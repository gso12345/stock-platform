"""
백그라운드 데이터 갱신 스케줄러
- 한국: 네이버 금융 Polling API
- 미국: Yahoo Finance v7 멀티쿼트
"""
import asyncio
import logging
import os
import time
from datetime import datetime
from app.core.cache import cache
from app.services.price_fetcher import (
    fetch_naver_indices, fetch_naver_stocks, fetch_naver_exchange,
    fetch_naver_prices_light,
    fetch_yf_quotes, fetch_yf_quotes_with_fallback, fetch_yf_index_quotes, fetch_pykrx_index,
)
from app.services import market_hours, watched
from app.core import memory, activity, health
from app.core.config import settings

log = logging.getLogger(__name__)

# 큰 인스턴스에서만 켜는 선제 캐싱 (기본 끔 — 무료 플랜 메모리 한도 때문)
HEAVY_PREFETCH = os.getenv("ENABLE_HEAVY_PREFETCH", "").lower() in ("1", "true", "yes")

# 마지막 요청이 이 시간을 넘으면 주기 갱신을 멈춘다.
# 값을 미리 받아둬 봐야 아무도 안 보고, 그 사이 CPU만 쓴다.
IDLE_PAUSE_SEC = int(os.getenv("IDLE_PAUSE_SEC", 600))

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
    if ok:
        health.record_ok("국내 지수", None, f"{ok}/{len(KR_INDICES)}개")
    else:
        health.record_fail("국내 지수", "전부 실패")
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

    if ok:
        health.record_ok("미국 지수", None, f"{ok}/{len(US_INDICES)}개")
    else:
        health.record_fail("미국 지수", "전부 실패")
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
                    cache.set(f"price:{sym}", merged, 360)
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
        cache.set(f"price:{sym_ks}", q, 360)
        cache.set(f"price:{code6}", q, 360)
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
            cache.set(f"price:{code6}", q, 360)
            cache.set(f"price:{code6}.KS", q, 360)
            cache.set(f"price:{code6}.KQ", q, 360)
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


# ── 지금 보고 있는 종목만 빠르게 갱신 ──────────────────────
#
# 예전에는 모든 사용자의 보유·관심종목을 5분마다 통째로 갱신했다. 그래서
# WebSocket이 30초마다 값을 밀어도 실제 숫자는 5분에 한 번만 바뀌었다
# (같은 값이 10~14번 반복 전송됐다).
#
# 지금은 WebSocket이 열려 있는 종목 = 누군가 화면에서 보고 있는 종목만
# 갱신한다. 대상이 수십 개로 줄어드는 대신 주기를 장중 15초까지 당길 수 있다.
# 아무도 안 보고 있으면 아무것도 하지 않는다.

_WATCH_TTL_MULTIPLIER = 3   # TTL = 주기 × 3 (한두 번 실패해도 만료되지 않게)


