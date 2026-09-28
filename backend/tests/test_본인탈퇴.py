"""본인 탈퇴와 관리자 삭제.

본인 탈퇴는 **계정만 닫고 기록은 남긴다.** 완전 삭제는 관리자 삭제로만
하고, 그때는 남김없이 지운다.

외래키 검사를 켜고 돌린다. SQLite 는 기본으로 외래키를 안 봐서, 순서가
틀려도 로컬에서는 통과하고 PostgreSQL(실서비스)에서만 500 이 난다.
켜 두면 여기서도 똑같이 막힌다.
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event

from app.main import app
from app.db.database import Base, engine, SessionLocal
from app.core.security import create_access_token, hash_password
from app.models.user import User
from app.models import stock as S
from app.models import community as C
from app.services.account_delete import 회원지우기

이름들 = ["wd_me_x", "wd_other_x", "wd_social_x", "wd_admin_x"]


def _외래키켜기(conn, _):
    conn.execute("PRAGMA foreign_keys=ON")


@pytest.fixture
def 외래키():
    if engine.dialect.name != "sqlite":
        yield
        return
    event.listen(engine, "connect", _외래키켜기)
    engine.dispose()
    yield
    event.remove(engine, "connect", _외래키켜기)
    engine.dispose()


def _사람치우기():
    s = SessionLocal()
    try:
        for u in s.query(User).filter(User.username.in_(이름들)).all():
            회원지우기(s, u)
        s.commit()
    finally:
        s.close()


@pytest.fixture
def 사람들(외래키):
    Base.metadata.create_all(bind=engine)
    _사람치우기()
    s = SessionLocal()
    나 = User(username="wd_me_x", hashed_password=hash_password("Passw0rd!"))
    남 = User(username="wd_other_x", hashed_password=hash_password("Passw0rd!"))
    소셜 = User(username="wd_social_x", hashed_password=hash_password("random"),
                oauth_provider="kakao", oauth_id="k-wd-1")
    관리자 = User(username="wd_admin_x", hashed_password=hash_password("Passw0rd!"), is_admin=True)
    s.add_all([나, 남, 소셜, 관리자]); s.commit()

    # 내 글 하나 — 남이 댓글·답글·좋아요·투표·신고를 달았다
    글 = C.StockPost(symbol="SPY", market="US", user_id=나.id, content="내 글")
    남의글 = C.StockPost(symbol="QQQ", market="US", user_id=남.id, content="남의 글")
    s.add_all([글, 남의글]); s.commit()
    남댓글 = C.StockComment(post_id=글.id, user_id=남.id, content="남이 단 댓글")
    s.add(남댓글); s.commit()
    내답글 = C.StockComment(post_id=글.id, user_id=나.id, content="내 답글", parent_id=남댓글.id)
    내댓글_남의글 = C.StockComment(post_id=남의글.id, user_id=나.id, content="남의 글에 단 내 댓글")
    s.add_all([내답글, 내댓글_남의글]); s.commit()
    남답글 = C.StockComment(post_id=남의글.id, user_id=남.id, content="내 댓글에 남이 단 답글",
                            parent_id=내댓글_남의글.id)
    s.add(남답글); s.commit()
    s.add_all([
        C.StockPostLike(post_id=글.id, user_id=남.id),
        C.StockPostLike(post_id=남의글.id, user_id=나.id),
        C.StockCommentLike(comment_id=내답글.id, user_id=남.id),
        C.StockPostPollVote(post_id=글.id, user_id=남.id, option_index=0),
        C.UserFollow(follower_id=남.id, following_id=나.id),
        C.Report(reporter_id=남.id, post_id=글.id, reason="신고"),
        C.Notification(user_id=나.id, actor_id=남.id, kind="comment", post_id=글.id),
        C.Notification(user_id=남.id, actor_id=나.id, kind="comment", comment_id=내댓글_남의글.id),
        C.UserProfile(user_id=나.id, nickname="나"),
        S.Watchlist(user_id=나.id, name="내 목록"),
        S.WatchlistFolder(user_id=나.id, name="내 폴더"),
        S.Strategy(name="전략", user_id=나.id),
        S.PriceAlert(user_id=나.id, symbol="SPY", market="US", direction="above", target=1),
        S.Portfolio(user_id=나.id, name="공개 포트폴리오", is_public=True),
        S.PortfolioExperiment(user_id=나.id, name="e", initial_amount=1,
                              start_date="2020-01-01", end_date="2021-01-01", assets=[]),
    ])
    s.commit()
    목록 = s.query(S.Watchlist).filter(S.Watchlist.user_id == 나.id).first()
    폴더 = s.query(S.WatchlistFolder).filter(S.WatchlistFolder.user_id == 나.id).first()
    종목 = S.WatchlistItem(watchlist_id=목록.id, folder_id=폴더.id, symbol="SPY", market="US")
    #: 폴더 없이 목록에만 든 종목 — 목록을 거쳐야만 찾을 수 있다
    폴더없는종목 = S.WatchlistItem(watchlist_id=목록.id, folder_id=None, symbol="QQQ", market="US")
    s.add_all([종목, 폴더없는종목])
    s.commit()
    ids = {"종목": 종목.id, "폴더없는종목": 폴더없는종목.id, "나": 나.id, "남": 남.id, "소셜": 소셜.id, "관리자": 관리자.id,
           "글": 글.id, "남의글": 남의글.id, "남댓글": 남댓글.id, "남답글": 남답글.id}
    s.close()
    yield ids
    _사람치우기()


def _토큰(uid):
    return {"Authorization": f"Bearer {create_access_token(data={'sub': str(uid)})}"}


def _탈퇴(client, uid, **몸):
    return client.request("DELETE", "/api/v1/auth/me", headers=_토큰(uid), json=몸)


@pytest.fixture
def client():
    from app.api.routes import auth as A
    try:
        A.limiter._storage.reset()
    except Exception:
        pass
    return TestClient(app)


# ── 안전장치 ─────────────────────────────────────────────────────

def _살아있나(uid):
    s = SessionLocal()
    try:
        u = s.query(User).filter(User.id == uid).first()
        return u is not None and u.is_active is not False and u.withdrawn_at is None
    finally:
        s.close()


def test_로그인_안_하면_못_한다(client, 사람들):
    r = client.request("DELETE", "/api/v1/auth/me", json={"confirm": "탈퇴합니다"})
    assert r.status_code == 401


def test_확인_문구가_다르면_탈퇴되지_않는다(client, 사람들):
    r = _탈퇴(client, 사람들["나"], password="Passw0rd!", confirm="탈퇴")
    assert r.status_code == 400
    assert _살아있나(사람들["나"])


def test_비밀번호가_틀리면_탈퇴되지_않는다(client, 사람들):
    assert _탈퇴(client, 사람들["나"], password="wrong", confirm="탈퇴합니다").status_code == 400
    assert _탈퇴(client, 사람들["나"], confirm="탈퇴합니다").status_code == 400  # 비밀번호 없음
    assert _살아있나(사람들["나"])


def test_관리자는_탈퇴할_수_없다(client, 사람들):
    r = _탈퇴(client, 사람들["관리자"], password="Passw0rd!", confirm="탈퇴합니다")
    assert r.status_code == 400
    assert "관리자" in r.json()["detail"]
    assert _살아있나(사람들["관리자"])


def test_소셜_계정은_비밀번호_없이_확인_문구만으로(client, 사람들):
    r = _탈퇴(client, 사람들["소셜"], confirm="탈퇴합니다")
    assert r.status_code == 200, r.text
    assert not _살아있나(사람들["소셜"])


def test_내_정보에_소셜_여부가_실려_온다(client, 사람들):
    """화면이 비밀번호 칸을 보일지 정한다"""
    assert client.get("/api/v1/auth/me", headers=_토큰(사람들["소셜"])).json()["oauth_provider"] == "kakao"
    assert client.get("/api/v1/auth/me", headers=_토큰(사람들["나"])).json()["oauth_provider"] is None


# ── 본인 탈퇴: 계정만 닫고 기록은 남긴다 ──────────────────────────

def test_탈퇴하면_계정은_닫히고_기록은_그대로_남는다(client, 사람들):
    r = _탈퇴(client, 사람들["나"], password="Passw0rd!", confirm="탈퇴합니다")
    assert r.status_code == 200, r.text

    s = SessionLocal()
    try:
        나 = s.query(User).filter(User.id == 사람들["나"]).first()
        assert 나 is not None, "탈퇴했다고 계정 줄을 지웠다 — 기록을 남겨야 한다"
        assert 나.is_active is False and 나.withdrawn_at is not None
        # 내 글·댓글과, 거기에 남이 단 것 모두 그대로
        assert s.query(C.StockPost).filter(C.StockPost.id == 사람들["글"]).count() == 1
        assert s.query(C.StockComment).filter(C.StockComment.id == 사람들["남댓글"]).count() == 1
        assert s.query(C.StockComment).filter(C.StockComment.user_id == 나.id).count() == 2
        for 모델 in (C.UserProfile, S.Strategy, S.PriceAlert, S.PortfolioExperiment,
                     S.Watchlist, S.WatchlistFolder, S.Portfolio):
            assert s.query(모델).filter(모델.user_id == 나.id).count() >= 1, 모델.__tablename__
        assert s.query(S.WatchlistItem).filter(S.WatchlistItem.id == 사람들["종목"]).count() == 1
        # 공개해 둔 포트폴리오는 비공개로 — 떠난 사람의 자산 내역이 계속 보이면 안 된다
        assert s.query(S.Portfolio).filter(S.Portfolio.user_id == 나.id,
                                           S.Portfolio.is_public.is_(True)).count() == 0
    finally:
        s.close()


def test_탈퇴한_뒤에는_토큰도_로그인도_막힌다(client, 사람들):
    _탈퇴(client, 사람들["나"], password="Passw0rd!", confirm="탈퇴합니다")
    #: 이미 받아 둔 토큰 — 예전엔 비활성 계정도 토큰이 살아 있었다
    assert client.get("/api/v1/auth/me", headers=_토큰(사람들["나"])).status_code == 401
    r = client.post("/api/v1/auth/login", json={"username": "wd_me_x", "password": "Passw0rd!"})
    assert r.status_code == 403
    assert "탈퇴" in r.json()["detail"]


def test_두_번_탈퇴할_수는_없다(client, 사람들):
    """닫힌 계정의 토큰은 여기까지 오지도 못한다 — 401"""
    _탈퇴(client, 사람들["나"], password="Passw0rd!", confirm="탈퇴합니다")
    assert _탈퇴(client, 사람들["나"], password="Passw0rd!", confirm="탈퇴합니다").status_code == 401


def test_관리자가_정지한_계정의_토큰도_막힌다(client, 사람들):
    s = SessionLocal()
    s.query(User).filter(User.id == 사람들["남"]).update({User.is_active: False})
    s.commit(); s.close()
    assert client.get("/api/v1/auth/me", headers=_토큰(사람들["남"])).status_code == 401


def test_탈퇴는_아무것도_지우지_않는다(client, 사람들, monkeypatch):
    """삭제 함수를 부르면 곧바로 실패하게 해 둔다 — 탈퇴가 그걸 부르면 걸린다"""
    from app.services import account_delete as D
    monkeypatch.setattr(D, "회원지우기", lambda *a, **k: (_ for _ in ()).throw(AssertionError("지웠다")))
    assert _탈퇴(client, 사람들["나"], password="Passw0rd!", confirm="탈퇴합니다").status_code == 200


# ── 관리자 삭제: 남김없이, 남의 것은 그대로 ─────────────────────────

@pytest.fixture
def 관리자로():
    from app.api.routes import admin as A
    s = SessionLocal()
    관리자id = s.query(User.id).filter(User.username == "wd_admin_x").scalar()
    s.close()

    class 흉내:
        id = 관리자id
        is_admin = True
        username = "wd_admin_x"
    app.dependency_overrides[A.require_admin] = lambda: 흉내()
    try:
        A.limiter._storage.reset()
    except Exception:
        pass
    yield
    app.dependency_overrides.pop(A.require_admin, None)


def test_관리자_삭제는_내것과_내글에_달린_것까지_지우고_남의것은_남긴다(client, 사람들, 관리자로):
    r = client.delete(f"/api/v1/admin/users/{사람들['나']}")
    assert r.status_code == 200, r.text

    s = SessionLocal()
    try:
        나 = 사람들["나"]
        assert s.query(User).filter(User.id == 나).count() == 0
        assert s.query(C.StockPost).filter(C.StockPost.id == 사람들["글"]).count() == 0
        # 내 글에 남이 단 댓글도 같이 사라진다(글이 없으면 달릴 곳이 없다)
        assert s.query(C.StockComment).filter(C.StockComment.id == 사람들["남댓글"]).count() == 0
        # 남의 글에 단 내 댓글 → 그 밑에 남이 단 답글도 같이
        assert s.query(C.StockComment).filter(C.StockComment.id == 사람들["남답글"]).count() == 0
        assert s.query(C.StockComment).filter(C.StockComment.user_id == 나).count() == 0
        for 모델, 칸 in [(C.StockPostLike, "user_id"), (C.StockCommentLike, "user_id"),
                         (C.UserFollow, "following_id"), (C.Notification, "actor_id"),
                         (C.Notification, "user_id"), (C.UserProfile, "user_id"),
                         (S.Strategy, "user_id"), (S.PriceAlert, "user_id"),
                         (S.PortfolioExperiment, "user_id"), (S.Watchlist, "user_id"),
                         (S.WatchlistFolder, "user_id"), (S.Portfolio, "user_id")]:
            assert s.query(모델).filter(getattr(모델, 칸) == 나).count() == 0, 모델.__tablename__
        # 관심목록 종목에는 user_id 가 없다 — 목록을 거쳐 지워졌어야 한다
        assert s.query(S.WatchlistItem).filter(
            S.WatchlistItem.id.in_([사람들["종목"], 사람들["폴더없는종목"]])).count() == 0
        # 남의 계정과 남의 글은 그대로다
        assert s.query(User).filter(User.id == 사람들["남"]).count() == 1
        assert s.query(C.StockPost).filter(C.StockPost.id == 사람들["남의글"]).count() == 1
    finally:
        s.close()


def test_관리자_삭제가_중간에_실패하면_하나도_안_지운다(client, 사람들, 관리자로, monkeypatch):
    """반쯤 지워진 계정은 설명할 수 없는 상태가 된다 — 통째로 되돌린다"""
    from app.services import account_delete as D
    원래 = D._지우기

    def 중간에_터짐(db, sql, 지운수, 이름, **값):
        if 이름 == "strategies":
            raise RuntimeError("터짐")
        return 원래(db, sql, 지운수, 이름, **값)

    monkeypatch.setattr(D, "_지우기", 중간에_터짐)
    r = client.delete(f"/api/v1/admin/users/{사람들['나']}")
    assert r.status_code == 500
    s = SessionLocal()
    try:
        assert s.query(User).filter(User.id == 사람들["나"]).count() == 1
        assert s.query(C.StockPost).filter(C.StockPost.id == 사람들["글"]).count() == 1
        assert s.query(C.StockPostLike).filter(C.StockPostLike.post_id == 사람들["글"]).count() == 1
    finally:
        s.close()


def test_이미_배포된_users_표에도_탈퇴일_칸을_붙인다():
    """create_all 은 기존 표의 칸을 안 건드린다. 안 붙이면 배포 직후 users 를
    읽는 모든 요청(로그인 포함)이 'no such column' 으로 깨진다."""
    import inspect as 검사
    from app import main as M
    assert '_add_col_if_missing("users", "withdrawn_at"' in 검사.getsource(M)
