import feedparser
import re
import html as _html
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta
from app.core.cache import cache
from app.core.executor import background_executor

_refreshing = {}  # 중복 갱신 방지 플래그

KST = timezone(timedelta(hours=9))

# ── 국내 뉴스 RSS ──────────────────────────────────────────
KR_FEEDS = [
    # 경제 전문지
    ("한국경제",       "https://www.hankyung.com/feed/economy"),
    ("한국경제TV",     "https://www.hankyungtv.com/rss/market"),
    ("매일경제",       "https://www.mk.co.kr/rss/40300001/"),
    ("서울경제",       "https://www.sedaily.com/RssData/"),
    ("이데일리",       "https://www.edaily.co.kr/rss/"),
    ("이데일리 증권",  "https://www.edaily.co.kr/rss/stockmarket"),
    ("파이낸셜뉴스",   "https://www.fnnews.com/rss/fn_economy_news.xml"),
    ("헤럴드경제",     "https://biz.heraldcorp.com/common/rss.php?ct=102"),
    ("아시아경제",     "https://www.asiae.co.kr/rss/economy.htm"),
    ("머니투데이",     "https://news.mt.co.kr/mtview.php?type=2&rss=1"),
    ("머니투데이 증권","https://news.mt.co.kr/mtview.php?type=4&rss=1"),
    ("비즈니스포스트", "https://www.businesspost.co.kr/BP?command=rss"),
    ("더벨",           "https://www.thebell.co.kr/free/content/RssAllNews.asp"),
    ("딜사이트",       "https://dealsite.co.kr/articles/rss"),
    ("인베스트조선",   "https://www.investchosun.com/site/data/rss/rss.xml"),
    # 종합지 경제섹션
    ("조선비즈",       "https://biz.chosun.com/arc/outboundfeeds/rss/?outputType=xml"),
    ("동아일보 경제",  "https://rss.donga.com/economy.xml"),
    ("중앙일보",       "https://rss.joins.com/joins_economy_list.xml"),
    ("국민일보 경제",  "https://rss.kmib.co.kr/data/kmibEcoRss.xml"),
    ("경향신문 경제",  "https://www.khan.co.kr/rss/rssdata/economy_news.xml"),
    ("한겨레 경제",    "https://www.hani.co.kr/rss/economy/"),
    ("문화일보 경제",  "https://www.munhwa.com/rss/economy.xml"),
    ("세계일보 경제",  "https://www.segye.com/newsList/RSS/economy.xml"),
    # 통신사
    ("연합뉴스",       "https://www.yna.co.kr/RSS/economy.xml"),
    ("연합뉴스 증권",  "https://www.yna.co.kr/RSS/stocks.xml"),
    ("뉴스1",          "https://www.news1.kr/rss/economic.xml"),
    ("뉴스1 증권",     "https://www.news1.kr/rss/stocks.xml"),
    ("연합인포맥스",   "https://news.einfomax.co.kr/rss/allNews.xml"),
    ("뉴시스",         "https://www.newsis.com/RSS/economy.xml"),
    ("뉴시스 증권",    "https://www.newsis.com/RSS/stock.xml"),
    # 방송
    ("KBS 경제",       "https://news.kbs.co.kr/rss/rss_economy.xml"),
    ("MBC 경제",       "https://imnews.imbc.com/rss/economy/index.xml"),
    ("SBS 경제",       "https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=02&plink=RSSREADER"),
    ("YTN 경제",       "https://www.ytn.co.kr/rss/0401.xml"),
    ("채널A 경제",     "https://www.ichannela.com/news/rss/newsprss_eco.xml"),
    # IT/산업 (반도체·전자 등 기술주 관련 보도 보강)
    ("전자신문",       "https://rss.etnews.com/Section901.xml"),
    ("디지털타임스",   "https://www.dt.co.kr/rss/economy.xml"),
]

# 해외(미국 등) 증시·경제 관련 뉴스는 더 이상 해외 언론사 RSS를 직접 수집하지 않고,
# 국내 언론사가 작성한 해외 관련 기사를 KR_FEEDS 결과에서 골라 사용한다 (get_us_news 참고).


# 경제/금융 뉴스 피드에서도 섞여 들어올 수 있는 비경제 키워드 — 포함 시 제외
_NONFINANCE_KW = {
    "야구","축구","농구","배구","골프","스포츠","연예","드라마","영화","음악","아이돌","배우",
    "요리","레시피","맛집","여행","패션","뷰티","헬스","운동","건강","날씨","사건","사고","범죄",
    "정치","국회","탄핵","선거","총선","대선","여야","원내대표","청문회",
    "부고","동정","인사발령","지진","화재","테러","참사","유튜브","웹툰",
}

