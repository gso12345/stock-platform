"""기술적 분석 예측 — 사용자: "기술적분석을 바탕으로 주가를 공모가처럼 예측해줘".

조용히 틀리기 쉬운 곳
  · 지표가 손으로 셈한 값과 같나(이동평균·RSI·MACD·볼린저·52주 고점·변동성·거래량·시장)
  · 앞날을 훔쳐보지 않나 — 지표도, 비슷했던 때도, 지난 맞힘도 그날까지의 시세만
  · 맞힐 것이 숨은 주가는 알아보고, 맞힐 것이 없는 주가(무작위 걸음)에서는 '확실히 낫다' 고 말하지 않나
  · 없는 종목은 404 — 야후의 빈 표를 '받다가 실패' 로 읽어 503 이 나가던 것
"""
import math

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.core.cache import cache
from app.api.routes import predict as R
from app.services.predict import forecast as F, technical as T

API = "/api/v1/predict"


def _날들(n: int, 끝: str = "2026-11-10") -> list[str]:
    return [str(d) for d in np.busday_offset(np.datetime64(끝, "D"), np.arange(-(n - 1), 1), roll="backward")]


def _무작위(n=1260, 씨=1, 시작=100.0) -> np.ndarray:
    rng = np.random.default_rng(씨)
    return 시작 * np.exp(np.cumsum(rng.normal(0, 0.02, n)))


def _되돌림(n=1260, 씨=1) -> np.ndarray:
    """느린 걸음 + 평균으로 되돌아가는 출렁임(AR 0.9) — 20일선에서 멀어질수록 돌아온다"""
    rng = np.random.default_rng(씨)
    m = np.cumsum(rng.normal(0, 0.005, n))
    x = np.zeros(n)
    for i in range(1, n):
        x[i] = 0.9 * x[i - 1] + rng.normal(0, 0.03)
    return 100 * np.exp(m + x)


def _기간(결과, 이름):
    return next(h for h in 결과["horizons"] if h["label"] == 이름)


# ── 지표 ──────────────────────────────────────────────────────
def test_지표를_손으로_셈한_것과_견준다():
    rng = np.random.default_rng(4)
    n = 700
    C = 100 * np.exp(np.cumsum(rng.normal(0.0005, 0.015, n)))
    V = rng.uniform(1e5, 3e5, n)
    I = 2500 * np.exp(np.cumsum(rng.normal(0.0003, 0.01, n)))
    표 = T.지표표(C, V, I)
    lc = np.log(C)
    r = np.diff(lc)                                                   # r[j] — j+1 날의 하루 수익
    # MACD — 12·26 지수 평균의 차, 그 9 지수 평균과의 차를 종가로 나눈다
    def ema(x, 길이):
        a, out = 2 / (길이 + 1), np.empty(len(x))
        out[0] = x[0]
        for i in range(1, len(x)):
            out[i] = a * x[i] + (1 - a) * out[i - 1]
        return out
    macd = ema(C, 12) - ema(C, 26)
    신호 = ema(macd, 9)

    def 볼린저(t):                                                    # 20일 평균 ± 2 표준편차(모집단) 사이의 자리
        창 = C[t - 19:t + 1]
        아래, 위 = 창.mean() - 2 * 창.std(), 창.mean() + 2 * 창.std()
        return (C[t] - 아래) / (위 - 아래)
    손 = {
        "gap200": lambda t: math.log(C[t] / C[t - 199:t + 1].mean()),
        "gap20": lambda t: math.log(C[t] / C[t - 19:t + 1].mean()),
        "ret21": lambda t: lc[t] - lc[t - 21],
        "mom": lambda t: lc[t - 21] - lc[t - 252],
        "rsi": lambda t: F._rsi(C)[t],
        "macd": lambda t: (macd[t] - 신호[t]) / C[t],
        "bb": 볼린저,
        "high52": lambda t: math.log(C[t] / C[t - 251:t + 1].max()),
        "vol": lambda t: math.log(r[t - 21:t].std() / r[t - 252:t].std()),     # 최근 21일 ÷ 252일
        "volume": lambda t: math.log(V[t - 4:t + 1].mean() / V[t - 59:t + 1].mean()),
        "mkt_gap200": lambda t: math.log(I[t] / I[t - 199:t + 1].mean()),
        "mkt_ret21": lambda t: math.log(I[t] / I[t - 21]),
    }
    assert set(손) == set(T.지표이름)
    # 하루만 보면 창 길이가 하나 틀려도 같은 값이 나오기 쉽다(52주 최고가가 창 끝에 걸린 날만 다르다) — 모든 날을 본다
    for k, 셈 in 손.items():
        # pandas 의 굴리는 표준편차는 1e-12 남짓 어긋난다 — 창이 하루 틀리면 1e-4 넘게 어긋난다
        assert np.allclose(표[k][260:], [셈(t) for t in range(260, n)], rtol=1e-9, atol=1e-9), k
    # 자리 잡기 전은 비우고, 자리 잡은 첫날부터 채운다
    첫날 = {"gap200": 199, "gap20": 19, "ret21": 21, "mom": 252, "rsi": F.RSI데움, "macd": 60, "bb": 19,
           "high52": 251, "vol": 252, "volume": 59, "mkt_gap200": 199, "mkt_ret21": 21}
    for k, d in 첫날.items():
        assert np.isnan(표[k][d - 1]) and np.isfinite(표[k][d]), k


