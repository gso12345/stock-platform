"""
외부에서 들어온 주소를 화면에 내보내기 전에 걸러내는 로직.

뉴스 기사의 링크·이미지는 언론사 RSS가 주는 값이고, 팝업 배너 링크는 관리자가
입력한 값이다. 검증이 뚫리면 사용자가 그 링크를 누르는 순간 우리 사이트 권한으로
코드가 실행될 수 있다(브라우저에 로그인 토큰이 있으므로 계정 탈취까지 이어진다).

보안 코드는 나중에 누가 손대도 조용히 뚫리면 안 되므로 테스트로 못 박아 둔다.
"""
import pytest
from fastapi import HTTPException

from app.services.news_service import _safe_url
from app.api.routes.admin import _safe_link_url
from app.api.routes.community import _validate_uploaded_image


# ── 뉴스 링크·이미지 (외부 RSS) ────────────────────────────────
class TestNewsUrl:
    @pytest.mark.parametrize("url", [
        "https://news.naver.com/article/1",
        "http://example.com/a.jpg",
        "https://img.example.com/a.jpg?w=200&h=100",
        "https://한글도메인.kr/기사",
    ])
    def test_정상_주소는_통과한다(self, url):
        assert _safe_url(url) == url

    @pytest.mark.parametrize("url", [
        "HTTPS://example.com/a",
        "Http://example.com/a",
        "HtTpS://example.com/a",
    ])
    def test_스킴이_대문자여도_통과한다(self, url):
        # 스킴은 대소문자를 가리지 않는다(RFC 3986). 이걸 놓치면 대문자로 쓴
        # 정상 주소가 통째로 차단돼 기사가 사라진다
        assert _safe_url(url) == url

    def test_스킴만_생략한_주소는_https로_살린다(self):
        # RSS에 흔한 형태다. 예전에 이걸 막았더니 이미지가 있는 기사가
        # 통째로 걸러져 국내 뉴스 목록이 100건 → 96건으로 줄었다
        assert _safe_url("//img.example.com/a.jpg") == "https://img.example.com/a.jpg"

    @pytest.mark.parametrize("url, 설명", [
        ("javascript:alert(document.cookie)", "스크립트 실행"),
        ("JaVaScRiPt:alert(1)",               "대소문자 섞기"),
        ("java\nscript:alert(1)",             "개행 끼워넣기"),
        ("java\tscript:alert(1)",             "탭 끼워넣기"),
        ("  javascript:alert(1)  ",           "앞뒤 공백"),
        ("java\x00script:alert(1)",           "널문자 끼워넣기"),
        ("data:text/html,<script>alert(1)</script>", "data URL"),
        ("vbscript:msgbox(1)",                "VBScript"),
        ("file:///etc/passwd",                "로컬 파일"),
        ("/relative/path",                    "상대경로"),
        ("",                                  "빈 값"),
        (None,                                "값 없음"),
        (12345,                               "문자열이 아님"),
    ])
    def test_위험하거나_쓸_수_없는_주소는_막는다(self, url, 설명):
        assert _safe_url(url) is None, f"{설명}이(가) 통과했다"


# ── 팝업 배너 링크 (관리자 입력) ───────────────────────────────
class TestPopupLink:
    @pytest.mark.parametrize("url", [
        "https://event.example.com",
        "http://event.example.com/promo?id=1",
    ])
    def test_정상_링크는_그대로_저장된다(self, url):
        assert _safe_link_url(url) == url

    @pytest.mark.parametrize("url", ["HTTPS://event.example.com", "Http://event.example.com"])
    def test_스킴이_대문자여도_통과한다(self, url):
        assert _safe_link_url(url) == url

    def test_스킴_생략은_https로_보정한다(self):
        assert _safe_link_url("//event.example.com") == "https://event.example.com"

    @pytest.mark.parametrize("value", [None, "", "   "])
    def test_링크를_비우면_None이_된다(self, value):
        assert _safe_link_url(value) is None

    @pytest.mark.parametrize("url, 설명", [
        ("javascript:alert(document.cookie)", "스크립트 실행"),
        ("java\nscript:alert(1)",             "개행 우회"),
        ("data:text/html,x",                  "data URL"),
        ("/admin",                            "내부 경로"),
        (["https://a.com"],                   "문자열이 아님"),
    ])
    def test_위험한_링크는_422로_거부한다(self, url, 설명):
        # 관리자만 입력하지만 모든 사용자에게 노출되는 링크라
        # 계정이 탈취되면 피해 범위가 넓다
        with pytest.raises(HTTPException) as e:
            _safe_link_url(url)
        assert e.value.status_code == 422, 설명


# ── 게시글·프로필 이미지 (사용자 업로드) ───────────────────────
class TestUploadedImage:
    @pytest.mark.parametrize("mime", ["jpeg", "png", "gif", "webp"])
    def test_허용된_이미지_형식은_통과한다(self, mime):
        v = f"data:image/{mime};base64,AAAA"
        assert _validate_uploaded_image(v) == v

    def test_이미지를_안_넣으면_빈_값으로_통과한다(self):
        assert _validate_uploaded_image("") == ""

    def test_외부_주소는_막는다(self):
        # 외부 이미지를 넣으면 그 글을 보는 모든 사용자의 접속 정보가
        # 작성자가 지정한 서버로 전달돼 추적에 쓰일 수 있다
        with pytest.raises(HTTPException) as e:
            _validate_uploaded_image("https://evil.example.com/track.gif")
        assert e.value.status_code == 422

    @pytest.mark.parametrize("value, 설명", [
        ("data:text/html,<script>alert(1)</script>", "HTML 위장"),
        ("data:image/svg+xml,<svg onload=alert(1)>", "SVG (스크립트 실행 가능)"),
        ("javascript:alert(1)",                      "스크립트"),
        ("//evil.example.com/x.jpg",                 "스킴 생략 외부 주소"),
    ])
    def test_허용되지_않은_형식은_막는다(self, value, 설명):
        with pytest.raises(HTTPException) as e:
            _validate_uploaded_image(value)
        assert e.value.status_code == 422, 설명
