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

    def begin_nested(self):
        """SAVEPOINT 대역.

        찍기() 가 사람마다 따로 담는다(begin_nested). 옛 유니크 제약이
        안 지워진 DB 에서 포트폴리오 줄 하나가 걸려도 전체 줄은
        남기려는 것이다 — 안 그러면 그 회차가 통째로 뒤집혀서 자산
        흐름 그래프가 배포한 날에 멈춘다.

        여기서는 아무것도 안 되돌린다. 진짜 되돌림은 SQLite 를 띄운
        Test옛_제약이_남아_있어도 쪽에서 건다."""
        더미 = self

        class _자리:
            def commit(self): 더미.savepoints = getattr(더미, "savepoints", 0) + 1
            def rollback(self): 더미.savepoint_rollbacks = getattr(더미, "savepoint_rollbacks", 0) + 1
        return _자리()


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
        """값이 **정말로 같아야** 이 검사가 뜻을 갖는다.

        total_cost 를 안 채워 두었더니 매입금액이 달라져서 쓰기가
        나갔다 — 검사가 '안 쓴다' 를 지키는 게 아니라 대역이 덜
        채워진 것을 보고 있었던 셈이다."""
        그대로 = _줄(portfolio_id=0, filled=1, priced=2,
                     total_value=2_300_000, total_cost=2_200_000)
        그대로포트 = _줄(portfolio_id=1, filled=1, priced=2,
                         total_value=2_300_000, total_cost=2_200_000)
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


