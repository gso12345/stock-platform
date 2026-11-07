"""1:1 메시지 — 사용자: "상대방이랑 채팅도 할 수 있도록 해줘".

실제 경로로 두 사람(가·나)과 끼어드는 사람(다)이 주고받는다. 망가지면 조용히 틀리는 곳을 하나씩 못 박는다.
  · 남의 방은 '없는 방' — 있다는 것도 알리지 않는다
  · 읽음은 뒤로 안 가고, 아직 없는 번호를 읽었다고 적지 못한다(그러면 새 메시지가 안 읽은 수에서 빠진다)
  · 나가기는 내 화면에서만 — 상대에게는 남고, 새 메시지가 오면 방이 다시 보인다
  · 차단은 양쪽 — 막힌 사람에게 '차단당했다' 고 알리지 않는다
  · 신고하면 관리자는 **그 메시지만** 본다. 메시지는 지우지 않고 가린다(보낸 사람이 지운 것이 처리 취소로 되살아나지 않게)
  · 계정을 지우면 방째로(외래키를 켜고 — PostgreSQL 에서만 터지는 순서 문제를 여기서 잡는다)
"""
import inspect
import json
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event

from app.main import app
from app.db.database import Base, engine, SessionLocal
from app.core.security import create_access_token, hash_password
from app.models.user import User
from app.models import community as C
from app.services.account_delete import 회원지우기

API = "/api/v1/community"
이름들 = ["dm_ga_x", "dm_na_x", "dm_da_x", "dm_admin_x"]


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
            회원지우기(s, u)                  # 계정 줄까지 지운다
        s.commit()
    finally:
        s.close()


@pytest.fixture
def 사람들(외래키):
    Base.metadata.create_all(bind=engine)
    _사람치우기()
    s = SessionLocal()
    가 = User(username="dm_ga_x", hashed_password=hash_password("Passw0rd!"))
    나 = User(username="dm_na_x", hashed_password=hash_password("Passw0rd!"))
    다 = User(username="dm_da_x", hashed_password=hash_password("Passw0rd!"))
    관리자 = User(username="dm_admin_x", hashed_password=hash_password("Passw0rd!"), is_admin=True)
    s.add_all([가, 나, 다, 관리자]); s.commit()
    s.add(C.UserProfile(user_id=가.id, nickname="개미왕")); s.commit()
    ids = {"가": 가.id, "나": 나.id, "다": 다.id, "관리자": 관리자.id}
    s.close()
    yield ids
    _사람치우기()


@pytest.fixture
def 알림(monkeypatch):
    """보낸 뒤 맡긴 휴대폰 알림 — 메시지 번호를 남긴다(뒤에서 실제로 보내지는 않는다)"""
    from app.services import push_service
    맡긴: list = []
    monkeypatch.setattr(push_service, "메시지_알리기", lambda 번호: 맡긴.append(번호))
    return 맡긴


@pytest.fixture
def client(알림):
    """요청 제한은 검사마다 새로 — 앞 검사가 쓴 몫을 비운다(커뮤니티 것과 앞문의 분당 300)"""
    from app.main import limiter as 앞문
    from app.api.routes import community as 커뮤니티
    for 제한 in (커뮤니티.limiter, 앞문):
        try:
            제한._storage.reset()
        except Exception:
            pass
    return TestClient(app)


def _토큰(uid):
    return {"Authorization": f"Bearer {create_access_token(data={'sub': str(uid)})}"}


def _열기(client, 나, 상대) -> int:
    r = client.post(API + "/dm/threads", json={"user_id": 상대}, headers=_토큰(나))
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _보내기(client, 나, 방, 글):
    return client.post(API + f"/dm/threads/{방}/messages", json={"body": 글}, headers=_토큰(나))


def _방들(client, 나) -> list:
    r = client.get(API + "/dm/threads", headers=_토큰(나))
    assert r.status_code == 200, r.text
    return r.json()["items"]


def _방(client, 나, 방) -> dict:
    r = client.get(API + f"/dm/threads/{방}", headers=_토큰(나))
    assert r.status_code == 200, r.text
    return r.json()


def _메시지들(client, 나, 방, **물음) -> list:
    r = client.get(API + f"/dm/threads/{방}/messages", params=물음, headers=_토큰(나))
    assert r.status_code == 200, r.text
    return r.json()["items"]


def _안읽음(client, 나) -> int:
    r = client.get(API + "/dm/unread-count", headers=_토큰(나))
    assert r.status_code == 200, r.text
    return r.json()["count"]


def _신고(client, 누가, 번호, 사유="욕설"):
    return client.post(API + f"/dm/messages/{번호}/report", json={"reason": 사유}, headers=_토큰(누가))


