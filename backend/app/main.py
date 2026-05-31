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
from app.api.routes import dashboard, stocks, screening, backtest, watchlist, search, auth
from app.models.user import User  # noqa: F401  — Base.metadata가 users 테이블을 인식하도록
from app.api.websocket.price_stream import stream_prices, stream_indices
from app.services.scheduler import start_background_tasks
from app.services.ticker_service import init_ticker_db

import logging
logging.basicConfig(level=logging.INFO)

Base.metadata.create_all(bind=engine)

limiter = Limiter(key_func=get_remote_address, default_limits=["60/minute"])

_is_prod = settings.APP_ENV == "production"

app = FastAPI(
    title="Stock Platform API",
    description="종목발굴 및 백테스트 플랫폼",
    version="1.0.0",
    docs_url=None if _is_prod else "/docs",
    redoc_url=None if _is_prod else "/redoc",
    openapi_url=None if _is_prod else "/openapi.json",
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

_allowed_origins = [o.strip() for o in settings.FRONTEND_URL.split(",") if o.strip()]
if settings.APP_ENV != "production":
    _allowed_origins = ["*"]


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        if _is_prod:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response


app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

app.include_router(auth.router,      prefix="/api/v1")
app.include_router(search.router,    prefix="/api/v1")
app.include_router(dashboard.router, prefix="/api/v1")
app.include_router(stocks.router,    prefix="/api/v1")
app.include_router(screening.router, prefix="/api/v1")
app.include_router(backtest.router,  prefix="/api/v1")
app.include_router(watchlist.router, prefix="/api/v1")


@app.on_event("startup")
async def _startup():
    # 스키마 마이그레이션 — 새 컬럼 자동 추가 (Alembic 없이)
    from sqlalchemy import inspect, text
    try:
        inspector = inspect(engine)
        tables = inspector.get_table_names()

        def _add_col_if_missing(table: str, col: str, col_def: str):
            if table in tables:
                existing = [c["name"] for c in inspector.get_columns(table)]
                if col not in existing:
                    with engine.connect() as conn:
                        conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {col_def}"))
                        conn.commit()

        _add_col_if_missing("watchlists",  "user_id", "INTEGER REFERENCES users(id)")
        _add_col_if_missing("strategies",  "user_id", "INTEGER REFERENCES users(id)")
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(f"마이그레이션 스킵: {e}")

    init_ticker_db()

start_background_tasks(app)


@app.websocket("/ws/indices")
async def ws_indices(websocket: WebSocket, interval: int = Query(default=30)):
    await stream_indices(websocket, interval=interval)


@app.websocket("/ws/prices")
async def ws_prices(
    websocket: WebSocket,
    symbols: str = Query(...),
    markets: str = Query(...),
    interval: int = Query(default=30),
):
    sym_list = symbols.split(",")
    mkt_list = markets.split(",")
    await stream_prices(websocket, sym_list, mkt_list, interval=interval)


@app.get("/")
def root():
    return {"status": "ok", "message": "Stock Platform API 실행 중"}


@app.get("/health")
def health():
    return {"status": "healthy"}
