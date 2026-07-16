from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.database import Base


class StockPost(Base):
    __tablename__ = "stock_posts"

    id         = Column(Integer, primary_key=True, index=True)
    symbol     = Column(String(20), nullable=False, index=True)
    market     = Column(String(10), nullable=False, index=True)
    user_id    = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    content    = Column(Text, nullable=False)
    like_count = Column(Integer, default=0)
    is_deleted = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    user  = relationship("User")
    likes = relationship("StockPostLike", back_populates="post", cascade="all, delete-orphan")


class StockPostLike(Base):
    __tablename__ = "stock_post_likes"
    __table_args__ = (UniqueConstraint("post_id", "user_id"),)

    id      = Column(Integer, primary_key=True, index=True)
    post_id = Column(Integer, ForeignKey("stock_posts.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    post = relationship("StockPost", back_populates="likes")
