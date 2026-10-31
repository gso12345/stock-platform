"""사고판 기록 — 실현 손익과 해외주식 양도세 어림.

숫자가 틀리면 그 숫자로 '올해 더 팔까' 를 정하는 사람이 손해를 본다. 손으로 셀 수 있는 예로 못 박는다.
  · 달러 종목은 원화로 — 판 날 환율로 받은 돈에서 산 때 환율로 낸 돈을 뺀다(환차익도 양도차익)
  · 더 사면 평단·매수 환율이 섞인다 — 원화로 들인 돈의 합이 그대로 남게
  · 해외주식만 양도세 — 손익통산, 기본공제 250만원, 22%. 국내 상장 ETF 는 뺀다
  · 다 팔면 보유는 지우고 기록은 남긴다. 남의 보유는 못 건드린다
"""
from datetime import datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.services.portfolio import trades as T


class Test해외인가:
    @pytest.mark.parametrize("기호, 시장, 기대", [
        ("AAPL", "US", True),
        ("SPY", "ETF", True),           # 미국에 상장한 ETF
        ("069500", "ETF", False),       # 국내 상장 ETF — 양도세가 아니라 배당소득세
        ("0091C0", "ETF", False),       # 영문이 섞인 새 국내 코드
        ("005930", "KR", False),
        ("005930.KS", "ETF", False),
    ])
    def test_양도세를_내는_것만(self, 기호, 시장, 기대):
        assert T.해외인가(기호, 시장) is 기대


class Test팔기:
    def test_원화는_판_돈에서_평단과_수수료를_뺀다(self):
        r = T.매도(10, 70_000, None, "KRW", 4, 80_000, None, 수수료=1_000)
        assert r == {"avg_cost": 70_000, "avg_fx": None, "realized": 39_000, "남은수": 6}

    def test_달러는_판_날_환율로_받고_산_때_환율로_낸_것을_뺀다(self):
        # 5주 × $120 × 1,400 − 5주 × $100 × 1,300 − $1 × 1,400
        r = T.매도(10, 100, 1_300, "USD", 5, 120, 1_400, 수수료=1)
        assert r["realized"] == 840_000 - 650_000 - 1_400
        assert r["avg_fx"] == 1_300 and r["남은수"] == 5

    def test_산_때_환율을_모르면_판_날_환율로_환차익은_0(self):
        r = T.매도(10, 100, None, "USD", 5, 120, 1_400)
        assert r["realized"] == 5 * 20 * 1_400 and r["avg_fx"] == 1_400

    def test_손실도_그대로(self):
        assert T.매도(10, 100, 1_300, "USD", 10, 90, 1_250)["realized"] == 10 * 90 * 1_250 - 10 * 100 * 1_300

    def test_다_팔면_0_부동소수_찌꺼기도_0(self):
        assert T.매도(10, 1, None, "KRW", 10, 1, None)["남은수"] == 0
        assert T.매도(0.3, 1, None, "KRW", 0.1 + 0.2, 1, None)["남은수"] == 0
        # 0.1 + 0.2 주를 갖고 0.3 주를 팔면 5.6e-17 주가 남는다 — 그건 0 주다
        assert T.매도(0.1 + 0.2, 1, None, "KRW", 0.3, 1, None)["남은수"] == 0

    def test_찌꺼기만큼_더_파는_것은_다_파는_것이다(self):
        """0.3 주를 갖고 화면에서 '전부' 를 누르면 0.30000000000000004 가 올 수 있다 — 막으면 영영 못 판다"""
        assert T.매도(0.3, 1, None, "KRW", 0.1 + 0.2, 1, None)["남은수"] == 0
        with pytest.raises(ValueError):
            T.매도(0.3, 1, None, "KRW", 0.3001, 1, None)

    def test_가진_것보다_많이_또는_0주는_못_판다(self):
        with pytest.raises(ValueError, match="가진 것보다"):
            T.매도(10, 1, None, "KRW", 10.5, 1, None)
        with pytest.raises(ValueError):
            T.매도(10, 1, None, "KRW", 0, 1, None)


