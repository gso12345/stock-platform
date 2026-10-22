"""스크리닝 — 비던 지표를 채우고, 국가·산업을 한국어로(2026-10 두 번째 묶음).

사용자:
  3. 스크리닝에서 일부종목의 지표가 안나와
  4. 스크리닝 국가는 모두 한국어로 표기해줘
  5. 스크리닝 산업도 모두 한국어로 표기해줘
  6. 국내주식 스크리닝은 안나오는 지표가 너무 많아

까닭 — KRX 는 이제 로그인한 세션에만 자료를 준다('LOGOUT'). 그래서 국내 PER·PBR·배당·업종·수익률이 운영에서
통째로 비었다. 국내 지표는 네이버 종목별 조회를 빨리 돌려 채우고, 산업·누리집·수익률은 KRX 에 로그인해 받은 표를
FinanceData 가 날마다 올리는 GitHub CSV 로, 미국 주요 종목 밖의 52주·수익률·RSI 는 야후 1년 시세(spark)로 채운다.
"""
import json
import time
from datetime import date

import pandas as pd
import pytest

from app.services.screening import names_ko as N
from app.services.screening import service as S
from app.services.screening import sources
from app.services.screening.table import 만들기, 원천표

#: 나스닥 종목 목록(nasdaq·nyse·amex 전 종목, 2026-10)에 실제로 나오는 산업·나라
나스닥_산업 = [
    "Biotechnology: Pharmaceutical Preparations", "Blank Checks", "Major Banks",
    "Computer Software: Prepackaged Software", "Industrial Machinery/Components",
    "Real Estate Investment Trusts", "Finance: Consumer Services", "EDP Services", "Investment Managers",
    "Biotechnology: Biological Products (No Diagnostic Substances)", "Medical/Dental Instruments",
    "Oil & Gas Production", "Semiconductors", "Business Services", "Telecommunications Equipment",
    "Trusts Except Educational Religious and Charitable", "Finance/Investors Services",
    "Computer Software: Programming Data Processing", "Property-Casualty Insurers",
    "Electric Utilities: Central", "Other Consumer Services", "Marine Transportation", "Precious Metals",
    "Major Chemicals", "Investment Bankers/Brokers/Service", "Finance Companies", "Real Estate",
    "Industrial Specialties", "Restaurants", "Professional Services",
    "Services-Misc. Amusement & Recreation", "Metal Fabrications", "Medical Specialities", "Metal Mining",
    "Packaged Foods", "Military/Government/Technical", "Other Specialty Stores",
    "Diversified Commercial Services", "Auto Parts:O.E.M.", "Beverages (Production/Distribution)",
    "Hotels/Resorts", "Commercial Banks", "Specialty Insurers", "Electrical Products", "Aerospace",
    "Savings Institutions", "Medical/Nursing Services", "Auto Manufacturing", "Farming/Seeds/Milling",
    "Homebuilding", "Life Insurance", "Catalog/Specialty Distribution", "Natural Gas Distribution",
    "Apparel", "Power Generation", "Medicinal Chemicals and Botanical Products", "Steel/Iron Ore",
    "Biotechnology: Electromedical & Electrotherapeutic Apparatus", "Advertising", "Broadcasting",
    "Package Goods/Cosmetics", "Clothing/Shoe/Accessory Stores",
    "Mining & Quarrying of Nonmetallic Minerals (No Fuels)", "Banks",
    "Biotechnology: Laboratory Analytical Instruments", "Consumer Electronics/Appliances",
    "Transportation Services", "Radio And Television Broadcasting And Communications Equipment",
    "Electronic Components", "Air Freight/Delivery Services", "Trucking Freight/Courier Services",
    "Oilfield Services/Equipment", "Biotechnology: In Vitro & In Vivo Diagnostic Substances",
    "Computer peripheral equipment", "Home Furnishings", "Recreational Games/Products/Toys",
    "Engineering & Construction", "Retail-Auto Dealers and Gas Stations",
    "Computer Communications Equipment", "Cable & Other Pay Television Services",
    "Integrated Freight & Logistics", "Containers/Packaging", "Oil and Gas Field Machinery",
    "RETAIL: Building Materials", "Construction/Ag Equipment/Trucks", "Oil/Gas Transmission",
    "Integrated oil Companies", "Movies/Entertainment",
    "Biotechnology: Commercial Physical & Biological Resarch", "Food Chains", "Water Supply",
    "Hospital/Nursing Management", "Coal Mining", "Agricultural Chemicals",
    "Office Equipment/Supplies/Services", "Department/Specialty Retail Stores", "Environmental Services",
    "Multi-Sector Companies", "Other Metals and Minerals", "Building Products", "Publishing", "Railroads",
    "Computer Manufacturing", "Oil Refining/Marketing", "Consumer Specialties", "Building Materials",
    "Miscellaneous manufacturing industries", "Food Distributors", "Other Pharmaceuticals",
    "Misc Health and Biotechnology Services", "Specialty Foods", "Ophthalmic Goods", "Shoe Manufacturing",
    "Plastic Products", "Building operators", "Ordnance And Accessories", "Automotive Aftermarket",
    "Retail: Computer Software & Peripheral Equipment", "Motor Vehicles",
    "Water Sewer Pipeline Comm & Power Line Construction", "Paper", "Forest Products", "Fluid Controls",
    "Rental/Leasing Companies", "Newspapers/Magazines", "Specialty Chemicals", "Meat/Poultry/Fish",
    "Textiles", "Garments and Clothing", "Auto & Home Supply Stores", "Consumer Electronics/Video Chains",
    "Misc Corporate Leasing Services", "Retail-Drug Stores and Proprietary Stores",
    "Accident &Health Insurance", "Diversified Financial Services", "Durable Goods", "Miscellaneous",
    "Pollution Control Equipment", "Medical Electronics", "Books", "Precision Instruments",
    "Wholesale Distributors", "Paints/Coatings", "Tobacco", "Aluminum",
    "Professional and commerical equipment", "General Bldg Contractors - Nonresidential Bldgs",
    "Managed Health Care", "Pharmaceuticals and Biotechnology", "Other Transportation",
    "Electronics Distribution", "Tools/Hardware",
]
나스닥_나라 = [
    "United States", "China", "Canada", "Israel", "United Kingdom", "Singapore", "Hong Kong", "Bermuda",
    "Cayman Islands", "Greece", "Australia", "Japan", "Brazil", "Switzerland", "Taiwan", "Netherlands",
    "Ireland", "Luxembourg", "France", "Mexico", "Malaysia", "South Korea", "Germany", "Argentina",
    "United Arab Emirates", "Sweden", "India", "Chile", "South Africa", "Belgium", "Denmark", "Italy",
    "Jersey", "Cyprus", "Spain", "Puerto Rico", "Peru", "Monaco", "British Virgin Islands", "Uruguay",
    "Guernsey", "Macau", "Finland", "Colombia", "Gibraltar", "Kazakhstan", "Turkey", "Norway", "Indonesia",
    "Philippines", "Panama", "New Zealand", "Costa Rica", "U.S. Virgin Islands", "Cambodia", "Jordan",
    "Curacao", "Bahamas", "Isle of Man", "Marshall Islands",
]


