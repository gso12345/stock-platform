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
