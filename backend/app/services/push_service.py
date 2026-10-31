"""웹 푸시 보내기 — 알림이 생기면 그 사람이 켜 둔 기기(휴대폰·PC)로도 보낸다.

예전에는 가격 알림이 울려도 앱 안의 종 모양에만 쌓였다. 앱을 열어야 보이니, 앱을 닫고 기다리는
사람에게는 없는 기능이었다. 알림(notifications 표)은 그대로 쌓고, 같은 내용을 푸시로도 보낸다.

  · 보내기는 뒤에서(일꾼 둘) — 댓글 달기·알림 확인이 푸시 서버를 기다리지 않게. 실패해도 원래 일은 그대로
  · 푸시 서버가 '없는 구독' 이라고 하면(404·410) 지운다 — 앱을 지우거나 알림을 끈 기기
  · 끝점은 알려진 푸시 서버만 받는다 — 아무 주소나 받으면 우리 서버가 그 주소로 요청을 보내게 된다
"""
from __future__ import annotations

import json
import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from urllib.parse import quote, urlsplit

import httpx

from app.core import webpush
from app.core.config import 앱주소
from app.core.http import SSL

log = logging.getLogger(__name__)

#: 보내는 일꾼 — 푸시 서버를 기다리는 일이라 CPU 는 거의 안 쓴다. 스레드마다 메모리가 붙으므로 둘
_일꾼 = ThreadPoolExecutor(max_workers=2, thread_name_prefix="push")
_열쇠 = None
_열쇠_잠금 = threading.Lock()

#: 연달아 이만큼 실패하면 죽은 기기로 보고 지운다(404·410 은 한 번에)
실패_한도 = 5
#: 푸시 서버가 들고 있다가 전해 줄 시간(초) — 휴대폰이 꺼져 있어도 이 안에 켜지면 받는다.
#  가격 알림은 한 시간 뒤면 뜻이 없고, 공모주 아침 알림은 그날 장이 끝나기 전까지
TTL = {"price_alert": 3600, "ipo": 6 * 3600}
기본_TTL = 24 * 3600

#: 받는 끝점 — 브라우저마다의 푸시 서버(크롬·삼성=FCM, 파이어폭스, 엣지, 사파리)
_푸시서버 = ("fcm.googleapis.com", "android.googleapis.com", "push.services.mozilla.com",
           "notify.windows.com", "push.apple.com")

#: 알림 목록의 문구와 같게(frontend constants/notifications.ts KIND_META.text)
_말 = {
    "comment": "님이 회원님의 글에 댓글을 남겼습니다",
    "reply": "님이 회원님의 댓글에 답글을 남겼습니다",
    "post_like": "님이 회원님의 글을 좋아합니다",
    "comment_like": "님이 회원님의 댓글을 좋아합니다",
    "follow": "님이 회원님을 팔로우했습니다",
}


def 받는_끝점인가(끝점: str) -> bool:
    try:
        u = urlsplit(끝점)
    except ValueError:
        return False
    host = (u.hostname or "").lower()
    return u.scheme == "https" and any(host == h or host.endswith("." + h) for h in _푸시서버)


def 열쇠():
    """VAPID 열쇠 — 환경변수 VAPID_PRIVATE_KEY → DB → 없으면 새로 만들어 DB 에. 한 번 읽으면 프로세스에 둔다.

    두 프로세스가 동시에 만들면 줄이 둘 생길 수 있다 — 늘 가장 먼저 만든 줄을 쓰므로 어긋나지 않는다."""
    global _열쇠
    if _열쇠 is not None:
        return _열쇠
    with _열쇠_잠금:
        if _열쇠 is not None:
            return _열쇠
        글 = (os.environ.get("VAPID_PRIVATE_KEY") or "").strip()
        if 글:
            _열쇠 = webpush.열쇠_읽기(글)
            return _열쇠
        from app.db.database import SessionLocal
        from app.models.push import PushKey
        db = SessionLocal()
        try:
            줄 = db.query(PushKey).order_by(PushKey.id).first()
            if 줄 is None:
                db.add(PushKey(private_pem=webpush.열쇠_글(webpush.새_열쇠())))
                db.commit()
                줄 = db.query(PushKey).order_by(PushKey.id).first()
            _열쇠 = webpush.열쇠_읽기(줄.private_pem)
        finally:
            db.close()
        return _열쇠


def 공개키() -> str:
    return webpush.공개키(열쇠())


def _연락처() -> str:
    """VAPID 의 sub — 푸시 서버가 문제를 알릴 곳. 메일 주소를 드러내지 않게 앱 주소를 쓴다"""
    return 앱주소() or "https://stock-platform-one.vercel.app"


