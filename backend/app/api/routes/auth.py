from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from typing import Optional
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.core.deps import get_current_user, require_user
from app.core.security import create_access_token, hash_password, verify_password
from app.db.database import get_db
from app.models.user import User

router = APIRouter(prefix="/auth", tags=["인증"])
limiter = Limiter(key_func=get_remote_address)


# ── Pydantic 스키마 ──────────────────────────────────────────────
class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=50, pattern=r"^[a-zA-Z0-9_]+$")
    password: str = Field(..., min_length=8, max_length=100)
    email: Optional[str] = Field(None, max_length=200)  # 선택


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: int
    username: str
    email: Optional[str] = None


class UserResponse(BaseModel):
    id: int
    username: str
    email: Optional[str] = None
    is_active: bool

    model_config = {"from_attributes": True}


# ── 헬퍼 ─────────────────────────────────────────────────────────
def _make_token_response(user: User) -> TokenResponse:
    token = create_access_token(data={"sub": str(user.id)})
    return TokenResponse(
        access_token=token,
        user_id=user.id,
        username=user.username,
        email=user.email,
    )


# ── 엔드포인트 ────────────────────────────────────────────────────
@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("10/minute")
def register(request: Request, req: RegisterRequest, db: Session = Depends(get_db)):
    """username+비밀번호로 신규 회원가입 후 JWT 토큰 반환"""
    # username 중복 체크
    if db.query(User).filter(User.username == req.username).first():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="이미 사용 중인 아이디입니다",
        )
    # email 중복 체크 (입력한 경우에만)
    if req.email:
        if db.query(User).filter(User.email == req.email).first():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="이미 사용 중인 이메일입니다",
            )
    user = User(
        username=req.username,
        email=req.email or None,
        hashed_password=hash_password(req.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _make_token_response(user)


@router.post("/login", response_model=TokenResponse)
@limiter.limit("5/minute")
def login(request: Request, req: LoginRequest, db: Session = Depends(get_db)):
    """username+비밀번호 검증 후 JWT 토큰 반환"""
    user = db.query(User).filter(User.username == req.username).first()
    if not user or not verify_password(req.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="아이디 또는 비밀번호가 올바르지 않습니다",
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="비활성화된 계정입니다",
        )
    return _make_token_response(user)


@router.get("/me", response_model=UserResponse)
def me(current_user: User = Depends(require_user)):
    """Bearer 토큰으로 현재 로그인된 유저 정보 반환"""
    return current_user
