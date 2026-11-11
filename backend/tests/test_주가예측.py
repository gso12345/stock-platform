"""주가예측 — 사용자: "주가예측 메뉴도 만들어줘".

숫자를 지어내기 쉬운 곳이라, 조용히 틀리면 안 되는 것을 하나씩 못 박는다.
  · 범위가 실제로 맞나 — 출렁임을 아는 가짜 주가에서 80%·50% 범위의 적중률이 그 언저리로 나온다
  · 검증이 앞날을 훔쳐보지 않는다 — t 의 예측은 t 뒤의 주가를 바꿔도 그대로다
  · 요즘 크게 출렁이면 가까운 범위가 넓어지고, 먼 앞날은 평소 출렁임으로 돌아간다
  · 많이 오른 종목의 가운데를 그대로 따라가지 않는다(과거 수익은 잡음이 크다)
  · 시세를 못 받으면 데모 시세로 채우지 않는다
"""
import math
from datetime import date, timedelta

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.core.cache import cache
from app.api.routes import predict as R
from app.services.predict import forecast as F

API = "/api/v1/predict"


def _날들(n: int, 끝: str = "2026-11-10") -> list[str]:
    끝날 = np.datetime64(끝, "D")
    return [str(d) for d in np.busday_offset(끝날, np.arange(-(n - 1), 1), roll="backward")]


def _걸음(n=1260, 연변동=0.30, 연기대=0.0, 씨=7, 시작=100.0, 꼬리=None) -> np.ndarray:
    """하루 로그 수익이 서로 상관없는 가짜 주가 — 출렁임을 알고 있다"""
    rng = np.random.default_rng(씨)
    σ = 연변동 / math.sqrt(252)
    if 꼬리:
        z = rng.standard_t(꼬리, n - 1) / math.sqrt(꼬리 / (꼬리 - 2))
    else:
        z = rng.standard_normal(n - 1)
    r = (연기대 - 연변동 ** 2 / 2) / 252 + σ * z
    return 시작 * np.exp(np.concatenate(([0.0], np.cumsum(r))))


def _봉들(종가, 날들=None) -> list[dict]:
    날들 = 날들 or _날들(len(종가))
    return [{"date": d, "open": c, "high": c, "low": c, "close": c, "volume": 1} for d, c in zip(날들, 종가)]


def _기간(결과, 이름) -> dict:
    return next(h for h in 결과["horizons"] if h["label"] == 이름)


# ── 셈 ────────────────────────────────────────────────────────
def test_종가정리_차례_겹침_빈값():
    날들, 종가 = F.종가정리([
        {"date": "2026-01-03", "close": 12},
        {"date": "2026-01-02T00:00:00", "close": 11},
        {"date": "2026-01-03", "close": 13},          # 같은 날은 마지막 것
        {"date": "2026-01-04", "close": None},
        {"date": "2026-01-05", "close": 0},
        {"date": "2026-01-06", "close": -3},
        {"date": "2026-01-07", "close": "x"},
        {"date": "", "close": 5},
        "깨진 줄",
        {"date": "2026-01-08", "close": float("nan")},
        {"date": "2026-01-09", "close": "14.5"},
    ])
    assert 날들 == ["2026-01-02", "2026-01-03", "2026-01-09"]
    assert 종가.tolist() == [11.0, 13.0, 14.5]
    assert F.종가정리(None)[0] == [] and F.종가정리([])[1].size == 0


def test_짧으면_예측하지_않는다():
    C = _걸음(F.최소일수)
    with pytest.raises(F.자료부족):
        F.예측(_날들(F.최소일수 - 1), C[:-1])
    결과 = F.예측(_날들(F.최소일수), C)
    assert len(결과["horizons"]) == 5 and 결과["days_used"] == F.최소일수


def test_출렁임을_아는_주가에서_범위가_맞는다():
    """연 30% 출렁이는 무작위 걸음 — 지금·평소 출렁임을 그 언저리로 재고, 80%·50% 범위의 지난 적중률이 80%·50% 언저리"""
    결과 = F.예측(_날들(1260), _걸음())
    assert 0.24 < 결과["volatility"]["long"] < 0.36
    assert 0.18 < 결과["volatility"]["now"] < 0.42
    한달 = _기간(결과, "1개월")
    폭 = math.log(한달["q90"] / 한달["q10"])
    기대폭 = 2 * 1.2816 * 결과["volatility"]["long"] * math.sqrt(21 / 252)
    assert 0.75 * 기대폭 < 폭 < 1.3 * 기대폭
    for 이름 in ("1주", "1개월"):
        검 = _기간(결과, 이름)["check"]
        assert 검["n"] >= 140
        assert abs(검["above80"] + 검["below80"] + 검["in80"] - 1) < 1e-3


