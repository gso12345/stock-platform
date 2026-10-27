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
                    if k not in ("fin_years", "rev_hist", "eps_hist", "ni_hist") and not k.endswith("_prev")}
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
        assert a["ni_hist"] == [20, 20, 20, 20], "순이익도 해마다 — EPS 를 주식 종류별로만 적는 회사의 어림용"
        assert "ni_hist" not in 줄들["CCC"], "순이익이 한 해도 없으면 안 싣는다"
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

    def _해외준비(self, monkeypatch):
        """미국 회사 AAA(1)·BBB(2)·CCC(3)·ZZZ(9), IFRS 대만 달러 TSM(5), IFRS 달러 SHEL(6), 위안 미국 회계기준 BABA(7)"""
        from app.services.fundamentals import sec_frames as F
        monkeypatch.setattr(F, "_간격", 0)
        monkeypatch.setattr(F, "최소회사수", 3)
        monkeypatch.setattr(F, "최소티커수", 2)
        물음: list = []

        def 틀(url, params):
            분류, 개념, 단위, 기간 = url.rsplit("/", 4)[1:]
            기간 = 기간.removesuffix(".json")
            해 = int(기간[2:6])
            if 분류 == "us-gaap" and 단위.startswith("USD"):
                답 = {"Revenues": [(1, 100.0), (2, 50.0), (9, 1.0)],
                      "RevenueFromContractWithCustomerIncludingAssessedTax": [(3, 70.0)],
                      "EarningsPerShareBasicAndDiluted": [(2, 3.0)],
                      "NetIncomeLoss": [(1, 10.0)],
                      "CommonStockDividendsPerShareDeclared": [(7, 1.0)],
                      "Assets": [(1, 500.0)]}.get(개념)
            elif 분류 == "ifrs-full" and 단위 in ("TWD", "TWD-per-shares"):
                if 개념 == "EquityAttributableToOwnersOfParent":
                    assert 기간.endswith("Q4I"), "자본은 그해 말의 값"
                주당 = 개념 == "DilutedEarningsLossPerShare"
                답 = None if 주당 != (단위 == "TWD-per-shares") else {      # 주당 값은 '돈-per-shares' 로만 온다
                    "Revenue": [(5, 1000.0 * (해 - 2021)), (1, 9e9)],
                    "ProfitLossAttributableToOwnersOfParent": [(5, 400.0)],
                    "DilutedEarningsLossPerShare": [(5, 10.0 * (해 - 2021))],
                    "EquityAttributableToOwnersOfParent": [(5, 2000.0)]}.get(개념)
            elif 분류 == "ifrs-full" and 단위 == "USD":
                답 = {"ProfitLossAttributableToOwnersOfParent": [(6, 20.0)]}.get(개념)
            elif 분류 == "us-gaap" and 단위.startswith("CNY"):
                답 = {"Revenues": [(7, 700.0)], "NetIncomeLoss": [(7, 70.0)]}.get(개념)
            else:
                답 = None
            return {"data": [{"cik": c, "val": v} for c, v in 답]} if 답 else 응답({}, 404)

        답 = {"company_tickers.json": {str(i): {"cik_str": c, "ticker": t} for i, (c, t) in enumerate(
            [(1, "AAA"), (2, "BBB"), (3, "CCC"), (5, "TSM"), (6, "SHEL"), (7, "BABA"), (9, "ZZZ")])},
              "/frames/": 틀}
        monkeypatch.setattr(F.httpx, "Client", lambda **kw: 가짜웹(답, 물음))
        return F, 물음

    def test_해외_상장사는_IFRS_와_자기_나라_돈의_값을_달러로_바꿔_넣는다(self, monkeypatch):
        """사용자: "스크리닝 지표가 아예 안나오는 종목이 있어(… SK하이닉스 ADR …)" — 달러로 적은 미국 회계기준만 받아
        TSMC·셸·알리바바 같은 해외 상장사가 통째로 빠졌다"""
        F, 물음 = self._해외준비(monkeypatch)
        줄들, 해 = F.fetch_fundamentals(2025, 환율={"TWD": 0.03, "CNY": 0.14, "JPY": 0.0067})
        assert 해 == 2025
        t = 줄들["TSM"]
        assert (t["revenue"], t["earnings"], t["eps"], t["equity"]) == (120.0, 12.0, 1.2, 60.0)
        assert t["fin_years"] == [2022, 2023, 2024, 2025] and t["rev_hist"] == [30, 60, 90, 120]
        assert t["eps_hist"] == [0.3, 0.6, 0.9, 1.2] and t["earnings_prev"] == 12.0
        assert (t["foreign"], t["fin_fx"]) == (1.0, "TWD")
        s = 줄들["SHEL"]
        assert s["earnings"] == 20.0 and s["foreign"] == 1.0 and "fin_fx" not in s, "달러로 적은 IFRS — 매출이 없어도"
        b = 줄들["BABA"]
        assert (b["revenue"], b["earnings"], b["dps"]) == (98.0, 9.8, 1.0), "달러로 적은 칸(주당배당)은 그대로"
        assert (b["foreign"], b["fin_fx"]) == (1.0, "CNY")
        a = 줄들["AAA"]
        assert a["revenue"] == 100.0 and "foreign" not in a, "미국 회사의 달러 값은 해외 값이 덮지 않는다"
        assert a["assets"] == 500.0, "자산(ROA)"
        assert 줄들["BBB"]["eps"] == 3.0, "기본·희석을 한 개념으로 적는 회사(엑슨모빌)"
        assert 줄들["CCC"]["revenue"] == 70.0, "판매세를 넣어 적는 매출"
        주소 = [u for u, _ in 물음]
        assert not any("/EUR" in u for u in 주소), "환율을 모르는 돈은 묻지도 않는다"
        엔 = [u for u in 주소 if "/JPY" in u]
        assert 엔 and all(("Revenue" in u or "ProfitLoss" in u or "NetIncome" in u) for u in 엔), \
            "엔으로 적은 회사가 없으면 그해 매출·순이익만 묻고 그만"

    def test_환율이_없으면_달러로_적은_IFRS_만(self, monkeypatch):
        F, 물음 = self._해외준비(monkeypatch)
        줄들, _ = F.fetch_fundamentals(2025)
        assert "TSM" not in 줄들 and "BABA" in 줄들 and "revenue" not in 줄들["BABA"]
        assert 줄들["SHEL"]["foreign"] == 1.0


