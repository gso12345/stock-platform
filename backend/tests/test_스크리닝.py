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
from app.services.market import yf_service as 모듈
from app.services.market.yf_service import (
    yf_service, 스크리닝줄, 스크리닝_숫자키, 스크리닝_글자키, _rsi14, 연간흐름, _도메인,
)

#: 화면의 칸·조건·조건 묶음은 이 파일 한 곳에 모여 있다
화면 = Path(__file__).resolve().parents[2] / "frontend" / "src" / "components" / "screening" / "screeningDefs.ts"


@pytest.fixture(autouse=True)
def _캐시_치우기():
    def 치우기():
        for 항목 in cache.keys_with_ttl():
            열쇠 = 항목.get("key") if isinstance(항목, dict) else 항목
            if isinstance(열쇠, str) and 열쇠.startswith(("screening:", "screen_row:", "fx:")):
                cache.delete(열쇠)
        # 시장 전체의 사진도 버린다 — 남아 있으면 앞 검사의 줄로 답한다
        모듈.스크리닝_사진_비우기()
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
    # 참고한 스크리너의 칸 — 최근 1년 실적·순부채·예상 EPS·국가·산업
    "totalRevenue": 3.0e11, "netIncomeToCommon": 7.5e10, "freeCashflow": 6.0e10,
    "totalDebt": 1.0e11, "totalCash": 4.0e10, "forwardEps": 6.0,
    "country": "United States", "industry": "Semiconductors", "website": "https://www.test.com/",
}


def _연간표(매출=(100.0, 120.0, 150.0, 200.0), eps=(1.0, 1.5, 2.0, 3.0), 앞빈해=False):
    """야후 income_stmt 모양 — 줄 = 항목, 칸 = 회계연도 끝(최근 것이 왼쪽)"""
    해들 = [pd.Timestamp(f"{2021 + i}-12-31") for i in range(len(매출))]
    표 = pd.DataFrame({"Total Revenue": 매출, "Diluted EPS": eps}, index=해들).T
    if 앞빈해:
        표[pd.Timestamp("2020-12-31")] = [np.nan, np.nan]
    return 표[sorted(표.columns, reverse=True)]


# ── ① 화면과 서버가 같은 키를 쓰는가 ─────────────────────────────

def _블록(시작: str, 끝: str = "\n];") -> str:
    src = 화면.read_text(encoding="utf-8")
    assert 시작 in src, f"화면 설정에서 {시작} 을 못 찾았다 — 검사가 헛돈다"
    return src.split(시작, 1)[1].split(끝, 1)[0]


def test_화면의_조건칸은_전부_서버가_아는_키다():
    화면키 = set(re.findall(r'key: "(\w+)"', _블록("export const 조건묶음")))
    assert len(화면키) >= 20, "화면에서 조건칸을 못 찾았다 — 검사가 헛돈다"
    모르는키 = 화면키 - 스크리닝_숫자키
    assert not 모르는키, f"서버가 값을 안 만드는 조건칸: {모르는키} — 걸면 결과가 0개가 된다"


def test_화면의_글자_조건도_서버가_아는_키다():
    글키 = set(re.findall(r'key: "(\w+)"', _블록("export const 글조건")))
    assert 글키 == 스크리닝_글자키


def test_화면의_정렬기준도_전부_서버가_아는_키다():
    """칸 제목을 누르면 그 칸으로 세운다 — 세움: false 가 아닌 칸은 서버가 숫자로 세울 수 있어야 한다"""
    줄들 = [l for l in _블록("export const 칸들").splitlines() if 'key: "' in l]
    세울칸 = {re.search(r'key: "(\w+)"', l).group(1) for l in 줄들 if "세움: false" not in l}
    assert len(세울칸) >= 20, "화면에서 칸을 못 찾았다 — 검사가 헛돈다"
    assert not 세울칸 - 스크리닝_숫자키, f"서버가 못 세우는 칸: {세울칸 - 스크리닝_숫자키} — 누르면 422"


def test_조건_묶음과_ETF_칸도_서버가_아는_키다():
    블록 = _블록("export const 기본묶음")
    조건키 = set(re.findall(r'(\w+): \{ (?:min|max)', 블록))
    정렬키 = set(re.findall(r'정렬: \["(\w+)"', 블록))
    assert len(조건키) >= 5 and not 조건키 - 스크리닝_숫자키
    assert len(정렬키) >= 5 and not 정렬키 - 스크리닝_숫자키
    etf = set(re.findall(r'"(\w+)"', _블록("export const ETF칸", "]);")))
    assert len(etf) >= 8 and not etf - 스크리닝_숫자키


# ── ② 키마다 값이 실제로 들어가는가 ─────────────────────────────

def test_정보가_다_있으면_서버가_아는_키마다_값이_있다():
    줄 = 스크리닝줄("TEST", "US", 꽉찬정보, _시세(), 연간흐름(_연간표()))
    비었음 = {k for k in 스크리닝_숫자키 | 스크리닝_글자키 if 줄.get(k) is None}
    assert not 비었음, f"값을 안 만드는 키: {비었음}"


# ── 참고한 스크리너의 칸 (사용자: "스크리닝 사이트 참고해줘" → "일단 할수있는건 다해줘") ──