class Test옛_제약이_남아_있어도:
    """배포에서 조용히 실패할 수 있는 자리다.

    스냅샷을 '하루 한 줄' 에서 '포트폴리오마다 한 줄' 로 넓히면서 옛
    유니크 제약(user_id, day)을 지우는 SQL 을 넣었는데, 그게 실패해도
    아무 소리가 안 났다.

    그러면 포트폴리오 줄이 옛 제약에 걸려 IntegrityError 가 나고,
    사람 전부를 한 번에 commit 하던 탓에 **전체 줄까지 같이 날아갔다**.
    자산 흐름 그래프가 배포한 날에서 그냥 멈춰 선다 — 실제로 재현했다.

    전체 줄은 (user_id, day) 한 벌이라 옛 제약에서도 반드시 들어간다.
    포트폴리오별을 못 쌓더라도 전체는 이어지는 것이, 둘 다 잃는 것보다
    낫다.
    """

    @pytest.fixture
    def 옛제약DB(self, tmp_path):
        from sqlalchemy import create_engine, text
        from sqlalchemy.orm import sessionmaker
        from app.db.database import Base
        from app.models.user import User
        from app.models.stock import Portfolio, PortfolioItem

        엔진 = create_engine(f"sqlite:///{tmp_path}/옛.db")
        Base.metadata.create_all(엔진, tables=[
            User.__table__, Portfolio.__table__, PortfolioItem.__table__])
        with 엔진.connect() as c:
            # 넓히기 **전** 모양 그대로
            c.execute(text("""
                CREATE TABLE portfolio_snapshots (
                    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL,
                    portfolio_id INTEGER NOT NULL DEFAULT 0, day VARCHAR(10) NOT NULL,
                    total_value FLOAT, total_cost FLOAT,
                    filled INTEGER, priced INTEGER, made_at DATETIME,
                    CONSTRAINT uq_pf_snapshot_day UNIQUE (user_id, day))"""))
            c.commit()
        db = sessionmaker(bind=엔진)()
        yield db
        db.close()

    @pytest.fixture(autouse=True)
    def _환율넣기(self):
        from app.core.cache import cache
        cache.set("extra:usdkrw", {"value": 1400.0}, 60)
        yield
        cache.delete("extra:usdkrw")

    def test_전체_줄은_반드시_남는다(self, monkeypatch, 옛제약DB, 시세):
        from sqlalchemy import text
        from app.models.stock import Portfolio, PortfolioItem
        import app.db.database as D
        시세("005930", 80_000)
        시세("000660", 200_000)

        옛제약DB.add(Portfolio(id=1, user_id=7, name="주력"))
        옛제약DB.add(Portfolio(id=2, user_id=7, name="연금"))
        옛제약DB.add(PortfolioItem(user_id=7, portfolio_id=1, symbol="005930",
                                   market="KR", shares=100, avg_price=70_000, currency="KRW"))
        옛제약DB.add(PortfolioItem(user_id=7, portfolio_id=2, symbol="000660",
                                   market="KR", shares=50, avg_price=150_000, currency="KRW"))
        옛제약DB.commit()
        monkeypatch.setattr(D, "SessionLocal", lambda: 옛제약DB)
        monkeypatch.setattr(옛제약DB, "close", lambda: None)

        assert PS.찍기() == 1, "한 줄도 안 남겼다 — 그래프가 그날로 멈춘다"
        줄들 = 옛제약DB.execute(text(
            "SELECT portfolio_id, total_value FROM portfolio_snapshots")).fetchall()
        assert len(줄들) == 1, 줄들
        pid, 값 = 줄들[0]
        assert pid == 0, "남은 것이 전체 줄이 아니다"
        assert 값 == 100 * 80_000 + 50 * 200_000   # 1,800만

    def test_한_사람이_걸려도_다른_사람은_적힌다(self, monkeypatch, 옛제약DB, 시세):
        """예전에는 사람 전부를 한 번에 commit 했다. 한 사람이 걸리면
        그 회차 전체가 뒤집혔다."""
        from sqlalchemy import text
        from app.models.stock import Portfolio, PortfolioItem
        import app.db.database as D
        시세("005930", 80_000)

        # 7번은 포트폴리오 둘 — 옛 제약에 걸린다
        옛제약DB.add(Portfolio(id=1, user_id=7, name="주력"))
        옛제약DB.add(Portfolio(id=2, user_id=7, name="연금"))
        옛제약DB.add(PortfolioItem(user_id=7, portfolio_id=1, symbol="005930",
                                   market="KR", shares=100, avg_price=70_000, currency="KRW"))
        옛제약DB.add(PortfolioItem(user_id=7, portfolio_id=2, symbol="005930",
                                   market="KR", shares=10, avg_price=70_000, currency="KRW"))
        # 9번은 포트폴리오 하나 — 안 걸린다
        옛제약DB.add(Portfolio(id=3, user_id=9, name="하나"))
        옛제약DB.add(PortfolioItem(user_id=9, portfolio_id=3, symbol="005930",
                                   market="KR", shares=5, avg_price=70_000, currency="KRW"))
        옛제약DB.commit()
        monkeypatch.setattr(D, "SessionLocal", lambda: 옛제약DB)
        monkeypatch.setattr(옛제약DB, "close", lambda: None)

        assert PS.찍기() == 2
        사람들 = {u for (u,) in 옛제약DB.execute(text(
            "SELECT DISTINCT user_id FROM portfolio_snapshots")).fetchall()}
        assert 사람들 == {7, 9}, 사람들

    def test_제약이_멀쩡하면_포트폴리오_줄도_다_남는다(self, monkeypatch, 임시DB2, 시세):
        """되돌아가는 길도 막아 둔다 — 전체 줄만 남기는 것이 기본이
        되면 포트폴리오별 그래프가 영영 안 쌓인다."""
        from app.models.stock import Portfolio, PortfolioItem, PortfolioSnapshot
        import app.db.database as D
        시세("005930", 80_000)
        임시DB2.add(Portfolio(id=1, user_id=7, name="주력"))
        임시DB2.add(PortfolioItem(user_id=7, portfolio_id=1, symbol="005930",
                                  market="KR", shares=100, avg_price=70_000, currency="KRW"))
        임시DB2.commit()
        monkeypatch.setattr(D, "SessionLocal", lambda: 임시DB2)
        monkeypatch.setattr(임시DB2, "close", lambda: None)

        assert PS.찍기() == 1
        칸들 = {r.portfolio_id for r in 임시DB2.query(PortfolioSnapshot).all()}
        assert 칸들 == {0, 1}, 칸들

    @pytest.fixture
    def 임시DB2(self, tmp_path):
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        from app.db.database import Base
        from app.models.user import User
        from app.models.stock import Portfolio, PortfolioItem, PortfolioSnapshot

        엔진 = create_engine(f"sqlite:///{tmp_path}/새.db")
        Base.metadata.create_all(엔진, tables=[
            User.__table__, Portfolio.__table__, PortfolioItem.__table__,
            PortfolioSnapshot.__table__])
        db = sessionmaker(bind=엔진)()
        yield db
        db.close()