def _is_finance_news(title: str) -> bool:
    """제목이 경제/증권/금융 관련인지 판단.
    피드 자체가 이미 경제/증권 섹션으로 큐레이션되어 있으므로, 화이트리스트
    매칭을 강제하지 않고 비경제 키워드(스포츠/연예/정치 등)만 걸러낸다.
    (화이트리스트를 강제하면 키워드와 무관한 정상 경제 기사까지 누락되는 문제가 있었음)
    """
    return not any(kw in title for kw in _NONFINANCE_KW)


# 해외(미국 등) 증시·경제 관련 키워드 — 국내 언론사 기사 중 해외 뉴스만 골라내기 위한 화이트리스트
_OVERSEAS_KW = {
    "나스닥", "다우", "다우존스", "S&P", "S&P500", "뉴욕증시", "뉴욕증권거래소", "미국증시", "미 증시",
    "유럽증시", "일본증시", "중국증시", "글로벌증시", "해외증시", "아시아증시",
    "연준", "Fed", "FOMC", "파월", "월가", "ECB", "BOJ", "유럽중앙은행", "옐런",
    "FTSE", "니케이", "항셍", "상하이종합", "엔비디아", "테슬라", "애플", "마이크로소프트",
    "아마존", "구글", "알파벳", "메타", "페이스북", "넷플릭스", "인텔", "퀄컴", "TSMC", "ARM",
    "국제유가", "WTI", "브렌트유", "국제금값", "글로벌", "해외", "미국 연준", "미 연준",
    "관세전쟁", "미중", "미국", "중국", "일본", "유럽", "美", "中", "日", "유로존",
}


def _is_overseas_news(title: str) -> bool:
    """국내 언론사 기사 중 해외(미국 등) 증시·경제 관련 기사인지 판단"""
    return any(kw in title for kw in _OVERSEAS_KW)


def _clean_text(raw: str) -> str:
    """HTML 태그 제거 + 엔티티 디코딩 + 공백 정리"""
    if not raw:
        return ""
    text = re.sub(r"<[^>]+>", " ", raw)
    text = _html.unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:150]


def _extract_thumbnail(entry) -> str | None:
    """RSS 항목에서 썸네일 이미지 URL 추출 (없으면 None)"""
    try:
        media_thumb = entry.get("media_thumbnail")
        if media_thumb:
            url = media_thumb[0].get("url")
            if url:
                return url

        media_content = entry.get("media_content")
        if media_content:
            for m in media_content:
                mtype = m.get("type") or m.get("medium") or ""
                if m.get("url") and "image" in mtype:
                    return m["url"]
            if media_content[0].get("url"):
                return media_content[0]["url"]

        for link in entry.get("links", []):
            if link.get("rel") == "enclosure" and "image" in (link.get("type") or ""):
                if link.get("href"):
                    return link["href"]

        html_blob = entry.get("summary", "") or ""
        for c in entry.get("content", []):
            html_blob += c.get("value", "") or ""
        m = re.search(r'<img[^>]+src=["\']([^"\']+)["\']', html_blob)
        if m:
            return m.group(1)
    except Exception:
        pass
    return None


def _parse_feed(url: str, source: str, limit: int = 8) -> list[dict]:
    try:
        feed  = feedparser.parse(url)
        items = []
        cutoff = datetime.now(timezone.utc) - timedelta(days=3)
        # 필터(경제 키워드/기간/이미지) 통과율이 낮을 수 있으므로 넉넉히 스캔
        for entry in feed.entries[:max(limit * 10, 100)]:
            title = entry.get("title", "").strip()
            if not title:
                continue
            if not _is_finance_news(title):
                continue

            parsed = entry.get("published_parsed") or entry.get("updated_parsed")
            if not parsed:
                continue
            try:
                dt = datetime(*parsed[:6], tzinfo=timezone.utc)
            except Exception:
                continue
            if dt < cutoff:
                continue

            image = _extract_thumbnail(entry)
            if not image:
                continue

            items.append({
                "title":     title,
                "link":      entry.get("link", ""),
                "source":    source,
                "published": dt.astimezone(KST).strftime("%m/%d %H:%M"),
                "summary":   _clean_text(entry.get("summary") or ""),
                "image":     image,
                "_ts":       dt.timestamp(),
            })
            if len(items) >= limit:
                break
        return items
    except Exception:
        return []


def _add_trending_score(articles: list) -> list:
    """제목 키워드 빈도로 인기도 점수 계산 (같은 주제 기사 많을수록 높음)"""
    import re
    from collections import Counter
    stopwords = {"이", "가", "의", "을", "를", "은", "는", "에", "서", "로", "도", "와", "과", "한", "된", "하고", "에서", "으로", "했다", "한다", "된다", "밝혀"}
    all_words = []
    for a in articles:
        words = [w for w in re.findall(r'[가-힣A-Za-z]{2,}', a.get("title","")) if w not in stopwords]
        all_words.extend(words)
    freq = Counter(all_words)
    # 극히 흔한 단어(top 3) 제외 후 점수 부여
    common = {w for w, _ in freq.most_common(3)}
    for a in articles:
        words = [w for w in re.findall(r'[가-힣A-Za-z]{2,}', a.get("title","")) if w not in stopwords and w not in common]
        a["_trend_score"] = sum(freq.get(w, 0) for w in words)
    return articles


