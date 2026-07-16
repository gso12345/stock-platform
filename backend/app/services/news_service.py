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
    ("블로터",         "https://www.bloter.net/rss/allArticle.xml"),
    ("디지털데일리",   "https://www.ddaily.co.kr/rss/allArticle.xml"),
    # 중소형 경제 전문지/매체 (언론사 다양성 보강)
    ("데일리안 경제",  "https://www.dailian.co.kr/rss/economy.xml"),
    ("프라임경제",     "http://www.newsprime.co.kr/rss/allArticle.xml"),
    ("브릿지경제",     "http://www.viva100.com/rss/allArticle.xml"),
    ("메트로신문",     "http://www.metroseoul.co.kr/rss/allArticle.xml"),
    ("이뉴스투데이",   "http://www.enewstoday.co.kr/rss/allArticle.xml"),
    ("한스경제",       "http://www.sporbiz.co.kr/rss/allArticle.xml"),
    ("시사저널e",      "http://www.sisajournal-e.com/rss/allArticle.xml"),
    ("글로벌이코노믹", "https://www.g-enews.com/rss/allArticle.xml"),
    ("이코노미스트",   "https://economist.co.kr/rss/allArticle.xml"),
    ("비즈워치",       "https://news.bizwatch.co.kr/rss/total_news.xml"),
]

# ── 해외 뉴스 RSS ──────────────────────────────────────────
US_FEEDS = [
    # 주요 경제·시장
    ("Yahoo Finance",      "https://finance.yahoo.com/news/rssindex"),
    ("MarketWatch",        "https://feeds.content.dowjones.io/public/rss/mw_marketpulse"),
    ("CNBC Economy",       "https://www.cnbc.com/id/20910258/device/rss/rss.html"),
    ("CNBC Finance",       "https://www.cnbc.com/id/10000664/device/rss/rss.html"),
    ("CNBC Top News",      "https://www.cnbc.com/id/100003114/device/rss/rss.html"),
    ("WSJ Markets",        "https://feeds.a.dj.com/rss/RSSMarketsMain.xml"),
    ("WSJ Economy",        "https://feeds.a.dj.com/rss/RSSWorldNews.xml"),
    # 투자·분석
    ("Seeking Alpha",      "https://seekingalpha.com/feed.xml"),
    ("Investing.com",      "https://www.investing.com/rss/news.rss"),
    ("The Street",         "https://www.thestreet.com/feeds/headline-stories.rss"),
    ("Forbes Business",    "https://www.forbes.com/feeds/news.rss"),
    ("Barron's",           "https://www.barrons.com/xml/rss/3_7028.xml"),
    ("Fortune",            "https://fortune.com/feed/"),
    ("Business Insider",   "https://markets.businessinsider.com/rss/news"),
]


# 경제·증권·금융 관련 키워드 — 화이트리스트(제목에 하나라도 있어야 노출)
# "경제" 섹션 RSS라도 사회/문화성 기사가 섞여 들어오는 경우가 많아,
# 비경제 키워드 제외만으로는 걸러지지 않는 기사가 통과하는 문제를 막기 위해
# 경제/증권/금융 신호 키워드가 실제로 있는지 직접 확인한다.
_FINANCE_KW = {
    # 증시·종목
    "증시","주가","코스피","코스닥","나스닥","다우","증권","주식","상장","공모주","IPO",
    "상장폐지","액면분할","유상증자","무상증자","배당","합병","인수","M&A","ETF","공시",
    "실적","매출","영업이익","순이익","적자","흑자","목표가","리포트","애널리스트","주총",
    "시가총액","거래량","거래소","코스피200","코스닥150","외국인","기관","순매수","순매도",
    "급등","급락","상한가","하한가","신고가","신저가","공매도","대주주","주주","주식회사",
    "유가증권","채권시장","장마감","장중","개장","폐장","증권거래세","사모펀드","공모펀드",
    "투자은행","증권업계","코넥스","스팩","SPAC","우회상장","감자","주식분할","주식매수청구권",
    "기업공개","유동성","시총","밸류에이션","PER","PBR","ROE","EPS","BPS","컨센서스",
    # 금리·통화·채권
    "금리","기준금리","환율","달러","원화","엔화","유로","위안화","채권","국채","회사채","한은",
    "연준","Fed","FOMC","금통위","빅컷","기준금리동결","양적완화","테이퍼링","외환보유액",
    # 경제 지표·정책
    "경제","경기","성장률","GDP","물가","인플레이션","디플레이션","고용","실업","일자리","수출","수입","무역",
    "무역수지","관세","예산","세금","법인세","소득세","재정","경상수지","투자","펀드","부양",
    "경제성장","소비자물가","생산자물가","경기침체","경기둔화","경기회복","산업생산","무역적자","무역흑자",
    # 부동산·금융업
    "부동산","집값","아파트","전세","월세","대출","은행","증권사","보험사","카드사","핀테크","금융",
    "캐피탈","저축은행","대출규제","DSR","주택담보대출","청약","분양","재건축","재개발",
    # 산업·원자재·기업경영
    "반도체","수주","공급망","유가","금값","원자재","2차전지","바이오","K-방산","조선업",
    "구조조정","희망퇴직","감원","채용","파산","법정관리","워크아웃","흑자전환","적자전환",
}

