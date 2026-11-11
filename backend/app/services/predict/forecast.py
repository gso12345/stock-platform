"""주가예측 — 일봉으로 앞으로의 주가 범위와 확률을 셈한다(사용자: "주가예측 메뉴도 만들어줘").

숫자 하나로 '얼마가 된다' 고 말하지 않는다. 주가는 그렇게 맞힐 수 있는 것이 아니고, 한 숫자를 크게 두면 그게 답처럼
읽힌다(공모주 예측과 같은 까닭 — 화면의 components/ipo/IpoPrediction). 대신 이만큼은 꽤 믿을 만하게 말할 수 있다.
  · 얼마나 출렁일까 — 출렁임(변동성)은 몰려다닌다. 요즘 크게 움직인 종목은 당분간 크게 움직인다
  · 그래서 앞으로 어느 범위에 있을 가능성이 큰가 — 80%·50% 범위, 오를 확률
  · 그리고 이 방식이 이 종목에서 지난날 얼마나 맞았나 — 같은 방식으로 지난날을 예측해 범위 안에 든 비율을 센다

셈하는 법
  1) 변동성 — 최근 하루하루의 움직임에 무게를 더 두는 지수가중(EWMA, λ=0.94 — 리스크메트릭스의 일간 값)으로
     지금의 출렁임을 잰다. 먼 앞날일수록 지난 3년 평균 출렁임으로 돌아간다고 본다(하루 0.985 씩 — 반감기 약 46 영업일)
  2) 가운데(기대 흐름) — 주식의 장기 평균(연 7%)에서 시작해 이 종목의 지난 3년 수익률을 '믿을 만한 만큼만' 섞는다.
     과거 수익률은 잡음이 커서(연 30% 출렁이는 종목의 3년 평균은 ±17%p 남짓 어긋난다) 그대로 쓰면 많이 오른 종목은
     계속 오른다고 과하게 말한다. 섞는 비율 = τ² / (τ² + 어긋남²), τ = 연 10%
  3) 꼬리 — 하루 움직임을 그날의 변동성으로 나눈 값의 치우침·두꺼운 꼬리(왜도·첨도)를 범위에 반영한다(코니시-피셔).
     기간이 길수록 하루의 꼬리는 묽어진다(왜도 /√h, 첨도 /h)
  4) 검증 — 지난 3년 동안 매주(5 영업일마다) **그날까지의 자료만으로** 같은 셈을 해, h 영업일 뒤 실제 주가가 80%·50%
     범위 안에 든 비율을 센다. 범위가 제대로 그어졌다면 80%·50% 언저리가 나와야 한다

이 파일은 숫자만 다룬다(받기·담아 두기는 routes/predict). 같은 일봉이면 언제나 같은 답이 나온다(우연을 쓰지 않는다).
"""
import math
from statistics import NormalDist
from typing import Optional

import numpy as np

#: 지수가중 변동성의 붙잡는 정도 — 리스크메트릭스의 일간 값. 어제 움직임의 무게가 6%, 그 전날 5.6%, …
λ = 0.94
#: 지금 출렁임이 장기 평균으로 돌아가는 빠르기(하루) — 반감기 ln 0.5 / ln 0.985 ≈ 46 영업일
φ = 0.985
#: 장기 평균·꼬리·기대 수익을 재는 기간 — 약 3년(영업일)
창 = 756
#: 지수가중 변동성을 데우는 앞부분 — 이보다 앞의 하루 움직임은 꼬리 재기에 쓰지 않는다
데움 = 60
#: 이보다 짧으면 예측하지 않는다 — 1년 남짓은 있어야 평소 출렁임과 검증할 날이 생긴다
최소일수 = 300
연일수 = 252
#: 주식의 장기 평균 수익(연, 산술) — 가운데를 여기서 시작한다
기본기대 = 0.07
#: 종목마다 기대 수익이 그 기본에서 흩어진 정도(연, 표준편차) — 과거 수익을 얼마나 믿을지를 정한다
기대폭 = 0.10
기대한계 = (-0.15, 0.30)
#: 검증 — 몇 영업일마다 지난날을 예측해 볼까
검증간격 = 5
#: 검증의 맨 앞(종가 자리) — 이보다 앞은 그날까지의 자료가 모자라 셈하지 않는다
검증시작 = 260
기간들: tuple[tuple[int, str], ...] = ((5, "1주"), (21, "1개월"), (63, "3개월"), (126, "6개월"), (252, "1년"))
분위들 = (0.10, 0.25, 0.50, 0.75, 0.90)
#: 그래프에 함께 그릴 지난 주가(영업일) — 1년
그릴지난날 = 260
#: RSI 를 믿기 시작하는 자리 — 와일더 평균이 자리 잡을 때까지 기다린다
RSI기간 = 14
RSI데움 = 64

