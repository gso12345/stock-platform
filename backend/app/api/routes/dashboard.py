"""
대시보드 라우트
- 국내: KIS API (지수 + 랭킹) → demo 폴백
- 해외: Finnhub/yfinance (지수) → demo 폴백
"""
from fastapi import APIRouter, Query, HTTPException
import asyncio
from app.services.kis_service import kis_service
from app.services.finnhub_service import finnhub_service
from app.services.fmp_service import fmp_service
from app.services.yf_service import yf_service, INDEX_SYMBOLS, INDEX_NAMES
from app.services.news_service import get_kr_news, get_us_news
from app.services.ranking_service import get_us_rankings
from app.services.market_extras import get_kr_futures, get_kr_rates
from app.services.price_fetcher import get_usdkrw
from app.services.demo_data import (
    get_demo_index, get_demo_rankings_kr, get_demo_rankings_us, DEMO_INDICES
)
from app.core.config import settings
from app.core.cache import cache

router = APIRouter(prefix="/dashboard", tags=["대시보드"])

KR_INDICES = ["KOSPI", "KOSDAQ", "KOSPI200", "KOSDAQ150"]
US_INDICES = ["SP500", "NASDAQ", "DOW", "SOX", "RUSSELL"]

KIS_INDEX_CODES = {
    "KOSPI":    ("0001", "코스피"),
    "KOSDAQ":   ("1001", "코스닥"),
    "KOSPI200": ("2001", "코스피 200"),
    "KOSDAQ150":("2203", "코스닥 150"),
}


async def _run(fn, *args):
    loop = asyncio.get_event_loop()
    return await asyncio.wait_for(loop.run_in_executor(None, fn, *args), timeout=15)


# ── 국내 지수 조회 ─────────────────────────────────────────
async def _get_kr_index(name: str) -> dict:
    # 1. KIS API (실시간)
    if settings.KIS_APP_KEY and name in KIS_INDEX_CODES:
        code, display = KIS_INDEX_CODES[name]
        try:
            r = await kis_service.get_index(code, name, display)
            if r and r.get("value", 0) > 0:
                return r
        except Exception:
            pass
    # 2. 신선한 캐시 (스케줄러가 채운 yfinance 값)
    fresh = cache.get(f"idx:{name}")
    if fresh and fresh.get("value", 0) > 0:
        return fresh
    # 3. stale (비데모 우선)
    stale = cache.get_stale(f"idx:{name}")
    if stale and stale.get("value", 0) > 0 and not stale.get("_demo"):
        return stale
    # 4. 데모
    return get_demo_index(name) or {"index": name, "name": INDEX_NAMES.get(name, name), "value": 0, "change": 0, "change_rate": 0}


# ── 해외 지수 조회 ─────────────────────────────────────────
async def _get_us_index(name: str) -> dict:
    # 1. 신선한 캐시 (스케줄러가 갱신한 값)
    fresh = cache.get(f"idx:{name}")
    if fresh and fresh.get("value", 0) > 0:
        return fresh
    # 2. stale 캐시 (신선한 것 없을 때)
    stale = cache.get_stale(f"idx:{name}")
    if stale and stale.get("value", 0) > 0 and not stale.get("_demo"):
        return stale
    # 3. 데모 (stale도 없거나 데모인 경우)
    return get_demo_index(name) or {"index": name, "name": INDEX_NAMES.get(name, name), "value": 0, "change": 0, "change_rate": 0}


# ── 전체 지수 ──────────────────────────────────────────────
@router.get("/indices")
async def get_all_indices():
    all_names = KR_INDICES + US_INDICES
    tasks = [_get_kr_index(n) if n in KR_INDICES else _get_us_index(n) for n in all_names]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    kr = [r if not isinstance(r, Exception) else get_demo_index(n) for r, n in zip(results, all_names) if n in KR_INDICES]
    us = [r if not isinstance(r, Exception) else get_demo_index(n) for r, n in zip(results, all_names) if n in US_INDICES]
    return {"kr": kr, "us": us}


# ── 국내 대시보드 ──────────────────────────────────────────
@router.get("/kr")
async def get_kr_dashboard(category: str = Query(default="시가총액")):
    loop = asyncio.get_event_loop()
    idx_results, rankings, news, exchange, rates = await asyncio.gather(
        asyncio.gather(*[_get_kr_index(n) for n in KR_INDICES]),
        _get_kr_rankings(category),
        loop.run_in_executor(None, get_kr_news, 6, 100),
        _get_exchange_rate_async(),
        loop.run_in_executor(None, get_kr_rates),
    )
    futures = await get_kr_futures()
    return {
        "indices":  idx_results,
        "kospi":    idx_results[0],
        "kosdaq":   idx_results[1],
        "rankings": rankings,
        "news":     news[:80],
        "category": category,
        "exchange": exchange,
        "futures":  futures,
        "rates":    rates,
        "_has_kis": bool(settings.KIS_APP_KEY),
    }


