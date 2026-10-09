"""
사용자 보고(2026-10-09): "해외종목 순위도 나오도록해줘"

해외 순위 카드가 통째로 비어 있었다. 순위표를 채우는 두 경로(인기·S&P500
갱신, 전종목 훑기)가 야후 일괄 시세(v7/quote) 하나에만 기대는데, 그 길은
crumb(인증 토큰)가 있어야 해서 서버가 crumb 을 못 받으면 아무것도 안 왔다.
그리고 표는 메모리에만 있어 서버가 다시 뜨면 처음부터 다시 쌓아야 했다.
왜 비었는지 볼 곳도 없었다.

  · 일괄 시세가 빈손이면 spark(crumb 없이 되는 길)로 받는다
  · spark 는 시가총액을 안 주므로 알던 시가총액을 지킨다
  · 마지막으로 제대로 만든 순위를 DB 에 남기고, 다시 뜨면 그것부터 깐다
  · 관리자 화면 '해외 순위표' 줄에 몇 종목을 어느 길로 받았는지 남긴다
"""
import asyncio

import pytest

from app.core import health
from app.core.cache import cache
from app.services import price_fetcher as pf
from app.services import ranking_service as rs

#: conftest 가 검사마다 '사진 남기기' 를 끈다 — 끄기 전의 진짜를 잡아 둔다
_진짜_사진_남기기 = rs._순위사진_남기기

T0 = 1_759_953_600        # 2025-10-08 16:00 뉴욕 무렵 — 지난 장
T1 = 1_760_040_000        # 그다음 장


# ── 가짜 야후 ────────────────────────────────────────────────
class _응답:
    def __init__(self, status: int, j=None):
        self.status_code = status
        self._j = j

    def json(self):
        if self._j is None:
            raise ValueError("JSON 아님")
        return self._j


class _가짜야후:
    """httpx.AsyncClient 자리에 놓는다. 답(판, 심볼들) → (상태, JSON)."""

    def __init__(self, 답):
        self.답 = 답
        self.물음: list = []

    def __call__(self, *a, **k):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, url, params=None, **k):
        판 = "v8" if "/v8/" in url else "v7"
        심볼들 = [s for s in (params or {}).get("symbols", "").split(",") if s]
        self.물음.append((판, 심볼들))
        상태, j = self.답(판, 심볼들)
        return _응답(상태, j)


def _v7(값: dict, t: int = T1, 거래량: int = 1234) -> dict:
    return {"spark": {"result": [
        {"symbol": s, "response": [{"meta": {
            "symbol": s, "regularMarketPrice": p, "chartPreviousClose": p - 2,
            "regularMarketTime": t, "regularMarketVolume": 거래량,
            "longName": f"{s} Inc.", "currency": "USD"}}]}
        for s, p in 값.items()], "error": None}}


def _v8(값: dict, t: int = T1) -> dict:
    return {s: {"symbol": s, "timestamp": [t - 60, t], "close": [p - 1, p],
                "chartPreviousClose": p - 2, "previousClose": None, "dataGranularity": 300}
            for s, p in 값.items()}


def _일괄시세_막기(monkeypatch):
    monkeypatch.setattr(pf, "_fetch_yf_quotes_authed_sync", lambda syms: None)

    async def 없음(syms):
        return None
    monkeypatch.setattr(pf, "_fetch_yf_quotes_raw", 없음)


