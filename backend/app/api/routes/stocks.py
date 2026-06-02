"""
종목 상세 라우트
- 국내: KIS API → DART (재무)
- 해외: Finnhub → FMP (재무)
- 폴백: yfinance (API 키 없을 때)
"""
from fastapi import APIRouter, Query, HTTPException
from typing import Literal
import asyncio
from app.services.kis_service import kis_service
from app.services.finnhub_service import finnhub_service
from app.services.dart_service import dart_service
from app.services.fmp_service import fmp_service
from app.services.yf_service import yf_service, _resolve_kr_symbol
from app.services.demo_data import get_demo_price, get_demo_ohlcv, DEMO_PRICES
from app.services.ticker_service import get_fdr_price
from app.core.config import settings
from app.core.cache import cache

router = APIRouter(prefix="/stocks", tags=["종목"])


async def _run(fn, *args):
    loop = asyncio.get_running_loop()
    return await asyncio.wait_for(loop.run_in_executor(None, fn, *args), timeout=15)


# ── 국내 주식 ──────────────────────────────────────────────
async def get_kr_price(symbol: str) -> dict:
    """KIS → 캐시 → Naver → 순위캐시 → yfinance 순으로 폴백"""
    from app.services.price_fetcher import fetch_naver_stock
    code6 = symbol.replace(".KS","").replace(".KQ","")
    ck = f"price:{symbol}"

    # 0순위: 신선한 캐시
    fresh = cache.get(ck)
    if fresh and fresh.get("price") and not fresh.get("_demo"):
        return fresh

    # 1순위: KIS 실시간
    if settings.KIS_APP_KEY:
        result = await kis_service.get_price(code6)
        if result and result.get("price"):
            cache.set(ck, result, 15)
            return result

    # 2순위: Naver 모바일 API
    try:
        naver = await fetch_naver_stock(code6)
        if naver and naver.get("price"):
            cache.set(ck, naver, 15)
            return naver
    except Exception:
        pass

    # 3순위: stale 캐시
    stale = cache.get_stale(ck)
    if stale and stale.get("price") and not stale.get("_demo"):
        return stale

    # 4순위: 순위 캐시에서 해당 종목 가격 추출
    for cat in ("시가총액", "상승률", "거래량"):
        rank_cache = cache.get_stale(f"rank:kr:{cat}") or []
        for r in rank_cache:
            if r.get("symbol") == symbol and r.get("price"):
                result = {
                    "symbol": symbol, "name": r.get("name", ""),
                    "price": r["price"], "change": r.get("change", 0),
                    "change_rate": r.get("change_rate", 0),
                    "volume": r.get("volume", 0), "market_cap": r.get("market_cap", 0),
                    "currency": "KRW",
                }
                cache.set(ck, result, 30)
                return result

    # 5순위: FDR 전일 종가
    fdr = get_fdr_price(symbol) or get_fdr_price(code6+".KS") or get_fdr_price(code6+".KQ")
    if fdr and fdr.get("price"):
        return fdr

    # 6순위: yfinance (최후 수단)
    try:
        result = await asyncio.wait_for(
            asyncio.get_running_loop().run_in_executor(None, yf_service.get_stock_price, symbol, "KR"),
            timeout=10
        )
        if result and result.get("price"):
            cache.set(ck, result, 30)
            return result
    except Exception:
        pass

    return {"symbol": symbol, "price": None, "change_rate": 0, "currency": "KRW"}


async def get_us_price(symbol: str) -> dict:
    """Finnhub → Yahoo Finance → yfinance 순으로 폴백"""
    from app.services.price_fetcher import fetch_yf_quotes
    ck = f"price:{symbol}"

    # 신선한 캐시 (30초 이내)
    fresh = cache.get(ck)
    if fresh and fresh.get("price") and not fresh.get("_demo"):
        return fresh

    # 1순위: Finnhub (실시간, IP 차단 없음)
    if settings.FINNHUB_API_KEY:
        try:
            result = await _run(finnhub_service.get_quote, symbol)
            if result and result.get("price"):
                cache.set(ck, result, 15)
                return result
        except Exception:
            pass

    # 2순위: Yahoo Finance 직접 조회
    try:
        data = await fetch_yf_quotes([symbol])
        q = data.get(symbol)
        if q and q.get("price"):
            cache.set(ck, q, 30)
            return q
    except Exception:
        pass

    # stale 캐시
    stale = cache.get_stale(ck)
    if stale and stale.get("price") and not stale.get("_demo"):
        return stale

    # 3순위: yfinance 직접 호출
    try:
        result = await _run(yf_service.get_stock_price, symbol, "US")
        if result and result.get("price"):
            cache.set(ck, result, 30)
            return result
    except Exception:
        pass

    return {"symbol": symbol, "price": None, "change_rate": 0, "currency": "USD"}


# ── 엔드포인트 ─────────────────────────────────────────────
@router.get("/{market}/{symbol}/price")
async def get_stock_price(market: Literal["KR","US","ETF"], symbol: str):
    if market == "KR":
        return await get_kr_price(symbol)
    return await get_us_price(symbol)