# ── 들어오기 ──────────────────────────────────────────────────
@pytest.mark.parametrize("방법, 주소", [
    ("GET", "/dm/threads"), ("POST", "/dm/threads"), ("GET", "/dm/unread-count"),
    ("GET", "/dm/threads/1"), ("GET", "/dm/threads/1/messages"), ("POST", "/dm/threads/1/messages"),
    ("POST", "/dm/threads/1/read"), ("POST", "/dm/threads/1/leave"), ("DELETE", "/dm/messages/1"),
    ("POST", "/dm/messages/1/report"), ("POST", "/users/1/block"), ("DELETE", "/users/1/block"),
    ("GET", "/blocks"),
])
def test_로그인_안_하면_아무것도_못_한다(client, 방법, 주소):
    r = client.request(방법, API + 주소, json={"user_id": 1, "body": "x", "last_id": 1, "reason": "x"})
    assert r.status_code == 401, (방법, 주소, r.status_code)


# ── 방 ────────────────────────────────────────────────────────
def test_자기_자신과는_방을_못_연다(client, 사람들):
    r = client.post(API + "/dm/threads", json={"user_id": 사람들["가"]}, headers=_토큰(사람들["가"]))
    assert r.status_code == 400 and "자기 자신" in r.json()["detail"]


def test_없는_사람과는_못_연다(client, 사람들):
    r = client.post(API + "/dm/threads", json={"user_id": 99_999_999}, headers=_토큰(사람들["가"]))
    assert r.status_code == 404


def test_두_사람에_방은_하나다_누가_먼저_열든(client, 사람들):
    가, 나 = 사람들["가"], 사람들["나"]
    방 = _열기(client, 가, 나)
    assert _열기(client, 나, 가) == 방, "(나, 너)·(너, 나) 가 따로 생기면 같은 대화가 둘로 갈린다"
    assert _열기(client, 가, 나) == 방
    s = SessionLocal()
    try:
        t = s.query(C.DmThread).filter(C.DmThread.id == 방).one()
        assert (t.user_a_id, t.user_b_id) == tuple(sorted((가, 나)))
        assert s.query(C.DmThread).filter(C.DmThread.user_a_id.in_([가, 나]),
                                          C.DmThread.user_b_id.in_([가, 나])).count() == 1
    finally:
        s.close()


def test_열기만_한_방은_목록에_안_나온다(client, 사람들):
    _열기(client, 사람들["가"], 사람들["나"])
    assert _방들(client, 사람들["가"]) == [] and _방들(client, 사람들["나"]) == []


def test_방에는_상대와_보낼_수_있는지가_실려_온다(client, 사람들):
    방 = _열기(client, 사람들["나"], 사람들["가"])
    d = _방(client, 사람들["나"], 방)
    assert d["other"]["id"] == 사람들["가"] and d["other"]["name"] == "개미왕"
    assert d["other"]["username"] == "dm_ga_x" and d["other"]["active"] is True
    assert d["can_send"] is True and d["i_blocked"] is False
    assert d["my_read_id"] == 0 and d["other_read_id"] == 0


# ── 메시지 ────────────────────────────────────────────────────
def test_보내면_상대_목록에_안_읽음으로_나온다(client, 사람들, 알림):
    가, 나 = 사람들["가"], 사람들["나"]
    방 = _열기(client, 가, 나)
    r = _보내기(client, 가, 방, "  안녕하세요\n  반가워요  ")
    assert r.status_code == 201, r.text
    m = r.json()
    assert m["mine"] is True and m["body"] == "안녕하세요\n  반가워요", "앞뒤 빈칸만 떼고 줄바꿈은 둔다"
    assert m["deleted"] is False and m["blinded"] is False and m["created_at"]

    내것, 상대것 = _방들(client, 가), _방들(client, 나)
    assert 내것[0]["unread"] == 0, "내가 보낸 것은 내가 읽은 것"
    assert 상대것[0]["unread"] == 1
    assert 상대것[0]["other"]["id"] == 가 and 내것[0]["other"]["id"] == 나
    assert 상대것[0]["last_message"]["preview"] == "안녕하세요 반가워요", "목록 한 줄은 줄바꿈·빈칸을 하나로"
    assert 상대것[0]["last_message"]["mine"] is False and 내것[0]["last_message"]["mine"] is True
    assert _안읽음(client, 나) == 1 and _안읽음(client, 가) == 0
    assert 알림 == [m["id"]], "보낸 뒤 상대 기기로 알림을 맡긴다 — 커밋한 그 메시지 번호로"