async def _refresh_watched_once() -> tuple[int, int]:
    """보고 있는 종목을 한 번 갱신하고 (성공, 시도) 를 돌려준다"""
    pairs = watched.snapshot()
    if not pairs:
        return 0, 0

    kr_codes = sorted({s.replace(".KS", "").replace(".KQ", "") for s, m in pairs if m == "KR"})
    us_syms  = sorted({s for s, m in pairs if m != "KR"})

    # 국내는 종목당 1요청, 미국은 배치 1회로 끝나므로 국내 종목 수가 비용을 좌우한다
    interval = market_hours.refresh_interval(
        ([market_hours.kr_session()] if kr_codes else []) +
        ([market_hours.us_session()] if us_syms else []),
        symbol_count=len(kr_codes),
    )
    ttl = max(60, interval * _WATCH_TTL_MULTIPLIER)
    ok = 0

    if kr_codes:
        try:
            _t = time.monotonic()
            data = await fetch_naver_prices_light(kr_codes)
            if data:
                health.record_ok("네이버 시세", (time.monotonic() - _t) * 1000, f"{len(data)}/{len(kr_codes)}종목")
            else:
                health.record_fail("네이버 시세", f"{len(kr_codes)}종목 모두 실패")
            for code6, q in data.items():
                # 가격만 새로 받았으므로 기존 값(시가총액·PER 등) 위에 덮어쓴다
                for key in (code6, f"{code6}.KS", f"{code6}.KQ"):
                    prev = cache.get_stale(f"price:{key}") or {}
                    cache.set(f"price:{key}", {**prev, **q, "symbol": prev.get("symbol") or q["symbol"]}, ttl)
                ok += 1
            if len(data) < len(kr_codes):
                log.warning(f"실시간 국내 시세 일부 실패: {len(data)}/{len(kr_codes)}")
        except Exception as e:
            health.record_fail("네이버 시세", f"{type(e).__name__}: {e}")
            log.warning(f"실시간 국내 시세 갱신 실패: {type(e).__name__}: {e}")

    if us_syms:
        try:
            _t = time.monotonic()
            # 배치가 막혀도 단건 폴백으로 메운다.
            #
            # 예전에는 여기서 배치만 썼다. 배치가 야후 인증 때문에 100% 실패하는
            # 동안, 화면(REST)은 폴백 덕에 멀쩡했지만 이 루프는 해외 종목 캐시를
            # 못 채웠다. 그래서 해외는 실시간(15초) 갱신 없이 60초 REST 에만
            # 의존했다 — 국내보다 눈에 띄게 느렸고, 아무도 그 이유를 몰랐다.
            data, filled = await fetch_yf_quotes_with_fallback(us_syms)
            _ms = (time.monotonic() - _t) * 1000
            if data and not filled:
                health.record_ok("야후 시세", _ms, f"{len(data)}/{len(us_syms)}종목")
            elif data:
                # 폴백이 받쳐준 상태 — 사용자에게는 영향이 없으므로 실패로 세지
                # 않는다. 붉은 경고가 계속 떠 있으면 진짜 문제가 묻힌다
                health.record_ok("야후 시세", _ms,
                                 f"{len(data)}/{len(us_syms)}종목 · 배치 막혀 단건 폴백 {filled}개")
            else:
                health.record_fail("야후 시세", f"{len(us_syms)}종목 응답 없음 — 배치·단건 모두 실패")
            if not data:
                # 예전에는 여기서 조용히 넘어가 몇 시간 된 값이 계속 나갔다
                log.warning(f"실시간 해외 시세 응답 없음 ({len(us_syms)}종목) — 배치·단건 모두 실패")
            for sym, q in data.items():
                if not q.get("price"):
                    continue
                prev = cache.get_stale(f"price:{sym}") or {}
                cache.set(f"price:{sym}", {**prev, **{k: v for k, v in q.items() if v is not None}}, ttl)
                ok += 1
        except Exception as e:
            health.record_fail("야후 시세", f"{type(e).__name__}: {e}")
            log.warning(f"실시간 해외 시세 갱신 실패: {type(e).__name__}: {e}")

    return ok, len(kr_codes) + len(us_syms)


async def refresh_watched_loop():
    """보고 있는 종목 전용 루프.

    periodic_refresh 안에 두지 않는 이유: 그 루프는 작업을 순서대로 await 해서
    한 사이클이 5.5~7분까지 늘어난다. 여기 얹으면 '15초 주기'가 이름뿐이 된다.
    벽시계 기준으로 다음 틱을 맞춰 작업 시간이 주기에 누적되지 않게 한다."""
    log.info("실시간 시세 루프 시작")
    while True:
        started = time.monotonic()
        pairs = watched.snapshot()
        kr_n = sum(1 for _, m in pairs if m == "KR")
        interval = market_hours.refresh_interval(
            [market_hours.kr_session(), market_hours.us_session()], symbol_count=kr_n
        )
        try:
            t0 = time.monotonic()
            ok, total = await _refresh_watched_once()
            if total:
                health.record_ok("실시간 시세", (time.monotonic() - t0) * 1000, f"{ok}/{total}종목")
        except Exception as e:
            health.record_fail("실시간 시세", f"{type(e).__name__}: {e}")
            log.warning(f"실시간 시세 루프 오류: {type(e).__name__}: {e}")
        elapsed = time.monotonic() - started
        await asyncio.sleep(max(1.0, interval - elapsed))