class Test하루_중_갱신:
    """'자산 흐름 수치가 정확하지 않다' 의 원인이었다.

    예전에는 시세가 다 채워진 사람을 그날 회차에서 아예 뺐다. 그래서
    스케줄러가 **처음 도는 순간의 값이 그날 값으로 굳었다.** 24시간
    도는 서버에서는 새벽 00:15 값이다 — 한국 장은 열리지도 않은 시각.

    어제 점은 어제 새벽 값, 그제 점은 그제 새벽 값. 점마다 하루 중
    시각이 제각각이라 그래프의 일간 변동이 실제 움직임과 관계가 없었다.
    """

    @pytest.fixture(autouse=True)
    def _환율넣기(self):
        """환율이 없으면 찍기() 가 맨 앞에서 그냥 돌아간다.

        Test찍기 의 같은 픽스처는 그 클래스에만 걸린다 — 여기 안 두면
        이 검사들이 '아무것도 안 적혔다' 를 보고 엉뚱하게 실패한다."""
        from app.core.cache import cache
        cache.set("extra:usdkrw", {"value": 1400.0}, 60)
        yield
        cache.delete("extra:usdkrw")

    def test_시세가_움직이면_그날_값도_따라간다(self, monkeypatch, 시세):
        시세("005930", 80_000)
        항목 = [_항목(user_id=7, shares=10, avg_price=70_000)]
        아침 = _줄(portfolio_id=0, filled=1, priced=1,
                   total_value=750_000, total_cost=700_000)
        아침포트 = _줄(portfolio_id=1, filled=1, priced=1,
                       total_value=750_000, total_cost=700_000)
        db = _찍기DB(항목, 오늘줄=(아침, 아침포트))
        import app.db.database as D
        monkeypatch.setattr(D, "SessionLocal", lambda: db)

        assert PS.찍기() == 1
        assert 아침.total_value == 800_000, "첫 회차 값에 굳어 있다"

    def test_값이_그대로면_쓰지_않는다(self, monkeypatch, 시세):
        """15분마다 도는 일이다. 안 바뀐 줄에까지 쓰기를 내보내면
        그 자체가 부담이다."""
        시세("005930", 80_000)
        항목 = [_항목(user_id=7, shares=10, avg_price=70_000)]
        같은것 = _줄(portfolio_id=0, filled=1, priced=1,
                     total_value=800_000, total_cost=700_000)
        같은것포트 = _줄(portfolio_id=1, filled=1, priced=1,
                         total_value=800_000, total_cost=700_000)
        db = _찍기DB(항목, 오늘줄=(같은것, 같은것포트))
        import app.db.database as D
        monkeypatch.setattr(D, "SessionLocal", lambda: db)

        assert PS.찍기() == 0
        assert db.commits == 0


class Test고쳐쓸까:
    """규칙을 따로 떼어 놓고 하나씩 본다."""

    def _줄만들기(self, filled=2, value=1000.0, cost=900.0):
        return _줄(filled=filled, priced=2, total_value=value, total_cost=cost)

    def test_덜_채워진_값으로_안_돌아간다(self):
        """장중에 캐시가 잠깐 비면 filled 가 줄어든다. 그때 덮어쓰면
        온전하던 줄이 반쪽이 된다 — 그 하루가 17.9% 아래로 찍혔었다."""
        있던것 = self._줄만들기(filled=2, value=1000.0)
        새것 = {"value": 500.0, "cost": 900.0, "filled": 1, "priced": 2}
        assert PS._고쳐쓸까(있던것, 새것) is False

    def test_더_채워졌으면_고쳐_쓴다(self):
        있던것 = self._줄만들기(filled=1, value=500.0)
        새것 = {"value": 1000.0, "cost": 900.0, "filled": 2, "priced": 2}
        assert PS._고쳐쓸까(있던것, 새것) is True

    def test_같은_만큼_채워졌어도_값이_달라졌으면_고쳐_쓴다(self):
        """여기가 '새벽 값으로 굳는' 것을 푸는 자리다."""
        있던것 = self._줄만들기(filled=2, value=1000.0)
        새것 = {"value": 1100.0, "cost": 900.0, "filled": 2, "priced": 2}
        assert PS._고쳐쓸까(있던것, 새것) is True

    def test_값이_똑같으면_안_쓴다(self):
        있던것 = self._줄만들기(filled=2, value=1000.0, cost=900.0)
        새것 = {"value": 1000.0, "cost": 900.0, "filled": 2, "priced": 2}
        assert PS._고쳐쓸까(있던것, 새것) is False

    def test_매입금액만_달라져도_고쳐_쓴다(self):
        """종목을 더 샀으면 평가금액은 그대로여도 매입금액이 는다"""
        있던것 = self._줄만들기(filled=2, value=1000.0, cost=900.0)
        새것 = {"value": 1000.0, "cost": 950.0, "filled": 2, "priced": 2}
        assert PS._고쳐쓸까(있던것, 새것) is True

    def test_1원_미만_차이는_같은_것으로_본다(self):
        """부동소수점 찌꺼기로 매 회차 쓰기가 나가면 안 된다"""
        있던것 = self._줄만들기(filled=2, value=1000.0, cost=900.0)
        새것 = {"value": 1000.001, "cost": 900.002, "filled": 2, "priced": 2}
        assert PS._고쳐쓸까(있던것, 새것) is False


