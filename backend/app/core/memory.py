"""
프로세스 메모리 확인.

Render 무료 플랜은 512MB를 넘으면 프로세스를 강제 재시작한다. 재시작 중에는
서비스가 아예 응답하지 않으므로, 무거운 작업을 시작하기 전에 여유가 있는지
확인해서 없으면 건너뛰는 편이 낫다 — 캐시가 조금 비는 것과 서비스가 죽는 것은
비교할 문제가 아니다.

psutil 없이 /proc 으로 읽는다. 배포 대상이 리눅스 컨테이너이고, 이 하나를
위해 의존성을 늘릴 이유가 없다.
"""
from __future__ import annotations

import logging
import os

log = logging.getLogger(__name__)

# 인스턴스 메모리 한도(MB). Render 무료 플랜 기준이며 환경변수로 조정한다.
MEMORY_LIMIT_MB = int(os.getenv("MEMORY_LIMIT_MB", 512))
# 이 비율을 넘으면 무거운 작업을 건너뛴다
HEAVY_WORK_THRESHOLD = float(os.getenv("MEMORY_HEAVY_THRESHOLD", 0.75))


def rss_mb() -> float | None:
    """현재 프로세스가 실제로 쓰는 물리 메모리(MB). 못 읽으면 None."""
    try:
        with open("/proc/self/status", encoding="utf-8") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1]) / 1024
    except Exception:
        pass
    # cgroup v2 (컨테이너에서 /proc/self/status 가 호스트 값을 줄 때 대비)
    try:
        with open("/sys/fs/cgroup/memory.current", encoding="utf-8") as f:
            return int(f.read().strip()) / 1024 / 1024
    except Exception:
        return None


def usage_ratio() -> float | None:
    mb = rss_mb()
    return None if mb is None else mb / MEMORY_LIMIT_MB


# RSS 표본 — 시간에 따라 늘고 있는지 보려고 남긴다.
# 순간값만 보면 '지금 85%'는 알아도 '계속 오르는 중인지 평탄한지'를 모른다.
# 파이썬은 한 번 받은 메모리를 잘 돌려주지 않으므로, 초반 상승 후 평탄하면
# 정상이고 계속 오르면 누수다. 그 둘을 구분하는 게 이 표본의 목적이다.
_MAX_SAMPLES = 48          # 5분 간격이면 4시간치
_samples: list[tuple[float, float]] = []      # (기록 시각, RSS MB)


def record_sample():
    """주기 작업이 부른다. /proc 한 줄 읽는 게 전부라 사실상 공짜다."""
    mb = rss_mb()
    if mb is None:
        return
    import time as _t
    _samples.append((_t.time(), round(mb, 1)))
    if len(_samples) > _MAX_SAMPLES:
        del _samples[0]
    _추적_표본()


def trend() -> dict:
    """RSS 추이 요약 — 늘고 있나, 멈췄나."""
    import time as _t
    if len(_samples) < 2:
        return {"samples": len(_samples), "points": [], "per_hour_mb": None, "span_min": 0}
    t0, m0 = _samples[0]
    t1, m1 = _samples[-1]
    span_h = max((t1 - t0) / 3600, 1e-6)
    return {
        "samples": len(_samples),
        # 화면에 스파크라인으로 그릴 값
        "points": [m for _, m in _samples],
        "first_mb": m0,
        "last_mb": m1,
        "min_mb": min(m for _, m in _samples),
        "max_mb": max(m for _, m in _samples),
        "per_hour_mb": round((m1 - m0) / span_h, 1),
        "span_min": round((t1 - t0) / 60),
    }