# 해외(영문) 피드용 화이트리스트 — 소문자로 비교
_FINANCE_KW_EN = {
    "stock","stocks","share","shares","market","markets","earnings","revenue","profit","profits",
    "ipo","merger","acquisition","dividend","nasdaq","dow jones","s&p","nyse","fed","fomc",
    "inflation","rate cut","rate hike","interest rate","gdp","economy","economic","recession",
    "bond","bonds","treasury","currency","dollar","tariff","export","import","trade",
    "investor","investors","trading","etf","valuation","quarterly","guidance","outlook",
    "buyback","ceo","layoff","layoffs","ai chip","semiconductor","oil price","crude oil",
    "wall street","bull market","bear market","rally","selloff","sell-off","yield","forecast",
    "m&a","ratings","downgrade","upgrade","ipo",
}

def _is_finance_news(title: str) -> bool:
    """제목이 경제/증권/금융 관련인지 판단 (화이트리스트 키워드가 있어야 통과)
    경제 키워드가 있으면 비경제 키워드가 섞여 있어도 통과시킨다
    (예: "정치 테마주 급등" 처럼 비경제 키워드가 있어도 경제와 관련된 기사일 수 있음)"""
    lower = title.lower()
    return any(kw in title for kw in _FINANCE_KW) or any(kw in lower for kw in _FINANCE_KW_EN)


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


_FEED_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
}