# ── 빈 날 메우기 ────────────────────────────────────────────
#
# "앱을 안 연 날도 기록하게 해 줘" 를 받고 코드를 다시 봤다. 찍기() 는
# 앱을 여는 것과 아무 상관이 없다 — 스케줄러가 15분마다 보유 종목이
# 있는 **모든** 사람을 돈다.
#
# 구멍이 생기는 진짜 이유는 서버가 자기 때문이다. Render 무료
# 인스턴스는 아무도 안 들어오면 잠들고, 자는 동안에는 스케줄러도 안
# 돈다. 하루 종일 아무도 안 들어온 날은 그날 줄이 통째로 없다.
# 사용자 눈에는 '내가 앱을 안 연 날' 과 정확히 겹쳐 보인다.
#
# 여기서 못 박는 것 —
#   · 값을 지어내지 않는다(그날의 실제 종가로 다시 계산한다)
#   · 그 사이에 매매가 있었을 것 같으면 **아예 안 메운다**
#   · 주말·휴장일은 직전 거래일 종가를 쓴다(실제로 안 움직인 날이다)

class Test그날이전종가:
    표 = (["2026-08-20", "2026-08-21", "2026-08-24"], [100.0, 110.0, 120.0])

    def test_그날_값이_있으면_그것(self):
        assert PS.그날이전종가(self.표, "2026-08-21") == 110.0

    @pytest.mark.parametrize("날,나와야", [
        ("2026-08-22", 110.0),      # 토요일 — 금요일 종가
        ("2026-08-23", 110.0),      # 일요일
    ])
    def test_장이_안_선_날은_직전_거래일(self, 날, 나와야):
        """비워 두면 그날 자산이 0 이 된다. 직전 종가를 쓰면
        '안 움직였다' 가 되는데, 실제로 안 움직였다"""
        assert PS.그날이전종가(self.표, 날) == 나와야

    def test_첫_거래일보다_앞이면_없다(self):
        """지어낼 값이 없다. 0 으로 채우면 '그날 자산이 0 이었다' 가 된다"""
        assert PS.그날이전종가(self.표, "2026-08-19") is None

    def test_마지막_뒤는_마지막_값(self):
        assert PS.그날이전종가(self.표, "2026-09-01") == 120.0

    def test_표가_없으면_없다(self):
        assert PS.그날이전종가(None, "2026-08-21") is None


class Test빈날찾기:
    def test_사이의_빈_날만_돌려준다(self):
        있는날 = {"2026-08-20", "2026-08-24"}
        assert PS.빈날찾기(있는날, "2026-08-20", "2026-08-24") == [
            "2026-08-21", "2026-08-22", "2026-08-23"]

    def test_양_끝은_안_넣는다(self):
        """양 끝은 실제로 적힌 날이다. 다시 넣으면 같은 날이 두 줄이 된다"""
        결과 = PS.빈날찾기(set(), "2026-08-20", "2026-08-22")
        assert "2026-08-20" not in 결과 and "2026-08-22" not in 결과

    def test_이미_있는_날은_건너뛴다(self):
        있는날 = {"2026-08-20", "2026-08-22", "2026-08-24"}
        assert PS.빈날찾기(있는날, "2026-08-20", "2026-08-24") == [
            "2026-08-21", "2026-08-23"]

    def test_붙어_있으면_빈_날이_없다(self):
        assert PS.빈날찾기(set(), "2026-08-20", "2026-08-21") == []

    def test_달을_넘어도_센다(self):
        assert PS.빈날찾기(set(), "2026-08-30", "2026-09-02") == [
            "2026-08-31", "2026-09-01"]


