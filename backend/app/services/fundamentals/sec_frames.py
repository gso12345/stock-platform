"""미국 상장사 재무 — SEC(미국 증권거래위원회) XBRL frames.

스크리닝의 미국 재무(매출·순이익·PER·배당 …)는 종목마다 야후 상세(info)로 받았는데, 운영 서버에서는
야후가 그 응답을 막아 가격만 남았다(ranking_service 주석: v7/quote 도 막혀 spark 로만 받는다).
SEC 는 공시된 재무를 '개념 하나·기간 하나 → 모든 회사' 로 한 번에 준다(frames). 요청 열 몇 번이면
미국 상장사 대부분의 연간 매출·순이익·영업이익·EPS·자본·부채·주당배당·영업현금흐름·설비투자가 온다.

  · company_tickers.json                       — 회사 번호(CIK) ↔ 티커
  · frames/us-gaap/{개념}/{단위}/CY{해}.json     — 그해(달력 기준 1년) 값
  · frames/us-gaap/{개념}/{단위}/CY{해}Q4I.json  — 그해 말의 값(자본·부채처럼 '시점' 값)

매출·EPS 는 앞의 세 해도 받는다 — 스크리닝의 4년 막대(매출·EPS 흐름)와 3년 성장률이다.

해외 상장사(20-F — TSMC·ASML·노보·KB금융 …)는 국제회계기준(ifrs-full)이나 자기 나라 돈으로 적는다. 예전엔
달러로 적은 미국 회계기준 값만 받아 이 회사들이 통째로 빠졌다(사용자: "스크리닝 지표가 아예 안나오는 종목이
있어"). 이제 그 값도 받아 환율(spark)로 달러로 바꾸고 'foreign' 을 적는다 — 주당 값(EPS)은 원주 1주의 값이라
ADR 1주와 다르다(표가 시가총액 ÷ 순이익으로 PER 을 낸다). SEC 는 연락처가 든 User-Agent 를 요구하고,
초당 열 번을 넘으면 막는다.
"""
from __future__ import annotations

import logging
import time
from datetime import date

import httpx

from app.core.http import SSL

log = logging.getLogger(__name__)

TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
FRAMES_URL = "https://data.sec.gov/api/xbrl/frames/{분류}/{개념}/{단위}/{기간}.json"
_HEADERS = {"User-Agent": "StockPlatform screener stock-platform@users.noreply.github.com",
            "Accept": "application/json"}
_TIMEOUT = 30.0
#: 요청 사이 쉬는 시간(초) — SEC 는 초당 열 번까지
_간격 = 0.2

