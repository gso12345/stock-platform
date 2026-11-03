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


@pytest.fixture
def 진짜DB(tmp_path):
    """작은 진짜 DB 와, 덧칠하는 동안 나간 SQL 을 세는 기록.

    예전에는 가짜 DB 가 '처음 묻는 대상' 으로 결과를 골라 줬다. 그러면 질의
    모양을 바꾸는 순간(좋아요 여부에 숫자를 같이 싣는 등) 검사가 엉뚱한 결과를
    받고 헛돈다. 진짜 테이블에 넣고 진짜로 묻는다.

    글 1 (글쓴이 100) — 좋아요 2 (7·9), 댓글 2 + 지운 것 1 + 가린 것 1
    글 2 (글쓴이 200) — 투표: 7→1, 8→0, 9→1
    팔로우 — 7 이 100 을"""
    from sqlalchemy import create_engine, event
    from sqlalchemy.orm import sessionmaker
    from app.db.database import Base
    from app.models.community import (StockPost, StockPostLike, StockComment, StockCommentLike,
                                      StockPostPollVote, UserFollow)
    엔진 = create_engine(f"sqlite:///{tmp_path}/t.db")
    Base.metadata.create_all(엔진, tables=[m.__table__ for m in (
        StockPost, StockPostLike, StockComment, StockCommentLike, StockPostPollVote, UserFollow)])
    db = sessionmaker(bind=엔진)()
    db.add_all([
        StockPost(id=1, symbol="005930", market="KR", user_id=100, content="{}", like_count=2),
        StockPost(id=2, symbol="SCHD", market="US", user_id=200, content="{}", like_count=0),
        StockPostLike(post_id=1, user_id=7), StockPostLike(post_id=1, user_id=9),
        StockComment(post_id=1, user_id=7, content="a"), StockComment(post_id=1, user_id=8, content="b"),
        StockComment(post_id=1, user_id=9, content="지움", is_deleted=True),
        StockComment(post_id=1, user_id=9, content="가림", is_blinded=True),
        StockPostPollVote(post_id=2, user_id=7, option_index=1),
        StockPostPollVote(post_id=2, user_id=8, option_index=0),
        StockPostPollVote(post_id=2, user_id=9, option_index=1),
        UserFollow(follower_id=7, following_id=100),
    ])
    db.commit()
    왕복: list[str] = []
    event.listen(엔진, "before_cursor_execute", lambda _c, _cur, sql, *a: 왕복.append(sql))
    try:
        yield db, 왕복
    finally:
        db.close()


def _공통(포함투표=True, 지운글=False):
    """캐시에 담기는 '누가 보든 같은' 모양 — 개인 항목은 비어 있고, 숫자는 캐시에 담을 때의
    (이제는 묵은) 값이다: 좋아요·댓글 0, 투표 0표"""
    글들 = [{"id": 1, "user_id": 100, "symbol": "005930", "like_count": 0, "comment_count": 0,
             "liked": False, "is_mine": False, "is_following": False}]
    if 포함투표:
        글들.append({"id": 2, "user_id": 200, "symbol": "SCHD", "like_count": 0, "comment_count": 0,
                     "liked": False, "is_mine": False, "is_following": False,
                     "poll": {"question": "뭐 살까?", "options": ["SCHD", "JEPI", "O"],
                              "counts": [0, 0, 0], "total": 0, "my_vote": None}})
    if 지운글:
        글들.append({"id": 99, "user_id": 300, "symbol": "TSLA", "like_count": 5, "comment_count": 4,
                     "liked": False, "is_mine": False, "is_following": False})
    return {"total": len(글들), "page": 1, "items": 글들}


def _글(결과, id_):
    return next(it for it in 결과["items"] if it["id"] == id_)