class Test메울구간:
    """어디를 메우고 어디를 안 메우나.

    그날 무엇을 갖고 있었는지를 우리는 모른다 — 지금 보유 목록밖에
    없고, 판 종목은 아예 안 남아 있다. 그래서 **양쪽이 실제 기록으로
    막힌 구멍**만 보고, 그 앞뒤 원금이 같은지로 '그 사이에 매매가
    없었나' 를 가늠한다. 사고팔면 원금이 바뀐다.
    """

    def test_원금이_같으면_메운다(self):
        rows = [("2026-08-20", 1_000_000.0), ("2026-08-24", 1_000_000.0)]
        assert PS.메울구간(rows, None) == [("2026-08-20", "2026-08-24")]

    def test_원금이_달라지면_그_구간은_안_메운다(self):
        """그 사이에 뭔가 샀다는 뜻이다. 언제 얼마나 샀는지는 알 수
        없으므로, 지금 목록으로 계산하면 그건 기록이 아니라 지어낸 값이다"""
        rows = [("2026-08-20", 1_000_000.0), ("2026-08-24", 3_000_000.0)]
        assert PS.메울구간(rows, None) == []

    def test_환율_흔들림_정도는_같은_것으로_본다(self):
        """원화로 안 넣은 해외 종목은 매매가 없어도 환율 때문에
        매입금액이 매일 조금씩 달라진다. 그것 때문에 못 메우면
        해외 종목을 가진 사람은 이 기능을 통째로 못 쓴다"""
        rows = [("2026-08-20", 1_000_000.0), ("2026-08-24", 1_005_000.0)]  # 0.5%
        assert PS.메울구간(rows, None) == [("2026-08-20", "2026-08-24")]

    def test_1퍼센트를_넘으면_안_메운다(self):
        rows = [("2026-08-20", 1_000_000.0), ("2026-08-24", 1_020_000.0)]  # 2%
        assert PS.메울구간(rows, None) == []

    def test_구간이_여럿이면_되는_것만_고른다(self):
        rows = [("2026-08-01", 100.0), ("2026-08-05", 100.0),
                ("2026-08-10", 500.0), ("2026-08-20", 500.0)]
        assert PS.메울구간(rows, None) == [
            ("2026-08-01", "2026-08-05"), ("2026-08-10", "2026-08-20")]

    def test_마지막_기록과_오늘_사이도_본다(self):
        """지금 보유 목록은 정확히 알고 있으므로 그쪽이 뒤 기둥이 된다.
        서버가 며칠 자다 깬 경우가 여기다"""
        rows = [("2026-08-20", 1_000_000.0)]
        구간 = PS.메울구간(rows, 1_000_000.0)
        assert 구간 == [("2026-08-20", PS.오늘())]

    def test_지금_원금이_다르면_꼬리는_안_메운다(self):
        rows = [("2026-08-20", 1_000_000.0)]
        assert PS.메울구간(rows, 5_000_000.0) == []

    def test_기록이_없으면_아무것도_안_한다(self):
        assert PS.메울구간([], 1_000_000.0) == []