# ── spark 읽기 ───────────────────────────────────────────────
class Test_spark_를_읽는다:
    def test_v7_모양(self):
        q = pf._parse_yf_spark(_v7({"AAPL": 230.0}))["AAPL"]
        assert q["price"] == 230.0 and q["prev_close"] == 228.0
        assert q["change"] == pytest.approx(2.0)
        assert q["change_rate"] == pytest.approx(2 / 228 * 100, abs=1e-3)
        assert q["regular_time"] == T1 and q["volume"] == 1234
        assert q["name"] == "AAPL Inc." and q["currency"] == "USD"

    def test_시가총액은_싣지_않는다(self):
        """0 으로 실으면 다른 데서 알던 시가총액을 덮는다"""
        for j in (_v7({"AAPL": 230.0}), _v8({"AAPL": 230.0})):
            assert "market_cap" not in pf._parse_yf_spark(j)["AAPL"]

    def test_v7_에_현재가가_없으면_마지막_종가(self):
        j = {"spark": {"result": [{"symbol": "MSFT", "response": [{
            "meta": {"symbol": "MSFT", "chartPreviousClose": 400.0, "regularMarketTime": T1},
            "indicators": {"quote": [{"close": [405.0, None, 410.0, None]}]}}]}]}}
        q = pf._parse_yf_spark(j)["MSFT"]
        assert q["price"] == 410.0 and q["change"] == pytest.approx(10.0)

    def test_v8_모양(self):
        q = pf._parse_yf_spark(_v8({"NVDA": 190.0}))["NVDA"]
        assert q["price"] == 190.0 and q["prev_close"] == 188.0
        assert q["regular_time"] == T1
        assert "volume" not in q, "모르는 거래량을 0 으로 실으면 거래량 순위에 0 이 앉는다"

    def test_값이_없는_줄과_엉뚱한_응답은_건너뛴다(self):
        j = {"spark": {"result": [
            {"symbol": "XXXX", "response": None},
            "엉뚱한 줄",
            {"symbol": "AAPL", "response": [{"meta": {"symbol": "AAPL", "regularMarketPrice": 1.0}}]},
        ]}}
        assert list(pf._parse_yf_spark(j)) == ["AAPL"]
        assert pf._parse_yf_spark(None) == {} and pf._parse_yf_spark([1, 2]) == {}
        assert pf._parse_yf_spark({"finance": {"result": None, "error": {"code": "x"}}}) == {}


# ── 야후 시세를 받는 차례 ────────────────────────────────────
class Test일괄시세가_빈손이면_spark:
    def test_일괄시세가_되면_spark_는_안_묻는다(self, monkeypatch):
        monkeypatch.setattr(pf, "_fetch_yf_quotes_authed_sync",
                            lambda syms: [{"symbol": "AAPL", "regularMarketPrice": 230.0,
                                           "marketCap": 3 * 10**12}])
        가짜 = _가짜야후(lambda 판, 심볼들: (200, _v7({"AAPL": 1.0})))
        monkeypatch.setattr(pf.httpx, "AsyncClient", 가짜)
        out = asyncio.run(pf.fetch_yf_quotes(["AAPL"]))
        assert out["AAPL"]["market_cap"] == 3 * 10**12
        assert 가짜.물음 == [] and pf.마지막_야후경로 == "인증 배치"

    def test_일괄시세가_막히면_spark_로_받는다(self, monkeypatch):
        _일괄시세_막기(monkeypatch)
        monkeypatch.setattr(pf.httpx, "AsyncClient",
                            _가짜야후(lambda 판, 심볼들: (200, _v7({s: 100.0 for s in 심볼들}))))
        out = asyncio.run(pf.fetch_yf_quotes(["AAPL", "MSFT"]))
        assert set(out) == {"AAPL", "MSFT"} and out["AAPL"]["price"] == 100.0
        assert pf.마지막_야후경로 == "spark(v7)"

    def test_다_막히면_없음으로_남긴다(self, monkeypatch):
        _일괄시세_막기(monkeypatch)
        monkeypatch.setattr(pf.httpx, "AsyncClient", _가짜야후(lambda 판, 심볼들: (429, None)))
        assert asyncio.run(pf.fetch_yf_quotes(["AAPL"])) == {}
        assert pf.마지막_야후경로 == "없음"


