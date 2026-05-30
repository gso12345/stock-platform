"""
폴백 데모 데이터 (API 키 없을 때 / rate limit 시)
2026년 5월 기준 근사값
"""
import math, random

DEMO_INDICES = {
    # 국내 (KIS API 없을 때)
    "KOSPI":     {"index":"KOSPI",    "name":"코스피",           "value":2838.52, "change":-10.34, "change_rate":-0.36},
    "KOSDAQ":    {"index":"KOSDAQ",   "name":"코스닥",           "value":909.88,  "change":2.41,   "change_rate":0.27},
    "KOSPI200":  {"index":"KOSPI200", "name":"코스피 200",       "value":373.20,  "change":-1.05,  "change_rate":-0.28},
    "KOSDAQ150": {"index":"KOSDAQ150","name":"코스닥 150",       "value":1190.44, "change":3.20,   "change_rate":0.27},
    # 해외 (yfinance rate limit 시 — 2026-05-30 실제값 기준)
    "SP500":     {"index":"SP500",    "name":"S&P 500",          "value":7582.30, "change":24.97,  "change_rate":0.33},
    "NASDAQ":    {"index":"NASDAQ",   "name":"나스닥 종합",       "value":26994.28,"change":80.99,  "change_rate":0.30},
    "DOW":       {"index":"DOW",      "name":"다우 산업",         "value":51091.26,"change":422.29, "change_rate":0.83},
    "SOX":       {"index":"SOX",      "name":"필라델피아 반도체", "value":4921.10, "change":67.44,  "change_rate":1.39},
    "RUSSELL":   {"index":"RUSSELL",  "name":"러셀 2000",         "value":2110.45, "change":8.32,   "change_rate":0.40},
}

DEMO_PRICES = {
    # 미국 — 2026-05-30 기준 근사값
    "AAPL":  {"symbol":"AAPL", "name":"Apple Inc.",           "price":211.45,"change":1.23,  "change_rate":0.59,  "volume":52341000,"market_cap":3190000000000,"currency":"USD","high":212.10,"low":209.80,"open":210.50,"prev_close":210.22},
    "NVDA":  {"symbol":"NVDA", "name":"NVIDIA Corporation",   "price":134.80,"change":3.21,  "change_rate":2.44,  "volume":285000000,"market_cap":3290000000000,"currency":"USD","high":136.10,"low":132.90,"open":133.50,"prev_close":131.59},
    "MSFT":  {"symbol":"MSFT", "name":"Microsoft Corp.",      "price":457.30,"change":2.10,  "change_rate":0.46,  "volume":18920000,"market_cap":3400000000000,"currency":"USD","high":458.90,"low":454.70,"open":455.80,"prev_close":455.20},
    "AMZN":  {"symbol":"AMZN", "name":"Amazon.com Inc.",      "price":225.60,"change":3.40,  "change_rate":1.53,  "volume":31240000,"market_cap":2370000000000,"currency":"USD","high":226.90,"low":222.40,"open":223.10,"prev_close":222.20},
    "TSLA":  {"symbol":"TSLA", "name":"Tesla Inc.",           "price":248.10,"change":-3.40, "change_rate":-1.35, "volume":98120000,"market_cap":791000000000, "currency":"USD","high":253.20,"low":247.50,"open":252.00,"prev_close":251.50},
    "META":  {"symbol":"META", "name":"Meta Platforms",       "price":615.30,"change":5.70,  "change_rate":0.94,  "volume":12340000,"market_cap":1560000000000,"currency":"USD","high":617.20,"low":610.50,"open":612.00,"prev_close":609.60},
    "GOOGL": {"symbol":"GOOGL","name":"Alphabet Inc.",        "price":185.20,"change":0.90,  "change_rate":0.49,  "volume":21340000,"market_cap":2290000000000,"currency":"USD","high":186.10,"low":184.00,"open":184.50,"prev_close":184.30},
    "JPM":   {"symbol":"JPM",  "name":"JPMorgan Chase",       "price":278.30,"change":1.20,  "change_rate":0.43,  "volume":8920000, "market_cap":793000000000, "currency":"USD","high":279.50,"low":277.10,"open":277.50,"prev_close":277.10},
    "V":     {"symbol":"V",    "name":"Visa Inc.",            "price":356.90,"change":0.80,  "change_rate":0.22,  "volume":6120000, "market_cap":726000000000, "currency":"USD","high":357.80,"low":355.40,"open":356.00,"prev_close":356.10},
    "AMD":   {"symbol":"AMD",  "name":"Advanced Micro Devices","price":161.40,"change":3.80, "change_rate":2.41,  "volume":45230000,"market_cap":261000000000, "currency":"USD","high":163.20,"low":158.90,"open":159.50,"prev_close":157.60},
    "NFLX":  {"symbol":"NFLX", "name":"Netflix Inc.",         "price":1198.70,"change":12.30,"change_rate":1.04,  "volume":5120000, "market_cap":505000000000, "currency":"USD","high":1203.00,"low":1192.00,"open":1193.00,"prev_close":1186.40},
    "SPY":   {"symbol":"SPY",  "name":"SPDR S&P 500 ETF",    "price":755.10,"change":2.50,  "change_rate":0.33,  "volume":68230000,"market_cap":0,            "currency":"USD","high":756.20,"low":752.80,"open":753.50,"prev_close":752.60},
    "QQQ":   {"symbol":"QQQ",  "name":"Invesco QQQ Trust",   "price":528.40,"change":4.80,  "change_rate":0.92,  "volume":41230000,"market_cap":0,            "currency":"USD","high":530.10,"low":524.30,"open":525.80,"prev_close":523.60},
    # 국내 — 2026-05-30 기준 근사값
    "005930.KS":{"symbol":"005930.KS","name":"삼성전자",     "price":57300, "change":500,   "change_rate":0.88,  "volume":12340000,"market_cap":342000000000000,"currency":"KRW","high":57800,"low":56900,"open":56900,"prev_close":56800},
    "000660.KS":{"symbol":"000660.KS","name":"SK하이닉스",   "price":197000,"change":5000,  "change_rate":2.60,  "volume":3210000, "market_cap":143200000000000,"currency":"KRW","high":198500,"low":194000,"open":194000,"prev_close":192000},
    "035420.KS":{"symbol":"035420.KS","name":"NAVER",        "price":181000,"change":-1000, "change_rate":-0.55, "volume":1230000, "market_cap":29600000000000, "currency":"KRW","high":182500,"low":180000,"open":182000,"prev_close":182000},
    "035720.KQ":{"symbol":"035720.KQ","name":"카카오",       "price":43600, "change":200,   "change_rate":0.46,  "volume":3400000, "market_cap":19300000000000, "currency":"KRW","high":44000,"low":43200,"open":43400,"prev_close":43400},
    "005380.KS":{"symbol":"005380.KS","name":"현대차",       "price":238000,"change":-2500, "change_rate":-1.04, "volume":890000,  "market_cap":50800000000000, "currency":"KRW","high":241000,"low":237500,"open":240500,"prev_close":240500},
}


