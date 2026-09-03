# 맨 앞이어야 한다 — 힙 나눔 상한은 이미 만들어진 힙에는 소급되지 않는다.
# 아래 import 들이 스레드 풀과 커넥션 풀을 만들기 시작하면 늦는다.
from app.core.memory import 힙나눔_제한
힙나눔_제한()

from contextlib import asynccontextmanager  # noqa: E402
import asyncio  # noqa: E402
from fastapi import FastAPI, WebSocket, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from app.core.config import settings
from app.db.database import Base, engine
from app.api.routes import dashboard, stocks, screening, backtest, watchlist, search, auth, portfolio, admin as admin_routes
from app.api.routes import community
from app.api.routes import clienterr
from app.api.routes import alerts
from app.models.user import User  # noqa: F401  — Base.metadata가 users 테이블을 인식하도록
from app.models.stock import (  # noqa: F401  — 테이블 생성 보장
    Portfolio, PortfolioItem, FundamentalsCache, FinancialsCache,
    AnalystCache, ForecastsCache, DisclosuresCache, DartCorpMapCache,
    QuantScoreWeight, QuantPercentileCache, KrTicker, UsTicker,
    MetricsHistoryCache, PriceAlert, PortfolioSnapshot,
)
from app.models.community import StockPost, StockPostLike, StockComment, StockCommentLike, UserProfile, UserFollow, StockPostPollVote, SitePopup, Report  # noqa: F401
from app.models.admin_log import AdminLog  # noqa: F401  — 관리자 행위 기록 테이블 생성 보장
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

# 전역 기본 한도.
#
# 60/분으로 잡혀 있었지만 SlowAPIMiddleware 가 없어 실제로는 적용되지 않았다.
# 이제 켜면서 값을 올린다 — 대시보드 한 번 열면 지수·환율·뉴스·관심종목·
# 보유종목·퀀트로 8건 넘게 나가고, 화면을 몇 개 넘기면 금방 60건이 된다.
# 정상 사용자를 막지 않으면서 남용만 걷어내는 선이 목표다.
#
# 프록시 뒤에서 X-Forwarded-For 가 안 잡히면 모든 사용자가 한 IP 로 보여
# 이 값이 '서비스 전체 상한'이 된다. 그때 서비스가 멈추지 않도록 넉넉히 둔다.
# 비싼 라우트(퀀트 비교 등)는 각자 @limiter.limit 으로 따로 조인다.
limiter = Limiter(key_func=get_remote_address, default_limits=["300/minute"])

_is_prod = settings.APP_ENV == "production"


