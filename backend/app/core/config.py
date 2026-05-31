from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite:///./stockplatform.db"
    SECRET_KEY: str = "dev-secret-key-change-in-production"
    FRONTEND_URL: str = "http://localhost:5173,https://stock-platform-one.vercel.app"

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
