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


async def _fetch_naver_one(cl: httpx.AsyncClient, code6: str) -> dict | None:
    """공유 AsyncClient로 단일 네이버 종목 조회 (connection pool 재사용)"""
    try:
        basic_r, intg_r = await asyncio.gather(
            cl.get(f"https://m.stock.naver.com/api/stock/{code6}/basic"),
            cl.get(f"https://m.stock.naver.com/api/stock/{code6}/integration"),
            return_exceptions=True,
        )

        if not isinstance(basic_r, Exception) and basic_r.status_code == 200:
            b = basic_r.json()
        else:
            return None
        curr = _safe(b.get("closePrice"))
        if curr is None:
            return None
        chg  = _safe(b.get("compareToPreviousClosePrice")) or 0
        chgr = _safe(b.get("fluctuationsRatio")) or 0

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
            "forward_per":    pct("cnsPer"),
            "pbr":            pct("pbr"),
            "eps":            _parse_kr_num(info.get("eps")) or None,
            "forward_eps":    _parse_kr_num(info.get("cnsEps")) or None,
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


async def fetch_naver_stock(code6: str) -> dict | None:
    """네이버 모바일 API (basic + integration) 로 한국 종목 실시간 조회"""
    async with httpx.AsyncClient(timeout=10, headers=NAVER_HEADERS) as cl:
        return await _fetch_naver_one(cl, code6)


