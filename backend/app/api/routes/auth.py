import logging
import re
import secrets
from datetime import timedelta
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session
from typing import Optional
from slowapi import Limiter
from slowapi.util import get_remote_address

log = logging.getLogger(__name__)

from app.core.cache import cache
from app.core.config import settings
from app.core.deps import get_current_user, require_user
from app.core.oauth import PROVIDERS, make_username, parse_userinfo
from app.core.security import create_access_token, decode_token, hash_password, verify_password
from app.db.database import get_db
from app.models.user import User

OAUTH_EXCHANGE_TTL = 60  # 교환 코드 유효 시간(초)

# 타이밍 사이드채널 방지용 더미 해시 — 사용자 미존재 시에도 verify_password를 항상 실행
_DUMMY_HASH = "pbkdf2:sha256:260000:dummy:0000000000000000000000000000000000000000000000000000000000000000"

router = APIRouter(prefix="/auth", tags=["인증"])
limiter = Limiter(key_func=get_remote_address)


# ── Pydantic 스키마 ──────────────────────────────────────────────
class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=50, pattern=r"^[a-zA-Z0-9_]+$")
    password: str = Field(..., min_length=8, max_length=100)
    email: Optional[str] = Field(None, max_length=200)

    @field_validator("password")
    @classmethod
    def password_complexity(cls, v: str) -> str:
        if not re.search(r"[A-Za-z]", v) or not re.search(r"\d", v) or not re.search(r"[^A-Za-z0-9]", v):
            raise ValueError("비밀번호는 영문자, 숫자, 특수문자를 모두 포함해야 합니다")
        return v


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=50)
    password: str = Field(..., min_length=1, max_length=100)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: int
    username: str
    email: Optional[str] = None
    is_admin: bool = False


class OAuthExchangeRequest(BaseModel):
    code: str = Field(..., min_length=1, max_length=200)


class UserResponse(BaseModel):
    id: int
    username: str
    email: Optional[str] = None
    is_active: bool
    is_admin: bool = False

    model_config = {"from_attributes": True}


# ── 헬퍼 ─────────────────────────────────────────────────────────
def _is_admin_username(username: str) -> bool:
    admins = [a.strip() for a in settings.ADMIN_USERNAME.split(",") if a.strip()]
    return username in admins


def _make_token_response(user: User, db=None) -> TokenResponse:
    if db and _is_admin_username(user.username) and not user.is_admin:
        user.is_admin = True
        db.commit()
    token = create_access_token(data={"sub": str(user.id)})
    return TokenResponse(
        access_token=token,
        user_id=user.id,
        username=user.username,
        email=user.email,
        is_admin=user.is_admin or _is_admin_username(user.username),
    )


# ── 엔드포인트 ────────────────────────────────────────────────────
@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("20/hour")
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
    try:
        user = User(
            username=req.username,
            email=req.email or None,
            hashed_password=hash_password(req.password),
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    except Exception as e:
        db.rollback()
        err = str(e).lower()
        log.error(f"회원가입 오류: {type(e).__name__}")
        if "unique" in err or "duplicate" in err:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="이미 사용 중인 아이디 또는 이메일입니다")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="서버 오류가 발생했습니다")
    return _make_token_response(user, db)


@router.post("/login", response_model=TokenResponse)
@limiter.limit("5/minute")
def login(request: Request, req: LoginRequest, db: Session = Depends(get_db)):
    """username+비밀번호 검증 후 JWT 토큰 반환"""
    user = db.query(User).filter(User.username == req.username).first()
    if not user:
        log.warning(f"로그인 실패: 존재하지 않는 username='{req.username}' — DB가 SQLite(ephemeral)이면 배포 후 계정이 사라집니다")
    pwd_hash = user.hashed_password if user else _DUMMY_HASH
    if not user or not verify_password(req.password, pwd_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="아이디 또는 비밀번호가 올바르지 않습니다",
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="비활성화된 계정입니다",
        )
    return _make_token_response(user, db)


@router.get("/me", response_model=UserResponse)
def me(current_user: User = Depends(require_user)):
    """Bearer 토큰으로 현재 로그인된 유저 정보 반환"""
    return current_user


# ── 소셜 로그인 (OAuth 2.0) ────────────────────────────────────────
def _frontend_url() -> str:
    return settings.FRONTEND_URL.split(",")[0].strip()


def _redirect_uri(provider: str) -> str:
    return f"{settings.OAUTH_REDIRECT_BASE}/api/v1/auth/oauth/{provider}/callback"


