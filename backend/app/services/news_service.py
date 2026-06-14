import feedparser
import threading
import re
import html as _html
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta
from app.core.cache import cache

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
]

# ── 해외 뉴스 RSS ──────────────────────────────────────────
US_FEEDS = [
    # 주요 경제·시장
    ("Reuters Business",   "https://feeds.reuters.com/reuters/businessNews"),
    ("Reuters Markets",    "https://feeds.reuters.com/reuters/companyNews"),
    ("Yahoo Finance",      "https://finance.yahoo.com/news/rssindex"),
    ("MarketWatch",        "https://feeds.content.dowjones.io/public/rss/mw_marketpulse"),
    ("CNBC Economy",       "https://www.cnbc.com/id/20910258/device/rss/rss.html"),
    ("CNBC Finance",       "https://www.cnbc.com/id/10000664/device/rss/rss.html"),
    ("Bloomberg Markets",  "https://feeds.bloomberg.com/markets/news.rss"),
    ("WSJ Markets",        "https://feeds.a.dj.com/rss/RSSMarketsMain.xml"),
    ("WSJ Economy",        "https://feeds.a.dj.com/rss/RSSWorldNews.xml"),
    # 투자·분석
    ("Seeking Alpha",      "https://seekingalpha.com/feed.xml"),
    ("Investing.com",      "https://www.investing.com/rss/news.rss"),
    ("The Street",         "https://www.thestreet.com/feeds/headline-stories.rss"),
    ("Forbes Business",    "https://www.forbes.com/feeds/news.rss"),
    ("FT Markets",         "https://www.ft.com/rss/home/us"),
    ("Barron's",           "https://www.barrons.com/xml/rss/3_7028.xml"),
]


# 경제/금융 뉴스 피드에서도 섞여 들어올 수 있는 비경제 키워드 — 포함 시 제외
_NONFINANCE_KW = {
    "야구","축구","농구","배구","골프","스포츠","연예","드라마","영화","음악","아이돌","배우",
    "요리","레시피","맛집","여행","패션","뷰티","헬스","운동","건강","날씨","사건","사고","범죄",
    "정치","국회","탄핵","선거","총선","대선","여야","원내대표","청문회",
    "부고","동정","인사발령","지진","화재","테러","참사","유튜브","웹툰",
}

# 비경제 키워드가 포함돼 있어도 아래 경제·증시 키워드가 함께 있으면 예외적으로 포함
# (예: "OOO 후보자, 청문회서 증시 부양책 언급" → "청문회"는 있지만 "증시"·"부양"이 있어 포함)
_FINANCE_OVERRIDE_KW = {
    "증시","주가","코스피","코스닥","나스닥","다우","증권","주식","금리","환율","채권",
    "부양","투자","펀드","상장","공시","실적","매출","영업이익","적자","흑자",
    "경제","금융","원화","달러","수출","수입","무역","관세","기준금리","한은","연준",
}

def _is_finance_news(title: str) -> bool:
    """제목이 경제/금융 관련인지 판단 (모든 피드가 경제 섹션이므로 비경제 키워드만 제외)"""
    if not any(kw in title for kw in _NONFINANCE_KW):
        return True
    return any(kw in title for kw in _FINANCE_OVERRIDE_KW)


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
        for entry in feed.entries[:max(limit * 6, 60)]:
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
    with ThreadPoolExecutor(max_workers=min(len(feeds), 24)) as executor:
        futures = {
            executor.submit(_parse_feed, url, source, limit_per_source): source
            for source, url in feeds
        }
        try:
            for future in as_completed(futures, timeout=20):
                try:
                    items = future.result(timeout=8)
                    all_news.extend(items)
                except Exception:
                    pass
        except Exception:
            pass
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


def _do_refresh_news(ck: str, feeds: list, limit_per_source: int, total_limit: int) -> list[dict]:
    all_news = _fetch_all_feeds(feeds, limit_per_source)
    if not all_news:
        return []
    _add_trending_score(all_news)
    # 실제 발행 시각(_ts) 기준 정렬 → 최신 일부는 시간순, 나머지는 언론사 다양성 확보를 위해 인터리브
    all_news.sort(key=lambda x: x.get("_ts", 0), reverse=True)
    top      = all_news[:6]     # 최신 6개는 시간순
    rest     = _interleave_by_source(all_news[6:])  # 나머지는 언론사별 균등 배치
    result   = (top + rest)[:total_limit]
    for a in result:
        a.pop("_ts", None)
    cache.set(ck, result, 300)
    _refreshing.pop(ck, None)
    return result


def get_kr_news(limit_per_source: int = 24, total_limit: int = 500) -> list[dict]:
    ck = "news:kr"
    if c := cache.get(ck):
        return c
    stale = cache.get_stale(ck)
    if stale and not _refreshing.get(ck):
        _refreshing[ck] = True
        threading.Thread(target=_do_refresh_news, args=(ck, KR_FEEDS, limit_per_source, total_limit), daemon=True).start()
        return stale
    return _do_refresh_news(ck, KR_FEEDS, limit_per_source, total_limit)


def get_us_news(limit_per_source: int = 20, total_limit: int = 300) -> list[dict]:
    ck = "news:us"
    if c := cache.get(ck):
        return c
    stale = cache.get_stale(ck)
    if stale and not _refreshing.get(ck):
        _refreshing[ck] = True
        threading.Thread(target=_do_refresh_news, args=(ck, US_FEEDS, limit_per_source, total_limit), daemon=True).start()
        return stale
    return _do_refresh_news(ck, US_FEEDS, limit_per_source, total_limit)
