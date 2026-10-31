"""가격 알림 종목의 시세를 누가 받아 주는가.

알림 확인(alert_checker.확인하기)은 캐시만 읽는다. 그런데 시세를 새로 받는 종목은
국내 인기 10종목·미국 S&P500·지금 누가 화면에 띄운 종목뿐이었다. 그래서 에코프로에
알림을 걸고 앱을 닫으면 값이 멈춰 알림이 영영 안 울렸다(사용자가 앱을 닫는 것이
알림을 거는 이유인데).

여기서 못 박는 것
  · 켜진 알림의 종목은 장이 열려 있으면 1분마다 새로 받는다
  · 누가 1분 안에 받은 종목, 장이 닫힌 시장은 받지 않는다(0.15 CPU 서버다)
  · 받은 값으로 실제로 알림이 울린다 — 처음부터 끝까지
"""
import asyncio
import ast
import inspect
import textwrap

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.cache import cache
from app.services import alert_checker as A
from app.services import scheduler as S


@pytest.fixture
def 캐시():
    """price:{…} 를 넣었다 치운다"""
    쓴것 = []

    def 넣기(sym, 값: dict, ttl=60):
        cache.set(f"price:{sym}", 값, ttl)
        쓴것.append(f"price:{sym}")

    yield 넣기, 쓴것
    for k in set(쓴것):
        cache.delete(k)


@pytest.fixture
def 장(monkeypatch):
    """국내·미국 장이 열렸는지 정한다"""
    def 정하기(국내: bool, 미국: bool):
        monkeypatch.setattr(S.market_hours, "kr_session", lambda *a: "regular" if 국내 else "closed")
        monkeypatch.setattr(S.market_hours, "us_session", lambda *a: "regular" if 미국 else "closed")
    return 정하기


@pytest.fixture
def 메모리DB(monkeypatch):
    """진짜 SQL 로 알림 표를 만든다 — 켜진 것만·겹치지 않게 를 대역으로는 못 본다"""
    import importlib
    import pkgutil
    import app.db.database as D
    import app.models as 모델들
    from app.db.database import Base
    for 칸 in pkgutil.iter_modules(모델들.__path__):     # 표를 모두 올린다(__init__ 은 비어 있다)
        importlib.import_module(f"app.models.{칸.name}")
    엔진 = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(엔진)
    세션 = sessionmaker(bind=엔진)
    monkeypatch.setattr(D, "SessionLocal", 세션)
    return 세션


def _알림_넣기(세션, *줄):
    from app.models.stock import PriceAlert
    db = 세션()
    for i, (sym, mkt, 방향, 목표, 켜짐) in enumerate(줄, start=1):
        db.add(PriceAlert(user_id=1, symbol=sym, market=mkt, name=sym, direction=방향,
                          target=목표, is_active=켜짐))
    db.commit()
    db.close()


# ── 무엇을 받는가 ──────────────────────────────────────────────
class Test받을종목:
    def test_국내는_6자리로_해외는_기호로_나눈다(self):
        국내, 해외 = S._알림_받을종목(
            [("005930", "KR"), ("086520.KQ", "KR"), ("000660.KS", "KR"), ("AAPL", "US")],
            True, True, lambda k: None)
        assert sorted(국내) == ["000660", "005930", "086520"]
        assert 해외 == ["AAPL"]

    def test_국내_상장_ETF_는_시장이_ETF_여도_국내로_받는다(self):
        """야후에 069500 을 물으면 없는 기호다 — 영영 못 받는다"""
        국내, 해외 = S._알림_받을종목([("069500", "ETF"), ("0091C0", "ETF"), ("SPY", "ETF")],
                                    True, True, lambda k: None)
        assert sorted(국내) == ["0091C0", "069500"]
        assert 해외 == ["SPY"]

    def test_소문자로_와도_같은_종목이다(self):
        assert S._알림_받을종목([("aapl", "US")], True, True, lambda k: None) == ([], ["AAPL"])

    def test_장이_닫힌_시장은_받지_않는다(self):
        쌍 = [("005930", "KR"), ("AAPL", "US")]
        assert S._알림_받을종목(쌍, False, True, lambda k: None) == ([], ["AAPL"])
        assert S._알림_받을종목(쌍, True, False, lambda k: None) == (["005930"], [])

    def test_1분_안에_누가_받은_종목은_건너뛴다(self):
        나이 = {"price:AAPL": 10.0, "price:MSFT": 70.0, "price:NVDA": 54.9}.get
        _, 해외 = S._알림_받을종목([("AAPL", "US"), ("MSFT", "US"), ("NVDA", "US"), ("TSLA", "US")],
                                 True, True, 나이)
        assert set(해외) == {"MSFT", "TSLA"}, "54.9초 된 값은 아직 쓸 만하다 — 다음 차례에 받는다"
        _, 해외 = S._알림_받을종목([("NVDA", "US")], True, True, {"price:NVDA": 55.0}.get)
        assert 해외 == ["NVDA"], "55초가 넘으면(우리가 60초마다 받으니) 다시 받는다"

    def test_국내는_꼬리_달린_열쇠_중_하나라도_새것이면_건너뛴다(self):
        """보는 종목 루프는 005930·005930.KS·005930.KQ 셋에 쓴다 — 어느 것이든 새것이면 같은 값이다"""
        나이 = {"price:005930.KS": 3.0, "price:005930": 400.0}.get
        assert S._알림_받을종목([("005930", "KR")], True, True, 나이) == ([], [])

    def test_오래_묵은_것부터_상한까지만(self, monkeypatch):
        monkeypatch.setattr(S, "알림시세_한번에", 2)
        나이 = {"price:A": 100.0, "price:B": 300.0, "price:C": None, "price:D": 200.0}.get
        _, 해외 = S._알림_받을종목([(s, "US") for s in "ABCD"], True, True, 나이)
        assert 해외 == ["C", "B"], "한 번도 안 받은 것(C) → 가장 오래된 것(B) 순"

    def test_빈_기호는_버린다(self):
        assert S._알림_받을종목([("", "KR"), (None, "US")], True, True, lambda k: None) == ([], [])


