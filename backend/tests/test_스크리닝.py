"""스크리닝이 **화면에 있는 조건을 전부 실제로 거르는가.**

스크리닝 화면에는 조건 칸이 스물다섯 개 있는데, 서버는 그중 여덟 개
값만 만들고 있었다. 나머지(거래량·RSI·배당·1년 수익률…)는 값이 없으니
`_apply_filters` 가 '모름 → 탈락' 으로 처리해서 **걸기만 하면 결과가
0개**였다. 오류는 안 났다. 화면은 "조건이 너무 좁습니다" 라고 말했다.

그래서 여기서 보는 것은:
  ① 화면의 조건 키가 전부 서버가 아는 키인가 (화면 파일을 직접 읽는다)
  ② 서버가 아는 키마다 종목 한 줄에 값이 실제로 들어가는가
  ③ 그 값이 맞는가 (1년 수익률·RSI·52주 고저·배당)
  ④ 모르는 키·글자 값은 조용히 0개가 아니라 422 로 돌려보내는가
  ⑤ 값 없는 종목이 정렬 맨 앞에 깔리지 않는가
"""
import re
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.core.cache import cache
from app.api.routes import screening as 라우트
from app.services import yf_service as 모듈
from app.services.yf_service import (
    yf_service, 스크리닝줄, 스크리닝_숫자키, 스크리닝_글자키, _rsi14,
)

화면 = Path(__file__).resolve().parents[2] / "frontend" / "src" / "pages" / "Screening.tsx"


@pytest.fixture(autouse=True)
def _캐시_치우기():
    def 치우기():
        for 항목 in cache.keys_with_ttl():
            열쇠 = 항목.get("key") if isinstance(항목, dict) else 항목
            if isinstance(열쇠, str) and 열쇠.startswith(("screening:", "screen_row:")):
                cache.delete(열쇠)
    치우기()
    yield
    치우기()


@pytest.fixture
def client():
    return TestClient(app)


def _시세(일수=400, 시작가=100.0, 하루=0.001, 끝=pd.Timestamp("2026-09-25")):
    날 = pd.bdate_range(end=끝, periods=일수)
    값 = 시작가 * (1 + 하루) ** np.arange(일수)
    return pd.DataFrame({"Close": 값, "Volume": np.arange(일수) + 1000}, index=날)


꽉찬정보 = {
    "longName": "Test Co", "sector": "Technology", "marketCap": 5e11, "currency": "USD",
    "trailingPE": 20.0, "forwardPE": 18.0, "priceToBook": 3.0, "trailingPegRatio": 1.5,
    "enterpriseToEbitda": 12.0, "priceToSalesTrailing12Months": 4.0, "dividendRate": 2.0,
    "beta": 1.1, "returnOnEquity": 0.2, "returnOnAssets": 0.08, "operatingMargins": 0.3,
    "profitMargins": 0.25, "trailingEps": 5.0, "debtToEquity": 80.0, "currentRatio": 1.4,
}


# ── ① 화면과 서버가 같은 키를 쓰는가 ─────────────────────────────

def test_화면의_조건칸은_전부_서버가_아는_키다():
    src = 화면.read_text(encoding="utf-8")
    화면키 = set(re.findall(r'filterKey="(\w+)"', src))
    assert len(화면키) >= 20, "화면에서 조건칸을 못 찾았다 — 검사가 헛돈다"
    모르는키 = 화면키 - 스크리닝_숫자키
    assert not 모르는키, f"서버가 값을 안 만드는 조건칸: {모르는키} — 걸면 결과가 0개가 된다"


def test_화면의_정렬기준도_전부_서버가_아는_키다():
    src = 화면.read_text(encoding="utf-8")
    블록 = src.split("const SORT_OPTIONS", 1)[1].split("];", 1)[0]
    정렬키 = set(re.findall(r'value: "(\w+)"', 블록))
    assert 정렬키 and 정렬키 <= 스크리닝_숫자키


# ── ② 키마다 값이 실제로 들어가는가 ─────────────────────────────

def test_정보가_다_있으면_서버가_아는_키마다_값이_있다():
    줄 = 스크리닝줄("TEST", "US", 꽉찬정보, _시세())
    비었음 = {k for k in 스크리닝_숫자키 | 스크리닝_글자키 if 줄.get(k) is None}
    assert not 비었음, f"값을 안 만드는 키: {비었음}"


