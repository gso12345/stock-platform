"""
해외 순위에 다섯 종목만 나오던 문제.

원인이 세 겹이었다.

  1) _build_us_rows 가 아무것도 안 받아 온다.
     캐시에 이미 있는 종목만 주워 담는다. 없으면 그냥 건너뛴다.

  2) 그 캐시를 채우는 refresh_us_stocks 는 미국장이 열렸을 때만 돈다.
     한국 낮에는 미국장이 닫혀 있으니 하루의 대부분 아무것도 안 받는다.

  3) price:{sym} 수명이 120초인데 갱신은 300초마다였다. 게다가 지난 값
     보관함이 전체 400칸뿐이라(STALE_MAX_ITEMS) 미국 종목 335개가 금방
     밀려난다.

세 개가 겹쳐서, 한국 낮에 들어오면 주울 것이 거의 없었다.

고친 방향 —
  · 종목별 시세 대신 '완성된 순위표' 를 따로 담는다(15분).
  · 표가 얇으면 전종목을 실제로 받아 다시 만든다(배경).
  · 장이 닫혀 있어도 30분에 한 번, 시작할 때도 한 번 채운다.
    닫혀 있으면 종가라 값이 안 변하므로 오히려 오래 담아 둘 수 있다.

그리고 범위를 넓혔다.
  처음 고칠 때는 대상이 여전히 코드에 적어 둔 335개(인기 20 + S&P500
  발췌 315)였다. 그건 'S&P500 안에서의 순위' 이지 미국 시장 순위가
  아니다 — 러셀 소형주도, 나스닥 중소형도, ETF 도 후보에 없었다.

  목록은 이미 갖고 있었다. us_tickers 가 NASDAQ Trader 심볼 디렉터리를
  받아 두고(우선주·워런트·유닛은 그쪽에서 걸러진다) 약 8~9천 종목이다.
  한 번에 다 받을 수는 없으니 나눠 훑고 다음 번에 이어 간다.
"""
import asyncio

import pytest

from app.core.cache import cache  # noqa: E402
from app.services import ranking_service as R  # noqa: E402


def _가짜시세(n: int, 시작: int = 0) -> dict:
    """n개 종목의 시세를 캐시에 심는다."""
    from app.services.scheduler import POPULAR_US
    심볼 = list(dict.fromkeys(POPULAR_US + R.SP500_SYMBOLS))[시작:시작 + n]
    for i, s in enumerate(심볼):
        cache.set(f"price:{s}", {
            "symbol": s, "name": s, "price": 100.0 + i,
            "change": 1.0, "change_rate": 1.0 + i * 0.01,
            "volume": 1000 + i, "market_cap": 1_000_000 * (i + 1),
        }, 300)
    return {"심볼": 심볼}


@pytest.fixture(autouse=True)
def _비우기():
    cache.delete(R.US_ROWS_CK)
    for c in ("시가총액", "상승률", "하락률", "거래대금", "거래량"):
        cache.delete(f"rank:us:{c}")
    from app.services.scheduler import POPULAR_US
    for s in list(dict.fromkeys(POPULAR_US + R.SP500_SYMBOLS)):
        cache.delete(f"price:{s}")
    R._us_rows_refreshing = False
    yield


