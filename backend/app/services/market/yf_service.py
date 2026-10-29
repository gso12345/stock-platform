import yfinance as yf
import pandas as pd
import logging
import math
import os
import threading
import time
from urllib.parse import urlparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional
from app.core.cache import cache
from app.core.utils import safe_float as _safe
from app.core.cpu import 낮은_우선순위

log = logging.getLogger(__name__)

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

#: 시장 전체를 **종목마다** 새로 받는(재무 + 1년 시세) 간격. 재무는 분기마다, RSI·수익률은 하루 단위로
#  변한다. 예전엔 30분마다 300곳을 다시 받았는데, 화면이 열자마자 표를 채우게 되자 그 일이 잦아져
#  0.15 CPU·512MB 서버의 메모리가 100% 를 찍고 종목상세 요청이 30초를 넘겨 끊겼다(관리자 화면 실측)
SCREEN_FULL_TTL = int(os.getenv("SCREEN_FULL_TTL_SEC", 6 * 3600))
#: 가격·등락·거래량·시가총액만 **묶음 시세**로 새로 받는 간격 — 요청 몇 번이면 시장 전체가 된다
SCREEN_PRICE_TTL = int(os.getenv("SCREEN_PRICE_TTL_SEC", 300))
#: 종목마다 받을 때 동시에 묻는 수. 늘리면 빨라지는 것보다 메모리가 한꺼번에 오르는 쪽이 크다 —
#  야후 응답을 풀어 담는 동안의 버퍼가 동시에 묻는 수만큼 쌓인다
SCREEN_SCAN_WORKERS = int(os.getenv("SCREEN_SCAN_WORKERS", 4))
#: 시장 전체 받기를 멈추는 메모리 비율 — 넘으면 정리해 보고, 그래도 넘으면 남은 종목은 지난 줄로 둔다
SCREEN_MEMORY_STOP = float(os.getenv("SCREEN_MEMORY_STOP", 0.9))


#: 뒤에서 도는 받기 스레드는 낮은 우선순위로(app.core.cpu.낮은_우선순위)
_뒤로_미루기 = 낮은_우선순위


def _메모리_빠듯함() -> bool:
    """시장 전체를 받다가 멈춰야 하나 — 넘으면 한 번 털어 보고 다시 본다. 잴 수 없으면(로컬) 안 멈춘다"""
    try:
        from app.core import memory
    except Exception:
        return False
    비율 = memory.usage_ratio()
    if 비율 is None or 비율 < SCREEN_MEMORY_STOP:
        return False
    memory.trim_if_tight()
    비율 = memory.usage_ratio()
    return 비율 is not None and 비율 >= SCREEN_MEMORY_STOP


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
    # 참고한 스크리너의 칸(사용자: "스크리닝 사이트 참고해줘") — 최근 1년 실적과 성장
    "revenue", "earnings", "fcf", "net_debt", "forward_eps_growth",
    # 연간 재무 흐름에서 낸다(연간흐름) — 받기 전인 종목은 값이 없다
    "rev_cagr_3y", "eps_cagr_3y",
})
#: 거래소(코스피·코스닥·코넥스, 나스닥·NYSE …)는 상장된 모든 종목을 담으면서 생긴 칸이다
스크리닝_글자키 = frozenset({"sector", "country", "industry", "exchange"})

#: 연간 재무 흐름(4년 매출·EPS 막대와 3년 성장률)이 줄에 붙는 칸. fin_at 은 받은 때
흐름_칸 = ("fin_years", "rev_hist", "eps_hist", "rev_cagr_3y", "eps_cagr_3y", "fin_at")
#: 연간 재무는 분기마다 바뀐다 — 시세처럼 30분마다 물을 일이 없어 이만큼 둔다(초)
흐름_수명 = 7 * 86400
#: 스크리닝을 뒤에서 새로 찍을 때 연간 흐름을 새로 받는 종목 수와 시간 상한(초).
#: 한꺼번에 수백 곳을 물으면 0.15 CPU 서버가 오래 붙잡힌다 — 찍을 때마다 조금씩 채운다
흐름_한번 = int(os.getenv("SCREEN_FIN_PER_REFRESH", 60))
흐름_시간 = float(os.getenv("SCREEN_FIN_BUDGET_SEC", 120))


def _도메인(누리집: object) -> Optional[str]:
    """회사 누리집 주소 → 'nvidia.com'. 화면이 그 주소의 아이콘을 로고로 쓴다"""
    if not isinstance(누리집, str) or not 누리집.strip():
        return None
    주소 = 누리집.strip()
    if "://" not in 주소:
        주소 = "http://" + 주소
    try:
        이름 = (urlparse(주소).hostname or "").lower()
    except ValueError:
        return None
    if 이름.startswith("www."):
        이름 = 이름[4:]
    return 이름 or None