def test_지표는_그날까지의_시세로만():
    rng = np.random.default_rng(5)
    n = 700
    C = 100 * np.exp(np.cumsum(rng.normal(0, 0.015, n)))
    V = rng.uniform(1e5, 3e5, n)
    I = 2500 * np.exp(np.cumsum(rng.normal(0, 0.01, n)))
    t = 500
    C2, V2, I2 = C.copy(), V.copy(), I.copy()
    C2[t + 1:] *= 1.7
    V2[t + 1:] *= 5
    I2[t + 1:] *= 0.6
    가, 나 = T.지표표(C, V, I), T.지표표(C2, V2, I2)
    for k in T.지표이름:
        assert np.allclose(가[k][:t + 1], 나[k][:t + 1], equal_nan=True), k
        assert not np.allclose(가[k][t + 2:], 나[k][t + 2:], equal_nan=True) or k in ("rsi",), k


def test_비어_있는_지표는_빼고_셈한다():
    C = _무작위(700)
    assert "volume" not in T.쓸지표(T.지표표(C, None, None))
    assert not {"mkt_gap200", "mkt_ret21"} & set(T.쓸지표(T.지표표(C, None, None)))
    V = np.where(np.arange(700) % 2 == 0, 1e5, 0.0)                  # 반은 거래량이 0(없음)
    assert "volume" not in T.쓸지표(T.지표표(C, V, None))
    전부 = T.쓸지표(T.지표표(C, np.full(700, 1e5) * (1 + np.arange(700) % 3), C * 20))
    assert 전부 == list(T.지표이름)
    # 거래량이 늦게 시작한 종목 — 지표가 다 자리 잡은 252일째부터 셈해 20% 넘게 비면 빼고, 덜 비면 쓴다
    V = np.full(700, 1e5) * (1 + np.arange(700) % 3)
    늦게, 조금 = V.copy(), V.copy()
    늦게[:305] = np.nan                                               # 거래량 지표는 364일째부터 — 75%만 찼다
    조금[:250] = np.nan                                               # 309일째부터 — 87% 찼다
    assert "volume" not in T.쓸지표(T.지표표(C, 늦게, None))
    assert "volume" in T.쓸지표(T.지표표(C, 조금, None))


def test_지수를_종목_날짜에_맞춘다():
    날들 = ["2026-01-02", "2026-01-05", "2026-01-06", "2026-01-07"]
    지수 = T.지수맞추기(날들, ["2026-01-03", "2026-01-06"], np.array([10.0, 11.0]))
    assert np.isnan(지수[0])                                    # 지수 첫날보다 앞
    assert 지수[1:].tolist() == [10.0, 11.0, 11.0]              # 없는 날은 그 전 가장 가까운 날
    assert T.지수맞추기(날들, [], np.array([])) is None


