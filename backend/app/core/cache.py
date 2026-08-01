import json
import os
import sys
import threading
import time
import zlib
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

# 만료된 값을 따로 보관하는 몫(_stale)의 상한.
#
# 이 보관소의 목적은 하나다 — 외부 API 가 막혔을 때 '마지막으로 받은 값'
# 이라도 보여주는 것. 그러려면 최근 것 얼마간이면 충분하지, 지금까지 거쳐
# 간 모든 값이 필요하지 않다.
#
# 예전에는 여기에 바이트 상한이 없고 개수 상한만 신선 캐시와 같은
# 50,000건이라 사실상 무한이었다. 게다가 값이 만료되면 _store 에서만
# 지우고 _stale 에는 그대로 남겨서, 한 번 쓰고 버릴 값까지 영원히 쌓였다.
# 프로덕션에서 아무도 접속하지 않는 시간대에도 시간당 84MB 씩 늘어
# 512MB 한도를 넘겼다. 화면의 '응답 캐시 10.2MB' 에는 이 몫이 제대로
# 잡히지 않아 눈에 띄지도 않았다.
STALE_MAX_BYTES = int(os.getenv("STALE_MAX_BYTES", 16 * 1024 * 1024))
STALE_MAX_ITEMS = int(os.getenv("STALE_MAX_ITEMS", 400))


# 이 크기를 넘는 값은 압축해 보관한다.
#
# OHLCV 시계열은 파이썬 객체로 두면 1행에 약 775바이트인데, 실제 정보는
# 날짜 문자열 하나와 숫자 다섯 개뿐이다. JSON으로 직렬화하고 압축하면
# 실제 시세 데이터 기준 약 28배가 줄어, 12,000행 차트가 8.9MB → 0.33MB 가
# 된다. 같은 캐시 용량(80MB)에 차트 8개 대신 약 240개가 들어간다.
#
# 값을 꺼낼 때 약 20ms가 들지만(CPU가 느리면 그 몇 배), 캐시에서 밀려나
# 야후에서 다시 받아오는 데 걸리는 몇 초와는 비교가 되지 않는다.
COMPRESS_OVER_BYTES = int(os.getenv("CACHE_COMPRESS_OVER", 256 * 1024))
_COMPRESS_LEVEL = 1     # 압축률은 level 6과 거의 같은데 더 빠르다


class _Packed:
    """압축해 보관 중인 값. 캐시 내부에서만 쓰인다."""
    __slots__ = ("blob", "nbytes")

    def __init__(self, blob: bytes):
        self.blob = blob
        self.nbytes = len(blob)


def _pack(value: Any) -> Any:
    """큰 값만 압축한다. JSON으로 만들 수 없는 값은 그대로 둔다."""
    try:
        raw = json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode()
    except (TypeError, ValueError):
        return value
    if len(raw) < COMPRESS_OVER_BYTES:
        return value
    return _Packed(zlib.compress(raw, _COMPRESS_LEVEL))


def _unpack(value: Any) -> Any:
    if isinstance(value, _Packed):
        return json.loads(zlib.decompress(value.blob))
    return value


