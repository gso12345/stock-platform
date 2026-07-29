from contextlib import asynccontextmanager
import asyncio
from fastapi import FastAPI, WebSocket, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from app.core.config import settings
from app.db.database import Base, engine
from app.api.routes import dashboard, stocks, screening, backtest, watchlist, search, auth, portfolio, admin as admin_routes
from app.api.routes import community
from app.models.user import User  # noqa: F401  — Base.metadata가 users 테이블을 인식하도록
from app.models.stock import (  # noqa: F401  — 테이블 생성 보장
    Portfolio, PortfolioItem, FundamentalsCache, FinancialsCache,
    AnalystCache, ForecastsCache, DisclosuresCache, DartCorpMapCache,
    QuantScoreWeight, QuantPercentileCache, KrTicker,
)
from app.models.community import StockPost, StockPostLike, StockComment, StockCommentLike, UserProfile, UserFollow, StockPostPollVote, SitePopup, Report  # noqa: F401
from app.api.websocket.price_stream import stream_prices, stream_indices, MAX_STREAM_SYMBOLS
from app.services.scheduler import start_background_tasks
from app.services.ticker_service import init_ticker_db

import logging
logging.basicConfig(level=logging.INFO)
_startup_log = logging.getLogger(__name__)

# ── DB 종류 명시 로그 ────────────────────────────────────────
_db_url = settings.DATABASE_URL
if _db_url.startswith("sqlite"):
    _startup_log.warning(
        "⚠️  SQLite 사용 중 — 배포 시 데이터가 초기화됩니다. "
        "Render 환경변수에 DATABASE_URL(Supabase PostgreSQL)을 설정하세요."
    )
else:
    _masked = _db_url.split("@")[-1] if "@" in _db_url else _db_url
    _startup_log.info(f"✅ PostgreSQL 사용 중: ...@{_masked}")

try:
    Base.metadata.create_all(bind=engine)
except Exception as _db_init_err:
    logging.warning(f"DB 초기화 실패 (서버는 계속 실행): {_db_init_err}")

limiter = Limiter(key_func=get_remote_address, default_limits=["60/minute"])

_is_prod = settings.APP_ENV == "production"


