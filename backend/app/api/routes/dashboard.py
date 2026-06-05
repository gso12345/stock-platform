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
from app.services.market_extras import get_kr_futures, get_kr_rates, get_us_rates
from app.services.price_fetcher import get_usdkrw
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
    loop = asyncio.get_running_loop()
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
    # 3. stale 캐시
    stale = cache.get_stale(f"idx:{name}")
    if stale and stale.get("value", 0) > 0:
        return stale
    return {"index": name, "name": INDEX_NAMES.get(name, name), "value": 0, "change": 0, "change_rate": 0}


# ── 해외 지수 조회 ─────────────────────────────────────────
async def _get_us_index(name: str) -> dict:
    # 1. 신선한 캐시
    fresh = cache.get(f"idx:{name}")
    if fresh and fresh.get("value", 0) > 0:
        return fresh
    # 2. stale 캐시
    stale = cache.get_stale(f"idx:{name}")
    if stale and stale.get("value", 0) > 0:
        return stale
    # 3. yfinance 직접 조회 (서버 재시작 직후 캐시 없을 때 fallback)
    try:
        result = await asyncio.wait_for(
            asyncio.get_running_loop().run_in_executor(None, yf_service.get_market_index, name),
            timeout=8
        )
        if result and result.get("value", 0) > 0:
            cache.set(f"idx:{name}", result, 60)
            return result
    except Exception:
        pass
    return {"index": name, "name": INDEX_NAMES.get(name, name), "value": 0, "change": 0, "change_rate": 0}


async def _get_kr_index_with_fallback(name: str) -> dict:
    result = await _get_kr_index(name)
    if result.get("value", 0) > 0:
        return result
    # yfinance 직접 fallback
    try:
        yf_result = await asyncio.wait_for(
            asyncio.get_running_loop().run_in_executor(None, yf_service.get_market_index, name),
            timeout=8
        )
        if yf_result and yf_result.get("value", 0) > 0:
            cache.set(f"idx:{name}", yf_result, 60)
            return yf_result
    except Exception:
        pass
    return result


# ── 전체 지수 ──────────────────────────────────────────────
@router.get("/indices")
async def get_all_indices():
    all_names = KR_INDICES + US_INDICES
    tasks = [_get_kr_index_with_fallback(n) if n in KR_INDICES else _get_us_index(n) for n in all_names]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    kr = [r if not isinstance(r, Exception) else {"index": n, "value": 0, "change": 0, "change_rate": 0} for r, n in zip(results, all_names) if n in KR_INDICES]
    us = [r if not isinstance(r, Exception) else {"index": n, "value": 0, "change": 0, "change_rate": 0} for r, n in zip(results, all_names) if n in US_INDICES]
    return {"kr": kr, "us": us}


# ── 국내 대시보드 ──────────────────────────────────────────
@router.get("/kr")
async def get_kr_dashboard(
    category: str = Query(default="시가총액"),
    include_news: bool = Query(default=False),
):
    loop = asyncio.get_running_loop()
    tasks = [
        asyncio.gather(*[_get_kr_index(n) for n in KR_INDICES]),
        _get_kr_rankings(category),
        _get_exchange_rate_async(),
        asyncio.wait_for(loop.run_in_executor(None, get_kr_rates), timeout=5),
        asyncio.wait_for(get_kr_futures(), timeout=5),
    ]
    if include_news:
        tasks.append(loop.run_in_executor(None, get_kr_news, 6, 100))
        results = await asyncio.gather(*tasks, return_exceptions=True)
        idx_results, rankings, exchange, rates, futures, news = results
    else:
        results = await asyncio.gather(*tasks, return_exceptions=True)
        idx_results, rankings, exchange, rates, futures = results
        news = cache.get("news:kr") or cache.get_stale("news:kr") or []
    # 타임아웃 등 오류 시 stale/빈 값으로 대체
    if isinstance(rates,   Exception): rates   = cache.get_stale("extra:kr_rates") or []
    if isinstance(futures, Exception): futures = cache.get_stale("extra:kr_futures") or []
    return {
        "indices":  idx_results,
        "kospi":    idx_results[0],
        "kosdaq":   idx_results[1],
        "rankings": rankings,
        "news":     news[:80] if news else [],
        "category": category,
        "exchange": exchange,
        "futures":  futures,
        "rates":    rates,
        "_has_kis": bool(settings.KIS_APP_KEY),
    }


async def _refresh_kr_ranking_bg(category: str):
    """백그라운드 KR 랭킹 갱신 (stale-while-revalidate)"""
    from app.services.ranking_service import fetch_naver_rank, RANK_TTL
    try:
        rows = await fetch_naver_rank(category)
        if rows:
            for i, r in enumerate(rows):
                r["rank"] = i + 1
            cache.set(f"rank:kr:{category}", rows, RANK_TTL)
    except Exception:
        pass


