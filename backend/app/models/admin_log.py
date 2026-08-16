"""관리자가 무엇을 했는지 남기는 자리.

예전에는 로그 파일에만 남았고, 그나마 '누가' 가 빠져 있었다.

    log.info(f"관리자가 게시글 삭제: post_id={post_id}")

ADMIN_USERNAME 은 쉼표로 여러 명을 받는다("admin,gso12345"). 관리자가 둘
이상이면 이 줄로는 누가 지웠는지 알 수 없다. 게다가 Render 무료 플랜은
재시작이 잦아 로그가 곧 흘러가 버린다.

그래서 DB 에 남긴다. 되돌릴 수는 없어도, 무슨 일이 있었는지는 알 수 있어야
한다 — 특히 계정 정지나 삭제처럼 사람에게 영향이 가는 일은.

지우는 사람의 이름을 지금 시점에 함께 박아 둔다(actor_name). 나중에 그
관리자 계정이 사라져도 기록은 남아야 하므로, id 만 두지 않는다.
"""
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Integer, String, Text

from app.db.database import Base


class AdminLog(Base):
    __tablename__ = "admin_logs"

    id = Column(Integer, primary_key=True, index=True)

    # 누가 — 계정이 지워져도 이름은 남게 문자열로 함께 박는다
    actor_id   = Column(Integer, index=True, nullable=True)
    actor_name = Column(String(50), nullable=False, default="")

    # 무엇을 — "post.delete", "user.ban" 같은 짧은 이름
    action = Column(String(40), nullable=False, index=True)

    # 어느 것에 — 대상 종류와 식별자
    target_type = Column(String(20), nullable=False, default="")
    target_id   = Column(String(80), nullable=False, default="")

    # 덧붙일 것 (지운 글의 제목, 캐시 건수 등). 길어질 수 있어 Text
    detail = Column(Text, nullable=False, default="")

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)