def test_최근_1년_실적과_순부채와_예상_EPS_성장률():
    줄 = 스크리닝줄("TEST", "US", 꽉찬정보, _시세())
    assert (줄["revenue"], 줄["earnings"], 줄["fcf"]) == (3.0e11, 7.5e10, 6.0e10)
    assert 줄["net_debt"] == pytest.approx(6.0e10), "순부채 = 빚 − 현금"
    assert 줄["forward_eps_growth"] == pytest.approx(20.0), "다음 해 예상 6 ÷ 최근 5 − 1"
    assert (줄["country"], 줄["industry"], 줄["domain"]) == ("United States", "Semiconductors", "test.com")
    assert 줄["fin_currency"] == "USD"
    현금부자 = 스크리닝줄("TEST", "US", {**꽉찬정보, "totalCash": 2.5e11}, _시세())
    assert 현금부자["net_debt"] == pytest.approx(-1.5e11), "현금이 더 많으면 마이너스"
    적자 = 스크리닝줄("TEST", "US", {**꽉찬정보, "trailingEps": -1.0}, _시세())
    assert 적자["forward_eps_growth"] is None, "최근이 적자면 성장률이 뜻이 없다"
    모름 = 스크리닝줄("TEST", "US", {"longName": "x"}, _시세())
    assert all(모름.get(k) is None for k in ("revenue", "earnings", "fcf", "net_debt", "forward_eps_growth")), \
        "값이 없으면 0 이 아니라 모름"
    빚만 = 스크리닝줄("TEST", "US", {"longName": "x", "totalDebt": 1.0e9}, _시세())
    assert 빚만.get("net_debt") is None, "현금을 모르면 순부채도 모른다"


def test_ETF_는_순자산과_3년_베타를_쓴다():
    """야후는 ETF 에 시가총액·베타 대신 순자산(totalAssets)·3년 베타를 준다 — 비우면 크기 순으로 못 세운다"""
    etf = 스크리닝줄("SPY", "ETF", {"longName": "SPDR", "totalAssets": 5.0e11, "beta3Year": 1.0}, _시세())
    assert (etf["market_cap"], etf["beta"]) == (5.0e11, 1.0)
    주식 = 스크리닝줄("AAA", "US", {"longName": "x", "totalAssets": 5.0e11}, _시세())
    assert 주식.get("market_cap") is None, "주식의 총자산은 시가총액이 아니다"
    둘다 = 스크리닝줄("QQQ", "ETF", {"longName": "q", "marketCap": 3.0e11, "totalAssets": 2.9e11,
                                    "beta": 1.2, "beta3Year": 1.1}, _시세())
    assert (둘다["market_cap"], 둘다["beta"]) == (3.0e11, 1.2), "있으면 원래 값이 먼저"


대만정보 = {**꽉찬정보, "financialCurrency": "TWD"}


def test_장부_돈이_다른_회사는_최근_1년_실적을_시세_돈으로_바꾼다():
    """TSMC 는 미국에 상장했지만 장부는 대만 달러다. 그대로 두면 매출 2.9조(대만 달러)가
    월마트의 6,800억(달러)보다 커서, 매출 순으로 세우면 맨 위에 선다"""
    대만 = 스크리닝줄("TSM", "US", 대만정보, _시세(), 연간흐름(_연간표()), 환율=0.03)
    assert (대만["currency"], 대만["fin_currency"]) == ("USD", "TWD")
    assert 대만["revenue"] == pytest.approx(3.0e11 * 0.03)
    assert 대만["earnings"] == pytest.approx(7.5e10 * 0.03)
    assert 대만["fcf"] == pytest.approx(6.0e10 * 0.03)
    assert 대만["net_debt"] == pytest.approx(6.0e10 * 0.03)
    assert 대만["rev_hist"] == [100, 120, 150, 200], "4년 흐름은 장부 돈 그대로 — 화면이 TWD 를 붙인다"
    assert 대만["market_cap"] == 꽉찬정보["marketCap"], "시가총액은 원래 시세 돈이다"


def test_환율을_모르면_최근_1년_실적을_비운다():
    대만 = 스크리닝줄("TSM", "US", 대만정보, _시세())
    assert all(대만.get(k) is None for k in ("revenue", "earnings", "fcf", "net_debt")), \
        "대만 달러 그대로 두면 달러 회사들과 섞여 순서가 틀린다 — 모름이 낫다"
    assert 대만["per"] == 20.0, "다른 칸은 그대로"


def test_장부_돈과_시세_돈이_같으면_환율을_쓰지_않는다():
    줄 = 스크리닝줄("TEST", "US", {**꽉찬정보, "financialCurrency": "USD"}, _시세(), 환율=0.5)
    assert 줄["revenue"] == 3.0e11


def _가짜야후(물은것: list, 환율값=0.031):
    class 가짜:
        def __init__(self, s):
            self.s = s
            물은것.append(s)
            self.info = {**대만정보, "longName": s}

        def history(self, **k):
            if self.s.endswith("=X"):
                if 환율값 is None:
                    raise RuntimeError("환율 못 받음")
                return pd.DataFrame({"Close": [환율값 * 0.9, 환율값]})
            return _시세(일수=30)
    return 가짜


def test_종목을_받을_때_환율을_물어_바꾸고_하루_기억한다(monkeypatch):
    물은것: list = []
    monkeypatch.setattr(모듈.yf, "Ticker", _가짜야후(물은것))
    가 = yf_service._screen_one("TSM", "US")
    나 = yf_service._screen_one("UMC", "US")
    assert 가["revenue"] == pytest.approx(3.0e11 * 0.031), "마지막 종가로 바꾼다"
    assert 나["revenue"] == pytest.approx(3.0e11 * 0.031)
    assert 물은것.count("TWDUSD=X") == 1, "같은 돈은 한 번만 묻는다"


def test_종목마다_받으면_받은_때를_남긴다(monkeypatch):
    """받은 때(scanned_at)가 없으면 사진이 늘 '6시간 넘게 통째로 안 받은' 것으로 보여 5분마다
    시장 전체를 종목마다 다시 받는다"""
    import time
    물은것: list = []
    monkeypatch.setattr(모듈.yf, "Ticker", _가짜야후(물은것))
    줄 = yf_service._screen_one("TSM", "US")
    assert abs(줄["scanned_at"] - time.time()) < 5


def test_환율을_못_받으면_그_종목의_실적만_비운다(monkeypatch):
    물은것: list = []
    monkeypatch.setattr(모듈.yf, "Ticker", _가짜야후(물은것, 환율값=None))
    줄 = yf_service._screen_one("TSM", "US")
    assert 줄 is not None and 줄["price"], "환율 때문에 종목이 통째로 빠지면 안 된다"
    assert 줄.get("revenue") is None
    assert cache.get("fx:TWDUSD") is None, "못 받은 것은 기억하지 않는다 — 다음에 다시"


