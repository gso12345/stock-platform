"""웹 푸시 — 휴대폰(브라우저)마다의 구독과, 보내는 서버의 열쇠."""
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.sql import func

from app.db.database import Base


class PushSubscription(Base):
    """기기 하나(브라우저 하나)의 푸시 구독.

    한 사람이 휴대폰·PC 에서 각각 켜면 줄이 둘이다. 같은 기기에서 다른 계정으로 다시 켜면
    endpoint 가 같으므로 그 줄의 주인만 바꾼다(유일 제약) — 남의 알림이 내 휴대폰에 오지 않게."""
    __tablename__ = "push_subscriptions"

    id         = Column(Integer, primary_key=True, index=True)
    user_id    = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    endpoint   = Column(String(1000), nullable=False, unique=True)
    p256dh     = Column(String(200), nullable=False)
    auth       = Column(String(100), nullable=False)
    # 공모주 청약 첫날 아침 알림을 받나 — 고른 증권사(쉼표)가 있으면 그 증권사가 주관하는 것만
    ipo        = Column(Boolean, nullable=False, default=True, server_default="true")
    brokers    = Column(String(300), nullable=True)
    # 연달아 실패한 수 — 푸시 서버가 '없는 구독' 이라고 하면(404·410) 바로 지우고, 그 밖의
    # 실패가 쌓이면(죽은 기기) 지운다
    fail_count = Column(Integer, nullable=False, default=0, server_default="0")
    last_ok_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class PushKey(Base):
    """VAPID 열쇠 — 환경변수(VAPID_PRIVATE_KEY)가 없을 때 처음 한 번 만들어 여기 둔다.

    열쇠가 바뀌면 그동안의 구독이 모두 못 쓰게 된다(브라우저는 구독할 때의 공개키만 믿는다).
    그래서 서버가 다시 뜰 때마다 새로 만들면 안 되고, 어딘가에 남겨야 한다 — Render 무료 서버는
    디스크가 남지 않으므로 DB 에 둔다."""
    __tablename__ = "push_keys"

    id          = Column(Integer, primary_key=True)
    private_pem = Column(Text, nullable=False)
    created_at  = Column(DateTime(timezone=True), server_default=func.now())