def _연평균성장(값들: list) -> Optional[float]:
    """3년 전 → 마지막 해 연평균 성장률(%). 어느 한쪽이라도 없거나 0 이하면 모른다 —
    적자에서 흑자로 돌아선 것은 성장률로 말할 수 없다"""
    if len(값들) < 4:
        return None
    처음, 끝 = 값들[-4], 값들[-1]
    if 처음 is None or 끝 is None or 처음 <= 0 or 끝 <= 0:
        return None
    return round(((끝 / 처음) ** (1 / 3) - 1) * 100, 1)


def 연간흐름(표) -> dict:
    """야후 연간 손익계산서(줄 = 항목, 칸 = 회계연도 끝) → {fin_years, rev_hist, eps_hist,
    rev_cagr_3y, eps_cagr_3y}. 오래된 해부터, 값이 없는 해는 None(막대 자리를 비운다).

    참고한 스크리너는 10년 막대를 그리지만 야후는 연간 손익을 4년치쯤만 준다 — 있는 만큼 그린다.
    5년 성장률도 그래서 못 낸다."""
    if 표 is None or getattr(표, "empty", True):
        return {}
    해들 = sorted(표.columns, key=lambda c: pd.Timestamp(c))

    def 줄(이름들):
        for 이름 in 이름들:
            if 이름 in 표.index:
                return [_safe(표.at[이름, c]) for c in 해들]
        return [None] * len(해들)

    매출 = 줄(("Total Revenue", "Operating Revenue"))
    eps = 줄(("Diluted EPS", "Basic EPS"))
    # 야후는 맨 앞(가장 오래된) 해를 비워 두기도 한다 — 앞쪽의 빈 해만 뺀다(가운데를 빼면
    # '3년 전' 이 4년 전이 된다)
    시작 = next((i for i in range(len(해들)) if 매출[i] is not None or eps[i] is not None), None)
    if 시작 is None:
        return {}
    해들, 매출, eps = 해들[시작:], 매출[시작:], eps[시작:]
    return {
        "fin_years": [pd.Timestamp(c).year for c in 해들],
        "rev_hist": [None if v is None else round(v) for v in 매출],
        "eps_hist": [None if v is None else round(v, 2) for v in eps],
        "rev_cagr_3y": _연평균성장(매출),
        "eps_cagr_3y": _연평균성장(eps),
    }


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


