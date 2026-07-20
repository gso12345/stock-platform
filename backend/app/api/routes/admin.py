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
def get_users(
    status: str = Query(default="all", pattern="^(all|active|inactive)$"),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    q = db.query(User).order_by(User.id.desc())
    if status == "active":
        q = q.filter(User.is_active == True)
    elif status == "inactive":
        q = q.filter(User.is_active == False)
    users = q.all()
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


# ── 팝업 관리 ──────────────────────────────────────────────────────────────────

def _popup_dict(p) -> dict:
    return {
        "id":         p.id,
        "popup_type": p.popup_type,
        "title":      p.title,
        "content":    p.content,
        "link_url":   p.link_url,
        "link_text":  p.link_text,
        "bg_color":   p.bg_color,
        "is_active":  p.is_active,
        "starts_at":  p.starts_at.isoformat() if p.starts_at else None,
        "ends_at":    p.ends_at.isoformat() if p.ends_at else None,
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


@router.get("/popups/active")
def get_active_popups(db: Session = Depends(get_db)):
    """현재 노출 중인 팝업 목록 (인증 불필요 — 프론트엔드 레이아웃에서 호출)"""
    from app.models.community import SitePopup
    now = datetime.now(timezone.utc)
    popups = (
        db.query(SitePopup)
        .filter(
            SitePopup.is_active == True,
            (SitePopup.starts_at == None) | (SitePopup.starts_at <= now),
            (SitePopup.ends_at == None) | (SitePopup.ends_at >= now),
        )
        .order_by(SitePopup.id.desc())
        .all()
    )
    return [_popup_dict(p) for p in popups]


@router.get("/popups")
def list_popups(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    from app.models.community import SitePopup
    popups = db.query(SitePopup).order_by(SitePopup.id.desc()).all()
    return [_popup_dict(p) for p in popups]


@router.post("/popups", status_code=201)
def create_popup(body: dict, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    from app.models.community import SitePopup
    popup = SitePopup(
        popup_type=body.get("popup_type", "info")[:20],
        title=(body.get("title") or "")[:200],
        content=body.get("content"),
        link_url=body.get("link_url"),
        link_text=body.get("link_text"),
        bg_color=(body.get("bg_color") or "blue")[:20],
        is_active=bool(body.get("is_active", True)),
        starts_at=body.get("starts_at"),
        ends_at=body.get("ends_at"),
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return _popup_dict(popup)


@router.put("/popups/{popup_id}")
def update_popup(
    popup_id: int,
    body: dict,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    from app.models.community import SitePopup
    popup = db.query(SitePopup).filter(SitePopup.id == popup_id).first()
    if not popup:
        raise HTTPException(404, "팝업을 찾을 수 없습니다")
    for field, max_len in [("popup_type", 20), ("title", 200), ("bg_color", 20)]:
        if field in body:
            setattr(popup, field, str(body[field])[:max_len])
    for field in ("content", "link_url", "link_text", "starts_at", "ends_at"):
        if field in body:
            setattr(popup, field, body[field])
    if "is_active" in body:
        popup.is_active = bool(body["is_active"])
    db.commit()
    db.refresh(popup)
    return _popup_dict(popup)


@router.delete("/popups/{popup_id}", status_code=204)
def delete_popup(popup_id: int, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    from app.models.community import SitePopup
    popup = db.query(SitePopup).filter(SitePopup.id == popup_id).first()
    if not popup:
        raise HTTPException(404, "팝업을 찾을 수 없습니다")
    db.delete(popup)
    db.commit()


# ── 신고 관리 ─────────────────────────────────────────────────────────────────

@router.get("/reports")
def list_reports(
    status: str = Query(default="pending", pattern="^(pending|resolved|dismissed|all)$"),
    page:  int  = Query(1, ge=1),
    limit: int  = Query(20, ge=1, le=50),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    from app.models.community import Report, StockPost, StockComment
    q = db.query(Report)
    if status != "all":
        q = q.filter(Report.status == status)
    total = q.count()
    reports = q.order_by(Report.created_at.desc()).offset((page - 1) * limit).limit(limit).all()
    result = []
    for r in reports:
        post_title = None
        comment_preview = None
        if r.post_id:
            post = db.query(StockPost).filter(StockPost.id == r.post_id).first()
            if post:
                try:
                    cd = json.loads(post.content)
                    post_title = cd.get("title", "")[:100]
                except Exception:
                    post_title = str(post.content)[:100]
        if r.comment_id:
            comment = db.query(StockComment).filter(StockComment.id == r.comment_id).first()
            if comment:
                comment_preview = str(comment.content)[:100]
        result.append({
            "id":              r.id,
            "reporter_id":     r.reporter_id,
            "reporter":        r.reporter.username if r.reporter else "—",
            "post_id":         r.post_id,
            "comment_id":      r.comment_id,
            "post_title":      post_title,
            "comment_preview": comment_preview,
            "reason":          r.reason,
            "status":          r.status,
            "created_at":      r.created_at.isoformat() if r.created_at else None,
        })
    return {"total": total, "items": result}


@router.patch("/reports/{report_id}/blind")
def blind_content(report_id: int, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    """신고된 게시글 또는 댓글을 블라인드 처리"""
    from app.models.community import Report, StockPost, StockComment
    report = db.query(Report).filter(Report.id == report_id).first()
    if not report:
        raise HTTPException(404, "신고를 찾을 수 없습니다")
    if report.post_id:
        post = db.query(StockPost).filter(StockPost.id == report.post_id).first()
        if post:
            post.is_blinded = True
    if report.comment_id:
        comment = db.query(StockComment).filter(StockComment.id == report.comment_id).first()
        if comment:
            comment.is_blinded = True
    report.status = "resolved"
    db.commit()
    return {"message": "블라인드 처리 완료", "report_id": report_id}


@router.patch("/reports/{report_id}/dismiss")
def dismiss_report(report_id: int, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    """신고 기각"""
    from app.models.community import Report
    report = db.query(Report).filter(Report.id == report_id).first()
    if not report:
        raise HTTPException(404, "신고를 찾을 수 없습니다")
    report.status = "dismissed"
    db.commit()
    return {"message": "신고 기각 완료", "report_id": report_id}


@router.delete("/reports/{report_id}/content", status_code=204)
def delete_reported_content(report_id: int, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    """신고된 게시글 또는 댓글을 삭제 처리"""
    from app.models.community import Report, StockPost, StockComment
    report = db.query(Report).filter(Report.id == report_id).first()
    if not report:
        raise HTTPException(404, "신고를 찾을 수 없습니다")
    if report.post_id:
        post = db.query(StockPost).filter(StockPost.id == report.post_id).first()
        if post:
            post.is_deleted = True
    if report.comment_id:
        comment = db.query(StockComment).filter(StockComment.id == report.comment_id).first()
        if comment:
            comment.is_deleted = True
    report.status = "resolved"
    db.commit()


# ── 트렌드 / 사용 통계 ──────────────────────────────────────────────────────────

@router.get("/search-trends")
def get_search_trends(_: User = Depends(require_admin)):
    """검색어 트렌드 TOP 20 (인메모리, 서버 재시작 시 초기화)"""
    from app.core.trends import get_search_trends as _trends
    return _trends(top_n=20)


@router.get("/usage-stats")
def get_usage_stats(_: User = Depends(require_admin)):
    """기능별 사용 통계 (인메모리, 서버 재시작 시 초기화)"""
    from app.core.trends import get_usage_stats as _stats
    return _stats()