class Test_환율:
    """해외 회사 장부 돈 → 달러(야후 spark 의 TWDUSD=X …). 운영에서 야후 상세가 막혀도 spark 는 된다"""

    def test_돈마다_마지막_종가(self, monkeypatch):
        from app.services.market import price_fetcher
        물음: list = []

        async def 가짜(심볼들, 기간="1y"):
            물음.append((sorted(심볼들), 기간))
            return {"TWDUSD=X": [0.031, 0.0312], "EURUSD=X": [1.1], "JPYUSD=X": [], "ZZZ=X": [9.0],
                    "KRWUSD=X": [0.0]}
        monkeypatch.setattr(price_fetcher, "fetch_yf_closes", 가짜)
        r = sources.환율들(("TWD", "EUR", "JPY", "KRW", "USD"))
        assert r["rows"] == {"TWD": {"usd": 0.0312}, "EUR": {"usd": 1.1}}, "빈 것·0·모르는 종목은 뺀다"
        assert 물음 == [(["EURUSD=X", "JPYUSD=X", "KRWUSD=X", "TWDUSD=X"], "5d")], "달러는 묻지 않는다"

    def test_못_받으면_None(self, monkeypatch):
        from app.services.market import price_fetcher

        async def 빈(심볼들, 기간="1y"):
            return {}

        async def 터짐(심볼들, 기간="1y"):
            raise RuntimeError("x")
        monkeypatch.setattr(price_fetcher, "fetch_yf_closes", 빈)
        assert sources.환율들(("TWD",)) is None
        monkeypatch.setattr(price_fetcher, "fetch_yf_closes", 터짐)
        assert sources.환율들(("TWD",)) is None
        assert sources.환율들(("USD",)) is None, "달러만이면 물을 것이 없다"

    def test_기본으로_묻는_돈에_TSMC_ASML_소니의_돈이_있다(self):
        assert {"TWD", "EUR", "JPY", "KRW", "CNY"} <= set(sources.장부돈들) and "USD" not in sources.장부돈들


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
        R._분류_db({"NVDA": ("Technology", "Semiconductors", "United States")}, {"SPCX": 2026})
        monkeypatch.setattr(R, "_나스닥_분류", {})
        monkeypatch.setattr(R, "_나스닥_분류_읽음", False)
        monkeypatch.setattr(R, "_나스닥_상장해", {})
        monkeypatch.setattr(R, "_나스닥_상장해_읽음", False)
        assert R.나스닥_분류()["NVDA"] == ("Technology", "Semiconductors", "United States")
        assert R.나스닥_상장해() == {"SPCX": 2026}

    def test_상장한_해를_읽는다(self):
        """새로 상장한 종목(스페이스X 2026)은 첫 연간 공시 전이라 재무 칸이 빈다 — 화면이 그 까닭을 알린다"""
        from app.services.market.ranking_service import 나스닥_상장해_읽기
        j = {"data": {"rows": [{"symbol": "SPCX", "ipoyear": "2026"}, {"symbol": "BRK/B", "ipoyear": "1996"},
                               {"symbol": "OLD", "ipoyear": ""}, {"symbol": "BAD", "ipoyear": "20x6"}, {"ipoyear": "2020"}]}}
        assert 나스닥_상장해_읽기(j) == {"SPCX": 2026, "BRK-B": 1996}
        assert 나스닥_상장해_읽기(None) == {}

    def test_기초_줄과_표에_상장한_해(self, monkeypatch):
        from app.services.market import ranking_service as R
        from app.services.listings import ticker_service as T
        cache.set(R.US_ROWS_CK, [{"symbol": "SPCX", "name": "SpaceX", "price": 161.0, "market_cap": 2e12}], 60)
        monkeypatch.setattr(T, "_us_db", [{"s": "SPCX", "n": "Space Exploration Technologies", "x": "NASDAQ", "m": "US"}])
        monkeypatch.setattr(R, "나스닥_분류", lambda: {})
        monkeypatch.setattr(R, "나스닥_상장해", lambda: {"SPCX": 2026})
        try:
            줄 = S.기초줄("US")[0]
        finally:
            cache.delete(R.US_ROWS_CK)
        assert 줄["ipo_year"] == 2026
        assert 만들기("US", [줄], []).한줄("SPCX")["ipo_year"] == 2026
        assert "ipo_year" not in 만들기("US", [{"symbol": "AAA", "price": 1.0}], []).한줄("AAA")


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

    def _EPS표(self, 줄들: dict, 기초: list):
        return {x["symbol"]: x for x in 만들기("US", 기초, [], {"us_sec": 원천표("us_sec", 줄들)})
                .결과({}, "", "price", True, 0, 20)[0]}

    def test_EPS_가_없거나_시세_1주의_것이_아니면_순이익과_시가총액으로(self):
        """사용자: "스크리닝 지표가 아예 안나오는 종목이 있어(알파벳, … 버크셔해서웨이 …)" """
        r = self._EPS표({
            # 알파벳 — A·B·C 주마다 따로 적어 SEC frames 에 EPS 가 없다
            "GOOGL": {"earnings": 1.2e11, "equity": 3.0e11},
            # 버크셔 B — SEC 의 EPS 는 A 주 1주의 값(4만 달러)이다
            "BRK-B": {"earnings": 9.0e10, "eps": 41000.0, "fin_years": [2024, 2025], "eps_hist": [30000.0, 41000.0]},
            # 결산 뒤 10:1 분할 — 장부 EPS 는 나누기 전 1주의 값
            "SPLT": {"earnings": 3.0e10, "eps": 12.0},
            # 보통 회사 — 장부 EPS 그대로(시가총액 ÷ 순이익과 조금 달라도)
            "NORM": {"earnings": 1.0e10, "eps": 2.1},
            # 적자 해외 회사 — 시가총액을 모른다
            "ADRX": {"earnings": -5.0e8, "eps": -1.0, "foreign": 1.0, "fin_years": [2025], "eps_hist": [-1.0]},
        }, [{"symbol": "GOOGL", "price": 250.0, "market_cap": 3.0e12},
            {"symbol": "BRK-B", "price": 480.0, "market_cap": 1.035e12},
            {"symbol": "SPLT", "price": 120.0, "market_cap": 3.0e12},
            {"symbol": "NORM", "price": 40.0, "market_cap": 2.0e11},
            {"symbol": "ADRX", "price": 5.0}])
        g = r["GOOGL"]
        assert (g["eps"], g["per"]) == (10.0, 25.0) and g["pbr"] == 10.0
        b = r["BRK-B"]
        assert (b["eps"], b["per"]) == (round(480 * 9.0e10 / 1.035e12, 4), 11.5)
        assert b["eps_hist"] == [round(30000 * b["eps"] / 41000, 2), b["eps"].__round__(2)], "흐름도 B 주 1주로 맞춘다"
        assert r["SPLT"]["per"] == 100.0 and r["SPLT"]["eps"] == 1.2, "열 배 어긋난 EPS 는 믿지 않는다"
        n = r["NORM"]
        assert (n["eps"], n["per"]) == (2.1, 19.05), "세 배 안쪽이면 장부 EPS 가 맞다"
        x = r["ADRX"]
        assert "eps" not in x and "per" not in x, "해외 회사의 원주 1주 EPS 를 ADR 시세로 나누지 않는다"
        assert x["eps_hist"] == [-1.0] and x["eps_basis"] == "ordinary", "시세 1주로 못 맞춘 흐름은 원주 기준이라고 적는다"

    def test_SEC_에_EPS_칸이_아예_없어도_순이익과_시가총액으로(self):
        r = self._EPS표({"GOOGL": {"earnings": 1.2e11}}, [{"symbol": "GOOGL", "price": 250.0, "market_cap": 3.0e12}])
        assert (r["GOOGL"]["eps"], r["GOOGL"]["per"]) == (10.0, 25.0)

    def test_장부_EPS_와_순이익의_부호가_다른_해외_회사는_흐름을_맞추지_않는다(self):
        """원주 EPS 는 적자(우선주 배당을 뗀 보통주 몫)인데 순이익은 흑자 — 배율이 음수면 흐름의 부호가 뒤집힌다"""
        r = self._EPS표({"ADRZ": {"earnings": 1.0e9, "eps": -0.5, "foreign": 1.0, "fin_years": [2024, 2025],
                                  "eps_hist": [0.3, -0.5]}},
                        [{"symbol": "ADRZ", "price": 10.0, "market_cap": 5.0e9}])
        z = r["ADRZ"]
        assert z["eps_hist"] == [0.3, -0.5] and z["eps_basis"] == "ordinary"

    def test_해외_회사는_적자여도_흐름을_시세_1주로(self):
        r = self._EPS표({"ADRY": {"earnings": -1.0e9, "eps": -0.5, "foreign": 1.0, "fin_fx": "EUR",
                                  "fin_years": [2024, 2025], "eps_hist": [-0.25, -0.5], "revenue": 4.0e9}},
                        [{"symbol": "ADRY", "price": 10.0, "market_cap": 5.0e9}])
        y = r["ADRY"]
        # 시세 1주의 몫 = −10억 × 10 ÷ 50억 = −2 — 원주 EPS(−0.5)의 네 배
        assert y["eps"] == -2.0 and "per" not in y and y["eps_hist"] == [-1.0, -2.0]
        assert (y["fin_fx"], y["fin_currency"]) == ("EUR", "USD") and "eps_basis" not in y

    def test_SEC_공시가_없는_국내_회사_ADR_은_원주_줄로(self):
        """사용자: "스크리닝 지표가 아예 안나오는 종목이 있어(… SK하이닉스 ADR …)" — 2026년 7월에 상장해 20-F 가 아직
        없다. ADR 10주 = 원주 1주"""
        원주 = {"per": 8.5, "pbr": 2.1, "roe": 30.0, "dividend_yield": 0.9, "_ni_yoy": 120.0, "sector": "전기·전자",
                "revenue": 66e12, "earnings": 20e12, "eps": 28000.0, "forward_eps": 40000.0,
                "fin_years": [2024, 2025], "rev_hist": [44e12, 66e12], "eps_hist": [20000.0, 28000.0]}
        fx = 원천표("us_fx", {"KRW": {"usd": 0.0007}})
        기초 = [{"symbol": "SKHY", "price": 20.0, "market_cap": 2e11},
                {"symbol": "OTHR", "price": 1.0}]
        표 = 만들기("US", 기초, [{"symbol": "SKHY", "pbr": 2.5}], {"us_fx": fx, "kr_adr": {"SKHY": 원주, "OTHR": 원주}})
        s = 표.한줄("SKHY")
        assert (s["per"], s["roe"], s["dividend_yield"], s["_ni_yoy"]) == (8.5, 30.0, 0.9, 120.0), "비율은 그대로"
        assert s["pbr"] == 2.5, "있는 값은 덮지 않는다"
        assert (s["revenue"], s["earnings"]) == (46.2e9, 14e9), "원화 금액은 지금 환율로 달러로"
        assert (s["eps"], s["forward_eps"]) == (1.96, 2.8), "주당 값은 ADR 1주(원주 0.1주)로"
        assert s["fin_years"] == [2024, 2025] and s["rev_hist"] == [30_800_000_000, 46_200_000_000]
        assert s["eps_hist"] == [1.4, 1.96] and (s["fin_currency"], s["fin_fx"]) == ("USD", "KRW")
        assert s["sector"] == "전기·전자"
        assert "per" not in 표.한줄("OTHR"), "정해 둔 ADR 만"
        # 원화 환율을 모르면 비율만
        s = 만들기("US", 기초, [], {"kr_adr": {"SKHY": 원주}}).한줄("SKHY")
        assert s["per"] == 8.5 and "revenue" not in s and "eps" not in s and "fin_years" not in s

    def test_국내_표가_있으면_미국_표가_ADR_에_원주_줄을_쓴다(self, 가짜시장):
        S._표["KR"] = 만들기("KR", [{"symbol": "000660", "price": 200000.0}], [], {
            "kr_krx": 원천표("kr_krx", {"000660": {"per": 9.0, "eps": 22222.0}})})
        가짜시장["기초"] = [{"symbol": "SKHY", "price": 15.0}]
        assert S.표("US").한줄("SKHY")["per"] == 9.0
        S._표.pop("KR")
        S._표.pop("US")
        assert "per" not in S.표("US").한줄("SKHY"), "국내 표가 없으면 비운 채로 — 국내 표를 짓게 하지는 않는다"
        assert "KR" not in S._표

    def test_SEC_에_없는_주식_종류는_같은_회사의_다른_종류_줄로(self):
        """사용자: "스크리닝에 지표가 안나오는 종목이 있어(알파벳C, … 버크셔해서웨이A …)" — 회사 값은 같고 주당 값은
        시세 1주로 맞춘다. 이름만 같은 남남(티커 줄기가 다르다)은 잇지 않는다"""
        sec = 원천표("us_sec", {
            "BRK-A": {"revenue": 3.7e11, "earnings": 8.9e10, "equity": 6.5e11, "eps": 61910.0},
            "GOOGL": {"revenue": 4.0e11, "earnings": 1.2e11, "equity": 3.5e11, "fin_years": [2024, 2025],
                      "rev_hist": [3.5e11, 4.0e11], "ni_hist": [1.0e11, 1.2e11]},
            "FOX": {"revenue": 1.6e10, "earnings": 2.2e9},
            "BAC": {"revenue": 1.0e11, "earnings": 2.7e10}})
        기초 = [
            {"symbol": "BRK-A", "name_en": "Berkshire Hathaway Inc. Class A", "price": 720000.0, "market_cap": 1.035e12},
            {"symbol": "BRK-B", "name_en": "Berkshire Hathaway Inc. Class B", "price": 480.0, "market_cap": 1.035e12},
            {"symbol": "GOOGL", "name_en": "Alphabet Inc. Class A Common Stock", "price": 250.0, "market_cap": 3.0e12},
            {"symbol": "GOOG", "name_en": "Alphabet Inc. Class C Capital Stock", "price": 252.0, "market_cap": 3.0e12},
            {"symbol": "HATH", "name_en": "Berkshire Hathaway Inc.", "price": 5.0, "market_cap": 1e9},
            {"symbol": "FOX", "name_en": "Fox Corporation Class B Common Stock", "price": 55.0, "market_cap": 2.5e10},
            {"symbol": "BAC", "name_en": "Bank of America Corporation Common Stock", "price": 50.0, "market_cap": 3.8e11},
            {"symbol": "BAC-PL", "name_en": "Bank of America Corporation Depositary Shares, each representing a 1/1,000th "
             "interest in a share of 5.875% Non-Cumulative Preferred Stock, Series L", "price": 25.0, "market_cap": 1e9}]
        # 기초 줄이 없는 종목(야후 줄만) — 야후의 이름으로 회사를 맞춘다
        야후 = [{"symbol": "FOXA", "name": "Fox Corporation Class A Common Stock", "price": 60.0, "market_cap": 2.5e10}]
        r = {x["symbol"]: x for x in 만들기("US", 기초, 야후, {"us_sec": sec}).결과({}, "", "price", True, 0, 19)[0]}
        b = r["BRK-B"]
        assert b["revenue"] == 3.7e11 and b["pbr"] == round(1.035e12 / 6.5e11, 2)
        assert (b["eps"], b["per"]) == (round(480 * 8.9e10 / 1.035e12, 4), 11.63), "A 주 EPS 는 B 주 1주로"
        assert r["BRK-A"]["per"] == 11.63 and r["BRK-A"]["eps"] == 61910.0
        g = r["GOOG"]
        assert g["revenue"] == 4.0e11 and (g["eps"], g["per"]) == (10.08, 25.0)
        assert g["fin_years"] == [2024, 2025] and g["rev_hist"] == [3.5e11, 4.0e11]
        assert "revenue" not in r["HATH"], "이름만 같고 티커 줄기가 다르면 남남이다"
        assert r["FOXA"]["revenue"] == 1.6e10
        assert "revenue" not in r["BAC-PL"] and "per" not in r["BAC-PL"], "우선주는 보통주의 재무를 받지 않는다"

    def test_EPS_흐름이_없는_회사는_해마다_순이익을_지금_주식_수로_어림한다(self):
        """알파벳 — EPS 를 주식 종류별로만 적어 SEC frames 에 EPS 흐름이 없다. 마지막 해는 표의 EPS 와 같다"""
        sec = 원천표("us_sec", {
            "GOOGL": {"earnings": 1.2e11, "fin_years": [2023, 2024, 2025], "rev_hist": [3.0e11, 3.5e11, 4.0e11],
                      "ni_hist": [0.75e11, 1.0e11, 1.2e11]},
            "NRM": {"earnings": 1e9, "eps": 2.0, "fin_years": [2025], "rev_hist": [5e9], "eps_hist": [2.0],
                    "ni_hist": [1e9]},
            "NOMC": {"earnings": 1e9, "fin_years": [2025], "rev_hist": [5e9], "ni_hist": [1e9]},
            "YAH": {"earnings": 2e9, "fin_years": [2025], "rev_hist": [6e9], "ni_hist": [2e9]}})
        기초 = [{"symbol": "GOOGL", "price": 250.0, "market_cap": 3.0e12},
                {"symbol": "NRM", "price": 40.0, "market_cap": 2e10},
                {"symbol": "NOCAP", "price": 10.0},
                {"symbol": "NOMC", "price": 10.0},
                {"symbol": "YAH", "price": 10.0, "market_cap": 4e10}]
        야후 = [{"symbol": "YAH", "fin_currency": "USD", "fin_years": [2024, 2025], "rev_hist": [5e9, 6e9],
                 "eps_hist": [0.4, 0.5]}]
        r = {x["symbol"]: x for x in 만들기("US", 기초, 야후, {"us_sec": sec}).결과({}, "", "price", True, 0, 9)[0]}
        g = r["GOOGL"]
        # 지금 주식 수 = 3조 ÷ 250 = 120억 주
        assert g["eps_hist"] == [6.25, 8.33, 10.0] and g["eps"] == 10.0 and g["eps_basis"] == "implied"
        assert "eps_cagr_3y" not in g, "세 해뿐이면 3년 성장률은 모른다"
        assert r["NRM"]["eps_hist"] == [2.0] and "eps_basis" not in r["NRM"], "장부 EPS 흐름이 있으면 그것"
        assert "eps_hist" not in r["NOCAP"], "SEC 에 없는 종목은 흐름도 없다"
        assert "eps_basis" not in r["NOMC"], "주식 수(시가총액)를 모르면 어림하지 않는다"
        assert r["YAH"]["eps_hist"] == [0.4, 0.5] and "eps_basis" not in r["YAH"], "야후 흐름을 쓰는 줄은 어림이 아니다"

    def test_회사이름과_형제_티커(self):
        from app.services.screening.table import _회사이름, _형제티커인가
        assert _회사이름("Alphabet Inc. Class C Capital Stock") == _회사이름("Alphabet Inc.") == "alphabet"
        assert _회사이름("Berkshire Hathaway Inc. Class B Common Stock") == "berkshire hathaway"
        assert _회사이름("HSBC Holdings plc American Depositary Shares") == "hsbc holdings"
        assert _회사이름(None) is None and _회사이름("  ") is None
        assert _형제티커인가("BRK-A", "BRK-B") and _형제티커인가("GOOG", "GOOGL") and _형제티커인가("LBRDA", "LBRDK")
        assert _형제티커인가("FOX", "FOXA") and _형제티커인가("HEI", "HEI-A") and _형제티커인가("Z", "ZG")
        assert not _형제티커인가("HATH", "BRK-B") and not _형제티커인가("AB", "CD") and not _형제티커인가("BAC", "BRK-B")

    def test_ROA_는_SEC_자산으로(self):
        r = self._EPS표({"AST": {"earnings": 5.0, "assets": 50.0}}, [{"symbol": "AST", "price": 1.0}])
        assert r["AST"]["roa"] == 10.0

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
                 "fin_currency": "USD"}]
        r = {x["symbol"]: x for x in 만들기("US", 기초, 풍부, {"us_sec": sec}).결과({}, "", "market_cap", True, 0, 9)[0]}
        a = r["AAA"]
        assert a["fin_years"] == [2022, 2023, 2024, 2025] and a["rev_hist"] == [20, 40, 80, 160]
        assert a["eps_hist"] == [0.25, 0.5, 1.0, 2.0]
        assert a["rev_cagr_3y"] == 100.0 and a["eps_cagr_3y"] == 100.0, "20 → 160 은 해마다 두 배"
        assert a["fin_currency"] == "USD"
        b = r["BBB"]
        assert b["fin_years"] == [2023, 2024, 2025] and b["rev_hist"] == [1, 2, 3], "야후 흐름이 있으면 그 한 벌"
        assert "rev_cagr_3y" not in b and b["fin_currency"] == "USD", "SEC 의 성장률을 야후 막대에 섞지 않는다"
        assert "fin_years" not in r["CCC"] and "fin_currency" not in r["CCC"]

    def test_장부_돈이_다른_야후_흐름보다_달러로_바꾼_SEC_흐름이_먼저(self):
        """TSMC 처럼 야후 흐름이 대만 달러이고 SEC(IFRS — 달러로 바꾸고 ADR 1주로 맞춘 것)에도 있으면 SEC 의 것.
        야후 흐름은 원주 1주의 EPS 라 ADR 시세와 단위가 다르다"""
        기초 = [{"symbol": "TSM", "price": 300.0, "market_cap": 1.5e12}]
        sec = 원천표("us_sec", {"TSM": {"revenue": 120e9, "earnings": 50e9, "eps": 2.0, "foreign": 1.0, "fin_fx": "TWD",
                                        "fin_years": [2024, 2025], "rev_hist": [90e9, 120e9], "eps_hist": [1.5, 2.0]}})
        풍부 = [{"symbol": "TSM", "currency": "USD", "fin_currency": "TWD", "fin_years": [2023, 2024, 2025],
                 "rev_hist": [1, 2, 3], "eps_hist": [40.0, 45.0, 61.0]}]
        t = 만들기("US", 기초, 풍부, {"us_sec": sec, "us_fx": 원천표("us_fx", {"TWD": {"usd": 0.03}})}).한줄("TSM")
        assert t["fin_years"] == [2024, 2025] and t["rev_hist"] == [90_000_000_000, 120_000_000_000]
        # 시세 1주의 몫 = 순이익 × 시세 ÷ 시가총액 = 10 — 원주 1주 EPS(2) 의 다섯 배(ADR 1주 = 원주 5주)
        assert t["eps"] == 10.0 and t["per"] == 30.0 and t["eps_hist"] == [7.5, 10.0]
        assert (t["fin_currency"], t["fin_fx"]) == ("USD", "TWD") and "eps_basis" not in t, "시세 1주로 맞췄다"

    def test_장부_돈이_다른_야후_흐름은_지금_환율로_달러로(self):
        """사용자: "스크리닝 TSMC가 대만달러로 나와" — 4년 흐름이 TSMC 장부의 대만 달러 그대로 나갔다"""
        기초 = [{"symbol": s, "price": 10.0} for s in ("TSM", "SONY", "AAPL", "UMC")]
        풍부 = [
            {"symbol": "TSM", "currency": "USD", "fin_currency": "TWD", "fin_years": [2024, 2025],
             "rev_hist": [2_894_000_000_000, 3_631_000_000_000], "eps_hist": [45.25, None]},
            {"symbol": "SONY", "currency": "USD", "fin_currency": "JPY", "fin_years": [2025], "rev_hist": [13e12],
             "eps_hist": [180.0]},
            {"symbol": "AAPL", "currency": "USD", "fin_currency": "USD", "fin_years": [2025], "rev_hist": [400e9],
             "eps_hist": [7.0]},
            {"symbol": "UMC", "currency": "TWD", "fin_currency": "TWD", "fin_years": [2025], "rev_hist": [2e11],
             "eps_hist": [3.0]},
        ]
        fx = 원천표("us_fx", {"TWD": {"usd": 0.03}, "EUR": {"usd": 1.1}})
        r = {x["symbol"]: x for x in 만들기("US", 기초, 풍부, {"us_fx": fx}).결과({}, "", "price", True, 0, 9)[0]}
        t = r["TSM"]
        assert t["rev_hist"] == [86_820_000_000, 108_930_000_000] and t["eps_hist"] == [1.36, None]
        assert (t["fin_currency"], t["fin_fx"]) == ("USD", "TWD")
        assert t["eps_basis"] == "ordinary", "야후의 해마다 EPS 는 원주 1주의 값이라고 적는다"
        assert r["SONY"]["rev_hist"] == [13e12] and r["SONY"]["fin_currency"] == "JPY", "환율을 모르는 돈은 그대로"
        assert "eps_basis" not in r["SONY"] and "eps_basis" not in r["AAPL"]
        assert "fin_fx" not in r["SONY"] and "fin_fx" not in r["AAPL"]
        assert r["AAPL"]["rev_hist"] == [400e9] and r["AAPL"]["fin_currency"] == "USD"
        assert r["UMC"]["rev_hist"] == [2e11], "시세 돈이 달러가 아니면 건드리지 않는다"
        # 환율을 못 받았으면 장부 돈 그대로(예전과 같다)
        r = {x["symbol"]: x for x in 만들기("US", 기초, 풍부, {}).결과({}, "", "price", True, 0, 9)[0]}
        assert r["TSM"]["rev_hist"] == [2_894_000_000_000, 3_631_000_000_000] and r["TSM"]["fin_currency"] == "TWD"
        # 국내 표는 바꾸지 않는다 — 시세 돈을 모르는 줄이어도
        kr = 만들기("KR", [{"symbol": "005930", "price": 1.0}],
                  [{"symbol": "005930", "fin_currency": "TWD", "fin_years": [2025],
                    "rev_hist": [100]}], {"us_fx": fx}).결과({}, "", "price", True, 0, 1)[0][0]
        assert kr["rev_hist"] == [100] and kr["fin_currency"] == "TWD"

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

    def test_국내는_DART_가_없으면_네이버_연간_실적으로_재무와_흐름(self):
        """사용자: "국내주식 스크리닝은 안나오는 지표가 너무 많아" — 운영 서버에 DART 키가 없고 KRX 가 로그인을 요구해
        매출·순이익·영업이익률·매출/EPS 흐름·성장률이 통째로 비었다"""
        네이버 = 원천표("kr_naver", {"005930": sources.네이버_연간_읽기(_삼성연간) | {"per": 14.0}})
        기초 = [{"symbol": "005930", "price": 70000.0, "market_cap": 4.0e14}]
        r = 만들기("KR", 기초, [], {"kr_naver": 네이버}).한줄("005930")
        assert (r["revenue"], r["earnings"]) == (3_008_709e8, 344_514e8)
        assert r["operating_margin"] == round(327_260 / 3_008_709 * 100, 2)
        assert r["profit_margin"] == round(344_514 / 3_008_709 * 100, 2)
        assert (r["roe"], r["debt_ratio"]) == (8.98, 27.93) and r["ps_ratio"] == round(4.0e14 / 3_008_709e8, 2)
        assert r["fin_years"] == [2021, 2022, 2023, 2024] and r["eps_hist"] == [5777.0, 8057.0, 2131.0, 4950.0]
        assert r["rev_cagr_3y"] == round(((3_008_709 / 2_796_048) ** (1 / 3) - 1) * 100, 1)
        assert r["_ni_yoy"] == round((344_514 - 154_871) / 154_871 * 100, 2) and r["fin_currency"] == "KRW"

    def test_국내는_DART_가_먼저고_네이버는_빈_종목_빈_해만(self):
        dart = 원천표("kr_dart", {"005930": {"revenue": 300.0, "net_income": 30.0, "net_income_prev": 20.0,
                                             "op_income": 40.0, "equity": 600.0, "liabilities": 300.0,
                                             "rev_years": [2022, 2023, 2024], "rev_hist": [200.0, 250.0, 300.0]}})
        네이버 = 원천표("kr_naver", {
            "005930": {"revenue": 999.0, "net_income": 99.0, "net_income_prev": 9.0, "roe": 77.0, "debt_ratio": 7.0,
                       "rev_years": [2021, 2022, 2023, 2024], "rev_hist": [150.0, 999.0, 999.0, 999.0]},
            "000660": {"revenue": 80.0, "net_income": 8.0, "fin_year": 2024}})
        기초 = [{"symbol": s, "price": 1.0, "market_cap": 1000.0} for s in ("005930", "000660")]
        표 = 만들기("KR", 기초, [], {"kr_dart": dart, "kr_naver": 네이버})
        삼성 = 표.한줄("005930")
        assert (삼성["revenue"], 삼성["earnings"], 삼성["roe"], 삼성["debt_ratio"]) == (300.0, 30.0, 5.0, 50.0)
        assert 삼성["rev_hist"] == [150, 200, 250, 300], "DART 에 없는 해(2021)만 네이버로 — 그래서 네 해"
        assert 삼성["_ni_yoy"] == 50.0, "성장률도 DART 의 그해·지난해"
        assert 표.한줄("000660")["revenue"] == 80.0, "DART 에 없는 종목은 네이버로"

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
        "미국_SEC": lambda: 부름.append("sec") or {"at": time.time(), "year": 2025, "v": sources.SEC_판, "rows": {"AAA": {
            "eps": 4.0, "fin_years": [2024, 2025], "rev_hist": [10, 20], "eps_hist": [3.0, 4.0]}}},
        "미국_한글이름": lambda: 부름.append("ko") or {"at": time.time(), "rows": {"AAA": "에이"}},
        "환율들": lambda: 부름.append("fx") or {"at": time.time(), "rows": {"TWD": {"usd": 0.03}}},
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

    def test_환율을_받아_장부_돈이_다른_흐름을_달러로(self, 가짜시장, 원천켜기):
        가짜시장["기초"] = [{"symbol": "TSM", "price": 10.0}]
        가짜시장["풍부"] = [{"symbol": "TSM", "price": 10.0, "currency": "USD", "fin_currency": "TWD",
                          "fin_years": [2025], "rev_hist": [1000]}]
        S.표("US")
        _원천_끝까지()
        assert "fx" in 원천켜기
        줄 = _새_표("US").한줄("TSM")
        assert (줄["rev_hist"], 줄["fin_currency"], 줄["fin_fx"]) == ([30], "USD", "TWD")
        assert store.읽기("US_FX")[0]["rows"]["TWD"]["usd"] == 0.03, "서버가 깨도 DB 에서 곧바로"

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
        from app.core import health
        from app.core.config import settings
        monkeypatch.setattr(settings, "DART_API_KEY", "")
        monkeypatch.setattr(S, "_DART_알림", [False])
        health.reset()
        가짜시장["기초"] = [{"symbol": "AAA", "price": 1.0}]
        S.표("KR")
        _원천_끝까지()
        assert "dart" not in 원천켜기 and "krx" in 원천켜기
        # 예전엔 말없이 건너뛰어 관리자 화면(바깥 원천)에 안 보였다 — 이제 왜 비는지 적는다(한 번만)
        줄 = {s["name"]: s for s in health.snapshot()}[sources.이름_DART]
        assert "DART_API_KEY" in 줄["last_error"] and "네이버 연간 실적" in 줄["last_error"]
        S.표("KR")
        _원천_끝까지()
        assert {s["name"]: s for s in health.snapshot()}[sources.이름_DART]["streak"] == 줄["streak"], "한 번만 남긴다"

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
    받은환율: list = []
    monkeypatch.setattr(sources, "환율들", lambda: {"at": 1.0, "rows": {"TWD": {"usd": 0.03}}})
    monkeypatch.setattr(sec_frames, "fetch_fundamentals",
                        lambda 환율=None: (받은환율.append(환율), ({"AAA": {"eps": 1.0}}, 2025))[1])
    assert sources.국내_KRX() is None
    받은 = sources.미국_SEC()
    assert 받은["rows"] == {"AAA": {"eps": 1.0}}
    assert 받은["v"] == sources.SEC_판, "받는 법의 판을 남긴다 — 옛 판으로 남은 것은 서버가 곧바로 새로 받는다"
    assert 받은환율 == [{"TWD": 0.03}], "해외 상장사의 재무를 달러로 바꿀 환율을 넘긴다"
    monkeypatch.setattr(sources, "환율들", lambda: None)
    assert sources.미국_SEC()["rows"] == {"AAA": {"eps": 1.0}} and 받은환율[-1] == {}, "환율을 못 받아도 미국 회사는"
    이름별 = {s["name"]: s for s in health.snapshot()}
    assert 이름별[sources.이름_KRX]["streak"] >= 1
    assert 이름별[sources.이름_SEC]["streak"] == 0 and 이름별[sources.이름_SEC]["ok"] >= 1


