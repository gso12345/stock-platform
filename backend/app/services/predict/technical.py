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
셋 가운데 평균 오차가 가장 작았던 것으로 예상 주가를 낸다(공모주의 '가장 잘 맞아 온 방식'). 그리고 그 방식이
'그대로' 보다 확실히 나았는지를 판정해 함께 내보낸다 — 아니면 화면이 '참고만' 이라고 말한다.

확실히 나았나 — 날마다의 오차 차이(그대로 - 그 방식)의 평균을, 겹치지 않는 표본 수(셈한 번수 × 5 ÷ h)로 본
표준오차로 나눈 값이 1 이상. 넷 가운데 가장 잘 맞은 것을 고르면 운으로 고르는 몫이 있어서, 무작위 걸음(맞힐 것이
없는 주가) 24벌에서 '그대로보다 덜 틀렸다' 만으로는 1개월 8%·3개월 17% 를 잘못 골랐다. 이 판정으로는 0%·4%.
평균으로 되돌아가는 규칙이 숨은 주가는 1주 79%·1개월 67% 를 알아본다(3개월은 겹치지 않는 표본이 적어 17%).

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
#: 견주는 차례 — 예상 주가는 기술적 방식(뒤의 셋) 가운데서 고르고, 같은 성적이면 앞의 것
방식차례 = ("flat", "knn", "ridge", "mid")
기술방식 = ("knn", "ridge", "mid")
#: 그대로보다 확실히 나았다고 볼 문턱 — 오차 차이의 평균 ÷ 표준오차(겹치지 않는 표본 수로)
믿을문턱 = 1.0


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
    """가까운 차례로, 서로 이웃간격 이상 떨어진 날만 이웃수만큼 — (뽑은 줄 번호, 거리)"""
    d = np.sqrt(((Z - z) ** 2).sum(axis=1))
    뽑은: list[int] = []
    for i in np.argsort(d, kind="stable"):
        if all(abs(int(자리[i]) - int(자리[j])) >= 이웃간격 for j in 뽑은):
            뽑은.append(int(i))
            if len(뽑은) == 이웃수:
                break
    return np.array(뽑은, dtype=int), d


def _셈(X: np.ndarray, y: np.ndarray, 학습: np.ndarray, x: np.ndarray) -> dict:
    """학습한 날들(지표 X·결과 y)로 지표 x 인 날을 맞힌다 — 비슷했던 때·회귀·둘의 가운데"""
    Xl, yl = X[학습], y[학습]
    μ, σ = Xl.mean(axis=0), Xl.std(axis=0)
    σ = np.where(σ > 1e-12, σ, 1.0)
    Z, z = (Xl - μ) / σ, (x - μ) / σ
    뽑은, 거리 = _이웃(Z, z, 학습)
    yn = yl[뽑은]
    knn = float(np.median(yn))
    평균 = float(yl.mean())
    β = np.linalg.solve(Z.T @ Z + len(Z) * np.eye(Z.shape[1]), Z.T @ (yl - 평균))   # 릿지 — 하루 하나만큼 줄인다
    ridge = 평균 + float(z @ β)
    return {
        "knn": knn, "ridge": ridge, "mid": (knn + ridge) / 2, "flat": 0.0,
        "이웃": 학습[뽑은], "이웃수익": yn, "이웃거리": 거리[뽑은],
        "q25": float(np.quantile(yn, 0.25)), "q75": float(np.quantile(yn, 0.75)),
    }


def _오르내림(yn: np.ndarray) -> dict:
    """비슷했던 때(그 뒤 로그 수익 yn) 가운데 오른 비율 · 가격으로 10% 넘게 오른 비율 · 10% 넘게 내린 비율"""
    return {
        "up": round(float(np.mean(yn > 0)), 4),
        "up10": round(float(np.mean(yn > math.log(1.1))), 4),
        "down10": round(float(np.mean(yn < math.log(0.9))), 4),
    }


