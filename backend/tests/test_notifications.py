"""
알림 — 누구에게 보내고, 언제 보내지 않는가.

알림은 남의 알림함에 글자를 넣는 기능이라, 잘못 만들면 그대로 도배 수단이 된다.
실제로 좋아요를 껐다 켜기만 반복해도 알림이 계속 쌓이는 상태였다(요청 제한은
분당 60회라 그것만으로는 못 막는다). 조용히 뚫리는 종류라 규칙을 못 박아 둔다.
"""
import inspect
import pytest

from app.api.routes import community as C
from app.models.community import Notification, UserProfile


class _FakeQuery:
    """_notify가 무엇을 찾는지만 보기 위한 최소 대역"""
    def __init__(self, found): self._found = found
    def filter(self, *a, **k): return self
    def first(self): return self._found


class _FakeDB:
    """_notify가 하는 조회는 두 가지다 — 알림 설정(UserProfile)과 중복 검사(Notification).
    둘을 구분하지 않으면 한쪽 대역이 다른 쪽 결과를 받아 엉뚱하게 통과/실패한다."""
    def __init__(self, dup=None, 꺼둔종류=""):
        self.added, self.commits, self.rollbacks = [], 0, 0
        self._dup, self._off = dup, 꺼둔종류
    def query(self, entity, *a, **k):
        if entity is UserProfile.noti_disabled:
            return _FakeQuery((self._off,))
        return _FakeQuery(self._dup)
    def add(self, obj): self.added.append(obj)
    def commit(self): self.commits += 1
    def rollback(self): self.rollbacks += 1


def notify(db, **kw):
    kw.setdefault("user_id", 1)
    kw.setdefault("actor_id", 2)
    kw.setdefault("kind", "comment")
    C._notify(db, **kw)


class Test받는사람:
    def test_보통은_알림이_쌓인다(self):
        db = _FakeDB()
        notify(db, post_id=10, preview="댓글 내용")
        assert len(db.added) == 1 and db.commits == 1
        assert db.added[0].kind == "comment" and db.added[0].post_id == 10

    def test_내_행동은_나에게_알리지_않는다(self):
        # 내 글에 내가 댓글을 달거나 좋아요를 눌러도 알림이 오면 안 된다
        db = _FakeDB()
        notify(db, user_id=5, actor_id=5, post_id=10)
        assert db.added == []

    def test_받는_사람이_없으면_아무것도_하지_않는다(self):
        db = _FakeDB()
        notify(db, user_id=0, actor_id=2)
        assert db.added == []


class Test도배_방지:
    def test_한_번만_보내야_할_종류가_정해져_있다(self):
        # 이 목록이 비면 아래 검사가 0건이 되어 조용히 통과해 버린다
        assert C._NOTI_ONCE_KINDS == {"post_like", "comment_like", "follow"}

    @pytest.mark.parametrize("kind", ["post_like", "comment_like", "follow"])
    def test_좋아요_팔로우는_두_번_쌓이지_않는다(self, kind):
        assert kind in C._NOTI_ONCE_KINDS, f"{kind}가 중복 방지 대상에서 빠졌다"
        # 껐다 켜기를 반복해 상대 알림함을 채울 수 있었다
        db = _FakeDB(dup=object())
        notify(db, kind=kind, post_id=10)
        assert db.added == [], f"{kind}가 중복으로 쌓인다"

    @pytest.mark.parametrize("kind", ["comment", "reply"])
    def test_댓글_답글은_매번_알린다(self, kind):
        # 댓글은 하나하나가 별개의 사건이라 합치면 안 된다
        db = _FakeDB(dup=object())
        notify(db, kind=kind, post_id=10, preview="새 댓글")
        assert len(db.added) == 1, f"{kind}가 합쳐졌다"


class Test알림_설정:
    """설정을 화면에서만 걸러내면, 끈 알림도 DB에 계속 쌓이고 안 읽은 개수에
    잡힌다. 배지에 숫자가 떠서 눌렀더니 아무것도 없는 상태가 된다."""

    @pytest.mark.parametrize("kind", ["comment", "reply", "post_like", "comment_like", "follow"])
    def test_끈_종류는_아예_만들지_않는다(self, kind):
        db = _FakeDB(꺼둔종류=kind)
        notify(db, kind=kind, post_id=10)
        assert db.added == [], f"{kind}를 껐는데도 알림이 쌓인다"

    def test_끄지_않은_종류는_그대로_온다(self):
        db = _FakeDB(꺼둔종류="post_like,follow")
        notify(db, kind="comment", post_id=10)
        assert len(db.added) == 1

    @pytest.mark.parametrize("저장값", [None, "", "   ", ",,"])
    def test_설정한_적_없으면_전부_켜진_상태다(self, 저장값):
        # 기존 사용자에게 값을 채워 넣지 않아도 되도록 '끈 것'만 저장한다
        db = _FakeDB(꺼둔종류=저장값)
        notify(db, kind="post_like", post_id=10)
        assert len(db.added) == 1

    def test_설정_항목이_화면과_같은_다섯_가지다(self):
        from app.api.routes.community import NotificationSettingsIn
        assert set(C._NOTI_KINDS) == set(NotificationSettingsIn.model_fields)
        assert set(C._NOTI_KINDS) == {"comment", "reply", "post_like", "comment_like", "follow"}

    def test_설정_기본값은_모두_켜짐이다(self):
        from app.api.routes.community import NotificationSettingsIn
        s = NotificationSettingsIn()
        assert all(getattr(s, k) for k in C._NOTI_KINDS)

    def test_설정은_로그인해야_바꿀_수_있다(self):
        for 함수명 in ("get_notification_settings", "update_notification_settings"):
            assert "require_user" in inspect.getsource(getattr(C, 함수명))

    def test_설정_저장에도_요청_제한이_있다(self):
        키 = "app.api.routes.community.update_notification_settings"
        assert C.limiter._route_limits.get(키), "설정 저장에 요청 제한이 없다"


