"""
전체 상장 종목 DB 서비스
- 한국: pykrx → KRX 전체 상장 종목 (KOSPI+KOSDAQ ~2500개)
- 미국: 내장 데이터 + Finnhub/FMP 동적 조회
"""
import logging
import threading
from app.core.cache import cache

log = logging.getLogger(__name__)

# ── 미국 종목 한국어 이름 매핑 ──────────────────────────────
KO_NAME_MAP: dict[str, list[str]] = {
    "AAPL":  ["애플"],          "NVDA":  ["엔비디아"],       "MSFT":  ["마이크로소프트"],
    "AMZN":  ["아마존"],        "META":  ["메타"],            "TSLA":  ["테슬라"],
    "GOOGL": ["구글","알파벳"], "GOOG":  ["구글","알파벳"],   "AVGO":  ["브로드컴"],
    "JPM":   ["JP모건"],        "LLY":   ["일라이릴리"],       "V":     ["비자"],
    "UNH":   ["유나이티드헬스"], "XOM":   ["엑슨모빌"],        "MA":    ["마스터카드"],
    "COST":  ["코스트코"],       "HD":    ["홈디포"],          "WMT":   ["월마트"],
    "PG":    ["P&G","프록터앤갬블"], "JNJ": ["존슨앤존슨"],   "MRK":   ["머크"],
    "ABBV":  ["애브비"],         "CVX":   ["쉐브론"],          "CRM":   ["세일즈포스"],
    "BAC":   ["뱅크오브아메리카"], "AMD":  ["AMD","어드밴스드마이크로디바이시스"],
    "KO":    ["코카콜라"],       "ACN":   ["액센추어"],        "PEP":   ["펩시"],
    "TMO":   ["써모피셔"],       "NFLX":  ["넷플릭스"],        "WFC":   ["웰스파고"],
    "DIS":   ["디즈니"],         "MCD":   ["맥도날드"],        "ADBE":  ["어도비"],
    "ORCL":  ["오라클"],         "IBM":   ["IBM"],             "QCOM":  ["퀄컴"],
    "TXN":   ["텍사스인스트루먼트"], "INTC": ["인텔"],          "GE":   ["GE항공"],
    "CAT":   ["캐터필러"],       "BA":    ["보잉"],            "GS":    ["골드만삭스"],
    "BLK":   ["블랙록"],         "AMGN":  ["암젠"],            "AXP":   ["아메리칸익스프레스"],
    "HON":   ["허니웰"],         "LMT":   ["록히드마틴"],       "T":     ["AT&T"],
    "VZ":    ["버라이즌"],       "CMCSA": ["컴캐스트"],         "NEE":   ["넥스트에라에너지"],
    "RTX":   ["레이시온"],       "DHR":   ["다나허"],           "PM":    ["필립모리스"],
    "NOW":   ["서비스나우"],      "ISRG":  ["인튜이티브서지컬"], "BKNG": ["부킹홀딩스"],
    "LRCX":  ["램리서치"],       "KLAC":  ["KLA"],             "PANW":  ["팔로알토"],
    "PYPL":  ["페이팔"],         "UBER":  ["우버"],             "ABNB":  ["에어비앤비"],
    "SHOP":  ["쇼피파이"],        "COIN":  ["코인베이스"],       "PLTR":  ["팔란티어"],
    "ARM":   ["ARM홀딩스"],       "CRWD":  ["크라우드스트라이크"],"DDOG": ["데이터독"],
    "SNOW":  ["스노우플레이크"],  "SMCI":  ["슈퍼마이크로컴퓨터"],"MSTR": ["마이크로스트래티지"],
    "TSM":   ["TSMC","대만반도체"], "ASML": ["ASML"],           "NIO":   ["니오"],
    "BABA":  ["알리바바"],        "JD":    ["JD닷컴"],          "PDD":   ["핀둬둬"],
    "BIDU":  ["바이두"],          "NKE":   ["나이키"],           "SBUX":  ["스타벅스"],
    "MMM":   ["쓰리엠"],
    "SPY":   ["S&P500 ETF","스파이"], "QQQ": ["나스닥 ETF","큐큐큐"],
    "IWM":   ["러셀2000 ETF"],    "GLD":   ["금 ETF"],          "TQQQ":  ["나스닥 3배 레버리지"],
    "SQQQ":  ["나스닥 인버스 3배"], "ARKK": ["아크 이노베이션"],
    "MU":    ["마이크론","마이크론테크놀로지"], "SNDK": ["샌디스크"],
    "WDC":   ["웨스턴디지털"],                 "STX":  ["시게이트"],
    "ON":    ["온세미","온세미컨덕터"],          "MRVL": ["마벨테크놀로지"],
    "NXPI":  ["NXP반도체"],                     "MCHP": ["마이크로칩테크놀로지"],
}