def _resample_to_annual(daily_or_monthly: list) -> list:
    """월봉 데이터를 연봉으로 리샘플링"""
    by_year: dict = {}
    for bar in daily_or_monthly:
        year = bar["date"][:4]
        if year not in by_year:
            by_year[year] = {"date": f"{year}-01-01", "open": bar["open"], "high": bar["high"], "low": bar["low"], "close": bar["close"], "volume": bar["volume"]}
        else:
            by_year[year]["high"]   = max(by_year[year]["high"], bar["high"])
            by_year[year]["low"]    = min(by_year[year]["low"],  bar["low"])
            by_year[year]["close"]  = bar["close"]
            by_year[year]["volume"] += bar["volume"]
    return sorted(by_year.values(), key=lambda x: x["date"])


@router.get("/{market}/{symbol}/ohlcv")
async def get_stock_ohlcv(
    market: Literal["KR","US","ETF"], symbol: str,
    period: str = Query("1y"),
    interval: str = Query("1d"),   # 1m,5m,15m,30m,60m,1d,1wk,1mo,1y
):
    """
    OHLCV 데이터 조회
    interval: 1m/5m/15m/30m/60m = 분봉, 1d = 일봉, 1wk = 주봉, 1mo = 월봉, 1y = 연봉
    period: 1d/5d/1m/3m/6m/1y/2y/3y/5y/10y/max
    """
    intraday_map = {"1m":2,"5m":5,"15m":10,"30m":20,"60m":30}
    is_intraday = interval in intraday_map
    is_annual = interval == "1y"
    # yfinance는 1y interval을 지원하지 않으므로 1mo로 가져와서 리샘플링
    yf_interval_mapped = "1mo" if is_annual else interval

    # yfinance 분봉 기간 제한: 1m=7일, 나머지=60일
    intraday_max_period = {"1m":"5d","5m":"60d","15m":"60d","30m":"60d","60m":"60d"}
    yf_period = intraday_max_period.get(interval, period) if is_intraday else period

    YF_VALID = {"1m","2m","5m","15m","30m","60m","90m","1h","1d","5d","1wk","1mo","3mo"}

    # OHLCV 캐시 (분봉 1m은 캐시 안 함, 나머지는 TTL별 캐시)
    ohlcv_ttl = {
        "5m": 60, "15m": 60, "30m": 120, "60m": 180,
        "1d": 300, "1wk": 1800, "1mo": 3600, "1y": 3600,
    }.get(interval, 0)
    ohlcv_ck = f"ohlcv:{market}:{symbol}:{period}:{interval}" if ohlcv_ttl else None
    if ohlcv_ck:
        cached_ohlcv = cache.get(ohlcv_ck)
        if cached_ohlcv is not None:
            return cached_ohlcv

    def _cache_and_return(result):
        if ohlcv_ck and result:
            cache.set(ohlcv_ck, result, ohlcv_ttl)
        return result

    if market == "KR":
        code6 = symbol.replace(".KS","").replace(".KQ","")

        # KIS API — 일봉만 지원
        if settings.KIS_APP_KEY and interval == "1d":
            result = await kis_service.get_ohlcv(code6, period)
            if result:
                return _cache_and_return(result)

        # yfinance 폴백 (분봉 포함)
        try:
            yf_iv = yf_interval_mapped if yf_interval_mapped in YF_VALID else "1d"
            result = await _run(yf_service.get_ohlcv, symbol, yf_period, yf_iv, "KR")
            if result:
                data = _resample_to_annual(result) if is_annual else result
                return _cache_and_return(data)
        except Exception:
            pass
        return get_demo_ohlcv(symbol, period)

    else:
        # Finnhub — 분봉 지원
        if settings.FINNHUB_API_KEY:
            finnhub_res_map = {"1m":"1","5m":"5","15m":"15","30m":"30","60m":"60","1d":"D","1wk":"W","1mo":"M","1y":"M"}
            resolution = finnhub_res_map.get(interval, "D")
            result = await _run(finnhub_service.get_candles, symbol, yf_period if is_intraday else period, resolution)
            if result:
                data = _resample_to_annual(result) if is_annual else result
                return _cache_and_return(data)

        # yfinance 폴백 (분봉 포함)
        try:
            yf_iv = yf_interval_mapped if yf_interval_mapped in YF_VALID else "1d"
            result = await _run(yf_service.get_ohlcv, symbol, yf_period, yf_iv, "US")
            if result:
                data = _resample_to_annual(result) if is_annual else result
                return _cache_and_return(data)
        except Exception:
            pass
        return get_demo_ohlcv(symbol, period)


