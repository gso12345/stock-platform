"""정보 불러오는 속도 — 성능 점검에서 고친 것들이 되돌아가지 않게.

0.15 CPU 서버에서는 CPU 를 쓰는 동안 이벤트 루프가 멈춰, 그 순간 들어온
다른 사람의 요청까지 같이 기다린다. 여기 있는 검사는 그 '같이 기다리는'
시간을 만들던 자리들을 지킨다.
"""
import json

import pytest
from starlette.middleware.gzip import GZipMiddleware


class Test압축:
    def _gzip설정(self):
        from app.main import app
        return next(m for m in app.user_middleware if m.cls is GZipMiddleware)

    def test_압축_강도는_6_이하(self):
        """기본값 9 는 6 보다 다섯 배 느리고 크기는 4% 남짓 작을 뿐이다."""
        수준 = self._gzip설정().kwargs.get("compresslevel", 9)
        assert 수준 <= 6, f"compresslevel={수준} — 9 로 돌아가면 큰 응답마다 0.5초씩 루프가 멈춘다"

    def test_그래도_압축은_한다(self):
        """강도를 낮추다 압축 자체를 끄면 안 된다 — 큰 응답은 여전히 gzip 으로."""
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        설정 = self._gzip설정()
        작은앱 = FastAPI()
        작은앱.add_middleware(GZipMiddleware, **설정.kwargs)
        줄들 = [{"date": f"2020-01-{i % 28 + 1:02d}", "close": i * 1.5} for i in range(2000)]

        @작은앱.get("/큰것")
        def 큰것():
            return 줄들

        r = TestClient(작은앱).get("/큰것", headers={"Accept-Encoding": "gzip"})
        assert r.headers.get("content-encoding") == "gzip"
        assert r.json() == 줄들
        assert int(r.headers["content-length"]) < len(json.dumps(줄들)) / 3


class Test차트_응답:
    """종목 상세를 열면 가장 먼저 부르는 것이 일봉 차트다. 캐시에 있는 것을
    돌려줄 때 FastAPI 가 수천 줄을 jsonable_encoder 로 다시 훑던 것을 막는다."""

    줄들 = [{"date": f"2001-01-{i % 28 + 1:02d}", "open": 1.5 + i, "high": 2.5 + i,
             "low": 0.5 + i, "close": 1.0 + i, "volume": 1000 + i} for i in range(3000)]

    def _부르기(self, monkeypatch, 키, 주소):
        import fastapi.routing as 라우팅
        from fastapi.testclient import TestClient
        from app.main import app
        from app.core.cache import cache

        cache.set(키, self.줄들, 3600)
        세기 = {"n": 0}
        원래 = 라우팅.jsonable_encoder

        def 세며(*a, **k):
            세기["n"] += 1
            return 원래(*a, **k)

        monkeypatch.setattr(라우팅, "jsonable_encoder", 세며)
        r = TestClient(app).get(주소)
        return r, 세기["n"]

    @pytest.mark.parametrize("키, 주소", [
        ("ohlcv:KR:005930.KS:max:1d", "/api/v1/stocks/KR/005930.KS/ohlcv?period=max&interval=1d"),
        ("idx_ohlcv:SP500:max:1d", "/api/v1/dashboard/index/SP500/ohlcv?period=max&interval=1d"),
    ], ids=["종목", "지수"])
    def test_캐시에_있으면_그대로_내보낸다(self, monkeypatch, 키, 주소):
        r, 훑은횟수 = self._부르기(monkeypatch, 키, 주소)
        assert r.status_code == 200
        assert r.json() == self.줄들
        assert 훑은횟수 == 0, "일봉 수천 줄을 jsonable_encoder 로 다시 훑었다"


class Test봉목록_만들기:
    """차트 줄을 iterrows 로 한 줄씩 만들면 일봉 전체에 0.4초(0.15 CPU 로 2.7초)
    가 든다. 열 단위로 바꾸되 결과는 한 글자도 달라지면 안 된다."""

    @staticmethod
    def _예전(hist, is_kr=False, 분봉=False, 지수=False):
        """바꾸기 전 코드 그대로 — 결과 비교용."""
        def _rp(v):
            if 지수:
                return round(float(v), 2)
            return int(round(float(v))) if is_kr else round(float(v), 2)
        return [
            {
                "date": str(idx)[:19] if 분봉 else str(idx.date()),
                "open": _rp(row["Open"]), "high": _rp(row["High"]),
                "low": _rp(row["Low"]), "close": _rp(row["Close"]),
                "volume": int(row.get("Volume", 0)) if 지수 else int(row["Volume"]),
            }
            for idx, row in hist.iterrows()
        ]

    @staticmethod
    def _가격표(줄수=600, 분봉=False, 시간대=None):
        import numpy as np
        import pandas as pd
        rng = np.random.default_rng(7)
        idx = pd.date_range("2015-01-02", periods=줄수, freq="5min" if 분봉 else "B", tz=시간대)
        종가 = 100 + rng.standard_normal(줄수).cumsum()
        표 = pd.DataFrame({
            "Open": 종가 + rng.random(줄수), "High": 종가 + 2, "Low": 종가 - 2,
            "Close": 종가, "Volume": rng.integers(1_000, 9_000_000, 줄수),
            "Dividends": 0.0, "Stock Splits": 0.0,
        }, index=idx)
        표.iloc[3, 0] = 101.005  # 반올림 경계값
        표.iloc[4, 3] = 99.995
        return 표

    @pytest.fixture
    def 야후(self, monkeypatch):
        from app.services import yf_service as Y
        from app.core.cache import cache
        담기 = {}

        class 가짜종목:
            def __init__(self, sym): self.sym = sym
            def history(self, **k): return 담기["표"].copy()

        monkeypatch.setattr(Y.yf, "Ticker", 가짜종목)
        cache.clear()

        def 막은iterrows(*a, **k):
            raise AssertionError("iterrows 로 한 줄씩 만든다")

        import pandas as pd
        monkeypatch.setattr(pd.DataFrame, "iterrows", 막은iterrows)
        yield Y.YFinanceService(), 담기
        cache.clear()

    def _비교(self, 실제, 기대):
        assert len(실제) == len(기대)
        assert 실제 == 기대
        assert [type(r["volume"]) for r in 실제] == [int] * len(실제)

    def test_미국_일봉(self, 야후):
        서비스, 담기 = 야후
        담기["표"] = self._가격표(시간대="America/New_York")
        실제 = 서비스.get_ohlcv("AAPL", "max", "1d", "US")
        표 = 담기["표"].dropna(subset=["Close"])
        표.index = 표.index.tz_localize(None)
        self._비교(실제, _iterrows_로(self._예전, 표))

    def test_국내_일봉은_정수로(self, 야후):
        서비스, 담기 = 야후
        담기["표"] = self._가격표(시간대="Asia/Seoul")
        실제 = 서비스.get_ohlcv("005930.KS", "max", "1d", "KR")
        표 = 담기["표"].dropna(subset=["Close"])
        표.index = 표.index.tz_convert("Asia/Seoul").tz_localize(None)
        self._비교(실제, _iterrows_로(self._예전, 표, is_kr=True))
        assert all(type(r["close"]) is int for r in 실제)

    def test_분봉은_시각까지(self, 야후):
        서비스, 담기 = 야후
        담기["표"] = self._가격표(줄수=200, 분봉=True, 시간대="America/New_York")
        실제 = 서비스.get_ohlcv("AAPL", "5d", "5m", "US")
        표 = 담기["표"].dropna(subset=["Close"])
        표.index = 표.index.tz_localize(None)
        self._비교(실제, _iterrows_로(self._예전, 표, 분봉=True))
        assert len(실제[0]["date"]) == 19

    def test_N일봉(self, 야후):
        서비스, 담기 = 야후
        담기["표"] = self._가격표(시간대="America/New_York")
        실제 = 서비스.get_ohlcv("AAPL", "1y", "10d", "US")
        표 = 담기["표"].dropna(subset=["Close"])
        표.index = 표.index.tz_localize(None)
        묶음 = 표.resample("10B").agg({"Open": "first", "High": "max", "Low": "min",
                                       "Close": "last", "Volume": "sum"}).dropna(subset=["Close"])
        self._비교(실제, _iterrows_로(self._예전, 묶음))

    def test_지수_일봉과_연봉(self, 야후):
        서비스, 담기 = 야후
        담기["표"] = self._가격표(줄수=1500, 시간대="America/New_York")
        실제 = 서비스.get_index_ohlcv("SP500", "max", "1d")
        표 = 담기["표"].dropna(subset=["Close"])
        표.index = 표.index.tz_localize(None)
        self._비교(실제, _iterrows_로(self._예전, 표, 지수=True))

        실제연 = 서비스.get_index_ohlcv("SP500", "max", "1y")
        연 = 표.resample("YE").agg({"Open": "first", "High": "max", "Low": "min",
                                    "Close": "last", "Volume": "sum"}).dropna()
        self._비교(실제연, _iterrows_로(self._예전, 연, 지수=True))
        assert len(실제연) >= 5

    def test_거래량_칸이_없는_지수(self, 야후):
        서비스, 담기 = 야후
        담기["표"] = self._가격표(시간대="America/New_York").drop(columns=["Volume"])
        실제 = 서비스.get_index_ohlcv("VIX", "1y", "1d")
        assert 실제 and all(r["volume"] == 0 for r in 실제)


def _iterrows_로(예전, 표, **k):
    """iterrows 를 막아 둔 채로 예전 결과를 만든다 — 줄을 iloc 로 꺼내면
    iterrows 와 똑같은 Series(같은 형 변환)가 나온다."""
    return 예전(_풀린표(표), **k)


