"""내 보유 종목 뉴스 — 흩어진 것을 한 자리에 모은다.

종목 상세에 들어가면 그 종목 뉴스가 나온다. 그런데 열 종목을 가진
사람은 '내 종목에 무슨 일이 있었나' 를 알려고 화면을 열 번 드나들어야
했다. 참고한 자산 앱들이 포트폴리오 안에 뉴스 탭을 두는 이유다.

── 요청을 붙잡지 않으면서 모든 종목을 채운다 ──

처음에는 아예 새로 안 받았다. 종목마다 구글뉴스 RSS 나 yfinance 를
부르면 스무 종목 = 외부 호출 스무 번이고, 0.15 CPU 서버에서 그건
화면이 30초를 기다린다는 뜻이라서다.

그런데 그러면 종목 상세를 한 번도 안 열어 본 종목은 영영 안 나온다.
'내 종목 뉴스' 인데 절반이 비어 있으면 화면을 여는 뜻이 없다.

그래서 세 겹으로 나눈다.

  1) 종합 뉴스 캐시(news:kr · news:us) — 비용 0
     스케줄러가 5분마다 채워 둔다. 거기서 내 종목을 언급한 기사를
     골라낸다. 큰 종목은 대개 여기서 다 잡힌다.
  2) 종목 뉴스 캐시(stock_news:{market}:{symbol}) — 비용 0
     누군가 그 종목 상세를 열었으면 남아 있다.
  3) **배경에서 받아 온다** — 요청은 안 기다린다
     1·2 로 못 채운 종목은 배경 스레드에 맡기고, 지금 있는 것만
     돌려주면서 `pending` 으로 몇 개가 오는 중인지 알려 준다.
     화면은 그 수를 보고 몇 초 뒤 한 번 더 물어본다.

받아 온 것은 종목 상세와 **같은 열쇠**에 담는다. 그래서 이 화면을
연 뒤에 종목 상세를 열면 그쪽도 곧바로 뜬다 — 반대도 마찬가지다.

한 번에 배경으로 보내는 종목 수에도 상한이 있다(배당 달력의
'한번에' 와 같은 규칙). 스무 종목을 한꺼번에 밀어 넣으면 풀이 막혀
다른 화면까지 같이 느려진다.

── 조심한 것 ──

published_ts 의 타입이 출처마다 다르다. 종합피드는 float epoch,
구글뉴스는 ISO 문자열, yfinance 는 아예 없다. 한 리스트에 섞어 놓고
sorted() 를 부르면 float 과 str 을 비교하다 TypeError 로 죽는다.
종목 하나만 볼 때는 잘 안 섞이지만 여러 종목을 합치면 거의 반드시
섞인다. 그래서 합치기 전에 float 하나로 맞춘다.
"""
from __future__ import annotations

import hashlib
import logging
import re
from datetime import datetime, timedelta, timezone

from app.core.cache import cache

log = logging.getLogger(__name__)

KST = timezone(timedelta(hours=9))

#: 한 사람 몫 캐시 수명. 종합 뉴스 캐시가 5분이라 그보다 길 이유가 없다
TTL = 300

#: 응답 최대 건수. 무한 스크롤이 아니라 '요즘 무슨 일이 있었나' 를 보는
#: 화면이라 이 정도면 충분하고, 넘기면 압축 대상(256KB)에 가까워진다
최대건수 = 60

#: 종목 하나가 뉴스 목록을 통째로 먹지 않도록
종목당_최대 = 12

#: 종목 코드로 인정하는 모양. 포트폴리오는 '현금'·'금'·'채권' 같은 한글
#: 심볼을 허용하는데(PortfolioItemRequest), 그건 종목이 아니라 분류다.
#: 안 거르면 '금' 이 들어간 기사가 전부 딸려 온다 — 관심종목 시세에서
#: 겪었던 것과 같은 사고다
_종목코드 = re.compile(r"^[A-Za-z0-9.\-]{1,20}$")

_한글 = re.compile(r"[가-힣]")
#: 제목 중복 판정용 — 공백·문장부호를 걷어낸다
_지울것 = re.compile(r"[\s\W_]+", re.UNICODE)