def get_display_name(symbol: str, market: str, fallback: str = "") -> str:
    """해외(US/ETF) 종목은 한국어 별칭이 있으면 그걸로 표시, 없으면 기존 이름 사용"""
    if market in ("US", "ETF") and symbol:
        aliases = KO_NAME_MAP.get(symbol.upper())
        if aliases:
            return aliases[0]
    return fallback or symbol


# 미국 주요 상장 종목 (S&P500 + NASDAQ100 + 기타 인기)
US_TICKERS: list[dict] = [
    # ── S&P 500 대형주 ──
    {"s":"AAPL","n":"Apple Inc.","x":"NASDAQ","m":"US"},
    {"s":"MSFT","n":"Microsoft Corporation","x":"NASDAQ","m":"US"},
    {"s":"NVDA","n":"NVIDIA Corporation","x":"NASDAQ","m":"US"},
    {"s":"GOOGL","n":"Alphabet Inc. Class A","x":"NASDAQ","m":"US"},
    {"s":"GOOG","n":"Alphabet Inc. Class C","x":"NASDAQ","m":"US"},
    {"s":"AMZN","n":"Amazon.com Inc.","x":"NASDAQ","m":"US"},
    {"s":"META","n":"Meta Platforms Inc.","x":"NASDAQ","m":"US"},
    {"s":"TSLA","n":"Tesla Inc.","x":"NASDAQ","m":"US"},
    {"s":"AVGO","n":"Broadcom Inc.","x":"NASDAQ","m":"US"},
    {"s":"JPM","n":"JPMorgan Chase & Co.","x":"NYSE","m":"US"},
    {"s":"LLY","n":"Eli Lilly and Company","x":"NYSE","m":"US"},
    {"s":"V","n":"Visa Inc.","x":"NYSE","m":"US"},
    {"s":"UNH","n":"UnitedHealth Group Inc.","x":"NYSE","m":"US"},
    {"s":"XOM","n":"Exxon Mobil Corporation","x":"NYSE","m":"US"},
    {"s":"MA","n":"Mastercard Incorporated","x":"NYSE","m":"US"},
    {"s":"COST","n":"Costco Wholesale Corporation","x":"NASDAQ","m":"US"},
    {"s":"HD","n":"The Home Depot Inc.","x":"NYSE","m":"US"},
    {"s":"WMT","n":"Walmart Inc.","x":"NYSE","m":"US"},
    {"s":"PG","n":"Procter & Gamble Company","x":"NYSE","m":"US"},
    {"s":"JNJ","n":"Johnson & Johnson","x":"NYSE","m":"US"},
    {"s":"MRK","n":"Merck & Co. Inc.","x":"NYSE","m":"US"},
    {"s":"ABBV","n":"AbbVie Inc.","x":"NYSE","m":"US"},
    {"s":"CVX","n":"Chevron Corporation","x":"NYSE","m":"US"},
    {"s":"CRM","n":"Salesforce Inc.","x":"NYSE","m":"US"},
    {"s":"BAC","n":"Bank of America Corporation","x":"NYSE","m":"US"},
    {"s":"AMD","n":"Advanced Micro Devices Inc.","x":"NASDAQ","m":"US"},
    {"s":"KO","n":"The Coca-Cola Company","x":"NYSE","m":"US"},
    {"s":"ACN","n":"Accenture plc","x":"NYSE","m":"US"},
    {"s":"PEP","n":"PepsiCo Inc.","x":"NASDAQ","m":"US"},
    {"s":"TMO","n":"Thermo Fisher Scientific Inc.","x":"NYSE","m":"US"},
    {"s":"NFLX","n":"Netflix Inc.","x":"NASDAQ","m":"US"},
    {"s":"WFC","n":"Wells Fargo & Company","x":"NYSE","m":"US"},
    {"s":"DIS","n":"The Walt Disney Company","x":"NYSE","m":"US"},
    {"s":"MCD","n":"McDonald's Corporation","x":"NYSE","m":"US"},
    {"s":"ADBE","n":"Adobe Inc.","x":"NASDAQ","m":"US"},
    {"s":"ORCL","n":"Oracle Corporation","x":"NYSE","m":"US"},
    {"s":"IBM","n":"International Business Machines","x":"NYSE","m":"US"},
    {"s":"QCOM","n":"Qualcomm Incorporated","x":"NASDAQ","m":"US"},
    {"s":"TXN","n":"Texas Instruments Incorporated","x":"NASDAQ","m":"US"},
    {"s":"INTC","n":"Intel Corporation","x":"NASDAQ","m":"US"},
    {"s":"INTU","n":"Intuit Inc.","x":"NASDAQ","m":"US"},
    {"s":"AMAT","n":"Applied Materials Inc.","x":"NASDAQ","m":"US"},
    {"s":"GE","n":"GE Aerospace","x":"NYSE","m":"US"},
    {"s":"CAT","n":"Caterpillar Inc.","x":"NYSE","m":"US"},
    {"s":"BA","n":"The Boeing Company","x":"NYSE","m":"US"},
    {"s":"GS","n":"The Goldman Sachs Group Inc.","x":"NYSE","m":"US"},
    {"s":"BLK","n":"BlackRock Inc.","x":"NYSE","m":"US"},
    {"s":"SPGI","n":"S&P Global Inc.","x":"NYSE","m":"US"},
    {"s":"AMGN","n":"Amgen Inc.","x":"NASDAQ","m":"US"},
    {"s":"AXP","n":"American Express Company","x":"NYSE","m":"US"},
    {"s":"HON","n":"Honeywell International Inc.","x":"NASDAQ","m":"US"},
    {"s":"LMT","n":"Lockheed Martin Corporation","x":"NYSE","m":"US"},
    {"s":"MMM","n":"3M Company","x":"NYSE","m":"US"},
    {"s":"T","n":"AT&T Inc.","x":"NYSE","m":"US"},
    {"s":"VZ","n":"Verizon Communications Inc.","x":"NYSE","m":"US"},
    {"s":"CMCSA","n":"Comcast Corporation","x":"NASDAQ","m":"US"},
    {"s":"NEE","n":"NextEra Energy Inc.","x":"NYSE","m":"US"},
    {"s":"UPS","n":"United Parcel Service Inc.","x":"NYSE","m":"US"},
    {"s":"RTX","n":"RTX Corporation","x":"NYSE","m":"US"},
    {"s":"DHR","n":"Danaher Corporation","x":"NYSE","m":"US"},
    {"s":"PM","n":"Philip Morris International","x":"NYSE","m":"US"},
    {"s":"NOW","n":"ServiceNow Inc.","x":"NYSE","m":"US"},
    {"s":"ISRG","n":"Intuitive Surgical Inc.","x":"NASDAQ","m":"US"},
    {"s":"BKNG","n":"Booking Holdings Inc.","x":"NASDAQ","m":"US"},
    {"s":"LRCX","n":"Lam Research Corporation","x":"NASDAQ","m":"US"},
    {"s":"KLAC","n":"KLA Corporation","x":"NASDAQ","m":"US"},
    {"s":"MU","n":"Micron Technology Inc.","x":"NASDAQ","m":"US"},
    {"s":"SNDK","n":"Sandisk Corporation","x":"NASDAQ","m":"US"},
    {"s":"WDC","n":"Western Digital Corporation","x":"NASDAQ","m":"US"},
    {"s":"STX","n":"Seagate Technology Holdings plc","x":"NASDAQ","m":"US"},
    {"s":"ON","n":"ON Semiconductor Corporation","x":"NASDAQ","m":"US"},
    {"s":"MRVL","n":"Marvell Technology Inc.","x":"NASDAQ","m":"US"},
    {"s":"NXPI","n":"NXP Semiconductors N.V.","x":"NASDAQ","m":"US"},
    {"s":"MCHP","n":"Microchip Technology Inc.","x":"NASDAQ","m":"US"},
    {"s":"PANW","n":"Palo Alto Networks Inc.","x":"NASDAQ","m":"US"},
    {"s":"SNPS","n":"Synopsys Inc.","x":"NASDAQ","m":"US"},
    {"s":"CDNS","n":"Cadence Design Systems Inc.","x":"NASDAQ","m":"US"},
    {"s":"MELI","n":"MercadoLibre Inc.","x":"NASDAQ","m":"US"},
    {"s":"MDLZ","n":"Mondelez International Inc.","x":"NASDAQ","m":"US"},
    {"s":"REGN","n":"Regeneron Pharmaceuticals","x":"NASDAQ","m":"US"},
    {"s":"GILD","n":"Gilead Sciences Inc.","x":"NASDAQ","m":"US"},
    {"s":"VRTX","n":"Vertex Pharmaceuticals Inc.","x":"NASDAQ","m":"US"},
    {"s":"PYPL","n":"PayPal Holdings Inc.","x":"NASDAQ","m":"US"},
    {"s":"UBER","n":"Uber Technologies Inc.","x":"NYSE","m":"US"},
    {"s":"ABNB","n":"Airbnb Inc.","x":"NASDAQ","m":"US"},
    {"s":"SHOP","n":"Shopify Inc.","x":"NYSE","m":"US"},
    {"s":"COIN","n":"Coinbase Global Inc.","x":"NASDAQ","m":"US"},
    {"s":"PLTR","n":"Palantir Technologies Inc.","x":"NYSE","m":"US"},
    {"s":"ARM","n":"Arm Holdings plc","x":"NASDAQ","m":"US"},
    {"s":"CRWD","n":"CrowdStrike Holdings Inc.","x":"NASDAQ","m":"US"},
    {"s":"DDOG","n":"Datadog Inc.","x":"NASDAQ","m":"US"},
    {"s":"SNOW","n":"Snowflake Inc.","x":"NYSE","m":"US"},
    {"s":"RBLX","n":"Roblox Corporation","x":"NYSE","m":"US"},
    {"s":"RIVN","n":"Rivian Automotive Inc.","x":"NASDAQ","m":"US"},
    {"s":"LCID","n":"Lucid Group Inc.","x":"NASDAQ","m":"US"},
    {"s":"NIO","n":"NIO Inc.","x":"NYSE","m":"US"},
    {"s":"BIDU","n":"Baidu Inc.","x":"NASDAQ","m":"US"},
    {"s":"BABA","n":"Alibaba Group Holding","x":"NYSE","m":"US"},
    {"s":"JD","n":"JD.com Inc.","x":"NASDAQ","m":"US"},
    {"s":"PDD","n":"PDD Holdings Inc.","x":"NASDAQ","m":"US"},
    {"s":"TEMU","n":"Temu (PDD Holdings)","x":"NASDAQ","m":"US"},
    {"s":"TSM","n":"Taiwan Semiconductor Manufacturing","x":"NYSE","m":"US"},
    {"s":"ASML","n":"ASML Holding N.V.","x":"NASDAQ","m":"US"},
    {"s":"SMCI","n":"Super Micro Computer Inc.","x":"NASDAQ","m":"US"},
    {"s":"MSTR","n":"MicroStrategy Inc.","x":"NASDAQ","m":"US"},
    # ── ETF ──
    {"s":"SPY","n":"SPDR S&P 500 ETF Trust","x":"NYSE","m":"ETF"},
    {"s":"QQQ","n":"Invesco QQQ Trust (NASDAQ 100)","x":"NASDAQ","m":"ETF"},
    {"s":"IWM","n":"iShares Russell 2000 ETF","x":"NYSE","m":"ETF"},
    {"s":"DIA","n":"SPDR Dow Jones Industrial Average ETF","x":"NYSE","m":"ETF"},
    {"s":"VTI","n":"Vanguard Total Stock Market ETF","x":"NYSE","m":"ETF"},
    {"s":"VOO","n":"Vanguard S&P 500 ETF","x":"NYSE","m":"ETF"},
    {"s":"GLD","n":"SPDR Gold Trust","x":"NYSE","m":"ETF"},
    {"s":"SLV","n":"iShares Silver Trust","x":"NYSE","m":"ETF"},
    {"s":"TLT","n":"iShares 20+ Year Treasury Bond ETF","x":"NASDAQ","m":"ETF"},
    {"s":"HYG","n":"iShares iBoxx High Yield Corporate Bond ETF","x":"NYSE","m":"ETF"},
    {"s":"XLK","n":"Technology Select Sector SPDR Fund","x":"NYSE","m":"ETF"},
    {"s":"XLF","n":"Financial Select Sector SPDR Fund","x":"NYSE","m":"ETF"},
    {"s":"XLE","n":"Energy Select Sector SPDR Fund","x":"NYSE","m":"ETF"},
    {"s":"XLV","n":"Health Care Select Sector SPDR Fund","x":"NYSE","m":"ETF"},
    {"s":"XLI","n":"Industrial Select Sector SPDR Fund","x":"NYSE","m":"ETF"},
    {"s":"ARKK","n":"ARK Innovation ETF","x":"NYSE","m":"ETF"},
    {"s":"SOXX","n":"iShares Semiconductor ETF","x":"NASDAQ","m":"ETF"},
    {"s":"EEM","n":"iShares MSCI Emerging Markets ETF","x":"NYSE","m":"ETF"},
    {"s":"VNQ","n":"Vanguard Real Estate ETF","x":"NYSE","m":"ETF"},
    {"s":"TQQQ","n":"ProShares UltraPro QQQ","x":"NASDAQ","m":"ETF"},
    {"s":"SQQQ","n":"ProShares UltraPro Short QQQ","x":"NASDAQ","m":"ETF"},
    {"s":"UVXY","n":"ProShares Ultra VIX Short-Term Futures ETF","x":"CBOE","m":"ETF"},
]

