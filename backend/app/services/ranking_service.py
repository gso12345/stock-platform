"""
주식 순위 서비스
- 한국: Naver 캐시 가격 기반 (scheduler가 10초마다 갱신)
- 미국: YF 캐시 기반
- 데모: 캐시 없을 때만 사용
"""
from app.core.cache import cache
from app.services.yf_service import KOSPI_SYMBOLS, KOSDAQ_SYMBOLS, SP500_SYMBOLS

RANK_TTL = 30  # 30초 캐시 (Naver가 10초마다 갱신하므로 짧게)

KR_NAME_MAP = {
    "005930.KS":"삼성전자","000660.KS":"SK하이닉스","035420.KS":"NAVER",
    "005380.KS":"현대차","000270.KS":"기아","051910.KS":"LG화학",
    "066570.KS":"LG전자","055550.KS":"신한지주","105560.KS":"KB금융",
    "096770.KS":"SK이노베이션","034730.KS":"SK","017670.KS":"SK텔레콤",
    "068270.KS":"셀트리온","009150.KS":"삼성전기","003550.KS":"LG",
    "028260.KS":"삼성물산","018260.KS":"삼성SDS","003490.KS":"대한항공",
    "015760.KS":"한국전력","010130.KS":"고려아연","012330.KS":"현대모비스",
    "032830.KS":"삼성생명","004020.KS":"현대제철","011200.KS":"HMM",
    "086790.KS":"하나금융지주","033780.KS":"KT&G","030200.KS":"KT",
    "207940.KS":"삼성바이오로직스","006400.KS":"삼성SDI",
    "035720.KQ":"카카오","247540.KQ":"에코프로비엠","036570.KQ":"NC소프트",
    "263750.KQ":"펄어비스","041510.KQ":"에스엠","293490.KQ":"카카오게임즈",
}

US_NAME_MAP = {
    "AAPL":"Apple Inc.","NVDA":"NVIDIA","MSFT":"Microsoft",
    "AMZN":"Amazon","TSLA":"Tesla","META":"Meta","GOOGL":"Alphabet",
    "AVGO":"Broadcom","JPM":"JPMorgan","V":"Visa","MA":"Mastercard",
    "UNH":"UnitedHealth","XOM":"Exxon Mobil","WMT":"Walmart",
    "LLY":"Eli Lilly","JNJ":"J&J","COST":"Costco","HD":"Home Depot",
    "BAC":"Bank of America","AMD":"AMD","NFLX":"Netflix",
    "CRM":"Salesforce","ORCL":"Oracle","QCOM":"Qualcomm",
}


def _get_cached_price(symbol: str) -> dict | None:
    """캐시에서 가격 조회 (신선→stale 순)"""
    fresh = cache.get(f"price:{symbol}")
    if fresh and fresh.get("price") and not fresh.get("_demo"):
        return fresh
    stale = cache.get_stale(f"price:{symbol}")
    if stale and stale.get("price") and not stale.get("_demo"):
        return stale
    # demo 포함해서 반환 (아무것도 없는 것보다 낫다)
    return fresh or stale


def _build_kr_rows() -> list[dict]:
    """Naver 캐시에서 한국 종목 랭킹 데이터 구성"""
    symbols = KOSPI_SYMBOLS[:25] + KOSDAQ_SYMBOLS[:10]
    rows = []
    for sym in symbols:
        p = _get_cached_price(sym)
        price  = p.get("price")  if p else None
        volume = p.get("volume") if p else 0
        amount = (price * volume) if (price and volume) else 0
        # 시가총액: KIS/yfinance 제공 또는 주가*발행주식수 추정 (캐시에 있으면 사용)
        market_cap = p.get("market_cap") if p else 0
        rows.append({
            "symbol":      sym,
            "name":        KR_NAME_MAP.get(sym, sym),
            "price":       price,
            "change_rate": p.get("change_rate") if p else 0.0,
            "change":      p.get("change")      if p else 0.0,
            "volume":      volume,
            "amount":      amount,
            "market_cap":  market_cap,
            "_demo":       p.get("_demo",False) if p else True,
        })
    return rows