def test_거래량을_종가_날짜에_맞춘다():
    v = T.거래량맞추기([{"date": "2026-01-05", "volume": 30}, {"date": "2026-01-02T00:00", "volume": "10"},
                     {"date": "2026-01-06", "volume": None}, {"date": "2026-01-07", "volume": -1}, "깨짐"],
                    ["2026-01-02", "2026-01-05", "2026-01-06", "2026-01-07"])
    assert v[:2].tolist() == [10.0, 30.0] and np.isnan(v[2]) and np.isnan(v[3])


# ── 비슷했던 때 · 회귀 ────────────────────────────────────────
def test_비슷했던_때는_서로_떨어지고_배운_날에서만():
    rng = np.random.default_rng(6)
    X = rng.normal(size=(600, 4))
    y = rng.normal(size=600)
    학습 = np.arange(100, 500)
    셈 = T._셈(X, y, 학습, X[550])
    이웃 = np.sort(셈["이웃"])
    assert len(이웃) == T.이웃수
    assert set(이웃) <= set(학습)
    assert np.all(np.diff(이웃) >= T.이웃간격)
    yn = y[셈["이웃"]]
    assert 셈["knn"] == pytest.approx(float(np.median(yn)))
    assert (셈["q25"], 셈["q75"]) == pytest.approx((float(np.quantile(yn, 0.25)), float(np.quantile(yn, 0.75))))
    assert 셈["q25"] <= 셈["knn"] <= 셈["q75"]
    assert 셈["mid"] == pytest.approx((셈["knn"] + 셈["ridge"]) / 2) and 셈["flat"] == 0
    # 회귀 — 표준화한 지표로 릿지(하루 하나만큼)
    Xl, yl = X[학습], y[학습]
    μ, σ = Xl.mean(0), Xl.std(0)
    Z, z = (Xl - μ) / σ, (X[550] - μ) / σ
    β = np.linalg.solve(Z.T @ Z + len(Z) * np.eye(4), Z.T @ (yl - yl.mean()))
    assert 셈["ridge"] == pytest.approx(yl.mean() + z @ β)


def test_같은_지표면_가장_가까운_날부터():
    X = np.zeros((300, 2))
    X[:, 0] = np.arange(300)
    y = np.arange(300, dtype=float)
    셈 = T._셈(X, y, np.arange(0, 250), np.array([100.0, 0.0]))
    # 100 에서 가까운 차례로, 5 일 이상 떨어진 것만 — 100, 95, 105, 90, 110, …
    assert sorted(셈["이웃"].tolist()) == sorted([100, 95, 105, 90, 110, 85, 115, 80, 120, 75, 125, 70, 130, 65, 135])


def test_오른_비율과_10퍼센트는_가격으로_센다():
    """'10% 넘게' 는 가격으로 10% — 로그 수익 0.1(가격 10.5%)과 헷갈리기 쉽다. 그 사이에 걸린 날로 견준다"""
    yn = np.log([1.101, 1.05, 0.902, 0.95, 0.899, 1.0])
    # 1.101(10.1% 오름)은 10% 넘게 오른 때, 0.902(9.8% 내림)는 아니고 0.899(10.1% 내림)는 10% 넘게 내린 때
    assert T._오르내림(yn) == {"up": round(2 / 6, 4), "up10": round(1 / 6, 4), "down10": round(1 / 6, 4)}


def test_되돌림이_숨은_주가는_알아본다():
    """20일선에서 멀어지면 돌아오는 주가 — 1주·1개월 예측이 '그대로' 보다 확실히 낫다고 대개 알아본다"""
    알아봄 = {"1주": 0, "1개월": 0}
    for 씨 in range(1, 7):
        결과 = T.예측(_날들(1260), _되돌림(씨=씨))
        for 이름 in 알아봄:
            검 = _기간(결과, 이름)["check"]
            알아봄[이름] += 검["beats_flat"]
            assert 검["gain"] > 0, (씨, 이름, 검)
    assert 알아봄["1주"] >= 4 and 알아봄["1개월"] >= 3, 알아봄