def test_같은_돈을_쓰는_종목은_환율을_묻지_않는다(monkeypatch):
    물은것: list = []

    class 미국(_가짜야후(물은것)):
        def __init__(self, s):
            super().__init__(s)
            self.info = {**꽉찬정보, "financialCurrency": "USD"}

    monkeypatch.setattr(모듈.yf, "Ticker", 미국)
    줄 = yf_service._screen_one("AAPL", "US")
    assert 줄["revenue"] == 3.0e11
    assert not [s for s in 물은것 if s.endswith("=X")]


@pytest.mark.parametrize("주소, 도메인", [
    ("https://www.nvidia.com/", "nvidia.com"),
    ("http://investor.apple.com/x", "investor.apple.com"),
    ("www.samsung.com", "samsung.com"),
    ("", None), (None, None), ("   ", None),
])
def test_누리집에서_로고에_쓸_도메인을_뽑는다(주소, 도메인):
    assert _도메인(주소) == 도메인


def test_연간흐름은_오래된_해부터_그리고_3년_성장률():
    r = 연간흐름(_연간표())
    assert r["fin_years"] == [2021, 2022, 2023, 2024]
    assert r["rev_hist"] == [100, 120, 150, 200] and r["eps_hist"] == [1.0, 1.5, 2.0, 3.0]
    assert r["rev_cagr_3y"] == pytest.approx(26.0, abs=0.1), "(200/100)^(1/3) − 1"
    assert r["eps_cagr_3y"] == pytest.approx(44.2, abs=0.1), "(3/1)^(1/3) − 1"
    # 야후가 맨 앞 해를 비워 두면 그 해만 뺀다
    assert 연간흐름(_연간표(앞빈해=True))["fin_years"] == [2021, 2022, 2023, 2024]


def test_연간흐름은_적자나_모자란_해에서는_성장률을_모른다():
    적자 = 연간흐름(_연간표(eps=(-1.0, 0.5, 1.0, 2.0)))
    assert 적자["eps_cagr_3y"] is None and 적자["rev_cagr_3y"] is not None
    짧음 = 연간흐름(_연간표(매출=(100.0, 120.0, 150.0), eps=(1.0, 1.5, 2.0)))
    assert 짧음["rev_cagr_3y"] is None and 짧음["rev_hist"] == [100, 120, 150]
    가운데빔 = 연간흐름(_연간표(매출=(100.0, np.nan, 150.0, 200.0)))
    assert 가운데빔["rev_hist"] == [100, None, 150, 200], "가운데 빈 해는 빼지 않고 비워 둔다"
    assert 연간흐름(pd.DataFrame()) == {} and 연간흐름(None) == {}


class Test연간흐름_채우기:
    """연간 재무는 분기마다 바뀐다 — 시세처럼 30분마다 다시 묻지 않는다. 사진(DB 에도 남는다)에
    붙여 두고, 뒤에서 새로 찍을 때만 모자란 종목을 시가총액이 큰 것부터 조금씩 받는다."""

    def _준비(self, monkeypatch, 받기=None):
        줄들 = {s: {"symbol": s, "price": 1.0, "market_cap": cap}
                for s, cap in (("AAA", 3e9), ("BBB", 2e9), ("CCC", 1e9))}
        monkeypatch.setattr(모듈, "스크리닝_종목들", lambda m: list(줄들))
        monkeypatch.setattr(yf_service, "_screen_one", lambda s, m: 줄들[s])
        물음: list = []

        def 기본받기(s):
            물음.append(s)
            return {"fin_years": [2024], "rev_hist": [10], "eps_hist": [1.0],
                    "rev_cagr_3y": None, "eps_cagr_3y": None}
        monkeypatch.setattr(yf_service, "_연간흐름_받기", 받기 or 기본받기)
        monkeypatch.setattr(모듈, "흐름_한번", 2)
        return 줄들, 물음

    def test_사람이_기다리는_첫_사진에서는_받지_않는다(self, monkeypatch):
        _, 물음 = self._준비(monkeypatch)
        yf_service._스크리닝_전체_새로("US")
        assert 물음 == []

    def test_뒤에서_찍을_때_큰_것부터_조금씩_받고_다음엔_이어_쓴다(self, monkeypatch):
        줄들, 물음 = self._준비(monkeypatch)
        첫 = {r["symbol"]: r for r in yf_service._스크리닝_전체_새로("US", 흐름채우기=True)}
        # 둘씩 겹쳐 묻는다 — 누가 먼저 물리는지는 정해지지 않는다. 어느 것을 고르는지가 요점이다
        assert sorted(물음) == ["AAA", "BBB"], "한 번에 흐름_한번 곳까지, 시가총액이 큰 것부터"
        assert 첫["AAA"]["rev_hist"] == [10] and 첫["AAA"]["fin_at"] and "fin_at" not in 첫["CCC"]
        assert "fin_at" not in 줄들["AAA"], "종목마다 캐시된 줄은 건드리지 않는다"
        물음.clear()
        둘 = {r["symbol"]: r for r in yf_service._스크리닝_전체_새로("US", 흐름채우기=True)}
        assert 물음 == ["CCC"], "받은 것은 사진에서 이어 쓰고 모자란 것만"
        assert 둘["AAA"]["rev_hist"] == [10] and 둘["CCC"]["fin_at"]

    def test_오래되면_다시_받고_못_물었으면_받은_것으로_치지_않는다(self, monkeypatch):
        _, 물음 = self._준비(monkeypatch, 받기=lambda s: None)
        첫 = yf_service._스크리닝_전체_새로("US", 흐름채우기=True)
        assert not any(r.get("fin_at") for r in 첫), "못 물었으면 다음 차례에 다시"
        _, 물음 = self._준비(monkeypatch)
        yf_service._스크리닝_전체_새로("US", 흐름채우기=True)
        사진 = 모듈._스크리닝_사진["US"][0]
        for r in 사진:
            if r.get("fin_at"):
                r["fin_at"] -= 모듈.흐름_수명 + 1
        물음.clear()
        yf_service._스크리닝_전체_새로("US", 흐름채우기=True)
        assert sorted(물음) == ["AAA", "BBB"], "흐름_수명이 지나면 다시 받는다"

    def test_ETF_는_받지_않는다(self, monkeypatch):
        _, 물음 = self._준비(monkeypatch)
        yf_service._스크리닝_전체_새로("ETF", 흐름채우기=True)
        assert 물음 == []

    def test_한국_종목은_접미사_붙은_이름으로_묻는다(self, monkeypatch):
        줄 = {"symbol": "005930", "market": "KR", "price": 1.0, "market_cap": 1e12}
        monkeypatch.setattr(모듈, "스크리닝_종목들", lambda m: ["005930.KS"])
        monkeypatch.setattr(yf_service, "_screen_one", lambda s, m: 줄)
        물음: list = []
        monkeypatch.setattr(yf_service, "_연간흐름_받기", lambda s: 물음.append(s) or {})
        yf_service._스크리닝_전체_새로("KR", 흐름채우기=True)
        assert 물음 == ["005930.KS"]

    def test_시간_상한을_넘기면_나머지는_다음_차례에(self, monkeypatch):
        _, 물음 = self._준비(monkeypatch)
        monkeypatch.setattr(모듈, "흐름_시간", -1)
        결과 = yf_service._스크리닝_전체_새로("US", 흐름채우기=True)
        assert 물음 == [] and not any(r.get("fin_at") for r in 결과)


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
    from app.services.backtest.backtest_engine import BacktestEngine
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


