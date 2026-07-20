from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.core.security import decode_token
from app.db.database import get_db
from app.models.user import User

bearer = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
    db: Session = Depends(get_db),
) -> User | None:
    """Bearer 토큰이 유효하면 User 반환, 없거나 유효하지 않으면 None"""
    if not credentials:
        return None
    data = decode_token(credentials.credentials)
    if not data:
        return None
    user_id = data.get("sub")
    if not user_id:
        return None
    try:
        user = db.query(User).filter(User.id == int(user_id)).first()
    except (ValueError, TypeError):
        return None
    return user


def require_user(user: User | None = Depends(get_current_user)) -> User:
    """로그인 필수 엔드포인트용 — 미인증 시 401 반환"""
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="로그인이 필요합니다",
        )
    return user


def require_community_active(user: User = Depends(require_user)) -> User:
    """커뮤니티 쓰기 전용 — 커뮤니티 차단된 계정은 403 반환"""
    if getattr(user, "is_community_banned", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="커뮤니티 이용이 제한된 계정입니다",
        )
    return user
