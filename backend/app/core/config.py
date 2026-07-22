import hashlib
import logging
from pydantic_settings import BaseSettings

log = logging.getLogger(__name__)

_PLACEHOLDER = "your-secret-key-change-this"


class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite:///./stockplatform.db"
    SECRET_KEY: str = _PLACEHOLDER

    def stable_secret_key(self) -> str:
        """SECRET_KEY가 기본값이면 DATABASE_URL에서 결정론적으로 파생."""
        if self.SECRET_KEY and self.SECRET_KEY != _PLACEHOLDER:
            return self.SECRET_KEY
        seed = f"stock-platform-{self.DATABASE_URL}"
        return "sp-" + hashlib.sha256(seed.encode()).hexdigest()
    FRONTEND_URL: str = "http://localhost:5173,https://stock-platform-one.vercel.app"
    APP_ENV: str = "development"   # "production"으로 설정하면 CORS strict 모드

    # ── 한국투자증권 KIS API ─────────────────────────────
    KIS_APP_KEY:    str = ""
    KIS_APP_SECRET: str = ""
    KIS_ACCOUNT_NO: str = ""
    KIS_IS_REAL:    bool = False   # False = 모의투자, True = 실거래

    # ── Finnhub (미국 주식 실시간) ──────────────────────
    FINNHUB_API_KEY: str = ""

    # ── OpenDART (국내 공시/재무제표) ───────────────────
    DART_API_KEY: str = ""

    # ── FMP - Financial Modeling Prep (해외 재무) ───────
    FMP_API_KEY: str = ""

    # ── 한국은행 ECOS (기준금리/국고채) ─────────────────────
    BOK_API_KEY: str = "sample"   # 무료 가입 후 발급 키 입력, 기본값은 sample

    # ── Anthropic (뉴스 AI 요약) ─────────────────────────
    ANTHROPIC_API_KEY: str = ""

    # ── 관리자 ────────────────────────────────────────────
    ADMIN_USERNAME: str = ""   # 쉼표 구분 복수 가능: "admin,gso12345"

    # ── 소셜 로그인 (OAuth) ───────────────────────────────
    OAUTH_REDIRECT_BASE: str = "http://localhost:8000"  # 백엔드 콜백 base URL (프로덕션은 실제 백엔드 도메인)
    GOOGLE_CLIENT_ID:     str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    NAVER_CLIENT_ID:      str = ""
    NAVER_CLIENT_SECRET:  str = ""
    KAKAO_CLIENT_ID:      str = ""
    KAKAO_CLIENT_SECRET:  str = ""

    class Config:
        env_file = ".env"


settings = Settings()

if settings.SECRET_KEY == _PLACEHOLDER:
    log.warning("SECRET_KEY가 기본값입니다. DATABASE_URL로부터 안정적인 키를 자동 생성합니다.")
