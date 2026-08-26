"""배당 달력 — 언제 얼마를 주는가.

지금까지 배당은 '배당수익률 2.1%' 라는 숫자 하나뿐이었다. 배당을 보고
사는 사람이 정작 알고 싶은 것은 **언제** 들어오느냐다.

이 기능이 조용히 망가지는 방식은 셋이다.

  1) 지난 날짜를 '다음 배당' 이라고 말한다. 야후는 지난 회차의
     ex-date 를 그대로 남겨 두는 일이 잦고, 마지막 배당일에 주기를
     한 번만 더하면 오래 안 들여다본 종목은 과거가 나온다.
  2) 추정을 확정처럼 말한다. '8월 12일에 들어온다' 와 '8월 중순쯤일
     것 같다' 는 다른 말이다.
  3) 조회가 폭발한다. 종목 하나에 HTTP 두 번인데 보유 20종목이면
     40번이다. 0.15 CPU 서버에서 한 요청에 그걸 다 하면 화면이 멈춘다.
"""
from datetime import date, timedelta

import pytest

from app.services import dividend_service as DV


def 날(뒤로: int) -> date:
    return date.today() - timedelta(days=뒤로)


@pytest.fixture(autouse=True)
def _치우기():
    from app.core.cache import cache
    from app.core import fetchcache
    yield
    DV.쉼.잊기()
    fetchcache.잊기()
    for 항목 in cache.keys_with_ttl():
        열쇠 = 항목.get("key") if isinstance(항목, dict) else 항목
        if isinstance(열쇠, str) and 열쇠.startswith("div:"):
            cache.delete(열쇠)


# ── 심볼 ─────────────────────────────────────────────────────
class Test심볼:
    @pytest.mark.parametrize("symbol, market, 기대", [
        ("005930", "KR", "005930.KS"),
        ("005930.KS", "KR", "005930.KS"),
        ("035720.KQ", "KR", "035720.KQ"),
        ("NVDA", "US", "NVDA"),
        ("SCHD", "ETF", "SCHD"),
    ])
    def test_국내는_접미사가_붙는다(self, symbol, market, 기대):
        assert DV._야후심볼(symbol, market) == 기대


# ── 주기 ─────────────────────────────────────────────────────
class Test주기:
    @pytest.mark.parametrize("간격, 기대", [
        (30, "월"), (91, "분기"), (182, "반기"), (365, "연"),
    ])
    def test_간격으로_주기를_읽는다(self, 간격, 기대):
        날들 = [날(간격 * i) for i in range(4, 0, -1)]
        assert DV._주기(날들) == 기대

    def test_특별배당_한_번이_주기를_흔들지_않는다(self):
        """삼성전자처럼 분기배당에 결산배당이 겹치면 간격 하나가 짧다."""
        날들 = [날(365), 날(274), 날(183), 날(180), 날(91)]   # 하나만 3일 간격
        assert DV._주기(날들) == "분기"

    def test_내역이_중간에_비어도_주기를_안_틀린다(self):
        """월배당 ETF 인데 야후 내역이 한 구간 통째로 비어 있는 경우.

        간격은 30·30·30·400 이 된다. 평균을 쓰면 122 라 '분기' 가
        되지만, 실제로는 매달 주는 종목이다. 가운데 값은 30 —
        한쪽으로 크게 튄 값 하나에 안 흔들린다."""
        날들 = [날(490), 날(90), 날(60), 날(30)]
        assert DV._주기(날들) == "월"

    def test_한_건뿐이면_모른다고_한다(self):
        assert DV._주기([날(30)]) is None
        assert DV._주기([]) is None


# ── 다음 날짜 ────────────────────────────────────────────────
class Test다음예상:
    def test_마지막_기준일에_주기를_더한다(self):
        마지막 = 날(30)
        assert DV._다음_예상(마지막, "분기") == 마지막 + timedelta(days=91)

    def test_지난_날짜가_나오면_올_때까지_민다(self):
        """오래 안 들여다본 종목은 한 번만 더해서는 과거가 나온다.
        달력에 지난 날짜가 '다음 배당' 으로 찍히는 것은 그냥 틀린 정보다."""
        결과 = DV._다음_예상(날(1000), "분기")
        assert 결과 is not None and 결과 >= date.today()

    def test_주기를_모르면_추정하지_않는다(self):
        assert DV._다음_예상(날(30), None) is None