class Test과거합계:
    """찍기() 의 합계내기() 와 **같은 규칙**이어야 한다.

    다른 것은 시세를 어디서 가져오느냐뿐이다. 규칙이 두 벌이면 언젠가
    한쪽만 고쳐져서, 메운 날과 찍은 날이 서로 다른 계산으로 나온 값이
    된다 — 그래프 한가운데에 계단이 생긴다.
    """
    표 = (["2026-08-20"], [80_000.0])
    달러표 = (["2026-08-20"], [200.0])

    def test_국내_종목은_환율을_안_곱한다(self):
        값 = PS.과거합계([_항목(shares=10, avg_price=70_000)],
                       "2026-08-20", 1400, {"005930": self.표})
        assert 값["value"] == 800_000 and 값["cost"] == 700_000

    def test_달러_종목에는_그날_환율을_곱한다(self):
        값 = PS.과거합계(
            [_항목(symbol="AAPL", market="US", shares=2, avg_price=150,
                  currency="USD")],
            "2026-08-20", 1300, {"AAPL": self.달러표})
        assert 값["value"] == pytest.approx(200 * 1300 * 2)
        assert 값["cost"] == pytest.approx(150 * 1300 * 2)

    def test_원화로_넣은_해외_종목에_환율을_또_곱하지_않는다(self):
        """예전에 실제로 난 사고다 — 이미 원화인 평단가에 환율을 또
        곱해서 값이 수천 배가 됐다. 시장이 아니라 통화를 봐야 한다"""
        값 = PS.과거합계(
            [_항목(symbol="AAPL", market="US", shares=2, avg_price=200_000,
                  currency="KRW")],
            "2026-08-20", 1300, {"AAPL": self.달러표})
        assert 값["cost"] == pytest.approx(400_000)

    def test_그날_아직_안_산_종목은_뺀다(self):
        """산 날을 적어 둔 사람에게는 이게 원금 어림보다 정확하다"""
        늦게산것 = _항목(symbol="000660", shares=5, avg_price=100_000)
        늦게산것.purchase_date = "2026-08-25"
        값 = PS.과거합계([_항목(shares=10, avg_price=70_000), 늦게산것],
                       "2026-08-20", 1400,
                       {"005930": self.표, "000660": (["2026-08-20"], [1.0])})
        assert 값["cost"] == 700_000            # 늦게 산 것은 안 들어간다
        assert 값["priced"] == 1

    def test_그날_이미_산_종목은_넣는다(self):
        산것 = _항목(shares=10, avg_price=70_000)
        산것.purchase_date = "2026-08-01"
        값 = PS.과거합계([산것], "2026-08-20", 1400, {"005930": self.표})
        assert 값["cost"] == 700_000

    def test_시세를_하나도_못_구하면_안_적는다(self):
        """매입금액을 그대로 적으면 '그날 자산이 원금과 같았다' 는
        거짓말이 그래프에 남는다. 찍기() 와 같은 판단이다"""
        assert PS.과거합계([_항목()], "2026-08-20", 1400, {}) is None

    def test_현금만_있으면_시세를_안_찾는다(self):
        값 = PS.과거합계([_항목(symbol="KRW", asset_class="현금",
                             shares=1, avg_price=500_000)],
                       "2026-08-20", 1400, {})
        assert 값 is not None
        assert 값["priced"] == 0 and 값["value"] == 500_000

    def test_같은_날_찍기와_같은_값이_나온다(self, 시세):
        """이게 이 검사 묶음의 핵심이다. 메운 날과 찍은 날이 그래프
        위에서 이어져 보이려면 두 계산이 같은 답을 내야 한다"""
        시세("005930", 80_000)
        항목들 = [_항목(shares=10, avg_price=70_000),
                _항목(symbol="AAPL", market="US", shares=2,
                     avg_price=150, currency="USD")]
        찍은것 = PS.합계내기(항목들, 1300)
        # 과거표에 오늘 시세와 같은 값을 넣는다
        표 = {"005930": ([PS.오늘()], [80_000.0]), "AAPL": ([PS.오늘()], [200.0])}
        시세("AAPL", 200)
        찍은것 = PS.합계내기(항목들, 1300)
        메운것 = PS.과거합계(항목들, PS.오늘(), 1300, 표)
        assert 메운것["value"] == pytest.approx(찍은것["value"])
        assert 메운것["cost"] == pytest.approx(찍은것["cost"])