def _시각(값) -> float:
    """무엇이 오든 float epoch 로. 못 읽으면 0(맨 뒤)."""
    if 값 is None or 값 == "":
        return 0.0
    if isinstance(값, (int, float)):
        return float(값)
    if isinstance(값, str):
        try:
            return datetime.fromisoformat(값.replace("Z", "+00:00")).timestamp()
        except Exception:
            pass
        # "2026/08/26 14:30" / "08/26 14:30" (KST 표시용 문자열)
        for 꼴, 연도있음 in (("%Y/%m/%d %H:%M", True), ("%m/%d %H:%M", False)):
            try:
                dt = datetime.strptime(값, 꼴)
                if not 연도있음:
                    이제 = datetime.now(KST)
                    해 = 이제.year if dt.month <= 이제.month else 이제.year - 1
                    dt = dt.replace(year=해)
                return dt.replace(tzinfo=KST).timestamp()
            except Exception:
                continue
    return 0.0


def _제목열쇠(제목: str) -> str:
    """같은 기사가 다른 주소로 두 번 오는 것을 잡는다.

    종합피드는 언론사 원문 주소로, 구글뉴스는 리다이렉트 주소로 온다.
    link 만 보면 서로 다른 기사로 남는다 — 종목이 여러 개면 그 중복이
    배로 늘어난다."""
    return _지울것.sub("", (제목 or "")).lower()[:40]


def _검색어(심볼: str, 이름: str, 시장: str) -> list[str]:
    """이 종목을 언급한 기사를 찾을 말들."""
    말: list[str] = []
    깨끗한이름 = (이름 or "").strip()
    if 시장 == "KR":
        # 국내는 한글 종목명이 곧 검색어다
        if len(깨끗한이름) >= 2 and 깨끗한이름 != 심볼:
            말.append(깨끗한이름)
        코드 = 심볼.replace(".KS", "").replace(".KQ", "")
        if len(코드) >= 6:
            말.append(코드)
    else:
        # 해외 기사도 국내 언론사 한글 기사로 오는 것이 많아 한글명이 먼저다
        try:
            from app.api.routes.stocks.news import _US_NAME_KO, _US_NAME_OVERRIDES, _CORP_SUFFIX_RE
        except Exception:                              # pragma: no cover - 라우트 못 읽는 환경
            _US_NAME_KO, _US_NAME_OVERRIDES, _CORP_SUFFIX_RE = {}, {}, re.compile(r"$^")
        if ko := _US_NAME_KO.get(심볼):
            말.append(ko)
        if 덮어쓰기 := _US_NAME_OVERRIDES.get(심볼):
            말.append(덮어쓰기)
        elif 깨끗한이름:
            앞말 = _CORP_SUFFIX_RE.sub("", 깨끗한이름).strip().split()
            if 앞말 and len(앞말[0]) >= 3:
                말.append(앞말[0])
        if len(심볼) >= 3:
            말.append(심볼)
    # 순서를 지키며 중복 제거
    return list(dict.fromkeys(w for w in 말 if w))


def _맞나(말: str, 글: str) -> bool:
    """한글은 그냥 포함, 영문은 단어 경계로.

    영문을 포함으로 보면 'V'(비자)가 거의 모든 기사에 걸리고,
    'GD' 는 'GDP' 에 걸린다."""
    if not 말 or not 글:
        return False
    if _한글.search(말):
        return 말 in 글
    return re.search(rf"\b{re.escape(말)}\b", 글, re.I) is not None


def 열쇠(보유: list[dict]) -> str:
    """같은 종목 묶음을 가진 사람끼리 캐시를 나눠 쓴다.

    사용자 id 로 키를 잡으면 사람 수만큼 캐시가 늘어난다. 실제로
    갈리는 것은 '어떤 종목을 갖고 있나' 뿐이라 그것으로 잡는다."""
    씨 = ",".join(sorted(f"{h.get('market')}:{h.get('symbol')}" for h in 보유))
    return "portfolio_news:" + hashlib.md5(씨.encode("utf-8")).hexdigest()[:16]


