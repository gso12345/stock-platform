"""기술적 분석 예측 — 공모주 시초가 예측처럼(사용자: "기술적분석을 바탕으로 주가를 공모가처럼 예측해줘").

공모주 예측(services/ipo_service)은 상장 전에 알 수 있는 단서(기관경쟁률·확약·청약경쟁률 …)가 비슷했던 과거 공모주와
같은 단서로 세운 회귀식, 그 둘로 예측하고, 시간 순서대로 걸어가며 맞혀 본 성적으로 방식을 고른다.
여기서는 단서가 기술적 지표다 — 이동평균선 이격도 · RSI · MACD · 볼린저밴드 · 거래량 · 모멘텀 · 52주 고점 · 변동성 ·
시장 흐름(국내는 코스피, 해외는 S&P 500).

  · 비슷했던 때 — 이 종목의 지난날 가운데 지표가 지금과 가까웠던 날 15번(서로 5영업일 이상 떨어진 날만 — 바로 옆
    날들이 한 덩어리로 뽑히지 않게). 그 뒤 h 영업일 수익의 가운데 값이 예상, 가운데 절반이 범위, 오른 비율이 확률
  · 회귀(릿지) — 같은 지표로 세운 직선 모델
  · 둘의 가운데
  · 지금 가격 그대로 — 견줄 바탕
지난 3년 동안 매주, **그날 결과가 이미 나와 있던 날들만으로** 배워 그날을 맞혀 보고(앞날을 보지 않는다), 기술적 방식
셋 가운데 평균 오차가 가장 작았던 것을 기술적 신호로 고른다(공모주의 '가장 잘 맞아 온 방식').

실제 시세로 잰 것(국내 40·해외 39종목, 2016~2026년 일봉 — 과거 기준일 4,586번에 앱과 똑같이 그날까지의 5년만
넣어 예측하고 그 뒤 실제와 견주었다. 종목 절반으로 정하고 나머지 절반으로 확인):
  · 기술적 신호를 그대로 예상으로 쓰면 '지금 가격 그대로' 보다 1주 1.5%·1개월 5%·3개월 11% 더 틀렸다. 방향 맞힘은 50%
  · 지난 3년에 '그대로' 보다 확실히 나았던(판정값 1 이상) 때도 그 뒤로는 더 틀렸다 — 그래서 '확실히 낫다' 는 판정은 없앴다
  · 그래서 신호를 얼마나 반영할지(0·¼·½·¾·1)를 지난 3년 평균 오차로 고른다 — 더 틀리는 몫이 0.3%·1%·4% 로 줄었다.
    절반 남짓은 0 이 골라진다(예상 주가가 지금 가격)
  · 50% 범위는 지난 3년 예상 오차의 22~78% 자리(3개월은 20.5~79.5%)를 예상에 더한다. 비슷했던 때 15번의 가운데 절반은
    실제로 35~43% 만 들었고, 이렇게 하니 50~53% 가 들었다

기술적 분석은 짧은 앞날을 보는 도구라 3개월 뒤까지만 셈한다. 같은 종목의 지난날만 견주므로, 그 종목이 겪어 보지 못한
일(처음 겪는 큰 사건)은 모른다. 지표는 모두 그날까지의 시세로만 셈한다.
"""
import math
from typing import Optional

import numpy as np
import pandas as pd

from app.services.predict import forecast as F

