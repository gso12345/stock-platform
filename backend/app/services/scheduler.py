"""
백그라운드 데이터 갱신 스케줄러
- 한국: 네이버 금융 Polling API
- 미국: Yahoo Finance v7 멀티쿼트
"""
import asyncio
import logging
from app.core.cache import cache
from app.services.price_fetcher import (
    fetch_naver_indices, fetch_naver_stocks, fetch_naver_exchange,
    fetch_yf_quotes, fetch_yf_index_quotes, get_usdkrw,
)
from app.core.config import settings

log = logging.getLogger(__name__)

KR_INDICES = ["KOSPI","KOSDAQ","KOSPI200","KOSDAQ150"]
US_INDICES = ["SP500","NASDAQ","DOW","SOX","RUSSELL"]

KR_INDEX_DISPLAY = {
    "KOSPI":"코스피","KOSDAQ":"코스닥","KOSPI200":"코스피 200","KOSDAQ150":"코스닥 150",
}
US_INDEX_YF = {
    "SP500":"^GSPC","NASDAQ":"^IXIC","DOW":"^DJI","SOX":"^SOX","RUSSELL":"^RUT",
}
US_INDEX_DISPLAY = {
    "SP500":"S&P 500","NASDAQ":"나스닥 종합","DOW":"다우 산업","SOX":"필라델피아 반도체","RUSSELL":"러셀 2000",
}

POPULAR_US = [
    "AAPL","NVDA","MSFT","AMZN","TSLA","META","GOOGL","AVGO","JPM","V",
    "MA","UNH","AMD","NFLX","COST","HD","BAC","CRM","ORCL","QCOM",
]
POPULAR_KR_CODES = [
    "005930","000660","035420","005380","000270",
    "051910","066570","055550","068270","035720",
]



async def refresh_kr_indices():
    """네이버 금융으로 국내 지수 갱신"""
    naver_data = await fetch_naver_indices()
    ok = 0
    for name in KR_INDICES:
        if name in naver_data:
            cache.set(f"idx:{name}", naver_data[name], 30)
            ok += 1
    # KIS API 보강
    if settings.KIS_APP_KEY:
        from app.services.kis_service import kis_service
        KIS_MAP = {"KOSPI":"0001","KOSDAQ":"1001","KOSPI200":"2001","KOSDAQ150":"2203"}
        for name, code in KIS_MAP.items():
            if name in naver_data:
                continue  # 이미 네이버로 갱신됨
            try:
                r = await asyncio.wait_for(
                    kis_service.get_index(code, name, KR_INDEX_DISPLAY[name]), timeout=8
                )
                if r and r.get("value", 0) > 0:
                    cache.set(f"idx:{name}", r, 30)
                    ok += 1
            except Exception:
                pass
    log.info(f"국내 지수 {ok}/{len(KR_INDICES)}개 갱신")
    return ok


async def refresh_us_indices():
    """YF v7으로 미국 지수 갱신"""
    yf_symbols = list(US_INDEX_YF.values())
    data = await fetch_yf_index_quotes(yf_symbols)
    ok = 0
    for name, yf_sym in US_INDEX_YF.items():
        q = data.get(yf_sym)
        if q and q.get("price", 0) > 0:
            entry = {
                "index": name,
                "name":  US_INDEX_DISPLAY.get(name, name),
                "value": round(q["price"], 2),
                "change": round(q["change"], 2),
                "change_rate": round(q["change_rate"], 2),
            }
            cache.set(f"idx:{name}", entry, 60)
            ok += 1
    log.info(f"미국 지수 {ok}/{len(US_INDICES)}개 갱신")
    return ok


async def refresh_us_stocks():
    """YF v7 멀티쿼트로 미국 종목 갱신 — 순위용 SP500 + 인기종목 합산"""
    from app.services.yf_service import SP500_SYMBOLS
    all_syms = list(dict.fromkeys(POPULAR_US + SP500_SYMBOLS))  # 중복 제거, 순서 유지
    data = await fetch_yf_quotes(all_syms)
    ok = 0
    for sym in all_syms:
        q = data.get(sym)
        if q and q.get("price"):
            q["symbol"] = sym
            cache.set(f"price:{sym}", q, 60)
            ok += 1
    log.info(f"미국 종목 {ok}/{len(all_syms)}개 갱신")
    return ok