class Test한국어_이름:
    def test_나스닥에_나오는_산업과_나라는_모두_한국어로(self):
        영문산업 = [k for k in 나스닥_산업 if N.산업_이름(k) == k]
        영문나라 = [k for k in 나스닥_나라 if N.나라_이름(k) == k]
        assert 영문산업 == [] and 영문나라 == []
        assert len(나스닥_산업) == 152 and len(나스닥_나라) == 60

    @pytest.mark.parametrize("영문, 한국어", [
        ("Software—Infrastructure", "인프라 소프트웨어"), ("Software - Infrastructure", "인프라 소프트웨어"),
        ("Software–Application", "응용 소프트웨어"), ("Beverages - Non-Alcoholic", "비주류 음료"),
        ("REIT - Office", "리츠: 오피스"), ("Insurance—Property & Casualty", "손해보험"),
        ("Banks - Regional", "지방은행"), ("semiconductors", "반도체"), ("Major Banks", "대형 은행"),
        ("Auto Parts:O.E.M.", "자동차 부품(OEM)"), ("Property-Casualty Insurers", "손해보험"),
    ])
    def test_야후의_줄표_표기가_달라도_같은_이름(self, 영문, 한국어):
        assert N.산업_이름(영문) == 한국어

    def test_이미_한국어면_그대로_모르면_영문_그대로_한_번만_적는다(self, caplog):
        caplog.set_level("INFO")
        assert N.산업_이름("반도체 제조업") == "반도체 제조업" and N.나라_이름("대한민국") == "대한민국"
        assert caplog.records == [], "한국어(국내 표준산업분류)는 모르는 이름이 아니다"
        assert N.산업_이름("") is None and N.나라_이름(None) is None
        assert N.산업_이름("Quantum Widgets") == "Quantum Widgets"
        N.산업_이름("Quantum Widgets")
        assert sum("Quantum Widgets" in r.message for r in caplog.records) == 1

    def test_나라_다른_표기(self):
        assert N.나라_이름("Korea, Republic of") == "대한민국" and N.나라_이름("united states") == "미국"
        assert N.나라_이름("Taiwan, Province of China") == "대만"

    @pytest.mark.parametrize("산업, 업종", [
        ("반도체 제조업", "전기·전자"), ("통신 및 방송 장비 제조업", "전기·전자"), ("의약품 제조업", "제약"),
        ("의료용 기기 제조업", "의료·정밀기기"), ("기타 금융업", "금융"), ("부동산 임대 및 공급업", "부동산"),
        ("산업용 기계 및 장비 임대업", "일반서비스"), ("특수 목적용 기계 제조업", "기계·장비"),
        ("기타 비금속 광물제품 제조업", "비금속"), ("1차 철강 제조업", "금속"),
        ("서적, 잡지 및 기타 인쇄물 출판업", "오락·문화"), ("음·식료품 및 담배 도매업", "유통"),
        ("소프트웨어 개발 및 공급업", "IT 서비스"), ("자동차용 엔진 및 자동차 제조업", "운송장비·부품"),
        ("전기 및 통신 공사업", "건설"), ("떡, 빵 및 과자류 제조업", "음식료·담배"), ("전기업", "전기·가스"),
        ("기타 운송관련 서비스업", "운송·창고"), ("그외 기타 제품 제조업", "기타제조"),
    ])
    def test_국내_표준산업분류로_KRX_업종을_어림한다(self, 산업, 업종):
        assert N.국내업종_어림(산업) == 업종

    def test_어림_못하면_없음(self):
        assert N.국내업종_어림("") is None and N.국내업종_어림(None) is None and N.국내업종_어림("알 수 없는 업") is None


# ── GitHub 우회로(KRX CSV) ─────────────────────────────────────────

class 글응답:
    def __init__(self, 글: str, 상태: int = 200):
        self.text, self.status_code = 글, 상태

    def json(self):
        return json.loads(self.text)

    def raise_for_status(self):
        if self.status_code >= 400:
            import httpx
            raise httpx.HTTPStatusError("가짜", request=httpx.Request("GET", "http://x"),
                                        response=httpx.Response(self.status_code))


def _목록csv(줄들: list[tuple[str, float, float]]) -> str:
    머리 = "﻿,Code,ISU_CD,Name,Market,Dept,Close,ChangeCode,Changes,ChagesRatio,Open,High,Low,Volume,Amount,Marcap,Stocks,MarketId\n"
    채움 = [f"{i},{c},KR7{c}003,회사{c},KOSPI,,{종가:.0f},1,0,0,0,0,0,0,0,0,{주식수:.0f},STK" for i, (c, 종가, 주식수) in enumerate(줄들)]
    return 머리 + "\n".join(채움) + "\n" + ("#" * 1000)


def _상세csv(줄들: list[tuple[str, str, str]]) -> str:
    머리 = "﻿,Code,Name,Market,Sector,Industry,Products,ListingDate,SettleMonth,Representative,HomePage,Region\n"
    채움 = [f'{i},{c},회사{c},KOSPI,,"{산업}",제품,2000-01-01,12월,대표,{누리집},서울특별시'
            for i, (c, 산업, 누리집) in enumerate(줄들)]
    return 머리 + "\n".join(채움) + "\n" + ("#" * 1000)


class 가짜깃헙:
    """날짜별 CSV 를 정해 둔다 — 없는 날은 404"""

    def __init__(self, 상세: dict, 목록: dict, 물음: list):
        self.상세, self.목록, self.물음 = 상세, 목록, 물음

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def get(self, url, **kw):
        self.물음.append(url)
        날 = url.rsplit("/", 1)[1].removesuffix(".csv")
        표 = self.상세 if "/desc/" in url else self.목록
        return 글응답(표[날]) if 날 in 표 else 글응답("", 404)


