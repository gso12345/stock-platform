import re
from typing import Optional
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.user import User

# 공급자별 OAuth 2.0 엔드포인트 및 클라이언트 설정
PROVIDERS = {
    "google": {
        "authorize_url": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_url": "https://oauth2.googleapis.com/token",
        "userinfo_url": "https://www.googleapis.com/oauth2/v2/userinfo",
        "scope": "openid email profile",
        "client_id": settings.GOOGLE_CLIENT_ID,
        "client_secret": settings.GOOGLE_CLIENT_SECRET,
    },
    "naver": {
        "authorize_url": "https://nid.naver.com/oauth2.0/authorize",
        "token_url": "https://nid.naver.com/oauth2.0/token",
        "userinfo_url": "https://openapi.naver.com/v1/nid/me",
        "scope": "",
        "client_id": settings.NAVER_CLIENT_ID,
        "client_secret": settings.NAVER_CLIENT_SECRET,
    },
    "kakao": {
        "authorize_url": "https://kauth.kakao.com/oauth/authorize",
        "token_url": "https://kauth.kakao.com/oauth/token",
        "userinfo_url": "https://kapi.kakao.com/v2/user/me",
        "scope": "account_email",
        "client_id": settings.KAKAO_CLIENT_ID,
        "client_secret": settings.KAKAO_CLIENT_SECRET,
    },
}


def parse_userinfo(provider: str, info: dict) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """공급자별 사용자 정보 응답에서 (고유 ID, 이메일, 표시 이름)을 추출"""
    if provider == "google":
        oid = info.get("id")
        return (str(oid) if oid else None), info.get("email"), info.get("name")
    if provider == "naver":
        resp = info.get("response") or {}
        oid = resp.get("id")
        return (str(oid) if oid else None), resp.get("email"), resp.get("name") or resp.get("nickname")
    if provider == "kakao":
        oid = info.get("id")
        account = info.get("kakao_account") or {}
        profile = account.get("profile") or {}
        return (str(oid) if oid else None), account.get("email"), profile.get("nickname")
    return None, None, None


def make_username(db: Session, provider: str, display_name: Optional[str]) -> str:
    """소셜 로그인 신규 가입자용 username 자동 생성 (중복 시 숫자 접미사 추가)"""
    base = re.sub(r"[^a-zA-Z0-9_]", "", display_name or "").lower()[:20]
    if not base:
        base = provider
    candidate = f"{base}_{provider}"[:46]
    final = candidate
    suffix = 0
    while db.query(User).filter(User.username == final).first():
        suffix += 1
        final = f"{candidate}{suffix}"[:50]
    return final
