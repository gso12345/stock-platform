"""
메모리 상한 — 프로세스가 강제 재시작되지 않도록 하는 방어선.

Render 무료 플랜은 512MB를 넘으면 프로세스를 죽인다. 실제로 그런 일이 있었다.
원인은 캐시가 '항목 수'만 제한하고 바이트를 전혀 보지 않은 것이었다.
OHLCV 시계열 하나가 20,000행이면 약 15MB인데 항목 수로는 '1개'라서,
23개만 쌓여도 200MB가 됐다.

캐시가 무제한으로 커지지 않는다는 것과, 무거운 선제 캐싱이 작은 인스턴스에서
기본으로 꺼져 있다는 것을 못 박아 둔다.
"""
import os
import inspect

import pytest

from app.core.cache import TTLCache, _rough_size, MAX_CACHE_BYTES
from app.core import memory
from app.services import scheduler


def _본문(fn):
    import ast, textwrap
    return ast.parse(textwrap.dedent(inspect.getsource(fn)))


def _이름들(node) -> set:
    import ast
    return {n.id for n in ast.walk(node) if isinstance(n, ast.Name)} | {
        n.attr for n in ast.walk(node) if isinstance(n, ast.Attribute)
    }


def _조건안에서_호출되나(fn, 조건: str, 호출: str) -> bool:
    """`호출`이 `조건`을 검사하는 if 문 안에서만 나타나는가"""
    import ast
    tree = _본문(fn)
    안에서 = False
    for node in ast.walk(tree):
        if isinstance(node, ast.If) and 조건 in _이름들(node.test):
            if any(호출 in _이름들(b) for b in node.body):
                안에서 = True
    # 조건 밖에서도 불리면 실패
    밖에서 = False
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and 호출 in _이름들(node):
            부모조건 = [p for p in ast.walk(tree)
                        if isinstance(p, ast.If) and 조건 in _이름들(p.test)
                        and any(node is c for b in p.body for c in ast.walk(b))]
            if not 부모조건:
                밖에서 = True
    return 안에서 and not 밖에서


def _가드로_감싸였나(fn, 호출: str) -> bool:
    """`호출`이 has_headroom 결과에 따라 조건부로만 실행되는가"""
    import ast
    tree = _본문(fn)
    for node in ast.walk(tree):
        # `A() if has_headroom(...) else B` 또는 `if has_headroom(...): A()`
        if isinstance(node, ast.IfExp) and "has_headroom" in _이름들(node.test):
            if 호출 in _이름들(node.body) or 호출 in _이름들(node.orelse):
                return True
        if isinstance(node, ast.If) and "has_headroom" in _이름들(node.test):
            if any(호출 in _이름들(b) for b in node.body):
                return True
    return False


def _rough_size_of_stored(v) -> int:
    """캐시에 실제로 들어가는 형태(압축 포함)의 크기"""
    from app.core.cache import _pack
    return _rough_size(_pack(v))


def ohlcv(rows: int) -> list:
    """실제 OHLCV 응답과 같은 모양.

    행마다 값이 달라야 한다 — 똑같은 행을 반복하면 압축률이 비현실적으로
    좋게 나와, 압축 효과를 실제보다 크게 착각하게 된다."""
    import datetime as _dt
    d0 = _dt.date(1990, 1, 2)
    out = []
    for i in range(rows):
        base = 100.0 + (i * 7919 % 9973) / 100.0
        out.append({
            "date":   str(d0 + _dt.timedelta(days=i)),
            "open":   round(base, 2),
            "high":   round(base * 1.013, 2),
            "low":    round(base * 0.987, 2),
            "close":  round(base * (1 + ((i * 31 % 61) - 30) / 3000), 2),
            "volume": 1_000_000 + (i * 104729 % 90_000_000),
        })
    return out


class Test크기_측정:
    def test_큰_값과_작은_값을_자릿수로_구분한다(self):
        시세 = {"symbol": "005930", "price": 71000, "change_rate": 1.2}
        assert _rough_size(시세) < 1_000
        assert _rough_size(ohlcv(20_000)) > 5_000_000

    def test_행_수에_비례한다(self):
        작음, 큼 = _rough_size(ohlcv(100)), _rough_size(ohlcv(10_000))
        assert 큼 / 작음 > 50

    @pytest.mark.parametrize("v", [None, 0, "", [], {}, "문자열", 3.14, [[]], {"a": {"b": [1, 2]}}])
    def test_어떤_값이든_터지지_않는다(self, v):
        assert _rough_size(v) >= 0


