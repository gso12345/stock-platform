"""
뉴스 수집이 왜 실패하는지 알 수 있게 된 자리.

관리자 화면에 "최근 실패한 언론사" 로 20곳 가까이 떠 있었는데, 마우스를
올려 보면 무엇이든 똑같이 "기사 0건 (필터에서 전부 제외)" 라고 나왔다.
원인이 셋이었다.

  1) _parse_feed 가 `except Exception: return []` 로 모든 예외를 삼켰다.
     타임아웃도, 403 차단도, 없어진 도메인도, 정말로 필터에 걸린 것도
     전부 '빈 목록' 이 되어 부르는 쪽에서 구분할 수 없었다.
     그래서 아래 `except` 절(실패 집계)은 사실상 죽은 코드였다.

  2) 언론사별 성공을 기록하지 않았다. 실패 수만 쌓이니, 한참 전에 실패하고
     그 뒤로 계속 성공한 곳도 화면에 영원히 '실패' 로 남았다.
     '최근 실패' 라고 써 놓고 '역대 실패한 적 있음' 을 보여 준 셈이다.

  3) MAX_TRACKED 가 60인데 언론사만 국내 49 + 해외 8이라, 오래된 항목부터
     소리 없이 밀려나 목록이 늘 일부만 보였다.

여기서 못 박는 것은 '이유가 구분되는가' 다. 실제 HTTP 응답을 만들어 건다 —
글자만 맞춰 보면 예외를 다시 삼켜도 통과해 버린다.
"""
import threading
import time
from email.utils import formatdate
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

pytest.importorskip("httpx")
pytest.importorskip("feedparser")

from app.core import health  # noqa: E402
from app.services import news_service as N  # noqa: E402

_경제기사 = """<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>코스피 상승 마감</title><link>https://example.com/1</link>
<pubDate>{언제}</pubDate></item>
</channel></rss>"""

_비경제기사 = """<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>오늘 날씨</title><link>https://example.com/9</link></item>
</channel></rss>""".encode()

_안내페이지 = b"<html><body>This feed has been retired.</body></html>"


class _손님(BaseHTTPRequestHandler):
    """언론사 서버가 낼 만한 응답을 흉내 낸다."""

    def log_message(self, *a):
        pass

    def do_GET(self):
        길 = self.path
        if 길.startswith("/ok"):
            self._보내기(200, _경제기사.format(언제=formatdate(time.time(), usegmt=True)).encode())
        elif 길.startswith("/403"):
            self._보내기(403, b"forbidden")
        elif 길.startswith("/404"):
            self._보내기(404, b"not found")
        elif 길.startswith("/429"):
            self._보내기(429, b"slow down")
        elif 길.startswith("/html"):
            self._보내기(200, _안내페이지)
        elif 길.startswith("/filtered"):
            self._보내기(200, _비경제기사)
        elif 길.startswith("/slow"):
            # 응답을 붙들고 있는 서버. 타임아웃 경로를 실제로 태우려면
            # 글자 검사가 아니라 이렇게 진짜로 기다려 봐야 한다
            time.sleep(3)
            self._보내기(200, b"<rss/>")
        else:
            self._보내기(404, b"?")

    def _보내기(self, 코드, 몸):
        self.send_response(코드)
        self.send_header("Content-Length", str(len(몸)))
        self.end_headers()
        self.wfile.write(몸)


@pytest.fixture(scope="module")
def 서버():
    # 스레드형이어야 한다 — /slow 하나가 서버를 붙들면 뒤 검사가 전부 막힌다
    s = ThreadingHTTPServer(("127.0.0.1", 0), _손님)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{s.server_port}"
    s.shutdown()


@pytest.fixture(autouse=True)
def _프록시_비우기(monkeypatch):
    """이 환경은 바깥으로 나갈 때 프록시를 거치는데,
    127.0.0.1 까지 프록시로 보내면 테스트가 통째로 막힌다."""
    for k in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"):
        monkeypatch.delenv(k, raising=False)


