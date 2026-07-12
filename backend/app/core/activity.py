"""
프로세스 내 인메모리 활동 트래커.
- online_users  : 최근 5분 이내 API를 호출한 고유 사용자 수
- today_visitors: UTC 당일 API를 호출한 고유 사용자 수
관리자 조회 시 이전 날 데이터를 system_settings 테이블에 영속화한다.
"""
import time
from datetime import datetime, timezone, timedelta
from threading import Lock

ONLINE_WINDOW = 5 * 60  # 5분

_lock = Lock()
_last_seen: dict[int, float] = {}   # user_id → monotonic timestamp
_daily: dict[str, set[int]] = {}    # "YYYY-MM-DD" → set(user_id)
_flushed: set[str] = set()          # 이미 DB에 영속화된 날짜


def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def mark_active(user_id: int) -> None:
    now_mono = time.monotonic()
    today = _today()
    with _lock:
        _last_seen[user_id] = now_mono
        _daily.setdefault(today, set()).add(user_id)


def online_count() -> int:
    cutoff = time.monotonic() - ONLINE_WINDOW
    with _lock:
        stale = [uid for uid, t in _last_seen.items() if t < cutoff]
        for uid in stale:
            del _last_seen[uid]
        return len(_last_seen)


def today_visitor_count() -> int:
    with _lock:
        return len(_daily.get(_today(), set()))


def get_visitor_trend(days: int = 30) -> list[dict]:
    """최근 N일 방문자 추이를 반환. 오늘이 아닌 날짜는 DB에 영속화한 뒤 조회한다."""
    today = _today()

    # 오늘이 아닌 날 중 아직 flush 안 된 날 → DB에 저장
    with _lock:
        to_flush = {k: len(v) for k, v in _daily.items() if k != today and k not in _flushed}

    if to_flush:
        try:
            from app.db.database import engine
            from sqlalchemy import text
            with engine.connect() as conn:
                for date_str, count in to_flush.items():
                    conn.execute(
                        text(
                            "INSERT INTO system_settings (key, value) "
                            "VALUES (:k, :v) ON CONFLICT (key) DO UPDATE SET value = :v"
                        ),
                        {"k": f"visitors_{date_str}", "v": str(count)},
                    )
                conn.commit()
            with _lock:
                _flushed.update(to_flush.keys())
        except Exception:
            pass

    # DB에서 이전 날 데이터 읽기
    db_data: dict[str, int] = {}
    try:
        from app.db.database import engine
        from sqlalchemy import text
        with engine.connect() as conn:
            rows = conn.execute(
                text("SELECT key, value FROM system_settings WHERE key LIKE 'visitors_%'")
            ).fetchall()
        for row in rows:
            date_str = str(row[0]).replace("visitors_", "")
            try:
                db_data[date_str] = int(row[1])
            except (ValueError, TypeError):
                pass
    except Exception:
        pass

    # 오늘 방문자는 메모리에서
    with _lock:
        today_count = len(_daily.get(today, set()))

    # 최근 N일 조립 (오래된 날 → 오늘 순)
    result = []
    for i in range(days - 1, -1, -1):
        day = (datetime.now(timezone.utc) - timedelta(days=i)).strftime("%Y-%m-%d")
        count = today_count if day == today else db_data.get(day, 0)
        result.append({"date": day, "count": count})

    return result
