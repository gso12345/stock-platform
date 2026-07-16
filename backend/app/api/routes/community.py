import json
from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel, field_validator
from typing import Literal, Optional
from app.db.database import get_db
from app.models.community import StockPost, StockPostLike, StockComment, StockCommentLike, UserProfile
from app.core.deps import get_current_user, require_user

router = APIRouter(prefix="/community", tags=["community"])

_SYMBOL_RE = r"^[A-Za-z0-9.\-]{1,20}$"

# ── 컨텐츠 인코딩/디코딩 ──────────────────────────────────────
def encode_content(title: str, body: str) -> str:
    return json.dumps({"v": 1, "title": title.strip(), "body": body.strip()}, ensure_ascii=False)

def decode_content(raw: str) -> dict:
    try:
        d = json.loads(raw)
        if d.get("v") == 1:
            return {"title": d.get("title", ""), "body": d.get("body", raw)}
    except Exception:
        pass
    return {"title": "", "body": raw}

# ── 프로필 헬퍼 ───────────────────────────────────────────────
def get_profile(db: Session, user_id: int) -> UserProfile:
    p = db.query(UserProfile).filter(UserProfile.user_id == user_id).first()
    if not p:
        p = UserProfile(user_id=user_id)
        db.add(p)
        db.flush()
    return p

def display_name(user, profile: Optional[UserProfile]) -> str:
    if profile and profile.nickname:
        return profile.nickname
    return user.username if user else "알 수 없음"

# ── 직렬화 ────────────────────────────────────────────────────
def _ser_post(post: StockPost, uid: Optional[int], db: Session) -> dict:
    liked  = any(lk.user_id == uid for lk in post.likes) if uid else False
    parsed = decode_content(post.content)
    profile = get_profile(db, post.user_id) if post.user else None
    return {
        "id":            post.id,
        "user_id":       post.user_id,
        "username":      display_name(post.user, profile),
        "avatar_color":  profile.avatar_color if profile else 0,
        "title":         parsed["title"],
        "body":          parsed["body"],
        "like_count":    post.like_count,
        "comment_count": post.comment_count,
        "liked":         liked,
        "created_at":    post.created_at.isoformat(),
        "is_mine":       post.user_id == uid if uid else False,
    }

def _ser_comment(c: StockComment, uid: Optional[int], db: Session) -> dict:
    liked   = any(lk.user_id == uid for lk in c.likes) if uid else False
    profile = get_profile(db, c.user_id) if c.user else None
    replies = []
    if c.replies:
        for r in sorted([x for x in c.replies if not x.is_deleted], key=lambda x: x.created_at):
            rp = get_profile(db, r.user_id) if r.user else None
            r_liked = any(lk.user_id == uid for lk in r.likes) if uid else False
            replies.append({
                "id":           r.id,
                "parent_id":    c.id,
                "user_id":      r.user_id,
                "username":     display_name(r.user, rp),
                "avatar_color": rp.avatar_color if rp else 0,
                "content":      r.content,
                "like_count":   r.like_count,
                "liked":        r_liked,
                "created_at":   r.created_at.isoformat(),
                "is_mine":      r.user_id == uid if uid else False,
                "replies":      [],
            })
    return {
        "id":           c.id,
        "parent_id":    c.parent_id,
        "user_id":      c.user_id,
        "username":     display_name(c.user, profile),
        "avatar_color": profile.avatar_color if profile else 0,
        "content":      c.content,
        "like_count":   c.like_count,
        "liked":        liked,
        "created_at":   c.created_at.isoformat(),
        "is_mine":      c.user_id == uid if uid else False,
        "replies":      replies,
    }

# ── Pydantic ──────────────────────────────────────────────────
class PostCreate(BaseModel):
    title:   str = ""
    body:    str
    @field_validator("body")
    @classmethod
    def body_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("내용을 입력해 주세요")
        if len(v) > 2000:
            raise ValueError("내용은 2000자 이내로 입력해 주세요")
        return v
    @field_validator("title")
    @classmethod
    def title_max(cls, v: str) -> str:
        v = v.strip()
        if len(v) > 100:
            raise ValueError("제목은 100자 이내로 입력해 주세요")
        return v

class CommentCreate(BaseModel):
    content:   str
    parent_id: Optional[int] = None
    @field_validator("content")
    @classmethod
    def not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("내용을 입력해 주세요")
        if len(v) > 500:
            raise ValueError("댓글은 500자 이내로 입력해 주세요")
        return v

