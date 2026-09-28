from sqlalchemy import Column, Integer, String, Boolean, DateTime
from sqlalchemy.sql import func
from app.db.database import Base


class User(Base):
    __tablename__ = "users"

    id              = Column(Integer, primary_key=True, index=True)
    username        = Column(String(50), unique=True, index=True, nullable=False)
    email           = Column(String(200), unique=True, index=True, nullable=True)  # 선택
    hashed_password = Column(String(200), nullable=False)
    is_active            = Column(Boolean, default=True)
    is_admin             = Column(Boolean, default=False)
    is_community_banned  = Column(Boolean, default=False, nullable=True)
    oauth_provider  = Column(String(20), nullable=True, index=True)   # google / naver / kakao
    oauth_id        = Column(String(100), nullable=True, index=True)  # 제공자별 고유 사용자 ID
    created_at      = Column(DateTime(timezone=True), server_default=func.now())
    #: 탈퇴한 때. 탈퇴해도 **데이터는 지우지 않는다** — 계정만 닫는다
    #  (is_active=False). 이 칸으로 '관리자가 정지한 계정' 과 가른다.
    withdrawn_at    = Column(DateTime(timezone=True), nullable=True)
