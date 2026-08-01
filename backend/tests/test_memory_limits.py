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
import time
import inspect
import textwrap

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


class Test메모리_구성_보고:
    """'파이썬 자체·기타 281MB'가 무엇인지 알 수 없어 손을 못 대던 문제.

    관리자 화면에서 추정치가 아니라 커널이 적어둔 숫자를 보여주기로 했다.
    추정과 실측을 섞으면 어느 쪽이 틀렸는지 알 수 없으므로, 여기서는
    '실측이 실측답게 나오는가'만 못 박는다."""

    def test_커널이_보고한_구성으로_RSS_를_설명할_수_있다(self):
        b = memory.proc_breakdown()
        if b is None:
            pytest.skip("smaps_rollup 없음 (리눅스 4.14 미만)")
        # 코드(공유) + 전용 데이터만으로 RSS 의 대부분이 설명돼야 한다.
        # 아니라면 엉뚱한 필드를 읽고 있다는 뜻이다
        설명됨 = b["code_shared_mb"] + b["private_dirty_mb"] + b["private_clean_mb"]
        assert b["rss_mb"] > 0
        assert 설명됨 == pytest.approx(b["rss_mb"], rel=0.15), b
        # PSS 는 공유분을 나눠 가진 값이라 RSS 를 넘을 수 없다
        assert 0 < b["pss_mb"] <= b["rss_mb"] * 1.01, b

    def test_읽을_수_없는_환경에서도_터지지_않는다(self, monkeypatch):
        """로컬 맥이나 오래된 커널에서 관리자 화면이 500 이 되면 안 된다"""
        def 못연다(*a, **k):
            raise FileNotFoundError
        monkeypatch.setattr("builtins.open", 못연다)
        assert memory.proc_breakdown() is None

    def test_객체_통계가_실제_개수를_센다(self, monkeypatch):
        monkeypatch.setattr(memory, "_samples", [])
        s = memory.object_stats(top=3)
        assert s["total"] > 1000, s          # 파이썬이 떠 있으면 최소 이만큼은 있다
        assert s["threads"] >= 1
        assert len(s["top"]) == 3
        assert [x["count"] for x in s["top"]] == sorted(
            (x["count"] for x in s["top"]), reverse=True), "많은 순이어야 한다"

    def test_표본이_한_개면_추세라고_말하지_않는다(self, monkeypatch):
        """점 하나로 그은 기울기는 숫자일 뿐 근거가 아니다"""
        monkeypatch.setattr(memory, "_samples", [])
        memory.record_sample()
        t = memory.trend()
        assert t["samples"] <= 1
        assert t["per_hour_mb"] is None
        assert t["points"] == []

    def test_시간당_증가량을_실제_간격으로_나눈다(self, monkeypatch):
        # 30분 동안 100MB → 200MB 면 시간당 +200MB
        monkeypatch.setattr(memory, "_samples", [(1000.0, 100.0), (1000.0 + 1800, 200.0)])
        t = memory.trend()
        assert t["per_hour_mb"] == 200.0, t
        assert t["span_min"] == 30
        assert (t["min_mb"], t["max_mb"], t["points"]) == (100.0, 200.0, [100.0, 200.0])

    def test_표본은_정해진_개수만_남긴다(self, monkeypatch):
        """4시간치만 보면 충분하고, 무한히 쌓이면 그 자체가 누수다"""
        monkeypatch.setattr(memory, "_samples", [])
        monkeypatch.setattr(memory, "rss_mb", lambda: 100.0)
        for _ in range(memory._MAX_SAMPLES + 20):
            memory.record_sample()
        assert len(memory._samples) == memory._MAX_SAMPLES

    def test_측정할_수_없으면_표본을_남기지_않는다(self, monkeypatch):
        monkeypatch.setattr(memory, "_samples", [])
        monkeypatch.setattr(memory, "rss_mb", lambda: None)
        memory.record_sample()
        assert memory._samples == []

    def test_주기_작업이_표본을_남긴다(self):
        """관리자 화면에 추세가 뜨려면 누군가 계속 찍어줘야 한다.
        스케줄러에서 이 호출이 빠지면 화면은 영원히 '표본 없음'이 된다.

        문자열로 찾으면 주석 처리된 것도 '있다'고 세므로 구문으로 본다."""
        import ast
        나무 = ast.parse(inspect.getsource(scheduler))
        호출들 = {
            ast.unparse(n.func) for n in ast.walk(나무)
            if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
        }
        assert "memory.record_sample" in 호출들, "스케줄러가 RSS 표본을 남기지 않는다"

    def test_표본_수집이_쉬는_시간_가드보다_앞에_있다(self):
        """사람이 안 들어오면 스케줄러는 통째로 쉰다(idle → continue).
        표본 수집이 그 아래 있으면 정작 누수를 봐야 할 조용한 시간대에
        기록이 끊긴다. 무거운 갱신보다도 앞이어야 간격이 5분으로 지켜진다."""
        import ast
        본문 = inspect.getsource(scheduler.periodic_refresh)
        나무 = ast.parse(textwrap.dedent(본문)).body[0]
        루프 = next(n for n in ast.walk(나무) if isinstance(n, ast.While))

        표본_위치 = 쉬는시간_위치 = None
        for i, 문 in enumerate(루프.body):
            원문 = ast.unparse(문)
            if "memory.record_sample" in 원문 and 표본_위치 is None:
                표본_위치 = i
            if "seconds_since_last_request" in 원문 and "continue" in 원문:
                쉬는시간_위치 = i
        assert 표본_위치 is not None, "루프 최상위에 표본 수집이 없다"
        assert 쉬는시간_위치 is not None, "쉬는 시간 가드를 못 찾았다"
        assert 표본_위치 < 쉬는시간_위치, (
            f"표본 수집({표본_위치})이 쉬는 시간 가드({쉬는시간_위치}) 뒤에 있다")


