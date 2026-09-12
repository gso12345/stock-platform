"""배당을 사람이 열기 전에 받아 둔다.

── 무엇이 문제였나 ─────────────────────────────────────────

배당 달력은 캐시가 비어 있으면 그 자리에서 종목마다 야후에 물어본다.
한 요청에 12종목까지 묶고 6개씩 겹쳐 받는데도 **첫 조회가 2.4초**다
(실측). 그리고 그건 첫 사람 한 명이 무는 값이 아니다 — 캐시가 24시간
이라 **날마다 처음 여는 사람**이 문다.

시세는 이미 미리 받고 있었다(refresh_held_symbols). 배당도 같게 맞췄다.
배당은 하루 단위로 바뀌는 값이라 미리 받아도 낡지 않는다.

── 이 검사가 지키는 것 ─────────────────────────────────────

미리 채우기는 **너무 열심히 해도 문제**다. 0.15 CPU · 512MB 서버에서
'미리 받아두면 빠르다' 는 최적화가 프로세스를 죽인 적이 있다.
그래서 빠르게 만드는 것만큼이나 **덜 하는 것**을 검사한다 —
이미 있는 것을 또 받지 않는가, 한 회차에 정해진 만큼만 하는가.
"""
import asyncio

import pytest

from app.core.cache import cache
from app.services import scheduler as S


class _줄:
    def __init__(self, symbol, market):
        self.symbol, self.market = symbol, market


def _DB흉내(monkeypatch, 보유, 관심=()):
    """SessionLocal 을 갈아 끼워 원하는 보유 목록을 준다"""
    class _질의:
        def __init__(self, 것들): self._것들 = 것들
        def all(self): return list(self._것들)

    class _세션:
        def query(self, *cols):
            from app.models.stock import PortfolioItem
            첫 = cols[0]
            이름 = getattr(getattr(첫, "class_", None), "__name__", "")
            if 이름 == "PortfolioItem":
                return _질의(보유)
            return _질의(관심)
        def close(self): pass

    monkeypatch.setattr("app.db.database.SessionLocal", lambda: _세션())


@pytest.fixture(autouse=True)
def _빈칸():
    for k in list(getattr(cache, "_store", {}) or {}):
        if k.startswith("div:"):
            cache._store.pop(k, None)
            cache._stale.pop(k, None)
    yield