class Test야후가_답을_못_할_때:
    """화면이 열자마자 표를 채우므로, 새로 찍다 야후가 잠깐 멈추면 그게 곧 빈 화면이다"""

    def _처음(self, monkeypatch, 종목들):
        monkeypatch.setattr(모듈, "스크리닝_종목들", lambda m: 종목들)
        monkeypatch.setattr(yf_service, "_screen_one",
                            lambda s, m: {"symbol": s.split(".")[0], "price": 1.0, "per": 10.0})
        return yf_service._스크리닝_전체_새로("US")

    def test_못_받은_종목은_지난_사진의_줄로(self, monkeypatch):
        self._처음(monkeypatch, ["AAA", "BBB", "005930.KS"])
        monkeypatch.setattr(yf_service, "_screen_one",
                            lambda s, m: {"symbol": s, "price": 2.0} if s == "AAA" else None)
        새 = {r["symbol"]: r for r in yf_service._스크리닝_전체_새로("US")}
        assert set(새) == {"AAA", "BBB", "005930"}, "빼 버리면 30분 동안 표에서 사라진다"
        assert 새["AAA"]["price"] == 2.0, "받은 것은 새 값"
        assert 새["BBB"]["per"] == 10.0, "못 받은 것은 지난 값 그대로"

    def test_통째로_멈춰도_사진이_비지_않는다(self, monkeypatch):
        self._처음(monkeypatch, ["AAA", "BBB"])
        monkeypatch.setattr(yf_service, "_screen_one", lambda s, m: None)
        yf_service._스크리닝_전체_새로("US")
        assert len(yf_service.스크리닝_전체("US")) == 2

    def test_목록에서_빠진_종목은_되살리지_않는다(self, monkeypatch):
        self._처음(monkeypatch, ["AAA", "BBB"])
        monkeypatch.setattr(모듈, "스크리닝_종목들", lambda m: ["AAA"])
        monkeypatch.setattr(yf_service, "_screen_one", lambda s, m: None)
        assert [r["symbol"] for r in yf_service._스크리닝_전체_새로("US")] == ["AAA"]


