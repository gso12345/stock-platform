import yfinance as yf
import pandas as pd
import math
from typing import Optional
from app.core.cache import cache

PRICE_TTL  = 30      # 현재가 캐시 30초
INDEX_TTL  = 60      # 지수 캐시 60초
OHLCV_TTL  = 21600   # OHLCV 캐시 6시간 (일봉 이상은 당일 변경 없음)
FUND_TTL   = 86400   # 재무지표 캐시 24시간


def _safe(v):
    """nan/inf를 None으로 변환"""
    if v is None:
        return None
    try:
        f = float(v)
        return None if (math.isnan(f) or math.isinf(f)) else f
    except (TypeError, ValueError):
        return v


def _clean(d: dict) -> dict:
    return {k: _safe(v) if isinstance(v, float) else v for k, v in d.items()}

PERIOD_MAP = {
    "1d": "1d", "5d": "5d",
    "1m": "1mo", "1mo": "1mo", "3m": "3mo", "3mo": "3mo",
    "6m": "6mo", "6mo": "6mo",
    "1y": "1y", "2y": "2y", "3y": "3y", "5y": "5y", "10y": "10y", "max": "max",
}

INDEX_SYMBOLS = {
    # 국내
    "KOSPI":    "^KS11",
    "KOSDAQ":   "^KQ11",
    "KOSPI200": "^KS200",
    "KOSDAQ150":"^KQ150",
    # 미국
    "SP500":    "^GSPC",
    "NASDAQ":   "^IXIC",
    "DOW":      "^DJI",
    "SOX":      "^SOX",       # 필라델피아 반도체
    "RUSSELL":  "^RUT",       # 러셀 2000
    # 환율/채권
    "USDKRW":  "USDKRW=X",
    "US10Y":   "^TNX",        # 미국 10년 국채 금리
    "US2Y":    "^IRX",        # 미국 단기 금리
}

INDEX_NAMES = {
    "KOSPI":    "코스피",
    "KOSDAQ":   "코스닥",
    "KOSPI200": "코스피 200",
    "KOSDAQ150":"코스닥 150",
    "SP500":    "S&P 500",
    "NASDAQ":   "나스닥 종합",
    "DOW":      "다우 산업",
    "SOX":      "필라델피아 반도체",
    "RUSSELL":  "러셀 2000",
    "USDKRW":  "원/달러",
    "US10Y":   "미국 10년 국채",
    "US2Y":    "미국 단기 금리",
}

SP500_SYMBOLS = [
    "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "AVGO", "JPM", "V",
    "MA", "UNH", "XOM", "WMT", "LLY", "JNJ", "COST", "HD", "BAC", "CVX",
    "MRK", "ABBV", "AMD", "NFLX", "CRM", "ORCL", "ACN", "TMO", "ADBE", "KO",
    "PEP", "DHR", "MCD", "NKE", "INTC", "QCOM", "IBM", "TXN", "PM", "GS",
    "CAT", "HON", "BA", "AMGN", "LMT", "MDT", "GILD", "SPGI", "AXP", "BLK",
]

KOSPI_SYMBOLS = [
    "005930.KS", "000660.KS", "035420.KS", "005380.KS", "000270.KS",
    "068270.KS", "105560.KS", "055550.KS", "028260.KS", "012330.KS",
    "066570.KS", "003550.KS", "032830.KS", "018260.KS", "009150.KS",
    "051910.KS", "034730.KS", "015760.KS", "030200.KS", "096770.KS",
    "010130.KS", "011200.KS", "003490.KS", "086790.KS", "000720.KS",
    "017670.KS", "010950.KS", "004020.KS", "009540.KS", "033780.KS",
]

KOSDAQ_SYMBOLS = [
    "035720.KQ", "247540.KQ", "086900.KQ", "196170.KQ", "112040.KQ",
    "041510.KQ", "293490.KQ", "263750.KQ", "058470.KQ", "036570.KQ",
    "357780.KQ", "039030.KQ", "067160.KQ", "214150.KQ", "091990.KQ",
]