@asynccontextmanager
async def lifespan(application: FastAPI):
    # startup
    from sqlalchemy import inspect, text
    import re as _re
    try:
        inspector = inspect(engine)
        tables = inspector.get_table_names()

        _ALLOWED_MIGRATE_TABLES = {"watchlists", "strategies", "watchlist_items", "users", "screening_presets", "watchlist_folders", "backtest_results", "quant_score_weights", "portfolio_items", "portfolios", "kr_tickers", "notifications"}
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
        # 상장주식수. 시가총액을 직접 계산하려고 KRX 에서 함께 받아 오는데
        # DB 에 안 담고 있었다 — 재시작하면 통째로 사라졌다.
        # (아래 '시가총액 순위에서 삼성전자가 사라진' 건의 원인)
        _add_col_if_missing("kr_tickers", "shares", "DOUBLE PRECISION", "REAL")
        # 가격 알림이 가리키는 종목. 알림을 눌렀을 때 그 종목으로 가야 한다.
        _add_col_if_missing("notifications", "symbol", "VARCHAR(20)")
        _add_col_if_missing("notifications", "market", "VARCHAR(10)")

        def _widen_col(table: str, col: str, new_type: str):
            """이미 만들어진 컬럼의 길이를 늘린다.

            create_all 은 없는 테이블만 만들고 기존 컬럼은 건드리지 않는다.
            kr_tickers.market 을 VARCHAR(10) 으로 잡았다가 'KOSDAQ GLOBAL'(13자)
            때문에 종목 저장이 통째로 실패했다 — 이미 배포된 테이블은 여기서
            늘려야 한다. SQLite 는 길이를 강제하지 않으므로 건너뛴다."""
            if _is_sqlite or table not in tables:
                return
            if not (_IDENTIFIER_RE.match(table) and _IDENTIFIER_RE.match(col)):
                logging.getLogger(__name__).warning(f"잘못된 식별자 형식 {table}.{col}")
                return
            if not _re.fullmatch(r"VARCHAR\(\d{1,4}\)", new_type):
                logging.getLogger(__name__).warning(f"허용되지 않는 타입 {new_type}")
                return
            try:
                cur = {c["name"]: c for c in inspector.get_columns(table)}.get(col)
                if cur is None:
                    return
                want = int(new_type[len("VARCHAR("):-1])
                have = getattr(cur["type"], "length", None)
                if have is not None and have >= want:
                    return
                with engine.connect() as conn:
                    conn.execute(text(f"ALTER TABLE {table} ALTER COLUMN {col} TYPE {new_type}"))
                    conn.commit()
                logging.getLogger(__name__).info(f"{table}.{col} 을 {new_type} 으로 확장")
            except Exception as me:
                logging.getLogger(__name__).warning(f"컬럼 확장 실패 {table}.{col}: {me}")

        _widen_col("kr_tickers", "market", "VARCHAR(30)")
        _widen_col("kr_tickers", "symbol", "VARCHAR(30)")
        _widen_col("kr_tickers", "code",   "VARCHAR(20)")

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

                # 피드 검색은 LIKE '%...%' 라 앞이 열려 있어 일반 인덱스가 안 먹는다.
                # PostgreSQL 의 trigram 인덱스는 이걸 태울 수 있다. 다만 확장을
                # 못 켜는 환경도 있어, 실패하면 그냥 훑는다 — 느릴 뿐 안 깨진다.
                if engine.dialect.name != "sqlite":
                    try:
                        _idx.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
                        _idx.execute(text("CREATE INDEX IF NOT EXISTS ix_stock_posts_search ON stock_posts USING GIN (search_text gin_trgm_ops)"))
                        _idx.commit()
                    except Exception as _trgm_err:
                        _idx.rollback()
                        _startup_log.info(f"검색 인덱스 없이 진행: {_trgm_err}")
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
            # 이미지를 본문 밖으로 뺀다. 옛 글은 아직 content 안에 있으므로
            # 읽는 쪽에 폴백을 남겨 뒀다 — 이 컬럼이 비어 있어도 안 깨진다.
            ("stock_posts",    "has_image",            "BOOLEAN NOT NULL DEFAULT false"),
            ("stock_posts",    "image_mime",           "VARCHAR(30)"),
            ("stock_posts",    "image_data",           "BLOB" if _is_sqlite else "BYTEA"),
            # 피드 검색용 납작한 사본. content 는 JSON 이라 DB 가 안을 못 본다
            ("stock_posts",    "search_text",          "TEXT"),
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
            # 자산 흐름을 포트폴리오별로 보려면 스냅샷에도 그 구분이 있어야 한다.
            # 0 은 '전체'(사람 단위 합계) — 이 열이 생기기 전에 쌓인 줄이
            # 그대로 0 이 되고, 그 줄들이 곧 전체였으므로 뜻이 맞는다.
            ("portfolio_snapshots", "portfolio_id", "INTEGER NOT NULL DEFAULT 0"),
            # 서버가 자던 날을 나중에 메운 줄인가. 메운 줄은 기둥으로
            # 쓰지 않고 매번 지웠다 다시 넣는다 — 안 그러면 옛 규칙으로
            # 낸 값이 그대로 굳는다(실제로 한 번 굳었다).
            #
            # 이 열이 생기기 전에 메운 줄은 0 으로 들어오는데,
            # portfolio_snapshot._내가_메운것() 이 made_at 으로 가려낸다.
            ("portfolio_snapshots", "backfilled", "INTEGER NOT NULL DEFAULT 0"),
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

        """자산 스냅샷의 한 벌 제약을 (user, day) → (user, portfolio, day) 로.

        이걸 안 바꾸면 포트폴리오별 줄이 통째로 안 들어간다 — 같은 날
        같은 사람의 두 번째 줄이 옛 제약에 걸린다.

        새 것을 먼저 만들고 옛 것을 지운다. 순서를 바꾸면 그 사이에
        스케줄러가 돌 때 중복이 들어올 수 있다.

        SQLite(로컬)에서는 제약을 못 지운다. 대신 거기서는 애초에
        create_all 이 새 모양으로 표를 만들므로 할 일이 없다."""
        try:
            if "portfolio_snapshots" in tables and engine.dialect.name != "sqlite":
                with engine.connect() as _sc:
                    _sc.execute(text(
                        "CREATE UNIQUE INDEX IF NOT EXISTS uq_pf_snapshot_pf_day "
                        "ON portfolio_snapshots (user_id, portfolio_id, day)"))
                    _sc.commit()
                    try:
                        _sc.execute(text(
                            "ALTER TABLE portfolio_snapshots "
                            "DROP CONSTRAINT IF EXISTS uq_pf_snapshot_day"))
                        _sc.commit()
                    except Exception:
                        _sc.rollback()
                    # 제약이 아니라 인덱스로 만들어졌을 수도 있다
                    try:
                        _sc.execute(text("DROP INDEX IF EXISTS uq_pf_snapshot_day"))
                        _sc.commit()
                    except Exception:
                        _sc.rollback()

                    """**정말 지워졌는지 확인한다.**

                    여기가 조용히 실패했다. 위 DROP 두 개가 다 실패해도
                    아래 로그는 '넓혔습니다' 를 찍었다 — 사실이 아닌 줄을
                    남긴 것이고, 그러면 다음 사람이 여기를 안 본다.

                    안 지워지면 무슨 일이 나는지가 크다. 포트폴리오 줄이
                    옛 제약에 걸려 IntegrityError 가 나고, 한 번에 commit
                    하던 탓에 전체 줄까지 같이 날아갔다 — 자산 흐름
                    그래프가 배포한 날에서 그냥 멈춰 섰다.
                    (portfolio_snapshot.찍기() 쪽도 이제 사람마다 따로
                     담아서, 걸려도 전체 줄은 남긴다.)

                    이름이 다를 수도 있다. 옛 제약을 이름으로 못 찾으면
                    (user_id, day) 두 칸짜리 유니크를 찾아 지운다."""
                    남은것 = _sc.execute(text("""
                        SELECT c.conname FROM pg_constraint c
                        JOIN pg_class t ON t.oid = c.conrelid
                        WHERE t.relname = 'portfolio_snapshots' AND c.contype = 'u'
                          AND array_length(c.conkey, 1) = 2
                          AND EXISTS (SELECT 1 FROM unnest(c.conkey) k
                                      JOIN pg_attribute a
                                        ON a.attrelid = t.oid AND a.attnum = k
                                      WHERE a.attname = 'day')
                          AND NOT EXISTS (SELECT 1 FROM unnest(c.conkey) k
                                          JOIN pg_attribute a
                                            ON a.attrelid = t.oid AND a.attnum = k
                                          WHERE a.attname = 'portfolio_id')
                    """)).fetchall()
                    for (이름,) in 남은것:
                        try:
                            _sc.execute(text(
                                f'ALTER TABLE portfolio_snapshots DROP CONSTRAINT "{이름}"'))
                            _sc.commit()
                            _startup_log.info("옛 스냅샷 제약 %s 를 지웠습니다", 이름)
                        except Exception as _e:
                            _sc.rollback()
                            _startup_log.warning(
                                "옛 스냅샷 제약 %s 를 못 지웠습니다: %s — "
                                "포트폴리오별 자산 흐름이 안 쌓입니다", 이름, _e)
                    if 남은것:
                        _startup_log.info("자산 스냅샷 제약을 포트폴리오별로 넓혔습니다")
                    else:
                        _startup_log.info("자산 스냅샷 제약은 이미 포트폴리오별입니다")
        except Exception as _snap_err:
            _startup_log.warning(f"자산 스냅샷 제약 변경 스킵: {_snap_err}")

        # 피드 검색 — 옛 글의 search_text 채우기
        #
        # 컬럼을 만든 이후에 쓴 글만 검색되면, 검색이 되긴 되므로 한참 뒤에야
        # 빈 것을 알아챈다. 한 묶음만 하고 나머지는 다음 시작 때 이어서 한다 —
        # 0.15 CPU 에서 수천 건을 한꺼번에 올리면 그동안 앱이 안 뜬다.
        try:
            from app.api.routes.community import 시작할때_검색문장_채우기
            _n = 시작할때_검색문장_채우기()
            if _n:
                _startup_log.info(f"검색문장 채움: {_n}건 (남은 것은 다음 시작 때)")
        except Exception as _bf_err:
            _startup_log.warning(f"검색문장 채우기 스킵: {_bf_err}")
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


