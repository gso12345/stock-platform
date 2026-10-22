"""스크리닝 — 상장된 모든 종목을 한 표로.

사용자:
  1. 시가총액이 안나옴
  2. PER 예상 Per, 순이익, 매출, 배당 수익률, 영업이익률 등등 … 많은 지표들이 안나와
  3. 국내주식은 회사명이아닌 코드가 나와
  4. 국내 해외모두 한글로된 회사명이 나오도록 해줘
  5. 상장된 모든 종목을 대상으로 해줘

까닭 — 스크리닝 한 줄을 종목마다 야후 상세(info)로 채웠는데, 운영 서버에서는 야후 상세가 막혀 가격만
남았고(ranking_service 주석: v7/quote 도 막혀 spark 로만), 6시간마다 그 빈 줄이 멀쩡하던 줄을 덮었다.
대상도 정해 둔 545종목뿐이었다.

여기서 보는 것:
  ① 원천을 읽는 법 — KRX(지표·업종·기간 수익률), SEC(미국 재무), 네이버(해외 한글 이름), DART(국내 재무),
     나스닥(업종·산업·국가). 응답 표본은 pykrx 1.0.45 문서·기존 파서·공개 형식에 맞춘 것이다
     (검사 환경은 바깥에 못 나가 실제 응답을 받아 볼 수 없다)
  ② 표 — 기초 ∪ 야후 줄, 어느 값이 이기나, 지금 가격으로 다시 나누기, 거르기·세우기·쪽·찾기, 메모리
  ③ 서비스 — 기초 줄 만들기(한글 이름·주식만), 표 들고 있기, 원천을 언제 받나
  ④ 라우트 — 쪽 넘기기, 한글 이름, 받는 중 알림
"""
import json
import time
from datetime import date

import httpx
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.core.cache import cache
from app.main import app
from app.services.screening import service as S
from app.services.screening import sources, store
from app.services.screening.table import 만들기, 원천표


class 응답:
    def __init__(self, j, 상태=200):
        self._j, self.status_code = j, 상태
        self.text = json.dumps(j, ensure_ascii=False)

    def json(self):
        return self._j

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("가짜", request=httpx.Request("GET", "http://x"),
                                        response=httpx.Response(self.status_code))


# ── ① 원천을 읽는 법 ────────────────────────────────────────────

def _krx_줄(code, **칸):
    기본 = {"ISU_SRT_CD": code, "ISU_ABBRV": f"회사{code}", "TDD_CLSPRC": "10,000", "EPS": "1,000", "PER": "10.00",
            "BPS": "20,000", "PBR": "0.50", "DPS": "300", "DVD_YLD": "3.00"}
    return {**기본, **칸}


class 가짜KRX:
    """bld 마다 답을 정해 둔다. 물은 것(data)은 물음에 남긴다"""

    def __init__(self, 답: dict, 물음: list):
        self.답, self.물음 = 답, 물음

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def get(self, url, **kw):
        return 응답({"result": {"output": [{"max_work_dt": "20261020"}]}})

    def post(self, url, data=None, **kw):
        self.물음.append(dict(data))
        답 = self.답.get(data["bld"])
        답 = 답(data) if callable(답) else 답
        if 답 is None:
            return 응답({}, 500)
        return 응답(답)


def _수많은(n=600):
    return [_krx_줄(f"{100000 + i:06d}") for i in range(n)]


class Test_KRX:
    def _준비(self, monkeypatch, 답):
        from app.services.listings import krx_listing as K
        물음: list = []
        monkeypatch.setattr(K.httpx, "Client", lambda **kw: 가짜KRX(답, 물음))
        return K, 물음

    def test_지표는_모름을_0이_아니라_비움으로_읽는다(self, monkeypatch):
        K, 물음 = self._준비(monkeypatch, {})
        줄들 = K.fetch_valuation(가짜KRX({K._BLD_지표: {"output": [
            _krx_줄("005930", EPS="4,950", PER="14.14", BPS="52,002", PBR="1.35", DPS="1,444", DVD_YLD="2.06"),
            _krx_줄("247540", EPS="-", PER="-", DPS="0", DVD_YLD="0.00"),
            _krx_줄("00680K"), _krx_줄(""), _krx_줄("12345678"), _krx_줄("660"),
        ]}}, 물음), "20261020")
        assert 줄들["005930"] == {"eps": 4950.0, "per": 14.14, "bps": 52002.0, "pbr": 1.35, "dps": 1444.0,
                                 "dividend_yield": 2.06}
        assert 줄들["247540"]["per"] is None and 줄들["247540"]["eps"] is None, "적자 회사의 '-' 는 0 이 아니다"
        assert 줄들["247540"]["dividend_yield"] == 0.0, "무배당은 0 이다"
        assert "00680K" in 줄들, "우선주처럼 영문이 섞인 코드도 받는다"
        assert set(줄들) == {"005930", "247540", "00680K", "000660"}, "앞의 0 이 빠져 온 코드도 6자리로 맞춘다"
        assert 물음[0]["bld"] == "dbms/MDC/STAT/standard/MDCSTAT03501" and 물음[0]["mktId"] == "ALL"

    def test_업종은_코스피와_코스닥을_합친다(self, monkeypatch):
        K, 물음 = self._준비(monkeypatch, {})
        답 = {K._BLD_업종: lambda d: {"block1": [
            {"ISU_SRT_CD": "005930" if d["mktId"] == "STK" else "247540",
             "IDX_IND_NM": "전기전자" if d["mktId"] == "STK" else "화학"}]}}
        assert K.fetch_sectors(가짜KRX(답, 물음), "20261020") == {"005930": "전기전자", "247540": "화학"}
        assert [q["mktId"] for q in 물음] == ["STK", "KSQ"]

    def test_달전은_그_달에_없는_날이면_마지막_날(self):
        from app.services.listings.krx_listing import _달전
        assert _달전("20260331", 1) == date(2026, 2, 28)
        assert _달전("20261020", 12) == date(2025, 10, 20)
        assert _달전("20260115", 3) == date(2025, 10, 15)

    def test_기간_수익률은_시작일이_휴일이면_하루씩_앞당긴다(self, monkeypatch):
        K, 물음 = self._준비(monkeypatch, {})
        답 = {K._BLD_등락: lambda d: ({"OutBlock_1": [
            {"ISU_SRT_CD": f"{100000 + i:06d}", "FLUC_RT": "12.50"} for i in range(600)]}
            if d["strtDd"] == "20260917" else {"OutBlock_1": []})}
        # 2026-09-20 은 일요일 — 토요일은 묻지 않고, 18일(금, 비어 있다고 치자) 다음 17일(목)
        값들 = K._기간등락(가짜KRX(답, 물음), "20261020", 1)
        assert 값들["100000"] == 12.5
        assert [q["strtDd"] for q in 물음] == ["20260918", "20260917"]
        assert all(q["adjStkPrc"] == 2 and q["endDd"] == "20261020" for q in 물음), "수정주가로, 끝일은 기준일"

    def test_한번에_지표_업종_수익률을_합친다(self, monkeypatch):
        from app.services.listings import krx_listing as K
        답 = {K._BLD_지표: {"output": _수많은() + [_krx_줄("005930", EPS="5,000")]},
              K._BLD_업종: lambda d: {"block1": [{"ISU_SRT_CD": "005930", "IDX_IND_NM": "전기전자"}]
                                    if d["mktId"] == "STK" else []},
              K._BLD_등락: {"OutBlock_1": [{"ISU_SRT_CD": f"{100000 + i:06d}", "FLUC_RT": "1.0"} for i in range(600)]
                                         + [{"ISU_SRT_CD": "005930", "FLUC_RT": "-3.5"}]}}
        K, _ = self._준비(monkeypatch, 답)
        줄들, 기준일 = K.fetch_screening_bulk()
        assert 기준일 == "20261020"
        assert 줄들["005930"]["eps"] == 5000.0 and 줄들["005930"]["sector"] == "전기전자"
        assert 줄들["005930"]["return_1m"] == -3.5 and 줄들["005930"]["return_1y"] == -3.5
        assert "per" in 줄들["100000"] and "sector" not in 줄들["100000"]

    def test_지난해들_같은_날의_EPS_로_4년_흐름(self, monkeypatch):
        """그날 KRX 지표의 EPS 는 그때의 직전 사업연도 것 — 3·2·1년 전 같은 날(휴일이면 앞당겨)을 묻는다"""
        from app.services.listings import krx_listing as K
        # 기준일 2026-10-20(화). 2년 전 같은 날은 일요일이라 18일(금). 1년 전 같은 날(월)은 빈 표가
        # 왔다고 치자(임시 휴장) — 17일(금)로 앞당긴다
        EPS = {"20261020": "5,000", "20251017": "4,000", "20241018": "-", "20231020": "2,000"}

        def 지표(d):
            if d["trdDd"] not in EPS:
                return {"output": []}
            새종목 = [_krx_줄("999999")] if d["trdDd"] == "20261020" else []
            return {"output": _수많은() + [_krx_줄("005930", EPS=EPS[d["trdDd"]])] + 새종목}
        답 = {K._BLD_지표: 지표, K._BLD_업종: None, K._BLD_등락: None}
        K, 물음 = self._준비(monkeypatch, 답)
        줄들, _ = K.fetch_screening_bulk()
        assert 줄들["005930"]["eps_years"] == [2022, 2024, 2025], "적자('-')인 해는 빈다"
        assert 줄들["005930"]["eps_hist"] == [2000.0, 4000.0, 5000.0]
        assert 줄들["100000"]["eps_years"] == [2022, 2023, 2024, 2025]
        assert "eps_years" not in 줄들["999999"], "올해 것 하나뿐이면 흐름이 아니다"
        물은날 = [q["trdDd"] for q in 물음 if q["bld"] == K._BLD_지표]
        assert "20241020" not in 물은날 and "20241019" not in 물은날, "주말은 묻지 않는다"
        assert K.사업연도("20260331") == 2024 and K.사업연도("20260401") == 2025

    def test_지표를_못_받으면_빈손이고_업종이_막혀도_지표는_쓴다(self, monkeypatch):
        from app.services.listings import krx_listing as K
        K, _ = self._준비(monkeypatch, {K._BLD_지표: None})
        assert K.fetch_screening_bulk() == ({}, "")
        K, _ = self._준비(monkeypatch, {K._BLD_지표: {"output": _수많은()}, K._BLD_업종: None, K._BLD_등락: None})
        줄들, 기준일 = K.fetch_screening_bulk()
        assert len(줄들) == 600 and 기준일