def test_맞힐_것이_없는_주가에서는_확실히_낫다고_말하지_않는다():
    잘못 = 그대로가_나았던 = 0
    for 씨 in range(1, 9):
        for h in T.예측(_날들(1260), _무작위(씨=씨))["horizons"]:
            검 = h["check"]
            잘못 += 검["beats_flat"]
            # 예상은 언제나 기술적 방식 셋 가운데서 — '그대로' 가 가장 덜 틀렸어도(무작위 걸음에서는 흔하다) 그것을 내지 않는다
            assert h["method"] == 검["best"] in T.기술방식
            그대로가_나았던 += 검["gain"] < 0
    assert 잘못 <= 1, 잘못
    assert 그대로가_나았던 > 0                                          # 위의 확인이 헛돌지 않게


def test_예상은_가장_잘_맞아_온_기술적_방식으로():
    날들 = _날들(1260)
    결과 = T.예측(날들, _되돌림(씨=2))
    P0 = round(float(_되돌림(씨=2)[-1]), 2)
    for h in 결과["horizons"]:
        검 = h["check"]
        # 지난 3년(창 756 영업일)만 매주 — 그보다 앞은 맞혀 보지 않는다
        처음 = 1260 - 1 - F.창 - h["days"]
        assert 날들.index(검["from"]) >= 처음
        매주 = len(range(1260 - 1 - h["days"], 처음 - 1, -F.검증간격))          # 3년을 매주 — 152번
        if h["days"] <= 21:
            assert 검["n"] == 매주
        else:                                                         # 3개월은 앞쪽 몇 주가 배울 날(200일)이 모자라 빠진다
            assert 0.8 * 매주 < 검["n"] < 매주
        성적 = {m["key"]: m["mae"] for m in 검["methods"]}
        assert [m["key"] for m in 검["methods"]] == ["flat", "knn", "ridge", "mid"]
        assert 검["best"] == min(("knn", "ridge", "mid"), key=lambda k: 성적[k]) == h["method"]
        assert h["method_label"] == T.방식이름[h["method"]]
        if h["method"] in ("knn", "ridge"):
            assert h["predicted"] == h[h["method"]]
        else:
            assert h["predicted"] == pytest.approx(math.sqrt(h["knn"] * h["ridge"]), rel=1e-3)
        # 서버는 반올림 전 오차로 셈한다 — 넷째 자리로 반올림된 오차로 견주니 그만큼 넉넉히
        assert 검["gain"] == pytest.approx(1 - 성적[검["best"]] / 성적["flat"], abs=3e-3)
        assert h["range"][0] <= h["range"][1]
        assert 0 <= h["down10"] <= 1 - h["up"] and 0 <= h["up10"] <= h["up"] <= 1
        assert h["neighbor_count"] == T.이웃수 and abs(h["up"] * T.이웃수 - round(h["up"] * T.이웃수)) < 1e-3
        assert len(h["neighbors"]) == T.보일이웃
        assert P0 > 0