@router.get("/{market}/{symbol}/detail")
async def get_stock_detail(market: Literal["KR","US","ETF"], symbol: str):
    if market == "KR":
        from app.services.price_fetcher import fetch_naver_stock
        code6 = symbol.replace(".KS","").replace(".KQ","")

        # 신선한 캐시에 open/high/low까지 있으면 Naver 재요청 생략
        price = None
        fresh = cache.get(f"price:{symbol}")
        if fresh and fresh.get("price") and fresh.get("open") and not fresh.get("_demo"):
            price = fresh
        else:
            try:
                price = await fetch_naver_stock(code6)
            except Exception:
                pass

        # Naver 실패 시 캐시 → yfinance 폴백
        if not price or not price.get("price"):
            price = await get_kr_price(symbol)

        if not price or not price.get("price"):
            return {"symbol": symbol, "price": None, "currency": "KRW"}

        # 종목명이 없거나 코드와 같으면 보완
        if not price.get("name") or price.get("name") == symbol:
            price["name"] = price.get("name") or code6

        # 시가/고가/저가/전일종가 없으면 OHLCV에서 보완
        if not price.get("open") or not price.get("prev_close"):
            try:
                ohlcv = await asyncio.wait_for(
                    asyncio.get_running_loop().run_in_executor(None, yf_service.get_ohlcv, symbol, "5d", "1d", "KR"),
                    timeout=10
                )
                if ohlcv and len(ohlcv) >= 2:
                    latest = ohlcv[-1]
                    prev   = ohlcv[-2]
                    if not price.get("open"):       price["open"]       = latest.get("open")
                    if not price.get("high"):       price["high"]       = latest.get("high")
                    if not price.get("low"):        price["low"]        = latest.get("low")
                    if not price.get("prev_close"): price["prev_close"] = prev.get("close")
            except Exception:
                pass

        # fundamentals 캐시에서 재무지표 보완 (forward_per, peg, ev_ebitda 등)
        fund_data = cache.get(f"fund:{symbol}") or cache.get_stale(f"fund:{symbol}")
        if fund_data:
            for key in ("forward_per", "peg", "ev_ebitda", "ev_revenue", "enterprise_value",
                        "psr", "forward_eps", "roe", "roa", "gross_margin", "op_margin",
                        "net_margin", "debt_ratio", "current_ratio", "quick_ratio",
                        "beta", "sector", "industry", "description"):
                if not price.get(key) and fund_data.get(key) is not None:
                    price[key] = fund_data[key]

        return price
    else:
        # US: Finnhub 우선 → 캐시 → yfinance 폴백
        # Finnhub으로 가격+재무 통합 조회
        if settings.FINNHUB_API_KEY:
            try:
                detail = await _run(finnhub_service.get_stock_detail, symbol)
                if detail and detail.get("price"):
                    # Finnhub은 volume을 제공하지 않으므로 YF 캐시에서 보완
                    prev = cache.get_stale(f"price:{symbol}") or {}
                    for field in ("volume", "market_cap", "name"):
                        if not detail.get(field) and prev.get(field):
                            detail[field] = prev[field]
                    # 거래대금 계산
                    if detail.get("price") and detail.get("volume"):
                        detail["amount"] = detail["price"] * detail["volume"]
                    cache.set(f"price:{symbol}", detail, 15)
                    return detail
            except Exception:
                pass

        fund_ck = f"fund:{symbol}"
        fund_cached = cache.get(fund_ck) or cache.get_stale(fund_ck)

        cached = cache.get_stale(f"price:{symbol}")
        if cached and cached.get("price") and not cached.get("_demo"):
            if fund_cached:
                return {**cached, **fund_cached}
            try:
                fund = await asyncio.wait_for(
                    asyncio.get_running_loop().run_in_executor(None, yf_service.get_fundamentals, symbol, "US"),
                    timeout=15
                )
                return {**cached, **(fund or {})}
            except Exception:
                return cached

        # 캐시 없으면 price + fundamentals 병렬 fetch
        try:
            price, fund = await asyncio.gather(
                _run(yf_service.get_stock_price, symbol, "US"),
                _run(yf_service.get_fundamentals, symbol, "US"),
                return_exceptions=True,
            )
            p = price if isinstance(price, dict) else {}
            f = fund  if isinstance(fund,  dict) else {}
            result = {**p, **f}
            if result.get("price"):
                cache.set(f"price:{symbol}", result, 30)
            return result or {"symbol": symbol, "price": None, "currency": "USD"}
        except Exception:
            return {"symbol": symbol, "price": None, "currency": "USD"}


@router.get("/{market}/{symbol}/fundamentals")
async def get_fundamentals(market: Literal["KR","US","ETF"], symbol: str):
    """벨류에이션 지표 (PER, PBR, ROE 등)"""
    ck = f"fund:{symbol}"
    cached = cache.get(ck)
    if cached:
        return cached
    if market == "KR":
        # Naver integration에서 먼저 가져오기
        from app.services.price_fetcher import fetch_naver_stock
        code6 = symbol.replace(".KS","").replace(".KQ","")
        try:
            naver = await fetch_naver_stock(code6)
            if naver:
                fund = {k: naver.get(k) for k in ("per","pbr","eps","bps","dividend_yield","week52_high","week52_low","market_cap") if naver.get(k) is not None}
                if fund:
                    cache.set(ck, fund, 3600)
                    return fund
        except Exception:
            pass
    # yfinance 폴백
    try:
        result = await asyncio.wait_for(
            asyncio.get_running_loop().run_in_executor(None, yf_service.get_fundamentals, symbol, market),
            timeout=10
        )
        if result:
            cache.set(ck, result, 3600)
        return result or {}
    except Exception:
        return {}


@router.get("/{market}/{symbol}/financials")
async def get_financials(market: Literal["KR","US","ETF"], symbol: str):
    if market == "KR":
        if settings.DART_API_KEY:
            result = await _run(dart_service.get_financials, symbol)
            if result.get("annual") or result.get("quarterly"):
                return result
        # yfinance 폴백 (재무제표)
        return await _yf_financials(symbol, market)
    else:
        if settings.FMP_API_KEY:
            result = await _run(fmp_service.get_financials, symbol)
            if result.get("annual") or result.get("quarterly"):
                return result
        return await _yf_financials(symbol, market)


