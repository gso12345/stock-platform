"""
대시보드 라우트
- 국내: KIS API (지수 + 랭킹) → demo 폴백
- 해외: Finnhub/yfinance (지수) → demo 폴백
"""
from fastapi import APIRouter, Path, Query, HTTPException
import asyncio
import logging
from app.services.kis_service import kis_service
from app.services.finnhub_service import finnhub_service
from app.services.yf_service import yf_service, INDEX_SYMBOLS, INDEX_NAMES
from app.services.news_service import get_kr_news, get_us_news, pick_top_image_first, strip_internal_fields
from app.services.ranking_service import get_us_rankings
from app.services.market_extras import get_kr_futures, get_kr_rates, get_us_rates
from app.services.price_fetcher import get_usdkrw, get_eurkrw, fetch_pykrx_index_ohlcv
from app.core.config import settings
from app.core.cache import cache

from app.services.ranking_service import CATEGORY_PATTERN, US_MIN_ROWS

log = logging.getLogger(__name__)

router = APIRouter(prefix="/dashboard", tags=["대시보드"])

_bg_refresh_in_flight: set[str] = set()

KR_INDICES = ["KOSPI", "KOSDAQ", "KOSPI200", "KOSPI100"]
US_INDICES = ["SP500", "NASDAQ", "DOW", "SOX", "RUSSELL"]

KIS_INDEX_CODES = {
    "KOSPI":    ("0001", "코스피"),
    "KOSDAQ":   ("1001", "코스닥"),
    "KOSPI200": ("2001", "코스피 200"),
}


async def _run(fn, *args):
    loop = asyncio.get_running_loop()
    return await asyncio.wait_for(loop.run_in_executor(None, fn, *args), timeout=15)


#: 지수 하나를 KIS 에서 실시간으로 받아 올 때 기다릴 최대 시간.
#:
#: 상한이 없었다. KIS 는 이 화면에서 '더 신선한 값' 을 얻으려고 부르는
#: 곳이지 없으면 안 되는 곳이 아니다(바로 아래 캐시가 30초짜리 값을
#: 들고 있다). 그런데 상한이 없어서, KIS 가 늦는 날에는 그 대안이
#: 있는데도 대시보드가 통째로 그만큼 멈췄다.
_KIS_지수_상한 = 3


# ── 국내 지수 조회 ─────────────────────────────────────────
async def _get_kr_index(name: str) -> dict:
    # 1. KIS API (실시간)
    if settings.KIS_APP_KEY and name in KIS_INDEX_CODES:
        code, display = KIS_INDEX_CODES[name]
        try:
            r = await asyncio.wait_for(
                kis_service.get_index(code, name, display), timeout=_KIS_지수_상한
            )
            if r and r.get("value", 0) > 0:
                return r
        except Exception:
            pass
    # 2. 신선한 캐시 (스케줄러가 채운 yfinance 값)
    fresh = cache.get(f"idx:{name}")
    if fresh and fresh.get("value", 0) > 0:
        return fresh
    # 3. stale 캐시
    stale = cache.get_stale(f"idx:{name}")
    if stale and stale.get("value", 0) > 0:
        return stale
    return {"index": name, "name": INDEX_NAMES.get(name, name), "value": 0, "change": 0, "change_rate": 0}


async def _refresh_indices_bg():
    """백그라운드 지수 전체 갱신 (non-blocking)"""
    from app.services.scheduler import refresh_kr_indices, refresh_us_indices
    try:
        await asyncio.gather(refresh_kr_indices(), refresh_us_indices(), return_exceptions=True)
    except Exception:
        pass


# ── 해외 지수 조회 ─────────────────────────────────────────
async def _get_us_index(name: str) -> dict:
    fresh = cache.get(f"idx:{name}")
    if fresh and fresh.get("value", 0) > 0:
        return fresh
    stale = cache.get_stale(f"idx:{name}")
    if "us_index" not in _bg_refresh_in_flight:
        _bg_refresh_in_flight.add("us_index")
        async def _guarded_us_refresh():
            try:
                await _refresh_indices_bg()
            finally:
                _bg_refresh_in_flight.discard("us_index")
        asyncio.get_running_loop().create_task(_guarded_us_refresh())
    if stale and stale.get("value", 0) > 0:
        return stale
    return {"index": name, "name": INDEX_NAMES.get(name, name), "value": 0, "change": 0, "change_rate": 0}


