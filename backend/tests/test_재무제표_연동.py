"""종목 상세 재무제표·투자지표 ↔ 스크리닝 — 같은 원천을 본다.

사용자: "스크리닝이랑 재무제표가 같이 연동되야하는 거 아니야?"

종목 상세는 종목별 원천(야후·네이버·FMP·DART 단일)만 보고 스크리닝은 전 종목 일괄 원천(SEC·DART 일괄·KRX·네이버)을
봤다. 운영에서는 야후 상세가 막혀, 스크리닝에는 매출·순이익·PER 이 있는 종목이 상세에서는 비었다. 종목별 원천이 비운
것만 스크리닝의 것으로 채운다 — 있는 값은 그대로.
"""
import asyncio

import pytest
from fastapi.testclient import TestClient

from app.services.fundamentals import fundamentals_service as FS
from app.services.screening import service as S
from app.services.screening.table import 만들기, 원천표

#: 미국 SEC 일괄 원천의 한 줄 — 네 해 매출·두 해 EPS, 그해·지난해 이익, 그해 현금흐름·재무상태
_SEC = {"revenue": 120.0, "earnings": 12.0, "earnings_prev": 10.0, "op_income": 18.0, "op_income_prev": 12.0,
        "equity": 60.0, "liabilities": 30.0, "assets": 90.0, "ocf": 25.0, "capex": 5.0, "eps": 2.0,
        "fin_years": [2022, 2023, 2024, 2025], "rev_hist": [80, 90, 96, 120], "eps_hist": [None, None, 1.5, 2.0]}
#: 국내 DART 일괄 원천의 한 줄 — 세 해 매출, 당기·전기 이익, 당기 재무상태(EPS 는 없다)
_DART = {"revenue": 300.0, "net_income": 30.0, "net_income_prev": 20.0, "op_income": 40.0, "op_income_prev": 50.0,
         "assets": 600.0, "liabilities": 200.0, "equity": 400.0,
         "rev_years": [2023, 2024, 2025], "rev_hist": [200.0, 250.0, 300.0]}


@pytest.fixture
def 원천(monkeypatch):
    """스크리닝 원천을 DB 대신 이 시험의 것으로"""
    S.비우기()
    S._원천_읽음[0] = True
    # 다른 종목(OTH)은 2022 년 EPS 가 있어 표에 그 칸이 선다 — QZQ 의 그 칸은 빈 값(NaN)이다
    S._원천["us_sec"] = 원천표("us_sec", {"QZQ": _SEC, "OTH": {"eps": 1.0, "fin_years": [2022, 2023, 2024, 2025],
                                                              "eps_hist": [0.5, 0.6, None, None], "earnings": 3.0}})
    S._원천["kr_dart"] = 원천표("kr_dart", {"005930": _DART})
    yield S
    S.비우기()


def test_원천_한_줄은_해마다의_값까지_숫자로(원천):
    줄 = S.재무_원천줄("US", "QZQ")
    assert 줄["rev@2025"] == 120.0 and 줄["eps@2024"] == 1.5 and 줄["earnings_prev"] == 10.0
    assert "eps@2022" not in 줄, "빈 해(NaN)는 뺀다"
    assert 줄["_끝해"] == 2025
    assert S.재무_원천줄("US", "OTH")["_끝해"] == 2025, "그 종목에 그해 값이 없어도 원천의 그해"
    assert S.재무_원천줄("KR", "005930.KS")["rev@2023"] == 200.0, "꼬리(.KS)를 떼고 찾는다"
    assert S.재무_원천줄("US", "없음") is None and S.재무_원천줄("ETF", "SPY") is None