def test_시각에는_시간대가_붙는다(client, 사람들):
    """SQLite 는 시간대를 버리고 돌려준다 — 그대로 보내면 화면이 UTC 를 그 기기 시각으로 읽어 9시간 어긋난다"""
    가, 나 = 사람들["가"], 사람들["나"]
    방 = _열기(client, 가, 나)
    보낸 = _보내기(client, 가, 방, "몇 시?").json()
    받은 = _메시지들(client, 나, 방)[0]
    목록 = _방들(client, 나)[0]["last_message"]
    for 시각 in (보낸["created_at"], 받은["created_at"], 목록["created_at"]):
        assert 시각.endswith("+00:00"), 시각
    시각차 = abs((datetime.fromisoformat(보낸["created_at"]) - datetime.now(timezone.utc)).total_seconds())
    assert 시각차 < 120, "UTC 로 넣지 않았다"


def test_답장하면_그_앞의_것은_읽은_것이다(client, 사람들):
    """읽음을 따로 보내지 않고 답장만 해도, 상대 화면에는 자기 메시지에 '읽음' 이 떠야 한다"""
    가, 나 = 사람들["가"], 사람들["나"]
    방 = _열기(client, 가, 나)
    질문 = _보내기(client, 가, 방, "점심 뭐 먹어요?").json()["id"]
    답 = _보내기(client, 나, 방, "김밥이요").json()["id"]
    assert _방(client, 가, 방)["other_read_id"] == 답 >= 질문
    assert _방(client, 나, 방)["my_read_id"] == 답
    assert _안읽음(client, 나) == 0


def test_목록은_최근에_말이_오간_방부터(client, 사람들):
    가, 나, 다 = 사람들["가"], 사람들["나"], 사람들["다"]
    방1, 방2 = _열기(client, 가, 나), _열기(client, 가, 다)
    _보내기(client, 나, 방1, "먼저")
    _보내기(client, 다, 방2, "나중")
    assert [t["id"] for t in _방들(client, 가)] == [방2, 방1]
    _보내기(client, 나, 방1, "다시")
    assert [t["id"] for t in _방들(client, 가)] == [방1, 방2]
    assert _안읽음(client, 가) == 3, "안 읽은 수는 모든 방을 더한 것"


@pytest.mark.parametrize("글, 상태", [
    ("", 422),
    ("   \n  ", 400),
    ("가" * 1000, 201),
    ("  " + "가" * 1000 + "\n", 201),       # 앞뒤 빈칸은 세지 않는다
    ("가" * 1001, 400),
])
def test_빈_메시지와_너무_긴_메시지는_못_보낸다(client, 사람들, 글, 상태):
    방 = _열기(client, 사람들["가"], 사람들["나"])
    r = _보내기(client, 사람들["가"], 방, 글)
    assert r.status_code == 상태, r.text
    if 상태 == 400:
        assert r.json()["detail"] in ("메시지를 입력해 주세요", "메시지는 1,000자까지 보낼 수 있어요")


def test_남의_방은_없는_방처럼(client, 사람들):
    가, 나, 다 = 사람들["가"], 사람들["나"], 사람들["다"]
    방 = _열기(client, 가, 나)
    m = _보내기(client, 가, 방, "비밀").json()["id"]
    for 방법, 주소, 몸 in [
        ("GET", f"/dm/threads/{방}", None),
        ("GET", f"/dm/threads/{방}/messages", None),
        ("POST", f"/dm/threads/{방}/messages", {"body": "끼어들기"}),
        ("POST", f"/dm/threads/{방}/read", {"last_id": m}),
        ("POST", f"/dm/threads/{방}/leave", None),
    ]:
        r = client.request(방법, API + 주소, json=몸, headers=_토큰(다))
        assert r.status_code == 404 and r.json()["detail"] == "대화를 찾을 수 없어요", (방법, 주소)
    없는방 = client.get(API + "/dm/threads/99999999", headers=_토큰(다))
    assert 없는방.status_code == 404 and 없는방.json()["detail"] == "대화를 찾을 수 없어요", \
        "없는 방과 남의 방이 같은 답이어야 남의 방이 있는지도 모른다"
    assert [x["body"] for x in _메시지들(client, 가, 방)] == ["비밀"], "끼어든 메시지가 생겼다"
    assert _방(client, 나, 방)["my_read_id"] == 0, "남이 대신 읽음을 적었다"
    assert _안읽음(client, 나) == 1


