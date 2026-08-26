"""자산 그래프 — 하루치 기록이 화면의 숫자와 같은가.

이 기능이 조용히 망가지는 방식은 둘이다.

  1) 그래프의 오늘 점과 화면 위의 '총 평가금액' 이 다른 말을 한다.
     합계는 지금까지 화면에서만 냈고, 서버가 제 방식대로 다시 계산하면
     환율을 한 번 더 곱하거나 덜 곱해서 어긋난다. 그러면 그래프가
     없는 것보다 나쁘다.

  2) 시세를 못 구한 날에 매입금액을 그대로 적는다. 숫자는 그럴듯한데
     '그날 자산이 원금과 같았다' 는 거짓말이 그래프에 영원히 남는다.

특히 (1) 의 환율은 예전에 실제로 사고가 났던 자리다 — 원화로 넣은
해외 종목의 평단가에 환율을 또 곱해 값이 수천 배가 됐었다.
"""
from datetime import datetime, timedelta

import pytest

from app.services import portfolio_snapshot as PS


class _항목:
    """PortfolioItem 한 줄"""
    def __init__(self, **kw):
        self.user_id = kw.get("user_id", 7)
        self.symbol = kw.get("symbol", "005930")
        self.market = kw.get("market", "KR")
        self.shares = kw.get("shares", 10)
        self.avg_price = kw.get("avg_price", 70_000)
        self.currency = kw.get("currency", None)
        self.input_exchange_rate = kw.get("input_exchange_rate", None)
        self.asset_class = kw.get("asset_class", None)


@pytest.fixture
def 시세():
    from app.core.cache import cache
    넣은것 = []

    def 넣기(symbol, price):
        cache.set(f"price:{symbol}", {"price": price}, 60)
        넣은것.append(f"price:{symbol}")
    yield 넣기
    for k in 넣은것:
        cache.delete(k)


# ── 화면과 같은 숫자 ─────────────────────────────────────────
class Test합계:
    def test_국내_종목은_환율을_안_곱한다(self, 시세):
        시세("005930", 80_000)
        합 = PS.합계내기([_항목(shares=10, avg_price=70_000)], 1400)
        assert 합["value"] == 800_000       # 80,000 × 10
        assert 합["cost"] == 700_000
        assert 합["filled"] == 1 and 합["priced"] == 1

    def test_달러로_산_해외_종목(self, 시세):
        시세("NVDA", 200.0)
        합 = PS.합계내기(
            [_항목(symbol="NVDA", market="US", currency="USD",
                   shares=2, avg_price=150.0, input_exchange_rate=1300)], 1400)
        assert 합["value"] == pytest.approx(200 * 1400 * 2)
        assert 합["cost"] == pytest.approx(150 * 1300 * 2)   # 살 때 환율로

    def test_원화로_넣은_해외_종목에_환율을_또_곱하지_않는다(self, 시세):
        """예전에 실제로 난 사고다.

        '엔비디아를 주당 21만원에 샀다' 로 넣으면 avg_price 가 이미
        원화다. 여기에 환율을 곱하면 매입금액이 2억 9천만원이 된다."""
        시세("NVDA", 200.0)
        합 = PS.합계내기(
            [_항목(symbol="NVDA", market="US", currency="KRW",
                   shares=2, avg_price=210_000)], 1400)
        assert 합["cost"] == pytest.approx(210_000 * 2)      # 42만원
        assert 합["cost"] < 1_000_000

    def test_시세를_못_구하면_매입금액_그대로(self):
        """현지가 자리에 평단가를 넣으면 원화로 넣은 해외 종목이
        환율만큼 부풀어 오른다. 손익 0 으로 두는 편이 옳다."""
        from app.core.cache import cache
        cache.delete("price:없는종목")
        합 = PS.합계내기(
            [_항목(symbol="없는종목", market="US", currency="KRW",
                   shares=2, avg_price=210_000)], 1400)
        assert 합["value"] == 합["cost"] == pytest.approx(420_000)
        assert 합["filled"] == 0 and 합["priced"] == 1

    def test_현금은_시세를_안_찾는다(self):
        """현금에 시세가 없는 것은 정상이다. '못 구했다' 로 세면
        현금만 가진 사람의 기록이 영영 안 남는다."""
        합 = PS.합계내기(
            [_항목(symbol="현금", asset_class="현금", shares=1, avg_price=3_000_000)], 1400)
        assert 합["value"] == 합["cost"] == 3_000_000
        assert 합["priced"] == 0            # 셈에서 뺀다

    def test_국내_종목_접미사가_달라도_시세를_찾는다(self, 시세):
        """캐시에 005930 으로 들어올 때도 005930.KS 로 들어올 때도 있다.
        어느 경로로 들어왔는지에 따라 다르다."""
        시세("005930.KS", 80_000)
        합 = PS.합계내기([_항목(symbol="005930", shares=1, avg_price=1)], 1400)
        assert 합["value"] == 80_000

        시세("373220", 400_000)
        합 = PS.합계내기([_항목(symbol="373220.KS", shares=1, avg_price=1)], 1400)
        assert 합["value"] == 400_000

    def test_여러_종목이_섞여도_합계가_맞는다(self, 시세):
        시세("005930", 80_000)
        시세("AAPL", 200.0)
        합 = PS.합계내기([
            _항목(symbol="005930", shares=10, avg_price=70_000),
            _항목(symbol="AAPL", market="US", currency="USD", shares=1, avg_price=180,
                  input_exchange_rate=1300),
            _항목(symbol="현금", asset_class="현금", shares=1, avg_price=500_000),
        ], 1400)
        assert 합["value"] == pytest.approx(800_000 + 200 * 1400 + 500_000)
        assert 합["cost"] == pytest.approx(700_000 + 180 * 1300 + 500_000)
        assert 합["filled"] == 2 and 합["priced"] == 2


