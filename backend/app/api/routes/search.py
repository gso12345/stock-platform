"""
종목 검색 API
- 한국: Naver 자동완성 API (전체 KRX 종목)
- 미국: Finnhub 전 종목 검색 → 내장 DB 폴백
"""
from fastapi import APIRouter, Query, Request, Response
from pydantic import BaseModel, Field
import httpx
from app.core.http import SSL
import asyncio
import re
from slowapi import Limiter
from slowapi.util import get_remote_address
from app.services.ticker_service import search_stocks
from app.services.finnhub_service import finnhub_service
from app.core.cache import cache
from app.core.config import settings

router = APIRouter(prefix="/search", tags=["검색"])
limiter = Limiter(key_func=get_remote_address)

NAVER_AC_URL = "https://ac.stock.naver.com/ac"
NAVER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Mobile Safari/537.36",
    "Referer": "https://m.stock.naver.com/",
}


async def _naver_search(q: str) -> list[dict]:
    """Naver 자동완성 API로 전체 KRX 종목 검색"""
    try:
        # 3초. 못 받아도 내장 목록으로 찾으므로 오래 기다릴 이유가 없다 —
        # 검색창은 글자를 칠 때마다 묻는 자리다
        async with httpx.AsyncClient(timeout=3, headers=NAVER_HEADERS, verify=SSL) as cl:
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
@limiter.limit("30/minute")
async def search_route(
    request: Request,
    q: str = Query(..., min_length=1, max_length=50),
    market: str = Query(default="ALL", pattern="^(ALL|KR|US|ETF)$"),
):
    """종목 검색 — 전체 상장 종목 대상"""
    ck = f"search:{market}:{q.strip().lower()}"
    if cached := cache.get(ck):
        return {"results": cached, "total": len(cached)}

    async def 국내() -> list[dict]:
        if market not in ("ALL", "KR"):
            return []
        # Naver API로 한국 전체 종목 검색 → 안 되면 내장 DB
        return (await _naver_search(q)
                or [r for r in search_stocks(q, "KR") if r.get("market") == "KR"])

    async def 해외() -> list[dict]:
        if market not in ("ALL", "US", "ETF"):
            return []
        결과 = []
        # Finnhub으로 미국 전 종목 검색. 한글 검색어는 Finnhub 이 못 찾는다 —
        # 늘 빈손으로 와서 내장 DB 로 넘어갔다. 내장 DB 가 '애플'·'테슬라'
        # 같은 한글 이름을 알므로 바로 그쪽으로 간다(결과는 같고 왕복이 준다)
        if settings.FINNHUB_API_KEY and not re.search(r"[가-힣]", q):
            loop = asyncio.get_running_loop()
            결과 = await loop.run_in_executor(None, finnhub_service.search, q) or []
        # 폴백: 내장 DB
        return 결과 or [r for r in search_stocks(q, "US") if r.get("market") in ("US", "ETF")]

    # 국내(네이버)와 해외(Finnhub)를 **동시에** 묻는다. 예전에는 네이버가
    # 답한 뒤에야 Finnhub 에 물어서, 검색 한 번이 두 왕복을 차례로 기다렸다.
    kr_results, us_results = await asyncio.gather(국내(), 해외())

    results = (kr_results + us_results)[:30]

    # 캐시된 가격 추가
    for r in results:
        p = cache.get_stale(f"price:{r['symbol']}")
        if p:
            r["price"]       = p.get("price")
            r["change_rate"] = p.get("change_rate")
            r["currency"]    = p.get("currency", "KRW" if r.get("market") == "KR" else "USD")

    cache.set(ck, results, 300)  # 5분 캐시

    # 트렌드는 여기서 세지 않는다 — '무엇을 쳤나'가 아니라 '무엇을 찾았나'를
    # 알아야 하므로, 사용자가 결과 중 하나를 고른 시점(/search/picked)에 센다.
    return {"results": results, "total": len(results)}


class PickedIn(BaseModel):
    symbol: str = Field(min_length=1, max_length=20)
    market: str = Field(default="", max_length=8)
    name:   str = Field(default="", max_length=60)


@router.post("/picked", status_code=204)
@limiter.limit("60/minute")
def search_picked(request: Request, body: PickedIn):
    """검색 결과에서 종목을 골랐을 때 — 관리자 화면의 '검색 트렌드' 재료.

    화면 이동을 막지 않도록 아무 것도 돌려주지 않는다. 실패해도 사용자가
    알 필요가 없는 통계라 조용히 넘어간다."""
    try:
        from app.core.trends import track_search
        track_search(body.symbol, body.name, body.market)
    except Exception:
        pass
    return Response(status_code=204)


@router.get("/batch-prices")
@limiter.limit("60/minute")
def batch_prices(request: Request, symbols: str = Query(..., max_length=500)):
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
@limiter.limit("30/minute")
async def suggest(request: Request, q: str = Query(..., min_length=1, max_length=50)):
    """자동완성 — 상위 5개"""
    kr = await _naver_search(q)
    if settings.FINNHUB_API_KEY:
        loop = asyncio.get_running_loop()
        us = await loop.run_in_executor(None, finnhub_service.search, q)
        us = us[:3]
    else:
        us = search_stocks(q, "US")[:3]
    return {"results": (kr + us)[:5]}
