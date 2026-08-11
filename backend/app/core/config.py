import hashlib
import logging
from pydantic_settings import BaseSettings

log = logging.getLogger(__name__)

_PLACEHOLDER = "your-secret-key-change-this"


class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite:///./stockplatform.db"
    SECRET_KEY: str = _PLACEHOLDER

    def stable_secret_key(self) -> str:
        """JWT 서명 키.

        SECRET_KEY 를 안 넣으면 DATABASE_URL 에서 파생한다 — 로컬에서 매번
        키를 만들지 않아도 로그인이 유지되게 하려는 편의다.

        다만 프로덕션에서는 이 편의가 위험하다. DATABASE_URL 은 접속 정보라
        로그·에러 화면·설정 화면·백업에 자주 드러나는 값인데, 그것을 아는
        사람은 누구나 이 서명 키를 다시 만들어 **아무 계정의 토큰이든 위조**할
        수 있다(관리자 포함). 게다가 DB 비밀번호를 바꾸면 그 순간 모든 사람의
        토큰이 조용히 무효가 된다.

        그래서 프로덕션에서는 파생하지 않고 아예 못 뜨게 막는다. 조용히
        약한 키로 도는 것보다 배포가 실패하는 편이 낫다.
        """
        if self.SECRET_KEY and self.SECRET_KEY != _PLACEHOLDER:
            return self.SECRET_KEY
        if self.APP_ENV in ("production", "staging"):
            raise RuntimeError(
                "SECRET_KEY 가 설정되지 않았습니다. "
                "프로덕션에서는 DATABASE_URL 로부터 키를 파생하지 않습니다 — "
                "접속 정보를 아는 사람이 토큰을 위조할 수 있기 때문입니다. "
                "Render 대시보드의 환경변수에 SECRET_KEY 를 넣어 주세요 "
                "(예: python -c \"import secrets; print(secrets.token_urlsafe(48))\")."
            )
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
    if settings.APP_ENV in ("production", "staging"):
        # stable_secret_key() 가 어차피 막지만, 기동 로그 맨 앞에서 이유를 보이게 한다
        log.error("SECRET_KEY 가 없습니다 — 프로덕션에서는 기동하지 않습니다. 환경변수를 설정하세요.")
    else:
        log.warning("SECRET_KEY가 기본값입니다. 개발 환경이므로 DATABASE_URL로부터 임시 키를 만듭니다.")