async def _yf_financials(symbol: str, market: str) -> dict:
    """yfinance 재무제표 폴백"""
    import yfinance as yf
    if market == "KR":
        symbol = _resolve_kr_symbol(symbol, "KS")
    def _fetch():
        t = yf.Ticker(symbol)
        result = {"annual": [], "quarterly": []}
        for attr, key in [("financials", "annual"), ("quarterly_financials", "quarterly")]:
            try:
                df = getattr(t, attr)
                if df is None or df.empty:
                    continue
                rows = []
                for col in df.columns:
                    period = str(col)[:10]
                    def sv(rn):
                        try:
                            v = df.loc[rn, col]
                            return int(v) if v == v else None
                        except: return None
                    revenue    = sv("Total Revenue")
                    op_income  = sv("Operating Income") or sv("EBIT")
                    net_income = sv("Net Income")
                    rows.append({"period": period, "revenue": revenue, "op_income": op_income, "net_income": net_income})
                result[key] = sorted(rows, key=lambda x: x["period"])
            except Exception:
                pass
        return result
    try:
        loop = asyncio.get_running_loop()
        return await asyncio.wait_for(loop.run_in_executor(None, _fetch), timeout=15)
    except Exception:
        return {"annual": [], "quarterly": []}


@router.get("/{market}/{symbol}/metrics-history")
async def get_metrics_history(market: Literal["KR","US","ETF"], symbol: str):
    """재무지표 연간/분기별 추이 (yfinance)"""
    from app.core.cache import cache
    ck = f"metrics_hist2:{symbol}"
    if c := cache.get(ck):
        return c

    import yfinance as yf
    yf_sym = _resolve_kr_symbol(symbol, "KS") if market == "KR" else symbol

    def _process(fin_df, bal_df, shares, hist):
        """income + balance sheet 결합하여 지표 dict 반환"""
        rows: dict = {}

        def sv(df, row, col):
            try:
                v = df.loc[row, col]
                return float(v) if v == v and v is not None else None
            except Exception:
                return None

        if fin_df is not None and not fin_df.empty:
            for col in fin_df.columns:
                p = str(col)[:10]
                rows.setdefault(p, {"period": p})
                rev   = sv(fin_df, "Total Revenue", col)
                op    = sv(fin_df, "Operating Income", col) or sv(fin_df, "EBIT", col)
                net   = sv(fin_df, "Net Income", col)
                gross = sv(fin_df, "Gross Profit", col)
                rows[p]["revenue"]    = int(rev) if rev else None
                rows[p]["op_income"]  = int(op)  if op  else None
                rows[p]["net_income"] = int(net) if net else None
                if rev and op:   rows[p]["op_margin"]    = round(op / rev * 100, 2)
                if rev and net:  rows[p]["net_margin"]   = round(net / rev * 100, 2)
                if rev and gross:rows[p]["gross_margin"] = round(gross / rev * 100, 2)
                if net and shares: rows[p]["eps"] = round(net / shares, 2)

        if bal_df is not None and not bal_df.empty:
            for col in bal_df.columns:
                p = str(col)[:10]
                rows.setdefault(p, {"period": p})
                equity  = sv(bal_df, "Stockholders Equity", col) or sv(bal_df, "Total Stockholder Equity", col)
                debt    = sv(bal_df, "Total Debt", col)
                cur_a   = sv(bal_df, "Current Assets", col)
                cur_l   = sv(bal_df, "Current Liabilities", col)
                inv     = sv(bal_df, "Inventory", col)
                net     = rows[p].get("net_income")
                if equity and equity != 0:
                    if net:   rows[p]["roe"]        = round(net / equity * 100, 2)
                    if debt:  rows[p]["debt_ratio"]  = round(debt / equity * 100, 2)
                    if shares:rows[p]["bps"]         = round(equity / shares, 2)
                if cur_a and cur_l and cur_l != 0:
                    rows[p]["current_ratio"] = round(cur_a / cur_l, 2)
                    if inv: rows[p]["quick_ratio"] = round((cur_a - inv) / cur_l, 2)

        # 해당 기간 말 주가로 PER/PBR/PSR 계산
        if hist is not None and not hist.empty:
            import pandas as pd
            for p, row in rows.items():
                try:
                    p_date = pd.Timestamp(p)
                    # 기간 말 이전 가장 가까운 종가
                    past = hist[hist.index <= p_date]
                    if past.empty:
                        continue
                    close = float(past["Close"].iloc[-1])
                    row["period_close"] = round(close, 2)
                    if row.get("eps") and row["eps"] != 0:
                        row["per"] = round(close / row["eps"], 2)
                    if row.get("bps") and row["bps"] != 0:
                        row["pbr"] = round(close / row["bps"], 2)
                    rev = row.get("revenue")
                    if rev and rev != 0 and shares:
                        row["psr"] = round(close / (rev / shares), 2)
                except Exception:
                    pass

        return sorted(rows.values(), key=lambda x: x["period"])

    # ── _process와 같은 레벨 (get_metrics_history 스코프) ──────────

    def _add_growth(sorted_list: list):
        """YoY 성장률 계산 — 이미 정렬된 rows 리스트에 in-place 추가"""
        for i, row in enumerate(sorted_list):
            if i == 0:
                continue
            prev = sorted_list[i - 1]
            for key, gkey in [
                ("revenue",    "revenue_growth"),
                ("op_income",  "op_income_growth"),
                ("net_income", "net_income_growth"),
            ]:
                cv, pv = row.get(key), prev.get(key)
                if cv and pv and pv != 0:
                    row[gkey] = round((cv - pv) / abs(pv) * 100, 2)

    def _process_cf(cf_df) -> dict:
        """현금흐름 DataFrame → {period: {operating_cf, ...}} dict"""
        result: dict = {}
        if cf_df is None or cf_df.empty:
            return result
        for col in cf_df.columns:
            p = str(col)[:10]
            result.setdefault(p, {"period": p})

            def sv(name, _col=col, _df=cf_df):
                try:
                    v = _df.loc[name, _col]
                    return int(float(v)) if v == v and v is not None else None
                except Exception:
                    return None

            op    = sv("Operating Cash Flow")
            inv   = sv("Investing Cash Flow")
            fin   = sv("Financing Cash Flow")
            capex = sv("Capital Expenditure")
            da    = sv("Depreciation And Amortization") or sv("Depreciation Amortization Depletion")
            fcf   = sv("Free Cash Flow")

            if op    is not None: result[p]["operating_cf"] = op
            if inv   is not None: result[p]["investing_cf"] = inv
            if fin   is not None: result[p]["financing_cf"] = fin
            if capex is not None: result[p]["capex"] = capex
            if da    is not None: result[p]["da"] = da
            if fcf   is not None:
                result[p]["free_cf"] = fcf
            elif op is not None and capex is not None:
                result[p]["free_cf"] = op + capex
        return result

    def _fetch():
        try:
            t = yf.Ticker(yf_sym)
            shares = None

            # 1차: fast_info (IP 차단에 강함)
            try:
                fi = t.fast_info
                shares = float(getattr(fi, "shares", None) or 0) or None
            except Exception:
                pass

            # 2차: info (느리지만 fallback)
            if not shares:
                try:
                    shares = float(t.info.get("sharesOutstanding") or 0) or None
                except Exception:
                    pass

            # 3차: KR 종목은 market_cap / price 로 추정
            if not shares and market == "KR":
                try:
                    fi2 = t.fast_info
                    mc = getattr(fi2, "market_cap", None)
                    lp = getattr(fi2, "last_price", None)
                    if mc and lp and lp > 0:
                        shares = mc / lp
                except Exception:
                    pass

            hist = None
            try:
                # PER/PBR/PSR 계산용 주가 이력 — max 대신 10y로 제한 (속도 개선)
                hist = t.history(period="10y", interval="1mo")
                if hist.index.tz is not None:
                    hist.index = hist.index.tz_localize(None)
            except Exception:
                pass

            annual    = _process(t.financials,          t.balance_sheet,          shares, hist)
            quarterly = _process(t.quarterly_financials, t.quarterly_balance_sheet, shares, hist)

            # YoY 성장률 추가
            _add_growth(annual)
            _add_growth(quarterly)

            # 현금흐름 병합
            try:
                cf_a = _process_cf(t.cashflow)
                for row in annual:
                    row.update({k: v for k, v in cf_a.get(row["period"], {}).items() if k != "period"})
            except Exception:
                pass
            try:
                cf_q = _process_cf(t.quarterly_cashflow)
                for row in quarterly:
                    row.update({k: v for k, v in cf_q.get(row["period"], {}).items() if k != "period"})
            except Exception:
                pass

            return {"annual": annual, "quarterly": quarterly}
        except Exception:
            return {"annual": [], "quarterly": []}

    # 재무이력은 데이터가 많아 timeout을 60초로 늘림
    try:
        loop = asyncio.get_running_loop()
        result = await asyncio.wait_for(loop.run_in_executor(None, _fetch), timeout=60)
    except asyncio.TimeoutError:
        result = {"annual": [], "quarterly": []}
    cache.set(ck, result, 3600)
    return result