class 가짜웹:
    """주소(앞부분)마다 답을 정해 둔다"""

    def __init__(self, 답: dict, 물음: list):
        self.답, self.물음 = 답, 물음

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def get(self, url, params=None, **kw):
        self.물음.append((url, dict(params or {})))
        for 앞, 답 in self.답.items():
            if 앞 in url:
                답 = 답(url, params or {}) if callable(답) else 답
                return 답 if isinstance(답, 응답) else 응답(답)
        return 응답({}, 404)


class Test_SEC:
    def test_티커표는_한_회사의_여러_종목을_묶고_점은_붙임표로(self):
        from app.services.fundamentals.sec_frames import 티커표_읽기
        표 = 티커표_읽기({"0": {"cik_str": 1652044, "ticker": "GOOGL", "title": "Alphabet"},
                         "1": {"cik_str": 1652044, "ticker": "GOOG", "title": "Alphabet"},
                         "2": {"cik_str": 1067983, "ticker": "BRK.B", "title": "Berkshire"},
                         "3": {"cik_str": "x", "ticker": "BAD"}})
        assert 표 == {1652044: ["GOOGL", "GOOG"], 1067983: ["BRK-B"]}

    def test_틀은_회사마다_값_하나(self):
        from app.services.fundamentals.sec_frames import 틀_읽기
        assert 틀_읽기({"data": [{"cik": 1, "val": 10}, {"cik": 2, "val": "x"}, {"cik": 1, "val": 12}]}) == {1: 12.0}
        assert 틀_읽기(None) == {} and 틀_읽기({"data": None}) == {}

    def _준비(self, monkeypatch, 해_매출수: dict):
        from app.services.fundamentals import sec_frames as F
        monkeypatch.setattr(F, "_간격", 0)
        # 뒤 개념(RevenueFromContract…)이 늘 두 곳(1·3)을 주니 세 곳은 모여야 그해로 친다
        monkeypatch.setattr(F, "최소회사수", 3)
        monkeypatch.setattr(F, "최소티커수", 2)
        물음: list = []

        def 틀(url, params):
            # .../frames/us-gaap/{개념}/{단위}/{기간}.json
            개념, 단위, 기간 = url.rsplit("/", 3)[1:]
            기간 = 기간.removesuffix(".json")
            해 = int(기간[2:6])
            if 개념 == "Revenues":
                return {"data": [{"cik": c, "val": 100.0 * c} for c in range(1, 해_매출수.get(해, 0) + 1)]}
            if 개념 == "RevenueFromContractWithCustomerExcludingAssessedTax":
                return {"data": [{"cik": 1, "val": 999.0}, {"cik": 3, "val": 300.0}]}
            if 개념 == "NetIncomeLoss":
                return {"data": [{"cik": 1, "val": 20.0}]}
            if 개념 == "OperatingIncomeLoss":
                return {"data": [{"cik": 1, "val": float(해 - 1994)}]}     # 2024 30 → 2025 31
            if 개념 == "EarningsPerShareDiluted":
                return {"data": [{"cik": 1, "val": float(해 - 2020)}]}
            if 개념 == "EarningsPerShareBasic":
                return {"data": [{"cik": 1, "val": 99.0}] + ([{"cik": 3, "val": float(해 - 2023)}] if 해 >= 2024 else [])}
            if 개념 == "StockholdersEquity":
                assert 기간.endswith("Q4I"), "자본은 그해 말의 값"
                return {"data": [{"cik": 1, "val": 400.0}]}
            return 응답({}, 404)

        답 = {"company_tickers.json": {"0": {"cik_str": 1, "ticker": "AAA"}, "1": {"cik_str": 1, "ticker": "AAB"},
                                       "2": {"cik_str": 3, "ticker": "CCC"}, "3": {"cik_str": 2, "ticker": "BBB"}},
              "/frames/": 틀}
        monkeypatch.setattr(F.httpx, "Client", lambda **kw: 가짜웹(답, 물음))
        return F, 물음

    def test_앞_개념이_이기고_한_회사의_여러_종목에_같은_값(self, monkeypatch):
        F, _ = self._준비(monkeypatch, {2025: 2})
        줄들, 해 = F.fetch_fundamentals(2025)
        assert 해 == 2025

        def 재무(t):
            return {k: v for k, v in 줄들[t].items()
                    if k not in ("fin_years", "rev_hist", "eps_hist") and not k.endswith("_prev")}
        assert 재무("AAA") == 재무("AAB") == {"revenue": 100.0, "earnings": 20.0, "equity": 400.0, "eps": 5.0,
                                             "op_income": 31.0}, \
            "Revenues 가 있으면 그것 — 뒤 개념(999)이 덮지 않는다. EPS 는 희석(5)이 기본(99)보다 먼저"
        assert 재무("CCC") == {"revenue": 300.0, "eps": 2.0}, "Revenues 가 없는 회사는 뒤 개념으로"
        assert 줄들["AAA"]["earnings_prev"] == 20.0 and "earnings_prev" not in 줄들["CCC"], "순이익은 지난해 값도(퀀트 성장)"
        assert 줄들["AAA"]["op_income_prev"] == 30.0, "영업이익도 지난해 값 — 그해(31)가 아니라 한 해 앞"

    def test_매출_EPS_는_앞의_세_해도_받아_4년_흐름으로(self, monkeypatch):
        F, 물음 = self._준비(monkeypatch, {2025: 2, 2024: 1, 2023: 1, 2022: 1})
        줄들, _ = F.fetch_fundamentals(2025)
        a = 줄들["AAA"]
        assert a["fin_years"] == [2022, 2023, 2024, 2025]
        assert a["rev_hist"] == [100, 100, 100, 100], "해마다 앞 개념(Revenues)이 이긴다"
        assert a["eps_hist"] == [2.0, 3.0, 4.0, 5.0]
        # CCC 는 매출이 네 해 모두 뒤 개념(300)으로 있고, EPS 는 2024 년부터
        assert 줄들["CCC"]["rev_hist"] == [300] * 4 and 줄들["CCC"]["eps_hist"] == [None, None, 1.0, 2.0]
        # BBB 는 2025 년 매출만 — 앞쪽의 빈 해는 뺀다
        assert 줄들["BBB"]["fin_years"] == [2025] and 줄들["BBB"]["rev_hist"] == [200]
        assert any("EarningsPerShareDiluted/USD-per-shares/CY2022" in u for u, _ in 물음)

    def test_그해_공시가_덜_모였으면_한_해_앞(self, monkeypatch):
        F, 물음 = self._준비(monkeypatch, {2025: 1, 2024: 3})
        줄들, 해 = F.fetch_fundamentals(2025)
        assert 해 == 2024 and 줄들["AAA"]["revenue"] == 100.0
        assert any("CY2024" in u for u, _ in 물음)

    def test_매출이_너무_적으면_빈손(self, monkeypatch):
        F, _ = self._준비(monkeypatch, {})
        assert F.fetch_fundamentals(2025) == ({}, 0)

    def test_받을해는_지난해(self):
        from app.services.fundamentals.sec_frames import 받을해
        assert 받을해(date(2026, 10, 21)) == 2025


class Test_네이버_한글이름:
    def test_목록이_어디에_있든_한글_이름만(self):
        from app.services.listings.naver_world import 쪽_읽기
        쪽 = {"result": {"stocks": [
            {"stockName": "엔비디아", "symbolCode": "NVDA", "reutersCode": "NVDA.O"},
            {"stockName": "버크셔 해서웨이 B", "symbolCode": "BRK.B"},
            {"stockName": "Some Corp", "symbolCode": "SOME"},
            {"stockName": "애플", "reutersCode": "AAPL.O"},
            {"stockName": "이상한", "symbolCode": "이상"},
        ]}, "totalCount": 5}
        assert 쪽_읽기(쪽) == {"NVDA": "엔비디아", "BRK-B": "버크셔 해서웨이 B", "AAPL": "애플"}
        assert 쪽_읽기([]) == {} and 쪽_읽기({"x": 1}) == {}

    def test_쪽을_넘기다_같은_쪽이_오면_멈추고_모자라면_빈손(self, monkeypatch):
        from app.services.listings import naver_world as N
        monkeypatch.setattr(N, "최소이름수", 3)
        monkeypatch.setattr(N.time, "sleep", lambda s: None)
        물음: list = []

        def 쪽(url, params):
            if "NASDAQ" in url:
                return {"stocks": [{"stockName": f"나스닥{params['page']}", "symbolCode": f"N{params['page']}"}]
                        if params["page"] <= 2 else []}
            return {"stocks": [{"stockName": "뉴욕", "symbolCode": "NY"}]}          # 쪽을 넘겨도 같은 쪽
        monkeypatch.setattr(N.httpx, "Client", lambda **kw: 가짜웹({"marketValue": 쪽}, 물음))
        assert N.fetch_names() == {"N1": "나스닥1", "N2": "나스닥2", "NY": "뉴욕"}
        assert sum(1 for u, _ in 물음 if "NYSE" in u) == 2, "같은 쪽이 오면 다음 쪽을 더 묻지 않는다"
        monkeypatch.setattr(N, "최소이름수", 10)
        assert N.fetch_names() == {}, "모자라면 못 받은 것으로 친다 — 지난 것을 쓰게"