def _검증(X, y, 쓸날, 날들: list[str], h: int) -> Optional[dict]:
    """지난 3년 매주, 그날 결과가 나와 있던 날들만으로 배워 그날을 맞혀 본다 — 방식마다 평균 오차·방향 맞힘"""
    n = len(y)
    끝 = n - 1 - h
    시작 = max(F.검증시작, n - 1 - F.창 - h)
    if 끝 < 시작:
        return None
    오차 = {k: [] for k in 방식차례}
    방향 = {k: [] for k in 방식차례 if k != "flat"}
    안50: list[bool] = []
    본날: list[int] = []
    for t in np.arange(끝, 시작 - 1, -F.검증간격)[::-1]:
        if not 쓸날[t]:
            continue
        학습 = np.flatnonzero(쓸날[: t - h + 1])                     # 결과가 t 까지 나온 날만
        if len(학습) < 최소학습:
            continue
        셈 = _셈(X, y, 학습, X[t])
        실제 = float(y[t])
        for k in 방식차례:
            오차[k].append(abs(math.exp(실제) - math.exp(셈[k])))
            if k != "flat" and 셈[k] != 0:
                방향[k].append((셈[k] > 0) == (실제 > 0))
        안50.append(셈["q25"] <= 실제 <= 셈["q75"])
        본날.append(int(t))
    if not 본날:
        return None
    성적 = {k: float(np.mean(v)) for k, v in 오차.items()}
    best = min(기술방식, key=lambda k: (round(성적[k], 12), 기술방식.index(k)))
    차이 = np.array(오차["flat"]) - np.array(오차[best])                # + 면 그 방식이 덜 틀렸다
    표본 = max(2.0, len(차이) * F.검증간격 / h)
    흩어짐 = float(np.std(차이, ddof=1)) if len(차이) > 1 else 0.0
    t값 = float(np.mean(차이)) / (흩어짐 / math.sqrt(표본)) if 흩어짐 > 0 else 0.0
    return {
        "n": len(본날), "from": 날들[본날[0]], "to": 날들[본날[-1] + h],
        "periods": int(max(1, (본날[-1] + h - 본날[0]) // h)),
        "in50": round(float(np.mean(안50)), 4),
        "best": best,
        #: 그대로보다 덜 틀린 비율(음수면 더 틀렸다) · 확실히 나았나
        "gain": round(1 - 성적[best] / 성적["flat"], 4) if 성적["flat"] > 0 else 0.0,
        "t": round(t값, 2),
        "beats_flat": bool(t값 >= 믿을문턱 and 성적[best] < 성적["flat"]),
        "methods": [{"key": k, "label": 방식이름[k], "mae": round(성적[k], 4),
                     "direction": round(float(np.mean(방향[k])), 4) if k in 방향 and 방향[k] else None}
                    for k in 방식차례],
    }


def 예측(날들: list[str], 종가: np.ndarray, 거래량: Optional[np.ndarray] = None,
       지수: Optional[np.ndarray] = None, 정수: bool = False, 미래날: Optional[list[str]] = None) -> Optional[dict]:
    """1주·1개월·3개월 뒤 — 예상 주가(가장 잘 맞아 온 방식) · 비슷했던 때의 가운데 절반 · 오른 비율 · 지난 3년 맞힘.
    지표가 자리 잡고 배울 날이 모자라면(일봉 2년 가까이 안 되면) None. 오늘 비어 있는 지표는 빼고(used=False) 셈한다"""
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
        검 = _검증(X, y, 쓸날, 날들, h)
        방식 = 검["best"] if 검 else "mid"
        yn = 셈["이웃수익"]
        보일 = np.argsort(셈["이웃거리"], kind="stable")[:보일이웃]
        rsi, gap = 표["rsi"], 표["gap200"]
        기간별.append({
            "days": h, "label": 이름, "date": 미래날[h - 1],
            "method": 방식, "method_label": 방식이름[방식],
            "predicted": 값(P0 * math.exp(셈[방식])),
            "knn": 값(P0 * math.exp(셈["knn"])), "ridge": 값(P0 * math.exp(셈["ridge"])),
            "range": [값(P0 * math.exp(셈["q25"])), 값(P0 * math.exp(셈["q75"]))],
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