class _풀린표:
    def __init__(self, 표): self.표 = 표
    def iterrows(self):
        for i in range(len(self.표)):
            yield self.표.index[i], self.표.iloc[i]


def test_거래량이_실수로_와도_정수로(monkeypatch):
    """야후는 거래량을 실수(1234.0)로 줄 때가 있다 — 화면은 정수를 기대한다."""
    from app.services import yf_service as Y
    표 = Test봉목록_만들기._가격표(줄수=50)
    표["Volume"] = 표["Volume"].astype(float)
    줄들 = Y._봉목록(표, lambda v: round(float(v), 2), Y._일자들(표.index))
    assert all(type(r["volume"]) is int for r in 줄들)
    assert 줄들[0]["volume"] == int(표["Volume"].iloc[0])


class Test지난값_보관함_칸:
    """종목 시세를 몰아서 쓰는 일(미국 장 마감 중 30분마다 1,500종목 등)이
    지난 값 보관함 400칸을 통째로 밀어내, 대시보드 지수·뉴스·금리와 내 자산의
    지난 시세가 사라졌다. 그러면 첫 사람이 바깥 조회를 기다린다."""

    공용 = ["idx:KOSPI", "news:kr", "extra:us_rates", "rank:kr:상승률", "kr_rankings:x"]

    def _새캐시(self):
        from app.core.cache import TTLCache
        return TTLCache()

    def test_시세를_몰아서_써도_공용_지난값은_남는다(self):
        c = self._새캐시()
        for k in self.공용:
            c.set(k, {"v": k}, -1)       # 바로 만료 — 지난 값 보관함에만 남는다
        for i in range(6000):
            c.set(f"price:S{i}", {"price": i + 1.0, "change": 0.1}, 60)
        for k in self.공용:
            assert c.get_stale(k) == {"v": k}, f"{k} 의 지난 값이 시세에 밀려났다"

    def test_차트를_몰아서_써도_공용과_시세는_남는다(self):
        c = self._새캐시()
        for k in self.공용:
            c.set(k, {"v": k}, -1)
        c.set("price:005930", {"price": 72400}, -1)
        큰것 = [{"d": i, "v": "x" * 200} for i in range(2000)]
        for i in range(500):
            c.set(f"ohlcv:S{i}:5y:1d", 큰것, 60)
        for k in self.공용:
            assert c.get_stale(k) == {"v": k}, f"{k} 의 지난 값이 차트에 밀려났다"
        assert c.get_stale("price:005930") == {"price": 72400}

    def test_시세를_몰아서_써도_보유종목_시세는_오래_남는다(self):
        """예전에는 400건만 지나가도 밀려났다."""
        c = self._새캐시()
        c.set("price:005930", {"price": 72400}, -1)
        for i in range(2500):
            c.set(f"price:US{i}", {"price": 1.0}, 60)
        assert c.get_stale("price:005930") == {"price": 72400}

    def test_칸마다_상한은_지킨다(self):
        c = self._새캐시()
        c._칸상한["시세"] = (50, 10**9)
        c._칸상한["공용"] = (5, 10**9)
        c._stale_maxitems = 20
        for i in range(120):
            c.set(f"price:S{i}", {"price": 1.0}, 60)
            c.set(f"idx:I{i}", {"v": 1}, 60)
            c.set(f"fund:F{i}", {"v": 1}, 60)
        def 칸(머리): return sum(1 for k in c._stale if k.startswith(머리))
        assert (칸("price:"), 칸("idx:"), 칸("fund:")) == (50, 5, 20)
        # 남는 것은 가장 최근 것들이다
        assert c.get_stale("price:S119") and c.get_stale("price:S70") and not c._stale.get("price:S69")
        assert c._stale_total == sum(c._stale_bytes.values())

    def test_바이트_상한도_칸마다(self):
        c = self._새캐시()
        c._칸상한["시세"] = (10**6, 5_000)
        for i in range(200):
            c.set(f"price:S{i}", {"price": 1.0, "name": "x" * 100}, 60)
        assert c._칸합["시세"] <= 5_000
        assert c._stale_total == sum(c._stale_bytes.values())

    def test_같은_키를_거듭_써도_칸_합이_불지_않는다(self):
        """시세는 같은 종목을 몇 초마다 다시 쓴다. 덮어쓸 때 예전 몫을 빼지
        않으면 합이 계속 불어 멀쩡한 값이 밀려난다."""
        c = self._새캐시()
        c.set("price:005930", {"price": 1.0}, -1)
        for i in range(20_000):
            c.set("price:000660", {"price": float(i)}, 60)
        assert c._칸합["시세"] == sum(c._stale_bytes[k] for k in c._칸순서["시세"])
        assert c.get_stale("price:005930") == {"price": 1.0}

    def test_지우고_비우면_칸_합도_0(self):
        c = self._새캐시()
        c.set("price:A", {"price": 1.0}, 60)
        c.set("idx:A", {"v": 1}, 60)
        c.set("fund:A", {"v": 1}, 60)
        c.delete("price:A")
        assert c._칸합["시세"] == 0 and "price:A" not in c._칸순서["시세"]
        c.clear()
        assert c._stale_total == 0 and all(v == 0 for v in c._칸합.values())
        assert all(len(v) == 0 for v in c._칸순서.values())


class Test깨어날때:
    """Render 무료 서버는 잠들었다 깨어난다. 깨어나는 동안 기다리는 사람이
    가장 오래 기다린다 — 그 시간을 늘리던 것들."""

    def test_미국_금리_배치는_동시에_불러도_한_번만_돈다(self, monkeypatch):
        import threading
        import time
        from app.services import market_extras as M
        from app.core.cache import cache
        횟수 = {"n": 0}

        def 느린받기():
            횟수["n"] += 1
            time.sleep(0.3)
            값 = [{"name": "원/달러", "value": 1380.0}]
            cache.set("extra:us_rates", 값, 300)
            return 값

        monkeypatch.setattr(M, "_us_rates_받기", 느린받기)
        결과 = []
        스레드들 = [threading.Thread(target=lambda: 결과.append(M._do_fetch_us_rates())) for _ in range(4)]
        for t in 스레드들: t.start()
        for t in 스레드들: t.join()
        assert 횟수["n"] == 1, f"같은 배치를 {횟수['n']}번 돌렸다"
        assert 결과 == [[{"name": "원/달러", "value": 1380.0}]] * 4

    def test_끝나면_다음_사람은_새로_받는다(self, monkeypatch):
        from app.services import market_extras as M
        횟수 = {"n": 0}
        monkeypatch.setattr(M, "_us_rates_받기", lambda: 횟수.__setitem__("n", 횟수["n"] + 1) or [])
        M._do_fetch_us_rates()
        M._do_fetch_us_rates()
        assert 횟수["n"] == 2

    @pytest.fixture
    def 기록(self, monkeypatch):
        """시작 프리페치가 부르는 것들을 가짜로 바꾸고 부른 순서를 남긴다."""
        import asyncio
        from app.services import scheduler as S, ranking_service, news_service, market_extras, ticker_service
        순서: list[str] = []

        def 비동기(이름, 걸림=0.0):
            async def f(*a, **k):
                순서.append(이름 + ":시작")
                await asyncio.sleep(걸림)
                순서.append(이름 + ":끝")
            return f

        def 동기(이름):
            def f(*a, **k):
                순서.append(이름)
            return f

        monkeypatch.setattr(S, "refresh_kr_indices", 비동기("국내지수", 0.1))
        monkeypatch.setattr(S, "refresh_us_indices", 비동기("미국지수", 0.1))
        monkeypatch.setattr(S, "refresh_exchange", 비동기("환율", 0.1))
        monkeypatch.setattr(ranking_service, "refresh_kr_rankings_from_naver", 비동기("순위", 0.1))
        monkeypatch.setattr(news_service, "get_kr_news", 동기("국내뉴스"))
        monkeypatch.setattr(news_service, "get_us_news", 동기("해외뉴스"))
        monkeypatch.setattr(market_extras, "get_kr_rates", 동기("국내금리"))
        monkeypatch.setattr(market_extras, "get_us_rates", 동기("미국금리"))
        monkeypatch.setattr(ticker_service, "init_ticker_db", 동기("종목목록"))
        monkeypatch.setattr(S.market_hours, "us_session", lambda: "closed")
        monkeypatch.setattr(S.market_hours, "kr_session", lambda: "closed")
        monkeypatch.setattr(S.memory, "has_headroom", lambda *a, **k: False)
        monkeypatch.setattr(S, "HEAVY_PREFETCH", False)
        monkeypatch.setattr(S, "STARTUP_WARM_DELAY", 0.05)
        return S, 순서

    def test_첫화면_먼저_그다음_종목목록과_뉴스(self, 기록):
        import asyncio
        S, 순서 = 기록
        asyncio.run(S.run_startup_prefetch())
        첫화면끝 = max(순서.index(f"{n}:끝") for n in ("국내지수", "미국지수", "환율", "순위"))
        for 나중 in ("종목목록", "국내뉴스", "해외뉴스", "국내금리"):
            assert 순서.index(나중) > 첫화면끝, f"{나중} 이 첫 화면보다 먼저 돌았다: {순서}"

    def test_같은_배치를_두번_부르지_않는다(self, 기록):
        """환율 갱신이 미국 금리까지 채운다 — 따로 또 부르면 같은 여덟
        종목을 두 번 받는다."""
        import asyncio
        S, 순서 = 기록
        asyncio.run(S.run_startup_prefetch())
        assert "미국금리" not in 순서
        assert 순서.count("환율:시작") == 1

    def test_첫화면이_늦어도_한도까지만_기다린다(self, 기록, monkeypatch):
        import asyncio
        S, 순서 = 기록

        async def 멈춘순위(*a, **k):
            순서.append("순위:시작")
            await asyncio.sleep(1.0)
            순서.append("순위:끝")

        from app.services import ranking_service
        monkeypatch.setattr(ranking_service, "refresh_kr_rankings_from_naver", 멈춘순위)
        monkeypatch.setattr(S, "STARTUP_FIRST_WAIT", 0.2)
        asyncio.run(S.run_startup_prefetch())
        assert 순서.index("국내뉴스") < 순서.index("순위:끝"), "느린 하나 때문에 뉴스가 줄을 섰다"

    def test_포트가_열리기_전에는_무거운_일을_안_한다(self, 기록, monkeypatch):
        """lifespan 이 끝난 뒤에야 포트가 열린다. 그 사이에 무거운 일이
        먼저 돌면 0.15 CPU 를 나눠 쓰느라 포트가 30초 넘게 늦게 열렸다."""
        import asyncio
        from app.main import app
        S, 순서 = 기록
        monkeypatch.setattr(S, "STARTUP_WARM_DELAY", 0.6)

        async def run():
            async with app.router.lifespan_context(app):
                await asyncio.sleep(0.3)
                지금까지 = list(순서)
                await asyncio.sleep(0.8)
                return 지금까지

        포트열기전 = asyncio.run(run())
        assert 포트열기전 == [], f"lifespan 직후 바로 돌았다: {포트열기전}"
        assert "국내지수:시작" in 순서, "기다린 뒤에는 돌아야 한다"


