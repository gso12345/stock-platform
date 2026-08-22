"""시가총액 순위에서 삼성전자가 사라진 것.

시총은 '현재가 × 상장주식수' 로 직접 계산한다. 남이 준 시총 값을 안 쓰기로
한 이유는 전에 표의 옆 칸을 잘못 읽어 똑같이 삼성전자가 사라졌기 때문이다.

그런데 주식수가 파이썬 변수에만 있었다. DB 에 담지도, 읽지도 않았다.
평소 재시작은 DB 만 읽으므로(그게 kr_tickers 표를 만든 이유다) 재시작
직후에는 2,800 종목 전부 주식수가 0 이 된다.

계산이 안 되면 받아둔 시총으로 물러나는데, 여기서 두 번째 구멍이 났다.
물러날 곳을 '넘겨받은 dict' 안에서만 찾았다. 그 dict 가 실시간 시세면
시총 칸이 아예 없다 —

    p = (실시간 시세가 있으면 그것) or (목록과 함께 받아둔 것)

즉 사람이 많이 보는 종목일수록 실시간 시세가 채워져 있고, 그 종목만
시총이 0 이 되어 순위에서 빠졌다. 시가총액 1위가 가장 먼저 사라진다.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services import ranking_service as rs

삼성 = "005930.KS"


def 실시간시세(가격):
    """실시간 시세 응답의 모양 — 시총도 주식수도 없다."""
    return {"symbol": 삼성, "name": "삼성전자", "price": 가격,
            "change": 100, "change_rate": 0.1, "volume": 12_000_000,
            "high": 가격, "low": 가격, "open": 가격, "currency": "KRW"}


def 목록시세(가격, 주식수=0, 시총=0):
    """목록과 함께 받아 오는 모양 — 주식수와 시총이 들어 있다."""
    d = 실시간시세(가격)
    d["shares"] = 주식수
    d["market_cap"] = 시총
    return d


# ── 계산 ───────────────────────────────────────────────────
def test_주식수를_알면_직접_계산한다(monkeypatch):
    monkeypatch.setattr(rs, "상장주식수", lambda s: 0)
    assert rs._시가총액(삼성, 70_000, 목록시세(70_000, 주식수=5_969_782_550)) \
        == 70_000 * 5_969_782_550


def test_실시간_가격으로_계산해서_시총도_최신이_된다(monkeypatch):
    monkeypatch.setattr(rs, "상장주식수", lambda s: 5_000_000_000)
    어제 = rs._시가총액(삼성, 70_000, 실시간시세(70_000))
    오늘 = rs._시가총액(삼성, 77_000, 실시간시세(77_000))
    assert 오늘 > 어제


def test_주식수는_목록에서도_찾는다(monkeypatch):
    """실시간 시세에는 주식수가 없다 — 목록 쪽에서 가져와야 한다."""
    monkeypatch.setattr(rs, "상장주식수", lambda s: 5_969_782_550)
    assert rs._시가총액(삼성, 70_000, 실시간시세(70_000)) > 0


# ── 계산을 못 할 때 ────────────────────────────────────────
def test_주식수를_몰라도_0이_되지_않는다(monkeypatch):
    """이게 삼성전자가 사라진 자리다.

    실시간 시세에는 시총 칸이 없다. 넘겨받은 dict 안에서만 찾으면 0 이
    되고, 0 이면 시가총액 순위에서 통째로 빠진다."""
    monkeypatch.setattr(rs, "상장주식수", lambda s: 0)
    monkeypatch.setattr("app.services.ticker_service.get_fdr_price",
                        lambda s: 목록시세(70_000, 시총=418_000_000_000_000))

    결과 = rs._시가총액(삼성, 70_000, 실시간시세(70_000))
    assert 결과 == 418_000_000_000_000


def test_넘겨받은_것에_시총이_있으면_그걸_먼저_쓴다(monkeypatch):
    monkeypatch.setattr(rs, "상장주식수", lambda s: 0)
    monkeypatch.setattr("app.services.ticker_service.get_fdr_price",
                        lambda s: 목록시세(70_000, 시총=999))
    assert rs._시가총액(삼성, 70_000, 목록시세(70_000, 시총=418)) == 418


def test_아무_데도_없으면_0(monkeypatch):
    """지어내지는 않는다."""
    monkeypatch.setattr(rs, "상장주식수", lambda s: 0)
    monkeypatch.setattr("app.services.ticker_service.get_fdr_price", lambda s: None)
    assert rs._시가총액(삼성, 70_000, 실시간시세(70_000)) == 0


def test_가격이_0이면_계산하지_않는다(monkeypatch):
    monkeypatch.setattr(rs, "상장주식수", lambda s: 5_969_782_550)
    monkeypatch.setattr("app.services.ticker_service.get_fdr_price", lambda s: None)
    assert rs._시가총액(삼성, 0, 실시간시세(0)) == 0


# ── 순위표에서 사라지지 않는가 ─────────────────────────────
def test_시가총액_1위가_순위표_1위로_나온다(monkeypatch):
    """끝에서 끝까지 — 실시간 시세가 있는 종목이 사라지지 않는지."""
    monkeypatch.setattr(rs, "상장주식수", lambda s: 0)
    큰것 = {"삼성전자": 418_000_000_000_000, "SK하이닉스": 150_000_000_000_000,
            "작은회사": 5_000_000_000}
    이름으로 = {f"00{i}.KS": n for i, n in enumerate(큰것)}
    monkeypatch.setattr("app.services.ticker_service.get_fdr_price",
                        lambda s: {"market_cap": 큰것[이름으로[s]]} if s in 이름으로 else None)

    행 = []
    for sym, 이름 in 이름으로.items():
        # 실시간 시세만 있는 상황 — 시총 칸이 없다
        p = 실시간시세(70_000)
        행.append({"symbol": sym, "name": 이름, "price": 70_000,
                   "market_cap": rs._시가총액(sym, 70_000, p)})

    결과 = rs._sort_kr(행, "시가총액")
    assert [r["name"] for r in 결과] == ["삼성전자", "SK하이닉스", "작은회사"]
    assert 결과[0]["rank"] == 1


def test_시총이_0이면_순위표에서_빠진다는_것을_확인():
    """왜 0 이 위험한지 — 뒤로 밀리는 게 아니라 100위 밖으로 나간다."""
    행 = [{"symbol": f"{i}.KS", "name": f"종목{i}", "price": 1000,
           "market_cap": 1_000_000 * (200 - i)} for i in range(150)]
    행.append({"symbol": "005930.KS", "name": "삼성전자", "price": 70_000,
               "market_cap": 0})
    결과 = rs._sort_kr(행, "시가총액")
    assert len(결과) == 100
    assert "삼성전자" not in [r["name"] for r in 결과]


# ── DB 왕복 ────────────────────────────────────────────────
@pytest.mark.skipif(
    __import__("importlib.util", fromlist=["util"]).find_spec("sqlalchemy") is None,
    reason="이 환경에는 sqlalchemy 가 없다")
def test_주식수가_DB_모델에_있다():
    from app.models.stock import KrTicker
    assert hasattr(KrTicker, "shares")


def test_주식수_컬럼이_모델_소스에_적혀_있다():
    """sqlalchemy 가 없는 환경에서도 확인할 수 있어야 한다."""
    본문 = open(os.path.join(os.path.dirname(__file__), "..", "app", "models",
                             "stock.py"), encoding="utf-8").read()
    표 = 본문[본문.index("__tablename__ = \"kr_tickers\""):]
    표 = 표[:표.index("class ", 10)]
    assert "shares      = Column(Float" in 표


def test_저장할_때_주식수를_담는다():
    본문 = open(os.path.join(os.path.dirname(__file__), "..", "app", "services",
                             "ticker_service.py"), encoding="utf-8").read()
    저장 = 본문[본문.index("def _save_kr_to_db"):]
    저장 = 저장[:저장.index("\ndef ", 10)]
    assert '"shares": p.get("shares")' in 저장


def test_읽을_때_주식수를_되살린다():
    """담기만 하고 안 읽으면 아무것도 달라지지 않는다."""
    본문 = open(os.path.join(os.path.dirname(__file__), "..", "app", "services",
                             "ticker_service.py"), encoding="utf-8").read()
    읽기 = 본문[본문.index("def _load_kr_from_db"):]
    읽기 = 읽기[:읽기.index("\ndef ", 10)]
    assert "r.shares" in 읽기


def test_이미_있는_표에도_컬럼을_더한다():
    """create_all 은 없는 표만 만들고 기존 컬럼은 안 건드린다.
    이미 배포된 kr_tickers 에는 따로 더해 줘야 한다."""
    본문 = open(os.path.join(os.path.dirname(__file__), "..", "app", "main.py"),
                encoding="utf-8").read()
    assert '_add_col_if_missing("kr_tickers", "shares"' in 본문
    허용 = 본문[본문.index("_ALLOWED_MIGRATE_TABLES"):]
    허용 = 허용[:허용.index("\n")]
    assert "kr_tickers" in 허용, "허용 목록에 없으면 조용히 건너뛴다"
