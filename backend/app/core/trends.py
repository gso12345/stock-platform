"""검색 트렌드 + 기능별 사용 통계 인메모리 트래커 (서버 재시작 시 초기화)"""
from collections import Counter
from threading import Lock

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
