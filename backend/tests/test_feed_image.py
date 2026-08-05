"""
피드가 느리던 진짜 이유 — "피드 글 불러오는 속도가 너무 느려"

DB 쪽은 이미 손봤다(인덱스도 있고 공통 부분은 캐시한다). 그런데도 느렸다.

이미지가 base64 로 글 본문(content) 안에 들어 있는 것이 원인이었다. 피드
한 페이지가 글 20개면 이미지 20장이 통째로 같이 온다. 화면에서는 높이
192px 로 잘라 보여줄 뿐인데 원본을 다 받는 셈이라, 목록 한 번에 수 MB 가
오갔다. 느린 회선에서는 이게 전부다.

그래서 목록에서는 이미지를 빼고 '있다'는 표시만 보낸다. 이미지는 카드가
화면에 들어올 때 따로 받고, 브라우저가 캐시한다.

여기서 못 박는 것 —
  1) 목록 응답에 이미지 본체가 없다 (이게 무너지면 느린 상태로 돌아간다)
  2) 대신 '있다'는 것은 알려준다 (모르면 자리를 못 잡는다)
  3) 따로 받는 자리가 실제로 그 이미지를 준다
  4) 저장된 값이 깨져도 글이 통째로 죽지 않는다
"""
import base64

import pytest

from app.api.routes import community as C

# 1×1 픽셀 JPEG
_픽셀 = base64.b64encode(bytes.fromhex(
    "ffd8ffdb004300ff"
)).decode()
_이미지 = f"data:image/jpeg;base64,{_픽셀}"


class _가짜사용자:
    id = 7
    username = "나"


class _가짜글:
    def __init__(self, content, pid=1):
        self.id = pid
        self.user_id = 7
        self.symbol = "005930"
        self.market = "KR"
        self.content = content
        self.like_count = 0
        self.view_count = 0
        self.likes = []
        self.user = _가짜사용자()
        import datetime as _d
        self.created_at = _d.datetime(2026, 1, 1)


def _글(이미지=_이미지):
    return _가짜글(C.encode_content("제목", "본문", 이미지))


class Test목록은_가볍게:
    def test_이미지빼기를_켜면_본체가_안_나간다(self):
        """이게 무너지면 피드가 다시 수 MB 가 된다."""
        r = C._ser_post(_글(), None, None, profiles_map={}, comment_counts={},
                        following_ids=set(), poll_votes_map={}, liked_ids=set(),
                        이미지빼기=True)
        assert r["image"] == ""

    def test_그래도_있다는_것은_알려준다(self):
        """모르면 화면이 자리를 못 잡고, 이미지가 뒤늦게 끼어들며 글이 밀린다."""
        r = C._ser_post(_글(), None, None, profiles_map={}, comment_counts={},
                        following_ids=set(), poll_votes_map={}, liked_ids=set(),
                        이미지빼기=True)
        assert r["has_image"] is True

    def test_이미지가_없는_글은_없다고_한다(self):
        r = C._ser_post(_글(이미지=""), None, None, profiles_map={}, comment_counts={},
                        following_ids=set(), poll_votes_map={}, liked_ids=set(),
                        이미지빼기=True)
        assert r["has_image"] is False

    def test_안_켜면_예전처럼_그대로_보낸다(self):
        """글 상세는 한 건이라 같이 보내도 된다. 목록만 빼는 것이다."""
        r = C._ser_post(_글(), None, None, profiles_map={}, comment_counts={},
                        following_ids=set(), poll_votes_map={}, liked_ids=set())
        assert r["image"] == _이미지

    def test_피드가_실제로_빼고_보낸다(self):
        """부품이 옵션을 갖고 있어도 피드가 안 쓰면 소용없다."""
        import inspect
        본문 = inspect.getsource(C.get_feed)
        assert "이미지빼기=True" in 본문, "피드가 이미지를 그대로 보내고 있다"


