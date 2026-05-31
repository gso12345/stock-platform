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
    loop = asyncio.get_event_loop()
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
            asyncio.get_event_loop().run_in_executor(None, yf_service.get_stock_price, symbol, "KR"),
            timeout=10
        )
        if result and result.get("price"):
            cache.set(ck, result, 30)
            return result
    except Exception:
        pass

    return {"symbol": symbol, "price": None, "change_rate": 0, "currency": "KRW"}


async def get_us_price(symbol: str) -> dict:
    """Yahoo Finance v7 → 캐시 순서로 폴백 (항상 최신 데이터 우선)"""
    from app.services.price_fetcher import fetch_yf_quotes
    ck = f"price:{symbol}"

    # 신선한 캐시 (30초 이내)
    fresh = cache.get(ck)
    if fresh and fresh.get("price") and not fresh.get("_demo"):
        return fresh

    # Yahoo Finance 직접 조회 (가장 최신)
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

    # yfinance 직접 호출
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

    if market == "KR":
        code6 = symbol.replace(".KS","").replace(".KQ","")

        # KIS API — 일봉만 지원
        if settings.KIS_APP_KEY and interval == "1d":
            result = await kis_service.get_ohlcv(code6, period)
            if result:
                return result

        # yfinance 폴백 (분봉 포함)
        try:
            yf_iv = yf_interval_mapped if yf_interval_mapped in YF_VALID else "1d"
            result = await _run(yf_service.get_ohlcv, symbol, yf_period, yf_iv, "KR")
            if result:
                return _resample_to_annual(result) if is_annual else result
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
                return _resample_to_annual(result) if is_annual else result

        # yfinance 폴백 (분봉 포함)
        try:
            yf_iv = yf_interval_mapped if yf_interval_mapped in YF_VALID else "1d"
            result = await _run(yf_service.get_ohlcv, symbol, yf_period, yf_iv, "US")
            if result:
                return _resample_to_annual(result) if is_annual else result
        except Exception:
            pass
        return get_demo_ohlcv(symbol, period)


@router.get("/{market}/{symbol}/detail")
async def get_stock_detail(market: Literal["KR","US","ETF"], symbol: str):
    if market == "KR":
        # Naver integration API가 이미 PER/PBR/EPS/시총/거래량 제공 → yfinance 불필요
        price = await get_kr_price(symbol)
        return price or {"symbol": symbol, "price": None, "currency": "KRW"}
    else:
        # US: 캐시 우선 → yfinance 병렬 fetch
        cached = cache.get_stale(f"price:{symbol}")
        if cached and cached.get("price") and not cached.get("_demo"):
            # 캐시된 가격이 있으면 fundamentals만 추가
            try:
                fund = await asyncio.wait_for(
                    asyncio.get_event_loop().run_in_executor(None, yf_service.get_fundamentals, symbol, "US"),
                    timeout=8
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
            f = fund if isinstance(fund, dict) else {}
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
            asyncio.get_event_loop().run_in_executor(None, yf_service.get_fundamentals, symbol, market),
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
        loop = asyncio.get_event_loop()
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

    def _fetch():
        try:
            t = yf.Ticker(yf_sym)
            shares = None
            try:
                shares = float(t.info.get("sharesOutstanding") or 0) or None
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

            return {"annual": annual, "quarterly": quarterly}
        except Exception:
            return {"annual": [], "quarterly": []}

    # 재무이력은 데이터가 많아 timeout을 60초로 늘림
    try:
        loop = asyncio.get_event_loop()
        result = await asyncio.wait_for(loop.run_in_executor(None, _fetch), timeout=60)
    except asyncio.TimeoutError:
        result = {"annual": [], "quarterly": []}
    cache.set(ck, result, 3600)
    return result


@router.get("/{market}/{symbol}/forecasts")
async def get_forecasts(market: Literal["KR","US","ETF"], symbol: str):
    """컨센서스 추정치 (연간 Revenue/EPS/Net Income 예측)"""
    from app.core.cache import cache
    ck = f"forecasts:{symbol}"
    if c := cache.get(ck):
        return c

    import yfinance as yf
    yf_sym = _resolve_kr_symbol(symbol, "KS") if market == "KR" else symbol

    def _fetch():
        try:
            t = yf.Ticker(yf_sym)
            rows = []

            # 1. earnings_forecasts (연간 EPS 추정)
            try:
                ef = t.earnings_forecasts
                if ef is not None and not ef.empty:
                    for idx, row in ef.iterrows():
                        period = str(idx)[:10]
                        rows.append({
                            "period":   period,
                            "eps_est":  float(row.get("EPS Estimate", row.get("avg", 0)) or 0) or None,
                            "type":     "forecast",
                        })
            except Exception:
                pass

            # 2. income_stmt 기반 미래 추정 (analyst_info)
            try:
                ae = t.analyst_price_targets
                if ae is not None and isinstance(ae, dict):
                    pass  # 가격 타겟은 이미 detail에 포함
            except Exception:
                pass

            # 3. revenue_estimate, earnings_estimate (forward)
            try:
                fi = t.financials
                # quarterly_earnings_estimate
                pe = getattr(t, "earnings_estimate", None)
                if pe is not None and not pe.empty:
                    for idx, row in pe.iterrows():
                        period = str(idx)[:10]
                        existing = next((r for r in rows if r["period"] == period), None)
                        if existing:
                            existing["eps_est"] = float(row.get("avg", existing.get("eps_est", 0)) or 0) or existing.get("eps_est")
                        else:
                            rows.append({"period": period, "eps_est": float(row.get("avg",0) or 0) or None, "type": "forecast"})
            except Exception:
                pass

            # 4. revenue_estimate
            try:
                re_ = getattr(t, "revenue_estimate", None)
                if re_ is not None and not re_.empty:
                    for idx, row in re_.iterrows():
                        period = str(idx)[:10]
                        rev_est = float(row.get("avg", 0) or 0) or None
                        existing = next((r for r in rows if r["period"] == period), None)
                        if existing:
                            existing["revenue_est"] = rev_est
                        else:
                            rows.append({"period": period, "revenue_est": rev_est, "type": "forecast"})
            except Exception:
                pass

            # 중복 제거 및 정렬
            seen = {}
            for r in rows:
                p = r["period"]
                if p not in seen:
                    seen[p] = r
                else:
                    seen[p].update({k: v for k, v in r.items() if v is not None})

            return sorted(seen.values(), key=lambda x: x["period"])
        except Exception:
            return []

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
            for entry in (feed.entries or [])[:30]:
                pub = ""
                try:
                    if entry.get("published_parsed"):
                        utc_dt = datetime(*entry.published_parsed[:6], tzinfo=timezone.utc)
                        pub = utc_dt.astimezone(KST).strftime("%m/%d %H:%M")
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
