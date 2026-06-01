from datetime import datetime, timedelta, timezone
from typing import Optional
import hashlib
import hmac
import secrets

from jose import JWTError, jwt

from app.core.config import settings

SECRET_KEY = settings.SECRET_KEY
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 24시간

_ITERATIONS = 260_000
_ALGO = "sha256"


def hash_password(password: str) -> str:
    """PBKDF2-SHA256으로 비밀번호 해시 (표준 라이브러리, 외부 의존성 없음)"""
    salt = secrets.token_hex(32)
    key = hashlib.pbkdf2_hmac(_ALGO, password.encode("utf-8"), salt.encode(), _ITERATIONS)
    return f"pbkdf2:{_ALGO}:{_ITERATIONS}:{salt}:{key.hex()}"


def verify_password(plain: str, hashed: str) -> bool:
    """해시 검증"""
    try:
        parts = hashed.split(":")
        if len(parts) != 5 or parts[0] != "pbkdf2":
            return False
        _, algo, iterations, salt, stored = parts
        key = hashlib.pbkdf2_hmac(algo, plain.encode("utf-8"), salt.encode(), int(iterations))
        return hmac.compare_digest(key.hex(), stored)
    except Exception:
        return False


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """JWT 액세스 토큰 생성"""
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta if expires_delta else timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode["exp"] = expire
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> Optional[dict]:
    """JWT 토큰 디코딩 — 유효하지 않으면 None 반환"""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        return None
