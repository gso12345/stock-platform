"""스크리닝 원천 — 전 종목을 한 번에(또는 조금씩 돌아가며) 주는 곳들. 받기만 한다 — 언제 받을지는
service 가 정한다. 모두 {"at": 받은 때, "rows": {종목: {칸: 값}}} 꼴로 돌려주고(남길 때도 이 꼴),
못 받으면 None. 관리자 화면(시스템 → 바깥 원천)에 이름마다 성공·실패가 남는다 — 운영에서 어느 원천이
되는지는 거기서 본다(검사 환경은 바깥에 못 나가서 실제 응답을 여기서 확인할 수 없었다).
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import date

from app.core import health

log = logging.getLogger(__name__)

이름_KRX = "스크리닝 · 국내 지표(KRX)"
이름_깃헙 = "스크리닝 · 국내 산업·수익률(GitHub)"
이름_네이버 = "스크리닝 · 국내 지표(네이버 종목별)"
이름_시세 = "스크리닝 · 해외 52주·수익률(야후 1년 시세)"
이름_국내시세 = "스크리닝 · 국내 1년 수익률·RSI(야후 1년 시세)"
이름_DART = "스크리닝 · 국내 재무(DART)"
이름_SEC = "스크리닝 · 미국 재무(SEC)"
이름_한글 = "스크리닝 · 해외 한글 이름(네이버)"
이름_환율 = "스크리닝 · 해외 회사 장부 돈 환율(야후 시세)"

#: 미국에 상장한 해외 회사(ADR·20-F)가 장부를 쓰는 돈 — 그 재무를 달러로 바꾼다(TSMC 대만 달러, ASML 유로 …)
장부돈들 = ("TWD", "EUR", "JPY", "CNY", "KRW", "GBP", "DKK", "CHF", "INR", "BRL", "CAD", "AUD", "HKD", "SEK",
         "NOK", "MXN", "ILS", "ZAR", "SGD", "IDR", "PHP", "THB", "CLP", "COP", "PEN", "ARS", "TRY", "PLN", "NZD")


def _재기(시작: float) -> float:
    return (time.time() - 시작) * 1000


#: KRX 가 지난번에 로그인을 요구했나 — 회원 아이디가 없으면 다시 물어도 같으니 오래 쉰다(service)
KRX_로그인막힘 = [False]


def 국내_KRX() -> dict | None:
    """전 종목 PER·PBR·EPS·BPS·주당배당·배당수익률·업종·1/3/12개월 수익률(KRX). KRX 는 로그인한 세션에만
    자료를 준다 — settings.KRX_ID·KRX_PW 가 있으면 로그인해서 받는다"""
    from app.core.config import settings
    from app.services.listings import krx_listing
    시작 = time.time()
    try:
        줄들, 기준일 = krx_listing.fetch_screening_bulk(settings.KRX_ID, settings.KRX_PW)
    except krx_listing.KRX로그인필요:
        KRX_로그인막힘[0] = True
        health.record_fail(이름_KRX, "KRX 가 로그인을 요구함 — Render 환경변수 KRX_ID·KRX_PW(KRX 정보데이터시스템 "
                                   "회원)를 넣으면 켜진다. 그동안은 GitHub·네이버로 채운다")
        return None
    except Exception as e:
        health.record_fail(이름_KRX, f"{type(e).__name__}")
        return None
    if not 줄들:
        health.record_fail(이름_KRX, "지표를 못 받음(KRX 가 막혔거나 응답 모양이 바뀜)")
        return None
    업종수 = sum(1 for r in 줄들.values() if r.get("sector"))
    KRX_로그인막힘[0] = False
    health.record_ok(이름_KRX, _재기(시작), f"{len(줄들):,}종목 · 업종 {업종수:,} · {기준일}")
    return {"at": time.time(), "ymd": 기준일, "rows": 줄들}


def 국내_GitHub() -> dict | None:
    """국내 전 종목 산업(한국표준산업분류)·누리집·1/3개월 수익률 — KRX 에 로그인해 받은 표를 FinanceData 가 날마다
    GitHub 에 올린다(krx_listing.fetch_github_bulk). KRX 를 못 받는 동안 산업·업종·로고·수익률을 채운다"""
    from app.services.listings import krx_listing
    시작 = time.time()
    try:
        줄들, 기준일 = krx_listing.fetch_github_bulk()
    except Exception as e:
        health.record_fail(이름_깃헙, f"{type(e).__name__}")
        return None
    if len(줄들) < 500:
        health.record_fail(이름_깃헙, f"{len(줄들)}종목뿐(GitHub 에 그날 CSV 가 없거나 모양이 바뀜)")
        return None
    산업수 = sum(1 for r in 줄들.values() if r.get("industry"))
    수익률수 = sum(1 for r in 줄들.values() if r.get("return_1m") is not None)
    health.record_ok(이름_깃헙, _재기(시작), f"{len(줄들):,}종목 · 산업 {산업수:,} · 수익률 {수익률수:,} · {기준일}")
    return {"at": time.time(), "ymd": 기준일, "rows": 줄들}


NAVER_연간 = "https://m.stock.naver.com/api/stock/{코드}/finance/annual"


async def _네이버_여럿(코드들: list[str], 동시: int) -> dict[str, dict]:
    import httpx
    from app.core.http import SSL
    from app.services.market.price_fetcher import NAVER_HEADERS, _fetch_naver_one
    sem = asyncio.Semaphore(동시)
    out: dict[str, dict] = {}
    async with httpx.AsyncClient(timeout=10, headers=NAVER_HEADERS, verify=SSL) as cl:
        async def 하나(code: str):
            async with sem:
                try:
                    d = await asyncio.wait_for(_fetch_naver_one(cl, code), timeout=15)
                except Exception:
                    d = None
                if d:
                    # 연간 실적(매출·영업이익·순이익·EPS·ROE·부채비율) — DART 키가 없고 KRX 가 로그인을 요구하는
                    # 동안 국내 재무 칸은 여기서만 온다. 못 받아도 위의 지표는 쓴다
                    try:
                        r = await asyncio.wait_for(cl.get(NAVER_연간.format(코드=code)), timeout=10)
                        if r.status_code == 200:
                            d["_연간"] = 네이버_연간_읽기(r.json())
                    except Exception:
                        pass
            if d:
                out[code] = d
        await asyncio.gather(*(하나(c) for c in 코드들))
    return out


#: 네이버 종목 응답에서 스크리닝이 쓰는 칸
_네이버칸 = ("forward_per", "forward_eps", "per", "pbr", "eps", "bps", "dividend_yield")


def _네이버수(v) -> float | None:
    """'3,008,709' · '-1,234' · '12.5' → 수. '-'·'N/A'·빈칸은 None"""
    글 = str(v if v is not None else "").replace(",", "").strip()
    try:
        return float(글)
    except ValueError:
        return None


def 네이버_연간_읽기(j) -> dict:
    """네이버 종목 연간 실적(m.stock.naver.com/api/stock/{코드}/finance/annual) → 스크리닝 원천 칸 —
    rev_years·rev_hist·eps_years·eps_hist(해마다), revenue·op_income·net_income·roe·debt_ratio(마지막 해),
    op_income_prev·net_income_prev(그 앞 해). 금액은 억원 → 원. 추정(isConsensus 'Y')은 뺀다.
    응답: financeInfo.trTitleList[{key: '202412', isConsensus: 'N'}] · rowList[{title: '매출액', columns: {key: {value}}}]
    (검사 환경은 네이버에 못 나가 공개된 설명대로 읽는다 — 모양이 다르면 빈 것)"""
    info = j.get("financeInfo") if isinstance(j, dict) else None
    if not isinstance(info, dict):
        return {}
    열들 = sorted({(int(k[:4]), k) for t in info.get("trTitleList") or []
                 if isinstance(t, dict) and str(t.get("isConsensus") or "N").upper() != "Y"
                 and len(k := str(t.get("key") or "")) >= 4 and k[:4].isdigit()})
    행: dict[str, dict] = {}
    for r in info.get("rowList") or []:
        if isinstance(r, dict) and isinstance(r.get("columns"), dict):
            행.setdefault(str(r.get("title") or "").strip(), r["columns"])
    if not 열들 or not 행:
        return {}

    def 줄(*머리들: str) -> list:
        """그 제목의 행 — 같은 제목이 없으면 그 머리로 시작하는 행('EPS(원)'·'ROE(지배주주)'). 비율 행('영업이익률'·
        '매출액증가율')은 금액 행이 아니다 — 해마다 값"""
        for 머리 in 머리들:
            후보 = [칸 for 제목, 칸 in 행.items() if 제목 == 머리] or [
                칸 for 제목, 칸 in 행.items()
                if 제목.startswith(머리) and not any(글 in 제목[len(머리):] for 글 in ("률", "율"))]
            if 후보:
                return [_네이버수((후보[0].get(k) or {}).get("value") if isinstance(후보[0].get(k), dict)
                                else 후보[0].get(k)) for _y, k in 열들]
        return [None] * len(열들)

    억 = 1e8
    해들 = [y for y, _k in 열들]
    매출 = [None if v is None else v * 억 for v in 줄("매출액", "영업수익", "순영업수익")]
    영업 = [None if v is None else v * 억 for v in 줄("영업이익")]
    순익 = [None if v is None else v * 억 for v in 줄("당기순이익", "순이익")]
    eps, roe, 부채 = 줄("EPS"), 줄("ROE"), 줄("부채비율")
    있는해 = [i for i in range(len(해들)) if 매출[i] is not None or 순익[i] is not None]
    out: dict = {}
    if any(v is not None for v in 매출):
        out["rev_years"], out["rev_hist"] = 해들, 매출
    if any(v is not None for v in eps):
        out["eps_years"], out["eps_hist"] = 해들, eps
    if 있는해:
        i = 있는해[-1]
        out.update(fin_year=해들[i], revenue=매출[i], op_income=영업[i], net_income=순익[i], roe=roe[i],
                   debt_ratio=부채[i])
        if i > 0:
            out.update(op_income_prev=영업[i - 1], net_income_prev=순익[i - 1])
    return {k: v for k, v in out.items() if v is not None}


def 국내_네이버(코드들: list[str], 동시: int = 4) -> dict[str, dict]:
    """종목마다 PER·PBR·EPS·BPS·배당수익률·예상 PER·예상 EPS·52주 고저 — KRX 가 로그인을 요구해 막힌 동안
    국내 지표는 주로 여기서 온다. {코드: {칸: 값, "at": 받은 때}} — 받은 것만. 종목마다 두 번 묻는 일이라
    service 가 시가총액 큰 것부터 몇십 곳씩 나눠 부른다"""
    if not 코드들:
        return {}
    시작 = time.time()
    try:
        받음 = asyncio.run(_네이버_여럿(코드들, 동시))
    except Exception as e:
        health.record_fail(이름_네이버, f"{type(e).__name__}")
        return {}
    지금 = time.time()
    out: dict[str, dict] = {}
    for code, d in 받음.items():
        줄 = {k: d[k] for k in _네이버칸 if d.get(k) is not None}
        if d.get("week52_high"):
            줄["high_52w"] = d["week52_high"]
        if d.get("week52_low"):
            줄["low_52w"] = d["week52_low"]
        줄.update(d.get("_연간") or {})
        줄["at"] = 지금
        out[code] = 줄
    if out:
        연간수 = sum(1 for d in 받음.values() if d.get("_연간"))
        health.record_ok(이름_네이버, _재기(시작), f"{len(out)}/{len(코드들)}종목 · 연간 실적 {연간수}")
    else:
        health.record_fail(이름_네이버, f"{len(코드들)}종목 중 하나도 못 받음")
    return out


def 시세흐름_지표(종가들: list[float]) -> dict:
    """일별 종가(오래된 날부터, 1년 남짓) → 52주 고저·1/3/12개월 수익률·RSI(14). 거래일로 센다(21·63·252일)"""
    if len(종가들) < 15:
        return {}
    import pandas as pd
    from app.services.market.yf_service import _rsi14
    끝 = 종가들[-1]
    일년 = 종가들[-252:]
    out = {"high_52w": round(max(일년), 4), "low_52w": round(min(일년), 4), "rsi": _rsi14(pd.Series(종가들))}
    for 칸, 날 in (("return_1m", 21), ("return_3m", 63), ("return_1y", 252)):
        자리 = len(종가들) - 1 - 날
        if 칸 == "return_1y" and 자리 < 0 and len(종가들) >= 245:
            자리 = 0                                   # 휴장일만큼 모자란 1년 — 첫날로
        if 자리 >= 0 and 종가들[자리] > 0:
            out[칸] = round((끝 / 종가들[자리] - 1) * 100, 2)
    return {k: v for k, v in out.items() if v is not None}


def _시세흐름(심볼들: list[str], 이름: str) -> dict[str, dict]:
    """야후 종목들의 1년 일별 종가(spark) → {야후 종목: {52주 고저·수익률·RSI, "at"}} — 받은 것만"""
    if not 심볼들:
        return {}
    from app.services.market.price_fetcher import fetch_yf_closes
    시작 = time.time()
    try:
        받음 = asyncio.run(fetch_yf_closes(심볼들))
    except Exception as e:
        health.record_fail(이름, f"{type(e).__name__}")
        return {}
    지금 = time.time()
    out = {s: {**지표, "at": 지금} for s, v in 받음.items() if (지표 := 시세흐름_지표(v))}
    if out:
        health.record_ok(이름, _재기(시작), f"{len(out)}/{len(심볼들)}종목")
    else:
        health.record_fail(이름, f"{len(심볼들)}종목 중 하나도 못 받음(spark 가 막혔거나 쉬는 중)")
    return out


def 미국_시세흐름(심볼들: list[str]) -> dict[str, dict]:
    """미국 종목들의 1년 시세 → {종목: {52주 고저·수익률·RSI, "at"}}. 주요 500여 곳 밖의 전 종목은 종목별 야후 줄이
    없어 52주 고점 대비·수익률·RSI 가 비었다 — service 가 시가총액 큰 것부터 나눠 부른다"""
    return _시세흐름(심볼들, 이름_시세)


#: 국내 거래소 → 야후 종목 꼬리. 코넥스는 야후에 없다
야후꼬리 = {"KOSPI": ".KS", "KOSDAQ": ".KQ"}


def 국내_시세흐름(거래소: dict[str, str]) -> dict[str, dict]:
    """국내 종목들(코드 → KOSPI·KOSDAQ)의 1년 시세(야후 005930.KS·247540.KQ) → {코드: {52주 고저·수익률·RSI, "at"}}.
    KRX 가 로그인을 요구한 뒤로 1년 수익률·RSI 는 주요 종목(야후 줄)에만 있었다(GitHub 에는 1년 전 표가 없다)"""
    야후 = {f"{c}{야후꼬리[x]}": c for c, x in 거래소.items() if x in 야후꼬리}
    return {야후[s]: v for s, v in _시세흐름(list(야후), 이름_국내시세).items() if s in 야후}


def DART_해(오늘: date | None = None) -> str:
    """사업보고서가 다 나온 해 — 3월 말까지 공시하므로 4월부터는 지난해, 그 전엔 지지난해"""
    오늘 = 오늘 or date.today()
    return str(오늘.year - 1 if 오늘.month >= 4 else 오늘.year - 2)


def _매출흐름_잇기(줄들: dict[str, dict], 지난: dict[str, dict]) -> None:
    """그해 사업보고서의 매출 흐름(전전기·전기·당기)에 지난해 보고서의 전전기를 붙여 네 해로 — 3년 성장률은
    네 해가 있어야 낸다. 두 보고서에 다 있는 해는 그해 보고서의 값(고쳐 적은 값)을 쓴다"""
    for code, 줄 in 줄들.items():
        옛 = 지난.get(code) or {}
        해마다 = {y: v for y, v in zip(옛.get("rev_years") or [], 옛.get("rev_hist") or []) if v is not None}
        해마다.update({y: v for y, v in zip(줄.get("rev_years") or [], 줄.get("rev_hist") or []) if v is not None})
        if 해마다:
            줄["rev_years"] = sorted(해마다)
            줄["rev_hist"] = [해마다[y] for y in 줄["rev_years"]]


def 국내_DART(코드들: list[str]) -> dict | None:
    """국내 상장사의 매출·영업이익·순이익·자산·부채·자본(사업보고서 주요계정)과 네 해 매출 흐름(그해와
    지난해 사업보고서). DART 키가 없으면 None"""
    from app.core.config import settings
    if not settings.DART_API_KEY:
        return None
    from app.services.fundamentals.dart_service import dart_service
    시작, 해 = time.time(), DART_해()
    try:
        줄들 = dart_service.get_main_accounts_multi(코드들, 해)
    except Exception as e:
        health.record_fail(이름_DART, f"{type(e).__name__}")
        return None
    if len(줄들) < 300:
        health.record_fail(이름_DART, f"{len(줄들)}곳뿐({해}년)")
        return None
    try:
        _매출흐름_잇기(줄들, dart_service.get_main_accounts_multi(list(줄들), str(int(해) - 1)))
    except Exception as e:
        log.info("DART 지난해 사업보고서 실패(흐름은 세 해만): %s", type(e).__name__)
    health.record_ok(이름_DART, _재기(시작), f"{len(줄들):,}곳 · {해}년 사업보고서")
    return {"at": time.time(), "year": 해, "rows": 줄들}


def 미국_SEC() -> dict | None:
    """미국 상장사 연간 매출·순이익·영업이익·EPS·주당배당·현금흐름·설비투자·자본·부채·자산(SEC frames). 해외
    상장사(IFRS·자기 나라 돈 — TSMC·ASML·KB금융 …)는 지금 환율로 달러로 바꿔 넣는다 — 환율을 못 받으면 달러로
    적은 IFRS 회사(셸·HSBC …)만"""
    from app.services.fundamentals import sec_frames
    시작 = time.time()
    받은환율 = 환율들() or {}
    달러 = {돈: 줄["usd"] for 돈, 줄 in (받은환율.get("rows") or {}).items()}
    try:
        줄들, 해 = sec_frames.fetch_fundamentals(환율=달러)
    except Exception as e:
        health.record_fail(이름_SEC, f"{type(e).__name__}")
        return None
    if not 줄들:
        health.record_fail(이름_SEC, "못 받음(SEC 가 막혔거나 응답 모양이 바뀜)")
        return None
    해외 = sum(1 for 줄 in 줄들.values() if 줄.get("foreign"))
    health.record_ok(이름_SEC, _재기(시작), f"{len(줄들):,}종목(해외 {해외:,}) · {해}년"
                     + ("" if 달러 else " · 환율을 못 받아 해외 회사는 달러로 적은 곳만"))
    return {"at": time.time(), "year": 해, "rows": 줄들}


def 환율들(돈들: tuple[str, ...] = 장부돈들) -> dict | None:
    """돈 1 = 달러 얼마 → {"at", "rows": {돈: {"usd": 값}}}. 야후 환율 종목(TWDUSD=X …)의 5일 종가 중 마지막(spark —
    운영에서 야후 상세가 막혀도 되는 길). 받은 것만 — 모르는 돈의 재무는 바꾸지 않는다(틀린 순서보다 '모름' 이 낫다)"""
    from app.services.market.price_fetcher import fetch_yf_closes
    심볼 = {f"{d}USD=X": d for d in 돈들 if d != "USD"}
    if not 심볼:
        return None
    시작 = time.time()
    try:
        받음 = asyncio.run(fetch_yf_closes(list(심볼), 기간="5d"))
    except Exception as e:
        health.record_fail(이름_환율, f"{type(e).__name__}")
        return None
    줄들 = {심볼[s]: {"usd": float(v[-1])} for s, v in 받음.items()
          if s in 심볼 and v and isinstance(v[-1], (int, float)) and v[-1] > 0}
    if not 줄들:
        health.record_fail(이름_환율, f"{len(심볼)}개 돈 중 하나도 못 받음(spark 가 막혔거나 쉬는 중)")
        return None
    health.record_ok(이름_환율, _재기(시작), f"{len(줄들)}/{len(심볼)}개 돈")
    return {"at": time.time(), "rows": 줄들}


def 미국_한글이름() -> dict | None:
    """미국 종목 한글 이름(네이버 해외주식 시가총액 목록)"""
    from app.services.listings import naver_world
    시작 = time.time()
    try:
        이름들 = naver_world.fetch_names()
    except Exception as e:
        health.record_fail(이름_한글, f"{type(e).__name__}")
        return None
    if not 이름들:
        health.record_fail(이름_한글, "못 받음(네이버가 막혔거나 응답 모양이 바뀜) — 주요 159곳만 한글")
        return None
    health.record_ok(이름_한글, _재기(시작), f"{len(이름들):,}종목")
    return {"at": time.time(), "rows": 이름들}