# ── 받아서 담는다 ──────────────────────────────────────────────
class Test받기:
    def test_두_장이_다_닫혔으면_DB_도_안_본다(self, 장, monkeypatch):
        장(False, False)
        monkeypatch.setattr(A, "켜진_알림종목", lambda: pytest.fail("장이 닫혔는데 DB 를 봤다"))
        assert asyncio.run(S.알림종목_시세_받기()) == (0, 0)

    def test_국내는_꼬리_셋에_해외는_기호에_담고_알던_칸을_지키지_않는다(self, 장, 캐시, monkeypatch):
        넣기, 쓴것 = 캐시
        장(True, True)
        넣기("086520.KQ", {"price": 90_000, "market_cap": 123, "symbol": "086520.KQ"}, ttl=1)
        넣기("TSLA", {"price": 200.0, "market_cap": 999, "name": "Tesla"}, ttl=1)
        쓴것 += ["price:086520", "price:086520.KS"]
        monkeypatch.setattr(A, "켜진_알림종목", lambda: [("086520", "KR"), ("TSLA", "US")])
        monkeypatch.setattr(S, "_알림_받을종목", lambda 쌍, 국, 미: (["086520"], ["TSLA"]))

        async def 네이버(codes):
            assert codes == ["086520"]
            return {"086520": {"price": 101_000, "symbol": "086520"}}

        async def 야후(syms):
            assert syms == ["TSLA"]
            return {"TSLA": {"price": 250.0, "market_cap": None}}, 0

        monkeypatch.setattr(S, "fetch_naver_prices_light", 네이버)
        monkeypatch.setattr(S, "fetch_yf_quotes_with_fallback", 야후)
        assert asyncio.run(S.알림종목_시세_받기()) == (2, 2)
        for k in ("086520", "086520.KS", "086520.KQ"):
            assert cache.get(f"price:{k}")["price"] == 101_000, f"{k} 에 안 담겼다"
        assert cache.get("price:086520.KQ")["market_cap"] == 123, "가격만 받았는데 시가총액이 지워졌다"
        테슬라 = cache.get("price:TSLA")
        assert 테슬라["price"] == 250.0
        assert 테슬라["market_cap"] == 999, "빈 칸(None)으로 알던 시가총액을 지웠다"

    def test_담은_값은_다음_차례까지_살아_있다(self, 장, 캐시, monkeypatch):
        """60초마다 받는데 수명이 그보다 짧으면 사이사이 캐시가 비어 '시세 없음' 으로 넘어간다"""
        _, 쓴것 = 캐시
        쓴것 += ["price:AAPL"]
        장(False, True)
        수명 = {}
        monkeypatch.setattr(S.cache, "set", lambda k, v, ttl=60: 수명.__setitem__(k, ttl))
        monkeypatch.setattr(A, "켜진_알림종목", lambda: [("AAPL", "US")])

        async def 야후(syms):
            return {"AAPL": {"price": 1.0}}, 0

        monkeypatch.setattr(S, "fetch_yf_quotes_with_fallback", 야후)
        asyncio.run(S.알림종목_시세_받기())
        assert 수명["price:AAPL"] >= 2 * S.알림시세_간격

    def test_가격이_없는_응답은_안_담고_세지_않는다(self, 장, 캐시, monkeypatch):
        장(False, True)
        monkeypatch.setattr(A, "켜진_알림종목", lambda: [("AAPL", "US")])

        async def 야후(syms):
            return {"AAPL": {"price": None}}, 0

        monkeypatch.setattr(S, "fetch_yf_quotes_with_fallback", 야후)
        assert asyncio.run(S.알림종목_시세_받기()) == (0, 1)
        assert cache.get("price:AAPL") is None
        from app.core import health
        줄 = next(s for s in health.snapshot() if s.get("name") == "가격 알림 시세")
        assert "1종목 모두 실패" in (줄.get("last_error") or ""), "하나도 못 받았는데 성공으로 남겼다"

    def test_받다_터지면_건강판에_남기고_예외는_안_낸다(self, 장, monkeypatch):
        from app.core import health
        장(True, False)
        monkeypatch.setattr(A, "켜진_알림종목", lambda: [("005930", "KR")])

        async def 터짐(codes):
            raise TimeoutError("네이버 느림")

        monkeypatch.setattr(S, "fetch_naver_prices_light", 터짐)
        monkeypatch.setattr(S, "_알림_받을종목", lambda 쌍, 국, 미: (["005930"], []))
        assert asyncio.run(S.알림종목_시세_받기()) == (0, 1)
        줄 = next(s for s in health.snapshot() if s.get("name") == "가격 알림 시세")
        assert "네이버 느림" in (줄.get("last_error") or "")


