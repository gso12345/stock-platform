import os
import sys
import time
import threading
from typing import Any, Optional
from collections import OrderedDict


MAX_CACHE_SIZE = 50_000  # 최대 항목 수 (초과 시 오래된 것부터 삭제)

# 캐시가 쓸 수 있는 대략적인 최대 바이트.
#
# 항목 수만 제한하면 큰 값 하나를 못 막는다. 실제로 OHLCV 시계열 하나가
# 20,000행이면 약 15MB인데 항목 수로는 '1개'다. 이런 값 20여 개가 쌓여
# 200MB를 넘겼고, Render 무료 플랜(512MB)에서 프로세스가 강제 재시작됐다.
# 기본 80MB — 이 서비스는 시작만으로 이미 약 290MB를 쓴다(pandas·yfinance
# 임포트 149MB + 국내 종목 DB 101MB). 512MB에서 요청 처리 여유를 남기려면
# 캐시는 이 정도가 상한이다. 큰 인스턴스에서는 환경변수로 올린다.
MAX_CACHE_BYTES = int(os.getenv("MAX_CACHE_BYTES", 80 * 1024 * 1024))


def _rough_size(v: Any) -> int:
    """값의 대략적인 바이트 크기.

    정확할 필요는 없다. 필요한 건 'OHLCV 시계열처럼 큰 값'과 '시세 dict처럼
    작은 값'을 자릿수 단위로 구분하는 것뿐이다. 전체를 재귀 순회하면 그 자체가
    비싸므로, 리스트는 앞쪽 몇 개만 재보고 곱한다."""
    try:
        if isinstance(v, (list, tuple)):
            n = len(v)
            if n == 0:
                return 64
            sample = v[: min(5, n)]
            per = sum(_rough_size(x) for x in sample) / len(sample)
            return int(per * n) + 64
        if isinstance(v, dict):
            return sys.getsizeof(v) + sum(
                sys.getsizeof(k) + (_rough_size(x) if isinstance(x, (list, dict)) else sys.getsizeof(x))
                for k, x in v.items()
            )
        return sys.getsizeof(v)
    except Exception:
        return 512


class TTLCache:
    """TTL 캐시 — rate limit 대비 stale 값 반환 지원 + 메모리 제한"""

    def __init__(self, maxsize: int = MAX_CACHE_SIZE, maxbytes: int = MAX_CACHE_BYTES):
        self._store: OrderedDict[str, tuple[Any, float]] = OrderedDict()
        self._stale: OrderedDict[str, Any] = OrderedDict()
        # 값을 마지막으로 쓴 시각. 만료(_store에서 삭제)된 뒤에도 남는다 —
        # stale 값을 내보낼 때 '얼마나 묵은 값인지' 알려주기 위한 것이다.
        self._written: OrderedDict[str, float] = OrderedDict()
        self._bytes: OrderedDict[str, int] = OrderedDict()
        self._total_bytes = 0
        self._maxsize = maxsize
        self._maxbytes = maxbytes
        self._lock = threading.Lock()

    def get(self, key: str) -> Optional[Any]:
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            value, expires_at = entry
            if time.time() > expires_at:
                del self._store[key]
                return None
            # 최근 접근 항목을 뒤로 이동 (LRU)
            self._store.move_to_end(key)
            return value

    def age(self, key: str) -> Optional[float]:
        """이 값을 쓴 지 몇 초 지났는가. 쓴 적이 없으면 None.

        만료 여부와 무관하다. 외부 API가 막혀 갱신이 끊긴 상태를
        화면과 로그에서 알아볼 수 있게 하려고 둔다."""
        with self._lock:
            at = self._written.get(key)
        return None if at is None else time.time() - at

    def get_stale(self, key: str) -> Optional[Any]:
        """만료됐더라도 마지막 값 반환 (rate limit 대비 폴백)"""
        fresh = self.get(key)
        if fresh is not None:
            return fresh
        with self._lock:
            return self._stale.get(key)

    def _evict(self, key: str):
        """락을 이미 잡은 상태에서 호출한다"""
        self._store.pop(key, None)
        self._stale.pop(key, None)
        self._written.pop(key, None)
        self._total_bytes -= self._bytes.pop(key, 0)

    def set(self, key: str, value: Any, ttl: int = 60):
        size = _rough_size(value)
        with self._lock:
            if key in self._bytes:
                self._total_bytes -= self._bytes[key]

            now = time.time()
            self._store[key] = (value, now + ttl)
            self._store.move_to_end(key)
            self._stale[key] = value
            self._written[key] = now
            self._written.move_to_end(key)
            self._bytes[key] = size
            self._bytes.move_to_end(key)
            self._total_bytes += size

            # 항목 수 제한
            while len(self._store) > self._maxsize:
                oldest = next(iter(self._store))
                if oldest == key:
                    break
                self._evict(oldest)

            # 바이트 제한 — 오래 안 쓴 것부터 밀어낸다.
            # 이게 없으면 OHLCV 시계열 몇 개만으로 수백 MB가 되어
            # 프로세스가 메모리 한도로 강제 재시작된다.
            while self._total_bytes > self._maxbytes and len(self._bytes) > 1:
                oldest = next(iter(self._bytes))
                if oldest == key:
                    break
                self._evict(oldest)

            # stale/written 도 같은 상한을 따른다
            while len(self._stale) > self._maxsize:
                self._stale.popitem(last=False)
            while len(self._written) > self._maxsize:
                self._written.popitem(last=False)

    def delete(self, key: str):
        with self._lock:
            self._evict(key)

    def clear(self):
        with self._lock:
            self._store.clear()
            self._stale.clear()
            self._written.clear()
            self._bytes.clear()
            self._total_bytes = 0

    def size(self) -> int:
        return len(self._store)

    def bytes_used(self) -> int:
        return self._total_bytes

    def stats(self) -> dict:
        return {
            "items": len(self._store),
            "bytes": self._total_bytes,
            "mb": round(self._total_bytes / 1024 / 1024, 1),
            "limit_mb": round(self._maxbytes / 1024 / 1024, 1),
        }

    def keys_with_ttl(self) -> list[dict]:
        """현재 캐시된 모든 키와 남은 TTL(초) 반환 (관리자 전용)"""
        now = time.time()
        with self._lock:
            return sorted([
                {
                    "key": k,
                    "ttl_remaining": max(0, round(exp - now)),
                    "has_stale": k in self._stale,
                }
                for k, (_, exp) in list(self._store.items())
            ], key=lambda x: x["key"])

    def delete_pattern(self, prefix: str) -> int:
        """특정 접두사로 시작하는 모든 키 삭제 후 삭제 개수 반환"""
        with self._lock:
            to_delete = [k for k in self._store if k.startswith(prefix)]
            for k in to_delete:
                self._evict(k)
            return len(to_delete)


cache = TTLCache()