async def refresh_exchange():
    """환율 갱신 — 원달러·원유로·원엔 모두 us_rates 배치(yfinance history)로 통일"""
    try:
        loop = asyncio.get_running_loop()
        from app.services.market_extras import _do_fetch_us_rates
        await loop.run_in_executor(None, _do_fetch_us_rates)
        from app.core.cache import cache as _cache
        for ck, sym in [("extra:usdkrw", "USD"), ("extra:eurkrw", "EUR"), ("extra:jpykrw", "JPY")]:
            v = _cache.get(ck)
            if v and v.get("value", 0) > 0:
                log.info(f"{sym}/KRW: {v['value']} ({v.get('change', 0):+.2f})")
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
    # 종목 갱신 (후순위) — 장이 열려 있을 때만.
    # 전 사용자 보유종목 선제 캐싱(refresh_held_symbols)은 뺐다. 시작 시점엔
    # 아무도 보고 있지 않고, 누군가 화면을 열면 refresh_watched_loop 가
    # 15초 안에 그 종목을 가져온다.
    startup_jobs = []
    if market_hours.us_session() != "closed":
        startup_jobs.append(refresh_us_stocks())
    if market_hours.kr_session() != "closed":
        startup_jobs.append(refresh_kr_stocks())
    if startup_jobs:
        await asyncio.gather(*startup_jobs, return_exceptions=True)
    # OHLCV·펀더멘털 선제 캐싱은 '미리 받아두면 빠르다'는 최적화일 뿐인데
    # 메모리를 가장 많이 먹는다. 지수·종목 23개 시계열이 약 200MB이고,
    # Render 무료 플랜(512MB)에서는 이것만으로 프로세스가 강제 재시작된다.
    # 사용자가 차트를 열 때 받아도 되므로 기본값은 끔. 큰 인스턴스에서만 켠다.
    if HEAVY_PREFETCH:
        _spawn(_prefetch_ohlcv_popular(), "prefetch-ohlcv")
        _spawn(_prefetch_fundamentals_popular(), "prefetch-fundamentals")
    else:
        log.info("무거운 선제 캐싱(OHLCV·펀더멘털) 비활성 — ENABLE_HEAVY_PREFETCH=1 로 켤 수 있음")
    log.info("=== 초기 프리페치 완료 ===")