class Test바이트_상한:
    def test_상한을_넘으면_오래된_것부터_밀어낸다(self):
        # 압축 후 크기 기준으로 상한을 잡는다 (압축 전 크기로 잡으면
        # 아무것도 밀려나지 않아 검사가 통과해 버린다)
        한개 = _rough_size_of_stored(ohlcv(3_000))
        c = TTLCache(maxbytes=한개 * 3)
        for i in range(10):
            c.set(f"ohlcv:{i}", ohlcv(3_000), 3600)
        assert c.bytes_used() <= 한개 * 3
        assert c.get("ohlcv:0") is None, "가장 오래된 항목이 남아 있다"
        assert c.get("ohlcv:9") is not None, "방금 넣은 항목이 사라졌다"

    def test_방금_넣은_값은_상한을_넘어도_남긴다(self):
        # 하나만으로 상한을 넘는 값이 들어와도 곧바로 자기 자신을 지우면
        # 호출한 쪽은 저장에 성공했다고 믿는데 값이 없는 상태가 된다
        c = TTLCache(maxbytes=1024)
        c.set("huge", ohlcv(5_000), 3600)
        assert c.get("huge") is not None

    def test_같은_키를_덮어써도_사용량이_누적되지_않는다(self):
        c = TTLCache(maxbytes=50 * 1024 * 1024)
        for _ in range(10):
            c.set("same", ohlcv(2_000), 3600)
        assert c.bytes_used() < _rough_size(ohlcv(2_000)) * 2

    def test_삭제하면_사용량이_줄어든다(self):
        c = TTLCache()
        c.set("k", ohlcv(1_000), 3600)
        before = c.bytes_used()
        c.delete("k")
        assert c.bytes_used() < before
        assert c.bytes_used() == 0

    def test_전체_삭제하면_0이_된다(self):
        c = TTLCache()
        for i in range(5):
            c.set(f"k{i}", ohlcv(500), 3600)
        c.clear()
        assert c.bytes_used() == 0

    def test_접두사_삭제도_사용량에_반영된다(self):
        c = TTLCache()
        for i in range(5):
            c.set(f"ohlcv:{i}", ohlcv(500), 3600)
        c.set("price:005930", {"price": 1}, 60)
        before = c.bytes_used()
        c.delete_pattern("ohlcv:")
        assert c.bytes_used() < before / 2

    def test_기본_상한이_인스턴스_크기에_맞는다(self):
        # 이 서비스는 시작만으로 약 290MB를 쓴다(임포트 149MB + 종목 DB 101MB).
        # 512MB에서 요청 처리 여유를 남기려면 캐시는 100MB를 넘으면 안 된다
        assert 20 * 1024 * 1024 <= MAX_CACHE_BYTES <= 100 * 1024 * 1024

    def test_항목_수_상한도_계속_동작한다(self):
        c = TTLCache(maxsize=10, maxbytes=100 * 1024 * 1024)
        for i in range(30):
            c.set(f"k{i}", {"v": i}, 3600)
        assert c.size() <= 10


class Test무거운_작업_차단:
    def test_선제_캐싱은_기본으로_꺼져_있다(self):
        # OHLCV·펀더멘털 프리페치가 약 200MB를 쓴다. 이게 켜지면서
        # 프로세스가 메모리 한도로 강제 재시작됐다
        assert scheduler.HEAVY_PREFETCH is False or os.getenv("ENABLE_HEAVY_PREFETCH")

    def test_프리페치가_환경변수_안에서만_실행된다(self):
        # 함수 어딘가에 단어가 있는지가 아니라, 실제로 그 조건 '안에서'
        # 호출되는지를 본다 — if 를 True 로 바꿔도 단어는 남기 때문이다
        assert _조건안에서_호출되나(
            scheduler.run_startup_prefetch, 조건="HEAVY_PREFETCH", 호출="_prefetch_ohlcv_popular"
        ), "프리페치가 환경변수 조건 밖에서 실행된다"

    def test_무거운_주기_작업이_메모리_가드_안에서만_실행된다(self):
        assert _가드로_감싸였나(scheduler.periodic_refresh, 호출="refresh_us_stocks"), \
            "메모리가 부족해도 전종목 갱신을 강행한다"

    def test_실시간_시세_갱신은_막지_않는다(self):
        # 이건 사용자가 실제로 보고 있는 것이라, 메모리를 이유로 끄면
        # 원래 고치려던 문제로 되돌아간다. 게다가 가벼운 작업이다
        src = inspect.getsource(scheduler.refresh_watched_loop)
        assert "has_headroom" not in src


