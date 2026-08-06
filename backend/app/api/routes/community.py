import json
import logging
from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from sqlalchemy.orm import Session, selectinload, defer
from sqlalchemy import func, text
from sqlalchemy.exc import IntegrityError
from pydantic import BaseModel, field_validator, model_validator, Field, ConfigDict
from slowapi import Limiter
from slowapi.util import get_remote_address
from typing import Literal, Optional
from app.db.database import get_db, engine
from fastapi import Body
from app.models.community import StockPost, StockPostLike, StockComment, StockCommentLike, UserProfile, UserFollow, StockPostPollVote, Report, Notification
from app.models.user import User
from app.core.deps import get_current_user, require_user, require_community_active
from app.core.cache import cache

# 피드 공통 부분의 캐시 수명. 글이 초 단위로 바뀌지는 않으므로 30초면
# 새 글이 늦게 보이는 느낌 없이 왕복을 크게 줄인다.
# 피드 캐시 수명.
#
# 예전에는 30초였다. 무효화하는 곳이 하나도 없어서, 새 글이 늦게 보이는 것을
# 짧은 수명으로 막고 있었던 것이다. 그 대가로 30초마다 모든 방문자가 캐시를
# 놓쳤고, 그때마다 DB 를 여섯 번 왕복했다 — DB 가 원격이라 왕복마다 지연이
# 붙고, 그게 "피드가 느리다" 의 실체였다.
#
# 이제 글이 바뀔 때 직접 비운다. 그래서 수명을 길게 잡아도 새 글은 곧바로
# 보인다. 댓글 수만 이 수명만큼 늦게 따라오는데, 그건 기다려도 되는 값이다.
FEED_TTL = 180


def 피드캐시_비우기() -> None:
    """글이 바뀌었으니 목록 캐시를 버린다.

    페이지·정렬·시장·검색어마다 칸이 따로 있어서 한 글이 바뀌면 어느 칸에
    들어 있는지 알 수 없다. 전부 버리는 편이 맞다 — 다시 채우는 값이
    묵은 목록을 보여주는 것보다 싸다."""
    try:
        cache.delete_pattern("feed:")
    except Exception:
        log.exception("피드 캐시 비우기 실패")
from app.core.security import decode_token
from app.services.ticker_service import get_kr_db

log = logging.getLogger(__name__)

router = APIRouter(prefix="/community", tags=["community"])


def _account_key(request: Request) -> str:
    """쓰기 요청 횟수를 계정 기준으로 센다.

    IP로 세면 양쪽이 다 어긋난다. 회사·학교·모바일망처럼 여러 사람이 한 IP를
    쓰면 한 명 때문에 나머지가 막히고, 반대로 IP만 바꾸면 제한이 그냥 풀린다.
    커뮤니티 쓰기는 전부 로그인이 필요하므로 계정으로 세는 게 맞다.
    토큰을 읽지 못한 요청(=어차피 401로 막힐 요청)만 IP로 되돌린다."""
    auth = request.headers.get("authorization") or ""
    if auth[:7].lower() == "bearer ":
        data = decode_token(auth[7:].strip())
        if data and data.get("sub"):
            return f"community-user:{data['sub']}"
    return get_remote_address(request)


# 쓰기 엔드포인트에는 아무 제한이 없었다. 자동화 도구로 글·댓글·좋아요를
# 초당 수십 번 보내면 피드가 도배되고 DB 쓰기가 그대로 늘어난다.
# 사람이 손으로 쓰는 속도보다 넉넉하게, 자동 반복은 걸리도록 잡는다.
limiter = Limiter(key_func=_account_key)

_SYMBOL_RE = r"^[A-Za-z0-9.\-]{1,20}$"

# 블라인드(신고 누적·관리자 조치로 가려진 글·댓글)는 목록에서만 빠졌고
# 단건 조회·좋아요·댓글 작성·투표는 그대로 통과했다. 목록에서 사라진 글도
# 주소만 알면 계속 읽히고 반응이 달렸다는 뜻이다. 모든 접근 경로가 목록과
# 같은 기준을 쓰도록 조건을 한곳에 모은다.
# (관리자 화면은 admin.py의 별도 질의를 쓰므로 여기 조건에 영향받지 않는다)
_POST_VISIBLE    = (StockPost.is_deleted.isnot(True),    StockPost.is_blinded.isnot(True))
_COMMENT_VISIBLE = (StockComment.is_deleted.isnot(True), StockComment.is_blinded.isnot(True))

_SAFE_AVATAR_TYPES = frozenset({"image/jpeg", "image/png", "image/gif", "image/webp"})

# 화면은 800px·품질 0.7 JPEG로 줄여 보내므로 보통 200KB 안쪽이다. 상한은 그보다
# 넉넉히 잡되 무제한은 아니게 둔다 — 글 이미지에는 상한이 아예 없어서, API를
# 직접 호출하면 수십 MB짜리 글을 만들 수 있었다. 그 글은 목록에 뜨는 것만으로
# 모든 사용자의 피드 응답에 그대로 실려 나간다.
_IMAGE_MAX_CHARS = 1_500_000


def _validate_uploaded_image(value: str, field: str = "이미지") -> str:
    """게시글·프로필에 첨부되는 이미지를 검증한다.

    화면에서는 캔버스로 압축한 data:image/jpeg 만 보내지만, API는 누구나 직접
    호출할 수 있다. 외부 주소(https://…)를 넣으면 그 글을 보는 모든 사용자의
    접속 정보가 작성자가 지정한 서버로 전달돼 추적에 쓰일 수 있고,
    data:text/html 같은 형식은 브라우저·환경에 따라 다르게 해석될 수 있다.
    그래서 프로필 사진과 동일하게 허용된 이미지 형식만 받는다.
    """
    if not value:
        return ""
    if len(value) > _IMAGE_MAX_CHARS:
        raise HTTPException(422, f"{field}가 너무 큽니다 (약 1.5MB 이하)")
    if not value.startswith("data:"):
        raise HTTPException(422, f"{field}는 파일 첨부만 가능합니다")
    mime = value[5:].split(";")[0]
    if mime not in _SAFE_AVATAR_TYPES:
        raise HTTPException(422, "지원하지 않는 이미지 형식입니다 (JPEG, PNG, GIF, WebP만 허용)")
    return value

_kr_name_cache: dict[str, str] = {}

def _kr_name(symbol: str) -> str | None:
    if symbol in _kr_name_cache:
        return _kr_name_cache[symbol]
    try:
        for t in get_kr_db():
            if t.get("s") == symbol or t.get("symbol") == symbol:
                name = t.get("n") or t.get("name")
                if name:
                    _kr_name_cache[symbol] = name
                    return name
    except Exception:
        pass
    return None

def _enrich_tags(tags: list) -> list:
    result = []
    for t in tags:
        if isinstance(t, dict) and t.get("market") == "KR" and not t.get("name"):
            name = _kr_name(t.get("symbol", ""))
            t = {**t, "name": name} if name else t
        result.append(t)
    return result

# ── 컨텐츠 인코딩/디코딩 ──────────────────────────────────────
def _plain(v):
    """첨부물을 JSON에 담을 수 있는 순수 dict/list로 되돌린다.

    첨부물은 검증을 위해 Pydantic 모델로 받지만 저장은 JSON 문자열이라
    모델 객체 그대로는 json.dumps가 터진다. 읽어올 때는 이미 dict이므로
    양쪽 어느 형태로 들어와도 같은 결과가 나오게 한다."""
    if isinstance(v, BaseModel):
        return v.model_dump()
    if isinstance(v, list):
        return [_plain(x) for x in v]
    return v


def _댓글수(db: Session, post_ids: list[int]) -> dict[int, int]:
    """글 여러 건의 댓글 수를 한 번에 센다.

    예전에는 raw SQL 의 `post_id = ANY(:ids)` 를 썼다. ANY 는 PostgreSQL
    전용이라 SQLite 에서는 'no such function: ANY' 로 죽는다 — 프로덕션은
    멀쩡한데 로컬에서 글이 하나라도 있으면 피드가 통째로 500 이었다.
    ORM 의 in_() 로 바꾸면 두 곳 다 같은 SQL 로 나간다."""
    if not post_ids:
        return {}
    행 = (
        db.query(StockComment.post_id, func.count(StockComment.id))
          .filter(StockComment.post_id.in_(post_ids),
                  StockComment.is_deleted.isnot(True),
                  StockComment.is_blinded.isnot(True))
          .group_by(StockComment.post_id)
          .all()
    )
    return {r[0]: r[1] for r in 행}


