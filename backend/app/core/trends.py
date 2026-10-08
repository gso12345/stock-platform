"""검색으로 찾은 종목 + 기능별 사용 통계.

DB 의 usage_counters 표에 쌓는다(app/models/usage.py 에 왜 이렇게 바꿨는지
적어 두었다). 서버는 **아직 저장하지 않은 증가분만** 들고 있다가 1분마다,
그리고 서버가 꺼질 때 표에 더해 넣는다 — 숫자를 통째로 덮어쓰지 않으므로
배포·재시작·서버 두 대가 겹쳐 도는 동안에도 센 것이 사라지지 않는다.
"""
import json
import logging
import weakref
from collections import Counter
from datetime import datetime, timezone
from threading import Lock

log = logging.getLogger(__name__)

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

KIND_SEARCH = "search"
KIND_USAGE  = "usage"

"""검색 트렌드는 '어떤 종목을 찾았는지'로 센다.

예전에는 사용자가 친 글자를 그대로 셌다. 그러면 같은 종목을 찾아도
'삼성', '삼성전자', '005930', 'samsung' 이 전부 다른 줄이 되어, 정작
'무엇이 인기인가'는 알 수 없었다. 키는 "시장|종목코드" 다."""
_SEARCH_KEY_SEP = "|"
# 상장 종목 수를 넘을 일이 없지만, 아무나 /search/picked 로 엉뚱한 코드를
# 보낼 수 있으므로 상한을 둔다. 넘으면 가장 적게 찾은 것부터 버린다
# (아직 저장 안 한 증가분에도, 표에도 같은 상한을 쓴다).
_MAX_SEARCH_KEYS = 8000

_lock = Lock()
#: 아직 표에 더하지 않은 증가분
_search_pending: Counter = Counter()
#: 그 증가분의 종목명 — 카운터와 같은 키만 담아 따로 자라지 않게 한다
_search_names: dict[str, str] = {}
_usage_pending: Counter = Counter()

#: 예전 저장 자리(system_settings 의 JSON 한 칸)와, 옮겼다는 표시
_LEGACY_KEYS = ("trends_search", "trends_usage")
_MOVED_KEY = "trends_moved_to_table"

_더하기_SQL = (
    "INSERT INTO usage_counters (kind, key, name, count, updated_at) "
    "VALUES (:kind, :key, :name, :n, :at) "
    "ON CONFLICT (kind, key) DO UPDATE SET "
    "count = usage_counters.count + excluded.count, "
    "name = COALESCE(NULLIF(excluded.name, ''), usage_counters.name), "
    "updated_at = excluded.updated_at"
)


def _엔진():
    """통계를 쌓는 DB. 검사에서는 이 함수를 바꿔 끼워 임시 DB 를 쓴다."""
    from app.db.database import engine
    return engine


#: 표가 있는지 확인한 엔진들. create_all 은 서버가 뜰 때 한 번 돌고, 그때
#: DB 가 붐비면 실패하고 넘어간다("DB 초기화 실패 (서버는 계속 실행)").
#: 그러면 표가 없는 채로 돌게 되므로 여기서 한 번 더 챙긴다.
_표확인: "weakref.WeakSet" = weakref.WeakSet()


def _표_보장(engine) -> None:
    if engine in _표확인:
        return
    from app.models.usage import UsageCounter
    UsageCounter.__table__.create(bind=engine, checkfirst=True)
    _표확인.add(engine)


# ── 세기 ─────────────────────────────────────────────────────
def track_search(symbol: str, name: str = "", market: str = "") -> None:
    """검색 결과에서 사용자가 실제로 고른 종목을 기록한다."""
    sym = (symbol or "").strip()
    if not sym or len(sym) > 20:
        return
    mkt = (market or "").strip()[:8] or "?"
    key = f"{mkt}{_SEARCH_KEY_SEP}{sym}"
    with _lock:
        _search_pending[key] += 1
        if name:
            _search_names[key] = name.strip()[:60]
        if len(_search_pending) > _MAX_SEARCH_KEYS:
            keep = dict(_search_pending.most_common(_MAX_SEARCH_KEYS))
            _search_pending.clear()
            _search_pending.update(keep)
            for k in [k for k in _search_names if k not in keep]:
                del _search_names[k]


def track_usage(feature: str) -> None:
    if feature not in FEATURE_LABELS:
        return
    with _lock:
        _usage_pending[feature] += 1