# ── 하루 한 줄 ───────────────────────────────────────────────
class _질의:
    def __init__(self, rows, distinct_rows=None):
        self._rows, self._d = rows, distinct_rows
    def filter(self, *a, **k): return self
    def distinct(self): return _질의(self._d if self._d is not None else self._rows)
    def order_by(self, *a, **k): return self
    def limit(self, *a, **k): return self
    def all(self): return list(self._rows)
    def first(self): return self._rows[0] if self._rows else None


class _DB:
    def __init__(self, 사용자=(), 이미=(), 항목=(), 터짐=False):
        self.사용자, self.이미, self.항목 = list(사용자), list(이미), list(항목)
        self.added, self.commits, self.rollbacks, self.closes = [], 0, 0, 0
        self._터짐 = 터짐
    def query(self, 무엇, *a, **k):
        if self._터짐:
            raise RuntimeError("표가 없다")
        이름 = getattr(무엇, "key", "") or str(무엇)
        if "PortfolioItem.user_id" in str(무엇) or 이름 == "user_id":
            # distinct().all() 로 (uid,) 튜플이 온다
            return _질의([(u,) for u in self.사용자])
        return _질의(self.항목)
    def add(self, o): self.added.append(o)
    def commit(self): self.commits += 1
    def rollback(self): self.rollbacks += 1
    def close(self): self.closes += 1


