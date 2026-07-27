"""
블라인드 처리된 글·댓글에 접근하는 모든 경로, 그리고 쓰기 요청 제한.

블라인드는 신고가 쌓이거나 관리자가 가린 상태다. 그런데 예전에는 '목록에서
빼는 것'만 구현돼 있었다. 목록에서 사라진 글도 주소만 알면 그대로 읽혔고
좋아요·댓글·투표가 계속 달렸다. 가려도 가려지지 않았다는 뜻이다.

한 군데만 고치면 나머지가 남으므로, 접근 경로를 전부 한 테스트에 모아 둔다.
"""
import inspect
import pytest

from app.api.routes import community as C


# ── 블라인드 조건이 모든 경로에 붙어 있는가 ───────────────────
#
# 조건은 SQL 문자열과 필터 튜플로 들어가 있어서, 실제 차단 여부는 PostgreSQL을
# 띄워 확인했다(현금 포함 포트폴리오 공유, 블라인드 후 5개 경로 전부 404).
# 여기서는 그 조건이 각 경로에서 빠지지 않았는지를 붙잡아 둔다 —
# 한 곳만 빼먹어도 오류 없이 조용히 뚫리는 종류의 회귀이기 때문이다.

_글_접근_경로 = [
    "get_post",            # 단건 조회
    "toggle_post_like",    # 좋아요
    "create_comment",      # 댓글 작성
    "vote_poll",           # 투표
    "get_user_activity",   # 프로필 활동 목록
]
_댓글_접근_경로 = [
    "toggle_comment_like",
    "create_comment",      # 부모 댓글 확인
    "get_user_activity",
]


@pytest.mark.parametrize("함수명", _글_접근_경로)
def test_글_접근_경로는_블라인드를_거른다(함수명):
    src = inspect.getsource(getattr(C, 함수명))
    assert "_POST_VISIBLE" in src, f"{함수명}이 블라인드된 글을 그대로 통과시킨다"


@pytest.mark.parametrize("함수명", _댓글_접근_경로)
def test_댓글_접근_경로는_블라인드를_거른다(함수명):
    src = inspect.getsource(getattr(C, 함수명))
    assert "_COMMENT_VISIBLE" in src, f"{함수명}이 블라인드된 댓글을 그대로 통과시킨다"


def test_댓글_목록_조회는_블라인드된_글을_거른다():
    src = inspect.getsource(C.list_comments)
    assert "is_blinded IS NOT TRUE" in src


def test_답글도_블라인드를_거른다():
    # 최상위 댓글은 질의에서 걸렀지만 답글은 관계로 딸려와 그대로 노출됐다
    src = inspect.getsource(C._ser_comment)
    assert "is_blinded" in src


def test_프로필_글_수에_블라인드는_포함되지_않는다():
    src = inspect.getsource(C.get_user_public_profile)
    assert "post_count" in src
    글수_줄 = [l for l in src.splitlines() if "AS post_count" in l][0]
    assert "is_blinded IS NOT TRUE" in 글수_줄


def test_블라인드_조건은_한곳에서_온다():
    # 경로마다 조건을 따로 쓰면 한 곳만 빠뜨려도 조용히 뚫린다
    assert len(C._POST_VISIBLE) == 2 and len(C._COMMENT_VISIBLE) == 2


# ── 쓰기 요청 제한 ────────────────────────────────────────────
_제한_대상 = {
    "create_post": "10/minute", "update_post": "20/minute", "delete_post": "20/minute",
    "toggle_post_like": "60/minute", "create_comment": "20/minute",
    "update_comment": "20/minute", "delete_comment": "20/minute",
    "toggle_comment_like": "60/minute", "vote_poll": "30/minute",
    "toggle_follow": "30/minute", "update_my_profile": "10/minute",
    "report_post": "20/hour", "report_comment": "20/hour",
}


@pytest.mark.parametrize("함수명, 제한", sorted(_제한_대상.items()))
def test_모든_쓰기_엔드포인트에_요청_제한이_걸려_있다(함수명, 제한):
    등록 = C.limiter._route_limits.get(f"app.api.routes.community.{함수명}")
    assert 등록, f"{함수명}에 요청 제한이 없다"
    횟수, 단위 = 제한.split("/")
    assert str(등록[0].limit) == f"{횟수} per 1 {단위}", \
        f"{함수명}의 제한이 '{등록[0].limit}' 로 바뀌었다"
    # slowapi는 요청 객체에서 제한 키를 뽑는다. request 파라미터가 빠지면
    # 오류 없이 제한만 조용히 사라진다
    assert "request" in inspect.signature(getattr(C, 함수명)).parameters, \
        f"{함수명}에 request 파라미터가 없어 요청 제한이 동작하지 않는다"


def test_요청_제한은_계정_기준이다():
    # IP 기준이면 회사·학교·모바일망처럼 IP를 공유하는 사용자끼리 서로를 막는다.
    # 반대로 IP만 바꾸면 제한이 그냥 풀린다
    from app.core.security import create_access_token

    class _Req:
        def __init__(self, token=None):
            self.headers = {"authorization": f"Bearer {token}"} if token else {}
            self.client = type("c", (), {"host": "10.0.0.1"})()

    a = C._account_key(_Req(create_access_token({"sub": "7"})))
    b = C._account_key(_Req(create_access_token({"sub": "8"})))
    assert a != b, "계정이 달라도 같은 한도를 나눠 쓰고 있다"
    assert a == C._account_key(_Req(create_access_token({"sub": "7"}))), \
        "같은 계정인데 한도가 따로 잡힌다"


def test_토큰이_없으면_IP로_되돌린다():
    class _Req:
        headers = {}
        client = type("c", (), {"host": "10.0.0.1"})()
    assert C._account_key(_Req()) == "10.0.0.1"


@pytest.mark.parametrize("헤더", ["", "Basic abc", "Bearer ", "Bearer 망가진토큰"])
def test_이상한_인증_헤더에도_터지지_않는다(헤더):
    class _Req:
        headers = {"authorization": 헤더}
        client = type("c", (), {"host": "10.0.0.1"})()
    assert C._account_key(_Req()) == "10.0.0.1"


def test_읽기_엔드포인트에는_제한을_걸지_않는다():
    # 비로그인 읽기는 계정 키가 없어 IP로 떨어진다. Render처럼 프록시 뒤에서는
    # 모든 방문자가 한 IP로 보일 수 있어, 읽기에 제한을 걸면 서비스가 통째로 막힌다
    for 함수명 in ("get_feed", "list_posts", "list_comments", "get_post"):
        assert "request" not in inspect.signature(getattr(C, 함수명)).parameters, \
            f"{함수명}(읽기)에 요청 제한이 걸렸다"