# ── 한 종목 ──────────────────────────────────────────────────
class _가짜티커:
    def __init__(self, 내역=None, 달력=None, 터짐=False):
        self._내역, self._달력, self._터짐 = 내역 or [], 달력 or {}, 터짐

    @property
    def dividends(self):
        if self._터짐:
            raise RuntimeError("야후가 죽었다")
        import pandas as pd
        if not self._내역:
            return pd.Series(dtype=float)
        idx = pd.to_datetime([d for d, _ in self._내역])
        return pd.Series([v for _, v in self._내역], index=idx)

    @property
    def calendar(self):
        return self._달력


@pytest.fixture
def 야후(monkeypatch):
    """yfinance.Ticker 를 대역으로 바꾼다."""
    담김 = {"부른수": 0}

    def 놓기(티커):
        import yfinance as yf

        def _만들기(sym, *a, **k):
            담김["부른수"] += 1
            담김["마지막심볼"] = sym
            return 티커
        monkeypatch.setattr(yf, "Ticker", _만들기)
        return 담김
    return 놓기


class Test한종목:
    def test_지난_내역으로_주기와_다음_날짜를_낸다(self, 야후):
        내역 = [(날(365), 361.0), (날(274), 361.0), (날(183), 361.0), (날(91), 361.0)]
        야후(_가짜티커(내역))
        r = DV.한종목("005930", "KR")
        assert r["cycle"] == "분기"
        assert r["last_amount"] == 361.0
        assert r["per_year"] == pytest.approx(361.0 * 4)
        assert r["ex_date"] is None
        assert r["estimated_date"] >= date.today().isoformat()

    def test_회사가_공시한_날짜가_있으면_그걸_쓴다(self, 야후):
        """추정보다 공시가 옳다. 추정치는 그때 안 내보낸다 — 둘 다
        보내면 화면이 어느 쪽을 믿을지 정해야 한다."""
        앞날 = date.today() + timedelta(days=10)
        야후(_가짜티커([(날(91), 0.25), (날(1), 0.25)],
                       {"Ex-Dividend Date": 앞날, "Dividend Date": 앞날 + timedelta(days=14)}))
        r = DV.한종목("AAPL", "US")
        assert r["ex_date"] == 앞날.isoformat()
        assert r["pay_date"] == (앞날 + timedelta(days=14)).isoformat()
        assert r["estimated_date"] is None

    def test_이미_지난_공시일은_안_쓴다(self, 야후):
        """야후는 지난 회차를 그대로 남겨 두는 일이 잦다. 그걸 그대로
        내보내면 달력에 지난 날짜가 '다음 배당' 으로 찍힌다."""
        야후(_가짜티커([(날(180), 0.25), (날(90), 0.25)],
                       {"Ex-Dividend Date": 날(80), "Dividend Date": 날(60)}))
        r = DV.한종목("AAPL", "US")
        assert r["ex_date"] is None and r["pay_date"] is None
        assert r["estimated_date"] is not None      # 대신 추정으로 채운다

    def test_배당이_없으면_빈손이다(self, 야후):
        야후(_가짜티커([]))
        assert DV.한종목("NVDA", "US") == {}

    def test_야후가_죽어도_예외를_안_내보낸다(self, 야후):
        야후(_가짜티커(터짐=True))
        assert DV.한종목("AAPL", "US") == {}

    def test_두_번째부터는_안_물어본다(self, 야후):
        담김 = 야후(_가짜티커([(날(91), 1.0), (날(1), 1.0)]))
        DV.한종목("AAPL", "US")
        첫번 = 담김["부른수"]
        DV.한종목("AAPL", "US")
        assert 담김["부른수"] == 첫번, "담긴 값을 두고 또 받아 왔다"

    def test_국내_종목은_접미사를_붙여_묻는다(self, 야후):
        담김 = 야후(_가짜티커([(날(365), 361.0), (날(1), 361.0)]))
        DV.한종목("005930", "KR")
        assert 담김["마지막심볼"] == "005930.KS"

    def test_계속_실패하면_그만_물어본다(self, 야후):
        """배당을 아예 안 주는 종목이 훨씬 많다. 요청마다 다시 두드리면
        0.15 CPU 서버가 그것만 하다 끝난다."""
        담김 = 야후(_가짜티커(터짐=True))
        for _ in range(DV.쉼.쉼_기준 + 2):
            from app.core import fetchcache
            fetchcache.잊기(f"div:US:XYZ")      # 빈손 표시를 지워도
            DV.한종목("XYZ", "US")
        쉰뒤 = 담김["부른수"]
        from app.core import fetchcache
        fetchcache.잊기("div:US:XYZ")
        DV.한종목("XYZ", "US")
        assert 담김["부른수"] == 쉰뒤, "쉬어야 할 종목을 또 물어봤다"


