"""공시와 뉴스.

원래 stocks.py 한 파일에 있던 것을 탭 단위로 가른 조각이다.
공용 폴백·시한 처리는 _공용 에 있다.
"""
from ._공용 import (   # noqa: F401  — 쪼개기 전과 같은 이름을 쓴다
    APIRouter, Path, Query, HTTPException, Request, Depends, Literal,
    asyncio, logging, re, log, QMETRICS_TTL, _퀀트갱신중, _퀀트지표_뒤로미루기, Session,
    kis_service, finnhub_service, dart_service, yf_service,
    _resolve_kr_symbol, get_demo_price, get_demo_ohlcv, DEMO_PRICES,
    get_fdr_price, get_kr_db, compute_quant_score, DEFAULT_WEIGHTS, settings,
    cache, _safe_float, get_current_user, require_user, get_db,
    QuantScoreWeight, limiter, router_새로, _SYMBOL_PATTERN, _run, _시한내결과,
    get_kr_price, get_us_price,
)

router = router_새로()

@router.get("/{market}/{symbol}/disclosures")
async def get_disclosures(market: Literal["KR","US","ETF"], symbol: str = Path(..., pattern=_SYMBOL_PATTERN)):
    """국내 공시 목록 (OpenDART)
    최초 호출 시 전체 기업코드 매핑 파일(corpCode.xml, 수 MB)을 내려받아야 해서
    일반 API보다 오래 걸릴 수 있다 — 공용 _run(15초)이 아닌 넉넉한 타임아웃 사용.
    """
    if market != "KR" or not settings.DART_API_KEY:
        return []
    loop = asyncio.get_running_loop()
    try:
        return await asyncio.wait_for(
            loop.run_in_executor(None, dart_service.get_disclosures, symbol), timeout=45
        )
    except Exception:
        return []


# 법인 접미사 (종목명 끝부분) — 해외 종합피드 매칭용 검색어 추출 시 제거
_CORP_SUFFIX_RE = re.compile(r"\s+(Inc\.?|Corporation|Corp\.?|Co\.?|Company|Platforms|Holdings|Group|plc|Trust|ETF|N\.V\.|Ltd\.?|\.com)\s*$", re.I)
# 종목명만으로는 검색어가 모호한 해외 종목 — 직접 지정
_US_NAME_OVERRIDES = {
    "AMD": "AMD", "V": "Visa", "JPM": "JPMorgan", "AMZN": "Amazon",
    "GOOGL": "Alphabet", "GOOG": "Alphabet",
}
# 해외 뉴스가 국내 언론사 기사(한글)로 대체됨에 따라, 한글 기사 제목 매칭을 위한 주요 종목 한글명
_US_NAME_KO = {
    "AAPL": "애플", "TSLA": "테슬라", "MSFT": "마이크로소프트", "GOOGL": "알파벳", "GOOG": "알파벳",
    "AMZN": "아마존", "NVDA": "엔비디아", "META": "메타", "NFLX": "넷플릭스", "INTC": "인텔",
    "QCOM": "퀄컴", "BA": "보잉", "DIS": "디즈니", "JPM": "JP모건", "V": "비자", "MA": "마스터카드",
    "PYPL": "페이팔", "ORCL": "오라클", "CRM": "세일즈포스", "ADBE": "어도비", "PFE": "화이자",
    "JNJ": "존슨앤드존슨", "KO": "코카콜라", "PEP": "펩시코", "WMT": "월마트", "XOM": "엑손모빌",
    "CVX": "셰브론", "BAC": "뱅크오브아메리카", "GS": "골드만삭스", "UBER": "우버", "SBUX": "스타벅스",
    "NKE": "나이키", "MCD": "맥도날드",
}


def _us_search_terms(symbol: str, name: str | None) -> list[str]:
    """해외 종합피드에서 이 종목을 언급한 기사를 찾기 위한 검색어 목록"""
    terms = []
    ko = _US_NAME_KO.get(symbol)
    if ko:
        terms.append(ko)
    override = _US_NAME_OVERRIDES.get(symbol)
    if override:
        terms.append(override)
    elif name:
        base = _CORP_SUFFIX_RE.sub("", name).strip()
        first = base.split()[0] if base.split() else ""
        if len(first) >= 3:
            terms.append(first)
    if len(symbol) >= 3:
        terms.append(symbol)
    return list(dict.fromkeys(terms))


