"""관리자 전용 API"""
import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
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
    from app.models.stock import Portfolio
    total_users    = db.query(func.count(User.id)).scalar() or 0
    active_users   = db.query(func.count(User.id)).filter(User.is_active == True).scalar() or 0
    watchlist_cnt  = db.query(func.count(WatchlistItem.id)).scalar() or 0
    portfolio_cnt  = db.query(func.count(Portfolio.id)).scalar() or 0
    return {
        "total_users":     total_users,
        "active_users":    active_users,
        "watchlist_items": watchlist_cnt,
        "portfolio_items": portfolio_cnt,
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