async def periodic_refresh():
    """30초마다 국내 지수, 60초마다 미국 지수 + 환율 + 순위, 5분마다 종목 + 뉴스, 24시간마다 펀더멘털 DB 갱신"""
    from app.services.ranking_service import refresh_kr_rankings_from_naver
    counter = 0
    _last_fund_refresh = datetime.utcnow()

    while True:
        await asyncio.sleep(10)
        counter += 1

        # RSS 표본 (5분) — 순간값만으로는 '오르는 중'과 '평탄'을 구분할 수 없다.
        #
        # 아래 idle 가드보다 위에, 무거운 작업보다 앞에 둔다. 아래에 두면
        # 두 가지가 어긋난다 — 사람이 안 들어오는 동안에는 표본이 아예
        # 안 남고(누수는 오히려 그때 봐야 한다), 뉴스·전종목 갱신이 오래
        # 걸리면 '5분마다'가 실제로는 10분도 15분도 된다.
        # 비용은 /proc 한 줄 읽기이고 5분에 한 번뿐이라 사실상 공짜다.
        if counter % 30 == 0:
            memory.record_sample()

        # 아무도 안 쓰는 동안에는 갱신할 이유가 없다. Render 무료 플랜은
        # CPU가 0.1개뿐이라, 백그라운드가 계속 도는 것만으로 사용자가 실제로
        # 요청했을 때 응답이 밀린다. 마지막 요청이 오래됐으면 통째로 쉰다.
        # (다시 접속하면 첫 요청이 touch_request 로 깨운다)
        if activity.seconds_since_last_request() > IDLE_PAUSE_SEC:
            continue

        # 국내 지수 (장중 30초 / 휴장 10분)
        if counter % (3 if market_hours.kr_session() != "closed" else 60) == 0:
            await refresh_kr_indices()

        # 미국 지수 (장중 60초 / 휴장 10분)
        if counter % (6 if market_hours.us_session() != "closed" else 60) == 0:
            await refresh_us_indices()

        # 환율 (60초)
        if counter % 6 == 0:
            await refresh_exchange()

        # 한국 금리 — 기준금리·CD금리·국고채 (3분)
        if counter % 18 == 0:
            from app.services.market_extras import _do_fetch_kr_rates
            loop2 = asyncio.get_running_loop()
            await loop2.run_in_executor(None, _do_fetch_kr_rates)

        # 미국 환율·금리·국채 (5분)
        if counter % 30 == 0:
            from app.services.market_extras import get_us_rates
            loop2 = asyncio.get_running_loop()
            await loop2.run_in_executor(None, get_us_rates)

        # 종목 + 뉴스 (5분)
        if counter % 30 == 0:
            from app.services.news_service import get_kr_news, get_us_news
            loop = asyncio.get_running_loop()
            # SP500 전 종목 갱신은 응답 파싱 중 메모리가 크게 튄다.
            # 여유가 없으면 이번 사이클은 건너뛴다 — 캐시가 조금 묵는 것과
            # 프로세스가 강제 재시작되는 것은 비교할 문제가 아니다.
            # refresh_held_symbols 는 여기서 뺐다 — refresh_watched_loop 가
            # '지금 화면에서 보고 있는 종목'을 15초마다 이미 갱신한다. 전 사용자의
            # 보유·관심종목을 5분마다 또 긁는 것은 순수한 중복이고, Render 무료
            # 플랜(CPU 0.1개)에서는 그 낭비가 곧바로 응답 지연으로 나타난다.
            jobs = [loop.run_in_executor(None, get_kr_news),
                    loop.run_in_executor(None, get_us_news)]
            if market_hours.kr_session() != "closed":
                jobs.append(refresh_kr_stocks())
            if market_hours.us_session() != "closed" and memory.has_headroom("미국 전종목 갱신"):
                jobs.append(refresh_us_stocks())
            await asyncio.gather(*jobs, return_exceptions=True)

        # 국내 종목 목록 (1시간마다 확인 — 실제 갱신은 DB가 묵었을 때만)
        #
        # 예전에는 서버가 시작할 때 딱 한 번만 확인했다. Render 무료 플랜은
        # 재시작이 잦아 실질적으로는 하루에 몇 번씩 갱신됐지만, 서버가 오래
        # 떠 있으면 신규 상장이 안 들어오고 상장폐지된 종목이 계속 남는다.
        #
        # 확인은 싸다 — DB 행의 갱신 시각만 보고, 12시간이 안 지났으면 아무
        # 것도 하지 않는다. 실제로 받아올 때도 httpx 요청 두 번뿐이다.
        if counter % 360 == 0:
            try:
                from app.services.ticker_service import (
                    refresh_kr_tickers_if_stale, refresh_us_tickers_if_stale,
                )
                loop4 = asyncio.get_running_loop()
                await loop4.run_in_executor(None, refresh_kr_tickers_if_stale)
                # 미국 목록도 같은 방식이다 — 묵었을 때만 실제로 받아온다.
                # 하루에 한 번꼴이고, 받아올 때도 평문 파일 두 개뿐이다.
                await loop4.run_in_executor(None, refresh_us_tickers_if_stale)
            except Exception as e:
                log.warning(f"종목 목록 주기 갱신 실패: {type(e).__name__}: {e}")

        # 트렌드·사용 통계 DB flush (5분)
        if counter % 30 == 0:
            try:
                from app.core.trends import flush_to_db
                loop3 = asyncio.get_running_loop()
                await loop3.run_in_executor(None, flush_to_db)
            except Exception:
                pass

        # 순위 (장중 60초 / 휴장 10분) - Naver 실시간
        #
        # 이 주기는 순위 캐시 수명(RANK_TTL)보다 짧아야 한다. 예전에는
        # 갱신 10분 / 캐시 60초라, 휴장 중 9분 동안 캐시가 비어 있었고 그
        # 사이 들어온 요청은 전부 전일 종가로 순위를 새로 만들었다.
        # 지금은 캐시가 15분이라 구멍이 없다 — 주기를 줄이는 대신 캐시를
        # 늘렸다. 0.15 CPU 에서 휴장 중에까지 자주 긁을 이유가 없다.
        if counter % (6 if market_hours.kr_session() != "closed" else 60) == 0:
            await refresh_kr_rankings_from_naver()

        # 펀더멘털·재무제표 DB 갱신 (24시간 주기, 백그라운드)
        now = datetime.utcnow()
        if (now - _last_fund_refresh).total_seconds() >= 86400:
            _last_fund_refresh = now
            if HEAVY_PREFETCH and memory.has_headroom("일일 펀더멘털 갱신"):
                _spawn(refresh_fundamentals_daily(), "fundamentals-daily")
                log.info("일일 펀더멘털·재무제표 DB 갱신 작업 시작")