class Test안전장치:
    def test_알림_저장이_실패해도_원래_작업은_살아있다(self):
        # 댓글은 이미 커밋된 뒤에 알림을 남긴다. 알림이 터졌다고
        # 댓글 작성까지 500이 되면 안 된다
        class _Boom(_FakeDB):
            def commit(self): raise RuntimeError("DB 장애")
        db = _Boom()
        notify(db, post_id=10)   # 예외가 밖으로 나오면 안 된다
        assert db.rollbacks == 1

    def test_긴_미리보기는_잘려서_저장된다(self):
        db = _FakeDB()
        notify(db, post_id=10, preview="가" * 500)
        assert len(db.added[0].preview) == C._NOTI_PREVIEW_MAX

    def test_미리보기가_없으면_None이다(self):
        db = _FakeDB()
        notify(db, kind="follow")
        assert db.added[0].preview is None


class Test알림을_남기는_지점:
    # 반응이 생기는 곳마다 알림을 붙여야 하는데, 한 군데만 빠뜨려도
    # 오류 없이 그 알림만 조용히 오지 않는다
    @pytest.mark.parametrize("함수명, 종류", [
        ("toggle_post_like",    "post_like"),
        ("toggle_comment_like", "comment_like"),
        ("create_comment",      "comment"),
        ("create_comment",      "reply"),
        ("toggle_follow",       "follow"),
    ])
    def test_반응이_생기면_알림을_남긴다(self, 함수명, 종류):
        src = inspect.getsource(getattr(C, 함수명))
        assert f'kind="{종류}"' in src, f"{함수명}에서 {종류} 알림이 빠졌다"

    def test_좋아요를_취소할_때는_알리지_않는다(self):
        for 함수명 in ("toggle_post_like", "toggle_comment_like"):
            src = inspect.getsource(getattr(C, 함수명))
            assert "if liked:" in src, f"{함수명}이 취소할 때도 알림을 보낸다"


class Test삭제_정리:
    @pytest.mark.parametrize("함수명", ["delete_post", "delete_comment"])
    def test_글_댓글을_지우면_알림도_지운다(self, 함수명):
        # 알림이 글·댓글을 외래키로 참조하므로, 남겨두면 삭제 자체가 실패한다
        src = inspect.getsource(getattr(C, 함수명))
        assert "DELETE FROM notifications" in src, f"{함수명}이 알림을 남겨둔다"


class Test조회:
    def test_남의_알림은_읽음_처리할_수_없다(self):
        src = inspect.getsource(C.mark_notification_read)
        assert "user_id = :uid" in src, "id만으로 남의 알림을 읽음 처리할 수 있다"

    def test_개수_조회는_상한까지만_센다(self):
        # 알림이 수만 건 쌓인 계정에서 매번 전체 COUNT를 돌면 부담이 크고,
        # 화면에는 어차피 99+로만 보인다
        src = inspect.getsource(C.get_unread_notification_count)
        assert "LIMIT :cap" in src

    def test_목록은_보낸_사람을_한_번에_가져온다(self):
        # 알림마다 조회하면 30건짜리 목록에 30번 질의가 나간다
        src = inspect.getsource(C.list_notifications)
        assert "User.id.in_(actor_ids)" in src
        assert "UserProfile.user_id.in_(actor_ids)" in src

    def test_알림은_로그인해야_볼_수_있다(self):
        for 함수명 in ("list_notifications", "get_unread_notification_count",
                       "mark_notification_read", "mark_all_notifications_read"):
            src = inspect.getsource(getattr(C, 함수명))
            assert "require_user" in src, f"{함수명}이 비로그인에게 열려 있다"


def test_알림_모델에_조회용_인덱스가_있다():
    # 안 읽은 개수는 화면이 떠 있는 내내 주기적으로 물어본다
    names = {ix.name for ix in Notification.__table__.indexes}
    assert "ix_notifications_user_unread" in names