class Test_GitHub_일괄:
    def _준비(self, monkeypatch, 상세, 목록):
        from app.services.listings import krx_listing as K
        물음: list = []
        monkeypatch.setattr(K.httpx, "Client", lambda **kw: 가짜깃헙(상세, 목록, 물음))
        return K, 물음

    def test_산업_누리집과_1_3개월_수익률(self, monkeypatch):
        # 2026-10-21(수). 1개월 전 9-21(월)은 CSV 가 없고(추석) 9-18(금)로 앞당긴다. 1년 전은 저장소에 없다
        상세 = {"2026-10-21": _상세csv([("005930", "통신 및 방송 장비 제조업", "http://www.samsung.com/sec"),
                                       ("000660", "반도체 제조업", "")])}
        목록 = {"2026-10-21": _목록csv([("005930", 70000, 100), ("005935", 60000, 10), ("000660", 200000, 100),
                                       ("111110", 5000, 300)]),
                "2026-09-18": _목록csv([("005930", 56000, 100), ("005935", 50000, 10), ("000660", 250000, 100),
                                       ("111110", 10000, 100)]),
                "2026-07-21": _목록csv([("005930", 50000, 100)])}
        K, 물음 = self._준비(monkeypatch, 상세, 목록)
        줄들, 기준일 = K.fetch_github_bulk(date(2026, 10, 21))
        assert 기준일 == "20261021"
        assert 줄들["005930"] == {"industry": "통신 및 방송 장비 제조업", "homepage": "http://www.samsung.com/sec",
                                 "return_1m": 25.0, "return_3m": 40.0}
        assert 줄들["000660"]["return_1m"] == -20.0 and "homepage" not in 줄들["000660"]
        assert 줄들["005935"]["industry"] == "통신 및 방송 장비 제조업", "우선주는 보통주의 산업"
        assert "return_1m" not in 줄들.get("111110", {}), "주식 수가 세 배 — 분할일 수 있어 수익률을 비운다"
        assert all("return_1y" not in r for r in 줄들.values())
        assert not any("2026-09-19" in u or "2026-09-20" in u for u in 물음), "주말은 묻지 않는다"

    def test_그날_CSV_가_없으면_거슬러_올라가고_다_없으면_빈손(self, monkeypatch):
        K, _ = self._준비(monkeypatch, {"2026-10-19": _상세csv([("005930", "반도체 제조업", "")])}, {})
        줄들, 기준일 = K.fetch_github_bulk(date(2026, 10, 21))
        assert 줄들 == {"005930": {"industry": "반도체 제조업"}} and 기준일 == "20261019"
        K, _ = self._준비(monkeypatch, {}, {})
        assert K.fetch_github_bulk(date(2026, 10, 21)) == ({}, "")

    def test_200_이어도_몇_글자뿐이면_없는_날로_친다(self, monkeypatch):
        상세 = {"2026-10-21": "404: Not Found", "2026-10-20": _상세csv([("005930", "반도체 제조업", "")])}
        K, _ = self._준비(monkeypatch, 상세, {})
        assert K.fetch_github_bulk(date(2026, 10, 21)) == ({"005930": {"industry": "반도체 제조업"}}, "20261020")

    def test_기준일은_수익률을_낸_시세_목록의_날(self, monkeypatch):
        상세 = {"2026-10-21": _상세csv([("005930", "반도체 제조업", "")])}
        K, _ = self._준비(monkeypatch, 상세, {"2026-10-20": _목록csv([("005930", 70000, 100)])})
        assert K.fetch_github_bulk(date(2026, 10, 21))[1] == "20261020"


# ── KRX 로그인 ──────────────────────────────────────────────────

class 가짜KRX로그인:
    def __init__(self, 로그인답: list, 자료답: str, 물음: list):
        self.로그인답, self.자료답, self.물음 = list(로그인답), 자료답, 물음

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def get(self, url, **kw):
        self.물음.append(("GET", url, None))
        return 글응답(json.dumps({"result": {"output": [{"max_work_dt": "20261020"}]}}))

    def post(self, url, data=None, **kw):
        self.물음.append(("POST", url, dict(data or {})))
        if "MDCCOMS001D1" in url:
            return 글응답(json.dumps({"_error_code": self.로그인답.pop(0)}))
        return 글응답(self.자료답)


class Test_KRX_로그인:
    def test_로그인_없이_LOGOUT_이면_로그인이_필요하다고_던진다(self, monkeypatch):
        from app.services.listings import krx_listing as K
        물음: list = []
        monkeypatch.setattr(K.httpx, "Client", lambda **kw: 가짜KRX로그인([], "LOGOUT", 물음))
        with pytest.raises(K.KRX로그인필요):
            K.fetch_screening_bulk()
        assert not any("MDCCOMS001D1" in u for _, u, _ in 물음), "아이디가 없으면 로그인하지 않는다"

    def test_아이디가_있으면_로그인하고_이미_다른_곳에서_로그인_중이면_끊고_들어간다(self, monkeypatch):
        from app.services.listings import krx_listing as K
        물음: list = []
        monkeypatch.setattr(K.httpx, "Client", lambda **kw: 가짜KRX로그인(["CD011", "CD001"], "LOGOUT", 물음))
        with pytest.raises(K.KRX로그인필요):
            K.fetch_screening_bulk("myid", "mypw")
        로그인 = [d for 방식, u, d in 물음 if 방식 == "POST" and "MDCCOMS001D1" in u]
        assert [d.get("mbrId") for d in 로그인] == ["myid", "myid"] and 로그인[1].get("skipDup") == "Y"

    def test_로그인_결과(self):
        from app.services.listings import krx_listing as K
        assert K.krx_로그인(가짜KRX로그인(["CD001"], "", []), "a", "b") is True
        assert K.krx_로그인(가짜KRX로그인(["CD999"], "", []), "a", "b") is False
        assert K.krx_로그인(가짜KRX로그인([], "", []), "", "") is False