def test_새_것만_묻기와_이전_것_불러오기(client, 사람들):
    가, 나 = 사람들["가"], 사람들["나"]
    방 = _열기(client, 가, 나)
    번호 = [_보내기(client, 가 if i % 2 == 0 else 나, 방, f"{i}번").json()["id"] for i in range(7)]

    r = client.get(API + f"/dm/threads/{방}/messages", params={"limit": 3}, headers=_토큰(가)).json()
    assert [x["body"] for x in r["items"]] == ["4번", "5번", "6번"], "처음에는 최근 것을 오래된 → 새 차례로"
    assert r["has_more"] is True
    assert [x["mine"] for x in r["items"]] == [True, False, True], "mine 은 보는 사람 기준"

    이전 = client.get(API + f"/dm/threads/{방}/messages", params={"before_id": 번호[4], "limit": 3},
                    headers=_토큰(가)).json()
    assert [x["body"] for x in 이전["items"]] == ["1번", "2번", "3번"] and 이전["has_more"] is True
    맨앞 = client.get(API + f"/dm/threads/{방}/messages", params={"before_id": 번호[1], "limit": 3},
                    headers=_토큰(가)).json()
    assert [x["body"] for x in 맨앞["items"]] == ["0번"] and 맨앞["has_more"] is False
    # 앞에 꼭 limit 개만 남았으면 '더 있다' 가 아니다 — 아니면 화면이 없는 것을 또 받으러 간다
    딱 = client.get(API + f"/dm/threads/{방}/messages", params={"before_id": 번호[3], "limit": 3},
                   headers=_토큰(가)).json()
    assert [x["body"] for x in 딱["items"]] == ["0번", "1번", "2번"] and 딱["has_more"] is False

    assert [x["body"] for x in _메시지들(client, 나, 방, after_id=번호[4])] == ["5번", "6번"]
    assert _메시지들(client, 나, 방, after_id=번호[6]) == []
    assert [x["body"] for x in _메시지들(client, 나, 방, after_id=0)][:2] == ["0번", "1번"]


@pytest.mark.parametrize("읽는이", ["나", "가"])   # 방의 a 쪽(번호가 작은 사람)·b 쪽 모두
def test_읽음은_뒤로_안_가고_없는_번호까지_가지_않는다(client, 사람들, 읽는이):
    나 = 사람들[읽는이]
    가 = 사람들["가" if 읽는이 == "나" else "나"]
    방 = _열기(client, 가, 나)
    m1 = _보내기(client, 가, 방, "하나").json()["id"]
    m2 = _보내기(client, 가, 방, "둘").json()["id"]
    읽기 = lambda 번호: client.post(API + f"/dm/threads/{방}/read", json={"last_id": 번호}, headers=_토큰(나))

    assert 읽기(m1).json()["read_id"] == m1
    assert _안읽음(client, 나) == 1
    assert _방(client, 가, 방)["other_read_id"] == m1, "보낸 사람 화면의 '읽음'"
    assert client.get(API + f"/dm/threads/{방}/messages", headers=_토큰(가)).json()["other_read_id"] == m1

    assert 읽기(0).json()["read_id"] == m1, "늦게 온 옛 요청이 읽음을 되돌렸다"
    assert 읽기(m2 + 1000).json()["read_id"] == m2, "아직 없는 번호를 읽었다고 적었다"
    _보내기(client, 가, 방, "셋")
    assert _안읽음(client, 나) == 1, "새 메시지가 안 읽은 수에서 빠졌다"


def test_안_읽은_수는_99까지만_센다(client, 사람들):
    가, 나 = 사람들["가"], 사람들["나"]
    방 = _열기(client, 가, 나)
    s = SessionLocal()
    try:
        for i in range(105):                # 요청 제한(분당 30)을 피해 바로 넣는다
            s.add(C.DmMessage(thread_id=방, sender_id=가, body=f"{i}"))
        s.flush()
        t = s.query(C.DmThread).filter(C.DmThread.id == 방).one()
        t.last_message_id = s.query(C.DmMessage.id).filter(C.DmMessage.thread_id == 방) \
            .order_by(C.DmMessage.id.desc()).first()[0]
        t.last_message_at = datetime.now(timezone.utc)
        s.commit()
    finally:
        s.close()
    r = client.get(API + "/dm/unread-count", headers=_토큰(나)).json()
    assert r == {"count": 99, "capped": True}
    assert _방들(client, 나)[0]["unread"] == 99
    assert client.get(API + "/dm/unread-count", headers=_토큰(가)).json() == {"count": 0, "capped": False}
    # '다음 것' 은 한 번에 100개까지 — 더 있다고 알려 이어 받게
    다음 = client.get(API + f"/dm/threads/{방}/messages", params={"after_id": 0}, headers=_토큰(나)).json()
    assert len(다음["items"]) == 100 and 다음["has_more"] is True
    assert [m["body"] for m in 다음["items"][:2]] == ["0", "1"]
    나머지 = client.get(API + f"/dm/threads/{방}/messages",
                     params={"after_id": 다음["items"][-1]["id"]}, headers=_토큰(나)).json()
    assert [m["body"] for m in 나머지["items"]] == ["100", "101", "102", "103", "104"] and 나머지["has_more"] is False
    # 처음 열 때는 최근 30개, 너무 많이 달라고 하면 거절
    처음 = client.get(API + f"/dm/threads/{방}/messages", headers=_토큰(나)).json()
    assert len(처음["items"]) == 30 and 처음["items"][-1]["body"] == "104" and 처음["has_more"] is True
    assert client.get(API + f"/dm/threads/{방}/messages", params={"limit": 101}, headers=_토큰(나)).status_code == 422