# ── 켜진 알림 종목 ─────────────────────────────────────────────
class Test켜진_알림종목:
    def test_켜진_것만_겹치지_않게(self, 메모리DB):
        _알림_넣기(메모리DB,
                   ("086520", "KR", "above", 100_000, True),
                   ("086520", "KR", "below", 80_000, True),     # 같은 종목 두 번
                   ("AAPL", "US", "above", 300, True),
                   ("TSLA", "US", "above", 500, False))         # 꺼진 알림
        assert sorted(A.켜진_알림종목()) == [("086520", "KR"), ("AAPL", "US")]

    def test_못_읽으면_빈_목록(self, monkeypatch):
        import app.db.database as D

        class 터지는DB:
            def query(self, *a, **k): raise RuntimeError("표가 없다")
            def close(self): pass

        monkeypatch.setattr(D, "SessionLocal", lambda: 터지는DB())
        assert A.켜진_알림종목() == []


# ── 처음부터 끝까지 ────────────────────────────────────────────
class Test알림이_정말_울린다:
    def test_아무도_안_보는_국내_종목도_값이_닿으면_울린다(self, 메모리DB, 장, 캐시, monkeypatch):
        """사용자가 말한 그대로 — 에코프로 10만원 알림을 걸고 앱을 닫았다.

        캐시에는 알림을 걸 때 본 9만원이 묵어 있다. 고치기 전에는 이 값이 영영 안 바뀌어
        안 울렸다."""
        from app.models.community import Notification
        넣기, 쓴것 = 캐시
        쓴것 += ["price:086520", "price:086520.KS", "price:086520.KQ"]
        장(True, False)
        _알림_넣기(메모리DB, ("086520", "KR", "above", 100_000, True))
        넣기("086520", {"price": 90_000, "symbol": "086520"}, ttl=1)
        monkeypatch.setattr(S.cache, "age", lambda k: 600.0)        # 10분 묵었다

        async def 네이버(codes):
            return {c: {"price": 101_500, "symbol": c} for c in codes}

        monkeypatch.setattr(S, "fetch_naver_prices_light", 네이버)
        assert A.확인하기() == 0, "받기 전에는 묵은 9만원이라 안 울린다"
        assert asyncio.run(S.알림종목_시세_받기()) == (1, 1)
        assert A.확인하기() == 1
        db = 메모리DB()
        알림 = db.query(Notification).filter(Notification.kind == "price_alert").one()
        assert 알림.symbol == "086520" and "101,500" in 알림.preview
        db.close()


# ── 루프 ──────────────────────────────────────────────────────
class Test루프:
    def test_받고_나서_확인한다_터져도_멈추지_않는다(self, monkeypatch):
        순서 = []
        쉰횟수 = []

        async def 받기():
            순서.append("받기")
            if len(순서) == 1:
                raise RuntimeError("첫 차례는 터진다")
            return 0, 0

        def 확인():
            순서.append("확인")
            return 0

        async def 쉬기(초):
            쉰횟수.append(초)
            if len(쉰횟수) >= 3:          # 처음 한 번 + 두 차례 돌고 멈춘다
                raise asyncio.CancelledError

        monkeypatch.setattr(S, "알림종목_시세_받기", 받기)
        monkeypatch.setattr(A, "확인하기", 확인)
        monkeypatch.setattr(S.asyncio, "sleep", 쉬기)
        with pytest.raises(asyncio.CancelledError):
            asyncio.run(S.가격알림_루프())
        assert 순서 == ["받기", "확인", "받기", "확인"], "받기가 터져도 확인은 해야 하고, 루프는 계속 돈다"
        assert 쉰횟수[0] == S.알림_확인_간격, "막 떴을 때는 한 간격 쉬고 시작한다"
        assert all(0 < s <= S.알림_확인_간격 for s in 쉰횟수[1:])

    def test_서버가_뜰_때_루프가_선다(self):
        코드 = inspect.getsource(S.start_background_tasks)
        assert "가격알림_루프()" in 코드

    def test_주기_갱신_루프에서는_빠졌다(self):
        """두 군데서 보면 같은 알림을 두 번 확인한다 — 한 번 울리면 꺼지니 해는 없지만 일이 두 배다"""
        트리 = ast.parse(textwrap.dedent(inspect.getsource(S.periodic_refresh)))
        이름들 = {n.id for n in ast.walk(트리) if isinstance(n, ast.Name)}
        assert "확인하기" not in 이름들

    def test_안_쓰던_보유종목_갱신은_지웠다(self):
        assert not hasattr(S, "refresh_held_symbols")