#: 칸 → (단위, 시점 값인가, 개념들). 개념은 앞의 것부터 — 회사마다 매출을 적는 개념이 다르다
#: (2018년 회계기준이 바뀌며 RevenueFromContractWithCustomer… 로 옮긴 회사가 많다)
#: 뒤에 붙인 개념들 — 기본·희석 EPS 가 같아 한 개념(BasicAndDiluted)으로 적는 회사(엑슨모빌 따위), 판매세를
#: 매출에 넣어 적는 회사(정유·담배), 보통주 몫 순이익만 적는 회사, 비지배지분까지 든 자본만 적는 회사
개념들: dict[str, tuple[str, bool, tuple[str, ...]]] = {
    "revenue":     ("USD", False, ("Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax",
                                    "SalesRevenueNet", "RevenuesNetOfInterestExpense",
                                    "RevenueFromContractWithCustomerIncludingAssessedTax")),
    "earnings":    ("USD", False, ("NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic")),
    "op_income":   ("USD", False, ("OperatingIncomeLoss",)),
    "eps":         ("USD-per-shares", False, ("EarningsPerShareDiluted", "EarningsPerShareBasic",
                                              "EarningsPerShareBasicAndDiluted")),
    "dps":         ("USD-per-shares", False, ("CommonStockDividendsPerShareDeclared",
                                              "CommonStockDividendsPerShareCashPaid")),
    "ocf":         ("USD", False, ("NetCashProvidedByUsedInOperatingActivities",)),
    "capex":       ("USD", False, ("PaymentsToAcquirePropertyPlantAndEquipment",)),
    "equity":      ("USD", True, ("StockholdersEquity",
                                  "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest")),
    "liabilities": ("USD", True, ("Liabilities",)),
    "assets":      ("USD", True, ("Assets",)),
}
#: 해외 상장사의 국제회계기준(IFRS) 개념 — 칸 → (시점 값인가, 개념들). 단위는 그 회사의 돈('TWD'·'TWD-per-shares')
IFRS개념: dict[str, tuple[bool, tuple[str, ...]]] = {
    "revenue":     (False, ("Revenue", "RevenueFromContractsWithCustomers")),
    "earnings":    (False, ("ProfitLossAttributableToOwnersOfParent", "ProfitLoss")),
    "op_income":   (False, ("ProfitLossFromOperatingActivities",)),
    "eps":         (False, ("DilutedEarningsLossPerShare", "BasicEarningsLossPerShare")),
    "ocf":         (False, ("CashFlowsFromUsedInOperatingActivities",)),
    "capex":       (False, ("PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities",)),
    "equity":      (True, ("EquityAttributableToOwnersOfParent", "Equity")),
    "liabilities": (True, ("Liabilities",)),
    "assets":      (True, ("Assets",)),
}
#: 미국 회계기준이지만 자기 나라 돈으로 적는 해외 상장사(알리바바 위안 …) — 주당배당은 뺀다(ADR 몫과 섞인다)
해외GAAP개념: dict[str, tuple[bool, tuple[str, ...]]] = {
    칸: (시점, 이름들) for 칸, (_단위, 시점, 이름들) in 개념들.items() if 칸 != "dps"}
#: IFRS 로 적는 돈(달러로 적는 셸·HSBC·BHP 도) · 자기 나라 돈의 미국 회계기준으로 적는 돈
IFRS돈 = ("USD", "EUR", "JPY", "TWD", "KRW", "GBP", "CNY", "DKK", "CHF", "INR", "BRL", "CAD", "AUD", "SEK",
         "NOK", "MXN", "ZAR", "HKD", "ILS", "CLP", "COP", "ARS", "PEN", "IDR", "PHP", "TRY", "PLN", "SGD")
해외GAAP돈 = ("CNY", "JPY", "EUR", "INR", "TWD", "KRW", "HKD", "BRL", "MXN", "GBP", "CAD")
#: 주당 값 칸 — 단위가 '돈-per-shares'
주당칸 = frozenset({"eps", "dps"})
#: 4년 흐름(막대)을 내는 칸과 해 수 — 그해와 앞의 세 해
#: 순이익도 해마다 받는다 — EPS 를 주식 종류별로만 적는 회사(알파벳 A·B·C)는 EPS 흐름이 없어서, 표가 해마다 순이익
#: ÷ 지금 주식 수로 어림한다(table)
흐름칸 = ("revenue", "eps", "earnings")
흐름해수 = 4
#: 지난해 값도 받는 칸 — 퀀트 성장 점수(순이익·영업이익 전년 대비)
전해칸 = ("earnings", "op_income")
#: 그해 값이 이보다 적게 모였으면 아직 공시가 덜 됐다(연초) — 한 해 앞을 쓴다
최소회사수 = 1500
#: 티커표가 이보다 작으면 엉뚱한 것을 받은 것이다(실제로는 1만 곳이 넘는다)
최소티커수 = 1000


def 티커표_읽기(j) -> dict[int, list[str]]:
    """company_tickers.json → {CIK: [티커, …]}. 한 회사가 여러 종목(GOOGL·GOOG)일 수 있다"""
    out: dict[int, list[str]] = {}
    for v in (j.values() if isinstance(j, dict) else []):
        if not isinstance(v, dict):
            continue
        try:
            cik = int(v.get("cik_str"))
        except (TypeError, ValueError):
            continue
        t = str(v.get("ticker") or "").strip().upper().replace(".", "-")
        if t:
            out.setdefault(cik, []).append(t)
    return out