# ── 한국 종목 내장 DB (주요 종목 200개+) ────────────────────
KR_TICKERS_BUILTIN: list[dict] = [
    # ── KOSPI 대형주 ────────────────────────────────────────
    {"s":"005930.KS","n":"삼성전자","x":"KOSPI","m":"KR","c":"005930"},
    {"s":"000660.KS","n":"SK하이닉스","x":"KOSPI","m":"KR","c":"000660"},
    {"s":"035420.KS","n":"NAVER","x":"KOSPI","m":"KR","c":"035420"},
    {"s":"005380.KS","n":"현대차","x":"KOSPI","m":"KR","c":"005380"},
    {"s":"000270.KS","n":"기아","x":"KOSPI","m":"KR","c":"000270"},
    {"s":"051910.KS","n":"LG화학","x":"KOSPI","m":"KR","c":"051910"},
    {"s":"066570.KS","n":"LG전자","x":"KOSPI","m":"KR","c":"066570"},
    {"s":"055550.KS","n":"신한지주","x":"KOSPI","m":"KR","c":"055550"},
    {"s":"105560.KS","n":"KB금융","x":"KOSPI","m":"KR","c":"105560"},
    {"s":"096770.KS","n":"SK이노베이션","x":"KOSPI","m":"KR","c":"096770"},
    {"s":"034730.KS","n":"SK","x":"KOSPI","m":"KR","c":"034730"},
    {"s":"017670.KS","n":"SK텔레콤","x":"KOSPI","m":"KR","c":"017670"},
    {"s":"068270.KS","n":"셀트리온","x":"KOSPI","m":"KR","c":"068270"},
    {"s":"009150.KS","n":"삼성전기","x":"KOSPI","m":"KR","c":"009150"},
    {"s":"003550.KS","n":"LG","x":"KOSPI","m":"KR","c":"003550"},
    {"s":"028260.KS","n":"삼성물산","x":"KOSPI","m":"KR","c":"028260"},
    {"s":"018260.KS","n":"삼성SDS","x":"KOSPI","m":"KR","c":"018260"},
    {"s":"003490.KS","n":"대한항공","x":"KOSPI","m":"KR","c":"003490"},
    {"s":"015760.KS","n":"한국전력","x":"KOSPI","m":"KR","c":"015760"},
    {"s":"010130.KS","n":"고려아연","x":"KOSPI","m":"KR","c":"010130"},
    {"s":"012330.KS","n":"현대모비스","x":"KOSPI","m":"KR","c":"012330"},
    {"s":"032830.KS","n":"삼성생명","x":"KOSPI","m":"KR","c":"032830"},
    {"s":"004020.KS","n":"현대제철","x":"KOSPI","m":"KR","c":"004020"},
    {"s":"011200.KS","n":"HMM","x":"KOSPI","m":"KR","c":"011200"},
    {"s":"086790.KS","n":"하나금융지주","x":"KOSPI","m":"KR","c":"086790"},
    {"s":"033780.KS","n":"KT&G","x":"KOSPI","m":"KR","c":"033780"},
    {"s":"030200.KS","n":"KT","x":"KOSPI","m":"KR","c":"030200"},
    {"s":"009540.KS","n":"HD한국조선해양","x":"KOSPI","m":"KR","c":"009540"},
    {"s":"000720.KS","n":"현대건설","x":"KOSPI","m":"KR","c":"000720"},
    {"s":"010950.KS","n":"S-Oil","x":"KOSPI","m":"KR","c":"010950"},
    {"s":"005490.KS","n":"POSCO홀딩스","x":"KOSPI","m":"KR","c":"005490"},
    {"s":"003670.KS","n":"포스코퓨처엠","x":"KOSPI","m":"KR","c":"003670"},
    {"s":"207940.KS","n":"삼성바이오로직스","x":"KOSPI","m":"KR","c":"207940"},
    {"s":"006400.KS","n":"삼성SDI","x":"KOSPI","m":"KR","c":"006400"},
    {"s":"035720.KS","n":"카카오","x":"KOSPI","m":"KR","c":"035720"},
    {"s":"000100.KS","n":"유한양행","x":"KOSPI","m":"KR","c":"000100"},
    {"s":"090430.KS","n":"아모레퍼시픽","x":"KOSPI","m":"KR","c":"090430"},
    {"s":"004370.KS","n":"농심","x":"KOSPI","m":"KR","c":"004370"},
    {"s":"051900.KS","n":"LG생활건강","x":"KOSPI","m":"KR","c":"051900"},
    {"s":"000810.KS","n":"삼성화재","x":"KOSPI","m":"KR","c":"000810"},
    {"s":"032640.KS","n":"LG유플러스","x":"KOSPI","m":"KR","c":"032640"},
    {"s":"069960.KS","n":"현대백화점","x":"KOSPI","m":"KR","c":"069960"},
    {"s":"001040.KS","n":"CJ","x":"KOSPI","m":"KR","c":"001040"},
    {"s":"097950.KS","n":"CJ제일제당","x":"KOSPI","m":"KR","c":"097950"},
    {"s":"011170.KS","n":"롯데케미칼","x":"KOSPI","m":"KR","c":"011170"},
    {"s":"023530.KS","n":"롯데쇼핑","x":"KOSPI","m":"KR","c":"023530"},
    {"s":"010060.KS","n":"OCI홀딩스","x":"KOSPI","m":"KR","c":"010060"},
    {"s":"161390.KS","n":"한국타이어앤테크놀로지","x":"KOSPI","m":"KR","c":"161390"},
    {"s":"002380.KS","n":"KCC","x":"KOSPI","m":"KR","c":"002380"},
    {"s":"008770.KS","n":"호텔신라","x":"KOSPI","m":"KR","c":"008770"},
    {"s":"000150.KS","n":"두산","x":"KOSPI","m":"KR","c":"000150"},
    {"s":"042660.KS","n":"한화오션","x":"KOSPI","m":"KR","c":"042660"},
    {"s":"329180.KS","n":"현대중공업","x":"KOSPI","m":"KR","c":"329180"},
    {"s":"000020.KS","n":"동화약품","x":"KOSPI","m":"KR","c":"000020"},
    {"s":"139480.KS","n":"이마트","x":"KOSPI","m":"KR","c":"139480"},
    {"s":"004800.KS","n":"효성","x":"KOSPI","m":"KR","c":"004800"},
    {"s":"001300.KS","n":"이건산업","x":"KOSPI","m":"KR","c":"001300"},
    {"s":"316140.KS","n":"우리금융지주","x":"KOSPI","m":"KR","c":"316140"},
    {"s":"015020.KS","n":"이재명","x":"KOSPI","m":"KR","c":"015020"},
    {"s":"047050.KS","n":"포스코인터내셔널","x":"KOSPI","m":"KR","c":"047050"},
    {"s":"006800.KS","n":"미래에셋증권","x":"KOSPI","m":"KR","c":"006800"},
    {"s":"071050.KS","n":"한국금융지주","x":"KOSPI","m":"KR","c":"071050"},
    {"s":"003600.KS","n":"SK케미칼","x":"KOSPI","m":"KR","c":"003600"},
    {"s":"180640.KS","n":"한진칼","x":"KOSPI","m":"KR","c":"180640"},
    {"s":"001080.KS","n":"만호제강","x":"KOSPI","m":"KR","c":"001080"},
    {"s":"000080.KS","n":"하이트진로","x":"KOSPI","m":"KR","c":"000080"},
    {"s":"111770.KS","n":"영원무역","x":"KOSPI","m":"KR","c":"111770"},
    {"s":"026960.KS","n":"동서","x":"KOSPI","m":"KR","c":"026960"},
    {"s":"005830.KS","n":"DB손해보험","x":"KOSPI","m":"KR","c":"005830"},
    # ── KOSPI ETF ────────────────────────────────────────────
    {"s":"069500.KS","n":"KODEX 200","x":"KOSPI","m":"KR","c":"069500"},
    {"s":"114800.KS","n":"KODEX 인버스","x":"KOSPI","m":"KR","c":"114800"},
    {"s":"122630.KS","n":"KODEX 레버리지","x":"KOSPI","m":"KR","c":"122630"},
    {"s":"252670.KS","n":"KODEX 200선물인버스2X","x":"KOSPI","m":"KR","c":"252670"},
    {"s":"229200.KS","n":"KODEX 코스닥150","x":"KOSPI","m":"KR","c":"229200"},
    {"s":"233740.KS","n":"KODEX 코스닥150레버리지","x":"KOSPI","m":"KR","c":"233740"},
    {"s":"102110.KS","n":"TIGER 200","x":"KOSPI","m":"KR","c":"102110"},
    {"s":"148020.KS","n":"KOSEF 국고채10년","x":"KOSPI","m":"KR","c":"148020"},
    # ── KOSDAQ 주요 종목 ─────────────────────────────────────
    {"s":"035720.KQ","n":"카카오","x":"KOSDAQ","m":"KR","c":"035720"},
    {"s":"247540.KQ","n":"에코프로비엠","x":"KOSDAQ","m":"KR","c":"247540"},
    {"s":"086900.KQ","n":"메디톡스","x":"KOSDAQ","m":"KR","c":"086900"},
    {"s":"196170.KQ","n":"알테오젠","x":"KOSDAQ","m":"KR","c":"196170"},
    {"s":"112040.KQ","n":"위메이드","x":"KOSDAQ","m":"KR","c":"112040"},
    {"s":"041510.KQ","n":"에스엠","x":"KOSDAQ","m":"KR","c":"041510"},
    {"s":"293490.KQ","n":"카카오게임즈","x":"KOSDAQ","m":"KR","c":"293490"},
    {"s":"263750.KQ","n":"펄어비스","x":"KOSDAQ","m":"KR","c":"263750"},
    {"s":"058470.KQ","n":"리노공업","x":"KOSDAQ","m":"KR","c":"058470"},
    {"s":"036570.KQ","n":"NC소프트","x":"KOSDAQ","m":"KR","c":"036570"},
    {"s":"357780.KQ","n":"솔브레인","x":"KOSDAQ","m":"KR","c":"357780"},
    {"s":"039030.KQ","n":"이오테크닉스","x":"KOSDAQ","m":"KR","c":"039030"},
    {"s":"067160.KQ","n":"아프리카TV","x":"KOSDAQ","m":"KR","c":"067160"},
    {"s":"214150.KQ","n":"클래시스","x":"KOSDAQ","m":"KR","c":"214150"},
    {"s":"091990.KQ","n":"셀트리온헬스케어","x":"KOSDAQ","m":"KR","c":"091990"},
    {"s":"145020.KQ","n":"휴젤","x":"KOSDAQ","m":"KR","c":"145020"},
    {"s":"028300.KQ","n":"HLB","x":"KOSDAQ","m":"KR","c":"028300"},
    {"s":"054040.KQ","n":"한미반도체","x":"KOSDAQ","m":"KR","c":"054040"},
    {"s":"039200.KQ","n":"오스코텍","x":"KOSDAQ","m":"KR","c":"039200"},
    {"s":"000250.KQ","n":"삼천당제약","x":"KOSDAQ","m":"KR","c":"000250"},
    {"s":"078600.KQ","n":"대주전자재료","x":"KOSDAQ","m":"KR","c":"078600"},
    {"s":"064760.KQ","n":"티씨케이","x":"KOSDAQ","m":"KR","c":"064760"},
    {"s":"240810.KQ","n":"원익IPS","x":"KOSDAQ","m":"KR","c":"240810"},
    {"s":"131290.KQ","n":"티이엔에스","x":"KOSDAQ","m":"KR","c":"131290"},
    {"s":"041960.KQ","n":"코미팜","x":"KOSDAQ","m":"KR","c":"041960"},
    {"s":"060900.KQ","n":"인선이엔티","x":"KOSDAQ","m":"KR","c":"060900"},
    {"s":"950160.KQ","n":"코오롱티슈진","x":"KOSDAQ","m":"KR","c":"950160"},
    {"s":"218410.KQ","n":"RFHIC","x":"KOSDAQ","m":"KR","c":"218410"},
    {"s":"259960.KQ","n":"크래프톤","x":"KOSDAQ","m":"KR","c":"259960"},
    {"s":"122900.KQ","n":"와이지엔터테인먼트","x":"KOSDAQ","m":"KR","c":"122900"},
    {"s":"035900.KQ","n":"JYP Ent.","x":"KOSDAQ","m":"KR","c":"035900"},
    {"s":"016360.KQ","n":"삼성증권","x":"KOSDAQ","m":"KR","c":"016360"},
    {"s":"376300.KQ","n":"디어유","x":"KOSDAQ","m":"KR","c":"376300"},
    {"s":"039560.KQ","n":"다산네트웍스","x":"KOSDAQ","m":"KR","c":"039560"},
    {"s":"140410.KQ","n":"메지온","x":"KOSDAQ","m":"KR","c":"140410"},
    {"s":"357120.KQ","n":"코람코에너지리츠","x":"KOSDAQ","m":"KR","c":"357120"},
    {"s":"241560.KQ","n":"두산퓨얼셀","x":"KOSDAQ","m":"KR","c":"241560"},
    {"s":"069960.KQ","n":"현대백화점","x":"KOSDAQ","m":"KR","c":"069960"},
]