def 스크리닝줄(symbol: str, market: str, info: dict, hist: pd.DataFrame,
              연간: Optional[dict] = None, 환율: Optional[float] = None) -> Optional[dict]:
    """야후의 info + 1년 시세 → 스크리닝 표 한 줄. 네트워크 없이 부를 수 있게 떼어 둔다.
    연간 — 연간흐름() 의 결과(있으면 4년 매출·EPS 와 3년 성장률이 붙는다).
    환율 — 장부 돈(financialCurrency)이 시세 돈(currency)과 다른 회사만: 장부 돈 1 = 시세 돈 얼마."""
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

    빚, 현금 = _safe(info.get("totalDebt")), _safe(info.get("totalCash"))
    다음eps, 지난eps = _safe(info.get("forwardEps")), _safe(info.get("trailingEps"))

    # 한국 종목은 표·상세·관심목록 모두 '005930' 처럼 접미사 없이 쓴다
    보일이름 = symbol
    보일시장 = market
    if symbol.endswith((".KS", ".KQ")):
        보일이름 = symbol.rsplit(".", 1)[0]
        보일시장 = "KR"

    시세돈 = info.get("currency") or ("KRW" if 보일시장 == "KR" else "USD")
    #: 장부 돈은 야후가 알려 준 때만 — 상세(info)가 막혀 모르는데 시세 돈('USD')으로 적으면, 받아 둔 'JPY'·'TWD' 를
    #  막힌 회차가 'USD' 로 덮고(_줄_잇기 는 빈 칸만 남긴다) 해외 회사가 달러 장부로 보인다(table._시총_달러로)
    장부돈 = info.get("financialCurrency")
    #: 최근 1년 실적(매출·순이익·FCF·순부채)은 시세 돈으로 바꿔 둔다 — 세우고 거르는 값이라
    #  회사마다 돈이 다르면 토요타(엔)·TSMC(대만 달러)가 '매출 1등' 이 된다.
    #  환율을 모르면 비운다 — 틀린 순서보다 '모름' 이 낫다
    비율 = 1.0 if 장부돈 in (None, 시세돈) else _safe(환율)

    def 시세돈으로(v: Optional[float]) -> Optional[float]:
        return None if v is None or not 비율 else v * 비율

    return _clean({
        "symbol": 보일이름,
        "name": info.get("longName") or info.get("shortName") or 보일이름,
        "market": 보일시장,
        "sector": info.get("sector"),
        "price": round(curr, 2),
        "change_rate": round(change_rate, 2) if change_rate is not None else None,
        "volume": volume,
        #: ETF 는 야후가 시가총액 대신 순자산(totalAssets)을 준다 — 크기 순으로 세울 수 있게 그걸 쓴다
        "market_cap": info.get("marketCap") or (info.get("totalAssets") if market == "ETF" else None),
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
        #: 묶음 시세로 가격만 새로 받을 때 다시 나누려고 남긴다 — 52주 고저·연 배당금·다음 해 예상 EPS
        "high_52w": round(고점, 4) if 고점 else None,
        "low_52w": round(저점, 4) if 저점 else None,
        "dividend_rate": 연배당,
        "forward_eps": 다음eps,
        # ETF 는 3년 베타(beta3Year)만 준다
        "beta": _safe(info.get("beta") if info.get("beta") is not None else info.get("beta3Year")),
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
        "currency": 시세돈,
        #: 회사가 장부를 쓰는 돈 — 미국 상장이라도 TSMC 처럼 대만 달러로 적는 회사가 있다.
        #  4년 흐름(rev_hist·eps_hist)은 이 돈 그대로다
        "fin_currency": 장부돈,
        "revenue": 시세돈으로(_safe(info.get("totalRevenue"))),
        "earnings": 시세돈으로(_safe(info.get("netIncomeToCommon"))),
        "fcf": 시세돈으로(_safe(info.get("freeCashflow"))),
        #: 순부채 = 빚 − 현금. 마이너스면 빚보다 현금이 많다
        "net_debt": 시세돈으로(빚 - 현금 if 빚 is not None and 현금 is not None else None),
        #: 다음 회계연도 예상 EPS ÷ 최근 1년 EPS − 1. 최근이 적자(0 이하)면 성장률이 뜻이 없다
        "forward_eps_growth": (round((다음eps / 지난eps - 1) * 100, 1)
                               if 다음eps is not None and 지난eps and 지난eps > 0 else None),
        "country": info.get("country"),
        "industry": info.get("industry"),
        "domain": _도메인(info.get("website")),
        **(연간 or {}),
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
_스크리닝_시작잠금 = threading.Lock()
#: 사진이 아예 없어 처음 짓는 중인 시장 → {"줄들": 받은 줄, "받은": 물어본 수, "전체": 종목 수, "끝": Event}.
#: 시장 전체를 받는 데 0.15 CPU 로 1~3분 걸린다 — 그동안 받은 줄부터 화면에 보여 준다
_스크리닝_짓기: dict[str, dict] = {}
#: 처음 짓다가 한 줄도 못 받은 때(야후가 막혔다). 잠깐 다시 짓지 않는다 — 막힌 곳을 두드리지 않게
_스크리닝_실패: dict[str, float] = {}
SCREEN_FAIL_COOLDOWN = 120
#: 사진이 없을 때 짓기 시작한 요청이 기다려 주는 시간(초). 그 안에 다 못 지으면 받은 줄부터 돌려준다 —
#  시총 큰 종목부터 묻으므로 5초면 위쪽 수십 곳은 받는다
SCREEN_FIRST_WAIT = float(os.getenv("SCREEN_FIRST_WAIT_SEC", 5))
#: 이보다 오래된 DB 사진은 안 쓴다 — 재무는 분기마다, 가격은 매일 바뀐다
SCREEN_SNAPSHOT_MAX_AGE = 7 * 86400


def _스크리닝_잠금(market: str) -> threading.Lock:
    return _스크리닝_잠금들.setdefault(market, threading.Lock())


#: 종목마다 통째로 받는 일은 시장을 가리지 않고 한 번에 하나만 — 미국·국내·ETF 를 겹쳐 받으면
#  동시에 묻는 수가 세 배가 된다
_스크리닝_한시장씩 = threading.Semaphore(1)


def _줄_잇기(옛: dict, 새: dict) -> dict:
    """야후 상세(info)가 막혀 가격만 온 줄이면, 비어 온 칸(None)은 지난 줄의 값을 남긴다.

    운영 서버에서 야후 상세가 막히면 새 줄에는 1년 시세로 낸 값(가격·RSI·수익률 …)만 있고 나머지
    칸은 None 으로 온다. 예전엔 그 줄로 통째로 덮어서, 6시간마다 멀쩡하던 시가총액·PER·배당·회사명이
    지워졌다(사용자: "시가총액이 안나옴", "국내주식은 회사명이아닌 코드가 나와").
    상세가 온 줄(이름이 종목 코드가 아니거나 시가총액이 있다)은 그대로 쓴다 — 적자로 돌아서 PER 이
    사라진 것까지 지난 값으로 덮으면 안 된다."""
    if 새.get("name") not in (None, "", 새.get("symbol")) or 새.get("market_cap") is not None:
        return 새
    합친 = dict(옛)
    합친.update({k: v for k, v in 새.items() if v is not None and k != "name"})
    합친["name"] = 옛.get("name") or 새.get("name")
    return 합친


def _마지막_통째(줄들: list) -> float:
    """사진을 마지막으로 종목마다 통째로 받은 때 — 줄마다 받은 때(scanned_at) 중 가장 늦은 것.
    가장 이른 것으로 하면 계속 못 받는 종목 하나 때문에 5분마다 시장 전체를 다시 받는다."""
    return max((float(r.get("scanned_at") or 0) for r in 줄들), default=0.0)


def _시세_덮기(줄: dict, q: dict) -> None:
    """묶음 시세로 가격에 딸린 칸을 고친다. 재무(EPS·배당금·매출)는 그대로 두고 새 가격으로 다시 나눈다."""
    값 = _safe(q.get("price"))
    if not 값 or 값 <= 0:
        return
    옛값 = _safe(줄.get("price"))
    줄["price"] = round(값, 2)
    if (등락 := _safe(q.get("change_rate"))) is not None:
        줄["change_rate"] = round(등락, 2)
    if q.get("volume"):
        줄["volume"] = int(q["volume"])
    시총 = _safe(q.get("market_cap"))
    if 시총 and 시총 > 0:
        줄["market_cap"] = 시총
    elif 옛값 and 줄.get("market_cap"):
        줄["market_cap"] = round(줄["market_cap"] * 값 / 옛값)       # 주식 수는 그대로다
    if (고점 := _safe(줄.get("high_52w"))):
        고점 = max(고점, 값)
        줄["high_52w"], 줄["pct_from_52w_high"] = 고점, round((값 / 고점 - 1) * 100, 2)
    if (저점 := _safe(줄.get("low_52w"))):
        저점 = min(저점, 값)
        줄["low_52w"], 줄["pct_from_52w_low"] = 저점, round((값 / 저점 - 1) * 100, 2)
    if (연배당 := _safe(줄.get("dividend_rate"))) is not None:
        줄["dividend_yield"] = round(연배당 / 값 * 100, 2)
    if (매출 := _safe(줄.get("revenue"))) and 매출 > 0 and 줄.get("market_cap"):
        줄["ps_ratio"] = round(줄["market_cap"] / 매출, 2)
    # PER 은 EPS 가 시세와 같은 돈일 때만 다시 나눈다 — 해외 상장사의 EPS 는 장부 돈일 수 있다
    if 줄.get("currency") == 줄.get("fin_currency"):
        if (eps := _safe(줄.get("eps"))) and eps > 0:
            줄["per"] = round(값 / eps, 2)
        if (다음 := _safe(줄.get("forward_eps"))) and 다음 > 0:
            줄["forward_per"] = round(값 / 다음, 2)


def _다_쓴_메모리_돌려주기(까닭: str) -> None:
    """야후 응답을 풀어 담던 버퍼는 놓아도 OS 로 바로 안 돌아간다 — 큰 일을 끝내면 곧바로 돌려준다"""
    try:
        from app.core import memory
        memory.trim_native(label=까닭)
    except Exception:
        pass


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


def _흐름_잇기(market: str, 줄들: list) -> None:
    """지난 사진의 줄에 붙여 둔 연간 흐름을 새 줄로 옮긴다. 시세는 30분마다 새로 받지만
    연간 재무는 분기마다 바뀌어 흐름_수명 동안 다시 물을 일이 없다 — 사진(DB 에도 남는다)이
    그 사이 보관함 노릇을 한다."""
    지난 = (_스크리닝_사진.get(market) or ([], 0.0))[0]
    있던 = {r.get("symbol"): r for r in 지난 if r.get("fin_at")}
    for r in 줄들:
        p = 있던.get(r.get("symbol"))
        if p and not r.get("fin_at"):
            for k in 흐름_칸:
                if k in p:
                    r[k] = p[k]


def 스크리닝_사진_비우기() -> None:
    """메모리와 DB 의 사진을 모두 버린다 (검사용). 뒤에서 찍던 것이 있으면 끝나기를 잠깐 기다린다 —
    안 그러면 앞 검사가 시작한 일이 다음 검사의 사진을 덮는다."""
    끝 = time.time() + 10
    while _스크리닝_새로찍는중 and time.time() < 끝:
        time.sleep(0.02)
    _스크리닝_사진.clear()
    _스크리닝_실패.clear()
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


#: 국내 코드 → 야후 꼬리 표. 종목 목록(ticker_service)이 바뀌면(DB·pykrx 로 새로 읽으면) 다시 만든다
_국내꼬리표: dict = {"목록": None, "표": {}}


def _국내꼬리(code6: str) -> str:
    """6자리 국내 코드의 야후 꼬리 — 코스닥이면 '.KQ', 그 밖(코스피·목록에 없는 종목)은 '.KS'.

    종목 목록은 'XXXXXX.KQ' 처럼 꼬리째 들고 있는데, 화면 몇 곳(스크리닝 표의 관심종목 담기 등)은
    꼬리 없이 6자리만 보낸다. 예전엔 그때 늘 '.KS' 를 붙여서, 코스닥 종목은 야후가 빈손을 줬다 —
    2년 시세·재무제표가 비어 퀀트의 모멘텀·성장 점수가 '—' 였다(사용자: "가치 모멘텀 ... 안나오는
    회사가 있어"). 목록을 읽는 것뿐이다 — 목록을 새로 받으러 가지 않는다."""
    try:
        from app.services.listings import ticker_service as T
        목록 = T._kr_db or T.KR_TICKERS_BUILTIN
    except Exception:
        목록 = None
    if 목록 is not _국내꼬리표["목록"]:
        표: dict = {}
        for r in 목록 or []:
            이름 = str(r.get("s") or "")
            코드 = str(r.get("c") or 이름.split(".")[0])
            if 이름.endswith(".KQ") or str(r.get("x") or "").upper() == "KOSDAQ":
                표[코드] = ".KQ"
            elif 이름.endswith(".KS"):
                표[코드] = ".KS"
        # 스크리닝 국내 목록 — 종목 목록을 못 읽었을 때도 이것만큼은 맞힌다
        for 이름 in KOSPI_SYMBOLS + KOSDAQ_SYMBOLS:
            코드, _, 꼬리 = 이름.partition(".")
            표.setdefault(코드, f".{꼬리}")
        _국내꼬리표.update(목록=목록, 표=표)
    return _국내꼬리표["표"].get(code6, ".KS")


def _resolve_kr_symbol(symbol: str, market: str) -> str:
    """한국 종목코드에 야후파이낸스 접미사 자동 부여 — 꼬리가 없으면 종목 목록에서 코스피·코스닥을 찾는다"""
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
    return f"{symbol}{_국내꼬리(symbol)}"


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
            row = 스크리닝줄(symbol, market, info, hist, 환율=self._장부환율(info))
        except Exception:
            return None
        if row:
            # 종목마다 받은 때 — 시장 전체를 언제 마지막으로 통째로 받았는지 여기서 안다(DB 사진에도 남는다)
            row["scanned_at"] = time.time()
            cache.set(ck, row, SCREEN_ROW_TTL)
        return row

    def _장부환율(self, info: dict) -> Optional[float]:
        """장부 돈이 시세 돈과 다른 회사(TSMC·토요타…)만 '장부 돈 1 = 시세 돈 얼마'. 같으면 묻지 않는다"""
        장부, 시세 = info.get("financialCurrency"), info.get("currency")
        if not 장부 or not 시세 or 장부 == 시세:
            return None
        return self._환율(장부, 시세)

    def _환율(self, 원래: str, 바꿀: str) -> Optional[float]:
        """1 원래 = 바꿀 얼마. 하루 한 번만 묻는다 — 같은 돈을 쓰는 종목이 여럿이다"""
        ck = f"fx:{원래}{바꿀}"
        if (v := cache.get(ck)) is not None:
            return v
        try:
            종가 = yf.Ticker(f"{원래}{바꿀}=X").history(period="5d")["Close"].dropna()
            v = _safe(종가.iloc[-1]) if len(종가) else None
        except Exception:
            v = None
        if v is None or v <= 0:
            return None
        cache.set(ck, v, 86400)
        return v

    def screen_stocks(self, market: str, filters: dict) -> list:
        return [r for r in self.스크리닝_전체(market) if self._apply_filters(r, filters)]

    def _스크리닝_전체_새로(self, market: str, 흐름채우기: bool = False) -> list:
        """시장 전체를 새로 훑는다. 잠금을 잡은 쪽만 부른다.

        흐름채우기 — 연간 흐름이 없거나 오래된 종목을 조금(흐름_한번) 새로 받아 붙인다.
        뒤에서 새로 찍을 때만 한다 — 사진이 아예 없어 사람이 기다리는 때는 시세만 받는다."""
        # 목록에 같은 종목이 두 번 적힌 곳이 있다(AMZN·NFLX·MRNA…).
        # 그대로 두면 결과에도 두 줄로 나온다.
        symbols = list(dict.fromkeys(스크리닝_종목들(market)))
        #: 처음 짓는 중이면 받는 대로 여기 쌓는다 — 화면이 다 받기 전에도 받은 줄부터 보여 준다
        짓기 = _스크리닝_짓기.get(market)
        if 짓기 is not None:
            짓기["전체"] = len(symbols)

        # 종목마다 묻는다(네트워크를 기다리는 일이라 몇 개씩 겹쳐서). 다만 겹치는 수만큼 야후 응답을
        # 풀어 담는 버퍼가 한꺼번에 쌓인다 — 0.15 CPU·512MB 서버라 넷만 겹치고, 한 번에 한 시장만,
        # 낮은 우선순위로 돈다(화면 요청이 먼저 CPU 를 쓰게). 메모리가 빠듯하면 남은 종목은 지난 줄로 둔다
        멈춤 = threading.Event()

        def 한종목(s: str):
            if 멈춤.is_set():
                return None
            if _메모리_빠듯함():
                if not 멈춤.is_set():
                    log.warning("메모리가 빠듯해 스크리닝 %s 받기를 멈춤 — 남은 종목은 지난 줄로", market)
                멈춤.set()
                return None
            return self._screen_one(s, market)

        받은것: dict = {}
        with _스크리닝_한시장씩:
            with ThreadPoolExecutor(max_workers=SCREEN_SCAN_WORKERS, initializer=_뒤로_미루기) as pool:
                일감 = {pool.submit(한종목, s): s for s in symbols}
                for 끝난 in as_completed(일감):
                    try:
                        r = 끝난.result()
                    except Exception:
                        r = None
                    받은것[일감[끝난]] = r
                    if 짓기 is not None:
                        if r:
                            짓기["줄들"].append(dict(r))
                        짓기["받은"] += 1

        def 보일이름(s: str) -> str:
            return s.rsplit(".", 1)[0] if s.endswith((".KS", ".KQ")) else s
        원래이름 = {보일이름(s): s for s in symbols}
        #: 야후가 잠깐 답을 못 한 종목은 지난 사진의 줄을 쓴다. 빼 버리면 다음에 찍을 때(30분)까지
        #  표에서 사라지고, 야후가 통째로 멈춘 때는 사진이 빈 목록이 되어 화면이 '맞는 종목이 없어요' 가 된다
        지난 = {r.get("symbol"): r for r in (_스크리닝_사진.get(market) or ([], 0.0))[0]}
        줄들 = []
        for s in symbols:
            새, 옛 = 받은것.get(s), 지난.get(보일이름(s))
            r = _줄_잇기(옛, 새) if 새 and 옛 else (새 or 옛)
            if r:
                # 줄은 종목마다 캐시된 것일 수 있다 — 흐름을 붙이기 전에 떼어 낸다(캐시를 건드리지 않게)
                줄들.append(dict(r))
        if not 줄들:
            # 한 줄도 못 받았다(야후가 막혔다). 빈 사진을 30분 동안 '맞는 종목이 없어요' 로 내놓지 않는다
            _스크리닝_실패[market] = time.time()
            return 줄들
        _흐름_잇기(market, 줄들)
        if 흐름채우기 and market != "ETF":
            self._흐름_채우기(줄들, 원래이름)
        _스크리닝_사진[market] = (줄들, time.time())
        _사진_남기기(market, 줄들)
        _다_쓴_메모리_돌려주기("스크리닝 시장 전체를 받은 뒤")
        return 줄들

    def _연간흐름_받기(self, symbol: str) -> "dict | None":
        """한 종목의 연간 흐름. 못 물었으면 None(다음 차례에 다시), 받았는데 비었으면 {}"""
        try:
            return 연간흐름(yf.Ticker(symbol).income_stmt)
        except Exception:
            return None

    def _흐름_채우기(self, 줄들: list, 원래이름: dict) -> int:
        """연간 흐름이 없거나 흐름_수명보다 오래된 종목을 시가총액이 큰 것부터 흐름_한번 곳까지,
        흐름_시간 안에서 받아 붙인다. 붙인 곳 수를 돌려준다."""
        지금 = time.time()
        고른 = sorted((r for r in 줄들 if 지금 - float(r.get("fin_at") or 0) > 흐름_수명),
                     key=lambda r: -(r.get("market_cap") or 0))[:흐름_한번]
        if not 고른:
            return 0

        def 하나(r):
            if time.time() - 지금 > 흐름_시간 or _메모리_빠듯함():
                return None                        # 시간이 다 됐거나 메모리가 빠듯하다 — 다음 차례에
            return self._연간흐름_받기(원래이름.get(r["symbol"], r["symbol"]))

        with ThreadPoolExecutor(max_workers=2, initializer=_뒤로_미루기) as pool:
            받은것 = list(pool.map(하나, 고른))
        붙임 = 0
        for r, 흐름 in zip(고른, 받은것):
            if 흐름 is None:
                continue
            # 받았는데 비었어도(재무가 없는 종목) 받은 때는 남긴다 — 찍을 때마다 다시 묻지 않게
            r.update(흐름)
            r["fin_at"] = 지금
            붙임 += 1
        return 붙임

    def 스크리닝_전체(self, market: str) -> list:
        """시장 전체의 스크리닝 줄. **조건과 상관없이** 같다 — 조건은 그 뒤에 거른다.

        예전에는 누를 때마다 300종목 넘게 줄을 다시 모았다. 종목마다 30분
        캐시가 있었지만, 30분이 지나거나 서버가 깨어나면(메모리가 빈다)
        다시 전부 야후에 물어 0.15 CPU 에서 수십 초를 기다렸다. 게다가
        여럿이 동시에 누르면 그 일을 각자 했다.

        · 마지막 결과(사진)를 들고 있다 — 서버가 깨도 쓸 수 있게 DB 에도.
        · 지났으면 그 사진으로 곧바로 답하고 새로 찍는 것은 뒤에서. 두 갈래다 —
          종목마다 통째로(재무·1년 시세)는 SCREEN_FULL_TTL(6시간)마다, 가격·등락·거래량·시가총액은
          묶음 시세로 SCREEN_PRICE_TTL(5분)마다. 예전엔 30분마다 통째로 받아 서버가 그 일에 붙잡혔다.
        · 사진이 아예 없으면(배포 직후·처음 여는 시장) 뒤에서 짓고 SCREEN_FIRST_WAIT 만 기다린다.
          그 안에 다 못 지었으면 받은 줄부터 돌려준다 — 화면은 '받는 중' 이라고 알리고 다시 묻는다.
          예전엔 다 지을 때까지(0.15 CPU 로 1~3분) 요청이 붙잡혀 표가 빈 채로 기다렸다.
          여럿이 동시에 눌러도 한 번만 짓는다."""
        있음 = _스크리닝_사진.get(market)
        if 있음 is None:
            있음 = _사진_읽기(market)
            if 있음 is not None:
                _스크리닝_사진[market] = 있음
        if 있음 is not None:
            줄들, 찍은때 = 있음
            지금 = time.time()
            if 지금 - _마지막_통째(줄들) > SCREEN_FULL_TTL:
                self._스크리닝_뒤에서_새로(market)
            elif 지금 - 찍은때 > SCREEN_PRICE_TTL:
                self._스크리닝_뒤에서_새로(market, 시세만=True)
            return 줄들
        if self.스크리닝_못받음(market):
            return []
        # 사람이 기다리는 첫 사진에서는 연간 흐름을 받지 않는다 — 시세만 받아도 1~3분이다.
        # 짓기 시작한 요청만 잠깐 기다린다 — 짓는 동안 다시 묻는 요청(화면이 3초마다, 정렬을 바꿀 때)까지
        # 기다리게 하면 받는 동안 표가 굼떠진다
        if self._스크리닝_뒤에서_새로(market, 흐름채우기=False, 처음=True):
            if (짓기 := _스크리닝_짓기.get(market)) is not None:
                짓기["끝"].wait(SCREEN_FIRST_WAIT)
        if (다 := _스크리닝_사진.get(market)) is not None:
            return 다[0]
        짓기 = _스크리닝_짓기.get(market)
        return list(짓기["줄들"]) if 짓기 is not None else []

    def 스크리닝_짓는중(self, market: str) -> Optional[dict]:
        """사진이 없어 처음 짓는 중이면 {"done": 물어본 종목 수, "total": 전체 종목 수}, 아니면 None"""
        짓기 = _스크리닝_짓기.get(market)
        if 짓기 is None or _스크리닝_사진.get(market) is not None:
            return None
        return {"done": 짓기["받은"], "total": 짓기["전체"]}

    def 스크리닝_찍은때(self, market: str) -> Optional[float]:
        """지금 사진의 시세가 언제 것인가(유닉스 초) — 화면이 'N분 전 시세' 로 적는다"""
        있음 = _스크리닝_사진.get(market)
        return 있음[1] if 있음 is not None else None

    def 스크리닝_못받음(self, market: str) -> bool:
        """사진도 없는데 방금 지어 보니 한 줄도 못 받았다(야후가 막혔다) — 잠깐은 다시 짓지 않는다"""
        return (_스크리닝_사진.get(market) is None
                and time.time() - _스크리닝_실패.get(market, 0.0) < SCREEN_FAIL_COOLDOWN)

    def _스크리닝_뒤에서_새로(self, market: str, 흐름채우기: bool = True, 처음: bool = False,
                         시세만: bool = False) -> bool:
        """뒤에서 새로 찍기 시작했으면 True. 처음 — 사진이 없어서 짓는 것(그새 남이 다 지었으면 또 짓지 않는다).
        시세만 — 종목마다 받지 않고 묶음 시세로 가격에 딸린 칸만 고친다"""
        with _스크리닝_시작잠금:          # 보고-넣기 사이에 남이 끼면 시장 전체를 두 번 받는다
            if market in _스크리닝_새로찍는중 or (처음 and _스크리닝_사진.get(market) is not None):
                return False
            _스크리닝_새로찍는중.add(market)
            if _스크리닝_사진.get(market) is None:
                _스크리닝_짓기[market] = {"줄들": [], "받은": 0, "전체": 0, "끝": threading.Event()}

        def 끝내기():
            _스크리닝_새로찍는중.discard(market)
            if (짓기 := _스크리닝_짓기.pop(market, None)) is not None:
                짓기["끝"].set()

        def 일():
            try:
                with _스크리닝_잠금(market):
                    if 시세만:
                        self._스크리닝_시세_새로(market)
                    else:
                        self._스크리닝_전체_새로(market, 흐름채우기=흐름채우기)
            except Exception:
                pass                      # 못 찍었으면 지난 사진을 계속 쓴다
            finally:
                끝내기()

        try:
            from app.core.executor import background_executor
            background_executor.submit(일)
        except Exception:
            끝내기()
            return False
        return True

    def _스크리닝_시세_새로(self, market: str) -> list:
        """가격·등락·거래량·시가총액만 묶음 시세로 받아 사진에 덮는다 — 요청 몇 번이면 시장 전체다.
        재무·RSI·수익률은 종목마다 받는 쪽(SCREEN_FULL_TTL)에 맡긴다."""
        있음 = _스크리닝_사진.get(market)
        if 있음 is None:
            return []
        줄들 = [dict(r) for r in 있음[0]]
        시세 = self._묶음시세(줄들)
        for r in 줄들:
            if (q := 시세.get(r.get("symbol"))):
                _시세_덮기(r, q)
        _스크리닝_사진[market] = (줄들, time.time())
        _사진_남기기(market, 줄들)
        return 줄들

    def _묶음시세(self, 줄들: list) -> dict:
        """{표의 symbol: 시세}. 해외는 야후 묶음 시세(100곳씩), 국내는 네이버 가격만.
        막 받아 둔 시세(price:심볼 — 시세 갱신·관심종목 화면이 2분 단위로 채운다)는 다시 묻지 않는다."""
        import asyncio
        from app.services.market.price_fetcher import fetch_yf_quotes, fetch_naver_prices_light
        out: dict = {}
        해외: list = []
        국내: list = []
        for r in 줄들:
            s = r.get("symbol")
            if not s:
                continue
            q = cache.get(f"price:{s}")
            if q and q.get("price"):
                out[s] = q
            elif r.get("market") == "KR":
                국내.append(s)
            else:
                해외.append(s)

        async def 받기():
            for i in range(0, len(해외), 100):
                try:
                    out.update(await asyncio.wait_for(fetch_yf_quotes(해외[i:i + 100]), timeout=25))
                except Exception:
                    pass
            if 국내:
                try:
                    out.update(await asyncio.wait_for(fetch_naver_prices_light(국내, concurrency=8), timeout=30))
                except Exception:
                    pass

        try:
            asyncio.run(받기())
        except Exception:
            pass
        return out

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
