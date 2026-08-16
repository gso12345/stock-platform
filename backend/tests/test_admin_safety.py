"""
관리자 패널의 되돌릴 수 없는 일들 — 안전장치가 사라지지 않게.

점검에서 나온 것들이다.
  · 계정 삭제가 db.delete(user) 한 줄이었다. users.id 를 참조하는 표가
    열 개가 넘는데 User 쪽에는 cascade 선언이 없다 → 프로덕션(PostgreSQL)
    에서는 외래키 위반으로 500. 화면에 버튼이 없어서 아무도 안 밟았을 뿐이다.
  · 기록에 '누가' 가 없었다. ADMIN_USERNAME 은 쉼표로 여러 명을 받는데,
    로그는 "관리자가 게시글 삭제: post_id=3" 이라 누구인지 알 수 없었다.
  · 동료 관리자를 지우거나 정지시킬 수 있었다. 한 사람이 나머지를 다
    밀어낼 수 있다는 뜻이다.
"""
import ast
import pathlib
import re

_소스 = (pathlib.Path(__file__).resolve().parents[1]
         / "app" / "api" / "routes" / "admin.py").read_text(encoding="utf-8")


def _코드만(본문: str) -> str:
    """주석·문서화 문자열을 걷어낸다.

    설명에 'db.delete(user)' 처럼 그만둔 코드를 적어 두기 때문에,
    그걸 현재 코드로 착각하면 멀쩡한 구현이 걸린다."""
    본문 = re.sub(r'"""[\s\S]*?"""', "", 본문)
    return re.sub(r"^\s*#.*$", "", 본문, flags=re.M)


def _함수(이름: str) -> str:
    """그 함수 본문만 잘라 낸다."""
    나무 = ast.parse(_소스)
    for n in ast.walk(나무):
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == 이름:
            return ast.unparse(n)
    raise AssertionError(f"{이름} 을 못 찾음")


class Test계정삭제:
    def test_딸린_것을_정리하고_지운다(self):
        """cascade 선언이 없으므로 손으로 지워야 한다. 안 그러면 500.

        글자만 세면 안 된다 — 반복문을 빈 목록으로 바꿔도 'DELETE FROM'
        이라는 글자는 남는다(뮤테이션에서 실제로 그렇게 빠져나갔다).
        그래서 반복 대상이 정말 채워져 있는지를 구문 나무로 본다."""
        나무 = ast.parse(_소스)
        대상 = None
        for n in ast.walk(나무):
            if isinstance(n, ast.FunctionDef) and n.name == "delete_user":
                대상 = n
        assert 대상 is not None
        표들 = []
        for n in ast.walk(대상):
            if isinstance(n, ast.For) and isinstance(n.iter, ast.List):
                for 원소 in n.iter.elts:
                    if isinstance(원소, ast.Tuple) and 원소.elts:
                        v = 원소.elts[0]
                        if isinstance(v, ast.Constant):
                            표들.append(v.value)
        assert len(표들) >= 10, f"정리하는 표가 너무 적다: {표들}"
        for 표 in ("stock_posts", "stock_comments", "user_follows", "notifications"):
            assert 표 in 표들, f"{표} 를 안 지운다"

    def test_실패하면_500_대신_안내를_준다(self):
        """지우다 막히면 '계정 정지를 대신 쓰라' 고 알려 줘야 한다."""
        본문 = _코드만(_함수("delete_user"))
        assert "rollback" in 본문
        # 주석에도 '계정 정지' 라는 말이 나온다 — 왜 삭제보다 정지를
        # 권하는지 적어 뒀기 때문이다. 코드에서 봐야 한다
        assert "계정 정지를 대신" in 본문, "실패했을 때 대안을 안 알려 준다"
        assert "status_code=500" in 본문

    def test_자기_자신을_못_지운다(self):
        assert "user.id == current.id" in _코드만(_함수("delete_user"))

    def test_동료_관리자를_못_지운다(self):
        """한 사람이 나머지 관리자를 다 밀어낼 수 있으면 안 된다."""
        assert "user.is_admin" in _코드만(_함수("delete_user"))


class Test관리자끼리_보호:
    def test_계정_정지는_관리자에게_안_먹는다(self):
        assert "user.is_admin" in _코드만(_함수("toggle_active"))

    def test_커뮤니티_차단도_관리자에게_안_먹는다(self):
        assert "user.is_admin" in _코드만(_함수("toggle_community_ban"))


class Test기록:
    def test_되돌릴_수_없는_일은_모두_남긴다(self):
        """무엇이 있었는지 모르면 사고를 추적할 수 없다."""
        for 이름 in ("delete_user", "toggle_active", "toggle_community_ban",
                     "clear_cache", "delete_cache_key", "delete_cache_prefix",
                     "admin_delete_post", "admin_delete_comment"):
            assert "관리기록(" in _코드만(_함수(이름)), f"{이름} 이 기록을 안 남긴다"

    def test_누가_했는지_남긴다(self):
        """예전 로그에는 '관리자가' 라고만 적혀 있었다."""
        본문 = _코드만(_소스)
        assert "actor_name=actor.username" in 본문, "행위자 이름을 안 남긴다"
        # 계정이 지워져도 기록은 남아야 하므로 이름을 문자열로 함께 박는다
        assert "actor_id=actor.id" in 본문

    def test_기록이_실패해도_본_작업은_막지_않는다(self):
        """글을 지웠는데 기록이 안 남는 것보다, 기록 때문에 지우기가
        실패하는 쪽이 더 곤란하다."""
        본문 = _코드만(_함수("관리기록"))
        assert "except Exception" in 본문
        assert "rollback" in 본문

    def test_기록을_볼_수_있다(self):
        assert '@router.get("/logs")' in _소스, "기록 조회 엔드포인트가 없다"
        assert "require_admin" in _함수("get_admin_logs")


class Test상한:
    def test_파괴적_엔드포인트에_상한이_있다(self):
        """인가로 막혀 있지만, 잘못 짠 스크립트가 관리자 토큰으로 돌면
        0.15 CPU 서버가 멈춘다."""
        for 데코 in ('@router.delete("/users/{user_id}")',
                     '@router.post("/cache/clear")',
                     '@router.patch("/users/{user_id}/active")'):
            i = _소스.index(데코)
            assert "@limiter.limit(" in _소스[i:i + 200], f"{데코} 에 상한이 없다"

    def test_상한을_건_함수는_request_를_받는다(self):
        """slowapi 는 request 인자가 없으면 그 자리에서 터진다."""
        줄 = _소스.splitlines()
        for i, l in enumerate(줄):
            if l.startswith("@limiter.limit("):
                j = i + 1
                while j < len(줄) and not 줄[j].startswith("def "):
                    j += 1
                블록 = "\n".join(줄[j:j + 10])
                assert "request" in 블록, f"{줄[j][:40]} 에 request 가 없다"
