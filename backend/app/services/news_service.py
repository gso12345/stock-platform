import feedparser
import os
import re
import html as _html
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock
from datetime import datetime, timezone, timedelta
from app.core.cache import cache
from app.core.backoff import 쉼표
from app.core.executor import background_executor
from app.core import health
from app.core.cpu import cpu_worker_count, io_worker_count

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
# 여섯 곳을 뺐다 — 관리자 화면에서 30회차 동안 30번, 즉 100% 실패했다.
#
#   MarketWatch  feeds.content.dowjones.io
#   WSJ Markets  feeds.a.dj.com
#   WSJ Economy  feeds.a.dj.com
#   Barron's     barrons.com/xml/rss
#   Forbes Business  forbes.com/feeds/news.rss
#   The Street   thestreet.com/feeds
#
# 앞의 넷은 모두 Dow Jones 계열이고 공개 RSS 를 닫았다. 나머지 둘도 매체가
# 개편되며 경로가 사라졌다. 같은 목록의 Yahoo·CNBC·Seeking Alpha 등은 계속
# 성공하고 있으므로 서버나 코드 문제가 아니다.
#
# 안 되는 곳을 남겨 두는 것은 그냥 낭비가 아니다 — 해외는 14곳을 매 회차
# 전부 긁는데(_FEED_BATCH 와 수가 같아서) 그중 여섯 칸이 매번 헛돌았다.
# 빼면 나머지가 그만큼 빨리 끝난다.
#
# 대신할 곳을 지금 넣지 않은 이유: 이 작업 환경은 외부 인터넷이 막혀 있어
# 새 주소가 살아 있는지 확인할 방법이 없다. 확인 못 한 주소를 넣는 것이
# 애초에 이 목록이 이렇게 된 원인이다. 위의 '실패 이유 기록' 이 배포되면
# 한 회차 만에 어디가 되는지 화면에 그대로 뜨므로, 그때 보고 넣는 게 맞다.
US_FEEDS = [
    # 주요 경제·시장
    ("Yahoo Finance",      "https://finance.yahoo.com/news/rssindex"),
    ("CNBC Economy",       "https://www.cnbc.com/id/20910258/device/rss/rss.html"),
    ("CNBC Finance",       "https://www.cnbc.com/id/10000664/device/rss/rss.html"),
    ("CNBC Top News",      "https://www.cnbc.com/id/100003114/device/rss/rss.html"),
    # 투자·분석
    ("Seeking Alpha",      "https://seekingalpha.com/feed.xml"),
    ("Investing.com",      "https://www.investing.com/rss/news.rss"),
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
    "경제","성장률","GDP","물가","인플레이션","디플레이션","고용","실업","일자리","수출","수입","무역",
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


def _safe_url(raw: str | None) -> str | None:
    """외부 RSS에서 온 URL을 http/https만 통과시킨다.

    링크와 이미지 주소는 언론사 피드가 주는 값을 그대로 화면에 넣는다.
    피드가 변조되거나 언론사 서버가 뚫리면 javascript:… 같은 주소가 섞여 들어올
    수 있고, 그러면 사용자가 기사를 누르는 순간 우리 사이트 권한으로 실행된다.
    (브라우저에 로그인 토큰이 있으므로 계정 탈취까지 이어질 수 있다)

    공백·개행을 먼저 제거하는 이유: "java\\nscript:" 처럼 끼워 넣어 검사를
    피하는 수법이 있어서, 스킴을 판정하기 전에 정규화해야 한다.
    """
    if not raw or not isinstance(raw, str):
        return None
    url = re.sub(r"[\s\x00-\x1f]+", "", raw)           # 공백·제어문자 제거
    if not url:
        return None

    # "//img.example.com/a.jpg" 처럼 스킴만 생략한 주소는 RSS에서 흔하고,
    # 브라우저가 https://img.example.com/a.jpg 로 해석하는 정상 주소다.
    # (우리 도메인이 아니라 // 뒤의 호스트로 간다) https를 붙여 살려 쓴다.
    if url.startswith("//"):
        return "https:" + raw.strip()

    scheme = url.split(":", 1)[0].lower() if ":" in url else ""
    if scheme in ("http", "https"):
        return raw.strip()
    # javascript:, data: 등 실행 가능한 스킴과 단순 상대경로(/path)는 받지 않는다
    return None


def _이미지주소(raw: "str | None") -> "str | None":
    """이미지 주소는 링크보다 한 가지를 더 본다 — http:// 를 https:// 로 올린다.

    "이미지 안 나오는 기사가 있다" 의 조용한 원인이다. 우리 사이트는
    https 로 열리는데, 그 안에서 <img src="http://..."> 를 그리면 브라우저가
    혼합 콘텐츠라며 통째로 막는다. 오류도 안 뜨고 그냥 안 나온다.

    서버 쪽에서는 이게 더 나쁘다. 주소가 있으니 '사진 있는 기사' 로 세어
    필터를 통과시키는데, 화면에서는 빈 자리가 된다. 세는 것과 보이는 것이
    어긋난다.

    링크(a href)는 안 올린다 — 거기는 브라우저가 그냥 이동하므로 http 라도
    멀쩡히 열린다. 이미지만 문제다.

    https 를 안 하는 서버면 올려도 실패한다. 그래도 손해는 없다 — http 로
    두면 100% 막히고, 올리면 될 가능성이라도 있다. 실패하면 화면이
    대체 아이콘으로 바꿔 그린다.
    """
    url = _safe_url(raw)
    if not url:
        return None
    return "https://" + url[7:] if url[:7].lower() == "http://" else url


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

# 피드 한 곳을 기다려 주는 시간.
#
# 5초였다. CPU 가 0.15개인 서버에서 워커 6개가 나눠 쓰면 응답을 받아 놓고도
# 그 안에 못 끝나는 곳이 생긴다 — 국내 언론사가 여럿 실패하던 원인 중
# 하나로 의심되는 자리다. 위쪽 예산이 넉넉하므로(as_completed 40초,
# 개별 12초) 10초까지는 안전하다. 14곳을 6워커로 돌리면 최악이 약 24초다.
_FEED_TIMEOUT = int(os.getenv("NEWS_FEED_TIMEOUT", 10))


class 피드실패(Exception):
    """왜 못 가져왔는지 사람이 읽는 한 문장으로 담는다.

    예전에는 _parse_feed 가 무슨 일이 나든 `except Exception: return []` 로
    삼켰다. 그래서 부르는 쪽에서는 타임아웃도, 403 차단도, 없어진 도메인도,
    정말로 필터에 걸린 것도 모두 '기사 0건' 으로만 보였고, 관리자 화면에는
    무엇이 문제든 똑같이 "기사 0건 (필터에서 전부 제외)" 라고 떴다.
    원인을 알 수 없으니 고칠 수도 없었다."""


def _parse_feed(url: str, source: str, limit: int = 8) -> list[dict]:
    """RSS 한 곳을 가져온다.

    실패하면 이유를 담아 던진다 — 조용히 빈 목록을 돌려주지 않는다."""
    import httpx

    # feedparser.parse(url)는 자체 타임아웃이 없어, 응답이 느리거나 멈춘
    # 피드 하나가 스레드를 오래 점유해 다른 피드까지 예산 안에 못 끝나는
    # 문제가 있었음 — httpx로 명시적 타임아웃을 두고 받아온 바이트를 파싱
    try:
        resp = httpx.get(url, headers=_FEED_HEADERS, timeout=_FEED_TIMEOUT,
                         follow_redirects=True)
    except httpx.TimeoutException:
        raise 피드실패(f"응답 없음 ({_FEED_TIMEOUT}초 초과)")
    except httpx.ConnectError as e:
        # 도메인이 사라졌거나(DNS) 서버가 안 받는 경우. 둘을 가르면
        # '주소를 고쳐야 한다' 와 '기다렸다 다시' 를 구분할 수 있다
        말 = str(e).lower()
        if "name or service not known" in 말 or "nodename nor servname" in 말 \
           or "temporary failure in name resolution" in 말:
            raise 피드실패("주소를 찾을 수 없음 (도메인 확인 필요)")
        raise 피드실패("연결 거부됨")
    except Exception as e:
        raise 피드실패(f"연결 실패 ({type(e).__name__})")

    if resp.status_code >= 400:
        # 401·403 은 대개 봇 차단이나 유료화, 404 는 경로가 바뀐 것이다.
        설명 = {401: "인증 요구", 403: "차단됨(봇 차단·유료화)",
                404: "없는 주소(경로 변경)", 429: "요청이 너무 잦음"}
        raise 피드실패(f"HTTP {resp.status_code}"
                       + (f" — {설명[resp.status_code]}" if resp.status_code in 설명 else ""))

    try:
        feed = feedparser.parse(resp.content)
    except Exception as e:
        raise 피드실패(f"읽을 수 없는 형식 ({type(e).__name__})")

    if not feed.entries:
        # 200 인데 항목이 없다 — 대개 RSS 가 아니라 안내 페이지(HTML)를 받은 것이다
        raise 피드실패("피드에 기사가 없음 (RSS 가 아닐 수 있음)")

    try:
        items = []
        cutoff = datetime.now(timezone.utc) - timedelta(days=3)
        # 필터(경제 키워드/기간/이미지) 통과율이 낮을 수 있으므로 넉넉히 스캔
        for entry in feed.entries[:max(limit * 10, 100)]:
            title = entry.get("title", "").strip()
            if not title:
                continue
            if not _is_finance_news(title):
                continue

            # 발행 시각이 없다고 기사를 버리면 언론사 하나가 통째로 사라진다.
            # 실제로 그래서 14곳에서 정상 수신했는데도 화면에는 2곳만 떴다.
            # RSS 는 최근 기사를 싣는 형식이므로, 날짜를 못 읽어도 최근 기사로
            # 보되 정렬에서는 날짜가 확실한 기사 뒤에 놓는다.
            parsed = entry.get("published_parsed") or entry.get("updated_parsed")
            dt = None
            if parsed:
                try:
                    dt = datetime(*parsed[:6], tzinfo=timezone.utc)
                except Exception:
                    dt = None
            if dt is None:
                dt = cutoff + timedelta(minutes=1)   # 통과는 하되 맨 뒤로
            elif dt < cutoff:
                continue

            # 링크가 http/https가 아니면 기사 자체를 버린다 (누를 수 없는 기사는 무의미)
            link = _safe_url(entry.get("link"))
            if not link:
                continue
            image = _이미지주소(_extract_thumbnail(entry))

            items.append({
                "title":     title,
                "link":      link,
                "source":    source,
                "published":    dt.astimezone(KST).strftime("%m/%d %H:%M"),
                "published_ts": dt.timestamp(),
                "summary":      _clean_text(entry.get("summary") or ""),
                "image":        image,
                "_ts":          dt.timestamp(),
            })
            if len(items) >= limit:
                break
    except Exception as e:
        raise 피드실패(f"기사 해석 중 오류 ({type(e).__name__})")

    if not items:
        # 받아오기는 제대로 했는데 조건에 맞는 기사가 하나도 안 남은 경우다.
        # 위의 '피드에 기사가 없음' 과 뜻이 전혀 다르므로 따로 알린다 —
        # 이건 주소 문제가 아니라 필터를 손봐야 하는 신호다
        raise 피드실패(f"기사 {len(feed.entries)}건 중 통과 0건 "
                       "(경제 키워드·3일 이내 조건)")
    return items


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


# 피드 fetch 전용 공유 스레드풀.
#
# 예전에는 워커를 64개 두어 모든 언론사 피드를 동시에 시작했다. 그런데 이 서버는
# CPU가 0.1개(10%)라, 동시에 띄운다고 총 CPU 시간이 줄지 않는다. 오히려 64개가
# CPU를 나눠 쓰면서 각자 느려지고, 결국 대부분이 타임아웃(5초)에 걸려 통째로
# 버려졌다 — 뉴스 탭에 한두 언론사 기사만 뜨던 원인이다.
# 워커를 줄이면 각 피드가 제 시간 안에 끝나 성공률이 오히려 올라간다.
_FEED_WORKERS = int(os.getenv("NEWS_FEED_WORKERS", 0)) or cpu_worker_count(default=6)
_feed_executor = ThreadPoolExecutor(max_workers=_FEED_WORKERS, thread_name_prefix="feed-fetch")

# 한 번에 가져올 피드 수. 국내 49개를 매번 전부 긁으면 CPU만 8초를 쓰는데,
# 뉴스는 5분마다 몇 개 언론사씩 돌아가며 채워도 충분하다. 이전 회차 기사는
# 아래 stale 병합이 살려 두므로 목록은 계속 가득 찬 상태로 유지된다.
_FEED_BATCH = int(os.getenv("NEWS_FEED_BATCH", 14))

# 언론사별로 돌아가며 가져오기 위한 시작 위치 (자리 이름 → 다음 시작 index)
_feed_cursor: dict[str, int] = {}
_cursor_lock = Lock()

# ── 계속 실패하는 곳은 뒤로 물린다 ──────────────────────────
#
# 실패 이유를 화면에 띄우고 나서야 규모가 보였다. 국내 49곳 중 36곳이
# 38회 연속 실패 중이다. 그런데 고르는 코드는 그걸 전혀 안 본다 —
# 순서대로만 돌리니 회차당 14칸 중 열 칸이 38번 연속 실패한 곳으로 간다.
#
# 두 가지를 한꺼번에 잃고 있었다.
#   · 살아 있는 13곳이 3~4회차에 한 번씩만 갱신된다(약 17분마다).
#     칸이 남아도는 게 아니라 죽은 곳이 칸을 먹고 있어서다.
#   · 회차 전체 예산이 40초인데 죽은 곳 하나가 최대 10초를 쓴다.
#     열 곳이면 예산을 다 쓰고, 살아 있는 곳이 그 안에 못 끝나 버려진다.
#
# 그래서 연속 실패가 쌓인 곳은 '쉬는 곳' 으로 빼고, 매 회차 몇 칸만
# 다시 찔러본다. 목록에서 지우지는 않는다 — 언론사가 주소를 되살리면
# 그 찔러보는 칸에서 성공해 스스로 돌아온다. 지워 버리면 사람이
# 알아채고 다시 넣기 전까지는 영영 안 온다.
#
# '기사는 받았는데 경제 키워드에 하나도 안 걸림' 은 실패로 세지 않는다.
# 그건 피드가 멀쩡하다는 뜻이다.
#
# 세는 일 자체는 app/core/backoff.py 로 옮겼다. 국내 지수와 국내 금리도
# 똑같은 것을 각자 가지고 있었는데, 이름만 조금씩 달라 관리자 화면에서
# 꺼내 볼 때 세 벌을 따로 알아야 했다. 여기 남은 이름들은 그대로 두고
# (admin 화면과 시험이 이 이름으로 부른다) 속만 공용 것으로 바꾼다.
뉴스쉼표 = 쉼표(
    #: 이만큼 연속 실패하면 쉬는 곳으로 본다. 한두 번은 서버가 잠깐
    #: 흔들린 것일 수 있어 넉넉히 잡는다.
    쉼_기준=int(os.getenv("NEWS_FEED_REST_AFTER", 5)),
    #: 한 회차에서 쉬는 곳을 다시 찔러보는 칸 수. 36곳을 2칸씩 돌면
    #: 한 곳당 18회차(약 90분)에 한 번 다시 시도한다.
    되살림_칸=int(os.getenv("NEWS_FEED_PROBE", 2)),
)

#: 같은 딕셔너리를 가리킨다 — 새로 만들면 두 벌이 따로 놀아서
#: 여기에 넣은 값이 쉼표에는 안 보인다.
_연속실패: dict[str, int] = 뉴스쉼표._연속실패
_쉼_기준 = 뉴스쉼표.쉼_기준
_되살림_칸 = 뉴스쉼표.되살림_칸


def _쉬는가(이름: str) -> bool:
    return 뉴스쉼표.쉬는가(이름)


def _실패기록(이름: str, 실패했나: bool) -> None:
    뉴스쉼표.기록(이름, 실패했나)


def _돌아가며(목록: list, 개수: int, 자리: str) -> list:
    """목록에서 순서대로 개수만큼 고르고, 다음에 이어서 갈 자리를 남긴다.

    무작위로 섞으면 운이 나쁜 언론사는 몇 회차 연속 빠질 수 있다.
    순서대로 돌리면 모든 언론사가 정확히 같은 빈도로 갱신된다.

    자리 이름을 따로 받는 이유 — 예전에는 id(목록) 을 열쇠로 썼다.
    목록이 모듈 상수일 때는 맞지만, 아래처럼 그때그때 걸러 만든
    임시 목록에는 못 쓴다. id 는 회차마다 달라지고, 심하면 먼저 버려진
    목록의 번지를 물려받아 엉뚱한 자리에서 이어가게 된다."""
    if 개수 <= 0 or not 목록:
        return []
    if 개수 >= len(목록):
        return list(목록)
    with _cursor_lock:
        시작 = _feed_cursor.get(자리, 0) % len(목록)
        _feed_cursor[자리] = (시작 + 개수) % len(목록)
    이어붙인것 = list(목록) + list(목록)
    return 이어붙인것[시작:시작 + 개수]


def _next_batch(feeds: list, batch: int) -> list:
    """이번 회차에 가져올 피드를 고른다 — 쉬는 곳은 몇 칸만."""
    if batch >= len(feeds):
        return list(feeds)
    자리 = "kr" if feeds is KR_FEEDS else "us" if feeds is US_FEEDS else str(id(feeds))

    사는곳 = [f for f in feeds if not _쉬는가(f[0])]
    쉬는곳 = [f for f in feeds if _쉬는가(f[0])]

    # 전부 쉬는 중이면 예전처럼 돈다. 여기서 빈 목록을 주면 뉴스가
    # 통째로 멈추고, 그러면 스스로 되살아날 길도 함께 막힌다.
    if not 사는곳:
        return _돌아가며(feeds, batch, 자리)
    if not 쉬는곳:
        return _돌아가며(사는곳, batch, f"{자리}:live")

    # 찔러보는 칸이 묶음을 다 먹지 않게 한다 — 살아 있는 곳이 최소 한 칸.
    찔러볼칸 = max(0, min(_되살림_칸, batch - 1, len(쉬는곳)))
    return (_돌아가며(사는곳, batch - 찔러볼칸, f"{자리}:live")
            + _돌아가며(쉬는곳, 찔러볼칸, f"{자리}:rest"))


def _fetch_all_feeds(feeds: list, limit_per_source: int, batch: int | None = None) -> list[dict]:
    """피드를 순서대로 나눠 가져온다 (CPU 0.1개 환경에서 타임아웃 방지)"""
    picked = _next_batch(feeds, batch or _FEED_BATCH)
    all_news = []
    futures = {
        _feed_executor.submit(_parse_feed, url, source, limit_per_source): source
        for source, url in picked
    }
    성공 = 실패 = 빈곳 = 0
    남은곳 = dict(futures)          # 답을 못 들은 곳 — 아래에서 하나씩 지운다
    try:
        # 워커가 적으므로 개별 피드는 여유 있게 기다린다 — 예전에는 동시 실행
        # 때문에 이 예산 안에 못 끝나 버려지는 피드가 대부분이었다
        for future in as_completed(futures, timeout=40):
            source = futures[future]
            남은곳.pop(future, None)
            try:
                items = future.result(timeout=12)
                all_news.extend(items)
                성공 += 1
                _실패기록(source, False)
                # 성공도 언론사별로 남긴다. 이게 없으면 실패 수만 쌓여서,
                # 한참 전에 실패하고 그 뒤로 계속 성공한 곳도 화면에
                # 영원히 '실패' 로 남는다(연속실패가 0으로 돌아가지 않는다)
                health.record_ok(f"뉴스:{source}", detail=f"{len(items)}건")
            except 피드실패 as e:
                # 받아오긴 했는데 조건에 맞는 기사가 없던 경우와, 아예 못
                # 가져온 경우를 갈라서 센다. 예전에는 "14/14곳 성공" 인데
                # 화면에는 2곳만 뜨는 일이 있었다
                if "통과 0건" in str(e):
                    빈곳 += 1
                    # 받아오긴 했다. 피드는 멀쩡하므로 쉬게 하지 않는다 —
                    # 여기서 실패로 세면 경제 기사가 뜸한 언론사가 통째로
                    # 목록에서 빠진다
                    _실패기록(source, False)
                else:
                    실패 += 1
                    _실패기록(source, True)
                # 어떤 언론사가 왜 실패했는지 그대로 남긴다 — 관리자 화면의
                # 칩에 마우스를 올리면 이 문장이 보인다
                health.record_fail(f"뉴스:{source}", str(e))
            except Exception as e:
                실패 += 1
                _실패기록(source, True)
                health.record_fail(f"뉴스:{source}", f"{type(e).__name__}")
    except Exception:
        pass

    # 회차 예산(40초)이 끝나면 남은 것은 결과를 못 듣는다. 예전에는 여기서
    # 그냥 빠져나가서, 매번 예산을 넘기는 느린 곳은 성공도 실패도 기록되지
    # 않았다 — 화면에 아무 흔적이 없으니 '되고 있는 줄' 알았고, 연속 실패도
    # 안 쌓이니 쉬는 곳으로 물러나지도 않아 매 회차 칸만 먹었다.
    for future, source in 남은곳.items():
        future.cancel()
        실패 += 1
        _실패기록(source, True)
        health.record_fail(f"뉴스:{source}", "회차 시간(40초) 안에 못 끝냄")

    전체 = 성공 + 실패 + 빈곳
    if 성공:
        상세 = f"{성공}/{전체}곳에서 기사 확보"
        if 빈곳:
            상세 += f" · {빈곳}곳은 0건"
        if 실패:
            상세 += f" · {실패}곳 오류"
        health.record_ok("뉴스 수집", None, 상세)
    elif 전체:
        health.record_fail("뉴스 수집", f"{전체}곳 모두 기사 확보 실패")
    return all_news


# 화면에 필요 없는 내부 계산 필드 — 응답에서 제외한다
# (_ts: 정렬용 원본 타임스탬프, _trend_score: 인기순 산식)
_INTERNAL_FIELDS = {"_ts", "_trend_score"}


def strip_internal_fields(articles: list[dict]) -> list[dict]:
    """내부 계산 필드를 제거한 뒤 응답에 싣는다"""
    return [{k: v for k, v in a.items() if k not in _INTERNAL_FIELDS} for a in articles]


# 기존 호출부 호환용 별칭
_strip_ts = strip_internal_fields


def _do_refresh_news(ck: str, feeds: list, limit_per_source: int, total_limit: int) -> list[dict]:
    # 배포 직후처럼 캐시가 비어 있으면 목록이 한두 언론사로만 채워져 보인다.
    # 이때 한 번은 넓게 가져와 첫 화면을 제대로 채운다.
    cold = not cache.get_stale(ck)
    all_news = _fetch_all_feeds(feeds, limit_per_source, batch=None if not cold else _FEED_BATCH * 3)
    stale = cache.get_stale(ck)
    if not all_news:
        # 전체 피드 실패 시에도 _refreshing을 해제해야 다음 요청에서 재시도 가능
        _refreshing.pop(ck, None)
        if not stale:
            # 빈손이었다는 것을 담아 둔다. 이게 없으면 들어오는 요청마다
            # 49곳을 처음부터 다시 훑는다(실측 2.8초/요청, 응답은 빈 배열)
            cache.set(f"{ck}:miss", True, NEWS_MISS_TTL)
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


#: 훑었는데 빈손이었을 때, 이만큼은 다시 안 훑는다.
#
# 서버를 띄워 재보니 뉴스가 매 요청 2.8초씩 걸리는데 응답은 2바이트
# (빈 배열)였다. 결과가 비면 아무것도 담지 않고 그대로 돌려주니,
# 다음 요청이 또 49곳을 훑는다. 게다가 겹침 방지는 지난 값이 있을 때만
# 걸려 있어서, 재시작 직후에는 들어오는 요청마다 각자 수집을 돌렸다.
NEWS_MISS_TTL = int(os.getenv("NEWS_MISS_TTL", 90))


def _배경갱신(ck: str, feeds: list, limit_per_source: int, total_limit: int) -> None:
    """배경에서 갱신하고, 무슨 일이 있어도 표시를 풀어 준다.

    _do_refresh_news 는 제 갈래마다 _refreshing 을 지운다. 그런데 그 사이
    어디서든 예외가 나면 표시가 True 로 남고, 그 뒤로는
    `if not _refreshing.get(ck)` 에 걸려 다시는 갱신을 안 시작한다.
    화면에는 지난 기사가 계속 떠 있으니 멈춘 줄도 모른다."""
    try:
        _do_refresh_news(ck, feeds, limit_per_source, total_limit)
    except Exception as e:                      # noqa: BLE001
        health.record_fail("뉴스 수집", f"배경 갱신 실패 ({type(e).__name__})")
    finally:
        _refreshing.pop(ck, None)


def _뉴스가져오기(ck: str, feeds: list, limit_per_source: int, total_limit: int) -> list[dict]:
    """캐시 → 지난 값 → (한 번만) 직접 수집.

    어느 갈래로 가든 요청을 오래 잡지 않는 것이 규칙이다."""
    if c := cache.get(ck):
        return _strip_ts(c)

    stale = cache.get_stale(ck)
    if stale:
        # 지난 값이 있으면 그걸 주고 갱신은 배경으로 넘긴다
        if not _refreshing.get(ck):
            _refreshing[ck] = True
            try:
                background_executor.submit(_배경갱신, ck, feeds, limit_per_source, total_limit)
            except Exception:
                # 밀어 넣는 것 자체가 실패하면(풀이 닫혔다든지) 표시를 그대로
                # 두면 안 된다 — 그 뒤로 뉴스가 영영 안 갱신된다
                _refreshing.pop(ck, None)
        return _strip_ts(stale)

    # 여기부터가 캐시가 통째로 빈 상태(재시작 직후)다.
    if cache.get(f"{ck}:miss"):
        return []                      # 방금 훑었는데 빈손이었다
    if _refreshing.get(ck):
        return []                      # 이미 누가 훑는 중 — 줄 서지 않는다
    _refreshing[ck] = True
    try:
        return _do_refresh_news(ck, feeds, limit_per_source, total_limit)
    finally:
        _refreshing.pop(ck, None)


def get_kr_news(limit_per_source: int = 40, total_limit: int = 800) -> list[dict]:
    return _뉴스가져오기("news:kr", KR_FEEDS, limit_per_source, total_limit)


def get_us_news(limit_per_source: int = 35, total_limit: int = 500) -> list[dict]:
    """해외(미국 등) 증시·경제 뉴스 — 해외 언론사 RSS(Yahoo Finance/CNBC 등)에서 직접 수집"""
    return _뉴스가져오기("news:us", US_FEEDS, limit_per_source, total_limit)


def pick_top_image_first(articles: list, limit: int) -> list:
    """이미지가 있는 기사를 우선 배치해 상위 limit개를 뽑는다.
    (각 그룹 내부의 기존 순서(최신순/언론사 다양성)는 그대로 유지)"""
    with_image    = [a for a in articles if a.get("image")]
    without_image = [a for a in articles if not a.get("image")]
    return (with_image + without_image)[:limit]