_정규 = NormalDist()
#: 누적확률을 구할 격자 — 코니시-피셔 분위를 거꾸로 읽는다
_격자p = np.linspace(0.0005, 0.9995, 1999)
_격자z = np.array([_정규.inv_cdf(float(p)) for p in _격자p])
_분위z = {p: _정규.inv_cdf(p) for p in 분위들}


class 자료부족(ValueError):
    """예측할 만큼 일봉이 없다 — 새로 상장했거나 거래가 끊겼다"""


def 종가정리(봉들: Optional[list]) -> tuple[list[str], np.ndarray]:
    """일봉 → (날짜들, 종가들). 날짜 차례로 세우고, 같은 날은 마지막 것, 비었거나 0 이하인 종가는 뺀다"""
    표: dict[str, float] = {}
    for b in 봉들 or []:
        if not isinstance(b, dict):
            continue
        d = str(b.get("date") or "")[:10]
        try:
            c = float(b.get("close"))
        except (TypeError, ValueError):
            continue
        if d and math.isfinite(c) and c > 0:
            표[d] = c
    날들 = sorted(표)
    return 날들, np.array([표[d] for d in 날들], dtype=float)


def _누적(x: np.ndarray) -> np.ndarray:
    return np.concatenate(([0.0], np.cumsum(x, dtype=float)))


def _ewma분산(r: np.ndarray) -> np.ndarray:
    """v[i] — r[i](i 번째 하루 로그 수익)의 분산을 그 전날까지만 보고 내다본 값.

    길이는 len(r)+1 — 끝(v[len(r)])은 아직 오지 않은 다음 날의 것. 0 이 되지 않게 바닥을 둔다(거래가 멈춘 종목)"""
    v = np.empty(len(r) + 1)
    v[0] = float(np.mean(r[:데움] ** 2)) if len(r) else 0.0
    for i in range(len(r)):
        v[i + 1] = λ * v[i] + (1 - λ) * r[i] * r[i]
    return np.maximum(v, 1e-12)


def _cf(z, s, k):
    """코니시-피셔 — 정규분포의 z 를 왜도 s·초과첨도 k 인 분포의 같은 자리로 옮긴다.
    s·k 를 작게 묶어 두면(|s|≤0.5, 0≤k≤3 — 실제로는 k≤1 만 쓴다) 차례가 뒤집히지 않는다(분위가 늘 커지는 쪽)"""
    return z + (z * z - 1) * s / 6 + (z ** 3 - 3 * z) * k / 24 - (2 * z ** 3 - 5 * z) * s * s / 36


