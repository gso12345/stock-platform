from fastapi import FastAPI, WebSocket, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from app.core.config import settings
from app.db.database import Base, engine
from app.api.routes import dashboard, stocks, screening, backtest, watchlist, search
from app.api.websocket.price_stream import stream_prices, stream_indices
from app.services.scheduler import start_background_tasks
from app.services.ticker_service import init_ticker_db

import logging
logging.basicConfig(level=logging.INFO)

Base.metadata.create_all(bind=engine)

limiter = Limiter(key_func=get_remote_address, default_limits=["60/minute"])

app = FastAPI(
    title="Stock Platform API",
    description="종목발굴 및 백테스트 플랫폼",
    version="1.0.0",
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

_allowed_origins = [o.strip() for o in settings.FRONTEND_URL.split(",") if o.strip()]
if not _allowed_origins or _allowed_origins == ["http://localhost:5173"]:
    # 개발 환경: 전체 허용
    _allowed_origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

app.include_router(search.router,    prefix="/api/v1")
app.include_router(dashboard.router, prefix="/api/v1")
app.include_router(stocks.router,    prefix="/api/v1")
app.include_router(screening.router, prefix="/api/v1")
app.include_router(backtest.router,  prefix="/api/v1")
app.include_router(watchlist.router, prefix="/api/v1")

# 종목 DB + 스케줄러 등록
@app.on_event("startup")
async def _startup():
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
