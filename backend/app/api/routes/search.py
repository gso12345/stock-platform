"""
종목 검색 API
- 전체 상장 종목 검색 (한국 2500+, 미국 500+)
- 배치 가격 조회 (캐시 기반)
- 관심종목 즉시 추가
"""
from fastapi import APIRouter, Query
from app.services.ticker_service import search_stocks
from app.core.cache import cache

router = APIRouter(prefix="/search", tags=["검색"])


@router.get("")
def search_route(
    q: str = Query(..., min_length=1),
    market: str = Query(default="ALL"),   # ALL, KR, US, ETF
):
    """종목 검색 — 전체 상장 종목 대상"""
    ck = f"search:{market}:{q.strip().lower()}"
    if cached := cache.get(ck):
        return {"results": cached, "total": len(cached)}

    results = search_stocks(q, market)

    # 캐시된 가격 추가
    for r in results:
        p = cache.get_stale(f"price:{r['symbol']}")
        if p:
            r["price"]       = p.get("price")
            r["change_rate"] = p.get("change_rate")
            r["currency"]    = p.get("currency","USD")
        else:
            r["price"] = None
            r["change_rate"] = None

    cache.set(ck, results, 30)
    return {"results": results, "total": len(results)}


@router.get("/batch-prices")
def batch_prices(symbols: str = Query(...)):
    """여러 종목 캐시 가격 일괄 조회"""
    sym_list = [s.strip() for s in symbols.split(",") if s.strip()][:30]
    result = {}
    for sym in sym_list:
        p = cache.get_stale(f"price:{sym}")
        result[sym] = {
            "price":       p.get("price") if p else None,
            "change_rate": p.get("change_rate") if p else None,
            "currency":    p.get("currency","USD") if p else "USD",
        } if p else None
    return result


@router.get("/suggest")
def suggest(q: str = Query(..., min_length=1)):
    """자동완성 — 상위 5개만"""
    results = search_stocks(q, "ALL")[:5]
    return {"results": results}