def test_KRX_가_로그인을_요구하면_관리자_화면에_그렇게_알리고_아이디가_없으면_오래_쉰다(monkeypatch):
    from app.core import health
    from app.core.config import settings
    from app.services.listings import krx_listing

    def 막힘(*a):
        raise krx_listing.KRX로그인필요("x")
    monkeypatch.setattr(krx_listing, "fetch_screening_bulk", 막힘)
    monkeypatch.setattr(sources, "KRX_로그인막힘", [False])
    assert sources.국내_KRX() is None and sources.KRX_로그인막힘[0] is True
    줄 = {s["name"]: s for s in health.snapshot()}[sources.이름_KRX]
    assert "KRX_ID" in 줄["last_error"]
    # 아이디가 없으면 한 시간이 아니라 열두 시간 쉰다
    monkeypatch.setattr(settings, "KRX_ID", "")
    monkeypatch.setattr(S, "원천_받기", True)
    맡김: list = []
    monkeypatch.setattr(S, "_일_맡기기", lambda 칸: 맡김.append(칸))
    monkeypatch.setattr(S, "_원천때", {})
    monkeypatch.setattr(S, "_시도때", {"kr_krx": time.time() - 2 * 3600})
    S._원천_챙기기("KR")
    assert "kr_krx" not in 맡김
    monkeypatch.setattr(settings, "KRX_ID", "myid")
    S._원천_챙기기("KR")
    assert "kr_krx" in 맡김, "아이디가 있으면 한 시간 뒤 다시"
    # 다시 받으면 막힘을 푼다 — 안 풀면 그 뒤로 아이디 없이 한 번 못 받을 때마다 열두 시간씩 쉰다
    monkeypatch.setattr(krx_listing, "fetch_screening_bulk", lambda *a: ({"005930": {"per": 10.0}}, "20261021"))
    assert sources.국내_KRX()["rows"] and sources.KRX_로그인막힘[0] is False


def test_GitHub_원천은_몇_곳뿐이면_못_받은_것(monkeypatch):
    from app.services.listings import krx_listing
    monkeypatch.setattr(krx_listing, "fetch_github_bulk", lambda: ({"005930": {"industry": "x"}}, "20261021"))
    assert sources.국내_GitHub() is None
    monkeypatch.setattr(krx_listing, "fetch_github_bulk",
                        lambda: ({f"{i:06d}": {"industry": "x", "return_1m": 1.0} for i in range(600)}, "20261021"))
    assert len(sources.국내_GitHub()["rows"]) == 600


# ── 미국 1년 시세(야후 spark) ──────────────────────────────────────

def test_spark_응답_두_모양에서_종가를_읽는다():
    from app.services.market.price_fetcher import 종가들_읽기
    v7 = {"spark": {"result": [{"symbol": "AAA", "response": [{"meta": {"symbol": "AAA"},
                                                                "indicators": {"quote": [{"close": [1.0, None, 0, 2.0]}]}}]},
                               {"symbol": "BBB", "response": [{"meta": {}, "indicators": {"quote": [{"close": []}]}}]}]}}
    v8 = {"CCC": {"symbol": "CCC", "close": [3.0, 0, 4.0], "timestamp": [1, 2, 3]}, "bad": 1}
    assert 종가들_읽기(v7) == {"AAA": [1.0, 2.0]}
    assert 종가들_읽기(v8) == {"CCC": [3.0, 4.0]}
    assert 종가들_읽기(None) == {} and 종가들_읽기([]) == {}


def test_1년_종가로_52주_고저_수익률_RSI():
    종가들 = [100.0 + i for i in range(260)]               # 꾸준히 오른다
    지표 = sources.시세흐름_지표(종가들)
    assert 지표["high_52w"] == 359.0 and 지표["low_52w"] == 108.0, "마지막 252 거래일"
    assert 지표["return_1m"] == round((359 / 338 - 1) * 100, 2) and 지표["return_1y"] == round((359 / 107 - 1) * 100, 2)
    assert 지표["rsi"] == 100.0
    assert "return_1y" in sources.시세흐름_지표(종가들[:246]), "휴장일만큼 모자란 1년은 첫날로"
    assert "return_1y" not in sources.시세흐름_지표(종가들[:200])
    assert sources.시세흐름_지표([1.0] * 10) == {}


class 가짜야후:
    def __init__(self, 답, 물음):
        self.답, self.물음 = 답, 물음

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, url, params=None, **kw):
        self.물음.append((url, dict(params or {})))
        return self.답(url, params)


def test_spark_종가는_막히면_쉬고_되는_주소를_기억한다(monkeypatch):
    import asyncio
    from app.services.market import price_fetcher as P
    물음: list = []

    def 답(url, params):
        if "/v7/" in url:
            return 글응답("{}", 200)                            # v7 은 빈손 — v8 로
        return 글응답(json.dumps({s: {"close": [1.0, 2.0]} for s in params["symbols"].split(",")}))
    monkeypatch.setattr(P, "_spark_막힌때", 0.0)
    monkeypatch.setattr(P, "_spark_판", "v7")
    monkeypatch.setattr(P, "SPARK_BATCH", 2)
    monkeypatch.setattr(P.httpx, "AsyncClient", lambda **kw: 가짜야후(답, 물음))
    받음 = asyncio.run(P.fetch_yf_closes(["A", "B", "C"]))
    assert 받음 == {"A": [1.0, 2.0], "B": [1.0, 2.0], "C": [1.0, 2.0]} and P._spark_판 == "v8"
    assert 물음[0][1]["range"] == "1y" and 물음[0][1]["interval"] == "1d"
    # 막히면(429) 쉰다 — 쉬는 동안은 묻지도 않는다
    물음.clear()
    monkeypatch.setattr(P.httpx, "AsyncClient", lambda **kw: 가짜야후(lambda u, p: 글응답("", 429), 물음))
    assert asyncio.run(P.fetch_yf_closes(["A"])) == {} and P._spark_막힌때 > 0
    물음.clear()
    assert asyncio.run(P.fetch_yf_closes(["A"])) == {} and 물음 == []


def test_spark_가_JSON_이_아닌_답을_주면_다른_주소로(monkeypatch):
    import asyncio
    from app.services.market import price_fetcher as P

    def 답(url, params):
        if "/v7/" in url:
            return 글응답("<html>점검 중</html>", 200)
        return 글응답(json.dumps({"A": {"close": [1.0, 2.0]}}))
    monkeypatch.setattr(P, "_spark_막힌때", 0.0)
    monkeypatch.setattr(P, "_spark_판", "v7")
    monkeypatch.setattr(P.httpx, "AsyncClient", lambda **kw: 가짜야후(답, []))
    assert asyncio.run(P.fetch_yf_closes(["A"])) == {"A": [1.0, 2.0]}