def test_DART_주요계정은_연결을_먼저_쓰고_이름이_조금_달라도_읽는다():
    from app.services.fundamentals.dart_service import 주요계정_읽기
    줄들 = [
        {"stock_code": "005930", "fs_div": "OFS", "account_nm": "매출액", "thstrm_amount": "100"},
        {"stock_code": "005930", "fs_div": "CFS", "account_nm": "매출액", "thstrm_amount": "300,000"},
        {"stock_code": "005930", "fs_div": "CFS", "account_nm": "당기순이익(손실)", "thstrm_amount": "30,000"},
        {"stock_code": "005930", "fs_div": "CFS", "account_nm": "법인세차감전 순이익", "thstrm_amount": "40,000"},
        {"stock_code": "005930", "fs_div": "CFS", "account_nm": "자본총계", "thstrm_amount": "-"},
        {"stock_code": "000660", "fs_div": "OFS", "account_nm": "수익(매출액)", "thstrm_amount": "50"},
        {"stock_code": "000660", "fs_div": "OFS", "account_nm": "영업이익", "thstrm_amount": "-5"},
        {"stock_code": "12", "fs_div": "OFS", "account_nm": "매출액", "thstrm_amount": "1"},
    ]
    assert 주요계정_읽기(줄들) == {"005930": {"revenue": 300000.0, "net_income": 30000.0},
                               "000660": {"revenue": 50.0, "op_income": -5.0}}


def test_DART_매출은_사업보고서의_전기_전전기까지_흐름으로():
    from app.services.fundamentals.dart_service import 주요계정_읽기
    줄들 = [
        {"stock_code": "005930", "fs_div": "CFS", "account_nm": "매출액", "bsns_year": "2025",
         "thstrm_amount": "300", "frmtrm_amount": "280", "bfefrmtrm_amount": "-"},
        {"stock_code": "005930", "fs_div": "OFS", "account_nm": "매출액", "bsns_year": "2025",
         "thstrm_amount": "100", "frmtrm_amount": "90", "bfefrmtrm_amount": "80"},
        {"stock_code": "000660", "fs_div": "OFS", "account_nm": "매출액", "thstrm_amount": "50"},
    ]
    r = 주요계정_읽기(줄들)
    assert r["005930"]["rev_years"] == [2023, 2024, 2025]
    assert r["005930"]["rev_hist"] == [None, 280.0, 300.0], "연결의 흐름 — 별도(80·90)와 섞지 않는다"
    assert r["000660"] == {"revenue": 50.0}, "사업연도를 모르면 흐름은 없다"


class Test_나스닥_분류:
    def test_업종_산업_국가를_따로_읽는다(self):
        from app.services.market.ranking_service import 나스닥_분류_읽기
        j = {"data": {"rows": [
            {"symbol": "NVDA", "sector": "Technology", "industry": "Semiconductors", "country": "United States"},
            {"symbol": "BRK/B", "sector": "Finance", "industry": "Insurance", "country": "United States"},
            {"symbol": "XYZ", "sector": "", "industry": "", "country": ""},
        ]}}
        assert 나스닥_분류_읽기(j) == {"NVDA": ("Technology", "Semiconductors", "United States"),
                                     "BRK-B": ("Finance", "Insurance", "United States")}

    def test_받은_분류는_DB_에_남겨_서버가_깨도_쓴다(self, monkeypatch):
        from app.services.market import ranking_service as R
        from app.db.database import Base, engine
        Base.metadata.create_all(engine)
        R._분류_db({"NVDA": ("Technology", "Semiconductors", "United States")})
        monkeypatch.setattr(R, "_나스닥_분류", {})
        monkeypatch.setattr(R, "_나스닥_분류_읽음", False)
        assert R.나스닥_분류()["NVDA"] == ("Technology", "Semiconductors", "United States")


# ── ② 표 ─────────────────────────────────────────────────────

def _국내기초(**더):
    return [{"symbol": "005930", "name": "삼성전자", "market": "KR", "exchange": "KOSPI", "price": 70000.0,
             "change_rate": 1.0, "volume": 1000, "market_cap": 4.0e14, "currency": "KRW", "country": "대한민국",
             **더},
            {"symbol": "247540", "name": "에코프로비엠", "market": "KR", "exchange": "KOSDAQ", "price": 150000.0,
             "market_cap": 1.4e13, "currency": "KRW", "country": "대한민국"}]


def _국내원천():
    krx = pd.DataFrame({"eps": [5000.0, -100.0], "bps": [50000.0, 30000.0], "dps": [1400.0, 0.0],
                        "per": [13.9, None], "sector": ["전기전자", "화학"], "return_1y": [10.0, -20.0]},
                       index=["005930", "247540"])
    네이버 = pd.DataFrame({"forward_eps": [7000.0], "forward_per": [9.9], "high_52w": [80000.0],
                         "low_52w": [50000.0]}, index=["005930"])
    dart = pd.DataFrame({"revenue": [300.0], "op_income": [30.0], "net_income": [20.0], "assets": [1000.0],
                         "liabilities": [200.0], "equity": [800.0]}, index=["005930"])
    return {"kr_krx": krx, "kr_naver": 네이버, "kr_dart": dart}


class Test표_국내:
    def test_이름은_한글_업종은_KRX_가격은_야후_줄이_먼저(self):
        풍부 = [{"symbol": "005930", "name": "Samsung Electronics", "market": "KR", "price": 71000.0,
                 "sector": "Technology", "rsi": 55.0}]
        표 = 만들기("KR", _국내기초(), 풍부, _국내원천())
        삼성 = {r["symbol"]: r for r in 표.결과({}, "", "market_cap", True, 0, 10)[0]}["005930"]
        assert 삼성["name"] == "삼성전자", "국내는 코드가 아니라 한글 이름"
        assert 삼성["name_en"] == "Samsung Electronics", "영문은 찾기에 쓴다"
        assert 삼성["sector"] == "전기전자", "KRX 업종이 야후('Technology')보다 먼저"
        assert 삼성["price"] == 71000.0 and 삼성["rsi"] == 55.0
        assert 삼성["exchange"] == "KOSPI" and 삼성["market_cap"] == 400000000000000

    def test_야후_이름이_종목_코드면_영문_이름이_아니다(self):
        """야후 상세가 막히면 이름 자리에 종목 코드가 온다"""
        풍부 = [{"symbol": "005930", "name": "005930", "price": 71000.0}]
        삼성 = {r["symbol"]: r for r in 만들기("KR", _국내기초(), 풍부, _국내원천()).결과({}, "", "price", True, 0, 9)[0]}
        assert "name_en" not in 삼성["005930"] and 삼성["005930"]["name"] == "삼성전자"

    def test_원천의_비율은_지금_가격으로_다시_나눈다(self):
        r = {x["symbol"]: x for x in 만들기("KR", _국내기초(), [], _국내원천()).결과({}, "", "price", True, 0, 9)[0]}
        삼성, 에코 = r["005930"], r["247540"]
        assert 삼성["per"] == 14.0, "70,000 ÷ EPS 5,000 — KRX 가 받은 날 낸 13.9 가 아니라"
        assert 삼성["pbr"] == 1.4 and 삼성["dividend_yield"] == 2.0 and 삼성["dividend_rate"] == 1400.0
        assert 삼성["forward_per"] == 10.0 and 삼성["forward_eps_growth"] == 40.0, "예상 EPS 7,000"
        assert 삼성["pct_from_52w_high"] == -12.5 and 삼성["pct_from_52w_low"] == 40.0
        assert 삼성["return_1y"] == 10.0
        assert "per" not in 에코, "적자(EPS −100) 회사는 PER 모름 — 'PER 낮은 순' 맨 앞에 안 깔린다"
        assert 에코["dividend_yield"] == 0.0, "무배당은 0"
        assert 에코["sector"] == "화학"

    def test_DART_로_매출_순이익_이익률_ROE_부채비율(self):
        r = {x["symbol"]: x for x in 만들기("KR", _국내기초(), [], _국내원천()).결과({}, "", "price", True, 0, 9)[0]}
        삼성 = r["005930"]
        assert (삼성["revenue"], 삼성["earnings"]) == (300.0, 20.0)
        assert (삼성["operating_margin"], 삼성["profit_margin"]) == (10.0, 6.67)
        assert (삼성["roe"], 삼성["roa"], 삼성["debt_ratio"]) == (2.5, 2.0, 25.0)
        assert 삼성["ps_ratio"] == round(4.0e14 / 300.0, 2)

    def test_KRX_업종이_있으면_야후_업종을_섞지_않는다(self):
        """KRX('전기전자')와 야후('기술')는 업종 갈래가 달라, 섞으면 고르기 목록이 두 갈래로 갈린다"""
        풍부 = [{"symbol": "000660", "name": "SK hynix", "market": "KR", "price": 200000.0, "sector": "Technology"}]
        표 = 만들기("KR", _국내기초(), 풍부, _국내원천())
        assert 표.고를값들()["sector"] == ["전기전자", "화학"]
        하닉 = {x["symbol"]: x for x in 표.결과({}, "", "price", True, 0, 9)[0]}["000660"]
        assert "sector" not in 하닉
        # KRX 업종을 못 받았으면 야후 것이라도
        원천 = _국내원천()
        원천["kr_krx"] = 원천["kr_krx"].drop(columns=["sector"])
        표 = 만들기("KR", _국내기초(), 풍부, 원천)
        assert 표.고를값들()["sector"] == ["기술"]

    def test_부채비율은_원천이_야후_줄보다_먼저(self):
        """야후 debtToEquity 는 '차입금 ÷ 자본' 이라 부채총계 ÷ 자본총계(국내 부채비율)와 다르다"""
        풍부 = [{"symbol": "005930", "debt_ratio": 7.0, "roe": 99.0}]
        삼성 = {x["symbol"]: x for x in 만들기("KR", _국내기초(), 풍부, _국내원천()).결과({}, "", "price", True, 0, 9)[0]}
        assert 삼성["005930"]["debt_ratio"] == 25.0 and 삼성["005930"]["roe"] == 99.0