@router.get("/{market}/{symbol}/forecasts")
async def get_forecasts(market: Literal["KR","US","ETF"], symbol: str):
    """컨센서스 추정치 — 연간/분기별 매출·EPS·영업이익·순이익·EBITDA·성장률"""
    from app.core.cache import cache
    ck = f"forecasts:{symbol}"
    if c := cache.get(ck):
        return c

    import yfinance as yf
    yf_sym = _resolve_kr_symbol(symbol, "KS") if market == "KR" else symbol

    # 국내 종목: FnGuide 컨센서스 (네이버 모바일 API)
    if market == "KR":
        code6 = symbol.replace(".KS","").replace(".KQ","")
        def _fetch_kr():
            try:
                import httpx, math
                headers = {
                    "User-Agent": "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/80.0 Mobile Safari/537.36",
                    "Referer": "https://m.stock.naver.com/",
                }
                # 네이버 증권 컨센서스 API
                url = f"https://m.stock.naver.com/api/stock/{code6}/consensus"
                r = httpx.get(url, headers=headers, timeout=10)
                if r.status_code != 200:
                    return {"annual": [], "quarterly": []}
                data = r.json()
                annual, quarterly = [], []
                for item in (data.get("annualList") or []):
                    year = str(item.get("fiscalYear",""))
                    if not year:
                        continue
                    def sf(k):
                        v = item.get(k)
                        try:
                            f = float(str(v).replace(",",""))
                            return None if (math.isnan(f) or math.isinf(f)) else f
                        except Exception:
                            return None
                    annual.append({
                        "period": f"{year}-12-31",
                        "type": "forecast",
                        "revenue_est":  sf("salesEstimate"),
                        "revenue_high": sf("salesHigh"),
                        "revenue_low":  sf("salesLow"),
                        "eps_est":      sf("epsEstimate"),
                        "eps_high":     sf("epsHigh"),
                        "eps_low":      sf("epsLow"),
                        "op_income_est":sf("operatingProfitEstimate"),
                        "net_income_est":sf("netProfitEstimate"),
                    })
                for item in (data.get("quarterList") or []):
                    period = str(item.get("fiscalQuarter",""))
                    if not period:
                        continue
                    def sf(k):
                        v = item.get(k)
                        try:
                            f = float(str(v).replace(",",""))
                            return None if (math.isnan(f) or math.isinf(f)) else f
                        except Exception:
                            return None
                    quarterly.append({
                        "period": period,
                        "type": "forecast",
                        "revenue_est":   sf("salesEstimate"),
                        "eps_est":       sf("epsEstimate"),
                        "op_income_est": sf("operatingProfitEstimate"),
                    })
                if annual or quarterly:
                    return {"annual": annual, "quarterly": quarterly}
            except Exception:
                pass
            # yfinance 폴백
            try:
                t = yf.Ticker(yf_sym)
                rows = []
                pe = getattr(t, "earnings_estimate", None)
                if pe is not None and not pe.empty:
                    for idx, row in pe.iterrows():
                        p = str(idx)[:10]
                        try:
                            eps = float(row.get("avg",0) or 0) or None
                        except Exception:
                            eps = None
                        rows.append({"period": p, "type": "forecast", "eps_est": eps})
                return {"annual": [r for r in rows if len(r["period"]) <= 7],
                        "quarterly": [r for r in rows if len(r["period"]) > 7]}
            except Exception:
                return {"annual": [], "quarterly": []}

        loop = asyncio.get_running_loop()
        result = await asyncio.wait_for(loop.run_in_executor(None, _fetch_kr), timeout=15)
        cache.set(ck, result, 3600)
        return result

    def _safe_float(v):
        try:
            f = float(v)
            import math
            return None if (math.isnan(f) or math.isinf(f)) else f
        except Exception:
            return None

    def _fetch():
        try:
            t = yf.Ticker(yf_sym)
            annual: dict = {}
            quarterly: dict = {}

            def _upsert(store, period, **kwargs):
                if period not in store:
                    store[period] = {"period": period, "type": "forecast"}
                for k, v in kwargs.items():
                    if v is not None and store[period].get(k) is None:
                        store[period][k] = v

            # ── earnings_estimate (EPS 추정, 연간+분기) ──────────
            try:
                ee = getattr(t, "earnings_estimate", None)
                if ee is not None and not ee.empty:
                    for idx, row in ee.iterrows():
                        p = str(idx)[:10]
                        store = quarterly if len(p) > 6 else annual
                        _upsert(store, p,
                            eps_est=_safe_float(row.get("avg") or row.get("Avg Estimate")),
                            eps_low=_safe_float(row.get("low") or row.get("Low Estimate")),
                            eps_high=_safe_float(row.get("high") or row.get("High Estimate")),
                            eps_analysts=_safe_float(row.get("numberOfAnalysts") or row.get("No. of Analysts")),
                        )
            except Exception:
                pass

            # ── revenue_estimate (매출 추정) ─────────────────────
            try:
                re_ = getattr(t, "revenue_estimate", None)
                if re_ is not None and not re_.empty:
                    for idx, row in re_.iterrows():
                        p = str(idx)[:10]
                        store = quarterly if len(p) > 6 else annual
                        _upsert(store, p,
                            revenue_est=_safe_float(row.get("avg") or row.get("Avg Estimate")),
                            revenue_low=_safe_float(row.get("low") or row.get("Low Estimate")),
                            revenue_high=_safe_float(row.get("high") or row.get("High Estimate")),
                        )
            except Exception:
                pass

            # ── eps_trend (추정치 변화 추이) ─────────────────────
            try:
                et = getattr(t, "eps_trend", None)
                if et is not None and not et.empty:
                    for idx, row in et.iterrows():
                        p = str(idx)[:10]
                        store = quarterly if len(p) > 6 else annual
                        _upsert(store, p,
                            eps_current=_safe_float(row.get("current")),
                            eps_7d_ago=_safe_float(row.get("7daysAgo")),
                            eps_30d_ago=_safe_float(row.get("30daysAgo")),
                            eps_90d_ago=_safe_float(row.get("90daysAgo")),
                        )
            except Exception:
                pass

            # ── growth_estimates (성장률 추정) ───────────────────
            try:
                ge = getattr(t, "growth_estimates", None)
                if ge is not None and not ge.empty:
                    for idx, row in ge.iterrows():
                        p = str(idx)[:10]
                        store = quarterly if len(p) > 6 else annual
                        _upsert(store, p,
                            growth_est=_safe_float(row.get(yf_sym) or row.get("stock")),
                        )
            except Exception:
                pass

            return {
                "annual":    sorted(rows,   key=lambda x: x["period"]),
                "quarterly": sorted(q_rows, key=lambda x: x["period"]),
            }
        except Exception:
            return {"annual": [], "quarterly": []}

    result = await _run(_fetch)
    cache.set(ck, result, 3600)
    return result