def 틀_읽기(j) -> dict[int, float]:
    """frames 응답 → {CIK: 값}. 한 회사에 여럿이면 마지막 것(나중에 고쳐 낸 공시)"""
    out: dict[int, float] = {}
    for p in (j.get("data") if isinstance(j, dict) else None) or []:
        try:
            cik, 값 = int(p["cik"]), float(p["val"])
        except (KeyError, TypeError, ValueError):
            continue
        out[cik] = 값
    return out


def _기간(해: int, 시점: bool) -> str:
    return f"CY{해}Q4I" if 시점 else f"CY{해}"


def _받기(client: httpx.Client, 주소: str):
    r = client.get(주소, headers=_HEADERS, timeout=_TIMEOUT)
    if r.status_code == 404:
        return None                         # 그 개념·기간의 값이 없다
    r.raise_for_status()
    return r.json()


def 받을해(오늘: date | None = None) -> int:
    """어느 해의 값을 쓸까 — 지난해. 연간 보고서는 대개 3월까지 나온다"""
    return (오늘 or date.today()).year - 1


def 흐름_줄(cik: int, 해들: list[int], 흐름: dict[str, dict[int, dict[int, float]]]) -> dict:
    """한 회사의 4년 흐름 → {fin_years, rev_hist, eps_hist, ni_hist}. 오래된 해부터, 값이 없는 해는 None.
    앞쪽의 빈 해만 뺀다 — 가운데를 빼면 '3년 전' 이 4년 전이 된다(yf_service.연간흐름 과 같다)"""
    매출 = [흐름["revenue"].get(y, {}).get(cik) for y in 해들]
    eps = [흐름["eps"].get(y, {}).get(cik) for y in 해들]
    순익 = [흐름.get("earnings", {}).get(y, {}).get(cik) for y in 해들]
    시작 = next((i for i in range(len(해들)) if 매출[i] is not None or eps[i] is not None), None)
    if 시작 is None:
        return {}
    out = {"fin_years": 해들[시작:],
           "rev_hist": [None if v is None else round(v) for v in 매출[시작:]],
           "eps_hist": [None if v is None else round(v, 2) for v in eps[시작:]]}
    if any(v is not None for v in 순익[시작:]):
        out["ni_hist"] = [None if v is None else round(v) for v in 순익[시작:]]
    return out


def fetch_fundamentals(해: int | None = None, 환율: dict[str, float] | None = None) -> tuple[dict[str, dict], int]:
    """미국 상장사 연간 재무 → ({티커: {revenue, earnings, op_income, eps, dps, ocf, capex, equity, liabilities,
    assets, fin_years, rev_hist, eps_hist, earnings_prev, op_income_prev[, foreign, fin_fx]}}, 쓴 해). 못 받으면 ({}, 0).
    개념 하나를 못 받아도 나머지는 쓴다.

    환율 — {돈: 달러 값}. 있으면 해외 상장사(IFRS·자기 나라 돈)의 값도 달러로 바꿔 넣는다(모르는 돈은 건너뛴다).
    달러로 적은 미국 회계기준 값이 있는 칸은 그것이 이긴다."""
    해 = 해 or 받을해()
    with httpx.Client(follow_redirects=True, verify=SSL) as client:
        try:
            티커 = 티커표_읽기(_받기(client, TICKERS_URL))
        except Exception as e:
            log.warning("SEC 티커표 실패: %s", type(e).__name__)
            return {}, 0
        if len(티커) < 최소티커수:
            log.warning("SEC 티커표가 너무 작다(%d)", len(티커))
            return {}, 0

        def 모으기(분류: str, 이름들: tuple[str, ...], 단위: str, 기간: str) -> dict[int, float]:
            모음: dict[int, float] = {}
            for 이름 in 이름들:
                time.sleep(_간격)
                try:
                    j = _받기(client, FRAMES_URL.format(분류=분류, 개념=이름, 단위=단위, 기간=기간))
                except Exception as e:
                    log.debug("SEC %s/%s/%s %s 실패: %s", 분류, 이름, 단위, 기간, type(e).__name__)
                    continue
                for cik, 값 in 틀_읽기(j).items():
                    모음.setdefault(cik, 값)      # 앞 개념이 이긴다
            return 모음

        def 한칸(칸: str, 그해: int) -> dict[int, float]:
            단위, 시점, 이름들 = 개념들[칸]
            return 모으기("us-gaap", 이름들, 단위, _기간(그해, 시점))

        매출 = 한칸("revenue", 해)
        if len(매출) < 최소회사수:
            해 -= 1
            매출 = 한칸("revenue", 해)
        if len(매출) < 최소회사수:
            log.warning("SEC 매출이 너무 적다(%d곳)", len(매출))
            return {}, 0
        값들 = {"revenue": 매출}
        for 칸 in 개념들:
            if 칸 != "revenue":
                값들[칸] = 한칸(칸, 해)
        해들 = list(range(해 - 흐름해수 + 1, 해 + 1))
        흐름 = {칸: {해: 값들[칸]} for 칸 in 흐름칸}
        for 칸 in 흐름칸:
            for 그해 in 해들[:-1]:
                흐름[칸][그해] = 한칸(칸, 그해)
        전해 = {칸: 한칸(칸, 해 - 1) for 칸 in 전해칸}
        해외 = _해외_넣기(모으기, 해, 해들, 환율 or {}, 값들, 흐름, 전해)

    out: dict[str, dict] = {}
    for cik, 티커들 in 티커.items():
        줄 = {칸: 표[cik] for 칸, 표 in 값들.items() if cik in 표}
        if 줄:
            줄.update(흐름_줄(cik, 해들, 흐름))
            줄.update({f"{칸}_prev": 표[cik] for 칸, 표 in 전해.items() if cik in 표})
            if cik in 해외:
                줄["foreign"] = 1.0
                if 해외[cik] != "USD":
                    줄["fin_fx"] = 해외[cik]
            for t in 티커들:
                out[t] = 줄
    log.info("SEC 재무(%d년) — 회사 %d곳(해외 %d) · 종목 %d", 해, len({c for 표 in 값들.values() for c in 표}),
             len(해외), len(out))
    return out, 해


