"""
백그라운드 데이터 갱신 스케줄러
- 한국: 네이버 금융 Polling API
- 미국: Yahoo Finance v7 멀티쿼트
"""
import asyncio
import logging
from datetime import datetime
from app.core.cache import cache
from app.services.price_fetcher import (
    fetch_naver_indices, fetch_naver_stocks, fetch_naver_exchange,
    fetch_yf_quotes, fetch_yf_index_quotes, get_usdkrw, fetch_pykrx_index,
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
    from app.services.yf_service import yf_service
    naver_data = await fetch_naver_indices()
    ok = 0
    resolved = set()
    for name in KR_INDICES:
        if name in naver_data:
            cache.set(f"idx:{name}", naver_data[name], 30)
            ok += 1
            resolved.add(name)

    # Naver에서 가져오지 못한 지수는 Yahoo Finance async로 보완 (빠름)
    failed = [n for n in KR_INDICES if n not in resolved]
    if failed:
        from app.services.yf_service import INDEX_SYMBOLS, INDEX_NAMES
        yf_syms = [INDEX_SYMBOLS.get(n, n) for n in failed]
        try:
            yf_data = await asyncio.wait_for(fetch_yf_quotes(yf_syms), timeout=8)
            for name in list(failed):
                sym = INDEX_SYMBOLS.get(name, name)
                if q := yf_data.get(sym):
                    entry = {
                        "index": name,
                        "name":  INDEX_NAMES.get(name, name),
                        "value": q["price"],
                        "change": q["change"],
                        "change_rate": q["change_rate"],
                    }
                    cache.set(f"idx:{name}", entry, 60)
                    ok += 1
                    resolved.add(name)
                    failed.remove(name)
        except Exception:
            pass

    # 그래도 안 된 지수는 yfinance 동기 함수로 보완
    for name in [n for n in KR_INDICES if n not in resolved]:
        try:
            loop = asyncio.get_running_loop()
            result = await asyncio.wait_for(
                loop.run_in_executor(None, yf_service.get_market_index, name),
                timeout=8,
            )
            if result and result.get("value", 0) > 0:
                cache.set(f"idx:{name}", result, 60)
                ok += 1
                resolved.add(name)
        except Exception:
            pass

    # Naver/yfinance 모두 실패한 지수는 pykrx(KRX 공식 데이터)로 보완
    # (네이버 내부 코드 추정이나 야후 심볼이 실제와 다를 때 — 예: KOSDAQ150)
    still_failed = [n for n in KR_INDICES if n not in resolved]
    for name in still_failed:
        try:
            loop = asyncio.get_running_loop()
            result = await asyncio.wait_for(
                loop.run_in_executor(None, fetch_pykrx_index, name),
                timeout=25,
            )
            if result and result.get("value", 0) > 0:
                cache.set(f"idx:{name}", result, 60)
                ok += 1
                resolved.add(name)
        except Exception:
            pass

    # KIS API 보강
    if settings.KIS_APP_KEY:
        from app.services.kis_service import kis_service
        KIS_MAP = {"KOSPI":"0001","KOSDAQ":"1001","KOSPI200":"2001","KOSDAQ150":"2203"}
        for name, code in KIS_MAP.items():
            if name in resolved:
                continue  # 이미 다른 소스로 갱신됨
            try:
                r = await asyncio.wait_for(
                    kis_service.get_index(code, name, KR_INDEX_DISPLAY[name]), timeout=8
                )
                if r and r.get("value", 0) > 0:
                    cache.set(f"idx:{name}", r, 30)
                    ok += 1
                    resolved.add(name)
            except Exception:
                pass
    log.info(f"국내 지수 {ok}/{len(KR_INDICES)}개 갱신")
    return ok


async def refresh_us_indices():
    """미국 지수 갱신 — YF v7 → yfinance fast_info 폴백"""
    import yfinance as yf

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
            continue

        # YF v7 실패 시 fast_info → history 순으로 시도
        try:
            loop = asyncio.get_running_loop()
            def _fast(sym):
                # 1차: fast_info
                try:
                    fi = yf.Ticker(sym).fast_info
                    price = float(getattr(fi, "last_price", 0) or 0)
                    prev  = float(getattr(fi, "previous_close", 0) or 0)
                    if price > 0:
                        chg = round(price - prev, 2)
                        chgr = round(chg / prev * 100, 2) if prev else 0
                        return price, chg, chgr
                except Exception:
                    pass
                # 2차: history (fast_info 실패 시)
                try:
                    hist = yf.Ticker(sym).history(period="2d", interval="1d")
                    if not hist.empty and len(hist) >= 1:
                        price = float(hist["Close"].iloc[-1])
                        prev  = float(hist["Close"].iloc[-2]) if len(hist) >= 2 else price
                        chg   = round(price - prev, 2)
                        chgr  = round(chg / prev * 100, 2) if prev else 0
                        return price, chg, chgr
                except Exception:
                    pass
                return None, None, None

            price, chg, chgr = await asyncio.wait_for(
                loop.run_in_executor(None, _fast, yf_sym), timeout=12
            )
            if price:
                entry = {
                    "index": name,
                    "name":  US_INDEX_DISPLAY.get(name, name),
                    "value": round(price, 2),
                    "change": chg,
                    "change_rate": chgr,
                }
                cache.set(f"idx:{name}", entry, 60)
                ok += 1
        except Exception:
            pass

    log.info(f"미국 지수 {ok}/{len(US_INDICES)}개 갱신")
    return ok


async def refresh_us_stocks():
    """YF 배치 fetch(volume/market_cap 포함) → Finnhub으로 인기종목 실시간 보강"""
    from app.services.finnhub_service import finnhub_service
    from app.services.yf_service import SP500_SYMBOLS
    from app.core.config import settings
    import yfinance as yf

    all_syms = list(dict.fromkeys(POPULAR_US + SP500_SYMBOLS))
    BATCH = 100  # YF 요청당 최대 종목 수

    # YF 배치 fetch: 전체 종목 volume + market_cap + name
    ok_yf = 0
    for i in range(0, len(all_syms), BATCH):
        batch = all_syms[i:i + BATCH]
        try:
            yf_data = await fetch_yf_quotes(batch)
            for sym in batch:
                q = yf_data.get(sym)
                if q and q.get("price"):
                    q["symbol"] = sym
                    cache.set(f"price:{sym}", q, 120)
                    ok_yf += 1
        except Exception as e:
            log.debug(f"YF 배치 fetch 실패: {e}")
        await asyncio.sleep(0.5)  # 배치 간 간격
    log.info(f"미국 종목(YF) {ok_yf}/{len(all_syms)}개 갱신")

    # market_cap=0인 인기종목은 배치 재조회 (sequential fast_info보다 훨씬 빠름)
    needs_mc = [s for s in POPULAR_US
                if not (cache.get(f"price:{s}") or {}).get("market_cap")]
    if needs_mc:
        try:
            retry_data = await fetch_yf_quotes(needs_mc)
            for sym, q in retry_data.items():
                existing = cache.get(f"price:{sym}") or cache.get_stale(f"price:{sym}") or {}
                if q.get("market_cap") or q.get("volume"):
                    merged = {**existing, **{k: v for k, v in q.items() if v}}
                    cache.set(f"price:{sym}", merged, 120)
            log.info(f"미국 인기종목 market_cap 배치 재조회 {len(retry_data)}개")
        except Exception:
            pass

    # Finnhub: POPULAR_US 병렬 보강 (직렬 0.5초×20 → 병렬 1회)
    if settings.FINNHUB_API_KEY:
        loop = asyncio.get_running_loop()

        async def _fh_one(sym: str):
            try:
                q = await asyncio.wait_for(loop.run_in_executor(None, finnhub_service.get_quote, sym), timeout=8)
                if q and q.get("price"):
                    existing = cache.get(f"price:{sym}") or {}
                    merged = {**existing, **q, "symbol": sym}
                    for field in ("volume", "market_cap", "name"):
                        if existing.get(field):
                            merged[field] = existing[field]
                    cache.set(f"price:{sym}", merged, 60)
                    return True
            except Exception:
                pass
            return False
        results = await asyncio.gather(*[_fh_one(s) for s in POPULAR_US], return_exceptions=True)
        ok_fh = sum(1 for r in results if r is True)
        log.info(f"미국 종목(Finnhub 병렬 보강) {ok_fh}/{len(POPULAR_US)}개")

    return ok_yf


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


async def refresh_held_symbols():
    """포트폴리오·관심종목으로 등록된 모든 보유종목 시세 선제 캐싱.
    POPULAR_US/POPULAR_KR_CODES 목록 밖의 종목(특히 비인기 코스피/코스닥 종목)은
    이 함수 없이는 페이지 진입 시 캐시 미스로 매번 외부 API를 직접 호출해야 했다."""
    from app.db.database import SessionLocal
    from app.models.stock import PortfolioItem, WatchlistItem

    db = SessionLocal()
    try:
        rows = set(db.query(PortfolioItem.symbol, PortfolioItem.market).all())
        rows |= set(db.query(WatchlistItem.symbol, WatchlistItem.market).all())
    finally:
        db.close()

    kr_codes = {sym.replace(".KS", "").replace(".KQ", "") for sym, mkt in rows if mkt == "KR"}
    us_syms = {sym for sym, mkt in rows if mkt != "KR"}

    if kr_codes:
        naver_data = await fetch_naver_stocks(list(kr_codes))
        for code6, q in naver_data.items():
            cache.set(f"price:{code6}", q, 60)
            cache.set(f"price:{code6}.KS", q, 60)
            cache.set(f"price:{code6}.KQ", q, 60)
        log.info(f"보유 국내종목 시세 선제 캐싱: {len(naver_data)}/{len(kr_codes)}개")

    if us_syms:
        us_list = list(us_syms)
        BATCH = 100
        ok = 0
        for i in range(0, len(us_list), BATCH):
            batch = us_list[i:i + BATCH]
            try:
                data = await fetch_yf_quotes(batch)
                for sym, q in data.items():
                    if q.get("price"):
                        cache.set(f"price:{sym}", q, 120)
                        ok += 1
            except Exception:
                pass
            await asyncio.sleep(0.3)
        log.info(f"보유 미국/ETF 종목 시세 선제 캐싱: {ok}/{len(us_list)}개")


async def refresh_exchange():
    """환율 갱신"""
    try:
        r = await get_usdkrw()
        if r and r.get("value", 0) > 0 and not r.get("_demo"):
            log.info(f"환율: {r['value']}원")
    except Exception as e:
        log.debug(f"환율 갱신 실패: {e}")


PREFETCH_INDEX_OHLCV = ["SP500", "NASDAQ", "DOW", "KOSPI", "KOSDAQ"]


async def _prefetch_ohlcv_popular():
    """인기 지수 + 종목 OHLCV 선제 캐싱 (startup 후 백그라운드)"""
    from app.services.yf_service import yf_service
    loop = asyncio.get_running_loop()
    ok = 0

    # 1) 인기 지수 OHLCV (max 기간)
    for name in PREFETCH_INDEX_OHLCV:
        for period in ("max", "5y"):
            ck = f"idx_ohlcv:{name}:{period}:1d"
            if cache.get(ck):
                continue
            try:
                result = await asyncio.wait_for(
                    loop.run_in_executor(None, yf_service.get_index_ohlcv, name, period, "1d"),
                    timeout=30
                )
                if result:
                    ok += 1
            except Exception:
                pass
            await asyncio.sleep(0.5)

    # 2) 인기 미국 종목 OHLCV (5년)
    for sym in POPULAR_US[:8]:
        ck = f"ohlcv:US:{sym}:max:1d"
        if cache.get(ck) or cache.get(f"ohlcv:US:{sym}:5y:1d"):
            continue
        try:
            result = await asyncio.wait_for(
                loop.run_in_executor(None, yf_service.get_ohlcv, sym, "max", "1d", "US"),
                timeout=20
            )
            if result:
                ok += 1
        except Exception:
            pass
        await asyncio.sleep(0.3)

    # 3) 인기 국내 종목 OHLCV
    for code6 in POPULAR_KR_CODES[:5]:
        sym = f"{code6}.KS"
        ck = f"ohlcv:KR:{sym}:max:1d"
        if cache.get(ck) or cache.get(f"ohlcv:KR:{sym}:5y:1d"):
            continue
        try:
            result = await asyncio.wait_for(
                loop.run_in_executor(None, yf_service.get_ohlcv, sym, "max", "1d", "KR"),
                timeout=20
            )
            if result:
                ok += 1
        except Exception:
            pass
        await asyncio.sleep(0.3)

    log.info(f"OHLCV 선제 캐싱 {ok}개")


async def _prefetch_fundamentals_popular():
    """서버 시작 시 인기 종목 펀더멘털·재무제표 DB 선제 갱신 (DB에 없는 종목만)"""
    from app.services.fundamentals_service import batch_refresh, get_all_fund_symbols
    popular = [(sym, "US") for sym in POPULAR_US] + [(f"{code}.KS", "KR") for code in POPULAR_KR_CODES]
    cached = set(get_all_fund_symbols())
    missing = [(s, m) for s, m in popular if (s, m) not in cached]
    if missing:
        log.info(f"인기 종목 초기 펀더멘털 갱신: {len(missing)}개")
        await batch_refresh(missing)

    # 서버 재시작 직후에도 퀀트 점수 상대평가가 바로 동작하도록 초기 분포 구축
    from app.services.quant_percentile_service import rebuild_all_distributions
    try:
        await rebuild_all_distributions()
    except Exception as e:
        log.warning(f"퀀트 percentile 초기 분포 구축 실패: {e}")


async def refresh_fundamentals_daily():
    """포트폴리오·관심종목·인기종목 펀더멘털 & 재무제표 일괄 갱신"""
    from app.services.fundamentals_service import batch_refresh, get_all_fund_symbols
    from app.db.database import SessionLocal
    from app.models.stock import PortfolioItem, WatchlistItem

    symbols_set: set[tuple[str, str]] = set()

    # 1) 이미 DB에 캐시된 종목 (이전에 조회됐던 모든 종목)
    for sym, mkt in get_all_fund_symbols():
        symbols_set.add((sym, mkt))

    # 2) 포트폴리오·관심종목 (로그인 사용자 데이터)
    db = SessionLocal()
    try:
        for sym, mkt in db.query(PortfolioItem.symbol, PortfolioItem.market).all():
            symbols_set.add((sym, mkt))
        for sym, mkt in db.query(WatchlistItem.symbol, WatchlistItem.market).all():
            symbols_set.add((sym, mkt))
    except Exception:
        pass
    finally:
        db.close()

    # 3) 인기 종목 (항상 최신 유지)
    for sym in POPULAR_US:
        symbols_set.add((sym, "US"))
    for code in POPULAR_KR_CODES:
        symbols_set.add((f"{code}.KS", "KR"))

    log.info(f"일일 펀더멘털·재무제표 갱신 시작 — {len(symbols_set)}개 종목")
    await batch_refresh(list(symbols_set))

    # 펀더멘털이 최신화된 직후 — 퀀트 점수 상대평가용 시장별 백분위 분포도 함께 재계산
    from app.services.quant_percentile_service import rebuild_all_distributions
    try:
        await rebuild_all_distributions()
    except Exception as e:
        log.warning(f"퀀트 percentile 분포 갱신 실패: {e}")


async def run_startup_prefetch():
    log.info("=== 초기 프리페치 시작 ===")

    loop = asyncio.get_running_loop()
    from app.services.news_service import get_kr_news, get_us_news
    from app.services.ranking_service import refresh_kr_rankings_from_naver

    from app.services.market_extras import get_kr_rates, get_us_rates
    # 지수 + 환율 + 금리 + 랭킹 + 국내/해외 뉴스 동시 갱신
    await asyncio.gather(
        refresh_kr_indices(),
        refresh_us_indices(),
        refresh_exchange(),
        refresh_kr_rankings_from_naver(),
        loop.run_in_executor(None, get_kr_news),
        loop.run_in_executor(None, get_us_news),
        loop.run_in_executor(None, get_kr_rates),
        loop.run_in_executor(None, get_us_rates),
        return_exceptions=True,
    )
    # 종목 갱신 (후순위)
    await asyncio.gather(
        refresh_us_stocks(),
        refresh_kr_stocks(),
        refresh_held_symbols(),
        return_exceptions=True,
    )
    # OHLCV 선제 캐싱 (후후순위 — 백그라운드)
    asyncio.create_task(_prefetch_ohlcv_popular())
    # 인기 종목 펀더멘털·재무제표 초기 갱신 (후후순위 — 백그라운드)
    asyncio.create_task(_prefetch_fundamentals_popular())
    log.info("=== 초기 프리페치 완료 ===")


async def periodic_refresh():
    """30초마다 국내 지수, 60초마다 미국 지수 + 환율 + 순위, 5분마다 종목 + 뉴스, 24시간마다 펀더멘털 DB 갱신"""
    from app.services.ranking_service import refresh_kr_rankings_from_naver
    counter = 0
    _last_fund_refresh = datetime.utcnow()

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

        # 미국 환율·금리·국채 (5분)
        if counter % 30 == 0:
            from app.services.market_extras import get_us_rates
            loop2 = asyncio.get_running_loop()
            await loop2.run_in_executor(None, get_us_rates)

        # 종목 + 뉴스 (5분)
        if counter % 30 == 0:
            from app.services.news_service import get_kr_news, get_us_news
            loop = asyncio.get_running_loop()
            await asyncio.gather(
                refresh_us_stocks(),
                refresh_kr_stocks(),
                refresh_held_symbols(),
                loop.run_in_executor(None, get_kr_news),
                loop.run_in_executor(None, get_us_news),
                return_exceptions=True,
            )

        # 트렌드·사용 통계 DB flush (5분)
        if counter % 30 == 0:
            try:
                from app.core.trends import flush_to_db
                loop3 = asyncio.get_running_loop()
                await loop3.run_in_executor(None, flush_to_db)
            except Exception:
                pass

        # 순위 (60초) - Naver 실시간
        if counter % 6 == 0:
            await refresh_kr_rankings_from_naver()

        # 펀더멘털·재무제표 DB 갱신 (24시간 주기, 백그라운드)
        now = datetime.utcnow()
        if (now - _last_fund_refresh).total_seconds() >= 86400:
            _last_fund_refresh = now
            asyncio.create_task(refresh_fundamentals_daily())
            log.info("일일 펀더멘털·재무제표 DB 갱신 작업 시작")


def start_background_tasks(app):
    @app.on_event("startup")
    async def startup():
        # init_ticker_db는 main.py _startup에서 이미 호출됨 — 여기서는 제거
        loop = asyncio.get_running_loop()
        loop.create_task(run_startup_prefetch())
        loop.create_task(periodic_refresh())
        log.info("스케줄러 시작됨")