class Test서버를_붙잡지_않게:
    """화면이 열자마자 표를 채우게 되자 30분마다 300곳을 종목마다 다시 받는 일이 잦아졌다 —
    0.15 CPU·512MB 서버의 메모리가 100% 를 찍고 종목상세 요청이 30초를 넘겨 끊겼다(관리자 화면).
    통째로는 6시간마다, 가격은 5분마다 묶음 시세로."""

    def _사진(self, 받은때_전: float, 찍은때_전: float):
        import time
        지금 = time.time()
        줄 = {"symbol": "AAA", "market": "US", "currency": "USD", "fin_currency": "USD", "price": 100.0,
              "change_rate": 1.0, "market_cap": 1.0e12, "eps": 5.0, "scanned_at": 지금 - 받은때_전}
        모듈._스크리닝_사진["US"] = ([줄], 지금 - 찍은때_전)

    def _기다리기(self, 조건):
        import time
        for _ in range(100):
            if 조건():
                return True
            time.sleep(0.02)
        return False

    def test_가격만_지났으면_묶음_시세로_가격만_고친다(self, monkeypatch):
        물음: list = []
        monkeypatch.setattr(yf_service, "_screen_one", lambda s, m: 물음.append(s))
        monkeypatch.setattr(yf_service, "_묶음시세", lambda 줄들: {"AAA": {"price": 110.0, "change_rate": 2.5}})
        self._사진(받은때_전=3600, 찍은때_전=600)
        yf_service.스크리닝_전체("US")
        assert self._기다리기(lambda: 모듈._스크리닝_사진["US"][0][0]["price"] == 110.0), "가격을 새로 받지 않았다"
        줄 = 모듈._스크리닝_사진["US"][0][0]
        assert 줄["change_rate"] == 2.5 and 줄["per"] == 22.0, "새 가격으로 PER 도 다시 나눈다"
        assert 물음 == [], "가격만 지났는데 종목마다 다시 받았다"

    def test_통째로_받은_지_오래면_종목마다_다시_받는다(self, monkeypatch):
        import time
        monkeypatch.setattr(모듈, "스크리닝_종목들", lambda m: ["AAA"])
        monkeypatch.setattr(yf_service, "_screen_one",
                            lambda s, m: {"symbol": s, "price": 120.0, "scanned_at": time.time()})
        monkeypatch.setattr(yf_service, "_연간흐름_받기", lambda s: {})
        monkeypatch.setattr(yf_service, "_묶음시세", lambda 줄들: (_ for _ in ()).throw(AssertionError("묶음 시세로 갔다")))
        self._사진(받은때_전=7 * 3600, 찍은때_전=600)
        yf_service.스크리닝_전체("US")
        assert self._기다리기(lambda: 모듈._스크리닝_사진["US"][0][0]["price"] == 120.0)

    def test_한_종목만_오래됐다고_시장_전체를_다시_받지_않는다(self, monkeypatch):
        """계속 못 받는 종목(상장폐지 등)은 지난 줄로 남아 받은 때가 오래된 채다 — 그 하나 때문에
        5분마다 시장 전체를 종목마다 다시 받으면 안 된다"""
        import time
        물음: list = []
        monkeypatch.setattr(yf_service, "_screen_one", lambda s, m: 물음.append(s))
        monkeypatch.setattr(yf_service, "_묶음시세", lambda 줄들: {})
        지금 = time.time()
        모듈._스크리닝_사진["US"] = ([{"symbol": "AAA", "price": 1.0, "scanned_at": 지금 - 60},
                                    {"symbol": "OLD", "price": 1.0, "scanned_at": 지금 - 8 * 3600}], 지금 - 600)
        yf_service.스크리닝_전체("US")
        assert self._기다리기(lambda: "US" not in 모듈._스크리닝_새로찍는중)
        assert 물음 == []

    def test_받는_스레드는_낮은_우선순위고_다_받으면_메모리를_돌려준다(self, monkeypatch):
        import os
        import threading
        from app.core import memory
        잰것: list = []
        정리: list = []

        def 한줄(s, m):
            잰것.append(os.getpriority(os.PRIO_PROCESS, threading.get_native_id()))
            return {"symbol": s, "price": 1.0}

        monkeypatch.setattr(모듈, "스크리닝_종목들", lambda m: ["AAA", "BBB"])
        monkeypatch.setattr(yf_service, "_screen_one", 한줄)
        monkeypatch.setattr(memory, "trim_native", lambda label="": 정리.append(label))
        앞 = os.getpriority(os.PRIO_PROCESS, threading.get_native_id())
        yf_service._스크리닝_전체_새로("US")
        assert 잰것 and all(n == min(앞 + 10, 19) for n in 잰것), "화면 요청과 똑같이 CPU 를 나눠 가졌다"
        assert len(정리) == 1 and "스크리닝" in 정리[0], "다 받고도 버퍼를 붙들고 있었다"

    def test_메모리가_빠듯하면_연간_재무도_안_받는다(self, monkeypatch):
        물음: list = []
        monkeypatch.setattr(yf_service, "_연간흐름_받기", lambda s: 물음.append(s) or {})
        monkeypatch.setattr(모듈, "_메모리_빠듯함", lambda: True)
        줄들 = [{"symbol": "AAA", "market_cap": 1.0}]
        assert yf_service._흐름_채우기(줄들, {"AAA": "AAA"}) == 0
        assert 물음 == [] and "fin_at" not in 줄들[0], "못 받은 것을 받은 것으로 치면 일주일 동안 안 받는다"

    def test_답은_1분만_남긴다_가격을_5분마다_새로_받으니까(self, client):
        self._사진(받은때_전=60, 찍은때_전=60)
        client.post("/api/v1/screening/run", json={"market": "US", "sort_by": "price"})
        남은 = [항목 for 항목 in cache.keys_with_ttl()
                if isinstance(항목, dict) and str(항목.get("key", "")).startswith("screening:US:price")]
        assert 남은, "답을 남기지 않았다"
        assert all(0 < float(항목["ttl_remaining"]) <= 60 for 항목 in 남은), 남은

    def test_막_받았으면_아무것도_안_한다(self, monkeypatch):
        monkeypatch.setattr(yf_service, "_screen_one", lambda s, m: (_ for _ in ()).throw(AssertionError()))
        monkeypatch.setattr(yf_service, "_묶음시세", lambda 줄들: (_ for _ in ()).throw(AssertionError()))
        self._사진(받은때_전=60, 찍은때_전=60)
        yf_service.스크리닝_전체("US")
        assert "US" not in 모듈._스크리닝_새로찍는중

    def test_묶음_시세는_막_받아_둔_시세를_다시_묻지_않고_국내외를_갈라_묻는다(self, monkeypatch):
        from app.services.market import price_fetcher
        물은해외: list = []
        물은국내: list = []

        async def 해외(심볼들):
            물은해외.extend(심볼들)
            return {s: {"price": 2.0} for s in 심볼들}

        async def 국내(코드들, concurrency=20):
            물은국내.extend(코드들)
            return {c: {"price": 70000.0} for c in 코드들}

        monkeypatch.setattr(price_fetcher, "fetch_yf_quotes", 해외)
        monkeypatch.setattr(price_fetcher, "fetch_naver_prices_light", 국내)
        cache.set("price:AAA", {"price": 1.0}, 60)
        try:
            받음 = yf_service._묶음시세([{"symbol": "AAA", "market": "US"}, {"symbol": "BBB", "market": "US"},
                                    {"symbol": "005930", "market": "KR"}])
        finally:
            cache.delete("price:AAA")
        assert 받음 == {"AAA": {"price": 1.0}, "BBB": {"price": 2.0}, "005930": {"price": 70000.0}}
        assert (물은해외, 물은국내) == (["BBB"], ["005930"])

    def test_시장_전체는_한_번에_한_시장만_그리고_넷만_겹쳐_묻는다(self, monkeypatch):
        import threading
        import time
        지금수 = {"n": 0, "최대": 0}
        잠금 = threading.Lock()

        def 한줄(s, m):
            with 잠금:
                지금수["n"] += 1
                지금수["최대"] = max(지금수["최대"], 지금수["n"])
            time.sleep(0.03)
            with 잠금:
                지금수["n"] -= 1
            return {"symbol": s.split(".")[0], "price": 1.0}

        monkeypatch.setattr(모듈, "스크리닝_종목들", lambda m: [f"{m}{i}" for i in range(12)])
        monkeypatch.setattr(yf_service, "_screen_one", 한줄)
        스레드들 = [threading.Thread(target=yf_service._스크리닝_전체_새로, args=(m,)) for m in ("US", "KR", "ETF")]
        for t in 스레드들: t.start()
        for t in 스레드들: t.join()
        assert 지금수["최대"] <= 모듈.SCREEN_SCAN_WORKERS == 4, "시장 셋을 겹쳐 받거나 너무 많이 겹쳐 물었다"

    def test_메모리가_빠듯하면_멈추고_남은_종목은_지난_줄로(self, monkeypatch):
        import time
        monkeypatch.setattr(모듈, "SCREEN_SCAN_WORKERS", 1)
        monkeypatch.setattr(모듈, "스크리닝_종목들", lambda m: ["AAA", "BBB", "CCC"])
        모듈._스크리닝_사진["US"] = ([{"symbol": s, "price": 1.0} for s in ("AAA", "BBB", "CCC")], time.time())
        물음: list = []
        monkeypatch.setattr(yf_service, "_screen_one", lambda s, m: 물음.append(s) or {"symbol": s, "price": 2.0})
        빠듯 = iter([False, True, True, True])
        monkeypatch.setattr(모듈, "_메모리_빠듯함", lambda: next(빠듯, True))
        새 = {r["symbol"]: r["price"] for r in yf_service._스크리닝_전체_새로("US")}
        assert 물음 == ["AAA"], "메모리가 빠듯한데도 계속 물었다"
        assert 새 == {"AAA": 2.0, "BBB": 1.0, "CCC": 1.0}, "멈췄다고 종목이 표에서 빠지면 안 된다"

    def test_뒤에서_받는_스레드는_낮은_우선순위다(self):
        import os
        import threading
        if not hasattr(os, "getpriority"):
            pytest.skip("우선순위를 잴 수 없는 곳")
        잰것: dict = {}

        def 재기():
            잰것["앞"] = os.getpriority(os.PRIO_PROCESS, threading.get_native_id())
            모듈._뒤로_미루기()
            잰것["뒤"] = os.getpriority(os.PRIO_PROCESS, threading.get_native_id())

        t = threading.Thread(target=재기)
        t.start(); t.join()
        assert 잰것["뒤"] == min(잰것["앞"] + 10, 19), "화면 요청보다 CPU 를 먼저 쓴다"
        assert os.getpriority(os.PRIO_PROCESS, threading.get_native_id()) == 잰것["앞"], "부른 스레드만 낮춘다"

    def test_화면에_시세가_언제_것인지_알린다(self, client, monkeypatch):
        import time
        self._사진(받은때_전=60, 찍은때_전=90)
        r = client.post("/api/v1/screening/run", json={"market": "US"}).json()
        assert abs(r["as_of"] - (time.time() - 90)) < 5