ETF_SYMBOLS = [
    "SPY", "QQQ", "IWM", "DIA", "VTI", "VOO", "GLD", "SLV", "TLT", "HYG",
    "XLF", "XLK", "XLE", "XLV", "XLI", "ARKK", "SOXX", "VNQ", "EEM",
    "069500.KS", "114800.KS", "122630.KS", "252670.KS", "kodex200.KS",
]


def _resolve_kr_symbol(symbol: str, market: str) -> str:
    """한국 종목코드에 야후파이낸스 접미사 자동 부여"""
    if "." in symbol:
        return symbol
    if market == "KQ":
        return f"{symbol}.KQ"
    return f"{symbol}.KS"


class YFinanceService:
    def get_stock_price(self, symbol: str, market: str = "US") -> dict:
        if market == "KR":
            symbol = _resolve_kr_symbol(symbol, "KS")

        ck = f"price:{symbol}"
        cached = cache.get(ck)
        if cached:
            return cached

        try:
            ticker = yf.Ticker(symbol)
            info = ticker.info
            hist = ticker.history(period="5d")
        except Exception:
            stale = cache.get_stale(ck)
            if stale:
                return stale
            return {"symbol": symbol, "price": None, "change": 0, "change_rate": 0, "volume": 0, "market_cap": 0}

        closes = hist["Close"].dropna() if len(hist) > 0 else pd.Series(dtype=float)

        if len(closes) >= 2:
            prev = float(closes.iloc[-2])
            curr = float(closes.iloc[-1])
            change = curr - prev
            change_rate = (change / prev) * 100 if prev else 0
        elif len(closes) == 1:
            curr = float(closes.iloc[-1])
            change = float(info.get("regularMarketChange", 0) or 0)
            change_rate = float(info.get("regularMarketChangePercent", 0) or 0)
        else:
            curr = float(info.get("currentPrice") or info.get("regularMarketPrice") or 0)
            change = float(info.get("regularMarketChange", 0) or 0)
            change_rate = float(info.get("regularMarketChangePercent", 0) or 0)

        result = _clean({
            "symbol": symbol,
            "name": info.get("longName") or info.get("shortName") or symbol,
            "price": round(curr, 2),
            "change": round(change, 2),
            "change_rate": round(change_rate, 2),
            "volume": int(info.get("regularMarketVolume") or info.get("volume") or 0),
            "market_cap": int(info.get("marketCap") or 0),
            "currency": info.get("currency", "USD"),
            "high":       round(float(info.get("regularMarketDayHigh") or 0), 2),
            "low":        round(float(info.get("regularMarketDayLow") or 0), 2),
            "open":       round(float(info.get("regularMarketOpen") or 0), 2),
            "prev_close": round(float(info.get("regularMarketPreviousClose") or info.get("previousClose") or 0), 2) or None,
        })
        cache.set(ck, result, PRICE_TTL)
        return result

    def _resample_nday(self, hist, n: int) -> list:
        """1일봉 DataFrame을 N일봉으로 리샘플링"""
        import pandas as pd
        rule = f"{n}B"  # N 영업일 단위 (Business Day)
        rs = hist.resample(rule).agg({
            "Open":   "first",
            "High":   "max",
            "Low":    "min",
            "Close":  "last",
            "Volume": "sum",
        }).dropna(subset=["Close"])
        return [
            {
                "date":   str(idx.date()),
                "open":   round(float(r["Open"]),   2),
                "high":   round(float(r["High"]),   2),
                "low":    round(float(r["Low"]),    2),
                "close":  round(float(r["Close"]),  2),
                "volume": int(r["Volume"]),
            }
            for idx, r in rs.iterrows()
        ]

    def get_ohlcv(self, symbol: str, period: str = "1y", interval: str = "1d", market: str = "US") -> list:
        if market == "KR":
            symbol = _resolve_kr_symbol(symbol, "KS")
        ck = f"ohlcv:{symbol}:{period}:{interval}"
        cached = cache.get(ck)
        if cached:
            return cached

        # N일봉 (3d/10d/30d/60d) — 1d 데이터 fetch 후 리샘플링
        NDAY_MAP = {"3d": 3, "10d": 10, "30d": 30, "60d": 60}
        if interval in NDAY_MAP:
            n = NDAY_MAP[interval]
            hist = yf.Ticker(symbol).history(period="max", interval="1d")
            hist = hist.dropna(subset=["Close"])
            if hist.index.tz is not None:
                hist.index = hist.index.tz_convert("Asia/Seoul").tz_localize(None) if market == "KR" else hist.index.tz_localize(None)
            result = self._resample_nday(hist, n)
            cache.set(ck, result, OHLCV_TTL)
            return result

        is_intraday = interval in ("1m","2m","5m","15m","30m","60m","90m","1h")
        yf_period = PERIOD_MAP.get(period, "5d" if is_intraday else "1y")
        hist = yf.Ticker(symbol).history(period=yf_period, interval=interval)
        hist = hist.dropna(subset=["Close"])
        # 타임존 제거
        if hist.index.tz is not None:
            hist.index = hist.index.tz_convert("Asia/Seoul").tz_localize(None) if market == "KR" else hist.index.tz_localize(None)
        result = [
            {
                # 분봉은 datetime, 일봉 이상은 date만
                "date": str(idx)[:19] if is_intraday else str(idx.date()),
                "open": round(float(row["Open"]), 2),
                "high": round(float(row["High"]), 2),
                "low": round(float(row["Low"]), 2),
                "close": round(float(row["Close"]), 2),
                "volume": int(row["Volume"]),
            }
            for idx, row in hist.iterrows()
        ]
        cache.set(ck, result, OHLCV_TTL)
        return result

    def get_fundamentals(self, symbol: str, market: str = "US") -> dict:
        orig_symbol = symbol
        if market == "KR":
            symbol = _resolve_kr_symbol(symbol, "KS")
        ck = f"fund:{symbol}"
        cached = cache.get(ck)
        if cached:
            return cached
        try:
            info = yf.Ticker(symbol).info
        except Exception:
            stale = cache.get_stale(ck)
            return stale if stale else {}
        # KR 주식: yfinance에서 per/eps/pbr 없을 때 pykrx로 보완
        if market == "KR" and not info.get("trailingPE"):
            try:
                from pykrx import stock as pkrx
                from datetime import datetime, timedelta
                code6 = orig_symbol.replace(".KS","").replace(".KQ","")
                today = datetime.today()
                # 최대 10일 전까지 탐색 (주말/공휴일 고려)
                for delta in range(10):
                    d = (today - timedelta(days=delta)).strftime("%Y%m%d")
                    try:
                        df = pkrx.get_market_fundamental(d, d, code6)
                    except Exception:
                        continue
                    if df is not None and not df.empty:
                        row = df.iloc[-1]
                        per_val = float(row.get("PER", 0) or 0)
                        if per_val > 0:
                            info["_pkrx_per"] = per_val
                            info["_pkrx_pbr"] = float(row.get("PBR", 0) or 0) or None
                            info["_pkrx_eps"] = float(row.get("EPS", 0) or 0) or None
                            info["_pkrx_bps"] = float(row.get("BPS", 0) or 0) or None
                            break
            except Exception:
                pass
        def _pct(key, max_abs=None):
            v = info.get(key)
            if not v:
                return None
            val = round(float(v) * 100, 2)
            # 비현실적인 값 제거
            if max_abs and abs(val) > max_abs:
                return None
            return val

        def _ratio(raw, max_val=None):
            """이미 퍼센트로 표시된 값 (yfinance가 가끔 혼용)"""
            if not raw:
                return None
            v = float(raw)
            # yfinance dividendYield: 0.02 (2%) 형태로 오는 게 맞음
            # 가끔 이미 퍼센트(2.0)로 올 때도 있음 — 10 이상이면 이미 %로 판단
            if v > 1:  # 이미 % 단위로 온 경우
                pct = round(v, 2)
            else:
                pct = round(v * 100, 2)
            # 비현실적 배당 (30% 초과) 제거
            if max_val and pct > max_val:
                return None
            return pct

        roe = info.get("returnOnEquity")
        div = info.get("dividendYield")
        result = _clean({
            "per":          _safe(info.get("_pkrx_per") or info.get("trailingPE")),
            "forward_per":  _safe(info.get("forwardPE")),
            "peg":          _safe(info.get("pegRatio")),
            "pbr":          _safe(info.get("_pkrx_pbr") or info.get("priceToBook")),
            "psr":          _safe(info.get("priceToSalesTrailing12Months")),
            "pcr":          _safe(info.get("priceToFreeCashflows")) or _safe(info.get("priceToOperatingCashflows")),
            "ev_ebitda":    _safe(info.get("enterpriseToEbitda")),
            "ev_revenue":   _safe(info.get("enterpriseToRevenue")),
            "roe":          _pct("returnOnEquity", max_abs=200),  # 200% 초과는 이상치
            "roa":          _pct("returnOnAssets", max_abs=100),
            "gross_margin": _pct("grossMargins", max_abs=100),
            "op_margin":    _pct("operatingMargins", max_abs=100),
            "net_margin":   _pct("profitMargins", max_abs=100),
            "eps":          _safe(info.get("_pkrx_eps") or info.get("trailingEps")),
            "forward_eps":  _safe(info.get("forwardEps")),
            "bps":          _safe(info.get("_pkrx_bps") or info.get("bookValue")),
            "dividend_yield": _ratio(div, max_val=30),  # 30% 초과 배당은 이상치
            "payout_ratio": _pct("payoutRatio", max_abs=500),
            "debt_ratio":   _safe(info.get("debtToEquity")),
            "current_ratio":_safe(info.get("currentRatio")),
            "quick_ratio":  _safe(info.get("quickRatio")),
            "beta":         round(float(info.get("beta")), 2) if info.get("beta") else None,
            "week52_high":  _safe(info.get("fiftyTwoWeekHigh")),
            "week52_low":   _safe(info.get("fiftyTwoWeekLow")),
            "ma50":         _safe(info.get("fiftyDayAverage")),
            "ma200":        _safe(info.get("twoHundredDayAverage")),
            "market_cap":        info.get("marketCap"),
            "enterprise_value":  info.get("enterpriseValue"),
            "shares_outstanding":info.get("sharesOutstanding"),
            "float_shares":      info.get("floatShares"),
            "sector":      info.get("sector"),
            "industry":    info.get("industry"),
            "description": info.get("longBusinessSummary") or info.get("description") or "",
            # 컨센서스
            "target_price_mean": _safe(info.get("targetMeanPrice")),
            "target_price_high": _safe(info.get("targetHighPrice")),
            "target_price_low":  _safe(info.get("targetLowPrice")),
            "recommendation":    info.get("recommendationKey") or info.get("recommendation"),
            "analyst_count":     info.get("numberOfAnalystOpinions"),
        })
        cache.set(ck, result, FUND_TTL)
        return result

    def get_market_index(self, index_name: str) -> dict:
        ck = f"idx:{index_name}"
        cached = cache.get(ck)
        if cached:
            return cached
        symbol = INDEX_SYMBOLS.get(index_name, index_name)
        display_name = INDEX_NAMES.get(index_name, index_name)
        try:
            hist = yf.Ticker(symbol).history(period="5d")
            closes = hist["Close"].dropna()
        except Exception:
            stale = cache.get_stale(ck)
            return stale if stale else {"index": index_name, "name": display_name, "value": 0, "change": 0, "change_rate": 0}

        if len(closes) >= 2:
            prev = float(closes.iloc[-2])
            curr = float(closes.iloc[-1])
            change = curr - prev
            change_rate = (change / prev) * 100 if prev else 0
        elif len(closes) == 1:
            curr = float(closes.iloc[-1])
            change = change_rate = 0.0
        else:
            stale = cache.get_stale(ck)
            return stale if stale else {"index": index_name, "name": display_name, "value": 0, "change": 0, "change_rate": 0}

        result = _clean({
            "index": index_name,
            "name": display_name,
            "value": round(curr, 2),
            "change": round(change, 2),
            "change_rate": round(change_rate, 2),
        })
        cache.set(ck, result, INDEX_TTL)
        return result

    def get_index_ohlcv(self, index_name: str, period: str = "1y", interval: str = "1d") -> list:
        """지수 OHLCV 데이터 (연봉은 월봉 데이터를 리샘플링)"""
        yf_sym = INDEX_SYMBOLS.get(index_name, index_name)
        ck = f"idx_ohlcv:{index_name}:{period}:{interval}"
        if cached := cache.get(ck):
            return cached
        try:
            # 연봉은 yfinance 미지원 → 월봉으로 받아서 연간 리샘플링
            actual_interval = "1mo" if interval == "1y" else interval
            yf_period = "max" if interval == "1y" else PERIOD_MAP.get(period, "1y")
            hist = yf.Ticker(yf_sym).history(period=yf_period, interval=actual_interval)
            hist = hist.dropna(subset=["Close"])
            hist.index = hist.index.tz_localize(None)

            if interval == "1y":
                hist = hist.resample("YE").agg({
                    "Open": "first", "High": "max", "Low": "min",
                    "Close": "last", "Volume": "sum"
                }).dropna()

            result = [
                {
                    "date":   str(idx.date()),
                    "open":   round(float(row["Open"]), 2),
                    "high":   round(float(row["High"]), 2),
                    "low":    round(float(row["Low"]), 2),
                    "close":  round(float(row["Close"]), 2),
                    "volume": int(row.get("Volume", 0)),
                }
                for idx, row in hist.iterrows()
            ]
            cache.set(ck, result, OHLCV_TTL)
            return result
        except Exception:
            return cache.get_stale(ck) or []

    def screen_stocks(self, market: str, filters: dict) -> list:
        if market == "KR":
            symbols = KOSPI_SYMBOLS + KOSDAQ_SYMBOLS
        elif market == "ETF":
            symbols = ETF_SYMBOLS
        else:
            symbols = SP500_SYMBOLS

        results = []
        for symbol in symbols:
            try:
                info = yf.Ticker(symbol).info
                hist = yf.Ticker(symbol).history(period="2d")
                if len(hist) >= 2:
                    prev = float(hist["Close"].iloc[-2])
                    curr = float(hist["Close"].iloc[-1])
                    change_rate = (curr - prev) / prev * 100 if prev else 0
                else:
                    curr = float(info.get("currentPrice") or info.get("regularMarketPrice") or 0)
                    change_rate = float(info.get("regularMarketChangePercent") or 0)

                roe = _safe(info.get("returnOnEquity"))
                row = _clean({
                    "symbol": symbol,
                    "name": info.get("longName") or info.get("shortName") or symbol,
                    "market": market,
                    "price": round(curr, 2),
                    "change_rate": round(change_rate, 2),
                    "per": _safe(info.get("trailingPE")),
                    "pbr": _safe(info.get("priceToBook")),
                    "roe": round(roe * 100, 2) if roe else None,
                    "eps": _safe(info.get("trailingEps")),
                    "debt_ratio": _safe(info.get("debtToEquity")),
                    "market_cap": info.get("marketCap"),
                    "currency": info.get("currency", "USD"),
                })
                if self._apply_filters(row, filters):
                    results.append(row)
            except Exception:
                continue
        return results

    def _apply_filters(self, stock: dict, filters: dict) -> bool:
        for key, condition in filters.items():
            value = stock.get(key)
            if value is None:
                return False
            if "min" in condition and value < condition["min"]:
                return False
            if "max" in condition and value > condition["max"]:
                return False
        return True


yf_service = YFinanceService()