class ProfileUpdate(BaseModel):
    nickname:     Optional[str] = None
    avatar_color: Optional[int] = None
    bio:          Optional[str] = None

# ── 게시글 목록 ────────────────────────────────────────────────
@router.get("/{market}/{symbol}/posts")
def list_posts(
    market: Literal["KR", "US", "ETF"],
    symbol: str = Path(..., pattern=_SYMBOL_RE),
    page:   int = Query(1, ge=1),
    limit:  int = Query(20, ge=1, le=50),
    sort:   Literal["latest", "likes"] = Query("latest"),
    db:     Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    sym = symbol.upper()
    uid = current_user.id if current_user else None

    q = db.query(StockPost).filter(
        StockPost.symbol == sym, StockPost.market == market, StockPost.is_deleted == False
    )
    total = q.count()
    if sort == "likes":
        q = q.order_by(StockPost.like_count.desc(), StockPost.created_at.desc())
    else:
        q = q.order_by(StockPost.created_at.desc())

    posts = q.offset((page - 1) * limit).limit(limit).all()
    return {"total": total, "page": page, "items": [_ser_post(p, uid, db) for p in posts]}


# ── 게시글 작성 ────────────────────────────────────────────────
@router.post("/{market}/{symbol}/posts", status_code=201)
def create_post(
    body:   PostCreate,
    market: Literal["KR", "US", "ETF"],
    symbol: str = Path(..., pattern=_SYMBOL_RE),
    db:     Session = Depends(get_db),
    current_user=Depends(require_user),
):
    post = StockPost(
        symbol=symbol.upper(), market=market, user_id=current_user.id,
        content=encode_content(body.title, body.body),
    )
    db.add(post)
    db.commit()
    db.refresh(post)
    return _ser_post(post, current_user.id, db)


# ── 게시글 삭제 ────────────────────────────────────────────────
@router.delete("/{market}/{symbol}/posts/{post_id}", status_code=204)
def delete_post(
    market:  Literal["KR", "US", "ETF"],
    symbol:  str = Path(..., pattern=_SYMBOL_RE),
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


# ── 게시글 좋아요 ──────────────────────────────────────────────
@router.post("/posts/{post_id}/like")
def toggle_post_like(
    post_id: int = Path(...),
    db:      Session = Depends(get_db),
    current_user=Depends(require_user),
):
    post = db.query(StockPost).filter(StockPost.id == post_id, StockPost.is_deleted == False).first()
    if not post:
        raise HTTPException(404, "게시글을 찾을 수 없습니다")
    existing = db.query(StockPostLike).filter(
        StockPostLike.post_id == post_id, StockPostLike.user_id == current_user.id
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


# ── 댓글 목록 ─────────────────────────────────────────────────
@router.get("/posts/{post_id}/comments")
def list_comments(
    post_id: int = Path(...),
    db:      Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    post = db.query(StockPost).filter(StockPost.id == post_id, StockPost.is_deleted == False).first()
    if not post:
        raise HTTPException(404, "게시글을 찾을 수 없습니다")
    uid = current_user.id if current_user else None
    # 루트 댓글만 (replies는 _ser_comment 내부에서 처리)
    root = db.query(StockComment).filter(
        StockComment.post_id == post_id,
        StockComment.parent_id == None,
        StockComment.is_deleted == False,
    ).order_by(StockComment.created_at.asc()).all()
    return [_ser_comment(c, uid, db) for c in root]


# ── 댓글 작성 ─────────────────────────────────────────────────
@router.post("/posts/{post_id}/comments", status_code=201)
def create_comment(
    body:    CommentCreate,
    post_id: int = Path(...),
    db:      Session = Depends(get_db),
    current_user=Depends(require_user),
):
    post = db.query(StockPost).filter(StockPost.id == post_id, StockPost.is_deleted == False).first()
    if not post:
        raise HTTPException(404, "게시글을 찾을 수 없습니다")
    if body.parent_id:
        parent = db.query(StockComment).filter(
            StockComment.id == body.parent_id, StockComment.post_id == post_id
        ).first()
        if not parent:
            raise HTTPException(404, "부모 댓글을 찾을 수 없습니다")
    c = StockComment(post_id=post_id, parent_id=body.parent_id,
                     user_id=current_user.id, content=body.content.strip())
    db.add(c)
    post.comment_count += 1
    db.commit()
    db.refresh(c)
    uid = current_user.id
    profile = get_profile(db, uid)
    return {
        "id": c.id, "parent_id": c.parent_id, "user_id": uid,
        "username": display_name(current_user, profile),
        "avatar_color": profile.avatar_color,
        "content": c.content, "like_count": 0, "liked": False,
        "created_at": c.created_at.isoformat(), "is_mine": True, "replies": [],
    }


# ── 댓글 삭제 ─────────────────────────────────────────────────
@router.delete("/comments/{comment_id}", status_code=204)
def delete_comment(
    comment_id: int = Path(...),
    db:         Session = Depends(get_db),
    current_user=Depends(require_user),
):
    c = db.query(StockComment).filter(StockComment.id == comment_id).first()
    if not c or c.is_deleted:
        raise HTTPException(404, "댓글을 찾을 수 없습니다")
    if c.user_id != current_user.id and not current_user.is_admin:
        raise HTTPException(403, "삭제 권한이 없습니다")
    c.is_deleted = True
    post = db.query(StockPost).filter(StockPost.id == c.post_id).first()
    if post:
        post.comment_count = max(0, post.comment_count - 1)
    db.commit()


# ── 댓글 좋아요 ───────────────────────────────────────────────
@router.post("/comments/{comment_id}/like")
def toggle_comment_like(
    comment_id: int = Path(...),
    db:         Session = Depends(get_db),
    current_user=Depends(require_user),
):
    c = db.query(StockComment).filter(StockComment.id == comment_id, StockComment.is_deleted == False).first()
    if not c:
        raise HTTPException(404, "댓글을 찾을 수 없습니다")
    existing = db.query(StockCommentLike).filter(
        StockCommentLike.comment_id == comment_id, StockCommentLike.user_id == current_user.id
    ).first()
    if existing:
        db.delete(existing)
        c.like_count = max(0, c.like_count - 1)
        liked = False
    else:
        db.add(StockCommentLike(comment_id=comment_id, user_id=current_user.id))
        c.like_count += 1
        liked = True
    db.commit()
    return {"liked": liked, "like_count": c.like_count}


# ── 프로필 조회 ────────────────────────────────────────────────
@router.get("/profile/me")
def get_my_profile(
    db:           Session = Depends(get_db),
    current_user=Depends(require_user),
):
    p = get_profile(db, current_user.id)
    db.commit()
    return {
        "user_id":      current_user.id,
        "username":     current_user.username,
        "nickname":     p.nickname,
        "avatar_color": p.avatar_color,
        "bio":          p.bio,
    }


@router.put("/profile/me")
def update_my_profile(
    body:         ProfileUpdate,
    db:           Session = Depends(get_db),
    current_user=Depends(require_user),
):
    p = get_profile(db, current_user.id)
    if body.nickname is not None:
        nick = body.nickname.strip()
        if len(nick) > 50:
            raise HTTPException(422, "닉네임은 50자 이내로 입력해 주세요")
        p.nickname = nick or None
    if body.avatar_color is not None:
        if not (0 <= body.avatar_color <= 7):
            raise HTTPException(422, "유효하지 않은 색상입니다")
        p.avatar_color = body.avatar_color
    if body.bio is not None:
        bio = body.bio.strip()
        if len(bio) > 200:
            raise HTTPException(422, "소개는 200자 이내로 입력해 주세요")
        p.bio = bio or None
    db.commit()
    return {
        "user_id":      current_user.id,
        "username":     current_user.username,
        "nickname":     p.nickname,
        "avatar_color": p.avatar_color,
        "bio":          p.bio,
    }


@router.get("/profile/{user_id}")
def get_user_profile(
    user_id: int = Path(...),
    db:      Session = Depends(get_db),
):
    from app.models.user import User
    user = db.query(User).filter(User.id == user_id, User.is_active == True).first()
    if not user:
        raise HTTPException(404, "사용자를 찾을 수 없습니다")
    p = db.query(UserProfile).filter(UserProfile.user_id == user_id).first()
    return {
        "user_id":      user.id,
        "username":     user.username,
        "nickname":     p.nickname if p else None,
        "avatar_color": p.avatar_color if p else 0,
        "bio":          p.bio if p else None,
    }
