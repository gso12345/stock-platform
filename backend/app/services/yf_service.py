import yfinance as yf
import pandas as pd
import math
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Optional
from app.core.cache import cache
from app.core.utils import safe_float as _safe
from app.core.cpu import cpu_worker_count, io_worker_count

PRICE_TTL  = 120     # 현재가 캐시 120초 (30→120: 외부 API 호출 빈도 75% 감소)
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


def _clean(d: dict) -> dict:
    return {k: _safe(v) if isinstance(v, float) else v for k, v in d.items()}


def _dividend_pct(raw, max_val: float = 30) -> Optional[float]:
    """yfinance dividendYield를 퍼센트 단위로 정규화 (0.02 → 2.0, 2.0 → 2.0)"""
    v = _safe(raw)
    if not v:
        return None
    pct = round(v, 2) if v > 1 else round(v * 100, 2)
    if pct > max_val:
        return None
    return pct

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
    "069500.KS", "114800.KS", "122630.KS", "252670.KS",
]

SCREEN_ROW_TTL = 1800  # 스크리닝 종목 한 줄 30분 — 재무값은 하루에 한 번, 시세는 이 정도면 충분


def 스크리닝_종목들(market: str) -> list[str]:
    if market == "KR":
        return KOSPI_SYMBOLS + KOSDAQ_SYMBOLS
    if market == "ETF":
        return ETF_SYMBOLS
    return SP500_SYMBOLS


#: 스크리닝 화면이 거를 수 있는 값들. 여기 없는 키로 거르면
#  모든 종목이 '값 없음'으로 떨어져 결과가 조용히 0개가 된다 — 그래서
#  라우트가 이 목록으로 요청을 먼저 막는다.
스크리닝_숫자키 = frozenset({
    "price", "change_rate", "volume", "market_cap",
    "per", "forward_per", "pbr", "peg_ratio", "ev_ebitda", "ps_ratio", "dividend_yield",
    "rsi", "pct_from_52w_high", "pct_from_52w_low", "beta",
    "return_1m", "return_3m", "return_1y",
    "roe", "roa", "operating_margin", "profit_margin", "eps", "debt_ratio", "current_ratio",
})
스크리닝_글자키 = frozenset({"sector"})


def _퍼센트(v) -> Optional[float]:
    """야후의 비율(0.153)을 퍼센트(15.3)로. 0 도 값이다 — 영업이익률 0% 는 '모름'이 아니다."""
    v = _safe(v)
    return None if v is None else round(v * 100, 2)


def _rsi14(closes: pd.Series) -> Optional[float]:
    """와일더 방식 RSI(14). 백테스트 엔진과 같은 식이어야 두 화면의 숫자가 맞는다."""
    if len(closes) < 15:
        return None
    d = closes.diff()
    up = d.where(d > 0, 0.0).ewm(com=13, adjust=False).mean().iloc[-1]
    down = (-d.where(d < 0, 0.0)).ewm(com=13, adjust=False).mean().iloc[-1]
    if down == 0:
        return 100.0 if up > 0 else 50.0
    return round(100 - 100 / (1 + up / down), 2)


def _몇달전수익률(closes: pd.Series, 달: int) -> Optional[float]:
    """마지막 날에서 `달` 개월 전(그날 이전의 마지막 거래일) 대비 수익률.
    받은 기간이 그만큼 안 되면 모른다 — 상장 두 달 된 종목의 '1년 수익률'을
    두 달 수익률로 채우면 안 된다."""
    if closes.empty:
        return None
    기준날 = closes.index[-1] - pd.DateOffset(months=달)
    앞 = closes[closes.index <= 기준날]
    if 앞.empty or not 앞.iloc[-1]:
        return None
    return round((float(closes.iloc[-1]) / float(앞.iloc[-1]) - 1) * 100, 2)