async def _get_kr_index_with_fallback(name: str) -> dict:
    result = await _get_kr_index(name)  # KIS + fresh + stale 캐시 확인
    if result.get("value", 0) > 0:
        return result
    if "kr_index" not in _bg_refresh_in_flight:
        _bg_refresh_in_flight.add("kr_index")
        async def _guarded_kr_refresh():
            try:
                await _refresh_indices_bg()
            finally:
                _bg_refresh_in_flight.discard("kr_index")
        asyncio.get_running_loop().create_task(_guarded_kr_refresh())
    return result


# ── 전체 지수 ──────────────────────────────────────────────
@router.get("/indices")
async def get_all_indices():
    all_names = KR_INDICES + US_INDICES
    tasks = [_get_kr_index_with_fallback(n) if n in KR_INDICES else _get_us_index(n) for n in all_names]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    kr = [r if not isinstance(r, Exception) else {"index": n, "value": 0, "change": 0, "change_rate": 0} for r, n in zip(results, all_names) if n in KR_INDICES]
    us = [r if not isinstance(r, Exception) else {"index": n, "value": 0, "change": 0, "change_rate": 0} for r, n in zip(results, all_names) if n in US_INDICES]
    return {"kr": kr, "us": us}


# ── 국내 대시보드 ──────────────────────────────────────────
#
# 순위표를 여기서 뺐다. 뉴스를 뺀 것과 같은 이유다 —
# 화면은 이 응답의 rankings 를 **한 군데서도 안 읽는다**. 순위 카드는
# /dashboard/rankings/kr 로 따로 받아서 기준(시가총액·거래량…)을 바꿀 수
# 있어야 하기 때문이다.
#
# 그래서 대시보드를 한 번 열 때마다 같은 순위표를 두 번 만들고 있었다.
# 캐시가 비어 있으면 두 번 다 전 종목을 훑는다. 게다가 만든 것을 응답에
# 실어 보내니 이 응답만 23KB 였다(순위표를 빼면 3KB 남짓이다) —
# 받아서 버리는 20KB 를 매번 싱가포르에서 한국까지 나른 셈이다.
#
# category 도 같이 뺐다. 이 라우트에서 그 값이 쓰이던 곳이 순위표뿐이라,
# 남겨 두면 아무 일도 안 하는 값을 계속 받게 된다.
@router.get("/kr")
async def get_kr_dashboard(include_news: bool = Query(default=False)):
    loop = asyncio.get_running_loop()
    tasks = [
        asyncio.gather(*[_get_kr_index_with_fallback(n) for n in KR_INDICES]),
        # 환율에만 상한이 없었다. 나머지 넷은 전부 wait_for 가 걸려 있는데
        # 이것만 없어서, 환율 하나가 늦으면 화면 전체가 그만큼 멈췄다
        # (실측 12초). 안쪽에서도 막지만 여기서도 한 번 더 조인다
        asyncio.wait_for(_get_exchange_rate_async(), timeout=5),
        asyncio.wait_for(loop.run_in_executor(None, get_kr_rates), timeout=5),
        asyncio.wait_for(get_kr_futures(), timeout=5),
    ]
    if include_news:
        tasks.append(asyncio.wait_for(loop.run_in_executor(None, get_kr_news), timeout=8))
        results = await asyncio.gather(*tasks, return_exceptions=True)
        idx_results, exchange, rates, futures, news = results
        if isinstance(news, BaseException):
            news = cache.get_stale("news:kr") or []
    else:
        results = await asyncio.gather(*tasks, return_exceptions=True)
        idx_results, exchange, rates, futures = results
        # include_news=False 인데도 캐시에서 꺼내 최대 80건을 실어 보냈다.
        # 화면은 이 필드를 안 쓰고 /dashboard/news/kr 로 따로 받는다 — 매 갱신마다
        # 기사 80건을 만들어 보내고 버리는 셈이었다
        news = []
    # 타임아웃 등 오류 시 stale/빈 값으로 대체
    if isinstance(rates,   Exception): rates   = cache.get_stale("extra:kr_rates") or []
    if isinstance(futures, Exception): futures = cache.get_stale("extra:kr_futures") or []
    return {
        "indices":  idx_results,
        "kospi":    idx_results[0],
        "kosdaq":   idx_results[1],
        # 화면은 /dashboard/rankings/kr 로 따로 받는다. 자리는 남겨 둔다 —
        # 배포가 엇갈려 옛 화면이 이 응답을 받을 때 없는 칸을 읽으면 터진다
        "rankings": [],
        "news":     pick_top_image_first(news, 80) if news else [],
        "exchange": exchange,
        "futures":  futures,
        "rates":    rates,
        "_has_kis": bool(settings.KIS_APP_KEY),
    }


