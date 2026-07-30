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


class Test시세없는자산_섞임:
    """관심종목 20개의 시세가 통째로 사라졌던 회귀.

    보유종목을 시세 조회에 합치자마자 벌어진 일이다. 포트폴리오는 '현금'·'금'·
    '채권' 같은 한글 심볼을 담을 수 있는데(자산 배분을 보려면 필요하다),
    시세 조회 쪽은 그런 심볼을 보면
      · REST  → 400 으로 요청 전체를 거절
      · WS    → close(4000) 으로 연결 전체를 종료 → 화면에 '연결 끊김'
    했다. 국내 3종목은 서버에 값이 있었는데도 화면에는 아무것도 안 나왔다.

    한 항목 때문에 나머지가 죽는 구조 자체를 고쳤다."""

    def _client(self):
        from fastapi.testclient import TestClient
        from app.main import app
        return TestClient(app)

    def test_현금이_섞여도_나머지_시세를_돌려준다(self):
        c = self._client()
        r = c.get("/api/v1/watchlist/prices",
                  params={"symbols": "005930.KS,AAPL,현금", "markets": "KR,US,KR"})
        assert r.status_code == 200, f"400 으로 전체를 거절하면 안 된다: {r.text[:200]}"
        by = {x["symbol"]: x for x in r.json()}
        assert set(by) == {"005930.KS", "AAPL", "현금"}, "요청한 심볼이 모두 응답에 있어야 한다"

    @pytest.mark.parametrize("이상한심볼", ["현금", "금", "채권", "커버드콜"])
    def test_조회할_수_없는_자산_이름들(self, 이상한심볼):
        c = self._client()
        r = c.get("/api/v1/watchlist/prices",
                  params={"symbols": f"005930.KS,{이상한심볼}", "markets": "KR,KR"})
        assert r.status_code == 200
        assert len(r.json()) == 2

    def test_전부_조회_대상이_아니어도_형식은_지킨다(self):
        c = self._client()
        r = c.get("/api/v1/watchlist/prices", params={"symbols": "현금,금", "markets": "KR,KR"})
        assert r.status_code == 200
        assert [x["symbol"] for x in r.json()] == ["현금", "금"]
        assert all(x["price"] is None for x in r.json())

    def test_50개_상한은_그대로_지킨다(self):
        c = self._client()
        r = c.get("/api/v1/watchlist/prices",
                  params={"symbols": ",".join(f"A{i}" for i in range(51)), "markets": "US"})
        assert r.status_code == 400

    def test_WS는_이상한_심볼만_빼고_연결한다(self):
        """연결을 닫으면 관심종목 전체가 '연결 끊김'이 된다."""
        c = self._client()
        with c.websocket_connect(
            "/ws/prices?symbols=005930.KS,현금,AAPL&markets=KR,KR,US&interval=5"
        ) as ws:
            msg = ws.receive_json()
            assert msg["type"] == "prices"
            돌아온것 = {d["symbol"] for d in msg["data"]}
            assert "현금" not in 돌아온것
            assert {"005930.KS", "AAPL"} <= 돌아온것, \
                f"이상한 심볼 하나 때문에 나머지가 빠졌다: {돌아온것}"

    def test_WS_심볼이_전부_이상하면_그냥_닫는다(self):
        # 구독할 게 없는 연결을 열어두면 슬롯만 차지한다
        import websockets.exceptions
        c = self._client()
        try:
            with c.websocket_connect("/ws/prices?symbols=현금&markets=KR") as ws:
                ws.receive_json()
            assert False, "닫혀야 한다"
        except Exception:
            pass    # 정상 종료(1000) 또는 수신 실패 — 어느 쪽이든 연결이 유지되지 않는다