#: 한 요청에 배경으로 새로 받을 종목 수. 배당 달력의 '한번에' 와 같은 규칙 —
#: 스무 종목을 한꺼번에 밀어 넣으면 풀이 막혀 다른 화면까지 느려진다
한번에 = 4

#: 종목 뉴스 캐시 수명. 종목 상세가 쓰는 값과 같게 둔다(같은 열쇠를 쓴다)
종목뉴스_수명 = 300

#: 빈손이었던 종목은 한동안 그만 물어본다. 뉴스가 아예 안 잡히는
#: 종목(작은 ETF·우선주)이 생각보다 많다
빈손수명 = 60 * 30

#: 지금 배경에서 받는 중인 열쇠. 같은 종목을 두 번 밀어 넣지 않는다
_받는중: set = set()

#: 외부 요청 시한. 이 시간을 넘기면 그 종목은 다음 기회에
_시한 = 8.0


def _구글뉴스(이름: str) -> list[dict]:
    """국내 종목 — 구글뉴스 RSS.

    feedparser.parse(url) 을 그냥 쓰면 시한이 없다. 응답이 멈춘 피드
    하나가 배경 스레드를 영영 붙잡는다(뉴스 수집이 httpx 로 옮겨 간
    것도 같은 이유였다). 바이트를 받아서 파싱한다."""
    import urllib.parse
    import feedparser
    import httpx

    질의 = urllib.parse.quote(f"{이름} 주가")
    주소 = f"https://news.google.com/rss/search?q={질의}&hl=ko&gl=KR&ceid=KR:ko"
    resp = httpx.get(주소, timeout=_시한, follow_redirects=True,
                     headers={"User-Agent": "Mozilla/5.0"})
    if resp.status_code >= 400:
        return []
    feed = feedparser.parse(resp.content)

    from app.services.news_service import _safe_url, _extract_thumbnail

    항목 = []
    for e in (feed.entries or [])[:40]:
        제목 = (e.get("title") or "").strip()
        주소2 = _safe_url(e.get("link"))
        if not 제목 or not 주소2:
            continue
        ts = 0.0
        try:
            if e.get("published_parsed"):
                ts = datetime(*e.published_parsed[:6], tzinfo=timezone.utc).timestamp()
        except Exception:
            pass
        항목.append({
            "title": 제목,
            "link": 주소2,
            "source": (e.get("source") or {}).get("title", ""),
            # 화면이 읽는 꼴로 맞춰 둔다(fmtNewsDateTime 이 KST 로 읽는다)
            "published": datetime.fromtimestamp(ts, KST).strftime("%Y/%m/%d %H:%M") if ts else "",
            "published_ts": ts,
            "summary": (e.get("summary") or "")[:200],
            "image": _safe_url(_extract_thumbnail(e)),
        })
    return 항목


def _야후뉴스(심볼: str) -> list[dict]:
    """해외 종목 — yfinance."""
    import yfinance as yf

    항목 = []
    for n in (yf.Ticker(심볼).news or [])[:40]:
        ct = n.get("content", {}) or {}
        제목 = ct.get("title") or n.get("title") or ""
        주소 = (ct.get("canonicalUrl") or {}).get("url") or n.get("link") or ""
        if not 제목 or not 주소:
            continue
        낸때 = ct.get("pubDate") or n.get("providerPublishTime") or ""
        ts = _시각(낸때)
        썸 = ct.get("thumbnail") or n.get("thumbnail") or {}
        해상도 = 썸.get("resolutions") or []
        항목.append({
            "title": 제목,
            "link": 주소,
            "source": (ct.get("provider") or {}).get("displayName") or n.get("publisher") or "",
            "published": datetime.fromtimestamp(ts, KST).strftime("%Y/%m/%d %H:%M") if ts else "",
            "published_ts": ts,
            "summary": (ct.get("summary") or "")[:200],
            "image": 해상도[0].get("url") if 해상도 else 썸.get("originalUrl"),
        })
    return 항목


