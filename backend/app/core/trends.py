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
                # 예전 방식으로 쌓인 것은 사람이 친 글자가 키다. 지금 형식
                # ("시장|종목코드")이 아닌 것은 종목을 알 수 없으니 버린다.
                # 섞어서 보여주면 순위표가 무슨 기준인지 알 수 없어진다.
                counts = data.get("c", data) if isinstance(data, dict) else {}
                with _search_lock:
                    _search_counter.update({
                        k: v for k, v in counts.items()
                        if isinstance(k, str) and _SEARCH_KEY_SEP in k
                    })
                    if isinstance(data, dict) and isinstance(data.get("n"), dict):
                        _search_names.update(data["n"])
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
            # c = 종목별 횟수, n = 종목코드 → 이름. 예전에는 카운터만 저장했고
            # 그 형태도 읽을 수 있게 _load_from_db 가 둘 다 받는다.
            search_json = json.dumps({"c": dict(_search_counter), "n": dict(_search_names)})
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


"""검색 트렌드는 '어떤 종목을 찾았는지'로 센다.

예전에는 사용자가 친 글자를 그대로 셌다. 그러면 같은 종목을 찾아도
'삼성', '삼성전자', '005930', 'samsung' 이 전부 다른 줄이 되어, 정작
'무엇이 인기인가'는 알 수 없었다.

부수적으로 메모리 문제도 함께 사라진다. 예전 방식은 키가 사람이 칠 수
있는 모든 문자열이라 상한이 없었고, 그 카운터가 통째로 DB 에 저장되고
서버가 뜰 때마다 다시 메모리로 올라왔다. 지금은 키가 상장 종목 수를
넘을 수 없다."""

_SEARCH_KEY_SEP = "|"
# 상장 종목 수를 넘을 일이 없지만, 종목코드 형식이 바뀌거나 하는 사고에
# 대비해 상한을 둔다. 넘으면 가장 적게 찾은 것부터 버린다.
_MAX_SEARCH_KEYS = 8000

# 종목코드로만 세면 화면에 코드만 남으므로 이름을 함께 들고 있는다.
# 카운터와 같은 키만 담아 따로 자라지 않게 한다.
_search_names: dict[str, str] = {}


def track_search(symbol: str, name: str = "", market: str = "") -> None:
    """검색 결과에서 사용자가 실제로 고른 종목을 기록한다."""
    sym = (symbol or "").strip()
    if not sym or len(sym) > 20:
        return
    mkt = (market or "").strip()[:8] or "?"
    key = f"{mkt}{_SEARCH_KEY_SEP}{sym}"
    with _search_lock:
        _search_counter[key] += 1
        if name:
            _search_names[key] = name.strip()[:60]
        if len(_search_counter) > _MAX_SEARCH_KEYS:
            keep = dict(_search_counter.most_common(_MAX_SEARCH_KEYS))
            _search_counter.clear()
            _search_counter.update(keep)
            for k in [k for k in _search_names if k not in keep]:
                del _search_names[k]


def get_search_trends(top_n: int = 20) -> list[dict]:
    with _search_lock:
        rows = _search_counter.most_common(top_n)
        names = dict(_search_names)
    out = []
    for key, count in rows:
        mkt, _, sym = key.partition(_SEARCH_KEY_SEP)
        out.append({
            "symbol": sym or key,
            "market": mkt if sym else "",
            "name":   names.get(key, ""),
            "count":  count,
        })
    return out


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