class Test더사기:
    def test_원화_평단은_수수료까지_섞는다(self):
        r = T.매수(10, 70_000, None, "KRW", 10, 90_000, None, 수수료=2_000)
        assert r == {"shares": 20, "avg_price": (700_000 + 900_000 + 2_000) / 20, "input_exchange_rate": None}

    def test_달러_매수_환율은_들인_돈으로_가중한_평균(self):
        r = T.매수(10, 100, 1_300, "USD", 10, 120, 1_400)
        assert r["shares"] == 20 and r["avg_price"] == 110
        assert r["input_exchange_rate"] == round((1_000 * 1_300 + 1_200 * 1_400) / 2_200, 4)
        # 원화로 들인 돈의 합이 그대로 남는다
        assert r["shares"] * r["avg_price"] * r["input_exchange_rate"] == pytest.approx(1_300_000 + 1_680_000, abs=1)

    def test_예전_매수_환율이_없으면_이번_환율로(self):
        assert T.매수(10, 100, None, "USD", 10, 100, 1_400)["input_exchange_rate"] == 1_400

    def test_0주는_못_산다(self):
        with pytest.raises(ValueError):
            T.매수(10, 1, None, "KRW", 0, 1, None)


class Test한해_요약:
    def test_해외만_공제_뒤_22퍼센트(self):
        r = T.한해_요약([
            {"symbol": "AAPL", "market": "US", "realized": 5_000_000},
            {"symbol": "005930", "market": "KR", "realized": 9_000_000},     # 국내는 세금 셈에 안 든다
        ])
        assert r == {"realized": 14_000_000, "domestic": 9_000_000, "overseas": 5_000_000,
                     "deduction": 2_500_000, "taxable": 2_500_000, "tax": 550_000, "rate": 0.22}

    def test_해외_손익은_서로_뺀다(self):
        r = T.한해_요약([
            {"symbol": "AAPL", "market": "US", "realized": 4_000_000},
            {"symbol": "TSLA", "market": "US", "realized": -1_000_000},
            {"symbol": "QQQ", "market": "ETF", "realized": 0},
        ])
        assert (r["overseas"], r["taxable"], r["tax"]) == (3_000_000, 500_000, 110_000)

    def test_공제_안이거나_손실이면_0(self):
        assert T.한해_요약([{"symbol": "AAPL", "market": "US", "realized": 2_500_000}])["tax"] == 0
        r = T.한해_요약([{"symbol": "AAPL", "market": "US", "realized": -3_000_000}])
        assert (r["taxable"], r["tax"], r["overseas"]) == (0, 0, -3_000_000)

    def test_국내_상장_ETF_는_빼고_비어_있으면_0(self):
        assert T.한해_요약([{"symbol": "069500", "market": "ETF", "realized": 9_000_000}])["tax"] == 0
        assert T.한해_요약([])["realized"] == 0
        assert T.한해_요약([{"symbol": "AAPL", "market": "US", "realized": None}])["overseas"] == 0


# ── 주소로 ────────────────────────────────────────────────────
@pytest.fixture
def 손님(monkeypatch):
    import importlib
    import pkgutil
    import app.models as 모델들
    from fastapi.testclient import TestClient
    from app.main import app
    from app.core.deps import require_user
    from app.db.database import Base, get_db
    from app.models.user import User
    for 칸 in pkgutil.iter_modules(모델들.__path__):
        importlib.import_module(f"app.models.{칸.name}")
    엔진 = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(엔진)
    세션 = sessionmaker(bind=엔진)
    db = 세션()
    나, 남 = User(username="나", hashed_password="x"), User(username="남", hashed_password="x")
    db.add_all([나, 남]); db.commit()
    지금 = {"id": 나.id}

    class 사람:
        @property
        def id(self):
            return 지금["id"]

    def db주기():
        s = 세션()
        try:
            yield s
        finally:
            s.close()
    app.dependency_overrides[get_db] = db주기
    app.dependency_overrides[require_user] = lambda: 사람()
    yield TestClient(app), 세션, 지금, (나.id, 남.id)
    app.dependency_overrides.pop(get_db, None)
    app.dependency_overrides.pop(require_user, None)
    db.close()