def test_미국_1년_시세는_받은_때를_적는다(monkeypatch):
    """받은 때(at)가 없으면 돌아가며 받기가 그 종목을 늘 '오래된 것' 으로 보고 같은 종목만 다시 받는다"""
    from app.services.market import price_fetcher as P

    async def 종가(심볼들, 기간="1y"):
        return {s: [100.0 + i for i in range(260)] for s in 심볼들 if s != "NONE"}
    monkeypatch.setattr(P, "fetch_yf_closes", 종가)
    전 = time.time()
    받음 = sources.미국_시세흐름(["AAA", "NONE"])
    assert set(받음) == {"AAA"} and 받음["AAA"]["at"] >= 전 and 받음["AAA"]["high_52w"] == 359.0
    assert sources.미국_시세흐름([]) == {}


# ── 표 ─────────────────────────────────────────────────────────────

def _국내기초():
    return [{"symbol": "005930", "name": "삼성전자", "price": 70000.0, "market_cap": 4.0e14},
            {"symbol": "000660", "name": "SK하이닉스", "price": 200000.0, "market_cap": 1.4e14},
            {"symbol": "123450", "name": "어떤회사", "price": 1000.0, "market_cap": 1.0e10}]


def _깃헙():
    return 원천표("kr_git", {
        "005930": {"industry": "통신 및 방송 장비 제조업", "homepage": "http://www.samsung.com/sec",
                   "return_1m": 5.0, "return_3m": 9.0},
        "000660": {"industry": "반도체 제조업", "homepage": "http://www.skhynix.com", "return_1m": -3.0},
        "123450": {"industry": "기타 금융업"}})


class Test표_국내_빈칸_채우기:
    def _줄들(self, 원천, 풍부=()):
        return {r["symbol"]: r for r in 만들기("KR", _국내기초(), list(풍부), 원천).결과({}, "", "price", True, 0, 9)[0]}

    def test_KRX_가_막히면_산업은_표준산업분류_업종은_그것으로_어림_로고는_누리집(self):
        r = self._줄들({"kr_git": _깃헙()})
        assert r["005930"]["industry"] == "통신 및 방송 장비 제조업" and r["005930"]["sector"] == "전기·전자"
        assert r["123450"]["sector"] == "금융" and r["005930"]["domain"] == "samsung.com"
        assert r["005930"]["return_1m"] == 5.0 and r["000660"]["return_1m"] == -3.0

    def test_KRX_업종과_수익률이_있으면_그것이_먼저(self):
        krx = 원천표("kr_krx", {"005930": {"sector": "전기·전자", "return_1m": 6.5, "eps": 5000.0}})
        r = self._줄들({"kr_git": _깃헙(), "kr_krx": krx})
        assert r["005930"]["return_1m"] == 6.5 and r["000660"]["return_1m"] == -3.0
        assert r["000660"]["sector"] == "전기·전자", "KRX 업종이 없는 종목은 어림한 같은 이름"

    def test_야후_줄의_누리집과_산업이_있으면_로고는_야후_산업은_표준산업분류가_먼저(self):
        풍부 = [{"symbol": "005930", "domain": "samsung.co.kr", "industry": "Consumer Electronics"}]
        r = self._줄들({"kr_git": _깃헙()}, 풍부)
        assert r["005930"]["domain"] == "samsung.co.kr" and r["005930"]["industry"] == "통신 및 방송 장비 제조업"

    def test_PER_PBR_은_네이버_KRX_가_없으면_DART_로_어림한다(self):
        dart = 원천표("kr_dart", {"005930": {"net_income": 2.0e13, "equity": 3.2e14, "revenue": 3.0e14}})
        네이버 = 원천표("kr_naver", {"000660": {"eps": 10000.0, "bps": 100000.0, "at": time.time()}})
        r = self._줄들({"kr_dart": dart, "kr_naver": 네이버})
        assert r["005930"]["per"] == 20.0 and r["005930"]["pbr"] == 1.25, "시가총액 ÷ 순이익·자본"
        assert r["000660"]["per"] == 20.0 and r["000660"]["pbr"] == 2.0, "네이버 EPS·BPS 가 있으면 그것"

    def test_1년_시세로_1년_수익률_RSI_52주를_채우고_52주는_네이버가_먼저(self):
        시세 = 원천표("kr_px", {"005930": {"high_52w": 80000.0, "low_52w": 50000.0, "return_1y": 30.0, "rsi": 55.0,
                                           "return_1m": 9.0, "at": 1.0},
                                "000660": {"high_52w": 300000.0, "low_52w": 100000.0, "return_1y": -5.0, "at": 1.0}})
        네이버 = 원천표("kr_naver", {"000660": {"high_52w": 250000.0, "low_52w": 160000.0, "at": time.time()}})
        r = self._줄들({"kr_px": 시세, "kr_naver": 네이버, "kr_git": _깃헙()})
        assert (r["005930"]["return_1y"], r["005930"]["rsi"], r["005930"]["high_52w"]) == (30.0, 55.0, 80000.0)
        assert r["005930"]["pct_from_52w_high"] == -12.5 and r["005930"]["pct_from_52w_low"] == 40.0
        assert r["005930"]["return_1m"] == 5.0, "1개월은 GitHub(그날 종가) 가 먼저"
        assert (r["000660"]["high_52w"], r["000660"]["low_52w"]) == (250000.0, 160000.0), "52주는 네이버가 먼저"
        assert r["000660"]["pct_from_52w_high"] == -20.0 and r["000660"]["return_1y"] == -5.0

    def test_업종_어림도_KRX_도_없으면_야후_업종(self):
        r = self._줄들({}, [{"symbol": "005930", "sector": "Technology"}])
        assert r["005930"]["sector"] == "기술"


