"""
실시간 가격 조회
- 한국 주식/지수: 네이버 금융 모바일 API (무료, 실시간)
- 미국 주식: Yahoo Finance v7/v8 (query1/query2 교차)
- 환율: 네이버 금융
"""
import httpx
import asyncio
import math
import re
import logging
from app.core.cache import cache

log = logging.getLogger(__name__)

NAVER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Linux; Android 10; SM-G981B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.162 Mobile Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "ko-KR,ko;q=0.9",
    "Referer": "https://m.stock.naver.com/",
    "Origin": "https://m.stock.naver.com",
}

YF_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
}

_yf_base_counter = 0  # query1/query2 교차용


def _safe(v) -> float | None:
    if v is None:
        return None
    try:
        # 콤마 제거 후 float 변환
        if isinstance(v, str):
            v = v.replace(",", "")
        f = float(v)
        return None if (math.isnan(f) or math.isinf(f)) else f
    except Exception:
        return None


def _yf_base() -> str:
    global _yf_base_counter
    _yf_base_counter += 1
    return "query2" if _yf_base_counter % 2 == 0 else "query1"


# ── 네이버 모바일 — 한국 주식 ──────────────────────────────
def _parse_kr_num(s) -> float:
    """'1,853조 2,703억' 같은 한국식 숫자 파싱"""
    if s is None:
        return 0
    s = str(s).replace(",", "").replace(" ", "")
    total = 0.0
    if "조" in s:
        parts = s.split("조")
        total += float(parts[0] or 0) * 1e12
        s = parts[1] if len(parts) > 1 else ""
    if "억" in s:
        parts = s.split("억")
        total += float(parts[0] or 0) * 1e8
        s = parts[1] if len(parts) > 1 else ""
    if "만" in s:
        parts = s.split("만")
        total += float(parts[0] or 0) * 1e4
    return total or _safe(s) or 0


async def fetch_naver_stock(code6: str) -> dict | None:
    """네이버 모바일 API (basic + integration) 로 한국 종목 실시간 조회"""
    try:
        async with httpx.AsyncClient(timeout=10, headers=NAVER_HEADERS) as cl:
            basic_r, intg_r = await asyncio.gather(
                cl.get(f"https://m.stock.naver.com/api/stock/{code6}/basic"),
                cl.get(f"https://m.stock.naver.com/api/stock/{code6}/integration"),
                return_exceptions=True,
            )

        # basic: 현재가·등락
        if not isinstance(basic_r, Exception) and basic_r.status_code == 200:
            b = basic_r.json()
        else:
            return None
        curr = _safe(b.get("closePrice"))
        if curr is None:
            return None
        chg  = _safe(b.get("compareToPreviousClosePrice")) or 0
        chgr = _safe(b.get("fluctuationsRatio")) or 0
        suffix = ".KQ" if "KOSDAQ" in str(b.get("stockExchangeType","")) else ".KS"

        # integration: totalInfos 배열에서 항목별 파싱
        info: dict = {}
        if not isinstance(intg_r, Exception) and intg_r.status_code == 200:
            for item in (intg_r.json().get("totalInfos") or []):
                info[item["code"]] = item.get("value","")

        def num(key): return _parse_kr_num(info.get(key))
        def pct(key):
            v = str(info.get(key,"")).replace("%","").replace("배","").replace(",","")
            return _safe(v)

        return {
            "symbol":          f"{code6}{suffix}",
            "name":            b.get("stockName",""),
            "price":           curr,
            "prev_close":      _parse_kr_num(info.get("lastClosePrice")) or (curr - chg),
            "change":          round(chg, 2),
            "change_rate":     round(chgr, 2),
            "open":            num("openPrice"),
            "high":            num("highPrice"),
            "low":             num("lowPrice"),
            "volume":          int(num("accumulatedTradingVolume")),
            "amount":          int(num("accumulatedTradingValue")),
            "market_cap":      int(num("marketValue")),
            "per":             pct("per"),
            "pbr":             pct("pbr"),
            "eps":             _parse_kr_num(info.get("eps")),
            "bps":             _parse_kr_num(info.get("bps")),
            "dividend_yield":  pct("dividendYieldRatio"),
            "week52_high":     num("highPriceOf52Weeks"),
            "week52_low":      num("lowPriceOf52Weeks"),
            "foreign_rate":    pct("foreignRate"),
            "currency":        "KRW",
        }
    except Exception as e:
        log.debug(f"네이버 주식 {code6} 실패: {e}")
        return None