async def refresh_kr_stocks():
    """네이버 금융으로 국내 종목 갱신"""
    # KIS API 우선
    if settings.KIS_APP_KEY:
        from app.services.kis_service import kis_service
        ok_kis = 0
        for code6 in POPULAR_KR_CODES:
            try:
                r = await asyncio.wait_for(kis_service.get_price(code6), timeout=8)
                if r and r.get("price"):
                    sym_ks = f"{code6}.KS"
                    cache.set(f"price:{sym_ks}", {**r, "symbol": sym_ks}, 30)
                    cache.set(f"price:{code6}", {**r, "symbol": code6}, 30)
                    ok_kis += 1
            except Exception:
                pass
            await asyncio.sleep(0.3)
        log.info(f"국내 종목(KIS) {ok_kis}/{len(POPULAR_KR_CODES)}개 갱신")
        if ok_kis > 5:
            return ok_kis

    # 네이버 금융 폴백
    naver_data = await fetch_naver_stocks(POPULAR_KR_CODES)
    ok = 0
    for code6, q in naver_data.items():
        sym_ks = f"{code6}.KS"
        cache.set(f"price:{sym_ks}", q, 60)
        cache.set(f"price:{code6}", q, 60)
        ok += 1
    log.info(f"국내 종목(네이버) {ok}/{len(POPULAR_KR_CODES)}개 갱신")
    return ok


async def refresh_exchange():
    """환율 갱신"""
    try:
        r = await get_usdkrw()
        if r and r.get("value", 0) > 0 and not r.get("_demo"):
            log.info(f"환율: {r['value']}원")
    except Exception as e:
        log.debug(f"환율 갱신 실패: {e}")


async def run_startup_prefetch():
    log.info("=== 초기 프리페치 시작 ===")
    await asyncio.sleep(0.3)

    loop = asyncio.get_event_loop()
    # 지수 + 환율 + 뉴스 동시 갱신
    from app.services.news_service import get_kr_news, get_us_news
    await asyncio.gather(
        refresh_kr_indices(),
        refresh_us_indices(),
        refresh_exchange(),
        loop.run_in_executor(None, get_kr_news, 6, 100),
        loop.run_in_executor(None, get_us_news, 6, 100),
        return_exceptions=True,
    )
    await asyncio.sleep(2)
    # 종목 갱신
    await asyncio.gather(
        refresh_us_stocks(),
        refresh_kr_stocks(),
        return_exceptions=True,
    )
    log.info("=== 초기 프리페치 완료 ===")


async def periodic_refresh():
    """30초마다 국내 지수, 60초마다 미국 지수 + 환율 + 순위, 5분마다 종목 + 뉴스"""
    from app.services.ranking_service import refresh_kr_rankings_from_naver
    counter = 0
    while True:
        await asyncio.sleep(10)
        counter += 1

        # 국내 지수 (30초 — 캐시 TTL과 일치)
        if counter % 3 == 0:
            await refresh_kr_indices()

        # 미국 지수 (60초 — 캐시 TTL 60초와 일치)
        if counter % 6 == 0:
            await refresh_us_indices()

        # 환율 (60초)
        if counter % 6 == 0:
            await refresh_exchange()

        # 종목 + 뉴스 (5분)
        if counter % 30 == 0:
            from app.services.news_service import get_kr_news, get_us_news
            loop = asyncio.get_event_loop()
            await asyncio.gather(
                refresh_us_stocks(),
                refresh_kr_stocks(),
                loop.run_in_executor(None, get_kr_news, 6, 100),
                loop.run_in_executor(None, get_us_news, 6, 100),
                return_exceptions=True,
            )

        # 순위 (60초) - Naver 실시간
        if counter % 6 == 0:
            await refresh_kr_rankings_from_naver()


def start_background_tasks(app):
    @app.on_event("startup")
    async def startup():
        # init_ticker_db는 main.py _startup에서 이미 호출됨 — 여기서는 제거
        loop = asyncio.get_event_loop()
        loop.create_task(run_startup_prefetch())
        loop.create_task(periodic_refresh())
        log.info("스케줄러 시작됨")