def _parse_feed(url: str, source: str, limit: int = 8) -> list[dict]:
    try:
        # feedparser.parse(url)는 자체 타임아웃이 없어, 응답이 느리거나 멈춘
        # 피드 하나가 스레드를 오래 점유해 다른 피드까지 10초 예산 안에 못 끝나는
        # 문제가 있었음 — httpx로 명시적 타임아웃을 두고 받아온 바이트를 파싱
        import httpx
        resp = httpx.get(url, headers=_FEED_HEADERS, timeout=4, follow_redirects=True)
        feed = feedparser.parse(resp.content)
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

            items.append({
                "title":     title,
                "link":      entry.get("link", ""),
                "source":    source,
                "published":    dt.astimezone(KST).strftime("%m/%d %H:%M"),
                "published_ts": dt.timestamp(),
                "summary":      _clean_text(entry.get("summary") or ""),
                "image":        image,
                "_ts":          dt.timestamp(),
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


# 피드 fetch 전용 공유 스레드풀 — 호출마다 새 ThreadPoolExecutor를 만들면
# 피드 수(50개+)만큼 OS 스레드가 한꺼번에 생성/TLS 핸드셰이크를 동시 수행해
# 호스트 CPU가 제한된 환경(Render 등)에서 전체 응답 지연을 유발할 수 있음 —
# 동시 처리량을 적절히 제한하는 공유 풀을 재사용한다.
_feed_executor = ThreadPoolExecutor(max_workers=32, thread_name_prefix="feed-fetch")


def _fetch_all_feeds(feeds: list, limit_per_source: int) -> list[dict]:
    """피드 목록을 공유 스레드풀로 fetch (동시 처리량 제한으로 CPU 버스트 방지)

    워커 수보다 피드가 많으면 뒤에 제출된 피드는 앞쪽 피드가 끝나야 실행되는데,
    KR_FEEDS가 카테고리별로 묶여 있어 매번 같은 순서로 제출하면 항상 뒤쪽
    카테고리(통신사/방송/IT 등)만 시간 예산 안에 못 끝나는 편향이 생긴다 —
    매 호출마다 순서를 섞어 모든 언론사가 번갈아 우선권을 갖도록 한다.
    """
    import random
    shuffled = list(feeds)
    random.shuffle(shuffled)
    all_news = []
    futures = {
        _feed_executor.submit(_parse_feed, url, source, limit_per_source): source
        for source, url in shuffled
    }
    try:
        for future in as_completed(futures, timeout=20):
            try:
                items = future.result(timeout=6)
                all_news.extend(items)
            except Exception:
                pass
    except Exception:
        pass
    return all_news


def _strip_ts(articles: list[dict]) -> list[dict]:
    # _ts is internal; published_ts is kept for frontend sort
    return [{k: v for k, v in a.items() if k != "_ts"} for a in articles]


def _do_refresh_news(ck: str, feeds: list, limit_per_source: int, total_limit: int) -> list[dict]:
    all_news = _fetch_all_feeds(feeds, limit_per_source)
    stale = cache.get_stale(ck)
    if not all_news:
        # 전체 피드 실패 시에도 _refreshing을 해제해야 다음 요청에서 재시도 가능
        _refreshing.pop(ck, None)
        return _strip_ts(stale) if stale else []
    _add_trending_score(all_news)

    # 일부 언론사 피드가 이번 회차에 타임아웃/실패해도 그 언론사의 최근 기사가
    # 화면에서 사라지지 않도록, 새로 가져온 기사와 이전 캐시 기사를 먼저 합친
    # 뒤에 전체를 다시 시간순으로 정렬한다. (정렬 후 자르기만 하면 "이번 회차
    # 결과만으로 total_limit을 채우는지"에 따라 stale 보충 여부가 갈려, 최신
    # 기사가 들어왔다 빠졌다 하는 비일관성이 생긴다 — 항상 합친 뒤 정렬해야
    # 실제로 가장 최신인 기사들이 always 살아남는다)
    seen = {a.get("link") for a in all_news if a.get("link")}
    if stale:
        for a in stale:
            link = a.get("link")
            if link and link not in seen and "_ts" in a:
                all_news.append(a)
                seen.add(link)

    # 실제 발행 시각(_ts) 기준 정렬 — 언론사별 상한 없이 순수 시간순으로 정렬
    all_news.sort(key=lambda x: x.get("_ts", 0), reverse=True)
    result = all_news[:total_limit]
    cache.set(ck, result, 300)
    _refreshing.pop(ck, None)
    return _strip_ts(result)


def get_kr_news(limit_per_source: int = 40, total_limit: int = 800) -> list[dict]:
    ck = "news:kr"
    if c := cache.get(ck):
        return _strip_ts(c)
    stale = cache.get_stale(ck)
    if stale:
        if not _refreshing.get(ck):
            _refreshing[ck] = True
            background_executor.submit(_do_refresh_news, ck, KR_FEEDS, limit_per_source, total_limit)
        return _strip_ts(stale)
    return _do_refresh_news(ck, KR_FEEDS, limit_per_source, total_limit)


def get_us_news(limit_per_source: int = 35, total_limit: int = 500) -> list[dict]:
    """해외(미국 등) 증시·경제 뉴스 — 해외 언론사 RSS(Yahoo Finance/CNBC/WSJ 등)에서 직접 수집"""
    ck = "news:us"
    if c := cache.get(ck):
        return _strip_ts(c)
    stale = cache.get_stale(ck)
    if stale:
        if not _refreshing.get(ck):
            _refreshing[ck] = True
            background_executor.submit(_do_refresh_news, ck, US_FEEDS, limit_per_source, total_limit)
        return _strip_ts(stale)
    return _do_refresh_news(ck, US_FEEDS, limit_per_source, total_limit)


def pick_top_image_first(articles: list, limit: int) -> list:
    """이미지가 있는 기사를 우선 배치해 상위 limit개를 뽑는다.
    (각 그룹 내부의 기존 순서(최신순/언론사 다양성)는 그대로 유지)"""
    with_image    = [a for a in articles if a.get("image")]
    without_image = [a for a in articles if not a.get("image")]
    return (with_image + without_image)[:limit]
