"""관리자 전용 API"""
import logging
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


@router.get("/stats")
def get_stats(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    """전체 통계"""
    total_users   = db.query(func.count(User.id)).scalar() or 0
    active_users  = db.query(func.count(User.id)).filter(User.is_active == True).scalar() or 0
    watchlist_cnt = db.query(func.count(WatchlistItem.id)).scalar() or 0
    portfolio_cnt = db.query(func.count(PortfolioItem.id)).scalar() or 0
    return {
        "total_users":   total_users,
        "active_users":  active_users,
        "watchlist_items": watchlist_cnt,
        "portfolio_items": portfolio_cnt,
    }


@router.get("/users")
def get_users(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    """전체 유저 목록"""
    users = db.query(User).order_by(User.id.desc()).all()
    return [
        {
            "id": u.id,
            "username": u.username,
            "email": u.email,
            "is_active": u.is_active,
            "is_admin": u.is_admin,
            "created_at": str(u.created_at) if u.created_at else None,
        }
        for u in users
    ]


@router.patch("/users/{user_id}/active")
def toggle_active(user_id: int, db: Session = Depends(get_db), current: User = Depends(require_admin)):
    """유저 활성/비활성 토글"""
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
    """유저 삭제"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")
    if user.id == current.id:
        raise HTTPException(status_code=400, detail="자신의 계정은 삭제할 수 없습니다")
    db.delete(user)
    db.commit()
    return {"message": "삭제 완료"}


@router.get("/announcement")
def get_announcement():
    """현재 공지사항 조회 (비로그인도 가능)"""
    try:
        with engine.connect() as conn:
            row = conn.execute(text("SELECT value FROM system_settings WHERE key = 'announcement'")).fetchone()
            return {"text": row[0] if row else ""}
    except Exception:
        return {"text": ""}


@router.post("/announcement")
def set_announcement(body: dict, _: User = Depends(require_admin)):
    """공지사항 저장"""
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
