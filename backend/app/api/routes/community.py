import json
from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlalchemy.orm import Session, selectinload, defer
from sqlalchemy import func, text
from pydantic import BaseModel, field_validator, model_validator
from typing import Literal, Optional
from app.db.database import get_db, engine
from fastapi import Body
from app.models.community import StockPost, StockPostLike, StockComment, StockCommentLike, UserProfile, UserFollow, StockPostPollVote
from app.models.user import User
from app.core.deps import get_current_user, require_user

router = APIRouter(prefix="/community", tags=["community"])

_SYMBOL_RE = r"^[A-Za-z0-9.\-]{1,20}$"

# ── 컨텐츠 인코딩/디코딩 ──────────────────────────────────────
def encode_content(title: str, body: str, image: str = "", poll: Optional[dict] = None, tags: Optional[list] = None, portfolio: Optional[list] = None) -> str:
    return json.dumps({
        "v":         1,
        "title":     title.strip(),
        "body":      body.strip(),
        "image":     image,
        "poll":      poll or None,
        "tags":      tags or [],
        "portfolio": portfolio or None,
    }, ensure_ascii=False)

def decode_content(raw: str) -> dict:
    try:
        d = json.loads(raw)
        if d.get("v") == 1:
            return {
                "title":     d.get("title", ""),
                "body":      d.get("body", raw),
                "image":     d.get("image", ""),
                "poll":      d.get("poll"),
                "tags":      d.get("tags", []),
                "portfolio": d.get("portfolio"),
            }
    except Exception:
        pass
    return {"title": "", "body": raw, "image": "", "poll": None, "tags": [], "portfolio": None}

# ── 프로필 헬퍼 ───────────────────────────────────────────────
def get_profile(db: Session, user_id: int) -> Optional[UserProfile]:
    try:
        p = db.query(UserProfile).filter(UserProfile.user_id == user_id).first()
        if not p:
            p = UserProfile(user_id=user_id)
            db.add(p)
            db.flush()
        return p
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
        return None

def display_name(user, profile: Optional[UserProfile]) -> str:
    if profile and profile.nickname:
        return profile.nickname
    return user.username if user else "알 수 없음"

# ── 직렬화 ────────────────────────────────────────────────────
def _ser_post(post: StockPost, uid: Optional[int], db: Session,
              profiles_map: Optional[dict] = None,
              comment_counts: Optional[dict] = None) -> dict:
    liked  = any(lk.user_id == uid for lk in post.likes) if uid else False
    parsed = decode_content(post.content)
    profile = profiles_map.get(post.user_id) if profiles_map is not None else (
        get_profile(db, post.user_id) if post.user else None
    )

    # 투표 집계
    poll_data = None
    if parsed.get("poll"):
        votes = db.query(StockPostPollVote).filter(StockPostPollVote.post_id == post.id).all()
        options = parsed["poll"].get("options", [])
        counts = [0] * len(options)
        for v in votes:
            if 0 <= v.option_index < len(counts):
                counts[v.option_index] += 1
        my_vote = next((v.option_index for v in votes if uid and v.user_id == uid), None)
        poll_data = {
            "question": parsed["poll"].get("question", ""),
            "options":  options,
            "counts":   counts,
            "total":    len(votes),
            "my_vote":  my_vote,
        }

    return {
        "id":            post.id,
        "symbol":        post.symbol,
        "market":        post.market,
        "user_id":       post.user_id,
        "username":      display_name(post.user, profile),
        "avatar_color":  profile.avatar_color if profile else 0,
        "title":         parsed["title"],
        "body":          parsed["body"],
        "image":         parsed.get("image", ""),
        "poll":          poll_data,
        "tags":          parsed.get("tags", []),
        "portfolio":     parsed.get("portfolio"),
        "like_count":    getattr(post, "like_count", 0) or 0,
        "comment_count": comment_counts.get(post.id, 0) if comment_counts is not None else 0,
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
    title:     str = ""
    body:      str = ""
    content:   str = ""  # backwards compat: old frontend sends {content}
    image:     str = ""
    poll:      Optional[dict] = None
    tags:      list = []
    portfolio: Optional[list] = None

    @model_validator(mode="before")
    @classmethod
    def _compat_content(cls, data):
        if isinstance(data, dict) and not data.get("body", "").strip() and data.get("content", "").strip():
            data = dict(data)
            data["body"] = data["content"]
        return data

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
        StockPost.symbol == sym, StockPost.market == market, StockPost.is_deleted.isnot(True)
    )
    total = q.count()
    if sort == "likes":
        q = q.order_by(StockPost.like_count.desc(), StockPost.created_at.desc())
    else:
        q = q.order_by(StockPost.created_at.desc())

    # defer: DB에 없는 컬럼은 SELECT 제외 → 쿼리 실패 방지
    # selectinload: likes/user 일괄 조회 → N+1 제거
    posts = (
        q.options(
            defer(StockPost.comment_count),
            defer(StockPost.updated_at),
            selectinload(StockPost.likes),
            selectinload(StockPost.user),
        )
        .offset((page - 1) * limit)
        .limit(limit)
        .all()
    )
    post_ids = [p.id for p in posts]
    user_ids = list({p.user_id for p in posts})

    profiles_map = (
        {up.user_id: up for up in db.query(UserProfile).filter(UserProfile.user_id.in_(user_ids)).all()}
        if user_ids else {}
    )
    # 댓글 수 일괄 집계 (comment_count 컬럼 불사용)
    comment_counts: dict = {}
    if post_ids:
        rows = db.execute(
            text("SELECT post_id, COUNT(*) FROM stock_comments WHERE post_id = ANY(:ids) AND is_deleted = false GROUP BY post_id"),
            {"ids": post_ids},
        ).fetchall()
        comment_counts = {r[0]: r[1] for r in rows}

    return {"total": total, "page": page, "items": [
        _ser_post(p, uid, db, profiles_map, comment_counts) for p in posts
    ]}