# ── 저장 ─────────────────────────────────────────────────────
def flush_to_db() -> bool:
    """아직 저장 안 한 증가분을 표에 더한다. 저장할 것이 없으면 DB 를 안 건드린다.

    스케줄러가 1분마다, 서버가 꺼질 때 lifespan 이 부른다. 실패하면 증가분을
    돌려놓는다 — 다음 번에 다시 더한다(잃지도, 두 번 세지도 않는다)."""
    with _lock:
        if not _search_pending and not _usage_pending:
            return True
        검색 = dict(_search_pending)
        이름 = {k: _search_names.get(k, "") for k in 검색}
        사용 = dict(_usage_pending)
        _search_pending.clear()
        _search_names.clear()
        _usage_pending.clear()

    지금 = datetime.now(timezone.utc)
    줄들 = (
        [{"kind": KIND_SEARCH, "key": k, "name": 이름.get(k) or "", "n": n, "at": 지금}
         for k, n in 검색.items()]
        + [{"kind": KIND_USAGE, "key": k, "name": "", "n": n, "at": 지금}
           for k, n in 사용.items()]
    )
    try:
        from sqlalchemy import text
        engine = _엔진()
        _표_보장(engine)
        with engine.begin() as conn:
            conn.execute(text(_더하기_SQL), 줄들)
            _넘치면_줄이기(conn)
        return True
    except Exception as e:
        with _lock:
            _search_pending.update(검색)
            for k, v in 이름.items():
                if v:
                    _search_names.setdefault(k, v)
            _usage_pending.update(사용)
        log.warning("사용 통계 저장 실패 — 다음 번에 다시 넣습니다: %s", type(e).__name__)
        return False


def _넘치면_줄이기(conn) -> None:
    """검색 종목 줄이 상한을 넘으면 적게 찾은 것부터 지운다."""
    from sqlalchemy import text
    수 = conn.execute(
        text("SELECT COUNT(*) FROM usage_counters WHERE kind = :k"), {"k": KIND_SEARCH},
    ).scalar() or 0
    if 수 <= _MAX_SEARCH_KEYS:
        return
    conn.execute(text(
        "DELETE FROM usage_counters WHERE kind = :k AND key NOT IN ("
        "  SELECT key FROM usage_counters WHERE kind = :k"
        "  ORDER BY count DESC, key LIMIT :cap)"
    ), {"k": KIND_SEARCH, "cap": _MAX_SEARCH_KEYS})


def 옛기록_옮기기() -> int:
    """system_settings 에 JSON 으로 쌓여 있던 옛 통계를 새 표로 한 번만 옮긴다.

    옮겼다는 표시를 같은 거래 안에서 먼저 박는다. 배포 때 서버 두 대가 같이
    떠도 표시를 박은 쪽만 옮긴다(나머지는 표시가 이미 있어 그냥 지나간다).

    옮긴 뒤에는 옛 칸을 지운다. 배포하는 몇 분 동안 옛 서버가 옛 칸을 다시
    써 놓을 수 있는데, 다음에 서버가 뜰 때 그것도 치운다."""
    from sqlalchemy import inspect, text
    engine = _엔진()
    _표_보장(engine)
    if "system_settings" not in inspect(engine).get_table_names():
        return 0                      # 옛 자리가 없는 DB — 옮길 것도 없다

    옮긴수 = 0
    with engine.begin() as conn:
        표시 = conn.execute(
            text("INSERT INTO system_settings (key, value) VALUES (:k, :v) "
                 "ON CONFLICT (key) DO NOTHING"),
            {"k": _MOVED_KEY, "v": datetime.now(timezone.utc).isoformat()},
        )
        옛칸 = {"a": _LEGACY_KEYS[0], "b": _LEGACY_KEYS[1]}
        if 표시.rowcount == 1:
            지금 = datetime.now(timezone.utc)
            줄들 = []
            for key, value in conn.execute(
                text("SELECT key, value FROM system_settings WHERE key IN (:a, :b)"), 옛칸,
            ).fetchall():
                줄들 += _옛_json_읽기(key, value, 지금)
            if 줄들:
                conn.execute(text(_더하기_SQL), 줄들)
                _넘치면_줄이기(conn)
            옮긴수 = len(줄들)
        conn.execute(text("DELETE FROM system_settings WHERE key IN (:a, :b)"), 옛칸)
    if 옮긴수:
        log.info("옛 사용 통계 %d줄을 usage_counters 로 옮겼습니다", 옮긴수)
    return 옮긴수