def _to_kst_published(value, short_mmdd: bool = False) -> str:
    """다양한 형식의 발행시각을 'YYYY/MM/DD HH:MM' (KST) 문자열로 정규화"""
    from datetime import datetime, timezone, timedelta
    KST = timezone(timedelta(hours=9))
    try:
        if short_mmdd:
            # 종합피드의 'MM/DD HH:MM' (연도 없음) → 현재 연도 기준 보완
            now_kst = datetime.now(KST)
            month = int(str(value)[:2])
            year = now_kst.year if month <= now_kst.month else now_kst.year - 1
            return f"{year}/{value}"
        if isinstance(value, (int, float)) and value:
            dt = datetime.fromtimestamp(value, tz=timezone.utc)
            return dt.astimezone(KST).strftime("%Y/%m/%d %H:%M")
        if isinstance(value, str) and value:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(KST).strftime("%Y/%m/%d %H:%M")
    except Exception:
        pass
    return value if isinstance(value, str) else ""


def _merge_news(primary: list, secondary: list, limit: int = 120,
                최소: int = 8) -> list:
    """종합피드(이미지 보장, 다양한 언론사)를 앞에 두고 종목별 검색으로 보강.

    이미지 없는 기사는 뒤로 미룬다.
      · 종합피드(primary)는 썸네일이 함께 온다
      · 구글 뉴스(secondary)는 RSS 에 썸네일이 거의 없다
    그대로 이어 붙이면 목록 뒷쪽이 통째로 회색 신문 아이콘이 된다 — 국내
    종목에서 특히 그랬다.

    다만 아예 버리지는 않는다. 종합피드에 그 종목 기사가 적으면 걸러내는
    순간 '뉴스가 없습니다' 가 되기 때문이다. 그림 있는 것으로 먼저 채우고,
    그래도 최소 건수에 못 미치면 나머지로 채운다.
    """
    seen, 그림있음, 그림없음 = set(), [], []
    for item in (*primary, *secondary):
        link = item.get("link")
        if not link or link in seen:
            continue
        seen.add(link)
        (그림있음 if item.get("image") else 그림없음).append(item)

    result = 그림있음[:limit]
    if len(result) < 최소:
        result += 그림없음[: 최소 - len(result)]
    return result[:limit]


def _sort_and_clean_news(items: list, sort: str) -> list:
    """정렬한 뒤 내부 계산 필드를 뺀 응답을 만든다"""
    from app.services.news_service import strip_internal_fields
    ordered = sorted(
        items or [],
        key=(lambda a: a.get("_trend_score", 0)) if sort == "popular"
            else (lambda a: a.get("published_ts") or ""),
        reverse=True,
    )
    return strip_internal_fields(ordered)