# ── 전체 DB ────────────────────────────────────────────────
_kr_db: list[dict] = []
_us_db: list[dict] = US_TICKERS.copy()
_kr_loaded = False
_lock = threading.Lock()

# FDR 가격 캐시 (종목코드 → 가격 정보)
_fdr_price_cache: dict = {}


def _load_kr_from_fdr():
    """FinanceDataReader로 KRX 전체 상장 종목 로드 (가격 포함)"""
    global _kr_db, _kr_loaded, _fdr_price_cache
    try:
        import FinanceDataReader as fdr
        df = fdr.StockListing("KRX")
        if df is None or df.empty:
            return False
        results = []
        prices = {}
        for _, row in df.iterrows():
            code = str(row.get("Code", "")).zfill(6)
            name = str(row.get("Name", "")).strip()
            market = str(row.get("Market", "KOSPI")).strip()
            if not code or not name or len(code) != 6:
                continue
            suffix = ".KS" if market == "KOSPI" else ".KQ"
            sym = f"{code}{suffix}"
            results.append({"s": sym, "n": name, "x": market, "m": "KR", "c": code})
            # 가격 정보도 캐시
            close = row.get("Close", 0)
            if close and float(close) > 0:
                prices[sym] = {
                    "symbol": sym, "name": name, "price": float(close),
                    "change": float(row.get("Changes", 0) or 0),
                    "change_rate": float(row.get("ChagesRatio", 0) or 0),
                    "volume": int(row.get("Volume", 0) or 0),
                    "market_cap": int(row.get("Marcap", 0) or 0),
                    "currency": "KRW",
                    "high": float(row.get("High", 0) or 0),
                    "low":  float(row.get("Low", 0) or 0),
                    "open": float(row.get("Open", 0) or 0),
                }
        if results:
            with _lock:
                _kr_db = results
                _fdr_price_cache = prices
                _kr_loaded = True
            log.info(f"FDR 한국 종목 {len(results)}개 로드 완료 (가격 {len(prices)}개 캐시)")
            return True
    except Exception as e:
        log.debug(f"FDR 실패: {e}")
    return False