def _jitter(base: float, pct: float = 0.001) -> float:
    return round(base * (1 + random.uniform(-pct, pct)), 2)


def get_demo_index(name: str) -> dict | None:
    d = DEMO_INDICES.get(name)
    if not d:
        return None
    v    = _jitter(d["value"], 0.0005)
    chg  = _jitter(d["change"], 0.05)
    chgr = round(chg / (v - chg) * 100, 2) if (v - chg) else d["change_rate"]
    return {**d, "value": v, "change": chg, "change_rate": chgr}


def get_demo_price(symbol: str) -> dict | None:
    d = DEMO_PRICES.get(symbol)
    if not d:
        return None
    p    = _jitter(d["price"], 0.001)
    chg  = _jitter(d["change"], 0.05)
    chgr = round(chg / p * 100, 2)
    return {**d, "price": p, "change": chg, "change_rate": chgr}


def get_demo_ohlcv(symbol: str, period: str = "1y") -> list:
    """데모 OHLCV 데이터 생성"""
    from datetime import date, timedelta
    d = DEMO_PRICES.get(symbol, {})
    base = float(d.get("price") or 100)

    n_map = {"1m":22,"3m":66,"6m":130,"1y":252,"2y":504,"5y":1260,"max":1260}
    n = n_map.get(period, 252)

    result, price = [], base * 0.65
    today = date.today()
    for i in range(n + 60):
        dt = today - timedelta(days=n + 60 - i)
        if dt.weekday() >= 5:
            continue
        price *= (1 + random.gauss(0.00025, 0.012))
        price  = max(price, base * 0.3)
        isKR   = symbol.endswith((".KS", ".KQ"))
        rnd    = 0 if isKR else 2
        o = round(price * random.uniform(0.990, 1.010), rnd)
        h = round(price * random.uniform(1.000, 1.018), rnd)
        l = round(price * random.uniform(0.982, 1.000), rnd)
        c = round(price, rnd)
        result.append({"date": str(dt), "open": o, "high": h, "low": l, "close": c, "volume": random.randint(3000000, 80000000)})

    return result[-n:]