async def fetch_naver_stocks(codes: list[str]) -> dict[str, dict]:
    """여러 한국 종목 병렬 조회 — 단일 AsyncClient로 connection pool 재사용"""
    if not codes:
        return {}
    async with httpx.AsyncClient(timeout=10, headers=NAVER_HEADERS) as cl:
        results = await asyncio.gather(
            *[_fetch_naver_one(cl, c) for c in codes],
            return_exceptions=True,
        )
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
    "KOSDAQ150": "KQ150",
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
            curr = _safe(d.get("closePrice") or d.get("currentIndexValue") or d.get("indexValue"))
            chg  = _safe(d.get("compareToPreviousClosePrice") or d.get("changeValue") or d.get("priceChange"))
            chgr = _safe(d.get("fluctuationsRatio") or d.get("changeRate") or d.get("rateOfChange"))
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
    "KOSDAQ": "코스닥지수", "KOSDAQ150": "코스닥 150",
}
PYKRX_INDEX_NAME_ALIASES = {
    "KOSDAQ150": ["코스닥 150", "코스닥150", "코스닥 150 지수"],
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

        aliases = [target_name] + PYKRX_INDEX_NAME_ALIASES.get(name, [])
        ticker = None
        for t in pkrx.get_index_ticker_list(market=market):
            t_name = pkrx.get_index_ticker_name(t)
            if t_name in aliases:
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

        aliases = [target_name] + PYKRX_INDEX_NAME_ALIASES.get(name, [])
        ticker = None
        for t in pkrx.get_index_ticker_list(market=market):
            t_name = pkrx.get_index_ticker_name(t)
            if t_name in aliases:
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


# ── 네이버 — 환율 (파라미터화) ────────────────────────────
async def _fetch_naver_fx(naver_symbol: str, display_name: str, symbol: str) -> dict | None:
    """네이버 환율 — naver_symbol: FX_USDKRW / FX_EURKRW 등"""
    url = f"https://m.stock.naver.com/api/forex/basic?symbol={naver_symbol}"
    try:
        async with httpx.AsyncClient(timeout=8, headers=NAVER_HEADERS) as cl:
            r = await cl.get(url)
            if r.status_code == 200:
                d = r.json()
                curr = _safe(d.get("closePrice") or d.get("currentPrice") or d.get("price"))
                chg  = _safe(d.get("compareToPreviousClosePrice") or d.get("changePrice") or d.get("change"))
                chgr = _safe(d.get("fluctuationsRatio") or d.get("changeRate") or d.get("rateOfChange"))
                if curr and curr > 100:
                    if chgr is not None and abs(chgr) < 1:
                        chgr = chgr * 100
                    if chgr is None and chg is not None and curr:
                        prev = curr - chg
                        chgr = (chg / prev * 100) if prev else 0
                    return {"symbol": symbol, "name": display_name, "value": round(curr, 2), "change": round(chg or 0, 2), "change_rate": round(chgr or 0, 2), "unit": "원"}
    except Exception:
        pass
    for url2 in [
        f"https://api.stock.naver.com/forex/close/history?stockEndType=index&code={naver_symbol}&timeframe=day&count=2&requestType=0",
        f"https://m.stock.naver.com/api/forex/history?symbol={naver_symbol}&timeframe=day&count=2",
    ]:
        try:
            async with httpx.AsyncClient(timeout=8, headers=NAVER_HEADERS) as cl:
                r = await cl.get(url2)
                if r.status_code == 200:
                    items = r.json()
                    if isinstance(items, list) and len(items) >= 2:
                        curr = _safe(items[-1].get("closePrice") or items[-1].get("value") or items[-1].get("price"))
                        prev = _safe(items[-2].get("closePrice") or items[-2].get("value") or items[-2].get("price"))
                        if curr and curr > 100:
                            chg = round(curr - (prev or curr), 2)
                            chgr = round(chg / (prev or 1) * 100, 2) if prev else 0
                            return {"symbol": symbol, "name": display_name, "value": round(curr, 2), "change": chg, "change_rate": chgr, "unit": "원"}
        except Exception:
            pass
    return None


async def fetch_naver_exchange() -> dict | None:
    """하위호환 래퍼 — USD/KRW 전용"""
    return await _fetch_naver_fx("FX_USDKRW", "원/달러 환율", "USDKRW")


# ── Yahoo Finance — 미국 주식 ──────────────────────────────
async def fetch_yf_quotes(symbols: list[str]) -> dict[str, dict]:
    """Yahoo Finance v7 멀티쿼트 (query1/query2 교차로 rate limit 완화)
    주의: fields 파라미터는 Yahoo가 검증하는 화이트리스트라 항목을 추가하면
    요청 전체가 빈 응답으로 실패할 수 있다 — 프리/애프터마켓 등 추가 필드가
    필요하면 이 배치 함수가 아니라 fetch_yf_quote_extended(단건)를 쓸 것."""
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


async def fetch_yf_quote_extended(symbol: str) -> dict | None:
    """단건 조회 + 프리마켓/애프터마켓 시세(marketState=PRE/POST). 종목 상세 페이지에서만 사용 —
    fields 화이트리스트 검증 실패 위험을 배치 조회(fetch_yf_quotes)와 분리해 격리."""
    base = _yf_base()
    fields = (
        "regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketPreviousClose,"
        "regularMarketOpen,regularMarketDayHigh,regularMarketDayLow,regularMarketVolume,marketCap,"
        "shortName,longName,currency,marketState,"
        "preMarketPrice,preMarketChange,preMarketChangePercent,"
        "postMarketPrice,postMarketChange,postMarketChangePercent"
    )
    url = f"https://{base}.finance.yahoo.com/v7/finance/quote?symbols={symbol}&fields={fields}"
    try:
        async with httpx.AsyncClient(timeout=10, headers=YF_HEADERS) as cl:
            r = await cl.get(url)
        if r.status_code != 200:
            return None
        res_list = r.json().get("quoteResponse", {}).get("result", [])
        if not res_list:
            return None
        q = res_list[0]
        market_state = q.get("marketState")
        pre_price  = _safe(q.get("preMarketPrice"))
        post_price = _safe(q.get("postMarketPrice"))
        return {
            "market_state":      market_state,
            "pre_market_price":        pre_price if market_state == "PRE" else None,
            "pre_market_change":       round(_safe(q.get("preMarketChange")) or 0, 4) if market_state == "PRE" and pre_price else None,
            "pre_market_change_rate":  round(_safe(q.get("preMarketChangePercent")) or 0, 4) if market_state == "PRE" and pre_price else None,
            "post_market_price":       post_price if market_state == "POST" else None,
            "post_market_change":      round(_safe(q.get("postMarketChange")) or 0, 4) if market_state == "POST" and post_price else None,
            "post_market_change_rate": round(_safe(q.get("postMarketChangePercent")) or 0, 4) if market_state == "POST" and post_price else None,
        }
    except Exception as e:
        log.debug(f"YF 확장 시세(프리/애프터마켓) {symbol} 실패: {e}")
        return None


async def fetch_yf_index_quotes(symbols: list[str]) -> dict[str, dict]:
    return await fetch_yf_quotes(symbols)


def _fetch_yf_quote_single_sync(symbol: str) -> dict | None:
    """YF v7 멀티쿼트가 인식하지 못하는(상장 직후/희귀 ETF 등) 종목 대비 폴백 —
    yfinance 패키지(fast_info → history 순)로 단건 조회"""
    import yfinance as yf
    try:
        fi = yf.Ticker(symbol).fast_info
        price = float(getattr(fi, "last_price", 0) or 0)
        prev  = float(getattr(fi, "previous_close", 0) or 0)
        if price > 0:
            chg  = round(price - prev, 4) if prev else 0
            chgr = round(chg / prev * 100, 4) if prev else 0
            return {"symbol": symbol, "name": symbol, "price": price, "prev_close": prev,
                    "change": chg, "change_rate": chgr, "volume": 0, "market_cap": 0, "currency": "USD"}
    except Exception:
        pass
    try:
        hist = yf.Ticker(symbol).history(period="2d", interval="1d")
        if not hist.empty:
            price = float(hist["Close"].iloc[-1])
            prev  = float(hist["Close"].iloc[-2]) if len(hist) >= 2 else price
            chg   = round(price - prev, 4)
            chgr  = round(chg / prev * 100, 4) if prev else 0
            return {"symbol": symbol, "name": symbol, "price": price, "prev_close": prev,
                    "change": chg, "change_rate": chgr, "volume": 0, "market_cap": 0, "currency": "USD"}
    except Exception:
        pass
    return None


async def fetch_yf_quotes_with_fallback(symbols: list[str]) -> dict[str, dict]:
    """배치 멀티쿼트 우선 시도 → 빠진 종목만 yfinance 단건 폴백으로 보강"""
    out = await fetch_yf_quotes(symbols)
    missing = [s for s in symbols if s not in out]
    if not missing:
        return out
    loop = asyncio.get_running_loop()
    results = await asyncio.gather(
        *(loop.run_in_executor(None, _fetch_yf_quote_single_sync, s) for s in missing),
        return_exceptions=True,
    )
    for sym, r in zip(missing, results):
        if isinstance(r, dict):
            out[sym] = r
    return out


# ── 통합 단일 조회 ─────────────────────────────────────────
async def get_price(symbol: str, ttl: int = 30) -> dict | None:
    """캐시 우선 반환 — 실제 fetch는 스케줄러가 처리"""
    ck = f"price:{symbol}"
    return cache.get(ck) or cache.get_stale(ck)


async def get_index_price(yf_sym: str, name: str, display: str, ttl: int = 30) -> dict | None:
    ck = f"idx:{name}"
    return cache.get(ck) or cache.get_stale(ck)


async def _get_fx_cached(cache_key: str, symbol: str, display_name: str) -> dict:
    """환율 캐시 조회 — 미스 시 us_rates 배치 갱신 후 재조회"""
    cached = cache.get(cache_key) or cache.get_stale(cache_key)
    if cached and cached.get("value", 0) > 0:
        return cached
    loop = asyncio.get_running_loop()
    from app.services.market_extras import _do_fetch_us_rates
    await loop.run_in_executor(None, _do_fetch_us_rates)
    return cache.get(cache_key) or cache.get_stale(cache_key) or \
        {"symbol": symbol, "name": display_name, "value": 0, "change": 0, "change_rate": 0, "unit": "원"}


async def get_usdkrw() -> dict:
    return await _get_fx_cached("extra:usdkrw", "USDKRW", "원/달러 환율")


async def get_eurkrw() -> dict:
    return await _get_fx_cached("extra:eurkrw", "EURKRW", "원/유로 환율")


async def get_jpykrw() -> dict:
    return await _get_fx_cached("extra:jpykrw", "JPYKRW", "원/100엔")