async def _refresh_kr_ranking_bg(category: str):
    """백그라운드 KR 랭킹 갱신 (stale-while-revalidate)"""
    from app.services.ranking_service import fetch_naver_rank, RANK_TTL
    try:
        rows = await fetch_naver_rank(category)
        if rows:
            for i, r in enumerate(rows):
                r["rank"] = i + 1
            cache.set(f"rank:kr:{category}", rows, RANK_TTL)
    except Exception:
        pass


#: 순위표를 만드느라 화면을 붙잡아 둘 수 있는 최대 시간.
#:
#: 여기에는 상한이 아예 없었다. KIS 가 늦으면 늦는 만큼, 캐시가 비어
#: FDR 로 전 종목을 훑으면 훑는 만큼 화면이 멈췄다. 순위표는 '있으면
#: 좋은' 카드지, 그것 하나 때문에 대시보드가 통째로 멈출 값이 아니다.
#: 상한을 넘기면 있는 것으로 답하고 나머지는 배경에서 채운다.
_RANK_상한 = 6


async def _get_kr_rankings(category: str) -> list:
    from app.services.ranking_service import get_kr_rankings

    # 신선한 캐시가 있으면 그걸로 끝낸다.
    #
    # 예전에는 KIS 를 **먼저** 불렀다. 키가 설정돼 있으면 캐시가 아무리
    # 신선해도 매 요청마다 외부 왕복이 한 번씩 붙었다는 뜻이다.
    cached = cache.get(f"rank:kr:{category}")
    if cached:
        return cached

    if settings.KIS_APP_KEY:
        try:
            result = await asyncio.wait_for(kis_service.get_rankings(category), timeout=_RANK_상한)
            if result:
                return result
        except Exception:
            pass

    # stale 캐시 → 즉시 반환 + 백그라운드 갱신
    stale = cache.get_stale(f"rank:kr:{category}")
    _rank_key = f"kr_rankings:{category}"
    if _rank_key not in _bg_refresh_in_flight:
        _bg_refresh_in_flight.add(_rank_key)
        async def _guarded_kr_ranking_bg():
            try:
                await _refresh_kr_ranking_bg(category)
            finally:
                _bg_refresh_in_flight.discard(_rank_key)
        asyncio.get_running_loop().create_task(_guarded_kr_ranking_bg())
    if stale:
        return stale

    # FDR 기반 랭킹 — 캐시 미스 시 전체 종목을 순회/정렬하므로 이벤트 루프 블로킹 방지를 위해 executor로 실행.
    # 상한을 넘기면 빈 목록으로 답한다. 바로 위에서 배경 갱신을 이미
    # 걸어 뒀으므로, 다음 요청 때는 캐시에서 곧바로 나온다.
    loop = asyncio.get_running_loop()
    try:
        return await asyncio.wait_for(
            loop.run_in_executor(None, get_kr_rankings, category), timeout=_RANK_상한
        ) or []
    except Exception:
        return []