@pytest.mark.parametrize("꼬리", [None, 3])
def test_여러_벌의_가짜_주가에서_적중률이_80_50_언저리(꼬리):
    """한 벌로는 우연이 크다 — 1개월 구간은 매주 셈해도 서로 겹쳐 독립 표본이 36개 남짓이라 ±7%p 가 흔들린다.
    열두 벌의 평균을 본다(꼬리가 아주 두꺼운 t 분포 자유도 3 도)"""
    적중 = {"1주": [], "1개월": []}
    for 씨 in range(1, 13):
        결과 = F.예측(_날들(1260), _걸음(씨=씨, 꼬리=꼬리))
        for 이름 in 적중:
            검 = _기간(결과, 이름)["check"]
            적중[이름].append((검["in80"], 검["in50"]))
    for 이름, 값들 in 적중.items():
        in80 = float(np.mean([a for a, _ in 값들]))
        in50 = float(np.mean([b for _, b in 값들]))
        assert 0.75 <= in80 <= 0.85, (꼬리, 이름, in80)
        assert 0.45 <= in50 <= 0.56, (꼬리, 이름, in50)
        assert min(a for a, _ in 값들) >= 0.62, (꼬리, 이름, 값들)


def test_검증은_그날까지의_자료만_쓴다():
    """t 의 셈 재료(지금 출렁임·평소 출렁임·가운데·꼬리)는 t 뒤의 주가를 아무리 바꿔도 그대로다"""
    C = _걸음()
    바꾼 = C.copy()
    t = 900
    바꾼[t + 1:] *= np.linspace(1.0, 3.0, len(C) - t - 1)     # 뒤를 크게 흔든다
    전, 후 = F._자료(C).통계([t, 500]), F._자료(바꾼).통계([t, 500])
    for 열쇠 in 전:
        assert np.allclose(전[열쇠], 후[열쇠]), 열쇠
    # 바로 다음 날의 것은 달라진다 — 위 검사가 헛돌지 않는다는 표시
    assert not np.allclose(F._자료(C).통계([t + 2])["지금"], F._자료(바꾼).통계([t + 2])["지금"])


def test_가운데는_기본에서_시작해_과거_수익을_믿을_만큼만_섞는다():
    """하루 단순 수익이 +x, -x 로 번갈아 — 과거 평균 수익이 정확히 0. 그러면 가운데 = 7% × (1 - w), w = τ²/(τ²+어긋남²)"""
    x = 0.01
    C = np.cumprod(np.concatenate(([100.0], np.where(np.arange(800) % 2 == 0, 1 + x, 1 - x))))
    통 = F._자료(C).통계([800])
    길이 = 756
    장기 = float(np.mean(np.diff(np.log(C))[800 - 길이:800] ** 2))
    어긋남제곱 = 장기 * 252 / (길이 / 252)
    w = 0.10 ** 2 / (0.10 ** 2 + 어긋남제곱)
    assert 통["장기"][0] == pytest.approx(장기)
    assert 통["기대"][0] == pytest.approx(0.07 * (1 - w), rel=1e-6)


def test_기간별_분산과_꼬리():
    """h 영업일 분산 = h·평소 + (지금-평소)(1-φ^h)/(1-φ), 가운데 = h·기대/252 - 분산/2, 왜도 /√h, 첨도 /h(1 까지)"""
    통 = {"지금": 4e-4, "장기": 1e-4, "기대": 0.10, "왜": 0.9, "첨": 6.0}
    for h in (1, 5, 21, 252):
        M, V, s, k = (float(v) for v in F._모양(h, 통))
        V기대 = h * 1e-4 + 3e-4 * (1 - 0.985 ** h) / (1 - 0.985)
        assert V == pytest.approx(V기대)
        assert M == pytest.approx(h * 0.10 / 252 - V기대 / 2)
        assert s == pytest.approx(min(0.5, 0.9 / math.sqrt(h)))
        assert k == pytest.approx(min(1.0, 6.0 / h))
    # 여러 기간을 한꺼번에 줘도 같다
    Ms, Vs, _, _ = F._모양(np.array([5, 21]), 통)
    assert Vs[1] == pytest.approx(float(F._모양(21, 통)[1]))