class Test메모리_측정:
    def test_현재_사용량을_읽을_수_있다(self):
        mb = memory.rss_mb()
        assert mb is None or 1 < mb < 100_000

    def test_측정할_수_없으면_막지_않는다(self, monkeypatch):
        # 알 수 없다는 이유로 기능을 끄면 로컬 개발이 불편해진다
        monkeypatch.setattr(memory, "usage_ratio", lambda: None)
        assert memory.has_headroom("테스트") is True

    @pytest.mark.parametrize("ratio, 기대", [(0.10, True), (0.50, True), (0.74, True), (0.80, False), (0.99, False)])
    def test_임계치를_넘으면_건너뛴다(self, monkeypatch, ratio, 기대):
        monkeypatch.setattr(memory, "usage_ratio", lambda: ratio)
        monkeypatch.setattr(memory, "rss_mb", lambda: ratio * memory.MEMORY_LIMIT_MB)
        assert memory.has_headroom("테스트") is 기대


class Test압축_보관:
    """OHLCV 시계열은 파이썬 객체로 두면 1행 775바이트인데 실제 정보는
    날짜 하나와 숫자 다섯 개다. 압축하면 1행 7바이트가 되어, 같은 용량에
    차트 8개 대신 800개가 들어간다. 이게 없으면 사용자가 차트를 몇 개만
    열어도 이전 것이 밀려나 매번 야후에서 다시 받는다(매번 몇 초)."""

    def test_큰_값은_압축해_보관한다(self):
        from app.core.cache import _Packed, _pack
        assert isinstance(_pack(ohlcv(12_000)), _Packed)

    def test_작은_값은_그대로_둔다(self):
        # 시세 dict 하나까지 압축하면 조회할 때마다 헛수고를 한다
        from app.core.cache import _pack
        assert _pack({"symbol": "005930", "price": 71000}) == {"symbol": "005930", "price": 71000}

    def test_압축해도_값이_정확히_왕복한다(self):
        c = TTLCache()
        rows = ohlcv(12_000)
        c.set("ohlcv:big", rows, 3600)
        assert c.get("ohlcv:big") == rows

    def test_만료된_뒤에도_꺼낼_수_있다(self):
        import time as _t
        c = TTLCache()
        c.set("ohlcv:big", ohlcv(9_000), 0)
        _t.sleep(0.05)
        assert c.get("ohlcv:big") is None
        assert len(c.get_stale("ohlcv:big")) == 9_000

    def test_압축_덕분에_같은_용량에_훨씬_많이_들어간다(self):
        c = TTLCache(maxbytes=80 * 1024 * 1024)
        for i in range(60):
            c.set(f"ohlcv:{i}", ohlcv(12_000), 3600)
        # 압축이 없으면 60개 × 8.9MB = 534MB 라 대부분 밀려났을 것이다
        assert c.size() >= 60, f"{c.size()}개만 남았다 — 압축이 동작하지 않는다"
        assert c.bytes_used() < 20 * 1024 * 1024

    def test_JSON으로_만들_수_없는_값도_저장된다(self):
        # 압축하려다 실패해서 저장 자체가 안 되면 안 된다
        class 이상한값:
            pass
        c = TTLCache()
        v = 이상한값()
        c.set("odd", v, 60)
        assert c.get("odd") is v

    def test_압축된_항목도_사용량에_정확히_반영된다(self):
        c = TTLCache()
        c.set("ohlcv:a", ohlcv(12_000), 3600)
        used = c.bytes_used()
        assert 0 < used < 1024 * 1024, f"{used} — 압축 후 크기로 세야 한다"
        c.delete("ohlcv:a")
        assert c.bytes_used() == 0