@asynccontextmanager
async def lifespan(application: FastAPI):
    # startup
    from sqlalchemy import inspect, text
    import re as _re
    try:
        inspector = inspect(engine)
        tables = inspector.get_table_names()

        _ALLOWED_MIGRATE_TABLES = {"watchlists", "strategies", "watchlist_items", "users", "screening_presets", "watchlist_folders", "backtest_results", "quant_score_weights", "portfolio_items", "portfolios"}
        _is_sqlite = settings.DATABASE_URL.startswith("sqlite")
        # 테이블/컬럼명이 항상 이 파일 내 하드코딩된 값이지만, 방어적으로 식별자 형식을 강제
        _IDENTIFIER_RE = _re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

        def _add_col_if_missing(table: str, col: str, col_def: str, sqlite_def: str = ""):
            if table not in _ALLOWED_MIGRATE_TABLES:
                return
            if table not in tables:
                return
            if not (_IDENTIFIER_RE.match(table) and _IDENTIFIER_RE.match(col)):
                logging.getLogger(__name__).warning(f"잘못된 식별자 형식 {table}.{col}")
                return
            try:
                existing = [c["name"] for c in inspector.get_columns(table)]
                if col not in existing:
                    effective_def = (sqlite_def or col_def) if _is_sqlite else col_def
                    with engine.connect() as conn:
                        conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {effective_def}"))
                        conn.commit()
            except Exception as me:
                logging.getLogger(__name__).warning(f"컬럼 추가 실패 {table}.{col}: {me}")

        _add_col_if_missing("watchlists",  "user_id",   "INTEGER REFERENCES users(id)",  "INTEGER")
        _add_col_if_missing("strategies",  "user_id",   "INTEGER REFERENCES users(id)",  "INTEGER")
        _add_col_if_missing("watchlist_items", "folder_id", "INTEGER REFERENCES watchlist_folders(id)", "INTEGER")
        _add_col_if_missing("watchlist_items", "position",  "INTEGER DEFAULT 0")
        _add_col_if_missing("watchlist_items", "memo",      "VARCHAR(200)")
        _add_col_if_missing("screening_presets", "user_id", "INTEGER REFERENCES users(id)", "INTEGER")
        _add_col_if_missing("watchlist_folders", "user_id", "INTEGER REFERENCES users(id)", "INTEGER")
        _add_col_if_missing("backtest_results", "user_id", "INTEGER REFERENCES users(id)", "INTEGER")
        _add_col_if_missing("users", "oauth_provider", "VARCHAR(20)")
        _add_col_if_missing("users", "oauth_id", "VARCHAR(100)")
        _add_col_if_missing("users", "is_admin", "BOOLEAN DEFAULT FALSE")
        _add_col_if_missing("quant_score_weights", "enabled_metrics", "JSON")
        _add_col_if_missing("portfolio_items", "portfolio_id", "INTEGER REFERENCES portfolios(id)", "INTEGER")
        _add_col_if_missing("portfolio_items", "asset_class", "VARCHAR(10)")
        _add_col_if_missing("portfolios", "is_public", "BOOLEAN DEFAULT FALSE")

        def _add_index_if_missing(table: str, col: str):
            if table not in tables:
                return
            if not (_IDENTIFIER_RE.match(table) and _IDENTIFIER_RE.match(col)):
                logging.getLogger(__name__).warning(f"잘못된 식별자 형식 {table}.{col}")
                return
            try:
                with engine.connect() as conn:
                    conn.execute(text(f"CREATE INDEX IF NOT EXISTS ix_{table}_{col} ON {table} ({col})"))
                    conn.commit()
            except Exception as me:
                logging.getLogger(__name__).warning(f"인덱스 생성 실패 {table}.{col}: {me}")

        for _table, _col in [
            ("watchlists", "user_id"),
            ("watchlist_items", "watchlist_id"),
            ("watchlist_items", "folder_id"),
            ("watchlist_items", "symbol"),
            ("watchlist_items", "market"),
            ("strategies", "user_id"),
            ("backtest_results", "strategy_id"),
            ("screening_presets", "user_id"),
            ("watchlist_folders", "user_id"),
            ("backtest_results", "user_id"),
            ("users", "oauth_provider"),
            ("users", "oauth_id"),
            ("portfolio_items", "portfolio_id"),
        ]:
            _add_index_if_missing(_table, _col)

        # 기존 portfolio_items 중 portfolio_id가 없는(=다중 포트폴리오 도입 이전) 항목을
        # 사용자별 "기본 포트폴리오"로 일괄 편입
        if "portfolio_items" in tables and "portfolios" in inspector.get_table_names():
            from app.db.database import SessionLocal
            from app.models.stock import Portfolio as _Portfolio, PortfolioItem as _PortfolioItem

            mdb = SessionLocal()
            try:
                orphan_user_ids = [
                    r[0] for r in mdb.query(_PortfolioItem.user_id)
                    .filter(_PortfolioItem.portfolio_id.is_(None))
                    .distinct().all()
                ]
                for uid in orphan_user_ids:
                    default_pf = mdb.query(_Portfolio).filter(_Portfolio.user_id == uid).first()
                    if not default_pf:
                        default_pf = _Portfolio(name="기본 포트폴리오", user_id=uid)
                        mdb.add(default_pf)
                        mdb.commit()
                        mdb.refresh(default_pf)
                    mdb.query(_PortfolioItem).filter(
                        _PortfolioItem.user_id == uid, _PortfolioItem.portfolio_id.is_(None)
                    ).update({"portfolio_id": default_pf.id})
                mdb.commit()
            except Exception as pe:
                mdb.rollback()
                logging.getLogger(__name__).warning(f"기본 포트폴리오 백필 실패: {pe}")
            finally:
                mdb.close()

        if "users" in tables and not settings.DATABASE_URL.startswith("sqlite"):
            with engine.connect() as conn:
                try:
                    conn.execute(text("ALTER TABLE users ALTER COLUMN email DROP NOT NULL"))
                    conn.commit()
                except Exception:
                    conn.rollback()

        # 커뮤니티 테이블이 없으면 재생성 (이전 배포에서 create_all이 실패했을 경우 대비)
        community_tables = {"stock_posts", "stock_post_likes", "stock_comments", "stock_comment_likes", "user_profiles", "user_follows", "stock_post_poll_votes", "site_popups", "reports"}
        if not community_tables.issubset(set(tables)):
            try:
                Base.metadata.create_all(bind=engine)
                _startup_log.info("커뮤니티 테이블 생성 완료")
            except Exception as _ct_err:
                _startup_log.warning(f"커뮤니티 테이블 생성 실패: {_ct_err}")

        # 커뮤니티 성능 인덱스 (복합 인덱스 — CREATE INDEX IF NOT EXISTS는 멱등)
        try:
            with engine.connect() as _idx:
                _idx.execute(text("CREATE INDEX IF NOT EXISTS ix_stock_posts_sym_mkt_created ON stock_posts (symbol, market, created_at DESC) WHERE is_deleted IS NOT TRUE AND is_blinded IS NOT TRUE"))
                _idx.execute(text("CREATE INDEX IF NOT EXISTS ix_stock_posts_sym_mkt_likes   ON stock_posts (symbol, market, like_count DESC, created_at DESC) WHERE is_deleted IS NOT TRUE AND is_blinded IS NOT TRUE"))
                _idx.execute(text("CREATE INDEX IF NOT EXISTS ix_stock_posts_created_at       ON stock_posts (created_at DESC) WHERE is_deleted IS NOT TRUE AND is_blinded IS NOT TRUE"))
                _idx.execute(text("CREATE INDEX IF NOT EXISTS ix_stock_posts_like_count       ON stock_posts (like_count DESC, created_at DESC) WHERE is_deleted IS NOT TRUE AND is_blinded IS NOT TRUE"))
                _idx.execute(text("CREATE INDEX IF NOT EXISTS ix_stock_comments_post_parent   ON stock_comments (post_id, parent_id, created_at ASC) WHERE is_deleted IS NOT TRUE AND is_blinded IS NOT TRUE"))
                _idx.commit()
                _startup_log.info("커뮤니티 성능 인덱스 생성 완료")
        except Exception as _idx_err:
            _startup_log.warning(f"커뮤니티 인덱스 생성 스킵: {_idx_err}")

        # 누락 컬럼 추가 (스키마 변경 시 자동 마이그레이션)
        #
        # "ALTER TABLE ... ADD COLUMN IF NOT EXISTS" 는 PostgreSQL 전용 문법이라
        # SQLite(로컬 개발)에서는 구문 오류로 통째로 실패하고 경고만 남긴 채 넘어갔다.
        # 그 결과 로컬에서는 컬럼이 끝내 만들어지지 않아 회원가입 등이 500으로 죽었다.
        # 그래서 실제 컬럼 목록을 먼저 조회해 없는 것만 추가하는 방식으로 바꾼다.
        _MIGRATIONS = [
            ("stock_posts",    "like_count",           "INTEGER NOT NULL DEFAULT 0"),
            ("stock_posts",    "comment_count",        "INTEGER NOT NULL DEFAULT 0"),
            ("stock_posts",    "view_count",           "INTEGER NOT NULL DEFAULT 0"),
            ("stock_posts",    "is_deleted",           "BOOLEAN NOT NULL DEFAULT false"),
            ("stock_posts",    "updated_at",           None),   # 타입이 DB마다 달라 아래에서 분기
            ("stock_posts",    "is_blinded",           "BOOLEAN DEFAULT false"),
            ("stock_comments", "is_blinded",           "BOOLEAN DEFAULT false"),
            ("user_profiles",  "avatar_url",           "TEXT"),
            ("user_profiles",  "noti_disabled",        "VARCHAR(200)"),
            ("users",          "is_community_banned",  "BOOLEAN DEFAULT false"),
        ]
        try:
            from sqlalchemy import inspect as _sa_inspect
            _is_sqlite = engine.dialect.name == "sqlite"
            _inspector = _sa_inspect(engine)
            _added, _skipped = 0, 0
            for _table, _col, _ddl in _MIGRATIONS:
                try:
                    _existing = {c["name"] for c in _inspector.get_columns(_table)}
                except Exception:
                    continue  # 아직 테이블이 없으면 create_all이 만들어 준다
                if _col in _existing:
                    _skipped += 1
                    continue
                if _ddl is None:  # updated_at — SQLite에는 TIMESTAMPTZ/now()가 없다
                    _ddl = "TIMESTAMP" if _is_sqlite else "TIMESTAMPTZ DEFAULT now()"
                try:
                    with engine.connect() as _mc:
                        _mc.execute(text(f"ALTER TABLE {_table} ADD COLUMN {_col} {_ddl}"))
                        _mc.commit()
                    _added += 1
                except Exception as _col_err:
                    _startup_log.warning(f"컬럼 추가 실패 {_table}.{_col}: {_col_err}")
            _startup_log.info(f"컬럼 마이그레이션 완료 (추가 {_added}, 이미 존재 {_skipped})")
        except Exception as _mig_err:
            _startup_log.warning(f"컬럼 마이그레이션 스킵: {_mig_err}")
    except Exception as e:
        logging.getLogger(__name__).warning(f"마이그레이션 스킵: {e}")

    # JWT 시크릿 키를 DB에서 로드 (없으면 생성 후 저장) — 배포해도 키가 유지됨
    try:
        import secrets as _secrets
        from app.core import security as _security
        from sqlalchemy import text as _text
        with engine.connect() as _conn:
            _conn.execute(_text("""
                CREATE TABLE IF NOT EXISTS system_settings (
                    key VARCHAR(100) PRIMARY KEY,
                    value TEXT NOT NULL
                )
            """))
            _conn.commit()
            _row = _conn.execute(_text("SELECT value FROM system_settings WHERE key = 'jwt_secret'")).fetchone()
            if _row:
                _security.SECRET_KEY = _row[0]
            else:
                _new_key = "sp-" + _secrets.token_hex(32)
                _conn.execute(_text("INSERT INTO system_settings (key, value) VALUES ('jwt_secret', :v)"), {"v": _new_key})
                _conn.commit()
                _security.SECRET_KEY = _new_key
        logging.getLogger(__name__).info("JWT 시크릿 키 DB에서 로드 완료")
    except Exception as _key_err:
        logging.getLogger(__name__).warning(f"JWT 시크릿 키 DB 로드 실패, 기존 키 사용: {_key_err}")

    # 스레드 수를 실제 CPU 할당량에 맞춘다. 컨테이너에서 os.cpu_count()는
    # 호스트 코어 수를 돌려주므로, 그대로 두면 0.1 CPU 에 수십 개가 뜬다.
    from app.core.cpu import configure_thread_limits
    configure_thread_limits()

    init_ticker_db()
    start_background_tasks(application)

    # 지수·환율 캐시 워밍업은 백그라운드로 — 서버가 즉시 요청을 받을 수 있도록 yield를 막지 않음
    from app.services.scheduler import refresh_kr_indices, refresh_us_indices, refresh_exchange

    async def _warm_dashboard_cache():
        try:
            await asyncio.wait_for(
                asyncio.gather(
                    refresh_kr_indices(),
                    refresh_us_indices(),
                    refresh_exchange(),
                    return_exceptions=True,
                ),
                timeout=20,
            )
        except Exception:
            pass

    asyncio.create_task(_warm_dashboard_cache())

    yield