def test_지난_맞힘을_한_줄씩_다시_세어_본다():
    """_검증 을 쉬운 반복으로 다시 — 그날까지 잘라 낸 시세로 지표를 다시 셈해 배운다(앞날을 보지 않는다)"""
    C = _되돌림(n=800, 씨=3)
    날들 = _날들(len(C))
    n, h = len(C), 21
    결과 = T.예측(날들, C)
    검 = _기간(결과, "1개월")["check"]
    오차 = {k: [] for k in T.방식차례}
    맞음 = {k: [] for k in T.기술방식}
    안50 = []
    T_ = list(range(n - 1 - h, max(F.검증시작, n - 1 - F.창 - h) - 1, -5))[::-1]
    본 = []
    for t in T_:
        잘린 = C[: t + 1]
        표 = T.지표표(잘린)
        쓸 = T.쓸지표(T.지표표(C))                                   # 쓰는 지표는 전체로 정한 것과 같게
        X = np.column_stack([표[k] for k in 쓸])
        쓸날 = np.all(np.isfinite(X), axis=1)
        if not 쓸날[t]:
            continue
        y = np.full(t + 1, np.nan)
        y[: t + 1 - h] = np.log(잘린[h:] / 잘린[: t + 1 - h])
        학습 = np.flatnonzero(쓸날[: t - h + 1])
        if len(학습) < T.최소학습:
            continue
        셈 = T._셈(X, y, 학습, X[t])
        실제 = math.log(C[t + h] / C[t])
        for k in T.방식차례:
            오차[k].append(abs(math.exp(실제) - math.exp(셈[k])))
        for k in T.기술방식:
            맞음[k].append((셈[k] > 0) == (실제 > 0))
        안50.append(셈["q25"] <= 실제 <= 셈["q75"])
        본.append(t)
    assert 검["n"] == len(본) and 검["from"] == 날들[본[0]] and 검["to"] == 날들[본[-1] + h]
    assert 검["periods"] == (본[-1] + h - 본[0]) // h                   # 겹치지 않는 기간 수
    assert 검["in50"] == round(float(np.mean(안50)), 4)
    for m in 검["methods"]:
        assert m["mae"] == round(float(np.mean(오차[m["key"]])), 4)
        if m["key"] != "flat":
            assert m["direction"] == round(float(np.mean(맞음[m["key"]])), 4)
    # 확실히 나았나 — 오차 차이의 평균 ÷ (흩어짐 ÷ √겹치지 않는 표본 수)
    차이 = np.array(오차["flat"]) - np.array(오차[검["best"]])
    표본 = max(2.0, len(차이) * 5 / h)
    t값 = 차이.mean() / (차이.std(ddof=1) / math.sqrt(표본))
    assert 검["t"] == round(t값, 2) and 검["beats_flat"] == (t값 >= 1.0)


def test_비슷했던_때는_결과가_나온_날뿐이고_날짜를_보여_준다():
    C = _되돌림(씨=4)
    n = len(C)
    날들 = _날들(n)
    결과 = T.예측(날들, C)
    rsi, 이평200 = F._rsi(C), F._이평(C, 200)
    표 = T.지표표(C)
    X = np.column_stack([표[k] for k in T.쓸지표(표)])
    쓸날 = np.all(np.isfinite(X), axis=1)
    for h in 결과["horizons"]:
        d = h["days"]
        for 이웃 in h["neighbors"]:
            i = 날들.index(이웃["date"])
            assert i + d <= n - 1                                  # 그 뒤 h 영업일의 결과가 나와 있다
            assert 이웃["change"] == round(C[i + d] / C[i] - 1, 4)
            assert 이웃["rsi"] == round(float(rsi[i]), 1)            # 그날의 RSI · 200일선 이격도
            assert 이웃["gap200"] == pytest.approx(C[i] / 이평200[i] - 1, abs=1e-4)
        # 보이는 8번은 15번 가운데 가장 가까운 차례로. 오른 비율 · 10% 넘게 오르내린 비율은 15번 모두의 가격 변화로
        y = np.full(n, np.nan)
        y[: n - d] = np.log(C[d:] / C[: n - d])
        셈 = T._셈(X, y, np.flatnonzero(쓸날[: n - d]), X[-1])
        assert np.all(np.diff(셈["이웃거리"]) >= 0)
        assert [x["date"] for x in h["neighbors"]] == [날들[i] for i in 셈["이웃"][: T.보일이웃]]
        변화 = C[셈["이웃"] + d] / C[셈["이웃"]] - 1
        assert (h["up"], h["up10"], h["down10"]) == (
            round(float(np.mean(변화 > 0)), 4), round(float(np.mean(변화 > 0.1)), 4), round(float(np.mean(변화 < -0.1)), 4))


