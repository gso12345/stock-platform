"""
주식 순위 서비스
- 한국: FDR 전체 KRX 종목(~2500개) + Naver 실시간 순위
- 미국: Yahoo Finance 캐시 기반
"""
import asyncio
import logging
import httpx
from app.core.cache import cache
from app.services.ticker_service import get_kr_db, get_fdr_price
from app.services.yf_service import SP500_SYMBOLS

log = logging.getLogger(__name__)
RANK_TTL = 60

NAVER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.162 Mobile Safari/537.36",
    "Referer": "https://m.stock.naver.com/",
}

NAVER_TYPE_MAP = {
    "시가총액": "MARKET_CAP",
    "상승률":   "RISE",
    "하락률":   "FALL",
    "거래대금": "TRADING_VALUE",
    "거래량":   "TRADING_VOLUME",
    "신고가":   "NEW_HIGH",
    "신저가":   "NEW_LOW",
}


# ── Naver 실시간 순위 API ───────────────────────────────────
async def fetch_naver_rank(category: str, market: str = "ALL", page_size: int = 100) -> list[dict]:
    naver_type = NAVER_TYPE_MAP.get(category, "MARKET_CAP")
    url = f"https://m.stock.naver.com/api/stocks/ranks?market={market}&type={naver_type}&pageSize={page_size}&page=0"
    try:
        async with httpx.AsyncClient(timeout=10, headers=NAVER_HEADERS) as cl:
            r = await cl.get(url)
        if r.status_code != 200:
            return []
        data = r.json()
        stocks = data.get("stocks") or data.get("rankingStocks") or []
        result = []
        for s in stocks:
            code = s.get("itemCode") or s.get("stockCode") or ""
            if not code:
                continue
            mkt = s.get("marketType") or s.get("market") or "KOSPI"
            suffix = ".KS" if "KOSPI" in mkt.upper() else ".KQ"
            sym = f"{code}{suffix}"
            price = float(str(s.get("closePrice") or s.get("price") or 0).replace(",", "") or 0)
            if not price:
                continue
            result.append({
                "symbol":      sym,
                "name":        s.get("stockName") or s.get("name") or code,
                "market":      mkt,
                "price":       price,
                "change":      float(str(s.get("compareToPreviousClosePrice") or 0).replace(",", "") or 0),
                "change_rate": float(str(s.get("fluctuationsRatio") or 0).replace(",", "") or 0),
                "volume":      int(str(s.get("accumulatedTradingVolume") or s.get("volume") or 0).replace(",", "") or 0),
                "amount":      int(str(s.get("accumulatedTradingValue") or 0).replace(",", "") or 0),
                "market_cap":  int(str(s.get("marketValue") or s.get("marketCap") or 0).replace(",", "") or 0),
            })
        log.info(f"Naver 순위 API: {category} {len(result)}개")
        return result
    except Exception as e:
        log.debug(f"Naver 순위 API 실패 ({category}): {e}")
        return []


# ── FDR 전체 종목 기반 순위 ────────────────────────────────
def _build_all_kr_rows() -> list[dict]:
    """FDR 캐시에서 전체 KRX 종목 데이터 구성"""
    kr_db = get_kr_db()
    rows = []
    for item in kr_db:
        sym = item["s"]
        fdr = get_fdr_price(sym)
        live = cache.get(f"price:{sym}") or cache.get_stale(f"price:{sym}")
        # 실시간 캐시 우선, 없으면 FDR 일봉 데이터
        p = (live if live and live.get("price") and not live.get("_demo") else None) or fdr
        if not p or not p.get("price"):
            continue
        price  = p.get("price") or 0
        volume = p.get("volume") or 0
        rows.append({
            "symbol":      sym,
            "name":        item["n"],
            "market":      item["x"],
            "price":       price,
            "change":      p.get("change") or 0,
            "change_rate": p.get("change_rate") or 0,
            "volume":      volume,
            "amount":      (price * volume) if price and volume else 0,
            "market_cap":  p.get("market_cap") or 0,
            "high":        p.get("high") or 0,
            "low":         p.get("low") or 0,
        })
    return rows