@app.exception_handler(Exception)
async def _오류_남기고_500(request: Request, exc: Exception):
    """터진 것을 남기고, 사용자에게는 짧게 알린다.

    지금까지 서버가 터지면 로그에만 찍혔다. Render 무료 플랜은 재시작이
    잦아 로그가 곧 흘러가고, 그래서 문제를 전부 사용자 제보로 알았다.
    이제 관리자 화면에서 볼 수 있다.

    사용자에게 보내는 본문에는 오류 내용을 안 싣는다 — 스택에는 파일
    경로와 내부 구조가 들어 있어 그대로 내보내면 공격에 쓰인다."""
    from app.core import errors
    errors.남기기(f"{request.method} {request.url.path}", exc,
                  어디서=request.headers.get("referer", ""))
    _startup_log.exception("처리되지 않은 오류: %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요."},
    )
# 이 미들웨어가 없으면 Limiter 의 default_limits 가 실제로는 적용되지 않는다.
# @limiter.limit(...) 을 붙인 라우트만 제한됐고, 대시보드처럼 데코레이터가
# 하나도 없는 라우트는 완전히 무제한이었다 — 임의 category 로 캐시를 밀어내는
# 공격을 아무 제약 없이 반복할 수 있었다.
app.add_middleware(SlowAPIMiddleware)

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