@router.get("/oauth/{provider}/login")
@limiter.limit("20/minute")
def oauth_login(request: Request, provider: str):
    """소셜 로그인 시작 — 공급자 인증 페이지로 리다이렉트"""
    cfg = PROVIDERS.get(provider)
    if not cfg or not cfg["client_id"]:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="지원하지 않는 로그인 방식입니다")

    state = create_access_token(data={"oauth_provider": provider}, expires_delta=timedelta(minutes=10))
    params = {
        "client_id": cfg["client_id"],
        "redirect_uri": _redirect_uri(provider),
        "response_type": "code",
        "state": state,
    }
    if cfg["scope"]:
        params["scope"] = cfg["scope"]
    return RedirectResponse(f"{cfg['authorize_url']}?{urlencode(params)}")


@router.get("/oauth/{provider}/callback")
@limiter.limit("20/minute")
def oauth_callback(
    request: Request,
    provider: str,
    code: str = "",
    state: str = "",
    error: str = "",
    db: Session = Depends(get_db),
):
    """소셜 로그인 콜백 — 코드 교환 후 사용자 조회/생성하고 프론트엔드로 토큰과 함께 리다이렉트"""
    frontend = _frontend_url()
    cfg = PROVIDERS.get(provider)
    if not cfg or not cfg["client_id"]:
        return RedirectResponse(f"{frontend}/login?oauth_error=unsupported")
    if error or not code:
        return RedirectResponse(f"{frontend}/login?oauth_error=denied")

    payload = decode_token(state)
    if not payload or payload.get("oauth_provider") != provider:
        return RedirectResponse(f"{frontend}/login?oauth_error=invalid_state")

    token_data = {
        "grant_type": "authorization_code",
        "client_id": cfg["client_id"],
        "client_secret": cfg["client_secret"],
        "redirect_uri": _redirect_uri(provider),
        "code": code,
    }
    if provider == "naver":
        token_data["state"] = state

    try:
        with httpx.Client(timeout=10) as client:
            token_resp = client.post(cfg["token_url"], data=token_data, headers={"Accept": "application/json"})
            token_resp.raise_for_status()
            access_token = token_resp.json().get("access_token")
            if not access_token:
                raise ValueError("토큰 발급 실패")

            userinfo_resp = client.get(cfg["userinfo_url"], headers={"Authorization": f"Bearer {access_token}"})
            userinfo_resp.raise_for_status()
            info = userinfo_resp.json()
    except Exception as e:
        log.error(f"OAuth 콜백 오류 ({provider}): {type(e).__name__}")
        return RedirectResponse(f"{frontend}/login?oauth_error=provider_error")

    oauth_id, email, display_name = parse_userinfo(provider, info)
    if not oauth_id:
        return RedirectResponse(f"{frontend}/login?oauth_error=no_user_info")

    user = db.query(User).filter(User.oauth_provider == provider, User.oauth_id == oauth_id).first()
    if not user:
        if email and db.query(User).filter(User.email == email).first():
            return RedirectResponse(f"{frontend}/login?oauth_error=email_exists")
        try:
            user = User(
                username=make_username(db, provider, display_name),
                email=email,
                hashed_password=hash_password(secrets.token_urlsafe(32)),
                oauth_provider=provider,
                oauth_id=oauth_id,
            )
            db.add(user)
            db.commit()
            db.refresh(user)
        except Exception as e:
            db.rollback()
            log.error(f"OAuth 회원가입 오류 ({provider}): {type(e).__name__}")
            return RedirectResponse(f"{frontend}/login?oauth_error=signup_failed")

    if not user.is_active:
        return RedirectResponse(f"{frontend}/login?oauth_error=inactive")

    token_resp = _make_token_response(user)
    exchange_code = secrets.token_urlsafe(32)
    cache.set(f"oauth_exchange:{exchange_code}", token_resp.model_dump(), OAUTH_EXCHANGE_TTL)
    return RedirectResponse(f"{frontend}/oauth/callback?{urlencode({'code': exchange_code})}")


@router.post("/oauth/exchange", response_model=TokenResponse)
@limiter.limit("20/minute")
def oauth_exchange(request: Request, body: OAuthExchangeRequest):
    """소셜 로그인 1회용 교환 코드를 실제 토큰으로 교환 (URL에 토큰 노출 방지)"""
    ck = f"oauth_exchange:{body.code}"
    data = cache.get(ck)
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="유효하지 않거나 만료된 코드입니다")
    cache.delete(ck)
    return TokenResponse(**data)