class Test시세_덮기:
    def _줄(self, **더):
        return {"symbol": "AAA", "currency": "USD", "fin_currency": "USD", "price": 100.0, "change_rate": 0.5,
                "volume": 10, "market_cap": 1.0e12, "high_52w": 120.0, "low_52w": 80.0,
                "pct_from_52w_high": -16.67, "pct_from_52w_low": 25.0, "dividend_rate": 2.0, "dividend_yield": 2.0,
                "eps": 5.0, "per": 20.0, "forward_eps": 6.0, "forward_per": 16.67, "revenue": 2.5e11,
                "ps_ratio": 4.0, **더}

    def test_가격에_딸린_칸을_새_가격으로_다시_나눈다(self):
        줄 = self._줄()
        모듈._시세_덮기(줄, {"price": 110.0, "change_rate": 1.234, "volume": 99})
        assert (줄["price"], 줄["change_rate"], 줄["volume"]) == (110.0, 1.23, 99)
        assert 줄["market_cap"] == pytest.approx(1.1e12), "시가총액이 안 오면 주식 수가 그대로라고 보고 늘린다"
        assert 줄["pct_from_52w_high"] == pytest.approx(-8.33, abs=0.01)
        assert 줄["pct_from_52w_low"] == pytest.approx(37.5)
        assert 줄["dividend_yield"] == pytest.approx(1.82, abs=0.01)
        assert (줄["per"], 줄["forward_per"]) == (22.0, 18.33)
        assert 줄["ps_ratio"] == pytest.approx(4.4)

    def test_새_고점이면_고점도_올린다(self):
        줄 = self._줄()
        모듈._시세_덮기(줄, {"price": 130.0, "market_cap": 1.3e12})
        assert (줄["high_52w"], 줄["pct_from_52w_high"], 줄["market_cap"]) == (130.0, 0.0, 1.3e12)

    def test_해외_상장사의_PER_은_다시_나누지_않는다(self):
        줄 = self._줄(fin_currency="TWD")
        모듈._시세_덮기(줄, {"price": 110.0})
        assert (줄["per"], 줄["forward_per"]) == (20.0, 16.67), "장부 돈 EPS 로 나누면 틀린다"

    def test_가격이_없으면_그대로(self):
        줄 = self._줄()
        모듈._시세_덮기(줄, {"price": None, "change_rate": 9.9})
        assert 줄 == self._줄()


