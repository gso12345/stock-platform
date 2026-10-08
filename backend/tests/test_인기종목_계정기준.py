"""
사용자 보고: "관리자 인기종목 TOP10 보유종목 기준을 계정으로 해줘"

화면은 'N명' 이라고 적는데 서버는 보유 **줄** 수를 셌다. 한 사람이
포트폴리오 셋에 같은 종목을 담으면 3명이 됐다. 게다가 이름까지 묶음
기준에 넣어서, 같은 종목이 이름이 다르게 저장돼 있으면 두 줄로 쪼개져
따로 셌다. 관심종목도 같은 화면·같은 'N명' 이라 함께 계정 기준으로 센다.
"""
from datetime import datetime, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import app.main  # noqa: F401  — 모든 표를 Base 에 올린다
from app.db.database import Base
from app.models.user import User
from app.models.stock import Portfolio, PortfolioItem, Watchlist, WatchlistItem
from app.api.routes import admin as A


@pytest.fixture
def db(tmp_path):
    엔진 = create_engine(f"sqlite:///{tmp_path}/인기.db")
    Base.metadata.create_all(bind=엔진)
    s = sessionmaker(bind=엔진)()
    yield s
    s.close()
    엔진.dispose()


def 사람(db, 이름, 탈퇴=False) -> User:
    u = User(username=이름, hashed_password="x",
             withdrawn_at=datetime.now(timezone.utc) if 탈퇴 else None)
    db.add(u)
    db.commit()
    return u


def 보유(db, u: User, 종목들: list[tuple]) -> None:
    """종목들: (포트폴리오 이름, 종목코드, 시장, 이름)"""
    포트폴리오 = {}
    for pf, sym, mkt, name in 종목들:
        if pf not in 포트폴리오:
            포트폴리오[pf] = Portfolio(name=pf, user_id=u.id)
            db.add(포트폴리오[pf])
            db.commit()
        db.add(PortfolioItem(user_id=u.id, portfolio_id=포트폴리오[pf].id, symbol=sym,
                             market=mkt, name=name, shares=1, avg_price=1))
    db.commit()


def 관심(db, u: User, 종목들: list[tuple]) -> None:
    wl = Watchlist(name="기본", user_id=u.id)
    db.add(wl)
    db.commit()
    for sym, mkt, name in 종목들:
        db.add(WatchlistItem(watchlist_id=wl.id, symbol=sym, market=mkt, name=name))
    db.commit()


def 인기(db, basis):
    return [(r["symbol"], r["count"]) for r in A.get_popular_stocks(basis=basis, db=db, _=None)]


class Test보유종목:
    def test_한_사람이_여러_포트폴리오에_담아도_한_명이다(self, db):
        가 = 사람(db, "가")
        보유(db, 가, [("연금", "005930", "KR", "삼성전자"),
                      ("ISA", "005930", "KR", "삼성전자"),
                      ("해외", "005930", "KR", "삼성전자"),
                      ("해외", "AAPL", "US", "Apple")])
        보유(db, 사람(db, "나"), [("기본", "AAPL", "US", "Apple")])
        # 예전 방식이면 삼성전자 3 · AAPL 2 — 삼성전자가 1등이었다
        assert 인기(db, "portfolio") == [("AAPL", 2), ("005930", 1)]

    def test_이름이_달라도_같은_종목은_한_줄이다(self, db):
        보유(db, 사람(db, "가"), [("기본", "005930", "KR", "삼성전자")])
        보유(db, 사람(db, "나"), [("기본", "005930", "KR", "")])
        보유(db, 사람(db, "다"), [("기본", "005930", "KR", "Samsung Electronics")])
        보유(db, 사람(db, "라"), [("기본", "005930", "KR", "삼성전자")])
        결과 = A.get_popular_stocks(basis="portfolio", db=db, _=None)
        assert len(결과) == 1
        assert 결과[0]["count"] == 4
        assert 결과[0]["name"] == "삼성전자"            # 가장 많이 쓰인 이름

    def test_한_사람이_같은_종목을_다른_이름으로_담아도_한_명이다(self, db):
        """줄을 세면 2, 사람을 세면 1 — 이름까지 묶음 기준이던 예전에는 두 줄로 갈렸다"""
        보유(db, 사람(db, "가"), [("연금", "005930", "KR", "삼성전자"),
                                  ("ISA", "005930", "KR", ""),
                                  ("해외", "005930.KS", "KR", "Samsung Electronics")])
        assert 인기(db, "portfolio") == [("005930", 1)]

    def test_국내_접미사가_붙어도_같은_종목이다(self, db):
        보유(db, 사람(db, "가"), [("기본", "005930", "KR", "삼성전자")])
        보유(db, 사람(db, "나"), [("기본", "005930.KS", "KR", "삼성전자")])
        assert 인기(db, "portfolio") == [("005930", 2)]

    def test_해외_ETF_는_US_로_담겨도_ETF_로_담겨도_같다(self, db):
        보유(db, 사람(db, "가"), [("기본", "SPY", "US", "SPDR S&P 500")])
        보유(db, 사람(db, "나"), [("기본", "SPY", "ETF", "SPDR S&P 500")])
        assert 인기(db, "portfolio") == [("SPY", 2)]

    def test_탈퇴한_계정은_세지_않는다(self, db):
        보유(db, 사람(db, "가"), [("기본", "AAPL", "US", "Apple")])
        보유(db, 사람(db, "떠난사람", 탈퇴=True), [("기본", "AAPL", "US", "Apple"),
                                                   ("기본", "TSLA", "US", "Tesla")])
        assert 인기(db, "portfolio") == [("AAPL", 1)]

    def test_많은_순으로_열_개까지(self, db):
        사람들 = [사람(db, f"p{i}") for i in range(12)]
        for i, u in enumerate(사람들):
            # 종목 Ti 는 i+1 명이 가진다
            보유(db, u, [("기본", f"T{j:02d}", "US", f"종목{j}") for j in range(i + 1)])
        결과 = 인기(db, "portfolio")
        assert len(결과) == 10
        assert [c for _, c in 결과] == sorted([c for _, c in 결과], reverse=True)
        assert 결과[0] == ("T00", 12)

    def test_이름이_비어_있으면_종목_목록에서_채운다(self, db, monkeypatch):
        monkeypatch.setattr("app.services.ticker_service.get_kr_db",
                            lambda: [{"s": "005930.KS", "c": "005930", "n": "삼성전자"}])
        보유(db, 사람(db, "가"), [("기본", "005930", "KR", "")])
        assert A.get_popular_stocks(basis="portfolio", db=db, _=None)[0]["name"] == "삼성전자"


class Test관심종목도_계정_기준:
    def test_한_사람이_폴더_여럿에_담아도_한_명이다(self, db):
        가 = 사람(db, "가")
        관심(db, 가, [("NVDA", "US", "NVIDIA"), ("NVDA", "US", "NVIDIA"), ("005930", "KR", "삼성전자")])
        관심(db, 사람(db, "나"), [("005930", "KR", "삼성전자")])
        assert 인기(db, "watchlist") == [("005930", 2), ("NVDA", 1)]

    def test_주인_없는_옛_관심목록은_세지_않는다(self, db):
        wl = Watchlist(name="옛것", user_id=None)
        db.add(wl)
        db.commit()
        db.add(WatchlistItem(watchlist_id=wl.id, symbol="AAPL", market="US", name="Apple"))
        db.commit()
        관심(db, 사람(db, "가"), [("MSFT", "US", "Microsoft")])
        assert 인기(db, "watchlist") == [("MSFT", 1)]