class Test순위표_읽기는_루프_밖에서:
    """국내 순위는 장중 1분마다 네이버 시세 여덟 페이지를 읽는다. 그걸 이벤트
    루프에서 읽으면 0.15 CPU 에서 페이지마다 수백 ms 씩 모든 요청이 선다."""

    def test_HTML_은_다른_스레드에서_읽는다(self, monkeypatch):
        import asyncio
        import threading
        from tests.test_parser_release import _표, _가짜클라이언트
        from app.services import ranking_service as rs

        monkeypatch.setattr(rs.httpx, "AsyncClient", lambda *a, **k: _가짜클라이언트(_표(5)))
        읽은스레드 = []
        원래 = rs._시세표_읽기

        def 기록하며(*a, **k):
            읽은스레드.append(threading.get_ident())
            return 원래(*a, **k)

        monkeypatch.setattr(rs, "_시세표_읽기", 기록하며)

        async def go():
            루프스레드 = threading.get_ident()
            줄들 = await rs._fetch_naver_sise_page("https://x", 0, True)
            return 루프스레드, 줄들

        루프스레드, 줄들 = asyncio.run(go())
        assert len(줄들) == 5 and 줄들[0]["symbol"] == "005930.KS"
        assert 읽은스레드 and all(t != 루프스레드 for t in 읽은스레드), "루프에서 HTML 을 읽었다"


class Test피드_읽기:
    """뉴스 갱신은 5분마다 피드 50곳 가까이를 읽는다. feedparser 의 기본
    '요약 HTML 다듬기' 가 그 CPU 의 절반 넘게를 먹었다."""

    def test_모든_피드_읽기가_다듬기를_끈다(self):
        import ast
        from pathlib import Path
        app = Path(__file__).resolve().parents[1] / "app"
        어긴곳 = []
        for 파일 in app.rglob("*.py"):
            나무 = ast.parse(파일.read_text(encoding="utf-8-sig"))
            for 마디 in ast.walk(나무):
                if (isinstance(마디, ast.Call) and isinstance(마디.func, ast.Attribute)
                        and 마디.func.attr == "parse"
                        and isinstance(마디.func.value, ast.Name) and 마디.func.value.id == "feedparser"):
                    인자 = {k.arg: k.value for k in 마디.keywords}
                    꺼짐 = isinstance(인자.get("sanitize_html"), ast.Constant) and 인자["sanitize_html"].value is False
                    if not 꺼짐:
                        어긴곳.append(f"{파일.relative_to(app.parent)}:{마디.lineno}")
        assert not 어긴곳, f"피드읽기 를 안 쓰는 곳: {어긴곳}"

    def test_결과는_예전과_같다(self):
        from app.services.news_service import 피드읽기, _clean_text
        import feedparser
        xml = ("<?xml version='1.0' encoding='utf-8'?><rss version='2.0'><channel><title>t</title>"
               "<item><title>삼성전자 주가 &amp; 반도체</title><link>https://e.com/1</link>"
               "<description><![CDATA[<p>요약 <b>굵게</b></p><script>alert(1)</script><style>p{}</style>"
               "<img src=\"https://i.e.com/1.jpg\"/>]]></description>"
               "<pubDate>Mon, 06 Oct 2026 10:00:00 +0900</pubDate></item></channel></rss>").encode()
        새것 = 피드읽기(xml).entries[0]
        예전 = feedparser.parse(xml).entries[0]
        assert 새것.title == 예전.title == "삼성전자 주가 & 반도체"
        assert 새것.link == 예전.link
        assert 새것.published_parsed == 예전.published_parsed
        assert _clean_text(새것.summary) == _clean_text(예전.summary) == "요약 굵게"

    def test_요약에_스크립트_글자가_안_남는다(self):
        from app.services.news_service import _clean_text
        assert _clean_text("앞<SCRIPT type='x'>alert('x')</script >뒤<style>.a{}</style>끝") == "앞 뒤 끝"

    def test_종목_뉴스는_시한을_두고_받는다(self, monkeypatch):
        """feedparser.parse(주소) 로 받으면 시한이 없어 스레드가 영영 묶인다."""
        import inspect
        from app.api.routes.stocks import news as N
        본문 = inspect.getsource(N)
        i = 본문.index("def _fetch_kr():")
        구역 = 본문[i:본문.index("def _match_feed_kr", i)]
        assert "httpx.get(google_rss" in 구역 and "timeout=" in 구역
        assert "피드읽기(resp.content)" in 구역


class Test내자산_뉴스_고르기:
    """내 자산 뉴스는 4초마다 다시 묻는데, 그때마다 보유 종목 × 기사 1,300건
    × 검색어마다 정규식을 새로 지어 0.15 CPU 에서 1.4초를 썼다."""

    말들목록 = [
        ["삼성전자", "005930"], ["V", "Visa"], ["GD", "General"], ["NVDA", "엔비디아", "Nvidia"],
        ["S&P", "BRK.B", "Berkshire"], ["LG화학", "LG"], ["AAPL", "Apple", "애플"],
    ]
    글들 = [
        ("오늘 삼성전자 주가가 올랐다", ""), ("Vision Pro sales rise", "V shares climb"),
        ("GDP growth slows", "GD wins navy contract"), ("nvda rallies", "엔비디아 실적"),
        ("S&P 500 hits record", "BRK.B up"), ("LG화학 배터리", "lg display"),
        ("Apple's new iPhone", "applesauce"), ("파인애플 가격", "pineapple"),
        ("005930.KS 거래량", ""), ("", ""), ("berkshire hathaway", "BERKSHIRE"),
        ("오늘의 시장", "삼성전자 신고가"),     # 한글 검색어가 요약에만
    ]

    def test_예전_맞추기와_결과가_같다(self):
        from app.services import portfolio_news as PN
        for 말들 in self.말들목록:
            맞나 = PN._맞추개(말들)
            for 제목, 요약 in self.글들:
                예전 = any(PN._맞나(w, 제목) or PN._맞나(w, 요약) for w in 말들)
                assert 맞나(제목, 요약, 제목.lower(), 요약.lower()) == 예전, (말들, 제목, 요약)

    def test_고를_때_한_번씩_부르던_맞추기를_안_쓴다(self, monkeypatch):
        from app.core.cache import cache
        from app.services import portfolio_news as PN
        기사들 = [{"title": f"삼성전자 소식 {i}", "link": f"https://e.com/{i}", "summary": "",
                   "published_ts": 1_700_000_000 + i} for i in range(300)]
        cache.set("news:kr", 기사들, 60)
        cache.set("news:us", [], 60)

        def 터짐(*a, **k):
            raise AssertionError("기사마다 _맞나 를 부른다")

        monkeypatch.setattr(PN, "_맞나", 터짐)
        try:
            골라낸것, 찾은종목 = PN._고르기([{"symbol": "005930", "market": "KR", "name": "삼성전자"}])
        finally:
            cache.delete("news:kr")
            cache.delete("news:us")
        assert 골라낸것 and 찾은종목 == ["005930"]