# ── 해외 대시보드 ──────────────────────────────────────────
# 순위표는 /dashboard/rankings/us 로 따로 받는다. 국내 쪽과 같은 이유다 —
# 화면이 이 응답의 rankings 를 안 읽는데 매번 만들어 실어 보내고 있었다.
@router.get("/us")
async def get_us_dashboard(include_news: bool = Query(default=False)):
    loop = asyncio.get_running_loop()
    tasks = [
        asyncio.gather(*[_get_us_index(n) for n in US_INDICES]),
        asyncio.wait_for(_get_exchange_rate_async(), timeout=5),
        asyncio.wait_for(loop.run_in_executor(None, get_us_rates), timeout=5),
    ]
    if include_news:
        tasks.append(asyncio.wait_for(loop.run_in_executor(None, get_us_news), timeout=8))

    gathered = await asyncio.gather(*tasks, return_exceptions=True)
    idx_results     = gathered[0] if not isinstance(gathered[0], Exception) else []
    exchange        = gathered[1] if not isinstance(gathered[1], Exception) else {}
    us_rates_cached = gathered[2] if not isinstance(gathered[2], Exception) else (cache.get_stale("extra:us_rates") or [])
    # KR 과 같은 이유로, 요청하지 않았으면 뉴스를 싣지 않는다.
    # 화면은 /dashboard/news/us 로 따로 받는다
    news = gathered[3] if (include_news and not isinstance(gathered[3], Exception)) else []
    if include_news and isinstance(gathered[3], BaseException):
        news = cache.get_stale("news:us") or []

    idx_map = {r["index"]: r for r in idx_results if isinstance(r, dict)}
    return {
        "indices":  idx_results,
        "sp500":    idx_map.get("SP500"),
        "nasdaq":   idx_map.get("NASDAQ"),
        "dow":      idx_map.get("DOW"),
        "sox":      idx_map.get("SOX"),
        "russell":  idx_map.get("RUSSELL"),
        "exchange": exchange,
        "rates":    us_rates_cached,
        # 옛 화면이 받아도 안 터지도록 칸만 남긴다 (국내 쪽 주석 참고)
        "rankings": [],
        "news":     news[:80] if news else [],
    }


@router.get("/us/rates")
async def us_rates():
    """미국 환율·금리·국채 — 원/달러, 연방금리, 2Y/10Y/30Y 국채, VIX"""
    loop = asyncio.get_running_loop()
    cached = cache.get("extra:us_rates") or cache.get_stale("extra:us_rates")
    if cached:
        return cached
    try:
        result = await asyncio.wait_for(loop.run_in_executor(None, get_us_rates), timeout=5)
    except Exception:
        # 받아 오는 일은 배경에서 계속 돈다. 여기서 더 기다리면 화면이 멈춘다
        return cache.get_stale("extra:us_rates") or []
    return result or []


async def _get_exchange_rate_async() -> dict:
    return await get_usdkrw()


async def _get_us_rankings_cached(category: str) -> list:
    """미국 순위.

    화면에 다섯 종목만 나오던 자리다. 예전에는 모자랄 때 인기종목 20개만
    더 받았는데, 그래 봐야 20위까지밖에 안 된다. 전종목(335개)을 받아
    순위표를 다시 만든다 — 시간이 걸리므로 배경으로 돌리고, 이번 요청은
    있는 것으로 답한다."""
    # 캐시 미스 시 전체 종목을 순회/정렬하므로 이벤트 루프 블로킹 방지를 위해 executor로 실행.
    # 국내 쪽과 같은 이유로 상한을 둔다 — 순위표 하나가 화면을 멈춰 세우면 안 된다
    loop = asyncio.get_running_loop()
    try:
        result = await asyncio.wait_for(
            loop.run_in_executor(None, get_us_rankings, category), timeout=_RANK_상한
        ) or []
    except Exception:
        result = []
    if len(result) < US_MIN_ROWS:
        # 블로킹 없이 백그라운드에서 갱신 — cold start 시 즉시 반환.
        # 겹침 방지는 refresh_us_rows 안에서 한다
        async def _bg_us_refresh():
            try:
                from app.services.ranking_service import refresh_us_rows
                await refresh_us_rows()
            except Exception as e:
                log.warning("미국 순위 배경 갱신 실패: %s", type(e).__name__)
        asyncio.get_running_loop().create_task(_bg_us_refresh())
    return result


