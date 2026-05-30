import time
from typing import Any, Optional


class TTLCache:
    """TTL 캐시 — rate limit 대비 stale 값 반환 지원"""

    def __init__(self):
        self._store: dict[str, tuple[Any, float]] = {}       # 정상 캐시
        self._stale: dict[str, Any]               = {}       # 만료 후에도 유지

    def get(self, key: str) -> Optional[Any]:
        entry = self._store.get(key)
        if entry is None:
            return None
        value, expires_at = entry
        if time.time() > expires_at:
            del self._store[key]
            return None
        return value

    def get_stale(self, key: str) -> Optional[Any]:
        """만료됐더라도 마지막 값 반환 (rate limit 대비 폴백)"""
        fresh = self.get(key)
        if fresh is not None:
            return fresh
        return self._stale.get(key)

    def set(self, key: str, value: Any, ttl: int = 60):
        self._store[key] = (value, time.time() + ttl)
        self._stale[key] = value            # stale 백업 갱신

    def delete(self, key: str):
        self._store.pop(key, None)
        self._stale.pop(key, None)

    def clear(self):
        self._store.clear()
        self._stale.clear()


cache = TTLCache()