app = FastAPI(
    title="Stock Platform API",
    description="종목발굴 및 백테스트 플랫폼",
    version="1.0.0",
    docs_url=None if _is_prod else "/docs",
    redoc_url=None if _is_prod else "/redoc",
    openapi_url=None if _is_prod else "/openapi.json",
    lifespan=lifespan,
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

_allowed_origins = [o.strip() for o in settings.FRONTEND_URL.split(",") if o.strip()]
if settings.APP_ENV not in ("production", "staging"):
    _allowed_origins = ["http://localhost:5173", "http://localhost:3000", *_allowed_origins]


_FEATURE_PATH_MAP = {
    "/api/v1/dashboard":  "dashboard",
    "/api/v1/stocks/":    "stock_detail",
    "/api/v1/community":  "community",
    "/api/v1/search":     "search",
    "/api/v1/portfolio":  "portfolio",
    "/api/v1/watchlist":  "watchlist",
    "/api/v1/screening":  "screening",
    "/api/v1/backtest":   "backtest",
}


class ActivityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # 헬스체크는 사람의 사용이 아니다 — 이걸로 '사용 중'을 판단하면
        # 아무도 안 보는데도 백그라운드 갱신이 계속 돈다
        if request.url.path not in ("/health", "/"):
            from app.core.activity import touch_request
            touch_request()
        auth = request.headers.get("authorization", "")
        if auth.lower().startswith("bearer "):
            try:
                from app.core.security import decode_token
                from app.core.activity import mark_active
                from app.core.trends import track_usage
                payload = decode_token(auth[7:])
                if payload and "sub" in payload:
                    mark_active(int(payload["sub"]))
                    path = request.url.path
                    for prefix, feature in _FEATURE_PATH_MAP.items():
                        if path.startswith(prefix):
                            track_usage(feature)
                            break
            except Exception:
                pass
        return await call_next(request)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline'; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: https:; "
            "connect-src 'self' ws: wss: https:; "
            "font-src 'self' data:;"
        )
        if _is_prod:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response