class Test막힌_길은_한동안_쉰다:
    def test_인증_배치가_오류면_한동안_건너뛴다(self, monkeypatch):
        """막힌 길을 묶음마다 다시 두드리면 묶음 시한(25초)을 거기서 다 써
        spark 까지 못 간다"""
        불림: list = []

        def 인증(syms):
            불림.append(1)
            raise RuntimeError("429")
        monkeypatch.setattr(pf, "_fetch_yf_quotes_authed_sync", 인증)

        async def 없음(syms):
            return None
        monkeypatch.setattr(pf, "_fetch_yf_quotes_raw", 없음)
        monkeypatch.setattr(pf, "_fetch_yf_spark", lambda syms: asyncio.sleep(0, {}))
        asyncio.run(pf.fetch_yf_quotes(["AAPL"]))
        asyncio.run(pf.fetch_yf_quotes(["AAPL"]))
        assert len(불림) == 1, "쉬어야 할 길을 또 두드렸다"
        # 쉬는 시간이 지나면 다시 묻는다
        monkeypatch.setattr(pf, "_인증_막힌때", pf._인증_막힌때 - pf.YF_AUTH_REST_SEC - 1)
        asyncio.run(pf.fetch_yf_quotes(["AAPL"]))
        assert len(불림) == 2

    def test_없는_종목이라_빈_것은_막힌_게_아니다(self, monkeypatch):
        불림: list = []
        monkeypatch.setattr(pf, "_fetch_yf_quotes_authed_sync",
                            lambda syms: 불림.append(1) or [])
        monkeypatch.setattr(pf, "_fetch_yf_quotes_raw", lambda syms: asyncio.sleep(0, None))
        monkeypatch.setattr(pf, "_fetch_yf_spark", lambda syms: asyncio.sleep(0, {}))
        asyncio.run(pf.fetch_yf_quotes(["ZZZZ"]))
        asyncio.run(pf.fetch_yf_quotes(["AAPL"]))
        assert len(불림) == 2

    def test_spark_가_막히면_한동안_안_묻는다(self, monkeypatch):
        가짜 = _가짜야후(lambda 판, 심볼들: (429, None))
        monkeypatch.setattr(pf.httpx, "AsyncClient", 가짜)
        assert asyncio.run(pf._fetch_yf_spark(["AAPL"])) == {}
        n = len(가짜.물음)
        assert n == 2, "v7 이 막히면 v8 을 한 번 찔러 본다"
        assert asyncio.run(pf._fetch_yf_spark(["AAPL"] * 30)) == {}
        assert len(가짜.물음) == n, "쉬는 동안 또 물었다"

    def test_여러_종목을_물었는데_하나도_안_오면_쉰다(self, monkeypatch):
        가짜 = _가짜야후(lambda 판, 심볼들: (200, {"spark": {"result": []}}))
        monkeypatch.setattr(pf.httpx, "AsyncClient", 가짜)
        asyncio.run(pf._fetch_yf_spark([f"S{i}" for i in range(40)]))
        assert len(가짜.물음) == 2, "첫 묶음이 빈손인데 나머지 묶음까지 물었다"
        asyncio.run(pf._fetch_yf_spark(["AAPL"]))
        assert len(가짜.물음) == 2

    def test_없는_종목_하나로는_쉬지_않는다(self, monkeypatch):
        """사람이 없는 종목을 찾아본 것 하나로 spark 가 10분씩 꺼지면 안 된다"""
        가짜 = _가짜야후(lambda 판, 심볼들: (404, None) if 심볼들 == ["ZZZZ"]
                         else (200, _v7({s: 1.0 for s in 심볼들})))
        monkeypatch.setattr(pf.httpx, "AsyncClient", 가짜)
        assert asyncio.run(pf._fetch_yf_spark(["ZZZZ"])) == {}
        assert asyncio.run(pf._fetch_yf_spark(["AAPL"]))["AAPL"]["price"] == 1.0