# ── 랭킹 ───────────────────────────────────────────────────
@router.get("/rankings/kr")
async def kr_rankings(category: str = Query(default="시가총액", pattern=CATEGORY_PATTERN)):
    return await _get_kr_rankings(category)


@router.get("/rankings/us")
async def us_rankings(category: str = Query(default="시가총액", pattern=CATEGORY_PATTERN)):
    return await _get_us_rankings_cached(category)


# ── 뉴스 ───────────────────────────────────────────────────
NEWS_TAB_LIMIT = 100

#: 기사를 모으느라 화면을 붙잡아 둘 수 있는 최대 시간.
#:
#: 상한이 없었다. RSS 를 여덟 곳 도는 일이라 늦을 때는 한참 늦는데,
#: 그동안 뉴스 탭은 아무 말 없이 멈춰 있었다. shield 로 감싸는 이유는
#: 상한을 넘겨도 **수집 자체는 계속 돌게** 하기 위해서다 — 여기서
#: 취소해 버리면 다음 요청도, 그다음 요청도 똑같이 처음부터 돈다.
_뉴스_상한 = 8


async def _news_tab(market: str, sort: str, images_only: bool) -> list:
    """뉴스 탭 응답을 만든다.

    정렬을 서버에서 처리하는 이유: 인기도 점수(_trend_score)는 내부 계산값이라
    화면에 내보내지 않는다. 예전에는 이 값을 그대로 응답에 실어 보내 프론트가
    정렬했는데, 산식이 노출될 뿐 아니라 쓰이지도 않는 필드가 매 응답에 붙었다.

    이미지 필터도 서버에서 한다. 예전에는 100건을 보낸 뒤 프론트가 이미지 없는
    기사를 걸러내서, 국내 탭은 실제로 40~60건만 보였다. 받아놓고 버린 셈이라
    아예 조건에 맞는 기사로만 100건을 채워 보낸다.
    """
    ck = f"news:{market}"
    cached = cache.get(ck) or cache.get_stale(ck)
    if cached is None:
        # 여기에 상한이 없었다. 캐시가 비면 RSS 여덟 곳을 다 돌 때까지
        # 화면이 기다린다 — 그 시간이 곧 '뉴스 탭이 안 뜬다' 였다.
        # 상한을 넘기면 빈 목록으로 답하고, 수집은 배경에서 마저 돈다.
        # (5분마다 도는 갱신이 채워 두므로 다음 번에는 캐시에서 나온다)
        loop = asyncio.get_running_loop()
        fetch = get_kr_news if market == "kr" else get_us_news
        받아오기 = loop.run_in_executor(None, fetch)
        try:
            cached = await asyncio.wait_for(asyncio.shield(받아오기), timeout=_뉴스_상한)
        except Exception:
            cached = cache.get_stale(ck) or []

    articles = list(cached or [])
    if images_only:
        """사진 있는 기사만 남긴다. 부탁받은 그대로다.

        중간에 '100건에 모자라면 사진 없는 기사를 뒤에 붙인다' 로 바꿔 본
        적이 있다. 목록이 짧아지는 게 아까웠는데, 그건 부탁을 고쳐 읽은
        것이었다 — 그래서 "이미지 안 나오는 기사가 있다" 는 말을 다시
        들었다. 몇 건이 남든 사진 있는 것만 남긴다.

        단 하나, 사진 있는 기사가 아예 없을 때는 필터를 접는다. 빈 화면은
        고장으로 보이고, 그때는 '사진 있는 기사만' 보다 '기사를 보여 주기'
        가 먼저다."""
        있는것 = [a for a in articles if a.get("image")]
        if 있는것:
            articles = 있는것
        else:
            log.info("사진 있는 기사가 하나도 없어 필터를 건너뜁니다 (%s)", market)

    def _key(a):
        if sort == "popular":
            return a.get("_trend_score", 0)
        return a.get("_ts") or a.get("published_ts") or 0

    if images_only:
        chosen = sorted(articles, key=_key, reverse=True)[:NEWS_TAB_LIMIT]
    else:
        # 어떤 기사를 보여줄지 고를 때는 이미지 있는 쪽을 우선하되(글만 있는 목록은
        # 보기 나빠서), 고른 뒤에는 사용자가 선택한 정렬을 그대로 따른다.
        # 예전에는 이미지 우선 배치가 정렬을 덮어써서, "최신순"을 눌러도 오래된
        # 이미지 기사가 최신 텍스트 기사보다 위에 오는 일이 있었다.
        chosen = pick_top_image_first(sorted(articles, key=_key, reverse=True), NEWS_TAB_LIMIT)
        chosen = sorted(chosen, key=_key, reverse=True)
    return strip_internal_fields(chosen)


