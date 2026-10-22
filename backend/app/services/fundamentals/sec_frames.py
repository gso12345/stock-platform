"""미국 상장사 재무 — SEC(미국 증권거래위원회) XBRL frames.

스크리닝의 미국 재무(매출·순이익·PER·배당 …)는 종목마다 야후 상세(info)로 받았는데, 운영 서버에서는
야후가 그 응답을 막아 가격만 남았다(ranking_service 주석: v7/quote 도 막혀 spark 로만 받는다).
SEC 는 공시된 재무를 '개념 하나·기간 하나 → 모든 회사' 로 한 번에 준다(frames). 요청 열 몇 번이면
미국 상장사 대부분의 연간 매출·순이익·영업이익·EPS·자본·부채·주당배당·영업현금흐름·설비투자가 온다.

  · company_tickers.json                       — 회사 번호(CIK) ↔ 티커
  · frames/us-gaap/{개념}/{단위}/CY{해}.json     — 그해(달력 기준 1년) 값
  · frames/us-gaap/{개념}/{단위}/CY{해}Q4I.json  — 그해 말의 값(자본·부채처럼 '시점' 값)

매출·EPS 는 앞의 세 해도 받는다 — 스크리닝의 4년 막대(매출·EPS 흐름)와 3년 성장률이다.

달러(USD)로 공시한 값만 쓴다 — 대만 달러로 적는 TSMC 같은 해외 상장사는 빠진다(다른 돈이 섞이면
매출 순서가 틀린다). SEC 는 연락처가 든 User-Agent 를 요구하고, 초당 열 번을 넘으면 막는다.
"""
from __future__ import annotations

import logging
import time
from datetime import date

import httpx

from app.core.http import SSL

log = logging.getLogger(__name__)

TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
FRAMES_URL = "https://data.sec.gov/api/xbrl/frames/us-gaap/{개념}/{단위}/{기간}.json"
_HEADERS = {"User-Agent": "StockPlatform screener stock-platform@users.noreply.github.com",
            "Accept": "application/json"}
_TIMEOUT = 30.0
#: 요청 사이 쉬는 시간(초) — SEC 는 초당 열 번까지
_간격 = 0.2

#: 칸 → (단위, 시점 값인가, 개념들). 개념은 앞의 것부터 — 회사마다 매출을 적는 개념이 다르다
#: (2018년 회계기준이 바뀌며 RevenueFromContractWithCustomer… 로 옮긴 회사가 많다)
개념들: dict[str, tuple[str, bool, tuple[str, ...]]] = {
    "revenue":     ("USD", False, ("Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax",
                                    "SalesRevenueNet", "RevenuesNetOfInterestExpense")),
    "earnings":    ("USD", False, ("NetIncomeLoss", "ProfitLoss")),
    "op_income":   ("USD", False, ("OperatingIncomeLoss",)),
    "eps":         ("USD-per-shares", False, ("EarningsPerShareDiluted", "EarningsPerShareBasic")),
    "dps":         ("USD-per-shares", False, ("CommonStockDividendsPerShareDeclared",
                                              "CommonStockDividendsPerShareCashPaid")),
    "ocf":         ("USD", False, ("NetCashProvidedByUsedInOperatingActivities",)),
    "capex":       ("USD", False, ("PaymentsToAcquirePropertyPlantAndEquipment",)),
    "equity":      ("USD", True, ("StockholdersEquity",)),
    "liabilities": ("USD", True, ("Liabilities",)),
}
#: 4년 흐름(막대)을 내는 칸과 해 수 — 그해와 앞의 세 해
흐름칸 = ("revenue", "eps")
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
    """한 회사의 4년 흐름 → {fin_years, rev_hist, eps_hist}. 오래된 해부터, 값이 없는 해는 None.
    앞쪽의 빈 해만 뺀다 — 가운데를 빼면 '3년 전' 이 4년 전이 된다(yf_service.연간흐름 과 같다)"""
    매출 = [흐름["revenue"].get(y, {}).get(cik) for y in 해들]
    eps = [흐름["eps"].get(y, {}).get(cik) for y in 해들]
    시작 = next((i for i in range(len(해들)) if 매출[i] is not None or eps[i] is not None), None)
    if 시작 is None:
        return {}
    return {"fin_years": 해들[시작:],
            "rev_hist": [None if v is None else round(v) for v in 매출[시작:]],
            "eps_hist": [None if v is None else round(v, 2) for v in eps[시작:]]}


def fetch_fundamentals(해: int | None = None) -> tuple[dict[str, dict], int]:
    """미국 상장사 연간 재무 → ({티커: {revenue, earnings, op_income, eps, dps, ocf, capex, equity,
    liabilities, fin_years, rev_hist, eps_hist, earnings_prev, op_income_prev}}, 쓴 해). 못 받으면 ({}, 0).
    개념 하나를 못 받아도 나머지는 쓴다."""
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

        def 한칸(칸: str, 그해: int) -> dict[int, float]:
            단위, 시점, 이름들 = 개념들[칸]
            모음: dict[int, float] = {}
            for 이름 in 이름들:
                time.sleep(_간격)
                try:
                    j = _받기(client, FRAMES_URL.format(개념=이름, 단위=단위, 기간=_기간(그해, 시점)))
                except Exception as e:
                    log.debug("SEC %s %s 실패: %s", 이름, 그해, type(e).__name__)
                    continue
                for cik, 값 in 틀_읽기(j).items():
                    모음.setdefault(cik, 값)      # 앞 개념이 이긴다
            return 모음

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

    out: dict[str, dict] = {}
    for cik, 티커들 in 티커.items():
        줄 = {칸: 표[cik] for 칸, 표 in 값들.items() if cik in 표}
        if 줄:
            줄.update(흐름_줄(cik, 해들, 흐름))
            줄.update({f"{칸}_prev": 표[cik] for 칸, 표 in 전해.items() if cik in 표})
            for t in 티커들:
                out[t] = 줄
    log.info("SEC 재무(%d년) — 회사 %d곳 · 종목 %d", 해, len({c for 표 in 값들.values() for c in 표}), len(out))
    return out, 해