class Test표_미국:
    def _표(self, 풍부=()):
        기초 = [{"symbol": "NVDA", "name": "엔비디아", "name_en": "NVIDIA Corp", "market": "US", "exchange": "NASDAQ",
                 "price": 100.0, "market_cap": 2.0e12, "currency": "USD", "sector": "Technology",
                 "industry": "Semiconductors", "country": "United States"},
                {"symbol": "XOM", "name": "Exxon Mobil", "market": "US", "exchange": "NYSE", "price": 50.0,
                 "market_cap": 4.0e11, "currency": "USD", "sector": "Energy"}]
        sec = pd.DataFrame({"revenue": [1.0e11, 3.0e11], "earnings": [5.0e10, 3.0e10], "op_income": [6.0e10, None],
                            "eps": [2.0, -1.0], "dps": [0.04, None], "equity": [1.0e11, 2.0e11],
                            "liabilities": [5.0e10, 1.0e11], "ocf": [7.0e10, None], "capex": [1.0e10, None]},
                           index=["NVDA", "XOM"])
        return 만들기("US", 기초, list(풍부), {"us_sec": sec})

    def test_SEC_로_PER_PBR_이익률_FCF_배당(self):
        r = {x["symbol"]: x for x in self._표().결과({}, "", "price", True, 0, 9)[0]}
        nv = r["NVDA"]
        assert (nv["per"], nv["pbr"], nv["ps_ratio"]) == (50.0, 20.0, 20.0)
        assert (nv["roe"], nv["operating_margin"], nv["profit_margin"], nv["debt_ratio"]) == (50.0, 60.0, 50.0, 50.0)
        assert nv["fcf"] == 6.0e10 and nv["dividend_yield"] == 0.04 and nv["eps"] == 2.0
        assert nv["sector"] == "기술" and nv["country"] == "미국" and nv["industry"] == "반도체", "산업도 한국어로"
        xom = r["XOM"]
        assert "per" not in xom, "적자면 PER 모름"
        assert "dividend_yield" not in xom, "주당배당 공시가 없으면 0 이 아니라 모름"
        assert "fcf" not in xom and xom["sector"] == "에너지"

    def test_야후_줄이_있으면_그것이_먼저(self):
        r = {x["symbol"]: x for x in self._표([{"symbol": "NVDA", "per": 33.0, "revenue": 1.2e11}])
             .결과({}, "", "price", True, 0, 9)[0]}
        assert r["NVDA"]["per"] == 33.0 and r["NVDA"]["revenue"] == 1.2e11
        assert r["NVDA"]["pbr"] == 20.0, "야후 줄에 없는 칸은 원천에서"

    @pytest.mark.parametrize("q, 남을것", [("nvidia", ["NVDA"]), ("엔비", ["NVDA"]), ("xom, nvda", ["NVDA", "XOM"]),
                                         ("exxonmobil", ["XOM"]), ("없는", [])])
    def test_티커_한글_영문으로_찾는다(self, q, 남을것):
        결과, 수 = self._표().결과({}, q, "market_cap", True, 0, 9)
        assert sorted(r["symbol"] for r in 결과) == 남을것 and 수 == len(남을것)

    def test_고를값에_거래소도_있고_영문으로_저장한_보기도_맞는다(self):
        표 = self._표()
        assert 표.고를값들()["exchange"] == ["NASDAQ", "NYSE"]
        assert 표.고를값들()["sector"] == ["기술", "에너지"]
        assert [r["symbol"] for r in 표.결과({"sector": {"eq": "Technology"}}, "", "price", True, 0, 9)[0]] == ["NVDA"]
        assert [r["symbol"] for r in 표.결과({"exchange": {"eq": "NYSE"}}, "", "price", True, 0, 9)[0]] == ["XOM"]


    def test_나스닥과_야후의_업종은_같은_이름으로_모은다(self):
        """나스닥 'Finance' 와 야후 'Financial Services' 가 '금융' 과 '금융서비스' 로 따로 서면
        '금융' 을 골랐을 때 야후 쪽 종목이 빠진다"""
        기초 = [{"symbol": "JPM", "price": 1.0, "market_cap": 4.0, "sector": "Finance"},
                {"symbol": "VZ", "price": 1.0, "market_cap": 3.0, "sector": "Telecommunications"}]
        풍부 = [{"symbol": "BAC", "price": 1.0, "market_cap": 2.0, "sector": "Financial Services"},
                {"symbol": "T", "price": 1.0, "market_cap": 1.0, "sector": "Communication Services"}]
        표 = 만들기("US", 기초, 풍부)
        assert 표.고를값들()["sector"] == ["금융", "통신서비스"]
        for 값 in ("금융", "Finance", "Financial Services"):
            assert [r["symbol"] for r in 표.결과({"sector": {"eq": 값}}, "", "market_cap", True, 0, 9)[0]] \
                == ["JPM", "BAC"], 값
        assert [r["symbol"] for r in 표.결과({"sector": {"eq": "통신서비스"}}, "", "market_cap", True, 0, 9)[0]] \
            == ["VZ", "T"]


class Test표_흐름:
    """4년 막대(매출·EPS 흐름)·3년 성장률 — 처음 보이는 칸인데 야후(주요 500여 곳)에서만 와서
    전 종목 표에서는 대부분 비어 있었다"""

    def test_미국은_야후_흐름이_없으면_SEC_네_해와_그_3년_성장률(self):
        기초 = [{"symbol": "AAA", "price": 10.0, "market_cap": 100.0},
                {"symbol": "BBB", "price": 10.0, "market_cap": 50.0},
                {"symbol": "CCC", "price": 10.0, "market_cap": 10.0}]
        sec = 원천표("us_sec", {
            "AAA": {"revenue": 160.0, "fin_years": [2022, 2023, 2024, 2025], "rev_hist": [20, 40, 80, 160],
                    "eps_hist": [0.25, 0.5, 1.0, 2.0]},
            "BBB": {"revenue": 50.0, "fin_years": [2022, 2023, 2024, 2025], "rev_hist": [10, 20, 40, 50],
                    "eps_hist": [1.0, 1.0, 1.0, 1.0]},
            "CCC": {"revenue": 5.0}})
        풍부 = [{"symbol": "BBB", "fin_years": [2023, 2024, 2025], "rev_hist": [1, 2, 3], "eps_hist": [0.1, 0.2, 0.3],
                 "fin_currency": "TWD"}]
        r = {x["symbol"]: x for x in 만들기("US", 기초, 풍부, {"us_sec": sec}).결과({}, "", "market_cap", True, 0, 9)[0]}
        a = r["AAA"]
        assert a["fin_years"] == [2022, 2023, 2024, 2025] and a["rev_hist"] == [20, 40, 80, 160]
        assert a["eps_hist"] == [0.25, 0.5, 1.0, 2.0]
        assert a["rev_cagr_3y"] == 100.0 and a["eps_cagr_3y"] == 100.0, "20 → 160 은 해마다 두 배"
        assert a["fin_currency"] == "USD"
        b = r["BBB"]
        assert b["fin_years"] == [2023, 2024, 2025] and b["rev_hist"] == [1, 2, 3], "야후 흐름이 있으면 그 한 벌"
        assert "rev_cagr_3y" not in b and b["fin_currency"] == "TWD", "SEC 의 성장률·돈을 야후 막대에 섞지 않는다"
        assert "fin_years" not in r["CCC"] and "fin_currency" not in r["CCC"]

    def test_3년_전이나_끝해가_0_이하면_성장률은_모른다(self):
        기초 = [{"symbol": s, "price": 1.0} for s in ("AAA", "BBB", "CCC")]
        sec = 원천표("us_sec", {
            "CCC": {"revenue": 80.0, "fin_years": [2022, 2023, 2024, 2025], "rev_hist": [10, 20, 40, 80],
                    "eps_hist": [-1.0, -2.0, -4.0, -8.0]},
            "AAA": {"revenue": 80.0, "fin_years": [2022, 2023, 2024, 2025], "rev_hist": [-10, 20, 40, 80],
                    "eps_hist": [0.0, 0.5, 1.0, 2.0]},
            "BBB": {"revenue": 80.0, "fin_years": [2022, 2023, 2024, 2025], "rev_hist": [10, 20, 40, -80],
                    "eps_hist": [1.0, 0.5, 1.0, 8.0]}})
        r = {x["symbol"]: x for x in 만들기("US", 기초, [], {"us_sec": sec}).결과({}, "", "price", True, 0, 9)[0]}
        assert "rev_cagr_3y" not in r["AAA"] and "eps_cagr_3y" not in r["AAA"], "적자·0 에서의 성장률은 뜻이 없다"
        assert "rev_cagr_3y" not in r["BBB"] and r["BBB"]["eps_cagr_3y"] == 100.0
        assert r["CCC"]["rev_cagr_3y"] == 100.0 and "eps_cagr_3y" not in r["CCC"], "적자가 −1 → −8 로 커진 것은 성장이 아니다"

    def test_국내는_DART_매출과_KRX_EPS_를_해로_맞춘다(self):
        기초 = [{"symbol": "005930", "name": "삼성전자", "price": 70000.0, "market_cap": 4e14}]
        dart = 원천표("kr_dart", {"005930": {"revenue": 300.0, "rev_years": [2023, 2024, 2025],
                                              "rev_hist": [None, 280.0, 300.0]}})
        krx = 원천표("kr_krx", {"005930": {"eps": 5000.0, "eps_years": [2022, 2024, 2025],
                                           "eps_hist": [2000.0, 4000.0, 5000.0]}})
        삼성 = 만들기("KR", 기초, [], {"kr_dart": dart, "kr_krx": krx}).결과({}, "", "price", True, 0, 9)[0][0]
        assert 삼성["fin_years"] == [2022, 2023, 2024, 2025]
        assert 삼성["rev_hist"] == [None, None, 280, 300] and 삼성["eps_hist"] == [2000.0, None, 4000.0, 5000.0]
        assert 삼성["eps_cagr_3y"] == round(((5000 / 2000) ** (1 / 3) - 1) * 100, 1)
        assert "rev_cagr_3y" not in 삼성, "3년 전 매출을 모르면 성장률도 모른다"
        assert 삼성["fin_currency"] == "KRW"

    def test_흐름은_종목마다_값이_있는_마지막_해에서_거슬러_네_해(self):
        krx = 원천표("kr_krx", {"A": {"eps": 5.0, "eps_years": [2019, 2021, 2022, 2023, 2025],
                                      "eps_hist": [1.0, 2.0, 3.0, 4.0, 5.0]},
                                "B": {"eps": 2.0, "eps_years": [2021, 2022], "eps_hist": [1.0, 2.0]},
                                "C": {"eps": 1.0}})
        assert "eps_years" not in krx.columns and "eps_hist" not in krx.columns, "목록은 해마다 숫자 칸으로 편다"
        기초 = [{"symbol": s, "price": 1.0, "market_cap": m} for s, m in (("A", 3.0), ("B", 2.0), ("C", 1.0))]
        r = {x["symbol"]: x for x in 만들기("KR", 기초, [], {"kr_krx": krx}).결과({}, "", "price", True, 0, 9)[0]}
        assert (r["A"]["fin_years"], r["A"]["eps_hist"]) == ([2022, 2023, 2024, 2025], [3.0, 4.0, None, 5.0])
        assert r["A"]["rev_hist"] == [None] * 4
        assert (r["B"]["fin_years"], r["B"]["eps_hist"]) == ([2021, 2022], [1.0, 2.0]), "B 는 2022 년에서 끝난다"
        assert "fin_years" not in r["C"] and not any(k.startswith("_") for k in r["A"]), "안쪽 칸은 내보내지 않는다"
        assert 만들기("ETF", 기초, [], {"kr_krx": krx}).결과({}, "", "price", True, 0, 1)[0][0].get("fin_years") is None