# ── 게시글 작성 ────────────────────────────────────────────────
@router.post("/{market}/{symbol}/posts", status_code=201)
def create_post(
    body:         PostCreate,
    market:       Literal["KR", "US", "ETF"],
    symbol:       str = Path(..., pattern=_SYMBOL_RE),
    current_user=Depends(require_user),
):
    # admin/announcement과 동일하게 engine.connect() + raw SQL 사용.
    # ORM 세션을 쓰면 commit 후 lazy-load가 발생해 Render 커넥션 풀 고갈로 500.
    uid_val   = current_user.id
    uname_val = current_user.username
    sym_upper = symbol.upper()
    content_val = encode_content(body.title, body.body, body.image, body.poll, body.tags, body.portfolio)

    try:
        with engine.connect() as conn:
            result = conn.execute(
                text("""
                    INSERT INTO stock_posts (symbol, market, user_id, content, is_deleted, like_count)
                    VALUES (:symbol, :market, :user_id, :content, false, 0)
                    RETURNING id
                """),
                {"symbol": sym_upper, "market": market, "user_id": uid_val, "content": content_val},
            )
            conn.commit()
            row = result.fetchone()
            post_id = row[0]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"글 등록 실패: {type(e).__name__}: {str(e)[:300]}")

    return {
        "id":            post_id,
        "symbol":        sym_upper,
        "market":        market,
        "user_id":       uid_val,
        "username":      uname_val,
        "avatar_color":  0,
        "title":         body.title.strip() if body.title else "",
        "body":          body.body,
        "image":         body.image or "",
        "poll":          None,
        "tags":          [t for t in (body.tags or []) if isinstance(t, dict) and "symbol" in t],
        "portfolio":     body.portfolio or None,
        "like_count":    0,
        "comment_count": 0,
        "liked":         False,
        "created_at":    "",
        "is_mine":       True,
    }


# ── 게시글 삭제 ────────────────────────────────────────────────
@router.delete("/{market}/{symbol}/posts/{post_id}", status_code=204)
def delete_post(
    market:  Literal["KR", "US", "ETF"],
    symbol:  str = Path(..., pattern=_SYMBOL_RE),
    post_id: int = Path(...),
    db:      Session = Depends(get_db),
    current_user=Depends(require_user),
):
    post = (
        db.query(StockPost)
        .filter(StockPost.id == post_id)
        .options(defer(StockPost.comment_count), defer(StockPost.updated_at))
        .first()
    )
    if not post or post.is_deleted:
        raise HTTPException(404, "게시글을 찾을 수 없습니다")
    if post.user_id != current_user.id and not current_user.is_admin:
        raise HTTPException(403, "삭제 권한이 없습니다")
    db.execute(text("DELETE FROM stock_post_poll_votes WHERE post_id = :pid"), {"pid": post_id})
    db.delete(post)
    db.commit()