class Test검색:
    """검색창은 글자를 칠 때마다 묻는다. 국내(네이버)와 해외(Finnhub)를
    차례로 기다리던 것을 동시에 묻는다."""

    @pytest.fixture
    def 가짜원천(self, monkeypatch):
        import asyncio
        import time
        from app.api.routes import search as S
        불림 = {"naver": 0, "finnhub": 0}

        async def 네이버(q):
            불림["naver"] += 1
            await asyncio.sleep(0.4)
            return [{"symbol": "005930.KS", "name": "삼성전자", "market": "KR"}]

        def 핀허브(q):
            불림["finnhub"] += 1
            time.sleep(0.4)
            return [{"symbol": "AAPL", "name": "Apple", "market": "US"}]

        monkeypatch.setattr(S, "_naver_search", 네이버)
        monkeypatch.setattr(S.finnhub_service, "search", 핀허브)
        monkeypatch.setattr(S.settings, "FINNHUB_API_KEY", "x")
        monkeypatch.setattr(S, "search_stocks", lambda q, m: [
            {"symbol": "AAPL", "name": "애플", "market": "US"}] if m == "US" else [])
        return 불림

    def _찾기(self, q):
        import time
        from fastapi.testclient import TestClient
        from app.main import app
        from app.core.cache import cache
        cache.delete(f"search:ALL:{q.lower()}")
        t = time.perf_counter()
        r = TestClient(app).get("/api/v1/search", params={"q": q})
        return r.json()["results"], time.perf_counter() - t

    def test_둘을_기다려도_한_번_기다린_만큼만(self, 가짜원천):
        결과, 걸림 = self._찾기("appl")
        assert 가짜원천 == {"naver": 1, "finnhub": 1}
        assert [r["symbol"] for r in 결과] == ["005930.KS", "AAPL"], "국내가 앞, 해외가 뒤"
        assert 걸림 < 0.7, f"{걸림:.2f}초 — 차례로 기다렸다(0.4 + 0.4)"

    def test_한글은_핀허브에_안_묻는다(self, 가짜원천):
        결과, _ = self._찾기("애플")
        assert 가짜원천["finnhub"] == 0
        assert any(r["symbol"] == "AAPL" for r in 결과), "내장 목록의 한글 이름으로 찾는다"


class Test관심종목_시세:
    """관심종목 시세가 캐시에 없으면 국내 종목마다 네이버를 두 번(basic·
    integration) 한꺼번에 불렀다. 이 화면은 가격·등락만 쓴다."""

    @pytest.fixture
    def 가짜네이버(self, monkeypatch):
        from app.services import price_fetcher as PF
        from app.core.cache import cache
        불림 = {"light": [], "full": []}

        async def 가벼운(codes, concurrency=20):
            불림["light"].append(list(codes))
            return {c: {"symbol": f"{c}.KS", "name": "이름", "price": 70000.0,
                        "change": 100.0, "change_rate": 0.14, "currency": "KRW", "market": "KOSPI"}
                    for c in codes}

        async def 무거운(codes):
            불림["full"].append(list(codes))
            return {}

        monkeypatch.setattr(PF, "fetch_naver_prices_light", 가벼운)
        monkeypatch.setattr(PF, "fetch_naver_stocks", 무거운)
        for c in ("123450", "123460"):
            for k in (f"price:{c}", f"price:{c}.KS", f"price:{c}.KQ"):
                cache.delete(k)
        yield 불림
        for c in ("123450", "123460"):
            for k in (f"price:{c}", f"price:{c}.KS", f"price:{c}.KQ"):
                cache.delete(k)

    def _부르기(self):
        from fastapi.testclient import TestClient
        from app.main import app
        return TestClient(app).get("/api/v1/watchlist/prices",
                                   params={"symbols": "123450.KS,123460.KS", "markets": "KR,KR"}).json()

    def test_가격만_받는다(self, 가짜네이버):
        답 = self._부르기()
        assert 가짜네이버["full"] == [] and 가짜네이버["light"] == [["123450", "123460"]]
        assert [r["price"] for r in 답] == [70000.0, 70000.0]

    def test_다른_화면이_읽는_칸은_지우지_않는다(self, 가짜네이버):
        from app.core.cache import cache
        # 가격이 빈 지난 값 — 시세는 새로 받아야 하지만 다른 칸은 남아 있다
        cache.set("price:123450.KS", {"price": 0, "market_cap": 5_000_000, "per": 12.3, "_demo": True}, -1)
        self._부르기()
        담긴것 = cache.get("price:123450.KS")
        assert 담긴것["price"] == 70000.0
        assert 담긴것["market_cap"] == 5_000_000 and 담긴것["per"] == 12.3
        assert "_demo" not in 담긴것, "진짜 가격이 왔는데 데모 표시가 남았다"


class Test마지막시세:
    """내 자산·관심종목을 열 때 같이 실어 보내는 '받아 둔 시세' 가 지난 값
    보관함에 기대고 있어, 시세를 몰아서 쓰고 나면 보유 종목이 다 빠졌다."""

    def test_가격만_따로_오래_기억한다(self):
        from app.core.cache import TTLCache
        c = TTLCache()
        c.set("price:005930", {"price": 72400.0, "change": 100.0, "change_rate": 0.14,
                               "currency": "KRW", "name": "삼성전자", "market_cap": 1}, -1)
        for i in range(8000):                           # 시세 칸(3000)을 넘겨 밀어낸다
            c.set(f"price:US{i}", {"price": 1.0}, 60)
        assert c.get_stale("price:005930") is None, "전제: 지난 값은 밀려났다"
        마지막 = c.마지막시세("005930")
        assert 마지막["price"] == 72400.0 and 마지막["change_rate"] == 0.14
        assert 마지막["currency"] == "KRW" and 마지막["asOf"] > 0

    def test_빈_가격이나_데모는_기억하지_않는다(self):
        from app.core.cache import TTLCache
        c = TTLCache()
        c.set("price:A", {"price": 10.0}, 60)
        c.set("price:A", {"price": None}, 60)         # 실패한 조회가 덮어써도
        c.set("price:A", {"price": 99.0, "_demo": True}, 60)
        assert c.마지막시세("A")["price"] == 10.0     # 마지막 '진짜' 가격이 남는다
        c.set("idx:A", {"price": 5.0}, 60)
        assert c.마지막시세("idx:A") is None and c.마지막시세("A")["price"] == 10.0

    def test_상한이_있다(self, monkeypatch):
        from app.core import cache as C
        monkeypatch.setattr(C, "LAST_QUOTE_MAX_ITEMS", 100)
        c = C.TTLCache()
        for i in range(300):
            c.set(f"price:S{i}", {"price": 1.0}, 60)
        assert len(c._마지막시세) == 100
        assert c.마지막시세("S299") and c.마지막시세("S199") is None
        # 다시 받은 종목은 최근 것으로 친다 — 자주 갱신되는 보유 종목이 먼저 밀려나면 안 된다
        c.set("price:S200", {"price": 2.0}, 60)
        c.set("price:NEW", {"price": 3.0}, 60)
        assert c.마지막시세("S200")["price"] == 2.0 and c.마지막시세("S201") is None
        c.clear()
        assert len(c._마지막시세) == 0

    def test_받아둔시세가_지난값이_없으면_마지막_가격을_쓴다(self):
        from types import SimpleNamespace as 항목
        from app.core.cache import cache
        from app.services.cached_prices import 받아둔시세
        cache.set("price:777770.KS", {"price": 5000.0, "change_rate": 1.0}, -1)
        cache._stale_drop("price:777770.KS")           # 지난 값까지 밀려난 상태
        try:
            나온것 = 받아둔시세([항목(symbol="777770", market="KR")])
        finally:
            cache.delete("price:777770.KS")
        assert len(나온것) == 1
        assert 나온것[0]["price"] == 5000.0 and 나온것[0]["symbol"] == "777770"
        assert 나온것[0]["stale"] is True, "낡은 값이라고 알려야 한다"


class Test관심종목_목록에_시세:
    """관심종목은 목록을 받은 뒤에야 시세를 물을 수 있어 왕복이 두 번이었다.
    내 자산처럼 받아 둔 시세를 같이 싣는다."""

    @pytest.fixture
    def 손님(self):
        from fastapi.testclient import TestClient
        from app.main import app
        from app.db.database import SessionLocal, Base, engine
        from app.models.user import User
        from app.models.stock import Watchlist, WatchlistItem, WatchlistFolder
        from app.core.security import create_access_token
        Base.metadata.create_all(engine)
        db = SessionLocal()
        me = db.query(User).filter(User.email == "관심시세@test").first()
        if not me:
            me = User(email="관심시세@test", username="관심시세", hashed_password="x")
            db.add(me); db.commit(); db.refresh(me)
        wl = db.query(Watchlist).filter(Watchlist.user_id == me.id).first()
        if not wl:
            wl = Watchlist(user_id=me.id, name="기본"); db.add(wl); db.commit(); db.refresh(wl)
        db.query(WatchlistItem).filter(WatchlistItem.watchlist_id == wl.id).delete()
        폴더 = db.query(WatchlistFolder).filter(WatchlistFolder.user_id == me.id).first()
        if not 폴더:
            폴더 = WatchlistFolder(user_id=me.id, name="기본"); db.add(폴더); db.commit(); db.refresh(폴더)
        for sym, mkt in (("777771", "KR"), ("ZZZZ", "US")):
            db.add(WatchlistItem(watchlist_id=wl.id, folder_id=폴더.id, symbol=sym, market=mkt, name=sym))
        db.commit()
        토큰 = create_access_token({"sub": str(me.id)})
        db.close()
        yield TestClient(app), {"Authorization": f"Bearer {토큰}"}

    def test_안_켜면_예전_그대로_배열(self, 손님):
        c, H = 손님
        본문 = c.get("/api/v1/watchlist/items", headers=H).json()
        assert isinstance(본문, list) and {x["symbol"] for x in 본문} == {"777771", "ZZZZ"}

    def test_켜면_목록과_받아둔_시세를_같이(self, 손님):
        from app.core.cache import cache
        c, H = 손님
        cache.set("price:777771.KS", {"price": 1234.0, "change_rate": 0.5}, 60)
        try:
            본문 = c.get("/api/v1/watchlist/items?with_prices=true", headers=H).json()
        finally:
            cache.delete("price:777771.KS")
        assert set(본문) == {"items", "prices"}
        assert {x["symbol"] for x in 본문["items"]} == {"777771", "ZZZZ"}
        assert [(p["symbol"], p["price"]) for p in 본문["prices"]] == [("777771", 1234.0)]