# ── 지우기 ────────────────────────────────────────────────────
def test_내가_보낸_것만_지운다_자리는_남는다(client, 사람들):
    가, 나, 다 = 사람들["가"], 사람들["나"], 사람들["다"]
    방 = _열기(client, 가, 나)
    m = _보내기(client, 가, 방, "실수로 보냄").json()["id"]
    assert client.delete(API + f"/dm/messages/{m}", headers=_토큰(나)).status_code == 404, "받은 사람이 지웠다"
    assert client.delete(API + f"/dm/messages/{m}", headers=_토큰(다)).status_code == 404
    assert _메시지들(client, 나, 방)[0]["body"] == "실수로 보냄"
    assert client.delete(API + f"/dm/messages/{m}", headers=_토큰(가)).status_code == 204
    for 누가 in (가, 나):
        줄 = _메시지들(client, 누가, 방)[0]
        assert 줄["deleted"] is True and 줄["body"] is None and 줄["blinded"] is False
    assert _방들(client, 나)[0]["last_message"]["preview"] == "삭제된 메시지예요"
    assert _안읽음(client, 나) == 0, "지운 것이 안 읽은 수에 남았다"


# ── 나가기 ────────────────────────────────────────────────────
@pytest.mark.parametrize("나가는이", ["나", "가"])   # 방의 a 쪽·b 쪽 모두
def test_나가기는_내_화면에서만_지운다(client, 사람들, 나가는이):
    나 = 사람들[나가는이]
    가 = 사람들["가" if 나가는이 == "나" else "나"]
    방 = _열기(client, 가, 나)
    _보내기(client, 가, 방, "옛날 이야기")
    _보내기(client, 나, 방, "답장")
    _보내기(client, 가, 방, "안 읽은 것")
    assert client.post(API + f"/dm/threads/{방}/leave", headers=_토큰(나)).status_code == 204
    assert _방들(client, 나) == [] and _메시지들(client, 나, 방) == []
    assert _안읽음(client, 나) == 0, "나간 방의 안 읽은 것이 남았다"
    assert [x["body"] for x in _메시지들(client, 가, 방)] == ["옛날 이야기", "답장", "안 읽은 것"], \
        "상대 화면에서도 지워졌다"
    assert len(_방들(client, 가)) == 1

    _보내기(client, 가, 방, "새 이야기")
    다시 = _방들(client, 나)
    assert len(다시) == 1 and 다시[0]["unread"] == 1, "새 메시지가 왔는데 방이 안 보인다"
    assert [x["body"] for x in _메시지들(client, 나, 방)] == ["새 이야기"], "나간 앞의 것이 다시 보인다"
    assert [x["body"] for x in _메시지들(client, 나, 방, after_id=0)] == ["새 이야기"]


# ── 차단 ──────────────────────────────────────────────────────
def test_차단하면_어느_쪽에서도_못_보낸다(client, 사람들):
    가, 나 = 사람들["가"], 사람들["나"]
    방 = _열기(client, 가, 나)
    _보내기(client, 나, 방, "안녕")
    assert client.post(API + f"/users/{나}/block", headers=_토큰(가)).json() == {"blocked": True}
    for 보내는이 in (가, 나):
        r = _보내기(client, 보내는이, 방, "막혔나?")
        assert r.status_code == 403 and r.json()["detail"] == "메시지를 보낼 수 없어요", 보내는이
    가쪽, 나쪽 = _방(client, 가, 방), _방(client, 나, 방)
    assert 가쪽["can_send"] is False and 가쪽["i_blocked"] is True
    assert 나쪽["can_send"] is False and 나쪽["i_blocked"] is False, "막힌 사람에게 '차단당했다' 고 알렸다"
    assert [x["body"] for x in _메시지들(client, 가, 방)] == ["안녕"], "나눈 것은 그대로 본다"

    assert client.get(API + f"/users/{나}/profile", headers=_토큰(가)).json()["i_blocked"] is True
    assert client.get(API + f"/users/{가}/profile", headers=_토큰(나)).json()["i_blocked"] is False
    assert client.get(API + f"/users/{나}/profile").json()["i_blocked"] is False, "로그인 안 한 사람"

    assert client.post(API + f"/users/{나}/block", headers=_토큰(가)).status_code == 200, "두 번 눌러도"
    막은 = client.get(API + "/blocks", headers=_토큰(가)).json()["items"]
    assert [b["id"] for b in 막은] == [나] and 막은[0]["name"] == "dm_na_x" and 막은[0]["blocked_at"]
    assert client.get(API + "/blocks", headers=_토큰(나)).json()["items"] == []

    assert client.delete(API + f"/users/{나}/block", headers=_토큰(가)).json() == {"blocked": False}
    assert _보내기(client, 나, 방, "다시 안녕").status_code == 201
    assert _방(client, 가, 방)["can_send"] is True
    assert client.get(API + "/blocks", headers=_토큰(가)).json()["items"] == []