def _옛_json_읽기(key: str, value: str, 지금: datetime) -> list[dict]:
    try:
        data = json.loads(value)
    except Exception:
        return []
    if key == _LEGACY_KEYS[0]:
        # {"c": {키: 횟수}, "n": {키: 이름}}, 더 옛날에는 {키: 횟수} 만.
        # "시장|종목코드" 가 아닌 키는 사람이 친 글자라 종목을 알 수 없다 — 버린다
        counts = data.get("c", data) if isinstance(data, dict) else {}
        names = data.get("n", {}) if isinstance(data, dict) else {}
        names = names if isinstance(names, dict) else {}
        return [
            {"kind": KIND_SEARCH, "key": k, "name": str(names.get(k) or "")[:60],
             "n": int(v), "at": 지금}
            for k, v in (counts or {}).items()
            if isinstance(k, str) and _SEARCH_KEY_SEP in k and len(k) <= 40
            and isinstance(v, (int, float)) and v > 0
        ]
    return [
        {"kind": KIND_USAGE, "key": k, "name": "", "n": int(v), "at": 지금}
        for k, v in (data.items() if isinstance(data, dict) else [])
        if k in FEATURE_LABELS and isinstance(v, (int, float)) and v > 0
    ]


# ── 읽기 ─────────────────────────────────────────────────────
def _표에서(kind: str, 개수: int | None) -> list[tuple[str, str, int]]:
    """표의 (키, 이름, 횟수). 못 읽으면 빈 목록 — 화면은 아직 저장 안 한 것만이라도 보인다."""
    try:
        from sqlalchemy import text
        engine = _엔진()
        _표_보장(engine)
        sql = ("SELECT key, name, count FROM usage_counters WHERE kind = :k "
               "ORDER BY count DESC, key")
        인자: dict = {"k": kind}
        if 개수 is not None:
            sql += " LIMIT :n"
            인자["n"] = 개수
        with engine.connect() as conn:
            return [(r[0], r[1] or "", int(r[2] or 0)) for r in conn.execute(text(sql), 인자)]
    except Exception as e:
        log.warning("사용 통계 읽기 실패: %s", type(e).__name__)
        return []


def 종목명_찾기(symbol: str, market: str) -> str:
    """종목코드로 이름을 찾는다. 모르면 빈 문자열.

    이름은 브라우저가 보내주지만 그것만 믿을 수는 없다 — 검색 결과에
    이름이 비어 오기도 하고, 예전에 쌓인 기록에는 아예 없다. 그러면
    관리자 화면에 '005930' 같은 숫자만 남아 무슨 종목인지 알 수 없다.
    서버는 상장 종목 목록을 이미 들고 있으므로 여기서 채워 준다."""
    try:
        from app.services.ticker_service import get_kr_db, get_us_db
        sym = (symbol or "").strip().upper()
        if not sym:
            return ""
        if market == "KR":
            # 화면·검색은 '005930', 종목 목록은 '005930.KS' 를 쓴다
            코드 = sym.split(".")[0]
            for it in get_kr_db():
                if it.get("c") == 코드 or it.get("s", "").split(".")[0] == 코드:
                    return it.get("n") or ""
            return ""
        for it in get_us_db():
            if it.get("s", "").upper() == sym:
                return it.get("n") or ""
    except Exception:
        pass
    return ""


def get_search_trends(top_n: int = 20) -> list[dict]:
    flush_to_db()                    # 방금 센 것까지 보이게
    with _lock:                      # 저장에 실패했다면 남아 있는 증가분
        남은것 = dict(_search_pending)
        남은이름 = dict(_search_names)
    횟수: Counter = Counter()
    이름: dict[str, str] = {}
    for key, name, count in _표에서(KIND_SEARCH, top_n + len(남은것)):
        횟수[key] += count
        if name:
            이름[key] = name
    횟수.update(남은것)
    for k, v in 남은이름.items():
        if v:
            이름[k] = v

    out = []
    for key, count in sorted(횟수.items(), key=lambda kv: (-kv[1], kv[0]))[:top_n]:
        mkt, _, sym = key.partition(_SEARCH_KEY_SEP)
        out.append({
            "symbol": sym or key,
            "market": mkt if sym else "",
            "name":   이름.get(key) or 종목명_찾기(sym or key, mkt if sym else ""),
            "count":  count,
        })
    return out


def get_usage_stats() -> list[dict]:
    flush_to_db()
    with _lock:
        남은것 = dict(_usage_pending)
    횟수: Counter = Counter({k: c for k, _, c in _표에서(KIND_USAGE, None)})
    횟수.update(남은것)
    return [
        {"feature": f, "label": FEATURE_LABELS[f], "count": c}
        for f, c in sorted(횟수.items(), key=lambda kv: (-kv[1], kv[0]))
        if f in FEATURE_LABELS and c > 0
    ]