class Test만료된_값_보관소:
    """프로덕션 메모리가 아무도 접속하지 않는 시간대에도 시간당 84MB 씩
    늘어 512MB 한도를 넘겼다. 화면에는 '응답 캐시 10.2MB' 로 찍혀 있어서
    캐시는 용의선상에 없었다.

    범인은 만료된 값을 보관하는 몫(_stale)이었다. 외부 API 가 막혔을 때
    마지막 값이라도 보여주려고 두는 것인데 —

      · 개수 상한이 신선 캐시와 같은 50,000건이라 사실상 무한이었고
      · 바이트 상한이 아예 없었고
      · 값이 만료되면 _store 에서만 지우고 여기엔 그대로 남겼다

    그래서 한 번 쓰고 버릴 값까지 영원히 쌓였다."""

    def _큰값(self):
        return [{"d": i, "v": "x" * 200, "n": i * 1.5} for i in range(2000)]

    def test_만료가_반복돼도_무한정_쌓이지_않는다(self):
        c = TTLCache()
        큰값 = self._큰값()
        for r in range(6):
            for i in range(120):
                c.set(f"chart:{r}:{i}", 큰값, 1)
            time.sleep(1.05)
            for i in range(120):
                c.get(f"chart:{r}:{i}")        # 만료 확인 — 예전엔 여기서 샜다
        assert len(c._stale) <= c._stale_maxitems, (
            f"만료 보관분이 {len(c._stale)}건 — 상한 {c._stale_maxitems} 을 넘었다")
        assert c._stale_total <= c._stale_maxbytes

    def test_만료_보관분에도_바이트_상한이_있다(self):
        """개수만 제한하면 큰 값 하나를 못 막는다 — 신선 캐시가 이미
        같은 이유로 바이트 상한을 갖고 있다."""
        c = TTLCache()
        c._stale_maxbytes = 200_000
        for i in range(50):
            c.set(f"big:{i}", self._큰값(), 1)
        assert c._stale_total <= c._stale_maxbytes, (
            f"{c._stale_total} 바이트 — 상한 {c._stale_maxbytes}")

    def test_만료된_값도_사용량에_잡힌다(self):
        """예전에는 stale 몫이 stats() 에서 빠져 있어, 화면에 10MB 로
        보이는 동안 실제로는 수백 MB 였다."""
        c = TTLCache()
        c.set("a", self._큰값(), 1)
        time.sleep(1.05)
        c.get("a")                              # 신선 캐시에서 빠진다
        st = c.stats()
        assert st["items"] == 0                 # 신선한 건 없지만
        # MB 는 반올림이라 압축된 값은 0.0 으로 보인다. 바이트로 본다.
        assert c._stale_total > 0               # 메모리는 쓰고 있다
        assert st["bytes"] >= c._stale_total, "합계에 만료 보관분이 들어가야 한다"

    def test_만료되면_신선_사용량에서_빠진다(self):
        """예전에는 _store 에서만 지우고 _total_bytes 는 그대로 둬서,
        쓰지도 않는 바이트가 계속 쌓여 회계가 어긋났다."""
        c = TTLCache()
        c.set("a", self._큰값(), 1)
        assert c._total_bytes > 0
        time.sleep(1.05)
        c.get("a")
        assert c._total_bytes == 0, (
            f"만료된 값이 신선 사용량에 {c._total_bytes} 바이트 남아 있다")

    def test_그래도_마지막_값은_돌려준다(self):
        """상한을 두더라도 이 보관소의 본래 목적은 지켜야 한다 —
        외부 API 가 막혔을 때 마지막으로 받은 값을 내주는 것."""
        c = TTLCache()
        c.set("price:005930", {"price": 72400}, 1)
        time.sleep(1.05)
        assert c.get("price:005930") is None            # 신선한 값은 없고
        assert c.get_stale("price:005930") == {"price": 72400}   # 마지막 값은 있다

    def test_지우면_양쪽에서_모두_사라진다(self):
        c = TTLCache()
        c.set("k", self._큰값(), 60)
        c.delete("k")
        assert c.get_stale("k") is None
        assert c._stale_total == 0

    def test_전체_삭제하면_보관분도_0이_된다(self):
        c = TTLCache()
        for i in range(20):
            c.set(f"k{i}", self._큰값(), 60)
        c.clear()
        assert len(c._stale) == 0 and c._stale_total == 0
        assert c.stats()["mb"] == 0