@router.get("/{market}/{symbol}/news")
@limiter.limit("10/minute")
async def get_stock_news(
    request: Request,
    market: Literal["KR","US","ETF"],
    symbol: str = Path(..., pattern=_SYMBOL_PATTERN),
    sort: str = Query(default="latest", pattern="^(latest|popular)$"),
):
    """종목 관련 뉴스 — 종합 RSS 피드(다양한 언론사 + 이미지 보장) + 종목별 검색(KR: 구글뉴스, US: yfinance) 병합

    정렬은 서버가 한다 — 인기도 점수는 내부 계산값이라 응답에 싣지 않는다
    (뉴스 탭·대시보드와 동일한 방식)
    """
    from app.core.cache import cache
    ck = f"stock_news:{market}:{symbol}"
    if c := cache.get(ck):
        return _sort_and_clean_news(c, sort)

    from app.services.news_service import _extract_thumbnail, _add_trending_score, get_kr_news, get_us_news, _safe_url
    code6 = symbol.replace(".KS","").replace(".KQ","")

    if market == "KR":
        # 종목명 조회 — 데모 데이터 → 가격 캐시(실제 한글명) → 코드 순
        demo = DEMO_PRICES.get(symbol) or DEMO_PRICES.get(code6+".KS")
        stock_name = demo.get("name") if demo else None
        if not stock_name:
            cached_price = cache.get(f"price:{symbol}") or cache.get_stale(f"price:{symbol}")
            stock_name = (cached_price or {}).get("name")
        if not stock_name or stock_name == symbol:
            stock_name = code6

        def _fetch_kr():
            import feedparser
            from datetime import timezone, timedelta, datetime
            KST = timezone(timedelta(hours=9))
            items = []
            import urllib.parse
            query = urllib.parse.quote(stock_name)
            google_rss = f"https://news.google.com/rss/search?q={query}+주식+주가&hl=ko&gl=KR&ceid=KR:ko"
            feed = feedparser.parse(google_rss)
            entries_sorted = sorted(
                (e for e in (feed.entries or []) if e.get("published_parsed")),
                key=lambda e: e.published_parsed,
                reverse=True,
            )[:120]
            for entry in entries_sorted:
                pub = ""
                pub_ts = ""
                try:
                    if entry.get("published_parsed"):
                        utc_dt = datetime(*entry.published_parsed[:6], tzinfo=timezone.utc)
                        pub = utc_dt.astimezone(KST).strftime("%Y/%m/%d %H:%M")
                        pub_ts = utc_dt.isoformat()
                except Exception:
                    pass
                title = entry.get("title", "").strip()
                if not title:
                    continue
                # 외부 RSS가 주는 주소는 그대로 쓰지 않는다 — javascript: 같은
                # 실행 가능한 스킴이 섞이면 기사를 누르는 순간 우리 사이트 권한으로
                # 실행된다 (뉴스 탭과 동일한 검증)
                link = _safe_url(entry.get("link"))
                if not link:
                    continue
                image = _safe_url(_extract_thumbnail(entry))
                source = (entry.get("source") or {}).get("title", "")
                items.append({
                    "title": title,
                    "link": link,
                    "source": source,
                    "published": pub,
                    "published_ts": pub_ts,
                    "summary": (entry.get("summary") or "")[:200],
                    "image": image,
                })
            return items

        def _match_feed_kr():
            matched = [
                dict(a) for a in get_kr_news()
                if stock_name in a.get("title", "") or stock_name in a.get("summary", "")
            ]
            for a in matched:
                a["published"] = _to_kst_published(a.get("published", ""), short_mmdd=True)
            return matched

        google_items, feed_items = await asyncio.gather(_run(_fetch_kr), _run(_match_feed_kr), return_exceptions=True)
        if isinstance(google_items, Exception):
            google_items = []
        if isinstance(feed_items, Exception):
            feed_items = []
        result = _merge_news(feed_items, google_items)

    else:
        # 해외 종합피드에서 이 종목 관련 기사 매칭 (ETF 포함)
        demo = DEMO_PRICES.get(symbol)
        name = demo.get("name") if demo else None
        if not name:
            cached_price = cache.get(f"price:{symbol}") or cache.get_stale(f"price:{symbol}")
            name = (cached_price or {}).get("name")
        search_terms = _us_search_terms(symbol, name)
        # 해외 뉴스가 이제 국내 언론사 한글 기사이므로, 한글 검색어는 단순 포함 여부로,
        # 영문 심볼/회사명은 단어 경계 매칭으로 판별
        _korean_re = re.compile(r"[가-힣]")
        patterns = [
            (t, True) if _korean_re.search(t) else (re.compile(rf"\b{re.escape(t)}\b", re.I), False)
            for t in search_terms
        ]

        def _match_feed_us():
            if not patterns:
                return []
            def _hit(title: str) -> bool:
                for matcher, is_korean in patterns:
                    if is_korean:
                        if matcher in title:
                            return True
                    elif matcher.search(title):
                        return True
                return False
            matched = [
                dict(a) for a in get_us_news()
                if _hit(a.get("title", "")) or _hit(a.get("summary", ""))
            ]
            for a in matched:
                a["published"] = _to_kst_published(a.get("published", ""), short_mmdd=True)
            return matched

        # US: yfinance 뉴스
        import yfinance as yf
        def _fetch_us():
            try:
                ticker = yf.Ticker(symbol)
                items = []
                for n in (ticker.news or [])[:50]:
                    ct = n.get("content", {})
                    title = ct.get("title") or n.get("title", "")
                    link  = (ct.get("canonicalUrl") or {}).get("url") or n.get("link", "")
                    pub   = ct.get("pubDate") or n.get("providerPublishTime", "")
                    provider = (ct.get("provider") or {}).get("displayName") or n.get("publisher", "")
                    if not title:
                        continue
                    thumb = ct.get("thumbnail") or n.get("thumbnail") or {}
                    resolutions = thumb.get("resolutions") or []
                    image = resolutions[0].get("url") if resolutions else thumb.get("originalUrl")
                    items.append({"title": title, "link": link, "source": provider, "published": _to_kst_published(pub), "summary": (ct.get("summary") or "")[:200], "image": image})
                return items
            except Exception:
                return []

        yf_items, feed_items = await asyncio.gather(_run(_fetch_us), _run(_match_feed_us), return_exceptions=True)
        if isinstance(yf_items, Exception):
            yf_items = []
        if isinstance(feed_items, Exception):
            feed_items = []
        result = _merge_news(feed_items, yf_items)

    # 인기순 정렬에 쓰는 점수 — 캐시에는 남기고 응답에서만 제거한다
    if result:
        result = _add_trending_score(result)

    cache.set(ck, result, 300)
    return _sort_and_clean_news(result, sort)