class Test실패이유를_구분하는가:
    """예전에는 무엇이든 '기사 0건' 하나였다."""

    def test_정상이면_기사를_돌려준다(self, 서버):
        assert len(N._parse_feed(f"{서버}/ok", "테스트", limit=5)) == 1

    @pytest.mark.parametrize("길,들어갈말", [
        ("/403", "403"),
        ("/404", "404"),
        ("/429", "429"),
    ])
    def test_HTTP_오류는_상태코드를_알려_준다(self, 서버, 길, 들어갈말):
        with pytest.raises(N.피드실패) as e:
            N._parse_feed(f"{서버}{길}", "테스트", limit=5)
        assert 들어갈말 in str(e.value)

    def test_차단과_경로변경을_말로_구분한다(self, 서버):
        """숫자만 주면 무엇을 해야 할지 모른다 — 기다릴 일인지
        주소를 고칠 일인지가 갈린다."""
        with pytest.raises(N.피드실패) as 차단:
            N._parse_feed(f"{서버}/403", "테스트")
        with pytest.raises(N.피드실패) as 경로:
            N._parse_feed(f"{서버}/404", "테스트")
        assert "차단" in str(차단.value)
        assert "경로" in str(경로.value)

    def test_RSS_가_아니면_그렇게_말한다(self, 서버):
        """200 인데 안내 페이지(HTML)를 주는 곳이 있다.
        RSS 를 닫은 매체에서 흔하다."""
        with pytest.raises(N.피드실패) as e:
            N._parse_feed(f"{서버}/html", "테스트")
        assert "RSS" in str(e.value)

    def test_필터에_걸린_것은_오류와_다르게_말한다(self, 서버):
        """이건 주소 문제가 아니라 필터를 손봐야 하는 신호다.
        섞어 놓으면 멀쩡한 언론사를 목록에서 빼게 된다."""
        with pytest.raises(N.피드실패) as e:
            N._parse_feed(f"{서버}/filtered", "테스트")
        assert "통과 0건" in str(e.value)

    def test_연결_자체가_안_되면_그렇게_말한다(self):
        with pytest.raises(N.피드실패) as e:
            N._parse_feed("http://127.0.0.1:1/rss", "테스트")
        assert "연결" in str(e.value) or "거부" in str(e.value)

    def test_빈_목록을_조용히_돌려주지_않는다(self, 서버):
        """이 성질이 무너지면 나머지가 전부 무의미해진다 —
        부르는 쪽이 실패를 알아챌 방법이 없어진다."""
        for 길 in ("/403", "/404", "/html", "/filtered"):
            with pytest.raises(N.피드실패):
                N._parse_feed(f"{서버}{길}", "테스트")


class Test기다리는_시간:
    def test_기다리다_지치면_그렇게_말한다(self, 서버, monkeypatch):
        """글자로 확인하면 안 되는 자리다.

        뮤테이션에서 이 갈래만 `return []` 로 되돌렸을 때 테스트가 통째로
        빠져나갔다 — 타임아웃 경로를 실제로 태운 검사가 하나도 없었기
        때문이다. 그래서 진짜로 붙들고 있는 서버에 건다.
        (10초를 다 기다리면 검사가 느려지므로 1초로 줄여서 태운다)"""
        monkeypatch.setattr(N, "_FEED_TIMEOUT", 1)
        시작 = time.time()
        with pytest.raises(N.피드실패) as e:
            N._parse_feed(f"{서버}/slow", "테스트")
        assert "응답 없음" in str(e.value)
        assert time.time() - 시작 < 2.5, "제 시간에 포기하지 않는다"

    def test_5초보다_넉넉하다(self):
        """CPU 0.15개에서 워커 6개가 나눠 쓰면 5초는 빠듯하다.
        위쪽 예산(as_completed 40초, 개별 12초) 안에서 늘린 값이다."""
        assert 8 <= N._FEED_TIMEOUT <= 10

    def test_개별_대기_예산에_여유를_남긴다(self):
        """_fetch_all_feeds 가 future.result(timeout=12) 로 기다린다.

        '작기만 하면 된다'로는 모자란다 — 11초로 잡으면 형식상 12보다
        작지만, 응답을 받은 뒤 파싱하는 시간에 곧바로 잘린다.
        받아온 다음에 할 일이 남아 있으므로 여유가 있어야 한다."""
        import re, pathlib
        본문 = pathlib.Path(N.__file__).read_text(encoding="utf-8")
        m = re.search(r"future\.result\(timeout=(\d+)\)", 본문)
        assert m, "개별 대기 시간을 못 찾음"
        예산 = int(m.group(1))
        assert N._FEED_TIMEOUT <= 예산 - 2, \
            f"피드 {N._FEED_TIMEOUT}초 / 예산 {예산}초 — 파싱할 틈이 없다"