class 가짜네이버:
    """httpx.AsyncClient 대역 — 연간 실적 주소에만 답을 정해 둔다(나머지는 404). 물은 주소는 물음에"""

    def __init__(self, 연간: dict, 물음: list):
        self.연간, self.물음 = 연간, 물음

    def __call__(self, **kw):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, url, **kw):
        self.물음.append(url)
        for 코드, 답 in self.연간.items():
            if f"/stock/{코드}/finance/annual" in url:
                if isinstance(답, Exception):
                    raise 답
                return 응답(답)
        return 응답({}, 404)


def _네이버연간(열: list[tuple[str, str]], 행: dict[str, list]) -> dict:
    """열 — [(key, isConsensus)], 행 — {제목: 열마다 값 글}"""
    return {"financeInfo": {
        "trTitleList": [{"key": k, "isConsensus": c, "title": f"{k[:4]}.{k[4:]}."} for k, c in 열],
        "rowList": [{"title": t, "columns": {k: {"value": v} for (k, _c), v in zip(열, 값들)}} for t, 값들 in 행.items()],
    }}


_삼성연간 = _네이버연간(
    [("202112", "N"), ("202212", "N"), ("202312", "N"), ("202412", "N"), ("202512", "Y")],
    {"매출액증가율": ["1.0", "2.0", "3.0", "4.0", "5.0"],          # 비율 행이 먼저 와도 금액 행을 고른다
     "매출액": ["2,796,048", "3,022,314", "2,589,355", "3,008,709", "3,300,000"],
     "영업이익": ["516,339", "433,766", "65,670", "327,260", "400,000"],
     "영업이익률": ["18.47", "14.35", "2.54", "10.88", "12.0"],
     "당기순이익(지배)": ["1", "1", "1", "1", "1"],                   # 같은 제목('당기순이익')이 있으면 그것
     "당기순이익": ["399,074", "556,541", "154,871", "344,514", "380,000"],
     "ROE(지배주주)": ["13.92", "17.07", "4.15", "8.98", "9.5"],
     "부채비율": ["39.92", "26.41", "25.36", "27.93", "-"],
     "EPS(원)": ["5,777", "8,057", "2,131", "4,950", "5,500"]})