class Test무엇이_늘었는지_알아내기:
    """메모리가 오르는 건 보이는데 원인을 못 찾아 캐시·스레드·라이브러리를
    하나씩 짚어가며 추측한 적이 있다. 파이썬은 자기가 어디서 무엇을
    할당했는지 말해 줄 수 있으므로 그냥 물어보게 만든다."""

    def test_기본값은_꺼짐이다(self):
        """상시로 켜면 메모리를 10~25% 더 쓴다. 512MB 짜리에서 그걸
        기본으로 켤 수는 없다 — 환경변수로 켠 게 아니면 꺼져 있어야 한다."""
        import os
        켜져있나 = os.getenv("MEM_TRACE", "").strip() in ("1", "true", "yes")
        assert memory._TRACE == 켜져있나, (
            "MEM_TRACE 를 켜지 않았는데 추적이 켜져 있다 — "
            "상시 추적은 이 인스턴스에서 감당할 수 없다")

    def test_꺼져_있으면_아무것도_돌려주지_않는다(self, monkeypatch):
        monkeypatch.setattr(memory, "_TRACE", False)
        g = memory.alloc_growth()
        assert g["enabled"] is False
        assert g["items"] == []

    def test_켜면_늘어난_곳을_짚어_준다(self, monkeypatch):
        monkeypatch.setattr(memory, "_TRACE", True)
        monkeypatch.setattr(memory, "_기준_스냅샷", None)
        monkeypatch.setattr(memory, "_samples", [(0.0, 100.0), (1.0, 100.0)])
        try:
            memory._추적_표본()      # tracemalloc 시작
            memory._추적_표본()      # 기준 스냅샷
            보관 = {i: {"a": i, "b": "x" * 50} for i in range(20000)}
            g = memory.alloc_growth()
            assert g["ready"] is True, g
            assert g["items"], "늘었는데 아무것도 짚지 못했다"
            제일큰것 = g["items"][0]
            assert 제일큰것["grew_kb"] > 500, 제일큰것
            assert "test_memory_limits" in 제일큰것["where"], (
                f"어디서 늘었는지 못 짚었다: {제일큰것['where']}")
            # '늘어난 곳' 목록에 줄어든 곳이 섞이면 읽는 사람이 헷갈린다
            assert all(it["grew_kb"] >= 0 for it in g["items"]), g["items"]
            assert all(it["count_diff"] > 0 or it["grew_kb"] > 0 for it in g["items"])
            del 보관
        finally:
            import tracemalloc
            if tracemalloc.is_tracing():
                tracemalloc.stop()
            memory._기준_스냅샷 = None

    def test_gc_로는_이걸_대신할_수_없다(self):
        """숫자·문자열만 든 dict 은 순환참조가 불가능해서 GC 가 추적을
        끊는다. 캐시에 담기는 값이 정확히 그 모양이라, 2만 개를 만들어도
        gc.get_objects() 에는 거의 잡히지 않는다 — 이 사실을 모르고
        gc 기반 진단을 만들었다가 헛다리를 짚었다."""
        import gc
        gc.collect()
        전 = memory.object_stats()["total"]
        보관 = {i: {"a": i, "b": "x" * 50} for i in range(20000)}
        후 = memory.object_stats()["total"]
        assert 후 - 전 < 1000, (
            f"gc 가 {후 - 전}개를 잡았다 — 이 전제가 바뀌었다면 "
            f"gc 기반 진단을 다시 고려해도 된다")
        assert len(보관) == 20000

    def test_줄어든_곳은_늘어난_곳에_섞지_않는다(self, monkeypatch):
        """'늘어난 곳' 목록에 줄어든 항목이 섞이면 읽는 사람이 엉뚱한
        곳을 파게 된다."""
        monkeypatch.setattr(memory, "_TRACE", True)
        monkeypatch.setattr(memory, "_기준_스냅샷", None)
        monkeypatch.setattr(memory, "_samples", [(0.0, 100.0), (1.0, 100.0)])
        try:
            memory._추적_표본()          # tracemalloc 시작
            # 추적이 켜진 뒤에 할당해야 지웠을 때 '줄었다'로 잡힌다
            버릴것 = [{"x": i, "y": "z" * 80} for i in range(30000)]
            memory._추적_표본()          # 기준 스냅샷 (버릴것이 살아 있는 상태)
            del 버릴것                    # 이제 줄어든다
            import gc
            gc.collect()
            남길것 = {i: "a" * 40 for i in range(5000)}
            g = memory.alloc_growth(top=200)   # 넉넉히 받아 줄어든 것도 섞이게 한다
            assert g["ready"] is True
            # compare_to 는 절댓값 순이라, 거르지 않으면 크게 '줄어든' 곳이
            # 오히려 1위 '늘어난 곳' 으로 올라온다
            줄어든것 = [it for it in g["items"] if it["grew_kb"] < 0]
            assert not 줄어든것, f"줄어든 곳이 섞였다: {줄어든것[:3]}"
            assert len(남길것) == 5000
        finally:
            import tracemalloc
            if tracemalloc.is_tracing():
                tracemalloc.stop()
            memory._기준_스냅샷 = None

    def test_추적이_실패해도_화면이_죽지_않는다(self, monkeypatch):
        monkeypatch.setattr(memory, "_TRACE", True)
        monkeypatch.setattr(memory, "_기준_스냅샷", object())   # 엉뚱한 값
        g = memory.alloc_growth()
        assert g["enabled"] is True and g["ready"] is False
        assert g["items"] == []