기간들: tuple[tuple[int, str], ...] = ((5, "1주"), (21, "1개월"), (63, "3개월"))
#: 비슷했던 때를 몇 번 견줄까 — 공모주는 8곳, 하루하루는 훨씬 많아 조금 넉넉히
이웃수 = 15
#: 화면에 펼쳐 보일 비슷했던 때
보일이웃 = 8
#: 비슷했던 때끼리 이만큼(영업일) 떨어져 있어야 한다 — 어제와 오늘은 지표가 거의 같아 한 덩어리로 뽑힌다
이웃간격 = 5
#: 이보다 적게 배웠으면 맞히지 않는다
최소학습 = 200
#: 지표가 이만큼 넘게 비어 있으면(거래량을 안 주는 종목 · 시장 시세를 못 받았을 때) 그 지표는 빼고 셈한다
빈칸한도 = 0.2
#: 기술적 신호를 얼마나 반영할까 — 지난 3년 평균 오차가 가장 작은 것(같으면 큰 쪽)
반영들 = (0.0, 0.25, 0.5, 0.75, 1.0)
#: 50% 범위 — 지난 3년 예상 오차의 이 자리부터 (1 − 이 자리)까지를 예상에 더한다. 25~75% 로 두면 실제로 46%·46%·43% 만
#: 들었다(오차가 흔들려서). 이 자리로 넓히니 51%·51%·50%(종목 절반으로 정하고 나머지 절반에서 53%·52%·50%).
#: 그날의 출렁임으로 나눠 맞추는 것도 견주었는데, 같은 50% 에서 범위가 더 넓고 위 끝이 크게 튀어 버렸다
범위자리 = {5: 0.22, 21: 0.22, 63: 0.205}
#: 범위를 셀 지난 오차가 이보다 적으면 비슷했던 때 15번의 가운데 절반을 쓴다
범위최소 = 20

지표이름: dict[str, str] = {
    "gap200": "200일선 이격도",
    "gap20": "20일선 이격도",
    "ret21": "최근 1개월 수익",
    "mom": "1년 흐름(최근 1개월 빼고)",
    "rsi": "RSI(14일)",
    "macd": "MACD 히스토그램",
    "bb": "볼린저밴드 위치(%B)",
    "high52": "52주 고점 대비",
    "vol": "변동성(1개월 ÷ 1년)",
    "volume": "거래량(1주 ÷ 3개월)",
    "mkt_gap200": "시장 200일선 이격도",
    "mkt_ret21": "시장 최근 1개월",
}
방식이름: dict[str, str] = {"knn": "비슷했던 때", "ridge": "회귀", "mid": "둘의 가운데", "flat": "지금 가격 그대로"}
#: 견주는 차례 — 기술적 신호는 기술적 방식(뒤의 셋) 가운데서 고르고, 같은 성적이면 앞의 것
방식차례 = ("flat", "knn", "ridge", "mid")
기술방식 = ("knn", "ridge", "mid")


def 거래량맞추기(봉들: Optional[list], 날들: list[str]) -> np.ndarray:
    """일봉의 거래량을 종가 날짜에 맞춘다 — 없거나 이상하면 nan"""
    표: dict[str, float] = {}
    for b in 봉들 or []:
        if not isinstance(b, dict):
            continue
        d = str(b.get("date") or "")[:10]
        try:
            v = float(b.get("volume"))
        except (TypeError, ValueError):
            continue
        if d and math.isfinite(v) and v >= 0:
            표[d] = v
    return np.array([표.get(d, np.nan) for d in 날들], dtype=float)


def 지수맞추기(날들: list[str], 지수날들: list[str], 지수종가: np.ndarray) -> Optional[np.ndarray]:
    """시장 지수를 종목 날짜에 맞춘다 — 그날(없으면 그 전 가장 가까운 날)의 지수. 지수가 없으면 None"""
    if not 지수날들:
        return None
    자리 = np.searchsorted(np.array(지수날들), np.array(날들), side="right") - 1
    return np.where(자리 >= 0, np.asarray(지수종가, dtype=float)[np.clip(자리, 0, None)], np.nan)


def _ema(x: np.ndarray, 길이: int) -> np.ndarray:
    return pd.Series(x).ewm(span=길이, adjust=False).mean().to_numpy()