def 스크리닝줄(symbol: str, market: str, info: dict, hist: pd.DataFrame) -> Optional[dict]:
    """야후의 info + 1년 시세 → 스크리닝 표 한 줄. 네트워크 없이 부를 수 있게 떼어 둔다."""
    closes = hist["Close"].dropna() if hist is not None and "Close" in hist else pd.Series(dtype=float)
    if len(closes):
        curr = float(closes.iloc[-1])
    else:
        curr = _safe(info.get("currentPrice") or info.get("regularMarketPrice"))
    if not curr:
        return None  # 값 하나 없는 줄은 표에 올려 봐야 '-' 뿐이다

    if len(closes) >= 2 and closes.iloc[-2]:
        change_rate = (curr / float(closes.iloc[-2]) - 1) * 100
    else:
        change_rate = _safe(info.get("regularMarketChangePercent"))

    volume = None
    if hist is not None and "Volume" in hist and len(hist["Volume"].dropna()):
        volume = int(hist["Volume"].dropna().iloc[-1])
    elif info.get("volume") is not None:
        volume = int(info["volume"])

    # 52주 고저는 마지막 날에서 1년 안쪽만 본다 — 받은 시세는 1년보다 길다
    일년 = closes[closes.index > closes.index[-1] - pd.DateOffset(years=1)] if len(closes) else closes
    고점 = float(일년.max()) if len(일년) else _safe(info.get("fiftyTwoWeekHigh"))
    저점 = float(일년.min()) if len(일년) else _safe(info.get("fiftyTwoWeekLow"))

    #: 배당수익률은 '연 배당금 ÷ 지금 가격' 으로 직접 낸다. 야후의
    #  dividendYield 는 버전에 따라 0.02 로도 2.0 으로도 와서 믿기 어렵다.
    #  배당을 안 주는 종목은 0 이다 — '모름'으로 두면 '배당 1% 이하'를
    #  찾을 때 무배당주가 빠진다.
    연배당 = _safe(info.get("dividendRate"))
    if 연배당 is None:
        연배당 = _safe(info.get("trailingAnnualDividendRate"))
    배당 = round(연배당 / curr * 100, 2) if 연배당 is not None else _dividend_pct(info.get("yield"))

    # 한국 종목은 표·상세·관심목록 모두 '005930' 처럼 접미사 없이 쓴다
    보일이름 = symbol
    보일시장 = market
    if symbol.endswith((".KS", ".KQ")):
        보일이름 = symbol.rsplit(".", 1)[0]
        보일시장 = "KR"

    return _clean({
        "symbol": 보일이름,
        "name": info.get("longName") or info.get("shortName") or 보일이름,
        "market": 보일시장,
        "sector": info.get("sector"),
        "price": round(curr, 2),
        "change_rate": round(change_rate, 2) if change_rate is not None else None,
        "volume": volume,
        "market_cap": info.get("marketCap"),
        "per": _safe(info.get("trailingPE")),
        "forward_per": _safe(info.get("forwardPE")),
        "pbr": _safe(info.get("priceToBook")),
        "peg_ratio": _safe(info.get("trailingPegRatio") or info.get("pegRatio")),
        "ev_ebitda": _safe(info.get("enterpriseToEbitda")),
        "ps_ratio": _safe(info.get("priceToSalesTrailing12Months")),
        "dividend_yield": 배당,
        "rsi": _rsi14(closes),
        "pct_from_52w_high": round((curr / 고점 - 1) * 100, 2) if 고점 else None,
        "pct_from_52w_low": round((curr / 저점 - 1) * 100, 2) if 저점 else None,
        "beta": _safe(info.get("beta")),
        "return_1m": _몇달전수익률(closes, 1),
        "return_3m": _몇달전수익률(closes, 3),
        "return_1y": _몇달전수익률(closes, 12),
        "roe": _퍼센트(info.get("returnOnEquity")),
        "roa": _퍼센트(info.get("returnOnAssets")),
        "operating_margin": _퍼센트(info.get("operatingMargins")),
        "profit_margin": _퍼센트(info.get("profitMargins")),
        "eps": _safe(info.get("trailingEps")),
        "debt_ratio": _safe(info.get("debtToEquity")),
        "current_ratio": _safe(info.get("currentRatio")),
        "currency": info.get("currency") or ("KRW" if 보일시장 == "KR" else "USD"),
    })