def _해외_넣기(모으기, 해: int, 해들: list[int], 환율: dict[str, float], 값들: dict, 흐름: dict, 전해: dict) -> dict[int, str]:
    """해외 상장사(IFRS 의 모든 돈 · 자기 나라 돈의 미국 회계기준)의 값을 달러로 바꿔, 아직 빈 칸에만 넣는다 →
    {넣은 회사: 원래 돈}. 그 돈으로 적은 회사가 하나도 없으면(그해 매출·순이익이 둘 다 비면) 그 돈은 더 묻지 않는다 —
    돈마다 개념을 다 물으면 요청이 수백 번이다"""
    해외: dict[int, str] = {}
    갈래 = [("ifrs-full", 돈, IFRS개념) for 돈 in IFRS돈] + [("us-gaap", 돈, 해외GAAP개념) for 돈 in 해외GAAP돈]
    for 분류, 돈, 개념표 in 갈래:
        r = 1.0 if 돈 == "USD" else 환율.get(돈)
        if not r or r <= 0:
            continue

        def 받음(칸: str, 그해: int) -> dict[int, float]:
            시점, 이름들 = 개념표[칸]
            단위 = f"{돈}-per-shares" if 칸 in 주당칸 else 돈
            return {cik: round(v * r, 4) for cik, v in 모으기(분류, 이름들, 단위, _기간(그해, 시점)).items()}

        그해매출 = 받음("revenue", 해)
        그해순익 = 받음("earnings", 해)
        if not 그해매출 and not 그해순익:
            continue
        새로: set[int] = set()

        def 채움(표: dict[int, float], 받은: dict[int, float]) -> None:
            for cik, v in 받은.items():
                if cik not in 표:
                    표[cik] = v
                    새로.add(cik)

        채움(값들["revenue"], 그해매출)
        채움(값들["earnings"], 그해순익)
        for 칸 in 개념표:
            if 칸 not in ("revenue", "earnings"):
                채움(값들.setdefault(칸, {}), 받음(칸, 해))
        for 칸 in 흐름칸:
            for 그해 in 해들[:-1]:
                채움(흐름[칸].setdefault(그해, {}), 받음(칸, 그해))
        for 칸 in 전해칸:
            채움(전해[칸], 받음(칸, 해 - 1))
        for cik in 새로:
            해외.setdefault(cik, 돈)
    return 해외