class Test_spark_묶음과_주소:
    def test_묶음으로_나눠_묻는다(self, monkeypatch):
        가짜 = _가짜야후(lambda 판, 심볼들: (200, _v7({s: 1.0 for s in 심볼들})))
        monkeypatch.setattr(pf.httpx, "AsyncClient", 가짜)
        심볼 = [f"S{i}" for i in range(45)]
        out = asyncio.run(pf._fetch_yf_spark(심볼))
        assert len(out) == 45
        assert [len(s) for _, s in 가짜.물음] == [pf.SPARK_BATCH, pf.SPARK_BATCH, 45 - 2 * pf.SPARK_BATCH]

    def test_v7_이_안_되면_v8_로_가고_기억한다(self, monkeypatch):
        가짜 = _가짜야후(lambda 판, 심볼들: (404, None) if 판 == "v7"
                         else (200, _v8({s: 5.0 for s in 심볼들})))
        monkeypatch.setattr(pf.httpx, "AsyncClient", 가짜)
        out = asyncio.run(pf._fetch_yf_spark([f"S{i}" for i in range(30)]))
        assert len(out) == 30
        assert [판 for 판, _ in 가짜.물음] == ["v7", "v8", "v8"], "된 쪽을 나머지 묶음에 안 썼다"
        asyncio.run(pf._fetch_yf_spark(["AAPL"]))
        assert 가짜.물음[-1][0] == "v8", "된 쪽을 기억하지 않는다"


# ── 시가총액을 지킨다 ───────────────────────────────────────
class Test알던_시가총액을_지킨다:
    def test_새_시세에_시가총액이_없으면_알던_것을_남긴다(self):
        cache.set("price:ZZTEST", {"symbol": "ZZTEST", "price": 10.0, "market_cap": 777}, 60)
        rs._시세_담기("ZZTEST", {"symbol": "ZZTEST", "price": 11.0}, 60)
        q = cache.get("price:ZZTEST")
        assert q["price"] == 11.0 and q["market_cap"] == 777
        rs._시세_담기("ZZTEST", {"symbol": "ZZTEST", "price": 12.0, "market_cap": 999}, 60)
        assert cache.get("price:ZZTEST")["market_cap"] == 999, "새 값이 이겨야 한다"
        cache.delete("price:ZZTEST")

    def test_인기_SP500_갱신도_지킨다(self, monkeypatch):
        from app.services import scheduler as S
        from app.core.config import settings
        monkeypatch.setattr(settings, "FINNHUB_API_KEY", "", raising=False)
        cache.set("price:AAPL", {"symbol": "AAPL", "price": 200.0, "market_cap": 3 * 10**12}, 60)

        async def spark뿐(심볼들):         # 시가총액 없이 온다
            return {s: {"symbol": s, "name": s, "price": 210.0, "change_rate": 1.0}
                    for s in 심볼들}
        monkeypatch.setattr(S, "fetch_yf_quotes", spark뿐)

        async def 안기다림(*a, **k):
            return None
        monkeypatch.setattr(S.asyncio, "sleep", 안기다림)
        asyncio.run(S.refresh_us_stocks())
        q = cache.get("price:AAPL")
        assert q["price"] == 210.0 and q["market_cap"] == 3 * 10**12


# ── 관리자 화면에 남긴다 ─────────────────────────────────────
def _해외순위표줄() -> dict:
    return {x["name"]: x for x in health.snapshot()}.get("해외 순위표") or {}


class Test관리자_화면에_남긴다:
    def test_받으면_몇_종목을_어느_길로(self):
        health.reset()
        rs._순위표_상태_남기기(1500, 1500, 6884, {"인증 배치": 10, "spark(v7)": 5})
        줄 = _해외순위표줄()
        assert 줄["streak"] == 0
        assert "1500/1500종목" in 줄["detail"] and "6884줄" in 줄["detail"]
        assert "인증 배치 10묶음" in 줄["detail"] and "spark(v7) 5묶음" in 줄["detail"]

    def test_못_받으면_실패로(self):
        health.reset()
        rs._순위표_상태_남기기(0, 1500, 0)
        줄 = _해외순위표줄()
        assert 줄["streak"] == 1 and "0/1500종목" in 줄["last_error"]

    def test_훑기가_끝나면_남긴다(self, monkeypatch):
        health.reset()
        monkeypatch.setattr(pf, "마지막_야후경로", pf.마지막_야후경로)
        monkeypatch.setattr(rs, "us_universe", lambda: ["AAPL", "MSFT"])
        monkeypatch.setattr(rs.memory, "has_headroom", lambda *a, **k: True)
        monkeypatch.setattr(rs, "_us_cursor", 0)

        async def 받기(심볼들):
            pf.마지막_야후경로 = "spark(v8)"
            return {s: {"symbol": s, "price": 1.0} for s in 심볼들}
        monkeypatch.setattr(pf, "fetch_yf_quotes", 받기)
        asyncio.run(rs.refresh_us_rows())
        assert "spark(v8) 1묶음" in _해외순위표줄()["detail"]

    def test_메모리가_모자라_건너뛰면_그것도_남긴다(self, monkeypatch):
        """여유가 늘 모자라면 해외 순위가 영영 안 서는데, 로그에만 남았다"""
        from app.services import scheduler as S
        health.reset()
        불림: list = []

        async def 훑기(*a, **k):
            불림.append(1)
            return 0
        monkeypatch.setattr(rs, "refresh_us_rows", 훑기)
        monkeypatch.setattr(S.memory, "has_headroom", lambda *a, **k: False)
        asyncio.run(S._미국순위표_돌리기())
        assert not 불림
        assert "메모리 여유가 없어 건너뜀" in _해외순위표줄()["last_error"]
        monkeypatch.setattr(S.memory, "has_headroom", lambda *a, **k: True)
        asyncio.run(S._미국순위표_돌리기())
        assert 불림 == [1]