@router.get("/{market}/{symbol}/disclosures")
async def get_disclosures(market: Literal["KR","US","ETF"], symbol: str):
    """국내 공시 목록 (OpenDART)"""
    if market != "KR" or not settings.DART_API_KEY:
        return []
    return await _run(dart_service.get_disclosures, symbol)


@router.get("/{market}/{symbol}/news")
async def get_stock_news(market: Literal["KR","US","ETF"], symbol: str):
    """종목 관련 뉴스 — KR: RSS 검색, US: yfinance"""
    from app.core.cache import cache
    ck = f"stock_news:{market}:{symbol}"
    if c := cache.get(ck):
        return c

    if market == "KR":
        # 종목명으로 국내 뉴스 RSS 검색
        from app.services.news_service import KR_FEEDS, _parse_feed
        code6 = symbol.replace(".KS","").replace(".KQ","")
        # 데모/KIS에서 종목명 조회
        from app.services.demo_data import DEMO_PRICES
        demo = DEMO_PRICES.get(symbol) or DEMO_PRICES.get(code6+".KS")
        stock_name = demo.get("name", code6) if demo else code6

        def _fetch_kr():
            import feedparser
            from datetime import timezone, timedelta, datetime
            KST = timezone(timedelta(hours=9))
            items = []
            # Naver 금융 뉴스 RSS (종목 코드)
            naver_url = f"https://finance.naver.com/item/news_news.nhn?code={code6}&page=1&sm=title_entity_id.basic&clusterId="
            # 대신 구글 뉴스 한국어 RSS 사용
            import urllib.parse
            query = urllib.parse.quote(stock_name)
            google_rss = f"https://news.google.com/rss/search?q={query}+주식+주가&hl=ko&gl=KR&ceid=KR:ko"
            feed = feedparser.parse(google_rss)
            entries_sorted = sorted(
                (e for e in (feed.entries or []) if e.get("published_parsed")),
                key=lambda e: e.published_parsed,
                reverse=True,
            )[:30]
            for entry in entries_sorted:
                pub = ""
                pub_ts = ""
                try:
                    if entry.get("published_parsed"):
                        utc_dt = datetime(*entry.published_parsed[:6], tzinfo=timezone.utc)
                        pub = utc_dt.astimezone(KST).strftime("%Y/%m/%d %H:%M")
                        pub_ts = utc_dt.isoformat()
                except Exception:
                    pass
                title = entry.get("title", "").strip()
                if not title:
                    continue
                source = (entry.get("source") or {}).get("title", "")
                items.append({
                    "title": title,
                    "link": entry.get("link", ""),
                    "source": source,
                    "published": pub,
                    "published_ts": pub_ts,
                    "summary": (entry.get("summary") or "")[:200],
                })
            return items

        result = await _run(_fetch_kr)

    else:
        # US: yfinance 뉴스
        import yfinance as yf
        def _fetch_us():
            try:
                ticker = yf.Ticker(symbol)
                items = []
                for n in (ticker.news or [])[:30]:
                    ct = n.get("content", {})
                    title = ct.get("title") or n.get("title", "")
                    link  = (ct.get("canonicalUrl") or {}).get("url") or n.get("link", "")
                    pub   = ct.get("pubDate") or n.get("providerPublishTime", "")
                    provider = (ct.get("provider") or {}).get("displayName") or n.get("publisher", "")
                    if not title:
                        continue
                    items.append({"title": title, "link": link, "source": provider, "published": pub, "summary": (ct.get("summary") or "")[:200]})
                return items
            except Exception:
                return []
        result = await _run(_fetch_us)

    # 인기순 정렬에 필요한 trend_score 계산
    if result:
        from app.services.news_service import _add_trending_score
        result = _add_trending_score(result)

    cache.set(ck, result, 300)
    return result


