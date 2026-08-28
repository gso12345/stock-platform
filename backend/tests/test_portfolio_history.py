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
        #: 실제 모델에 있는 칸. 자산 흐름을 포트폴리오별로 남기면서
        #  쓰기 시작했다 — 대역에 없으면 그 경로가 검사를 못 지난다
        self.portfolio_id = kw.get("portfolio_id", 1)


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


class _줄:
    """이미 적혀 있는 portfolio_snapshots 한 줄"""
    def __init__(self, user_id=7, portfolio_id=0, filled=0, priced=1,
                 total_value=0.0, total_cost=0.0):
        self.user_id, self.portfolio_id = user_id, portfolio_id
        self.filled, self.priced = filled, priced
        self.total_value, self.total_cost = total_value, total_cost
        self.day = PS.오늘()


def _찍기DB(항목, 사용자=(7,), 끝난=(), 오늘줄=()):
    """찍기() 가 던지는 세 가지 질의를 갈라 준다.

      · PortfolioItem.user_id      → 보유 종목이 있는 사람
      · PortfolioSnapshot.user_id  → 오늘 것이 **다 채워진** 사람
      · PortfolioSnapshot(모델)     → 오늘 이미 적힌 줄(덜 채워진 것 포함)

    앞의 둘만 갈라 놓고 셋째를 '나머지' 로 흘려보내면, 보유 목록이
    스냅샷 줄인 척하고 돌아와 '이미 적혀 있다' 로 읽힌다.
    """
    from app.models.stock import PortfolioItem, PortfolioSnapshot

    class DB(_DB):
        def query(self, 무엇, *a, **k):
            if 무엇 is PortfolioItem.user_id:
                return _질의([(u,) for u in 사용자])
            if 무엇 is PortfolioSnapshot.user_id:
                return _질의([(u,) for u in 끝난])
            if 무엇 is PortfolioSnapshot:
                return _질의(list(오늘줄))
            return _질의(항목)
    return DB()


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
        db = _찍기DB(항목)                       # 오늘 치 없음
        self._붙이기(monkeypatch, db)

        assert PS.찍기() == 1
        assert db.commits == 1
        """줄이 둘이다 — 전체(0) 와 포트폴리오(1).

        예전에는 사람마다 하루 한 줄이었다. 그래서 '연금 계좌만 어떻게
        움직였나' 를 물어볼 수가 없었다 — 포트폴리오를 나눠 쓰는 사람에게는
        그게 자산 흐름을 보는 이유의 절반이다."""
        assert len(db.added) == 2
        전체 = next(x for x in db.added if x.portfolio_id == 0)
        assert 전체.user_id == 7 and 전체.day == PS.오늘()
        assert 전체.total_value == 800_000 and 전체.total_cost == 700_000
        # 종목이 하나뿐이라 포트폴리오 줄도 같은 값이다
        하나 = next(x for x in db.added if x.portfolio_id == 1)
        assert 하나.total_value == 800_000 and 하나.total_cost == 700_000

    def test_오늘_이미_적었으면_다시_안_적는다(self, monkeypatch, 시세):
        시세("005930", 80_000)
        from app.models.stock import PortfolioItem, PortfolioSnapshot

        db = _찍기DB([], 끝난=(7,))              # 오늘 것이 이미 온전하다
        self._붙이기(monkeypatch, db)

        assert PS.찍기() == 0
        assert db.added == [] and db.commits == 0

    def test_반쪽만_적힌_날은_시세가_더_들어오면_고쳐_쓴다(self, monkeypatch, 시세):
        """실제로 재 보고 찾은 버그다.

        합계내기() 는 시세를 못 구한 종목을 **매입금액으로** 세운다.
        예전에는 오늘 줄이 하나라도 있으면 그 사람은 끝난 것으로 봐서,
        시세가 덜 들어온 이른 회차에 한 번 적히면 반쪽짜리 값이 그날
        내내 얼어붙었다.

        두 종목 중 하나만 시세가 있으면 280만원짜리 날이 230만원으로
        찍힌다 — 17.9% 아래다. 그래프에는 하루만 뚝 떨어졌다 이튿날
        되돌아오는 톱니로 남는다. 자산은 그렇게 움직인 적이 없는데도.
        """
        시세("005930", 80_000)
        시세("000660", 200_000)
        항목 = [_항목(user_id=7, symbol="005930", shares=10, avg_price=70_000),
                _항목(user_id=7, symbol="000660", shares=10, avg_price=150_000)]
        반쪽 = _줄(portfolio_id=0, filled=1, priced=2, total_value=2_300_000)
        반쪽포트 = _줄(portfolio_id=1, filled=1, priced=2, total_value=2_300_000)
        db = _찍기DB(항목, 오늘줄=(반쪽, 반쪽포트))
        self._붙이기(monkeypatch, db)

        assert PS.찍기() == 1
        assert db.added == []                    # 새 줄이 아니라 있던 줄을 고친다
        assert 반쪽.total_value == 2_800_000     # 반쪽 230만 → 온전한 280만
        assert 반쪽.filled == 2 and 반쪽.priced == 2
        assert 반쪽포트.total_value == 2_800_000

    def test_온전하던_줄을_반쪽으로_되돌리지_않는다(self, monkeypatch, 시세):
        """장중에 캐시가 잠깐 비는 일이 있다. 그때 무조건 덮어쓰면
        이미 온전하던 값이 반쪽으로 내려앉는다 — 고치려던 톱니를
        반대 방향으로 다시 만드는 셈이다."""
        시세("005930", 80_000)                   # 000660 은 일부러 안 넣는다
        항목 = [_항목(user_id=7, symbol="005930", shares=10, avg_price=70_000),
                _항목(user_id=7, symbol="000660", shares=10, avg_price=150_000)]
        온전한것 = _줄(portfolio_id=0, filled=2, priced=2, total_value=2_800_000)
        db = _찍기DB(항목, 오늘줄=(온전한것,))
        self._붙이기(monkeypatch, db)

        PS.찍기()
        assert 온전한것.total_value == 2_800_000
        assert 온전한것.filled == 2

    def test_반쪽이어도_같은_회차에_또_적지_않는다(self, monkeypatch, 시세):
        """더 채워진 것이 없으면 아무 일도 안 한다. 15분마다 도는
        일이라, 채울 것이 없는데 매번 쓰기가 나가면 안 된다."""
        시세("005930", 80_000)
        항목 = [_항목(user_id=7, symbol="005930", shares=10, avg_price=70_000),
                _항목(user_id=7, symbol="000660", shares=10, avg_price=150_000)]
        그대로 = _줄(portfolio_id=0, filled=1, priced=2, total_value=2_300_000)
        그대로포트 = _줄(portfolio_id=1, filled=1, priced=2, total_value=2_300_000)
        db = _찍기DB(항목, 오늘줄=(그대로, 그대로포트))
        self._붙이기(monkeypatch, db)

        assert PS.찍기() == 0
        assert db.added == [] and db.commits == 0

    def test_시세를_하나도_못_구한_날은_안_적는다(self, monkeypatch):
        """매입금액을 그대로 적으면 '그날 원금과 같았다' 는 거짓말이
        그래프에 영원히 남는다. 빈 날은 비워 두는 편이 낫다."""
        from app.core.cache import cache
        from app.models.stock import PortfolioItem, PortfolioSnapshot
        cache.delete("price:없는종목")
        항목 = [_항목(user_id=7, symbol="없는종목", shares=10, avg_price=70_000)]

        db = _찍기DB(항목); self._붙이기(monkeypatch, db)

        assert PS.찍기() == 0
        assert db.added == []

    def test_현금만_가진_사람도_적힌다(self, monkeypatch):
        """현금에는 시세가 원래 없다. '못 구했다' 로 세면 이 사람의
        기록이 영영 안 남는다."""
        from app.models.stock import PortfolioItem, PortfolioSnapshot
        항목 = [_항목(user_id=7, symbol="현금", asset_class="현금",
                      shares=1, avg_price=3_000_000)]

        db = _찍기DB(항목); self._붙이기(monkeypatch, db)

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

        db = _찍기DB(항목); self._붙이기(monkeypatch, db)
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

    def test_전체_기간을_받아_준다(self):
        """화면에 '전체' 칩이 생겼다.

        상한이 365 였다. 366 이상은 라우트 본문에 닿기도 전에 Pydantic
        검증에서 422 로 거절돼서, 사용자에게는 '눌렀는데 아무 일도 안
        일어남' 으로 보인다 — 오류 메시지조차 안 뜬다.

        화면은 3650(10년)을 보낸다. 그 값이 실제로 통과해야 한다.
        무한은 아니다 — 상한이 아예 없으면 days=99999999 로 스캔을
        시킬 수 있다.
        """
        from fastapi.routing import APIRoute
        from app.api.routes.portfolio import router

        길 = next(r for r in router.routes
                  if isinstance(r, APIRoute) and r.path.endswith("/history"))
        칸 = next(p for p in 길.dependant.query_params if p.name == "days")
        메타 = 칸.field_info.metadata          # [Ge(7), Le(3650)]
        아래 = next(m.ge for m in 메타 if hasattr(m, "ge"))
        위   = next((m.le for m in 메타 if hasattr(m, "le")), None)
        assert 위 is not None, "상한이 아예 없으면 큰 값으로 스캔을 시킬 수 있다"
        assert 위 >= 3650, f"화면이 보내는 3650 이 422 로 거절된다(지금 상한 {위})"
        assert 아래 == 7, "'올해' 를 1월 초에 누르면 7 밑으로 내려간다"


