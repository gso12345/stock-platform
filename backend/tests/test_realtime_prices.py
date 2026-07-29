"""
실시간 시세 — 무엇을, 얼마나 자주 갱신하는가.

'내 자산·관심종목이 실시간이 아니다'의 진짜 원인은 두 가지였다.

(1) 백그라운드 스케줄러가 아예 돌지 않았다. lifespan 안에서
    @app.on_event("startup") 으로 핸들러를 '등록'했는데, 그 시점엔 startup이
    이미 진행 중이라 등록된 핸들러가 영영 실행되지 않았다. 오류가 나지 않아
    서버는 정상으로 보였고, 시세는 처음 조회된 값에 그대로 멈춰 있었다.

(2) 설령 돌았어도 보유종목 갱신은 5분 주기였다. WebSocket은 30초마다 밀었으니
    같은 값을 10~14번 반복 전송한 셈이다.

둘 다 조용히 실패하는 종류라 테스트로 못 박아 둔다.
"""
import asyncio
import inspect
from datetime import datetime, timedelta, timezone

import pytest

from app.services import market_hours as mh
from app.services import watched
from app.services import scheduler
from app.api.websocket import price_stream
from app.core.cache import TTLCache

KST = timezone(timedelta(hours=9))


@pytest.fixture(autouse=True)
def _빈_레지스트리():
    watched._refcount.clear()
    watched._market_of.clear()
    yield
    watched._refcount.clear()
    watched._market_of.clear()


# ── 스케줄러가 실제로 뜨는가 ──────────────────────────────────
class Test백그라운드_루프:
    def test_startup_이벤트에_의존하지_않는다(self):
        # lifespan 안에서 on_event("startup")을 등록하면 절대 실행되지 않는다.
        # 이것 때문에 모든 주기 갱신이 한 번도 돌지 않았다.
        # (주석에는 이 단어가 설명으로 등장하므로 실행되는 코드만 본다)
        코드 = "\n".join(
            l.split("#")[0] for l in inspect.getsource(scheduler.start_background_tasks).splitlines()
        )
        코드 = 코드.replace(scheduler.start_background_tasks.__doc__ or "", "")
        assert "on_event" not in 코드, "startup 이벤트에 등록하면 lifespan에서 실행되지 않는다"
        for 이름 in ("run_startup_prefetch", "periodic_refresh", "refresh_watched_loop"):
            assert 이름 in 코드, f"{이름} 루프가 시작되지 않는다"

    def test_lifespan을_돌리면_루프가_실제로_뜬다(self):
        # 위 검사는 코드 모양만 본다. 진짜로 뜨는지는 lifespan을 실행해 확인한다
        from app.main import app

        async def run():
            async with app.router.lifespan_context(app):
                await asyncio.sleep(0.5)
                return {t.get_name() for t in scheduler._tasks}, all(not t.done() for t in scheduler._tasks)

        이름들, 살아있음 = asyncio.run(run())
        assert {"periodic-refresh", "watched-prices"} <= 이름들, f"뜬 루프: {이름들}"
        assert 살아있음

    def test_태스크_참조를_붙잡는다(self):
        # create_task 결과를 아무도 안 잡고 있으면 가비지 컬렉션으로
        # 루프가 도중에 조용히 사라질 수 있다(파이썬 공식 경고)
        assert isinstance(scheduler._tasks, set)
        assert "_tasks.add" in inspect.getsource(scheduler._spawn)

    def test_루프가_죽으면_로그를_남긴다(self):
        # 예전에는 태스크가 예외로 죽어도 흔적이 없어, 시세가 멈춰도 알 수 없었다
        src = inspect.getsource(scheduler._on_task_done)
        assert "log.error" in src and "log.warning" in src


