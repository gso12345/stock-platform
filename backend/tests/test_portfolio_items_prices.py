"""보유 목록에 시세를 얹어 보내는 자리 — 왕복 한 번을 없앤 그 길.

── 왜 이 검사가 필요한가 ────────────────────────────────────

화면이 평가금액을 그리려면 예전에는 왕복이 두 번이었다.

    /portfolio/items  ──▶ (답) ──▶ /watchlist/prices ──▶ (답)

무엇의 시세를 물어볼지는 종목을 받아야 알 수 있어서, 뒤엣것은 앞엣것이
올 때까지 시작조차 못 한다. 그 두 번째 왕복 내내 총자산·손익·비중이
전부 빈칸이었다. 종목이 한 개든 서른 개든 늘 붙는 대기다.

지금은 이미 메모리에 있는 시세를 목록에 같이 실어 보낸다. 그런데 이
'덤' 은 세 가지로 조용히 망가질 수 있고, 셋 다 화면에는 오류로 안
보인다 —

  1) **바깥에 물어보기 시작한다.** 이 자리는 캐시만 읽어야 한다. 한 줄만
     잘못 고쳐 여기서 종목마다 야후를 부르면, 목록을 받는 일이 갑자기
     몇 초짜리가 된다. 왕복 하나를 줄이려다 훨씬 큰 것을 잃는다.

  2) **응답 모양이 말없이 바뀐다.** with_prices 를 안 준 곳은 예전처럼
     배열을 받아야 한다. 여기가 꾸러미로 바뀌면 관리자 화면이나 다른
     호출부가 목록을 못 읽는데, 그건 이 파일이 아니라 저쪽에서 터진다.

  3) **현금에 시세를 붙인다.** 현금·금·채권은 심볼이 한글이라 시세가
     없다. 붙여 봐야 빈 값인데, 그 빈 값이 목록에 끼면 화면은 '시세를
     아직 못 받은 종목' 으로 세어 영원히 다시 물어본다.
"""
import pytest

from app.api.routes.portfolio import _받아둔시세
from app.core.cache import cache


class _항목:
    """PortfolioItem 한 줄 — 이 함수가 보는 칸만"""
    def __init__(self, symbol, market, asset_class=None):
        self.symbol = symbol
        self.market = market
        self.asset_class = asset_class


@pytest.fixture(autouse=True)
def _빈캐시():
    """검사마다 깨끗한 데서 시작한다 — 앞 검사가 심어 둔 시세가 남으면
    '캐시에 없을 때' 를 검사할 수가 없다"""
    cache.clear() if hasattr(cache, "clear") else None
    yield


def _심기(열쇠, 값):
    cache.set(f"price:{열쇠}", 값, 300)


class Test받아둔시세:
    def test_캐시에_있는_것만_돌려준다(self):
        _심기("005930", {"symbol": "005930", "price": 71_000, "change_rate": 1.2})
        나온것 = _받아둔시세([_항목("005930", "KR"), _항목("000660", "KR")])
        assert [x["symbol"] for x in 나온것] == ["005930"]
        assert 나온것[0]["price"] == 71_000
        assert 나온것[0]["market"] == "KR"

    def test_바깥에_한_번도_안_물어본다(self, monkeypatch):
        """이 자리가 조용히 느려지는 유일한 길이다.

        캐시에 없는 종목이 스무 개여도 요청 시간은 그대로여야 한다.
        여기서 바깥을 부르기 시작하면 목록 받기가 몇 초짜리가 된다."""
        불린횟수 = {"n": 0}

        def _못부름(*a, **k):
            불린횟수["n"] += 1
            raise AssertionError("여기서 바깥을 부르면 안 된다")

        import requests
        monkeypatch.setattr(requests.Session, "request", _못부름)
        나온것 = _받아둔시세([_항목(f"SYM{i}", "US") for i in range(20)])
        assert 나온것 == []
        assert 불린횟수["n"] == 0

    def test_현금은_건너뛴다(self):
        """현금에는 물어볼 시세가 없다. 빈 값이 끼면 화면이
        '아직 못 받은 종목' 으로 세어 영원히 다시 물어본다."""
        _심기("현금", {"symbol": "현금", "price": 1})
        나온것 = _받아둔시세([_항목("현금", "KR", asset_class="현금")])
        assert 나온것 == []

    def test_같은_종목을_두_줄로_담아도_한_번만(self):
        """한 종목을 여러 계좌에 나눠 담는 사람이 있다. 시세는 종목당
        하나면 되고, 두 줄이 나가면 화면이 짝을 맞출 때 헷갈린다."""
        _심기("AAPL", {"symbol": "AAPL", "price": 225.5})
        나온것 = _받아둔시세([_항목("AAPL", "US"), _항목("AAPL", "US")])
        assert len(나온것) == 1

    def test_국내는_접미사가_붙은_채로_담겨_있어도_찾는다(self):
        """같은 종목이 005930 으로도 005930.KS 로도 캐시에 들어간다 —
        어느 경로로 들어왔느냐에 따라 다르다. 한쪽만 보면 절반을 놓친다."""
        _심기("035420.KS", {"symbol": "035420.KS", "price": 180_000})
        나온것 = _받아둔시세([_항목("035420", "KR")])
        assert len(나온것) == 1
        # 화면은 보유 목록의 심볼로 짝을 맞춘다 — 캐시에 담긴 이름이 아니라
        assert 나온것[0]["symbol"] == "035420"

    def test_값이_없는_캐시는_안_쓴다(self):
        """서버가 시세를 못 구하면 price 를 비운 채로 캐시에 넣는다.
        그걸 그대로 실어 보내면 화면은 '받았다' 고 보고 다시 안 물어본다."""
        _심기("TSLA", {"symbol": "TSLA", "price": None})
        assert _받아둔시세([_항목("TSLA", "US")]) == []