class Test깨어난_직후_지수:
    """포트를 먼저 열고 지수는 뒤에 받게 바꿨다. 그 사이 들어온 사람에게 0 을
    주면 화면에 남아 있던 값이 0 으로 덮인다 — 잠깐 기다려 채운 것을 준다."""

    @pytest.fixture
    def 빈캐시(self, monkeypatch):
        import asyncio
        from app.api.routes import dashboard as D
        from app.core.cache import cache
        이름들 = ("KOSPI", "SP500")
        def 치우기():
            for n in 이름들:
                cache.delete(f"idx:{n}")
        치우기()
        횟수 = {"n": 0, "걸림": 0.2}

        async def 채우기():
            횟수["n"] += 1
            await asyncio.sleep(횟수["걸림"])
            cache.set("idx:KOSPI", {"index": "KOSPI", "value": 2600.0}, 60)
            cache.set("idx:SP500", {"index": "SP500", "value": 5800.0}, 60)

        monkeypatch.setattr(D, "_refresh_indices_bg", 채우기)
        monkeypatch.setattr(D.settings, "KIS_APP_KEY", "")
        monkeypatch.setattr(D, "_지수채우기", None)
        monkeypatch.setattr(D, "_지수채우기_끝난시각", -1e9)   # 앞 검사의 '방금 실패' 를 지운다
        yield D, 횟수
        치우기()

    def test_비어_있으면_채우기를_기다려_값을_준다(self, 빈캐시):
        import asyncio
        D, 횟수 = 빈캐시

        async def go():
            return await asyncio.gather(D._get_kr_index_with_fallback("KOSPI"), D._get_us_index("SP500"))

        국내, 해외 = asyncio.run(go())
        assert 국내["value"] == 2600.0 and 해외["value"] == 5800.0
        assert 횟수["n"] == 1, "국내·해외가 같은 갱신을 따로 띄웠다"

    def test_지난_값이_있으면_기다리지_않는다(self, 빈캐시):
        import asyncio
        import time
        from app.core.cache import cache
        D, 횟수 = 빈캐시
        횟수["걸림"] = 1.0
        cache.set("idx:SP500", {"index": "SP500", "value": 5700.0}, -1)   # 지난 값만

        async def go():
            t = time.perf_counter()
            r = await D._get_us_index("SP500")
            return r, time.perf_counter() - t

        결과, 걸림 = asyncio.run(go())
        assert 결과["value"] == 5700.0 and 걸림 < 0.3

    def test_늦으면_한도까지만_기다린다(self, 빈캐시, monkeypatch):
        import asyncio
        import time
        D, 횟수 = 빈캐시
        횟수["걸림"] = 2.0
        monkeypatch.setattr(D, "INDEX_COLD_WAIT", 0.3)

        async def go():
            t = time.perf_counter()
            r = await D._get_kr_index_with_fallback("KOSPI")
            return r, time.perf_counter() - t

        결과, 걸림 = asyncio.run(go())
        assert 결과["value"] == 0 and 걸림 < 0.8


class Test지수_갱신은_한번에_하나:
    def test_동시에_불러도_한_번만_돈다(self, monkeypatch):
        import asyncio
        from app.services import scheduler as S
        횟수 = {"n": 0}

        async def 느린(*a, **k):
            횟수["n"] += 1
            await asyncio.sleep(0.1)
            return 횟수["n"]

        감싼 = S._한번에_하나(느린)

        async def go():
            a = await asyncio.gather(감싼(), 감싼(), 감싼())
            b = await 감싼()                    # 끝난 뒤에는 새로 돈다
            return a, b

        a, b = asyncio.run(go())
        assert a == [1, 1, 1] and b == 2

    def test_기다리던_쪽이_취소돼도_갱신은_끝까지(self):
        import asyncio
        from app.services import scheduler as S
        끝남 = {"v": False}

        async def 느린():
            await asyncio.sleep(0.2)
            끝남["v"] = True

        감싼 = S._한번에_하나(느린)

        async def go():
            try:
                await asyncio.wait_for(감싼(), 0.05)
            except asyncio.TimeoutError:
                pass
            await asyncio.sleep(0.3)

        asyncio.run(go())
        assert 끝남["v"], "시한에 걸린 쪽이 갱신까지 죽였다"

    def test_지수_갱신에_씌워져_있다(self):
        from app.services import scheduler as S
        assert S.refresh_kr_indices.__wrapped__ and S.refresh_us_indices.__wrapped__


class Test퀀트_지표_남겨두기:
    """서버가 깨어나면 퀀트 비교가 30종목의 재무·가격을 처음부터 다시 모았다.
    계산해 둔 지표를 DB 에 남겨 두고 곧바로 쓴다."""

    @pytest.fixture
    def 표(self):
        from app.db.database import SessionLocal, Base, engine
        from app.models.stock import QuantMetricsCache
        Base.metadata.create_all(engine)
        db = SessionLocal()
        db.query(QuantMetricsCache).filter(QuantMetricsCache.symbol.like("QT%")).delete(synchronize_session=False)
        db.commit(); db.close()
        yield
        db = SessionLocal()
        db.query(QuantMetricsCache).filter(QuantMetricsCache.symbol.like("QT%")).delete(synchronize_session=False)
        db.commit(); db.close()

    지표 = {"_sector": "Technology", "per": 12.0, "roe": 15.0, "mom_3m": 4.2, "mom_12m": 10.0, "volatility": 22.0}

    def test_남기고_한번에_읽는다(self, 표):
        from app.services import quant_store as Q
        Q.저장("QT1", "US", self.지표)
        Q.저장("QT2", "KR", {**self.지표, "per": 8.0})
        Q.저장("QT1", "US", {**self.지표, "per": 13.0})          # 고쳐 쓴다(두 줄이 안 된다)
        읽음 = Q.여럿읽기([("QT1", "US"), ("QT2", "KR"), ("QT3", "US"), ("QT2", "US")])
        assert set(읽음) == {("QT1", "US"), ("QT2", "KR")}
        assert 읽음[("QT1", "US")][0]["per"] == 13.0 and 읽음[("QT1", "US")][1] < 60
        assert Q.여럿읽기([("QT2", "US")]) == {}, "다른 시장의 같은 이름을 가져왔다"

    def test_반쪽짜리는_안_남긴다(self, 표):
        from app.services import quant_store as Q
        Q.저장("QT4", "US", {"per": 12.0, "roe": 15.0})          # 가격(모멘텀)이 빠졌다
        assert Q.여럿읽기([("QT4", "US")]) == {}

    def test_NaN_은_비워서_남긴다(self, 표):
        from app.services import quant_store as Q
        Q.저장("QT5", "US", {**self.지표, "per": float("nan")})
        assert Q.여럿읽기([("QT5", "US")])[("QT5", "US")][0]["per"] is None

    def test_일주일_넘은_것은_안_쓴다(self, 표):
        from datetime import datetime, timedelta
        from app.db.database import SessionLocal
        from app.models.stock import QuantMetricsCache
        from app.services import quant_store as Q
        Q.저장("QT6", "US", self.지표)
        db = SessionLocal()
        db.query(QuantMetricsCache).filter_by(symbol="QT6").update(
            {"fetched_at": datetime.utcnow() - timedelta(days=8)})
        db.commit(); db.close()
        assert Q.여럿읽기([("QT6", "US")]) == {}

    @pytest.fixture
    def 퀀트손님(self, 표, monkeypatch):
        from fastapi.testclient import TestClient
        from app.main import app
        from app.db.database import SessionLocal
        from app.models.user import User
        from app.core.security import create_access_token
        from app.core.cache import cache
        from app.api.routes.stocks import quant as R
        db = SessionLocal()
        me = db.query(User).filter(User.email == "퀀트남김@test").first()
        if not me:
            me = User(email="퀀트남김@test", username="퀀트남김", hashed_password="x")
            db.add(me); db.commit(); db.refresh(me)
        토큰 = create_access_token({"sub": str(me.id)})
        db.close()
        for s in ("QT1", "QT2", "QT7"):
            cache.delete(f"qmetrics:US:{s}")
        불림 = {"모으기": [], "미루기": []}

        async def 모으기(sym, mkt, fetch_ohlcv=True):
            불림["모으기"].append(sym)
            return dict(self.지표)

        monkeypatch.setattr("app.services.quant_score.collect_quant_metrics", 모으기)
        monkeypatch.setattr(R, "_퀀트지표_뒤로미루기", lambda s, m, ck: 불림["미루기"].append(s))
        yield TestClient(app), {"Authorization": f"Bearer {토큰}"}, 불림
        for s in ("QT1", "QT2", "QT7"):
            cache.delete(f"qmetrics:US:{s}")

    def test_남겨둔_것으로_곧바로_답한다(self, 퀀트손님):
        from app.services import quant_store as Q
        from app.core.cache import cache
        c, H, 불림 = 퀀트손님
        Q.저장("QT1", "US", self.지표)
        cache.delete("qmetrics:US:QT1")
        r = c.get("/api/v1/stocks/quant-score/compare", params={"symbols": "QT1", "markets": "US"}, headers=H)
        assert r.status_code == 200, r.text
        assert r.json()["items"][0]["total_score"] is not None
        assert 불림["모으기"] == [], "남겨 둔 것이 있는데 처음부터 다시 모았다"
        assert cache.get("qmetrics:US:QT1") is not None, "신선한 것은 메모리에도 담는다"

    def test_오래된_것은_그것으로_답하고_뒤에서_새로(self, 퀀트손님):
        from datetime import datetime, timedelta
        from app.db.database import SessionLocal
        from app.models.stock import QuantMetricsCache
        from app.services import quant_store as Q
        c, H, 불림 = 퀀트손님
        Q.저장("QT2", "US", self.지표)
        db = SessionLocal()
        db.query(QuantMetricsCache).filter_by(symbol="QT2").update(
            {"fetched_at": datetime.utcnow() - timedelta(hours=3)})
        db.commit(); db.close()
        r = c.get("/api/v1/stocks/quant-score/compare", params={"symbols": "QT2", "markets": "US"}, headers=H)
        assert r.json()["items"][0]["total_score"] is not None
        assert 불림["모으기"] == [] and 불림["미루기"] == ["QT2"]

    def test_처음_모은_것은_남겨_둔다(self, 퀀트손님):
        import time
        from app.services import quant_store as Q
        c, H, 불림 = 퀀트손님
        c.get("/api/v1/stocks/quant-score/compare", params={"symbols": "QT7", "markets": "US"}, headers=H)
        assert 불림["모으기"] == ["QT7"]
        for _ in range(50):                      # 응답과 따로 남긴다 — 잠깐 기다린다
            if Q.여럿읽기([("QT7", "US")]):
                break
            time.sleep(0.05)
        assert Q.여럿읽기([("QT7", "US")])[("QT7", "US")][0]["per"] == 12.0