# ── 무엇을 갱신하는가 ────────────────────────────────────────
class Test구독_레지스트리:
    def test_보는_사람이_생기면_대상에_들어간다(self):
        asyncio.run(watched.subscribe([("005930", "KR"), ("AAPL", "US")]))
        assert dict(watched.snapshot()) == {"005930": "KR", "AAPL": "US"}

    def test_여러_화면이_같은_종목을_봐도_한_번만_갱신한다(self):
        asyncio.run(watched.subscribe([("005930", "KR")]))
        asyncio.run(watched.subscribe([("005930", "KR")]))
        assert len(watched.snapshot()) == 1
        assert watched.stats() == {"symbols": 1, "connections": 2}

    def test_한_화면을_닫아도_다른_화면이_보고_있으면_유지된다(self):
        asyncio.run(watched.subscribe([("005930", "KR")]))
        asyncio.run(watched.subscribe([("005930", "KR")]))
        asyncio.run(watched.unsubscribe([("005930", "KR")]))
        assert len(watched.snapshot()) == 1

    def test_아무도_안_보면_대상에서_사라진다(self):
        # 이게 핵심이다. 예전에는 1년째 로그인 안 한 사용자의 관심종목까지
        # 5분마다 갱신하느라 정작 지금 보는 종목에 예산을 못 썼다
        asyncio.run(watched.subscribe([("005930", "KR")]))
        asyncio.run(watched.unsubscribe([("005930", "KR")]))
        assert watched.snapshot() == []

    def test_없는_종목을_해제해도_터지지_않는다(self):
        asyncio.run(watched.unsubscribe([("ZZZZ", "US")]))
        assert watched.stats()["symbols"] == 0

    def test_대상이_없으면_외부_API를_부르지_않는다(self):
        assert asyncio.run(scheduler._refresh_watched_once()) == (0, 0)

    def test_한꺼번에_갱신할_종목_수에_상한이_있다(self):
        asyncio.run(watched.subscribe([(f"S{i:04d}", "US") for i in range(watched.MAX_WATCHED + 50)]))
        assert len(watched.snapshot()) == watched.MAX_WATCHED


# ── 얼마나 자주 갱신하는가 ───────────────────────────────────
class Test갱신_주기:
    @pytest.mark.parametrize("kst_hour, 기대", [
        (9,  "regular"), (12, "regular"), (15, "regular"),
        (16, "after"),   (19, "closed"),  (3,  "closed"),
    ])
    def test_국내_장_시간(self, kst_hour, 기대):
        t = datetime(2026, 7, 28, kst_hour, 0, tzinfo=KST).astimezone(timezone.utc)
        assert mh.kr_session(t) == 기대

    def test_주말은_휴장이다(self):
        토 = datetime(2026, 8, 1, 11, 0, tzinfo=KST).astimezone(timezone.utc)
        assert mh.kr_session(토) == "closed"
        assert mh.us_session(토) == "closed"

    def test_장중에는_빠르게_휴장에는_느리게(self):
        # 게이팅이 없으면 새벽·주말에도 같은 주기로 외부 API를 때린다.
        # 국내 정규장은 하루의 27%뿐이라 나머지가 전부 낭비였다
        assert mh.refresh_interval(["regular"]) <= 15
        assert mh.refresh_interval(["closed", "closed"]) >= 300

    def test_한_시장만_열려도_빠르게_돈다(self):
        assert mh.refresh_interval(["closed", "regular"]) == mh.refresh_interval(["regular"])

    @pytest.mark.parametrize("종목수", [0, 50, 120, 300, 1000])
    def test_종목이_많아지면_주기가_늘어_초당_요청이_묶인다(self, 종목수):
        # 주기를 고정하면 접속자가 늘 때 초당 요청이 그만큼 올라가 차단된다
        sec = mh.refresh_interval(["regular"], symbol_count=종목수)
        assert 종목수 / sec <= mh.MAX_REQ_PER_SEC + 0.5, f"{종목수}종목에서 초당 {종목수/sec:.1f}건"

    def test_종목이_적으면_주기를_늘리지_않는다(self):
        assert mh.refresh_interval(["regular"], symbol_count=10) == mh.refresh_interval(["regular"])


# ── 값이 언제 것인지 알 수 있는가 ────────────────────────────
class Test신선도:
    def test_캐시가_나이를_기억한다(self):
        c = TTLCache()
        c.set("k", {"price": 1}, 1)
        assert c.age("k") < 1
        assert c.age("없는키") is None

    def test_만료된_뒤에도_나이를_알_수_있다(self):
        # 만료되면 _store에서 지워지지만 stale 값은 계속 나간다.
        # 그 값이 몇 초짜리인지 모르면 '멈춘 화면'을 탐지할 수 없다
        import time as _t
        c = TTLCache()
        c.set("k", {"price": 1}, 0)
        _t.sleep(0.05)
        assert c.get("k") is None
        assert c.get_stale("k") == {"price": 1}
        assert c.age("k") >= 0.05

    def test_스트림이_나이와_멈춤여부를_함께_보낸다(self):
        from app.core.cache import cache
        cache.set("price:TESTSYM", {"symbol": "TESTSYM", "price": 100}, 60)
        out = price_stream._cached_price("TESTSYM", "US")
        assert out["price"] == 100
        assert "age" in out and out["stale"] is False
        cache.delete("price:TESTSYM")

    def test_캐시에_없으면_가격이_None이다(self):
        out = price_stream._cached_price("NOSUCHSYM", "US")
        assert out["price"] is None