class Test표_공통:
    def test_기초와_야후_줄의_합집합이고_기본은_시가총액_순(self):
        표 = 만들기("US", [{"symbol": "AAA", "price": 1.0, "market_cap": 10.0}],
                  [{"symbol": "BBB", "price": 2.0, "market_cap": 20.0}, {"symbol": "CCC", "price": 3.0}])
        assert len(표) == 3 and 표.기초수 == 1
        assert list(표.df.index) == ["BBB", "AAA", "CCC"], "시가총액 모르는 것은 맨 뒤"

    def test_쪽을_넘겨도_전체_수는_같고_겹치지_않는다(self):
        줄들 = [{"symbol": f"S{i:03d}", "price": 1.0, "market_cap": float(1000 - i)} for i in range(250)]
        표 = 만들기("US", 줄들, [])
        첫, 수1 = 표.결과({}, "", "market_cap", True, 0, 100)
        둘, 수2 = 표.결과({}, "", "market_cap", True, 100, 100)
        셋, _ = 표.결과({}, "", "market_cap", True, 200, 100)
        assert 수1 == 수2 == 250 and len(셋) == 50
        assert [r["symbol"] for r in 첫][:2] == ["S000", "S001"] and 둘[0]["symbol"] == "S100"
        assert not {r["symbol"] for r in 첫} & {r["symbol"] for r in 둘}
        assert 표.결과({}, "", "market_cap", True, 300, 100) == ([], 250)

    def test_모르는_칸으로_거르면_아무도_못_지난다(self):
        표 = 만들기("US", [{"symbol": "AAA", "price": 1.0}], [])
        assert 표.결과({"per": {"max": 10}}, "", "price", True, 0, 9) == ([], 0)

    def test_비었으면_빈_표(self):
        표 = 만들기("KR", [], [])
        assert len(표) == 0 and 표.결과({}, "", "per", True, 0, 9) == ([], 0)
        assert 표.고를값들() == {"country": [], "sector": [], "industry": [], "exchange": []}

    def test_1만_줄이어도_표는_작다(self):
        """종목마다 dict 로 들면 1만 줄에 25~50MB 였다(512MB 서버)"""
        업종 = ["Technology", "Energy", "Finance", "Health Care"]
        기초 = [{"symbol": f"S{i:05d}", "name": f"회사 {i}", "name_en": f"Company {i} Inc", "market": "US",
                 "exchange": "NASDAQ" if i % 2 else "NYSE", "sector": 업종[i % 4], "industry": f"산업 {i % 150}",
                 "country": "United States", "price": 10.0 + i, "change_rate": 0.5, "volume": 1000 + i,
                 "market_cap": 1e9 + i, "currency": "USD"} for i in range(10000)]
        sec = pd.DataFrame({k: [1e9] * 10000 for k in ("revenue", "earnings", "op_income", "equity", "liabilities",
                                                        "ocf", "capex", "eps", "dps")},
                           index=[f"S{i:05d}" for i in range(10000)])
        표 = 만들기("US", 기초, [], {"us_sec": sec})
        assert 표.df.memory_usage(deep=True).sum() < 12e6
        시작 = time.perf_counter()
        결과, 수 = 표.결과({"per": {"max": 1e6}, "sector": {"eq": "기술"}}, "회사", "revenue", True, 100, 100)
        assert 수 == 2500 and len(결과) == 100 and time.perf_counter() - 시작 < 0.5


# ── ③ 서비스 ──────────────────────────────────────────────────

class Test기초줄:
    def test_국내는_코드에서_꼬리를_떼고_거래소를_단다(self, monkeypatch):
        from app.services.market import ranking_service as R
        monkeypatch.setattr(R, "_build_all_kr_rows", lambda: [
            {"symbol": "005930.KS", "name": "삼성전자", "market": "KOSPI", "price": 70000, "change_rate": 1.0,
             "volume": 10, "market_cap": 4e14},
            {"symbol": "247540.KQ", "name": "에코프로비엠", "market": "KOSDAQ", "price": 0, "market_cap": 1e13}])
        줄들 = S.기초줄("KR")
        assert [(r["symbol"], r["name"], r["exchange"]) for r in 줄들] == [("005930", "삼성전자", "KOSPI")], \
            "가격 모르는 종목은 뺀다"

    def test_미국은_주식만_한글_이름_나스닥_분류(self, monkeypatch):
        from app.services.market import ranking_service as R
        from app.services.listings import ticker_service as T
        cache.set(R.US_ROWS_CK, [
            {"symbol": "NVDA", "name": "NVIDIA", "price": 100.0, "market_cap": 2e12},
            {"symbol": "ZZZZ", "name": "Tiny Co", "price": 1.0, "market_cap": 1e6},
            {"symbol": "SPY", "name": "SPDR", "price": 500.0},
            {"symbol": "^GSPC", "name": "S&P 500", "price": 5000.0},
            {"symbol": "DEMO", "name": "Demo", "price": 1.0, "_demo": True},
            {"symbol": "TINY", "name": "TINY", "price": 2.0},
        ], 60)
        monkeypatch.setattr(T, "_us_db", [{"s": "NVDA", "n": "NVIDIA Corporation", "x": "NASDAQ", "m": "US"},
                                          {"s": "SPY", "n": "SPDR S&P 500", "x": "NYSE ARCA", "m": "ETF"},
                                          {"s": "DEMO", "n": "Demo", "x": "NYSE", "m": "US"},
                                          {"s": "TINY", "n": "Tiny Inc", "x": "NYSE", "m": "US"}])
        monkeypatch.setattr(R, "나스닥_분류", lambda: {"NVDA": ("Technology", "Semiconductors", "United States"),
                                                   "ZZZZ": ("Finance", "", "")})
        S._원천["us_ko"] = {"ZZZZ": "지지지"}
        try:
            줄들 = {r["symbol"]: r for r in S.기초줄("US")}
        finally:
            cache.delete(R.US_ROWS_CK)
        assert set(줄들) == {"NVDA", "ZZZZ", "TINY"}, "ETF·지수·가짜 시세는 뺀다"
        assert 줄들["NVDA"]["name"] == "엔비디아", "네이버 이름이 없으면 코드에 적어 둔 한글 이름"
        assert 줄들["NVDA"]["name_en"] == "NVIDIA" and 줄들["NVDA"]["exchange"] == "NASDAQ"
        assert (줄들["NVDA"]["sector"], 줄들["NVDA"]["industry"]) == ("Technology", "Semiconductors")
        assert 줄들["ZZZZ"]["name"] == "지지지", "목록에 없어도 나스닥 주식 목록에 있으면 주식"
        assert 줄들["TINY"]["name"] == "Tiny Inc", "이름이 티커와 같으면 종목 목록의 이름"

    def test_못_만들면_빈_것(self, monkeypatch):
        from app.services.market import ranking_service as R

        def 터짐():
            raise RuntimeError("x")
        monkeypatch.setattr(R, "_build_all_kr_rows", 터짐)
        assert S.기초줄("KR") == [] and S.기초줄("ETF") == []