class Test미국_상세_장외시세:
    """미국 종목 상세는 가격·지표를 다 모은 뒤 장전·장후 시세를 차례로 한 번 더
    받았다. 그 왕복만큼 늘 늦게 떴고, 장중에는 화면이 쓰지도 않는 값이다."""

    @pytest.fixture
    def 상세(self, monkeypatch):
        import asyncio
        from fastapi.testclient import TestClient
        from app.main import app
        from app.core.cache import cache
        from app.api.routes.stocks import price as P
        from app.services import market_hours, price_fetcher
        불림 = {"장외": 0}
        세션 = {"v": "regular"}

        async def 느린장외(sym):
            불림["장외"] += 1
            await asyncio.sleep(0.8)
            return {"market_state": "PRE", "pre_market_price": 201.5}

        monkeypatch.setattr(price_fetcher, "fetch_yf_quote_extended", 느린장외)
        monkeypatch.setattr(market_hours, "us_session", lambda *a, **k: 세션["v"])
        monkeypatch.setattr(P.settings, "FINNHUB_API_KEY", "x")
        monkeypatch.setattr(P.finnhub_service, "get_stock_detail",
                            lambda s: {"symbol": s, "price": 200.0, "volume": 1, "per": 30.0})
        cache.set("fund:ZZTT", {"per": 30.0}, 60)
        for k in ("ext:ZZTT", "price:ZZTT"):
            cache.delete(k)
        P._장외받는중.clear()
        # 뒤에서 받는 일이 끝나려면 요청 사이에도 루프가 살아 있어야 한다(운영의
        # uvicorn 처럼). with 로 연다 — 대신 배경 루프들은 띄우지 않는다
        import app.main as M
        monkeypatch.setattr(M, "start_background_tasks", lambda *a, **k: None)
        with TestClient(app) as c:
            yield c, 불림, 세션
        for k in ("ext:ZZTT", "price:ZZTT", "fund:ZZTT"):
            cache.delete(k)

    def _부르기(self, c):
        import time
        t = time.perf_counter()
        r = c.get("/api/v1/stocks/US/ZZTT/detail")
        return r.json(), time.perf_counter() - t

    def test_장중에는_묻지도_않는다(self, 상세):
        c, 불림, 세션 = 상세
        본문, 걸림 = self._부르기(c)
        assert 본문["price"] == 200.0 and 불림["장외"] == 0 and 걸림 < 0.6

    def test_장전에는_기다리지_않고_다음_번에_붙는다(self, 상세):
        import time
        c, 불림, 세션 = 상세
        세션["v"] = "pre"
        본문, 걸림 = self._부르기(c)
        assert 걸림 < 0.6, f"{걸림:.2f}초 — 장외 시세를 기다렸다"
        assert "pre_market_price" not in 본문
        self._부르기(c)                                  # 받는 중에 또 열어도 한 번만 받는다
        time.sleep(1.0)                                  # 뒤에서 받는 동안
        본문2, _ = self._부르기(c)
        assert 본문2.get("pre_market_price") == 201.5
        assert 불림["장외"] == 1

    def test_못_받으면_한동안_다시_안_묻는다(self, 상세, monkeypatch):
        import time
        from app.core.cache import cache
        from app.services import price_fetcher
        c, 불림, 세션 = 상세
        세션["v"] = "after"

        async def 빈손(sym):
            불림["장외"] += 1
            return None

        monkeypatch.setattr(price_fetcher, "fetch_yf_quote_extended", 빈손)
        self._부르기(c)
        time.sleep(0.2)
        self._부르기(c)
        self._부르기(c)
        assert 불림["장외"] == 1
        assert cache.age("ext:ZZTT") is not None


class Test컨센서스_지난값_먼저:
    """컨센서스는 신선 기간이 하루라 대부분 '지난 값만 있는' 상태로 온다. 예전에는
    지난 값을 들고도 야후 속성 네 개를 다 받을 때까지 기다렸다."""

    @pytest.fixture
    def 손님(self, monkeypatch):
        import time
        from datetime import datetime, timedelta
        from fastapi.testclient import TestClient
        from app.main import app
        import app.main as M
        from app.core.cache import cache
        from app.db.database import SessionLocal, Base, engine
        from app.models.stock import ForecastsCache
        from app.api.routes.stocks import metrics as R
        Base.metadata.create_all(engine)
        db = SessionLocal()
        db.query(ForecastsCache).filter_by(symbol="FCST1").delete()
        db.add(ForecastsCache(symbol="FCST1", market="US",
                              data={"annual": [{"period": "2026", "eps_est": 5.0}], "quarterly": []},
                              fetched_at=datetime.utcnow() - timedelta(days=3)))
        db.commit(); db.close()
        for k in ("forecasts:v3:FCST1",):
            cache.delete(k)
        R._컨센서스받는중.clear()
        불림 = {"n": 0}

        class 느린종목:
            def __init__(self, s):
                불림["n"] += 1
            def __getattr__(self, name):
                time.sleep(0.6)
                return None

        monkeypatch.setattr("yfinance.Ticker", 느린종목)
        monkeypatch.setattr(M, "start_background_tasks", lambda *a, **k: None)
        with TestClient(app) as c:
            yield c, 불림
        cache.delete("forecasts:v3:FCST1")
        db = SessionLocal(); db.query(ForecastsCache).filter_by(symbol="FCST1").delete(); db.commit(); db.close()

    def test_지난_값으로_곧바로_답한다(self, 손님):
        import time
        c, 불림 = 손님
        t = time.perf_counter()
        r = c.get("/api/v1/stocks/US/FCST1/forecasts")
        걸림 = time.perf_counter() - t
        assert r.status_code == 200 and r.json()["annual"][0]["eps_est"] == 5.0
        assert 걸림 < 0.5, f"{걸림:.2f}초 — 지난 값을 들고도 야후를 기다렸다"

    def test_새로_받는_것은_뒤에서_한_번만(self, 손님):
        import time
        c, 불림 = 손님
        c.get("/api/v1/stocks/US/FCST1/forecasts")
        time.sleep(0.1)
        assert 불림["n"] >= 1, "뒤에서 새로 받지 않는다"
        n = 불림["n"]
        from app.core.cache import cache
        cache.delete("forecasts:v3:FCST1")                # 다음 요청도 지난 값 갈래로
        c.get("/api/v1/stocks/US/FCST1/forecasts")
        time.sleep(0.1)
        assert 불림["n"] == n, "받는 중인데 또 받기 시작했다"


class Test바깥이_막혀도_대시보드는_안_느려진다:
    """빈 지수를 잠깐 기다리게 했더니, 바깥(네이버·야후)이 막힌 동안에는
    대시보드 요청이 전부 3초씩 늦어졌다 — 기다려 봐야 또 빈손인데."""

    @pytest.fixture
    def 막힘(self, monkeypatch):
        import asyncio
        from app.api.routes import dashboard as D
        from app.core.cache import cache
        cache.delete("idx:KOSPI")
        횟수 = {"n": 0}

        async def 실패하는_채우기():
            횟수["n"] += 1
            await asyncio.sleep(0.3)             # 받아 보지만 빈손

        monkeypatch.setattr(D, "_refresh_indices_bg", 실패하는_채우기)
        monkeypatch.setattr(D.settings, "KIS_APP_KEY", "")
        monkeypatch.setattr(D, "_지수채우기", None)
        monkeypatch.setattr(D, "_지수채우기_끝난시각", -1e9)
        monkeypatch.setattr(D, "INDEX_COLD_WAIT", 1.0)
        return D, 횟수

    def test_실패한_뒤에는_기다리지_않는다(self, 막힘):
        import asyncio
        import time
        D, 횟수 = 막힘

        async def go():
            걸림 = []
            for _ in range(4):
                t = time.perf_counter()
                await D._get_kr_index_with_fallback("KOSPI")
                걸림.append(time.perf_counter() - t)
                await asyncio.sleep(0.01)
            return 걸림

        걸림 = asyncio.run(go())
        assert 걸림[0] < 0.6                     # 첫 사람은 채우기(0.3초)를 기다렸다
        assert all(x < 0.05 for x in 걸림[1:]), f"실패한 뒤에도 기다렸다: {걸림}"

    def test_앞사람이_기다린_만큼은_또_안_기다린다(self, 막힘, monkeypatch):
        import asyncio
        import time
        D, 횟수 = 막힘

        async def 오래걸림():
            await asyncio.sleep(5)

        monkeypatch.setattr(D, "_refresh_indices_bg", 오래걸림)

        async def go():
            t = time.perf_counter()
            await D._get_kr_index_with_fallback("KOSPI")       # 1초 기다리고 0
            첫 = time.perf_counter() - t
            t = time.perf_counter()
            await D._get_kr_index_with_fallback("KOSPI")       # 이미 1초 넘게 돌았다
            return 첫, time.perf_counter() - t

        첫, 둘 = asyncio.run(go())
        assert 0.8 < 첫 < 1.5 and 둘 < 0.05, (첫, 둘)