def _한종목_받기(심볼: str, 시장: str, 이름: str) -> None:
    """한 종목 뉴스를 받아 **종목 상세와 같은 열쇠**에 담는다.

    같은 열쇠를 쓰는 것이 요점이다 — 이 화면을 연 뒤 그 종목 상세를
    열면 곧바로 뜨고, 반대도 마찬가지다. 같은 것을 두 번 받지 않는다."""
    ck = f"stock_news:{시장}:{심볼}"
    try:
        항목 = _구글뉴스(이름 or 심볼) if 시장 == "KR" else _야후뉴스(심볼)
        if 항목:
            cache.set(ck, 항목, 종목뉴스_수명)
        else:
            # 빈손도 기억한다. 안 그러면 뉴스가 없는 종목을 매번 다시 받는다
            cache.set(f"{ck}:miss", True, 빈손수명)
    except Exception as e:
        log.debug("보유 뉴스 받기 실패 %s: %s", 심볼, type(e).__name__)
        cache.set(f"{ck}:miss", True, 60)
    finally:
        _받는중.discard(ck)


def _배경으로(대상: list[dict]) -> int:
    """캐시에 없는 종목을 배경 스레드에 맡긴다. 요청은 안 기다린다.

    돌려주는 것은 '지금 오는 중인 종목 수'. 화면이 그 수를 보고 몇 초
    뒤에 한 번 더 물어본다."""
    from app.core.executor import background_executor

    보낸수 = 0
    오는중 = 0
    for h in 대상:
        심볼, 시장 = str(h.get("symbol")), str(h.get("market"))
        ck = f"stock_news:{시장}:{심볼}"
        if cache.get(ck) is not None or cache.get(f"{ck}:miss"):
            continue                       # 이미 있거나 방금 빈손이었다
        if ck in _받는중:
            오는중 += 1
            continue
        if 보낸수 >= 한번에:
            오는중 += 1                    # 이번엔 못 보냈지만 다음 요청에 간다
            continue
        _받는중.add(ck)
        try:
            background_executor.submit(_한종목_받기, 심볼, 시장, str(h.get("name") or 심볼))
            보낸수 += 1
            오는중 += 1
        except Exception:
            # 풀이 닫혔다든지. 표시를 남겨 두면 그 종목이 영영 안 온다
            _받는중.discard(ck)
    return 오는중


def _고르기(보유: list[dict]) -> tuple[list[dict], list[str]]:
    """이미 받아 둔 것에서 내 종목 기사를 골라낸다. 외부 호출 없음."""
    # 종합 뉴스는 캐시에서만 읽는다. get_kr_news() 를 부르면 캐시가 비었을
    # 때 그 자리에서 RSS 를 훑는 갈래로 빠질 수 있다 — 그건 이 화면이
    # 하지 않기로 한 일이다
    종합: list[dict] = []
    for ck in ("news:kr", "news:us"):
        종합 += (cache.get(ck) or cache.get_stale(ck) or [])

    모은것: dict[str, dict] = {}          # 제목열쇠 → 기사
    본주소: set[str] = set()
    찾은종목: set[str] = set()

    def 담기(기사: dict, 심볼: str) -> bool:
        주소 = 기사.get("link")
        if not 주소:
            return False
        키 = _제목열쇠(기사.get("title", "")) or 주소
        이미 = 모은것.get(키)
        if 이미 is not None:
            # 같은 기사가 다른 종목으로도 걸렸으면 종목만 덧붙인다
            if 심볼 not in 이미["symbols"]:
                이미["symbols"].append(심볼)
            return False
        if 주소 in 본주소:
            return False
        본주소.add(주소)
        모은것[키] = {
            "title": 기사.get("title", ""),
            "link": 주소,
            "source": 기사.get("source", ""),
            "published": 기사.get("published", ""),
            "published_ts": _시각(기사.get("published_ts") or 기사.get("_ts")),
            "summary": 기사.get("summary", ""),
            "image": 기사.get("image"),
            "symbols": [심볼],
        }
        return True

    # 여기 오는 목록은 모으기() 가 이미 종목코드로 걸러 둔 것이다.
    # 한 번 더 거르는 줄이 있었는데, 뮤테이션을 돌려 보니 그 줄을 통째로
    # 지워도 아무 검사가 안 깨졌다 — 실행될 일이 없는 방어였다.
    # 거르는 자리는 한 곳(모으기)이어야 어디를 고쳐야 하는지가 분명하다.
    for h in 보유:
        심볼 = str(h.get("symbol") or "")
        시장 = str(h.get("market") or "")
        말들 = _검색어(심볼, str(h.get("name") or ""), 시장)
        if not 말들:
            continue
        담은수 = 0

        # 1) 그 종목 상세를 누가 열어 뒀으면 그 캐시가 제일 정확하다
        for 기사 in (cache.get(f"stock_news:{시장}:{심볼}") or [])[:종목당_최대]:
            if 담기(기사, 심볼):
                담은수 += 1

        # 2) 종합 뉴스에서 이름으로 골라낸다
        for 기사 in 종합:
            if 담은수 >= 종목당_최대:
                break
            제목 = 기사.get("title", "")
            요약 = 기사.get("summary", "")
            if any(_맞나(w, 제목) or _맞나(w, 요약) for w in 말들):
                if 담기(기사, 심볼):
                    담은수 += 1

        if 담은수 > 0 or any(심볼 in v["symbols"] for v in 모은것.values()):
            찾은종목.add(심볼)

    기사들 = list(모은것.values())
    # 최신순. 여기서 published_ts 가 전부 float 이라 섞여도 안전하다
    기사들.sort(key=lambda a: a["published_ts"], reverse=True)
    # 사진 있는 것을 앞으로 — 없는 것을 버리지는 않는다(뉴스 탭과 같은 규칙)
    기사들 = [a for a in 기사들 if a.get("image")] + [a for a in 기사들 if not a.get("image")]
    return 기사들[:최대건수], sorted(찾은종목)