@pytest.fixture
def 가짜시장(monkeypatch):
    """종목별 야후 줄과 기초 줄을 마음대로 — 판(찍은 때)도 정한다"""
    상태 = {"풍부": [], "찍은때": 1.0, "기초": [], "기초부름": 0}

    def 풍부(시장):
        return list(상태["풍부"]), (상태["찍은때"], len(상태["풍부"]), S._원천판[0])

    def 기초(시장):
        상태["기초부름"] += 1
        return list(상태["기초"])
    monkeypatch.setattr(S, "_풍부", 풍부)
    monkeypatch.setattr(S, "기초줄", 기초)
    return 상태


def _기다리기(조건, 초=5.0):
    끝 = time.time() + 초
    while time.time() < 끝:
        if 조건():
            return True
        time.sleep(0.02)
    return False


class Test표_들고있기:
    def test_판이_같으면_같은_표(self, 가짜시장):
        가짜시장["기초"] = [{"symbol": "AAA", "price": 1.0}]
        첫 = S.표("US")
        assert S.표("US") is 첫 and 가짜시장["기초부름"] == 1

    def test_야후_줄이_새로_왔으면_있던_표로_답하고_뒤에서_새로(self, 가짜시장):
        """7천 줄을 합치는 데 0.15 CPU 로 몇 초 — 5분마다 그 자리에서 다시 만들면 그때 연 사람이 기다린다"""
        가짜시장["기초"] = [{"symbol": "AAA", "price": 1.0}]
        첫 = S.표("US")
        가짜시장["풍부"], 가짜시장["찍은때"] = [{"symbol": "AAA", "price": 2.0}], 2.0
        assert S.표("US") is 첫
        assert _기다리기(lambda: S._표["US"] is not 첫)
        assert S.표("US").결과({}, "", "price", True, 0, 1)[0][0]["price"] == 2.0

    def test_기초_줄_없이_만든_표는_일찍_다시_만든다(self, 가짜시장, monkeypatch):
        """서버가 막 떠 종목 목록을 아직 못 읽었을 때 만든 표 — 읽는 대로 전 종목 표로 바꿔야 한다"""
        가짜시장["풍부"] = [{"symbol": "AAA", "price": 1.0}]
        첫 = S.표("US")
        monkeypatch.setattr(S, "기초없는표_수명", -1)
        가짜시장["기초"] = [{"symbol": "AAA", "price": 1.0}, {"symbol": "BBB", "price": 2.0}]
        S.표("US")
        assert _기다리기(lambda: S._표["US"] is not 첫) and len(S._표["US"]) == 2

    def test_기초_줄_없이_만든_표는_야후_줄이_오는_대로_그_자리에서(self, 가짜시장):
        """ETF·종목 목록을 못 읽었을 때 — 몇백 줄이라 가볍고, 처음 받는 동안 받은 줄이 곧바로 보여야 한다"""
        가짜시장["풍부"] = [{"symbol": "AAA", "price": 1.0}]
        assert len(S.표("US")) == 1
        가짜시장["풍부"], 가짜시장["찍은때"] = [{"symbol": "AAA", "price": 1.0}, {"symbol": "BBB", "price": 2.0}], 2.0
        assert len(S.표("US")) == 2

    def test_오래됐으면_있던_표로_답하고_뒤에서_새로(self, 가짜시장, monkeypatch):
        가짜시장["기초"] = [{"symbol": "AAA", "price": 1.0}]
        첫 = S.표("US")
        monkeypatch.setattr(S, "표_수명", -1)
        가짜시장["기초"] = [{"symbol": "AAA", "price": 5.0}]
        assert S.표("US") is 첫, "기다리게 하지 않는다"
        assert _기다리기(lambda: S._표["US"] is not 첫)
        assert S._표["US"].결과({}, "", "price", True, 0, 1)[0][0]["price"] == 5.0


@pytest.fixture
def 원천켜기(monkeypatch):
    """바깥 원천 대신 가짜를 켠다. 받은 것은 검사용 DB 에 남으니 앞뒤로 지운다"""
    from app.db.database import Base, engine, SessionLocal
    from app.models.stock import ScreeningSnapshot
    Base.metadata.create_all(engine)
    열쇠들 = [v[0] for v in S.원천들.values()]

    def 지우기():
        db = SessionLocal()
        try:
            db.query(ScreeningSnapshot).filter(ScreeningSnapshot.market.in_(열쇠들)).delete(synchronize_session=False)
            db.commit()
        finally:
            db.close()
    지우기()
    S.비우기()
    monkeypatch.setattr(S, "원천_받기", True)
    부름: list = []
    가짜 = {
        "국내_KRX": lambda: 부름.append("krx") or {"at": time.time(), "ymd": "20261020",
                                                  "rows": {"AAA": {"eps": 2.0, "sector": "전기전자"}}},
        "국내_네이버": lambda 코드들: 부름.append(("naver", list(코드들))) or {
            c: {"forward_eps": 3.0, "at": time.time()} for c in 코드들},
        "국내_DART": lambda 코드들: 부름.append("dart") or None,
        # 새 원천도 가짜로 — 안 바꾸면 검사가 GitHub·야후에 실제로 나간다
        "국내_GitHub": lambda: 부름.append("git") or {"at": time.time(), "ymd": "20261020",
                                                    "rows": {"AAA": {"industry": "반도체 제조업", "return_1m": 7.0}}},
        "미국_시세흐름": lambda 심볼들: 부름.append(("px", list(심볼들))) or {
            s: {"rsi": 33.0, "high_52w": 20.0, "at": time.time()} for s in 심볼들},
        "국내_시세흐름": lambda 거래소: 부름.append(("krpx", sorted(거래소))) or {
            c: {"rsi": 44.0, "return_1y": 12.0, "at": time.time()} for c in 거래소},
        "미국_SEC": lambda: 부름.append("sec") or {"at": time.time(), "year": 2025, "rows": {"AAA": {
            "eps": 4.0, "fin_years": [2024, 2025], "rev_hist": [10, 20], "eps_hist": [3.0, 4.0]}}},
        "미국_한글이름": lambda: 부름.append("ko") or {"at": time.time(), "rows": {"AAA": "에이"}},
    }
    for 이름, f in 가짜.items():
        monkeypatch.setattr(sources, 이름, f)
    yield 부름
    S.비우기()
    지우기()


def _원천_끝까지():
    """원천 일꾼은 하나라 맡긴 차례대로 돈다 — 빈 일을 하나 더 맡겨 끝나길 기다린다"""
    S._원천일꾼.submit(lambda: None).result(timeout=10)


def _새_표(시장: str):
    """판이 바뀌었으면 뒤에서 새로 만든다 — 맡기고(한 번 묻고) 표 일꾼이 끝나길 기다린 뒤의 표"""
    S.표(시장)
    S._표일꾼.submit(lambda: None).result(timeout=10)
    return S.표(시장)