# ── 연결이 끊겨도 슬롯이 새지 않는가 ─────────────────────────
class Test연결_관리:
    def test_accept가_try_안에_있다(self):
        # 밖에 있으면 핸드셰이크 실패 시 카운터가 영영 안 내려가,
        # 재접속을 반복하는 사용자가 스스로를 차단하게 된다
        for fn in (price_stream.stream_prices, price_stream.stream_indices):
            src = inspect.getsource(fn)
            accept_at = src.index("await ws.accept()")
            try_at = src.index("    try:")
            assert try_at < accept_at, f"{fn.__name__}: accept()가 try 밖에 있다"

    def test_연결이_끝나면_구독을_해제한다(self):
        src = inspect.getsource(price_stream.stream_prices)
        assert "watched.unsubscribe" in src and "finally:" in src

    def test_프록시_뒤에서도_한_명이_전체를_막지_않는다(self):
        # Render는 프록시 뒤라 client.host가 전 사용자 공통으로 잡힌다.
        # 상한이 10이면 11번째 접속자부터 시세를 아예 못 받았다
        assert price_stream.MAX_WS_PER_IP >= 100


class Test백그라운드_부하:
    """Render 무료 플랜은 CPU가 0.1개다. 백그라운드가 쉬지 않고 돌면
    사용자가 실제로 요청했을 때 응답이 그만큼 밀린다. 실제로 실시간 시세를
    켠 뒤 '정보 불러오는 속도가 느려졌다'는 문제가 생겼다."""

    def test_아무도_안_쓰면_주기_갱신을_멈춘다(self):
        import ast, textwrap
        src = textwrap.dedent(inspect.getsource(scheduler.periodic_refresh))
        tree = ast.parse(src)
        멈춤 = any(
            isinstance(n, ast.If)
            and "seconds_since_last_request" in {
                x.attr for x in ast.walk(n.test) if isinstance(x, ast.Attribute)
            }
            and any(isinstance(b, ast.Continue) for b in n.body)
            for n in ast.walk(tree)
        )
        assert 멈춤, "아무도 안 쓰는 동안에도 갱신이 계속 돈다"

    def test_보유종목_갱신이_주기_루프에서_빠졌다(self):
        # refresh_watched_loop 가 '지금 보고 있는 종목'을 15초마다 갱신한다.
        # 전 사용자 보유종목을 5분마다 또 긁는 것은 순수한 중복이다.
        # (주석에는 이 이름이 설명으로 남아 있으므로 실제 호출만 본다)
        import ast, textwrap
        for fn in (scheduler.periodic_refresh, scheduler.run_startup_prefetch):
            tree = ast.parse(textwrap.dedent(inspect.getsource(fn)))
            호출 = {n.func.id for n in ast.walk(tree)
                    if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)}
            assert "refresh_held_symbols" not in 호출, \
                f"{fn.__name__}에 중복된 보유종목 갱신이 남아 있다"

    def test_지수_갱신이_장_시간에_따라_달라진다(self):
        # 휴장 중에는 값이 안 변하는데 30초마다 부르면 CPU만 쓴다
        src = inspect.getsource(scheduler.periodic_refresh)
        assert "kr_session()" in src and "us_session()" in src

    def test_유휴_기준이_너무_짧지_않다(self):
        # 너무 짧으면 잠깐 자리를 비운 사이 캐시가 통째로 묵는다
        assert 300 <= scheduler.IDLE_PAUSE_SEC <= 3600

    def test_실시간_시세는_유휴와_무관하게_돈다(self):
        # 이 루프는 '보고 있는 사람이 있을 때만' 일하므로 별도 유휴 판단이
        # 필요 없다. 여기에 유휴 정지를 걸면 화면을 켜 두고 보는 사용자의
        # 시세가 멈춘다
        assert "seconds_since_last_request" not in inspect.getsource(scheduler.refresh_watched_loop)