@router.get("/{market}/{symbol}/earnings")
async def get_earnings(market: Literal["KR","US","ETF"], symbol: str):
    """실적발표 일정 및 과거 실적 (yfinance)"""
    from app.core.cache import cache
    ck = f"earnings:{symbol}"
    if c := cache.get(ck):
        return c

    import yfinance as yf
    yf_sym = _resolve_kr_symbol(symbol, "KS") if market == "KR" else symbol

    def _fetch():
        try:
            t = yf.Ticker(yf_sym)
            result = {"history": [], "upcoming": []}

            # 과거 실적
            try:
                earn = t.earnings
                if earn is not None and not earn.empty:
                    for idx, row in earn.iterrows():
                        result["history"].append({
                            "period": str(idx),
                            "revenue": int(row.get("Revenue", 0) or 0),
                            "earnings": int(row.get("Earnings", 0) or 0),
                        })
            except Exception:
                pass

            # 향후 실적 발표 일정
            try:
                cal = t.calendar
                if cal is not None and isinstance(cal, dict):
                    ed = cal.get("Earnings Date")
                    if ed:
                        dates = ed if isinstance(ed, list) else [ed]
                        for dt in dates:
                            result["upcoming"].append(str(dt)[:10] if dt else "")
                    result["eps_estimate"] = cal.get("EPS Estimate")
                    result["revenue_estimate"] = cal.get("Revenue Estimate")
            except Exception:
                pass

            return result
        except Exception:
            return {"history": [], "upcoming": []}

    result = await _run(_fetch)
    cache.set(ck, result, 3600)
    return result