class Test표_미국_빈칸_채우기:
    def test_1년_시세로_52주_고점_대비_수익률_RSI_를_채우고_야후_줄이_먼저(self):
        기초 = [{"symbol": "AAA", "price": 90.0, "market_cap": 2.0}, {"symbol": "BBB", "price": 50.0, "market_cap": 1.0}]
        시세 = 원천표("us_px", {"AAA": {"high_52w": 100.0, "low_52w": 60.0, "return_1m": 2.0, "rsi": 55.0, "at": 1.0},
                               "BBB": {"high_52w": 80.0, "low_52w": 40.0, "return_1y": -10.0, "rsi": 30.0, "at": 1.0}})
        풍부 = [{"symbol": "BBB", "rsi": 41.0, "pct_from_52w_high": -30.0}]
        r = {x["symbol"]: x for x in 만들기("US", 기초, 풍부, {"us_px": 시세}).결과({}, "", "price", True, 0, 9)[0]}
        assert r["AAA"]["pct_from_52w_high"] == -10.0 and r["AAA"]["pct_from_52w_low"] == 50.0
        assert (r["AAA"]["high_52w"], r["AAA"]["low_52w"]) == (100.0, 60.0)
        assert (r["AAA"]["rsi"], r["AAA"]["return_1m"]) == (55.0, 2.0)
        assert r["BBB"]["rsi"] == 41.0 and r["BBB"]["pct_from_52w_high"] == -30.0, "야후 줄이 먼저"
        assert r["BBB"]["return_1y"] == -10.0

    def test_산업은_한국어로_담고_영문으로_저장한_조건도_맞는다(self):
        기초 = [{"symbol": "NVDA", "price": 1.0, "industry": "Semiconductors", "country": "United States"},
                {"symbol": "JPM", "price": 1.0, "industry": "Major Banks", "country": "United States"}]
        표 = 만들기("US", 기초, [])
        assert 표.고를값들()["industry"] == ["대형 은행", "반도체"]
        for 값 in ("Semiconductors", "반도체"):
            assert [r["symbol"] for r in 표.결과({"industry": {"eq": 값}}, "", "price", True, 0, 9)[0]] == ["NVDA"]


# ── 서비스 — 돌아가며 받기 ─────────────────────────────────────────

def test_미국_1년_시세는_야후_줄이_RSI_를_주는_종목은_건너뛰고_시가총액_큰_것부터(monkeypatch):
    물음: list = []
    monkeypatch.setattr(sources, "미국_시세흐름", lambda 심볼들: 물음.append(list(심볼들)) or {
        s: {"rsi": 50.0, "at": time.time()} for s in 심볼들})
    monkeypatch.setattr(S, "시세_한번", 2)
    기초 = [{"symbol": s, "price": 1.0, "market_cap": m} for s, m in (("AAA", 4.0), ("BBB", 3.0), ("CCC", 2.0), ("DDD", 1.0))]
    S._표["US"] = 만들기("US", 기초, [{"symbol": "AAA", "rsi": 60.0}])
    try:
        값 = S._돌아가며_받기("us_px")
        assert 물음 == [["BBB", "CCC"]] and set(값["rows"]) == {"BBB", "CCC"}
        S._넣기("us_px", 값, time.time())
        S._돌아가며_받기("us_px")
        assert 물음[-1] == ["DDD"], "받은 것은 건너뛰고 다음 차례"
    finally:
        S.비우기()


def test_돌아가며_받기는_못_받은_종목도_받은_때를_남겨_차례가_멈추지_않는다(monkeypatch):
    """원천이 모르는 종목(네이버·야후에 없는 종목)이 늘 '오래된 것' 으로 남으면 차례마다 맨 앞에 다시 뽑힌다 —
    그런 종목이 한 번에 묻는 수만큼 쌓이면 다른 종목은 다시는 안 받는다"""
    물음: list = []
    없는것 = {"AAA", "BBB"}
    monkeypatch.setattr(sources, "미국_시세흐름", lambda 심볼들: 물음.append(list(심볼들)) or {
        s: {"rsi": 50.0, "at": time.time()} for s in 심볼들 if s not in 없는것})
    monkeypatch.setattr(S, "시세_한번", 3)
    기초 = [{"symbol": s, "price": 1.0, "market_cap": m} for s, m in (("AAA", 5.0), ("BBB", 4.0), ("CCC", 3.0),
                                                                     ("DDD", 2.0), ("EEE", 1.0))]
    S._표["US"] = 만들기("US", 기초, [])
    전에받은것 = {"AAA": {"rsi": 10.0, "at": 1.0}}
    S._넣기("us_px", {"at": 1.0, "rows": 전에받은것}, 1.0)
    try:
        값 = S._돌아가며_받기("us_px")
        assert 물음 == [["AAA", "BBB", "CCC"]]
        assert 값["rows"]["AAA"]["rsi"] == 10.0 and 값["rows"]["AAA"]["at"] > 1.0, "있던 값은 두고 받은 때만 새로"
        S._넣기("us_px", 값, time.time())
        S._돌아가며_받기("us_px")
        assert 물음[-1] == ["DDD", "EEE"], "못 받은 종목에 차례가 막혔다"
    finally:
        S.비우기()


def test_국내_1년_시세는_코스피_코스닥만_야후_종목으로_묻고_코드로_돌려받는다(monkeypatch):
    from app.services.market import price_fetcher as P
    물음: list = []

    async def 종가(심볼들, 기간="1y"):
        물음.append(sorted(심볼들))
        return {s: [100.0 + i for i in range(260)] for s in 심볼들 if s != "000660.KS"}
    monkeypatch.setattr(P, "fetch_yf_closes", 종가)
    받음 = sources.국내_시세흐름({"005930": "KOSPI", "247540": "KOSDAQ", "000660": "KOSPI", "123456": "KONEX"})
    assert 물음 == [["000660.KS", "005930.KS", "247540.KQ"]]
    assert set(받음) == {"005930", "247540"} and 받음["005930"]["return_1y"] == round((359 / 107 - 1) * 100, 2)
    assert sources.국내_시세흐름({"123456": "KONEX"}) == {} and len(물음) == 1, "물을 것이 없으면 묻지 않는다"


def test_국내_1년_시세_돌아가며_받기는_코넥스와_야후_줄이_있는_종목을_건너뛴다(monkeypatch):
    물음: list = []
    monkeypatch.setattr(sources, "국내_시세흐름", lambda 거래소: 물음.append(dict(거래소)) or {
        c: {"rsi": 50.0, "at": time.time()} for c in 거래소})
    기초 = [{"symbol": c, "price": 1.0, "market_cap": m, "exchange": x}
            for c, m, x in (("005930", 4.0, "KOSPI"), ("111110", 3.0, "KONEX"), ("247540", 2.0, "KOSDAQ"),
                            ("000660", 1.0, "KOSPI"))]
    S._표["KR"] = 만들기("KR", 기초, [{"symbol": "005930", "rsi": 61.0}])
    try:
        값 = S._돌아가며_받기("kr_px")
        assert 물음 == [{"247540": "KOSDAQ", "000660": "KOSPI"}], "야후 줄이 RSI 를 주는 종목·코넥스는 묻지 않는다"
        assert set(값["rows"]) == {"247540", "000660"}
        S._넣기("kr_px", 값, time.time())
        assert S._돌아가며_받기("kr_px") is None and len(물음) == 1, "물을 종목이 없으면 원천을 부르지도 않는다"
    finally:
        S.비우기()