class Test프로필사진은_주소로:
    """프로필 사진(base64, 한 장에 9천 자 남짓)을 글·댓글·알림 하나하나에
    통째로 실었다. 피드 한 쪽이면 같은 사진이 스무 번 넘게 실렸다."""

    작은PNG = ("data:image/png;base64,"
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")

    @pytest.fixture
    def 사람과_글(self):
        from fastapi.testclient import TestClient
        from app.main import app
        from app.db.database import SessionLocal, Base, engine
        from app.models.user import User
        from app.models.community import StockPost, UserProfile
        from app.api.routes.community import encode_content
        from app.core.cache import cache
        Base.metadata.create_all(engine)
        db = SessionLocal()
        me = db.query(User).filter(User.email == "사진주소@test").first()
        if not me:
            me = User(email="사진주소@test", username="사진주소", hashed_password="x")
            db.add(me); db.commit(); db.refresh(me)
        p = db.query(UserProfile).filter_by(user_id=me.id).first()
        if not p:
            p = UserProfile(user_id=me.id); db.add(p)
        p.avatar_url = self.작은PNG
        db.query(StockPost).filter_by(user_id=me.id).delete()
        db.add(StockPost(symbol="005930", market="KR", user_id=me.id,
                         content=encode_content("사진 검사", "본문")))
        db.commit()
        uid = me.id
        db.close()
        cache.delete_pattern("feed:")
        cache.delete(f"avatar:{uid}")
        yield TestClient(app), uid
        cache.delete_pattern("feed:")
        cache.delete(f"avatar:{uid}")

    def test_피드에는_사진_대신_주소가_실린다(self, 사람과_글):
        c, uid = 사람과_글
        본문 = c.get("/api/v1/community/feed", params={"limit": 50}).json()
        내글 = [x for x in 본문["items"] if x["user_id"] == uid]
        assert 내글, "검사용 글이 피드에 없다"
        주소 = 내글[0]["avatar_url"]
        assert 주소.startswith(f"/community/users/{uid}/avatar?v=")
        assert "data:image" not in str(본문)

    def test_주소로_사진을_받는다(self, 사람과_글):
        import base64
        c, uid = 사람과_글
        r = c.get(f"/api/v1/community/users/{uid}/avatar?v=1")
        assert r.status_code == 200
        assert r.headers["content-type"] == "image/png"
        assert r.content == base64.b64decode(self.작은PNG.split(",", 1)[1])
        assert "immutable" in r.headers["cache-control"] and "max-age=31536000" in r.headers["cache-control"]
        assert r.headers.get("content-encoding", "identity") == "identity"

    def test_사진이_없으면_주소도_없다(self, 사람과_글):
        from app.api.routes.community import _사진주소
        from types import SimpleNamespace as 칸
        assert _사진주소(None) is None
        assert _사진주소(칸(user_id=1, avatar_url=None, updated_at=None)) is None

    def test_없는_사람은_404(self, 사람과_글):
        c, _ = 사람과_글
        assert c.get("/api/v1/community/users/987654321/avatar").status_code == 404

    def test_사진을_바꾸면_서버가_들고_있던_것도_버린다(self, 사람과_글):
        import inspect
        from app.api.routes import community as C
        본문 = inspect.getsource(C)
        i = 본문.index("p.avatar_url = body.avatar_url or None")
        assert 'cache.delete(f"avatar:{p.user_id}")' in 본문[i:i + 200]


def test_댓글과_알림도_사진은_주소로():
    import inspect
    from app.api.routes import community as C
    for 함수 in (C._ser_comment, C.list_notifications):
        본문 = inspect.getsource(함수)
        assert "_사진주소(" in 본문, f"{함수.__name__} 가 주소를 안 쓴다"
        assert ".avatar_url if" not in 본문, f"{함수.__name__} 가 사진을 통째로 싣는다"


class Test스크리닝_사진:
    """스크리닝은 누를 때마다 300종목 넘게 줄을 모았다 — 30분이 지나거나 서버가
    깨어나면 처음부터. 마지막 결과(사진)로 곧바로 답하고 새로 찍는 것은 뒤에서."""

    @pytest.fixture
    def 야후(self, monkeypatch):
        import threading
        import time
        from app.services import yf_service as Y
        Y.스크리닝_사진_비우기()
        불림 = {"n": 0, "늦음": 0.0, "값": 1.0}
        잠금 = threading.Lock()

        def 한줄(s, m):
            with 잠금:
                불림["n"] += 1
            time.sleep(불림["늦음"])
            return {"symbol": s, "market": m, "per": 불림["값"]}

        monkeypatch.setattr(Y, "스크리닝_종목들", lambda m: ["A", "B", "C"])
        monkeypatch.setattr(Y.yf_service, "_screen_one", 한줄)
        yield Y, 불림
        Y.스크리닝_사진_비우기()

    def test_사진이_있으면_다시_묻지_않는다(self, 야후):
        Y, 불림 = 야후
        Y.yf_service.screen_stocks("US", {})
        Y.yf_service.screen_stocks("US", {"per": {"min": 0}})
        assert 불림["n"] == 3, "조건만 바꿨는데 300종목을 다시 물었다"

    def test_오래됐으면_지난_사진으로_곧바로_답하고_뒤에서_새로(self, 야후, monkeypatch):
        import time
        Y, 불림 = 야후
        Y.yf_service.screen_stocks("US", {})
        줄들, _ = Y._스크리닝_사진["US"]
        Y._스크리닝_사진["US"] = (줄들, time.time() - 4000)          # 30분이 지났다
        불림["늦음"], 불림["값"] = 0.3, 2.0
        t = time.perf_counter()
        결과 = Y.yf_service.screen_stocks("US", {})
        assert time.perf_counter() - t < 0.1, "새로 찍는 것을 기다렸다"
        assert [r["per"] for r in 결과] == [1.0, 1.0, 1.0]          # 지난 사진
        for _ in range(40):
            if Y._스크리닝_사진["US"][0][0]["per"] == 2.0:
                break
            time.sleep(0.05)
        assert Y._스크리닝_사진["US"][0][0]["per"] == 2.0, "뒤에서 새로 찍지 않았다"

    def test_서버가_깨도_DB_의_사진으로_답한다(self, 야후):
        Y, 불림 = 야후
        Y.yf_service.screen_stocks("US", {})
        Y._스크리닝_사진.clear()                                   # 메모리가 비었다(서버가 깼다)
        불림["n"] = 0
        결과 = Y.yf_service.screen_stocks("US", {})
        assert len(결과) == 3 and 불림["n"] == 0

    def test_사진이_없을_때_여럿이_눌러도_한_번만_찍는다(self, 야후):
        import threading
        Y, 불림 = 야후
        불림["늦음"] = 0.2
        결과들 = []
        스레드들 = [threading.Thread(target=lambda: 결과들.append(Y.yf_service.screen_stocks("US", {})))
                    for _ in range(4)]
        for t in 스레드들: t.start()
        for t in 스레드들: t.join()
        assert 불림["n"] == 3 and all(len(r) == 3 for r in 결과들)

    def test_오래된_DB_사진은_안_쓴다(self, 야후):
        from datetime import datetime, timedelta
        from app.db.database import SessionLocal
        from app.models.stock import ScreeningSnapshot
        Y, 불림 = 야후
        Y.yf_service.screen_stocks("US", {})
        db = SessionLocal()
        db.query(ScreeningSnapshot).filter_by(market="US").update(
            {"fetched_at": datetime.utcnow() - timedelta(days=8)})
        db.commit(); db.close()
        Y._스크리닝_사진.clear()
        불림["n"] = 0
        Y.yf_service.screen_stocks("US", {})
        assert 불림["n"] == 3


class Test작은것들:
    def test_사전확인_답을_오래_기억하게_한다(self):
        """로그인한 사람의 요청은 주소마다 사전 확인(preflight)을 먼저 보낸다.
        기본 10분이면 그 왕복이 자주 다시 붙는다."""
        from fastapi.testclient import TestClient
        from app.main import app
        r = TestClient(app).options("/api/v1/dashboard/kr", headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
        })
        assert r.headers.get("access-control-max-age") == "7200"

    def test_글을_읽을_때_그림_바이트는_안_끌어온다(self):
        """좋아요·댓글·투표·관리자 목록 어디서도 안 쓰는 그림 바이트(수백 KB)를
        글 한 줄 읽을 때마다 같이 읽었다."""
        from sqlalchemy import inspect as 살펴보기
        from app.models.community import StockPost
        칸들 = 살펴보기(StockPost).column_attrs
        assert 칸들["image_data"].deferred and 칸들["search_text"].deferred
        assert not 칸들["content"].deferred


