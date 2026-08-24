"""관리자 전용 API"""
import json
import re
import logging
import os
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional
from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy.orm import Session, defer, selectinload
from sqlalchemy import text, func
from pydantic import BaseModel, Field
from app.core.deps import require_user
from app.db.database import get_db, engine
from app.models.user import User
from app.models.stock import WatchlistItem, PortfolioItem

log = logging.getLogger(__name__)

# 프로세스가 시작된 시각 — 재시작이 잦은지 판단하는 데 쓴다
_STARTED_AT = time.time()
from slowapi import Limiter
from slowapi.util import get_remote_address
from fastapi import Request

router = APIRouter(prefix="/admin", tags=["관리자"])

"""관리자 API 에도 상한을 둔다.

인가로 이미 막혀 있지만, 잘못 짠 스크립트가 관리자 토큰으로 돌면
0.15 CPU 서버가 그대로 멈춘다. 사람이 손으로 누르는 속도보다는 넉넉하게,
자동 반복은 걸리도록 잡는다."""
limiter = Limiter(key_func=get_remote_address)


def require_admin(current_user: User = Depends(require_user)):
    if not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="관리자 권한이 필요합니다")
    return current_user


def 관리기록(db: Session, actor: User, action: str,
             target_type: str = "", target_id: str = "", detail: str = "") -> None:
    """관리자가 한 일을 남긴다.

    로그 파일에만 남기던 것을 DB 로 옮긴 이유 —
      · 예전 로그에는 '누가' 가 없었다. ADMIN_USERNAME 은 쉼표로 여러 명을
        받으므로 관리자가 둘 이상이면 누가 했는지 알 수 없었다.
      · Render 무료 플랜은 재시작이 잦아 로그가 곧 흘러간다.

    기록에 실패했다고 본 작업까지 막지는 않는다 — 글을 지웠는데 기록이
    안 남는 것보다, 기록 때문에 지우기가 실패하는 쪽이 더 곤란하다.
    다만 조용히 넘어가지는 않고 로그에는 남긴다."""
    from app.models.admin_log import AdminLog
    try:
        db.add(AdminLog(
            actor_id=actor.id,
            actor_name=actor.username or "",
            action=action,
            target_type=target_type,
            target_id=str(target_id)[:80],
            detail=detail[:2000],
        ))
        db.commit()
    except Exception as e:
        db.rollback()
        log.warning("관리 기록 실패 (%s): %s", action, type(e).__name__)
    # 로그에도 남긴다 — 이제는 누가 했는지 함께
    log.info("[관리] %s 가 %s %s %s %s", actor.username, action, target_type, target_id, detail[:120])



# ── 통계 ────────────────────────────────────────────────────────────────────