def test_미국_1년_시세로_RSI_가_찬_종목도_하루가_지나면_다시_받는다(monkeypatch):
    """표의 RSI 가 제가(us_px) 받아 넣은 것이면 야후 줄이 준 것이 아니다 — 건너뛰면 그 종목은 다시는 안 받는다"""
    물음: list = []
    monkeypatch.setattr(sources, "미국_시세흐름", lambda 심볼들: 물음.append(list(심볼들)) or {
        s: {"rsi": 50.0, "at": time.time()} for s in 심볼들})
    오래전 = time.time() - S.시세_수명 - 60
    받았던 = {"BBB": {"rsi": 40.0, "at": 오래전}}
    S._넣기("us_px", {"at": 오래전, "rows": 받았던}, 오래전)
    기초 = [{"symbol": "AAA", "price": 1.0, "market_cap": 2.0}, {"symbol": "BBB", "price": 1.0, "market_cap": 1.0}]
    S._표["US"] = 만들기("US", 기초, [{"symbol": "AAA", "rsi": 60.0}], {"us_px": 원천표("us_px", 받았던)})
    try:
        assert S._표["US"].df.loc["BBB", "rsi"] == 40.0
        S._돌아가며_받기("us_px")
        assert 물음 == [["BBB"]]
    finally:
        S.비우기()


# ── 퀀트 — 품질·성장 점수가 비던 것(사용자: "품질, 성장점수가 안나오는 종목이 있어") ─────────

def _미국표():
    # 매출 96→120(25%), 순이익 10→12(20%), 영업이익 12→18(50%) — 성장률이 서로 달라야 칸이 섞여도 안다
    sec = 원천표("us_sec", {"QZQ": {"revenue": 120.0, "earnings": 12.0, "earnings_prev": 10.0, "op_income": 18.0,
                                    "op_income_prev": 12.0, "equity": 60.0, "liabilities": 30.0, "eps": 2.0,
                                    "fin_years": [2024, 2025], "rev_hist": [96, 120], "eps_hist": [1.5, 2.0]}})
    # 시가총액 240 = 시세 40 × 6주, 순이익 12 ÷ 6주 = EPS 2 — 셋이 서로 맞아야 표가 장부 EPS 를 믿는다(_시세주_EPS)
    return 만들기("US", [{"symbol": "QZQ", "price": 40.0, "market_cap": 240.0, "sector": "Technology"}], [],
                {"us_sec": sec})


def test_표의_한_줄에_전년_대비_성장률이_든다():
    줄 = _미국표().한줄("QZQ")
    assert (줄["_rev_yoy"], 줄["_ni_yoy"], 줄["_op_yoy"]) == (25.0, 20.0, 50.0)
    assert 줄["roe"] == 20.0 and 줄["per"] == 20.0
    assert _미국표().한줄("없음") is None
    결과 = _미국표().결과({}, "", "price", True, 0, 1)[0][0]
    assert not any(k.startswith("_") for k in 결과), "안쪽 칸을 화면에 보냈다"


def test_국내_성장률은_DART_의_당기_전기():
    dart = 원천표("kr_dart", {"005930": {"revenue": 300.0, "net_income": 30.0, "net_income_prev": 20.0,
                                         "op_income": 40.0, "op_income_prev": 50.0,
                                         "rev_years": [2023, 2024, 2025], "rev_hist": [200.0, 250.0, 300.0]}})
    줄 = 만들기("KR", [{"symbol": "005930", "price": 1.0, "market_cap": 3000.0}], [], {"kr_dart": dart}).한줄("005930")
    assert (줄["_rev_yoy"], 줄["_ni_yoy"], 줄["_op_yoy"]) == (20.0, 50.0, -20.0)


def test_적자에서_흑자로는_전년_대비를_적자의_크기로_나눈다():
    """(12 − (−10)) ÷ |−10| = +220% — 그냥 나누면 −220% 가 되어 좋아진 회사가 나빠진 것으로 보인다"""
    import numpy as np
    from app.services.screening.table import _전년대비
    v = _전년대비(np.array([12.0, -5.0, 3.0]), np.array([-10.0, -10.0, 0.0]))
    assert v[0] == 220.0 and v[1] == 50.0 and np.isnan(v[2])
    assert _전년대비(None, np.array([1.0])) is None


def test_DART_영업이익_순이익은_전기_값도():
    from app.services.fundamentals.dart_service import 주요계정_읽기
    줄들 = [{"stock_code": "005930", "fs_div": "CFS", "account_nm": "영업이익", "thstrm_amount": "30",
             "frmtrm_amount": "25"},
            {"stock_code": "005930", "fs_div": "CFS", "account_nm": "당기순이익", "thstrm_amount": "20",
             "frmtrm_amount": "-"},
            {"stock_code": "000660", "fs_div": "CFS", "account_nm": "당기순이익", "thstrm_amount": "8",
             "frmtrm_amount": "-4", "bfefrmtrm_amount": "3"}]
    읽음 = 주요계정_읽기(줄들)
    assert 읽음["005930"] == {"op_income": 30.0, "op_income_prev": 25.0, "net_income": 20.0}
    assert 읽음["000660"] == {"net_income": 8.0, "net_income_prev": -4.0}, "전기(frmtrm) — 전전기가 아니다"


def _퀀트_원천(monkeypatch, 펀더=None, 재무=None):
    from app.services.fundamentals import fundamentals_service as FS
    from app.services.market.yf_service import yf_service

    async def 펀더받기(symbol, market, 기다림=None):
        return dict(펀더 or {})

    async def 재무받기(symbol, market, 기다림=None):
        return dict(재무 or {})
    monkeypatch.setattr(FS, "get_fundamentals", 펀더받기)
    monkeypatch.setattr(FS, "get_financials", 재무받기)
    monkeypatch.setattr(yf_service, "get_ohlcv", lambda *a, **k: [{"close": 100.0 + i} for i in range(300)])