def _load_kr_from_pykrx():
    """pykrx 시도 → FDR → 내장 DB 순으로 폴백"""
    global _kr_db, _kr_loaded
    # 1순위: FDR
    if _load_kr_from_fdr():
        return
    # 2순위: pykrx (레거시)
    try:
        from pykrx import stock
        from datetime import datetime, timedelta
        date = (datetime.now() - timedelta(days=1)).strftime("%Y%m%d")
        results = []
        for market in ["KOSPI", "KOSDAQ"]:
            try:
                tickers = stock.get_market_ticker_list(date, market=market)
                for ticker in (tickers or []):
                    try:
                        name = stock.get_market_ticker_name(ticker)
                        if name:
                            suffix = ".KS" if market == "KOSPI" else ".KQ"
                            results.append({"s": f"{ticker}{suffix}", "n": name, "x": market, "m": "KR", "c": ticker})
                    except Exception:
                        continue
            except Exception:
                continue
        if results:
            with _lock:
                _kr_db = results
                _kr_loaded = True
            log.info(f"pykrx 한국 종목 {len(results)}개 로드 완료")
            return
    except Exception as e:
        log.debug(f"pykrx 실패: {e}")
    # 3순위: 내장 DB
    log.info("내장 한국 종목 DB 사용")
    with _lock:
        _kr_db = KR_TICKERS_BUILTIN.copy()
        _kr_loaded = True