# ── 진짜 DB 로 거는 검사 ──────────────────────────────────────
#
# 위쪽 검사는 세션을 대역으로 바꿔치기한다. 대역은 filter() 를 그냥
# 자기 자신으로 되돌리므로, **어떤 조건으로 걸렀는지**는 아무것도
# 지키지 못한다. 조건이 통째로 빠져도 대역은 똑같이 답한다.
#
# 이 아래 두 가지가 딱 그런 자리다.
#
#   · 오늘 것이 '있으면 끝' 이 아니라 '다 채워졌으면 끝' 이어야 한다
#   · 히스토리는 고른 칸의 줄만 꺼내야 한다
#
# 그래서 여기서는 SQLite 를 진짜로 만들어 건다.
class Test진짜DB:
    @pytest.fixture
    def 임시DB(self, tmp_path):
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        from app.db.database import Base
        from app.models.stock import Portfolio, PortfolioItem, PortfolioSnapshot

        엔진 = create_engine(f"sqlite:///{tmp_path}/t.db")
        Base.metadata.create_all(엔진, tables=[
            Portfolio.__table__, PortfolioItem.__table__, PortfolioSnapshot.__table__])
        db = sessionmaker(bind=엔진)()
        yield db
        db.close()

    @pytest.fixture(autouse=True)
    def _환율넣기(self):
        from app.core.cache import cache
        cache.set("extra:usdkrw", {"value": 1400.0}, 60)
        yield
        cache.delete("extra:usdkrw")

    def test_반쪽짜리_줄이_있어도_다시_본다(self, monkeypatch, 임시DB, 시세):
        """'오늘 줄이 있으면 끝' 이면 반쪽 값이 그날 내내 얼어붙는다.

        조건이 filled >= priced 여야 한다. 대역으로는 이 조건이 통째로
        빠져도 안 걸린다 — 진짜 DB 로 건다."""
        from app.models.stock import Portfolio, PortfolioItem, PortfolioSnapshot
        import app.db.database as D
        시세("005930", 80_000)
        시세("000660", 200_000)

        임시DB.add(Portfolio(id=1, user_id=7, name="주력"))
        임시DB.add(PortfolioItem(user_id=7, portfolio_id=1, symbol="005930",
                                 market="KR", shares=10, avg_price=70_000))
        임시DB.add(PortfolioItem(user_id=7, portfolio_id=1, symbol="000660",
                                 market="KR", shares=10, avg_price=150_000))
        # 이른 회차에 반쪽만 적힌 상태 — 000660 시세가 아직 없던 때
        임시DB.add(PortfolioSnapshot(user_id=7, portfolio_id=0, day=PS.오늘(),
                                     total_value=2_300_000, total_cost=2_200_000,
                                     filled=1, priced=2))
        임시DB.add(PortfolioSnapshot(user_id=7, portfolio_id=1, day=PS.오늘(),
                                     total_value=2_300_000, total_cost=2_200_000,
                                     filled=1, priced=2))
        임시DB.commit()
        monkeypatch.setattr(D, "SessionLocal", lambda: 임시DB)
        monkeypatch.setattr(임시DB, "close", lambda: None)   # 뒤에서 더 읽는다

        assert PS.찍기() == 1
        줄 = (임시DB.query(PortfolioSnapshot)
              .filter(PortfolioSnapshot.portfolio_id == 0).one())
        assert 줄.total_value == 2_800_000     # 반쪽 230만 → 온전한 280만
        assert 줄.filled == 2
        # 하루 한 줄은 그대로다. 고쳐 쓴 것이지 새로 만든 것이 아니다
        assert 임시DB.query(PortfolioSnapshot).count() == 2

    def test_히스토리는_고른_칸의_줄만_꺼낸다(self, 임시DB):
        """전체 줄과 포트폴리오 줄이 같은 날에 나란히 있다.

        칸을 안 거르면 같은 날이 두 줄로 나와서 그래프가 톱니처럼
        튄다 — 하루에 자산이 두 번 있는 셈이다."""
        from app.api.routes.portfolio import 자산흐름
        from app.models.stock import Portfolio, PortfolioSnapshot

        임시DB.add(Portfolio(id=1, user_id=7, name="주력"))
        for 날, 전체, 하나 in (("2026-08-20", 5_000_000, 3_000_000),
                                ("2026-08-21", 5_200_000, 3_100_000)):
            임시DB.add(PortfolioSnapshot(user_id=7, portfolio_id=0, day=날,
                                         total_value=전체, total_cost=4_000_000,
                                         filled=2, priced=2))
            임시DB.add(PortfolioSnapshot(user_id=7, portfolio_id=1, day=날,
                                         total_value=하나, total_cost=2_500_000,
                                         filled=1, priced=1))
        임시DB.commit()

        class _나:
            id = 7

        전부 = 자산흐름(days=3650, portfolio_id=None, db=임시DB, current_user=_나())
        하나만 = 자산흐름(days=3650, portfolio_id=1, db=임시DB, current_user=_나())

        # 날짜가 겹치면 안 된다 — 하루에 점 하나다
        assert [p["day"] for p in 전부["points"]] == ["2026-08-20", "2026-08-21"]
        assert [p["day"] for p in 하나만["points"]] == ["2026-08-20", "2026-08-21"]
        assert [p["value"] for p in 전부["points"]] == [5_000_000, 5_200_000]
        assert [p["value"] for p in 하나만["points"]] == [3_000_000, 3_100_000]
        assert 하나만["portfolio_id"] == 1

    def test_남의_포트폴리오는_못_본다(self, 임시DB):
        """id 만 바꿔 부르면 남의 자산 흐름이 나오면 안 된다."""
        from fastapi import HTTPException
        from app.api.routes.portfolio import 자산흐름
        from app.models.stock import Portfolio

        임시DB.add(Portfolio(id=1, user_id=99, name="남의것"))
        임시DB.commit()

        class _나:
            id = 7

        with pytest.raises(HTTPException) as e:
            자산흐름(days=90, portfolio_id=1, db=임시DB, current_user=_나())
        assert e.value.status_code == 404