def test_차단을_풀어도_상대가_막은_것은_그대로(client, 사람들):
    가, 나 = 사람들["가"], 사람들["나"]
    방 = _열기(client, 가, 나)
    client.post(API + f"/users/{가}/block", headers=_토큰(나))
    client.delete(API + f"/users/{나}/block", headers=_토큰(가))      # 가는 막은 적이 없다 — 나의 차단이 풀리면 안 된다
    assert _보내기(client, 가, 방, "풀렸나?").status_code == 403


def test_차단_대상이_잘못되면(client, 사람들):
    assert client.post(API + f"/users/{사람들['가']}/block", headers=_토큰(사람들["가"])).status_code == 400
    assert client.post(API + "/users/99999999/block", headers=_토큰(사람들["가"])).status_code == 404


def test_커뮤니티_이용이_막힌_계정은_보내지_못하고_읽기는_된다(client, 사람들):
    가, 나, 다 = 사람들["가"], 사람들["나"], 사람들["다"]
    방 = _열기(client, 가, 나)
    _보내기(client, 나, 방, "안녕")
    s = SessionLocal()
    try:
        s.query(User).filter(User.id == 가).update({"is_community_banned": True})
        s.commit()
    finally:
        s.close()
    assert _보내기(client, 가, 방, "답장").status_code == 403
    assert client.post(API + "/dm/threads", json={"user_id": 다}, headers=_토큰(가)).status_code == 403
    assert [x["body"] for x in _메시지들(client, 가, 방)] == ["안녕"]
    assert _방(client, 가, 방)["can_send"] is False
    assert _방(client, 나, 방)["can_send"] is True, "막힌 것은 보내는 사람 — 받는 쪽은 보낼 수 있다"


def test_탈퇴한_상대는_이름이_가려지고_보낼_수_없다(client, 사람들):
    가, 나 = 사람들["가"], 사람들["나"]
    방 = _열기(client, 가, 나)
    _보내기(client, 가, 방, "잘 지내요")
    s = SessionLocal()
    try:
        s.query(User).filter(User.id == 가).update(
            {"is_active": False, "withdrawn_at": datetime.now(timezone.utc)})
        s.commit()
    finally:
        s.close()
    상대 = _방들(client, 나)[0]["other"]
    assert 상대["name"] == "탈퇴한 사용자" and 상대["username"] is None and 상대["avatar_url"] is None
    assert 상대["active"] is False
    assert _방(client, 나, 방)["can_send"] is False
    assert _보내기(client, 나, 방, "어디 갔어요").status_code == 403
    assert [x["body"] for x in _메시지들(client, 나, 방)] == ["잘 지내요"], "나눈 대화는 남은 사람에게 남는다"
    assert client.post(API + "/dm/threads", json={"user_id": 가}, headers=_토큰(나)).status_code == 404


# ── 신고 ──────────────────────────────────────────────────────
def test_탈퇴_표시만_남아도_보낼_수_없다(client, 사람들):
    """관리자가 계정을 다시 열어도(is_active) 탈퇴한 계정은 로그인하지 못한다 — 메시지도 못 받는 사람으로 본다"""
    가, 나 = 사람들["가"], 사람들["나"]
    방 = _열기(client, 가, 나)
    s = SessionLocal()
    try:
        s.query(User).filter(User.id == 가).update({"is_active": True, "withdrawn_at": datetime.now(timezone.utc)})
        s.commit()
    finally:
        s.close()
    assert _방(client, 나, 방)["can_send"] is False
    assert _방(client, 나, 방)["other"]["name"] == "탈퇴한 사용자"
    assert _보내기(client, 나, 방, "계세요?").status_code == 403
    assert client.post(API + "/dm/threads", json={"user_id": 가}, headers=_토큰(나)).status_code == 404


def test_받은_메시지만_신고한다(client, 사람들):
    가, 나, 다 = 사람들["가"], 사람들["나"], 사람들["다"]
    방 = _열기(client, 가, 나)
    받은 = _보내기(client, 가, 방, "나쁜 말").json()["id"]
    보낸 = _보내기(client, 나, 방, "그러지 마세요").json()["id"]
    assert _신고(client, 나, 받은).status_code == 201
    assert _신고(client, 나, 받은).status_code == 409
    assert _신고(client, 나, 보낸).status_code == 400
    assert _신고(client, 다, 받은).status_code == 404, "남의 방 메시지를 신고했다"
    assert _신고(client, 나, 99999999).status_code == 404
    assert _신고(client, 나, 받은, 사유="").status_code == 422