def _fetch_all_feeds(feeds: list, limit_per_source: int) -> list[dict]:
    """피드 목록을 병렬로 fetch (ThreadPoolExecutor 사용)"""
    all_news = []
    executor = ThreadPoolExecutor(max_workers=min(len(feeds), 24))
    try:
        futures = {
            executor.submit(_parse_feed, url, source, limit_per_source): source
            for source, url in feeds
        }
        try:
            for future in as_completed(futures, timeout=10):
                try:
                    items = future.result(timeout=8)
                    all_news.extend(items)
                except Exception:
                    pass
        except Exception:
            pass
    finally:
        # wait=False: 응답 시한(10s)을 넘긴 느린 피드 스레드는 백그라운드에서
        # 마무리되도록 두고 즉시 반환 (with 블록은 모든 스레드 종료까지 대기해 타임아웃을 무력화함)
        executor.shutdown(wait=False)
    return all_news


def _interleave_by_source(articles: list) -> list:
    """소스별로 균등하게 섞어서 특정 언론사 독점 방지"""
    from collections import defaultdict
    by_src: dict = defaultdict(list)
    for a in articles:
        by_src[a["source"]].append(a)
    # 각 소스 내부는 최신순 정렬
    for src in by_src:
        by_src[src].sort(key=lambda x: x.get("_ts", 0), reverse=True)
    result = []
    sources = list(by_src.keys())
    while any(by_src[s] for s in sources):
        for s in sources:
            if by_src[s]:
                result.append(by_src[s].pop(0))
    return result


def _pick_diverse_top(sorted_news: list, count: int, per_source_cap: int) -> "tuple[list, list]":
    """시간순으로 상위 count개를 뽑되, 한 언론사가 너무 많이 차지하지 않도록 소스별 상한을 둠
    (특정 언론사가 발행 빈도가 높아 최신순 상단을 독점하는 것 방지)"""
    from collections import Counter
    top, remaining, used = [], [], Counter()
    for a in sorted_news:
        src = a["source"]
        if len(top) < count and used[src] < per_source_cap:
            top.append(a)
            used[src] += 1
        else:
            remaining.append(a)
    return top, remaining


def _do_refresh_news(ck: str, feeds: list, limit_per_source: int, total_limit: int) -> list[dict]:
    all_news = _fetch_all_feeds(feeds, limit_per_source)
    stale = cache.get_stale(ck)
    if not all_news:
        # 전체 피드 실패 시에도 _refreshing을 해제해야 다음 요청에서 재시도 가능
        _refreshing.pop(ck, None)
        return stale or []
    _add_trending_score(all_news)
    # 실제 발행 시각(_ts) 기준 정렬 → 최신 일부는 시간순(단, 언론사별 상한 적용), 나머지는 다양성 확보를 위해 인터리브
    all_news.sort(key=lambda x: x.get("_ts", 0), reverse=True)
    top, leftover = _pick_diverse_top(all_news, count=6, per_source_cap=1)
    rest     = _interleave_by_source(leftover)  # 나머지는 언론사별 균등 배치
    result   = (top + rest)[:total_limit]
    for a in result:
        a.pop("_ts", None)
    # 일부 피드 타임아웃으로 기사 수가 부족하면 이전 캐시 기사로 보충 (링크 기준 중복 제거, 최신 우선)
    if stale and len(result) < total_limit:
        seen = {a.get("link") for a in result if a.get("link")}
        for a in stale:
            if a.get("link") not in seen:
                result.append(a)
                seen.add(a.get("link"))
                if len(result) >= total_limit:
                    break
    cache.set(ck, result, 300)
    _refreshing.pop(ck, None)
    return result


def get_kr_news(limit_per_source: int = 40, total_limit: int = 800) -> list[dict]:
    ck = "news:kr"
    if c := cache.get(ck):
        return c
    stale = cache.get_stale(ck)
    if stale and not _refreshing.get(ck):
        _refreshing[ck] = True
        background_executor.submit(_do_refresh_news, ck, KR_FEEDS, limit_per_source, total_limit)
        return stale
    return _do_refresh_news(ck, KR_FEEDS, limit_per_source, total_limit)


def get_us_news(total_limit: int = 500) -> list[dict]:
    """해외(미국 등) 증시·경제 뉴스 — 해외 언론사 RSS 대신, 국내 언론사가 작성한
    해외 관련 기사를 KR 뉴스 결과에서 골라 사용 (다양한 국내 언론사가 고르게 노출됨)"""
    overseas = [a for a in get_kr_news() if _is_overseas_news(a.get("title", ""))]
    return overseas[:total_limit]