def get_demo_rankings_kr(category: str = "시가총액") -> list:
    items = [
        {"symbol":"005930.KS","name":"삼성전자","price":57300,"change_rate":0.88,"volume":12340000,"market_cap":342000000000000},
        {"symbol":"000660.KS","name":"SK하이닉스","price":197000,"change_rate":2.60,"volume":3210000,"market_cap":143200000000000},
        {"symbol":"035420.KS","name":"NAVER","price":181000,"change_rate":-0.55,"volume":1230000,"market_cap":29600000000000},
        {"symbol":"005380.KS","name":"현대차","price":238000,"change_rate":-1.04,"volume":890000,"market_cap":50800000000000},
        {"symbol":"000270.KS","name":"기아","price":124500,"change_rate":0.24,"volume":1450000,"market_cap":49800000000000},
        {"symbol":"051910.KS","name":"LG화학","price":189500,"change_rate":-0.79,"volume":540000,"market_cap":33700000000000},
        {"symbol":"066570.KS","name":"LG전자","price":87400,"change_rate":0.58,"volume":780000,"market_cap":14300000000000},
        {"symbol":"055550.KS","name":"신한지주","price":50800,"change_rate":0.40,"volume":620000,"market_cap":24100000000000},
        {"symbol":"068270.KS","name":"셀트리온","price":162000,"change_rate":1.25,"volume":890000,"market_cap":21400000000000},
        {"symbol":"035720.KQ","name":"카카오","price":43600,"change_rate":0.46,"volume":3400000,"market_cap":19300000000000},
    ]
    if category == "상승률":   items.sort(key=lambda x: x["change_rate"], reverse=True)
    elif category == "하락률": items.sort(key=lambda x: x["change_rate"])
    elif category == "거래량": items.sort(key=lambda x: x["volume"], reverse=True)
    elif category == "거래대금": items.sort(key=lambda x: x["price"]*x["volume"], reverse=True)
    for i, r in enumerate(items):
        r["rank"] = i + 1
        r["amount"] = r["price"] * r["volume"]
    return items


def get_demo_rankings_us(category: str = "시가총액") -> list:
    items = [
        {"symbol":"AAPL", "name":"Apple Inc.",         "price":211.45,"change_rate":0.59,"volume":52341000, "market_cap":3190000000000},
        {"symbol":"NVDA", "name":"NVIDIA",             "price":134.80,"change_rate":2.44,"volume":285000000,"market_cap":3290000000000},
        {"symbol":"MSFT", "name":"Microsoft",          "price":457.30,"change_rate":0.46,"volume":18920000, "market_cap":3400000000000},
        {"symbol":"AMZN", "name":"Amazon",             "price":225.60,"change_rate":1.53,"volume":31240000, "market_cap":2370000000000},
        {"symbol":"GOOGL","name":"Alphabet",           "price":185.20,"change_rate":0.49,"volume":21340000, "market_cap":2290000000000},
        {"symbol":"META", "name":"Meta Platforms",     "price":615.30,"change_rate":0.94,"volume":12340000, "market_cap":1560000000000},
        {"symbol":"TSLA", "name":"Tesla",              "price":248.10,"change_rate":-1.35,"volume":98120000,"market_cap":791000000000},
        {"symbol":"JPM",  "name":"JPMorgan Chase",     "price":278.30,"change_rate":0.43,"volume":8920000,  "market_cap":793000000000},
        {"symbol":"V",    "name":"Visa Inc.",          "price":356.90,"change_rate":0.22,"volume":6120000,  "market_cap":726000000000},
        {"symbol":"AMD",  "name":"AMD",                "price":161.40,"change_rate":2.41,"volume":45230000, "market_cap":261000000000},
    ]
    if category == "상승률":   items.sort(key=lambda x: x["change_rate"], reverse=True)
    elif category == "하락률": items.sort(key=lambda x: x["change_rate"])
    elif category == "거래량": items.sort(key=lambda x: x["volume"], reverse=True)
    elif category == "거래대금": items.sort(key=lambda x: x["price"]*x["volume"], reverse=True)
    for i, r in enumerate(items):
        r["rank"] = i + 1
        r["amount"] = r["price"] * r["volume"]
    return items