async def fetch_naver_stocks(codes: list[str]) -> dict[str, dict]:
    """여러 한국 종목 병렬 조회"""
    tasks = [fetch_naver_stock(c) for c in codes]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    out = {}
    for code, r in zip(codes, results):
        if isinstance(r, dict) and r:
            out[code] = r
    return out


# ── 네이버 모바일 — 한국 지수 ──────────────────────────────
NAVER_INDEX_CODE = {
    "KOSPI":    "KOSPI",
    "KOSDAQ":   "KOSDAQ",
    "KOSPI200": "KPI200",
    "KOSDAQ150":"KSDAQ150",
}
INDEX_DISPLAY = {
    "KOSPI":"코스피","KOSDAQ":"코스닥","KOSPI200":"코스피 200","KOSDAQ150":"코스닥 150",
}


async def fetch_naver_index(name: str) -> dict | None:
    """네이버 모바일 API로 한국 지수 조회"""
    code = NAVER_INDEX_CODE.get(name)
    if not code:
        return None
    url = f"https://m.stock.naver.com/api/index/{code}/basic"
    try:
        async with httpx.AsyncClient(timeout=8, headers=NAVER_HEADERS) as cl:
            r = await cl.get(url)
        if r.status_code != 200:
            return None
        d = r.json()
        curr = _safe(d.get("closePrice"))
        chg  = _safe(d.get("compareToPreviousClosePrice"))
        chgr = _safe(d.get("fluctuationsRatio"))
        if curr is None:
            return None
        return {
            "index":       name,
            "name":        INDEX_DISPLAY.get(name, name),
            "value":       round(curr, 2),
            "change":      round(chg or 0, 2),
            "change_rate": round(chgr or 0, 2),
        }
    except Exception as e:
        log.debug(f"네이버 지수 {name} 실패: {e}")
        return None


async def fetch_naver_indices() -> dict[str, dict]:
    """한국 4대 지수 병렬 조회"""
    names = ["KOSPI","KOSDAQ","KOSPI200","KOSDAQ150"]
    tasks = [fetch_naver_index(n) for n in names]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    out = {}
    for name, r in zip(names, results):
        if isinstance(r, dict) and r:
            out[name] = r
    return out


# ── 네이버 — 환율 ──────────────────────────────────────────
async def fetch_naver_exchange() -> dict | None:
    """네이버 환율 (USDKRW)"""
    url = "https://m.stock.naver.com/api/forex/basic?symbol=FX_USDKRW"
    try:
        async with httpx.AsyncClient(timeout=8, headers=NAVER_HEADERS) as cl:
            r = await cl.get(url)
        if r.status_code == 200:
            d = r.json()
            curr = _safe(d.get("closePrice"))
            chg  = _safe(d.get("compareToPreviousClosePrice"))
            chgr = _safe(d.get("fluctuationsRatio"))
            if curr and curr > 100:
                return {"symbol":"USDKRW","name":"원/달러 환율","value":round(curr,2),"change":round(chg or 0,2),"change_rate":round(chgr or 0,4),"unit":"원"}
    except Exception:
        pass
    # 폴백: 네이버 외환 시장 정보
    url2 = "https://api.stock.naver.com/forex/close/history?stockEndType=index&code=FX_USDKRW&timeframe=day&count=2&requestType=0"
    try:
        async with httpx.AsyncClient(timeout=8, headers=NAVER_HEADERS) as cl:
            r = await cl.get(url2)
        if r.status_code == 200:
            items = r.json()
            if items and len(items) >= 2:
                curr = _safe(items[-1].get("closePrice") or items[-1].get("value"))
                prev = _safe(items[-2].get("closePrice") or items[-2].get("value"))
                if curr and curr > 100:
                    chg = curr - (prev or curr)
                    return {"symbol":"USDKRW","name":"원/달러 환율","value":round(curr,2),"change":round(chg,2),"change_rate":round(chg/(prev or 1)*100,4),"unit":"원"}
    except Exception:
        pass
    return None