# ── 거래량을 모르는 줄 ───────────────────────────────────────
class Test거래량을_모르면_거래_순위에서_뺀다:
    def test_거래량_0_은_모르는_것이다(self):
        줄들 = ([{"symbol": f"K{i}", "price": 10.0, "volume": 100 + i, "amount": 1000.0 + i,
                 "regular_time": T1} for i in range(rs.US_SESSION_MIN_ROWS)]
              + [{"symbol": "Z", "price": 10.0, "volume": 0, "amount": 0, "regular_time": T1}])
        for 분류 in ("거래량", "거래대금"):
            assert "Z" not in [r["symbol"] for r in rs._sort_us(줄들, 분류)], 분류


# ── 마지막 순위를 DB 에 남긴다 ───────────────────────────────
@pytest.fixture
def 사진DB(tmp_path, monkeypatch):
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from app.db import database
    from app.models.stock import RankingSnapshot
    엔진 = create_engine(f"sqlite:///{tmp_path}/사진.db")
    RankingSnapshot.__table__.create(엔진)
    monkeypatch.setattr(database, "SessionLocal", sessionmaker(bind=엔진))
    monkeypatch.setattr(rs, "_사진_불러옴", False)
    monkeypatch.setattr(rs, "_사진_남긴때", 0.0)
    monkeypatch.setattr(rs, "_순위사진_남기기", _진짜_사진_남기기)
    # 다른 검사가 캐시에 남긴 시세로 표가 서지 않게 대상을 좁힌다
    monkeypatch.setattr(rs, "us_universe", lambda: ["NVDA", "AAPL", "MSFT", "TSLA"])
    _다시_뜬_서버(monkeypatch)
    yield 엔진
    _다시_뜬_서버(monkeypatch)
    엔진.dispose()


def _다시_뜬_서버(monkeypatch) -> None:
    """서버가 새로 뜬 것과 같게 — 메모리에 든 순위·시세를 비운다(DB 는 그대로)."""
    cache.delete(rs.US_ROWS_CK)
    for c in rs.ALLOWED_CATEGORIES:
        cache.delete(f"rank:us:{c}")
    for s in ("NVDA", "AAPL", "MSFT", "TSLA"):
        cache.delete(f"price:{s}")
    monkeypatch.setattr(rs, "_사진_불러옴", False)


def _줄(sym, price, cap, rank, t=T0, **더):
    return {"symbol": sym, "name": f"{sym} Inc.", "price": price, "change": 1.0,
            "change_rate": 1.0, "volume": 1000, "amount": price * 1000,
            "market_cap": cap, "regular_time": t, "rank": rank, "as_of": t, **더}


def _지난순위() -> dict:
    return {
        "시가총액": [_줄("NVDA", 180.0, 4_400 * 10**9, 1), _줄("AAPL", 230.0, 3_500 * 10**9, 2),
                  _줄("MSFT", 450.0, 3_400 * 10**9, 3)],
        "상승률": [_줄("TSLA", 300.0, 900 * 10**9, 1)],
    }