# ── ③ 값이 맞는가 ───────────────────────────────────────────────

def test_기간_수익률은_그만큼_전_가격과_비교한다():
    시세 = _시세()
    줄 = 스크리닝줄("TEST", "US", {}, 시세)
    c = 시세["Close"]
    마지막 = c.index[-1]
    for 키, 달 in (("return_1m", 1), ("return_3m", 3), ("return_1y", 12)):
        앞 = c[c.index <= 마지막 - pd.DateOffset(months=달)].iloc[-1]
        assert 줄[키] == pytest.approx((c.iloc[-1] / 앞 - 1) * 100, abs=0.01), 키


def test_시세가_모자라면_1년_수익률은_모른다_짧은_기간으로_채우지_않는다():
    줄 = 스크리닝줄("NEW", "US", {}, _시세(일수=60))
    assert 줄["return_1y"] is None
    assert 줄["return_1m"] is not None


def test_52주_고저는_최근_1년_안에서만_본다():
    시세 = _시세(일수=400, 하루=-0.001)          # 계속 내림 → 1년보다 오래된 날이 제일 비쌈
    줄 = 스크리닝줄("DOWN", "US", {}, 시세)
    c = 시세["Close"]
    일년 = c[c.index > c.index[-1] - pd.DateOffset(years=1)]
    assert 줄["pct_from_52w_high"] == pytest.approx((c.iloc[-1] / 일년.max() - 1) * 100, abs=0.01)
    assert 줄["pct_from_52w_low"] == pytest.approx(0, abs=0.01)


def test_RSI는_백테스트_엔진과_같은_값이다():
    from app.services.backtest_engine import BacktestEngine
    rng = np.random.default_rng(3)
    값 = 100 * np.cumprod(1 + rng.normal(0, 0.02, 120))
    날 = pd.bdate_range("2025-01-01", periods=120)
    df = pd.DataFrame({"open": 값, "high": 값, "low": 값, "close": 값, "volume": 1}, index=날)
    엔진값 = BacktestEngine()._add_all_indicators(df)["rsi"].iloc[-1]
    assert _rsi14(pd.Series(값, index=날)) == pytest.approx(엔진값, abs=0.01)


def test_배당은_연배당을_지금_가격으로_나눈다_무배당은_0이다():
    시세 = _시세()
    가격 = float(시세["Close"].iloc[-1])
    assert 스크리닝줄("A", "US", {"dividendRate": 2.0}, 시세)["dividend_yield"] == pytest.approx(2.0 / 가격 * 100, abs=0.01)
    assert 스크리닝줄("B", "US", {"trailingAnnualDividendRate": 0.0}, 시세)["dividend_yield"] == 0


def test_비율은_퍼센트로_바꾸고_0은_모름이_아니다():
    줄 = 스크리닝줄("A", "US", {"operatingMargins": 0.0, "returnOnEquity": 0.153}, _시세())
    assert 줄["operating_margin"] == 0
    assert 줄["roe"] == pytest.approx(15.3)


def test_한국_종목은_접미사를_떼고_KR로_낸다():
    줄 = 스크리닝줄("069500.KS", "ETF", {}, _시세())
    assert (줄["symbol"], 줄["market"], 줄["currency"]) == ("069500", "KR", "KRW")


def test_가격을_하나도_못_받으면_줄을_안_만든다():
    assert 스크리닝줄("X", "US", {}, pd.DataFrame()) is None


# ── 거르기 ─────────────────────────────────────────────────────

def test_거르기_최소_최대_같음_그리고_모름은_탈락():
    f = yf_service._apply_filters
    assert f({"per": 10}, {"per": {"min": 5, "max": 15}})
    assert not f({"per": 20}, {"per": {"max": 15}})
    assert not f({"per": 1}, {"per": {"min": 5}})
    assert not f({"per": None}, {"per": {"max": 15}})
    assert f({"sector": "Technology"}, {"sector": {"eq": "Technology"}})
    assert not f({"sector": "Energy"}, {"sector": {"eq": "Technology"}})