def _봉목록(hist: pd.DataFrame, rp, 날짜들: list) -> list:
    """가격표(DataFrame) → [{date, open, high, low, close, volume}, …]

    iterrows 를 쓰지 않는다. iterrows 는 줄마다 pandas Series 를 새로 만들어,
    일봉 전체(1만 줄 남짓)면 0.4초가 걸렸다 — 0.15 CPU 로는 2.7초, 지수 상세가
    기본으로 여는 S&P500 전체(2만 5천 줄)는 5.7초다. 열을 통째로 파이썬 목록으로
    꺼내 짝지으면 같은 결과가 20배 넘게 빨리 나온다.

    값 다루는 법(rp, int)은 예전과 똑같이 둔다 — 반올림 하나 달라져도 차트의
    마지막 값이 시세와 어긋난다."""
    거래량 = hist["Volume"].tolist() if "Volume" in hist.columns else [0] * len(hist)
    return [
        {"date": d, "open": rp(o), "high": rp(h), "low": rp(l), "close": rp(c), "volume": int(v)}
        for d, o, h, l, c, v in zip(
            날짜들, hist["Open"].tolist(), hist["High"].tolist(),
            hist["Low"].tolist(), hist["Close"].tolist(), 거래량,
        )
    ]


def _일자들(index) -> list:
    """일봉 이상의 날짜 — 예전 str(idx.date()) 와 같은 'YYYY-MM-DD'."""
    return index.strftime("%Y-%m-%d").tolist()


# ── 스크리닝 사진 (YFinanceService.스크리닝_전체 참고) ──────────
#: 시장 → (줄들, 찍은 시각)
_스크리닝_사진: dict[str, tuple[list, float]] = {}
_스크리닝_잠금들: dict[str, threading.Lock] = {}
_스크리닝_새로찍는중: set[str] = set()
#: 이보다 오래된 DB 사진은 안 쓴다 — 재무는 분기마다, 가격은 매일 바뀐다
SCREEN_SNAPSHOT_MAX_AGE = 7 * 86400


def _스크리닝_잠금(market: str) -> threading.Lock:
    return _스크리닝_잠금들.setdefault(market, threading.Lock())


def _사진_읽기(market: str) -> "tuple[list, float] | None":
    """DB 에 남겨 둔 사진. 없거나 너무 오래됐거나 못 읽으면 None."""
    try:
        from datetime import datetime
        from app.db.database import SessionLocal
        from app.models.stock import ScreeningSnapshot
        db = SessionLocal()
        try:
            줄 = db.query(ScreeningSnapshot).filter_by(market=market).first()
        finally:
            db.close()
        if not 줄 or not 줄.data or not 줄.fetched_at:
            return None
        지난초 = (datetime.utcnow() - 줄.fetched_at).total_seconds()
        if 지난초 > SCREEN_SNAPSHOT_MAX_AGE:
            return None
        return list(줄.data), time.time() - 지난초
    except Exception:
        return None


def _사진_남기기(market: str, 줄들: list) -> None:
    """사진을 DB 에 남긴다. 실패해도 조용히 — 메모리에는 이미 있다."""
    if not 줄들:
        return
    try:
        from datetime import datetime
        from app.db.database import SessionLocal
        from app.models.stock import ScreeningSnapshot
        깨끗 = [{k: (None if isinstance(v, float) and not math.isfinite(v) else v) for k, v in r.items()}
                for r in 줄들]
        db = SessionLocal()
        try:
            줄 = db.query(ScreeningSnapshot).filter_by(market=market).first()
            if 줄:
                줄.data, 줄.fetched_at = 깨끗, datetime.utcnow()
            else:
                db.add(ScreeningSnapshot(market=market, data=깨끗, fetched_at=datetime.utcnow()))
            db.commit()
        except Exception:
            db.rollback()
        finally:
            db.close()
    except Exception:
        pass


def 스크리닝_사진_비우기() -> None:
    """메모리와 DB 의 사진을 모두 버린다 (검사용)."""
    _스크리닝_사진.clear()
    try:
        from app.db.database import SessionLocal
        from app.models.stock import ScreeningSnapshot
        db = SessionLocal()
        try:
            db.query(ScreeningSnapshot).delete()
            db.commit()
        finally:
            db.close()
    except Exception:
        pass