async def _get_kr_rankings(category: str) -> list:
    if settings.KIS_APP_KEY:
        result = await kis_service.get_rankings(category)
        if result:
            return result
    # 캐시 폴백
    cached = cache.get_stale(f"rank:kr:{category}")
    if cached:
        return cached
    # 데모 폴백 — category 전달
    return get_demo_rankings_kr(category)


# ── 해외 대시보드 ──────────────────────────────────────────
@router.get("/us")
async def get_us_dashboard(category: str = Query(default="시가총액")):
    loop = asyncio.get_event_loop()
    idx_results, exchange, rankings, news = await asyncio.gather(
        asyncio.gather(*[_get_us_index(n) for n in US_INDICES]),
        _get_exchange_rate_async(),
        loop.run_in_executor(None, _get_us_rankings_cached, category),
        loop.run_in_executor(None, get_us_news, 6, 100),
    )
    idx_map = {r["index"]: r for r in idx_results if isinstance(r, dict)}
    return {
        "indices":  idx_results,
        "sp500":    idx_map.get("SP500"),
        "nasdaq":   idx_map.get("NASDAQ"),
        "dow":      idx_map.get("DOW"),
        "sox":      idx_map.get("SOX"),
        "russell":  idx_map.get("RUSSELL"),
        "exchange": exchange,
        "rankings": rankings,
        "news":     news[:80],
        "category": category,
    }


async def _get_exchange_rate_async() -> dict:
    return await get_usdkrw()


def _get_us_rankings_cached(category: str) -> list:
    result = get_us_rankings(category)
    if result:
        return result
    return get_demo_rankings_us(category)  # category 전달


# ── 랭킹 ───────────────────────────────────────────────────
@router.get("/rankings/kr")
async def kr_rankings(category: str = Query(default="시가총액")):
    return await _get_kr_rankings(category)


@router.get("/rankings/us")
async def us_rankings(category: str = Query(default="시가총액")):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _get_us_rankings_cached, category)


# ── 뉴스 ───────────────────────────────────────────────────
@router.get("/news/kr")
async def kr_news():
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, get_kr_news)


@router.get("/news/us")
async def us_news():
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, get_us_news)


@router.get("/exchange")
async def exchange_rate():
    return await get_usdkrw()

@router.get("/kr/futures")
async def kr_futures():
    return await get_kr_futures()

@router.get("/kr/rates")
async def kr_rates():
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, get_kr_rates)

@router.get("/kr/extras")
async def kr_extras():
    """선물 + 환율 + 금리 통합"""
    loop = asyncio.get_event_loop()
    exchange, rates, futures = await asyncio.gather(
        _get_exchange_rate_async(),
        loop.run_in_executor(None, get_kr_rates),
        get_kr_futures(),
    )
    return {"exchange": exchange, "rates": rates, "futures": futures}


# ── 지수 상세 ──────────────────────────────────────────────
@router.get("/index/{name}")
async def get_index_detail(name: str):
    name_upper = name.upper()
    if name_upper in KR_INDICES:
        info = await _get_kr_index(name_upper)
    elif name_upper in US_INDICES:
        info = await _get_us_index(name_upper)
    else:
        raise HTTPException(status_code=404, detail="지원하지 않는 지수입니다")
    return {**info, "display_name": INDEX_NAMES.get(name_upper, name_upper)}


@router.get("/index/{name}/ohlcv")
async def get_index_ohlcv(name: str, period: str = Query(default="1y")):
    name_upper = name.upper()
    loop = asyncio.get_event_loop()
    try:
        result = await asyncio.wait_for(
            loop.run_in_executor(None, yf_service.get_index_ohlcv, name_upper, period),
            timeout=20
        )
        if result:
            return result
    except Exception:
        pass
    # 데모 데이터
    from app.services.demo_data import get_demo_ohlcv, DEMO_INDICES
    demo_idx = DEMO_INDICES.get(name_upper, {})
    return get_demo_ohlcv(name_upper, period)


# ── top-movers (호환) ──────────────────────────────────────
@router.get("/top-movers")
async def get_top_movers():
    if settings.KIS_APP_KEY:
        risers, fallers = await asyncio.gather(
            kis_service.get_top_movers("rise"),
            kis_service.get_top_movers("fall"),
        )
        if risers or fallers:
            return {"risers": risers, "fallers": fallers}
    return {"risers": get_demo_rankings_kr()[:10], "fallers": []}
