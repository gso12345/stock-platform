"""
프로세스 내 인메모리 활동 트래커.
- online_users  : 최근 5분 이내 API를 호출한 고유 사용자 수
- today_visitors: UTC 당일 API를 호출한 고유 사용자 수

Render 재시작(배포) 시 인메모리 데이터가 초기화되므로,
오늘 방문자 수도 DB에 주기적으로 flush하고 재시작 후에는 DB에서 복원한다.
"""
import time
from datetime import datetime, timezone, timedelta
from threading import Lock

ONLINE_WINDOW = 5 * 60  # 5분

_lock = Lock()
_last_seen: dict[int, float] = {}   # user_id → monotonic timestamp
_daily: dict[str, set[int]] = {}    # "YYYY-MM-DD" → set(user_id)
_flushed: set[str] = set()          # 이미 DB에 영속화된 과거 날짜 (오늘은 제외)
_db_base: dict[str, int] = {}       # 서버 시작 시 DB에서 로드한 날짜별 기준값


def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _load_db_base() -> None:
    """모듈 로드 시 DB에서 최근 방문자 기준값 로드 — 재시작 후 오늘 수치 보존"""
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
                _db_base[date_str] = int(row[1])
            except (ValueError, TypeError):
                pass
    except Exception:
        pass


# 모듈 로드 시 즉시 DB 기준값 로드 (재시작 시 오늘 수치 복원)
_load_db_base()


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
    today = _today()
    with _lock:
        memory_count = len(_daily.get(today, set()))
    # 재시작으로 메모리가 초기화됐을 때 DB 기준값이 더 클 수 있음
    return max(memory_count, _db_base.get(today, 0))


def get_visitor_trend(days: int = 30) -> list[dict]:
    """최근 N일 방문자 추이를 반환.
    오늘을 포함한 모든 날짜를 DB에 flush해 서버 재시작 시 데이터 손실을 방지한다."""
    today = _today()

    with _lock:
        snapshot = {k: len(v) for k, v in _daily.items()}

    # 과거 날짜: 아직 flush 안 된 것만 / 오늘: 항상 flush (재시작 대비)
    to_flush: dict[str, int] = {}
    for date_str, count in snapshot.items():
        if date_str == today:
            # 오늘은 DB 기준값과 비교해 큰 쪽으로 저장
            to_flush[date_str] = max(count, _db_base.get(date_str, 0))
        elif date_str not in _flushed:
            to_flush[date_str] = count

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
                # 오늘은 _flushed에 추가하지 않아 다음 호출에서도 갱신 가능
                _flushed.update(d for d in to_flush if d != today)
            # 오늘 DB 기준값 갱신
            if today in to_flush:
                _db_base[today] = to_flush[today]
        except Exception:
            pass

    # DB에서 전체 날짜 데이터 읽기
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

    with _lock:
        today_memory = len(_daily.get(today, set()))
    # 재시작 전후 최댓값 사용
    today_count = max(today_memory, db_data.get(today, 0))

    # 최근 N일 조립 (오래된 날 → 오늘 순)
    result = []
    for i in range(days - 1, -1, -1):
        day = (datetime.now(timezone.utc) - timedelta(days=i)).strftime("%Y-%m-%d")
        count = today_count if day == today else db_data.get(day, 0)
        result.append({"date": day, "count": count})

    return result