def _이미지쪼개기(data_uri: str) -> tuple[str | None, bytes | None]:
    """'data:image/jpeg;base64,...' 를 (형식, 원본바이트) 로 나눈다.

    이미지를 본문(content) 안에 두면 피드 한 페이지를 읽을 때 이미지 스무
    장이 SELECT 에 딸려 온다. 컬럼으로 빼서 목록 조회에서 아예 안 읽게
    한다. base64 는 3바이트를 4글자로 부풀리므로 원본 바이트로 넣는다.

    못 쪼개면 (None, None) — 부르는 쪽이 예전처럼 content 에 넣는다."""
    import base64
    if not data_uri or not data_uri.startswith("data:image/"):
        return None, None
    try:
        머리, 본체 = data_uri.split(",", 1)
        형식 = 머리.split(";")[0][5:]
        if 형식 not in _SAFE_AVATAR_TYPES:
            return None, None
        return 형식, base64.b64decode(본체, validate=True)
    except Exception:
        return None, None


def encode_content(title: str, body: str, image: str = "", poll: Optional[dict] = None, tags: Optional[list] = None, portfolio: Optional[list] = None) -> str:
    return json.dumps({
        "v":         1,
        "title":     title.strip(),
        "body":      body.strip(),
        "image":     image,
        "poll":      _plain(poll) or None,
        "tags":      _plain(tags) or [],
        "portfolio": _plain(portfolio) or None,
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

# ── 검색용 납작한 사본 ────────────────────────────────────────
# content 는 JSON 이라 DB 가 안을 들여다볼 수 없다. 매번 꺼내 파싱해서
# 거르면 글이 늘수록 그대로 느려지고, 인덱스도 못 태운다. 그래서 검색에
# 걸릴 만한 것들만 소문자로 이어 붙여 따로 둔다.
#
# 이미지·투표 결과·포트폴리오 스냅샷은 넣지 않는다. 사람이 검색창에 칠
# 만한 말이 아니고, 넣으면 컬럼만 무거워진다.
_SEARCH_MAX = 4000
# 검색어 길이 — 길수록 캐시 칸만 늘고 LIKE 도 느려진다
_SEARCH_Q_MAX = 50


def 검색문장(title: str, body: str, symbol: str = "", tags: Optional[list] = None) -> str:
    조각 = [title or "", body or "", symbol or ""]
    for t in (tags or []):
        d = t if isinstance(t, dict) else getattr(t, "__dict__", {}) or {}
        조각.append(str(d.get("symbol") or ""))
        조각.append(str(d.get("name") or ""))
    # 종목코드는 대문자로 저장되고 사람은 소문자로 친다. 한쪽으로 맞춘다
    return " ".join(x for x in 조각 if x).lower()[:_SEARCH_MAX]


def 글에서_검색문장(post) -> str:
    """이미 저장된 글에서 뽑아낸다 — 채워 넣기(backfill)와 수정에 쓴다."""
    parsed = decode_content(post.content or "")
    return 검색문장(parsed.get("title", ""), parsed.get("body", ""),
                    post.symbol or "", parsed.get("tags") or [])


def 검색문장_채우기(db: Session, 한번에: int = 200) -> int:
    """search_text 가 빈 옛 글을 채운다. 시작할 때 한 번 돈다.

    안 채우면 컬럼을 만든 이후에 쓴 글만 검색되고, 그 전 글은 통째로
    안 걸린다 — 검색이 되긴 되므로 한참 뒤에야 알아챈다.

    한 번에 다 하지 않는다. 0.15 CPU / 512MB 짜리 서버라 수천 건을 한꺼번에
    올리면 그동안 앱이 안 뜬다. 한 묶음만 하고 나머지는 다음 시작 때 이어서
    한다 — 어차피 옛 글이라 급하지 않다.
    """
    try:
        대상 = (db.query(StockPost)
                  .filter(StockPost.search_text.is_(None),
                          StockPost.is_deleted.isnot(True))
                  .limit(한번에).all())
        if not 대상:
            return 0
        for p in 대상:
            p.search_text = 글에서_검색문장(p)
        db.commit()
        return len(대상)
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
        log.exception("검색문장 채우기 실패")
        return 0


def 시작할때_검색문장_채우기() -> int:
    """서버가 뜰 때 한 묶음 채운다. main 은 이것만 부르면 된다.

    세션 여닫는 것까지 여기서 하는 이유 — main 쪽에 두면 그 코드가 커다란
    try 블록 안에 들어가, import 하나만 어긋나도 조용히 넘어간다. 실제로는
    한 건도 안 채우면서 로그에는 아무 말도 안 남는 상태가 된다.
    """
    from app.db.database import SessionLocal
    db = SessionLocal()
    try:
        return 검색문장_채우기(db)
    finally:
        db.close()


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

# ── 좋아요 여부 조회 ──────────────────────────────────────────
def _liked_post_ids(db: Session, uid: Optional[int], post_ids: list) -> set:
    """이 목록 중 내가 좋아요한 글의 id만 뽑는다.

    예전에는 글마다 좋아요 행을 통째로 불러와(selectinload) 그 안에서 내 id를
    찾았다. 화면에 필요한 건 '내가 눌렀는가' 한 줄인데, 좋아요 5천 개짜리 글이
    한 페이지에 몇 개만 있어도 수만 행을 읽어 버린다. 개수는 like_count 컬럼에
    이미 있으므로 내 것만 물어보면 된다."""
    if not uid or not post_ids:
        return set()
    rows = db.query(StockPostLike.post_id).filter(
        StockPostLike.user_id == uid, StockPostLike.post_id.in_(post_ids)
    ).all()
    return {r[0] for r in rows}


def _liked_comment_ids(db: Session, uid: Optional[int], comment_ids: list) -> set:
    """댓글도 같은 이유로 내가 누른 것만 조회한다"""
    if not uid or not comment_ids:
        return set()
    rows = db.query(StockCommentLike.comment_id).filter(
        StockCommentLike.user_id == uid, StockCommentLike.comment_id.in_(comment_ids)
    ).all()
    return {r[0] for r in rows}


def _개인화(db: Session, uid: Optional[int], 공통: dict) -> dict:
    """캐시에서 꺼낸 공통 목록에 '나에게만 해당하는 것'을 덧칠한다.

    사람마다 다른 건 네 가지뿐이다 — 좋아요를 눌렀는지, 내 글인지,
    그 사람을 팔로우 중인지, 어느 항목에 투표했는지. 나머지는 누가 보든
    같으므로 캐시에서 그대로 쓴다.

    비로그인이면 덧칠할 것이 없어 DB 를 아예 보지 않는다."""
    items = 공통.get("items") or []
    if not uid or not items:
        return 공통

    post_ids = [it["id"] for it in items]
    user_ids = {it.get("user_id") for it in items if it.get("user_id")}

    liked = _liked_post_ids(db, uid, post_ids)
    following: set = set()
    others = [u for u in user_ids if u != uid]
    if others:
        following = {
            r[0] for r in db.query(UserFollow.following_id).filter(
                UserFollow.follower_id == uid, UserFollow.following_id.in_(others)
            ).all()
        }
    # 내가 투표한 것 — 투표가 붙은 글에만 해당한다
    투표글 = [it["id"] for it in items if it.get("poll")]
    내투표: dict = {}
    if 투표글:
        for v in db.query(StockPostPollVote).filter(
            StockPostPollVote.post_id.in_(투표글), StockPostPollVote.user_id == uid
        ).all():
            내투표[v.post_id] = v.option_index

    새items = []
    for it in items:
        새 = {**it,
              "liked":        it["id"] in liked,
              "is_mine":      it.get("user_id") == uid,
              "is_following": it.get("user_id") in following}
        if it.get("poll") and it["id"] in 내투표:
            새["poll"] = {**it["poll"], "my_vote": 내투표[it["id"]]}
        새items.append(새)
    return {**공통, "items": 새items}


# ── 직렬화 ────────────────────────────────────────────────────
def _ser_post(post: StockPost, uid: Optional[int], db: Session,
              profiles_map: Optional[dict] = None,
              comment_counts: Optional[dict] = None,
              following_ids: Optional[set] = None,
              poll_votes_map: Optional[dict] = None,
              liked_ids: Optional[set] = None,
              이미지빼기: bool = False) -> dict:
    """이미지빼기 — 목록에서는 이미지를 빼고 '있다'는 표시만 보낸다.

    이미지가 base64 로 본문(content) 안에 들어 있어서, 피드 20개를 부르면
    이미지 20장이 통째로 같이 온다. 화면에서는 높이 192px 로 잘라 보여줄
    뿐인데 원본을 다 받는 셈이라, 글 목록 하나에 수 MB 가 오갔다.
    목록은 가볍게 보내고, 이미지는 카드가 화면에 들어올 때 따로 받는다
    (/community/posts/{id}/image). 브라우저가 그걸 캐시하므로 다시 볼 때는
    아예 요청이 안 나간다."""
    liked = (post.id in liked_ids) if liked_ids is not None else (
        any(lk.user_id == uid for lk in post.likes) if uid else False
    )
    parsed = decode_content(post.content)
    profile = profiles_map.get(post.user_id) if profiles_map is not None else (
        get_profile(db, post.user_id) if post.user else None
    )

    # 투표 집계 — poll_votes_map이 있으면 DB 재조회 없이 사용
    poll_data = None
    if parsed.get("poll"):
        votes = poll_votes_map.get(post.id, []) if poll_votes_map is not None else (
            db.query(StockPostPollVote).filter(StockPostPollVote.post_id == post.id).all()
        )
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
        "avatar_url":    profile.avatar_url if profile else None,
        "title":         parsed["title"],
        "body":          parsed["body"],
        "image":         "" if 이미지빼기 else parsed.get("image", ""),
        # 목록에서는 이미지를 안 보내므로, 자리를 잡아 두려면 있는지는 알아야 한다
        # 컬럼이 먼저다. 옛 글은 아직 본문 안에 있으므로 그때만 파싱값을 본다
        "has_image":     bool(getattr(post, "has_image", False) or parsed.get("image")),
        "poll":          poll_data,
        "tags":          _enrich_tags(parsed.get("tags", [])),
        "portfolio":     parsed.get("portfolio"),
        "like_count":    getattr(post, "like_count", 0) or 0,
        "comment_count": comment_counts.get(post.id, 0) if comment_counts is not None else 0,
        "view_count":    getattr(post, "view_count", 0) or 0,
        "liked":         liked,
        "created_at":    post.created_at.isoformat(),
        "is_mine":       post.user_id == uid if uid else False,
        "is_following":  (post.user_id in following_ids) if following_ids is not None and uid and post.user_id != uid else False,
    }

def _ser_comment(c: StockComment, uid: Optional[int], db: Session, profiles_map: Optional[dict] = None,
                 liked_ids: Optional[set] = None) -> dict:
    liked = (c.id in liked_ids) if liked_ids is not None else (
        any(lk.user_id == uid for lk in c.likes) if uid else False
    )
    profile = profiles_map.get(c.user_id) if profiles_map is not None else (get_profile(db, c.user_id) if c.user else None)
    replies = []
    if c.replies:
        # 최상위 댓글은 질의에서 블라인드를 걸렀지만 답글은 관계로 딸려와
        # 그대로 노출되고 있었다
        for r in sorted([x for x in c.replies if not x.is_deleted and not x.is_blinded],
                        key=lambda x: x.created_at):
            rp = profiles_map.get(r.user_id) if profiles_map is not None else (get_profile(db, r.user_id) if r.user else None)
            r_liked = (r.id in liked_ids) if liked_ids is not None else (
                any(lk.user_id == uid for lk in r.likes) if uid else False
            )
            replies.append({
                "id":           r.id,
                "parent_id":    c.id,
                "user_id":      r.user_id,
                "username":     display_name(r.user, rp),
                "avatar_color": rp.avatar_color if rp else 0,
                "avatar_url":   rp.avatar_url if rp else None,
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
        "avatar_url":   profile.avatar_url if profile else None,
        "content":      c.content,
        "like_count":   c.like_count,
        "liked":        liked,
        "created_at":   c.created_at.isoformat(),
        "is_mine":      c.user_id == uid if uid else False,
        "replies":      replies,
    }

# ── Pydantic ──────────────────────────────────────────────────
#
# 첨부물(투표·종목태그·포트폴리오)은 예전에 dict/list 라는 것만 확인하고 내부 구조를
# 전혀 보지 않았다. 그래서 options 자리에 숫자를 넣으면 목록을 만들 때 len()이 터져
# 피드와 모든 종목 커뮤니티가 500으로 죽었다. 자기 글 하나를 정상 API로 수정하는
# 것만으로 가능했고, 같은 목록에 있던 남의 글까지 함께 보이지 않게 됐다.
# 화면이 실제로 만들 수 있는 형태만 받도록 스키마를 고정한다.

class PollIn(BaseModel):
    """투표 — 화면에서는 질문 1개 + 보기 2~4개만 만들 수 있다"""
    model_config = ConfigDict(extra="ignore")
    question: str = Field(..., max_length=100)
    options:  list[str] = Field(..., min_length=2, max_length=4)

    @field_validator("options")
    @classmethod
    def _options_ok(cls, v: list[str]) -> list[str]:
        cleaned = [o.strip() for o in v if isinstance(o, str) and o.strip()]
        if len(cleaned) < 2:
            raise ValueError("투표 보기는 2개 이상 입력해 주세요")
        if any(len(o) > 50 for o in cleaned):
            raise ValueError("투표 보기는 50자 이내로 입력해 주세요")
        return cleaned


# 종목코드는 형식을 강제하지 않는다. 내 자산의 현금 항목은 symbol이 "현금"이라
# 영문·숫자만 허용하면 현금이 들어간 포트폴리오는 공유 자체가 막힌다.
# 여기서 막아야 하는 건 표기 형식이 아니라 '터지거나 화면을 밀어버리는 값'이다.
_SymbolIn = Field(..., min_length=1, max_length=40)


class TagIn(BaseModel):
    """종목 태그 — 글에 붙는 종목 참조"""
    model_config = ConfigDict(extra="ignore")
    symbol: str = _SymbolIn
    market: Literal["KR", "US", "ETF"]
    name:   Optional[str] = Field(None, max_length=100)


class PortfolioItemIn(BaseModel):
    """포트폴리오 첨부 — 화면에서 보유 종목을 골라 붙인다"""
    model_config = ConfigDict(extra="ignore")
    symbol:    str = _SymbolIn
    market:    Literal["KR", "US", "ETF"]
    name:      str = Field("", max_length=100)
    shares:    float = Field(0, ge=0, le=1e12)
    avg_price: float = Field(0, ge=0, le=1e12)
    currency:  Optional[str] = Field(None, max_length=8)
    input_exchange_rate: Optional[float] = Field(None, ge=0, le=1e6)
    current_price:       Optional[float] = Field(None, ge=0, le=1e12)
    asset_class:         Optional[str] = Field(None, max_length=20)


# 본문·제목·댓글 길이 — 작성과 수정이 같은 기준을 쓰도록 한곳에 둔다
_BODY_MAX, _TITLE_MAX, _COMMENT_MAX = 2000, 100, 500
_TAGS_MAX, _PORTFOLIO_MAX = 60, 50


def _check_body(v: str) -> str:
    v = (v or "").strip()
    if not v:
        raise ValueError("내용을 입력해 주세요")
    if len(v) > _BODY_MAX:
        raise ValueError(f"내용은 {_BODY_MAX}자 이내로 입력해 주세요")
    return v


def _check_title(v: str) -> str:
    v = (v or "").strip()
    if len(v) > _TITLE_MAX:
        raise ValueError(f"제목은 {_TITLE_MAX}자 이내로 입력해 주세요")
    return v


def _check_comment(v: str) -> str:
    v = (v or "").strip()
    if not v:
        raise ValueError("내용을 입력해 주세요")
    if len(v) > _COMMENT_MAX:
        raise ValueError(f"댓글은 {_COMMENT_MAX}자 이내로 입력해 주세요")
    return v


class PostCreate(BaseModel):
    title:     str = ""
    body:      str = ""
    content:   str = ""  # backwards compat: old frontend sends {content}
    image:     str = Field("", max_length=_IMAGE_MAX_CHARS)
    poll:      Optional[PollIn] = None
    # 직접 붙이는 태그는 화면에서 5개까지지만, 포트폴리오 공유는 보유 종목
    # 수만큼 태그가 자동으로 붙는다. 5로 잡으면 종목이 많은 사람은 공유가 막힌다.
    tags:      list[TagIn] = Field(default_factory=list, max_length=_TAGS_MAX)
    portfolio: Optional[list[PortfolioItemIn]] = Field(None, max_length=_PORTFOLIO_MAX)

    @model_validator(mode="before")
    @classmethod
    def _compat_content(cls, data):
        if isinstance(data, dict) and not data.get("body", "").strip() and data.get("content", "").strip():
            data = dict(data)
            data["body"] = data["content"]
        return data

    _body  = field_validator("body")(classmethod(lambda cls, v: _check_body(v)))
    _title = field_validator("title")(classmethod(lambda cls, v: _check_title(v)))

class CommentCreate(BaseModel):
    content:   str
    parent_id: Optional[int] = None
    _content = field_validator("content")(classmethod(lambda cls, v: _check_comment(v)))

class ProfileUpdate(BaseModel):
    nickname:     Optional[str] = None
    avatar_color: Optional[int] = None
    bio:          Optional[str] = None
    avatar_url:   Optional[str] = Field(None, max_length=_IMAGE_MAX_CHARS)

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
        StockPost.symbol == sym, StockPost.market == market,
        StockPost.is_deleted.isnot(True), StockPost.is_blinded.isnot(True)
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
            # 이미지를 안 읽는 것이 목록 속도의 핵심이다. 응답에서만 빼면
            # SELECT 는 여전히 이미지를 통째로 끌어온다.
            defer(StockPost.image_data),
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
        comment_counts = _댓글수(db, post_ids)
    lp_following_ids: set = set()
    if uid and user_ids:
        others = [uid2 for uid2 in user_ids if uid2 != uid]
        if others:
            fol_rows = db.query(UserFollow.following_id).filter(
                UserFollow.follower_id == uid, UserFollow.following_id.in_(others)
            ).all()
            lp_following_ids = {r[0] for r in fol_rows}
    lp_liked_ids = _liked_post_ids(db, uid, post_ids)
    # 투표 일괄 조회 (N+1 방지)
    lp_poll_votes: dict = {}
    if post_ids:
        for v in db.query(StockPostPollVote).filter(StockPostPollVote.post_id.in_(post_ids)).all():
            lp_poll_votes.setdefault(v.post_id, []).append(v)
    return {"total": total, "page": page, "items": [
        _ser_post(p, uid, db, profiles_map, comment_counts, lp_following_ids, lp_poll_votes,
                  lp_liked_ids) for p in posts
    ]}


# ── 알림 쌓기 ─────────────────────────────────────────────────
_NOTI_PREVIEW_MAX = 100
# 같은 사람이 같은 대상에 몇 번을 눌러도 알림은 한 번만 남기는 종류
_NOTI_ONCE_KINDS = frozenset({"post_like", "comment_like", "follow"})

# 사용자가 켜고 끌 수 있는 알림 종류 — 화면의 설정 항목과 1:1로 대응한다
_NOTI_KINDS = ("comment", "reply", "post_like", "comment_like", "follow")


def _disabled_kinds(db: Session, user_id: int) -> frozenset:
    """이 사람이 받지 않기로 한 알림 종류.

    설정을 화면에서만 걸러내면 끈 알림도 DB에 계속 쌓이고 안 읽은 개수에
    잡힌다. 그래서 만들기 전에 여기서 확인한다."""
    row = db.query(UserProfile.noti_disabled).filter(UserProfile.user_id == user_id).first()
    raw = (row[0] if row else None) or ""
    return frozenset(k for k in (s.strip() for s in raw.split(",")) if k)


def _notify(db: Session, *, user_id: int, actor_id: int, kind: str,
            post_id: Optional[int] = None, comment_id: Optional[int] = None,
            preview: str = "") -> None:
    """반응이 생겼을 때 알림 한 줄을 남긴다.

    알림은 곁다리 기능이다. 여기서 실패했다고 원래 하려던 일(댓글 작성,
    좋아요)까지 같이 실패하면 안 된다. 그래서 반드시 '원래 작업을 커밋한
    뒤에' 호출하고, 실패하면 알림만 되돌린다.
    내가 내 글에 다는 댓글처럼 자기 행동은 알리지 않는다."""
    if not user_id or user_id == actor_id:
        return
    try:
        if kind in _disabled_kinds(db, user_id):
            return
        if kind in _NOTI_ONCE_KINDS:
            # 좋아요·팔로우는 '한 사람이 한 번 누른 상태'이지 사건의 연속이 아니다.
            # 껐다 켜기를 반복하면 알림이 계속 쌓여 상대 알림함을 도배할 수 있었다
            # (요청 제한만으로는 분당 30건까지 통과한다).
            dup = db.query(Notification.id).filter(
                Notification.user_id == user_id,
                Notification.actor_id == actor_id,
                Notification.kind == kind,
                Notification.post_id.is_(None) if post_id is None else Notification.post_id == post_id,
                Notification.comment_id.is_(None) if comment_id is None else Notification.comment_id == comment_id,
            ).first()
            if dup:
                return
        db.add(Notification(
            user_id=user_id, actor_id=actor_id, kind=kind,
            post_id=post_id, comment_id=comment_id,
            preview=(preview or "")[:_NOTI_PREVIEW_MAX] or None,
        ))
        db.commit()
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass


# ── 게시글 작성 ────────────────────────────────────────────────
@router.post("/{market}/{symbol}/posts", status_code=201)
@limiter.limit("10/minute")
def create_post(
    request: Request,
    body:         PostCreate,
    market:       Literal["KR", "US", "ETF"],
    symbol:       str = Path(..., pattern=_SYMBOL_RE),
    current_user=Depends(require_community_active),
):
    # admin/announcement과 동일하게 engine.connect() + raw SQL 사용.
    # ORM 세션을 쓰면 commit 후 lazy-load가 발생해 Render 커넥션 풀 고갈로 500.
    uid_val   = current_user.id
    uname_val = current_user.username
    sym_upper = symbol.upper()
    image_val = _validate_uploaded_image(body.image, "첨부 이미지")
    # 이미지는 본문 밖 컬럼으로 넣는다
    형식, 바이트 = _이미지쪼개기(image_val)
    # 쪼개지면 content 에서는 뺀다 — 목록 조회가 이미지를 안 읽게 하는 것이 목적이다
    content_val = encode_content(body.title, body.body,
                                 "" if 바이트 else image_val,
                                 body.poll, body.tags, body.portfolio)

    try:
        with engine.connect() as conn:
            result = conn.execute(
                text("""
                    INSERT INTO stock_posts (symbol, market, user_id, content, is_deleted, like_count,
                                             has_image, image_mime, image_data, search_text)
                    VALUES (:symbol, :market, :user_id, :content, false, 0,
                            :has_image, :image_mime, :image_data, :search_text)
                    RETURNING id
                """),
                {"symbol": sym_upper, "market": market, "user_id": uid_val, "content": content_val,
                 "has_image": bool(바이트) or bool(image_val),
                 "image_mime": 형식, "image_data": 바이트,
                 # 여기서 안 채우면 방금 쓴 글만 검색에 안 걸린다 — 제일
                 # 알아채기 어려운 종류의 구멍이다
                 "search_text": 검색문장(body.title, body.body, sym_upper, _plain(body.tags))},
            )
            conn.commit()
            row = result.fetchone()
            post_id = row[0]
    except Exception as e:
        # 예전에는 예외 원문을 그대로 돌려줘 테이블·컬럼 구조가 노출됐다.
        # 원인은 서버 로그로 남기고 사용자에게는 상황만 알린다
        log.exception("글 등록 실패 (user=%s, symbol=%s)", uid_val, sym_upper)
        raise HTTPException(status_code=500, detail="글 등록에 실패했습니다. 잠시 후 다시 시도해 주세요")

    피드캐시_비우기()   # 방금 쓴 글이 목록에 바로 보여야 한다
    return {
        "id":            post_id,
        "symbol":        sym_upper,
        "market":        market,
        "user_id":       uid_val,
        "username":      uname_val,
        "avatar_color":  0,
        "title":         body.title.strip() if body.title else "",
        "body":          body.body,
        "image":         image_val,
        "poll":          None,
        "tags":          _plain(body.tags),
        "portfolio":     _plain(body.portfolio),
        "like_count":    0,
        "comment_count": 0,
        "liked":         False,
        "created_at":    "",
        "is_mine":       True,
    }


# ── 게시글 수정 ────────────────────────────────────────────────
class PostUpdate(BaseModel):
    """수정에도 작성과 동일한 제한을 건다.
    예전에는 검증이 하나도 없어서 '정상 작성 → 즉시 수정'만으로 글자수 제한을
    우회할 수 있었다 (본문 100만자 저장이 실제로 가능했다)."""
    title: str = ""
    body:  str = ""
    tags:  Optional[list[TagIn]] = Field(None, max_length=_TAGS_MAX)
    poll:  Optional[PollIn] = None
    image: Optional[str] = Field(None, max_length=_IMAGE_MAX_CHARS)

    _body  = field_validator("body")(classmethod(lambda cls, v: _check_body(v)))
    _title = field_validator("title")(classmethod(lambda cls, v: _check_title(v)))

@router.put("/{market}/{symbol}/posts/{post_id}")
@limiter.limit("20/minute")
def update_post(
    request: Request,
    market:   Literal["KR", "US", "ETF"],
    symbol:   str = Path(..., pattern=_SYMBOL_RE),
    post_id:  int = Path(...),
    payload:  PostUpdate = Body(...),
    current_user=Depends(require_community_active),
):
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT user_id, content, is_deleted FROM stock_posts WHERE id = :id"),
            {"id": post_id},
        ).fetchone()
        if not row or row[2]:
            raise HTTPException(404, "게시글을 찾을 수 없습니다")
        if row[0] != current_user.id and not current_user.is_admin:
            raise HTTPException(403, "수정 권한이 없습니다")
        parsed = decode_content(row[1])
        new_title = payload.title.strip()
        new_body  = payload.body.strip()
        new_tags  = payload.tags if payload.tags is not None else parsed.get("tags")
        existing_poll = parsed.get("poll")
        new_poll  = existing_poll if existing_poll else payload.poll
        new_image = (_validate_uploaded_image(payload.image, "첨부 이미지")
                     if payload.image is not None else parsed.get("image", ""))
        new_content = encode_content(
            new_title, new_body,
            new_image, new_poll,
            new_tags, parsed.get("portfolio"),
        )
        conn.execute(
            text("UPDATE stock_posts SET content = :content, search_text = :search_text WHERE id = :id"),
            {"content": new_content, "id": post_id,
             # 제목을 고쳐 놓고 옛 제목으로 검색되면 더 이상하다
             "search_text": 검색문장(new_title, new_body, symbol.upper(), _plain(new_tags))},
        )
        conn.commit()
    피드캐시_비우기()   # 고친 제목이 목록에도 반영돼야 한다
    return {"id": post_id, "title": new_title, "body": new_body}


# ── 게시글 삭제 ────────────────────────────────────────────────
@router.delete("/{market}/{symbol}/posts/{post_id}", status_code=204)
@limiter.limit("20/minute")
def delete_post(
    request: Request,
    market:  Literal["KR", "US", "ETF"],
    symbol:  str = Path(..., pattern=_SYMBOL_RE),
    post_id: int = Path(...),
    db:      Session = Depends(get_db),
    current_user=Depends(require_community_active),
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
    # 알림이 이 글·댓글을 참조하므로 먼저 지운다. 남겨두면 외래키 때문에
    # 글 삭제 자체가 실패한다
    db.execute(text("DELETE FROM notifications WHERE post_id = :pid"), {"pid": post_id})
    db.execute(text("DELETE FROM stock_post_poll_votes WHERE post_id = :pid"), {"pid": post_id})
    db.execute(text("DELETE FROM stock_comment_likes WHERE comment_id IN (SELECT id FROM stock_comments WHERE post_id = :pid)"), {"pid": post_id})
    db.execute(text("DELETE FROM stock_comments WHERE post_id = :pid"), {"pid": post_id})
    db.execute(text("DELETE FROM stock_post_likes WHERE post_id = :pid"), {"pid": post_id})
    db.delete(post)
    db.commit()
    피드캐시_비우기()   # 지운 글이 목록에 남아 있으면 눌렀을 때 404 다


# ── 게시글 좋아요 ──────────────────────────────────────────────
@router.post("/posts/{post_id}/like")
@limiter.limit("60/minute")
def toggle_post_like(
    request: Request,
    post_id: int = Path(...),
    db:      Session = Depends(get_db),
    current_user=Depends(require_community_active),
):
    post = (
        db.query(StockPost)
        .filter(StockPost.id == post_id, *_POST_VISIBLE)
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
    like_count = post.like_count
    author_id = post.user_id
    try:
        db.commit()
    except IntegrityError:
        # 같은 사람이 같은 글에 두 번 넣으려 했다. (post_id, user_id) 에
        # 유일 제약이 있어 DB 가 막아 준다 — 두 번 눌린 것뿐이니 500 을
        # 낼 일이 아니다. 지금 상태를 다시 읽어 그대로 알려준다.
        db.rollback()
        liked = db.query(StockPostLike).filter(
            StockPostLike.post_id == post_id, StockPostLike.user_id == current_user.id
        ).first() is not None
        like_count = db.query(func.count(StockPostLike.id)).filter(
            StockPostLike.post_id == post_id
        ).scalar() or 0
        return {"liked": liked, "like_count": like_count}
    if liked:
        _notify(db, user_id=author_id, actor_id=current_user.id,
                kind="post_like", post_id=post_id)
    return {"liked": liked, "like_count": like_count}


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
        .filter(StockPost.id == post_id, *_POST_VISIBLE)
        .options(
            defer(StockPost.comment_count),
            defer(StockPost.updated_at),
            selectinload(StockPost.user),
        )
        .first()
    )
    if not post:
        raise HTTPException(404, "게시글을 찾을 수 없습니다")
    # 조회수 증가 (게시글 확인 후)
    try:
        db.execute(text("UPDATE stock_posts SET view_count = COALESCE(view_count, 0) + 1 WHERE id = :id"), {"id": post_id})
        db.commit()
    except Exception:
        db.rollback()
    profile = get_profile(db, post.user_id) if post.user else None
    count_row = db.execute(
        text("SELECT COUNT(*) FROM stock_comments WHERE post_id = :pid AND is_deleted IS NOT TRUE AND is_blinded IS NOT TRUE"),
        {"pid": post_id},
    ).fetchone()
    comment_count = count_row[0] if count_row else 0
    following_ids: set = set()
    if uid and post.user_id != uid:
        is_fol = db.query(UserFollow).filter(
            UserFollow.follower_id == uid, UserFollow.following_id == post.user_id
        ).first()
        if is_fol:
            following_ids.add(post.user_id)
    # 투표 일괄 조회
    gp_poll_votes: dict = {}
    for v in db.query(StockPostPollVote).filter(StockPostPollVote.post_id == post_id).all():
        gp_poll_votes.setdefault(v.post_id, []).append(v)
    return _ser_post(post, uid, db, {post.user_id: profile} if profile else None,
                     {post_id: comment_count}, following_ids, gp_poll_votes,
                     _liked_post_ids(db, uid, [post_id]))


# ── 댓글 목록 ─────────────────────────────────────────────────
@router.get("/posts/{post_id}/comments")
def list_comments(
    post_id: int = Path(...),
    sort:    str = Query(default="latest", pattern="^(latest|popular)$"),
    db:      Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    exists = db.execute(
        text("SELECT 1 FROM stock_posts WHERE id = :pid AND is_deleted IS NOT TRUE AND is_blinded IS NOT TRUE LIMIT 1"),
        {"pid": post_id},
    ).fetchone()
    if not exists:
        raise HTTPException(404, "게시글을 찾을 수 없습니다")
    uid = current_user.id if current_user else None
    order = StockComment.like_count.desc() if sort == "popular" else StockComment.created_at.asc()
    root = (
        db.query(StockComment)
        .filter(
            StockComment.post_id == post_id,
            StockComment.parent_id == None,
            StockComment.is_deleted.isnot(True),
            StockComment.is_blinded.isnot(True),
        )
        .options(
            selectinload(StockComment.user),
            selectinload(StockComment.replies).selectinload(StockComment.user),
        )
        .order_by(order)
        .all()
    )
    # 작성자 프로필과 '내가 누른 좋아요'를 각각 한 번에 가져온다
    all_user_ids: set = set()
    all_comment_ids: list = []
    for c in root:
        all_user_ids.add(c.user_id)
        all_comment_ids.append(c.id)
        for r in c.replies:
            all_user_ids.add(r.user_id)
            all_comment_ids.append(r.id)
    cm_profiles_map: dict = (
        {p.user_id: p for p in db.query(UserProfile).filter(UserProfile.user_id.in_(list(all_user_ids))).all()}
        if all_user_ids else {}
    )
    cm_liked = _liked_comment_ids(db, uid, all_comment_ids)
    return [_ser_comment(c, uid, db, cm_profiles_map, cm_liked) for c in root]


# ── 댓글 작성 ─────────────────────────────────────────────────
@router.post("/posts/{post_id}/comments", status_code=201)
@limiter.limit("20/minute")
def create_comment(
    request: Request,
    body:    CommentCreate,
    post_id: int = Path(...),
    db:      Session = Depends(get_db),
    current_user=Depends(require_community_active),
):
    post = (
        db.query(StockPost)
        .filter(StockPost.id == post_id, *_POST_VISIBLE)
        .options(defer(StockPost.comment_count), defer(StockPost.updated_at))
        .first()
    )
    if not post:
        raise HTTPException(404, "게시글을 찾을 수 없습니다")
    parent = None
    if body.parent_id:
        parent = db.query(StockComment).filter(
            StockComment.id == body.parent_id, StockComment.post_id == post_id,
            *_COMMENT_VISIBLE,
        ).first()
        if not parent:
            raise HTTPException(404, "부모 댓글을 찾을 수 없습니다")
    post_author_id = post.user_id
    parent_author_id = parent.user_id if parent else None
    c = StockComment(post_id=post_id, parent_id=body.parent_id,
                     user_id=current_user.id, content=body.content.strip())
    db.add(c)
    db.commit()
    db.refresh(c)
    uid = current_user.id

    # 답글이면 부모 댓글 작성자에게, 아니면 글쓴이에게 알린다.
    # 답글이 글쓴이의 댓글에 달린 경우 두 번 알리지 않도록 받는 사람을 모아서 처리한다
    if parent_author_id is not None:
        _notify(db, user_id=parent_author_id, actor_id=uid, kind="reply",
                post_id=post_id, comment_id=c.id, preview=c.content)
        if post_author_id != parent_author_id:
            _notify(db, user_id=post_author_id, actor_id=uid, kind="comment",
                    post_id=post_id, comment_id=c.id, preview=c.content)
    else:
        _notify(db, user_id=post_author_id, actor_id=uid, kind="comment",
                post_id=post_id, comment_id=c.id, preview=c.content)

    profile = get_profile(db, uid)
    return {
        "id": c.id, "parent_id": c.parent_id, "user_id": uid,
        "username": display_name(current_user, profile),
        "avatar_color": profile.avatar_color,
        "content": c.content, "like_count": 0, "liked": False,
        "created_at": c.created_at.isoformat(), "is_mine": True, "replies": [],
    }


# ── 댓글 수정 ─────────────────────────────────────────────────
class CommentUpdate(BaseModel):
    content: str
    _content = field_validator("content")(classmethod(lambda cls, v: _check_comment(v)))

@router.put("/comments/{comment_id}")
@limiter.limit("20/minute")
def update_comment(
    request: Request,
    comment_id: int = Path(...),
    payload:    CommentUpdate = Body(...),
    db:         Session = Depends(get_db),
    current_user=Depends(require_community_active),
):
    c = db.query(StockComment).filter(StockComment.id == comment_id).first()
    if not c or c.is_deleted:
        raise HTTPException(404, "댓글을 찾을 수 없습니다")
    if c.user_id != current_user.id and not current_user.is_admin:
        raise HTTPException(403, "수정 권한이 없습니다")
    c.content = payload.content.strip()
    db.commit()
    return {"id": comment_id, "content": c.content}


# ── 댓글 삭제 ─────────────────────────────────────────────────
@router.delete("/comments/{comment_id}", status_code=204)
@limiter.limit("20/minute")
def delete_comment(
    request: Request,
    comment_id: int = Path(...),
    db:         Session = Depends(get_db),
    current_user=Depends(require_community_active),
):
    c = db.query(StockComment).filter(StockComment.id == comment_id).first()
    if not c or c.is_deleted:
        raise HTTPException(404, "댓글을 찾을 수 없습니다")
    if c.user_id != current_user.id and not current_user.is_admin:
        raise HTTPException(403, "삭제 권한이 없습니다")
    # 대댓글 좋아요 → 대댓글 → 댓글 좋아요 순으로 명시적 삭제.
    # 이 댓글과 대댓글을 가리키는 알림도 함께 지운다(외래키)
    db.execute(text("DELETE FROM notifications WHERE comment_id = :cid OR comment_id IN (SELECT id FROM stock_comments WHERE parent_id = :cid)"), {"cid": comment_id})
    db.execute(text("DELETE FROM stock_comment_likes WHERE comment_id IN (SELECT id FROM stock_comments WHERE parent_id = :cid)"), {"cid": comment_id})
    db.execute(text("DELETE FROM stock_comments WHERE parent_id = :cid"), {"cid": comment_id})
    db.execute(text("DELETE FROM stock_comment_likes WHERE comment_id = :cid"), {"cid": comment_id})
    db.delete(c)
    db.commit()


# ── 댓글 좋아요 ───────────────────────────────────────────────
@router.post("/comments/{comment_id}/like")
@limiter.limit("60/minute")
def toggle_comment_like(
    request: Request,
    comment_id: int = Path(...),
    db:         Session = Depends(get_db),
    current_user=Depends(require_community_active),
):
    c = db.query(StockComment).filter(StockComment.id == comment_id, *_COMMENT_VISIBLE).first()
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
    like_count, author_id, post_id, preview = c.like_count, c.user_id, c.post_id, c.content
    db.commit()
    if liked:
        _notify(db, user_id=author_id, actor_id=current_user.id, kind="comment_like",
                post_id=post_id, comment_id=comment_id, preview=preview)
    return {"liked": liked, "like_count": like_count}


# ── 전체 피드 ─────────────────────────────────────────────────
@router.get("/posts/{post_id}/image")
def get_post_image(post_id: int, db: Session = Depends(get_db)):
    """글에 붙은 이미지 한 장.

    목록 응답에서 이미지를 뺐으므로, 카드가 화면에 들어올 때 여기로 따로
    받는다. 브라우저가 캐시하도록 오래 살려 둔다 — 글에 붙은 이미지는
    바뀌지 않는다(수정하면 글이 새로 저장되고 id 도 그대로지만, 이미지를
    바꾸는 기능 자체가 없다).

    본문에는 'data:image/jpeg;base64,...' 형태로 들어 있다. 그대로 문자열로
    돌려주면 브라우저가 또 파싱해야 하므로, 실제 이미지로 디코딩해 보낸다."""
    import base64
    from fastapi.responses import Response

    # 컬럼에 있으면 그것만 읽는다 — 본문(content)을 통째로 끌어올 이유가 없다
    행 = db.query(StockPost.image_mime, StockPost.image_data).filter(
        StockPost.id == post_id,
        StockPost.is_deleted.isnot(True),
        StockPost.is_blinded.isnot(True),
    ).first()
    if 행 is None:
        raise HTTPException(status_code=404, detail="글을 찾을 수 없습니다")
    if 행[1]:
        return Response(content=행[1], media_type=행[0] or "image/jpeg",
                        headers={
                            "Cache-Control": "public, max-age=604800, immutable",
                            # JPEG·PNG 는 이미 압축돼 있다. gzip 은 형식을 안 가리고
                            # level 9 로 한 번 더 눌러서, 줄지도 않는 일에 CPU 0.15개를
                            # 쓴다. Content-Encoding 이 이미 있으면 건너뛴다.
                            "Content-Encoding": "identity",
                        })

    # 여기부터는 아직 컬럼으로 못 옮긴 옛 글. 본문에서 꺼낸다.
    post = db.query(StockPost).filter(StockPost.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="글을 찾을 수 없습니다")

    raw = (decode_content(post.content) or {}).get("image") or ""
    if not raw.startswith("data:image/"):
        raise HTTPException(status_code=404, detail="이미지가 없습니다")
    try:
        머리, 본체 = raw.split(",", 1)
        타입 = 머리.split(";")[0][5:]          # data:image/jpeg;base64 → image/jpeg
        if 타입 not in _SAFE_AVATAR_TYPES:
            raise ValueError(f"허용하지 않는 형식: {타입}")
        바이트 = base64.b64decode(본체, validate=True)
    except Exception:
        # 저장된 값이 깨졌을 때 500 으로 죽이면 그 글이 통째로 안 뜬다
        raise HTTPException(status_code=404, detail="이미지를 읽을 수 없습니다")

    return Response(content=바이트, media_type=타입,
                    headers={
                            "Cache-Control": "public, max-age=604800, immutable",
                            # JPEG·PNG 는 이미 압축돼 있다. gzip 은 형식을 안 가리고
                            # level 9 로 한 번 더 눌러서, 줄지도 않는 일에 CPU 0.15개를
                            # 쓴다. Content-Encoding 이 이미 있으면 건너뛴다.
                            "Content-Encoding": "identity",
                        })


@router.get("/feed")
def get_feed(
    page:      int = Query(1, ge=1),
    limit:     int = Query(20, ge=1, le=50),
    sort:      Literal["latest", "likes"] = Query("latest"),
    market:    Optional[str] = Query(None),
    following: bool = Query(False),
    q:         Optional[str] = Query(None, max_length=_SEARCH_Q_MAX),
    db:        Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    uid = current_user.id if current_user else None
    검색어 = (q or "").strip().lower()

    # ── 캐시 ──
    # 피드 한 번 여는 데 DB 왕복이 최대 7번이다 (전체 개수·글·프로필·
    # 댓글 수·팔로우·좋아요·투표). DB 가 원격이라 왕복마다 지연이 붙고,
    # CPU 0.15개에서는 그게 그대로 체감된다.
    #
    # 그런데 그중 대부분은 '누가 보든 같은' 내용이다. 사람마다 다른 건
    # 좋아요 눌렀는지·내 글인지·팔로우 중인지·어디에 투표했는지 네 가지뿐.
    # 그래서 공통 부분만 캐시하고 개인 항목은 꺼낸 뒤 덧칠한다.
    #
    # '팔로잉만 보기'는 애초에 사람마다 목록이 달라 캐시하지 않는다.
    # 검색 결과도 '누가 보든 같은' 내용이라 캐시가 그대로 먹는다. 다만
    # 검색어마다 칸이 따로 생기므로, 키에 검색어를 넣되 길이를 이미 막아 뒀다
    캐시키 = (None if (following and uid)
              else f"feed:{sort}:{market or 'ALL'}:{page}:{limit}:{검색어}")
    공통 = cache.get(캐시키) if 캐시키 else None
    if 공통 is not None:
        return _개인화(db, uid, 공통)

    질의 = db.query(StockPost).filter(StockPost.is_deleted.isnot(True), StockPost.is_blinded.isnot(True))

    if following and uid:
        followed_ids = [
            r[0] for r in db.query(UserFollow.following_id).filter(UserFollow.follower_id == uid).all()
        ]
        if followed_ids:
            질의 = 질의.filter(StockPost.user_id.in_(followed_ids))
        else:
            return {"total": 0, "page": page, "items": []}

    if market and market in ("KR", "US", "ETF"):
        질의 = 질의.filter(StockPost.market == market)
    if 검색어:
        # LIKE 의 와일드카드를 검색어에 그대로 두면 "%" 한 글자로 전체가
        # 걸린다. 이스케이프하고 escape 문자를 명시한다 (DB 기본값이 다르다)
        패턴 = "%" + 검색어.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        질의 = 질의.filter(StockPost.search_text.like(패턴, escape="\\"))
    total = 질의.count()
    if sort == "likes":
        질의 = 질의.order_by(StockPost.like_count.desc(), StockPost.created_at.desc())
    else:
        질의 = 질의.order_by(StockPost.created_at.desc())
    posts = (
        질의.options(
            defer(StockPost.comment_count),
            defer(StockPost.updated_at),
            # 이미지를 안 읽는 것이 목록 속도의 핵심이다. 응답에서만 빼면
            # SELECT 는 여전히 이미지를 통째로 끌어온다.
            defer(StockPost.image_data),
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
        feed_comment_counts = _댓글수(db, post_ids)
    # 투표 일괄 조회 (N+1 방지)
    feed_poll_votes: dict = {}
    if post_ids:
        for v in db.query(StockPostPollVote).filter(StockPostPollVote.post_id.in_(post_ids)).all():
            feed_poll_votes.setdefault(v.post_id, []).append(v)

    # 공통 부분만 만든다 — uid 를 넘기지 않으므로 개인 항목은 전부 비어 있다
    공통 = {"total": total, "page": page, "items": [
        _ser_post(p, None, db, profiles_map, feed_comment_counts, set(), feed_poll_votes, set(),
                  이미지빼기=True)
        for p in posts
    ]}
    if 캐시키:
        cache.set(캐시키, 공통, FEED_TTL)
    return _개인화(db, uid, 공통)


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
        "avatar_url":   p.avatar_url,
    }


@router.put("/profile/me")
@limiter.limit("10/minute")
def update_my_profile(
    request: Request,
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
    if body.avatar_url is not None:
        _validate_uploaded_image(body.avatar_url, "프로필 사진")
        p.avatar_url = body.avatar_url or None
    db.commit()
    return {
        "user_id":      current_user.id,
        "username":     current_user.username,
        "nickname":     p.nickname,
        "avatar_color": p.avatar_color,
        "bio":          p.bio,
        "avatar_url":   p.avatar_url,
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
        "avatar_url":   p.avatar_url if p else None,
    }


# ── 투표 ─────────────────────────────────────────────────────
@router.post("/posts/{post_id}/poll/vote")
@limiter.limit("30/minute")
def vote_poll(
    request: Request,
    post_id: int = Path(...),
    option_index: int = Body(..., embed=True),
    db: Session = Depends(get_db),
    current_user=Depends(require_community_active),
):
    post = (
        db.query(StockPost)
        .filter(StockPost.id == post_id, *_POST_VISIBLE)
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
@limiter.limit("30/minute")
def toggle_follow(
    request: Request,
    user_id: int = Path(...),
    db: Session = Depends(get_db),
    current_user=Depends(require_community_active),
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
        _notify(db, user_id=user_id, actor_id=current_user.id, kind="follow")
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
    # COUNT 4번 → 단일 SQL로 통합
    me_id = current_user.id if current_user else 0
    stat_row = db.execute(text("""
        SELECT
            (SELECT COUNT(*) FROM user_follows WHERE following_id = :uid) AS follower_count,
            (SELECT COUNT(*) FROM user_follows WHERE follower_id  = :uid) AS following_count,
            (SELECT COUNT(*) FROM stock_posts  WHERE user_id = :uid AND is_deleted IS NOT TRUE AND is_blinded IS NOT TRUE) AS post_count,
            (SELECT 1 FROM user_follows WHERE follower_id = :me AND following_id = :uid LIMIT 1) AS is_following
    """), {"uid": user_id, "me": me_id}).fetchone()
    follower_count  = stat_row[0] or 0
    following_count = stat_row[1] or 0
    post_count      = stat_row[2] or 0
    is_following    = bool(stat_row[3]) if current_user else False
    is_me = current_user.id == user_id if current_user else False
    return {
        "user_id":        user.id,
        "username":       user.username,
        "nickname":       p.nickname if p else None,
        "avatar_color":   p.avatar_color if p else 0,
        "avatar_url":     p.avatar_url if p else None,
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
        .filter(StockPost.user_id == user_id, *_POST_VISIBLE)
        .options(defer(StockPost.comment_count), defer(StockPost.updated_at))
        .order_by(StockPost.created_at.desc())
        .limit(10)
        .all()
    )
    comments = db.query(StockComment).filter(
        StockComment.user_id == user_id, *_COMMENT_VISIBLE
    ).order_by(StockComment.created_at.desc()).limit(10).all()
    act_post_ids = [p.id for p in posts]
    act_comment_counts: dict = {}
    if act_post_ids:
        act_comment_counts = _댓글수(db, act_post_ids)
    post_items = []
    for p in posts:
        parsed = decode_content(p.content)
        post_items.append({
            "type": "post",
            "id": p.id,
            "symbol": p.symbol,
            "market": p.market,
            "title": parsed["title"],
            "body": parsed["body"],
            "like_count": getattr(p, "like_count", 0) or 0,
            "comment_count": act_comment_counts.get(p.id, 0),
            "created_at": p.created_at.isoformat(),
        })
    comment_post_ids = [c.post_id for c in comments]
    post_meta: dict = {}
    if comment_post_ids:
        meta_rows = db.query(StockPost.id, StockPost.symbol, StockPost.market).filter(
            StockPost.id.in_(comment_post_ids),
            *_POST_VISIBLE,
        ).all()
        post_meta = {r[0]: (r[1], r[2]) for r in meta_rows}

    # 부모 글이 삭제·블라인드됐거나 존재하지 않는 댓글은 제외
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
    follower_ids = [r[0] for r in db.query(UserFollow.follower_id).filter(UserFollow.following_id == user_id).all()]
    if not follower_ids:
        return []
    users    = {u.id: u for u in db.query(User).filter(User.id.in_(follower_ids), User.is_active == True).all()}
    profiles = {p.user_id: p for p in db.query(UserProfile).filter(UserProfile.user_id.in_(follower_ids)).all()}
    return [
        {
            "user_id":      uid,
            "username":     users[uid].username,
            "nickname":     profiles[uid].nickname if uid in profiles else None,
            "avatar_color": profiles[uid].avatar_color if uid in profiles else 0,
        }
        for uid in follower_ids if uid in users
    ]


@router.get("/users/{user_id}/following")
def get_following(user_id: int = Path(...), db: Session = Depends(get_db)):
    following_ids = [r[0] for r in db.query(UserFollow.following_id).filter(UserFollow.follower_id == user_id).all()]
    if not following_ids:
        return []
    users    = {u.id: u for u in db.query(User).filter(User.id.in_(following_ids), User.is_active == True).all()}
    profiles = {p.user_id: p for p in db.query(UserProfile).filter(UserProfile.user_id.in_(following_ids)).all()}
    return [
        {
            "user_id":      uid,
            "username":     users[uid].username,
            "nickname":     profiles[uid].nickname if uid in profiles else None,
            "avatar_color": profiles[uid].avatar_color if uid in profiles else 0,
        }
        for uid in following_ids if uid in users
    ]


# ── 알림 ─────────────────────────────────────────────────────────────────────
#
# 목록은 자주 열리지 않지만 '안 읽은 개수'는 화면에 종이 떠 있는 내내 주기적으로
# 물어보게 된다. 그래서 개수는 COUNT 한 번만 하는 별도 엔드포인트로 분리하고,
# 사람이 셀 수 있는 수준을 넘어가면 굳이 정확한 수를 세지 않는다.
_NOTI_COUNT_CAP = 99
_NOTI_PAGE_SIZE = 30


class NotificationSettingsIn(BaseModel):
    """켜진 종류만 받는다. 화면의 스위치와 그대로 대응한다."""
    model_config = ConfigDict(extra="ignore")
    comment:      bool = True
    reply:        bool = True
    post_like:    bool = True
    comment_like: bool = True
    follow:       bool = True


@router.get("/notifications/settings")
def get_notification_settings(
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    off = _disabled_kinds(db, current_user.id)
    return {k: k not in off for k in _NOTI_KINDS}


@router.put("/notifications/settings")
@limiter.limit("30/minute")
def update_notification_settings(
    request: Request,
    body: NotificationSettingsIn,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    p = get_profile(db, current_user.id)
    if not p:
        raise HTTPException(500, "설정을 저장하지 못했습니다")
    off = [k for k in _NOTI_KINDS if not getattr(body, k)]
    p.noti_disabled = ",".join(off) or None
    db.commit()
    return {k: k not in off for k in _NOTI_KINDS}


@router.get("/notifications/unread-count")
def get_unread_notification_count(
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    row = db.execute(text("""
        SELECT COUNT(*) FROM (
            SELECT 1 FROM notifications
            WHERE user_id = :uid AND is_read IS NOT TRUE
            LIMIT :cap
        ) t
    """), {"uid": current_user.id, "cap": _NOTI_COUNT_CAP + 1}).fetchone()
    n = row[0] if row else 0
    return {"count": min(n, _NOTI_COUNT_CAP), "capped": n > _NOTI_COUNT_CAP}


@router.get("/notifications")
def list_notifications(
    page: int = Query(1, ge=1),
    db:   Session = Depends(get_db),
    current_user=Depends(require_user),
):
    rows = (
        db.query(Notification)
        .filter(Notification.user_id == current_user.id)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .offset((page - 1) * _NOTI_PAGE_SIZE)
        .limit(_NOTI_PAGE_SIZE)
        .all()
    )
    # 보낸 사람 이름·사진을 한 번에 가져온다 (알림마다 조회하면 30번이 된다)
    actor_ids = list({r.actor_id for r in rows if r.actor_id})
    actors   = {u.id: u for u in db.query(User).filter(User.id.in_(actor_ids)).all()} if actor_ids else {}
    profiles = ({p.user_id: p for p in db.query(UserProfile).filter(UserProfile.user_id.in_(actor_ids)).all()}
                if actor_ids else {})
    return {"items": [{
        "id":           r.id,
        "kind":         r.kind,
        "post_id":      r.post_id,
        "comment_id":   r.comment_id,
        "preview":      r.preview,
        "is_read":      bool(r.is_read),
        "created_at":   r.created_at.isoformat() if r.created_at else "",
        "actor_id":     r.actor_id,
        "actor_name":   display_name(actors.get(r.actor_id), profiles.get(r.actor_id)),
        "actor_color":  profiles[r.actor_id].avatar_color if r.actor_id in profiles else 0,
        "actor_avatar": profiles[r.actor_id].avatar_url if r.actor_id in profiles else None,
    } for r in rows]}


@router.post("/notifications/read-all")
@limiter.limit("30/minute")
def mark_all_notifications_read(
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    db.execute(
        text("UPDATE notifications SET is_read = true WHERE user_id = :uid AND is_read IS NOT TRUE"),
        {"uid": current_user.id},
    )
    db.commit()
    return {"ok": True}


@router.post("/notifications/{noti_id}/read")
@limiter.limit("120/minute")
def mark_notification_read(
    request: Request,
    noti_id: int = Path(...),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    # user_id 조건이 없으면 남의 알림도 읽음 처리할 수 있다
    result = db.execute(
        text("UPDATE notifications SET is_read = true WHERE id = :id AND user_id = :uid"),
        {"id": noti_id, "uid": current_user.id},
    )
    db.commit()
    if result.rowcount == 0:
        raise HTTPException(404, "알림을 찾을 수 없습니다")
    return {"ok": True}


# ── 신고 ─────────────────────────────────────────────────────────────────────

class ReportIn(BaseModel):
    reason: str = Field(..., min_length=1, max_length=200)


@router.post("/posts/{post_id}/report", status_code=201)
@limiter.limit("20/hour")
def report_post(
    request: Request,
    post_id: int = Path(...),
    body: ReportIn = Body(...),
    db: Session = Depends(get_db),
    current: User = Depends(require_community_active),
):
    """게시글 신고"""
    post = db.query(StockPost).filter(StockPost.id == post_id, StockPost.is_deleted.isnot(True)).first()
    if not post:
        raise HTTPException(404, "게시글을 찾을 수 없습니다")
    existing = db.query(Report).filter(Report.reporter_id == current.id, Report.post_id == post_id).first()
    if existing:
        raise HTTPException(409, "이미 신고한 게시글입니다")
    report = Report(reporter_id=current.id, post_id=post_id, reason=body.reason)
    db.add(report)
    db.commit()
    return {"message": "신고가 접수되었습니다"}


@router.post("/comments/{comment_id}/report", status_code=201)
@limiter.limit("20/hour")
def report_comment(
    request: Request,
    comment_id: int = Path(...),
    body: ReportIn = Body(...),
    db: Session = Depends(get_db),
    current: User = Depends(require_community_active),
):
    """댓글 신고"""
    comment = db.query(StockComment).filter(StockComment.id == comment_id, StockComment.is_deleted.isnot(True)).first()
    if not comment:
        raise HTTPException(404, "댓글을 찾을 수 없습니다")
    existing = db.query(Report).filter(Report.reporter_id == current.id, Report.comment_id == comment_id).first()
    if existing:
        raise HTTPException(409, "이미 신고한 댓글입니다")
    report = Report(reporter_id=current.id, comment_id=comment_id, reason=body.reason)
    db.add(report)
    db.commit()
    return {"message": "신고가 접수되었습니다"}