@router.get("/stats")
def get_stats(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    from app.core.activity import online_count, today_visitor_count
    row = db.execute(text("""
        SELECT
            (SELECT COUNT(*) FROM users)                                           AS total_users,
            (SELECT COUNT(*) FROM users WHERE is_active = TRUE)                    AS active_users,
            (SELECT COUNT(*) FROM watchlist_items)                                 AS watchlist_cnt,
            (SELECT COUNT(*) FROM portfolios)                                      AS portfolio_cnt,
            (SELECT COUNT(*) FROM watchlist_folders)                               AS folder_cnt,
            (SELECT COUNT(*) FROM stock_posts    WHERE is_deleted IS NOT TRUE)     AS post_cnt,
            (SELECT COUNT(*) FROM stock_comments WHERE is_deleted IS NOT TRUE)     AS comment_cnt,
            (SELECT COUNT(*) FROM reports        WHERE status = 'pending')         AS pending_reports
    """)).fetchone()
    return {
        "total_users":       row[0] or 0,
        "active_users":      row[1] or 0,
        "watchlist_items":   row[2] or 0,
        "portfolio_items":   row[3] or 0,
        "watchlist_folders": row[4] or 0,
        "total_posts":       row[5] or 0,
        "total_comments":    row[6] or 0,
        "pending_reports":   row[7] or 0,
        "online_users":      online_count(),
        "today_visitors":    today_visitor_count(),
    }


@router.get("/popular-stocks")
def get_popular_stocks(
    basis: str = "watchlist",
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """인기 종목 TOP 10 — basis: watchlist(관심종목) | portfolio(보유종목)"""
    if basis == "portfolio":
        rows = (
            db.query(
                PortfolioItem.symbol,
                PortfolioItem.name,
                PortfolioItem.market,
                func.count(PortfolioItem.id).label("cnt"),
            )
            .group_by(PortfolioItem.symbol, PortfolioItem.name, PortfolioItem.market)
            .order_by(func.count(PortfolioItem.id).desc())
            .limit(10)
            .all()
        )
    else:
        rows = (
            db.query(
                WatchlistItem.symbol,
                WatchlistItem.name,
                WatchlistItem.market,
                func.count(WatchlistItem.id).label("cnt"),
            )
            .group_by(WatchlistItem.symbol, WatchlistItem.name, WatchlistItem.market)
            .order_by(func.count(WatchlistItem.id).desc())
            .limit(10)
            .all()
        )
    return [{"symbol": r.symbol, "name": r.name or r.symbol, "market": r.market, "count": r.cnt} for r in rows]


@router.get("/visitor-trend")
def get_visitor_trend(_: User = Depends(require_admin)):
    """최근 30일 일별 방문자 수"""
    from app.core.activity import get_visitor_trend
    return get_visitor_trend(30)


@router.get("/signups")
def get_signups(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    """최근 30일 일별 가입자 수"""
    cutoff = datetime.now(timezone.utc) - timedelta(days=29)
    users = db.query(User.created_at).filter(User.created_at >= cutoff).all()

    daily: dict[str, int] = defaultdict(int)
    for (created_at,) in users:
        if created_at:
            try:
                dt = created_at if created_at.tzinfo else created_at.replace(tzinfo=timezone.utc)
                daily[dt.strftime("%Y-%m-%d")] += 1
            except Exception:
                pass

    result = []
    for i in range(29, -1, -1):
        day = (datetime.now(timezone.utc) - timedelta(days=i)).strftime("%Y-%m-%d")
        result.append({"date": day, "count": daily.get(day, 0)})
    return result


@router.get("/db-stats")
def get_db_stats(_: User = Depends(require_admin)):
    """PostgreSQL DB 용량 현황"""
    try:
        with engine.connect() as conn:
            size_row = conn.execute(text(
                "SELECT pg_database_size(current_database()), "
                "pg_size_pretty(pg_database_size(current_database()))"
            )).fetchone()

            table_rows = conn.execute(text("""
                SELECT
                    tablename,
                    pg_total_relation_size(quote_ident(tablename)) AS bytes,
                    pg_size_pretty(pg_total_relation_size(quote_ident(tablename))) AS pretty
                FROM pg_tables
                WHERE schemaname = 'public'
                ORDER BY pg_total_relation_size(quote_ident(tablename)) DESC
                LIMIT 8
            """)).fetchall()

        return {
            "total_bytes":  size_row[0],
            "total_pretty": size_row[1],
            "tables": [{"name": r[0], "bytes": r[1], "pretty": r[2]} for r in table_rows],
        }
    except Exception as e:
        raise HTTPException(500, f"DB 통계 조회 실패: {str(e)[:200]}")


@router.get("/system")
def get_system(_: User = Depends(require_admin)):
    """시스템 상태"""
    from app.core.cache import cache

    db_ok = True
    db_latency_ms = 0
    try:
        import time
        t0 = time.perf_counter()
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        db_latency_ms = round((time.perf_counter() - t0) * 1000, 1)
    except Exception:
        db_ok = False

    return {
        "db_ok":         db_ok,
        "db_latency_ms": db_latency_ms,
        "cache_size":    cache.size(),
        "server_time":   datetime.now(timezone.utc).isoformat(),
    }


def _news_status() -> dict:
    """뉴스 캐시는 압축돼 있어 한 번 읽을 때마다 압축을 푼다.
    같은 캐시를 세 번 읽으면 그만큼 헛일이라 한 번만 읽는다."""
    from app.core.cache import cache
    from app.services import news_service
    kr = cache.get_stale("news:kr") or []
    us = cache.get_stale("news:us") or []
    쉬는곳 = sorted(이름 for 이름, _ in news_service.KR_FEEDS + news_service.US_FEEDS
                    if news_service._쉬는가(이름))
    return {
        "kr_feeds":   len(news_service.KR_FEEDS),
        "us_feeds":   len(news_service.US_FEEDS),
        "batch":      news_service._FEED_BATCH,
        "kr_cached":  len(kr),
        "us_cached":  len(us),
        "kr_sources": sorted({a.get("source") for a in kr if a.get("source")}),
        # 계속 실패해서 뒤로 물린 곳. '지금 실패 중' 과 갈라 보여 줘야
        # 관리자가 '서버가 매 회차 여기에 시간을 쓰고 있다' 고 오해하지 않는다
        "resting":    쉬는곳,
        "rest_after": news_service._쉼_기준,
        "probe":      news_service._되살림_칸,
        # 금리·지수도 같은 방식으로 쉬는 곳을 둔다. 여기 안 보이면
        # '왜 콜금리가 화면에 없나' 를 서버 로그로 뒤져야 했다.
        "rate_resting":  _쉬는금리(),
        "index_resting": _쉬는지수(),
    }


def _쉬는금리() -> list:
    """지금 쉬고 있는 금리 후보. 화면에는 후보 코드가 아니라 어떤 금리가
    아직 못 들어왔는지를 보여 준다 — 코드 이름은 관리자에게 뜻이 없다."""
    try:
        from app.services import market_extras as me
        쉬는코드 = set(me.금리쉼표.쉬는것들())
        못찾은것 = [이름 for 이름, _, 코드들 in me._네이버_금리후보
                    if all(f"rate:{c}" in 쉬는코드 for c in 코드들)]
        못찾은것 += [이름 for 이름, 코드 in me._시장지표_금리
                     if f"지표:{코드}" in 쉬는코드 and 이름 not in 못찾은것]
        return sorted(set(못찾은것))
    except Exception:
        return []


@router.get("/rates-diagnosis")
def get_rates_diagnosis(_: User = Depends(require_admin)):
    """국내 금리를 원천별로 뭘 해 봤고 뭐가 돌아왔는지.

    "콜금리 회사채 안뜸" 을 두 번 들었는데, 두 번 다 원인을 화면에서
    확인할 방법이 없었다. 작업 환경에서는 네이버·KRX·ECOS 가 전부
    막혀 있어 코드를 고쳐도 맞는지 알 수가 없고, 배포한 뒤에도 '안
    나온다' 만 보일 뿐 왜 안 나오는지는 안 보였다.

    이 화면을 보면 다음 한 번에 고칠 수 있다 —
      · '실패(...)' 면 그 원천에 서버가 못 닿는 것이다
      · '빈손' 이면 닿기는 하는데 그 항목을 안 주는 것이다(코드가 틀렸다)
      · ECOS 가 계속 빈손이면 BOK_API_KEY 를 봐야 한다. 기본값 'sample'
        은 대부분의 통계가 막혀 있다 — ecos.bok.or.kr 에서 무료로 받는다.
    """
    from app.services.market_extras import 금리진단, get_kr_rates
    from app.core.config import settings as _s
    지금값 = get_kr_rates()
    키 = getattr(_s, "BOK_API_KEY", "sample") or "sample"
    return {
        "원천별": 금리진단(),
        "지금_나가는_것": [x.get("name") for x in 지금값],
        "쉬는_후보": _쉬는금리(),
        "bok_api_key": "기본값 sample (대부분 통계 막힘)" if 키 == "sample" else "설정됨",
    }


def _쉬는지수() -> list:
    try:
        from app.services import price_fetcher as pf
        return pf.지수쉼표.쉬는것들()
    except Exception:
        return []


@router.get("/runtime")
def get_runtime(_: User = Depends(require_admin)):
    """서버 자원과 백그라운드 작업 상태.

    이 화면이 없어서, 메모리 한도 초과나 백그라운드 루프 중단 같은 문제를
    Render 알림 메일이나 사용자 제보로 뒤늦게 알았다. 지금 무엇이 돌고 있고
    자원을 얼마나 쓰는지 한 화면에서 보이게 한다."""
    from app.core.cache import cache
    from app.core import memory, cpu, activity, health, libmem
    from app.services import scheduler, watched, market_hours, news_service, ticker_service

    used_mb = memory.rss_mb()
    limit_mb = memory.MEMORY_LIMIT_MB
    cache_stats = cache.stats()

    tasks = []
    for t in scheduler._tasks:
        err = None
        if t.done() and not t.cancelled():
            e = t.exception()
            err = f"{type(e).__name__}: {e}" if e else None
        tasks.append({
            "name":    t.get_name(),
            "running": not t.done(),
            "error":   err,
        })
    # 떠 있어야 하는데 목록에 없는 루프도 드러낸다
    expected = {"startup-prefetch", "periodic-refresh", "watched-prices"}
    for name in sorted(expected - {t["name"] for t in tasks}):
        tasks.append({"name": name, "running": False, "error": "시작되지 않음"})

    idle_sec = activity.seconds_since_last_request()
    from app.api.websocket.price_stream import _ws_connections, MAX_WS_PER_IP
    kr, us = market_hours.kr_session(), market_hours.us_session()
    watched_stats = watched.stats()

    return {
        "memory": {
            "used_mb":   round(used_mb, 1) if used_mb else None,
            "limit_mb":  limit_mb,
            "percent":   round(used_mb / limit_mb * 100) if used_mb else None,
            "cache_mb":  cache_stats["mb"],
            "cache_limit_mb": cache_stats["limit_mb"],
            "cache_items":    cache_stats["items"],
            "cache_packed":   cache_stats["packed"],
            # 만료된 값 보관분. 예전에는 이 몫이 보고에서 빠져 있어,
            # 화면에 10MB 로 보이는 동안 실제로는 수백 MB 였다.
            "cache_fresh_mb": cache_stats["fresh_mb"],
            "cache_stale_mb": cache_stats["stale_mb"],
            "cache_stale_items": cache_stats["stale_items"],
        },
        "cpu": {
            "quota":        round(cpu.cpu_quota(), 2),
            "reported":     os.cpu_count(),
            "news_workers": news_service._FEED_WORKERS,
        },
        "tasks": tasks,
        "market": {
            "kr": kr, "us": us,
            "kr_label": market_hours.session_label("KR"),
            "us_label": market_hours.session_label("US"),
            "price_interval_sec": market_hours.refresh_interval(
                [kr, us], symbol_count=sum(1 for _, m in watched.snapshot() if m == "KR")
            ),
        },
        "watched": watched_stats,
        "idle": {
            "seconds":   round(idle_sec),
            "paused":    idle_sec > scheduler.IDLE_PAUSE_SEC,
            "pause_after_sec": scheduler.IDLE_PAUSE_SEC,
        },
        "news": _news_status(),
        "heavy_prefetch": scheduler.HEAVY_PREFETCH,
        # 최근 성공/실패 이력 — '언제 마지막으로 성공했는지'가 없어서
        # 문제를 찾는 데 매번 오래 걸렸다
        "health": health.snapshot(),
        # '나머지 411MB' 한 줄로 뭉쳐 있던 것을 쪼갠다 —
        # 어떤 라이브러리가 얼마를 쓰는지, 어떤 데이터가 몇 건 올라와 있는지
        # '파이썬 자체·기타'가 무엇인지 커널에게 직접 물어본다.
        # 코드(공유)와 데이터(전용)를 나누면 줄일 수 있는 부분이 드러난다
        "proc": memory.proc_breakdown(),
        "objects": memory.object_stats(),
        "mem_trend": memory.trend(),
        # 무엇이 늘고 있는지 (MEM_TRACE=1 일 때만)
        "alloc_growth": memory.alloc_growth(),
        # 파이썬이 못 보는 영역 — C 라이브러리가 들고 있는 메모리
        "native": memory.native_breakdown(),
        "last_trim": memory.last_trim(),
        "libraries": libmem.report(),
        "data_stores": memory.data_stores(),
        # 종목 목록이 어디서 왔는지. 세 단계 폴백이 전부 조용히 실패해
        # 내장 115개로 서비스하던 것을 아무도 몰랐던 적이 있다
        "kr_tickers": ticker_service.kr_status(),
        # 미국도 같은 이유다. 코드에 적어둔 128개로 도는 동안 화면에는
        # 아무 표시가 없었고, 사용자가 '미국 모든 종목이 조회 가능하면
        # 좋겠어'라고 말하고서야 알았다
        "us_tickers": ticker_service.us_status(),
        "cache_breakdown": cache.by_prefix()[:10],
        "websocket": {
            "connections": sum(_ws_connections.values()),
            "limit_per_ip": MAX_WS_PER_IP,
        },
        "uptime_sec": round(time.time() - _STARTED_AT),
        "server_time": datetime.now(timezone.utc).isoformat(),
    }


@router.post("/cache/clear")
@limiter.limit("30/minute")
def clear_cache(request: Request, db: Session = Depends(get_db), current: User = Depends(require_admin)):
    """인메모리 캐시 전체 초기화"""
    from app.core.cache import cache
    size_before = cache.size()
    cache.clear()
    관리기록(db, current, "cache.clear", "cache", "*", f"{size_before}건 삭제")
    return {"cleared": size_before}


@router.get("/cache")
def list_cache(prefix: str = "", _: User = Depends(require_admin)):
    """인메모리 캐시 키 전체 목록 (prefix로 필터링 가능)"""
    from app.core.cache import cache
    items = cache.keys_with_ttl()
    if prefix:
        items = [i for i in items if i["key"].startswith(prefix)]
    return {"count": len(items), "items": items}


@router.delete("/cache/{key:path}")
@limiter.limit("60/minute")
def delete_cache_key(request: Request, key: str, db: Session = Depends(get_db), current: User = Depends(require_admin)):
    """특정 캐시 키 삭제"""
    from app.core.cache import cache
    cache.delete(key)
    관리기록(db, current, "cache.delete", "cache", key)
    return {"deleted": key}


@router.delete("/cache")
@limiter.limit("30/minute")
def delete_cache_prefix(request: Request, prefix: str, db: Session = Depends(get_db), current: User = Depends(require_admin)):
    """prefix로 시작하는 캐시 키 일괄 삭제"""
    from app.core.cache import cache
    count = cache.delete_pattern(prefix)
    관리기록(db, current, "cache.delete_prefix", "cache", prefix, f"{count}건")
    return {"deleted_count": count, "prefix": prefix}


# ── 유저 관리 ────────────────────────────────────────────────────────────────

@router.get("/users")
def get_users(
    status: str = Query(default="all", pattern="^(all|active|inactive)$"),
    page:   int = Query(1, ge=1),
    limit:  int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    q = db.query(User).order_by(User.id.desc())
    if status == "active":
        q = q.filter(User.is_active == True)
    elif status == "inactive":
        q = q.filter(User.is_active == False)
    total = q.count()
    users = q.offset((page - 1) * limit).limit(limit).all()
    return {
        "total": total,
        "items": [
            {
                "id":                  u.id,
                "username":            u.username,
                "email":               u.email,
                "is_active":           u.is_active,
                "is_admin":            u.is_admin,
                "is_community_banned": bool(getattr(u, "is_community_banned", False)),
                "created_at":          str(u.created_at) if u.created_at else None,
            }
            for u in users
        ]
    }


@router.patch("/users/{user_id}/active")
@limiter.limit("30/minute")
def toggle_active(request: Request, user_id: int, db: Session = Depends(get_db), current: User = Depends(require_admin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")
    if user.id == current.id:
        raise HTTPException(status_code=400, detail="자신의 계정은 변경할 수 없습니다")
    # 동료 관리자를 정지시킬 수 있으면 서로 잠글 수 있다
    if user.is_admin:
        raise HTTPException(status_code=400, detail="관리자 계정은 변경할 수 없습니다")
    user.is_active = not user.is_active
    db.commit()
    관리기록(db, current, "user.active", "user", user.id,
             f"{user.username} → {'활성' if user.is_active else '정지'}")
    return {"id": user.id, "is_active": user.is_active}


@router.patch("/users/{user_id}/community-ban")
@limiter.limit("30/minute")
def toggle_community_ban(request: Request, user_id: int, db: Session = Depends(get_db), current: User = Depends(require_admin)):
    """커뮤니티 차단/해제 — 로그인 자체는 유지, 커뮤니티 쓰기만 차단"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")
    if user.id == current.id:
        raise HTTPException(status_code=400, detail="자신의 계정은 변경할 수 없습니다")
    if user.is_admin:
        raise HTTPException(status_code=400, detail="관리자 계정은 변경할 수 없습니다")
    current_val = bool(getattr(user, "is_community_banned", False))
    user.is_community_banned = not current_val
    db.commit()
    관리기록(db, current, "user.community_ban", "user", user.id,
             f"{user.username} → {'차단' if user.is_community_banned else '해제'}")
    return {"id": user.id, "is_community_banned": user.is_community_banned}


@router.delete("/users/{user_id}")
@limiter.limit("10/minute")
def delete_user(request: Request, user_id: int, db: Session = Depends(get_db), current: User = Depends(require_admin)):
    """계정 삭제.

    예전에는 db.delete(user) 한 줄이었다. 그런데 users.id 를 참조하는 표가
    열 개가 넘는데(글·댓글·좋아요·팔로우·투표·프로필·신고·알림·관심종목·
    포트폴리오) User 쪽에는 cascade 선언이 없다. 프로덕션(PostgreSQL)에서는
    외래키 위반으로 500 이 나고, SQLite 에서는 주인 없는 행이 남는다.
    화면에 이 버튼이 없어서 아무도 안 밟았을 뿐이다.

    사람이 남긴 글까지 통째로 지우는 것은 되돌릴 수 없는 일이라, 기본은
    '비활성화' 를 권한다(계정 정지). 그래도 지워야 할 때가 있으므로
    (탈퇴 요청·스팸 계정) 딸린 것을 순서대로 정리하고 지운다.
    """
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")
    if user.id == current.id:
        raise HTTPException(status_code=400, detail="자신의 계정은 삭제할 수 없습니다")
    # 동료 관리자를 지울 수 있으면 한 사람이 나머지를 다 밀어낼 수 있다
    if user.is_admin:
        raise HTTPException(status_code=400, detail="관리자 계정은 삭제할 수 없습니다. 먼저 권한을 내려 주세요")

    이름 = user.username
    지운수 = {}
    try:
        # 딸린 것부터 정리한다. 순서가 중요하다 — 좋아요·투표처럼 남을 가리키는
        # 것을 먼저 지우고, 그다음 글·댓글, 마지막이 사람이다.
        for 표, 칸 in [
            ("stock_post_likes",    "user_id"),
            ("stock_comment_likes", "user_id"),
            ("stock_post_poll_votes", "user_id"),
            ("user_follows",        "follower_id"),
            ("user_follows",        "following_id"),
            ("reports",             "reporter_id"),
            ("notifications",       "user_id"),
            ("notifications",       "actor_id"),
            ("stock_comments",      "user_id"),
            ("stock_posts",         "user_id"),
            ("user_profiles",       "user_id"),
            ("watchlist_items",     "user_id"),
            ("portfolio_items",     "user_id"),
            ("watchlists",          "user_id"),
            ("portfolios",          "user_id"),
        ]:
            try:
                r = db.execute(text(f"DELETE FROM {표} WHERE {칸} = :uid"), {"uid": user_id})
                if r.rowcount:
                    지운수[f"{표}.{칸}"] = r.rowcount
            except Exception:
                # 아직 없는 표가 있을 수 있다(마이그레이션 전). 그건 지울 것도 없다
                db.rollback()
        db.delete(user)
        db.commit()
    except Exception as e:
        db.rollback()
        log.error("계정 삭제 실패 user_id=%s: %s: %s", user_id, type(e).__name__, e)
        raise HTTPException(status_code=500, detail="삭제하지 못했습니다. 계정 정지를 대신 사용해 주세요")

    관리기록(db, current, "user.delete", "user", user_id,
             f"{이름} · 함께 지운 것 {지운수}")
    return {"message": "삭제 완료", "deleted": 지운수}


@router.get("/users/{user_id}/detail")
def get_user_detail(user_id: int, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    """유저 상세 정보 (통계 + 최근 게시글)"""
    from app.models.community import StockPost
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(404, "사용자를 찾을 수 없습니다")
    row = db.execute(text("""
        SELECT
            (SELECT COUNT(*) FROM stock_posts    WHERE user_id = :uid AND is_deleted IS NOT TRUE) AS post_cnt,
            (SELECT COUNT(*) FROM stock_comments WHERE user_id = :uid AND is_deleted IS NOT TRUE) AS comment_cnt,
            (SELECT COUNT(*) FROM reports        WHERE reporter_id = :uid)                        AS report_sent,
            (SELECT COUNT(*) FROM user_follows   WHERE follower_id  = :uid)                      AS following_cnt,
            (SELECT COUNT(*) FROM user_follows   WHERE following_id = :uid)                      AS follower_cnt
    """), {"uid": user_id}).fetchone()
    recent_posts = (
        db.query(StockPost)
        .filter(StockPost.user_id == user_id, StockPost.is_deleted.isnot(True))
        .order_by(StockPost.created_at.desc())
        .limit(5)
        .all()
    )
    posts_list = []
    for p in recent_posts:
        try:
            cd = json.loads(p.content)
            title = (cd.get("title") or cd.get("body") or "")[:100]
        except Exception:
            title = str(p.content)[:100]
        posts_list.append({
            "id": p.id, "symbol": p.symbol, "market": p.market,
            "title": title, "created_at": p.created_at.isoformat() if p.created_at else None,
        })
    return {
        "id":                  user.id,
        "username":            user.username,
        "email":               user.email,
        "is_active":           user.is_active,
        "is_admin":            user.is_admin,
        "is_community_banned": bool(getattr(user, "is_community_banned", False)),
        "created_at":          str(user.created_at) if user.created_at else None,
        "post_count":          row[0] or 0,
        "comment_count":       row[1] or 0,
        "report_sent_count":   row[2] or 0,
        "following_count":     row[3] or 0,
        "follower_count":      row[4] or 0,
        "recent_posts":        posts_list,
    }


@router.get("/users/{user_id}/items")
def get_user_items(
    user_id: int,
    kind: Literal["posts", "comments", "reports", "followers", "following"] = Query(...),
    limit:  int = Query(30, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """유저 상세의 숫자를 눌렀을 때 나오는 실제 내용.

    예전에는 '게시글 12 · 댓글 30 · 신고 보냄 3' 처럼 숫자만 있었다. 그런데
    관리자가 이 화면을 여는 이유는 대개 '이 사람이 무슨 글을 썼길래' 를
    확인하려는 것이라, 숫자만 봐서는 다음 행동을 정할 수 없었다.

    삭제·블라인드된 것도 보여 준다 — 관리자에게는 그게 오히려 봐야 할
    대상이다. 대신 상태를 함께 준다.
    """
    if not db.query(User.id).filter(User.id == user_id).first():
        raise HTTPException(404, "사용자를 찾을 수 없습니다")

    def _제목(내용: str) -> str:
        """글 본문은 JSON 으로 저장돼 있다(제목·본문·이미지)."""
        try:
            cd = json.loads(내용)
            return (cd.get("title") or cd.get("body") or "")[:120]
        except Exception:
            return str(내용)[:120]

    if kind == "posts":
        총 = db.execute(text("SELECT COUNT(*) FROM stock_posts WHERE user_id = :u"),
                        {"u": user_id}).scalar() or 0
        rows = db.execute(text("""
            SELECT id, symbol, market, content, is_deleted, is_blinded,
                   like_count, comment_count, created_at
            FROM stock_posts WHERE user_id = :u
            ORDER BY created_at DESC LIMIT :l OFFSET :o
        """), {"u": user_id, "l": limit, "o": offset}).mappings().all()
        items = [{
            "id": r["id"], "symbol": r["symbol"], "market": r["market"],
            "text": _제목(r["content"]),
            "deleted": bool(r["is_deleted"]), "blinded": bool(r["is_blinded"]),
            "likes": r["like_count"] or 0, "comments": r["comment_count"] or 0,
            "created_at": str(r["created_at"]) if r["created_at"] else None,
        } for r in rows]

    elif kind == "comments":
        총 = db.execute(text("SELECT COUNT(*) FROM stock_comments WHERE user_id = :u"),
                        {"u": user_id}).scalar() or 0
        rows = db.execute(text("""
            SELECT c.id, c.post_id, c.content, c.is_deleted, c.is_blinded,
                   c.like_count, c.created_at, p.symbol, p.market
            FROM stock_comments c
            LEFT JOIN stock_posts p ON p.id = c.post_id
            WHERE c.user_id = :u
            ORDER BY c.created_at DESC LIMIT :l OFFSET :o
        """), {"u": user_id, "l": limit, "o": offset}).mappings().all()
        items = [{
            "id": r["id"], "post_id": r["post_id"],
            "symbol": r["symbol"], "market": r["market"],
            "text": str(r["content"] or "")[:120],
            "deleted": bool(r["is_deleted"]), "blinded": bool(r["is_blinded"]),
            "likes": r["like_count"] or 0,
            "created_at": str(r["created_at"]) if r["created_at"] else None,
        } for r in rows]

    elif kind == "reports":
        총 = db.execute(text("SELECT COUNT(*) FROM reports WHERE reporter_id = :u"),
                        {"u": user_id}).scalar() or 0
        rows = db.execute(text("""
            SELECT id, post_id, comment_id, reason, status, created_at
            FROM reports WHERE reporter_id = :u
            ORDER BY created_at DESC LIMIT :l OFFSET :o
        """), {"u": user_id, "l": limit, "o": offset}).mappings().all()
        items = [{
            "id": r["id"], "post_id": r["post_id"], "comment_id": r["comment_id"],
            "text": r["reason"] or "", "status": r["status"] or "pending",
            "created_at": str(r["created_at"]) if r["created_at"] else None,
        } for r in rows]

    else:
        # 팔로워는 나를 따르는 사람, 팔로잉은 내가 따르는 사람
        내칸, 상대칸 = (("following_id", "follower_id") if kind == "followers"
                        else ("follower_id", "following_id"))
        총 = db.execute(text(f"SELECT COUNT(*) FROM user_follows WHERE {내칸} = :u"),
                        {"u": user_id}).scalar() or 0
        rows = db.execute(text(f"""
            SELECT f.{상대칸} AS uid, u.username, u.is_active, u.created_at
            FROM user_follows f
            LEFT JOIN users u ON u.id = f.{상대칸}
            WHERE f.{내칸} = :u
            ORDER BY f.created_at DESC LIMIT :l OFFSET :o
        """), {"u": user_id, "l": limit, "o": offset}).mappings().all()
        items = [{
            "id": r["uid"], "username": r["username"] or f"(탈퇴 {r['uid']})",
            "is_active": bool(r["is_active"]) if r["is_active"] is not None else None,
            "created_at": str(r["created_at"]) if r["created_at"] else None,
        } for r in rows]

    return {"kind": kind, "total": 총, "items": items}


@router.get("/community/posts/{post_id}/likes")
def admin_post_likes(
    post_id: int,
    limit:  int = Query(100, ge=1, le=300),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """이 글에 좋아요를 누른 사람들.

    화면에는 개수만 있었다. 그런데 좋아요가 갑자기 몰리면 관리자가 보고
    싶은 것은 '몇 개' 가 아니라 '누가' 다 — 같은 사람이 여러 계정으로
    누르는지, 서로 밀어 주는 무리가 있는지는 이름을 봐야 알 수 있다.

    관리자 전용이다. 일반 사용자에게는 이 목록을 주지 않는다 —
    누가 눌렀는지는 그 사람의 활동 기록이고, 공개할 이유가 없다.
    """
    총 = db.execute(text("SELECT COUNT(*) FROM stock_post_likes WHERE post_id = :p"),
                    {"p": post_id}).scalar() or 0
    rows = db.execute(text("""
        SELECT l.user_id, u.username, u.is_active, u.is_admin
        FROM stock_post_likes l
        LEFT JOIN users u ON u.id = l.user_id
        WHERE l.post_id = :p
        ORDER BY l.id DESC LIMIT :l OFFSET :o
    """), {"p": post_id, "l": limit, "o": offset}).mappings().all()
    return {
        "total": 총,
        "items": [{
            "id": r["user_id"],
            # 탈퇴한 사람도 좋아요 행은 남는다 — 빈 줄이 되지 않게 표시한다
            "username": r["username"] or f"(탈퇴 {r['user_id']})",
            "is_active": bool(r["is_active"]) if r["is_active"] is not None else None,
            "is_admin": bool(r["is_admin"]) if r["is_admin"] is not None else False,
        } for r in rows],
    }


# ── 커뮤니티 관리 ────────────────────────────────────────────────────────────

@router.get("/community/posts")
def admin_list_posts(
    page:   int           = Query(1, ge=1),
    limit:  int           = Query(20, ge=1, le=50),
    market: Optional[str] = Query(None),
    db:     Session       = Depends(get_db),
    _:      User          = Depends(require_admin),
):
    from app.models.community import StockPost
    q = db.query(StockPost).filter(StockPost.is_deleted.isnot(True))
    if market and market in ("KR", "US", "ETF"):
        q = q.filter(StockPost.market == market)
    total = q.count()
    posts = (
        q.options(
            defer(StockPost.comment_count),
            defer(StockPost.updated_at),
            selectinload(StockPost.user),
        )
        .order_by(StockPost.created_at.desc())
        .offset((page - 1) * limit)
        .limit(limit)
        .all()
    )
    result = []
    for p in posts:
        try:
            cd = json.loads(p.content)
            title = cd.get("title", "")[:200]
            body  = cd.get("body",  "")[:200]
        except Exception:
            title = ""
            body  = str(p.content)[:200]
        result.append({
            "id":         p.id,
            "symbol":     p.symbol,
            "market":     p.market,
            "user_id":    p.user_id,
            "username":   p.user.username if p.user else "—",
            "title":      title,
            "body":       body,
            "like_count": getattr(p, "like_count", 0) or 0,
            "is_blinded": bool(getattr(p, "is_blinded", False)),
            "created_at": p.created_at.isoformat(),
        })
    return {"total": total, "items": result}


@router.delete("/community/posts/{post_id}", status_code=204)
@limiter.limit("60/minute")
def admin_delete_post(
    request: Request,
    post_id: int     = Path(...),
    db:      Session = Depends(get_db),
    current: User    = Depends(require_admin),
):
    from app.models.community import StockPost
    post = (
        db.query(StockPost)
        .filter(StockPost.id == post_id)
        .options(defer(StockPost.comment_count), defer(StockPost.updated_at))
        .first()
    )
    if not post:
        raise HTTPException(404, "게시글을 찾을 수 없습니다")
    db.execute(text("DELETE FROM stock_post_poll_votes WHERE post_id = :pid"), {"pid": post_id})
    db.delete(post)
    db.commit()
    관리기록(db, current, "post.delete", "post", post_id)


@router.patch("/community/posts/{post_id}/blind")
def admin_blind_post(
    post_id: int     = Path(...),
    db:      Session = Depends(get_db),
    current: User    = Depends(require_admin),
):
    from app.models.community import StockPost
    post = db.query(StockPost).filter(StockPost.id == post_id).first()
    if not post:
        raise HTTPException(404, "게시글을 찾을 수 없습니다")
    post.is_blinded = True
    db.commit()
    관리기록(db, current, "post.blind", "post", post_id)
    return {"id": post_id, "is_blinded": True}


@router.patch("/community/posts/{post_id}/unblind")
def admin_unblind_post(
    post_id: int     = Path(...),
    db:      Session = Depends(get_db),
    current: User    = Depends(require_admin),
):
    from app.models.community import StockPost
    post = db.query(StockPost).filter(StockPost.id == post_id).first()
    if not post:
        raise HTTPException(404, "게시글을 찾을 수 없습니다")
    post.is_blinded = False
    db.commit()
    관리기록(db, current, "post.unblind", "post", post_id)
    return {"id": post_id, "is_blinded": False}


# ── 댓글 관리 ────────────────────────────────────────────────────────────────

@router.get("/community/comments")
def admin_list_comments(
    page:    int           = Query(1, ge=1),
    limit:   int           = Query(20, ge=1, le=50),
    post_id: Optional[int] = Query(None),
    db:      Session       = Depends(get_db),
    _:       User          = Depends(require_admin),
):
    from app.models.community import StockComment
    q = db.query(StockComment).filter(StockComment.is_deleted.isnot(True))
    if post_id:
        q = q.filter(StockComment.post_id == post_id)
    total = q.count()
    comments = (
        q.options(selectinload(StockComment.user))
        .order_by(StockComment.created_at.desc())
        .offset((page - 1) * limit)
        .limit(limit)
        .all()
    )
    return {
        "total": total,
        "items": [
            {
                "id":         c.id,
                "post_id":    c.post_id,
                "user_id":    c.user_id,
                "username":   c.user.username if c.user else "—",
                "content":    str(c.content)[:300],
                "is_blinded": bool(getattr(c, "is_blinded", False)),
                "parent_id":  c.parent_id,
                "created_at": c.created_at.isoformat() if c.created_at else None,
            }
            for c in comments
        ],
    }


@router.delete("/community/comments/{comment_id}", status_code=204)
@limiter.limit("60/minute")
def admin_delete_comment(
    request: Request,
    comment_id: int     = Path(...),
    db:         Session = Depends(get_db),
    current:    User    = Depends(require_admin),
):
    from app.models.community import StockComment
    comment = db.query(StockComment).filter(StockComment.id == comment_id).first()
    if not comment:
        raise HTTPException(404, "댓글을 찾을 수 없습니다")
    comment.is_deleted = True
    db.commit()
    관리기록(db, current, "comment.delete", "comment", comment_id)


@router.patch("/community/comments/{comment_id}/blind")
def admin_blind_comment(
    comment_id: int     = Path(...),
    db:         Session = Depends(get_db),
    current:    User    = Depends(require_admin),
):
    from app.models.community import StockComment
    comment = db.query(StockComment).filter(StockComment.id == comment_id).first()
    if not comment:
        raise HTTPException(404, "댓글을 찾을 수 없습니다")
    comment.is_blinded = True
    db.commit()
    관리기록(db, current, "comment.blind", "comment", comment_id)
    return {"id": comment_id, "is_blinded": True}


@router.patch("/community/comments/{comment_id}/unblind")
def admin_unblind_comment(
    comment_id: int     = Path(...),
    db:         Session = Depends(get_db),
    current:    User    = Depends(require_admin),
):
    from app.models.community import StockComment
    comment = db.query(StockComment).filter(StockComment.id == comment_id).first()
    if not comment:
        raise HTTPException(404, "댓글을 찾을 수 없습니다")
    comment.is_blinded = False
    db.commit()
    관리기록(db, current, "comment.unblind", "comment", comment_id)
    return {"id": comment_id, "is_blinded": False}


# ── 공지사항 ──────────────────────────────────────────────────────────────────

@router.get("/announcement")
def get_announcement():
    try:
        with engine.connect() as conn:
            row = conn.execute(text("SELECT value FROM system_settings WHERE key = 'announcement'")).fetchone()
            return {"text": row[0] if row else ""}
    except Exception:
        return {"text": ""}


class 공지요청(BaseModel):
    """공지는 모든 사용자가 보는 글이다.

    예전에는 body: dict 로 받고 `(body.get("text") or "")[:500]` 했다.
    text 자리에 숫자나 dict 가 오면 그 자리에서 500 이 난다 — 관리자만
    부르는 곳이라 급하진 않지만, 형식을 적어 두면 그런 요청은 422 로
    또렷하게 돌려보낸다."""
    text: str = Field(default="", max_length=500)


@router.post("/announcement")
def set_announcement(body: 공지요청, db: Session = Depends(get_db),
                     current: User = Depends(require_admin)):
    text_val = body.text
    try:
        with engine.connect() as conn:
            conn.execute(
                text("INSERT INTO system_settings (key, value) VALUES ('announcement', :v) ON CONFLICT (key) DO UPDATE SET value = :v"),
                {"v": text_val},
            )
            conn.commit()
        관리기록(db, current, "announcement.set", "announcement", "-",
                 text_val[:200] or "(지움)")
        return {"text": text_val}
    except Exception as e:
        log.error(f"공지사항 저장 실패: {e}")
        raise HTTPException(status_code=500, detail="저장 실패")


# ── 팝업 관리 ──────────────────────────────────────────────────────────────────

def _popup_dict(p) -> dict:
    return {
        "id":         p.id,
        "popup_type": p.popup_type,
        "title":      p.title,
        "content":    p.content,
        "link_url":   p.link_url,
        "link_text":  p.link_text,
        "bg_color":   p.bg_color,
        "is_active":  p.is_active,
        "starts_at":  p.starts_at.isoformat() if p.starts_at else None,
        "ends_at":    p.ends_at.isoformat() if p.ends_at else None,
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


@router.get("/popups/active")
def get_active_popups(db: Session = Depends(get_db)):
    """현재 노출 중인 팝업 목록 (인증 불필요 — 프론트엔드 레이아웃에서 호출)"""
    from app.models.community import SitePopup
    now = datetime.now(timezone.utc)
    popups = (
        db.query(SitePopup)
        .filter(
            SitePopup.is_active == True,
            (SitePopup.starts_at == None) | (SitePopup.starts_at <= now),
            (SitePopup.ends_at == None) | (SitePopup.ends_at >= now),
        )
        .order_by(SitePopup.id.desc())
        .all()
    )
    return [_popup_dict(p) for p in popups]


@router.get("/popups")
def list_popups(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    from app.models.community import SitePopup
    popups = db.query(SitePopup).order_by(SitePopup.id.desc()).all()
    return [_popup_dict(p) for p in popups]


def _safe_link_url(raw):
    """팝업 배너의 이동 주소 — http/https만 허용한다.

    관리자만 입력하지만 모든 사용자에게 노출되는 링크다. 계정이 탈취되면
    javascript: 같은 실행 가능한 스킴이 들어갈 수 있고, 배너를 누른 사용자의
    브라우저에서 우리 사이트 권한으로 코드가 돈다.
    """
    if raw is None or raw == "":
        return None
    if not isinstance(raw, str):
        raise HTTPException(422, "링크 형식이 올바르지 않습니다")
    cleaned = re.sub(r"[\s\x00-\x1f]+", "", raw)
    if not cleaned:
        return None
    if cleaned.startswith("//"):
        return "https:" + raw.strip()
    scheme = cleaned.split(":", 1)[0].lower() if ":" in cleaned else ""
    if scheme in ("http", "https"):
        return raw.strip()
    raise HTTPException(422, "링크는 http:// 또는 https:// 로 시작해야 합니다")


class 팝업요청(BaseModel):
    """팝업도 모든 사용자가 보는 것이다.

    예전에는 body: dict 였고 세 가지가 새어 나갔다.
      · content·link_text 에 길이 제한이 없었다. 몇 MB 짜리 글이 그대로
        DB 에 들어간다.
      · starts_at·ends_at 을 문자열 그대로 DateTime 칸에 넣었다.
        모양이 틀리면 그 자리에서 500 이 난다.
      · popup_type 에 숫자가 오면 `[:20]` 이 터진다.

    관리자만 부르는 곳이라 공격보다는 '실수로 화면을 망가뜨리는' 쪽이
    문제다. 그래도 형식을 적어 두면 잘못된 요청이 422 로 또렷하게 돌아간다."""
    popup_type: str = Field(default="info", max_length=20)
    title: str = Field(default="", max_length=200)
    content: Optional[str] = Field(default=None, max_length=4000)
    link_url: Optional[str] = None
    link_text: Optional[str] = Field(default=None, max_length=100)
    bg_color: str = Field(default="blue", max_length=20)
    is_active: bool = True
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None


@router.post("/popups", status_code=201)
def create_popup(body: 팝업요청, db: Session = Depends(get_db),
                 current: User = Depends(require_admin)):
    from app.models.community import SitePopup
    popup = SitePopup(
        popup_type=body.popup_type,
        title=body.title,
        content=body.content,
        link_url=_safe_link_url(body.link_url),
        link_text=body.link_text,
        bg_color=body.bg_color,
        is_active=body.is_active,
        starts_at=body.starts_at,
        ends_at=body.ends_at,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    관리기록(db, current, "popup.create", "popup", popup.id, body.title[:200])
    return _popup_dict(popup)


@router.put("/popups/{popup_id}")
def update_popup(
    popup_id: int,
    body: 팝업요청,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
):
    from app.models.community import SitePopup
    popup = db.query(SitePopup).filter(SitePopup.id == popup_id).first()
    if not popup:
        raise HTTPException(404, "팝업을 찾을 수 없습니다")
    """보낸 칸만 고친다.

    exclude_unset 이 핵심이다. 이걸 안 쓰면 모델의 기본값(popup_type="info",
    is_active=True …)이 안 보낸 칸까지 덮어써서, 제목만 고치려다 꺼 둔
    팝업이 켜진다."""
    for 이름, 값 in body.model_dump(exclude_unset=True).items():
        if 이름 == "link_url":
            popup.link_url = _safe_link_url(값)
        else:
            setattr(popup, 이름, 값)
    db.commit()
    db.refresh(popup)
    관리기록(db, current, "popup.update", "popup", popup_id, popup.title[:200] or "")
    return _popup_dict(popup)


@router.delete("/popups/{popup_id}", status_code=204)
def delete_popup(popup_id: int, db: Session = Depends(get_db),
                 current: User = Depends(require_admin)):
    from app.models.community import SitePopup
    popup = db.query(SitePopup).filter(SitePopup.id == popup_id).first()
    if not popup:
        raise HTTPException(404, "팝업을 찾을 수 없습니다")
    제목 = popup.title or ""
    db.delete(popup)
    db.commit()
    관리기록(db, current, "popup.delete", "popup", popup_id, 제목[:200])


# ── 신고 관리 ─────────────────────────────────────────────────────────────────

@router.get("/reports")
def list_reports(
    status: str = Query(default="pending", pattern="^(pending|resolved|dismissed|all)$"),
    page:  int  = Query(1, ge=1),
    limit: int  = Query(20, ge=1, le=50),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    from app.models.community import Report, StockPost, StockComment
    q = db.query(Report).options(selectinload(Report.reporter))
    if status != "all":
        q = q.filter(Report.status == status)
    total = q.count()
    reports = q.order_by(Report.created_at.desc()).offset((page - 1) * limit).limit(limit).all()

    # 배치 조회로 N+1 제거
    post_ids    = list({r.post_id    for r in reports if r.post_id})
    comment_ids = list({r.comment_id for r in reports if r.comment_id})

    posts_map: dict = {}
    comments_map: dict = {}
    author_ids: set = set()

    if post_ids:
        for p in db.query(StockPost).filter(StockPost.id.in_(post_ids)).all():
            posts_map[p.id] = p
            author_ids.add(p.user_id)
    if comment_ids:
        for c in db.query(StockComment).filter(StockComment.id.in_(comment_ids)).all():
            comments_map[c.id] = c
            author_ids.add(c.user_id)

    users_map: dict = {}
    if author_ids:
        for u in db.query(User).filter(User.id.in_(author_ids)).all():
            users_map[u.id] = u

    result = []
    for r in reports:
        post_title = post_body = post_author = None
        comment_preview = comment_author = None
        post_is_blinded = comment_is_blinded = False
        post_is_deleted = comment_is_deleted = False

        if r.post_id and r.post_id in posts_map:
            post = posts_map[r.post_id]
            post_is_blinded = bool(post.is_blinded)
            post_is_deleted = bool(post.is_deleted)
            try:
                cd = json.loads(post.content)
                post_title = (cd.get("title") or "")[:200]
                post_body  = (cd.get("body") or "")[:300]
            except Exception:
                post_body = str(post.content)[:300]
            author = users_map.get(post.user_id)
            post_author = author.username if author else "—"

        if r.comment_id and r.comment_id in comments_map:
            comment = comments_map[r.comment_id]
            comment_is_blinded = bool(comment.is_blinded)
            comment_is_deleted = bool(comment.is_deleted)
            comment_preview = str(comment.content)[:300]
            author = users_map.get(comment.user_id)
            comment_author = author.username if author else "—"

        result.append({
            "id":                 r.id,
            "reporter_id":        r.reporter_id,
            "reporter":           r.reporter.username if r.reporter else "—",
            "post_id":            r.post_id,
            "comment_id":         r.comment_id,
            "post_title":         post_title,
            "post_body":          post_body,
            "post_author":        post_author,
            "comment_preview":    comment_preview,
            "comment_author":     comment_author,
            "post_is_blinded":    post_is_blinded,
            "comment_is_blinded": comment_is_blinded,
            "post_is_deleted":    post_is_deleted,
            "comment_is_deleted": comment_is_deleted,
            "reason":             r.reason,
            "status":             r.status,
            "created_at":         r.created_at.isoformat() if r.created_at else None,
        })
    return {"total": total, "items": result}


@router.patch("/reports/{report_id}/blind")
def blind_content(report_id: int, db: Session = Depends(get_db), current: User = Depends(require_admin)):
    """신고된 게시글 또는 댓글을 블라인드 처리"""
    from app.models.community import Report, StockPost, StockComment
    report = db.query(Report).filter(Report.id == report_id).first()
    if not report:
        raise HTTPException(404, "신고를 찾을 수 없습니다")
    if report.post_id:
        post = db.query(StockPost).filter(StockPost.id == report.post_id).first()
        if post:
            post.is_blinded = True
    if report.comment_id:
        comment = db.query(StockComment).filter(StockComment.id == report.comment_id).first()
        if comment:
            comment.is_blinded = True
    report.status = "resolved"
    db.commit()
    관리기록(db, current, "report.blind", "report", report_id,
             f"글 {report.post_id} · 댓글 {report.comment_id}")
    return {"message": "블라인드 처리 완료", "report_id": report_id}


@router.patch("/reports/{report_id}/unblind")
def unblind_content(report_id: int, db: Session = Depends(get_db), current: User = Depends(require_admin)):
    """블라인드 처리된 게시글 또는 댓글을 복구"""
    from app.models.community import Report, StockPost, StockComment
    report = db.query(Report).filter(Report.id == report_id).first()
    if not report:
        raise HTTPException(404, "신고를 찾을 수 없습니다")
    if report.post_id:
        post = db.query(StockPost).filter(StockPost.id == report.post_id).first()
        if post:
            post.is_blinded = False
    if report.comment_id:
        comment = db.query(StockComment).filter(StockComment.id == report.comment_id).first()
        if comment:
            comment.is_blinded = False
    report.status = "dismissed"
    db.commit()
    관리기록(db, current, "report.unblind", "report", report_id,
             f"글 {report.post_id} · 댓글 {report.comment_id}")
    return {"message": "블라인드 복구 완료", "report_id": report_id}


@router.patch("/reports/{report_id}/dismiss")
def dismiss_report(report_id: int, db: Session = Depends(get_db), current: User = Depends(require_admin)):
    """신고 기각"""
    from app.models.community import Report
    report = db.query(Report).filter(Report.id == report_id).first()
    if not report:
        raise HTTPException(404, "신고를 찾을 수 없습니다")
    report.status = "dismissed"
    db.commit()
    관리기록(db, current, "report.dismiss", "report", report_id)
    return {"message": "신고 기각 완료", "report_id": report_id}


@router.delete("/reports/{report_id}/content", status_code=204)
def delete_reported_content(report_id: int, db: Session = Depends(get_db), current: User = Depends(require_admin)):
    """신고된 게시글 또는 댓글을 삭제 처리"""
    from app.models.community import Report, StockPost, StockComment
    report = db.query(Report).filter(Report.id == report_id).first()
    if not report:
        raise HTTPException(404, "신고를 찾을 수 없습니다")
    if report.post_id:
        post = db.query(StockPost).filter(StockPost.id == report.post_id).first()
        if post:
            post.is_deleted = True
    if report.comment_id:
        comment = db.query(StockComment).filter(StockComment.id == report.comment_id).first()
        if comment:
            comment.is_deleted = True
    report.status = "resolved"
    db.commit()
    관리기록(db, current, "report.delete_content", "report", report_id,
             f"글 {report.post_id} · 댓글 {report.comment_id}")


# ── 트렌드 / 사용 통계 ──────────────────────────────────────────────────────────

@router.get("/search-trends")
def get_search_trends(_: User = Depends(require_admin)):
    """검색어 트렌드 TOP 20 (인메모리, 서버 재시작 시 초기화)"""
    from app.core.trends import get_search_trends as _trends
    return _trends(top_n=20)


@router.get("/usage-stats")
def get_usage_stats(_: User = Depends(require_admin)):
    """기능별 사용 통계 (인메모리, 서버 재시작 시 초기화)"""
    from app.core.trends import get_usage_stats as _stats
    return _stats()


# ── 관리자 행위 기록 ────────────────────────────────────────────
@router.get("/logs")
def get_admin_logs(
    request: Request,
    action: str = Query("", max_length=40),
    limit:  int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """누가·언제·무엇을 했는지.

    지우기와 정지는 되돌릴 수 없다. 되돌릴 수 없다면 최소한 무슨 일이
    있었는지는 알 수 있어야 한다 — 특히 관리자가 여럿일 때.
    """
    from app.models.admin_log import AdminLog
    q = db.query(AdminLog)
    if action:
        # 앞부분만 줘도 걸리게 한다("user" 로 user.delete·user.ban 을 함께)
        q = q.filter(AdminLog.action.like(f"{action}%"))
    total = q.count()
    rows = (q.order_by(AdminLog.created_at.desc())
              .offset(offset).limit(limit).all())
    return {
        "total": total,
        "items": [{
            "id": r.id,
            "actor": r.actor_name,
            "action": r.action,
            "target_type": r.target_type,
            "target_id": r.target_id,
            "detail": r.detail,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        } for r in rows],
    }