class Test개인화:
    def test_비로그인이면_DB를_보지_않는다(self, 진짜DB):
        """읽기만 하는 방문자에게 왕복을 쓸 이유가 없다 — 누를 수 없으니 숫자가
        조금 늦어도 '눌렀는데 되돌아가는' 일도 없다."""
        db, 왕복 = 진짜DB
        결과 = community._개인화(db, None, _공통())
        assert 왕복 == [], f"비로그인인데 DB 를 {len(왕복)}번 봤다"
        assert _글(결과, 1)["liked"] is False
        assert _글(결과, 1)["like_count"] == 0          # 캐시 값 그대로

    def test_내가_누른_좋아요만_내_것으로_표시된다(self, 진짜DB):
        """캐시된 공통 목록을 여러 사람이 함께 쓴다. 여기가 틀리면
        남이 누른 좋아요가 내 화면에 켜져 보인다 — 가장 위험한 사고다."""
        db, _ = 진짜DB
        assert _글(community._개인화(db, 7, _공통()), 1)["liked"] is True
        assert _글(community._개인화(db, 8, _공통()), 1)["liked"] is False    # 8 은 안 눌렀다
        assert _글(community._개인화(db, 7, _공통()), 2)["liked"] is False    # 7 도 글 2 는 안 눌렀다

    def test_숫자를_새로_센다(self, 진짜DB):
        """좋아요를 누르고 목록을 새로 받으면 하트는 빨간데 숫자는 캐시에 담길 때 값(0 →
        '좋아요' 글자)이었다. 캐시는 15분을 사는데 숫자가 바뀔 때는 버리지 않기 때문이다."""
        db, _ = 진짜DB
        글1 = _글(community._개인화(db, 7, _공통()), 1)
        assert 글1["like_count"] == 2
        # 지운 댓글·가린 댓글은 세지 않는다 — 글 상세의 숫자(_댓글수)와 같아야 한다
        assert 글1["comment_count"] == 2

    def test_투표_수와_내_투표를_새로_센다(self, 진짜DB):
        """내가 고른 칸이 0% 로 보이던 것 — 내 표는 새로 읽고 집계는 캐시 값이었다."""
        db, _ = 진짜DB
        투표 = _글(community._개인화(db, 7, _공통()), 2)["poll"]
        assert 투표["counts"] == [1, 2, 0]
        assert 투표["total"] == 3
        assert 투표["my_vote"] == 1
        assert _글(community._개인화(db, 8, _공통()), 2)["poll"]["my_vote"] == 0
        assert _글(community._개인화(db, 10, _공통()), 2)["poll"]["my_vote"] is None   # 안 했다
        assert 투표["question"] == "뭐 살까?" and 투표["options"] == ["SCHD", "JEPI", "O"]

    def test_내_글인지_구분한다(self, 진짜DB):
        db, _ = 진짜DB
        assert _글(community._개인화(db, 100, _공통()), 1)["is_mine"] is True
        assert _글(community._개인화(db, 7, _공통()), 1)["is_mine"] is False

    def test_팔로우_여부를_표시한다(self, 진짜DB):
        """좋아요와 같은 자리다 — 안 하는 사람도 '팔로우 중'으로 보이면
        캐시를 나눠 쓰다 남의 관계가 내 화면에 뜬 것이다."""
        db, _ = 진짜DB
        assert _글(community._개인화(db, 7, _공통()), 1)["is_following"] is True
        assert _글(community._개인화(db, 8, _공통()), 1)["is_following"] is False

    def test_숫자를_실어도_왕복은_늘지_않는다(self, 진짜DB):
        """예전에도 세 번이었다(내 좋아요·팔로우·내 투표). 숫자는 그 질의에 실어 보낸다 —
        DB 가 원격이라 왕복 하나가 곧 지연이다."""
        db, 왕복 = 진짜DB
        community._개인화(db, 7, _공통())
        assert len(왕복) == 3, 왕복

    def test_투표가_없는_글이면_투표를_묻지_않는다(self, 진짜DB):
        db, 왕복 = 진짜DB
        community._개인화(db, 7, _공통(포함투표=False))
        assert len(왕복) == 2, f"좋아요·숫자 하나, 팔로우 하나면 된다: {왕복}"

    def test_내_글은_팔로우_대상으로_묻지_않는다(self, 진짜DB):
        """자기 자신을 팔로우하는지 물어볼 이유가 없다 — 왕복 낭비다."""
        db, 왕복 = 진짜DB
        community._개인화(db, 100, _공통(포함투표=False))     # 글쓴이가 나
        assert len(왕복) == 1, f"좋아요·숫자 조회 1번이면 충분한데 {왕복}"

    def test_캐시에_담긴_뒤_지워진_글도_넘어간다(self, 진짜DB):
        """목록이 캐시된 뒤 지워진 글은 DB 에 행이 없다. 거기서 터지면 피드가 통째로 죽는다."""
        db, _ = 진짜DB
        글 = _글(community._개인화(db, 7, _공통(지운글=True)), 99)
        assert 글["liked"] is False
        assert (글["like_count"], 글["comment_count"]) == (5, 4)      # 캐시 값 그대로

    def test_캐시된_원본을_건드리지_않는다(self, 진짜DB):
        """같은 공통 목록을 여러 사람이 나눠 쓴다. 덧칠하면서 원본을
        고치면 다음 사람이 내 좋아요를 보게 된다."""
        db, _ = 진짜DB
        원본 = _공통()
        community._개인화(db, 7, 원본)
        assert _글(원본, 1)["liked"] is False, "캐시 원본이 오염됐다"
        assert _글(원본, 1)["like_count"] == 0
        assert _글(원본, 2)["poll"] == {"question": "뭐 살까?", "options": ["SCHD", "JEPI", "O"],
                                       "counts": [0, 0, 0], "total": 0, "my_vote": None}


