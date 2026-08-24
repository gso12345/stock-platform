"""뉴스 썸네일 주소 — 서버가 '있다' 고 센 것이 화면에도 떠야 한다.

"국내뉴스기사중 이미지 안나오는 거 있어" 의 조용한 원인.

사이트는 https 로 열리는데 <img src="http://..."> 를 그리면 브라우저가
혼합 콘텐츠라며 통째로 막는다. 오류도 안 뜨고 그냥 빈 자리가 된다.
서버 쪽에서는 더 나쁘다 — 주소가 있으니 '사진 있는 기사' 로 세어
필터를 통과시키는데 화면에서는 안 보인다. 세는 것과 보이는 것이 어긋난다.
"""
from app.services.news_service import _이미지주소, _safe_url


class Test이미지주소:
    def test_http는_https로_올린다(self):
        assert _이미지주소("http://img.example.com/a.jpg") == \
            "https://img.example.com/a.jpg"

    def test_대문자로_와도_올린다(self):
        assert _이미지주소("HTTP://img.example.com/a.jpg") == \
            "https://img.example.com/a.jpg"

    def test_이미_https면_그대로_둔다(self):
        주소 = "https://img.example.com/a.jpg"
        assert _이미지주소(주소) == 주소

    def test_스킴만_생략한_주소는_https로_읽는다(self):
        assert _이미지주소("//img.example.com/a.jpg") == \
            "https://img.example.com/a.jpg"

    def test_주소_안의_http는_안_건드린다(self):
        """?url=http://... 처럼 뒤쪽에 http 가 들어간 주소가 흔하다."""
        주소 = "https://cdn.example.com/resize?url=http://o.example.com/a.jpg"
        assert _이미지주소(주소) == 주소

    def test_실행_가능한_스킴은_예전처럼_막는다(self):
        """혼합 콘텐츠를 고치면서 보안 검사를 헐겁게 만들면 안 된다."""
        for 나쁜것 in ("javascript:alert(1)", "data:text/html;base64,x",
                       "java\nscript:alert(1)", "/relative/path.jpg", "", None):
            assert _이미지주소(나쁜것) is None, 나쁜것

    def test_링크는_올리지_않는다(self):
        """이미지만 문제다. 링크는 브라우저가 그냥 이동하므로 http 라도
        멀쩡히 열린다 — 괜히 바꾸면 리다이렉트가 한 번 더 붙는다."""
        assert _safe_url("http://news.example.com/1") == "http://news.example.com/1"


class Test기사에_붙는_주소:
    def test_기사_이미지가_https로_들어온다(self, monkeypatch):
        import httpx
        import app.services.news_service as ns

        monkeypatch.setattr(ns, "_extract_thumbnail",
                            lambda e: "http://img.example.com/a.jpg")

        class _응답:
            status_code = 200
            content = b"<rss/>"

        monkeypatch.setattr(httpx, "get", lambda *a, **k: _응답())

        class _F:
            entries = [{"title": "삼성전자 실적 발표",
                        "link": "https://news.example.com/1",
                        "summary": "", "published_parsed": None}]
            bozo = 0

        monkeypatch.setattr(ns.feedparser, "parse", lambda *a, **k: _F())
        기사들 = ns._parse_feed("https://feed.example.com/rss", "테스트사", 5)
        assert 기사들, "기사가 하나는 나와야 이 시험이 뜻이 있다"
        assert 기사들[0]["image"] == "https://img.example.com/a.jpg"