def 접속주소(request: Request) -> str:
    """이 요청이 어디서 왔는지.

    Render 는 프록시 뒤에 있어서 request.client.host 가 프록시 주소
    하나로 잡힌다. 그러면 방문자가 전부 한 사람으로 세어진다.
    X-Forwarded-For 의 맨 앞이 실제 접속자다.

    맨 앞을 그대로 믿는 것은 위조가 가능하지만, 여기서는 방문자 수를
    세는 데만 쓴다 — 위조해 봐야 자기 방문이 여러 번 세어질 뿐이고,
    권한이나 제한에 쓰이지 않는다."""
    앞줄 = request.headers.get("x-forwarded-for", "")
    if 앞줄:
        return 앞줄.split(",")[0].strip()
    return getattr(request.client, "host", "") or ""


class ActivityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # 헬스체크는 사람의 사용이 아니다 — 이걸로 '사용 중'을 판단하면
        # 아무도 안 보는데도 백그라운드 갱신이 계속 돈다
        if request.url.path not in ("/health", "/"):
            from app.core.activity import touch_request, mark_visit
            touch_request()

            누구 = None
            auth = request.headers.get("authorization", "")
            if auth.lower().startswith("bearer "):
                try:
                    from app.core.security import decode_token
                    from app.core.trends import track_usage
                    payload = decode_token(auth[7:])
                    if payload and "sub" in payload:
                        누구 = int(payload["sub"])
                        path = request.url.path
                        for prefix, feature in _FEATURE_PATH_MAP.items():
                            if path.startswith(prefix):
                                track_usage(feature)
                                break
                except Exception:
                    pass

            # 로그인 여부와 상관없이 센다.
            #
            # 예전에는 이 줄이 위의 `if auth...` 안에 있어서 로그인한
            # 사람만 세어졌다. 이 사이트는 로그인 없이도 대시보드·종목
            # 상세·뉴스를 다 볼 수 있으니, 방문자의 대부분이 통째로
            # 안 보이고 있었다.
            try:
                mark_visit(누구, 접속주소(request),
                           request.headers.get("user-agent", ""))
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
    # ── 라우터가 쓰는 메서드를 **다** 적어야 한다 ──
    #
    # PATCH 가 빠져 있었다. 그래서 시세 알림 켜고 끄기가 브라우저의
    # preflight 에서 막혀 서버 코드에 닿지도 못했다 — 지우기(DELETE)는
    # 되는데 켜고 끄기만 안 되던 이유다. 관리자 화면의 PATCH 아홉 개도
    # 같이 막혀 있었다.
    #
    # 조용히 망가지는 방식이 나빴다. 서버 로그에는 아무것도 안 남고
    # (요청이 오지도 않는다), 화면은 낙관 갱신으로 먼저 바꿔 놓고
    # 실패를 받아 되돌리므로 '눌러도 아무 일이 없다' 로만 보인다.
    #
    # tests/test_cors.py 가 라우터를 훑어 빠진 메서드를 잡는다.
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
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
# 브라우저에서 터진 것을 받는 자리. 사용자가 제보자 역할을 안 해도 되게 한다.
app.include_router(clienterr.router,    prefix="/api/v1")
# 가격 알림 — "삼성전자 8만원 되면 알려줘"
app.include_router(alerts.router,       prefix="/api/v1")


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
    raw_syms = [s.strip() for s in symbols.split(",") if s.strip()][:MAX_STREAM_SYMBOLS]
    raw_mkts = [m.strip() for m in markets.split(",") if m.strip()]

    # 시세를 조회할 수 없는 심볼은 빼고 나머지로 연결한다.
    #
    # 예전에는 하나라도 형식에 안 맞으면 연결 자체를 닫았다(code 4000).
    # 포트폴리오는 '현금'·'금'·'채권' 같은 한글 심볼을 허용하므로, 보유종목을
    # 실시간 시세 구독에 함께 넣자마자 관심종목 20개가 통째로 '연결 끊김'이
    # 됐다. 클라이언트는 3초마다 무한 재연결만 반복했다.
    _OK = _re.compile(r"^[A-Za-z0-9.\-]{1,20}$")
    pairs = [(s, m) for s, m in zip(raw_syms, raw_mkts + ["US"] * len(raw_syms)) if _OK.match(s)]
    if not pairs:
        # 구독할 게 하나도 없으면 연결을 열어둘 이유가 없다
        await websocket.close(code=1000)
        return
    if len(pairs) < len(raw_syms):
        _startup_log.info(
            f"실시간 시세: 조회 대상이 아닌 심볼 {len(raw_syms) - len(pairs)}개 제외하고 연결"
        )
    await stream_prices(websocket, [p[0] for p in pairs], [p[1] for p in pairs], interval=interval)


@app.get("/")
def root():
    return {"status": "ok", "message": "Stock Platform API 실행 중"}


@app.get("/health")
def health():
    return {"status": "healthy"}