def test_오늘_빈_지표는_빼고_셈한다():
    """최근 닷새 가운데 거래량이 0 인 날 · 거래 정지로 값이 그대로인 날 — 그 지표만 빼고 예측은 낸다
    (예전에는 통째로 None 이라 화면이 '시세가 2년 가까이 있어야' 라고 잘못 말했다)"""
    C = _되돌림(씨=6)
    n = len(C)
    V = np.full(n, 1e5) * (1 + np.arange(n) % 3)
    V[-2] = 0                                                         # 그저께 거래량 0(없음)
    결과 = T.예측(_날들(n), C, V)
    지표 = {i["key"]: i for i in 결과["indicators"]}
    assert 지표["volume"]["used"] is False and 지표["volume"]["value"] is None
    assert all(지표[k]["used"] for k in ("gap200", "gap20", "ret21", "mom", "rsi", "macd", "bb", "high52", "vol"))
    assert [h["days"] for h in 결과["horizons"]] == [5, 21, 63]
    assert T.예측(_날들(n), C, np.full(n, 1e5)) is not None
    # 거래 정지 — 한 달 넘게 값이 그대로면 출렁임·볼린저가 빈다
    멈춘 = C.copy()
    멈춘[-30:] = 멈춘[-31]
    결과 = T.예측(_날들(n), 멈춘, np.full(n, 1e5))
    지표 = {i["key"]: i for i in 결과["indicators"]}
    assert not 지표["vol"]["used"] and not 지표["bb"]["used"]
    assert 지표["volume"]["used"] and 지표["gap200"]["used"]
    assert 결과["horizons"][0]["predicted"] > 0


def test_기간은_3개월까지_짧으면_되는_만큼만():
    결과 = T.예측(_날들(1260), _무작위())
    assert [h["label"] for h in 결과["horizons"]] == ["1주", "1개월", "3개월"]
    assert [h["days"] for h in 결과["horizons"]] == [5, 21, 63]
    짧은 = T.예측(_날들(480), _무작위(480))
    assert [h["label"] for h in 짧은["horizons"]] == ["1주", "1개월"]     # 3개월은 배울 날이 모자라다
    assert T.예측(_날들(450), _무작위(450)) is None
    assert {i["key"] for i in 결과["indicators"]} == set(T.지표이름)


# ── 길(API) ───────────────────────────────────────────────────
@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _비우기():
    def 지우기():
        try:
            R.limiter._storage.reset()
        except Exception:
            pass
        for 항목 in cache.keys_with_ttl():
            열쇠 = 항목.get("key") if isinstance(항목, dict) else 항목
            if isinstance(열쇠, str) and (열쇠.startswith("predict:") or 열쇠.startswith("ohlcv:ZZQ")):
                cache.delete(열쇠)
    지우기()
    yield
    지우기()


def _봉들(C, 날들=None):
    날들 = 날들 or _날들(len(C))
    return [{"date": d, "close": float(c), "volume": 1e5 * (1 + i % 3)} for i, (d, c) in enumerate(zip(날들, C))]


def test_길에_기술적_예측이_실린다(client, monkeypatch):
    def 가짜(symbol, period, interval, market):
        return _봉들(_무작위(씨=9, 시작=4000) if symbol.startswith("^") else _되돌림(씨=5))
    monkeypatch.setattr(R.yf_service, "get_ohlcv", 가짜)
    d = client.get(f"{API}/US/AAPL").json()
    기술 = d["technical"]
    assert [h["label"] for h in 기술["horizons"]] == ["1주", "1개월", "3개월"]
    assert 기술["market"] == "S&P 500"
    assert {i["key"] for i in 기술["indicators"] if i["used"]} == set(T.지표이름)
    assert 기술["horizons"][1]["check"]["n"] > 0
    assert len(d["horizons"]) == 5                                   # 범위 예측도 그대로
    날짜 = {h["days"]: h["date"] for h in d["horizons"]}
    assert [h["date"] for h in 기술["horizons"]] == [날짜[5], 날짜[21], 날짜[63]]     # 범위 예측과 같은 날


def test_지수를_못_받아도_시장_흐름만_빼고(client, monkeypatch):
    def 가짜(symbol, period, interval, market):
        if symbol.startswith("^"):
            raise RuntimeError("지수 막힘")
        return _봉들(_되돌림(씨=5))
    monkeypatch.setattr(R.yf_service, "get_ohlcv", 가짜)
    d = client.get(f"{API}/KR/005930").json()
    assert d["technical"]["market"] is None
    assert not [i for i in d["technical"]["indicators"] if i["key"].startswith("mkt_") and i["used"]]
    assert isinstance(d["technical"]["horizons"][0]["predicted"], int)          # 국내는 원 단위 정수


