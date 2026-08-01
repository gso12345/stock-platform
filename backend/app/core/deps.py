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
    """토큰이 없으면 None(비로그인), 토큰이 있는데 못 쓰면 401.

    '토큰 없음'과 '토큰이 잘못됨'을 구분하는 것이 핵심이다.

    예전에는 둘 다 None 을 돌려줬다. 그러면 로그인 상태를 화면에 들고 있는
    사용자가 만료된 토큰으로 관심종목을 부를 때, 서버는 게스트(user_id=None)
    목록을 200 으로 돌려준다 — 즉 빈 목록이다. 브라우저는 여전히 로그인한
    것처럼 보이므로, 사용자 눈에는 '내 종목이 전부 사라졌다'로 읽힌다.
    실제 데이터는 DB 에 그대로 있는데도 그렇다.

    401 을 돌려주면 프런트의 인터셉터가 토큰을 지우고 로그인 화면으로
    보낸다. 다시 로그인하면 데이터가 그대로 보인다.

    토큰이 아예 없는 경우는 401 이 아니다 — 비로그인 미리보기가 정상
    동작이기 때문이다."""
    if not credentials:
        return None

    def _만료됨():
        return HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="로그인이 만료되었습니다. 다시 로그인해 주세요",
            headers={"WWW-Authenticate": "Bearer"},
        )

    data = decode_token(credentials.credentials)
    if not data:
        raise _만료됨()
    user_id = data.get("sub")
    if not user_id:
        raise _만료됨()
    try:
        user = db.query(User).filter(User.id == int(user_id)).first()
    except (ValueError, TypeError):
        raise _만료됨()
    if not user:
        # 토큰은 멀쩡한데 그 사용자가 없다 — 탈퇴했거나 DB 가 바뀐 경우
        raise _만료됨()
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
