"""
종목 상세 라우트
- 국내: KIS API → DART (재무)
- 해외: Finnhub → FMP (재무)
- 폴백: yfinance (API 키 없을 때)
"""
from fastapi import APIRouter, Path, Query, HTTPException, Request, Depends
from typing import Literal
import asyncio
import re
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session
from app.services.kis_service import kis_service
from app.services.finnhub_service import finnhub_service
from app.services.dart_service import dart_service
from app.services.yf_service import yf_service, _resolve_kr_symbol
from app.services.demo_data import get_demo_price, get_demo_ohlcv, DEMO_PRICES
from app.services.ticker_service import get_fdr_price
from app.services.quant_score import compute_quant_score, DEFAULT_WEIGHTS
from app.core.config import settings
from app.core.cache import cache
from app.core.utils import safe_float as _safe_float
from app.core.deps import get_current_user, require_user
from app.db.database import get_db
from app.models.stock import QuantScoreWeight

router = APIRouter(prefix="/stocks", tags=["종목"])
limiter = Limiter(key_func=get_remote_address)
_SYMBOL_PATTERN = r"^[A-Za-z0-9.\-]{1,20}$"


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
            async def _bg_ohlcv():
                try:
                    await asyncio.wait_for(
                        asyncio.get_running_loop().run_in_executor(
                            None, yf_service.get_ohlcv, symbol, period, interval, market
                        ), timeout=20
                    )
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
        fund_ck = f"fund:{symbol}"
        fund_cached = cache.get(fund_ck) or cache.get_stale(fund_ck)

        if fresh and fresh.get("price") and fresh.get("open") and not fresh.get("_demo"):
            price = fresh
        else:
            # Naver 가격 + fundamentals(캐시 없을 때만) 병렬 fetch
            yf_sym = symbol if symbol.endswith((".KS", ".KQ")) else f"{code6}.KS"
            tasks: list = [fetch_naver_stock(code6)]
            if not fund_cached:
                tasks.append(asyncio.wait_for(
                    asyncio.get_running_loop().run_in_executor(
                        None, yf_service.get_fundamentals, yf_sym, "KR"
                    ), timeout=8
                ))
            results = await asyncio.gather(*tasks, return_exceptions=True)
            naver_res = results[0] if not isinstance(results[0], Exception) else None
            if len(results) > 1 and not isinstance(results[1], Exception) and results[1]:
                fund_cached = results[1]
                cache.set(fund_ck, fund_cached, 86400)
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
        _KR_FUND_KEYS = (
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
            # 캐시 없으면 짧은 타임아웃으로 동기 대기 — 첫 조회에서도 PEG/선행EPS 등이
            # 바로 보이도록 함 (백그라운드 fire-and-forget이면 이번 응답엔 못 반영됨)
            _yf_sym_bg = symbol if symbol.endswith((".KS",".KQ")) else f"{symbol}.KS"
            try:
                f = await asyncio.wait_for(
                    asyncio.get_running_loop().run_in_executor(
                        None, yf_service.get_fundamentals, _yf_sym_bg, "KR"
                    ), timeout=4
                )
                if f:
                    cache.set(fund_ck, f, 86400)
                    for key in _KR_FUND_KEYS:
                        if not price.get(key) and f.get(key) is not None:
                            price[key] = f[key]
            except Exception:
                pass

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
                    _VALUATION_FIELDS = (
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
                        # 캐시 없으면 짧은 타임아웃으로 동기 대기 — 첫 조회에서도
                        # PEG/선행EPS 등이 바로 보이도록 함 (fire-and-forget이면
                        # 이번 응답엔 못 반영되고 다음 조회에서야 나타남)
                        try:
                            f = await asyncio.wait_for(
                                asyncio.get_running_loop().run_in_executor(
                                    None, yf_service.get_fundamentals, symbol, "US"
                                ), timeout=4
                            )
                            if f:
                                cache.set(fund_ck, f, 86400)
                                for key in _VALUATION_FIELDS:
                                    if detail.get(key) is None and f.get(key) is not None:
                                        detail[key] = f[key]
                        except Exception:
                            pass
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
            # 캐시 없으면 짧은 타임아웃으로 동기 대기 후 반환
            try:
                f = await asyncio.wait_for(
                    asyncio.get_running_loop().run_in_executor(None, yf_service.get_fundamentals, symbol, "US"),
                    timeout=4
                )
                if f:
                    cache.set(fund_ck, f, 86400)
                    return await _with_ext_hours({**cached, **f})
            except Exception:
                pass
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


def _clean_enabled_metrics(raw: dict) -> dict:
    """{factor_key: [metric_key, ...]} — 알 수 없는 factor/metric 키는 제거.
    유효한 항목이 하나도 없는 factor는 결과에서 제외(= 전체 지표 사용으로 간주)."""
    from app.services.quant_score import FACTOR_METRIC_KEYS
    cleaned = {}
    for fkey, allowed_keys in raw.items():
        if fkey not in FACTOR_METRIC_KEYS or not isinstance(allowed_keys, list):
            continue
        valid = [k for k in allowed_keys if k in FACTOR_METRIC_KEYS[fkey]]
        if valid:
            cleaned[fkey] = valid
    return cleaned


@router.get("/quant-score/weights")
def get_quant_score_weights(
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """로그인한 사용자가 저장한 퀀트 점수 팩터 가중치/사용 지표 (없으면 기본값 반환)"""
    if current_user:
        row = db.query(QuantScoreWeight).filter(QuantScoreWeight.user_id == current_user.id).first()
        if row and row.weights:
            return {"weights": row.weights, "enabled_metrics": row.enabled_metrics or {}, "is_default": False}
    return {"weights": DEFAULT_WEIGHTS, "enabled_metrics": {}, "is_default": True}


@router.put("/quant-score/weights")
def save_quant_score_weights(
    payload: dict,
    current_user=Depends(require_user),
    db: Session = Depends(get_db),
):
    """퀀트 점수 팩터 가중치 + 팩터별 사용 지표 저장 (로그인 필요)
    weights: value/quality/momentum/growth/risk, 0~100
    enabled_metrics: {"value": ["per","pbr"], "quality": [...]} — 팩터를 생략하면 해당 팩터는 전체 지표 사용"""
    weights = payload.get("weights")
    if not isinstance(weights, dict):
        raise HTTPException(400, "weights 형식이 올바르지 않습니다")

    cleaned = {}
    for key in DEFAULT_WEIGHTS:
        v = weights.get(key, DEFAULT_WEIGHTS[key])
        try:
            v = float(v)
        except (TypeError, ValueError):
            raise HTTPException(400, f"{key} 가중치가 올바르지 않습니다")
        if v < 0 or v > 100:
            raise HTTPException(400, f"{key} 가중치는 0~100 사이여야 합니다")
        cleaned[key] = v
    if sum(cleaned.values()) <= 0:
        raise HTTPException(400, "가중치 합이 0보다 커야 합니다")

    enabled_metrics_raw = payload.get("enabled_metrics")
    enabled_metrics = _clean_enabled_metrics(enabled_metrics_raw) if isinstance(enabled_metrics_raw, dict) else {}

    row = db.query(QuantScoreWeight).filter(QuantScoreWeight.user_id == current_user.id).first()
    if row:
        row.weights = cleaned
        row.enabled_metrics = enabled_metrics
    else:
        row = QuantScoreWeight(user_id=current_user.id, weights=cleaned, enabled_metrics=enabled_metrics)
        db.add(row)
    db.commit()
    return {"weights": cleaned, "enabled_metrics": enabled_metrics}


@router.get("/quant-score/compare")
@limiter.limit("10/minute")
async def get_quant_score_compare(
    request: Request,
    symbols: str = Query(..., description="쉼표로 구분된 종목코드"),
    markets: str = Query(..., description="쉼표로 구분된 시장(symbols와 동일 순서, KR/US/ETF)"),
    w_value: float | None = Query(None, ge=0, le=100),
    w_quality: float | None = Query(None, ge=0, le=100),
    w_momentum: float | None = Query(None, ge=0, le=100),
    w_growth: float | None = Query(None, ge=0, le=100),
    w_risk: float | None = Query(None, ge=0, le=100),
    metrics_value: str | None = Query(None),
    metrics_quality: str | None = Query(None),
    metrics_momentum: str | None = Query(None),
    metrics_growth: str | None = Query(None),
    metrics_risk: str | None = Query(None),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """관심종목 등 사용자가 직접 고른 소수 종목들의 퀀트 점수를 같은 기준(가중치/사용 지표)으로
    나란히 비교. 전체 시장을 스캔하는 방식과 달리 지정된 종목만 조회하므로
    캐시 여부와 무관하게 항상 최신 점수를 보여줄 수 있다."""
    from app.services.quant_score import collect_quant_metrics
    from app.services.quant_percentile_service import get_percentile_distributions, get_sector_distribution

    sym_list = [s.strip() for s in symbols.split(",") if s.strip()]
    mkt_list = [m.strip().upper() for m in markets.split(",") if m.strip()]
    if not sym_list or len(sym_list) != len(mkt_list):
        raise HTTPException(400, "symbols와 markets 개수가 일치해야 합니다")
    if len(sym_list) > 30:
        raise HTTPException(400, "한 번에 최대 30개까지 비교할 수 있습니다")
    if any(m not in ("KR", "US", "ETF") for m in mkt_list):
        raise HTTPException(400, "markets는 KR/US/ETF만 허용됩니다")

    override = {"value": w_value, "quality": w_quality, "momentum": w_momentum, "growth": w_growth, "risk": w_risk}
    saved_row = None
    if current_user:
        saved_row = db.query(QuantScoreWeight).filter(QuantScoreWeight.user_id == current_user.id).first()

    if any(v is not None for v in override.values()):
        weights = {k: (v if v is not None else DEFAULT_WEIGHTS[k]) for k, v in override.items()}
    else:
        weights = saved_row.weights if (saved_row and saved_row.weights) else DEFAULT_WEIGHTS

    metrics_override = {
        "value": metrics_value, "quality": metrics_quality,
        "momentum": metrics_momentum, "growth": metrics_growth, "risk": metrics_risk,
    }
    if any(v is not None for v in metrics_override.values()):
        enabled_metrics = _clean_enabled_metrics({
            k: v.split(",") for k, v in metrics_override.items() if v is not None
        })
    else:
        enabled_metrics = (saved_row.enabled_metrics if (saved_row and saved_row.enabled_metrics) else {})

    dist_cache: dict[str, dict] = {}

    def _dist(mkt: str) -> dict:
        if mkt not in dist_cache:
            dist_cache[mkt] = get_percentile_distributions(mkt)
        return dist_cache[mkt]

    sem = asyncio.Semaphore(16)

    async def _score_one(sym: str, mkt: str) -> dict:
        async with sem:
            try:
                metrics = await collect_quant_metrics(sym, mkt, fetch_ohlcv=True)
            except Exception:
                return {"symbol": sym, "market": mkt, "total_score": None, "grade": None, "factors": []}
        sector = metrics.pop("_sector", None)
        sector_dist = get_sector_distribution(mkt, sector)
        result = compute_quant_score(metrics, weights, _dist(mkt), sector_dist, enabled_metrics)
        return {"symbol": sym, "market": mkt, **result}

    items = await asyncio.gather(*[_score_one(s, m) for s, m in zip(sym_list, mkt_list)])

    return {"weights": weights, "enabled_metrics": enabled_metrics, "items": list(items)}


@router.get("/{market}/{symbol}/quant-score")
@limiter.limit("30/minute")
async def get_quant_score(
    request: Request,
    market: Literal["KR","US","ETF"], symbol: str = Path(..., pattern=_SYMBOL_PATTERN),
    w_value: float | None = Query(None, ge=0, le=100),
    w_quality: float | None = Query(None, ge=0, le=100),
    w_momentum: float | None = Query(None, ge=0, le=100),
    w_growth: float | None = Query(None, ge=0, le=100),
    w_risk: float | None = Query(None, ge=0, le=100),
    metrics_value: str | None = Query(None, description="쉼표로 구분된 가치 팩터 사용 지표 키 (미지정 시 저장된 설정/전체 지표)"),
    metrics_quality: str | None = Query(None, description="쉼표로 구분된 품질 팩터 사용 지표 키 (미지정 시 저장된 설정/전체 지표)"),
    metrics_momentum: str | None = Query(None, description="쉼표로 구분된 모멘텀 팩터 사용 지표 키 (미지정 시 저장된 설정/전체 지표)"),
    metrics_growth: str | None = Query(None, description="쉼표로 구분된 성장 팩터 사용 지표 키 (미지정 시 저장된 설정/전체 지표)"),
    metrics_risk: str | None = Query(None, description="쉼표로 구분된 안정성 팩터 사용 지표 키 (미지정 시 저장된 설정/전체 지표)"),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """가치/품질/모멘텀/성장/안정성 5팩터 기반 퀀트 종합 점수 + 등급(S~F)
    w_* 쿼리 파라미터가 하나라도 오면 저장된 가중치 대신 즉시 미리보기로 사용(저장 안 함)
    metrics_* 쿼리 파라미터가 오면 해당 팩터에서 지정한 지표만 즉시 미리보기로 사용(저장 안 함)
    지표 점수는 같은 시장(KR/US/ETF) 내 백분위 상대평가(분포는 일배치로 미리 캐시되어
    조회 시점에는 이분 탐색만 수행) — 표본이 부족한 지표는 절대평가로 폴백"""
    from app.services.quant_score import collect_quant_metrics
    from app.services.quant_percentile_service import get_percentile_distributions, get_sector_distribution

    override = {"value": w_value, "quality": w_quality, "momentum": w_momentum, "growth": w_growth, "risk": w_risk}
    saved_row = None
    if current_user:
        saved_row = db.query(QuantScoreWeight).filter(QuantScoreWeight.user_id == current_user.id).first()

    if any(v is not None for v in override.values()):
        weights = {k: (v if v is not None else DEFAULT_WEIGHTS[k]) for k, v in override.items()}
    else:
        weights = saved_row.weights if (saved_row and saved_row.weights) else DEFAULT_WEIGHTS

    metrics_override = {
        "value": metrics_value, "quality": metrics_quality,
        "momentum": metrics_momentum, "growth": metrics_growth, "risk": metrics_risk,
    }
    if any(v is not None for v in metrics_override.values()):
        enabled_metrics = _clean_enabled_metrics({
            k: v.split(",") for k, v in metrics_override.items() if v is not None
        })
    else:
        enabled_metrics = (saved_row.enabled_metrics if (saved_row and saved_row.enabled_metrics) else {})

    metrics = await collect_quant_metrics(symbol, market)
    sector = metrics.pop("_sector", None)
    percentile_dist = await asyncio.get_running_loop().run_in_executor(None, get_percentile_distributions, market)
    sector_dist = await asyncio.get_running_loop().run_in_executor(None, get_sector_distribution, market, sector)

    result = compute_quant_score(metrics, weights, percentile_dist, sector_dist, enabled_metrics)
    result["weights"] = weights
    result["enabled_metrics"] = enabled_metrics
    return result


@router.get("/{market}/{symbol}/metrics-history")
async def get_metrics_history(market: Literal["KR","US","ETF"], symbol: str = Path(..., pattern=_SYMBOL_PATTERN)):
    """재무지표 연간/분기별 추이 (yfinance)"""
    from app.core.cache import cache
    ck = f"metrics_hist4:{symbol}"  # v4: eps_growth/peg 추가
    if c := cache.get(ck):
        return c
    _stale_mh = cache.get_stale(ck)

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
                ("eps",        "eps_growth"),
            ]:
                cv, pv = row.get(key), prev.get(key)
                if cv and pv and pv != 0:
                    row[gkey] = round((cv - pv) / abs(pv) * 100, 2)
            # PEG 보완 — PER ÷ EPS 성장률(%) (quant_score.py의 PEG 계산과 동일한 정의)
            if row.get("peg") is None and row.get("per") and row.get("eps_growth"):
                if row["eps_growth"] > 0:
                    row["peg"] = round(row["per"] / row["eps_growth"], 2)

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
                # PER/PBR/PSR 계산용 주가 이력 — 6년으로 2020년부터 커버
                hist = t.history(period="6y", interval="1mo")
                if hist.index.tz is not None:
                    hist.index = hist.index.tz_localize(None)
            except Exception:
                pass

            # 재무 DataFrame 6종을 ThreadPoolExecutor로 병렬 조회
            import concurrent.futures

            def _get(attr):
                try:
                    return getattr(yf.Ticker(yf_sym), attr)
                except Exception:
                    return None

            pool = concurrent.futures.ThreadPoolExecutor(max_workers=6)
            _futures = {attr: pool.submit(_get, attr) for attr in (
                "financials", "balance_sheet",
                "quarterly_financials", "quarterly_balance_sheet",
                "cashflow", "quarterly_cashflow",
            )}
            dfs = {}
            for attr, fut in _futures.items():
                try:
                    dfs[attr] = fut.result(timeout=20)
                except Exception:
                    dfs[attr] = None
            pool.shutdown(wait=False)

            annual    = _process(dfs["financials"],          dfs["balance_sheet"],          shares, hist)
            quarterly = _process(dfs["quarterly_financials"], dfs["quarterly_balance_sheet"], shares, hist)

            # YoY 성장률 추가
            _add_growth(annual)
            _add_growth(quarterly)

            # 현금흐름 병합
            try:
                cf_a = _process_cf(dfs["cashflow"])
                for row in annual:
                    row.update({k: v for k, v in cf_a.get(row["period"], {}).items() if k != "period"})
            except Exception:
                pass
            try:
                cf_q = _process_cf(dfs["quarterly_cashflow"])
                for row in quarterly:
                    row.update({k: v for k, v in cf_q.get(row["period"], {}).items() if k != "period"})
            except Exception:
                pass

            return {"annual": annual, "quarterly": quarterly}
        except Exception:
            return {"annual": [], "quarterly": []}

    # stale-while-revalidate: return stale immediately, refresh in background
    if _stale_mh:
        async def _bg_refresh_mh():
            try:
                loop2 = asyncio.get_running_loop()
                r = await asyncio.wait_for(loop2.run_in_executor(None, _fetch), timeout=60)
                # 이번에 일부 기간/필드가 비어오면 이전 캐시값으로 보강 (정확도 유지)
                r = {
                    "annual":    _merge_forecast_lists(r.get("annual", []),    _stale_mh.get("annual", [])),
                    "quarterly": _merge_forecast_lists(r.get("quarterly", []), _stale_mh.get("quarterly", [])),
                }
                cache.set(ck, r, 3600)
            except Exception:
                pass
        asyncio.get_running_loop().create_task(_bg_refresh_mh())
        return _stale_mh

    # 재무이력은 데이터가 많아 timeout을 60초로 늘림
    try:
        loop = asyncio.get_running_loop()
        result = await asyncio.wait_for(loop.run_in_executor(None, _fetch), timeout=60)
    except asyncio.TimeoutError:
        result = {"annual": [], "quarterly": []}
    if result.get("annual") or result.get("quarterly"):
        cache.set(ck, result, 3600)
    else:
        cache.set(ck, result, 60)  # 완전 실패 시 짧게 캐시해 빠른 재시도 허용
    return result


def _period_to_label(code: str) -> tuple[str, str] | None:
    """yfinance 상대 기간 코드(0q/+1q/-1y 등)를 실제 연도·분기 라벨로 변환
    반환: (라벨, "annual"|"quarterly") — 변환 불가/장기(±5y) 코드는 None
    """
    from datetime import datetime
    m = re.match(r"^([+-]?\d+)([qy])$", code)
    if not m:
        return None
    offset = int(m.group(1))
    unit = m.group(2)
    today = datetime.now()
    if unit == "y":
        if abs(offset) >= 5:
            return None
        return (str(today.year + offset), "annual")
    cur_q = (today.month - 1) // 3 + 1
    global_idx = today.year * 4 + (cur_q - 1) + offset
    return (f"{global_idx // 4}-Q{global_idx % 4 + 1}", "quarterly")


def _merge_forecast_lists(new_list: list, stale_list: list) -> list:
    """기간(period)별로 병합 — 새로 받아온 값을 우선하고, 이번에 타임아웃 등으로
    빠진 항목/필드는 이전 캐시 값으로 채워 정확도를 유지"""
    if not stale_list:
        return new_list
    stale_map = {item.get("period"): item for item in stale_list}
    seen = set()
    merged = []
    for item in new_list:
        period = item.get("period")
        seen.add(period)
        base = dict(stale_map.get(period, {}))
        base.update({k: v for k, v in item.items() if v is not None})
        merged.append(base)
    for period, item in stale_map.items():
        if period not in seen:
            merged.append(item)
    return sorted(merged, key=lambda x: x.get("period", ""))


@router.get("/{market}/{symbol}/forecasts")
async def get_forecasts(market: Literal["KR","US","ETF"], symbol: str = Path(..., pattern=_SYMBOL_PATTERN)):
    """컨센서스 추정치 — 연간/분기별 매출·EPS·영업이익·순이익·EBITDA·성장률
    in-memory → DB fresh(24h) → DB stale(30일) → 외부 API 순으로 조회해
    Render 재시작으로 메모리 캐시가 비워져도 데이터가 바로 사라지지 않게 한다."""
    from app.core.cache import cache
    from app.models.stock import ForecastsCache
    from app.services.fundamentals_service import _db_get, _db_set
    ck = f"forecasts:v3:{symbol}"
    if c := cache.get(ck):
        return c

    db_fresh = await _run(_db_get, ForecastsCache, symbol, market, 24)
    if db_fresh:
        cache.set(ck, db_fresh, 3600)
        return db_fresh

    db_stale = await _run(_db_get, ForecastsCache, symbol, market, 720)  # 30일까지는 stale로 사용
    stale = db_stale or cache.get_stale(ck)

    import yfinance as yf
    yf_sym = _resolve_kr_symbol(symbol, "KS") if market == "KR" else symbol

    def _fetch():
        import concurrent.futures

        # 4개 yfinance 속성을 병렬로 조회 (각각 별도 Ticker 인스턴스)
        def _get_ee():
            try:
                return yf.Ticker(yf_sym).earnings_estimate
            except Exception:
                return None

        def _get_re():
            try:
                return yf.Ticker(yf_sym).revenue_estimate
            except Exception:
                return None

        def _get_et():
            try:
                return yf.Ticker(yf_sym).eps_trend
            except Exception:
                return None

        def _get_ge():
            try:
                return yf.Ticker(yf_sym).growth_estimates
            except Exception:
                return None

        # with 블록은 종료 시 모든 작업 완료까지 대기해 result(timeout=) 효과를 무력화하므로
        # shutdown(wait=False)로 응답 시한을 넘긴 작업은 백그라운드에 두고 즉시 반환
        pool = concurrent.futures.ThreadPoolExecutor(max_workers=4)
        f_ee = pool.submit(_get_ee)
        f_re = pool.submit(_get_re)
        f_et = pool.submit(_get_et)
        f_ge = pool.submit(_get_ge)
        try:
            ee = f_ee.result(timeout=12)
        except Exception:
            ee = None
        try:
            re_ = f_re.result(timeout=12)
        except Exception:
            re_ = None
        try:
            et = f_et.result(timeout=12)
        except Exception:
            et = None
        try:
            ge = f_ge.result(timeout=12)
        except Exception:
            ge = None
        pool.shutdown(wait=False)

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
            if ee is not None and not ee.empty:
                for idx, row in ee.iterrows():
                    conv = _period_to_label(str(idx))
                    if conv is None:
                        continue
                    p, bucket = conv
                    store = quarterly if bucket == "quarterly" else annual
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
            if re_ is not None and not re_.empty:
                for idx, row in re_.iterrows():
                    conv = _period_to_label(str(idx))
                    if conv is None:
                        continue
                    p, bucket = conv
                    store = quarterly if bucket == "quarterly" else annual
                    _upsert(store, p,
                        revenue_est=_safe_float(row.get("avg") or row.get("Avg Estimate")),
                        revenue_low=_safe_float(row.get("low") or row.get("Low Estimate")),
                        revenue_high=_safe_float(row.get("high") or row.get("High Estimate")),
                    )
        except Exception:
            pass

        # ── eps_trend (추정치 변화 추이) ─────────────────────
        try:
            if et is not None and not et.empty:
                for idx, row in et.iterrows():
                    conv = _period_to_label(str(idx))
                    if conv is None:
                        continue
                    p, bucket = conv
                    store = quarterly if bucket == "quarterly" else annual
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
            if ge is not None and not ge.empty:
                for idx, row in ge.iterrows():
                    conv = _period_to_label(str(idx))
                    if conv is None:
                        continue
                    p, bucket = conv
                    store = quarterly if bucket == "quarterly" else annual
                    _upsert(store, p,
                        growth_est=_safe_float(row.get(yf_sym) or row.get("stock")),
                    )
        except Exception:
            pass

        return {
            "annual":    sorted(annual.values(),    key=lambda x: x["period"]),
            "quarterly": sorted(quarterly.values(), key=lambda x: x["period"]),
        }

    try:
        result = await _run(_fetch)
    except Exception:
        result = {"annual": [], "quarterly": []}
    if stale:
        result = {
            "annual":    _merge_forecast_lists(result.get("annual", []),    stale.get("annual", [])),
            "quarterly": _merge_forecast_lists(result.get("quarterly", []), stale.get("quarterly", [])),
        }
    if result.get("annual") or result.get("quarterly"):
        cache.set(ck, result, 3600)
        await _run(_db_set, ForecastsCache, symbol, market, result)
        return result
    return stale or result


@router.get("/{market}/{symbol}/disclosures")
async def get_disclosures(market: Literal["KR","US","ETF"], symbol: str = Path(..., pattern=_SYMBOL_PATTERN)):
    """국내 공시 목록 (OpenDART)
    최초 호출 시 전체 기업코드 매핑 파일(corpCode.xml, 수 MB)을 내려받아야 해서
    일반 API보다 오래 걸릴 수 있다 — 공용 _run(15초)이 아닌 넉넉한 타임아웃 사용.
    """
    if market != "KR" or not settings.DART_API_KEY:
        return []
    loop = asyncio.get_running_loop()
    try:
        return await asyncio.wait_for(
            loop.run_in_executor(None, dart_service.get_disclosures, symbol), timeout=45
        )
    except Exception:
        return []


# 법인 접미사 (종목명 끝부분) — 해외 종합피드 매칭용 검색어 추출 시 제거
_CORP_SUFFIX_RE = re.compile(r"\s+(Inc\.?|Corporation|Corp\.?|Co\.?|Company|Platforms|Holdings|Group|plc|Trust|ETF|N\.V\.|Ltd\.?|\.com)\s*$", re.I)
# 종목명만으로는 검색어가 모호한 해외 종목 — 직접 지정
_US_NAME_OVERRIDES = {
    "AMD": "AMD", "V": "Visa", "JPM": "JPMorgan", "AMZN": "Amazon",
    "GOOGL": "Alphabet", "GOOG": "Alphabet",
}
# 해외 뉴스가 국내 언론사 기사(한글)로 대체됨에 따라, 한글 기사 제목 매칭을 위한 주요 종목 한글명
_US_NAME_KO = {
    "AAPL": "애플", "TSLA": "테슬라", "MSFT": "마이크로소프트", "GOOGL": "알파벳", "GOOG": "알파벳",
    "AMZN": "아마존", "NVDA": "엔비디아", "META": "메타", "NFLX": "넷플릭스", "INTC": "인텔",
    "QCOM": "퀄컴", "BA": "보잉", "DIS": "디즈니", "JPM": "JP모건", "V": "비자", "MA": "마스터카드",
    "PYPL": "페이팔", "ORCL": "오라클", "CRM": "세일즈포스", "ADBE": "어도비", "PFE": "화이자",
    "JNJ": "존슨앤드존슨", "KO": "코카콜라", "PEP": "펩시코", "WMT": "월마트", "XOM": "엑손모빌",
    "CVX": "셰브론", "BAC": "뱅크오브아메리카", "GS": "골드만삭스", "UBER": "우버", "SBUX": "스타벅스",
    "NKE": "나이키", "MCD": "맥도날드",
}


def _us_search_terms(symbol: str, name: str | None) -> list[str]:
    """해외 종합피드에서 이 종목을 언급한 기사를 찾기 위한 검색어 목록"""
    terms = []
    ko = _US_NAME_KO.get(symbol)
    if ko:
        terms.append(ko)
    override = _US_NAME_OVERRIDES.get(symbol)
    if override:
        terms.append(override)
    elif name:
        base = _CORP_SUFFIX_RE.sub("", name).strip()
        first = base.split()[0] if base.split() else ""
        if len(first) >= 3:
            terms.append(first)
    if len(symbol) >= 3:
        terms.append(symbol)
    return list(dict.fromkeys(terms))


def _to_kst_published(value, short_mmdd: bool = False) -> str:
    """다양한 형식의 발행시각을 'YYYY/MM/DD HH:MM' (KST) 문자열로 정규화"""
    from datetime import datetime, timezone, timedelta
    KST = timezone(timedelta(hours=9))
    try:
        if short_mmdd:
            # 종합피드의 'MM/DD HH:MM' (연도 없음) → 현재 연도 기준 보완
            now_kst = datetime.now(KST)
            month = int(str(value)[:2])
            year = now_kst.year if month <= now_kst.month else now_kst.year - 1
            return f"{year}/{value}"
        if isinstance(value, (int, float)) and value:
            dt = datetime.fromtimestamp(value, tz=timezone.utc)
            return dt.astimezone(KST).strftime("%Y/%m/%d %H:%M")
        if isinstance(value, str) and value:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(KST).strftime("%Y/%m/%d %H:%M")
    except Exception:
        pass
    return value if isinstance(value, str) else ""


def _merge_news(primary: list, secondary: list, limit: int = 120) -> list:
    """종합피드(이미지 보장, 다양한 언론사) 결과를 우선 배치하고 종목별 검색 결과로 보강, 링크 기준 중복 제거"""
    seen, result = set(), []
    for item in (*primary, *secondary):
        link = item.get("link")
        if not link or link in seen:
            continue
        seen.add(link)
        result.append(item)
        if len(result) >= limit:
            break
    return result


@router.get("/{market}/{symbol}/news")
async def get_stock_news(market: Literal["KR","US","ETF"], symbol: str = Path(..., pattern=_SYMBOL_PATTERN)):
    """종목 관련 뉴스 — 종합 RSS 피드(다양한 언론사 + 이미지 보장) + 종목별 검색(KR: 구글뉴스, US: yfinance) 병합"""
    from app.core.cache import cache
    ck = f"stock_news:{market}:{symbol}"
    if c := cache.get(ck):
        return c

    from app.services.news_service import _extract_thumbnail, _add_trending_score, get_kr_news, get_us_news
    code6 = symbol.replace(".KS","").replace(".KQ","")

    if market == "KR":
        # 종목명 조회 — 데모 데이터 → 가격 캐시(실제 한글명) → 코드 순
        demo = DEMO_PRICES.get(symbol) or DEMO_PRICES.get(code6+".KS")
        stock_name = demo.get("name") if demo else None
        if not stock_name:
            cached_price = cache.get(f"price:{symbol}") or cache.get_stale(f"price:{symbol}")
            stock_name = (cached_price or {}).get("name")
        if not stock_name or stock_name == symbol:
            stock_name = code6

        def _fetch_kr():
            import feedparser
            from datetime import timezone, timedelta, datetime
            KST = timezone(timedelta(hours=9))
            items = []
            import urllib.parse
            query = urllib.parse.quote(stock_name)
            google_rss = f"https://news.google.com/rss/search?q={query}+주식+주가&hl=ko&gl=KR&ceid=KR:ko"
            feed = feedparser.parse(google_rss)
            entries_sorted = sorted(
                (e for e in (feed.entries or []) if e.get("published_parsed")),
                key=lambda e: e.published_parsed,
                reverse=True,
            )[:120]
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
                image = _extract_thumbnail(entry)
                source = (entry.get("source") or {}).get("title", "")
                items.append({
                    "title": title,
                    "link": entry.get("link", ""),
                    "source": source,
                    "published": pub,
                    "published_ts": pub_ts,
                    "summary": (entry.get("summary") or "")[:200],
                    "image": image,
                })
            return items

        def _match_feed_kr():
            matched = [
                dict(a) for a in get_kr_news()
                if stock_name in a.get("title", "") or stock_name in a.get("summary", "")
            ]
            for a in matched:
                a["published"] = _to_kst_published(a.get("published", ""), short_mmdd=True)
            return matched

        google_items, feed_items = await asyncio.gather(_run(_fetch_kr), _run(_match_feed_kr), return_exceptions=True)
        if isinstance(google_items, Exception):
            google_items = []
        if isinstance(feed_items, Exception):
            feed_items = []
        result = _merge_news(feed_items, google_items)

    else:
        # 해외 종합피드에서 이 종목 관련 기사 매칭 (ETF 포함)
        demo = DEMO_PRICES.get(symbol)
        name = demo.get("name") if demo else None
        if not name:
            cached_price = cache.get(f"price:{symbol}") or cache.get_stale(f"price:{symbol}")
            name = (cached_price or {}).get("name")
        search_terms = _us_search_terms(symbol, name)
        # 해외 뉴스가 이제 국내 언론사 한글 기사이므로, 한글 검색어는 단순 포함 여부로,
        # 영문 심볼/회사명은 단어 경계 매칭으로 판별
        _korean_re = re.compile(r"[가-힣]")
        patterns = [
            (t, True) if _korean_re.search(t) else (re.compile(rf"\b{re.escape(t)}\b", re.I), False)
            for t in search_terms
        ]

        def _match_feed_us():
            if not patterns:
                return []
            def _hit(title: str) -> bool:
                for matcher, is_korean in patterns:
                    if is_korean:
                        if matcher in title:
                            return True
                    elif matcher.search(title):
                        return True
                return False
            matched = [
                dict(a) for a in get_us_news()
                if _hit(a.get("title", "")) or _hit(a.get("summary", ""))
            ]
            for a in matched:
                a["published"] = _to_kst_published(a.get("published", ""), short_mmdd=True)
            return matched

        # US: yfinance 뉴스
        import yfinance as yf
        def _fetch_us():
            try:
                ticker = yf.Ticker(symbol)
                items = []
                for n in (ticker.news or [])[:50]:
                    ct = n.get("content", {})
                    title = ct.get("title") or n.get("title", "")
                    link  = (ct.get("canonicalUrl") or {}).get("url") or n.get("link", "")
                    pub   = ct.get("pubDate") or n.get("providerPublishTime", "")
                    provider = (ct.get("provider") or {}).get("displayName") or n.get("publisher", "")
                    if not title:
                        continue
                    thumb = ct.get("thumbnail") or n.get("thumbnail") or {}
                    resolutions = thumb.get("resolutions") or []
                    image = resolutions[0].get("url") if resolutions else thumb.get("originalUrl")
                    items.append({"title": title, "link": link, "source": provider, "published": _to_kst_published(pub), "summary": (ct.get("summary") or "")[:200], "image": image})
                return items
            except Exception:
                return []

        yf_items, feed_items = await asyncio.gather(_run(_fetch_us), _run(_match_feed_us), return_exceptions=True)
        if isinstance(yf_items, Exception):
            yf_items = []
        if isinstance(feed_items, Exception):
            feed_items = []
        result = _merge_news(feed_items, yf_items)

    # 인기순 정렬에 필요한 trend_score 계산
    if result:
        result = _add_trending_score(result)

    cache.set(ck, result, 300)
    return result


@router.get("/{market}/{symbol}/earnings")
async def get_earnings(market: Literal["KR","US","ETF"], symbol: str = Path(..., pattern=_SYMBOL_PATTERN)):
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


# yfinance recommendationKey → 한글 라벨 (전용 컨센서스 모듈이 비어있을 때 보조 소스로 사용)
_REC_KEY_LABEL = {
    "strong_buy": "강력매수", "buy": "매수", "outperform": "매수", "overweight": "매수",
    "hold": "보유", "neutral": "보유", "market_perform": "보유", "equal_weight": "보유",
    "sell": "매도", "underperform": "매도", "underweight": "매도",
    "strong_sell": "강력매도",
}


@router.get("/{market}/{symbol}/analyst")
async def get_analyst(market: Literal["KR","US","ETF"], symbol: str = Path(..., pattern=_SYMBOL_PATTERN)):
    """애널리스트 투자의견 — 목표주가, 의견분포, 최근 리포트
    in-memory → DB fresh(24h) → DB stale(30일, +백그라운드 갱신) → 외부 API 순으로 조회.
    DB에 영속 저장해 Render 재시작으로 메모리 캐시가 비워져도 데이터가 사라지지 않게 한다."""
    from app.core.cache import cache
    from app.models.stock import AnalystCache
    from app.services.fundamentals_service import _db_get, _db_set
    ck = f"analyst:v3:{symbol}"
    if c := cache.get(ck):
        return c

    db_fresh = await _run(_db_get, AnalystCache, symbol, market, 24)
    if db_fresh:
        cache.set(ck, db_fresh, 86400)
        return db_fresh

    db_stale = await _run(_db_get, AnalystCache, symbol, market, 720)  # 30일까지는 stale로 사용
    stale_analyst = db_stale or cache.get_stale(ck)
    if db_stale:
        cache.set(ck, db_stale, 3600)

    import yfinance as yf
    yf_sym = _resolve_kr_symbol(symbol, "KS") if market == "KR" else symbol
    code6 = symbol.replace(".KS","").replace(".KQ","") if market == "KR" else ""

    def _fetch():
        import concurrent.futures

        # 3개 yfinance 속성을 병렬로 조회 (순차 실행 시 15s 타임아웃 → 병렬 시 ~4s)
        def _get_apt():
            try:
                return yf.Ticker(yf_sym).analyst_price_targets
            except Exception:
                return None

        def _get_rs():
            try:
                return yf.Ticker(yf_sym).recommendations_summary
            except Exception:
                return None

        def _get_ud():
            try:
                return yf.Ticker(yf_sym).upgrades_downgrades
            except Exception:
                return None

        def _get_fund():
            try:
                return yf_service.get_fundamentals(yf_sym, market)
            except Exception:
                return None

        # Finnhub 목표주가/추천동향 — 국내 종목은 미지원이라 KR 제외
        def _get_fh_pt():
            if market == "KR":
                return None
            try:
                return finnhub_service.get_price_target(yf_sym)
            except Exception:
                return None

        def _get_fh_rec():
            if market == "KR":
                return None
            try:
                return finnhub_service.get_recommendation_trends(yf_sym)
            except Exception:
                return None

        # with 블록은 종료 시 모든 작업 완료까지 대기해 result(timeout=) 효과를 무력화하므로
        # shutdown(wait=False)로 응답 시한을 넘긴 작업은 백그라운드에 두고 즉시 반환
        pool = concurrent.futures.ThreadPoolExecutor(max_workers=6)
        f_apt  = pool.submit(_get_apt)
        f_rs   = pool.submit(_get_rs)
        f_ud   = pool.submit(_get_ud)
        f_fund = pool.submit(_get_fund)
        f_fhpt = pool.submit(_get_fh_pt)
        f_fhrec= pool.submit(_get_fh_rec)
        try:
            apt = f_apt.result(timeout=12)
        except Exception:
            apt = None
        try:
            rs = f_rs.result(timeout=12)
        except Exception:
            rs = None
        try:
            ud = f_ud.result(timeout=12)
        except Exception:
            ud = None
        try:
            fund = f_fund.result(timeout=12)
        except Exception:
            fund = None
        try:
            fh_pt = f_fhpt.result(timeout=12)
        except Exception:
            fh_pt = None
        try:
            fh_rec = f_fhrec.result(timeout=12)
        except Exception:
            fh_rec = None
        pool.shutdown(wait=False)

        result: dict = {}

        # 목표주가
        if apt and isinstance(apt, dict):
            result["price_targets"] = {
                "current": _safe_float(apt.get("current")),
                "mean":    _safe_float(apt.get("mean")),
                "median":  _safe_float(apt.get("median")),
                "high":    _safe_float(apt.get("high")),
                "low":     _safe_float(apt.get("low")),
            }

        # 투자의견 분포 (현재월)
        try:
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
                        "target":       _safe_float(row.get("currentPriceTarget")),
                        "prior_target": _safe_float(row.get("priorPriceTarget")),
                    })
                result["reports"] = reports
        except Exception:
            pass

        # 목표주가/투자의견 보완 — 전용 컨센서스 모듈(apt/rs)이 비어있을 때
        # 펀더멘털(yfinance info)에 들어있는 컨센서스 값으로 대체 (국내 종목 등에서 자주 발생)
        if fund:
            if not result.get("price_targets") and fund.get("target_price_mean"):
                price_cached = cache.get(f"price:{symbol}") or cache.get_stale(f"price:{symbol}") or {}
                result["price_targets"] = {
                    "current": price_cached.get("price"),
                    "mean":    fund.get("target_price_mean"),
                    "high":    fund.get("target_price_high"),
                    "low":     fund.get("target_price_low"),
                }
            if not result.get("consensus") and fund.get("recommendation"):
                rec_label = _REC_KEY_LABEL.get(str(fund.get("recommendation","")).lower())
                if rec_label:
                    nc = result.setdefault("naver_consensus", {})
                    nc.setdefault("recommendation", rec_label)
                    if fund.get("analyst_count"):
                        nc.setdefault("analyst_count", int(fund["analyst_count"]))

        # 목표주가/투자의견 추가 보완 — yfinance에서 아무것도 못 얻었을 때 Finnhub로 대체
        if not result.get("price_targets") and fh_pt:
            price_cached = cache.get(f"price:{symbol}") or cache.get_stale(f"price:{symbol}") or {}
            result["price_targets"] = {
                "current": price_cached.get("price"),
                "mean":    fh_pt.get("mean"),
                "high":    fh_pt.get("high"),
                "low":     fh_pt.get("low"),
                "median":  fh_pt.get("median"),
            }
        if not result.get("consensus") and fh_rec:
            result["consensus"] = {
                "strong_buy":  fh_rec.get("strong_buy", 0),
                "buy":         fh_rec.get("buy", 0),
                "hold":        fh_rec.get("hold", 0),
                "sell":        fh_rec.get("sell", 0),
                "strong_sell": fh_rec.get("strong_sell", 0),
            }

        return result

    # KR 종목: Naver 컨센서스 목표주가 + 애널리스트 의견 직접 조회
    async def _fetch_kr_analyst() -> dict:
        """네이버 통합(integration) API의 totalInfos에서 목표주가·투자의견 항목을 값의
        패턴으로 탐지해 조회한다 (전용 consensusOpinion/opinion/consensus 엔드포인트는
        더 이상 응답하지 않아 제거됨 — 가격 조회에도 쓰이는 integration 엔드포인트를 재사용)"""
        import httpx, math, re
        headers = {
            "User-Agent": "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/80.0 Mobile Safari/537.36",
            "Referer": "https://m.stock.naver.com/",
        }

        def _sf(v):
            try:
                f = float(str(v).replace(",",""))
                return None if (math.isnan(f) or math.isinf(f)) else f
            except Exception:
                return None

        # "4.04매수" / "3.50중립" 같은 투자의견 점수+등급 패턴
        _opinion_re = re.compile(r"^(\d(?:\.\d{1,2})?)\s*(적극매수|매수|중립|보유|매도|적극매도)$")
        _grade_to_label = {
            "적극매수": "강력매수", "매수": "매수", "중립": "보유", "보유": "보유",
            "매도": "매도", "적극매도": "강력매도",
        }

        try:
            loop = asyncio.get_running_loop()
            r = await asyncio.wait_for(
                loop.run_in_executor(None, lambda: httpx.get(
                    f"https://m.stock.naver.com/api/stock/{code6}/integration",
                    headers=headers, timeout=8,
                )), timeout=10
            )
            if r.status_code != 200:
                return {}
            infos = r.json().get("totalInfos") or []

            out: dict = {}
            opinion_score = opinion_grade = None
            target_price = None

            for item in infos:
                name = str(item.get("name") or "")
                code = str(item.get("code") or "")
                value = str(item.get("value") or "").strip()
                if not value:
                    continue

                m = _opinion_re.match(value.replace(" ", ""))
                if m:
                    opinion_score = _sf(m.group(1))
                    opinion_grade = m.group(2)
                    continue

                if ("목표" in name and "주가" in name) or "target" in code.lower() or "goal" in code.lower():
                    tv = _sf(value)
                    if tv:
                        target_price = tv

            if target_price:
                price_src = cache.get(f"price:{yf_sym}") or cache.get_stale(f"price:{yf_sym}") or {}
                out["price_targets"] = {
                    "current": price_src.get("price"),
                    "mean":    target_price,
                }

            if opinion_grade:
                nc = out.setdefault("naver_consensus", {})
                nc["recommendation"] = _grade_to_label.get(opinion_grade, opinion_grade)
                if opinion_score is not None:
                    nc["score"] = opinion_score

            return out
        except Exception:
            return {}

    if stale_analyst:
        # stale 캐시(메모리 또는 DB) 즉시 반환, 백그라운드에서 갱신 + DB 영속 저장
        async def _bg_analyst():
            try:
                loop2 = asyncio.get_running_loop()
                r2 = await asyncio.wait_for(loop2.run_in_executor(None, _fetch), timeout=20)
                if market == "KR":
                    naver_r = await _fetch_kr_analyst()
                    r2 = {**r2, **naver_r}
                _enrich_analyst_fallback(r2, yf_sym, market)
                _fill_analyst_gaps(r2, stale_analyst)
                if r2:
                    cache.set(ck, r2, 86400)
                    await _run(_db_set, AnalystCache, symbol, market, r2)
            except Exception:
                pass
        asyncio.get_running_loop().create_task(_bg_analyst())
        return stale_analyst

    try:
        result = await asyncio.wait_for(
            asyncio.get_running_loop().run_in_executor(None, _fetch),
            timeout=20
        )
    except Exception:
        result = {}

    # KR 종목: Naver 컨센서스 목표주가·의견 보완
    if market == "KR":
        naver_analyst = await _fetch_kr_analyst()
        # Naver 데이터를 우선, yfinance로 보완
        result = {**result, **naver_analyst}

    _enrich_analyst_fallback(result, yf_sym, market)
    _fill_analyst_gaps(result, stale_analyst)

    if result:
        cache.set(ck, result, 86400)
        await _run(_db_set, AnalystCache, symbol, market, result)
    elif stale_analyst:
        return stale_analyst
    return result or {}


def _fill_analyst_gaps(result: dict, stale: dict | None):
    """이번 조회에서 타임아웃 등으로 빠진 항목을 이전 캐시 값으로 채워 정확도 유지 (새 값이 우선)"""
    if not stale:
        return
    for k, v in stale.items():
        if not result.get(k) and v:
            result[k] = v


def _enrich_analyst_fallback(result: dict, symbol: str, market: str):
    """price/fund 캐시로 투자의견·목표주가 보완 — 1차 조회가 비어있을 때 모든 시장 공통 폴백"""
    from app.core.cache import cache
    fund_cached  = cache.get(f"fund:{symbol}") or cache.get_stale(f"fund:{symbol}")
    price_cached = cache.get(f"price:{symbol}") or cache.get_stale(f"price:{symbol}")
    for src in [fund_cached, price_cached]:
        if not src:
            continue
        if not result.get("price_targets"):
            tp_mean = src.get("target_price_mean")
            curr    = src.get("price")
            if tp_mean:
                result["price_targets"] = {
                    "current": curr,
                    "mean":    tp_mean,
                    "high":    src.get("target_price_high"),
                    "low":     src.get("target_price_low"),
                }
        if src.get("forward_per") or src.get("recommendation"):
            nc = result.setdefault("naver_consensus", {})
            if nc.get("cons_per") is None and src.get("forward_per"):
                nc["cons_per"] = src.get("forward_per")
                nc["cons_eps"] = src.get("forward_eps")
            if nc.get("recommendation") is None:
                rec_label = _REC_KEY_LABEL.get(str(src.get("recommendation","")).lower())
                if rec_label:
                    nc["recommendation"] = rec_label
            if src.get("analyst_count"):
                nc.setdefault("analyst_count", src.get("analyst_count"))


@router.get("/KR/{symbol}/supply-demand")
async def get_supply_demand(symbol: str = Path(..., pattern=_SYMBOL_PATTERN), days: int = Query(default=30)):
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
