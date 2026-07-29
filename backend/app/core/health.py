"""
백그라운드 작업과 외부 데이터 소스의 최근 상태.

지금까지 문제를 찾는 데 매번 오래 걸린 이유는 '언제 마지막으로 성공했는지'를
아무도 기록하지 않았기 때문이다. 뉴스가 한 언론사만 나오던 것도, 스케줄러가
아예 안 돌던 것도, 코드를 읽어 추측해야 알 수 있었다.

여기서는 딱 두 가지만 기록한다 — 마지막 성공 시각과 최근 실패 횟수.
많이 기록할수록 그것 자체가 부하가 되므로, 진단에 꼭 필요한 것만 남긴다.
"""
from __future__ import annotations

import time
from collections import OrderedDict
from threading import Lock

_lock = Lock()
# 이름 -> {ok, fail, last_ok, last_fail, last_error, last_ms}
_stats: "OrderedDict[str, dict]" = OrderedDict()
MAX_TRACKED = 60


def _slot(name: str) -> dict:
    s = _stats.get(name)
    if s is None:
        if len(_stats) >= MAX_TRACKED:
            _stats.popitem(last=False)
        s = {"ok": 0, "fail": 0, "last_ok": None, "last_fail": None,
             "last_error": None, "last_ms": None}
        _stats[name] = s
    return s


def record_ok(name: str, ms: float | None = None, detail: str | None = None) -> None:
    with _lock:
        s = _slot(name)
        s["ok"] += 1
        s["last_ok"] = time.time()
        s["last_ms"] = round(ms) if ms is not None else None
        s["detail"] = detail


def record_fail(name: str, error: str) -> None:
    with _lock:
        s = _slot(name)
        s["fail"] += 1
        s["last_fail"] = time.time()
        s["last_error"] = str(error)[:200]


def snapshot() -> list[dict]:
    """화면에 그대로 쓸 수 있는 형태로 — 시각은 '몇 초 전'으로 바꿔 보낸다"""
    now = time.time()
    with _lock:
        items = list(_stats.items())
    out = []
    for name, s in items:
        total = s["ok"] + s["fail"]
        out.append({
            "name":        name,
            "ok":          s["ok"],
            "fail":        s["fail"],
            "success_pct": round(s["ok"] / total * 100) if total else None,
            "last_ok_sec":   round(now - s["last_ok"]) if s["last_ok"] else None,
            "last_fail_sec": round(now - s["last_fail"]) if s["last_fail"] else None,
            "last_error":  s["last_error"],
            "last_ms":     s["last_ms"],
            "detail":      s.get("detail"),
        })
    return out


def reset() -> None:
    with _lock:
        _stats.clear()