def _resolve_kr_symbol(symbol: str, market: str) -> str:
    """한국 종목코드에 야후파이낸스 접미사 자동 부여"""
    if "." in symbol:
        return symbol
    #: **지수에는 붙이지 않는다.** 지수 티커는 ^ 로 시작하고 그 자체가
    #  완성된 이름이다 — ^KS11(코스피), ^KQ11(코스닥). 여기에 .KS 를
    #  붙이면 '^KS11.KS' 라는 없는 종목이 되어 야후가 빈손을 준다.
    #  그러면 벤치마크 '코스피' 와 한국 ETF 의 '확장' 이 오류 하나 없이
    #  조용히 사라진다 — 화면에는 고를 수 있게 떠 있는데 고르면 안 나온다.
    if symbol.startswith("^"):
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

        # 3차: info — price 없을 때만 (속도 최적화: fast_info/history로 price 확보 시 스킵)
        info: dict = {}
        if not curr:
            try:
                info = ticker.info or {}
                curr     = _safe(info.get("regularMarketPrice") or info.get("currentPrice"))
                prev     = prev     or _safe(info.get("regularMarketPreviousClose") or info.get("previousClose"))
                high     = high     or _safe(info.get("regularMarketDayHigh"))
                low      = low      or _safe(info.get("regularMarketDayLow"))
                open_    = open_    or _safe(info.get("regularMarketOpen"))
                daily_vol = int(info.get("regularMarketVolume") or info.get("volume") or 0)
                volume   = daily_vol if daily_vol > 0 else volume
                market_cap = market_cap or int(info.get("marketCap") or 0)
                w52h     = w52h     or _safe(info.get("fiftyTwoWeekHigh"))
                w52l     = w52l     or _safe(info.get("fiftyTwoWeekLow"))
                currency = info.get("currency", currency) or currency
            except Exception:
                pass
        # name: .info 결과 또는 stale 캐시에서 보완
        name = info.get("longName") or info.get("shortName") or (cache.get_stale(ck) or {}).get("name") or symbol

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
            "dividend_yield": _dividend_pct(info.get("dividendYield")),
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
        return _봉목록(rs, _rp, _일자들(rs.index))

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
            hist = yf.Ticker(symbol).history(period="max", interval="1d", auto_adjust=False)
            hist = hist.dropna(subset=["Close"])
            if hist.index.tz is not None:
                hist.index = hist.index.tz_convert("Asia/Seoul").tz_localize(None) if is_kr else hist.index.tz_localize(None)
            result = self._resample_nday(hist, n, is_kr=is_kr)
            cache.set(ck, result, OHLCV_TTL)
            return result

        is_intraday = interval in ("1m","2m","5m","15m","30m","60m","90m","1h")
        yf_period = PERIOD_MAP.get(period, "5d" if is_intraday else "1y")
        # 실제 종가(auto_adjust=False) 사용 — 배당 조정 종가와의 불일치 방지
        # (yfinance 기본값 auto_adjust=True는 배당을 반영해 과거 종가를 깎아내려
        #  실제 거래된 가격과 달라짐 — 오래된 데이터일수록 오차가 커짐)
        hist = yf.Ticker(symbol).history(period=yf_period, interval=interval, auto_adjust=False)
        hist = hist.dropna(subset=["Close"])
        # 타임존 제거
        if hist.index.tz is not None:
            hist.index = hist.index.tz_convert("Asia/Seoul").tz_localize(None) if is_kr else hist.index.tz_localize(None)
        def _rp(v): return int(round(float(v))) if is_kr else round(float(v), 2)
        # 분봉은 datetime, 일봉 이상은 date만
        날짜들 = [str(t)[:19] for t in hist.index] if is_intraday else _일자들(hist.index)
        result = _봉목록(hist, _rp, 날짜들)
        cache.set(ck, result, OHLCV_TTL)
        return result

    def get_fundamentals(self, symbol: str, market: str = "US") -> dict:
        orig_symbol = symbol
        if market == "KR":
            symbol = _resolve_kr_symbol(symbol, "KS")
        # 자기 전용 키를 쓴다.
        #
        # 예전에는 `fund:{symbol}` 에 썼는데, 그건 fundamentals_service 가
        # "네이버로 보완까지 끝낸 값" 을 담는 공유 키다. 여기서 야후 단독
        # 결과를 그 키에 박으면, /fundamentals 가 그걸 먼저 읽고 그대로
        # 돌려준다(fundamentals_service 의 `if fresh := cache.get(ck)`).
        # 네이버 보완 경로(_fetch_fund)는 영영 안 돈다.
        #
        # 국내 종목은 야후에 trailingEps 가 없는 경우가 많아, 그 상태로
        # 기본정보 EPS 가 끝까지 빈다. 게다가 stale 도 '있음' 으로 치므로
        # 한 번 오염되면 스스로 유지된다.
        #
        # 얄궂게도 _fetch_fund 자신이 이 함수를 부른다 — 즉 정식 경로조차
        # 자기가 곧 병합해 덮을 키를 먼저 야후 단독값으로 쓰고 있었다.
        ck = f"fund_yf:{symbol}"
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
                from app.core import pykrx_light
                pkrx = pykrx_light.stock()
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

        # yfinance가 EV/PEG 계열을 직접 제공하지 않는 경우(국내 종목 등)
        # 시가총액·부채·현금·EBITDA·매출·EPS성장률로 자체 계산해 보완
        per_val = _safe(info.get("_pkrx_per") or info.get("trailingPE"))
        ev = _safe(info.get("enterpriseValue"))
        if ev is None:
            mc = _safe(info.get("marketCap"))
            debt = _safe(info.get("totalDebt"))
            cash = _safe(info.get("totalCash"))
            if mc is not None and (debt is not None or cash is not None):
                ev = mc + (debt or 0) - (cash or 0)

        ev_ebitda = _safe(info.get("enterpriseToEbitda"))
        if ev_ebitda is None:
            ebitda = _safe(info.get("ebitda"))
            if ev and ebitda:
                ev_ebitda = round(ev / ebitda, 2)

        ev_revenue = _safe(info.get("enterpriseToRevenue"))
        if ev_revenue is None:
            total_revenue = _safe(info.get("totalRevenue"))
            if ev and total_revenue:
                ev_revenue = round(ev / total_revenue, 2)

        # 야후 제공값(5년 기준 EPS 성장률 기반)만 사용 — 1년 성장률(earningsGrowth) 기반
        # 자체 추정은 기준 연수가 달라 일관성이 깨지므로 제거. 야후 값이 없으면
        # quant_score.collect_quant_metrics가 재무제표 다년치 EPS로 5년 기준으로 보완한다.
        peg = _safe(info.get("trailingPegRatio")) or _safe(info.get("pegRatio"))

        result = _clean({
            "per":          per_val,
            "forward_per":  _safe(info.get("forwardPE")),
            "peg":          peg,
            "pbr":          _safe(info.get("_pkrx_pbr") or info.get("priceToBook")),
            "psr":          _safe(info.get("priceToSalesTrailing12Months")),
            "pcr":          _safe(info.get("priceToFreeCashflows")) or _safe(info.get("priceToOperatingCashflows")),
            "ev_ebitda":    ev_ebitda,
            "ev_revenue":   ev_revenue,
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
            "enterprise_value":  ev,
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

            result = _봉목록(hist, lambda v: round(float(v), 2), _일자들(hist.index))
            cache.set(ck, result, OHLCV_TTL)
            return result
        except Exception:
            return cache.get_stale(ck) or []

    def _screen_one(self, symbol: str, market: str) -> dict | None:
        #: 종목 한 줄은 조건과 상관없이 똑같다. 그래서 **조건이 아니라 종목에**
        #  캐시를 건다. 스크리닝은 조건을 조금씩 바꿔 가며 여러 번 누르는
        #  화면인데, 조건마다 400종목을 야후에 다시 물으면 매번 수십 초다.
        ck = f"screen_row:{symbol}"
        if cached := cache.get(ck):
            return cached
        try:
            ticker = yf.Ticker(symbol)
            info = ticker.info or {}
            #: 1년 조금 넘게 받는다. 예전엔 2일치만 받아서 등락률밖에 못 냈고,
            #  화면의 RSI·52주 고저·1/3/12개월 수익률 필터는 값이 없어
            #  **걸기만 하면 결과가 0개**였다. 요청 수는 그대로 한 번이다.
            #  딱 1y 로 받으면 첫날이 '1년 전 오늘'보다 하루 늦게 잡혀
            #  1년 수익률이 늘 '모름'이 된다 — 그래서 여유를 둔다.
            hist = ticker.history(start=(pd.Timestamp.today() - pd.Timedelta(days=400)).strftime("%Y-%m-%d"))
            row = 스크리닝줄(symbol, market, info, hist)
        except Exception:
            return None
        if row:
            cache.set(ck, row, SCREEN_ROW_TTL)
        return row

    def screen_stocks(self, market: str, filters: dict) -> list:
        return [r for r in self.스크리닝_전체(market) if self._apply_filters(r, filters)]

    def _스크리닝_전체_새로(self, market: str) -> list:
        """시장 전체를 새로 훑는다. 잠금을 잡은 쪽만 부른다."""
        # 목록에 같은 종목이 두 번 적힌 곳이 있다(AMZN·NFLX·MRNA…).
        # 그대로 두면 결과에도 두 줄로 나온다.
        symbols = list(dict.fromkeys(스크리닝_종목들(market)))

        # 종목별 순차 호출(네트워크 I/O 대기)이 전체 응답 시간을 좌우하므로
        # 스레드풀로 동시에 fetch — yfinance가 스레드 안전한 블로킹 I/O이므로 안전함
        with ThreadPoolExecutor(max_workers=io_worker_count(default=20)) as pool:
            줄들 = [r for r in pool.map(lambda s: self._screen_one(s, market), symbols) if r]
        _스크리닝_사진[market] = (줄들, time.time())
        _사진_남기기(market, 줄들)
        return 줄들

    def 스크리닝_전체(self, market: str) -> list:
        """시장 전체의 스크리닝 줄. **조건과 상관없이** 같다 — 조건은 그 뒤에 거른다.

        예전에는 누를 때마다 300종목 넘게 줄을 다시 모았다. 종목마다 30분
        캐시가 있었지만, 30분이 지나거나 서버가 깨어나면(메모리가 빈다)
        다시 전부 야후에 물어 0.15 CPU 에서 수십 초를 기다렸다. 게다가
        여럿이 동시에 누르면 그 일을 각자 했다.

        · 마지막 결과(사진)를 들고 있다 — 서버가 깨도 쓸 수 있게 DB 에도.
        · 30분이 지났으면 그 사진으로 곧바로 답하고 새로 찍는 것은 뒤에서.
        · 사진이 아예 없을 때만 기다린다 — 그때도 여럿이 한 번만 찍는다."""
        있음 = _스크리닝_사진.get(market)
        if 있음 is None:
            있음 = _사진_읽기(market)
            if 있음 is not None:
                _스크리닝_사진[market] = 있음
        if 있음 is not None:
            줄들, 찍은때 = 있음
            if time.time() - 찍은때 > SCREEN_ROW_TTL:
                self._스크리닝_뒤에서_새로(market)
            return 줄들
        with _스크리닝_잠금(market):
            if (다른사람이 := _스크리닝_사진.get(market)) is not None:
                return 다른사람이[0]          # 기다리는 동안 앞사람이 찍었다
            return self._스크리닝_전체_새로(market)

    def _스크리닝_뒤에서_새로(self, market: str) -> None:
        if market in _스크리닝_새로찍는중:
            return
        _스크리닝_새로찍는중.add(market)

        def 일():
            try:
                with _스크리닝_잠금(market):
                    self._스크리닝_전체_새로(market)
            except Exception:
                pass                      # 못 찍었으면 지난 사진을 계속 쓴다
            finally:
                _스크리닝_새로찍는중.discard(market)

        try:
            from app.core.executor import background_executor
            background_executor.submit(일)
        except Exception:
            _스크리닝_새로찍는중.discard(market)

    def _apply_filters(self, stock: dict, filters: dict) -> bool:
        for key, condition in filters.items():
            value = stock.get(key)
            #: 값이 없는 종목은 조건을 **통과시키지 않는다.** PER 10 이하를
            #  찾는데 PER 모르는 종목이 끼면 조건이 거짓말이 된다.
            if value is None:
                return False
            if "eq" in condition and value != condition["eq"]:
                return False
            if "min" in condition and value < condition["min"]:
                return False
            if "max" in condition and value > condition["max"]:
                return False
        return True


yf_service = YFinanceService()