# ── 구독 ──────────────────────────────────────────────────────
def 구독하기(db, user_id: int, 끝점: str, p256dh: str, auth: str, ipo: bool = True,
           증권사: "list[str] | tuple" = ()):
    """기기 하나를 켠다(이미 있으면 고친다). 같은 기기를 다른 계정이 켜면 주인을 바꾼다"""
    from app.models.push import PushSubscription
    줄 = db.query(PushSubscription).filter(PushSubscription.endpoint == 끝점).first()
    if 줄 is None:
        줄 = PushSubscription(endpoint=끝점)
        db.add(줄)
    줄.user_id, 줄.p256dh, 줄.auth = user_id, p256dh, auth
    줄.ipo = bool(ipo)
    줄.brokers = ",".join(증권사) or None
    줄.fail_count = 0
    db.commit()
    return 줄


def 해지하기(db, user_id: int, 끝점: str) -> bool:
    from app.models.push import PushSubscription
    n = (db.query(PushSubscription)
         .filter(PushSubscription.endpoint == 끝점, PushSubscription.user_id == user_id)
         .delete(synchronize_session=False))
    db.commit()
    return bool(n)


# ── 보낼 내용 ─────────────────────────────────────────────────
def 알림_내용(db, n) -> dict:
    """notifications 한 줄 → 푸시 {title, body, url, tag}. 눌렀을 때 가는 곳은 알림 목록과 같다"""
    if n.kind == "price_alert":
        return {"title": "가격 알림", "body": n.preview or "걸어 둔 가격에 닿았어요",
                "url": f"/stocks/{n.market}/{quote(n.symbol)}" if n.symbol and n.market else "/notifications",
                "tag": f"price-{n.symbol or n.id}"}
    from app.models.community import UserProfile
    from app.models.user import User
    별명 = (db.query(UserProfile.nickname).filter(UserProfile.user_id == n.actor_id).scalar()
            if n.actor_id else None)
    이름 = 별명 or ((db.query(User.username).filter(User.id == n.actor_id).scalar() if n.actor_id else None)
                   or "누군가")
    주소 = (f"/profile/{n.actor_id}" if n.kind == "follow" and n.actor_id
            else f"/post/{n.post_id}" if n.post_id else "/notifications")
    return {"title": f"{이름}{_말.get(n.kind, '님의 새 알림')}", "body": n.preview or "",
            "url": 주소, "tag": f"{n.kind}-{n.id}"}


# ── 보내기 ────────────────────────────────────────────────────
def _한건(cl: httpx.Client, s, 본문: bytes, 키, 종류: str) -> int:
    """한 기기에 한 건 — HTTP 상태(201 이 정상)"""
    r = cl.post(s.endpoint, content=webpush.암호화(본문, s.p256dh, s.auth), headers={
        "TTL": str(TTL.get(종류, 기본_TTL)),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        # 가격 알림은 휴대폰이 절전 중이어도 깨워서 바로 — 나머지는 휴대폰 형편대로
        "Urgency": "high" if 종류 == "price_alert" else "normal",
        "Authorization": webpush.vapid_머리(s.endpoint, 키, _연락처()),
    })
    return r.status_code


def 기기들에(db, 구독들: list, 내용: dict, 종류: str) -> int:
    """구독들에 같은 내용을 — 보낸 수. 없는 구독은 지우고 실패는 센다(커밋까지 한다)"""
    if not 구독들:
        return 0
    키 = 열쇠()
    본문 = json.dumps(내용, ensure_ascii=False).encode()
    보낸 = 0
    이제 = datetime.now(timezone.utc)
    with httpx.Client(timeout=10, verify=SSL) as cl:
        for s in 구독들:
            try:
                상태 = _한건(cl, s, 본문, 키, 종류)
            except Exception as e:
                log.info("푸시 보내기 실패: %s", type(e).__name__)
                상태 = 0
            if 200 <= 상태 < 300:
                s.fail_count, s.last_ok_at = 0, 이제
                보낸 += 1
            elif 상태 in (404, 410):
                db.delete(s)                       # 앱을 지웠거나 알림을 끈 기기
            else:
                s.fail_count = (s.fail_count or 0) + 1
                if s.fail_count >= 실패_한도:
                    db.delete(s)
    db.commit()
    return 보낸


def _알림들_보내기(알림_id들: list) -> int:
    from app.db.database import SessionLocal
    from app.models.community import Notification
    from app.models.push import PushSubscription
    db = SessionLocal()
    보낸 = 0
    try:
        for n in db.query(Notification).filter(Notification.id.in_(알림_id들)).all():
            구독들 = db.query(PushSubscription).filter(PushSubscription.user_id == n.user_id).all()
            if 구독들:
                보낸 += 기기들에(db, 구독들, 알림_내용(db, n), n.kind)
        return 보낸
    except Exception as e:
        log.warning("알림 푸시 실패: %s", type(e).__name__)
        try:
            db.rollback()
        except Exception:
            pass
        return 보낸
    finally:
        db.close()