def test_검증의_적중률을_한_줄씩_다시_세어_본다():
    """_검증 을 쉬운 반복으로 다시 셈한다 — 시작·끝 자리, 범위, 실제 수익, 벗어난 쪽, 겹치지 않는 기간 수"""
    C = _걸음(씨=13)
    날들 = _날들(len(C))
    자료 = F._자료(C)
    n = len(C)
    for h in (5, 21, 252):
        검 = F._검증(자료, 날들, h)
        T = list(range(n - 1 - h, max(F.검증시작, n - 1 - F.창 - h) - 1, -5))[::-1]
        안80 = 안50 = 위 = 아래 = 0
        for t in T:
            M, V, s, k = (float(v[0]) if np.ndim(v) else float(v) for v in F._모양(h, F._자료(C[: t + 1]).통계([t])))
            q = {p: M + math.sqrt(V) * float(F._cf(F._정규.inv_cdf(p), s, k)) for p in (0.1, 0.25, 0.75, 0.9)}
            R = math.log(C[t + h] / C[t])
            안80 += q[0.1] <= R <= q[0.9]
            안50 += q[0.25] <= R <= q[0.75]
            위 += R > q[0.9]
            아래 += R < q[0.1]
        assert 검["n"] == len(T)
        assert 검["in80"] == round(안80 / len(T), 4) and 검["in50"] == round(안50 / len(T), 4)
        assert 검["above80"] == round(위 / len(T), 4) and 검["below80"] == round(아래 / len(T), 4)
        assert 검["from"] == 날들[T[0]] and 검["to"] == 날들[-1]           # 가장 최근에 결과가 나온 날까지
        assert 검["periods"] == max(1, (T[-1] + h - T[0]) // h)
    assert F._검증(F._자료(C[:400]), 날들[:400], 252) is None              # 결과가 나온 날이 없다


def test_요즘_출렁이면_가까운_범위가_넓고_먼_앞날은_평소로_돌아간다():
    잔잔 = _걸음(연변동=0.20, 씨=11)
    rng = np.random.default_rng(5)
    r = np.diff(np.log(잔잔))
    r[-40:] = rng.standard_normal(40) * 0.60 / math.sqrt(252)       # 마지막 두 달 남짓 세 배
    출렁 = 잔잔[0] * np.exp(np.concatenate(([0.0], np.cumsum(r))))
    가, 나 = F.예측(_날들(1260), 잔잔), F.예측(_날들(1260), 출렁)
    assert 나["volatility"]["now"] > 1.8 * 가["volatility"]["now"]
    assert 나["volatility"]["now"] > 1.8 * 나["volatility"]["long"]

    def 하루폭(결과, 이름, 날수):
        h = _기간(결과, 이름)
        return math.log(h["q90"] / h["q10"]) / math.sqrt(날수)
    assert 하루폭(나, "1주", 5) > 1.8 * 하루폭(가, "1주", 5)
    # 먼 앞날은 평소 출렁임 쪽으로 돌아간다 — 하루당 폭이 가까운 앞날보다 좁다
    assert 하루폭(나, "1년", 252) < 0.7 * 하루폭(나, "1주", 5)


def test_많이_오른_종목도_가운데는_조금만_따라간다():
    올 = F.예측(_날들(1260), _걸음(연변동=0.25, 연기대=0.60, 씨=3))
    assert 0.10 < 올["expected_return"] <= F.기대한계[1]
    내 = F.예측(_날들(1260), _걸음(연변동=0.25, 연기대=-0.40, 씨=3))
    assert F.기대한계[0] <= 내["expected_return"] < 0.05
    # 출렁임이 아주 적은데 많이 오르거나 내린 종목은 섞어도 한도를 넘는다 — 연 -15% ~ +30% 에서 멈춘다
    assert F.예측(_날들(1260), _걸음(연변동=0.08, 연기대=0.90, 씨=3))["expected_return"] == F.기대한계[1]
    assert F.예측(_날들(1260), _걸음(연변동=0.08, 연기대=-0.60, 씨=3))["expected_return"] == F.기대한계[0]
    # 출렁임이 적은 종목일수록 과거 수익을 더 믿는다(같은 수익, 다른 출렁임)
    덜 = F.예측(_날들(1260), _걸음(연변동=0.12, 연기대=0.25, 씨=3))
    더 = F.예측(_날들(1260), _걸음(연변동=0.45, 연기대=0.25, 씨=3))
    assert 덜["expected_return"] > 더["expected_return"]


def test_확률은_범위와_어긋나지_않는다():
    결과 = F.예측(_날들(1260), _걸음(씨=9))
    지금 = 결과["price"]
    앞폭 = 0
    for h in 결과["horizons"]:
        assert h["q10"] < h["q25"] < h["q50"] < h["q75"] < h["q90"]
        assert (h["up"] > 0.5) == (h["q50"] > 지금)
        assert 0 <= h["up10"] <= h["up"] <= 1 and 0 <= h["down10"] <= 1 - h["up"]
        # 80% 범위 밖(위) 확률은 10% — 위 끝이 +10% 보다 높으면 +10% 넘을 확률이 10% 를 넘는다
        if h["q90"] > 지금 * 1.1:
            assert h["up10"] > 0.10 - 1e-3
        else:
            assert h["up10"] <= 0.10 + 1e-3
        폭 = math.log(h["q90"] / h["q10"])
        assert 폭 > 앞폭
        앞폭 = 폭


def test_부채꼴은_멀수록_넓고_날짜는_평일():
    결과 = F.예측(_날들(1260, 끝="2026-11-13"), _걸음(씨=4))     # 금요일에 끝난다
    길 = 결과["path"]
    assert len(길) == 252 and [p["day"] for p in 길] == list(range(1, 253))
    assert [p["date"] for p in 길[:3]] == ["2026-11-16", "2026-11-17", "2026-11-18"]
    for p in 길:
        assert p["q10"] <= p["q25"] <= p["q50"] <= p["q75"] <= p["q90"]
        assert date.fromisoformat(p["date"]).weekday() < 5
    폭 = [math.log(p["q90"] / p["q10"]) for p in 길]
    assert all(b > a for a, b in zip(폭, 폭[1:]))
    # 기간 카드의 날짜·값은 부채꼴의 그 날과 같다
    for h in 결과["horizons"]:
        p = 길[h["days"] - 1]
        assert h["date"] == p["date"] and h["q10"] == p["q10"] and h["q90"] == p["q90"]
    assert len(결과["history"]) == F.그릴지난날 and 결과["history"][-1]["date"] == "2026-11-13"


def test_코니시_피셔_꼬리와_치우침():
    z80, z99 = 1.2816, 2.5758
    # 꼬리가 두꺼우면 가운데 쪽 분위는 안으로, 먼 분위는 밖으로
    assert abs(F._cf(z80, 0, 2.0)) < z80 and abs(F._cf(-z80, 0, 2.0)) < z80
    assert F._cf(z99, 0, 2.0) > z99
    # 오른쪽으로 치우치면(왜도 +) 위아래 분위가 둘 다 위로 밀린다
    assert F._cf(z80, 0.4, 0) > z80 and F._cf(-z80, 0.4, 0) > -z80
    # 묶어 둔 끝값에서도 차례가 뒤집히지 않는다
    for s in (-0.5, 0.5):
        for k in (0.0, 3.0):
            q = F._cf(F._격자z, s, k)
            assert np.all(np.diff(q) > 0), (s, k)


def test_RSI_와일더():
    오름 = np.arange(1.0, 40.0)
    assert np.isnan(F._rsi(오름)[F.RSI기간 - 1]) and F._rsi(오름)[-1] == 100
    assert F._rsi(오름[::-1])[-1] == 0
    번갈아 = np.array([10.0, 11.0] * 20)
    assert abs(F._rsi(번갈아)[-1] - 50) < 5


def test_같은_상태였을_때_오른_비율을_그대로_센다():
    C = np.array([1.0, 2.0] * 15)                  # 30일 — 낮은 날 다음 5일 뒤는 늘 높다
    상태 = C == 1.0
    쓸 = np.ones(30, dtype=bool)
    비 = F._비율들(C, 상태, 쓸)                    # 지금(마지막 날)은 높은 날 — 상태 False
    assert 비["5"] == {"cond": 0.0, "n": 12, "base": round(13 / 25, 4), "total": 25}
    assert 비["21"] == {"cond": 0.0, "n": 4, "base": round(5 / 9, 4), "total": 9}
    assert 비["63"] is None and 비["252"] is None


def test_근거_셋_꾸준히_오른_종목():
    C = 100 * np.exp(np.cumsum(np.full(600, 0.002)) + 0.001 * np.sin(np.arange(600)))
    근거 = {g["key"]: g for g in F.예측(_날들(600), C)["signals"]}
    assert 근거["trend"]["state"] == "above" and 근거["trend"]["ma200"] < 근거["trend"]["price"]
    assert 근거["momentum"]["state"] == "up" and 근거["momentum"]["ret"] == round(C[-22] / C[-253] - 1, 4)
    assert 근거["trend"]["ma200"] == round(float(np.mean(C[-200:])), 2) and 근거["trend"]["price"] == round(float(C[-1]), 2)
    assert 근거["rsi"]["state"] == "hot"
    비 = 근거["trend"]["rates"]["21"]
    assert 비["cond"] == 1.0 and 0 < 비["n"] <= 비["total"] and 비["base"] == 1.0


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
            if isinstance(열쇠, str) and 열쇠.startswith("predict:"):
                cache.delete(열쇠)
    지우기()
    yield
    지우기()


@pytest.fixture
def 시세(monkeypatch):
    """yf_service.get_ohlcv 를 흉내 낸다 — 부른 것을 적어 둔다"""
    부름: list = []
    상자 = {"봉들": _봉들(_걸음(씨=8))}

    def 가짜(symbol, period, interval, market):
        부름.append((symbol, period, interval, market))
        if isinstance(상자["봉들"], Exception):
            raise 상자["봉들"]
        return 상자["봉들"]
    monkeypatch.setattr(R.yf_service, "get_ohlcv", 가짜)
    return 부름, 상자


def test_해외_종목을_예측한다(client, 시세):
    부름, _ = 시세
    r = client.get(f"{API}/US/AAPL")
    assert r.status_code == 200, r.text
    d = r.json()
    assert 부름 == [("AAPL", "5y", "1d", "US")]
    assert d["symbol"] == "AAPL" and d["market"] == "US" and d["currency"] == "USD" and d["name"]
    assert [h["label"] for h in d["horizons"]] == ["1주", "1개월", "3개월", "6개월", "1년"]
    assert len(d["path"]) == 252 and len(d["history"]) == 260
    assert {g["key"] for g in d["signals"]} == {"trend", "momentum", "rsi"}
    assert isinstance(d["price"], float) and d["horizons"][1]["check"]["n"] > 0
    assert d["method"]["half_life_days"] == 46


def test_국내_종목은_원화_정수로(client, 시세):
    부름, 상자 = 시세
    상자["봉들"] = _봉들(_걸음(씨=8, 시작=71200))
    d = client.get(f"{API}/KR/005930").json()
    assert 부름 == [("005930", "5y", "1d", "KR")]
    assert d["currency"] == "KRW" and isinstance(d["price"], int)
    assert all(isinstance(h[k], int) for h in d["horizons"] for k in ("q10", "q50", "q90"))
    assert all(isinstance(p["q50"], int) for p in d["path"])


def test_ETF_는_해외_시세로(client, 시세):
    부름, _ = 시세
    assert client.get(f"{API}/ETF/SPY").status_code == 200
    assert 부름 == [("SPY", "5y", "1d", "US")]


def test_시세가_없으면_데모로_채우지_않고_404(client, 시세, monkeypatch):
    _, 상자 = 시세
    상자["봉들"] = []
    import app.services.demo_data as 데모
    monkeypatch.setattr(데모, "get_demo_ohlcv", lambda *a, **k: pytest.fail("데모 시세를 쓰면 안 된다"))
    r = client.get(f"{API}/US/ZZZZ")
    assert r.status_code == 404 and "시세를 찾지 못했어요" in r.json()["detail"]


def test_상장한_지_얼마_안_되면_422(client, 시세):
    _, 상자 = 시세
    상자["봉들"] = _봉들(_걸음(n=120))
    r = client.get(f"{API}/US/NEWCO")
    assert r.status_code == 422 and "1년 남짓" in r.json()["detail"] and "120일" in r.json()["detail"]


def test_시세를_못_받으면_503(client, 시세):
    _, 상자 = 시세
    상자["봉들"] = RuntimeError("야후가 막혔다")
    r = client.get(f"{API}/US/AAPL")
    assert r.status_code == 503 and "잠시 뒤" in r.json()["detail"]


def test_한_시간_들고_있는다(client, 시세):
    부름, _ = 시세
    가 = client.get(f"{API}/US/AAPL").json()
    나 = client.get(f"{API}/US/aapl").json()            # 대소문자만 다른 같은 종목
    assert 부름 == [("AAPL", "5y", "1d", "US")] and 가 == 나
    assert cache.get("predict:v1:US:AAPL") is not None
    # 실패는 들고 있지 않는다
    _, 상자 = 시세
    상자["봉들"] = []
    assert client.get(f"{API}/US/MSFT").status_code == 404
    assert cache.get("predict:v1:US:MSFT") is None


def test_잘못된_주소(client, 시세):
    부름, _ = 시세
    assert client.get(f"{API}/JP/7203").status_code == 422
    assert client.get(f"{API}/US/" + "A" * 21).status_code == 422
    assert client.get(f"{API}/US/AB$C").status_code == 422
    assert 부름 == []


def test_요청_제한은_분당_30번(client, 시세):
    for _ in range(30):
        assert client.get(f"{API}/US/AAPL").status_code == 200
    assert client.get(f"{API}/US/AAPL").status_code == 429