def test_기술적_예측이_터져도_범위_예측은_그대로(client, monkeypatch):
    monkeypatch.setattr(R.yf_service, "get_ohlcv", lambda *a: _봉들(_되돌림(씨=5)))
    monkeypatch.setattr(T, "예측", lambda *a, **k: (_ for _ in ()).throw(ValueError("터짐")))
    r = client.get(f"{API}/US/AAPL")
    assert r.status_code == 200 and r.json()["technical"] is None and len(r.json()["horizons"]) == 5


def _가짜야후(monkeypatch, 하기):
    """yf.Ticker 를 바꾼다 — history 가 받은 인자를 남기고 하기(인자)를 돌려준다(예외면 던진다)"""
    from app.services.market import yf_service as Y
    받은 = []

    class 가짜:
        def __init__(self, symbol, *a, **k):
            self.symbol = symbol

        def history(self, **k):
            받은.append(k)
            return 하기(self.symbol)
    monkeypatch.setattr(Y.yf, "Ticker", 가짜)
    return Y, 받은


def test_없는_종목은_빈_목록_그래서_404(client, monkeypatch):
    """없는 종목 — 야후가 '자료 없음' 이라 답한다. 예전에는 yfinance 가 준 빈 표의 시간대를 읽다 터져 '받다가 실패(503)'
    로 나갔다 — 다시 해 봐야 같은데 '잠시 뒤 다시 해 주세요' 라고 했다"""
    from yfinance.exceptions import YFPricesMissingError, YFTzMissingError

    def 자료없음(symbol):
        if symbol.startswith("ZZQX2"):
            raise YFTzMissingError(symbol)                        # 'max' 로 받을 때는 시간대부터 없다고 한다
        raise YFPricesMissingError(symbol, "(period=5y)", yahoo_reason="No data found, symbol may be delisted")
    Y, 받은 = _가짜야후(monkeypatch, 자료없음)
    assert Y.yf_service.get_ohlcv("ZZQX1", "5y", "1d", "US") == []
    assert Y.yf_service.get_ohlcv("ZZQX2", "1y", "10d", "US") == []          # N일봉 길도
    assert all(k.get("raise_errors") is True for k in 받은)                  # 실패를 빈 표로 숨기지 않게 받는다
    r = client.get(f"{API}/US/ZZQX3")
    assert r.status_code == 404 and "시세를 찾지 못했어요" in r.json()["detail"]
    # 야후가 빈 표를 그냥 줘도 빈 목록
    Y, _ = _가짜야후(monkeypatch, lambda s: pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"]))
    assert Y.yf_service.get_ohlcv("ZZQX4", "5y", "1d", "US") == []


def test_받다가_실패는_예외_그래서_다시_해_보라고(client, monkeypatch):
    """네트워크·야후 장애 — yfinance 는 이것도 빈 표로 주고 로그만 남긴다. 그대로 '없는 종목(404)' 이라 하면 다시 시도도
    없고 화면이 30분 동안 그 답을 쥐고 있다. 받다가 실패는 예외로 올려 503(다시 해 보세요)으로"""
    def 끊김(symbol):
        raise ConnectionError("연결이 끊겼어요")
    Y, _ = _가짜야후(monkeypatch, 끊김)
    with pytest.raises(ConnectionError):
        Y.yf_service.get_ohlcv("ZZQX5", "5y", "1d", "US")
    r = client.get(f"{API}/US/ZZQX6")
    assert r.status_code == 503 and "잠시 뒤 다시" in r.json()["detail"]
    assert cache.get("ohlcv:ZZQX6:5y:1d") is None                             # 실패는 담아 두지 않는다


def test_yfinance_가_raise_errors_를_아직_받는다():
    """_야후일봉 이 기대는 인자 — yfinance 를 올려 이 인자가 없어지면 모든 일봉이 TypeError 로 실패한다"""
    import inspect
    from yfinance.scrapers.history import PriceHistory
    assert "raise_errors" in inspect.signature(PriceHistory.history).parameters