class Test종목이름:
    """피드 카드가 'KR 005930' 처럼 코드만 보여 줬다 — 이름을 같이 보낸다."""

    @pytest.fixture(autouse=True)
    def _이름표(self, monkeypatch):
        monkeypatch.setattr(community, "_kr_name", lambda s: {"005930": "삼성전자", "069500": "KODEX 200"}.get(s))
        from app.services.screening import service
        monkeypatch.setattr(service, "한글이름", lambda s: {"NVDA": "엔비디아"}.get(s))

    def test_국내는_상장_목록에서(self):
        assert community._종목이름("005930", "KR") == "삼성전자"

    def test_국내_ETF도_숫자_코드로_찾는다(self):
        """시장이 'ETF' 인 글도 국내 ETF 면 코드가 숫자다."""
        assert community._종목이름("069500", "ETF") == "KODEX 200"

    def test_해외는_한글_이름(self):
        assert community._종목이름("NVDA", "US") == "엔비디아"

    def test_모르면_비운다(self):
        """이름이 없으면 화면이 코드를 쓴다 — 엉뚱한 이름보다 낫다."""
        assert community._종목이름("ZZZZ", "US") is None
        assert community._종목이름("999999", "KR") is None

    def test_해외_이름표가_터져도_비운다(self, monkeypatch):
        from app.services.screening import service
        def 터짐(_):
            raise RuntimeError("원천 없음")
        monkeypatch.setattr(service, "한글이름", 터짐)
        assert community._종목이름("NVDA", "US") is None

    def test_글에_이름이_실린다(self):
        본문 = inspect.getsource(community._ser_post)
        assert '"name":          _종목이름(post.symbol, post.market)' in 본문


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
        들어 있어서, 그건 이 수명만큼 늦게 따라온다.

        180 → 900 초로 늘어났다. 짧으면 3분마다 한 명이 글 스무 개를 DB 에서
        다시 긁고 작성자·프로필·투표·댓글 수를 붙이는 값을 통째로 치른다 —
        '들어갈 때마다 느리다' 가 되는 자리다. 무효화가 새 글·삭제를 즉시
        반영하므로 길게 잡아도 되고, 늦어지는 것은 댓글 수 정도다.

        상한 자체는 남겨 둔다. 무효화가 못 잡는 값이 있는 한 '영원히'는
        안 되고, 15분이면 그 한 바퀴로 충분하다."""
        assert 0 < community.FEED_TTL <= 900, community.FEED_TTL

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


class Test국내이름찾기:
    """상장 목록은 '005930.KS' 처럼 꼬리를 붙여 두고 코드는 따로(c) 둔다. 예전 _kr_name 은 꼬리 붙은 것과만
    견줘서 글에 저장된 '005930' 으로는 한 번도 못 찾았다 — 태그 이름도 늘 비었다."""

    @pytest.fixture(autouse=True)
    def _목록(self, monkeypatch):
        목록 = [
            {"s": "005930.KS", "n": "삼성전자", "x": "KOSPI", "m": "KR", "c": "005930"},
            {"s": "035720.KQ", "n": "카카오"},                     # 코드 칸이 없으면 꼬리를 떼서 쓴다
            {"symbol": "069500", "name": "KODEX 200"},             # 옛 모양
            {"s": "000000.KS", "n": ""},                           # 이름 없는 줄은 건너뛰고
            {"s": "000000.KQ", "n": "이름 있는 줄"},               # 같은 코드의 이름 있는 줄을 쓴다
        ]
        monkeypatch.setattr(community, "get_kr_db", lambda: 목록)
        monkeypatch.setattr(community, "_kr_이름표", None)
        return 목록

    def test_꼬리_없는_코드로_찾는다(self):
        assert community._kr_name("005930") == "삼성전자"
        assert community._kr_name("035720") == "카카오"
        assert community._kr_name("069500") == "KODEX 200"

    def test_꼬리_붙은_코드로_물어도_찾는다(self):
        assert community._kr_name("005930.KS") == "삼성전자"

    def test_모르면_비운다(self):
        assert community._kr_name("999999") is None
        assert community._kr_name("") is None

    def test_이름_없는_줄은_건너뛴다(self):
        """빈 이름이 먼저 자리를 차지하면, 뒤에 이름이 있어도 늘 빈 이름이 나간다"""
        assert community._kr_name("000000") == "이름 있는 줄"

    def test_목록을_새로_받으면_표도_새로_만든다(self, monkeypatch):
        assert community._kr_name("005930") == "삼성전자"
        monkeypatch.setattr(community, "get_kr_db", lambda: [{"s": "005930.KS", "n": "삼성전자(새)", "c": "005930"}])
        assert community._kr_name("005930") == "삼성전자(새)"

    def test_목록이_터져도_비운다(self, monkeypatch):
        def 터짐():
            raise RuntimeError("목록 없음")
        monkeypatch.setattr(community, "get_kr_db", 터짐)
        assert community._kr_name("005930") is None

    def test_태그에도_이름이_붙는다(self):
        """태그 이름을 비워 둔 옛 글도 이름으로 보인다"""
        assert community._enrich_tags([{"symbol": "005930", "market": "KR"}]) == [
            {"symbol": "005930", "market": "KR", "name": "삼성전자"}]