class Test얼마나_나오는가:
    def test_전종목_시세가_있으면_전부_순위에_들어간다(self):
        """예전에도 이건 됐다. 문제는 시세가 없을 때였다."""
        _가짜시세(200)
        rows = R._build_us_rows()
        assert len(rows) == 200

    def test_다섯_개뿐이면_그걸_담아_두지_않는다(self):
        """얇은 표를 캐시에 넣으면 15분 동안 다섯 줄짜리 순위가 굳는다."""
        _가짜시세(5)
        R._build_us_rows()
        assert cache.get(R.US_ROWS_CK) is None, "얇은 표를 담아 버렸다"

    def test_충분하면_담아_둔다(self):
        _가짜시세(R.US_MIN_ROWS + 10)
        R._build_us_rows()
        assert cache.get(R.US_ROWS_CK) is not None

    def test_지난_표가_지금보다_두꺼우면_지난_것을_쓴다(self):
        """다섯 줄짜리 순위를 보여 주느니 15분 지난 순위가 낫다."""
        _가짜시세(120)
        R._build_us_rows()                    # 120개짜리 표를 담는다
        cache.set(R.US_ROWS_CK, cache.get(R.US_ROWS_CK), 1)
        import time
        time.sleep(1.1)                       # 수명을 넘긴다
        for s in _가짜시세(0)["심볼"]:
            pass
        # 시세를 거의 다 지워 얇은 상태로 만든다
        from app.services.scheduler import POPULAR_US
        for s in list(dict.fromkeys(POPULAR_US + R.SP500_SYMBOLS))[5:]:
            cache.delete(f"price:{s}")
        rows = R._build_us_rows()
        assert len(rows) == 120, f"지난 표를 안 쓴다: {len(rows)}줄"

    def test_담긴_표가_있으면_다시_만들지_않는다(self):
        """담긴 표를 무시하고 매번 새로 만들면, 카테고리가 일곱 개라
        같은 계산을 일곱 번 한다. 0.15 CPU 에서는 그게 곧 지연이다.

        시세도 함께 넣어 둔다 — 시세가 없으면 새로 만들어도 빈 표가 나와
        '담긴 것을 썼는지' 를 구분할 수 없다(뮤테이션에서 그렇게
        빠져나갔다)."""
        _가짜시세(80)                                   # 새로 만들면 80줄
        담긴표 = [{"symbol": "담김", "price": 1, "market_cap": 1}]
        cache.set(R.US_ROWS_CK, 담긴표, 300)
        rows = R._build_us_rows()
        assert len(rows) == 1 and rows[0]["symbol"] == "담김", \
            f"담긴 표를 무시하고 새로 만들었다: {len(rows)}줄"


class Test정렬:
    def test_시가총액_순으로_매긴다(self):
        _가짜시세(60)
        순위 = R._sort_us(R._build_us_rows(), "시가총액")
        시총 = [r["market_cap"] for r in 순위]
        assert 시총 == sorted(시총, reverse=True)
        assert 순위[0]["rank"] == 1

    def test_상승률과_하락률이_반대다(self):
        _가짜시세(60)
        rows = R._build_us_rows()
        올림 = R._sort_us(list(rows), "상승률")[0]["symbol"]
        내림 = R._sort_us(list(rows), "하락률")[0]["symbol"]
        assert 올림 != 내림

    def test_백_등까지만_준다(self):
        """전종목을 다 내려보내면 응답이 커진다."""
        _가짜시세(200)
        assert len(R._sort_us(R._build_us_rows(), "시가총액")) == 100