def _rough_size(v: Any) -> int:
    """값의 대략적인 바이트 크기.

    정확할 필요는 없다. 필요한 건 'OHLCV 시계열처럼 큰 값'과 '시세 dict처럼
    작은 값'을 자릿수 단위로 구분하는 것뿐이다. 전체를 재귀 순회하면 그 자체가
    비싸므로, 리스트는 앞쪽 몇 개만 재보고 곱한다."""
    try:
        if isinstance(v, _Packed):
            return v.nbytes
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
        # 만료된 값의 마지막 사본. 자체 예산(개수·바이트)을 따로 갖는다 —
        # 신선 캐시와 같은 상한을 쓰면 사실상 무한이 되어 조용히 샌다.
        self._stale: OrderedDict[str, Any] = OrderedDict()
        self._stale_bytes: OrderedDict[str, int] = OrderedDict()
        self._stale_total = 0
        # 값을 마지막으로 쓴 시각. 만료(_store에서 삭제)된 뒤에도 남는다 —
        # stale 값을 내보낼 때 '얼마나 묵은 값인지' 알려주기 위한 것이다.
        self._written: OrderedDict[str, float] = OrderedDict()
        self._bytes: OrderedDict[str, int] = OrderedDict()
        self._total_bytes = 0
        self._maxsize = maxsize
        self._maxbytes = maxbytes
        self._stale_maxbytes = STALE_MAX_BYTES
        self._stale_maxitems = STALE_MAX_ITEMS
        self._lock = threading.Lock()

    def _stale_put(self, key: str, value: Any, size: int):
        """락을 이미 잡은 상태에서 호출한다. 예산을 넘으면 오래된 것부터 버린다."""
        if key in self._stale_bytes:
            self._stale_total -= self._stale_bytes.pop(key)
        self._stale[key] = value
        self._stale.move_to_end(key)
        self._stale_bytes[key] = size
        self._stale_bytes.move_to_end(key)
        self._stale_total += size
        while self._stale and (
            len(self._stale) > self._stale_maxitems
            or self._stale_total > self._stale_maxbytes
        ):
            old, _ = self._stale.popitem(last=False)
            self._stale_total -= self._stale_bytes.pop(old, 0)

    def _stale_drop(self, key: str):
        """락을 이미 잡은 상태에서 호출한다"""
        self._stale.pop(key, None)
        self._stale_total -= self._stale_bytes.pop(key, 0)

    def get(self, key: str) -> Optional[Any]:
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            value, expires_at = entry
            if time.time() > expires_at:
                # 만료 — 신선 캐시에서 빼고 그 몫의 바이트도 함께 돌려놓는다.
                # 예전에는 _store 에서만 지워서, 이 값이 차지하던 바이트가
                # _total_bytes 에 영원히 남아 회계가 어긋났다.
                del self._store[key]
                self._total_bytes -= self._bytes.pop(key, 0)
                return None
            # 최근 접근 항목을 뒤로 이동 (LRU)
            self._store.move_to_end(key)
        return _unpack(value)

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
            value = self._stale.get(key)
        return _unpack(value)

    def _evict(self, key: str):
        """락을 이미 잡은 상태에서 호출한다"""
        self._store.pop(key, None)
        self._stale_drop(key)
        self._written.pop(key, None)
        self._total_bytes -= self._bytes.pop(key, 0)

    def set(self, key: str, value: Any, ttl: int = 60):
        value = _pack(value)
        size = _rough_size(value)
        with self._lock:
            if key in self._bytes:
                self._total_bytes -= self._bytes[key]

            now = time.time()
            self._store[key] = (value, now + ttl)
            self._store.move_to_end(key)
            self._stale_put(key, value, size)
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

            # written 은 시각(float)만 담아 가볍지만, 그래도 한없이 늘면
            # 안 되므로 상한을 둔다. stale 은 _stale_put 이 스스로 지킨다.
            while len(self._written) > self._maxsize:
                self._written.popitem(last=False)

    def delete(self, key: str):
        with self._lock:
            self._evict(key)

    def clear(self):
        with self._lock:
            self._store.clear()
            self._stale.clear()
            self._stale_bytes.clear()
            self._stale_total = 0
            self._written.clear()
            self._bytes.clear()
            self._total_bytes = 0

    def size(self) -> int:
        return len(self._store)

    def bytes_used(self) -> int:
        return self._total_bytes

    def packed_count(self) -> int:
        return sum(1 for v, _ in self._store.values() if isinstance(v, _Packed))

    def by_prefix(self) -> list[dict]:
        """종류별 사용량 — 무엇이 캐시를 채우는지 한눈에 보려고 둔다"""
        groups: dict[str, list[int]] = {}
        with self._lock:
            for k, n in self._bytes.items():
                head = k.split(":", 1)[0] if ":" in k else k
                g = groups.setdefault(head, [0, 0])
                g[0] += 1
                g[1] += n
        return sorted(
            [{"prefix": k, "items": v[0], "bytes": v[1], "mb": round(v[1] / 1024 / 1024, 2)}
             for k, v in groups.items()],
            key=lambda x: -x["bytes"],
        )

    def stats(self) -> dict:
        # 만료된 값 보관분(stale)도 엄연히 메모리를 쓴다. 예전에는 이걸
        # 빼고 보고해서, 화면에는 '10MB' 인데 실제로는 수백 MB 인 상태를
        # 아무도 알아채지 못했다.
        return {
            "packed": self.packed_count(),
            "items": len(self._store),
            "bytes": self._total_bytes + self._stale_total,
            "mb": round((self._total_bytes + self._stale_total) / 1024 / 1024, 1),
            "limit_mb": round((self._maxbytes + self._stale_maxbytes) / 1024 / 1024, 1),
            "fresh_mb": round(self._total_bytes / 1024 / 1024, 1),
            "stale_mb": round(self._stale_total / 1024 / 1024, 1),
            "stale_items": len(self._stale),
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