def test_퀀트는_펀더멘털_재무제표가_비면_스크리닝_표로_품질_성장_가치를_채운다(monkeypatch):
    import asyncio
    from app.services.quant import quant_score as QS
    _퀀트_원천(monkeypatch)
    S._표["US"] = _미국표()
    try:
        m = asyncio.run(QS.collect_quant_metrics("QZQ", "US"))
    finally:
        S.비우기()
    assert (m["roe"], m["op_margin"], m["net_margin"], m["debt_ratio"]) == (20.0, 15.0, 10.0, 50.0)
    assert (m["revenue_growth"], m["net_income_growth"], m["op_income_growth"]) == (25.0, 20.0, 50.0)
    assert m["per"] == 20.0 and m["_sector"] == "기술" and m["mom_3m"] is not None
    assert not QS.지표가_반쪽인가(m, "US")
    점수 = {f["key"]: f["score"] for f in QS.compute_quant_score(m)["factors"]}
    assert 점수["quality"] is not None and 점수["growth"] is not None


def test_퀀트는_있는_값을_표로_덮지_않고_시세는_채우지_않는다(monkeypatch):
    import asyncio
    from app.services.quant import quant_score as QS
    _퀀트_원천(monkeypatch, 펀더={"per": 9.0, "roe": 33.0, "sector": "IT"})
    from app.services.market.yf_service import yf_service
    monkeypatch.setattr(yf_service, "get_ohlcv", lambda *a, **k: [])
    S._표["US"] = _미국표()
    try:
        m = asyncio.run(QS.collect_quant_metrics("QZQ", "US"))
    finally:
        S.비우기()
    assert m["per"] == 9.0 and m["roe"] == 33.0 and m["_sector"] == "IT"
    assert m["revenue_growth"] == 25.0
    assert not any(k.startswith("mom_") for k in m), "시세가 빈 것은 표로 메우지 않는다(곧 다시 받아야 한다)"
    assert QS.지표가_반쪽인가(m, "US")


def test_표가_아직_없으면_퀀트를_붙잡지_않고_뒤에서_만들게_맡긴다(monkeypatch):
    맡김: list = []
    monkeypatch.setattr(S, "_뒤에서_새로", lambda 시장: 맡김.append(시장))
    S.비우기()
    monkeypatch.setattr(S, "원천_받기", False)
    assert S.한종목("US", "QZQ") is None and 맡김 == [], "검사에서는 맡기지도 않는다"
    monkeypatch.setattr(S, "원천_받기", True)
    assert S.한종목("KR", "005930.KS") is None and 맡김 == ["KR"]
    assert S.한종목("CRYPTO", "BTC") is None and 맡김 == ["KR"]
    S._표["KR"] = 만들기("KR", [{"symbol": "005930", "price": 1.0}], [])
    try:
        assert S.한종목("KR", "005930.KS")["symbol"] == "005930", "꼬리(.KS)를 떼고 찾는다"
    finally:
        S.비우기()


# ── 관심종목 PC 표가 붙이는 지표 ─────────────────────────────────────

def test_관심종목_표는_스크리닝_표의_줄에서_몇_칸만_받는다(monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app
    S._표["US"] = _미국표()
    try:
        c = TestClient(app)
        r = c.post("/api/v1/screening/rows", json={"items": [{"symbol": "QZQ", "market": "US"},
                                                             {"symbol": "NONE", "market": "US"},
                                                             {"symbol": "005930", "market": "KR"}]})
        assert r.status_code == 200, r.text
        rows = r.json()["rows"]
        assert set(rows) == {"US:QZQ"}, "표에 없는 종목·아직 없는 시장의 표는 빠진다"
        assert rows["US:QZQ"]["per"] == 20.0 and rows["US:QZQ"]["market_cap"] == 240
        assert "revenue" not in rows["US:QZQ"] and "_rev_yoy" not in rows["US:QZQ"]
        assert c.post("/api/v1/screening/rows", json={"items": [{"symbol": "A;B", "market": "US"}]}).status_code == 422
        assert c.post("/api/v1/screening/rows", json={"items": [{"symbol": "BTC", "market": "CRYPTO"}]}).status_code == 422
        assert c.post("/api/v1/screening/rows", json={"items": [{"symbol": "A", "market": "US"}] * 201}).status_code == 422
    finally:
        S.비우기()


def test_관심종목_표_아직_없는_시장이면_짓는중이라_알린다(monkeypatch):
    """서버가 막 뜨면 표가 없어 줄이 빈다 — building 을 참으로 알려야 화면이 몇 초 뒤 다시 묻는다
    (예전엔 그 빈 답을 5분 동안 써서 칸이 '—' 였다). 표가 있는 시장에 없는 종목은 짓는 중이 아니다(영영 없다)"""
    from fastapi.testclient import TestClient
    from app.main import app
    맡김: list = []
    monkeypatch.setattr(S, "_뒤에서_새로", lambda 시장: 맡김.append(시장))
    monkeypatch.setattr(S, "원천_받기", True)
    S.비우기()
    S._표["US"] = _미국표()
    try:
        c = TestClient(app)
        r = c.post("/api/v1/screening/rows", json={"items": [{"symbol": "QZQ", "market": "US"},
                                                             {"symbol": "NONE", "market": "US"}]}).json()
        assert r["building"] is False and set(r["rows"]) == {"US:QZQ"}
        r = c.post("/api/v1/screening/rows", json={"items": [{"symbol": "QZQ", "market": "US"},
                                                             {"symbol": "005930", "market": "KR"}]}).json()
        assert r["building"] is True and set(r["rows"]) == {"US:QZQ"}
        assert 맡김 == ["KR"], "없는 시장의 표는 뒤에서 짓게 맡긴다"
        assert c.post("/api/v1/screening/rows", json={"items": []}).json() == {"rows": {}, "building": False}
    finally:
        S.비우기()


def test_관심종목_표_찾는_사이_표가_다_지어져도_짓는중이라_알린다(monkeypatch):
    """찾기 전에 표가 없었으면 building — 찾은 뒤에 보면 그 사이 다 지어진 표를 보고 '없는 종목' 으로 끝낸다
    (그 답은 5분 동안 쓰인다)"""
    from fastapi.testclient import TestClient
    from app.main import app
    S.비우기()

    def 찾는사이_다지음(시장, 종목):
        S._표[시장] = _미국표()
        return None

    monkeypatch.setattr(S, "한종목", 찾는사이_다지음)
    try:
        r = TestClient(app).post("/api/v1/screening/rows", json={"items": [{"symbol": "QZQ", "market": "US"}]}).json()
        assert r == {"rows": {}, "building": True}
    finally:
        S.비우기()