class _자료:
    """한 종목의 일봉에서 미리 셈해 두는 것 — 지금의 예측과 지난날 검증이 같이 쓴다.

    종가 자리 t 는 '그날 장 마감까지 안다' 는 뜻이다. 그때 아는 하루 수익은 r[0..t-1], 다음 날의 분산 예상은 v[t]"""

    def __init__(self, 종가: np.ndarray):
        self.C = 종가
        self.r = np.diff(np.log(종가))
        self.s = 종가[1:] / 종가[:-1] - 1
        self.v = _ewma분산(self.r)
        쓸 = np.arange(len(self.r)) >= 데움
        z = np.where(쓸, self.r / np.sqrt(self.v[:-1]), 0.0)
        self.P2 = _누적(self.r ** 2)
        self.Ps = _누적(self.s)
        self.Pm = _누적(쓸.astype(float))
        self.Pz = [_누적(z ** k) for k in (1, 2, 3, 4)]

    def 통계(self, t) -> dict:
        """종가 자리 t 들(여럿 한꺼번에)의 셈 재료 — 그때까지의 자료만 쓴다"""
        t = np.atleast_1d(np.asarray(t, dtype=int))
        a = np.maximum(0, t - 창)
        길이 = np.maximum(t - a, 1)
        장기 = np.maximum((self.P2[t] - self.P2[a]) / 길이, 1e-12)
        평균단순 = (self.Ps[t] - self.Ps[a]) / 길이
        # 가운데 — 기본에서 시작해 과거 수익을 믿을 만한 만큼만 섞는다
        어긋남제곱 = 장기 * 연일수 / (길이 / 연일수)
        w = 기대폭 ** 2 / (기대폭 ** 2 + 어긋남제곱)
        기대 = np.clip(기본기대 + w * (평균단순 * 연일수 - 기본기대), *기대한계)
        # 꼬리 — 변동성으로 나눈 하루 움직임의 왜도·초과첨도
        개수 = self.Pm[t] - self.Pm[a]
        m1, m2, m3, m4 = ((P[t] - P[a]) / np.maximum(개수, 1) for P in self.Pz)
        분산 = np.maximum(m2 - m1 ** 2, 1e-12)
        왜 = (m3 - 3 * m1 * m2 + 2 * m1 ** 3) / 분산 ** 1.5
        첨 = (m4 - 4 * m1 * m3 + 6 * m1 ** 2 * m2 - 3 * m1 ** 4) / 분산 ** 2 - 3
        모자람 = 개수 < 데움
        return {
            "지금": self.v[t], "장기": 장기, "기대": 기대,
            "왜": np.where(모자람, 0.0, np.clip(왜, -2.0, 2.0)),
            "첨": np.where(모자람, 0.0, np.clip(첨, 0.0, 20.0)),
        }


def _모양(h, 통):
    """h 영업일 뒤 로그 수익의 (가운데 M, 분산 V, 왜도, 초과첨도). h·통계는 수 하나든 여럿이든 된다"""
    h = np.asarray(h, dtype=float)
    V = np.maximum(h * 통["장기"] + (통["지금"] - 통["장기"]) * (1 - φ ** h) / (1 - φ), 1e-12)
    M = h * 통["기대"] / 연일수 - V / 2
    s = np.clip(통["왜"] / np.sqrt(h), -0.5, 0.5)
    #: 첨도 보정은 1 까지만 — 꼬리가 아주 두꺼운 종목(t 분포 자유도 3)에서 3 까지 두니 가운데 범위를 너무 좁혀
    #: 50% 범위의 적중이 45% 로 떨어졌다(가짜 주가 30벌 평균). 1 이면 정규·두꺼운 꼬리 모두 48~51%
    k = np.clip(통["첨"] / h, 0.0, 1.0)
    return M, V, s, k


def _분위(p: float, M, V, s, k):
    """로그 수익의 p 분위"""
    z = _분위z[p] if p in _분위z else _정규.inv_cdf(p)
    return M + np.sqrt(V) * _cf(z, s, k)


def _넘을확률(x: float, M: float, V: float, s: float, k: float) -> float:
    """로그 수익이 x 를 넘을 확률(수 하나)"""
    누적 = float(np.interp((x - M) / math.sqrt(V), _cf(_격자z, s, k), _격자p, left=0.0, right=1.0))
    return 1.0 - 누적


def _영업일(마지막: str, 개수: int) -> list[str]:
    """마지막 날 다음부터 개수만큼의 평일(주말만 건너뛴다 — 휴장일은 모른다, 어림 날짜)"""
    d = np.datetime64(마지막[:10], "D")
    return [str(x) for x in np.busday_offset(d, np.arange(1, 개수 + 1), roll="forward")]


