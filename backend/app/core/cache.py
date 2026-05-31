import time
from typing import Any, Optional
from collections import OrderedDict


MAX_CACHE_SIZE = 50_000  # 최대 항목 수 (초과 시 오래된 것부터 삭제)


class TTLCache:
    """TTL 캐시 — rate limit 대비 stale 값 반환 지원 + 메모리 제한"""

    def __init__(self, maxsize: int = MAX_CACHE_SIZE):
        self._store: OrderedDict[str, tuple[Any, float]] = OrderedDict()
        self._stale: OrderedDict[str, Any] = OrderedDict()
        self._maxsize = maxsize

    def get(self, key: str) -> Optional[Any]:
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
        return self._stale.get(key)

    def set(self, key: str, value: Any, ttl: int = 60):
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
        self._store.pop(key, None)
        self._stale.pop(key, None)

    def clear(self):
        self._store.clear()
        self._stale.clear()

    def size(self) -> int:
        return len(self._store)


cache = TTLCache()