def _build_us_rows() -> list[dict]:
    """YF 캐시에서 미국 종목 랭킹 데이터 구성"""
    symbols = SP500_SYMBOLS[:30]
    rows = []
    for sym in symbols:
        p = _get_cached_price(sym)
        rows.append({
            "symbol":      sym,
            "name":        US_NAME_MAP.get(sym, p.get("name", sym) if p else sym),
            "price":       p.get("price")       if p else None,
            "change_rate": p.get("change_rate") if p else 0.0,
            "change":      p.get("change")      if p else 0.0,
            "volume":      p.get("volume")      if p else 0,
            "amount":      (p["price"] * p.get("volume",0)) if p and p.get("price") else 0,
            "market_cap":  p.get("market_cap",0) if p else 0,
            "_demo":       p.get("_demo",False) if p else True,
        })
    return rows


def _sort_and_rank(rows: list[dict], category: str) -> list[dict]:
    """카테고리별 정렬 + 순위 부여"""
    if not rows:
        return rows

    sortable   = [r for r in rows if r.get("price") is not None]
    unsortable = [r for r in rows if r.get("price") is None]

    if category == "상승률":
        # 등락률 높은 순
        sortable.sort(key=lambda x: x.get("change_rate") or -9999, reverse=True)
    elif category == "하락률":
        # 등락률 낮은 순 (음수가 큰 것)
        sortable.sort(key=lambda x: x.get("change_rate") or 9999)
    elif category == "거래대금":
        # 거래대금(원) = 현재가 × 거래량
        for r in sortable:
            if not r.get("amount"):
                r["amount"] = (r.get("price") or 0) * (r.get("volume") or 0)
        sortable.sort(key=lambda x: x.get("amount") or 0, reverse=True)
    elif category == "거래량":
        # 거래량 많은 순
        sortable.sort(key=lambda x: x.get("volume") or 0, reverse=True)
    elif category == "신고가":
        # 당일 등락률 높은 순 (신고가 근접 = 상승률 높음)
        sortable.sort(key=lambda x: x.get("change_rate") or -9999, reverse=True)
    elif category == "신저가":
        # 당일 등락률 낮은 순 (신저가 근접 = 하락률 높음)
        sortable.sort(key=lambda x: x.get("change_rate") or 9999)
    else:
        # 시가총액 — market_cap 있으면 사용, 없으면 (가격 × 대략 발행주식수) 추정
        # KOSPI 기준 대략적 시가총액 수동 맵
        KR_MC_HINT = {
            "005930.KS": 342_000_000_000_000,  # 삼성전자 ~342조
            "000660.KS": 143_000_000_000_000,  # SK하이닉스 ~143조
            "207940.KS": 130_000_000_000_000,  # 삼성바이오로직스 ~130조
            "035420.KS":  30_000_000_000_000,  # NAVER ~30조
            "005380.KS":  51_000_000_000_000,  # 현대차 ~51조
            "006400.KS":  45_000_000_000_000,  # 삼성SDI ~45조
            "051910.KS":  34_000_000_000_000,  # LG화학 ~34조
        }
        for r in sortable:
            if not r.get("market_cap"):
                r["market_cap"] = KR_MC_HINT.get(r["symbol"], 0)
        sortable.sort(key=lambda x: x.get("market_cap") or 0, reverse=True)

    merged = sortable + unsortable
    for i, r in enumerate(merged):
        r["rank"] = i + 1
    return merged[:20]


def get_kr_rankings(category: str = "시가총액") -> list[dict]:
    ck = f"rank:kr:{category}"
    fresh = cache.get(ck)
    if fresh:
        return fresh

    rows   = _build_kr_rows()
    result = _sort_and_rank(rows, category)

    # 가격 있는 결과면 캐시 저장
    if any(r.get("price") for r in result):
        cache.set(ck, result, RANK_TTL)
    return result


def get_us_rankings(category: str = "시가총액") -> list[dict]:
    ck = f"rank:us:{category}"
    fresh = cache.get(ck)
    if fresh:
        return fresh

    rows   = _build_us_rows()
    result = _sort_and_rank(rows, category)

    if any(r.get("price") for r in result):
        cache.set(ck, result, RANK_TTL)
    return result


def get_exchange_rate() -> dict:
    """환율 — price_fetcher의 캐시 반환"""
    ck = "extra:usdkrw"
    return cache.get(ck) or cache.get_stale(ck) or {
        "symbol":"USDKRW","name":"원/달러 환율",
        "value":1384.50,"change":0,"change_rate":0,"unit":"원","_demo":True,
    }