def _검증(자료: _자료, 날들: list[str], h: int) -> Optional[dict]:
    """지난 3년 동안 매주, 그날까지의 자료만으로 h 영업일 뒤를 예측해 실제 주가가 범위 안에 든 비율"""
    n = len(자료.C)
    끝 = n - 1 - h
    시작 = max(검증시작, n - 1 - 창 - h)
    if 끝 < 시작:
        return None
    T = np.arange(끝, 시작 - 1, -검증간격)[::-1]      # 가장 최근에 결과가 나온 날까지 닿게 끝에서 거꾸로 센다
    M, V, s, k = _모양(h, 자료.통계(T))
    R = np.log(자료.C[T + h] / 자료.C[T])
    아래80, 위80 = _분위(0.10, M, V, s, k), _분위(0.90, M, V, s, k)
    아래50, 위50 = _분위(0.25, M, V, s, k), _분위(0.75, M, V, s, k)
    return {
        "n": int(len(T)),
        "in80": round(float(np.mean((R >= 아래80) & (R <= 위80))), 4),
        "in50": round(float(np.mean((R >= 아래50) & (R <= 위50))), 4),
        "above80": round(float(np.mean(R > 위80)), 4),
        "below80": round(float(np.mean(R < 아래80)), 4),
        #: 겹치지 않는 h 영업일 구간이 몇 번 들어갔나 — 1년 뒤 예측은 매주 셈해도 서로 크게 겹친다
        "periods": int(max(1, (int(T[-1]) + h - int(T[0])) // h)),
        "from": 날들[int(T[0])],
        "to": 날들[int(T[-1]) + h],
    }


def _이평(C: np.ndarray, w: int) -> np.ndarray:
    P = _누적(C)
    out = np.full(len(C), np.nan)
    if len(C) >= w:
        out[w - 1:] = (P[w:] - P[:-w]) / w
    return out


def _rsi(C: np.ndarray, 기간: int = RSI기간) -> np.ndarray:
    """와일더 RSI — t 자리의 값은 t 까지의 종가로 셈한다(앞 기간 자리까지는 nan)"""
    out = np.full(len(C), np.nan)
    if len(C) <= 기간:
        return out
    d = np.diff(C)
    오름, 내림 = np.clip(d, 0, None), np.clip(-d, 0, None)
    평오, 평내 = float(오름[:기간].mean()), float(내림[:기간].mean())
    for t in range(기간, len(C)):
        if t > 기간:
            평오 = (평오 * (기간 - 1) + 오름[t - 1]) / 기간
            평내 = (평내 * (기간 - 1) + 내림[t - 1]) / 기간
        out[t] = 100.0 if 평내 == 0 else 100 - 100 / (1 + 평오 / 평내)
    return out


def _비율들(C: np.ndarray, 상태: np.ndarray, 쓸: np.ndarray) -> dict:
    """기간마다 — 지금과 같은 상태였던 날들 가운데 h 영업일 뒤 주가가 올라 있던 비율(그리고 모든 날의 비율)"""
    n = len(C)
    지금상태 = 상태[-1]
    out = {}
    for h, _ in 기간들:
        t = np.flatnonzero(쓸[: n - h])
        if len(t) == 0:
            out[str(h)] = None
            continue
        올랐나 = C[t + h] > C[t]
        같은 = 상태[t] == 지금상태
        out[str(h)] = {
            "cond": round(float(올랐나[같은].mean()), 4) if 같은.any() else None,
            "n": int(같은.sum()),
            "base": round(float(올랐나.mean()), 4),
            "total": int(len(t)),
        }
    return out


def _근거(C: np.ndarray, 값) -> list[dict]:
    """지금의 상태 셋 — 그리고 이 종목에서 같은 상태였을 때 뒤에 오른 비율(지난 자료 그대로 센 것)"""
    n = len(C)
    out = []
    이평 = _이평(C, 200)
    쓸 = ~np.isnan(이평)
    if 쓸[-1]:
        상태 = np.where(쓸, C >= np.nan_to_num(이평), False)
        out.append({"key": "trend", "state": "above" if 상태[-1] else "below",
                    "price": 값(C[-1]), "ma200": 값(이평[-1]), "rates": _비율들(C, 상태, 쓸)})
    if n > 252:
        흐름 = np.full(n, np.nan)
        흐름[252:] = C[231:n - 21] / C[: n - 252] - 1
        쓸 = ~np.isnan(흐름)
        상태 = np.where(쓸, np.nan_to_num(흐름) > 0, False)
        out.append({"key": "momentum", "state": "up" if 상태[-1] else "down",
                    "ret": round(float(흐름[-1]), 4), "rates": _비율들(C, 상태, 쓸)})
    r = _rsi(C)
    쓸 = (~np.isnan(r)) & (np.arange(n) >= RSI데움)
    if 쓸[-1]:
        rr = np.nan_to_num(r)
        상태 = np.where(rr >= 70, 2, np.where(rr <= 30, 0, 1))
        out.append({"key": "rsi", "state": ("cold", "normal", "hot")[int(상태[-1])],
                    "value": round(float(r[-1]), 1), "rates": _비율들(C, 상태, 쓸)})
    return out


def 예측(날들: list[str], 종가: np.ndarray, 정수: bool = False) -> dict:
    """앞으로의 범위·확률·검증·근거 — routes/predict 가 그대로 내보낸다.

    정수: 원화처럼 소수 없는 값으로 내보낼까(국내 종목)"""
    n = len(종가)
    if n < 최소일수:
        raise 자료부족(f"예측하려면 일봉이 {최소일수}일(1년 남짓) 넘게 있어야 해요 — 지금 {n}일")
    자료 = _자료(np.asarray(종가, dtype=float))
    통 = {이름: float(v[0]) for 이름, v in 자료.통계(n - 1).items()}
    P0 = float(종가[-1])

    def 값(x: float):
        return int(round(float(x))) if 정수 else round(float(x), 2)

    가장긴 = 기간들[-1][0]
    미래날 = _영업일(날들[-1], 가장긴)

    # 부채꼴 — 1 ~ 252 영업일 뒤의 분위(화면이 고른 기간만큼 잘라 그린다)
    날수 = np.arange(1, 가장긴 + 1)
    M, V, s, kk = _모양(날수, 통)
    분위값 = {p: P0 * np.exp(_분위(p, M, V, s, kk)) for p in 분위들}
    부채꼴 = [
        {"day": int(i + 1), "date": 미래날[i], **{f"q{int(p * 100)}": 값(분위값[p][i]) for p in 분위들}}
        for i in range(가장긴)
    ]

    기간별 = []
    for h, 이름 in 기간들:
        M, V, s, kk = (float(x) for x in _모양(h, 통))
        기간별.append({
            "days": h, "label": 이름, "date": 미래날[h - 1],
            **{f"q{int(p * 100)}": 값(P0 * math.exp(float(_분위(p, M, V, s, kk)))) for p in 분위들},
            "up": round(_넘을확률(0.0, M, V, s, kk), 4),
            "up10": round(_넘을확률(math.log(1.1), M, V, s, kk), 4),
            "down10": round(1 - _넘을확률(math.log(0.9), M, V, s, kk), 4),
            "check": _검증(자료, 날들, h),
        })

    return {
        "as_of": 날들[-1],
        "price": 값(P0),
        "days_used": n,
        "volatility": {"now": round(math.sqrt(통["지금"] * 연일수), 4),
                       "long": round(math.sqrt(통["장기"] * 연일수), 4)},
        "expected_return": round(통["기대"], 4),
        "horizons": 기간별,
        "path": 부채꼴,
        "history": [{"date": d, "close": 값(c)} for d, c in zip(날들[-그릴지난날:], 종가[-그릴지난날:])],
        "signals": _근거(자료.C, 값),
        "method": {"lambda": λ, "half_life_days": round(math.log(0.5) / math.log(φ)),
                   "window_days": 창, "prior_return": 기본기대, "check_step_days": 검증간격},
    }