def get_fdr_price(symbol: str) -> dict | None:
    """FDR 캐시에서 한국 종목 가격 조회"""
    return _fdr_price_cache.get(symbol)


def ensure_kr_loaded():
    global _kr_loaded
    if not _kr_loaded:
        _load_kr_from_pykrx()


def get_kr_db() -> list[dict]:
    ensure_kr_loaded()
    return _kr_db or KR_TICKERS_BUILTIN


def get_us_db() -> list[dict]:
    return _us_db


# ── 검색 함수 ──────────────────────────────────────────────
def search_stocks(query: str, market_filter: str = "ALL") -> list[dict]:  # noqa: C901
    """
    전체 종목 검색
    market_filter: ALL, KR, US, ETF
    """
    q_up  = query.strip().upper()
    q_low = query.strip().lower()

    seen, results = set(), []

    def add(item: dict):
        sym = item["s"]
        if sym not in seen:
            seen.add(sym)
            results.append({
                "symbol":   sym,
                "name":     item["n"],
                "market":   item["m"],
                "exchange": item["x"],
                "type":     "ETF" if item["m"] == "ETF" else "EQUITY",
                "code":     item.get("c", ""),
            })

    # 한국 DB 검색
    if market_filter in ("ALL", "KR"):
        kr_db = get_kr_db()
        # 6자리 숫자 입력 → 코드 직접 매칭
        if q_up.isdigit() and len(q_up) == 6:
            for item in kr_db:
                if item.get("c") == q_up or item["s"].startswith(q_up):
                    add(item)
        # 심볼/이름 검색
        for item in kr_db:
            if q_up in item["s"].upper() or q_low in item["n"].lower():
                add(item)
            if len(results) >= 30:
                break

    # 미국/ETF DB 검색 (심볼, 영문명, 한국어명)
    if market_filter in ("ALL", "US", "ETF"):
        for item in _us_db:
            if item["m"] == "ETF" and market_filter not in ("ALL", "ETF"):
                continue
            if item["m"] == "US" and market_filter == "ETF":
                continue
            sym = item["s"]
            ko_names = KO_NAME_MAP.get(sym, [])
            ko_match = any(q_low in ko.lower() for ko in ko_names)
            if q_up in sym.upper() or q_low in item["n"].lower() or ko_match:
                # 한국어 이름도 표시
                enriched = {**item}
                if ko_names:
                    enriched["ko_name"] = ko_names[0]
                add(enriched)
            if len(results) >= 50:
                break

    return results[:20]


# 서버 시작 시 백그라운드로 한국 DB 로드
def init_ticker_db():
    t = threading.Thread(target=_load_kr_from_pykrx, daemon=True)
    t.start()
    log.info("한국 종목 DB 백그라운드 로드 시작")
