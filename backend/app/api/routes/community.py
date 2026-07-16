from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel, constr
from typing import Literal, Optional
from app.db.database import get_db
from app.models.community import StockPost, StockPostLike
from app.core.deps import get_current_user, require_user

router = APIRouter(prefix="/community", tags=["community"])

_SYMBOL_PATTERN = r"^[A-Za-z0-9.\-]{1,20}$"


class PostCreate(BaseModel):
    content: constr(min_length=1, max_length=1000)


class PostOut(BaseModel):
    id:         int
    user_id:    int
    username:   str
    content:    str
    like_count: int
    liked:      bool
    created_at: str
    is_mine:    bool

    class Config:
        from_attributes = True


def _serialize(post: StockPost, user_id: Optional[int]) -> dict:
    liked = any(lk.user_id == user_id for lk in post.likes) if user_id else False
    return {
        "id":         post.id,
        "user_id":    post.user_id,
        "username":   post.user.username if post.user else "알 수 없음",
        "content":    post.content,
        "like_count": post.like_count,
        "liked":      liked,
        "created_at": post.created_at.isoformat(),
        "is_mine":    post.user_id == user_id if user_id else False,
    }


@router.get("/{market}/{symbol}/posts")
def list_posts(
    market: Literal["KR", "US", "ETF"],
    symbol: str = Path(..., pattern=_SYMBOL_PATTERN),
    page:   int = Query(1, ge=1),
    limit:  int = Query(20, ge=1, le=50),
    db:     Session = Depends(get_db),
    current_user=Depends(get_current_user),  # optional – None if not logged in
):
    sym = symbol.upper()
    uid = current_user.id if current_user else None
    offset = (page - 1) * limit

    total = db.query(func.count(StockPost.id)).filter(
        StockPost.symbol == sym,
        StockPost.market == market,
        StockPost.is_deleted == False,
    ).scalar()

    posts = (
        db.query(StockPost)
        .filter(StockPost.symbol == sym, StockPost.market == market, StockPost.is_deleted == False)
        .order_by(StockPost.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    return {
        "total": total,
        "page":  page,
        "items": [_serialize(p, uid) for p in posts],
    }


@router.post("/{market}/{symbol}/posts", status_code=201)
def create_post(
    body:   PostCreate,
    market: Literal["KR", "US", "ETF"],
    symbol: str = Path(..., pattern=_SYMBOL_PATTERN),
    db:     Session = Depends(get_db),
    current_user=Depends(require_user),
):
    sym = symbol.upper()
    post = StockPost(symbol=sym, market=market, user_id=current_user.id, content=body.content.strip())
    db.add(post)
    db.commit()
    db.refresh(post)
    return _serialize(post, current_user.id)


@router.delete("/{market}/{symbol}/posts/{post_id}", status_code=204)
def delete_post(
    market:  Literal["KR", "US", "ETF"],
    symbol:  str = Path(..., pattern=_SYMBOL_PATTERN),
    post_id: int = Path(...),
    db:      Session = Depends(get_db),
    current_user=Depends(require_user),
):
    post = db.query(StockPost).filter(StockPost.id == post_id).first()
    if not post or post.is_deleted:
        raise HTTPException(404, "게시글을 찾을 수 없습니다")
    if post.user_id != current_user.id and not current_user.is_admin:
        raise HTTPException(403, "삭제 권한이 없습니다")
    post.is_deleted = True
    db.commit()


@router.post("/posts/{post_id}/like")
def toggle_like(
    post_id:      int = Path(...),
    db:           Session = Depends(get_db),
    current_user=Depends(require_user),
):
    post = db.query(StockPost).filter(StockPost.id == post_id, StockPost.is_deleted == False).first()
    if not post:
        raise HTTPException(404, "게시글을 찾을 수 없습니다")

    existing = db.query(StockPostLike).filter(
        StockPostLike.post_id == post_id,
        StockPostLike.user_id == current_user.id,
    ).first()

    if existing:
        db.delete(existing)
        post.like_count = max(0, post.like_count - 1)
        liked = False
    else:
        db.add(StockPostLike(post_id=post_id, user_id=current_user.id))
        post.like_count += 1
        liked = True

    db.commit()
    return {"liked": liked, "like_count": post.like_count}