@pytest.fixture
def 관리자(사람들):
    return _토큰(사람들["관리자"])


def _그신고(client, 관리자, 메시지번호) -> dict:
    목록 = client.get("/api/v1/admin/reports", params={"status": "all"}, headers=관리자).json()["items"]
    return next(x for x in 목록 if x.get("message_id") == 메시지번호)


def test_관리자는_신고된_그_메시지만_보고_가린다(client, 사람들, 관리자):
    가, 나 = 사람들["가"], 사람들["나"]
    방 = _열기(client, 가, 나)
    나쁜 = _보내기(client, 가, 방, "나쁜 말").json()["id"]
    _보내기(client, 가, 방, "대화의 다른 말")
    _신고(client, 나, 나쁜)

    목록 = client.get("/api/v1/admin/reports", params={"status": "pending"}, headers=관리자).json()["items"]
    r = next(x for x in 목록 if x.get("message_id") == 나쁜)
    assert r["message_preview"] == "나쁜 말" and r["message_author"] == "dm_ga_x"
    assert r["message_is_blinded"] is False and r["message_is_deleted"] is False
    assert r["post_id"] is None and r["comment_id"] is None
    assert "대화의 다른 말" not in json.dumps(목록, ensure_ascii=False), "신고하지 않은 메시지까지 관리자에게 보였다"

    assert client.patch(f"/api/v1/admin/reports/{r['id']}/blind", headers=관리자).status_code == 200
    for 누가 in (가, 나):
        줄 = next(x for x in _메시지들(client, 누가, 방) if x["id"] == 나쁜)
        assert 줄["blinded"] is True and 줄["body"] is None and 줄["deleted"] is False
    assert _그신고(client, 관리자, 나쁜)["message_is_blinded"] is True

    취소 = client.patch(f"/api/v1/admin/reports/{r['id']}/reopen", headers=관리자).json()
    assert 취소["undone"] == [f"메시지 #{나쁜} 블라인드 해제"]
    줄 = next(x for x in _메시지들(client, 나, 방) if x["id"] == 나쁜)
    assert 줄["blinded"] is False and 줄["body"] == "나쁜 말"


def test_블라인드를_풀면_다시_보인다(client, 사람들, 관리자):
    가, 나 = 사람들["가"], 사람들["나"]
    방 = _열기(client, 가, 나)
    나쁜 = _보내기(client, 가, 방, "나쁜 말").json()["id"]
    _신고(client, 나, 나쁜)
    rid = _그신고(client, 관리자, 나쁜)["id"]
    client.patch(f"/api/v1/admin/reports/{rid}/blind", headers=관리자)
    assert _방들(client, 나)[0]["last_message"]["preview"] == "운영 정책으로 가려진 메시지예요"
    assert client.patch(f"/api/v1/admin/reports/{rid}/unblind", headers=관리자).status_code == 200
    assert _메시지들(client, 나, 방)[0]["body"] == "나쁜 말"


def test_메시지는_지우지_않고_가린다(client, 사람들, 관리자):
    가, 나 = 사람들["가"], 사람들["나"]
    방 = _열기(client, 가, 나)
    나쁜 = _보내기(client, 가, 방, "나쁜 말").json()["id"]
    _신고(client, 나, 나쁜)
    rid = _그신고(client, 관리자, 나쁜)["id"]
    r = client.delete(f"/api/v1/admin/reports/{rid}/content", headers=관리자)
    assert r.status_code == 400 and "블라인드" in r.json()["detail"]
    assert _그신고(client, 관리자, 나쁜)["status"] == "pending", "거절했는데 처리된 것으로 남았다"
    assert _메시지들(client, 나, 방)[0]["deleted"] is False


def test_보낸_사람이_지운_메시지는_신고_취소로_되살아나지_않는다(client, 사람들, 관리자):
    가, 나 = 사람들["가"], 사람들["나"]
    방 = _열기(client, 가, 나)
    나쁜 = _보내기(client, 가, 방, "나쁜 말").json()["id"]
    _신고(client, 나, 나쁜)
    client.delete(API + f"/dm/messages/{나쁜}", headers=_토큰(가))       # 신고당하자 스스로 지웠다
    rid = _그신고(client, 관리자, 나쁜)["id"]
    assert _그신고(client, 관리자, 나쁜)["message_preview"] == "나쁜 말", "지워도 관리자는 신고된 글을 본다"
    client.patch(f"/api/v1/admin/reports/{rid}/blind", headers=관리자)
    client.patch(f"/api/v1/admin/reports/{rid}/reopen", headers=관리자)
    줄 = _메시지들(client, 나, 방)[0]
    assert 줄["deleted"] is True and 줄["body"] is None, "보낸 사람이 지운 메시지가 되살아났다"


