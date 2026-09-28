"""계정을 지우면 그 사람의 데이터가 **실제로** 다 지워지는가.

개인정보처리방침은 '탈퇴 시 지체 없이 파기' 를 약속한다. 예전 삭제
목록에는 전략·백테스트 기록·가격 알림·스크리닝 프리셋·자산배분 실험
등이 빠져 있어, 계정은 사라져도 그 사람의 데이터는 남았다.
"""
from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.db.database import Base, engine, SessionLocal
from app.models.user import User
from app.models import stock as S


모델들 = (S.BacktestResult, S.Strategy, S.PriceAlert, S.ScreeningPreset, S.QuantScoreWeight,
          S.PortfolioSnapshot, S.WatchlistFolder, S.PortfolioExperiment)


def _그사람것_치우기(s, uid):
    for 모델 in 모델들:
        s.query(모델).filter(모델.user_id == uid).delete(synchronize_session=False)
    s.commit()


@pytest.fixture
def 준비():
    Base.metadata.create_all(bind=engine)
    s = SessionLocal()
    for 옛사람 in s.query(User).filter(User.username.in_(["del_admin_x", "del_target_x"])).all():
        _그사람것_치우기(s, 옛사람.id)
        s.delete(옛사람)
    s.commit()
    관리자 = User(username="del_admin_x", hashed_password="x", is_admin=True)
    대상 = User(username="del_target_x", hashed_password="x")
    s.add_all([관리자, 대상]); s.commit()
    uid = 대상.id
    #: 검사용 sqlite 는 실행 사이에 남는다. 앞 실행이 남긴 행이 같은 번호의
    #  새 사용자에게 붙어 있으면 유일 제약에 걸린다 — 먼저 치운다.
    _그사람것_치우기(s, uid)
    전략 = S.Strategy(name="전략", user_id=uid)
    s.add(전략); s.commit()
    s.add_all([
        S.BacktestResult(symbol="SPY", user_id=uid, strategy_id=전략.id),
        S.PriceAlert(user_id=uid, symbol="SPY", market="US", direction="above", target=1),
        S.ScreeningPreset(name="p", user_id=uid, market="US", filters={}, sort_by="per"),
        S.QuantScoreWeight(user_id=uid, weights={}),
        S.PortfolioSnapshot(user_id=uid, day=date(2026, 1, 1), total_value=1, total_cost=1),
        S.WatchlistFolder(name="f", user_id=uid),
        S.PortfolioExperiment(user_id=uid, name="e", initial_amount=1, start_date="2020-01-01",
                              end_date="2021-01-01", assets=[]),
    ])
    s.commit()
    관리자id = 관리자.id
    s.close()

    from app.api.routes import admin as A
    class 관리자흉내:
        id = 관리자id
        is_admin = True
        username = "del_admin_x"
    app.dependency_overrides[A.require_admin] = lambda: 관리자흉내()
    yield TestClient(app), uid
    app.dependency_overrides.pop(A.require_admin, None)
    s = SessionLocal()
    _그사람것_치우기(s, uid)
    s.query(User).filter(User.username.in_(["del_admin_x", "del_target_x"])).delete(synchronize_session=False)
    s.commit(); s.close()


def test_계정을_지우면_딸린_데이터가_하나도_안_남는다(준비):
    client, uid = 준비
    r = client.delete(f"/api/v1/admin/users/{uid}")
    assert r.status_code == 200, r.text
    s = SessionLocal()
    try:
        남은것 = {}
        for 모델 in 모델들:
            n = s.query(모델).filter(모델.user_id == uid).count()
            if n:
                남은것[모델.__tablename__] = n
        assert not 남은것, f"탈퇴했는데 남은 데이터: {남은것}"
        assert s.query(User).filter(User.id == uid).count() == 0
    finally:
        s.close()