# 실행 중인 백그라운드 태스크 참조.
# create_task 가 돌려준 Task 를 아무도 잡고 있지 않으면 가비지 컬렉션 대상이
# 되어 도중에 조용히 사라질 수 있다(파이썬 공식 문서의 경고). 실제로 시세
# 갱신 루프가 그렇게 사라져 실시간이 동작하지 않았다.
_tasks: set = set()


def _spawn(coro, name: str):
    task = asyncio.get_running_loop().create_task(coro, name=name)
    _tasks.add(task)
    task.add_done_callback(lambda t: (_tasks.discard(t), _on_task_done(t, name)))
    return task


def _on_task_done(task, name: str):
    """백그라운드 루프가 끝나면 반드시 흔적을 남긴다.

    예전에는 태스크가 예외로 죽어도 아무 로그가 없어, 시세가 갱신되지 않는데도
    서버는 정상으로 보였다."""
    if task.cancelled():
        log.warning(f"백그라운드 작업 취소됨: {name}")
        return
    exc = task.exception()
    if exc:
        log.error(f"백그라운드 작업 중단: {name}: {type(exc).__name__}: {exc}", exc_info=exc)
    else:
        log.warning(f"백그라운드 작업 종료: {name}")


def start_background_tasks(app=None):
    """백그라운드 루프를 띄운다. lifespan 안에서 호출된다.

    예전에는 여기서 `@app.on_event("startup")` 으로 핸들러를 '등록'했는데,
    이 함수 자체가 이미 lifespan 시작 단계에서 호출되기 때문에 그 시점엔
    startup 이벤트가 이미 진행 중이라 등록된 핸들러가 영영 실행되지 않았다.
    그래서 지수·환율을 제외한 모든 주기 갱신(종목 시세 포함)이 한 번도
    돌지 않았고, 시세는 처음 조회된 값에 그대로 멈춰 있었다.
    오류 없이 조용히 죽는 종류라 겉보기에는 정상으로 보였다."""
    _spawn(run_startup_prefetch(), "startup-prefetch")
    _spawn(periodic_refresh(), "periodic-refresh")
    _spawn(refresh_watched_loop(), "watched-prices")
    log.info("스케줄러 시작됨 — 백그라운드 루프 3개")