class Test_네이버_연간:
    def test_해마다_매출_이익_EPS_와_마지막_해_재무(self):
        r = sources.네이버_연간_읽기(_삼성연간)
        assert r["rev_years"] == r["eps_years"] == [2021, 2022, 2023, 2024], "추정(2025E)은 뺀다"
        assert r["rev_hist"] == [2_796_048e8, 3_022_314e8, 2_589_355e8, 3_008_709e8], "억원 → 원"
        assert r["eps_hist"] == [5777.0, 8057.0, 2131.0, 4950.0]
        assert (r["fin_year"], r["revenue"], r["op_income"], r["net_income"]) == (2024, 3_008_709e8, 327_260e8, 344_514e8)
        assert (r["op_income_prev"], r["net_income_prev"]) == (65_670e8, 154_871e8)
        assert (r["roe"], r["debt_ratio"]) == (8.98, 27.93), "제목 뒤에 단위가 붙어도('ROE(지배주주)')"

    def test_모양이_다르거나_비었으면_빈_것(self):
        assert sources.네이버_연간_읽기(None) == {} and sources.네이버_연간_읽기({"financeInfo": None}) == {}
        assert sources.네이버_연간_읽기(_네이버연간([("202412", "Y")], {"매출액": ["1"]})) == {}, "추정뿐"
        r = sources.네이버_연간_읽기(_네이버연간([("202312", "N"), ("202412", "N")],
                                                {"매출액": ["-", "N/A"], "EPS": ["100", "-"]}))
        assert "rev_years" not in r and r["eps_hist"] == [100.0, None] and "fin_year" not in r, "값이 없는 해는 None"
        r = sources.네이버_연간_읽기(_네이버연간([("202412", "N")], {"매출액": ["100"], "영업이익률": ["9.0"]}))
        assert r["revenue"] == 100e8 and "op_income" not in r, "영업이익 행이 없으면 비율 행을 금액으로 읽지 않는다"

    def test_종목_응답에_연간_실적을_붙인다(self, monkeypatch):
        from app.core import health
        from app.services.market import price_fetcher
        import httpx as _httpx

        async def 하나(cl, code):
            return {"per": 12.0, "price": 70000.0}
        물음: list = []
        monkeypatch.setattr(price_fetcher, "_fetch_naver_one", 하나)
        monkeypatch.setattr(_httpx, "AsyncClient", 가짜네이버({"005930": _삼성연간, "000660": RuntimeError("x")}, 물음))
        줄들 = sources.국내_네이버(["005930", "000660", "035420"])
        assert 줄들["005930"]["rev_hist"][-1] == 3_008_709e8 and 줄들["005930"]["per"] == 12.0
        assert 줄들["000660"] == {"per": 12.0, "at": 줄들["000660"]["at"], "v": sources.네이버_판}, "연간 실적을 못 받아도 지표는"
        assert sorted(u.split("/stock/")[1].split("/")[0] for u in 물음) == ["000660", "005930", "035420"]
        assert "연간 실적 1" in {s["name"]: s for s in health.snapshot()}[sources.이름_네이버]["detail"]