class Test야후_배치_인증:
    """'야후 시세 0% — 응답 없음'이 몇 주째 붉게 떠 있던 이유.

    야후는 v7/quote 에 crumb(인증 토큰)를 요구한다. 우리 배치는 httpx 로 그냥
    불러서 늘 빈 응답이었다. 그런데 종목별 단건 폴백은 잘 됐다 — 그쪽은
    yfinance 패키지를 쓰고, yfinance 가 crumb·쿠키·브라우저 흉내를 처리하기
    때문이다. 같은 세션을 배치에도 쓰면 요청 한 번으로 끝난다."""

    def test_인증_세션을_먼저_쓴다(self):
        # run_in_executor 에 넘기므로 '호출'이 아니라 '이름'으로 등장한다
        import ast
        import inspect as _i
        from app.services import price_fetcher as pf
        tree = ast.parse(_i.getsource(pf.fetch_yf_quotes))
        이름들 = {n.id for n in ast.walk(tree) if isinstance(n, ast.Name)}
        assert "_fetch_yf_quotes_authed_sync" in 이름들, \
            "인증 세션 경로를 안 쓰면 배치는 계속 빈 응답이다"

    def test_인증_배치가_되면_맨몸_호출은_안_한다(self, monkeypatch):
        from app.services import price_fetcher as pf
        불린것 = []
        monkeypatch.setattr(pf, "_fetch_yf_quotes_authed_sync",
                            lambda syms: (불린것.append("authed"),
                                          [{"symbol": "AAPL", "regularMarketPrice": 241.5}])[1])

        async def 맨몸(syms):
            불린것.append("raw")
            return []
        monkeypatch.setattr(pf, "_fetch_yf_quotes_raw", 맨몸)
        out = asyncio.run(pf.fetch_yf_quotes(["AAPL"]))
        assert 불린것 == ["authed"]
        assert out["AAPL"]["price"] == 241.5

    def test_인증이_안_되면_맨몸으로_넘어간다(self, monkeypatch):
        # yfinance 내부 API에 기대는 코드라 버전이 바뀌면 못 쓸 수 있다
        from app.services import price_fetcher as pf
        monkeypatch.setattr(pf, "_fetch_yf_quotes_authed_sync", lambda syms: None)

        async def 맨몸(syms):
            return [{"symbol": "AAPL", "regularMarketPrice": 100.0}]
        monkeypatch.setattr(pf, "_fetch_yf_quotes_raw", 맨몸)
        out = asyncio.run(pf.fetch_yf_quotes(["AAPL"]))
        assert out["AAPL"]["price"] == 100.0

    def test_둘_다_안_되면_빈_결과를_돌려준다(self, monkeypatch):
        from app.services import price_fetcher as pf
        monkeypatch.setattr(pf, "_fetch_yf_quotes_authed_sync",
                            lambda syms: (_ for _ in ()).throw(RuntimeError("x")))

        async def 맨몸(syms):
            return None
        monkeypatch.setattr(pf, "_fetch_yf_quotes_raw", 맨몸)
        assert asyncio.run(pf.fetch_yf_quotes(["AAPL"])) == {}

    def test_인증_경로가_예외를_밖으로_던지지_않는다(self, monkeypatch):
        """yfinance 내부 구조가 바뀌어도 시세 조회가 통째로 죽으면 안 된다."""
        from app.services import price_fetcher as pf
        import yfinance.data as ydata
        monkeypatch.setattr(ydata, "YfData",
                            lambda *a, **k: (_ for _ in ()).throw(RuntimeError("구조 변경")))
        assert pf._fetch_yf_quotes_authed_sync(["AAPL"]) is None

    def test_파싱은_한_곳뿐이다(self):
        # 경로가 둘인데 파싱이 둘이면 한쪽만 고치는 실수가 난다
        import inspect as _i
        from app.services import price_fetcher as pf
        for fn in (pf._fetch_yf_quotes_authed_sync, pf._fetch_yf_quotes_raw):
            assert "regularMarketPrice" not in _i.getsource(fn).replace("_YF_QUOTE_FIELDS", ""), \
                f"{fn.__name__} 이 응답을 직접 파싱하고 있다"


class Test폴백_비용과_계측:
    def test_단건_폴백_개수를_함께_돌려준다(self, monkeypatch):
        # 배치가 죽었는데 폴백이 받쳐주는 상태를 '정상'과 구분하기 위한 값
        from app.services import price_fetcher as pf

        async def 배치없음(syms):
            return {}
        monkeypatch.setattr(pf, "fetch_yf_quotes", 배치없음)
        monkeypatch.setattr(pf, "_fetch_yf_quote_single_sync",
                            lambda s: {"symbol": s, "price": 10.0})
        data, filled = asyncio.run(pf.fetch_yf_quotes_with_fallback(["AAPL", "MSFT"]))
        assert len(data) == 2 and filled == 2

    def test_배치가_되면_폴백은_0이다(self, monkeypatch):
        from app.services import price_fetcher as pf

        async def 배치(syms):
            return {s: {"symbol": s, "price": 1.0} for s in syms}
        monkeypatch.setattr(pf, "fetch_yf_quotes", 배치)
        data, filled = asyncio.run(pf.fetch_yf_quotes_with_fallback(["AAPL"]))
        assert filled == 0

    def test_단건_폴백_개수에_상한이_있다(self, monkeypatch):
        """단건은 종목당 요청 하나다. 0.15 CPU 에서 수십 개를 매 주기마다
        돌리면 그것만으로 CPU 를 다 쓴다."""
        from app.services import price_fetcher as pf
        부른횟수 = []

        async def 배치없음(syms):
            return {}
        monkeypatch.setattr(pf, "fetch_yf_quotes", 배치없음)
        monkeypatch.setattr(pf, "_fetch_yf_quote_single_sync",
                            lambda s: (부른횟수.append(s), {"symbol": s, "price": 1.0})[1])
        asyncio.run(pf.fetch_yf_quotes_with_fallback([f"S{i}" for i in range(100)], max_fallback=5))
        assert len(부른횟수) == 5, f"상한을 안 지켰다: {len(부른횟수)}회"

    def test_배경_루프도_폴백을_쓴다(self):
        # 이게 없으면 해외 종목은 실시간(15초) 갱신이 안 되고 60초 REST 에만 의존한다
        import inspect as _i
        from app.services import scheduler
        src = _i.getsource(scheduler._refresh_watched_once)
        assert "fetch_yf_quotes_with_fallback" in src

    def test_폴백으로_복구되면_실패로_세지_않는다(self):
        """붉은 경고가 계속 떠 있으면 진짜 문제가 묻힌다."""
        import inspect as _i
        from app.services import scheduler
        src = _i.getsource(scheduler._refresh_watched_once)
        # 데이터가 있는데 record_fail 로 가는 분기가 없어야 한다
        assert "elif data:" in src and "단건 폴백" in src
        i_ok = src.index("배치 막혀 단건 폴백")
        i_fail = src.index('health.record_fail("야후 시세"')
        assert i_ok < i_fail, "폴백 성공이 실패 분기보다 뒤에 있으면 실패로 샌다"