def test_국내는_DART_에_없으면_네이버_연간_실적_줄(원천):
    """DART 키가 없으면 국내 재무 원천은 네이버 연간 실적뿐이다 — 상세 재무제표도 스크리닝과 같은 숫자로"""
    S._원천["kr_naver"] = 원천표("kr_naver", {
        "000660": {"per": 7.0, "fin_year": 2024, "revenue": 66.0, "net_income": 20.0, "net_income_prev": -9.0,
                   "op_income": 23.0, "op_income_prev": -8.0, "rev_years": [2022, 2023, 2024],
                   "rev_hist": [44.0, 33.0, 66.0], "eps_years": [2022, 2023, 2024], "eps_hist": [3000.0, -1000.0, 28000.0]},
        "035420": {"per": 20.0}})
    줄 = S.재무_원천줄("KR", "000660")
    assert (줄["_끝해"], 줄["_출처"], 줄["rev@2023"]) == (2024, "네이버", 33.0) and "fin_year" not in 줄
    assert S.재무_원천줄("KR", "005930")["_출처"] == "DART", "DART 가 먼저"
    assert S.재무_원천줄("KR", "035420.KS") is None, "연간 실적이 없는 네이버 줄(지표만)은 재무가 아니다"
    표 = FS.일괄_재무("KR", 줄)
    assert 표["source"] == "네이버"
    해마다 = {r["period"]: r for r in 표["annual"]}
    assert (해마다["2024"]["revenue"], 해마다["2024"]["net_income"], 해마다["2023"]["net_income"]) == (66.0, 20.0, -9.0)
    assert 해마다["2024"]["eps"] == 28000.0 and 해마다["2024"]["revenue_growth"] == 100.0


def test_해외_상장사의_해마다_EPS_도_스크리닝처럼_ADR_1주로(원천, monkeypatch):
    """스크리닝은 TSMC 의 EPS 를 ADR 1주(원주 5주)로 맞추는데 상세 재무제표가 원주 1주의 EPS 를 그대로 내면 다섯 배 다르다"""
    async def 빈것(symbol, market, 기다림=None):
        return {"annual": [], "quarterly": []}
    monkeypatch.setattr(FS, "_재무제표", 빈것)
    S._원천["us_sec"] = 원천표("us_sec", {
        "TSM": {"earnings": 50.0, "eps": 2.0, "foreign": 1.0, "revenue": 120.0,
                "fin_years": [2024, 2025], "eps_hist": [1.5, 2.0], "rev_hist": [90.0, 120.0]},
        "NRM": {"earnings": 10.0, "eps": 2.1, "revenue": 50.0, "fin_years": [2025], "eps_hist": [2.1]}})
    S._표["US"] = 만들기("US", [{"symbol": "TSM", "price": 300.0, "market_cap": 1500.0},
                               {"symbol": "NRM", "price": 40.0, "market_cap": 200.0}], [], {"us_sec": S._원천["us_sec"]})
    r = asyncio.run(FS.get_financials("TSM", "US"))
    # 시세 1주의 몫 = 300 × 50 ÷ 1500 = 10 — 원주 EPS(2)의 다섯 배
    assert {x["period"]: x["eps"] for x in r["annual"]} == {"2024": 7.5, "2025": 10.0}
    assert S.한종목("US", "TSM")["eps_hist"] == [7.5, 10.0], "스크리닝과 같은 숫자"
    r = asyncio.run(FS.get_financials("NRM", "US"))
    assert [x["eps"] for x in r["annual"]] == [2.1], "보통 회사는 장부 EPS 그대로"


def test_시세주_배율():
    assert FS.시세주_배율({"eps": 41000.0, "earnings": 9e10}, {"price": 480.0, "market_cap": 1.035e12}) \
        == pytest.approx(480 * 9e10 / 1.035e12 / 41000), "버크셔 B — A 주 EPS"
    assert FS.시세주_배율({"eps": 2.1, "earnings": 1e10}, {"price": 40.0, "market_cap": 2e11}) is None, "세 배 안쪽"
    assert FS.시세주_배율({"eps": 5.0, "earnings": 5e10, "foreign": 1.0}, {"price": 300.0, "market_cap": 1.5e12}) \
        == pytest.approx(2.0), "해외 상장사는 세 배 안쪽이어도(ADR 1주 = 원주 2주)"
    assert FS.시세주_배율({"eps": -0.5, "earnings": 1e9, "foreign": 1.0}, {"price": 10.0, "market_cap": 5e9}) is None, \
        "부호가 다르면 맞추지 않는다"
    assert FS.시세주_배율({"eps": 2.0, "earnings": 5e10, "foreign": 1.0}, {"price": 300.0}) is None, "시가총액을 모르면"
    assert FS.시세주_배율(None, None) is None