@router.get("/news/kr")
async def kr_news(
    sort: str = Query(default="latest", pattern="^(latest|popular)$"),
    images_only: bool = Query(default=True),
):
    return await _news_tab("kr", sort, images_only)


@router.get("/news/us")
async def us_news(
    sort: str = Query(default="latest", pattern="^(latest|popular)$"),
    images_only: bool = Query(default=True),
):
    """해외 뉴스도 이미지 있는 것만.

    국내는 진작 True 였는데 여기만 False 였다. 그래서 같은 화면의 두 탭이
    서로 다르게 보였다 — 국내는 사진이 붙은 카드가 늘어서고, 해외는
    글자만 있는 줄이 섞였다.

    기사가 모자랄 걱정은 접었다. 해외는 여덟 곳에서 500건 안팎을 받는데
    화면은 100건만 쓴다. 이미지 없는 것을 빼도 채우고 남는다 —
    아래 '기사가 확 줄면 되돌린다' 가 그걸 지킨다."""
    return await _news_tab("us", sort, images_only)


@router.get("/news/summary")
async def news_summary(market: str = Query(default="kr", pattern="^(kr|us)$")):
    """뉴스 헤드라인 AI 요약 (Anthropic API 키 설정 시에만 동작)"""
    if not settings.ANTHROPIC_API_KEY:
        return {"available": False, "summary": None}

    ck = f"news:summary:{market}"
    if c := cache.get(ck):
        return c

    loop = asyncio.get_running_loop()
    news = await loop.run_in_executor(None, get_kr_news if market == "kr" else get_us_news)
    if not news:
        return cache.get_stale(ck) or {"available": False, "summary": None}

    market_label = "국내" if market == "kr" else "미국"
    headlines = "\n".join(f"- {n['title']}" for n in news[:15] if n.get("title"))
    prompt = (
        f"다음은 오늘의 주요 {market_label} 증시 뉴스 헤드라인입니다. "
        "투자자가 주목할 만한 핵심 트렌드와 이슈를 3~5개의 간결한 한국어 불릿포인트로 요약해 주세요. "
        "불릿포인트(- 로 시작)만 출력하고 다른 설명은 추가하지 마세요.\n\n"
        f"{headlines}"
    )

    try:
        import anthropic
        client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        resp = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=500,
            messages=[{"role": "user", "content": prompt}],
        )
        summary = "".join(b.text for b in resp.content if b.type == "text").strip()
        result = {"available": True, "summary": summary}
        cache.set(ck, result, 1800)
        return result
    except Exception:
        return cache.get_stale(ck) or {"available": False, "summary": None}


@router.get("/exchange")
async def exchange_rate():
    return await get_usdkrw()

@router.get("/exchange/eur")
async def exchange_rate_eur():
    return await get_eurkrw()

@router.get("/kr/futures")
async def kr_futures():
    return await get_kr_futures()

@router.get("/kr/rates")
async def kr_rates():
    loop = asyncio.get_running_loop()
    try:
        return await asyncio.wait_for(loop.run_in_executor(None, get_kr_rates), timeout=5)
    except Exception:
        return cache.get_stale("extra:kr_rates") or []