class Test배당_미리채우기:
    def test_아직_없는_종목만_받아_온다(self, monkeypatch):
        """이미 받아 둔 것을 또 물어보면 그게 제일 큰 낭비다 —
        회차마다 같은 종목을 다시 받게 된다."""
        _DB흉내(monkeypatch, [("005930", "KR"), ("AAPL", "US")], [("MSFT", "US")])
        cache.set("div:KR:005930", {"symbol": "005930"}, 300)   # 이미 있다

        받은것 = []
        monkeypatch.setattr(S, "_spawn", lambda c, n: c.close())

        def _가짜한종목(sym, mkt, 받아도되나=True):
            받은것.append((sym, mkt))
            return {"symbol": sym}

        import app.services.dividend_service as DV
        monkeypatch.setattr(DV, "한종목", _가짜한종목)
        monkeypatch.setattr(DV.쉼, "쉬는가", lambda ck: False)
        monkeypatch.setattr("app.core.fetchcache.빈손인가", lambda ck: False)

        n = asyncio.run(S.배당_미리채우기())
        assert ("005930", "KR") not in 받은것, "이미 있는 것을 또 받았다"
        assert sorted(받은것) == [("AAPL", "US"), ("MSFT", "US")]
        assert n == 2

    def test_한_회차에_정해진_만큼만(self, monkeypatch):
        """전 사용자 보유 종목이 수백 개일 수 있다. 한 번에 다 돌면
        그 시간 내내 사람이 보낸 요청이 밀린다."""
        많이 = [(f"SYM{i}", "US") for i in range(100)]
        _DB흉내(monkeypatch, 많이)

        받은것 = []
        import app.services.dividend_service as DV
        monkeypatch.setattr(DV, "한종목",
                            lambda s, m, 받아도되나=True: 받은것.append((s, m)) or {"symbol": s})
        monkeypatch.setattr(DV.쉼, "쉬는가", lambda ck: False)
        monkeypatch.setattr("app.core.fetchcache.빈손인가", lambda ck: False)

        asyncio.run(S.배당_미리채우기())
        assert len(받은것) == S.배당_한회차, \
            f"{len(받은것)}개를 받았다 — 한 회차는 {S.배당_한회차}개여야 한다"

    def test_쉬는_종목은_건너뛴다(self, monkeypatch):
        """계속 실패하는 심볼 하나가 회차마다 칸을 다 먹으면
        나머지가 영영 안 채워진다."""
        _DB흉내(monkeypatch, [("BAD", "US"), ("GOOD", "US")])

        받은것 = []
        import app.services.dividend_service as DV
        monkeypatch.setattr(DV, "한종목",
                            lambda s, m, 받아도되나=True: 받은것.append((s, m)) or {"symbol": s})
        monkeypatch.setattr(DV.쉼, "쉬는가", lambda ck: ck.endswith(":BAD"))
        monkeypatch.setattr("app.core.fetchcache.빈손인가", lambda ck: False)

        asyncio.run(S.배당_미리채우기())
        assert 받은것 == [("GOOD", "US")]

    def test_배당을_안_주는_종목은_다시_안_묻는다(self, monkeypatch):
        """무배당 종목이 훨씬 많다(성장주가 대부분이다). 값 캐시에는
        아무것도 안 담기고 '빈손' 표시만 따로 남으므로, 그 표시를 안
        보면 회차마다 같은 종목을 다시 물어본다."""
        _DB흉내(monkeypatch, [("NODIV", "US"), ("PAYS", "US")])

        받은것 = []
        import app.services.dividend_service as DV
        monkeypatch.setattr(DV, "한종목",
                            lambda s, m, 받아도되나=True: 받은것.append((s, m)) or {"symbol": s})
        monkeypatch.setattr(DV.쉼, "쉬는가", lambda ck: False)
        monkeypatch.setattr("app.core.fetchcache.빈손인가", lambda ck: ck.endswith(":NODIV"))

        asyncio.run(S.배당_미리채우기())
        assert 받은것 == [("PAYS", "US")]

    def test_받을_것이_없으면_바깥을_한_번도_안_부른다(self, monkeypatch):
        """다 채워진 뒤에는 회차마다 DB 조회 한 번으로 끝나야 한다"""
        _DB흉내(monkeypatch, [("005930", "KR")])
        cache.set("div:KR:005930", {"symbol": "005930"}, 300)

        import app.services.dividend_service as DV
        def _못부름(*a, **k):
            raise AssertionError("받을 것이 없는데 바깥을 불렀다")
        monkeypatch.setattr(DV, "한종목", _못부름)

        assert asyncio.run(S.배당_미리채우기()) == 0

    def test_한_종목이_터져도_나머지는_받는다(self, monkeypatch):
        """배당 하나 때문에 미리 채우기가 통째로 멈추면,
        그 뒤 종목들은 영영 안 채워진다."""
        _DB흉내(monkeypatch, [("BOOM", "US"), ("OK", "US")])

        import app.services.dividend_service as DV
        def _한종목(s, m, 받아도되나=True):
            if s == "BOOM":
                raise RuntimeError("터짐")
            return {"symbol": s}
        monkeypatch.setattr(DV, "한종목", _한종목)
        monkeypatch.setattr(DV.쉼, "쉬는가", lambda ck: False)
        monkeypatch.setattr("app.core.fetchcache.빈손인가", lambda ck: False)

        assert asyncio.run(S.배당_미리채우기()) == 1


class Test주기갱신에_걸려_있다:
    """함수만 있고 아무도 안 부르면 아무 일도 안 일어난다.
    그런데 화면은 멀쩡하고 오류도 안 난다 — 그냥 예전만큼 느리다."""

    def test_주기_갱신이_배당_미리채우기를_부른다(self):
        import inspect
        소스 = inspect.getsource(S.periodic_refresh)
        assert "배당_미리채우기" in 소스, "주기 갱신에 안 걸려 있다"

    def test_메모리_여유를_보고_한다(self):
        """0.15 CPU · 512MB 서버에서 '미리 받아두면 빠르다' 는 최적화가
        프로세스를 죽인 적이 있다. 급하지 않은 일에 그 위험을 안 진다."""
        import inspect
        소스 = inspect.getsource(S.periodic_refresh)
        자리 = 소스.index("배당_미리채우기")
        앞 = 소스[max(0, 자리 - 300):자리]
        assert "has_headroom" in 앞, "메모리 여유를 안 보고 미리 받는다"