def test_서버가_막_떠도_DB_에_남긴_원천으로():
    from app.db.database import Base, SessionLocal, engine
    from app.models.stock import ScreeningSnapshot
    from app.services.screening import store
    Base.metadata.create_all(engine)
    S.비우기()
    try:
        assert store.남기기("US_SEC", {"at": 1.0, "year": 2025, "rows": {"QZQ": _SEC}})
        assert S.재무_원천줄("US", "QZQ")["earnings"] == 12.0
    finally:
        db = SessionLocal()
        try:
            db.query(ScreeningSnapshot).filter(ScreeningSnapshot.market == "US_SEC").delete(synchronize_session=False)
            db.commit()
        finally:
            db.close()
        S.비우기()


def test_그해_매출이_없어도_그해_이익은_그해에():
    """이 종목에 그해 매출·EPS 가 없으면(은행 등) 해 없는 칸(그해 순이익)이 한 해 앞 줄에 붙던 것"""
    표 = FS.일괄_재무("US", {"_끝해": 2025, "rev@2024": 10.0, "revenue": 12.0, "earnings": 5.0, "earnings_prev": -10.0})
    해마다 = {r["period"]: r for r in 표["annual"]}
    assert (해마다["2025"]["revenue"], 해마다["2025"]["net_income"], 해마다["2024"]["net_income"]) == (12.0, 5.0, -10.0)
    assert 해마다["2025"]["net_income_growth"] == 150.0, "적자에서 흑자 — 적자의 크기로 나눈다"
    # 그해 값이 하나도 없으면 그해 줄은 세우지 않는다
    표 = FS.일괄_재무("US", {"_끝해": 2025, "rev@2024": 10.0})
    assert [r["period"] for r in 표["annual"]] == ["2024"]


def test_미국_SEC_로_연간_재무제표(원천):
    표 = FS.일괄_재무("US", S.재무_원천줄("US", "QZQ"))
    assert 표["source"] == "SEC" and 표["quarterly"] == []
    해마다 = {r["period"]: r for r in 표["annual"]}
    assert list(해마다) == ["2022", "2023", "2024", "2025"]
    끝, 앞 = 해마다["2025"], 해마다["2024"]
    assert (끝["revenue"], 끝["net_income"], 끝["op_income"], 끝["eps"]) == (120.0, 12.0, 18.0, 2.0)
    assert (앞["net_income"], 앞["op_income"], 앞["eps"]) == (10.0, 12.0, 1.5), "지난해 이익은 _prev"
    assert (끝["operating_cf"], 끝["capex"], 끝["free_cf"]) == (25.0, -5.0, 20.0), "설비투자는 나간 돈(음수)"
    assert (끝["op_margin"], 끝["net_margin"], 끝["roe"], 끝["roa"], 끝["debt_ratio"]) == (15.0, 10.0, 20.0, 13.33, 50.0)
    assert (끝["revenue_growth"], 끝["op_income_growth"], 끝["net_income_growth"], 끝["eps_growth"]) == (25.0, 50.0, 20.0, 33.33)
    assert 해마다["2023"]["revenue_growth"] == 12.5 and "net_income" not in 해마다["2023"]


def test_국내_DART_로_연간_재무제표(원천):
    표 = FS.일괄_재무("KR", S.재무_원천줄("KR", "005930"))
    assert 표["source"] == "DART"
    해마다 = {r["period"]: r for r in 표["annual"]}
    assert list(해마다) == ["2023", "2024", "2025"]
    assert (해마다["2025"]["net_income"], 해마다["2024"]["net_income"]) == (30.0, 20.0)
    assert (해마다["2025"]["op_income"], 해마다["2024"]["op_income"]) == (40.0, 50.0)
    assert 해마다["2025"]["op_income_growth"] == -20.0 and 해마다["2025"]["debt_ratio"] == 50.0
    assert "eps" not in 해마다["2025"], "DART 일괄에는 EPS 가 없다 — 지어내지 않는다"


def test_가운데_해가_비면_전년_대비를_내지_않는다():
    표 = FS.일괄_재무("US", {"rev@2022": 80.0, "rev@2024": 96.0, "rev@2025": 120.0, "revenue": 120.0})
    해마다 = {r["period"]: r for r in 표["annual"]}
    assert "revenue_growth" not in 해마다["2024"], "두 해 성장을 전년 대비로 적었다"
    assert 해마다["2025"]["revenue_growth"] == 25.0
    assert FS.일괄_재무("US", None) == {"annual": [], "quarterly": []}
    assert FS.일괄_재무("US", {"revenue": 1.0}) == {"annual": [], "quarterly": []}, "어느 해 것인지 모르면 안 만든다"