def 알림_보내기(알림_id들: list) -> None:
    """방금 커밋한 알림들을 뒤에서 푸시로 — 부르는 쪽은 기다리지 않는다. 어떤 예외도 안 내보낸다"""
    ids = [i for i in 알림_id들 if i]
    if not ids:
        return
    try:
        _일꾼.submit(_알림들_보내기, ids)
    except Exception as e:                       # 서버가 내려가는 중(일꾼이 닫힘) 등
        log.debug("알림 푸시 맡기기 실패: %s", type(e).__name__)


def 시험_보내기(db, user_id: int) -> dict:
    """'시험 알림 보내기' — 지금 이 사람의 기기 모두에. {devices, sent}"""
    from app.models.push import PushSubscription
    구독들 = db.query(PushSubscription).filter(PushSubscription.user_id == user_id).all()
    n = len(구독들)
    보낸 = 기기들에(db, 구독들, {"title": "알림이 이렇게 와요", "body": "가격 알림·댓글·공모주 청약일을 휴대폰으로 알려 드려요.",
                             "url": "/notifications", "tag": "test"}, "test")
    return {"devices": n, "sent": 보낸}


# ── 공모주 청약 아침 알림 ──────────────────────────────────────
#: 보내는 때(한국 시각) — 청약은 보통 10시에 열린다. 이 사이에 한 번
아침_시작, 아침_끝 = (8, 40), (10, 0)
_아침_보낸날: "date | None" = None


def 오늘_청약(기록: dict, 오늘: date) -> list:
    """오늘 청약을 시작하거나 마감하는 공모주 — 청약 첫날·마지막 날 모두 챙긴다"""
    from app.services import ipo_service
    out = []
    for r in 기록.values():
        시작 = ipo_service._d(r.get("sub_start"))
        끝 = ipo_service._d(r.get("sub_end")) or 시작
        if 시작 and (시작 == 오늘 or 끝 == 오늘):
            out.append(r)
    return sorted(out, key=lambda r: r.get("name") or "")


def 아침_글(공모주들: list, 오늘: date) -> dict:
    from app.services import ipo_service
    from app.services.ipo_calendar import 증권사들
    조각 = []
    for r in 공모주들:
        끝 = ipo_service._d(r.get("sub_end")) or ipo_service._d(r.get("sub_start"))
        주관 = " · ".join(증권사들(r.get("underwriter")))
        조각.append(f"{r.get('name')}{' 마감' if 끝 == 오늘 else ''}" + (f"({주관})" if 주관 else ""))
    return {"title": f"오늘 공모주 청약 {len(공모주들)}곳", "body": ", ".join(조각)[:300],
            "url": "/ipo", "tag": f"ipo-{오늘.isoformat()}"}


def 공모주_아침(오늘: "date | None" = None) -> int:
    """오늘 청약하는 공모주를 알림을 켠 기기에 — 고른 증권사가 있으면 그 증권사가 주관하는 것만. 보낸 수"""
    from app.db.database import SessionLocal
    from app.models.push import PushSubscription
    from app.services import ipo_service
    from app.services.ipo_calendar import 증권사들
    오늘 = 오늘 or ipo_service.오늘()
    공모주들 = 오늘_청약(ipo_service.기록들(), 오늘)
    if not 공모주들:
        return 0
    db = SessionLocal()
    보낸 = 0
    try:
        for s in db.query(PushSubscription).filter(PushSubscription.ipo.is_(True)).all():
            고른 = {b for b in (s.brokers or "").split(",") if b}
            대상 = [r for r in 공모주들 if not 고른 or set(증권사들(r.get("underwriter"))) & 고른]
            if 대상:
                보낸 += 기기들에(db, [s], 아침_글(대상, 오늘), "ipo")
        return 보낸
    finally:
        db.close()


def 아침_챙기기(지금: "datetime | None" = None) -> int:
    """주기 갱신이 1분마다 부른다 — 평일 아침 그 사이에 하루 한 번만 보낸다"""
    global _아침_보낸날
    from app.services import ipo_service
    지금 = (지금 or datetime.now(timezone.utc)).astimezone(ipo_service.KST)
    if 지금.weekday() >= 5 or not (아침_시작 <= (지금.hour, 지금.minute) < 아침_끝):
        return 0
    if _아침_보낸날 == 지금.date():
        return 0
    _아침_보낸날 = 지금.date()
    try:
        return 공모주_아침(지금.date())
    except Exception as e:
        log.warning("공모주 아침 알림 실패: %s", type(e).__name__)
        return 0
