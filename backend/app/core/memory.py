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
        add("국내 종목 DB", ts._kr_db, len(ts._kr_db),
            "KRX 전체 상장 종목 — 종목코드·이름·시장(KOSPI/KOSDAQ)")
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
