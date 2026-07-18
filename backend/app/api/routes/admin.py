"""관리자 전용 API"""
import json
import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy.orm import Session, defer, selectinload
from sqlalchemy import text, func
from app.core.deps import require_user
from app.db.database import get_db, engine
from app.models.user import User
from app.models.stock import WatchlistItem, PortfolioItem

log = logging.getLogger(__name__)
router = APIRouter(prefix="/admin", tags=["관리자"])


def require_admin(current_user: User = Depends(require_user)):
    if not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="관리자 권한이 필요합니다")
    return current_user


# ── 통계 ────────────────────────────────────────────────────────────────────

@router.get("/stats")
def get_stats(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    from app.models.stock import Portfolio, WatchlistFolder
    from app.models.community import StockPost, StockComment
    from app.core.activity import online_count, today_visitor_count
    total_users       = db.query(func.count(User.id)).scalar() or 0
    active_users      = db.query(func.count(User.id)).filter(User.is_active == True).scalar() or 0
    watchlist_cnt     = db.query(func.count(WatchlistItem.id)).scalar() or 0
    portfolio_cnt     = db.query(func.count(Portfolio.id)).scalar() or 0
    folder_cnt        = db.query(func.count(WatchlistFolder.id)).scalar() or 0
    post_cnt          = db.query(func.count(StockPost.id)).filter(StockPost.is_deleted.isnot(True)).scalar() or 0
    comment_cnt       = db.query(func.count(StockComment.id)).filter(StockComment.is_deleted.isnot(True)).scalar() or 0
    return {
        "total_users":       total_users,
        "active_users":      active_users,
        "watchlist_items":   watchlist_cnt,
        "portfolio_items":   portfolio_cnt,
        "watchlist_folders": folder_cnt,
        "online_users":      online_count(),
        "today_visitors":    today_visitor_count(),
        "total_posts":       post_cnt,
        "total_comments":    comment_cnt,
    }


@router.get("/popular-stocks")
def get_popular_stocks(
    basis: str = "watchlist",
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """인기 종목 TOP 10 — basis: watchlist(관심종목) | portfolio(보유종목)"""
    if basis == "portfolio":
        rows = (
            db.query(
                PortfolioItem.symbol,
                PortfolioItem.name,
                PortfolioItem.market,
                func.count(PortfolioItem.id).label("cnt"),
            )
            .group_by(PortfolioItem.symbol, PortfolioItem.name, PortfolioItem.market)
            .order_by(func.count(PortfolioItem.id).desc())
            .limit(10)
            .all()
        )
    else:
        rows = (
            db.query(
                WatchlistItem.symbol,
                WatchlistItem.name,
                WatchlistItem.market,
                func.count(WatchlistItem.id).label("cnt"),
            )
            .group_by(WatchlistItem.symbol, WatchlistItem.name, WatchlistItem.market)
            .order_by(func.count(WatchlistItem.id).desc())
            .limit(10)
            .all()
        )
    return [{"symbol": r.symbol, "name": r.name or r.symbol, "market": r.market, "count": r.cnt} for r in rows]


@router.get("/visitor-trend")
def get_visitor_trend(_: User = Depends(require_admin)):
    """최근 30일 일별 방문자 수"""
    from app.core.activity import get_visitor_trend
    return get_visitor_trend(30)


@router.get("/signups")
def get_signups(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    """최근 30일 일별 가입자 수"""
    cutoff = datetime.now(timezone.utc) - timedelta(days=29)
    users = db.query(User.created_at).filter(User.created_at >= cutoff).all()

    daily: dict[str, int] = defaultdict(int)
    for (created_at,) in users:
        if created_at:
            try:
                dt = created_at if created_at.tzinfo else created_at.replace(tzinfo=timezone.utc)
                daily[dt.strftime("%Y-%m-%d")] += 1
            except Exception:
                pass

    result = []
    for i in range(29, -1, -1):
        day = (datetime.now(timezone.utc) - timedelta(days=i)).strftime("%Y-%m-%d")
        result.append({"date": day, "count": daily.get(day, 0)})
    return result


@router.get("/db-stats")
def get_db_stats(_: User = Depends(require_admin)):
    """PostgreSQL DB 용량 현황"""
    try:
        with engine.connect() as conn:
            size_row = conn.execute(text(
                "SELECT pg_database_size(current_database()), "
                "pg_size_pretty(pg_database_size(current_database()))"
            )).fetchone()

            table_rows = conn.execute(text("""
                SELECT
                    tablename,
                    pg_total_relation_size(quote_ident(tablename)) AS bytes,
                    pg_size_pretty(pg_total_relation_size(quote_ident(tablename))) AS pretty
                FROM pg_tables
                WHERE schemaname = 'public'
                ORDER BY pg_total_relation_size(quote_ident(tablename)) DESC
                LIMIT 8
            """)).fetchall()

        return {
            "total_bytes":  size_row[0],
            "total_pretty": size_row[1],
            "tables": [{"name": r[0], "bytes": r[1], "pretty": r[2]} for r in table_rows],
        }
    except Exception as e:
        raise HTTPException(500, f"DB 통계 조회 실패: {str(e)[:200]}")


@router.get("/system")
def get_system(_: User = Depends(require_admin)):
    """시스템 상태"""
    from app.core.cache import cache

    db_ok = True
    db_latency_ms = 0
    try:
        import time
        t0 = time.perf_counter()
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        db_latency_ms = round((time.perf_counter() - t0) * 1000, 1)
    except Exception:
        db_ok = False

    return {
        "db_ok":         db_ok,
        "db_latency_ms": db_latency_ms,
        "cache_size":    cache.size(),
        "server_time":   datetime.now(timezone.utc).isoformat(),
    }


@router.post("/cache/clear")
def clear_cache(_: User = Depends(require_admin)):
    """인메모리 캐시 전체 초기화"""
    from app.core.cache import cache
    size_before = cache.size()
    cache.clear()
    log.info(f"관리자가 캐시 초기화: {size_before}건 삭제")
    return {"cleared": size_before}


@router.get("/cache")
def list_cache(prefix: str = "", _: User = Depends(require_admin)):
    """인메모리 캐시 키 전체 목록 (prefix로 필터링 가능)"""
    from app.core.cache import cache
    items = cache.keys_with_ttl()
    if prefix:
        items = [i for i in items if i["key"].startswith(prefix)]
    return {"count": len(items), "items": items}


@router.delete("/cache/{key:path}")
def delete_cache_key(key: str, _: User = Depends(require_admin)):
    """특정 캐시 키 삭제"""
    from app.core.cache import cache
    cache.delete(key)
    log.info(f"관리자가 캐시 키 삭제: {key}")
    return {"deleted": key}


@router.delete("/cache")
def delete_cache_prefix(prefix: str, _: User = Depends(require_admin)):
    """prefix로 시작하는 캐시 키 일괄 삭제"""
    from app.core.cache import cache
    count = cache.delete_pattern(prefix)
    log.info(f"관리자가 캐시 prefix 삭제: {prefix} → {count}건")
    return {"deleted_count": count, "prefix": prefix}


# ── 유저 관리 ────────────────────────────────────────────────────────────────

@router.get("/users")
def get_users(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    users = db.query(User).order_by(User.id.desc()).all()
    return [
        {
            "id":         u.id,
            "username":   u.username,
            "email":      u.email,
            "is_active":  u.is_active,
            "is_admin":   u.is_admin,
            "created_at": str(u.created_at) if u.created_at else None,
        }
        for u in users
    ]


@router.patch("/users/{user_id}/active")
def toggle_active(user_id: int, db: Session = Depends(get_db), current: User = Depends(require_admin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")
    if user.id == current.id:
        raise HTTPException(status_code=400, detail="자신의 계정은 변경할 수 없습니다")
    user.is_active = not user.is_active
    db.commit()
    return {"id": user.id, "is_active": user.is_active}


@router.delete("/users/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db), current: User = Depends(require_admin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")
    if user.id == current.id:
        raise HTTPException(status_code=400, detail="자신의 계정은 삭제할 수 없습니다")
    db.delete(user)
    db.commit()
    return {"message": "삭제 완료"}


# ── 커뮤니티 관리 ────────────────────────────────────────────────────────────

@router.get("/community/posts")
def admin_list_posts(
    page:   int           = Query(1, ge=1),
    limit:  int           = Query(20, ge=1, le=50),
    market: Optional[str] = Query(None),
    db:     Session       = Depends(get_db),
    _:      User          = Depends(require_admin),
):
    from app.models.community import StockPost
    q = db.query(StockPost).filter(StockPost.is_deleted.isnot(True))
    if market and market in ("KR", "US", "ETF"):
        q = q.filter(StockPost.market == market)
    total = q.count()
    posts = (
        q.options(
            defer(StockPost.comment_count),
            defer(StockPost.updated_at),
            selectinload(StockPost.user),
        )
        .order_by(StockPost.created_at.desc())
        .offset((page - 1) * limit)
        .limit(limit)
        .all()
    )
    result = []
    for p in posts:
        try:
            cd = json.loads(p.content)
            title = cd.get("title", "")[:200]
            body  = cd.get("body",  "")[:200]
        except Exception:
            title = ""
            body  = str(p.content)[:200]
        result.append({
            "id":         p.id,
            "symbol":     p.symbol,
            "market":     p.market,
            "user_id":    p.user_id,
            "username":   p.user.username if p.user else "—",
            "title":      title,
            "body":       body,
            "like_count": getattr(p, "like_count", 0) or 0,
            "created_at": p.created_at.isoformat(),
        })
    return {"total": total, "items": result}


@router.delete("/community/posts/{post_id}", status_code=204)
def admin_delete_post(
    post_id: int     = Path(...),
    db:      Session = Depends(get_db),
    _:       User    = Depends(require_admin),
):
    from app.models.community import StockPost
    post = (
        db.query(StockPost)
        .filter(StockPost.id == post_id)
        .options(defer(StockPost.comment_count), defer(StockPost.updated_at))
        .first()
    )
    if not post:
        raise HTTPException(404, "게시글을 찾을 수 없습니다")
    db.execute(text("DELETE FROM stock_post_poll_votes WHERE post_id = :pid"), {"pid": post_id})
    db.delete(post)
    db.commit()
    log.info(f"관리자가 게시글 삭제: post_id={post_id}")


# ── 공지사항 ──────────────────────────────────────────────────────────────────

@router.get("/announcement")
def get_announcement():
    try:
        with engine.connect() as conn:
            row = conn.execute(text("SELECT value FROM system_settings WHERE key = 'announcement'")).fetchone()
            return {"text": row[0] if row else ""}
    except Exception:
        return {"text": ""}


@router.post("/announcement")
def set_announcement(body: dict, _: User = Depends(require_admin)):
    text_val = (body.get("text") or "")[:500]
    try:
        with engine.connect() as conn:
            conn.execute(
                text("INSERT INTO system_settings (key, value) VALUES ('announcement', :v) ON CONFLICT (key) DO UPDATE SET value = :v"),
                {"v": text_val},
            )
            conn.commit()
        return {"text": text_val}
    except Exception as e:
        log.error(f"공지사항 저장 실패: {e}")
        raise HTTPException(status_code=500, detail="저장 실패")