class Test전종목_받아오기:
    """이게 이번 고침의 핵심이다 — 예전에는 아무것도 안 받았다."""

    @pytest.fixture(autouse=True)
    def _여유는_있다고_본다(self, monkeypatch):
        """메모리 여유 검사를 고정한다.

        refresh_us_rows 는 묶음 사이마다 has_headroom 을 본다 — 야후 응답이
        파싱 중간물로 크게 잡혀서, 15묶음을 쉬지 않고 돌면 그 사이에 한도를
        넘기 때문이다(실제로 프로덕션이 그렇게 죽었다).

        그런데 검사를 전부 돌리는 프로세스는 pandas·yfinance 를 다 올려서
        RSS 가 MEMORY_LIMIT_MB(기본 512) 의 75% 를 넘는다. 그러면 첫 묶음
        뒤에 바로 멈춰 '한 묶음 실패에 전부 포기했다' 로 보인다 —
        이 검사가 보려는 것과 상관없는 이유로.

        단독으로 돌리면 통과하고 전체로 돌리면 깨지던 것이 이것이었다.
        여유 검사 자체는 test_memory_guard 가 따로 지킨다.

        커서도 함께 되돌린다. _us_cursor 는 모듈 전역이라 앞 검사가 옮겨
        놓은 자리가 그대로 남는다. 그러면 다음 검사는 목록 중간부터
        훑는데, 여기 가짜는 앞줄(인기종목·S&P500)만 답하므로 아무것도
        못 받고 '한 묶음 실패에 전부 포기했다' 로 보인다.

        목록이 6,884 종목이 되면서 드러났다 — 예전 372개일 때는 한 회차에
        한 바퀴를 다 돌아 커서가 늘 0 으로 돌아왔다."""
        monkeypatch.setattr(R.memory, "has_headroom", lambda *a, **kw: True)
        R._us_cursor = 0

    def _가짜받기(self, monkeypatch, 개수):
        from app.services.scheduler import POPULAR_US
        심볼 = list(dict.fromkeys(POPULAR_US + R.SP500_SYMBOLS))
        부른묶음 = []
        async def _받기(묶음):
            부른묶음.append(list(묶음))
            return {s: {"price": 100.0, "change": 1, "change_rate": 1,
                        "volume": 10, "market_cap": 1000, "name": s}
                    for s in 묶음 if s in 심볼[:개수]}

        import app.services.price_fetcher as PF
        monkeypatch.setattr(PF, "fetch_yf_quotes", _받기)
        return 부른묶음

    def test_전종목을_받아_표를_만든다(self, monkeypatch):
        묶음들 = self._가짜받기(monkeypatch, 400)
        받은수 = asyncio.run(R.refresh_us_rows())
        assert 받은수 > R.US_MIN_ROWS, f"{받은수}개뿐이다"
        assert cache.get(R.US_ROWS_CK), "표를 안 담았다"
        # 한꺼번에 던지지 않고 나눠 받는다 — 0.15 CPU 서버다
        assert len(묶음들) > 1
        assert all(len(b) <= 100 for b in 묶음들)

    def test_다_받으면_카테고리_순위도_다시_만들게_비운다(self, monkeypatch):
        self._가짜받기(monkeypatch, 400)
        cache.set("rank:us:시가총액", [{"symbol": "낡음"}], 900)
        asyncio.run(R.refresh_us_rows())
        assert cache.get("rank:us:시가총액") is None, "낡은 순위가 남았다"

    def test_한_묶음이_실패해도_나머지는_받는다(self, monkeypatch):
        from app.services.scheduler import POPULAR_US
        심볼 = list(dict.fromkeys(POPULAR_US + R.SP500_SYMBOLS))
        호출 = {"n": 0}

        async def _받기(묶음):
            호출["n"] += 1
            if 호출["n"] == 1:
                raise RuntimeError("첫 묶음 실패")
            return {s: {"price": 100.0, "change": 0, "change_rate": 0,
                        "volume": 1, "market_cap": 1, "name": s}
                    for s in 묶음 if s in 심볼}

        import app.services.price_fetcher as PF
        monkeypatch.setattr(PF, "fetch_yf_quotes", _받기)
        받은수 = asyncio.run(R.refresh_us_rows())
        assert 받은수 > R.US_MIN_ROWS, "한 묶음 실패에 전부 포기했다"

    def test_동시에_두_번_돌지_않는다(self, monkeypatch):
        """여러 사람이 동시에 열면 전종목 받기가 겹친다.
        0.15 CPU 에서는 겹치는 것 자체가 비용이다."""
        self._가짜받기(monkeypatch, 400)
        R._us_rows_refreshing = True
        try:
            assert asyncio.run(R.refresh_us_rows()) == 0
        finally:
            R._us_rows_refreshing = False

    def test_끝나면_표시를_지운다(self, monkeypatch):
        """안 지우면 그 뒤로 영영 갱신이 안 된다."""
        self._가짜받기(monkeypatch, 400)
        asyncio.run(R.refresh_us_rows())
        assert R._us_rows_refreshing is False

    def test_터져도_표시를_지운다(self, monkeypatch):
        import app.services.price_fetcher as PF

        async def _터짐(묶음):
            raise RuntimeError("전부 실패")
        monkeypatch.setattr(PF, "fetch_yf_quotes", _터짐)
        asyncio.run(R.refresh_us_rows())
        assert R._us_rows_refreshing is False

    def test_장이_닫혔으면_시세를_오래_담는다(self, monkeypatch):
        """종가는 안 변한다. 짧게 잡으면 금방 비어 또 다섯 줄이 된다."""
        self._가짜받기(monkeypatch, 400)
        from app.services import market_hours
        monkeypatch.setattr(market_hours, "us_session", lambda: "closed")

        담긴수명 = {}
        원래 = cache.set

        def _엿보기(k, v, ttl=None, *a, **kw):
            if k.startswith("price:"):
                담긴수명[k] = ttl
            return 원래(k, v, ttl, *a, **kw)
        monkeypatch.setattr(cache, "set", _엿보기)

        asyncio.run(R.refresh_us_rows())
        수명들 = set(담긴수명.values())
        assert 수명들 and max(수명들) >= 900, f"닫혔는데 수명이 짧다: {수명들}"


