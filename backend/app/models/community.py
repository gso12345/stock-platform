from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, ForeignKey, UniqueConstraint
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
    is_deleted = Column(Boolean, default=False)
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
    is_deleted = Column(Boolean, default=False)
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
