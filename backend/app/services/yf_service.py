import yfinance as yf
import pandas as pd
import math
from typing import Optional
from app.core.cache import cache

PRICE_TTL  = 30      # 현재가 캐시 30초
INDEX_TTL  = 60      # 지수 캐시 60초
OHLCV_TTL  = 21600   # OHLCV 캐시 6시간 (일봉 이상은 당일 변경 없음)
FUND_TTL   = 86400   # 재무지표 캐시 24시간

# yfinance GICS 섹터 한국어 번역
_SECTOR_KO: dict[str, str] = {
    "Technology": "기술",
    "Healthcare": "헬스케어",
    "Financial Services": "금융서비스",
    "Financials": "금융",
    "Consumer Cyclical": "경기소비재",
    "Consumer Defensive": "필수소비재",
    "Industrials": "산업재",
    "Communication Services": "통신서비스",
    "Energy": "에너지",
    "Basic Materials": "소재",
    "Real Estate": "부동산",
    "Utilities": "유틸리티",
    "Services": "서비스",
    "Manufacturing": "제조",
}

_INDUSTRY_KO: dict[str, str] = {
    "Semiconductors": "반도체",
    "Consumer Electronics": "소비자 가전",
    "Electronic Components": "전자부품",
    "Specialty Chemicals": "특수화학",
    "Auto Manufacturers": "자동차 제조",
    "Auto Parts": "자동차 부품",
    "Banks—Regional": "지방은행",
    "Banks—Diversified": "종합은행",
    "Insurance—Life": "생명보험",
    "Insurance—Property & Casualty": "손해보험",
    "Software—Application": "소프트웨어",
    "Software—Infrastructure": "인프라 소프트웨어",
    "Internet Content & Information": "인터넷 컨텐츠",
    "Telecom Services": "통신서비스",
    "Steel": "철강",
    "Oil & Gas Refining & Marketing": "정유",
    "Biotechnology": "바이오테크",
    "Drug Manufacturers—General": "제약",
    "Aerospace & Defense": "항공우주·방산",
    "Industrial Conglomerates": "복합기업",
    "Shipping & Logistics": "물류·해운",
    "Department Stores": "백화점",
    "Discount Stores": "할인마트",
    "Entertainment": "엔터테인먼트",
    "Publishing": "출판·미디어",
    "Construction": "건설",
    "Real Estate—Diversified": "복합부동산",
    "Utilities—Regulated Electric": "전력",
    "Solar": "태양광",
    "Medical Devices": "의료기기",
    "Diagnostics & Research": "진단·연구",
}


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
    # S&P 500 + NASDAQ 100 주요 종목 (약 300개, 시총 기준 상위)
    # 빅테크/성장주
    "AAPL","MSFT","NVDA","GOOGL","AMZN","META","TSLA","AVGO","NFLX","CRM",
    "ADBE","AMD","QCOM","TXN","ADI","AMAT","LRCX","KLAC","MU","MRVL",
    "PANW","CRWD","FTNT","ZS","SNPS","CDNS","NOW","INTU","ANSS","TEAM",
    # 금융
    "JPM","BAC","WFC","C","GS","MS","BLK","SCHW","AXP","V","MA",
    "USB","PNC","TFC","COF","DFS","AIG","MET","PRU","AFL","SPGI",
    "MCO","ICE","CME","NDAQ","CBOE",
    # 헬스케어/바이오
    "UNH","JNJ","LLY","ABBV","MRK","PFE","ABT","TMO","DHR","BMY",
    "AMGN","GILD","REGN","VRTX","BIIB","MRNA","BSX","SYK","MDT","EW",
    "ISRG","IDXX","ILMN","DXCM","ZBH","BDX","BAX","HOLX","VEEV","ALGN",
    # 소비재/유통
    "WMT","COST","TGT","HD","LOW","MCD","SBUX","CMG","YUM","DRI",
    "NKE","PG","KO","PEP","PM","MO","MDLZ","GIS","K","CPB",
    "CL","CHD","EL","ULTA","LULU","TJX","ROST","BURL","M","GPS",
    # 에너지
    "XOM","CVX","COP","OXY","SLB","HAL","EOG","PXD","DVN","MPC",
    "VLO","PSX","KMI","WMB","OKE","LNG","ET","EPD","PAA","TRGP",
    # 통신/미디어
    "T","VZ","TMUS","DIS","CMCSA","CHTR","NFLX","PARA","WBD","FOXA",
    # 산업재
    "CAT","DE","EMR","ETN","HON","GE","MMM","ITW","PH","DOV",
    "BA","LMT","RTX","NOC","GD","TDG","HEI","HEICO","L3H","TXT",
    "UPS","FDX","CSX","UNP","NSC","JBHT","CHRW","EXPD","XPO","ODFL",
    # 부동산
    "AMT","CCI","EQIX","DLR","PLD","PSA","EXR","SPG","O","WELL",
    # 유틸리티
    "NEE","DUK","SO","AEP","EXC","SRE","PCG","ED","XEL","WEC",
    # 기타 대형주
    "BRK-B","ORCL","IBM","ACN","CSCO","DELL","HPQ","HPE","NTAP","WDC",
    "PYPL","SQ","FIS","FI","GPN","COIN","HOOD","SOFI","AFRM","UPST",
    "UBER","LYFT","ABNB","BKNG","EXPE","TRIP","CTRIP","EBAY","ETSY","W",
    "SHOP","AMZN","WISH","CHWY","CPNG","SE","GRAB","GOTO","BABA","JD",
    "NIO","XPEV","LI","RIVN","LCID","GM","F","STLA","TM","HMC",
    "PLTR","SNOW","DDOG","NET","MDB","OKTA","ZM","DOCU","BILL","HUBS",
    "TTD","PUBM","MGNI","IAS","DV","APPS","IRONSRC","APPLOVIN","APP","IREN",
    "WDAY","VEEV","COUP","SMAR","PCTY","PAYC","ADP","PAYX","BSY","GWRE",
    "ZI","S","CFLT","ESTC","SUMO","PD","FIVN","NICE","NICE","CCCS",
    "DKNG","CZR","MGM","WYNN","LVS","PENN","RSI","EVRI","AGS","SGMS",
    "MRNA","BNTX","NVAX","ARCT","SGEN","EXEL","INCY","NKTR","ALNY","SRPT",
    "TSM","ASML","ASMX","STM","IFNNY","SSNLF","TOELY","ARMH","ARM","MCHP",
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

        ticker = yf.Ticker(symbol)
        currency = "KRW" if market == "KR" else "USD"

        # 1차: fast_info (가장 빠르고 IP 차단에 강함)
        curr = prev = high = low = open_ = volume = market_cap = None
        name = symbol
        try:
            fi = ticker.fast_info
            curr     = _safe(getattr(fi, "last_price",       None))
            prev     = _safe(getattr(fi, "previous_close",   None))
            high     = _safe(getattr(fi, "day_high",         None))
            low      = _safe(getattr(fi, "day_low",          None))
            open_    = _safe(getattr(fi, "open",             None))
            # 일일 거래량 우선, 없으면 3개월 평균으로 폴백
            volume   = int(
                getattr(fi, "last_volume", None) or
                getattr(fi, "three_month_average_volume", 0) or 0
            )
            market_cap = int(getattr(fi, "market_cap",       0) or 0)
            w52h     = _safe(getattr(fi, "year_high",        None))
            w52l     = _safe(getattr(fi, "year_low",         None))
            currency = getattr(fi, "currency", currency) or currency
        except Exception:
            w52h = w52l = None

        # 2차: history (fast_info 실패 또는 curr=None 시)
        if not curr:
            try:
                hist = ticker.history(period="5d")
                closes = hist["Close"].dropna() if len(hist) > 0 else pd.Series(dtype=float)
                if len(closes) >= 2:
                    prev = float(closes.iloc[-2])
                    curr = float(closes.iloc[-1])
                elif len(closes) == 1:
                    curr = float(closes.iloc[-1])
                if len(hist) > 0:
                    last = hist.iloc[-1]
                    open_  = open_  or _safe(last.get("Open"))
                    high   = high   or _safe(last.get("High"))
                    low    = low    or _safe(last.get("Low"))
                    volume = volume or int(last.get("Volume", 0) or 0)
            except Exception:
                pass

        # 3차: info (느리지만 추가 필드 보완)
        info: dict = {}
        try:
            info = ticker.info or {}
            name = info.get("longName") or info.get("shortName") or symbol
            curr     = curr     or _safe(info.get("regularMarketPrice") or info.get("currentPrice"))
            prev     = prev     or _safe(info.get("regularMarketPreviousClose") or info.get("previousClose"))
            high     = high     or _safe(info.get("regularMarketDayHigh"))
            low      = low      or _safe(info.get("regularMarketDayLow"))
            open_    = open_    or _safe(info.get("regularMarketOpen"))
            # regularMarketVolume이 실제 당일 거래량 — fast_info의 3개월 평균보다 우선
            daily_vol = int(info.get("regularMarketVolume") or info.get("volume") or 0)
            volume   = daily_vol if daily_vol > 0 else volume
            market_cap = market_cap or int(info.get("marketCap") or 0)
            w52h     = w52h     or _safe(info.get("fiftyTwoWeekHigh"))
            w52l     = w52l     or _safe(info.get("fiftyTwoWeekLow"))
            currency = info.get("currency", currency) or currency
        except Exception:
            pass

        if not curr:
            stale = cache.get_stale(ck)
            return stale if stale else {"symbol": symbol, "price": None, "change": 0, "change_rate": 0, "currency": currency}

        curr = round(curr, 2)
        change      = round(curr - prev, 2) if prev else 0
        change_rate = round(change / prev * 100, 2) if prev else 0

        result = _clean({
            "symbol":      symbol,
            "name":        name,
            "price":       curr,
            "prev_close":  round(prev, 2) if prev else None,
            "change":      change,
            "change_rate": change_rate,
            "open":        round(open_, 2) if open_ else None,
            "high":        round(high,  2) if high  else None,
            "low":         round(low,   2) if low   else None,
            "volume":      volume,
            "amount":      int(curr * volume) if curr and volume else 0,
            "market_cap":  market_cap,
            "currency":    currency,
            "week52_high": round(w52h, 2) if w52h else None,
            "week52_low":  round(w52l, 2) if w52l else None,
            "dividend_yield": _safe(info.get("dividendYield")),
            "per":         _safe(info.get("trailingPE")),
            "pbr":         _safe(info.get("priceToBook")),
            "eps":         _safe(info.get("trailingEps")),
            "beta":        _safe(info.get("beta")),
        })
        cache.set(ck, result, PRICE_TTL)
        return result

    def _resample_nday(self, hist, n: int, is_kr: bool = False) -> list:
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
        def _rp(v): return int(round(float(v))) if is_kr else round(float(v), 2)
        return [
            {
                "date":   str(idx.date()),
                "open":   _rp(r["Open"]),
                "high":   _rp(r["High"]),
                "low":    _rp(r["Low"]),
                "close":  _rp(r["Close"]),
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
        is_kr = market == "KR"
        if interval in NDAY_MAP:
            n = NDAY_MAP[interval]
            hist = yf.Ticker(symbol).history(period="max", interval="1d")
            hist = hist.dropna(subset=["Close"])
            if hist.index.tz is not None:
                hist.index = hist.index.tz_convert("Asia/Seoul").tz_localize(None) if is_kr else hist.index.tz_localize(None)
            result = self._resample_nday(hist, n, is_kr=is_kr)
            cache.set(ck, result, OHLCV_TTL)
            return result

        is_intraday = interval in ("1m","2m","5m","15m","30m","60m","90m","1h")
        yf_period = PERIOD_MAP.get(period, "5d" if is_intraday else "1y")
        # 일봉 이상은 실제 종가(auto_adjust=False) 사용 — 조정 종가와의 불일치 방지
        hist = yf.Ticker(symbol).history(period=yf_period, interval=interval, auto_adjust=not is_intraday)
        hist = hist.dropna(subset=["Close"])
        # 타임존 제거
        if hist.index.tz is not None:
            hist.index = hist.index.tz_convert("Asia/Seoul").tz_localize(None) if is_kr else hist.index.tz_localize(None)
        def _rp(v): return int(round(float(v))) if is_kr else round(float(v), 2)
        result = [
            {
                # 분봉은 datetime, 일봉 이상은 date만
                "date": str(idx)[:19] if is_intraday else str(idx.date()),
                "open":   _rp(row["Open"]),
                "high":   _rp(row["High"]),
                "low":    _rp(row["Low"]),
                "close":  _rp(row["Close"]),
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
            "sector":      _SECTOR_KO.get(info.get("sector",""), info.get("sector")),
            "industry":    _INDUSTRY_KO.get(info.get("industry",""), info.get("industry")),
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