def _읽기(엔진) -> dict:
    from sqlalchemy.orm import Session
    from app.models.stock import RankingSnapshot
    with Session(엔진) as db:
        줄 = db.get(RankingSnapshot, "US")
        return dict(줄.data) if 줄 else {}


class Test마지막_순위를_남긴다:
    def test_다시_뜨면_남긴_순위를_곧바로_보여_준다(self, 사진DB):
        rs._순위사진_쓰기("US", _지난순위())
        순위 = rs.get_us_rankings("시가총액")
        assert [r["symbol"] for r in 순위] == ["NVDA", "AAPL", "MSFT"]
        assert 순위[0]["as_of"] == T0, "언제 값인지가 빠졌다"

    def test_표도_그_종목들로_채운다(self, 사진DB):
        rs._순위사진_쓰기("US", _지난순위())
        assert rs.해외순위_사진_불러오기()
        표 = {r["symbol"]: r for r in cache.get(rs.US_ROWS_CK)}
        assert set(표) == {"NVDA", "AAPL", "MSFT", "TSLA"}
        assert 표["NVDA"]["market_cap"] == 4_400 * 10**9
        assert "rank" not in 표["NVDA"] and "as_of" not in 표["NVDA"]

    def test_한_번만_읽는다(self, 사진DB):
        rs._순위사진_쓰기("US", _지난순위())
        assert rs.해외순위_사진_불러오기() is True
        assert rs.해외순위_사진_불러오기() is False

    def test_새로_만든_순위를_덮지_않는다(self, 사진DB):
        rs._순위사진_쓰기("US", _지난순위())
        cache.set("rank:us:시가총액", [_줄("NEW", 1.0, 1, 1)], 300)
        rs.해외순위_사진_불러오기()
        assert cache.get("rank:us:시가총액")[0]["symbol"] == "NEW"

    def test_재시작_뒤_야후_일괄시세가_막혀도_시가총액_순위가_선다(self, 사진DB, monkeypatch):
        """이번 일의 한가운데 — 새 서버 + crumb 없음(spark 만 됨, 시가총액 없음)"""
        rs._순위사진_쓰기("US", _지난순위())
        _일괄시세_막기(monkeypatch)
        새값 = {"NVDA": 190.0, "AAPL": 220.0, "MSFT": 460.0}
        monkeypatch.setattr(pf.httpx, "AsyncClient", _가짜야후(
            lambda 판, 심볼들: (200, _v7({s: 새값[s] for s in 심볼들 if s in 새값}))))
        monkeypatch.setattr(rs, "us_universe", lambda: list(새값))
        monkeypatch.setattr(rs.memory, "has_headroom", lambda *a, **k: True)
        monkeypatch.setattr(rs, "_us_cursor", 0)
        health.reset()
        asyncio.run(rs.refresh_us_rows())

        순위 = rs.get_us_rankings("시가총액")
        # TSLA 는 남긴 상승률 순위에서 온 줄이다 — 시가총액을 알아서 함께 선다
        assert [r["symbol"] for r in 순위] == ["NVDA", "AAPL", "MSFT", "TSLA"]
        assert 순위[0]["price"] == 190.0, "새로 받은 가격이 아니다"
        assert 순위[0]["market_cap"] == 4_400 * 10**9, "알던 시가총액을 잃었다"
        assert 순위[0]["as_of"] == T1
        assert "spark(v7)" in _해외순위표줄()["detail"]

    def test_장중_재시작이면_인기_SP500_갱신도_남긴_순위부터_깐다(self, 사진DB, monkeypatch):
        """장중에 다시 뜨면 시작 갱신은 인기·S&P500 쪽이다(refresh_us_stocks).
        그쪽도 표를 쌓기 전에 남긴 순위를 깔아야 시가총액이 지켜진다"""
        from app.services import scheduler as S
        from app.core.config import settings
        rs._순위사진_쓰기("US", _지난순위())
        새값 = {"NVDA": 190.0, "AAPL": 220.0, "MSFT": 460.0,
               **{f"ZF{i}": 1.0 for i in range(rs.US_MIN_ROWS)}}
        monkeypatch.setattr(rs, "us_universe", lambda: list(새값))
        monkeypatch.setattr(S, "POPULAR_US", list(새값))
        monkeypatch.setattr("app.services.yf_service.SP500_SYMBOLS", [])
        monkeypatch.setattr(settings, "FINNHUB_API_KEY", "", raising=False)

        async def spark뿐(심볼들):         # 시가총액 없이 온다
            return {s: {"symbol": s, "name": s, "price": 새값[s], "change_rate": 1.0,
                        "regular_time": T1} for s in 심볼들 if s in 새값}
        monkeypatch.setattr(S, "fetch_yf_quotes", spark뿐)

        async def 안기다림(*a, **k):
            return None
        monkeypatch.setattr(S.asyncio, "sleep", 안기다림)
        try:
            asyncio.run(S.refresh_us_stocks())
            순위 = rs.get_us_rankings("시가총액")
            assert 순위[0]["symbol"] == "NVDA" and 순위[0]["price"] == 190.0
            assert 순위[0]["market_cap"] == 4_400 * 10**9
        finally:
            for s in 새값:
                cache.delete(f"price:{s}")

    def test_못_만든_분류는_남긴_것을_지우지_않는다(self, 사진DB):
        """spark 로만 받는 동안은 시가총액 순위가 안 선다 — 그걸로 덮으면
        남겨 둔 시가총액 순위가 사라진다"""
        rs._순위사진_쓰기("US", _지난순위())
        rs._순위사진_쓰기("US", {"시가총액": [], "상승률": [_줄("AAPL", 1.0, 1, 1)]})
        남은 = _읽기(사진DB)
        assert [r["symbol"] for r in 남은["시가총액"]] == ["NVDA", "AAPL", "MSFT"]
        assert 남은["상승률"][0]["symbol"] == "AAPL"

    def test_NaN_은_비운다(self, 사진DB):
        """Postgres JSON 은 NaN 을 못 받는다 — 한 줄 때문에 통째로 못 남긴다"""
        rs._순위사진_쓰기("US", {"상승률": [_줄("AAPL", 1.0, 1, 1, change_rate=float("nan"))]})
        assert _읽기(사진DB)["상승률"][0]["change_rate"] is None