def _보유(c, **덮):
    몸 = {"symbol": "AAPL", "market": "US", "name": "애플", "shares": 10, "avg_price": 100,
          "currency": "USD", "input_exchange_rate": 1300, **덮}
    r = c.post("/api/v1/portfolio/items", json=몸)
    assert r.status_code == 201, r.text
    return r.json()


class Test주소:
    def test_일부_팔면_수량이_줄고_실현_손익이_남는다(self, 손님):
        c, *_ = 손님
        항 = _보유(c)
        r = c.post(f"/api/v1/portfolio/items/{항['id']}/trade",
                   json={"side": "sell", "shares": 5, "price": 120, "fx": 1400, "fee": 1, "trade_date": "2026-03-02"})
        assert r.status_code == 201, r.text
        몸 = r.json()
        assert 몸["item"]["shares"] == 5 and 몸["item"]["avgPrice"] == 100
        assert 몸["trade"]["realized"] == 840_000 - 650_000 - 1_400
        assert (몸["trade"]["side"], 몸["trade"]["tradeDate"], 몸["trade"]["overseas"]) == ("sell", "2026-03-02", True)

    def test_다_팔면_보유는_지우고_기록은_남는다(self, 손님):
        c, *_ = 손님
        항 = _보유(c, symbol="005930", market="KR", name="삼성전자", avg_price=70_000, currency="KRW",
                  input_exchange_rate=None)
        r = c.post(f"/api/v1/portfolio/items/{항['id']}/trade",
                   json={"side": "sell", "shares": 10, "price": 80_000, "trade_date": "2026-05-01"})
        assert r.json()["item"] is None
        assert c.get("/api/v1/portfolio/items", params={"view_all": True}).json() == []
        목록 = c.get("/api/v1/portfolio/trades", params={"year": 2026}).json()
        assert [t["realized"] for t in 목록["items"]] == [100_000]
        assert 목록["summary"]["domestic"] == 100_000 and 목록["summary"]["tax"] == 0

    def test_가진_것보다_많이_팔면_400_보유는_그대로(self, 손님):
        c, *_ = 손님
        항 = _보유(c)
        r = c.post(f"/api/v1/portfolio/items/{항['id']}/trade", json={"side": "sell", "shares": 11, "price": 1, "fx": 1400})
        assert r.status_code == 400 and "가진 것보다" in r.json()["detail"]
        assert c.get("/api/v1/portfolio/items", params={"view_all": True}).json()[0]["shares"] == 10
        assert c.get("/api/v1/portfolio/trades").json()["items"] == []

    def test_달러_종목은_환율이_있어야(self, 손님):
        c, *_ = 손님
        항 = _보유(c)
        r = c.post(f"/api/v1/portfolio/items/{항['id']}/trade", json={"side": "sell", "shares": 1, "price": 1})
        assert r.status_code == 422 and "환율" in r.json()["detail"]

    def test_원화_종목은_환율을_줘도_안_쓴다(self, 손님):
        c, *_ = 손님
        항 = _보유(c, symbol="005930", market="KR", avg_price=70_000, currency="KRW", input_exchange_rate=None)
        r = c.post(f"/api/v1/portfolio/items/{항['id']}/trade",
                   json={"side": "sell", "shares": 1, "price": 80_000, "fx": 1400})
        assert r.json()["trade"]["fx"] is None and r.json()["trade"]["realized"] == 10_000

    def test_더_사면_평단과_매수_환율이_섞인다(self, 손님):
        c, *_ = 손님
        항 = _보유(c)
        r = c.post(f"/api/v1/portfolio/items/{항['id']}/trade",
                   json={"side": "buy", "shares": 10, "price": 120, "fx": 1400})
        보유 = r.json()["item"]
        assert 보유["shares"] == 20 and 보유["avgPrice"] == 110
        assert 보유["inputExchangeRate"] == round((1_000 * 1_300 + 1_200 * 1_400) / 2_200, 4)
        assert r.json()["trade"]["side"] == "buy" and r.json()["trade"]["realized"] is None

    def test_남의_보유는_못_사고판다(self, 손님):
        c, _, 지금, (나, 남) = 손님
        항 = _보유(c)
        지금["id"] = 남
        assert c.post(f"/api/v1/portfolio/items/{항['id']}/trade",
                      json={"side": "sell", "shares": 1, "price": 1, "fx": 1}).status_code == 404

    def test_날짜_모양이_틀리면_422(self, 손님):
        c, *_ = 손님
        항 = _보유(c)
        assert c.post(f"/api/v1/portfolio/items/{항['id']}/trade",
                      json={"side": "sell", "shares": 1, "price": 1, "fx": 1, "trade_date": "2026/03/02"}).status_code == 422
        assert c.post(f"/api/v1/portfolio/items/{항['id']}/trade",
                      json={"side": "hold", "shares": 1, "price": 1, "fx": 1}).status_code == 422

    def test_날짜를_안_주면_오늘(self, 손님):
        c, *_ = 손님
        항 = _보유(c)
        r = c.post(f"/api/v1/portfolio/items/{항['id']}/trade", json={"side": "buy", "shares": 1, "price": 1, "fx": 1})
        assert r.json()["trade"]["tradeDate"] == datetime.now().strftime("%Y-%m-%d")

    def test_해마다_고르고_세금은_사람_전체로_센다(self, 손님):
        c, *_ = 손님
        가 = _보유(c)                                             # 기본 포트폴리오
        포 = c.post("/api/v1/portfolio/portfolios", json={"name": "둘째"}).json()
        나 = _보유(c, symbol="TSLA", name="테슬라", portfolio_id=포["id"])
        for 항, 날, 값 in ((가, "2025-12-30", 200), (가, "2026-01-05", 400), (나, "2026-02-01", 500)):
            c.post(f"/api/v1/portfolio/items/{항['id']}/trade",
                   json={"side": "sell", "shares": 1, "price": 값, "fx": 1300, "trade_date": 날})
        올해 = c.get("/api/v1/portfolio/trades", params={"year": 2026}).json()
        assert 올해["years"] == [2026, 2025]
        assert [t["tradeDate"] for t in 올해["items"]] == ["2026-02-01", "2026-01-05"]   # 최근 것부터
        전체세 = 올해["summary"]["overseas"]
        assert 전체세 == (400 - 100) * 1300 + (500 - 100) * 1300
        둘째만 = c.get("/api/v1/portfolio/trades", params={"year": 2026, "portfolio_id": 포["id"]}).json()
        assert [t["symbol"] for t in 둘째만["items"]] == ["TSLA"]
        assert 둘째만["summary"]["overseas"] == 전체세, "양도세는 포트폴리오를 가리지 않고 한 사람의 한 해로"
        작년 = c.get("/api/v1/portfolio/trades", params={"year": 2025}).json()
        assert [t["tradeDate"] for t in 작년["items"]] == ["2025-12-30"]

    def test_기록이_없으면_올해만(self, 손님):
        c, *_ = 손님
        r = c.get("/api/v1/portfolio/trades").json()
        assert r["years"] == [datetime.now().year] and r["items"] == [] and r["summary"]["tax"] == 0

    def test_기록_지우기는_내_것만_보유는_그대로(self, 손님):
        c, _, 지금, (나, 남) = 손님
        항 = _보유(c)
        t = c.post(f"/api/v1/portfolio/items/{항['id']}/trade",
                   json={"side": "sell", "shares": 2, "price": 120, "fx": 1300}).json()["trade"]
        지금["id"] = 남
        assert c.delete(f"/api/v1/portfolio/trades/{t['id']}").status_code == 404
        지금["id"] = 나
        assert c.delete(f"/api/v1/portfolio/trades/{t['id']}").status_code == 200
        assert c.get("/api/v1/portfolio/trades").json()["items"] == []
        assert c.get("/api/v1/portfolio/items", params={"view_all": True}).json()[0]["shares"] == 8