class Test원천:
    def test_묵은_원천을_뒤에서_받아_표에_넣고_DB_에도_남긴다(self, 가짜시장, 원천켜기):
        가짜시장["기초"] = [{"symbol": "AAA", "price": 10.0}]
        S.표("US")
        _원천_끝까지()
        assert "sec" in 원천켜기 and "ko" in 원천켜기
        새표 = _새_표("US")
        줄 = 새표.결과({}, "", "price", True, 0, 1)[0][0]
        assert 줄["per"] == 2.5, "원천이 오면 표를 새로 만든다"
        assert (줄["fin_years"], 줄["rev_hist"], 줄["eps_hist"]) == ([2024, 2025], [10, 20], [3.0, 4.0])
        assert store.읽기("US_SEC")[0]["rows"]["AAA"]["eps"] == 4.0
        S.비우기()
        S._원천_불러오기()
        assert S._원천["us_ko"] == {"AAA": "에이"}, "서버가 깨도 DB 에서 곧바로"
        assert S._원천["us_sec"].loc["AAA", "eps@2025"] == 4.0, "DB 에서 읽어도 흐름은 해마다 숫자 칸으로"

    def test_받은_지_얼마_안_됐으면_다시_안_받고_못_받았으면_잠깐_쉰다(self, 가짜시장, 원천켜기, monkeypatch):
        S.표("US")
        _원천_끝까지()
        원천켜기.clear()
        S.표("US")
        _원천_끝까지()
        assert 원천켜기 == [], "막 받은 것을 또 받았다"
        monkeypatch.setattr(sources, "미국_SEC", lambda: 원천켜기.append("sec") or None)
        S._원천때.pop("us_sec")
        S._시도때.pop("us_sec")
        S.표("US")
        _원천_끝까지()
        S.표("US")
        _원천_끝까지()
        assert 원천켜기.count("sec") == 1, "못 받은 원천을 곧바로 다시 두드렸다"

    def test_DART_키가_없으면_묻지_않는다(self, 가짜시장, 원천켜기, monkeypatch):
        from app.core.config import settings
        monkeypatch.setattr(settings, "DART_API_KEY", "")
        가짜시장["기초"] = [{"symbol": "AAA", "price": 1.0}]
        S.표("KR")
        _원천_끝까지()
        assert "dart" not in 원천켜기 and "krx" in 원천켜기

    def test_예상_PER_은_시가총액_큰_것부터_조금씩_받고_받은_것은_건너뛴다(self, 가짜시장, 원천켜기, monkeypatch):
        monkeypatch.setattr(S, "네이버_한번", 2)
        가짜시장["기초"] = [{"symbol": s, "price": 1.0, "market_cap": c}
                         for s, c in (("AAA", 1.0), ("BBB", 3.0), ("CCC", 2.0))]
        S.표("KR")
        _원천_끝까지()
        S._시도때.pop("kr_naver", None)
        S.표("KR")
        _원천_끝까지()
        S._시도때.pop("kr_naver", None)
        S.표("KR")
        _원천_끝까지()
        묻은것 = [x[1] for x in 원천켜기 if isinstance(x, tuple) and x[0] == "naver"]
        assert 묻은것[:2] == [["BBB", "CCC"], ["AAA"]]
        assert _새_표("KR").결과({}, "", "price", True, 0, 9)[0][0].get("forward_eps") == 3.0

    def test_첫_요청에도_국내_DART_와_예상_PER_은_표를_만든_뒤에_맡긴다(self, 가짜시장, 원천켜기, monkeypatch):
        """서버가 막 떠 표가 없을 때 먼저 맡기면 표의 종목으로 묻는 원천이 빈손으로 끝나고, 다음 차례
        (예상 PER 10분·DART 6시간)까지 쉰다 — 배포한 뒤 첫 6시간 동안 국내 매출이 비었다"""
        from app.core.config import settings
        monkeypatch.setattr(settings, "DART_API_KEY", "x")
        가짜시장["기초"] = [{"symbol": "AAA", "price": 1.0, "market_cap": 1.0}]
        느린기초 = S.기초줄
        monkeypatch.setattr(S, "기초줄", lambda m: (time.sleep(0.3), 느린기초(m))[1])
        S.표("KR")
        _원천_끝까지()
        assert ("naver", ["AAA"]) in 원천켜기 and "dart" in 원천켜기, 원천켜기

    def test_표가_없으면_표가_필요한_원천은_맡기지도_시도로_치지도_않는다(self, 원천켜기, monkeypatch):
        from app.core.config import settings
        monkeypatch.setattr(settings, "DART_API_KEY", "x")
        S._원천_챙기기("KR")
        _원천_끝까지()
        assert 원천켜기 == ["krx", "git"]
        assert "kr_naver" not in S._시도때 and "kr_dart" not in S._시도때 and "kr_px" not in S._시도때
        # 미국 1년 시세는 미국 표가 있어야 — 국내 표만 있어도 맡기지 않는다
        S._표["KR"] = 만들기("KR", [{"symbol": "AAA", "price": 1.0}], [])
        S._원천_챙기기("US")
        _원천_끝까지()
        assert not any(isinstance(x, tuple) and x[0] == "px" for x in 원천켜기) and "us_px" not in S._시도때

    def test_국내_GitHub_과_미국_1년_시세를_받아_표에_넣는다(self, 가짜시장, 원천켜기):
        가짜시장["기초"] = [{"symbol": "AAA", "price": 10.0, "market_cap": 1.0, "exchange": "KOSDAQ"}]
        S.표("KR")
        _원천_끝까지()
        국내 = _새_표("KR").결과({}, "", "price", True, 0, 1)[0][0]
        assert "git" in 원천켜기 and (국내["industry"], 국내["return_1m"]) == ("반도체 제조업", 7.0)
        assert ("krpx", ["AAA"]) in 원천켜기 and (국내["rsi"], 국내["return_1y"]) == (44.0, 12.0), "국내 1년 시세"
        S.표("US")
        _원천_끝까지()
        미국 = _새_표("US").결과({}, "", "price", True, 0, 1)[0][0]
        assert ("px", ["AAA"]) in 원천켜기 and (미국["rsi"], 미국["pct_from_52w_high"]) == (33.0, -50.0)

    def test_메모리가_빠듯하면_원천을_안_받는다(self, 가짜시장, 원천켜기, monkeypatch):
        from app.core import memory
        monkeypatch.setattr(memory, "has_headroom", lambda *a, **k: False)
        S.표("US")
        _원천_끝까지()
        assert 원천켜기 == []

    def test_돌아가며_받는_원천은_조금씩_쌓이니_DB_에는_가끔_남긴다(self, monkeypatch):
        """몇백 곳씩 몇 분마다 받는다 — 받을 때마다 수천 곳을 통째로 DB 에 쓰지 않는다"""
        남김: list = []
        monkeypatch.setattr(store, "남기기", lambda 열쇠, 값: 남김.append(열쇠) or True)
        S._쌓임["kr_naver"] = [S._남길수 - 1, time.time()]
        S._남기기("kr_naver", {"rows": {}})
        assert 남김 == []
        S._쌓임["kr_naver"][0] = S._남길수
        S._남기기("kr_naver", {"rows": {}})
        assert 남김 == ["KR_NAVER"] and S._쌓임["kr_naver"][0] == 0
        S._쌓임["us_px"] = [1, time.time()]
        S._남기기("us_px", {"rows": {}})
        assert 남김 == ["KR_NAVER"], "미국 1년 시세도 조금씩 쌓인다"
        S._쌓임["us_px"] = [1, time.time() - S._남길때 - 1]
        S._남기기("us_px", {"rows": {}})
        assert 남김 == ["KR_NAVER", "US_PX"], "적게 쌓였어도 오래됐으면 남긴다"
        S._남기기("us_sec", {"rows": {}})
        assert 남김[-1] == "US_SEC", "다른 원천은 받을 때마다"

    def test_원천을_검사에서는_안_받는다(self, 가짜시장, monkeypatch):
        부름: list = []
        monkeypatch.setattr(sources, "미국_SEC", lambda: 부름.append(1))
        monkeypatch.setattr(S, "원천_받기", False)
        S.표("US")
        _원천_끝까지()
        assert 부름 == []


def test_store_는_NaN_을_비워서_남긴다():
    from app.db.database import Base, engine
    Base.metadata.create_all(engine)
    assert store.남기기("US_KO", {"rows": {"A": float("nan"), "B": [1.0, float("inf")]}})
    try:
        assert store.읽기("US_KO")[0]["rows"] == {"A": None, "B": [1.0, None]}
    finally:
        from app.db.database import SessionLocal
        from app.models.stock import ScreeningSnapshot
        db = SessionLocal()
        db.query(ScreeningSnapshot).filter_by(market="US_KO").delete()
        db.commit()
        db.close()


def test_원천_함수는_못_받으면_관리자_화면에_실패를_남긴다(monkeypatch):
    from app.core import health
    from app.services.listings import krx_listing
    from app.services.fundamentals import sec_frames
    monkeypatch.setattr(krx_listing, "fetch_screening_bulk", lambda: ({}, ""))
    monkeypatch.setattr(sec_frames, "fetch_fundamentals", lambda: ({"AAA": {"eps": 1.0}}, 2025))
    assert sources.국내_KRX() is None
    assert sources.미국_SEC()["rows"] == {"AAA": {"eps": 1.0}}
    이름별 = {s["name"]: s for s in health.snapshot()}
    assert 이름별[sources.이름_KRX]["streak"] >= 1
    assert 이름별[sources.이름_SEC]["streak"] == 0 and 이름별[sources.이름_SEC]["ok"] >= 1


def test_네이버_종목_응답에서_스크리닝_칸만_담고_52주_고저는_이름을_바꾼다(monkeypatch):
    from app.services.market import price_fetcher

    async def 하나(cl, code):
        if code == "BAD":
            raise RuntimeError("막힘")
        return {"forward_per": 9.5, "forward_eps": 7000.0, "per": None, "price": 70000.0, "name": "삼성전자",
                "week52_high": 88000.0, "week52_low": 50000.0}
    monkeypatch.setattr(price_fetcher, "_fetch_naver_one", 하나)
    줄들 = sources.국내_네이버(["005930", "BAD"])
    assert set(줄들) == {"005930"}
    줄 = 줄들["005930"]
    assert 줄.pop("at") > 0
    assert 줄 == {"forward_per": 9.5, "forward_eps": 7000.0, "high_52w": 88000.0, "low_52w": 50000.0}


def test_DART_는_몇_곳뿐이면_못_받은_것으로_친다(monkeypatch):
    from app.core.config import settings
    from app.services.fundamentals.dart_service import dart_service
    monkeypatch.setattr(settings, "DART_API_KEY", "x")
    monkeypatch.setattr(dart_service, "get_main_accounts_multi",
                        lambda 코드들, 해: {f"{i:06d}": {"revenue": 1.0} for i in range(10)})
    assert sources.국내_DART(["000001"]) is None, "열 곳뿐인 것으로 지난 2천여 곳을 덮지 않는다"
    monkeypatch.setattr(dart_service, "get_main_accounts_multi",
                        lambda 코드들, 해: {f"{i:06d}": {"revenue": 1.0} for i in range(300)})
    assert len(sources.국내_DART(["000001"])["rows"]) == 300


