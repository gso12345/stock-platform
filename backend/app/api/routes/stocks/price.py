"""시세·차트·상세·재무지표 — 종목 상세를 열면 가장 먼저 뜨는 것들.

원래 stocks.py 한 파일에 있던 것을 탭 단위로 가른 조각이다.
공용 폴백·시한 처리는 _공용 에 있다.
"""
from ._공용 import (   # noqa: F401  — 쪼개기 전과 같은 이름을 쓴다
    APIRouter, Path, Query, HTTPException, Request, Depends, Literal,
    asyncio, logging, re, log, QMETRICS_TTL, _퀀트갱신중, _퀀트지표_뒤로미루기, Session,
    kis_service, finnhub_service, dart_service, yf_service,
    _resolve_kr_symbol, get_demo_price, get_demo_ohlcv, DEMO_PRICES,
    get_fdr_price, get_kr_db, compute_quant_score, DEFAULT_WEIGHTS, settings,
    cache, _safe_float, get_current_user, require_user, get_db,
    QuantScoreWeight, limiter, router_새로, _SYMBOL_PATTERN, _run, _시한내결과,
    get_kr_price, get_us_price,
)

router = router_새로()

# ── 엔드포인트 ─────────────────────────────────────────────
@router.get("/{market}/{symbol}/price")
@limiter.limit("60/minute")
async def get_stock_price(request: Request, market: Literal["KR","US","ETF"], symbol: str = Path(..., pattern=_SYMBOL_PATTERN)):
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
    market: Literal["KR","US","ETF"], symbol: str = Path(..., pattern=_SYMBOL_PATTERN),
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
    YF_VALID = {"1m","2m","5m","15m","30m","60m","90m","1h","1d","5d","1wk","1mo","3mo"}
    # 3일봉/10일봉/30일봉/60일봉 — yfinance에 직접 인터벌은 없지만 yf_service.get_ohlcv가
    # 일봉을 받아 N일 단위로 자체 리샘플링해서 반환함 (NDAY_MAP)
    NDAY_SET = {"3d","10d","30d","60d"}

    # yfinance는 1y interval을 지원하지 않으므로 1mo로 가져와서 연봉으로 리샘플링
    yf_interval_mapped = "1mo" if is_annual else interval

    def _resample(bars: list) -> list:
        if is_annual:
            return _resample_to_annual(bars)
        return bars

    # yfinance 분봉 기간 제한: 1m=7일, 나머지=60일
    intraday_max_period = {"1m":"5d","5m":"60d","15m":"60d","30m":"60d","60m":"60d"}
    yf_period = intraday_max_period.get(interval, period) if is_intraday else period

    # OHLCV 캐시 (분봉 1m은 캐시 안 함, 나머지는 TTL별 캐시)
    ohlcv_ttl = {
        "5m": 60, "15m": 60, "30m": 120, "60m": 180,
        "1d": 300, "1wk": 1800, "1mo": 3600, "1y": 3600,
        "3d": 3600, "10d": 3600, "30d": 3600, "60d": 3600,
    }.get(interval, 0)
    ohlcv_ck = f"ohlcv:{market}:{symbol}:{period}:{interval}" if ohlcv_ttl else None
    if ohlcv_ck:
        cached_ohlcv = cache.get(ohlcv_ck)
        if cached_ohlcv is not None:
            return cached_ohlcv
        # Stale → 즉시 반환 + 백그라운드 갱신
        stale_ohlcv = cache.get_stale(ohlcv_ck)
        if stale_ohlcv:
            _bg_ck = ohlcv_ck
            _bg_ttl = ohlcv_ttl
            async def _bg_ohlcv():
                try:
                    result = await asyncio.wait_for(
                        asyncio.get_running_loop().run_in_executor(
                            None, yf_service.get_ohlcv, symbol, period, interval, market
                        ), timeout=20
                    )
                    if result:
                        cache.set(_bg_ck, result, _bg_ttl)
                except Exception:
                    pass
            asyncio.create_task(_bg_ohlcv())
            return stale_ohlcv

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

        # yfinance 폴백 (분봉/N일봉 포함)
        try:
            yf_iv = yf_interval_mapped if (yf_interval_mapped in YF_VALID or yf_interval_mapped in NDAY_SET) else "1d"
            result = await _run(yf_service.get_ohlcv, symbol, yf_period, yf_iv, "KR")
            if result:
                data = _resample(result)
                return _cache_and_return(data)
        except Exception:
            pass
        return get_demo_ohlcv(symbol, period)

    else:
        # Finnhub — 분봉 지원 (N일봉은 yfinance가 자체 리샘플링하므로 그쪽으로)
        if settings.FINNHUB_API_KEY and interval not in NDAY_SET:
            finnhub_res_map = {"1m":"1","5m":"5","15m":"15","30m":"30","60m":"60","1d":"D","1wk":"W","1mo":"M","1y":"M"}
            resolution = finnhub_res_map.get(interval, "D")
            result = await _run(finnhub_service.get_candles, symbol, yf_period if is_intraday else period, resolution)
            if result:
                data = _resample(result)
                return _cache_and_return(data)

        # yfinance 폴백 (분봉/N일봉 포함)
        try:
            yf_iv = yf_interval_mapped if (yf_interval_mapped in YF_VALID or yf_interval_mapped in NDAY_SET) else "1d"
            result = await _run(yf_service.get_ohlcv, symbol, yf_period, yf_iv, "US")
            if result:
                data = _resample(result)
                return _cache_and_return(data)
        except Exception:
            pass
        return get_demo_ohlcv(symbol, period)


