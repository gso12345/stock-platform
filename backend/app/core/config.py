import logging
from pydantic_settings import BaseSettings

log = logging.getLogger(__name__)

_PLACEHOLDER = "your-secret-key-change-this"


class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite:///./stockplatform.db"
    SECRET_KEY: str = _PLACEHOLDER
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

    class Config:
        env_file = ".env"


settings = Settings()

if settings.SECRET_KEY == _PLACEHOLDER:
    if settings.APP_ENV == "production":
        raise RuntimeError("운영 환경에서 SECRET_KEY 기본값 사용 불가. .env에 고정 키를 설정하세요.")
    log.warning("SECRET_KEY가 기본값입니다. .env 파일에 고정 키를 설정하세요.")