@router.get("/{market}/{symbol}/analyst")
async def get_analyst(market: Literal["KR","US","ETF"], symbol: str):
    """애널리스트 투자의견 — 목표주가, 의견분포, 최근 리포트"""
    from app.core.cache import cache
    ck = f"analyst:{symbol}"
    if c := cache.get(ck):
        return c

    import yfinance as yf
    yf_sym = _resolve_kr_symbol(symbol, "KS") if market == "KR" else symbol

    def _fetch():
        try:
            t = yf.Ticker(yf_sym)
            result: dict = {}

            # 목표주가
            try:
                apt = t.analyst_price_targets
                if apt and isinstance(apt, dict):
                    result["price_targets"] = {
                        "current": _safe(apt.get("current")),
                        "mean":    _safe(apt.get("mean")),
                        "median":  _safe(apt.get("median")),
                        "high":    _safe(apt.get("high")),
                        "low":     _safe(apt.get("low")),
                    }
            except Exception:
                pass

            # 투자의견 분포 (현재월)
            try:
                rs = t.recommendations_summary
                if rs is not None and not rs.empty:
                    row = rs[rs["period"] == "0m"]
                    if row.empty:
                        row = rs.iloc[[0]]
                    r = row.iloc[0]
                    result["consensus"] = {
                        "strong_buy":  int(r.get("strongBuy", 0) or 0),
                        "buy":         int(r.get("buy", 0) or 0),
                        "hold":        int(r.get("hold", 0) or 0),
                        "sell":        int(r.get("sell", 0) or 0),
                        "strong_sell": int(r.get("strongSell", 0) or 0),
                    }
                    # 최근 3개월 추이
                    history = []
                    for _, hr in rs.iterrows():
                        history.append({
                            "period":      hr.get("period", ""),
                            "strong_buy":  int(hr.get("strongBuy", 0) or 0),
                            "buy":         int(hr.get("buy", 0) or 0),
                            "hold":        int(hr.get("hold", 0) or 0),
                            "sell":        int(hr.get("sell", 0) or 0),
                            "strong_sell": int(hr.get("strongSell", 0) or 0),
                        })
                    result["consensus_history"] = history
            except Exception:
                pass

            # 최근 애널리스트 리포트 (최대 30개)
            try:
                ud = t.upgrades_downgrades
                if ud is not None and not ud.empty:
                    reports = []
                    for dt, row in ud.head(30).iterrows():
                        reports.append({
                            "date":         str(dt)[:10],
                            "firm":         str(row.get("Firm", "") or ""),
                            "to_grade":     str(row.get("ToGrade", "") or ""),
                            "from_grade":   str(row.get("FromGrade", "") or ""),
                            "action":       str(row.get("Action", "") or ""),
                            "price_action": str(row.get("priceTargetAction", "") or ""),
                            "target":       _safe(row.get("currentPriceTarget")),
                            "prior_target": _safe(row.get("priorPriceTarget")),
                        })
                    result["reports"] = reports
            except Exception:
                pass

            return result
        except Exception:
            return {}

    try:
        result = await asyncio.wait_for(
            asyncio.get_running_loop().run_in_executor(None, _fetch),
            timeout=15
        )
    except Exception:
        result = {}
    cache.set(ck, result, 3600)
    return result


@router.get("/KR/{symbol}/supply-demand")
async def get_supply_demand(symbol: str, days: int = Query(default=30)):
    """수급 데이터 (외국인/기관/개인) — pykrx"""
    from app.core.cache import cache
    from datetime import datetime, timedelta
    ck = f"supply:{symbol}:{days}"
    if c := cache.get(ck):
        return c
    def _fetch():
        try:
            from pykrx import stock as pkrx
            code = symbol.replace(".KS","").replace(".KQ","")
            end   = datetime.today().strftime("%Y%m%d")
            start = (datetime.today() - timedelta(days=days+10)).strftime("%Y%m%d")
            df = pkrx.get_market_trading_value_by_date(start, end, code)
            if df is None or df.empty:
                return []
            df = df.tail(days)
            rows = []
            for idx, row in df.iterrows():
                rows.append({
                    "date":        str(idx.date()),
                    "foreign":     int(row.get("외국인합계", row.get("외국인", 0)) or 0),
                    "institution": int(row.get("기관합계", row.get("기관", 0)) or 0),
                    "individual":  int(row.get("개인", 0) or 0),
                    "total":       int(row.get("전체", 0) or 0),
                })
            return rows
        except Exception:
            return []
    result = await _run(_fetch)
    cache.set(ck, result, 600)
    return result
