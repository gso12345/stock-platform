from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, ForeignKey, UniqueConstraint, Index, LargeBinary
from sqlalchemy.orm import relationship, backref
from sqlalchemy.sql import func
from app.db.database import Base


class StockPost(Base):
    __tablename__ = "stock_posts"

    id         = Column(Integer, primary_key=True, index=True)
    symbol     = Column(String(20), nullable=False, index=True)
    market     = Column(String(10), nullable=False, index=True)
    user_id    = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    content    = Column(Text, nullable=False)          # JSON {"v":1,"title":"..","body":".."} or plain text
    like_count = Column(Integer, default=0)
    comment_count = Column(Integer, default=0)
    view_count = Column(Integer, default=0, server_default="0")
    # 이미지는 본문(content) 밖에 둔다.
    #
    # 예전에는 base64 문자열이 content JSON 안에 들어 있었다. 피드 한
    # 페이지(20개)를 읽으면 이미지 20장이 SELECT 에 딸려 와 약 2MB 를
    # 끌어오고, 그걸 전부 json.loads 했다. 응답에서만 빼봐야 읽는 비용은
    # 그대로였다.
    #
    # 원본 바이트로 넣는다 — base64 는 3바이트를 4글자로 부풀리므로 저장도
    # 33% 더 먹고, 내보낼 때 매번 디코딩해야 한다.
    has_image   = Column(Boolean, nullable=False, server_default="false", default=False)
    image_mime  = Column(String(30), nullable=True)
    # 검색용 납작한 사본 — 제목·본문·종목코드·태그를 소문자로 이어 붙인 것.
    # content 는 JSON 이라 DB 가 안을 못 본다. 매번 파싱해 걸러내면 글이
    # 늘수록 그대로 느려진다.
    search_text = Column(Text, nullable=True)
    image_data  = Column(LargeBinary, nullable=True)
    is_deleted  = Column(Boolean, default=False)
    is_blinded  = Column(Boolean, default=False, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    user     = relationship("User")
    likes    = relationship("StockPostLike",    back_populates="post",    cascade="all, delete-orphan")
    comments = relationship("StockComment",     back_populates="post",    cascade="all, delete-orphan")


class StockPostLike(Base):
    __tablename__ = "stock_post_likes"
    __table_args__ = (UniqueConstraint("post_id", "user_id"),)

    id      = Column(Integer, primary_key=True, index=True)
    post_id = Column(Integer, ForeignKey("stock_posts.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    post = relationship("StockPost", back_populates="likes")


class StockComment(Base):
    __tablename__ = "stock_comments"

    id         = Column(Integer, primary_key=True, index=True)
    post_id    = Column(Integer, ForeignKey("stock_posts.id"), nullable=False, index=True)
    parent_id  = Column(Integer, ForeignKey("stock_comments.id"), nullable=True, index=True)
    user_id    = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    content    = Column(Text, nullable=False)
    like_count = Column(Integer, default=0)
    is_deleted  = Column(Boolean, default=False)
    is_blinded  = Column(Boolean, default=False, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user    = relationship("User")
    likes   = relationship("StockCommentLike", back_populates="comment", cascade="all, delete-orphan")
    replies = relationship("StockComment", foreign_keys=[parent_id],
                           backref=backref("parent", remote_side=[id]),
                           cascade="all, delete-orphan")
    post    = relationship("StockPost", back_populates="comments")


class StockCommentLike(Base):
    __tablename__ = "stock_comment_likes"
    __table_args__ = (UniqueConstraint("comment_id", "user_id"),)

    id         = Column(Integer, primary_key=True, index=True)
    comment_id = Column(Integer, ForeignKey("stock_comments.id"), nullable=False, index=True)
    user_id    = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    comment = relationship("StockComment", back_populates="likes")


class UserProfile(Base):
    __tablename__ = "user_profiles"

    id           = Column(Integer, primary_key=True, index=True)
    user_id      = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False, index=True)
    nickname     = Column(String(50), nullable=True)
    avatar_color = Column(Integer, default=0)   # 0~7 preset index
    bio          = Column(String(200), nullable=True)
    avatar_url   = Column(Text, nullable=True)  # base64 data URL 프로필 사진
    # 받지 않기로 한 알림 종류를 쉼표로 이어 둔다 (예: "post_like,follow").
    # '켠 것'이 아니라 '끈 것'을 저장하는 이유: 비어 있으면 전부 켜진 상태가 되어
    # 기존 사용자에게 값을 채워 넣지 않아도 되고, 나중에 알림 종류가 늘어도
    # 컬럼을 추가할 필요가 없다.
    noti_disabled = Column(String(200), nullable=True)
    updated_at   = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    user = relationship("User")


class UserFollow(Base):
    __tablename__ = "user_follows"
    __table_args__ = (UniqueConstraint("follower_id", "following_id"),)

    id           = Column(Integer, primary_key=True, index=True)
    follower_id  = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    following_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    created_at   = Column(DateTime(timezone=True), server_default=func.now())


class StockPostPollVote(Base):
    __tablename__ = "stock_post_poll_votes"
    __table_args__ = (UniqueConstraint("post_id", "user_id"),)

    id           = Column(Integer, primary_key=True, index=True)
    post_id      = Column(Integer, ForeignKey("stock_posts.id"), nullable=False, index=True)
    user_id      = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    option_index = Column(Integer, nullable=False)
    created_at   = Column(DateTime(timezone=True), server_default=func.now())


class Notification(Base):
    """내 글·댓글에 생긴 반응을 모아 보여준다.

    읽지 않은 개수를 자주 물어보게 되므로 (user_id, is_read) 조합으로 찾는 일이
    가장 잦다. 그래서 단일 컬럼 인덱스 대신 복합 인덱스를 둔다.
    actor_id는 '누가' 했는지 — 알림 목록에서 이름·프로필 사진을 함께 보여준다.
    """
    __tablename__ = "notifications"
    __table_args__ = (
        Index("ix_notifications_user_unread", "user_id", "is_read", "created_at"),
    )

    id         = Column(Integer, primary_key=True, index=True)
    user_id    = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)   # 받는 사람
    actor_id   = Column(Integer, ForeignKey("users.id"), nullable=True)                # 행동한 사람
    kind       = Column(String(20), nullable=False)   # comment, reply, post_like, comment_like, follow
    post_id    = Column(Integer, ForeignKey("stock_posts.id"), nullable=True, index=True)
    comment_id = Column(Integer, ForeignKey("stock_comments.id"), nullable=True)
    preview    = Column(String(100), nullable=True)   # 댓글 내용 앞부분 — 목록에서 바로 보이게
    is_read    = Column(Boolean, default=False, nullable=False, server_default="false")
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class SitePopup(Base):
    __tablename__ = "site_popups"

    id         = Column(Integer, primary_key=True, index=True)
    popup_type = Column(String(20), default="info")   # info, warning, event, feature
    title      = Column(String(200), nullable=False)
    content    = Column(Text, nullable=True)
    link_url   = Column(String(500), nullable=True)
    link_text  = Column(String(100), nullable=True)
    bg_color   = Column(String(20), default="blue")
    is_active  = Column(Boolean, default=True)
    starts_at  = Column(DateTime(timezone=True), nullable=True)
    ends_at    = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Report(Base):
    __tablename__ = "reports"

    id          = Column(Integer, primary_key=True, index=True)
    reporter_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    post_id     = Column(Integer, ForeignKey("stock_posts.id"), nullable=True, index=True)
    comment_id  = Column(Integer, ForeignKey("stock_comments.id"), nullable=True, index=True)
    reason      = Column(String(200), nullable=False)
    status      = Column(String(20), default="pending")  # pending, resolved, dismissed
    created_at  = Column(DateTime(timezone=True), server_default=func.now())

    reporter = relationship("User")