def 모으기(보유: list[dict]) -> dict:
    """보유 종목 뉴스.

    보유: [{"symbol": "005930", "market": "KR", "name": "삼성전자"}, ...]

    돌려주는 것
      items    기사 목록. 각 기사에 symbols(어느 종목으로 걸렸나)가 붙는다
      covered  기사를 찾은 종목
      missing  아직 기사를 못 찾은 종목 — 숨기지 않는다
      pending  지금 배경에서 받아 오는 중인 종목 수. 0 보다 크면 화면이
               몇 초 뒤에 한 번 더 물어본다
    """
    빈답 = {"items": [], "covered": [], "missing": [], "pending": 0}
    쓸것 = [h for h in 보유 if _종목코드.match(str(h.get("symbol") or ""))]
    if not 쓸것:
        return 빈답

    ck = 열쇠(쓸것)
    담긴것 = cache.get(ck)
    if 담긴것 is not None and not 담긴것.get("pending"):
        # 다 채워진 답만 캐시에서 그대로 준다. 아직 오는 중이면 다시 센다 —
        # 안 그러면 배경이 채워 놓은 것을 5분 동안 못 보여 준다
        return 담긴것

    try:
        기사들, 찾음 = _고르기(쓸것)
    except Exception as e:                                # pragma: no cover - 방어
        log.warning("보유 뉴스 모으기 실패: %s", e)
        return 빈답

    찾은것 = set(찾음)
    # 아직 기사를 못 찾은 종목만 배경에 맡긴다
    오는중 = _배경으로([h for h in 쓸것 if str(h["symbol"]) not in 찾은것])

    답 = {
        "items": 기사들,
        "covered": 찾음,
        "pending": 오는중,
        # 심볼만 주면 화면이 그 종목으로 갈 수가 없다 — 종목 상세 주소는
        # /stocks/{market}/{symbol} 이라 시장을 모르면 국내 종목을
        # 미국 종목으로 열게 된다
        "missing": [
            {"symbol": str(h["symbol"]), "market": str(h["market"]), "name": str(h.get("name") or h["symbol"])}
            for h in sorted(쓸것, key=lambda x: str(x["symbol"]))
            if str(h["symbol"]) not in 찾은것
        ],
    }
    # 아직 오는 중이면 짧게만 담는다. 5분을 담아 두면 배경이 채워 놓은
    # 것을 그동안 못 보여 준다
    cache.set(ck, 답, TTL if not 오는중 else 20)
    return 답
