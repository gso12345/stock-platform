import time
import threading
from typing import Any, Optional
from collections import OrderedDict


MAX_CACHE_SIZE = 50_000  # 최대 항목 수 (초과 시 오래된 것부터 삭제)


class TTLCache:
    """TTL 캐시 — rate limit 대비 stale 값 반환 지원 + 메모리 제한"""

    def __init__(self, maxsize: int = MAX_CACHE_SIZE):
        self._store: OrderedDict[str, tuple[Any, float]] = OrderedDict()
        self._stale: OrderedDict[str, Any] = OrderedDict()
        self._maxsize = maxsize
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

    def get_stale(self, key: str) -> Optional[Any]:
        """만료됐더라도 마지막 값 반환 (rate limit 대비 폴백)"""
        fresh = self.get(key)
        if fresh is not None:
            return fresh
        with self._lock:
            return self._stale.get(key)

    def set(self, key: str, value: Any, ttl: int = 60):
        with self._lock:
            # 크기 초과 시 가장 오래된 항목 제거
            if key not in self._store and len(self._store) >= self._maxsize:
                oldest_key, _ = self._store.popitem(last=False)
                self._stale.pop(oldest_key, None)

            self._store[key] = (value, time.time() + ttl)
            self._store.move_to_end(key)
            self._stale[key] = value

            # stale도 크기 제한
            if len(self._stale) > self._maxsize:
                self._stale.popitem(last=False)

    def delete(self, key: str):
        with self._lock:
            self._store.pop(key, None)
            self._stale.pop(key, None)

    def clear(self):
        with self._lock:
            self._store.clear()
            self._stale.clear()

    def size(self) -> int:
        return len(self._store)

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
                self._store.pop(k, None)
                self._stale.pop(k, None)
            return len(to_delete)


cache = TTLCache()
