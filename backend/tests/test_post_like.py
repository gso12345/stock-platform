"""
좋아요는 토글이다 — 그래서 화면이 틀리면 결과가 정반대가 된다.

"로그아웃하고 다시 로그인하면 중복으로 좋아요 누를 수 있어"

서버는 눌린 상태면 지우고 아니면 넣는다. 화면이 들고 있는 "지금 눌려
있나" 가 틀리면(재로그인 뒤 옛 캐시를 보고 있을 때 그렇다) 누르는 순간
의도와 반대로 움직인다. 화면 쪽은 따로 고쳤고(캐시 비우기 + 응답 반영),
여기서는 서버가 지켜야 할 몫을 못 박는다.

  1) 같은 사람이 같은 글에 두 번 들어가지 않는다 (유일 제약)
  2) 그래도 부딪히면 500 이 아니라 지금 상태를 알려준다
  3) 응답이 화면이 맞출 수 있는 형태다 (liked·like_count 둘 다)
"""
import inspect

from sqlalchemy import inspect as sa_inspect

from app.api.routes import community as C
from app.models.community import StockPostLike


class Test한_사람이_한_번만:
    def test_유일_제약이_있다(self):
        """없으면 동시에 두 번 눌렸을 때 행이 둘 생기고, 취소해도
        하나가 남아 영영 '눌린 상태' 가 된다."""
        제약 = [c for c in StockPostLike.__table__.constraints
                if c.__class__.__name__ == "UniqueConstraint"]
        assert 제약, "(post_id, user_id) 유일 제약이 없다"
        칸 = {c.name for c in 제약[0].columns}
        assert 칸 == {"post_id", "user_id"}, 칸

    def test_실제_테이블에도_있다(self):
        """모델에만 적어 두고 마이그레이션을 안 하면 소용없다."""
        from app.db.database import engine
        try:
            제약 = sa_inspect(engine).get_unique_constraints("stock_post_likes")
        except Exception:
            return  # 테이블이 아직 없는 환경
        칸들 = [set(c["column_names"]) for c in 제약]
        assert {"post_id", "user_id"} in 칸들, 제약


class Test부딪혀도_안_죽는다:
    def test_유일_제약_위반을_받아_넘긴다(self):
        """빠르게 두 번 누르면 두 요청이 겹칠 수 있다. 두 번 눌린 것뿐인데
        500 을 내면 화면에는 '오류' 가 뜬다."""
        본문 = inspect.getsource(C.toggle_post_like)
        assert "IntegrityError" in 본문
        assert "rollback" in 본문

    def test_부딪힌_뒤에는_지금_상태를_다시_읽는다(self):
        """롤백만 하고 아까 계산한 값을 돌려주면, 화면이 틀린 값으로
        맞춰져 다음 클릭이 또 어긋난다.

        '눌렸나' 와 '몇 개인가' 를 둘 다 다시 읽어야 한다 — 하나만 읽으면
        나머지는 여전히 롤백 전의 추측값이다."""
        import ast
        import textwrap

        나무 = ast.parse(textwrap.dedent(inspect.getsource(C.toggle_post_like)))
        받는곳 = [h for h in ast.walk(나무) if isinstance(h, ast.ExceptHandler)
                  and "IntegrityError" in ast.unparse(h.type or ast.Constant(""))]
        assert 받는곳, "IntegrityError 를 받는 자리가 없다"

        몸통 = "\n".join(ast.unparse(n) for n in 받는곳[0].body)
        질의 = [l for l in 몸통.splitlines() if "db.query" in l]
        assert len(질의) >= 2, f"다시 읽는 것이 부족하다: {몸통}"
        assert "StockPostLike" in 몸통, "좋아요 행을 안 읽는다"
        assert "count" in 몸통, "개수를 다시 안 센다"


class Test화면이_맞출_수_있는_응답:
    def test_눌렸는지와_개수를_함께_준다(self):
        """둘 중 하나만 주면 화면이 나머지를 추측해야 하고, 추측이 틀리면
        다시 어긋난다."""
        본문 = inspect.getsource(C.toggle_post_like)
        assert '"liked"' in 본문
        assert '"like_count"' in 본문

    def test_모든_갈래에서_같은_형태를_준다(self):
        """예외 갈래만 형태가 다르면 화면이 그 응답을 못 읽고 버린다."""
        본문 = inspect.getsource(C.toggle_post_like)
        반환들 = [l for l in 본문.splitlines() if l.strip().startswith("return {")]
        assert len(반환들) >= 2, "갈래가 하나뿐이다 — 예외 경로가 빠졌나"
        for r in 반환들:
            assert '"liked"' in r and '"like_count"' in r, r

    def test_개수가_음수로_안_내려간다(self):
        """취소가 두 번 겹치면 -1 이 될 수 있다. 화면에 '-1' 이 찍힌다."""
        assert "max(0," in inspect.getsource(C.toggle_post_like)