class Test화면에_보이는_값:
    def test_성공하면_연속실패가_0으로_돌아간다(self, 서버):
        """이게 없으면 '최근 실패' 가 '역대 실패한 적 있음' 이 된다."""
        health.reset()
        N._fetch_all_feeds([("살아난곳", f"{서버}/403")], 5, batch=1)
        전 = {x["name"]: x for x in health.snapshot()}["뉴스:살아난곳"]
        assert 전["streak"] == 1

        N._fetch_all_feeds([("살아난곳", f"{서버}/ok")], 5, batch=1)
        후 = {x["name"]: x for x in health.snapshot()}["뉴스:살아난곳"]
        assert 후["streak"] == 0, "성공했는데 아직 '실패 중' 으로 보인다"
        assert 후["fail"] == 1, "누적치까지 지우면 성공률을 낼 수 없다"

    def test_언론사마다_다른_이유가_남는다(self, 서버):
        health.reset()
        N._fetch_all_feeds([
            ("되는곳",   f"{서버}/ok"),
            ("차단",     f"{서버}/403"),
            ("경로변경", f"{서버}/404"),
            ("필터",     f"{서버}/filtered"),
        ], 5, batch=4)
        h = {x["name"]: x for x in health.snapshot()}
        이유 = {n: h[f"뉴스:{n}"]["last_error"] for n in ("차단", "경로변경", "필터")}
        assert len(set(이유.values())) == 3, f"이유가 뭉뚱그려졌다: {이유}"
        assert h["뉴스:되는곳"]["streak"] == 0

    def test_오류와_0건을_나눠_센다(self, 서버):
        """예전에는 '14/14곳 성공' 인데 화면에는 2곳만 뜨는 일이 있었다."""
        health.reset()
        N._fetch_all_feeds([
            ("되는곳", f"{서버}/ok"),
            ("필터",   f"{서버}/filtered"),
            ("차단",   f"{서버}/403"),
        ], 5, batch=3)
        요약 = {x["name"]: x for x in health.snapshot()}["뉴스 수집"]["detail"]
        assert "1곳은 0건" in 요약 and "1곳 오류" in 요약, 요약

    def test_기사는_성공한_곳에서만_온다(self, 서버):
        기사 = N._fetch_all_feeds([
            ("되는곳", f"{서버}/ok"),
            ("차단",   f"{서버}/403"),
        ], 5, batch=2)
        assert len(기사) == 1


class Test추적_칸수:
    def test_언론사_전부를_담을_수_있다(self):
        """60이었다. 국내 49 + 해외 8 에 지수·환율 같은 항목이 더해지면
        넘쳐서 오래된 것부터 소리 없이 밀려났다."""
        필요 = len(N.KR_FEEDS) + len(N.US_FEEDS)
        assert health.MAX_TRACKED >= 필요 + 30, \
            f"언론사만 {필요}곳인데 {health.MAX_TRACKED}칸뿐이다"


class Test죽은_주소를_뺐는가:
    """30회차 동안 30번, 즉 100% 실패하던 여섯 곳."""

    @pytest.mark.parametrize("이름", [
        "MarketWatch", "WSJ Markets", "WSJ Economy",
        "Barron's", "Forbes Business", "The Street",
    ])
    def test_공개_RSS_를_닫은_곳은_빠졌다(self, 이름):
        assert 이름 not in [n for n, _ in N.US_FEEDS]

    @pytest.mark.parametrize("도메인", ["feeds.a.dj.com", "dowjones.io", "barrons.com"])
    def test_다우존스_계열_주소가_남아_있지_않다(self, 도메인):
        # 이름만 지우고 주소를 다른 이름으로 남겨 두면 그대로 또 실패한다
        assert not any(도메인 in u for _, u in N.US_FEEDS)

    def test_살아_있던_곳은_그대로_둔다(self):
        남은것 = [n for n, _ in N.US_FEEDS]
        for 이름 in ("Yahoo Finance", "CNBC Economy", "Seeking Alpha", "Business Insider"):
            assert 이름 in 남은것, f"{이름} 은 성공하고 있었는데 빠졌다"

    def test_주소가_겹치지_않는다(self):
        주소 = [u for _, u in N.KR_FEEDS + N.US_FEEDS]
        assert len(주소) == len(set(주소)), "같은 주소를 두 번 긁는다"
