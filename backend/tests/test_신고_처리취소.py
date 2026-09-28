"""신고 처리 취소 — 한 일을 되돌리고 '대기' 로. 이 신고가 한 일만.

예전에는 되돌리기가 '블라인드 복구' 하나뿐이었고, 그것도 신고를 '기각됨'
으로 바꿨다. 삭제·기각은 되돌릴 길이 없었다.
"""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.db.database import Base, engine, SessionLocal
from app.core.security import hash_password
from app.models.user import User
from app.models import community as C
from app.models.admin_log import AdminLog

이름들 = ["rp_admin_x", "rp_writer_x", "rp_reporter_x", "rp_reporter2_x"]


def _치우기(s):
    ids = [u.id for u in s.query(User).filter(User.username.in_(이름들)).all()]
    if ids:
        s.query(C.Report).filter(C.Report.reporter_id.in_(ids)).delete(synchronize_session=False)
        글들 = [p.id for p in s.query(C.StockPost).filter(C.StockPost.user_id.in_(ids)).all()]
        if 글들:
            s.query(C.Report).filter(C.Report.post_id.in_(글들)).delete(synchronize_session=False)
            s.query(C.StockComment).filter(C.StockComment.post_id.in_(글들)).delete(synchronize_session=False)
        s.query(C.StockComment).filter(C.StockComment.user_id.in_(ids)).delete(synchronize_session=False)
        s.query(C.StockPost).filter(C.StockPost.user_id.in_(ids)).delete(synchronize_session=False)
        s.query(User).filter(User.id.in_(ids)).delete(synchronize_session=False)
    s.commit()


@pytest.fixture
def 준비():
    Base.metadata.create_all(bind=engine)
    s = SessionLocal()
    _치우기(s)
    관리자 = User(username="rp_admin_x", hashed_password=hash_password("x"), is_admin=True)
    글쓴이 = User(username="rp_writer_x", hashed_password=hash_password("x"))
    신고자 = User(username="rp_reporter_x", hashed_password=hash_password("x"))
    신고자2 = User(username="rp_reporter2_x", hashed_password=hash_password("x"))
    s.add_all([관리자, 글쓴이, 신고자, 신고자2]); s.commit()
    글 = C.StockPost(symbol="SPY", market="US", user_id=글쓴이.id, content="글")
    s.add(글); s.commit()
    댓글 = C.StockComment(post_id=글.id, user_id=글쓴이.id, content="댓글")
    s.add(댓글); s.commit()
    신고 = C.Report(reporter_id=신고자.id, post_id=글.id, reason="광고")
    댓글신고 = C.Report(reporter_id=신고자.id, post_id=글.id, comment_id=댓글.id, reason="욕설")
    s.add_all([신고, 댓글신고]); s.commit()
    #: 검사용 sqlite 는 실행 사이에 남는다. 앞 실행이 같은 신고 번호로 남긴
    #  관리 기록이 있으면 '기록 없는 옛 신고' 를 만들 수가 없다 — 치운다
    s.query(AdminLog).filter(AdminLog.target_type == "report",
                             AdminLog.target_id.in_([str(신고.id), str(댓글신고.id)])).delete(
        synchronize_session=False)
    s.commit()
    ids = {"관리자": 관리자.id, "글": 글.id, "댓글": 댓글.id, "신고": 신고.id,
           "댓글신고": 댓글신고.id, "신고자2": 신고자2.id}
    s.close()

    from app.api.routes import admin as A

    class 흉내:
        id = ids["관리자"]
        is_admin = True
        username = "rp_admin_x"
    app.dependency_overrides[A.require_admin] = lambda: 흉내()
    yield TestClient(app), ids
    app.dependency_overrides.pop(A.require_admin, None)
    s = SessionLocal(); _치우기(s); s.close()


def _글(ids):
    s = SessionLocal()
    try:
        p = s.query(C.StockPost).filter(C.StockPost.id == ids["글"]).first()
        return bool(p.is_blinded), bool(p.is_deleted)
    finally:
        s.close()


def _상태(ids, 이름="신고"):
    s = SessionLocal()
    try:
        return s.query(C.Report).filter(C.Report.id == ids[이름]).first().status
    finally:
        s.close()


def test_블라인드를_취소하면_풀리고_대기로(준비):
    c, ids = 준비
    c.patch(f"/api/v1/admin/reports/{ids['신고']}/blind")
    assert _글(ids)[0] is True
    r = c.patch(f"/api/v1/admin/reports/{ids['신고']}/reopen")
    assert r.status_code == 200, r.text
    assert _글(ids)[0] is False
    assert _상태(ids) == "pending"
    assert r.json()["action"] == "blind"