async def _get_kr_rankings(category: str) -> list:
    from app.services.ranking_service import fetch_naver_rank, get_kr_rankings, RANK_TTL

    if settings.KIS_APP_KEY:
        result = await kis_service.get_rankings(category)
        if result:
            return result

    # 신선한 캐시
    cached = cache.get(f"rank:kr:{category}")
    if cached:
        return cached

    # stale 캐시 → 즉시 반환 + 백그라운드 갱신 (stale-while-revalidate)
    stale = cache.get_stale(f"rank:kr:{category}")
    if stale:
        asyncio.get_running_loop().create_task(_refresh_kr_ranking_bg(category))
        return stale

    # 파생 카테고리: 기반 카테고리가 없으면 먼저 fetch
    derived_base = {"거래대금": "거래량", "신고가": "상승률", "신저가": "하락률"}
    if category in derived_base:
        base = derived_base[category]
        if not cache.get_stale(f"rank:kr:{base}"):
            base_rows = await fetch_naver_rank(base)
            if base_rows:
                for i, r in enumerate(base_rows):
                    r["rank"] = i + 1
                cache.set(f"rank:kr:{base}", base_rows, RANK_TTL)
        return get_kr_rankings(category)

    # FDR 기반 랭킹 활용 (충분한 데이터 있으면 즉시 반환 + 백그라운드 Naver 갱신)
    fdr_result = get_kr_rankings(category)
    if len(fdr_result) >= 15:
        asyncio.get_running_loop().create_task(_refresh_kr_ranking_bg(category))
        return fdr_result

    # FDR 데이터 없을 때만 직접 Naver fetch (최초 기동 직후)
    rows = await fetch_naver_rank(category)
    if rows:
        for i, r in enumerate(rows):
            r["rank"] = i + 1
        cache.set(f"rank:kr:{category}", rows, RANK_TTL)
        return rows

    return fdr_result or []


# ── 해외 대시보드 ──────────────────────────────────────────
@router.get("/us")
async def get_us_dashboard(
    category: str = Query(default="시가총액"),
    include_news: bool = Query(default=False),
):
    loop = asyncio.get_running_loop()
    tasks = [
        asyncio.gather(*[_get_us_index(n) for n in US_INDICES]),
        _get_exchange_rate_async(),
        _get_us_rankings_cached(category),
        asyncio.wait_for(loop.run_in_executor(None, get_us_rates), timeout=5),
    ]
    if include_news:
        tasks.append(loop.run_in_executor(None, get_us_news, 6, 100))

    gathered = await asyncio.gather(*tasks, return_exceptions=True)
    idx_results     = gathered[0] if not isinstance(gathered[0], Exception) else []
    exchange        = gathered[1] if not isinstance(gathered[1], Exception) else {}
    rankings        = gathered[2] if not isinstance(gathered[2], Exception) else []
    us_rates_cached = gathered[3] if not isinstance(gathered[3], Exception) else (cache.get_stale("extra:us_rates") or [])
    news = gathered[4] if include_news and not isinstance(gathered[4], Exception) else (cache.get("news:us") or cache.get_stale("news:us") or [])

    idx_map = {r["index"]: r for r in idx_results if isinstance(r, dict)}
    return {
        "indices":  idx_results,
        "sp500":    idx_map.get("SP500"),
        "nasdaq":   idx_map.get("NASDAQ"),
        "dow":      idx_map.get("DOW"),
        "sox":      idx_map.get("SOX"),
        "russell":  idx_map.get("RUSSELL"),
        "exchange": exchange,
        "rates":    us_rates_cached,
        "rankings": rankings,
        "news":     news[:80] if news else [],
        "category": category,
    }


@router.get("/us/rates")
async def us_rates():
    """미국 환율·금리·국채 — 원/달러, 연방금리, 2Y/10Y/30Y 국채, VIX"""
    loop = asyncio.get_running_loop()
    cached = cache.get("extra:us_rates") or cache.get_stale("extra:us_rates")
    if cached:
        return cached
    result = await loop.run_in_executor(None, get_us_rates)
    return result or []


async def _get_exchange_rate_async() -> dict:
    return await get_usdkrw()


async def _get_us_rankings_cached(category: str) -> list:
    result = get_us_rankings(category) or []
    # 인기 종목(20개)만 빠르게 fetch — 스타트업 프리페치 전 cold start 대응
    if len(result) < 15:
        try:
            from app.services.price_fetcher import fetch_yf_quotes
            from app.services.scheduler import POPULAR_US
            data = await asyncio.wait_for(fetch_yf_quotes(POPULAR_US), timeout=4)
            for sym, q in data.items():
                if q.get("price"):
                    q["symbol"] = sym
                    cache.set(f"price:{sym}", q, 300)
            cache.delete(f"rank:us:{category}")
            result = get_us_rankings(category) or []
        except Exception:
            pass
    return result


# ── 랭킹 ───────────────────────────────────────────────────
@router.get("/rankings/kr")
async def kr_rankings(category: str = Query(default="시가총액")):
    return await _get_kr_rankings(category)


@router.get("/rankings/us")
async def us_rankings(category: str = Query(default="시가총액")):
    return await _get_us_rankings_cached(category)


# ── 뉴스 ───────────────────────────────────────────────────
@router.get("/news/kr")
async def kr_news():
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, get_kr_news)


@router.get("/news/us")
async def us_news():
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, get_us_news)


@router.get("/exchange")
async def exchange_rate():
    return await get_usdkrw()

@router.get("/kr/futures")
async def kr_futures():
    return await get_kr_futures()

@router.get("/kr/rates")
async def kr_rates():
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, get_kr_rates)

@router.get("/kr/extras")
async def kr_extras():
    """선물 + 환율 + 금리 통합"""
    loop = asyncio.get_running_loop()
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
async def get_index_ohlcv(name: str, period: str = Query(default="1y"), interval: str = Query(default="1d")):
    name_upper = name.upper()
    loop = asyncio.get_running_loop()
    try:
        result = await asyncio.wait_for(
            loop.run_in_executor(None, yf_service.get_index_ohlcv, name_upper, period, interval),
            timeout=20
        )
        if result:
            return result
    except Exception:
        pass
    return []


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
    return {"risers": [], "fallers": []}
