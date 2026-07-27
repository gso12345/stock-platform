"""
응답과 요청의 무게 — 첨부 이미지 상한, 오류 메시지, 좋아요 조회 방식.

셋 다 "동작은 하는데 규모가 커지면 무너지는" 종류라 테스트가 없으면
고쳐 놓아도 다음 수정에서 조용히 되돌아간다.
"""
import inspect
import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.api.routes import community as C
from app.api.routes.community import (
    PostCreate, PostUpdate, ProfileUpdate,
    _validate_uploaded_image, _IMAGE_MAX_CHARS,
)

작은사진 = "data:image/jpeg;base64," + "A" * 200_000     # 화면이 실제로 만드는 크기
# 상한이 터무니없이 커지면 아래에서 그 크기만큼 문자열을 만들다 테스트가 멈춘다.
# 상한 자체가 의미 있는 범위인지 먼저 확인하고 그 안에서만 큰 값을 만든다
_상한_최대 = 4_000_000
큰사진 = "data:image/jpeg;base64," + "A" * (min(_IMAGE_MAX_CHARS, _상한_최대) + 1)


class Test첨부_이미지_크기:
    def test_상한이_의미_있는_범위에_있다(self):
        # 화면이 만드는 크기(약 200KB)보다는 크고, 피드 응답을 망칠 만큼
        # 크지는 않아야 한다
        assert 300_000 < _IMAGE_MAX_CHARS <= _상한_최대, (
            f"이미지 상한이 {_IMAGE_MAX_CHARS}자다 — 사실상 제한이 없거나 너무 빡빡하다"
        )

    def test_화면이_만드는_크기는_통과한다(self):
        # 800px·품질 0.7 JPEG는 보통 200KB 안쪽이다
        assert _validate_uploaded_image(작은사진) == 작은사진
        assert PostCreate(body="사진 글", image=작은사진).image == 작은사진

    def test_상한을_넘는_사진은_막는다(self):
        # 글 이미지에는 상한이 아예 없었다. API를 직접 부르면 수십 MB짜리 글을
        # 만들 수 있었고, 그 글은 목록에 뜨는 것만으로 모든 사용자의 피드
        # 응답에 그대로 실려 나간다
        with pytest.raises(HTTPException) as e:
            _validate_uploaded_image(큰사진)
        assert e.value.status_code == 422

    @pytest.mark.parametrize("모델, 필드", [
        (PostCreate,    "image"),
        (PostUpdate,    "image"),
        (ProfileUpdate, "avatar_url"),
    ])
    def test_스키마_단계에서도_걸린다(self, 모델, 필드):
        # 검증 함수까지 가기 전에 막아야 거대한 본문을 파싱하지 않는다
        with pytest.raises(ValidationError):
            모델(**{"body": "x", 필드: 큰사진})

    def test_글과_프로필이_같은_상한을_쓴다(self):
        # 예전에는 프로필 사진에만 상한이 있었다
        한도 = ProfileUpdate.model_fields["avatar_url"].metadata
        assert any(getattr(m, "max_length", None) == _IMAGE_MAX_CHARS for m in 한도)


class Test오류_메시지:
    def test_DB_오류_원문이_사용자에게_가지_않는다(self):
        # 예전에는 예외 원문을 그대로 돌려줘 테이블·컬럼 구조가 노출됐다
        src = inspect.getsource(C.create_post)
        assert "type(e).__name__" not in src
        assert "str(e)" not in src
        assert "log.exception" in src, "원인을 서버 로그에도 안 남기면 디버깅이 불가능해진다"


class Test좋아요_조회:
    def test_목록은_좋아요_행을_통째로_읽지_않는다(self):
        # 좋아요 5천 개짜리 글이 한 페이지에 몇 개만 있어도 수만 행을 읽었다.
        # 화면에 필요한 건 '내가 눌렀는가' 한 줄뿐이다
        전체 = inspect.getsource(C)
        assert "selectinload(StockPost.likes)" not in 전체
        assert "selectinload(StockComment.likes)" not in 전체

    @pytest.mark.parametrize("함수명, 헬퍼", [
        ("get_feed",       "_liked_post_ids"),
        ("list_posts",     "_liked_post_ids"),
        ("get_post",       "_liked_post_ids"),
        ("list_comments",  "_liked_comment_ids"),
    ])
    def test_내가_누른_것만_조회한다(self, 함수명, 헬퍼):
        assert 헬퍼 in inspect.getsource(getattr(C, 함수명))

    def test_비로그인은_질의조차_하지_않는다(self):
        class _NoQuery:
            def query(self, *a, **k): raise AssertionError("비로그인인데 좋아요를 조회했다")
        assert C._liked_post_ids(_NoQuery(), None, [1, 2, 3]) == set()
        assert C._liked_comment_ids(_NoQuery(), None, [1, 2, 3]) == set()

    def test_대상이_없으면_질의하지_않는다(self):
        class _NoQuery:
            def query(self, *a, **k): raise AssertionError("빈 목록인데 조회했다")
        assert C._liked_post_ids(_NoQuery(), 1, []) == set()
