import feedparser
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta
from app.core.cache import cache

_refreshing = {}  # 중복 갱신 방지 플래그

KST = timezone(timedelta(hours=9))


def _to_kst(parsed_time) -> str:
    """parsed_time(struct_time) → 한국 시간 문자열"""
    if not parsed_time:
        return ""
    try:
        # struct_time → UTC datetime → KST
        utc_dt = datetime(*parsed_time[:6], tzinfo=timezone.utc)
        kst_dt = utc_dt.astimezone(KST)
        return kst_dt.strftime("%m/%d %H:%M")
    except Exception:
        return ""

# ── 국내 뉴스 RSS ──────────────────────────────────────────
KR_FEEDS = [
    # 경제 전문지
    ("한국경제",     "https://www.hankyung.com/feed/economy"),
    ("한국경제TV",   "https://www.hankyungtv.com/rss/market"),
    ("매일경제",     "https://www.mk.co.kr/rss/40300001/"),
    ("서울경제",     "https://www.sedaily.com/RssData/"),
    ("이데일리",     "https://www.edaily.co.kr/rss/"),
    ("파이낸셜뉴스", "https://www.fnnews.com/rss/fn_economy_news.xml"),
    ("헤럴드경제",   "https://biz.heraldcorp.com/common/rss.php?ct=102"),
    ("아시아경제",   "https://www.asiae.co.kr/rss/economy.htm"),
    ("머니투데이",   "https://news.mt.co.kr/mtview.php?type=2&rss=1"),
    ("비즈니스포스트","https://www.businesspost.co.kr/BP?command=rss"),
    # 종합지 경제섹션
    ("조선비즈",     "https://biz.chosun.com/arc/outboundfeeds/rss/?outputType=xml"),
    ("중앙일보",     "https://rss.joins.com/joins_economy_list.xml"),
    ("연합뉴스",     "https://www.yna.co.kr/RSS/economy.xml"),
    ("뉴스1",        "https://www.news1.kr/rss/economic.xml"),
    # 통신/데이터
    ("연합인포맥스",  "https://news.einfomax.co.kr/rss/allNews.xml"),
    ("뉴시스",       "https://www.newsis.com/RSS/economy.xml"),
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


# 경제/금융 관련 키워드 (이 중 하나라도 포함되거나, 비경제 키워드가 없으면 통과)
_FINANCE_KW = {
    "주식","증시","코스피","코스닥","주가","상장","배당","실적","매출","영업이익","순이익","PER","PBR",
    "금리","기준금리","채권","환율","달러","원화","엔화","위안","물가","인플레","금융","은행","증권","펀드",
    "투자","외국인","기관","수급","ETF","선물","옵션","파생","자산","포트폴리오","매수","매도",
    "경제","GDP","성장률","수출","수입","무역","반도체","IT","기업","산업","제조","에너지","원자재",
    "부동산","리츠","부채","자본","M&A","IPO","공모","공시","재무","회계","연준","Fed","FOMC",
    "나스닥","다우","S&P","닛케이","상하이","항셍","ECB","BOJ","IMF","WB",
}
_NONFINANCE_KW = {
    "야구","축구","농구","배구","골프","스포츠","연예","드라마","영화","음악","아이돌","배우",
    "요리","레시피","맛집","여행","패션","뷰티","헬스","운동","건강","날씨","사건","사고","범죄",
}

def _is_finance_news(title: str) -> bool:
    """제목이 경제/금융 관련인지 판단"""
    import re
    # 비금융 키워드가 있으면 제외
    for kw in _NONFINANCE_KW:
        if kw in title:
            return False
    # 금융 키워드가 하나라도 있으면 포함
    for kw in _FINANCE_KW:
        if kw in title:
            return True
    # 영어 금융 패턴 (숫자+%, $, ₩ 포함 기사)
    if re.search(r'\d+\.?\d*%|[$₩€¥]|\bIPO\b|\bGDP\b|\bESG\b', title):
        return True
    return False


def _parse_feed(url: str, source: str, limit: int = 8) -> list[dict]:
    try:
        feed  = feedparser.parse(url)
        items = []
        for entry in feed.entries[:limit*3]:  # 더 많이 가져와서 필터 후 limit 맞춤
            pub = _to_kst(entry.get("published_parsed")) or _to_kst(entry.get("updated_parsed")) or ""
            title = entry.get("title", "").strip()
            if not title:
                continue
            if not _is_finance_news(title):
                continue
            items.append({
                "title":     title,
                "link":      entry.get("link", ""),
                "source":    source,
                "published": pub,
                "summary":   (entry.get("summary") or "")[:150],
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
    with ThreadPoolExecutor(max_workers=min(len(feeds), 16)) as executor:
        futures = {
            executor.submit(_parse_feed, url, source, limit_per_source): source
            for source, url in feeds
        }
        try:
            for future in as_completed(futures, timeout=12):
                try:
                    items = future.result(timeout=8)
                    all_news.extend(items)
                except Exception:
                    pass
        except Exception:
            pass
    return all_news


def _do_refresh_news(ck: str, feeds: list, limit_per_source: int, total_limit: int) -> list[dict]:
    all_news = _fetch_all_feeds(feeds, limit_per_source)
    if not all_news:
        return []
    all_news.sort(key=lambda x: x["published"], reverse=True)
    _add_trending_score(all_news)
    result = all_news[:total_limit]
    cache.set(ck, result, 300)
    _refreshing.pop(ck, None)
    return result


def get_kr_news(limit_per_source: int = 6, total_limit: int = 100) -> list[dict]:
    ck = "news:kr"
    if c := cache.get(ck):
        return c
    stale = cache.get_stale(ck)
    if stale and not _refreshing.get(ck):
        _refreshing[ck] = True
        threading.Thread(target=_do_refresh_news, args=(ck, KR_FEEDS, limit_per_source, total_limit), daemon=True).start()
        return stale
    return _do_refresh_news(ck, KR_FEEDS, limit_per_source, total_limit)


def get_us_news(limit_per_source: int = 6, total_limit: int = 100) -> list[dict]:
    ck = "news:us"
    if c := cache.get(ck):
        return c
    stale = cache.get_stale(ck)
    if stale and not _refreshing.get(ck):
        _refreshing[ck] = True
        threading.Thread(target=_do_refresh_news, args=(ck, US_FEEDS, limit_per_source, total_limit), daemon=True).start()
        return stale
    return _do_refresh_news(ck, US_FEEDS, limit_per_source, total_limit)
