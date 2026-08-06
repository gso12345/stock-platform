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
import inspect

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


def _캐시키_대입문() -> str:
    """캐시 키를 만드는 대입문 전체.

    예전에는 '캐시키 =' 가 든 줄 하나만 봤다. 그러다 조건이 늘어 줄을 나누는
    순간, 지켜야 할 성질은 그대로인데 검사가 통째로 헛돌았다. 줄바꿈 위치가
    아니라 대입문 전체를 본다."""
    import inspect
    본문 = inspect.getsource(community.get_feed)
    i = 본문.index("캐시키 = ")
    j = 본문.index("\n", 본문.index("공통 = ", i))   # 다음 문장 앞까지
    return 본문[i:j]


class Test캐시_동작:
    def test_팔로잉_피드는_캐시하지_않는다(self):
        """사람마다 목록 자체가 다르므로 공유할 수 없다."""
        키 = _캐시키_대입문()
        assert "following and uid" in 키 and "None" in 키, (
            f"팔로잉 전용 피드까지 캐시하면 남의 피드가 보인다: {키}")

    def test_캐시_수명에_상한이_있다(self):
        """새 글이 늦게 보이는 것은 이제 무효화가 막는다(아래 클래스).
        그래도 무한은 아니다 — 댓글 수처럼 무효화하지 않는 값이 공통 목록에
        들어 있어서, 그건 이 수명만큼 늦게 따라온다."""
        assert 0 < community.FEED_TTL <= 600, community.FEED_TTL

    def test_캐시_키가_조건을_모두_담는다(self):
        """목록을 가르는 것이 키에 없으면 다른 목록이 섞여 나온다.

        검색어가 빠지면 제일 눈에 띈다 — 한 번 검색한 결과가 검색 안 한
        피드에까지 그대로 나온다."""
        키 = _캐시키_대입문()
        for 조건 in ("sort", "market", "page", "limit", "검색어"):
            assert 조건 in 키, f"캐시 키에 {조건} 가 없다: {키}"

    def test_공통_목록에는_개인_항목이_비어_있다(self):
        """캐시에 남의 좋아요가 담기면 안 된다 — uid 를 넘기지 않아야 한다."""
        import inspect
        본문 = inspect.getsource(community.get_feed)
        assert "_ser_post(p, None, db" in 본문, (
            "캐시에 담을 때 uid 를 넘기고 있다 — 남의 개인 정보가 캐시된다")


class Test캐시를_언제_버리나:
    """수명만으로 버티던 것을 무효화로 바꿨다.

    예전에는 30초였다. 무효화하는 곳이 하나도 없어서, 새 글이 늦게 보이는
    것을 짧은 수명으로 막고 있었던 것이다. 그 대가로 30초마다 모든 방문자가
    캐시를 놓치고 DB 를 여섯 번 왕복했다 — DB 가 원격이라 왕복마다 지연이
    붙고, 그게 '피드가 느리다' 의 실체였다.

    (원격 DB 왕복을 30ms 로 흉내내 재보면 캐시 미스 190ms, 적중 0ms 였다)
    """

    def test_수명이_짧지_않다(self):
        """짧으면 무효화를 넣은 뜻이 없다 — 여전히 자주 놓친다."""
        assert community.FEED_TTL >= 120, community.FEED_TTL

    @staticmethod
    def _실제로_부르나(함수) -> bool:
        """주석 처리된 호출은 세지 않는다.

        소스를 글자로만 훑으면 `# 피드캐시_비우기()` 도 통과한다. 그러면
        누가 잠시 주석 처리해 두고 잊어도 아무도 못 알아챈다."""
        본문 = "\n".join(
            줄.split("#")[0] for 줄 in inspect.getsource(함수).splitlines()
        )
        return "피드캐시_비우기()" in 본문

    def test_새_글을_쓰면_버린다(self):
        """방금 쓴 글이 목록에 안 보이면, 글이 안 올라간 줄 알고 또 쓴다."""
        assert self._실제로_부르나(community.create_post)

    def test_고친_글도_버린다(self):
        """제목을 고쳐 놓고 목록에는 옛 제목이 남으면 더 이상하다."""
        assert self._실제로_부르나(community.update_post)

    def test_지운_글도_버린다(self):
        """목록에 남아 있는 것을 누르면 404 다."""
        assert self._실제로_부르나(community.delete_post)

    def test_실제로_다_버린다(self):
        """페이지·정렬·시장·검색어마다 칸이 따로다. 한 글이 어느 칸에
        들어 있는지 알 수 없으니 전부 버려야 한다."""
        community.cache.set("feed:latest:ALL:1:20:", {"items": []}, 60)
        community.cache.set("feed:likes:KR:3:20:삼성", {"items": []}, 60)
        community.cache.set("다른것:건드리지마", 1, 60)

        community.피드캐시_비우기()

        assert community.cache.get("feed:latest:ALL:1:20:") is None
        assert community.cache.get("feed:likes:KR:3:20:삼성") is None
        # 피드와 무관한 캐시까지 쓸어버리면 다른 화면이 같이 느려진다
        assert community.cache.get("다른것:건드리지마") == 1

    def test_비우다_실패해도_글은_올라간다(self, monkeypatch):
        """캐시는 거들 뿐이다. 여기서 터지면 글쓰기가 통째로 실패한다."""
        def 터짐(_):
            raise RuntimeError("캐시 죽음")
        monkeypatch.setattr(community.cache, "delete_pattern", 터짐)
        community.피드캐시_비우기()   # 예외가 새어 나오면 안 된다


class Test개인화_비용:
    def test_로그인_안_했으면_DB_를_안_친다(self):
        """비로그인은 좋아요도 팔로우도 없다. 그런데도 질의를 날리면
        캐시가 적중해도 왕복이 남는다."""
        본문 = inspect.getsource(community._개인화)
        assert "if not uid" in 본문 or "if uid is None" in 본문, (
            "비로그인일 때 일찍 빠져나가지 않는다")