class Test따로_받는_자리:
    def test_라우트가_등록돼_있다(self):
        길 = {getattr(r, "path", "") for r in C.router.routes}
        assert "/community/posts/{post_id}/image" in 길 or \
               any(p.endswith("/posts/{post_id}/image") for p in 길), 길

    def test_캐시하라고_알려준다(self):
        """이미지는 바뀌지 않는다. 매번 다시 받으면 따로 뺀 뜻이 없다."""
        import inspect
        본문 = inspect.getsource(C.get_post_image)
        assert "Cache-Control" in 본문
        assert "max-age" in 본문

    def test_허용한_형식만_내보낸다(self):
        """본문에 담긴 값을 그대로 Content-Type 으로 쓰면, 누가 넣은
        'text/html' 이 이미지인 척 브라우저에서 실행될 수 있다."""
        import inspect
        본문 = inspect.getsource(C.get_post_image)
        assert "_SAFE_AVATAR_TYPES" in 본문

    def test_깨진_값에_500_을_내지_않는다(self):
        """500 이면 그 글 카드가 통째로 안 뜬다. 이미지 하나 때문에
        글을 못 읽게 만들 이유가 없다."""
        import inspect
        본문 = inspect.getsource(C.get_post_image)
        assert "except Exception" in 본문
        assert "status_code=404" in 본문


class Test이미지를_본문_밖으로:
    """응답에서만 빼는 것으로는 부족했다.

    이미지가 여전히 content 안에 있으면, 피드 SELECT 는 스무 건의 content 를
    통째로(약 2MB) 끌어와 json.loads 한다. 응답 크기만 줄었을 뿐 읽는 비용은
    그대로다. 그래서 컬럼으로 뺐다."""

    def test_목록_질의가_이미지를_안_읽는다(self):
        """defer 가 빠지면 다시 스무 장을 끌어온다 — 이게 핵심이다."""
        import inspect
        for 함수 in (C.get_feed, C.list_posts):
            본문 = inspect.getsource(함수)
            assert "defer(StockPost.image_data)" in 본문, f"{함수.__name__} 가 이미지를 읽는다"

    def test_저장할_때_컬럼으로_뺀다(self):
        import inspect
        본문 = inspect.getsource(C.create_post)
        assert "_이미지쪼개기" in 본문
        assert "image_data" in 본문
        # 쪼개졌으면 본문에서는 빼야 한다. 둘 다 넣으면 두 배로 무거워진다
        assert '"" if 바이트 else image_val' in 본문

    def test_원본_바이트로_넣는다(self):
        """base64 는 3바이트를 4글자로 부풀린다. 저장도 33% 더 먹고,
        내보낼 때마다 디코딩해야 한다."""
        형식, 바이트 = C._이미지쪼개기(_이미지)
        assert 형식 == "image/jpeg"
        assert isinstance(바이트, bytes)
        assert 바이트 == base64.b64decode(_픽셀)

    def test_허용하지_않는_형식은_안_쪼갠다(self):
        """'data:image/svg+xml' 은 스크립트를 품을 수 있다."""
        형식, 바이트 = C._이미지쪼개기("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=")
        assert (형식, 바이트) == (None, None)

    def test_이상한_값에_터지지_않는다(self):
        for 값 in ("", "그냥글자", "data:image/jpeg;base64,!!!깨짐!!!", None):
            assert C._이미지쪼개기(값) == (None, None), 값

    def test_옛_글도_계속_보인다(self):
        """이미 저장된 글은 아직 content 안에 이미지가 있다. 컬럼만 보면
        예전 글의 이미지가 통째로 사라진다."""
        import inspect
        본문 = inspect.getsource(C.get_post_image)
        assert "decode_content" in 본문, "옛 글 폴백이 사라졌다"
        본문2 = inspect.getsource(C._ser_post)
        assert 'or parsed.get("image")' in 본문2, "옛 글의 has_image 가 항상 거짓이 된다"

    def test_이미지는_gzip_을_건너뛴다(self):
        """JPEG 은 이미 압축돼 있다. gzip 이 형식을 안 가리고 level 9 로
        한 번 더 누르는데, 줄지도 않으면서 CPU 0.15개를 먹는다."""
        import inspect
        본문 = inspect.getsource(C.get_post_image)
        assert '"Content-Encoding": "identity"' in 본문