# ── '무엇이' 늘고 있는지 ────────────────────────────────────
#
# RSS 가 오르는 건 보이는데 원인을 못 찾아 캐시·스레드·라이브러리를 하나씩
# 짚어가며 추측한 적이 있다. 파이썬은 자기가 어디서 무엇을 할당했는지
# 말해 줄 수 있다(tracemalloc). 다만 공짜가 아니라서 —
#
#   · 할당마다 기록을 남기므로 메모리를 10~25% 더 쓰고 CPU 도 더 쓴다
#   · 512MB / 0.15 CPU 짜리 인스턴스에서 상시로 켜 둘 것은 아니다
#
# 그래서 평소엔 꺼 두고, 원인을 찾아야 할 때만 MEM_TRACE=1 로 켠다.
# gc.get_objects() 로는 이걸 대신할 수 없다 — 숫자·문자열만 든 dict 은
# 순환참조가 불가능해서 GC 가 추적을 끊는다. 캐시에 담기는 값이 정확히
# 그 모양이라, 2만 개를 만들어도 '+2개' 로 보인다.
_TRACE = os.getenv("MEM_TRACE", "").strip() in ("1", "true", "yes")
_기준_스냅샷 = None
_기준_시각 = 0.0


def _추적_표본():
    """켜져 있을 때만 기준 스냅샷을 한 번 잡아 둔다."""
    global _기준_스냅샷, _기준_시각
    if not _TRACE or _기준_스냅샷 is not None or len(_samples) < 2:
        return
    try:
        import time as _t
        import tracemalloc
        if not tracemalloc.is_tracing():
            tracemalloc.start(1)
            return          # 켜자마자 찍으면 비어 있다. 다음 표본에서 잡는다
        _기준_스냅샷 = tracemalloc.take_snapshot()
        _기준_시각 = _t.time()
    except Exception as e:
        log.warning(f"메모리 추적 시작 실패: {type(e).__name__}: {e}")


def alloc_growth(top: int = 8) -> dict:
    """기준 시점 이후 어느 코드가 메모리를 늘렸는지.

    MEM_TRACE=1 이 아니면 꺼져 있다고만 알린다."""
    if not _TRACE:
        return {"enabled": False, "ready": False, "items": [], "span_min": 0}
    if _기준_스냅샷 is None:
        return {"enabled": True, "ready": False, "items": [], "span_min": 0}
    try:
        import time as _t
        import tracemalloc
        지금 = tracemalloc.take_snapshot()
        차이 = 지금.compare_to(_기준_스냅샷, "lineno")
        items = []
        for st in 차이[:top]:
            if st.size_diff <= 0:
                continue
            f = st.traceback[0]
            # 경로가 길어 화면을 넘치므로 app/ 아래만 남긴다
            where = f.filename
            if "/app/" in where:
                where = "app/" + where.split("/app/", 1)[1]
            items.append({
                "where": f"{where}:{f.lineno}",
                "grew_kb": round(st.size_diff / 1024),
                "now_kb": round(st.size / 1024),
                "count_diff": st.count_diff,
            })
        return {
            "enabled": True, "ready": True,
            "span_min": round((_t.time() - _기준_시각) / 60),
            "items": items,
        }
    except Exception as e:
        return {"enabled": True, "ready": False, "items": [], "span_min": 0,
                "error": f"{type(e).__name__}: {e}"}


def proc_breakdown() -> dict | None:
    """RSS 를 '코드'와 '데이터'로 나눈다.

    관리자 화면의 '파이썬 자체·기타'가 프로덕션에서 281MB로 찍혔는데, 그게
    무엇인지 알 방법이 없었다. 커널이 이미 답을 들고 있다 —

      Shared_Clean   라이브러리 코드(.so). 디스크에서 매핑된 것이라 줄일 수
                     없고, 다른 프로세스와 공유한다
      Private_Dirty  이 프로세스만의 실제 메모리. 파이썬 객체가 여기 있다
      Pss            공유분을 나눠 가진 '공정 분담분'

    smaps_rollup 은 리눅스 4.14+ 에서만 있다. 없으면 None."""
    try:
        d: dict[str, float] = {}
        with open("/proc/self/smaps_rollup", encoding="utf-8") as f:
            for line in f:
                k, _, v = line.partition(":")
                if "kB" in v:
                    d[k.strip()] = int(v.split()[0]) / 1024
        if not d:
            return None
        return {
            "rss_mb":           round(d.get("Rss", 0), 1),
            "pss_mb":           round(d.get("Pss", 0), 1),
            "code_shared_mb":   round(d.get("Shared_Clean", 0), 1),
            "private_dirty_mb": round(d.get("Private_Dirty", 0), 1),
            "private_clean_mb": round(d.get("Private_Clean", 0), 1),
        }
    except Exception:
        return None