class Test응답모양:
    """with_prices 를 **안 준** 곳은 예전 그대로 배열을 받아야 한다.

    이 라우트를 부르는 곳이 화면 한 군데가 아니다. 여기가 말없이
    꾸러미로 바뀌면 저쪽에서 목록을 못 읽는데, 그건 이 파일이 아니라
    엉뚱한 화면에서 터진다 — 그런 고장이 제일 찾기 어렵다.

    그래서 함수가 아니라 **HTTP 로 친다.** 로직을 여기 베껴 쓰면 라우트가
    바뀌어도 이 검사는 통과한다 — 아무것도 안 지키는 검사가 된다.
    """

    @pytest.fixture
    def 손님(self, tmp_path, monkeypatch):
        monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/보유.db")
        from fastapi.testclient import TestClient
        from app.main import app
        from app.db.database import SessionLocal, Base, engine
        from app.models.user import User
        from app.models.stock import Portfolio, PortfolioItem
        from app.core.security import create_access_token

        Base.metadata.create_all(engine)
        db = SessionLocal()
        me = db.query(User).filter(User.email == "보유@test").first()
        if not me:
            me = User(email="보유@test", username="보유", hashed_password="x")
            db.add(me); db.commit(); db.refresh(me)
        """앞 검사가 남긴 줄을 치운다 — engine 은 import 할 때 한 번
        만들어져서, 환경 변수를 바꿔도 검사마다 DB 가 갈리지 않는다."""
        db.query(PortfolioItem).filter(PortfolioItem.user_id == me.id).delete()
        db.query(Portfolio).filter(Portfolio.user_id == me.id).delete()
        db.commit()
        pf = Portfolio(user_id=me.id, name="검사용", position=0)
        db.add(pf); db.commit(); db.refresh(pf)
        for sym, mkt in (("005930", "KR"), ("AAPL", "US")):
            db.add(PortfolioItem(user_id=me.id, portfolio_id=pf.id, symbol=sym,
                                 market=mkt, name=sym, shares=1, avg_price=1,
                                 currency="KRW" if mkt == "KR" else "USD"))
        db.commit()
        토큰 = create_access_token({"sub": str(me.id)})
        db.close()
        yield TestClient(app), {"Authorization": f"Bearer {토큰}"}

    def test_안_켜면_예전_그대로_배열(self, 손님):
        c, H = 손님
        r = c.get("/api/v1/portfolio/items?view_all=true", headers=H)
        assert r.status_code == 200, r.text
        본문 = r.json()
        assert isinstance(본문, list)
        assert {x["symbol"] for x in 본문} == {"005930", "AAPL"}

    def test_켜면_목록과_시세를_같이_준다(self, 손님):
        c, H = 손님
        _심기("005930", {"symbol": "005930", "price": 71_000, "change_rate": 1.2})
        r = c.get("/api/v1/portfolio/items?view_all=true&with_prices=true", headers=H)
        assert r.status_code == 200, r.text
        본문 = r.json()
        assert set(본문) == {"items", "prices"}
        assert {x["symbol"] for x in 본문["items"]} == {"005930", "AAPL"}
        # 캐시에 있던 것만 — AAPL 은 심어 두지 않았다
        assert [p["symbol"] for p in 본문["prices"]] == ["005930"]
        assert 본문["prices"][0]["price"] == 71_000

    def test_캐시가_비어_있어도_목록은_온다(self, 손님):
        """서버가 막 깨어나면 시세 캐시가 텅 비어 있다. 그때 이 경로가
        빈손이라고 실패하면, 덤을 붙이려다 본체를 잃는다."""
        c, H = 손님
        r = c.get("/api/v1/portfolio/items?view_all=true&with_prices=true", headers=H)
        assert r.status_code == 200, r.text
        assert len(r.json()["items"]) == 2
        assert r.json()["prices"] == []
