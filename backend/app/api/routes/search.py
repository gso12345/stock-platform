"""
종목 검색 API
- 한국: Naver 자동완성 API (전체 KRX 종목)
- 미국: 내장 DB
"""
from fastapi import APIRouter, Query
import httpx
import asyncio
from app.services.ticker_service import search_stocks
from app.core.cache import cache

router = APIRouter(prefix="/search", tags=["검색"])

NAVER_AC_URL = "https://ac.stock.naver.com/ac"
NAVER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Mobile Safari/537.36",
    "Referer": "https://m.stock.naver.com/",
}


async def _naver_search(q: str) -> list[dict]:
    """Naver 자동완성 API로 전체 KRX 종목 검색"""
    try:
        async with httpx.AsyncClient(timeout=5, headers=NAVER_HEADERS) as cl:
            r = await cl.get(NAVER_AC_URL, params={"q": q, "target": "stock,index"})
        if r.status_code != 200:
            return []
        data = r.json()
        results = []
        for item in (data.get("items") or []):
            nation = item.get("nationCode", "")
            if nation != "KOR":
                continue
            code = item.get("code", "")
            type_code = item.get("typeCode", "KOSPI")
            name = item.get("name", "")
            suffix = ".KQ" if type_code == "KOSDAQ" else ".KS"
            sym = f"{code}{suffix}"
            results.append({
                "symbol":   sym,
                "name":     name,
                "market":   "KR",
                "exchange": type_code,
                "type":     "EQUITY",
                "code":     code,
                "price":    None,
                "change_rate": None,
            })
        return results
    except Exception:
        return []


@router.get("")
async def search_route(
    q: str = Query(..., min_length=1, max_length=50),
    market: str = Query(default="ALL", pattern="^(ALL|KR|US|ETF)$"),
):
    """종목 검색 — 전체 상장 종목 대상"""
    ck = f"search:{market}:{q.strip().lower()}"
    if cached := cache.get(ck):
        return {"results": cached, "total": len(cached)}

    kr_results, us_results = [], []

    if market in ("ALL", "KR"):
        # Naver API로 한국 전체 종목 검색
        kr_results = await _naver_search(q)
        if not kr_results:
            # 폴백: 내장 DB
            kr_results = [r for r in search_stocks(q, "KR") if r.get("market") == "KR"]

    if market in ("ALL", "US", "ETF"):
        us_results = [r for r in search_stocks(q, "US") if r.get("market") in ("US", "ETF")]

    results = (kr_results + us_results)[:30]

    # 캐시된 가격 추가
    for r in results:
        p = cache.get_stale(f"price:{r['symbol']}")
        if p:
            r["price"]       = p.get("price")
            r["change_rate"] = p.get("change_rate")
            r["currency"]    = p.get("currency", "KRW" if r.get("market") == "KR" else "USD")

    cache.set(ck, results, 300)  # 5분 캐시
    return {"results": results, "total": len(results)}


@router.get("/batch-prices")
def batch_prices(symbols: str = Query(..., max_length=500)):
    """여러 종목 캐시 가격 일괄 조회"""
    sym_list = [s.strip() for s in symbols.split(",") if s.strip()][:30]
    result = {}
    for sym in sym_list:
        p = cache.get_stale(f"price:{sym}")
        result[sym] = {
            "price":       p.get("price") if p else None,
            "change_rate": p.get("change_rate") if p else None,
            "currency":    p.get("currency", "USD") if p else "USD",
        } if p else None
    return result


@router.get("/suggest")
async def suggest(q: str = Query(..., min_length=1, max_length=50)):
    """자동완성 — 상위 5개"""
    kr = await _naver_search(q)
    us = search_stocks(q, "US")[:3]
    return {"results": (kr + us)[:5]}