# ── 달력 ─────────────────────────────────────────────────────
class Test달력:
    def test_날짜순으로_묶고_받을_돈을_낸다(self, 야후):
        from app.core.cache import cache
        늦은날 = (date.today() + timedelta(days=40)).isoformat()
        이른날 = (date.today() + timedelta(days=5)).isoformat()
        cache.set("div:KR:005930", {"symbol": "005930", "market": "KR", "recent": [],
                                    "per_year": 1444.0, "cycle": "분기",
                                    "last_date": 날(30).isoformat(), "last_amount": 361.0,
                                    "ex_date": None, "pay_date": None,
                                    "estimated_date": 늦은날}, 60)
        cache.set("div:US:AAPL", {"symbol": "AAPL", "market": "US", "recent": [],
                                  "per_year": 1.0, "cycle": "분기",
                                  "last_date": 날(30).isoformat(), "last_amount": 0.25,
                                  "ex_date": 이른날, "pay_date": None,
                                  "estimated_date": None}, 60)
        야후(_가짜티커([]))

        r = DV.달력([
            {"symbol": "005930", "market": "KR", "name": "삼성전자", "shares": 100},
            {"symbol": "AAPL", "market": "US", "name": "애플", "shares": 10},
        ])
        assert [x["symbol"] for x in r["items"]] == ["AAPL", "005930"]
        assert r["items"][0]["confirmed"] is True      # 공시된 날
        assert r["items"][1]["confirmed"] is False     # 추정한 날
        assert r["items"][1]["expected"] == pytest.approx(361.0 * 100)
        assert r["items"][1]["expected_year"] == pytest.approx(1444.0 * 100)

    def test_수량이_0이면_받을_돈을_안_낸다(self, 야후):
        """관심종목은 갖고 있지 않다. '0원 받는다' 고 쓰면 틀린 말이다."""
        from app.core.cache import cache
        cache.set("div:US:SCHD", {"symbol": "SCHD", "market": "ETF", "recent": [],
                                  "per_year": 1.0, "cycle": "분기",
                                  "last_date": 날(30).isoformat(), "last_amount": 0.25,
                                  "ex_date": (date.today() + timedelta(days=3)).isoformat(),
                                  "pay_date": None, "estimated_date": None}, 60)
        야후(_가짜티커([]))
        r = DV.달력([{"symbol": "SCHD", "market": "US", "name": "SCHD", "shares": 0}])
        assert r["items"][0]["expected"] is None
        assert r["items"][0]["expected_year"] is None

    def test_한_요청에_새로_받는_종목_수에_상한이_있다(self, 야후):
        """보유 20종목이면 HTTP 40번이다. 한 요청에 그걸 다 하면
        화면이 30초를 기다린다."""
        담김 = 야후(_가짜티커([(날(365), 1.0), (날(1), 1.0)]))
        보유 = [{"symbol": f"S{i}", "market": "US", "name": f"S{i}", "shares": 1}
                for i in range(DV.한번에 + 5)]
        r = DV.달력(보유)
        assert 담김["부른수"] <= DV.한번에
        assert r["pending"] >= 5           # 못 받은 수를 숨기지 않는다

    def test_아무것도_없어도_터지지_않는다(self):
        assert DV.달력([]) == {"items": [], "pending": 0}
        assert DV.달력(None) == {"items": [], "pending": 0}

    def test_날짜를_못_구한_종목은_달력에_안_넣는다(self, 야후):
        from app.core.cache import cache
        cache.set("div:US:OLD", {"symbol": "OLD", "market": "US", "recent": [],
                                 "per_year": 0, "cycle": None,
                                 "last_date": 날(900).isoformat(), "last_amount": 1.0,
                                 "ex_date": None, "pay_date": None,
                                 "estimated_date": None}, 60)
        야후(_가짜티커([]))
        assert DV.달력([{"symbol": "OLD", "market": "US", "name": "OLD", "shares": 1}])["items"] == []


class Test배관:
    def test_배당달력_경로가_있다(self):
        import inspect
        from app.api.routes import portfolio as P
        본문 = inspect.getsource(P)
        assert '@router.get("/dividends")' in 본문
        # 전 종목이 아니라 내 종목만 봐야 조회 수가 묶인다
        assert "PortfolioItem.user_id == current_user.id" in 본문
        assert "WatchlistItem" in 본문

    def test_현금은_배당_후보에서_뺀다(self):
        import inspect
        from app.api.routes import portfolio as P
        assert '(it.asset_class or "") == "현금"' in inspect.getsource(P.배당달력)