class Test공지와_팝업:
    """앱을 여는 모든 사람이 공지·팝업을 묻는다. 바뀌는 일은 드문데 매번 DB 를 읽었다."""

    @pytest.fixture
    def 팝업(self):
        from app.db.database import SessionLocal, Base, engine
        from app.models.community import SitePopup
        from app.core.cache import cache
        from fastapi.testclient import TestClient
        from app.main import app
        Base.metadata.create_all(engine)
        db = SessionLocal()
        db.query(SitePopup).filter(SitePopup.title.like("속도검사%")).delete(synchronize_session=False)
        db.commit(); db.close()
        cache.delete("site:popups")
        yield TestClient(app)
        db = SessionLocal()
        db.query(SitePopup).filter(SitePopup.title.like("속도검사%")).delete(synchronize_session=False)
        db.commit(); db.close()
        cache.delete("site:popups")

    def _넣기(self, 제목, 시작=None, 끝=None):
        from app.db.database import SessionLocal
        from app.models.community import SitePopup
        db = SessionLocal()
        db.add(SitePopup(title=제목, is_active=True, starts_at=시작, ends_at=끝))
        db.commit(); db.close()

    def _제목들(self, c):
        return {p["title"] for p in c.get("/api/v1/admin/popups/active").json() if p["title"].startswith("속도검사")}

    def test_한번_읽으면_다시_DB_를_안_읽는다(self, 팝업):
        c = 팝업
        self._넣기("속도검사1")
        assert self._제목들(c) == {"속도검사1"}
        self._넣기("속도검사2")                        # DB 에는 있지만
        assert self._제목들(c) == {"속도검사1"}        # 잠깐 들고 있던 것을 쓴다

    def test_노출_기간은_요청마다_지금_시각으로_거른다(self, 팝업):
        import time
        from datetime import datetime, timedelta, timezone
        c = 팝업
        지금 = datetime.now(timezone.utc)
        self._넣기("속도검사_곧끝", 끝=지금 + timedelta(seconds=1.5))
        self._넣기("속도검사_곧시작", 시작=지금 + timedelta(seconds=1.5))
        assert self._제목들(c) == {"속도검사_곧끝"}
        time.sleep(1.8)
        assert self._제목들(c) == {"속도검사_곧시작"}, "담아 둔 동안 기간이 지난 것을 못 걸렀다"

    def test_관리자가_바꾸면_곧바로_버린다(self):
        import inspect
        from app.api.routes import admin as A
        for 함수 in (A.create_popup, A.update_popup, A.delete_popup):
            assert "cache.delete(_팝업_열쇠)" in inspect.getsource(함수), 함수.__name__
        assert "cache.delete(_공지_열쇠)" in inspect.getsource(A.set_announcement)

    def test_공지도_잠깐_들고_있는다(self):
        from fastapi.testclient import TestClient
        from sqlalchemy import text
        from app.main import app
        from app.db.database import engine
        from app.core.cache import cache
        cache.delete("site:announcement")
        c = TestClient(app)
        처음 = c.get("/api/v1/admin/announcement").json()
        try:
            with engine.connect() as conn:
                conn.execute(text("DELETE FROM system_settings WHERE key = 'announcement'"))
                conn.execute(text("INSERT INTO system_settings (key, value) VALUES ('announcement', '속도검사 공지')"))
                conn.commit()
            assert c.get("/api/v1/admin/announcement").json() == 처음
            cache.delete("site:announcement")
            assert c.get("/api/v1/admin/announcement").json() == {"text": "속도검사 공지"}
        finally:
            with engine.connect() as conn:
                conn.execute(text("DELETE FROM system_settings WHERE key = 'announcement'"))
                conn.commit()
            cache.delete("site:announcement")


def test_신호_백테스트_계산은_이벤트_루프_밖에서(monkeypatch):
    """async 라우트에서 엔진을 그냥 돌리면 계산하는 동안 모든 요청이 멈춘다."""
    import asyncio
    from fastapi.testclient import TestClient
    from app.main import app
    from app.api.routes import backtest as R
    from app.services.backtest_engine import backtest_engine as E
    import pandas as pd
    날 = pd.bdate_range("2023-01-02", periods=300)
    monkeypatch.setattr(R.yf_service, "get_ohlcv", lambda *a, **k: [
        {"date": d.strftime("%Y-%m-%d"), "open": 100 + i * 0.1, "high": 101 + i * 0.1,
         "low": 99 + i * 0.1, "close": 100 + i * 0.1, "volume": 1000} for i, d in enumerate(날)])
    어디서 = []
    원래 = E.run

    def 기록하며(*a, **k):
        try:
            asyncio.get_running_loop()
            어디서.append("루프")
        except RuntimeError:
            어디서.append("스레드")
        return 원래(*a, **k)

    monkeypatch.setattr(E, "run", 기록하며)
    r = TestClient(app).post("/api/v1/backtest/run", json={
        "symbol": "AAPL", "market": "US", "start_date": "2023-06-01", "end_date": "2024-02-01",
        "entry_conditions": {"logic": "AND", "conditions": [{"indicator": "PRICE", "operator": ">", "value": 0}]},
        "exit_conditions": {"logic": "AND", "conditions": []},
    })
    assert r.status_code == 200, r.text
    assert 어디서 == ["스레드", "스레드"], f"엔진이 루프에서 돌았다: {어디서}"


def test_자산배분은_환율과_벤치마크_시세를_처음부터_같이_받는다(monkeypatch):
    """예전에는 내 자산 시세 → 환율 → … → 계산 → 벤치마크 시세 를 차례로 했다."""
    import threading
    import time
    from datetime import date, timedelta
    from fastapi.testclient import TestClient
    from app.main import app
    from app.api.routes import backtest as R

    날 = [date(2020, 1, 1) + timedelta(days=i) for i in range(1500) if (date(2020, 1, 1) + timedelta(days=i)).weekday() < 5]
    기록 = []
    잠금 = threading.Lock()

    def 시세(symbol, period, interval, market):
        시작 = time.perf_counter()
        time.sleep(0.3)
        with 잠금:
            기록.append((symbol, 시작, time.perf_counter()))
        값 = 1300.0 if symbol == "USDKRW=X" else 100.0
        return [{"date": d.isoformat(), "open": 값, "high": 값, "low": 값,
                 "close": 값 * (1 + i * 0.0001), "volume": 1} for i, d in enumerate(날)]

    monkeypatch.setattr(R.yf_service, "get_ohlcv", 시세)
    r = TestClient(app).post("/api/v1/backtest/portfolio", json={
        "assets": [{"symbol": "AAPL", "market": "US", "name": "AAPL", "weight": 100}],
        "currency": "KRW", "initial_amount": 10_000_000,
        "start_date": "2020-03-02", "end_date": "2025-06-30",
        "contribution_period": "none", "contribution_amount": 0,
        "rebalance_period": "none", "total_return": False, "benchmark": "spy"})
    assert r.status_code == 200, r.text[:300]
    assert r.json().get("benchmark"), "벤치마크가 안 나왔다"
    내것 = next(x for x in 기록 if x[0] == "AAPL")
    for 심볼, 시작, _ in 기록:
        if 심볼 != "AAPL":
            assert 시작 < 내것[2], f"{심볼} 를 내 자산 시세가 끝난 뒤에야 받기 시작했다"


def test_미리_받은_벤치마크도_내_포트폴리오가_잰_구간으로_자른다(monkeypatch):
    """벤치마크를 요청 기간으로 미리 받으므로, 내 자산이 늦게 상장해 측정이
    늦게 시작하면 반드시 그 구간으로 잘라야 같은 기간을 견준다."""
    from datetime import date, timedelta
    from fastapi.testclient import TestClient
    from app.main import app
    from app.api.routes import backtest as R

    def 날들(시작):
        return [시작 + timedelta(days=i) for i in range(2000)
                if (시작 + timedelta(days=i)).weekday() < 5 and 시작 + timedelta(days=i) <= date(2025, 6, 30)]

    def 시세(symbol, period, interval, market):
        시작 = date(2022, 1, 3) if symbol == "LATE" else date(2019, 1, 1)
        return [{"date": d.isoformat(), "open": 100, "high": 100, "low": 100,
                 "close": 100.0 * (1 + i * 0.0003), "volume": 1} for i, d in enumerate(날들(시작))]

    monkeypatch.setattr(R.yf_service, "get_ohlcv", 시세)
    r = TestClient(app).post("/api/v1/backtest/portfolio", json={
        "assets": [{"symbol": "LATE", "market": "US", "name": "LATE", "weight": 100}],
        "currency": "USD", "initial_amount": 10_000_000,
        "start_date": "2020-01-02", "end_date": "2025-06-30",
        "contribution_period": "none", "contribution_amount": 0,
        "rebalance_period": "none", "total_return": False, "benchmark": "spy"})
    d = r.json()
    assert d["start_date"] >= "2022-01-03"
    벤치곡선 = d["benchmark"]["curve"]
    첫날 = 벤치곡선[0]["date"] if isinstance(벤치곡선[0], dict) else 벤치곡선[0][0]
    assert 첫날 >= d["start_date"], f"벤치마크가 {첫날} 부터 잰다 — 내 것은 {d['start_date']} 부터"
    # 곡선은 화면용으로 내 날짜에 맞춰 솎으므로, 수익률로 본다 — 같은 구간이면
    # 벤치마크 수익률 = 그 구간 첫날·끝날 종가의 비
    spy = {x["date"]: x["close"] for x in 시세("SPY", "max", "1d", "US")}
    처음 = min(k for k in spy if k >= d["start_date"])
    끝 = max(k for k in spy if k <= d["end_date"])
    기대 = (spy[끝] / spy[처음] - 1) * 100
    assert abs(d["benchmark"]["total_return"] - 기대) < 0.5, \
        f"벤치마크 수익률 {d['benchmark']['total_return']} — 같은 구간이면 {기대:.2f}"