def test_네이버_종목_응답에서_스크리닝_칸만_담고_52주_고저는_이름을_바꾼다(monkeypatch):
    from app.services.market import price_fetcher
    import httpx as _httpx

    async def 하나(cl, code):
        if code == "BAD":
            raise RuntimeError("막힘")
        return {"forward_per": 9.5, "forward_eps": 7000.0, "per": None, "price": 70000.0, "name": "삼성전자",
                "week52_high": 88000.0, "week52_low": 50000.0}
    monkeypatch.setattr(price_fetcher, "_fetch_naver_one", 하나)
    monkeypatch.setattr(_httpx, "AsyncClient", 가짜네이버({}, []))
    줄들 = sources.국내_네이버(["005930", "BAD"])
    assert set(줄들) == {"005930"}
    줄 = 줄들["005930"]
    assert 줄.pop("at") > 0 and 줄.pop("v") == sources.네이버_판
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


def _표_끝까지():
    """표 일꾼도 하나라 맡긴 차례대로 돈다"""
    S._표일꾼.submit(lambda: None).result(timeout=10)


class Test한종목_원천:
    """관심종목 PC 표·종목 상세 투자지표·퀀트는 스크리닝 표를 한종목 으로 본다. 서버가 막 뜬 뒤 그쪽이 먼저 물으면
    DB 에 남긴 원천(SEC·KRX…) 없이 표를 지어, 누가 스크리닝 화면을 열 때까지 PER·EPS 가 비었다(가짜 서버를
    다시 띄우고 관심종목을 먼저 열었더니 PER 칸이 전부 '—'). 그 표는 원천이 새로 와도 다시 짓지 않았다"""

    def test_한종목이_맡긴_첫_표도_DB_에_남긴_원천으로(self, 가짜시장, 원천켜기):
        가짜시장["기초"] = [{"symbol": "AAA", "price": 10.0}]
        assert store.남기기("US_SEC", {"at": time.time(), "year": 2025, "v": sources.SEC_판, "rows": {"AAA": {
            "eps": 4.0, "fin_years": [2024, 2025], "rev_hist": [10, 20], "eps_hist": [3.0, 4.0]}}})
        S.비우기()                                    # 서버가 막 떴다 — 메모리에는 아무것도 없다
        assert S.한종목("US", "AAA") is None           # 표가 없다 — 기다리게 하지 않고 뒤에서 짓게 맡긴다
        _표_끝까지()
        줄 = S.한종목("US", "AAA")
        assert 줄["eps"] == 4.0 and 줄["per"] == 2.5, "DB 에 남긴 SEC 원천 없이 지었다"
        _원천_끝까지()
        assert "sec" not in 원천켜기, "DB 에 막 남긴 원천을 또 받았다"

    def test_옛_받는_법으로_남긴_SEC_는_쓰되_곧바로_새로_받는다(self, 가짜시장, 원천켜기):
        """배포 뒤 최대 7일 동안 새 받는 법(해외 상장사·대체 태그)이 안 들어오던 것 — 판이 다르면 곧바로"""
        가짜시장["기초"] = [{"symbol": "AAA", "price": 10.0}]
        assert store.남기기("US_SEC", {"at": time.time(), "year": 2025, "rows": {"AAA": {"eps": 5.0}}})
        S.비우기()
        첫 = S.표("US")
        assert 첫.한줄("AAA")["per"] == 2.0, "새로 받기 전에도 남긴 것을 쓴다"
        _원천_끝까지()
        assert 원천켜기.count("sec") == 1
        assert store.읽기("US_SEC")[0]["v"] == sources.SEC_판 and _새_표("US").한줄("AAA")["per"] == 2.5

    def test_네이버_옛_판_줄은_받은_지_얼마_안_됐어도_먼저_다시_받는다(self, 가짜시장, 원천켜기, monkeypatch):
        """연간 실적이 붙기 전(옛 판)에 받은 줄 — 20시간을 기다리지 않는다. 판을 남기니 다음 차례엔 건너뛴다"""
        monkeypatch.setattr(S, "네이버_한번", 5)
        가짜시장["기초"] = [{"symbol": s, "price": 1.0, "market_cap": c} for s, c in (("AAA", 3.0), ("BBB", 2.0), ("CCC", 1.0))]
        S.표("KR")
        지금 = time.time()
        S._원천["kr_naver_rows"] = {"AAA": {"per": 9.0, "at": 지금},                       # 옛 판(연간 실적 없음)
                                   "BBB": {"per": 8.0, "at": 지금, "v": sources.네이버_판},  # 새 판 — 건너뛴다
                                   "CCC": {"per": 7.0, "at": 지금 - S.네이버_수명 - 1, "v": sources.네이버_판}}
        assert S._돌아가며_받기("kr_naver")["rows"]["AAA"]["v"] == sources.네이버_판
        assert [x[1] for x in 원천켜기 if isinstance(x, tuple) and x[0] == "naver"][-1] == ["AAA", "CCC"]

    def test_네이버가_답하지_않은_종목도_판을_남겨_차례가_멈추지_않는다(self, 가짜시장, 원천켜기, monkeypatch):
        가짜시장["기초"] = [{"symbol": "AAA", "price": 1.0, "market_cap": 1.0}]
        S.표("KR")
        monkeypatch.setattr(sources, "국내_네이버", lambda 코드들: {"ZZZ": {"per": 1.0, "at": time.time()}})
        줄 = S._돌아가며_받기("kr_naver")["rows"]["AAA"]
        assert 줄["v"] == sources.네이버_판 and 줄["at"] > 0

    def test_스케줄러가_원천을_돌린다_표가_없으면_짓고(self, 가짜시장, 원천켜기, monkeypatch):
        """사람이 스크리닝을 안 열어도 — 예전엔 스크리닝·관심종목을 열 때만 원천이 돌았다"""
        import ast
        import inspect
        import textwrap
        from app.services import scheduler
        나무 = ast.parse(textwrap.dedent(inspect.getsource(scheduler.periodic_refresh)))
        갈래 = [n for n in ast.walk(나무) if isinstance(n, ast.If) and "counter" in ast.unparse(n.test)
              and "원천_돌리기" in ast.unparse(n)]
        assert len(갈래) == 1, "스케줄러가 스크리닝 원천을 돌리지 않는다"
        조건 = compile(ast.Expression(갈래[0].test), "<스케줄러>", "eval")
        횟수 = sum(bool(eval(조건, {"counter": c})) for c in range(361, 721))   # 뜬 뒤 둘째 한 시간(루프는 10초마다)
        assert 횟수, "스케줄러가 스크리닝 원천을 한 번도 안 맡긴다"
        # 네이버 쉬는 때(3분)를 넘기자마자 맡기게 — 3분마다 부르면 몇 초만 어긋나도 한 차례를 건너뛴다
        assert 30 <= 3600 / 횟수 <= S.네이버_간격 / 3
        첫 = min(c for c in range(1, 361) if eval(조건, {"counter": c}))
        assert 첫 * 10 >= 300, "서버가 막 뜬 뒤 5분은 비켜 둔다 — 깨운 사람의 첫 화면과 표 짓기가 부딪치지 않게"
        assert "run_in_executor" in ast.unparse(갈래[0]), "받기(표 짓기)가 루프를 막지 않게 일꾼 스레드에서"
        쉼 = next(n for n in ast.walk(나무) if isinstance(n, ast.If) and "seconds_since_last_request" in ast.unparse(n.test))
        assert 갈래[0].lineno > 쉼.lineno, "아무도 안 쓰는 동안(쉬는 중)에는 돌리지 않는다"
        맡김: list = []
        monkeypatch.setattr(S, "_뒤에서_새로", lambda 시장: 맡김.append(("짓기", 시장)))
        monkeypatch.setattr(S, "_원천_챙기기", lambda 시장: 맡김.append(("원천", 시장)))
        S.원천_돌리기()
        assert 맡김 == [("짓기", "KR"), ("짓기", "US")]
        S._표["KR"] = 만들기("KR", [{"symbol": "AAA", "price": 1.0}], [])
        맡김.clear()
        S.원천_돌리기()
        assert 맡김 == [("원천", "KR"), ("짓기", "US")]
        from app.core import memory
        monkeypatch.setattr(memory, "has_headroom", lambda 이름: False)
        맡김.clear()
        S.원천_돌리기()
        assert 맡김 == [("원천", "KR")], "기다리는 사람이 없는 표는 메모리가 빠듯하면 짓지 않는다(원천 맡기기는 제 가드가 있다)"
        monkeypatch.setattr(S, "원천_받기", False)
        맡김.clear()
        S.원천_돌리기()
        assert 맡김 == [], "검사에서는 돌리지 않는다"

    def test_한종목이_맡긴_표를_지은_뒤_묵은_원천과_표의_종목으로_묻는_원천을_맡긴다(self, 가짜시장, 원천켜기):
        가짜시장["기초"] = [{"symbol": "AAA", "price": 10.0}]
        assert S.한종목("US", "AAA") is None
        _표_끝까지()
        _원천_끝까지()
        assert "sec" in 원천켜기 and "ko" in 원천켜기
        assert ("px", ["AAA"]) in 원천켜기, "표가 생겼으니 1년 시세도 — 스크리닝을 아무도 안 열어도"

    def test_원천이_새로_오면_있던_줄로_답하고_뒤에서_새_표를(self, 가짜시장, 원천켜기):
        가짜시장["기초"] = [{"symbol": "AAA", "price": 10.0}]
        assert S.한종목("US", "AAA") is None
        _표_끝까지()
        _원천_끝까지()                                 # 가짜 SEC(EPS 4) 가 왔다 — 원천판이 바뀌었다
        첫 = S._표["US"]
        assert S.한종목("US", "AAA").get("per") is None, "있던 표로 곧바로 답한다(기다리게 하지 않는다)"
        _표_끝까지()
        assert S._표["US"] is not 첫 and S.한종목("US", "AAA")["per"] == 2.5

    def test_오래된_표면_있던_줄로_답하고_뒤에서_새로(self, 가짜시장, monkeypatch):
        monkeypatch.setattr(S, "원천_받기", True)
        monkeypatch.setattr(S, "_원천_챙기기", lambda 시장: None)    # 이 검사는 원천과 상관없다
        S._원천_읽음[0] = True
        가짜시장["기초"] = [{"symbol": "AAA", "price": 1.0}]
        S.한종목("US", "AAA")
        _표_끝까지()
        첫 = S._표["US"]
        assert S.한종목("US", "AAA")["price"] == 1.0
        _표_끝까지()
        assert S._표["US"] is 첫, "멀쩡한 표를 또 지었다"
        monkeypatch.setattr(S, "표_수명", -1)
        가짜시장["기초"] = [{"symbol": "AAA", "price": 5.0}]
        assert S.한종목("US", "AAA")["price"] == 1.0, "기다리게 하지 않는다"
        _표_끝까지()
        assert S._표["US"] is not 첫 and S._표["US"].한줄("AAA")["price"] == 5.0

    def test_검사에서는_낡은_표여도_맡기지_않는다(self, 가짜시장, monkeypatch):
        맡김: list = []
        S._표["US"] = 만들기("US", [{"symbol": "AAA", "price": 1.0}], [], {})
        monkeypatch.setattr(S, "_뒤에서_새로", lambda 시장: 맡김.append(시장))
        monkeypatch.setattr(S, "표_수명", -1)
        assert S.한종목("US", "AAA")["price"] == 1.0 and 맡김 == []
        monkeypatch.setattr(S, "원천_받기", True)
        assert S.한종목("US", "AAA")["price"] == 1.0 and 맡김 == ["US"]

    def test_DB_를_읽는_동안_상태_잠금을_쥐지_않는다(self, monkeypatch):
        """관심종목 표(/screening/rows)는 이벤트 루프에서 한종목 을 부른다 — 그 잠금을 기다리면 서버가 통째로 선다"""
        잠금상태: list = []

        def 읽기(열쇠):
            잠금상태.append(S._상태잠금.locked())
            return None, 0.0
        monkeypatch.setattr(store, "읽기", 읽기)
        S.비우기()
        S._원천_불러오기()
        assert 잠금상태 and not any(잠금상태)
        assert S._원천_읽음[0] is True
        잠금상태.clear()
        S._원천_불러오기()
        assert 잠금상태 == [], "한 번만 읽는다"

    def test_같이_부르면_다_읽을_때까지_기다린다(self, monkeypatch):
        """한쪽이 DB 를 읽는 동안 다른 쪽(표 일꾼·종목 상세 재무제표)이 빈 원천으로 표를 짓지 않게"""
        import threading
        들어감, 풀어줌 = threading.Event(), threading.Event()

        def 읽기(열쇠):
            if 열쇠 == "KR_KRX":
                들어감.set()
                풀어줌.wait(5)
                return {"at": 1.0, "rows": {"AAA": {"eps": 1.0}}}, 1.0
            return None, 0.0
        monkeypatch.setattr(store, "읽기", 읽기)
        S.비우기()
        먼저 = threading.Thread(target=S._원천_불러오기)
        먼저.start()
        assert 들어감.wait(5)
        본것: list = []
        나중 = threading.Thread(target=lambda: (S._원천_불러오기(), 본것.append(S._원천.get("kr_krx") is not None)))
        나중.start()
        나중.join(0.3)
        try:
            assert 나중.is_alive(), "다 읽기 전에 빈손으로 돌아갔다"
        finally:
            풀어줌.set()
            먼저.join(5)
            나중.join(5)
        assert 본것 == [True]

    def test_원천을_못_넣어도_한_번만_읽는다(self, monkeypatch):
        """요청마다 DB 를 다시 두드리지 않게"""
        부름: list = []
        monkeypatch.setattr(store, "읽기", lambda 열쇠: (부름.append(열쇠), ({"rows": {}}, 1.0))[1])

        def 터짐(*a):
            raise ValueError("망가진 원천")
        monkeypatch.setattr(S, "_넣기", 터짐)
        S.비우기()
        with pytest.raises(ValueError):
            S._원천_불러오기()
        S._원천_불러오기()
        assert len(부름) == 1 and S._원천_읽음[0] is True


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