def _sort_kr(rows: list[dict], category: str) -> list[dict]:
    sortable   = [r for r in rows if r.get("price")]
    unsortable = [r for r in rows if not r.get("price")]

    if category == "상승률":
        sortable.sort(key=lambda x: x.get("change_rate") or -9999, reverse=True)
    elif category == "하락률":
        sortable.sort(key=lambda x: x.get("change_rate") or 9999)
    elif category == "거래대금":
        sortable.sort(key=lambda x: x.get("amount") or 0, reverse=True)
    elif category == "거래량":
        sortable.sort(key=lambda x: x.get("volume") or 0, reverse=True)
    elif category == "신고가":
        # 당일 등락률 상위 (신고가 근접)
        sortable = [r for r in sortable if (r.get("change_rate") or 0) > 0]
        sortable.sort(key=lambda x: x.get("change_rate") or 0, reverse=True)
    elif category == "신저가":
        # 당일 등락률 하위 (신저가 근접)
        sortable = [r for r in sortable if (r.get("change_rate") or 0) < 0]
        sortable.sort(key=lambda x: x.get("change_rate") or 0)
    else:  # 시가총액
        sortable.sort(key=lambda x: x.get("market_cap") or 0, reverse=True)

    merged = sortable + unsortable
    for i, r in enumerate(merged):
        r["rank"] = i + 1
    return merged[:100]


def _build_us_rows() -> list[dict]:
    rows = []
    for sym in SP500_SYMBOLS:
        p = cache.get(f"price:{sym}") or cache.get_stale(f"price:{sym}")
        if not p:
            continue
        price  = p.get("price") or 0
        volume = p.get("volume") or 0
        rows.append({
            "symbol":      sym,
            "name":        p.get("name", sym),
            "price":       price,
            "change":      p.get("change") or 0,
            "change_rate": p.get("change_rate") or 0,
            "volume":      volume,
            "amount":      price * volume if price and volume else 0,
            "market_cap":  p.get("market_cap") or 0,
            "_demo":       p.get("_demo", False),
        })
    return rows


def _sort_us(rows: list[dict], category: str) -> list[dict]:
    sortable = [r for r in rows if r.get("price")]
    if category == "상승률":
        sortable.sort(key=lambda x: x.get("change_rate") or -9999, reverse=True)
    elif category == "하락률":
        sortable.sort(key=lambda x: x.get("change_rate") or 9999)
    elif category == "거래대금":
        sortable.sort(key=lambda x: x.get("amount") or 0, reverse=True)
    elif category == "거래량":
        sortable.sort(key=lambda x: x.get("volume") or 0, reverse=True)
    elif category in ("신고가", "신저가"):
        rev = (category == "신고가")
        sortable.sort(key=lambda x: x.get("change_rate") or 0, reverse=rev)
    else:
        sortable.sort(key=lambda x: x.get("market_cap") or 0, reverse=True)
    for i, r in enumerate(sortable):
        r["rank"] = i + 1
    return sortable[:50]


# ── 공개 인터페이스 ────────────────────────────────────────
def get_kr_rankings(category: str = "시가총액") -> list[dict]:
    ck = f"rank:kr:{category}"
    cached = cache.get(ck)
    if cached:
        return cached

    rows = _build_all_kr_rows()
    result = _sort_kr(rows, category)

    if result:
        cache.set(ck, result, RANK_TTL)
    return result


async def refresh_kr_rankings_from_naver():
    """Naver 실시간 순위로 캐시 갱신 (스케줄러에서 호출)"""
    for cat in NAVER_TYPE_MAP.keys():
        rows = await fetch_naver_rank(cat, market="ALL", page_size=100)
        if rows:
            for i, r in enumerate(rows):
                r["rank"] = i + 1
            cache.set(f"rank:kr:{cat}", rows, RANK_TTL)
    log.info("Naver 실시간 순위 갱신 완료")


def get_us_rankings(category: str = "시가총액") -> list[dict]:
    ck = f"rank:us:{category}"
    cached = cache.get(ck)
    if cached:
        return cached

    rows   = _build_us_rows()
    result = _sort_us(rows, category)

    if result:
        cache.set(ck, result, RANK_TTL)
    return result