def test_목록에_두번_적힌_종목도_결과엔_한번만(monkeypatch):
    monkeypatch.setattr(모듈, "스크리닝_종목들", lambda m: ["AAA", "BBB", "AAA"])
    불린것 = []
    monkeypatch.setattr(yf_service, "_screen_one",
                        lambda s, m: 불린것.append(s) or {"symbol": s, "price": 1})
    결과 = yf_service.screen_stocks("US", {})
    assert sorted(r["symbol"] for r in 결과) == ["AAA", "BBB"]
    assert sorted(불린것) == ["AAA", "BBB"]


def test_시세는_1년보다_넉넉히_받는다(monkeypatch):
    """딱 1년만 받으면 첫날이 '1년 전 오늘' 보다 늦게 잡혀 1년 수익률이 늘 모름이 된다"""
    받은것 = {}

    class 가짜:
        def __init__(self, s): pass
        info = {"longName": "x"}
        def history(self, **k):
            받은것.update(k)
            return _시세(일수=300)

    monkeypatch.setattr(모듈.yf, "Ticker", 가짜)
    yf_service._screen_one("DDD", "US")
    시작 = pd.Timestamp(받은것["start"])
    assert (pd.Timestamp.today() - 시작).days >= 380


def test_종목_한줄은_조건이_바뀌어도_다시_묻지_않는다(monkeypatch):
    물은수 = []

    class 가짜:
        def __init__(self, s): 물은수.append(s)
        info = {"longName": "x"}
        def history(self, **k): return _시세(일수=30)

    monkeypatch.setattr(모듈.yf, "Ticker", 가짜)
    yf_service._screen_one("CCC", "US")
    yf_service._screen_one("CCC", "US")
    assert 물은수 == ["CCC"]


# ── ④ 라우트: 모르는 조건은 422 ────────────────────────────────

@pytest.mark.parametrize("조건", [
    {"foo": {"min": 1}},
    {"per": {"min": "a"}},
    {"per": {"min": True}},
    {"per": {"min": 5, "max": 1}},
    {"per": {"gt": 1}},
    {"per": 3},
    {"sector": {"eq": 3}},
    {"sector": {"min": 1}},
])
def test_모르는_조건이나_숫자_아닌_값은_422(client, 조건, monkeypatch):
    # 검사를 빠져나가면 야후까지 가지 않고 곧장 200 으로 드러나게 한다
    monkeypatch.setattr(yf_service, "screen_stocks", lambda m, f: [])
    r = client.post("/api/v1/screening/run", json={"market": "US", "filters": 조건})
    assert r.status_code == 422


def test_프리셋_저장도_같은_검사를_한다():
    # 저장해 둔 프리셋을 불러와 돌리면 그때 422 가 난다 — 저장부터 막는다
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        라우트.PresetSaveRequest(name="x", market="US", filters={"foo": {"min": 1}}, sort_by="per")
    라우트.PresetSaveRequest(name="x", market="US", filters={"per": {"max": 10}}, sort_by="per")


# ── ⑤ 정렬 ────────────────────────────────────────────────────

def test_값_없는_종목은_오름차순이든_내림차순이든_맨_뒤():
    줄들 = [{"s": "a", "per": 10}, {"s": "b", "per": None}, {"s": "c", "per": 5}, {"s": "d"}]
    assert [r["s"] for r in 라우트.줄세우기(줄들, "per", False)] == ["c", "a", "b", "d"]
    assert [r["s"] for r in 라우트.줄세우기(줄들, "per", True)] == ["a", "c", "b", "d"]


def test_실행하면_새_조건이_끝까지_닿고_섹터도_서버에서_거른다(client, monkeypatch):
    줄들 = {
        "AAA": 스크리닝줄("AAA", "US", {**꽉찬정보, "sector": "Technology"}, _시세(하루=0.002)),
        "BBB": 스크리닝줄("BBB", "US", {**꽉찬정보, "sector": "Energy"}, _시세(하루=0.002)),
        "CCC": 스크리닝줄("CCC", "US", {**꽉찬정보, "sector": "Technology"}, _시세(하루=-0.002)),
    }
    monkeypatch.setattr(모듈, "스크리닝_종목들", lambda m: list(줄들))
    monkeypatch.setattr(yf_service, "_screen_one", lambda s, m: 줄들[s])

    r = client.post("/api/v1/screening/run", json={
        "market": "US", "sort_by": "return_1y",
        "filters": {"return_1y": {"min": 0}, "sector": {"eq": "Technology"}},
    })
    assert r.status_code == 200, r.text
    assert [x["symbol"] for x in r.json()["results"]] == ["AAA"]