class Test스케줄러가_닫혀도_채우는가:
    def test_장이_닫혀도_도는_자리가_있다(self):
        import inspect
        from app.services import scheduler as S
        본문 = inspect.getsource(S._scheduler_loop) if hasattr(S, "_scheduler_loop") \
            else inspect.getsource(S)
        assert 'us_session() == "closed"' in 본문, \
            "닫혀 있을 때 순위표를 채우는 자리가 없다"
        assert "refresh_us_rows" in 본문

    def test_시작할_때도_채운다(self):
        """Render 무료 플랜은 재시작이 잦다. 재시작 직후 한국 낮에
        들어온 사람이 다섯 줄짜리 순위를 보면 안 된다."""
        import inspect
        from app.services import scheduler as S
        본문 = inspect.getsource(S)
        시작부 = 본문[본문.find("startup_jobs = []"):]
        assert "refresh_us_rows" in 시작부[:800], "시작 작업에 없다"


class Test시세_수명이_갱신_주기와_맞는가:
    def test_갱신_주기보다_길다(self):
        """120초 수명에 300초 갱신이었다. 5분 중 3분은 캐시가 비어
        있었고, 지난 값 보관함은 400칸뿐이라 금방 밀려났다."""
        import inspect, re
        from app.services import scheduler as S
        본문 = inspect.getsource(S.refresh_us_stocks)
        m = re.search(r'cache\.set\(f"price:\{sym\}", q, (\d+)\)', 본문)
        assert m, "수명을 못 찾음"
        assert int(m.group(1)) >= 300, f"갱신 주기(300초)보다 짧다: {m.group(1)}초"


class Test범위가_전종목인가:
    """335개는 'S&P500 안에서의 순위' 이지 미국 시장 순위가 아니다."""

    def _가짜목록(self, monkeypatch, 개수):
        import app.services.ticker_service as TS
        목록 = [{"s": f"T{i:05d}", "n": f"이름{i}", "m": "US"} for i in range(개수)]
        monkeypatch.setattr(TS, "get_us_db", lambda: 목록)
        return 목록

    def test_상장_목록_전체를_대상으로_한다(self, monkeypatch):
        self._가짜목록(monkeypatch, 8000)
        assert len(R.us_universe()) >= 8000, "여전히 좁은 목록으로 돈다"

    def test_인기종목과_SP500_이_앞에_온다(self, monkeypatch):
        """한 바퀴를 다 돌기 전에도 시가총액 상위가 제대로 나와야 한다.
        알파벳 순으로 훑으면 A 로 시작하는 종목만 있는 순위가 한동안 뜬다."""
        self._가짜목록(monkeypatch, 8000)
        앞 = R.us_universe()[:335]
        assert "AAPL" in 앞 and "MSFT" in 앞

    def test_중복이_없다(self, monkeypatch):
        """S&P500 종목은 상장 목록에도 들어 있다. 두 번 받으면 낭비다."""
        import app.services.ticker_service as TS
        monkeypatch.setattr(TS, "get_us_db",
                            lambda: [{"s": s, "n": s, "m": "US"} for s in
                                     ["AAPL", "MSFT", "ZZZZ"] + [f"T{i}" for i in range(3000)]])
        u = R.us_universe()
        assert len(u) == len(set(u))

    def test_목록이_부실해도_예전만큼은_나온다(self, monkeypatch):
        """목록을 못 받아 내장 182개로 떨어진 상태다.
        앞줄(인기+SP500)이 늘 먼저 오므로 예전 335개보다 나쁠 수 없다."""
        import app.services.ticker_service as TS
        monkeypatch.setattr(TS, "get_us_db", lambda: [{"s": "AAPL", "n": "애플", "m": "US"}])
        assert len(R.us_universe()) >= 300

    def test_목록_읽기가_터져도_돈다(self, monkeypatch):
        import app.services.ticker_service as TS
        def _터짐():
            raise RuntimeError("DB 없음")
        monkeypatch.setattr(TS, "get_us_db", _터짐)
        assert len(R.us_universe()) >= 300

    def test_ETF_도_후보에_들어간다(self, monkeypatch):
        import app.services.ticker_service as TS
        monkeypatch.setattr(TS, "get_us_db", lambda: (
            [{"s": f"T{i}", "n": f"n{i}", "m": "US"} for i in range(3000)]
            + [{"s": "SPY", "n": "SPDR S&P 500", "m": "ETF"}]))
        assert "SPY" in R.us_universe()