# ── Yahoo Finance — 미국 주식 ──────────────────────────────
async def fetch_yf_quotes(symbols: list[str]) -> dict[str, dict]:
    """Yahoo Finance v7 멀티쿼트 (query1/query2 교차로 rate limit 완화)"""
    if not symbols:
        return {}
    base   = _yf_base()
    syms   = ",".join(symbols)
    fields = "regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketPreviousClose,regularMarketOpen,regularMarketDayHigh,regularMarketDayLow,regularMarketVolume,marketCap,shortName,longName,currency"
    url    = f"https://{base}.finance.yahoo.com/v7/finance/quote?symbols={syms}&fields={fields}"
    try:
        async with httpx.AsyncClient(timeout=12, headers=YF_HEADERS) as cl:
            r = await cl.get(url)
        if r.status_code == 429:
            log.debug(f"YF {base} 429, 다음 시도")
            return {}
        if r.status_code != 200:
            return {}
        data = r.json()
        res_list = data.get("quoteResponse", {}).get("result", [])
        out = {}
        for q in res_list:
            sym  = q.get("symbol","")
            curr = _safe(q.get("regularMarketPrice"))
            if not curr:
                continue
            out[sym] = {
                "symbol":      sym,
                "name":        q.get("longName") or q.get("shortName") or sym,
                "price":       curr,
                "prev_close":  _safe(q.get("regularMarketPreviousClose")),
                "change":      round(_safe(q.get("regularMarketChange")) or 0, 4),
                "change_rate": round(_safe(q.get("regularMarketChangePercent")) or 0, 4),
                "volume":      int(q.get("regularMarketVolume") or 0),
                "market_cap":  int(q.get("marketCap") or 0),
                "currency":    q.get("currency","USD"),
                "open":        _safe(q.get("regularMarketOpen")),
                "high":        _safe(q.get("regularMarketDayHigh")),
                "low":         _safe(q.get("regularMarketDayLow")),
            }
        return out
    except Exception as e:
        log.debug(f"YF 멀티쿼트 실패: {e}")
        return {}


async def fetch_yf_index_quotes(symbols: list[str]) -> dict[str, dict]:
    return await fetch_yf_quotes(symbols)


# ── 통합 단일 조회 ─────────────────────────────────────────
async def get_price(symbol: str, ttl: int = 30) -> dict | None:
    """캐시 우선 반환 — 실제 fetch는 스케줄러가 처리"""
    ck = f"price:{symbol}"
    return cache.get(ck) or cache.get_stale(ck)


async def get_index_price(yf_sym: str, name: str, display: str, ttl: int = 30) -> dict | None:
    ck = f"idx:{name}"
    return cache.get(ck) or cache.get_stale(ck)


async def _fetch_open_er() -> dict | None:
    """open.er-api.com — 무료 환율 API (키 불필요)"""
    try:
        async with httpx.AsyncClient(timeout=8) as cl:
            r = await cl.get("https://open.er-api.com/v6/latest/USD")
        if r.status_code != 200:
            return None
        d = r.json()
        krw = _safe(d.get("rates", {}).get("KRW"))
        if krw and krw > 100:
            return {
                "symbol":"USDKRW","name":"원/달러 환율",
                "value":round(krw, 2),"change":0,"change_rate":0,"unit":"원",
                "_source":"open.er-api.com",
            }
    except Exception as e:
        log.debug(f"open.er-api 실패: {e}")
    return None


async def get_usdkrw() -> dict:
    ck = "extra:usdkrw"
    fresh = cache.get(ck)
    if fresh and not fresh.get("_demo"):   # demo 값은 무시하고 실제 조회
        return fresh

    # 1차: 네이버 금융
    r = await fetch_naver_exchange()
    if r and r.get("value", 0) > 100:
        cache.set(ck, r, 60)
        return r

    # 2차: open.er-api.com (무료 환율 API)
    r2 = await _fetch_open_er()
    if r2:
        cache.set(ck, r2, 3600)   # 1시간 캐시 (일별 환율)
        return r2

    # 3차: Yahoo Finance
    data = await fetch_yf_quotes(["USDKRW=X"])
    if q := data.get("USDKRW=X"):
        entry = {"symbol":"USDKRW","name":"원/달러 환율","value":q["price"],"change":q["change"],"change_rate":q["change_rate"],"unit":"원"}
        cache.set(ck, entry, 60)
        return entry

    stale = cache.get_stale(ck)
    return stale or {"symbol":"USDKRW","name":"원/달러 환율","value":1384.50,"change":-2.30,"change_rate":-0.17,"unit":"원","_demo":True}