# ── 게시글 좋아요 ──────────────────────────────────────────────
@router.post("/posts/{post_id}/like")
def toggle_post_like(
    post_id: int = Path(...),
    db:      Session = Depends(get_db),
    current_user=Depends(require_user),
):
    post = (
        db.query(StockPost)
        .filter(StockPost.id == post_id, StockPost.is_deleted.isnot(True))
        .options(defer(StockPost.comment_count), defer(StockPost.updated_at))
        .first()
    )
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


# ── 게시글 단건 조회 ──────────────────────────────────────────
@router.get("/posts/{post_id}")
def get_post(
    post_id: int = Path(...),
    db:      Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    uid = current_user.id if current_user else None
    post = (
        db.query(StockPost)
        .filter(StockPost.id == post_id, StockPost.is_deleted.isnot(True))
        .options(
            defer(StockPost.comment_count),
            defer(StockPost.updated_at),
            selectinload(StockPost.likes),
            selectinload(StockPost.user),
        )
        .first()
    )
    if not post:
        raise HTTPException(404, "게시글을 찾을 수 없습니다")
    profile = get_profile(db, post.user_id) if post.user else None
    count_row = db.execute(
        text("SELECT COUNT(*) FROM stock_comments WHERE post_id = :pid AND is_deleted = false"),
        {"pid": post_id},
    ).fetchone()
    comment_count = count_row[0] if count_row else 0
    return _ser_post(post, uid, db, {post.user_id: profile} if profile else None, {post_id: comment_count})


# ── 댓글 목록 ─────────────────────────────────────────────────
@router.get("/posts/{post_id}/comments")
def list_comments(
    post_id: int = Path(...),
    db:      Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    exists = db.execute(
        text("SELECT 1 FROM stock_posts WHERE id = :pid AND is_deleted IS NOT TRUE LIMIT 1"),
        {"pid": post_id},
    ).fetchone()
    if not exists:
        raise HTTPException(404, "게시글을 찾을 수 없습니다")
    uid = current_user.id if current_user else None
    # 루트 댓글만 (replies는 _ser_comment 내부에서 처리)
    root = db.query(StockComment).filter(
        StockComment.post_id == post_id,
        StockComment.parent_id == None,
        StockComment.is_deleted.isnot(True),
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
    post = (
        db.query(StockPost)
        .filter(StockPost.id == post_id, StockPost.is_deleted.isnot(True))
        .options(defer(StockPost.comment_count), defer(StockPost.updated_at))
        .first()
    )
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
    db.delete(c)
    db.commit()


# ── 댓글 좋아요 ───────────────────────────────────────────────
@router.post("/comments/{comment_id}/like")
def toggle_comment_like(
    comment_id: int = Path(...),
    db:         Session = Depends(get_db),
    current_user=Depends(require_user),
):
    c = db.query(StockComment).filter(StockComment.id == comment_id, StockComment.is_deleted.isnot(True)).first()
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


# ── 전체 피드 ─────────────────────────────────────────────────
@router.get("/feed")
def get_feed(
    page:      int = Query(1, ge=1),
    limit:     int = Query(20, ge=1, le=50),
    sort:      Literal["latest", "likes"] = Query("latest"),
    market:    Optional[str] = Query(None),
    following: bool = Query(False),
    db:        Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    uid = current_user.id if current_user else None
    q = db.query(StockPost).filter(StockPost.is_deleted.isnot(True))

    if following and uid:
        followed_ids = [
            f.following_id
            for f in db.query(UserFollow).filter(UserFollow.follower_id == uid).all()
        ]
        if followed_ids:
            q = q.filter(StockPost.user_id.in_(followed_ids))
        else:
            return {"total": 0, "page": page, "items": []}

    if market and market in ("KR", "US", "ETF"):
        q = q.filter(StockPost.market == market)
    total = q.count()
    if sort == "likes":
        q = q.order_by(StockPost.like_count.desc(), StockPost.created_at.desc())
    else:
        q = q.order_by(StockPost.created_at.desc())
    posts = (
        q.options(
            defer(StockPost.comment_count),
            defer(StockPost.updated_at),
            selectinload(StockPost.likes),
            selectinload(StockPost.user),
        )
        .offset((page - 1) * limit)
        .limit(limit)
        .all()
    )
    post_ids = [p.id for p in posts]
    user_ids = list({p.user_id for p in posts})
    profiles_map = (
        {up.user_id: up for up in db.query(UserProfile).filter(UserProfile.user_id.in_(user_ids)).all()}
        if user_ids else {}
    )
    feed_comment_counts: dict = {}
    if post_ids:
        rows = db.execute(
            text("SELECT post_id, COUNT(*) FROM stock_comments WHERE post_id = ANY(:ids) AND is_deleted = false GROUP BY post_id"),
            {"ids": post_ids},
        ).fetchall()
        feed_comment_counts = {r[0]: r[1] for r in rows}
    return {"total": total, "page": page, "items": [
        _ser_post(p, uid, db, profiles_map, feed_comment_counts) for p in posts
    ]}


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


# ── 투표 ─────────────────────────────────────────────────────
@router.post("/posts/{post_id}/poll/vote")
def vote_poll(
    post_id: int = Path(...),
    option_index: int = Body(..., embed=True),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    post = (
        db.query(StockPost)
        .filter(StockPost.id == post_id, StockPost.is_deleted.isnot(True))
        .options(defer(StockPost.comment_count), defer(StockPost.updated_at))
        .first()
    )
    if not post:
        raise HTTPException(404, "게시글을 찾을 수 없습니다")
    parsed = decode_content(post.content)
    if not parsed.get("poll"):
        raise HTTPException(400, "투표가 없는 게시글입니다")
    options = parsed["poll"].get("options", [])
    if option_index < 0 or option_index >= len(options):
        raise HTTPException(400, "유효하지 않은 선택지입니다")
    existing = db.query(StockPostPollVote).filter(
        StockPostPollVote.post_id == post_id,
        StockPostPollVote.user_id == current_user.id,
    ).first()
    if existing:
        existing.option_index = option_index
    else:
        db.add(StockPostPollVote(post_id=post_id, user_id=current_user.id, option_index=option_index))
    db.commit()
    votes = db.query(StockPostPollVote).filter(StockPostPollVote.post_id == post_id).all()
    counts = [0] * len(options)
    for v in votes:
        if 0 <= v.option_index < len(counts):
            counts[v.option_index] += 1
    return {"total": len(votes), "counts": counts, "my_vote": option_index}


# ── 팔로우 토글 ───────────────────────────────────────────────
@router.post("/users/{user_id}/follow")
def toggle_follow(
    user_id: int = Path(...),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    if user_id == current_user.id:
        raise HTTPException(400, "자기 자신을 팔로우할 수 없습니다")
    existing = db.query(UserFollow).filter(
        UserFollow.follower_id == current_user.id,
        UserFollow.following_id == user_id,
    ).first()
    if existing:
        db.delete(existing)
        db.commit()
        return {"followed": False}
    else:
        db.add(UserFollow(follower_id=current_user.id, following_id=user_id))
        db.commit()
        return {"followed": True}


# ── 유저 공개 프로필 ──────────────────────────────────────────
@router.get("/users/{user_id}/profile")
def get_user_public_profile(
    user_id: int = Path(...),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    user = db.query(User).filter(User.id == user_id, User.is_active == True).first()
    if not user:
        raise HTTPException(404, "사용자를 찾을 수 없습니다")
    p = db.query(UserProfile).filter(UserProfile.user_id == user_id).first()
    follower_count = db.query(UserFollow).filter(UserFollow.following_id == user_id).count()
    following_count = db.query(UserFollow).filter(UserFollow.follower_id == user_id).count()
    post_count = db.query(StockPost).filter(
        StockPost.user_id == user_id, StockPost.is_deleted.isnot(True)
    ).count()
    is_following = False
    if current_user:
        is_following = db.query(UserFollow).filter(
            UserFollow.follower_id == current_user.id,
            UserFollow.following_id == user_id,
        ).first() is not None
    is_me = current_user.id == user_id if current_user else False
    return {
        "user_id":        user.id,
        "username":       user.username,
        "nickname":       p.nickname if p else None,
        "avatar_color":   p.avatar_color if p else 0,
        "bio":            p.bio if p else None,
        "follower_count": follower_count,
        "following_count": following_count,
        "post_count":     post_count,
        "is_following":   is_following,
        "is_me":          is_me,
    }


# ── 유저 최근 활동 ────────────────────────────────────────────
@router.get("/users/{user_id}/activity")
def get_user_activity(
    user_id: int = Path(...),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    posts = (
        db.query(StockPost)
        .filter(StockPost.user_id == user_id, StockPost.is_deleted.isnot(True))
        .options(defer(StockPost.comment_count), defer(StockPost.updated_at))
        .order_by(StockPost.created_at.desc())
        .limit(10)
        .all()
    )
    comments = db.query(StockComment).filter(
        StockComment.user_id == user_id, StockComment.is_deleted.isnot(True)
    ).order_by(StockComment.created_at.desc()).limit(10).all()
    act_post_ids = [p.id for p in posts]
    act_comment_counts: dict = {}
    if act_post_ids:
        rows = db.execute(
            text("SELECT post_id, COUNT(*) FROM stock_comments WHERE post_id = ANY(:ids) AND is_deleted = false GROUP BY post_id"),
            {"ids": act_post_ids},
        ).fetchall()
        act_comment_counts = {r[0]: r[1] for r in rows}
    post_items = [{
        "type": "post",
        "id": p.id,
        "symbol": p.symbol,
        "market": p.market,
        "title": decode_content(p.content)["title"],
        "body": decode_content(p.content)["body"],
        "like_count": getattr(p, "like_count", 0) or 0,
        "comment_count": act_comment_counts.get(p.id, 0),
        "created_at": p.created_at.isoformat(),
    } for p in posts]
    comment_post_ids = [c.post_id for c in comments]
    post_meta: dict = {}
    if comment_post_ids:
        meta_rows = db.query(StockPost.id, StockPost.symbol, StockPost.market).filter(
            StockPost.id.in_(comment_post_ids),
            StockPost.is_deleted.isnot(True),
        ).all()
        post_meta = {r[0]: (r[1], r[2]) for r in meta_rows}

    # 부모 글이 삭제됐거나 존재하지 않는 댓글은 제외
    comment_items = [{
        "type": "comment",
        "id": c.id,
        "post_id": c.post_id,
        "symbol": post_meta[c.post_id][0],
        "market": post_meta[c.post_id][1],
        "content": c.content,
        "like_count": c.like_count,
        "created_at": c.created_at.isoformat(),
    } for c in comments if c.post_id in post_meta]
    activity = sorted(post_items + comment_items, key=lambda x: x["created_at"], reverse=True)[:15]
    return {"items": activity}


# ── 팔로워/팔로잉 목록 ────────────────────────────────────────
@router.get("/users/{user_id}/followers")
def get_followers(user_id: int = Path(...), db: Session = Depends(get_db)):
    follows = db.query(UserFollow).filter(UserFollow.following_id == user_id).all()
    result = []
    for f in follows:
        u = db.query(User).filter(User.id == f.follower_id).first()
        if u:
            p = db.query(UserProfile).filter(UserProfile.user_id == u.id).first()
            result.append({
                "user_id": u.id,
                "username": u.username,
                "nickname": p.nickname if p else None,
                "avatar_color": p.avatar_color if p else 0,
            })
    return result


@router.get("/users/{user_id}/following")
def get_following(user_id: int = Path(...), db: Session = Depends(get_db)):
    follows = db.query(UserFollow).filter(UserFollow.follower_id == user_id).all()
    result = []
    for f in follows:
        u = db.query(User).filter(User.id == f.following_id).first()
        if u:
            p = db.query(UserProfile).filter(UserProfile.user_id == u.id).first()
            result.append({
                "user_id": u.id,
                "username": u.username,
                "nickname": p.nickname if p else None,
                "avatar_color": p.avatar_color if p else 0,
            })
    return result