def object_stats(top: int = 8) -> dict:
    """파이썬이 들고 있는 객체 종류별 개수.

    전체 순회지만 20ms 안팎이라 관리자 화면 갱신 주기(15초)에는 부담이 없다.
    '무엇이 많은가'를 알면 어디를 들여다볼지 정할 수 있다."""
    import gc
    import sys as _sys
    import threading as _th
    from collections import Counter
    try:
        objs = gc.get_objects()
        c = Counter(type(o).__name__ for o in objs)
        total = len(objs)
        del objs
        return {
            "total": total,
            "blocks": _sys.getallocatedblocks(),
            "threads": _th.active_count(),
            "gc_counts": list(gc.get_count()),
            "top": [{"name": n, "count": v} for n, v in c.most_common(top)],
        }
    except Exception:
        return {"total": 0, "blocks": 0, "threads": 0, "gc_counts": [], "top": []}


def data_stores() -> list[dict]:
    """메모리에 상주하는 '데이터' 목록 — 무엇이 몇 건 들어 있는지.

    라이브러리와 달리 이쪽은 우리가 직접 올려둔 것이라 줄일 수 있다.
    관리자 화면에서 크기와 함께 '무슨 데이터인지'를 보여줘야, 예를 들어
    국내 종목 DB 를 PostgreSQL 로 옮길지 같은 판단을 할 수 있다.

    크기는 근사값이다. 같은 모양의 dict 수천 개라 앞쪽 표본으로 곱해도
    자릿수는 정확하다."""
    from app.core.cache import cache, _rough_size

    rows: list[dict] = []

    def add(name: str, obj, count: int, what: str, movable: bool = True):
        try:
            n = _rough_size(obj)
        except Exception:
            n = 0
        rows.append({
            "name": name, "items": count, "bytes": n,
            "mb": round(n / 1024 / 1024, 2), "what": what, "movable": movable,
        })

    try:
        from app.services import ticker_service as ts
        kr = ts.kr_status()
        add("국내 종목 DB", ts._kr_db, len(ts._kr_db),
            f"KRX 상장 종목 — 출처 {kr['source']}"
            + (f" · 내장 폴백 {kr['builtin_count']}개로 축소 동작 중" if kr["degraded"]
               else " · 종목코드·이름·시장(KOSPI/KOSDAQ)"))
        add("국내 시세 스냅샷", ts._fdr_price_cache, len(ts._fdr_price_cache),
            "종목별 현재가·등락·거래량·시가총액·시가/고가/저가")
        add("미국 종목 DB", ts._us_db, len(ts._us_db),
            "미국 상장 종목·ETF 목록 — 심볼·이름·거래소")
        add("국내 종목 내장 목록", ts.KR_TICKERS_BUILTIN, len(ts.KR_TICKERS_BUILTIN),
            "외부 조회가 모두 실패했을 때 쓰는 기본 종목", movable=False)
        add("미국 종목 한글명", ts.KO_NAME_MAP, len(ts.KO_NAME_MAP),
            "'AAPL → 애플' 같은 검색·표시용 별칭", movable=False)
    except Exception:
        pass

    st = cache.stats()
    rows.append({
        "name": "응답 캐시", "items": st["items"], "bytes": st["bytes"],
        "mb": st["mb"], "movable": True,
        "what": "시세·차트·뉴스·재무 등 API 응답 (한도 초과 시 자동 정리)",
    })
    return sorted(rows, key=lambda r: -r["bytes"])


def has_headroom(label: str = "작업") -> bool:
    """무거운 작업을 시작해도 되는지.

    측정할 수 없는 환경(로컬 등)에서는 막지 않는다 — 알 수 없다는 이유로
    기능을 끄면 개발이 불편해진다."""
    r = usage_ratio()
    if r is None:
        return True
    if r >= HEAVY_WORK_THRESHOLD:
        log.warning(
            f"메모리 여유 부족으로 {label} 건너뜀 "
            f"({rss_mb():.0f}MB / {MEMORY_LIMIT_MB}MB, {r:.0%})"
        )
        return False
    return True