class Test처음_짓는_동안:
    """배포 직후·처음 여는 시장은 사진이 없다. 시장 전체를 받는 데 0.15 CPU 로 1~3분 걸리는데,
    예전엔 그동안 요청이 붙잡혀 화면이 빈 채로 기다렸다(사용자: "처음에는 아무것도 안나오던데").
    이제 뒤에서 짓고, 잠깐만 기다린 뒤 받은 줄부터 돌려준다."""

    @pytest.fixture
    def 느린야후(self, monkeypatch):
        import threading
        풀림 = threading.Event()
        물음: list = []

        def 한줄(s, m):
            물음.append(s)
            if s != "AAA":
                풀림.wait(5)                 # AAA 만 곧바로, 나머지는 풀어 줄 때까지
            return {"symbol": s, "market": m, "price": 1.0, "per": {"AAA": 10.0, "BBB": 5.0, "CCC": 20.0}[s]}

        monkeypatch.setattr(모듈, "스크리닝_종목들", lambda m: ["AAA", "BBB", "CCC"])
        monkeypatch.setattr(yf_service, "_screen_one", 한줄)
        monkeypatch.setattr(모듈, "SCREEN_FIRST_WAIT", 0.3)
        흐름물음: list = []
        monkeypatch.setattr(yf_service, "_연간흐름_받기", lambda s: 흐름물음.append(s) or {})
        self.흐름물음 = 흐름물음
        yield 풀림, 물음
        풀림.set()

    def _다_지을때까지(self):
        import time
        for _ in range(100):
            if yf_service.스크리닝_짓는중("US") is None and 모듈._스크리닝_사진.get("US"):
                return
            time.sleep(0.02)
        raise AssertionError("다 짓지 못했다")

    def test_오래_붙잡지_않고_받은_줄부터_돌려준다(self, 느린야후):
        import time
        풀림, _ = 느린야후
        t = time.perf_counter()
        줄들 = yf_service.스크리닝_전체("US")
        assert time.perf_counter() - t < 2, "다 지을 때까지 붙잡았다"
        assert [r["symbol"] for r in 줄들] == ["AAA"]
        assert yf_service.스크리닝_짓는중("US") == {"done": 1, "total": 3}
        풀림.set()
        self._다_지을때까지()
        assert [r["symbol"] for r in yf_service.스크리닝_전체("US")] == ["AAA", "BBB", "CCC"]
        assert yf_service.스크리닝_짓는중("US") is None

    def test_금방_다_지으면_기다린_시간만큼_붙잡지_않는다(self, monkeypatch):
        import time
        monkeypatch.setattr(모듈, "스크리닝_종목들", lambda m: ["AAA", "BBB"])
        monkeypatch.setattr(yf_service, "_screen_one", lambda s, m: {"symbol": s, "price": 1.0})
        monkeypatch.setattr(모듈, "SCREEN_FIRST_WAIT", 3.0)
        t = time.perf_counter()
        assert len(yf_service.스크리닝_전체("US")) == 2
        assert time.perf_counter() - t < 1, "다 지었는데도 기다리는 시간을 다 채웠다"

    def test_사람이_기다리는_첫_사진에서는_연간_재무를_받지_않는다(self, 느린야후):
        풀림, _ = 느린야후
        yf_service.스크리닝_전체("US")
        풀림.set()
        self._다_지을때까지()
        assert self.흐름물음 == [], "시세만 받아도 1~3분인데 연간 재무까지 받았다"

    def test_그새_남이_다_지었으면_또_짓지_않는다(self, monkeypatch):
        import time
        물음: list = []
        monkeypatch.setattr(yf_service, "_screen_one", lambda s, m: 물음.append(s))
        monkeypatch.setattr(모듈, "스크리닝_종목들", lambda m: ["AAA"])
        모듈._스크리닝_사진["US"] = ([{"symbol": "AAA", "price": 1.0}], time.time())
        assert yf_service._스크리닝_뒤에서_새로("US", 처음=True) is False
        assert 물음 == [] and "US" not in 모듈._스크리닝_새로찍는중

    def test_짓는_동안_또_불러도_한_번만_짓고_기다리지_않는다(self, 느린야후):
        import time
        풀림, 물음 = 느린야후
        yf_service.스크리닝_전체("US")
        t = time.perf_counter()
        다시 = yf_service.스크리닝_전체("US")             # 화면이 3초마다·정렬을 바꿀 때 다시 묻는다
        assert time.perf_counter() - t < 0.1, "짓는 동안 다시 묻는 요청까지 붙잡았다"
        assert [r["symbol"] for r in 다시] == ["AAA"]
        풀림.set()
        self._다_지을때까지()
        assert sorted(물음) == ["AAA", "BBB", "CCC"]

    def test_화면에_받는_중이라고_알리고_그_답은_남겨_두지_않는다(self, client, 느린야후):
        풀림, _ = 느린야후
        몸 = {"market": "US", "sort_by": "per", "sort_order": "asc"}
        r = client.post("/api/v1/screening/run", json=몸).json()
        assert [x["symbol"] for x in r["results"]] == ["AAA"]
        assert r["building"] == {"done": 1, "total": 3} and r["failed"] is False
        풀림.set()
        self._다_지을때까지()
        r = client.post("/api/v1/screening/run", json=몸).json()
        assert [x["symbol"] for x in r["results"]] == ["BBB", "AAA", "CCC"], "받는 중이던 답을 5분 동안 내놓았다"
        assert r["building"] is None

    def test_한_줄도_못_받으면_못_받았다고_알리고_잠깐은_다시_묻지_않는다(self, client, monkeypatch):
        물음: list = []
        monkeypatch.setattr(모듈, "스크리닝_종목들", lambda m: ["AAA", "BBB"])
        monkeypatch.setattr(yf_service, "_screen_one", lambda s, m: 물음.append(s))
        r = client.post("/api/v1/screening/run", json={"market": "US"}).json()
        assert r["failed"] is True and r["results"] == [] and r["building"] is None
        assert 모듈._스크리닝_사진.get("US") is None, "빈 사진을 30분 동안 '맞는 종목 없음' 으로 내놓는다"
        물음.clear()
        r = client.post("/api/v1/screening/run", json={"market": "US", "sort_by": "per"}).json()
        assert r["failed"] is True
        assert 물음 == [], "막힌 야후를 곧바로 다시 두드렸다"
        monkeypatch.setattr(모듈, "_스크리닝_실패", {"US": 0.0})          # 쉬는 시간이 지났다
        monkeypatch.setattr(yf_service, "_screen_one", lambda s, m: {"symbol": s, "price": 1.0})
        r = client.post("/api/v1/screening/run", json={"market": "US", "sort_by": "price"}).json()
        assert r["failed"] is False and [x["symbol"] for x in r["results"]] == ["AAA", "BBB"]


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