@router.get("/{market}/{symbol}/nxt")
@limiter.limit("30/minute")
async def get_stock_nxt(request: Request, market: Literal["KR","US","ETF"], symbol: str = Path(..., pattern=_SYMBOL_PATTERN)):
    """대체거래소(넥스트레이드/NXT) 시세 — KR 종목 중 NXT 거래 가능 종목만 시세 반환"""
    if market != "KR" or not settings.KIS_APP_KEY:
        return {"available": False}
    code6 = symbol.replace(".KS","").replace(".KQ","")
    result = await kis_service.get_nxt_price(code6)
    return result or {"available": False}


@router.get("/{market}/{symbol}/detail")
@limiter.limit("30/minute")
async def get_stock_detail(request: Request, market: Literal["KR","US","ETF"], symbol: str = Path(..., pattern=_SYMBOL_PATTERN)):
    if market == "KR":
        from app.services.price_fetcher import fetch_naver_stock
        code6 = symbol.replace(".KS","").replace(".KQ","")

        # 신선한 캐시에 open/high/low까지 있으면 Naver 재요청 생략
        price = None
        fresh = cache.get(f"price:{symbol}")

        if fresh and fresh.get("price") and fresh.get("open") and not fresh.get("_demo"):
            price = fresh
        else:
            # 가격만 기다린다.
            #
            # 예전에는 여기서 fundamentals 를 같이 gather 했다. 병렬이니
            # 공짜처럼 보이지만 아니다 — gather 는 둘 다 끝나야 넘어가므로,
            # 네이버가 1초에 와도 지표가 8초를 끌면 응답은 8초 뒤에 나간다.
            # 종목을 처음 여는 사람이 그 8초를 통째로 문다.
            #
            # 지표는 아래에서 캐시에 있으면 그 자리에서 채우고, 없으면
            # 백그라운드로 받는다. 화면 쪽도 detail 에 지표가 비면
            # fundamentals 를 따로 부르므로(StockDetail.tsx) 곧 채워진다.
            naver_res = await fetch_naver_stock(code6)
            price = naver_res if naver_res and naver_res.get("price") else None

        # Naver 실패 시 캐시 → yfinance 폴백
        if not price or not price.get("price"):
            price = await get_kr_price(symbol)

        if not price or not price.get("price"):
            return {"symbol": symbol, "price": None, "currency": "KRW"}

        # 종목명이 없거나 코드와 같으면 보완
        if not price.get("name") or price.get("name") == symbol:
            price["name"] = price.get("name") or code6

        # 시가/고가/저가/전일종가 없으면 캐시 우선 → 없으면 yfinance 호출
        if not price.get("open") or not price.get("prev_close"):
            ohlcv_cached = cache.get_stale(f"ohlcv:KR:{symbol}:5d:1d") or cache.get_stale(f"ohlcv:KR:{symbol}:1y:1d")
            if ohlcv_cached and len(ohlcv_cached) >= 2:
                latest = ohlcv_cached[-1]
                prev   = ohlcv_cached[-2]
                if not price.get("open"):       price["open"]       = latest.get("open")
                if not price.get("high"):       price["high"]       = latest.get("high")
                if not price.get("low"):        price["low"]        = latest.get("low")
                if not price.get("prev_close"): price["prev_close"] = prev.get("close")
            else:
                # 캐시에 없으면 yfinance 호출
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
        # 네이버 시세 응답에는 재무지표가 없어서 fundamentals 로 채운다.
        #
        # per·eps·pbr·bps 가 이 목록에 없었다. forward_eps(선행 EPS)는 있는데
        # 정작 eps(현재 EPS)가 빠져 있어서, 국내 종목은 detail 응답의 eps 가
        # 끝까지 비어 있었다. 재무제표 탭은 detail 이 비면 fundamentals 를
        # 다시 보므로 값이 나왔고, 기본정보는 detail 만 보고 있어서 안 나왔다.
        # 같은 화면에서 한쪽만 비는 그 증상의 뿌리가 여기다.
        _KR_FUND_KEYS = (
            "per", "eps", "pbr", "bps",
            "forward_per", "peg", "ev_ebitda", "ev_revenue", "enterprise_value",
            "psr", "forward_eps", "roe", "roa", "gross_margin", "op_margin",
            "net_margin", "debt_ratio", "current_ratio", "quick_ratio",
            "beta", "payout_ratio", "sector", "industry", "description",
        )
        fund_ck = f"fund:{symbol}"
        fund_data = cache.get(fund_ck) or cache.get_stale(fund_ck)
        if fund_data:
            for key in _KR_FUND_KEYS:
                if not price.get(key) and fund_data.get(key) is not None:
                    price[key] = fund_data[key]
        else:
            # 캐시가 없으면 백그라운드로 채우고 이번 응답은 그대로 보낸다.
            #
            # 예전에는 여기서 최대 4초를 동기 대기했다. 첫 조회에서도 지표가
            # 바로 보이게 하려던 것인데, 그 4초는 종목상세를 처음 여는 사람이
            # 전부 문다 — 화면이 통째로 4초 늦게 뜬다.
            #
            # 지금은 화면 쪽이 detail 에 지표가 비면 fundamentals 를 따로
            # 부른다(StockDetail.tsx 의 기본지표가_비었나). 그 요청은 detail 과
            # 나란히 나가므로, 기다리지 않아도 지표는 곧 채워진다. 여기서
            # 붙잡고 있을 이유가 없어졌다.
            _yf_sym_bg = symbol if symbol.endswith((".KS",".KQ")) else f"{symbol}.KS"

            async def _bg_fund_kr():
                """정식 경로로 채운다.

                예전에는 여기서 yf_service.get_fundamentals(야후 단독)를 부르고
                그 결과를 `fund:{symbol}` 에 그대로 박았다. 그런데 그 키는
                /fundamentals 엔드포인트가 제일 먼저 읽고 그대로 돌려주는
                키다(fundamentals_service.get_fundamentals). 그래서 detail 이
                한 번 다녀가면, 네이버로 per·eps·pbr·bps 를 보완하는 경로
                (_fetch_fund)가 영영 안 돌았다.

                국내 종목은 야후에 trailingEps 가 없는 경우가 많다. 그러면
                오염된 캐시 탓에 /fundamentals 도 EPS 를 못 주고, 기본정보
                EPS 가 끝까지 빈다 — 이번 문의의 뿌리 중 하나다."""
                try:
                    from app.services.fundamentals_service import get_fundamentals as _정식
                    await asyncio.wait_for(_정식(symbol, "KR"), timeout=20)
                except Exception:
                    pass

            asyncio.create_task(_bg_fund_kr())

        return price
    else:
        from app.services.price_fetcher import fetch_yf_quote_extended

        # 프리마켓/애프터마켓 시세 — 단건 전용 조회(배치 조회와 분리, 짧게 캐시)
        async def _with_ext_hours(result: dict) -> dict:
            if not result:
                return result
            ext_ck = f"ext:{symbol}"
            ext = cache.get(ext_ck)
            if ext is None:
                ext = await fetch_yf_quote_extended(symbol) or {}
                cache.set(ext_ck, ext, 30)
            return {**result, **{k: v for k, v in ext.items() if v is not None}}

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
                    # 여전히 volume이 없으면 별도 캐시(YF 기반)로 보완, 없으면 백그라운드 갱신
                    if not detail.get("volume"):
                        vol_ck = f"vol:{symbol}"
                        vol_cached = cache.get(vol_ck) or cache.get_stale(vol_ck)
                        if vol_cached:
                            if vol_cached.get("volume"):
                                detail["volume"] = vol_cached["volume"]
                            if not detail.get("market_cap") and vol_cached.get("market_cap"):
                                detail["market_cap"] = vol_cached["market_cap"]
                        else:
                            _sym_vol = symbol
                            async def _bg_vol_us():
                                try:
                                    p = await asyncio.wait_for(
                                        asyncio.get_running_loop().run_in_executor(
                                            None, yf_service.get_stock_price, _sym_vol, "US"
                                        ), timeout=10
                                    )
                                    if p and p.get("volume"):
                                        cache.set(vol_ck, {"volume": p.get("volume"), "market_cap": p.get("market_cap")}, 1800)
                                except Exception:
                                    pass
                            asyncio.create_task(_bg_vol_us())
                    # 거래대금 계산
                    if detail.get("price") and detail.get("volume"):
                        detail["amount"] = detail["price"] * detail["volume"]
                    # Finnhub이 제공하지 않는 밸류에이션 지표 보완
                    # (fund 캐시 우선, 없으면 yfinance 비동기 보완)
                    # per·eps·pbr·bps 가 이 목록에 없었다. Finnhub 이 주면
                    # 문제없지만, 그 종목의 metrics 를 못 주거나 키가 없어
                    # 아래 폴백으로 내려온 경우에는 채울 길이 없어졌다 —
                    # 그러면 기본정보의 EPS 가 끝까지 빈다.
                    #
                    # 국내(_KR_FUND_KEYS)에서 똑같은 빠짐을 이미 고쳤는데
                    # 해외 쪽은 그대로였다. 같은 버그가 두 곳에 있었다.
                    _VALUATION_FIELDS = (
                        "per", "eps", "pbr", "bps",
                        "forward_per", "peg", "ev_ebitda", "ev_revenue",
                        "enterprise_value", "psr", "forward_eps",
                        "gross_margin", "op_margin", "net_margin",
                        "roa", "current_ratio", "quick_ratio",
                        "payout_ratio", "description", "sector", "industry",
                    )
                    fund_ck = f"fund:{symbol}"
                    fund_cached = cache.get(fund_ck) or cache.get_stale(fund_ck)
                    if fund_cached:
                        for f in _VALUATION_FIELDS:
                            if detail.get(f) is None and fund_cached.get(f) is not None:
                                detail[f] = fund_cached[f]
                    else:
                        # 캐시가 없으면 백그라운드로 채우고 이번 응답은 그대로
                        # 보낸다. 예전에는 여기서 최대 4초를 동기 대기했는데,
                        # 그 4초는 종목상세를 처음 여는 사람이 전부 문다.
                        # 화면 쪽이 detail 에 지표가 비면 fundamentals 를 따로
                        # 부르므로(StockDetail.tsx), 붙잡고 있을 이유가 없다.
                        _sym_fund = symbol

                        async def _bg_fund_us():
                                # 국내와 같은 이유로 정식 경로를 쓴다 — 야후 단독 결과로
                                # 공유 캐시(fund:*)를 덮으면 /fundamentals 가 그걸 그대로
                                # 돌려주게 되고, 보완 경로가 영영 안 돈다
                                try:
                                    from app.services.fundamentals_service import get_fundamentals as _정식
                                    await asyncio.wait_for(_정식(_sym_fund, "US"), timeout=20)
                                except Exception:
                                    pass

                        asyncio.create_task(_bg_fund_us())
                    cache.set(f"price:{symbol}", detail, 15)
                    return await _with_ext_hours(detail)
            except Exception:
                pass

        fund_ck = f"fund:{symbol}"
        fund_cached = cache.get(fund_ck) or cache.get_stale(fund_ck)

        cached = cache.get_stale(f"price:{symbol}")
        if cached and cached.get("price") and not cached.get("_demo"):
            if fund_cached:
                return await _with_ext_hours({**cached, **fund_cached})
            # 가격은 이미 있다. 지표 때문에 4초를 더 기다릴 이유가 없다 —
            # 그 4초는 화면이 통째로 늦게 뜨는 시간이다. 백그라운드로 채운다.
            _sym_f2 = symbol

            async def _bg_fund_us2():
                # 국내와 같은 이유로 정식 경로를 쓴다 — 야후 단독 결과로
                # 공유 캐시(fund:*)를 덮으면 /fundamentals 가 그걸 그대로
                # 돌려주게 되고, 보완 경로가 영영 안 돈다
                try:
                    from app.services.fundamentals_service import get_fundamentals as _정식
                    await asyncio.wait_for(_정식(_sym_f2, "US"), timeout=20)
                except Exception:
                    pass

            asyncio.create_task(_bg_fund_us2())
            return await _with_ext_hours(cached)

        # 캐시 없으면 price + fundamentals 병렬 fetch (짧은 타임아웃)
        try:
            price_task = asyncio.wait_for(
                asyncio.get_running_loop().run_in_executor(None, yf_service.get_stock_price, symbol, "US"),
                timeout=10
            )
            fund_task = asyncio.wait_for(
                asyncio.get_running_loop().run_in_executor(None, yf_service.get_fundamentals, symbol, "US"),
                timeout=4
            )
            price_result, fund_result = await asyncio.gather(price_task, fund_task, return_exceptions=True)
            p = price_result if isinstance(price_result, dict) else {}
            if p.get("price"):
                cache.set(f"price:{symbol}", p, 30)
            if isinstance(fund_result, dict) and fund_result:
                cache.set(fund_ck, fund_result, 86400)
                p = {**p, **fund_result} if p else p
            return await _with_ext_hours(p) if p else {"symbol": symbol, "price": None, "currency": "USD"}
        except Exception:
            return {"symbol": symbol, "price": None, "currency": "USD"}


@router.get("/{market}/{symbol}/fundamentals")
async def get_fundamentals(market: Literal["KR","US","ETF"], symbol: str = Path(..., pattern=_SYMBOL_PATTERN)):
    """벨류에이션 지표 (PER, PBR, ROE 등) — DB 캐시 우선"""
    from app.services.fundamentals_service import get_fundamentals as _svc
    return await _svc(symbol, market)


@router.get("/{market}/{symbol}/financials")
async def get_financials(market: Literal["KR","US","ETF"], symbol: str = Path(..., pattern=_SYMBOL_PATTERN)):
    """재무제표 (손익·현금흐름·재무상태) — DB 캐시 우선"""
    from app.services.fundamentals_service import get_financials as _svc
    return await _svc(symbol, market)