def _굴림(x: np.ndarray, 길이: int, 할일: str) -> np.ndarray:
    창 = pd.Series(x).rolling(길이)
    return getattr(창, 할일)(**({"ddof": 0} if 할일 == "std" else {})).to_numpy()


def _로그비(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    with np.errstate(divide="ignore", invalid="ignore"):
        out = np.log(a / b)
    return np.where(np.isfinite(out), out, np.nan)


def 지표표(C: np.ndarray, V: Optional[np.ndarray] = None, 지수: Optional[np.ndarray] = None) -> dict[str, np.ndarray]:
    """종가 자리 t 마다의 기술적 지표 — t 까지의 시세로만 셈한다(앞쪽은 nan)"""
    C = np.asarray(C, dtype=float)
    n = len(C)
    logC = np.log(C)
    out: dict[str, np.ndarray] = {}
    out["gap200"] = _로그비(C, F._이평(C, 200))
    out["gap20"] = _로그비(C, F._이평(C, 20))
    ret21 = np.full(n, np.nan)
    ret21[21:] = logC[21:] - logC[:-21]
    out["ret21"] = ret21
    mom = np.full(n, np.nan)
    if n > 252:
        mom[252:] = logC[231:n - 21] - logC[: n - 252]
    out["mom"] = mom
    rsi = F._rsi(C)
    rsi[: F.RSI데움] = np.nan
    out["rsi"] = rsi
    macd = _ema(C, 12) - _ema(C, 26)
    히스토 = (macd - _ema(macd, 9)) / C
    히스토[:60] = np.nan                                  # 지수 평균이 자리 잡을 때까지
    out["macd"] = 히스토
    가운데, 폭 = F._이평(C, 20), _굴림(C, 20, "std")
    with np.errstate(divide="ignore", invalid="ignore"):
        bb = (C - (가운데 - 2 * 폭)) / (4 * 폭)
    out["bb"] = np.where(np.isfinite(bb) & (폭 > 0), bb, np.nan)
    out["high52"] = _로그비(C, _굴림(C, 252, "max"))
    r = np.concatenate(([np.nan], np.diff(logC)))
    out["vol"] = _로그비(_굴림(r, 21, "std"), _굴림(r, 252, "std"))
    if V is not None:
        V = np.where(np.asarray(V, dtype=float) > 0, V, np.nan)
        out["volume"] = _로그비(_굴림(V, 5, "mean"), _굴림(V, 60, "mean"))
    else:
        out["volume"] = np.full(n, np.nan)
    if 지수 is not None:
        I = np.asarray(지수, dtype=float)
        out["mkt_gap200"] = _로그비(I, F._이평(I, 200))
        mret = np.full(n, np.nan)
        mret[21:] = _로그비(I[21:], I[:-21])
        out["mkt_ret21"] = mret
    else:
        out["mkt_gap200"] = np.full(n, np.nan)
        out["mkt_ret21"] = np.full(n, np.nan)
    return out


def 쓸지표(표: dict[str, np.ndarray]) -> list[str]:
    """모델에 넣을 지표 — 지표가 다 자리 잡은 뒤(252일째부터)에도 많이 비어 있는 것은 뺀다"""
    쓸 = []
    for k in 지표이름:
        뒤 = 표[k][252:]
        if len(뒤) and np.mean(np.isfinite(뒤)) >= 1 - 빈칸한도:
            쓸.append(k)
    return 쓸


def _이웃(Z: np.ndarray, z: np.ndarray, 자리: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """가까운 차례로, 서로 이웃간격 이상 떨어진 날만 이웃수만큼 — (뽑은 줄 번호, 거리).

    고른 날의 앞뒤 (이웃간격 − 1)일을 막아 두고 막히지 않은 날만 고른다. 고른 날 모두와 하나하나 견주던 것과 같은
    답인데, 그 견주기가 셈 전체의 40% 를 먹었다(지표가 비슷한 날은 붙어 있어 막힌 후보를 많이 훑는다)"""
    d = np.sqrt(((Z - z) ** 2).sum(axis=1))
    막힘 = np.zeros(int(자리.max()) + 이웃간격 + 1 if len(자리) else 1, dtype=bool)
    뽑은: list[int] = []
    for i in np.argsort(d, kind="stable"):
        p = int(자리[i])
        if 막힘[p]:
            continue
        뽑은.append(int(i))
        if len(뽑은) == 이웃수:
            break
        막힘[max(0, p - 이웃간격 + 1): p + 이웃간격] = True
    return np.array(뽑은, dtype=int), d


def _셈(X: np.ndarray, y: np.ndarray, 학습: np.ndarray, x: np.ndarray) -> dict:
    """학습한 날들(지표 X·결과 y)로 지표 x 인 날을 맞힌다 — 비슷했던 때·회귀·둘의 가운데"""
    Xl, yl = X[학습], y[학습]
    가운데뺀 = Xl - Xl.mean(axis=0)
    μ, σ = Xl.mean(axis=0), np.sqrt((가운데뺀 ** 2).mean(axis=0))
    σ = np.where(σ > 1e-12, σ, 1.0)
    Z, z = 가운데뺀 / σ, (x - μ) / σ
    뽑은, 거리 = _이웃(Z, z, 학습)
    yn = yl[뽑은]
    q25, knn, q75 = (float(v) for v in np.quantile(yn, (0.25, 0.5, 0.75)))   # 한 번에 — 셋을 따로 부르면 그만큼 느리다
    평균 = float(yl.mean())
    β = np.linalg.solve(Z.T @ Z + len(Z) * np.eye(Z.shape[1]), Z.T @ (yl - 평균))   # 릿지 — 하루 하나만큼 줄인다
    ridge = 평균 + float(z @ β)
    return {
        "knn": knn, "ridge": ridge, "mid": (knn + ridge) / 2, "flat": 0.0,
        "이웃": 학습[뽑은], "이웃수익": yn, "이웃거리": 거리[뽑은],
        "q25": q25, "q75": q75,
    }


def _오르내림(yn: np.ndarray) -> dict:
    """비슷했던 때(그 뒤 로그 수익 yn) 가운데 오른 비율 · 가격으로 10% 넘게 오른 비율 · 10% 넘게 내린 비율"""
    return {
        "up": round(float(np.mean(yn > 0)), 4),
        "up10": round(float(np.mean(yn > math.log(1.1))), 4),
        "down10": round(float(np.mean(yn < math.log(0.9))), 4),
    }


def _평균오차(실제: np.ndarray, 예상: np.ndarray) -> float:
    """가격으로 본 평균 오차 — 실제 +5%, 예상 +2% 면 3%"""
    return float(np.mean(np.abs(np.exp(실제) - np.exp(예상))))


def _검증(X, y, 쓸날, 날들: list[str], h: int) -> Optional[tuple[dict, np.ndarray]]:
    """지난 3년 매주, 그날 결과가 나와 있던 날들만으로 배워 그날을 맞혀 본다.

    방식마다 평균 오차·방향 맞힘을 세고, 가장 덜 틀린 기술적 방식(신호)과 그 신호를 얼마나 반영할지(반영들 가운데
    평균 오차가 가장 작은 것)를 고른다. 50% 범위가 실제로 맞았는지도 센다 — 날마다 **그날까지 결과가 나와 있던 날들의
    오차만으로** 범위를 그어(앞날을 보지 않게) 실제가 그 안에 들었나.
    (검증 결과, 반영한 예상의 오차들(로그)) — 셀 날이 없으면 None"""
    n = len(y)
    끝 = n - 1 - h
    시작 = max(F.검증시작, n - 1 - F.창 - h)
    if 끝 < 시작:
        return None
    예상 = {k: [] for k in 방식차례}
    본날: list[int] = []
    for t in np.arange(끝, 시작 - 1, -F.검증간격)[::-1]:
        if not 쓸날[t]:
            continue
        학습 = np.flatnonzero(쓸날[: t - h + 1])                     # 결과가 t 까지 나온 날만
        if len(학습) < 최소학습:
            continue
        셈 = _셈(X, y, 학습, X[t])
        for k in 방식차례:
            예상[k].append(셈[k])
        본날.append(int(t))
    if not 본날:
        return None
    날 = np.array(본날)
    실제 = y[날]
    예상 = {k: np.array(v) for k, v in 예상.items()}
    성적 = {k: _평균오차(실제, v) for k, v in 예상.items()}
    방향 = {k: (v[v != 0] > 0) == (실제[v != 0] > 0) for k, v in 예상.items() if k != "flat"}
    best = min(기술방식, key=lambda k: (round(성적[k], 12), 기술방식.index(k)))
    반영 = min(반영들, key=lambda w: (round(_평균오차(실제, w * 예상[best]), 12), -w))
    쓴 = 반영 * 예상[best]
    쓴오차 = _평균오차(실제, 쓴)
    # 50% 범위가 실제로 맞았나 — 날마다 그날까지 결과가 나온 앞날들의 오차로만 범위를 긋는다
    e = 실제 - 쓴
    자리 = 범위자리.get(h, 0.25)
    든: list[bool] = []
    for i, t in enumerate(본날):
        알던 = e[: i][날[: i] + h <= t]
        if len(알던) < 범위최소:
            continue
        아래, 위 = np.quantile(알던, (자리, 1 - 자리))
        든.append(bool(쓴[i] + 아래 <= 실제[i] <= 쓴[i] + 위))
    return {
        "n": len(본날), "from": 날들[본날[0]], "to": 날들[본날[-1] + h],
        "periods": int(max(1, (본날[-1] + h - 본날[0]) // h)),
        #: 50% 범위에 실제로 든 비율 — 그날까지 알던 오차로 그은 범위로(셀 날이 모자라면 없다)
        "in50": round(float(np.mean(든)), 4) if 든 else None,
        "best": best,
        #: 신호를 반영한 비율 — 0 이면 예상 주가가 지금 가격
        "weight": 반영,
        #: 반영한 예상이 '그대로' 보다 덜 틀린 비율(반영 0 도 고를 수 있으니 0 아래로 내려가지 않는다)
        "gain": round(1 - 쓴오차 / 성적["flat"], 4) if 성적["flat"] > 0 else 0.0,
        "mae_used": round(쓴오차, 4),
        "direction_used": round(float(np.mean(방향[best])), 4) if 반영 > 0 and len(방향[best]) else None,
        "methods": [{"key": k, "label": 방식이름[k], "mae": round(성적[k], 4),
                     "direction": round(float(np.mean(방향[k])), 4) if k in 방향 and len(방향[k]) else None}
                    for k in 방식차례],
    }, e


def 예측(날들: list[str], 종가: np.ndarray, 거래량: Optional[np.ndarray] = None,
       지수: Optional[np.ndarray] = None, 정수: bool = False, 미래날: Optional[list[str]] = None) -> Optional[dict]:
    """1주·1개월·3개월 뒤 — 기술적 신호(가장 잘 맞아 온 방식)와 그것을 반영한 예상 주가 · 50% 범위 · 비슷했던 때 ·
    지난 3년 맞힘. 지표가 자리 잡고 배울 날이 모자라면(일봉 2년 가까이 안 되면) None.
    오늘 비어 있는 지표는 빼고(used=False) 셈한다"""
    C = np.asarray(종가, dtype=float)
    n = len(C)
    if n < 252 + 최소학습 + 기간들[0][0]:
        return None
    표 = 지표표(C, 거래량, 지수)
    # 오늘 비어 있는 지표는 빼고 셈한다 — 최근 닷새 가운데 거래량 0(없음)인 날이 하루라도 있으면 거래량 지표가 비고,
    # 거래 정지로 값이 그대로면 출렁임이 빈다. 그 하나 때문에 통째로 못 셈하고 '시세가 모자라요' 로 읽히지 않게
    쓸 = [k for k in 쓸지표(표) if np.isfinite(표[k][-1])]
    if not 쓸:
        return None
    X = np.column_stack([표[k] for k in 쓸])
    쓸날 = np.all(np.isfinite(X), axis=1)
    logC = np.log(C)
    P0 = float(C[-1])
    미래날 = 미래날 or F._영업일(날들[-1], 기간들[-1][0])

    def 값(x: float):
        return int(round(float(x))) if 정수 else round(float(x), 2)

    기간별 = []
    for h, 이름 in 기간들:
        y = np.full(n, np.nan)
        y[: n - h] = logC[h:] - logC[: n - h]
        학습 = np.flatnonzero(쓸날[: n - h])                          # 결과가 나와 있는 날만
        if len(학습) < 최소학습:
            continue
        셈 = _셈(X, y, 학습, X[-1])
        검증 = _검증(X, y, 쓸날, 날들, h)
        검, e = 검증 if 검증 else (None, np.zeros(0))
        방식 = 검["best"] if 검 else "mid"
        반영 = 검["weight"] if 검 else 0.0               # 지난 성적을 셀 수 없으면 신호를 쓰지 않는다(지금 가격)
        쓴 = 반영 * 셈[방식]
        if len(e) >= 범위최소:
            자리 = 범위자리.get(h, 0.25)
            아래, 위 = np.quantile(e, (자리, 1 - 자리))
            범위 = [값(P0 * math.exp(쓴 + 아래)), 값(P0 * math.exp(쓴 + 위))]
            범위종류 = "errors"
        else:
            범위 = [값(P0 * math.exp(셈["q25"])), 값(P0 * math.exp(셈["q75"]))]
            범위종류 = "neighbors"
        yn = 셈["이웃수익"]
        보일 = np.argsort(셈["이웃거리"], kind="stable")[:보일이웃]
        rsi, gap = 표["rsi"], 표["gap200"]
        기간별.append({
            "days": h, "label": 이름, "date": 미래날[h - 1],
            "method": 방식, "method_label": 방식이름[방식],
            #: 기술적 신호만 본 값(고른 방식 그대로)과, 지난 3년 성적만큼 반영한 예상 주가
            "signal": 값(P0 * math.exp(셈[방식])),
            "weight": 반영,
            "predicted": 값(P0 * math.exp(쓴)),
            "knn": 값(P0 * math.exp(셈["knn"])), "ridge": 값(P0 * math.exp(셈["ridge"])),
            #: errors — 지난 예상 오차로 그은 50% 범위 · neighbors — 비슷했던 때 15번의 가운데 절반(오차가 모자랄 때)
            "range": 범위, "range_kind": 범위종류,
            **_오르내림(yn),
            "neighbor_count": int(len(yn)),
            "neighbors": [{
                "date": 날들[int(셈["이웃"][i])],
                "change": round(math.exp(float(yn[i])) - 1, 4),
                "rsi": round(float(rsi[셈["이웃"][i]]), 1) if np.isfinite(rsi[셈["이웃"][i]]) else None,
                "gap200": round(math.exp(float(gap[셈["이웃"][i]])) - 1, 4) if np.isfinite(gap[셈["이웃"][i]]) else None,
            } for i in 보일],
            "check": 검,
        })
    if not 기간별:
        return None
    return {
        "horizons": 기간별,
        "indicators": [{"key": k, "label": 지표이름[k],
                        "value": round(float(표[k][-1]), 4) if np.isfinite(표[k][-1]) else None,
                        "used": k in 쓸} for k in 지표이름],
        "neighbors_k": 이웃수, "min_gap_days": 이웃간격,
    }