def test_스크리닝_요청_상한은_칸_몇_번_눌러_보다_막히지_않을_만큼():
    """화면이 칸 제목을 누를 때마다·찾는 말이 바뀔 때마다 곧바로 다시 묻는다. 예전 상한(분당 10번)이면
    칸 몇 개 눌러 보다 '요청이 너무 많아요' 가 뜬다. 그래도 상한 자체는 남긴다 — 0.15 CPU 서버다"""
    등록 = 라우트.limiter._route_limits.get("app.api.routes.screening.run_screening")
    assert 등록, "스크리닝에 요청 상한이 없다"
    assert str(등록[0].limit) == "40 per 1 minute"

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


def _세종목(monkeypatch):
    줄들 = {
        "AAPL": 스크리닝줄("AAPL", "US", {**꽉찬정보, "longName": "Apple Inc.", "country": "United States",
                                          "industry": "Consumer Electronics", "totalRevenue": 4e11}, _시세()),
        "BAC": 스크리닝줄("BAC", "US", {**꽉찬정보, "longName": "Bank of America", "sector": "Financial Services",
                                        "industry": "Banks", "totalRevenue": 1e11}, _시세()),
        "TSM": 스크리닝줄("TSM", "US", {**꽉찬정보, "longName": "TSMC", "country": "Taiwan",
                                        "industry": "Semiconductors", "totalRevenue": 9e10}, _시세()),
    }
    monkeypatch.setattr(모듈, "스크리닝_종목들", lambda m: list(줄들))
    monkeypatch.setattr(yf_service, "_screen_one", lambda s, m: 줄들[s])
    return 줄들


@pytest.mark.parametrize("q, 남을것", [
    ("aapl", ["AAPL"]),
    ("AAPL, tsm", ["AAPL", "TSM"]),
    ("bank of", ["BAC"]),                 # 띄어쓰기·대소문자를 가리지 않는다
    ("  ", ["AAPL", "BAC", "TSM"]),
    ("없는종목", []),
])
def test_티커나_이름으로_찾는다(client, monkeypatch, q, 남을것):
    _세종목(monkeypatch)
    r = client.post("/api/v1/screening/run", json={"market": "US", "sort_by": "revenue", "q": q})
    assert r.status_code == 200, r.text
    assert [x["symbol"] for x in r.json()["results"]] == 남을것
    assert r.json()["total"] == len(남을것)


def test_국가_섹터_산업_고를값은_거르기_전_시장_전체에서(client, monkeypatch):
    _세종목(monkeypatch)
    r = client.post("/api/v1/screening/run", json={"market": "US", "q": "aapl",
                                                  "filters": {"country": {"eq": "United States"}}})
    면 = r.json()["facets"]
    assert 면["country"] == ["Taiwan", "United States"]
    assert 면["industry"] == ["Banks", "Consumer Electronics", "Semiconductors"]
    assert 면["sector"] == ["Financial Services", "Technology"]


def test_새_칸으로_거르고_세운다(client, monkeypatch):
    _세종목(monkeypatch)
    r = client.post("/api/v1/screening/run", json={
        "market": "US", "sort_by": "revenue", "sort_order": "asc",
        "filters": {"revenue": {"min": 9.5e10}, "industry": {"eq": "Banks"}},
    })
    assert [x["symbol"] for x in r.json()["results"]] == ["BAC"]
    r = client.post("/api/v1/screening/run", json={"market": "US", "sort_by": "revenue", "sort_order": "asc"})
    assert [x["symbol"] for x in r.json()["results"]] == ["TSM", "BAC", "AAPL"]


class Test보기_저장:
    """보기 저장 — 조건·정렬에 더해 보이는 칸들도 남긴다"""

    @pytest.fixture
    def 로그인(self):
        from app.core.deps import require_user, get_current_user
        from app.db.database import engine, Base, SessionLocal
        from app.models.stock import ScreeningPreset
        # 검사용 sqlite 파일의 옛 표에는 새 칸(columns)이 없다 — 매번 새 표로
        ScreeningPreset.__table__.drop(bind=engine, checkfirst=True)
        Base.metadata.create_all(bind=engine)

        class 아무개:
            id = 876543

        app.dependency_overrides[require_user] = lambda: 아무개()
        app.dependency_overrides[get_current_user] = lambda: 아무개()
        yield TestClient(app)
        app.dependency_overrides.pop(require_user, None)
        app.dependency_overrides.pop(get_current_user, None)
        s = SessionLocal()
        try:
            s.query(ScreeningPreset).filter(ScreeningPreset.user_id == 아무개.id).delete()
            s.commit()
        finally:
            s.close()

    def test_칸들도_남기고_불러온다(self, 로그인):
        r = 로그인.post("/api/v1/screening/presets", json={
            "name": "내 보기", "market": "US", "filters": {"per": {"max": 20}},
            "sort_by": "revenue", "sort_order": "desc", "columns": ["market_cap", "rev_hist", "per"],
        })
        assert r.status_code == 200, r.text
        보기 = 로그인.get("/api/v1/screening/presets").json()
        assert [(p["name"], p["columns"], p["sort_by"]) for p in 보기] == [
            ("내 보기", ["market_cap", "rev_hist", "per"], "revenue")]

    def test_칸_없이_저장해도_된다_예전_보기처럼(self, 로그인):
        r = 로그인.post("/api/v1/screening/presets", json={
            "name": "옛 보기", "market": "KR", "filters": {}, "sort_by": "per"})
        assert r.status_code == 200, r.text
        assert 로그인.get("/api/v1/screening/presets").json()[0]["columns"] is None


@pytest.mark.parametrize("칸", [["Market Cap"], ["per; drop"], [3], ["a" * 41]])
def test_보기의_칸_이름은_화면의_칸_열쇠_모양만(칸):
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        라우트.PresetSaveRequest(name="x", market="US", filters={}, sort_by="per", columns=칸)
