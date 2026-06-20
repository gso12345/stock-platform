"""
실시간 가격 조회
- 한국 주식/지수: 네이버 금융 모바일 API (무료, 실시간)
- 미국 주식: Yahoo Finance v7/v8 (query1/query2 교차)
- 환율: 네이버 금융
"""
import httpx
import asyncio
import re
import logging
from app.core.cache import cache
from app.core.utils import safe_float as _safe

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


def _yf_base() -> str:
    global _yf_base_counter
    _yf_base_counter += 1
    return "query2" if _yf_base_counter % 2 == 0 else "query1"


# ── 네이버 모바일 — 한국 주식 ──────────────────────────────
def _parse_kr_num(s) -> float:
    """'1,853조 2,703억', '29,704,413백만' 같은 한국식 숫자 파싱"""
    if s is None:
        return 0
    s = str(s).replace(",", "").replace(" ", "")
    total = 0.0
    try:
        if "조" in s:
            parts = s.split("조")
            total += float(parts[0] or 0) * 1e12
            s = parts[1] if len(parts) > 1 else ""
        if "억" in s:
            parts = s.split("억")
            total += float(parts[0] or 0) * 1e8
            s = parts[1] if len(parts) > 1 else ""
        if "백만" in s:  # "만" 전에 먼저 처리 (거래대금 단위)
            parts = s.split("백만")
            total += float(parts[0] or 0) * 1e6
            s = parts[1] if len(parts) > 1 else ""
        elif "만" in s:
            parts = s.split("만")
            total += float(parts[0] or 0) * 1e4
    except (ValueError, TypeError):
        pass
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

            # basic: 현재가·등락 — 블록 안에서 처리
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

            # integration: totalInfos 배열에서 항목별 파싱 (대소문자 무관)
            info: dict = {}
            if not isinstance(intg_r, Exception) and intg_r.status_code == 200:
                for item in (intg_r.json().get("totalInfos") or []):
                    code_key = str(item.get("code","")).lower()
                    info[code_key] = item.get("value","")

            def num(key): return _parse_kr_num(info.get(key.lower()))
            def pct(key):
                v = str(info.get(key.lower(),"")).replace("%","").replace("배","").replace(",","")
                return _safe(v)

            exchange = str(b.get("stockExchangeType", {}).get("code", "KS"))
            market_suffix = ".KQ" if "KQ" in exchange or "KOSDAQ" in exchange.upper() else ".KS"

            return {
                "symbol":         f"{code6}{market_suffix}",
                "name":           b.get("stockName",""),
                "price":          curr,
                "prev_close":     _parse_kr_num(info.get("lastcloseprice")) or (curr - chg),
                "change":         round(chg, 2),
                "change_rate":    round(chgr, 2),
                "open":           num("openPrice") or None,
                "high":           num("highPrice") or None,
                "low":            num("lowPrice") or None,
                "volume":         int(num("accumulatedTradingVolume")),
                "amount":         int(num("accumulatedTradingValue")),
                "market_cap":     int(num("marketValue")),
                "per":            pct("per"),
                "forward_per":    pct("cnsPer"),   # 컨센서스 PER
                "pbr":            pct("pbr"),
                "eps":            _parse_kr_num(info.get("eps")) or None,
                "forward_eps":    _parse_kr_num(info.get("cnsEps")) or None,  # 컨센서스 EPS
                "bps":            _parse_kr_num(info.get("bps")) or None,
                "dividend_yield": pct("dividendYieldRatio"),
                "week52_high":    num("highPriceOf52Weeks") or None,
                "week52_low":     num("lowPriceOf52Weeks") or None,
                "foreign_rate":   pct("foreignRate"),
                "currency":       "KRW",
                "market":         "KOSDAQ" if "KQ" in exchange else "KOSPI",
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


# ── pykrx(KRX 공식 데이터) — 네이버/야후 모두 실패한 지수용 최종 폴백 ──
PYKRX_INDEX_MARKET = {
    "KOSPI": "KOSPI", "KOSPI200": "KOSPI",
    "KOSDAQ": "KOSDAQ", "KOSDAQ150": "KOSDAQ",
}
PYKRX_INDEX_NAME = {
    "KOSPI": "코스피", "KOSPI200": "코스피200",
    "KOSDAQ": "코스닥지수", "KOSDAQ150": "코스닥150",
}


def fetch_pykrx_index(name: str) -> dict | None:
    """KRX 공식 데이터(pykrx)로 지수 조회 — 네이버 내부 코드/야후 심볼이 안 맞을 때 보강용.
    동기 함수이므로 호출 측에서 run_in_executor로 실행해야 함."""
    market = PYKRX_INDEX_MARKET.get(name)
    target_name = PYKRX_INDEX_NAME.get(name)
    if not market or not target_name:
        return None
    try:
        from pykrx import stock as pkrx
        import datetime as dt

        ticker = None
        for t in pkrx.get_index_ticker_list(market=market):
            if pkrx.get_index_ticker_name(t) == target_name:
                ticker = t
                break
        if not ticker:
            return None

        today = dt.date.today()
        fromdate = (today - dt.timedelta(days=10)).strftime("%Y%m%d")
        todate = today.strftime("%Y%m%d")
        df = pkrx.get_index_ohlcv_by_date(fromdate, todate, ticker)
        df = df[df["종가"] > 0]
        if len(df) < 1:
            return None

        curr = float(df["종가"].iloc[-1])
        if len(df) >= 2:
            prev = float(df["종가"].iloc[-2])
            change = curr - prev
            change_rate = (change / prev) * 100 if prev else 0.0
        else:
            change = change_rate = 0.0

        return {
            "index":       name,
            "name":        INDEX_DISPLAY.get(name, name),
            "value":       round(curr, 2),
            "change":      round(change, 2),
            "change_rate": round(change_rate, 2),
        }
    except Exception as e:
        log.debug(f"pykrx 지수 {name} 실패: {e}")
        return None


def fetch_pykrx_index_ohlcv(name: str, period: str = "1y") -> list:
    """KRX 공식 데이터(pykrx)로 지수 일봉 OHLCV 조회 — 야후 심볼이 안 맞을 때 보강용.
    동기 함수이므로 호출 측에서 run_in_executor로 실행해야 함."""
    market = PYKRX_INDEX_MARKET.get(name)
    target_name = PYKRX_INDEX_NAME.get(name)
    if not market or not target_name:
        return []
    try:
        from pykrx import stock as pkrx
        import datetime as dt

        ticker = None
        for t in pkrx.get_index_ticker_list(market=market):
            if pkrx.get_index_ticker_name(t) == target_name:
                ticker = t
                break
        if not ticker:
            return []

        days_map = {
            "1d": 5, "5d": 9,
            "1mo": 31, "3mo": 92, "6mo": 183,
            "1y": 366, "2y": 731, "3y": 1100, "5y": 1830, "10y": 3660, "max": 3660,
        }
        days = days_map.get(period, 366)
        today = dt.date.today()
        fromdate = (today - dt.timedelta(days=days)).strftime("%Y%m%d")
        todate = today.strftime("%Y%m%d")
        df = pkrx.get_index_ohlcv_by_date(fromdate, todate, ticker)
        df = df[df["종가"] > 0]
        return [
            {
                "date":   idx.strftime("%Y-%m-%d"),
                "open":   round(float(row["시가"]), 2),
                "high":   round(float(row["고가"]), 2),
                "low":    round(float(row["저가"]), 2),
                "close":  round(float(row["종가"]), 2),
                "volume": int(row.get("거래량", 0)),
            }
            for idx, row in df.iterrows()
        ]
    except Exception as e:
        log.debug(f"pykrx 지수 OHLCV {name} 실패: {e}")
        return []


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
    if fresh:
        return fresh

    # 1차: 네이버 금융
    r = await fetch_naver_exchange()
    if r and r.get("value", 0) > 100:
        cache.set(ck, r, 60)
        return r

    # 2차: open.er-api.com (무료 환율 API)
    r2 = await _fetch_open_er()
    if r2:
        cache.set(ck, r2, 3600)
        return r2

    # 3차: Yahoo Finance
    data = await fetch_yf_quotes(["USDKRW=X"])
    if q := data.get("USDKRW=X"):
        entry = {"symbol":"USDKRW","name":"원/달러 환율","value":q["price"],"change":q["change"],"change_rate":q["change_rate"],"unit":"원"}
        cache.set(ck, entry, 60)
        return entry

    stale = cache.get_stale(ck)
    return stale or {"symbol":"USDKRW","name":"원/달러 환율","value":0,"change":0,"change_rate":0,"unit":"원"}
