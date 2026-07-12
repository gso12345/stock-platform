"""
프로세스 내 인메모리 활동 트래커.
- online_users  : 최근 5분 이내 API를 호출한 고유 사용자 수
- today_visitors: UTC 당일 API를 호출한 고유 사용자 수
Render 재시작 시 초기화된다.
"""
import time
from datetime import datetime, timezone
from threading import Lock

ONLINE_WINDOW = 5 * 60  # 5분

_lock = Lock()
_last_seen: dict[int, float] = {}   # user_id → monotonic timestamp
_daily: dict[str, set[int]] = {}    # "YYYY-MM-DD" → set(user_id)


def mark_active(user_id: int) -> None:
    now_mono = time.monotonic()
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    with _lock:
        _last_seen[user_id] = now_mono
        if today not in _daily:
            _daily.clear()
            _daily[today] = set()
        _daily[today].add(user_id)


def online_count() -> int:
    cutoff = time.monotonic() - ONLINE_WINDOW
    with _lock:
        stale = [uid for uid, t in _last_seen.items() if t < cutoff]
        for uid in stale:
            del _last_seen[uid]
        return len(_last_seen)


def today_visitor_count() -> int:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    with _lock:
        return len(_daily.get(today, set()))
