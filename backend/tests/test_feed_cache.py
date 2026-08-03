"""
피드 속도 — "글 불러오는 속도 너무 느려"

피드 한 번에 DB 왕복이 최대 7번이었다 (전체 개수·글·프로필·댓글 수·
팔로우·좋아요·투표). DB 가 원격이라 왕복마다 지연이 붙고, CPU 0.15개
에서는 그게 그대로 체감된다.

그런데 그중 대부분은 '누가 보든 같은' 내용이다. 사람마다 다른 건 좋아요·
내 글·팔로우·내 투표 네 가지뿐이라, 공통 부분만 캐시하고 개인 항목은
꺼낸 뒤 덧칠하면 된다.

여기서 못 박는 것은 두 가지 —
  1) 캐시가 실제로 왕복을 줄이는가
  2) 줄이면서 '남의 좋아요가 내 것으로 보이는' 사고가 없는가
"""
import pytest

from app.api.routes import community
from app.core.cache import cache


@pytest.fixture(autouse=True)
def _캐시비우기():
    cache.clear()
    yield
    cache.clear()


class 가짜쿼리:
    def __init__(self, 결과, 기록):
        self._결과, self._기록 = 결과, 기록

    def filter(self, *a, **k):
        return self

    def all(self):
        self._기록.append("쿼리")
        return self._결과


class 가짜DB:
    """DB 왕복 횟수를 센다."""
    def __init__(self, 좋아요=(), 팔로우=(), 투표=()):
        self.기록 = []
        self._map = {"like": 좋아요, "follow": 팔로우, "vote": 투표}

    def query(self, *entities):
        from app.models.community import StockPostLike, UserFollow, StockPostPollVote
        e = entities[0]
        키 = ("like" if getattr(e, "class_", None) is StockPostLike or e is StockPostLike
              else "follow" if getattr(e, "class_", None) is UserFollow or e is UserFollow
              else "vote")
        return 가짜쿼리(self._map[키], self.기록)


def _공통(포함투표=False):
    """캐시에 담기는 '누가 보든 같은' 모양 — 개인 항목은 전부 비어 있다"""
    글 = {
        "id": 1, "user_id": 100, "symbol": "005930", "content": "삼성전자 좋다",
        "liked": False, "is_mine": False, "is_following": False,
    }
    if 포함투표:
        글["poll"] = {"question": "살까?", "options": ["산다", "판다"],
                      "counts": [3, 1], "my_vote": None}
    return {"total": 1, "page": 1, "items": [글]}


class Test개인화:
    def test_비로그인이면_DB를_보지_않는다(self):
        """읽기만 하는 방문자에게 왕복을 쓸 이유가 없다."""
        db = 가짜DB()
        결과 = community._개인화(db, None, _공통())
        assert db.기록 == [], f"비로그인인데 DB 를 {len(db.기록)}번 봤다"
        assert 결과["items"][0]["liked"] is False

    def test_내가_누른_좋아요만_내_것으로_표시된다(self):
        """캐시된 공통 목록을 여러 사람이 함께 쓴다. 여기가 틀리면
        남이 누른 좋아요가 내 화면에 켜져 보인다 — 가장 위험한 사고다."""
        db = 가짜DB(좋아요=[(1,)])
        결과 = community._개인화(db, 7, _공통())
        assert 결과["items"][0]["liked"] is True

        db2 = 가짜DB(좋아요=[])          # 나는 안 눌렀다
        결과2 = community._개인화(db2, 8, _공통())
        assert 결과2["items"][0]["liked"] is False

    def test_내_글인지_구분한다(self):
        assert community._개인화(가짜DB(), 100, _공통())["items"][0]["is_mine"] is True
        assert community._개인화(가짜DB(), 7,   _공통())["items"][0]["is_mine"] is False

    def test_팔로우_여부를_표시한다(self):
        """좋아요와 같은 자리다 — 안 하는 사람도 '팔로우 중'으로 보이면
        캐시를 나눠 쓰다 남의 관계가 내 화면에 뜬 것이다."""
        db = 가짜DB(팔로우=[(100,)])
        assert community._개인화(db, 7, _공통())["items"][0]["is_following"] is True

        db2 = 가짜DB(팔로우=[])           # 나는 이 사람을 팔로우하지 않는다
        assert community._개인화(db2, 8, _공통())["items"][0]["is_following"] is False

    def test_내_글은_팔로우_대상으로_묻지_않는다(self):
        """자기 자신을 팔로우하는지 물어볼 이유가 없다 — 왕복 낭비다."""
        db = 가짜DB()
        community._개인화(db, 100, _공통())     # 글쓴이가 나
        assert len(db.기록) == 1, f"좋아요 조회 1번이면 충분한데 {db.기록}"

    def test_내가_투표한_항목을_표시한다(self):
        class 투표:
            post_id, option_index = 1, 1
        db = 가짜DB(투표=[투표()])
        결과 = community._개인화(db, 7, _공통(포함투표=True))
        assert 결과["items"][0]["poll"]["my_vote"] == 1
        # 집계는 공통 값이 그대로 살아 있어야 한다
        assert 결과["items"][0]["poll"]["counts"] == [3, 1]

    def test_투표가_없는_글이면_투표를_묻지_않는다(self):
        db = 가짜DB()
        community._개인화(db, 7, _공통(포함투표=False))
        # 좋아요·팔로우만 (투표 쿼리 없음)
        assert len(db.기록) <= 2, f"불필요한 왕복: {db.기록}"

    def test_캐시된_원본을_건드리지_않는다(self):
        """같은 공통 목록을 여러 사람이 나눠 쓴다. 덧칠하면서 원본을
        고치면 다음 사람이 내 좋아요를 보게 된다."""
        원본 = _공통()
        community._개인화(가짜DB(좋아요=[(1,)]), 7, 원본)
        assert 원본["items"][0]["liked"] is False, "캐시 원본이 오염됐다"


class Test캐시_동작:
    def test_팔로잉_피드는_캐시하지_않는다(self):
        """사람마다 목록 자체가 다르므로 공유할 수 없다."""
        import inspect
        본문 = inspect.getsource(community.get_feed)
        assert "following and uid" in 본문 and "캐시키 = None" in 본문, (
            "팔로잉 전용 피드까지 캐시하면 남의 피드가 보인다")

    def test_캐시_수명이_너무_길지_않다(self):
        """새 글이 한참 뒤에 보이면 그것대로 문제다."""
        assert 0 < community.FEED_TTL <= 60, community.FEED_TTL

    def test_캐시_키가_조건을_모두_담는다(self):
        """정렬·시장·페이지가 키에 없으면 다른 목록이 섞여 나온다."""
        import inspect
        본문 = inspect.getsource(community.get_feed)
        키줄 = [l for l in 본문.splitlines() if "캐시키 =" in l][0]
        for 조건 in ("sort", "market", "page", "limit"):
            assert 조건 in 키줄, f"캐시 키에 {조건} 가 없다: {키줄}"

    def test_공통_목록에는_개인_항목이_비어_있다(self):
        """캐시에 남의 좋아요가 담기면 안 된다 — uid 를 넘기지 않아야 한다."""
        import inspect
        본문 = inspect.getsource(community.get_feed)
        assert "_ser_post(p, None, db" in 본문, (
            "캐시에 담을 때 uid 를 넘기고 있다 — 남의 개인 정보가 캐시된다")
