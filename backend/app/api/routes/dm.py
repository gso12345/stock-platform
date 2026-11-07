"""1:1 대화(메시지) — 사용자: "상대방이랑 채팅도 할 수 있도록 해줘".

  POST   /community/dm/threads                     {user_id} → 그 사람과의 방(없으면 만든다)
  GET    /community/dm/threads                     내 방들 — 마지막 메시지·안 읽은 수
  GET    /community/dm/threads/{thread_id}         방 하나 — 상대·보낼 수 있나·상대가 어디까지 읽었나
  GET    /community/dm/threads/{thread_id}/messages?before_id=&after_id=   메시지(이전 것·새 것)
  POST   /community/dm/threads/{thread_id}/messages {body}
  POST   /community/dm/threads/{thread_id}/read     {last_id}
  POST   /community/dm/threads/{thread_id}/leave    나가기 — 지금까지를 내 화면에서 지운다(상대에게는 남는다)
  DELETE /community/dm/messages/{message_id}        내가 보낸 것 지우기('삭제된 메시지예요' 로 남는다)
  POST   /community/dm/messages/{message_id}/report {reason}
  GET    /community/dm/unread-count
  POST/DELETE /community/users/{user_id}/block · GET /community/blocks

── 실시간은 '자주 묻기' 로 ──────────────────────────────────

웹소켓은 사람별 연결을 들고 있어야 하는데, 서버가 자고 깨는 곳(Render)에서는 연결이 자주 끊기고 다시 붙이는 동안 놓친
메시지를 따로 메워야 한다. 화면이 열린 방만 몇 초마다 '이 번호 다음 것' 을 묻는다(after_id) — 번호가 곧 차례라 놓칠 것이
없다. 앱을 닫아 두면 휴대폰 알림으로 온다.

── 막는 것 ──────────────────────────────────────────────────

· 방의 두 사람만 — 남의 방은 '없는 방' 으로 답한다(있다는 것도 알리지 않는다)
· 차단은 양쪽 — 내가 막았든 상대가 막았든 메시지가 안 오간다. 상대에게 '차단당했다' 고 알리지 않는다
· 커뮤니티 이용이 막힌 계정은 보내지 못한다(읽기는 된다)
· 자동 반복은 요청 제한으로 — 사람이 손으로 쓰는 속도보다 넉넉하게

`from __future__ import annotations` 를 쓰지 않는다 — 요청 제한(slowapi)이 감싼 함수는 FastAPI 가 감싼 쪽 모듈에서
입력 모양(열기In 등)의 이름을 찾아 못 찾는다(PydanticUserError: not fully defined).
"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Path, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.routes.community import ReportIn, _사진주소, display_name, limiter
from app.core.deps import require_community_active, require_user
from app.db.database import get_db
from app.models.community import DmMessage, DmThread, Report, UserBlock, UserProfile
from app.models.user import User

router = APIRouter(prefix="/community", tags=["dm"])

#: 한 메시지의 글자 수 — 화면(frontend/src/constants/community.ts DM_MAX)과 같아야 한다
메시지_최대 = 1000
#: 방 목록 한 번에
목록_최대 = 50
#: 메시지를 한 번에 — 처음 열 때와 '이전 메시지' 마다
불러오기_기본 = 30
불러오기_최대 = 100
#: 안 읽은 수는 이만큼까지만 센다(종 모양과 같은 99+)
안읽음_한도 = 99
#: 목록·알림에 보일 앞부분
미리보기_길이 = 60


# ── 도우미 ────────────────────────────────────────────────────
def _쪽(t: DmThread, uid: int) -> str:
    return "a" if t.user_a_id == uid else "b"


def _상대(t: DmThread, uid: int) -> int:
    return t.user_b_id if t.user_a_id == uid else t.user_a_id


def _읽은(t: DmThread, uid: int) -> int:
    return (t.a_read_id if _쪽(t, uid) == "a" else t.b_read_id) or 0


def _지운(t: DmThread, uid: int) -> int:
    return (t.a_cleared_id if _쪽(t, uid) == "a" else t.b_cleared_id) or 0


def _읽음적기(t: DmThread, uid: int, 번호: int) -> None:
    """어디까지 읽었나 — **뒤로는 안 간다**(늦게 도착한 옛 요청이 읽음을 되돌리지 않게)"""
    if _쪽(t, uid) == "a":
        t.a_read_id = max(t.a_read_id or 0, 번호)
    else:
        t.b_read_id = max(t.b_read_id or 0, 번호)


def 막혔나(db: Session, 가: int, 나: int) -> bool:
    """둘 사이에 차단이 있나 — 어느 쪽이 막았든"""
    return db.query(UserBlock.id).filter(or_(
        and_(UserBlock.blocker_id == 가, UserBlock.blocked_id == 나),
        and_(UserBlock.blocker_id == 나, UserBlock.blocked_id == 가),
    )).first() is not None


def _내가막았나(db: Session, 나: int, 상대: int) -> bool:
    return db.query(UserBlock.id).filter(UserBlock.blocker_id == 나, UserBlock.blocked_id == 상대).first() is not None


def _살아있나(u: Optional[User]) -> bool:
    return bool(u) and bool(getattr(u, "is_active", True)) and not getattr(u, "withdrawn_at", None)


def 보낼수있나(db: Session, 나: User, 상대: Optional[User]) -> bool:
    """메시지를 보낼 수 있나 — 상대가 있고(탈퇴·정지 아님), 차단이 없고, 내가 커뮤니티 이용이 막히지 않았다"""
    if not _살아있나(상대) or getattr(나, "is_community_banned", False):
        return False
    return not 막혔나(db, 나.id, 상대.id)


def _사람(u: Optional[User], p: Optional[UserProfile]) -> dict:
    """상대 한 사람 — active 가 거짓이면 화면이 프로필로 잇지 않고 '대화할 수 없는 상대' 로 그린다"""
    if u is not None and getattr(u, "withdrawn_at", None):
        #: 탈퇴한 사람 — 이름·사진은 더 보이지 않는다(나눈 대화는 남은 사람에게 그대로 남는다)
        return {"id": u.id, "name": "탈퇴한 사용자", "username": None, "avatar_url": None, "avatar_color": 0,
                "active": False}
    return {
        "id": u.id if u else None,
        "name": display_name(u, p),
        "username": u.username if u else None,
        "avatar_url": _사진주소(p) if p else None,
        "avatar_color": (p.avatar_color if p else 0) or 0,
        "active": _살아있나(u),
    }


def _미리보기(m: Optional[DmMessage]) -> str:
    if m is None:
        return ""
    if m.is_deleted:
        return "삭제된 메시지예요"
    if m.is_blinded:
        return "운영 정책으로 가려진 메시지예요"
    return " ".join((m.body or "").split())[:미리보기_길이]


def _시각(d: Optional[datetime]) -> Optional[str]:
    """시간대를 붙여 보낸다 — SQLite 는 시간대를 버리고 돌려준다(PostgreSQL 은 붙여 준다). 붙이지 않으면 화면이
    UTC 시각을 그 기기의 시각으로 읽어 한국에서 9시간 어긋난다. 넣을 때는 늘 UTC 다(보내기·server_default)"""
    if not d:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.isoformat()


def _메시지(m: DmMessage, uid: int) -> dict:
    """한 줄 — 지운 것·가린 것은 글을 안 싣는다(화면이 자리만 그린다)"""
    가림 = bool(m.is_deleted or m.is_blinded)
    return {
        "id": m.id,
        "mine": m.sender_id == uid,
        "body": None if 가림 else m.body,
        "deleted": bool(m.is_deleted),
        "blinded": bool(m.is_blinded) and not m.is_deleted,
        "created_at": _시각(m.created_at),
    }


def _내방(db: Session, thread_id: int, uid: int) -> DmThread:
    """내가 든 방 — 남의 방은 없는 방처럼(있다는 것도 알리지 않는다)"""
    t = db.query(DmThread).filter(DmThread.id == thread_id).first()
    if not t or uid not in (t.user_a_id, t.user_b_id):
        raise HTTPException(404, "대화를 찾을 수 없어요")
    return t


def _안읽음조건(uid: int):
    """내가 안 읽은 메시지 — 남이 보냈고, 지우지 않았고, 내 읽음 번호보다 뒤.

    나가기 번호는 따로 안 본다 — 나가기는 읽음도 그 번호까지 올리고(leave_thread) 읽음은 뒤로 가지 않으니,
    읽음보다 뒤면 늘 나가기보다도 뒤다"""
    return and_(
        DmMessage.sender_id != uid,
        DmMessage.is_deleted.isnot(True),
        or_(
            and_(DmThread.user_a_id == uid, DmMessage.id > DmThread.a_read_id),
            and_(DmThread.user_b_id == uid, DmMessage.id > DmThread.b_read_id),
        ),
    )


# ── 방 열기 ───────────────────────────────────────────────────
class 열기In(BaseModel):
    user_id: int = Field(..., ge=1)


@router.post("/dm/threads")
@limiter.limit("60/hour")
def open_thread(
    request: Request,
    body: 열기In = Body(...),
    db: Session = Depends(get_db),
    current: User = Depends(require_community_active),
):
    """그 사람과의 방 — 없으면 만든다. 만들기만 해서는 목록에 안 나온다(메시지가 오가야 나온다)"""
    if body.user_id == current.id:
        raise HTTPException(400, "자기 자신에게는 메시지를 보낼 수 없어요")
    상대 = db.query(User).filter(User.id == body.user_id).first()
    if not _살아있나(상대):
        raise HTTPException(404, "사용자를 찾을 수 없어요")
    가, 나 = sorted((current.id, 상대.id))
    t = db.query(DmThread).filter(DmThread.user_a_id == 가, DmThread.user_b_id == 나).first()
    if not t:
        t = DmThread(user_a_id=가, user_b_id=나)
        db.add(t)
        try:
            db.commit()
        except IntegrityError:
            # 두 사람이 동시에 열었다 — 먼저 만든 방을 쓴다
            db.rollback()
            t = db.query(DmThread).filter(DmThread.user_a_id == 가, DmThread.user_b_id == 나).first()
            if not t:
                raise HTTPException(500, "대화를 열지 못했어요")
    return {"id": t.id}


# ── 방 목록 ───────────────────────────────────────────────────
@router.get("/dm/threads")
def list_threads(
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
):
    uid = current.id
    방들 = (db.query(DmThread)
            .filter(DmThread.last_message_id.isnot(None))
            #: 내가 든 방 중 '나가기' 뒤로 새 메시지가 있는 것만
            .filter(or_(and_(DmThread.user_a_id == uid, DmThread.last_message_id > DmThread.a_cleared_id),
                        and_(DmThread.user_b_id == uid, DmThread.last_message_id > DmThread.b_cleared_id)))
            .order_by(DmThread.last_message_at.desc(), DmThread.id.desc())
            .limit(목록_최대).all())
    if not 방들:
        return {"items": []}
    방번호 = [t.id for t in 방들]
    상대들 = {_상대(t, uid) for t in 방들}
    사람표 = {u.id: u for u in db.query(User).filter(User.id.in_(상대들)).all()}
    모습표 = {p.user_id: p for p in db.query(UserProfile).filter(UserProfile.user_id.in_(상대들)).all()}
    마지막표 = {m.id: m for m in db.query(DmMessage).filter(
        DmMessage.id.in_([t.last_message_id for t in 방들])).all()}
    안읽음 = dict(db.query(DmMessage.thread_id, func.count(DmMessage.id))
                  .join(DmThread, DmThread.id == DmMessage.thread_id)
                  .filter(DmMessage.thread_id.in_(방번호), _안읽음조건(uid))
                  .group_by(DmMessage.thread_id).all())
    items = []
    for t in 방들:
        o = _상대(t, uid)
        m = 마지막표.get(t.last_message_id)
        items.append({
            "id": t.id,
            "other": _사람(사람표.get(o), 모습표.get(o)),
            "last_message": {
                "id": t.last_message_id,
                "mine": bool(m and m.sender_id == uid),
                "preview": _미리보기(m),
                "created_at": _시각(m.created_at if m else t.last_message_at),
            },
            "unread": min(int(안읽음.get(t.id, 0)), 안읽음_한도),
        })
    return {"items": items}


# ── 방 하나 ───────────────────────────────────────────────────
@router.get("/dm/threads/{thread_id}")
def get_thread(
    thread_id: int = Path(..., ge=1),
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
):
    t = _내방(db, thread_id, current.id)
    o = _상대(t, current.id)
    상대 = db.query(User).filter(User.id == o).first()
    모습 = db.query(UserProfile).filter(UserProfile.user_id == o).first()
    return {
        "id": t.id,
        "other": _사람(상대, 모습),
        "can_send": 보낼수있나(db, current, 상대),
        "i_blocked": _내가막았나(db, current.id, o),
        "my_read_id": _읽은(t, current.id),
        "other_read_id": _읽은(t, o),
    }


# ── 메시지 ────────────────────────────────────────────────────
@router.get("/dm/threads/{thread_id}/messages")
def list_messages(
    thread_id: int = Path(..., ge=1),
    before_id: Optional[int] = Query(None, ge=1),
    after_id: Optional[int] = Query(None, ge=0),
    limit: int = Query(불러오기_기본, ge=1, le=불러오기_최대),
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
):
    """오래된 → 새 차례로. after_id 는 '그 다음 것' (몇 초마다 묻는 데 쓴다), before_id 는 '그 앞 것'(이전 메시지).

    나가기 한 곳(cleared) 앞은 안 준다 — 내 화면에서는 지운 것이다."""
    t = _내방(db, thread_id, current.id)
    q = db.query(DmMessage).filter(DmMessage.thread_id == t.id, DmMessage.id > _지운(t, current.id))
    if after_id is not None:
        줄들 = q.filter(DmMessage.id > after_id).order_by(DmMessage.id.asc()).limit(불러오기_최대 + 1).all()
        더 = len(줄들) > 불러오기_최대
        줄들 = 줄들[:불러오기_최대]
    else:
        if before_id is not None:
            q = q.filter(DmMessage.id < before_id)
        줄들 = q.order_by(DmMessage.id.desc()).limit(limit + 1).all()
        더 = len(줄들) > limit
        줄들 = list(reversed(줄들[:limit]))
    return {
        "items": [_메시지(m, current.id) for m in 줄들],
        "has_more": 더,
        "other_read_id": _읽은(t, _상대(t, current.id)),
    }


class 보내기In(BaseModel):
    body: str = Field(..., min_length=1, max_length=메시지_최대 * 2)


@router.post("/dm/threads/{thread_id}/messages", status_code=201)
@limiter.limit("30/minute")
@limiter.limit("1000/day")
def send_message(
    request: Request,
    thread_id: int = Path(..., ge=1),
    body: 보내기In = Body(...),
    db: Session = Depends(get_db),
    current: User = Depends(require_community_active),
):
    t = _내방(db, thread_id, current.id)
    글 = (body.body or "").strip()
    if not 글:
        raise HTTPException(400, "메시지를 입력해 주세요")
    if len(글) > 메시지_최대:
        raise HTTPException(400, f"메시지는 {메시지_최대:,}자까지 보낼 수 있어요")
    상대 = db.query(User).filter(User.id == _상대(t, current.id)).first()
    if not 보낼수있나(db, current, 상대):
        raise HTTPException(403, "메시지를 보낼 수 없어요")
    이제 = datetime.now(timezone.utc)
    m = DmMessage(thread_id=t.id, sender_id=current.id, body=글, created_at=이제)
    db.add(m)
    db.flush()
    t.last_message_id = m.id
    t.last_message_at = 이제
    _읽음적기(t, current.id, m.id)          # 내가 보낸 것은 내가 읽은 것
    db.commit()
    #: 커밋한 뒤에 — 상대 기기로 알림(뒤에서 보낸다. 실패해도 메시지는 남아 있다)
    from app.services import push_service
    push_service.메시지_알리기(m.id)
    return _메시지(m, current.id)


class 읽음In(BaseModel):
    last_id: int = Field(..., ge=0)


@router.post("/dm/threads/{thread_id}/read")
@limiter.limit("240/minute")
def mark_read(
    request: Request,
    thread_id: int = Path(..., ge=1),
    body: 읽음In = Body(...),
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
):
    """여기까지 읽었다 — 방의 마지막 번호를 넘지 않게(아직 없는 번호를 '읽었다' 고 적으면 새 메시지가 안 읽은 수에서 빠진다)"""
    t = _내방(db, thread_id, current.id)
    _읽음적기(t, current.id, min(body.last_id, t.last_message_id or 0))
    db.commit()
    return {"read_id": _읽은(t, current.id)}


@router.post("/dm/threads/{thread_id}/leave", status_code=204)
@limiter.limit("30/minute")
def leave_thread(
    request: Request,
    thread_id: int = Path(..., ge=1),
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
):
    """나가기 — 지금까지를 **내 화면에서만** 지운다. 상대에게는 그대로 남고, 새 메시지가 오면 방이 다시 보인다"""
    t = _내방(db, thread_id, current.id)
    끝 = t.last_message_id or 0
    if _쪽(t, current.id) == "a":
        t.a_cleared_id = max(t.a_cleared_id or 0, 끝)
    else:
        t.b_cleared_id = max(t.b_cleared_id or 0, 끝)
    _읽음적기(t, current.id, 끝)
    db.commit()


@router.delete("/dm/messages/{message_id}", status_code=204)
@limiter.limit("30/minute")
def delete_message(
    request: Request,
    message_id: int = Path(..., ge=1),
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
):
    """내가 보낸 것만 — 줄은 남기고 글만 감춘다('삭제된 메시지예요'). 남이 보낸 것은 없는 것처럼 답한다"""
    m = db.query(DmMessage).filter(DmMessage.id == message_id).first()
    if not m or m.sender_id != current.id:
        raise HTTPException(404, "메시지를 찾을 수 없어요")
    m.is_deleted = True
    db.commit()


@router.post("/dm/messages/{message_id}/report", status_code=201)
@limiter.limit("20/hour")
def report_message(
    request: Request,
    message_id: int = Path(..., ge=1),
    body: ReportIn = Body(...),
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
):
    """받은 메시지 신고 — 신고하면 관리자가 그 메시지를 본다(대화의 다른 메시지는 안 본다)"""
    m = db.query(DmMessage).filter(DmMessage.id == message_id).first()
    t = db.query(DmThread).filter(DmThread.id == m.thread_id).first() if m else None
    if not m or not t or current.id not in (t.user_a_id, t.user_b_id):
        raise HTTPException(404, "메시지를 찾을 수 없어요")
    if m.sender_id == current.id:
        raise HTTPException(400, "내 메시지는 신고할 수 없어요")
    if db.query(Report.id).filter(Report.reporter_id == current.id, Report.message_id == m.id).first():
        raise HTTPException(409, "이미 신고한 메시지예요")
    db.add(Report(reporter_id=current.id, message_id=m.id, reason=body.reason))
    db.commit()
    return {"message": "신고가 접수되었어요"}


@router.get("/dm/unread-count")
def dm_unread_count(
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
):
    """안 읽은 메시지 수 — 머리의 메시지 아이콘이 몇십 초마다 묻는다. 99 를 넘으면 세지 않는다"""
    n = (db.query(DmMessage.id).join(DmThread, DmThread.id == DmMessage.thread_id)
         .filter(_안읽음조건(current.id)).limit(안읽음_한도 + 1).count())
    return {"count": min(n, 안읽음_한도), "capped": n > 안읽음_한도}


# ── 차단 ──────────────────────────────────────────────────────
@router.post("/users/{user_id}/block")
@limiter.limit("30/minute")
def block_user(
    request: Request,
    user_id: int = Path(..., ge=1),
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
):
    if user_id == current.id:
        raise HTTPException(400, "자기 자신은 차단할 수 없어요")
    if not db.query(User.id).filter(User.id == user_id).first():
        raise HTTPException(404, "사용자를 찾을 수 없어요")
    if not _내가막았나(db, current.id, user_id):
        db.add(UserBlock(blocker_id=current.id, blocked_id=user_id))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()                 # 두 번 눌렀다 — 이미 막혀 있다
    return {"blocked": True}


@router.delete("/users/{user_id}/block")
@limiter.limit("30/minute")
def unblock_user(
    request: Request,
    user_id: int = Path(..., ge=1),
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
):
    db.query(UserBlock).filter(UserBlock.blocker_id == current.id, UserBlock.blocked_id == user_id).delete(
        synchronize_session=False)
    db.commit()
    return {"blocked": False}


@router.get("/blocks")
def list_blocks(
    db: Session = Depends(get_db),
    current: User = Depends(require_user),
):
    """내가 차단한 사람들 — 마이페이지에서 풀 수 있게"""
    줄들 = (db.query(UserBlock).filter(UserBlock.blocker_id == current.id)
            .order_by(UserBlock.created_at.desc(), UserBlock.id.desc()).limit(200).all())
    ids = [b.blocked_id for b in 줄들]
    사람표 = {u.id: u for u in db.query(User).filter(User.id.in_(ids)).all()} if ids else {}
    모습표 = {p.user_id: p for p in db.query(UserProfile).filter(UserProfile.user_id.in_(ids)).all()} if ids else {}
    return {"items": [{**_사람(사람표.get(b.blocked_id), 모습표.get(b.blocked_id)), "id": b.blocked_id,
                       "blocked_at": _시각(b.created_at)} for b in 줄들]}