def test_삭제를_취소하면_글이_되살아난다(준비):
    c, ids = 준비
    c.delete(f"/api/v1/admin/reports/{ids['신고']}/content")
    assert _글(ids)[1] is True
    c.patch(f"/api/v1/admin/reports/{ids['신고']}/reopen")
    assert _글(ids)[1] is False
    assert _상태(ids) == "pending"


def test_댓글_신고는_댓글만_되돌린다(준비):
    c, ids = 준비
    c.patch(f"/api/v1/admin/reports/{ids['댓글신고']}/blind")
    c.patch(f"/api/v1/admin/reports/{ids['댓글신고']}/reopen")
    s = SessionLocal()
    assert s.query(C.StockComment).filter(C.StockComment.id == ids["댓글"]).first().is_blinded is False
    s.close()


def test_기각을_취소하면_대기로만(준비):
    c, ids = 준비
    c.patch(f"/api/v1/admin/reports/{ids['신고']}/dismiss")
    assert _상태(ids) == "dismissed"
    r = c.patch(f"/api/v1/admin/reports/{ids['신고']}/reopen")
    assert r.status_code == 200 and _상태(ids) == "pending"
    assert _글(ids) == (False, False)


def test_다른_신고로도_블라인드됐으면_글은_그대로(준비):
    c, ids = 준비
    s = SessionLocal()
    둘째 = C.Report(reporter_id=ids["신고자2"], post_id=ids["글"], reason="도배")
    s.add(둘째); s.commit(); 둘째id = 둘째.id; s.close()
    c.patch(f"/api/v1/admin/reports/{ids['신고']}/blind")
    c.patch(f"/api/v1/admin/reports/{둘째id}/blind")
    r = c.patch(f"/api/v1/admin/reports/{ids['신고']}/reopen")
    assert _글(ids)[0] is True, "다른 신고가 여전히 블라인드 처리 중인데 풀었다"
    assert r.json()["kept"] and not r.json()["undone"]
    assert _상태(ids) == "pending"


def test_무엇을_했는지_모르면_글을_건드리지_않는다(준비):
    """작성자가 스스로 지운 글을 되살리면 안 된다"""
    c, ids = 준비
    s = SessionLocal()
    s.query(C.StockPost).filter(C.StockPost.id == ids["글"]).update({C.StockPost.is_deleted: True})
    s.query(C.Report).filter(C.Report.id == ids["신고"]).update(
        {C.Report.status: "resolved", C.Report.action: None})
    s.commit(); s.close()
    r = c.patch(f"/api/v1/admin/reports/{ids['신고']}/reopen")
    assert r.status_code == 200
    assert _글(ids)[1] is True
    assert _상태(ids) == "pending"


def test_칸이_생기기_전에_처리한_신고는_관리_기록으로_판단한다(준비):
    c, ids = 준비
    s = SessionLocal()
    s.query(C.StockPost).filter(C.StockPost.id == ids["글"]).update({C.StockPost.is_blinded: True})
    s.query(C.Report).filter(C.Report.id == ids["신고"]).update(
        {C.Report.status: "resolved", C.Report.action: None})
    s.add(AdminLog(actor_id=ids["관리자"], actor_name="rp_admin_x", action="report.blind",
                   target_type="report", target_id=str(ids["신고"]), detail=""))
    s.commit(); s.close()
    c.patch(f"/api/v1/admin/reports/{ids['신고']}/reopen")
    assert _글(ids)[0] is False


@pytest.mark.parametrize("길, 방식, 기대", [
    ("blind", "patch", "blind"), ("content", "delete", "delete"), ("dismiss", "patch", "dismiss")])
def test_처리할_때_무엇을_했는지_신고에_적어_둔다(준비, 길, 방식, 기대):
    """관리 기록은 실패해도 처리를 막지 않는다 — 되돌릴 근거는 신고 자신에 있어야 한다"""
    c, ids = 준비
    getattr(c, 방식)(f"/api/v1/admin/reports/{ids['신고']}/{길}")
    s = SessionLocal()
    try:
        assert s.query(C.Report).filter(C.Report.id == ids["신고"]).first().action == 기대
    finally:
        s.close()


def test_대기_중인_신고는_취소할_것이_없다(준비):
    c, ids = 준비
    assert c.patch(f"/api/v1/admin/reports/{ids['신고']}/reopen").status_code == 400


def test_목록에_무엇을_처리했는지_실린다(준비):
    c, ids = 준비
    c.patch(f"/api/v1/admin/reports/{ids['신고']}/blind")
    항목 = [x for x in c.get("/api/v1/admin/reports", params={"status": "all", "limit": 50}).json()["items"]
            if x["id"] == ids["신고"]][0]
    assert 항목["action"] == "blind"


def test_이미_배포된_reports_표에도_칸을_붙인다():
    import inspect
    from app import main as M
    src = inspect.getsource(M)
    assert '_add_col_if_missing("reports", "action"' in src and '"reports"}' in src