class Test메우기_전체:
    """진짜 DB 를 띄우고 메우기() 를 통째로 돌린다.

    조각마다 맞아도 이어 붙였을 때 안 도는 일이 있다. 특히 여기는
    '어느 줄이 이미 있나' 를 보고 '없는 줄만' 넣는 일이라, 한 칸만
    어긋나도 같은 날이 두 줄이 되거나 아무것도 안 들어간다.
    """

    @pytest.fixture
    def DB(self, tmp_path):
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        from app.db.database import Base
        from app.models.user import User
        from app.models.stock import Portfolio, PortfolioItem, PortfolioSnapshot

        엔진 = create_engine(f"sqlite:///{tmp_path}/메우기.db")
        Base.metadata.create_all(엔진, tables=[
            User.__table__, Portfolio.__table__,
            PortfolioItem.__table__, PortfolioSnapshot.__table__])
        db = sessionmaker(bind=엔진)()
        yield db
        db.close()

    @pytest.fixture(autouse=True)
    def _환율넣기(self):
        from app.core.cache import cache
        cache.set("extra:usdkrw", {"value": 1400.0}, 60)
        yield
        cache.delete("extra:usdkrw")

    def _붙이기(self, monkeypatch, db, 종가표, 환율표=None):
        """바깥 조회를 전부 걷어낸다.

        작업 환경에서 야후가 막혀 있기도 하고, 열려 있더라도 검사가
        네트워크에 기대면 안 된다 — 오늘 통과하고 내일 깨진다."""
        import app.db.database as D
        monkeypatch.setattr(D, "SessionLocal", lambda: db)
        monkeypatch.setattr(db, "close", lambda: None)
        monkeypatch.setattr(PS, "_봉표", lambda sym, mkt: 종가표.get(sym))
        monkeypatch.setattr(PS, "_과거환율표",
                            lambda: 환율표 or (["2020-01-01"], [1400.0]))

    def _날(self, 며칠전: int) -> str:
        return (datetime.now(PS.KST) - timedelta(days=며칠전)).strftime("%Y-%m-%d")

    def _채우기(self, db, 날들, 원금=700_000.0, pid=0, uid=7):
        from app.models.stock import PortfolioSnapshot
        for d in 날들:
            db.add(PortfolioSnapshot(user_id=uid, portfolio_id=pid, day=d,
                                     total_value=800_000.0, total_cost=원금,
                                     filled=1, priced=1))

    def _보유(self, db, uid=7):
        from app.models.stock import Portfolio, PortfolioItem
        db.add(Portfolio(id=1, user_id=uid, name="주력"))
        db.add(PortfolioItem(user_id=uid, portfolio_id=1, symbol="005930",
                             market="KR", shares=10, avg_price=70_000, currency="KRW"))

    def _표(self):
        """지난 열흘 매일 8만원"""
        날들 = sorted(self._날(i) for i in range(12))
        return {"005930": (날들, [80_000.0] * len(날들))}

    def test_가운데_빈_날을_메운다(self, monkeypatch, DB):
        """서버가 하루 자고 일어난 날이 이 모양이다"""
        from sqlalchemy import text
        self._보유(DB)
        self._채우기(DB, [self._날(5), self._날(2)], pid=0)
        self._채우기(DB, [self._날(5), self._날(2)], pid=1)
        DB.commit()
        self._붙이기(monkeypatch, DB, self._표())

        메운수 = PS.메우기()
        assert 메운수 > 0, "구멍이 있는데 하나도 안 메웠다"
        날들 = [r[0] for r in DB.execute(text(
            "SELECT day FROM portfolio_snapshots WHERE portfolio_id=0 ORDER BY day")).fetchall()]
        # 5·2일 전 사이(4·3)를 메우고, 마지막 기록 뒤의 꼬리(1일 전)도
        # 메운다 — 지금 보유 목록이 뒤 기둥 노릇을 한다. 오늘 것은
        # 라우트가 즉석으로 얹으므로 여기서 안 넣는다
        assert 날들 == sorted([self._날(i) for i in (5, 4, 3, 2, 1)]), 날들

    def test_같은_날을_두_번_안_넣는다(self, monkeypatch, DB):
        """두 번 돌아도 결과가 같아야 한다. 스케줄러가 2시간마다 부른다"""
        from sqlalchemy import text
        self._보유(DB)
        self._채우기(DB, [self._날(5), self._날(2)], pid=0)
        DB.commit()
        self._붙이기(monkeypatch, DB, self._표())

        PS.메우기()
        첫번째 = DB.execute(text("SELECT COUNT(*) FROM portfolio_snapshots")).scalar()
        assert PS.메우기() == 0, "이미 메운 것을 또 메웠다"
        assert DB.execute(text("SELECT COUNT(*) FROM portfolio_snapshots")).scalar() == 첫번째

    def test_원금이_달라진_구간은_안_메운다(self, monkeypatch, DB):
        """그 사이에 뭔가 샀다는 뜻이다. 지금 목록으로 계산하면
        그건 기록이 아니라 지어낸 값이다"""
        from sqlalchemy import text
        self._보유(DB)
        self._채우기(DB, [self._날(5)], 원금=700_000.0, pid=0)
        self._채우기(DB, [self._날(2)], 원금=3_000_000.0, pid=0)
        DB.commit()
        self._붙이기(monkeypatch, DB, self._표())

        PS.메우기()
        날들 = [r[0] for r in DB.execute(text(
            "SELECT day FROM portfolio_snapshots WHERE portfolio_id=0")).fetchall()]
        assert sorted(날들) == sorted([self._날(5), self._날(2)]), 날들

    def test_기록이_하나뿐이면_아무것도_안_한다(self, monkeypatch, DB):
        """기둥이 하나면 '그 사이에 매매가 없었나' 를 확인할 방법이 없다"""
        from sqlalchemy import text
        self._보유(DB)
        self._채우기(DB, [self._날(5)], pid=0)
        DB.commit()
        self._붙이기(monkeypatch, DB, self._표())

        PS.메우기()
        assert DB.execute(text("SELECT COUNT(*) FROM portfolio_snapshots")).scalar() == 1

    def test_시세를_못_구한_날은_안_메운다(self, monkeypatch, DB):
        """매입금액을 그대로 적으면 '그날 자산이 원금과 같았다' 는
        거짓말이 남는다"""
        from sqlalchemy import text
        self._보유(DB)
        self._채우기(DB, [self._날(5), self._날(2)], pid=0)
        DB.commit()
        self._붙이기(monkeypatch, DB, {})       # 봉이 아예 없다

        PS.메우기()
        assert DB.execute(text("SELECT COUNT(*) FROM portfolio_snapshots")).scalar() == 2

    def test_환율을_못_구하면_안_메운다(self, monkeypatch, DB):
        """해외 종목이 통째로 0 이 된다. 그 값을 남기면
        '그날 반토막 났다' 로 보인다"""
        from sqlalchemy import text
        self._보유(DB)
        self._채우기(DB, [self._날(5), self._날(2)], pid=0)
        DB.commit()
        self._붙이기(monkeypatch, DB, self._표(), 환율표=None)
        monkeypatch.setattr(PS, "_과거환율표", lambda: None)

        PS.메우기()
        assert DB.execute(text("SELECT COUNT(*) FROM portfolio_snapshots")).scalar() == 2

    def test_메운_값이_실제_종가로_계산된다(self, monkeypatch, DB):
        """이게 핵심이다. 앞뒤 값을 그대로 늘여 놓는 것이 아니라
        그날의 실제 종가로 다시 센다"""
        from sqlalchemy import text
        self._보유(DB)
        self._채우기(DB, [self._날(4), self._날(1)], pid=0)
        DB.commit()
        # 사이의 이틀만 값이 다르다
        날들 = sorted(self._날(i) for i in range(6))
        값들 = [90_000.0 if d in (self._날(3), self._날(2)) else 80_000.0 for d in 날들]
        self._붙이기(monkeypatch, DB, {"005930": (날들, 값들)})

        PS.메우기()
        메운것 = dict(DB.execute(text(
            "SELECT day, total_value FROM portfolio_snapshots WHERE portfolio_id=0")).fetchall())
        assert 메운것[self._날(3)] == 900_000, 메운것    # 90,000 × 10
        assert 메운것[self._날(2)] == 900_000, 메운것
        # 원래 있던 줄은 안 건드린다 — 그건 그날의 기록이다
        assert 메운것[self._날(4)] == 800_000

    def test_주말은_직전_거래일_종가로_메운다(self, monkeypatch, DB):
        """장이 안 선 날 자산은 실제로 안 움직였다"""
        from sqlalchemy import text
        self._보유(DB)
        self._채우기(DB, [self._날(4), self._날(1)], pid=0)
        DB.commit()
        # 4일 전 이후로는 봉이 없다(연휴)
        self._붙이기(monkeypatch, DB,
                    {"005930": ([self._날(4)], [85_000.0])})

        PS.메우기()
        메운것 = dict(DB.execute(text(
            "SELECT day, total_value FROM portfolio_snapshots WHERE portfolio_id=0")).fetchall())
        assert 메운것[self._날(3)] == 850_000, 메운것

    def test_어디서_터져도_예외를_안_내보낸다(self, monkeypatch, DB):
        """이 일이 주기 갱신 전체를 멈춰 세우면 고치려던 것보다 나쁘다"""
        import app.db.database as D
        monkeypatch.setattr(D, "SessionLocal",
                            lambda: (_ for _ in ()).throw(RuntimeError("DB 없음")))
        assert PS.메우기() == 0

    def test_포트폴리오별_줄도_같이_메운다(self, monkeypatch, DB):
        from sqlalchemy import text
        self._보유(DB)
        self._채우기(DB, [self._날(4), self._날(1)], pid=0)
        self._채우기(DB, [self._날(4), self._날(1)], pid=1)
        DB.commit()
        self._붙이기(monkeypatch, DB, self._표())

        PS.메우기()
        칸별 = dict(DB.execute(text(
            "SELECT portfolio_id, COUNT(*) FROM portfolio_snapshots GROUP BY portfolio_id")).fetchall())
        assert 칸별[0] == 4 and 칸별[1] == 4, 칸별