def test_DART_매출_흐름은_지난해_보고서의_전전기까지_붙여_네_해로(monkeypatch):
    """3년 성장률은 네 해가 있어야 낸다 — 그해 보고서엔 세 해(전전기·전기·당기)뿐이다"""
    from app.core.config import settings
    from app.services.fundamentals.dart_service import dart_service
    monkeypatch.setattr(settings, "DART_API_KEY", "x")
    물음: list = []

    def 보고서(코드들, 해):
        물음.append((len(코드들), 해))
        if 해 == "2025":
            return {f"{i:06d}": {"revenue": 300.0, "rev_years": [2023, 2024, 2025], "rev_hist": [None, 280.0, 300.0]}
                    for i in range(300)}
        return {"000000": {"revenue": 270.0, "rev_years": [2022, 2023, 2024], "rev_hist": [200.0, 250.0, 275.0]}}
    monkeypatch.setattr(dart_service, "get_main_accounts_multi", 보고서)
    monkeypatch.setattr(sources, "DART_해", lambda 오늘=None: "2025")
    줄들 = sources.국내_DART(["000000"])["rows"]
    assert 줄들["000000"]["rev_years"] == [2022, 2023, 2024, 2025]
    assert 줄들["000000"]["rev_hist"] == [200.0, 250.0, 280.0, 300.0], "겹치는 해는 그해 보고서(고쳐 적은 값)"
    assert 줄들["000001"]["rev_years"] == [2024, 2025], "지난해 보고서가 없는 회사는 있는 해만"
    assert 물음 == [(1, "2025"), (300, "2024")], "지난해 보고서는 그해 받은 회사만 묻는다"


def test_DART_지난해_보고서가_막혀도_그해_것은_쓴다(monkeypatch):
    from app.core.config import settings
    from app.services.fundamentals.dart_service import dart_service
    monkeypatch.setattr(settings, "DART_API_KEY", "x")

    def 보고서(코드들, 해):
        if 해 != DART해:
            raise RuntimeError("막힘")
        return {f"{i:06d}": {"revenue": 1.0} for i in range(300)}
    DART해 = sources.DART_해()
    monkeypatch.setattr(dart_service, "get_main_accounts_multi", 보고서)
    assert len(sources.국내_DART(["000001"])["rows"]) == 300


def test_DART_해는_사업보고서가_다_나온_해():
    assert sources.DART_해(date(2026, 10, 21)) == "2025"
    assert sources.DART_해(date(2026, 2, 1)) == "2024"


# ── 야후 줄이 비어 와도 멀쩡하던 값을 안 지운다 ─────────────────────

def test_새로_받은_야후_줄에_빠진_칸은_지난_값으로(monkeypatch):
    from app.services.market import yf_service as 모듈
    from app.services.market.yf_service import yf_service
    monkeypatch.setattr(모듈, "스크리닝_종목들", lambda m: ["AAA", "005930.KS"])
    모듈.스크리닝_사진_비우기()
    monkeypatch.setattr(yf_service, "_screen_one", lambda s, m: {
        "symbol": s.split(".")[0], "name": "Apple" if s == "AAA" else "Samsung", "price": 1.0,
        "market_cap": 5e11, "per": 20.0})
    yf_service._스크리닝_전체_새로("US")
    # 운영 서버처럼 야후 상세가 막혔다 — 실제로 줄을 만드는 스크리닝줄 에 빈 info 와 1년 시세만 준다.
    # 이름은 종목 코드가 되고, 1년 시세로 못 내는 칸은 None 으로 열쇠째 온다
    시세 = pd.DataFrame({"Close": [1.0 + i / 100 for i in range(300)], "Volume": [1000] * 300},
                        index=pd.date_range("2025-10-01", periods=300, freq="D"))
    monkeypatch.setattr(yf_service, "_screen_one", lambda s, m: 모듈.스크리닝줄(s, m, {}, 시세))
    새 = {r["symbol"]: r for r in yf_service._스크리닝_전체_새로("US")}
    try:
        assert "per" in 모듈.스크리닝줄("AAA", "US", {}, 시세), "검사의 전제 — 빈 칸도 열쇠째 온다"
        assert 새["AAA"]["price"] == 3.99 and 새["AAA"]["rsi"] is not None, "새로 온 값은 새 값"
        assert 새["AAA"]["market_cap"] == 5e11 and 새["AAA"]["per"] == 20.0, "비어 온 칸이 지난 값을 지웠다"
        assert 새["AAA"]["name"] == "Apple" and 새["005930"]["name"] == "Samsung", "이름이 코드로 덮였다"
        # 상세가 온 줄은 그대로 — 적자로 돌아 PER 이 사라졌으면 사라진 대로
        monkeypatch.setattr(yf_service, "_screen_one", lambda s, m: {
            "symbol": s.split(".")[0], "name": "Apple Inc.", "price": 3.0, "market_cap": 6e11, "per": None})
        새 = {r["symbol"]: r for r in yf_service._스크리닝_전체_새로("US")}
        assert 새["AAA"]["name"] == "Apple Inc." and 새["AAA"]["market_cap"] == 6e11
        assert 새["AAA"].get("per") is None, "상세가 온 줄의 빈 PER 을 지난 값으로 덮었다"
    finally:
        모듈.스크리닝_사진_비우기()


# ── ④ 라우트 ──────────────────────────────────────────────────

class Test라우트:
    @pytest.fixture
    def 손님(self, 가짜시장):
        from app.api.routes import screening as R
        R.limiter._storage.reset()
        for 항목 in cache.keys_with_ttl():
            열쇠 = 항목.get("key") if isinstance(항목, dict) else 항목
            if isinstance(열쇠, str) and 열쇠.startswith("screening:"):
                cache.delete(열쇠)
        yield TestClient(app)
        R.limiter._storage.reset()

    def test_쪽을_넘긴다(self, 손님, 가짜시장):
        가짜시장["기초"] = [{"symbol": f"S{i:03d}", "name": f"회사{i}", "price": 1.0, "market_cap": float(500 - i)}
                         for i in range(250)]
        r = 손님.post("/api/v1/screening/run", json={"market": "US", "limit": 100, "offset": 100}).json()
        assert r["total"] == 250 and r["offset"] == 100 and len(r["results"]) == 100
        assert r["results"][0]["symbol"] == "S100"
        끝 = 손님.post("/api/v1/screening/run", json={"market": "US", "limit": 100, "offset": 200}).json()
        assert len(끝["results"]) == 50 and 끝["results"][0]["symbol"] == "S200"

    @pytest.mark.parametrize("앞", [-1, 50001, "a"])
    def test_쪽_자리가_이상하면_422(self, 손님, 앞):
        assert 손님.post("/api/v1/screening/run", json={"market": "US", "offset": 앞}).status_code == 422

    def test_국내는_한글_이름과_거래소_고르기(self, 손님, 가짜시장):
        가짜시장["기초"] = _국내기초()
        가짜시장["풍부"] = [{"symbol": "005930", "name": "Samsung Electronics", "price": 71000.0}]
        r = 손님.post("/api/v1/screening/run", json={"market": "KR"}).json()
        assert [x["name"] for x in r["results"]] == ["삼성전자", "에코프로비엠"]
        assert r["facets"]["exchange"] == ["KOSDAQ", "KOSPI"]
        r = 손님.post("/api/v1/screening/run", json={"market": "KR", "filters": {"exchange": {"eq": "KOSDAQ"}}}).json()
        assert [x["symbol"] for x in r["results"]] == ["247540"]

    def test_기초_줄이_있으면_야후_줄을_처음_받는_중이어도_받는_중이라고_안_알린다(self, 손님, 가짜시장, monkeypatch):
        from app.services.market.yf_service import yf_service
        monkeypatch.setattr(yf_service, "스크리닝_짓는중", lambda m: {"done": 3, "total": 545})
        가짜시장["기초"] = [{"symbol": "AAA", "price": 1.0}]
        r = 손님.post("/api/v1/screening/run", json={"market": "US"}).json()
        assert r["building"] is None and r["total"] == 1
        가짜시장["기초"] = []
        S.비우기()
        r = 손님.post("/api/v1/screening/run", json={"market": "US", "sort_by": "per"}).json()
        assert r["building"] == {"done": 3, "total": 545}, "표가 비었으면 그대로 알린다"

    def test_뒤에서_표를_새로_만드는_동안_옛_표로_낸_답은_남기지_않는다(self, 손님, 가짜시장, monkeypatch):
        """원천이 오면 표를 뒤에서 새로 만들고 그동안은 옛 표로 답한다 — 그 답을 1분 남기면 새 표가 1분 더 늦게
        보였다(원천이 오고 2분 뒤)"""
        가짜시장["기초"] = [{"symbol": "AAA", "price": 1.0}]
        묻기 = lambda: 손님.post("/api/v1/screening/run", json={"market": "US"}).json()["results"][0]["price"]
        assert 묻기() == 1.0
        가짜시장["기초"] = [{"symbol": "AAA", "price": 2.0}]
        맡김: list = []
        monkeypatch.setattr(S, "_뒤에서_새로", lambda 시장: (맡김.append(시장), S._새로만드는중.add(시장)))
        S._원천판[0] += 1                                 # 원천이 새로 왔다 — 판이 바뀐다
        assert 손님.post("/api/v1/screening/run", json={"market": "US", "sort_by": "per"}).json()["results"][0]["price"] == 1.0
        assert 맡김 == ["US"]
        # 뒤에서 새 표가 섰다
        S._표["US"], S._표판["US"] = 만들기("US", 가짜시장["기초"], []), S._풍부("US")[1]
        S._새로만드는중.discard("US")
        assert 손님.post("/api/v1/screening/run", json={"market": "US", "sort_by": "per"}).json()["results"][0]["price"] == 2.0, \
            "옛 표로 낸 답을 남겨 두었다"
        S._새로만드는중.add("US")
        try:
            assert not S.지금_표인가("US", S._표["US"]), "새로 만드는 중이면 지금 표도 곧 낡는다"
        finally:
            S._새로만드는중.discard("US")
        assert S.지금_표인가("US", S._표["US"]) and not S.지금_표인가("US", 만들기("US", [], []))