def test_재무제표는_종목별_원천이_비면_스크리닝_원천으로(원천, monkeypatch):
    async def 빈것(symbol, market, 기다림=None):
        return {"annual": [], "quarterly": []}
    monkeypatch.setattr(FS, "_재무제표", 빈것)
    r = asyncio.run(FS.get_financials("QZQ", "US"))
    assert r["source"] == "SEC" and r["annual"][-1]["revenue"] == 120.0
    r = asyncio.run(FS.get_financials("없음", "US"))
    assert r == {"annual": [], "quarterly": []}, "스크리닝에도 없으면 빈 그대로"

    async def 있음(symbol, market, 기다림=None):
        return {"annual": [{"period": "2025", "revenue": 999.0}], "quarterly": []}
    monkeypatch.setattr(FS, "_재무제표", 있음)
    r = asyncio.run(FS.get_financials("QZQ", "US"))
    assert r["annual"] == [{"period": "2025", "revenue": 999.0}] and "source" not in r, "종목별 원천이 먼저"


def test_스크리닝_쪽이_깨져도_상세는_받은_그대로(원천, monkeypatch):
    async def 빈것(symbol, market, 기다림=None):
        return {"annual": [], "quarterly": []}

    def 깨짐(*a):
        raise RuntimeError("x")
    monkeypatch.setattr(FS, "_재무제표", 빈것)
    monkeypatch.setattr(S, "재무_원천줄", 깨짐)
    monkeypatch.setattr(S, "한종목", 깨짐)
    assert asyncio.run(FS.get_financials("QZQ", "US")) == {"annual": [], "quarterly": []}

    async def 지표(symbol, market, 기다림=None):
        return {"per": 9.0}
    monkeypatch.setattr(FS, "_투자지표", 지표)
    assert asyncio.run(FS.get_fundamentals("QZQ", "US")) == {"per": 9.0}


def test_투자지표는_빈_칸만_스크리닝_표로(원천, monkeypatch):
    async def 반쪽(symbol, market, 기다림=None):
        return {"per": 9.0, "sector": "IT", "pbr": None}
    monkeypatch.setattr(FS, "_투자지표", 반쪽)
    # 시가총액 240 = 시세 40 × 6주 — 순이익 12 ÷ 6주 = EPS 2 와 맞는다
    S._표["US"] = 만들기("US", [{"symbol": "QZQ", "price": 40.0, "market_cap": 240.0, "sector": "Technology"}], [],
                       {"us_sec": S._원천["us_sec"]})
    r = asyncio.run(FS.get_fundamentals("QZQ", "US"))
    assert r["per"] == 9.0 and r["sector"] == "IT", "있는 값은 그대로"
    assert (r["pbr"], r["roe"], r["op_margin"], r["net_margin"], r["market_cap"]) == (4.0, 20.0, 15.0, 10.0, 240)
    assert (r["debt_ratio"], r["eps"]) == (50.0, 2.0)
    r = asyncio.run(FS.get_fundamentals("없음", "US"))
    assert r == {"per": 9.0, "sector": "IT", "pbr": None}, "스크리닝에 없으면 받은 그대로"


def test_종목_상세_API_도_같은_숫자(원천, monkeypatch):
    async def 빈것(symbol, market, 기다림=None):
        return {"annual": [], "quarterly": []}

    async def 빈지표(symbol, market, 기다림=None):
        return {}
    monkeypatch.setattr(FS, "_재무제표", 빈것)
    monkeypatch.setattr(FS, "_투자지표", 빈지표)
    S._표["KR"] = 만들기("KR", [{"symbol": "005930", "price": 70000.0, "market_cap": 4.0e14}], [],
                       {"kr_dart": S._원천["kr_dart"]})
    c = TestClient(__import__("app.main", fromlist=["app"]).app)
    재무 = c.get("/api/v1/stocks/KR/005930/financials").json()
    assert 재무["source"] == "DART" and [r["period"] for r in 재무["annual"]] == ["2023", "2024", "2025"]
    지표 = c.get("/api/v1/stocks/KR/005930/fundamentals").json()
    스크리닝 = S.한종목("KR", "005930")
    assert 지표["roe"] == 스크리닝["roe"] and 지표["op_margin"] == 스크리닝["operating_margin"], "스크리닝과 같은 숫자"