# ── 계정 지우기 ───────────────────────────────────────────────
def test_계정을_지우면_그_사람의_방이_통째로_사라진다(client, 사람들):
    """외래키를 켠 채로 — 순서가 틀리면 PostgreSQL 처럼 여기서도 막힌다"""
    가, 나, 다 = 사람들["가"], 사람들["나"], 사람들["다"]
    방1 = _열기(client, 가, 나)
    나의말 = _보내기(client, 나, 방1, "가에게").json()["id"]
    가의말 = _보내기(client, 가, 방1, "나에게").json()["id"]
    _신고(client, 가, 나의말)                # 지울 사람이 한 신고
    _신고(client, 나, 가의말)                # 지울 사람이 받은 신고
    방2 = _열기(client, 나, 다)
    _보내기(client, 나, 방2, "다에게")
    client.post(API + f"/users/{가}/block", headers=_토큰(다))
    client.post(API + f"/users/{다}/block", headers=_토큰(가))

    s = SessionLocal()
    try:
        지운수 = 회원지우기(s, s.query(User).filter(User.id == 가).one())
        s.commit()
        assert 지운수.get("dm_threads") == 1 and 지운수.get("dm_messages") == 2
        assert s.query(C.DmThread).filter(C.DmThread.id == 방1).count() == 0
        assert s.query(C.DmMessage).filter(C.DmMessage.thread_id == 방1).count() == 0, "상대가 보낸 것도 같이"
        assert s.query(C.Report).filter(C.Report.message_id.in_([나의말, 가의말])).count() == 0
        assert s.query(C.UserBlock).filter((C.UserBlock.blocker_id == 가) | (C.UserBlock.blocked_id == 가)).count() == 0
        assert s.query(C.DmMessage).filter(C.DmMessage.thread_id == 방2).count() == 1, "남의 방까지 지웠다"
    finally:
        s.close()
    assert [t["id"] for t in _방들(client, 나)] == [방2]


# ── 요청 제한 ────────────────────────────────────────────────
_제한 = {
    "open_thread": ["60/hour"],
    "send_message": ["30/minute", "1000/day"],
    "mark_read": ["240/minute"],
    "leave_thread": ["30/minute"],
    "delete_message": ["30/minute"],
    "report_message": ["20/hour"],
    "block_user": ["30/minute"],
    "unblock_user": ["30/minute"],
}


@pytest.mark.parametrize("함수명, 제한들", sorted(_제한.items()))
def test_쓰기에는_요청_제한이_걸려_있다(함수명, 제한들):
    from app.api.routes import community as 커뮤니티, dm as D
    등록 = 커뮤니티.limiter._route_limits.get(f"app.api.routes.dm.{함수명}")
    assert 등록, f"{함수명}에 요청 제한이 없다"
    def 글(x):
        횟수, 단위 = x.split("/")
        return f"{횟수} per 1 {단위}"
    assert sorted(str(x.limit) for x in 등록) == sorted(글(x) for x in 제한들)
    assert "request" in inspect.signature(getattr(D, 함수명)).parameters, \
        f"{함수명}에 request 파라미터가 없어 요청 제한이 조용히 사라진다"


def test_읽기에는_제한을_걸지_않는다():
    """방이 열려 있는 동안 몇 초마다 묻는다 — 읽기에 걸면 대화 중에 막힌다"""
    from app.api.routes import dm as D
    for 함수명 in ("list_threads", "get_thread", "list_messages", "dm_unread_count", "list_blocks"):
        assert "request" not in inspect.signature(getattr(D, 함수명)).parameters, 함수명


def test_빠르게_연달아_보내면_막히고_다른_사람은_상관없다(client, 사람들):
    가, 나, 다 = 사람들["가"], 사람들["나"], 사람들["다"]
    방 = _열기(client, 가, 나)
    for i in range(30):
        assert _보내기(client, 가, 방, f"{i}").status_code == 201, i
    assert _보내기(client, 가, 방, "서른하나").status_code == 429
    assert _보내기(client, 나, 방, "나는 된다").status_code == 201, "한도를 계정끼리 나눠 쓴다"
    assert _보내기(client, 다, _열기(client, 다, 가), "나도").status_code == 201


def test_주소의_번호_이름은_영어다():
    """한글 경로 변수는 일부 프록시·문서 도구가 깨뜨린다(다른 경로와 같은 규칙)"""
    from app.api.routes import dm as D
    for r in D.router.routes:
        for 이름 in r.param_convertors:
            assert 이름.isascii(), (r.path, 이름)