class Test언제_남기나:
    def _기다려(self, 받음: list, n: int) -> None:
        import time
        끝 = time.time() + 3
        while len(받음) < n and time.time() < 끝:
            time.sleep(0.01)

    def test_읽기_전에는_안_쓰고_읽은_뒤에는_간격을_둔다(self, 사진DB, monkeypatch):
        받음: list = []
        monkeypatch.setattr(rs, "_순위사진_쓰기", lambda 시장, 모두: 받음.append(시장))
        rs._순위사진_남기기({"시가총액": [1]})
        self._기다려(받음, 1)
        assert 받음 == [], "DB 에 있던 것을 읽기도 전에 덮었다"
        rs.해외순위_사진_불러오기()
        rs._순위사진_남기기({"시가총액": [1]})
        self._기다려(받음, 1)
        rs._순위사진_남기기({"시가총액": [1]})          # 바로 또 — 간격 안
        self._기다려(받음, 2)
        assert 받음 == ["US"]

    def test_얇은_표로_만든_순위는_안_남긴다(self, monkeypatch):
        받음: list = []
        monkeypatch.setattr(rs, "_순위사진_남기기", lambda 모두: 받음.append(len(모두)))
        얇은표 = [{"symbol": f"S{i}", "price": 1.0, "market_cap": i + 1, "volume": 1, "amount": 1.0}
                for i in range(rs.US_SNAPSHOT_MIN_ROWS - 1)]
        rs._미국순위_모두_담기(얇은표)
        assert 받음 == []
        rs._미국순위_모두_담기(얇은표 + [{"symbol": "X", "price": 1.0, "market_cap": 1}])
        assert len(받음) == 1