app.add_middleware(ActivityMiddleware)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

app.include_router(auth.router,      prefix="/api/v1")
app.include_router(search.router,    prefix="/api/v1")
app.include_router(dashboard.router, prefix="/api/v1")
app.include_router(stocks.router,    prefix="/api/v1")
app.include_router(screening.router, prefix="/api/v1")
app.include_router(backtest.router,  prefix="/api/v1")
app.include_router(watchlist.router,  prefix="/api/v1")
app.include_router(portfolio.router, prefix="/api/v1")
app.include_router(admin_routes.router, prefix="/api/v1")
app.include_router(community.router,    prefix="/api/v1")


@app.websocket("/ws/indices")
async def ws_indices(
    websocket: WebSocket,
    interval: int = Query(default=30, ge=10, le=60),
):
    await stream_indices(websocket, interval=interval)


@app.websocket("/ws/prices")
async def ws_prices(
    websocket: WebSocket,
    # 상한이 좁아 보유종목이 조금만 많아도 연결 자체가 거부됐다.
    # markets(200자)가 실제 병목이라 국내 67종목·ETF 50종목에서 끊겼고,
    # 거부되면 클라이언트가 3초마다 무한 재연결만 반복했다.
    symbols: str = Query(..., max_length=2600),
    markets: str = Query(..., max_length=900),
    interval: int = Query(default=15, ge=5, le=60),
    token: str = Query(default=""),
):
    import re as _re
    sym_list = [s.strip() for s in symbols.split(",") if s.strip()][:MAX_STREAM_SYMBOLS]
    mkt_list = [m.strip() for m in markets.split(",") if m.strip()]
    bad = [s for s in sym_list if not _re.match(r"^[A-Za-z0-9.\-]{1,20}$", s)]
    if bad:
        await websocket.close(code=4000)
        return
    await stream_prices(websocket, sym_list, mkt_list, interval=interval)


@app.get("/")
def root():
    return {"status": "ok", "message": "Stock Platform API 실행 중"}


@app.get("/health")
def health():
    return {"status": "healthy"}