@router.get("/kr/extras")
async def kr_extras():
    """선물 + 환율 + 금리 통합"""
    loop = asyncio.get_running_loop()
    exchange, rates, futures = await asyncio.gather(
        asyncio.wait_for(_get_exchange_rate_async(), timeout=5),
        asyncio.wait_for(loop.run_in_executor(None, get_kr_rates), timeout=5),
        asyncio.wait_for(get_kr_futures(), timeout=5),
        return_exceptions=True,
    )
    # 하나가 늦었다고 나머지까지 버리지 않는다. 셋을 한 번에 주려고 묶은
    # 화면이라, 통째로 실패하면 카드 세 개가 동시에 사라진다
    if isinstance(exchange, BaseException): exchange = cache.get_stale("extra:usdkrw") or {}
    if isinstance(rates,    BaseException): rates    = cache.get_stale("extra:kr_rates") or []
    if isinstance(futures,  BaseException): futures  = cache.get_stale("extra:kr_futures") or []
    return {"exchange": exchange, "rates": rates, "futures": futures}


# ── 지수 상세 ──────────────────────────────────────────────
#
# 지수 이름·기간·간격을 그대로 캐시 키에 쓴다. 검증이 없으면 아무 값이나
# 새 키가 되고, 인증 없이 부를 수 있으므로 캐시를 통째로 밀어낼 수 있다.
# 순위 카테고리에서 똑같은 일을 이미 겪었다 — 40번만 불러도 캐시가
# 4.3MB → 10.2MB 로 불었고, 500번이면 시세·차트·뉴스가 전부 밀려났다.
#
# 여기는 그때 안 고쳐진 자리다. 아는 값만 받는다.
_INDEX_PATTERN = "^(" + "|".join(KR_INDICES + US_INDICES) + ")$"

#: 야후가 받는 것만. 모르는 값을 넘기면 빈 결과가 오는데, 그 빈 결과가
#: 새 캐시 키로 자리를 차지한다.
_PERIOD_PATTERN = "^(1d|5d|1mo|3mo|6mo|1y|2y|5y|10y|ytd|max)$"
_INTERVAL_PATTERN = "^(1m|2m|5m|15m|30m|60m|90m|1h|1d|5d|1wk|1mo|3mo)$"


@router.get("/index/{name}")
async def get_index_detail(name: str = Path(..., pattern=_INDEX_PATTERN)):
    name_upper = name.upper()
    if name_upper in KR_INDICES:
        info = await _get_kr_index(name_upper)
    elif name_upper in US_INDICES:
        info = await _get_us_index(name_upper)
    else:
        raise HTTPException(status_code=404, detail="지원하지 않는 지수입니다")
    return {**info, "display_name": INDEX_NAMES.get(name_upper, name_upper)}


@router.get("/index/{name}/ohlcv")
async def get_index_ohlcv(
    name: str = Path(..., pattern=_INDEX_PATTERN),
    period: str = Query(default="1y", pattern=_PERIOD_PATTERN),
    interval: str = Query(default="1d", pattern=_INTERVAL_PATTERN),
):
    name_upper = name.upper()
    ck = f"idx_ohlcv:{name_upper}:{period}:{interval}"

    fresh = cache.get(ck)
    if fresh:
        return fresh

    loop = asyncio.get_running_loop()
    result = []
    try:
        result = await asyncio.wait_for(
            loop.run_in_executor(None, yf_service.get_index_ohlcv, name_upper, period, interval),
            timeout=25,
        )
    except Exception:
        result = []

    # 야후 심볼이 해당 지수를 지원하지 않는 경우 pykrx(KRX 공식 데이터)로 보완
    if not result and name_upper in KR_INDICES and interval == "1d":
        try:
            result = await asyncio.wait_for(
                loop.run_in_executor(None, fetch_pykrx_index_ohlcv, name_upper, period),
                timeout=20,
            )
            if result:
                cache.set(ck, result, 21600)
        except Exception:
            result = []

    if result:
        return result
    stale = cache.get_stale(ck)
    return stale or []


# ── top-movers (호환) ──────────────────────────────────────
@router.get("/top-movers")
async def get_top_movers():
    if settings.KIS_APP_KEY:
        risers, fallers = await asyncio.gather(
            kis_service.get_top_movers("rise"),
            kis_service.get_top_movers("fall"),
        )
        if risers or fallers:
            return {"risers": risers, "fallers": fallers}
    return {"risers": [], "fallers": []}