class Test나눠_훑는가:
    """8~9천을 한 번에 받으면 몇 분씩 걸리고 그동안 서버가 멈춘다."""

    def _준비(self, monkeypatch, 목록수=5000, 훑는양=400):
        """훑는 양을 줄여 검사를 빠르게 한다 — 보려는 것은 '나눠 훑는가'
        이지 1500이라는 숫자가 아니다. 실제 값은 아래에서 따로 본다."""
        import app.services.ticker_service as TS
        import app.services.price_fetcher as PF
        monkeypatch.setattr(R, "US_SWEEP", 훑는양)
        monkeypatch.setattr(TS, "get_us_db",
                            lambda: [{"s": f"T{i:05d}", "n": f"n{i}", "m": "US"}
                                     for i in range(목록수)])
        받은심볼 = []

        async def _받기(묶음):
            받은심볼.extend(묶음)
            return {s: {"price": 10.0, "change": 0, "change_rate": 0,
                        "volume": 1, "market_cap": 1, "name": s} for s in 묶음}
        monkeypatch.setattr(PF, "fetch_yf_quotes", _받기)
        R._us_cursor = 0
        return 받은심볼

    def test_한_번에_다_받지_않는다(self, monkeypatch):
        받은 = self._준비(monkeypatch, 5000)
        asyncio.run(R.refresh_us_rows())
        assert len(받은) <= R.US_SWEEP, f"{len(받은)}개를 한꺼번에 받았다"

    def test_다음_번에_그_다음부터_이어_받는다(self, monkeypatch):
        """같은 앞부분만 반복해서 받으면 뒤쪽은 영영 안 채워진다."""
        받은 = self._준비(monkeypatch, 5000)
        asyncio.run(R.refresh_us_rows())
        첫바퀴 = set(받은)
        받은.clear()
        asyncio.run(R.refresh_us_rows())
        assert not (set(받은) & 첫바퀴), "같은 것을 또 받았다"

    def test_몇_번_돌면_한_바퀴가_된다(self, monkeypatch):
        받은 = self._준비(monkeypatch, 2000, 훑는양=500)
        전체수 = len(R.us_universe())
        for _ in range(전체수 // 500 + 2):
            asyncio.run(R.refresh_us_rows())
        assert len(set(받은)) >= 전체수, f"한 바퀴를 못 돌았다: {len(set(받은))}/{전체수}"

    def test_목록이_훑는_양보다_작으면_딱_한_바퀴만(self, monkeypatch):
        """목록을 두 번 이어 붙여 잘라 내므로, 잘못 짜면 같은 종목을
        두 번 받는다."""
        받은 = self._준비(monkeypatch, 2500, 훑는양=99999)
        asyncio.run(R.refresh_us_rows())
        전체수 = len(R.us_universe())
        assert len(받은) == 전체수, f"{len(받은)} 받음 / 전체 {전체수}"
        assert len(set(받은)) == 전체수, "같은 종목을 두 번 받았다"

    def test_끝에_닿아도_한_번에_훑는_양이_줄지_않는다(self, monkeypatch):
        """목록을 두 번 이어 붙여 잘라 내는 이유다. 안 그러면 끝자락에
        닿은 회차만 몇 개 받고 끝나 한 바퀴가 그만큼 늦어진다."""
        받은 = self._준비(monkeypatch, 2000, 훑는양=400)
        전체수 = len(R.us_universe())
        R._us_cursor = 전체수 - 50          # 끝에서 50개 남은 자리
        asyncio.run(R.refresh_us_rows())
        assert len(받은) == 400, f"끝자락에서 {len(받은)}개만 받았다"

    def test_요청_한_번에_담는_수가_주소_길이를_넘지_않는다(self, monkeypatch):
        받은 = self._준비(monkeypatch, 5000, 훑는양=400)
        묶음들 = []
        import app.services.price_fetcher as PF

        async def _엿보기(묶음):
            묶음들.append(len(묶음))
            return {}
        monkeypatch.setattr(PF, "fetch_yf_quotes", _엿보기)
        asyncio.run(R.refresh_us_rows())
        assert 묶음들 and max(묶음들) <= 100

    def test_기본_훑는_양이_한_번에_다_받지_않을_만큼_작다(self):
        """전종목이 8~9천이다. 이 값이 그만큼 크면 한 번에 다 받는 셈이라
        몇 분씩 서버를 물고 있게 된다."""
        assert 200 <= R.US_SWEEP <= 3000

    def test_장이_닫혔으면_한_바퀴_도는_동안_안_만료된다(self, monkeypatch):
        """전종목 한 바퀴가 몇 시간 걸린다. 수명이 짧으면 앞서 받은 것이
        뒤쪽을 받는 사이에 만료돼 순위표가 영원히 안 찬다."""
        self._준비(monkeypatch, 5000, 훑는양=200)
        from app.services import market_hours
        monkeypatch.setattr(market_hours, "us_session", lambda: "closed")
        수명 = {}
        원래 = cache.set

        def _엿보기(k, v, ttl=None, *a, **kw):
            if k.startswith("price:"):
                수명[k] = ttl
            return 원래(k, v, ttl, *a, **kw)
        monkeypatch.setattr(cache, "set", _엿보기)
        asyncio.run(R.refresh_us_rows())
        assert 수명 and min(수명.values()) >= 6 * 3600


class Test표를_쌓아_올리는가:
    """"해외종목순위 시가총액 안맞아" — 순위가 6,884 종목이 아니라
    마지막에 훑은 몇백 개 안에서만 매겨지고 있었다.

    _us_rows_from_cache 는 종목마다 price:{sym} 를 캐시에서 읽는다.
    그런데 지난 값 보관함이 400칸뿐이다(STALE_MAX_ITEMS). 한 바퀴에
    300개씩 훑으면, 다음 바퀴를 도는 사이에 앞서 받은 것이 밀려난다.
    매번 표를 처음부터 다시 만드니 앞부분이 통째로 사라졌고, 그래서
    삼성전자급 대형주가 빠진 순위가 나왔다."""

    def test_지난_표에_이번_회차를_덮어_쌓는다(self):
        지난표 = [{"symbol": "옛것", "price": 1.0, "market_cap": 500},
                  {"symbol": "겹침", "price": 1.0, "market_cap": 100}]
        cache.set(R.US_ROWS_CK, 지난표, 300)
        쌓은것 = R._표에_쌓기([{"symbol": "새것", "price": 2.0, "market_cap": 900},
                              {"symbol": "겹침", "price": 9.0, "market_cap": 999}])

        모음 = {r["symbol"]: r for r in 쌓은것}
        assert set(모음) == {"옛것", "겹침", "새것"}, "지난 표를 버렸다"
        assert 모음["겹침"]["market_cap"] == 999, "겹치면 새 값으로 덮어야 한다"

    def test_지난_표가_만료돼도_담아_둔_것을_쓴다(self):
        """수명이 지나도 stale 로 남아 있으면 그걸 밑바탕으로 쌓는다."""
        cache.set(R.US_ROWS_CK, [{"symbol": "옛것", "market_cap": 5}], 1)
        import time
        time.sleep(1.1)
        쌓은것 = R._표에_쌓기([{"symbol": "새것", "market_cap": 9}])
        assert {r["symbol"] for r in 쌓은것} == {"옛것", "새것"}

    def test_여러_회차를_돌면_표가_계속_두꺼워진다(self):
        """이게 실제로 겪은 것이다. 쌓지 않으면 몇 회차를 돌아도 표는
        마지막 회차 크기에 머문다."""
        cache.delete(R.US_ROWS_CK)
        누적 = []
        for 회차 in range(5):
            이번 = [{"symbol": f"S{회차}_{i}", "market_cap": i + 1} for i in range(50)]
            누적 = R._표에_쌓기(이번)
            cache.set(R.US_ROWS_CK, 누적, 300)
        assert len(누적) == 250, f"쌓이지 않는다: {len(누적)}줄"

    def test_심볼이_없는_줄은_안_담는다(self):
        쌓은것 = R._표에_쌓기([{"price": 1.0}, {"symbol": "", "price": 2.0},
                              {"symbol": "정상", "price": 3.0}])
        assert [r["symbol"] for r in 쌓은것] == ["정상"]


class Test시가총액이_없는_종목:
    def test_시가총액이_0인_것은_시가총액_순위에_안_넣는다(self):
        """ETF·리츠·신규 상장은 시가총액이 안 오는 일이 흔하다. 0 으로
        두면 목록 맨 아래에 '시가총액 0원' 짜리가 줄줄이 붙는다 —
        모르는 값을 숫자로 보여 주는 셈이다."""
        rows = [{"symbol": "있음", "price": 1.0, "market_cap": 1000},
                {"symbol": "없음", "price": 1.0, "market_cap": 0},
                {"symbol": "빈값", "price": 1.0, "market_cap": None}]
        순위 = R._sort_us(list(rows), "시가총액")
        assert [r["symbol"] for r in 순위] == ["있음"]

    def test_다른_순위에서는_안_뺀다(self):
        """시가총액을 모른다고 상승률 순위에서까지 빠질 이유는 없다."""
        rows = [{"symbol": "있음", "price": 1.0, "market_cap": 1000, "change_rate": 1.0},
                {"symbol": "없음", "price": 1.0, "market_cap": 0, "change_rate": 9.0}]
        순위 = R._sort_us(list(rows), "상승률")
        assert [r["symbol"] for r in 순위][0] == "없음"


class Test훑기가_표를_쌓는가:
    """_표에_쌓기 를 만들어 놓고 refresh_us_rows 가 안 쓰면 아무 소용이 없다.
    사용자가 본 증상(순위가 마지막 회차 안에서만 매겨짐)이 그대로 돌아온다."""

    @pytest.fixture(autouse=True)
    def _여유는_있다고_본다(self, monkeypatch):
        monkeypatch.setattr(R.memory, "has_headroom", lambda *a, **kw: True)
        R._us_cursor = 0

    def test_시세가_밀려나도_먼저_받은_종목이_표에_남는다(self, monkeypatch):
        """실제로 겪은 그대로를 흉내 낸다.

        지난 값 보관함이 400칸인데(STALE_MAX_ITEMS) 종목이 6,884개다.
        한 바퀴에 300개씩 훑으면, 둘째 바퀴를 도는 사이에 첫 바퀴 시세가
        보관함에서 밀려난다. 그 상태에서 표를 처음부터 다시 만들면 첫
        바퀴에 받은 대형주가 통째로 빠진다 — 사용자가 본 것이 이것이다.

        아래에서 첫 바퀴 뒤에 price:{sym} 를 지우는 것이 그 '밀려남'
        이다. 쌓아 두지 않으면 여기서 첫 바퀴가 사라진다."""
        from app.services.scheduler import POPULAR_US
        심볼 = list(dict.fromkeys(POPULAR_US + R.SP500_SYMBOLS))
        앞, 뒤 = 심볼[:150], 심볼[150:300]
        답할것 = {"현재": set(앞)}

        async def _받기(묶음):
            return {s: {"price": 100.0, "change": 1, "change_rate": 1,
                        "volume": 10, "market_cap": 1000, "name": s}
                    for s in 묶음 if s in 답할것["현재"]}

        import app.services.price_fetcher as PF
        monkeypatch.setattr(PF, "fetch_yf_quotes", _받기)
        monkeypatch.setattr(R, "US_MIN_ROWS", 10)

        R._us_cursor = 0
        asyncio.run(R.refresh_us_rows(sweep=len(심볼)))
        첫바퀴 = {r["symbol"] for r in (cache.get(R.US_ROWS_CK) or [])}
        assert 첫바퀴 & set(앞), "첫 바퀴에 아무것도 못 담았다"

        for s in 앞:                       # 보관함에서 밀려난 상황
            cache.delete(f"price:{s}")

        답할것["현재"] = set(뒤)
        R._us_cursor = 0
        asyncio.run(R.refresh_us_rows(sweep=len(심볼)))
        둘째바퀴 = {r["symbol"] for r in (cache.get(R.US_ROWS_CK) or [])}

        assert 둘째바퀴 & set(뒤), "둘째 바퀴 것이 안 담겼다"
        놓친것 = 첫바퀴 - 둘째바퀴
        assert not 놓친것, (
            f"첫 바퀴에 받은 {len(놓친것)}개가 사라졌다 — 쌓지 않고 새로 만들었다")
        assert len(둘째바퀴) > len(첫바퀴), "표가 안 두꺼워졌다"


class Test순위를_열_때도_표를_쌓는가:
    """엔비디아가 시가총액 순위에서 사라지던 주범.

    훑는 쪽(refresh_us_rows)은 표를 쌓게 고쳤는데, 사용자가 순위를 열 때
    도는 _build_us_rows 는 그대로 새로 만들고 있었다. 15분 뒤 표가
    만료되면 그때 살아남은 시세 몇백 개로 6,882줄짜리 표를 덮어썼고,
    한참 전 회차에 훑은 엔비디아는 거기 없었다."""

    def test_표가_만료돼도_지난_표_위에_쌓는다(self):
        큰표 = [{"symbol": f"OLD{i}", "price": 1.0, "market_cap": 1000 + i}
                for i in range(300)]
        큰표.append({"symbol": "NVDA", "price": 100.0, "market_cap": 4_400_000_000_000})
        cache.set(R.US_ROWS_CK, 큰표, 1)
        import time
        time.sleep(1.1)                         # 15분이 지난 셈

        _가짜시세(60)                            # 마지막 회차 것만 살아 있다
        표 = R._build_us_rows()

        assert any(r["symbol"] == "NVDA" for r in 표), \
            "지난 표를 버리고 새로 만들었다 — 시가총액 1위가 사라진다"
        assert len(표) > len(큰표), "이번 회차 것이 안 담겼다"

    def test_상세를_열어_시가총액이_0으로_덮여도_1위를_지킨다(self):
        """사용자가 엔비디아 상세 화면을 열면 그 응답으로 price:NVDA 가
        덮인다. 거기엔 시가총액이 없을 수 있고, 그러면 시가총액 순위에서
        통째로 빠진다 — 인기 종목일수록 상세를 자주 여니 하필 제일 큰
        회사부터 사라진다."""
        cache.set(R.US_ROWS_CK, [
            {"symbol": "NVDA", "name": "NVIDIA", "price": 100.0,
             "market_cap": 4_400_000_000_000},
            {"symbol": "AAPL", "name": "Apple", "price": 100.0,
             "market_cap": 3_900_000_000_000},
        ], 1)
        import time
        time.sleep(1.1)
        # 상세 화면이 남긴 값 — 가격은 있는데 시가총액이 없다
        cache.set("price:NVDA", {"symbol": "NVDA", "name": "NVDA",
                                 "price": 101.0, "change": 1, "change_rate": 1,
                                 "volume": 10, "market_cap": 0}, 300)
        순위 = R._sort_us(R._build_us_rows(), "시가총액")
        assert 순위[0]["symbol"] == "NVDA", \
            f"시가총액 1위가 사라졌다: {[r['symbol'] for r in 순위[:3]]}"
        assert 순위[0]["price"] == 101.0, "새 가격은 반영돼야 한다"

    def test_얇은_표는_담아_두지_않는다(self):
        """예전에도 있던 규칙이다. 쌓기로 바꾸면서 잃지 않았는지 본다."""
        cache.delete(R.US_ROWS_CK)
        _가짜시세(5)
        R._build_us_rows()
        assert cache.get(R.US_ROWS_CK) is None


class Test아는_시가총액을_지키는가:
    """두 번째 원인. price:{sym} 를 쓰는 곳이 열 곳이 넘는데 그중 몇은
    시가총액을 안 담는다 — 배치가 안 되는 종목의 단건 폴백은 0 으로 박고,
    종목 상세 화면을 열면 그 응답으로 덮어쓴다. 한 번 0 으로 덮이면
    시가총액 순위에서 통째로 빠진다. 인기 종목일수록 상세를 자주 여니
    하필 제일 큰 회사부터 사라진다."""

    def test_새_값이_0이면_알던_시가총액을_남긴다(self):
        옛것 = {"symbol": "NVDA", "price": 100.0, "market_cap": 4_400_000_000_000}
        새것 = {"symbol": "NVDA", "price": 101.0, "market_cap": 0}
        결과 = R._아는값_지키기(옛것, 새것)
        assert 결과["price"] == 101.0, "새 가격은 새 값이 이겨야 한다"
        assert 결과["market_cap"] == 4_400_000_000_000

    def test_새_값이_있으면_새_값이_이긴다(self):
        """시가총액은 실제로 변한다. 안 변하는 값으로 굳히면 안 된다."""
        결과 = R._아는값_지키기(
            {"symbol": "NVDA", "market_cap": 100},
            {"symbol": "NVDA", "market_cap": 200})
        assert 결과["market_cap"] == 200

    def test_이름도_지킨다(self):
        """단건 폴백은 name 을 심볼로 채운다. 그러면 목록에 'NVDA' 만 뜬다."""
        결과 = R._아는값_지키기(
            {"symbol": "NVDA", "name": "NVIDIA Corporation", "market_cap": 1},
            {"symbol": "NVDA", "name": "", "market_cap": 2})
        assert 결과["name"] == "NVIDIA Corporation"

    def test_처음_보는_종목은_그대로_담는다(self):
        새것 = {"symbol": "NEW", "market_cap": 0}
        assert R._아는값_지키기(None, 새것) == 새것

    def test_쌓을_때_실제로_지켜진다(self):
        cache.set(R.US_ROWS_CK, [
            {"symbol": "NVDA", "name": "NVIDIA", "market_cap": 4_400_000_000_000},
        ], 300)
        쌓은것 = R._표에_쌓기([{"symbol": "NVDA", "name": "NVDA",
                                "price": 101.0, "market_cap": 0}])
        nvda = next(r for r in 쌓은것 if r["symbol"] == "NVDA")
        assert nvda["market_cap"] == 4_400_000_000_000
        assert nvda["name"] == "NVIDIA"
        assert nvda["price"] == 101.0
