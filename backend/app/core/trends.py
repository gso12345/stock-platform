"""검색 트렌드 + 기능별 사용 통계 트래커 (DB 영속화 — 서버 재시작 후에도 유지)"""
import json
import logging
from collections import Counter
from threading import Lock

log = logging.getLogger(__name__)

_search_lock = Lock()
_search_counter: Counter = Counter()

_usage_lock = Lock()
_usage_counter: Counter = Counter()

FEATURE_LABELS: dict[str, str] = {
    "dashboard":    "대시보드",
    "stock_detail": "종목상세",
    "community":    "커뮤니티",
    "search":       "종목검색",
    "portfolio":    "포트폴리오",
    "watchlist":    "관심종목",
    "screening":    "스크리닝",
    "backtest":     "백테스트",
}

_DB_KEY_SEARCH = "trends_search"
_DB_KEY_USAGE  = "trends_usage"


def _load_from_db() -> None:
    """서버 시작 시 DB에서 카운터 복원"""
    try:
        from app.db.database import engine
        from sqlalchemy import text
        with engine.connect() as conn:
            rows = conn.execute(
                text("SELECT key, value FROM system_settings WHERE key IN (:ks, :ku)"),
                {"ks": _DB_KEY_SEARCH, "ku": _DB_KEY_USAGE},
            ).fetchall()
        for row in rows:
            if row[0] == _DB_KEY_SEARCH:
                data = json.loads(row[1])
                with _search_lock:
                    _search_counter.update(data)
            elif row[0] == _DB_KEY_USAGE:
                data = json.loads(row[1])
                with _usage_lock:
                    _usage_counter.update(data)
    except Exception as e:
        log.debug(f"trends DB 로드 스킵: {e}")


def flush_to_db() -> None:
    """현재 카운터를 DB에 저장 (스케줄러에서 주기적으로 호출)"""
    try:
        from app.db.database import engine
        from sqlalchemy import text
        with _search_lock:
            search_json = json.dumps(dict(_search_counter))
        with _usage_lock:
            usage_json = json.dumps(dict(_usage_counter))
        with engine.connect() as conn:
            for key, val in [(_DB_KEY_SEARCH, search_json), (_DB_KEY_USAGE, usage_json)]:
                conn.execute(
                    text(
                        "INSERT INTO system_settings (key, value) VALUES (:k, :v) "
                        "ON CONFLICT (key) DO UPDATE SET value = :v"
                    ),
                    {"k": key, "v": val},
                )
            conn.commit()
    except Exception as e:
        log.debug(f"trends DB flush 스킵: {e}")


# 모듈 로드 시 DB에서 복원
_load_from_db()


def track_search(query: str) -> None:
    q = query.strip()
    if not q:
        return
    with _search_lock:
        _search_counter[q] += 1


def get_search_trends(top_n: int = 20) -> list[dict]:
    with _search_lock:
        return [{"query": q, "count": c} for q, c in _search_counter.most_common(top_n)]


def track_usage(feature: str) -> None:
    if feature not in FEATURE_LABELS:
        return
    with _usage_lock:
        _usage_counter[feature] += 1


def get_usage_stats() -> list[dict]:
    with _usage_lock:
        return [
            {"feature": f, "label": FEATURE_LABELS.get(f, f), "count": c}
            for f, c in sorted(_usage_counter.items(), key=lambda x: x[1], reverse=True)
        ]
