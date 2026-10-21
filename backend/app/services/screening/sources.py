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
이름_네이버 = "스크리닝 · 국내 예상 PER(네이버)"
이름_DART = "스크리닝 · 국내 재무(DART)"
이름_SEC = "스크리닝 · 미국 재무(SEC)"
이름_한글 = "스크리닝 · 해외 한글 이름(네이버)"


def _재기(시작: float) -> float:
    return (time.time() - 시작) * 1000


def 국내_KRX() -> dict | None:
    """전 종목 PER·PBR·EPS·BPS·주당배당·배당수익률·업종·1/3/12개월 수익률(KRX, 요청 다섯 번)"""
    from app.services.listings import krx_listing
    시작 = time.time()
    try:
        줄들, 기준일 = krx_listing.fetch_screening_bulk()
    except Exception as e:
        health.record_fail(이름_KRX, f"{type(e).__name__}")
        return None
    if not 줄들:
        health.record_fail(이름_KRX, "지표를 못 받음(KRX 가 막혔거나 응답 모양이 바뀜)")
        return None
    업종수 = sum(1 for r in 줄들.values() if r.get("sector"))
    health.record_ok(이름_KRX, _재기(시작), f"{len(줄들):,}종목 · 업종 {업종수:,} · {기준일}")
    return {"at": time.time(), "ymd": 기준일, "rows": 줄들}


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
                out[code] = d
        await asyncio.gather(*(하나(c) for c in 코드들))
    return out


#: 네이버 종목 응답에서 스크리닝이 쓰는 칸
_네이버칸 = ("forward_per", "forward_eps", "per", "pbr", "eps", "bps", "dividend_yield")


def 국내_네이버(코드들: list[str], 동시: int = 4) -> dict[str, dict]:
    """종목마다 예상 PER·예상 EPS·52주 고저(+PER·PBR·EPS·BPS·배당 — KRX 가 막혔을 때 대신).
    {코드: {칸: 값, "at": 받은 때}} — 받은 것만. 종목마다 두 번 묻는 일이라 조금씩만 부른다"""
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
        줄["at"] = 지금
        out[code] = 줄
    if out:
        health.record_ok(이름_네이버, _재기(시작), f"{len(out)}/{len(코드들)}종목")
    else:
        health.record_fail(이름_네이버, f"{len(코드들)}종목 중 하나도 못 받음")
    return out


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
    """미국 상장사 연간 매출·순이익·영업이익·EPS·주당배당·현금흐름·설비투자·자본·부채(SEC frames)"""
    from app.services.fundamentals import sec_frames
    시작 = time.time()
    try:
        줄들, 해 = sec_frames.fetch_fundamentals()
    except Exception as e:
        health.record_fail(이름_SEC, f"{type(e).__name__}")
        return None
    if not 줄들:
        health.record_fail(이름_SEC, "못 받음(SEC 가 막혔거나 응답 모양이 바뀜)")
        return None
    health.record_ok(이름_SEC, _재기(시작), f"{len(줄들):,}종목 · {해}년")
    return {"at": time.time(), "year": 해, "rows": 줄들}


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