class Test찍기:
    @pytest.fixture(autouse=True)
    def _환율넣기(self):
        from app.core.cache import cache
        cache.set("extra:usdkrw", {"value": 1400.0}, 60)
        yield
        cache.delete("extra:usdkrw")

    def _붙이기(self, monkeypatch, db):
        import app.db.database as D
        monkeypatch.setattr(D, "SessionLocal", lambda: db)

    def test_오늘_치가_없으면_한_줄_남긴다(self, monkeypatch, 시세):
        시세("005930", 80_000)
        from app.models.stock import PortfolioItem, PortfolioSnapshot

        항목 = [_항목(user_id=7, shares=10, avg_price=70_000)]

        class DB(_DB):
            def query(self, 무엇, *a, **k):
                if 무엇 is PortfolioItem.user_id:
                    return _질의([(7,)])
                if 무엇 is PortfolioSnapshot.user_id:
                    return _질의([])            # 오늘 치 없음
                return _질의(항목)
        db = DB(); self._붙이기(monkeypatch, db)

        assert PS.찍기() == 1
        assert db.commits == 1 and len(db.added) == 1
        s = db.added[0]
        assert s.user_id == 7 and s.day == PS.오늘()
        assert s.total_value == 800_000 and s.total_cost == 700_000

    def test_오늘_이미_적었으면_다시_안_적는다(self, monkeypatch, 시세):
        시세("005930", 80_000)
        from app.models.stock import PortfolioItem, PortfolioSnapshot

        class DB(_DB):
            def query(self, 무엇, *a, **k):
                if 무엇 is PortfolioItem.user_id:
                    return _질의([(7,)])
                if 무엇 is PortfolioSnapshot.user_id:
                    return _질의([(7,)])        # 이미 적힘
                return _질의([])
        db = DB(); self._붙이기(monkeypatch, db)

        assert PS.찍기() == 0
        assert db.added == [] and db.commits == 0

    def test_시세를_하나도_못_구한_날은_안_적는다(self, monkeypatch):
        """매입금액을 그대로 적으면 '그날 원금과 같았다' 는 거짓말이
        그래프에 영원히 남는다. 빈 날은 비워 두는 편이 낫다."""
        from app.core.cache import cache
        from app.models.stock import PortfolioItem, PortfolioSnapshot
        cache.delete("price:없는종목")
        항목 = [_항목(user_id=7, symbol="없는종목", shares=10, avg_price=70_000)]

        class DB(_DB):
            def query(self, 무엇, *a, **k):
                if 무엇 is PortfolioItem.user_id:
                    return _질의([(7,)])
                if 무엇 is PortfolioSnapshot.user_id:
                    return _질의([])
                return _질의(항목)
        db = DB(); self._붙이기(monkeypatch, db)

        assert PS.찍기() == 0
        assert db.added == []

    def test_현금만_가진_사람도_적힌다(self, monkeypatch):
        """현금에는 시세가 원래 없다. '못 구했다' 로 세면 이 사람의
        기록이 영영 안 남는다."""
        from app.models.stock import PortfolioItem, PortfolioSnapshot
        항목 = [_항목(user_id=7, symbol="현금", asset_class="현금",
                      shares=1, avg_price=3_000_000)]

        class DB(_DB):
            def query(self, 무엇, *a, **k):
                if 무엇 is PortfolioItem.user_id:
                    return _질의([(7,)])
                if 무엇 is PortfolioSnapshot.user_id:
                    return _질의([])
                return _질의(항목)
        db = DB(); self._붙이기(monkeypatch, db)

        assert PS.찍기() == 1
        assert db.added[0].total_value == 3_000_000

    def test_환율이_없으면_아무것도_안_적는다(self, monkeypatch, 시세):
        """환율이 0 이면 해외 종목이 통째로 0 이 된다. 그런 값을
        남기면 그래프에 '그날 반토막' 이 찍힌다.

        적을 것이 분명히 있는 상황을 만들어 놓고 본다 — 사람이 없어서
        0 이 나오면 이 검사는 아무것도 안 지킨다."""
        from app.core.cache import cache
        from app.models.stock import PortfolioItem, PortfolioSnapshot
        시세("005930", 80_000)
        cache.delete("extra:usdkrw")
        항목 = [_항목(user_id=7, shares=10, avg_price=70_000)]

        class DB(_DB):
            def query(self, 무엇, *a, **k):
                if 무엇 is PortfolioItem.user_id:
                    return _질의([(7,)])
                if 무엇 is PortfolioSnapshot.user_id:
                    return _질의([])
                return _질의(항목)
        db = DB(); self._붙이기(monkeypatch, db)
        assert PS.찍기() == 0
        assert db.added == []

    def test_어디서_터져도_예외를_안_내보낸다(self, monkeypatch):
        """15분마다 주기 갱신 안에서 불린다. 여기서 터지면 시세·뉴스·
        순위 갱신이 통째로 멈춘다."""
        db = _DB(터짐=True); self._붙이기(monkeypatch, db)
        assert PS.찍기() == 0
        assert db.rollbacks == 1 and db.closes == 1

    def test_한_회차에_보는_사람_수에_상한이_있다(self):
        assert 0 < PS.한회차_최대 <= 2000

    def test_날짜는_한국_날짜다(self):
        """UTC 로 적으면 밤 9시 이후 값이 '내일' 로 들어간다."""
        assert PS.KST.utcoffset(None) == timedelta(hours=9)
        assert PS.오늘() == datetime.now(PS.KST).strftime("%Y-%m-%d")


class Test배관:
    def test_주기_갱신이_자산을_기록한다(self):
        import inspect
        from app.services import scheduler as S
        본문 = inspect.getsource(S)
        assert "portfolio_snapshot" in 본문 and "찍기" in 본문

    def test_기록은_캐시만_읽는다(self):
        """그래프 때문에 시세를 새로 받으면 0.15 CPU 서버가 그것만
        하다 끝난다."""
        import inspect
        본문 = inspect.getsource(PS)
        assert "cache.get" in 본문
        for 금지 in ("requests.", "httpx.", "yf.", "urlopen"):
            assert 금지 not in 본문, f"기록이 {금지} 로 새로 받아 온다"

    def test_자산흐름_경로가_있다(self):
        import inspect
        from app.api.routes import portfolio as P
        본문 = inspect.getsource(P)
        assert '@router.get("/history")' in 본문
        # 없는 날을 서버가 지어내면 안 된다
        assert "PortfolioSnapshot" in 본문
