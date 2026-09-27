"""운용보수와 매도세가 **맞게, 그리고 실제로** 결과에 닿는가.

운용보수 — 담은 자산에서 날마다 조금씩 빠진다(현금은 안 빠진다).
매도세   — 리밸런싱에서 **판 금액에만** 붙는다. 사는 쪽에는 없다.
"""
from datetime import date, timedelta
import math

import pytest

from app.services import portfolio_backtest as P
from test_자산배분_설정이_실제로_먹나 import (  # noqa: F401 — 가짜 시세·제한 해제
    _가짜시세, _횟수제한_지우기, client, 몸,
)


def _날들(부터: date, 까지: date) -> list[date]:
    나온것, d = [], 부터
    while d <= 까지:
        if d.weekday() < 5:
            나온것.append(d)
        d += timedelta(days=1)
    return 나온것


날들 = _날들(date(2020, 1, 1), date(2020, 12, 31))
평평 = {d: 100.0 for d in 날들}


def test_운용보수는_한해에_그_비율만큼_빠진다():
    r = P.돌리기({"A": 평평}, [{"symbol": "A", "weight": 1}], 1_000_000, 운용보수=0.01)
    햇수 = (날들[-1] - 날들[0]).days / 365.25
    기대 = 1_000_000 * (1 - 0.01) ** 햇수
    assert r["final_value"] == pytest.approx(기대, rel=1e-6)
    assert r["fees"] == pytest.approx(1_000_000 - 기대, rel=1e-4)
    assert r["fee_rate"] == 0.01


def test_운용보수는_현금에서_안_빠진다():
    r = P.돌리기({"A": 평평}, [{"symbol": "A", "weight": 50}, {"symbol": "현금", "weight": 50}],
                 1_000_000, 운용보수=0.01)
    햇수 = (날들[-1] - 날들[0]).days / 365.25
    assert r["final_value"] == pytest.approx(500_000 + 500_000 * 0.99 ** 햇수, rel=1e-6)


def test_안_넣으면_None이다_0원이_아니다():
    r = P.돌리기({"A": 평평}, [{"symbol": "A", "weight": 1}], 1_000_000)
    assert r["fees"] is None and r["taxes"] is None


def _갈라지는표():
    """A 는 오르고 B 는 제자리 — 리밸런싱 때마다 A 를 판다"""
    return {"A": {d: 100.0 * (1.002 ** i) for i, d in enumerate(날들)}, "B": 평평}


def test_매도세는_판_금액에만_붙는다():
    자산 = [{"symbol": "A", "weight": 50}, {"symbol": "B", "weight": 50}]
    없음 = P.돌리기(_갈라지는표(), 자산, 1_000_000, 리밸런싱="quarterly")
    있음 = P.돌리기(_갈라지는표(), 자산, 1_000_000, 리밸런싱="quarterly", 매도세=0.01)
    assert 있음["taxes"] > 0
    assert 있음["final_value"] < 없음["final_value"]

    # 첫 리밸런싱 한 번만 손으로 재 본다: 그날 A 가 목표보다 넘친 만큼 × 1%
    리밸날 = sorted(P.주기날들(날들, "quarterly", 1))[0]
    i = 날들.index(리밸날)
    a값 = 500_000 * (1.002 ** i)
    넘친것 = (a값 - (a값 + 500_000) / 2)
    한번만 = P.돌리기({s: {d: v for d, v in 표.items() if d <= 리밸날} for s, 표 in _갈라지는표().items()},
                      자산, 1_000_000, 리밸런싱="quarterly", 매도세=0.01)
    assert 한번만["taxes"] == pytest.approx(넘친것 * 0.01, abs=0.01)


def test_리밸런싱이_없으면_매도세도_없다():
    자산 = [{"symbol": "A", "weight": 50}, {"symbol": "B", "weight": 50}]
    r = P.돌리기(_갈라지는표(), 자산, 1_000_000, 매도세=0.01)
    assert r["taxes"] == 0


# ── 라우트: 퍼센트로 받아 엔진까지 닿는가 ────────────────────────

@pytest.mark.parametrize("칸", ["expense_ratio", "sell_tax"])
def test_화면_설정이_결과를_바꾼다(client, 칸):
    기본 = dict(rebalance_period="monthly")
    r0 = client.post("/api/v1/backtest/portfolio", json=몸(**기본)).json()
    r1 = client.post("/api/v1/backtest/portfolio", json=몸(**기본, **{칸: 1})).json()
    assert r1["final_value"] < r0["final_value"], f"{칸} 을 1% 로 올렸는데 결과가 그대로다"


def test_퍼센트를_비율로_나눠_넘긴다(client):
    r = client.post("/api/v1/backtest/portfolio", json=몸(expense_ratio=0.5, sell_tax=0.2,
                                                          rebalance_period="monthly")).json()
    assert r["fee_rate"] == pytest.approx(0.005)
    assert r["tax_rate"] == pytest.approx(0.002)


def test_벤치마크도_같은_조건으로_돈다(client, monkeypatch):
    받은것 = []
    원래 = P.돌리기
    monkeypatch.setattr(P, "돌리기", lambda *a, **k: 받은것.append(k) or 원래(*a, **k))
    client.post("/api/v1/backtest/portfolio", json=몸(benchmark="spy", expense_ratio=0.5, sell_tax=0.2))
    assert len(받은것) == 2
    assert all(k["운용보수"] == pytest.approx(0.005) and k["매도세"] == pytest.approx(0.002) for k in 받은것)


def test_너무_큰_값은_막는다(client):
    assert client.post("/api/v1/backtest/portfolio", json=몸(expense_ratio=50)).status_code == 422
    assert client.post("/api/v1/backtest/portfolio", json=몸(sell_tax=-1)).status_code == 422
