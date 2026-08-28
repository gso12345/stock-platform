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

    def test_주배당을_월배당과_구분한다(self):
        """APLY·NVDY 같은 주배당 ETF 가 늘었다. '월' 로 묶으면 한 달에
        네 번 받는 것을 한 번으로 세어 예상액이 4분의 1이 된다."""
        날들 = [날(28), 날(21), 날(14), 날(7)]
        assert DV._주기(날들) == "주"
        assert DV._한달회차["주"] > 4

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

    def test_몇_월에_주는지_적는다(self, 야후):
        """분기배당이라도 회사마다 달이 다르다(2·5·8·11 vs 3·6·9·12).
        안 적으면 한 해 계획을 못 세운다."""
        from datetime import date as _d
        내역 = [(_d(2026, 2, 10), 100.0), (_d(2026, 5, 10), 100.0),
                (_d(2026, 8, 10), 100.0), (_d(2026, 11, 10), 100.0)]
        야후(_가짜티커(내역))
        r = DV.한종목("GD", "US")
        assert r["months"] == [2, 5, 8, 11]
        assert r["per_month"] == 1.0
        assert r["currency"] == "USD"

    def test_주배당은_열두_달_전부다(self, 야후):
        야후(_가짜티커([(날(28), 1.0), (날(21), 1.0), (날(14), 1.0), (날(7), 1.0)]))
        r = DV.한종목("APLY", "US")
        assert r["cycle"] == "주"
        assert r["months"] == list(range(1, 13))
        assert r["per_month"] > 4

    def test_국내_종목은_원화로_표시한다(self, 야후):
        야후(_가짜티커([(날(365), 361.0), (날(1), 361.0)]))
        assert DV.한종목("005930", "KR")["currency"] == "KRW"

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

    def test_현금은_배당_후보에서_뺀다(self):
        import inspect
        from app.api.routes import portfolio as P
        assert '(it.asset_class or "") == "현금"' in inspect.getsource(P.배당달력)

    def test_고른_포트폴리오만_본다(self):
        """탭이 여럿인 사람에게 전부 섞어서 보여 주면 어느 계좌의
        배당인지 알 수 없다."""
        import inspect
        본문 = inspect.getsource(__import__("app.api.routes.portfolio",
                                            fromlist=["배당달력"]).배당달력)
        assert "portfolio_id" in 본문
        assert "PortfolioItem.portfolio_id == portfolio_id" in 본문
        # 남의 포트폴리오 번호를 넣어 들여다볼 수 없어야 한다
        assert "_valid_portfolio_id" in 본문

    def test_관심종목은_이제_안_넣는다(self):
        """살까 말까 하는 종목까지 넣으면 달력이 안 가진 종목으로
        뒤덮인다. 받을 돈도 못 적는다(수량이 0이다).

        배당 달력을 보는 이유는 '내가 언제 얼마를 받나' 다."""
        import inspect
        본문 = inspect.getsource(__import__("app.api.routes.portfolio",
                                            fromlist=["배당달력"]).배당달력)
        assert "WatchlistItem" not in 본문
        assert "include_watchlist" not in 본문


# ── 달마다 얼마·언제 ──────────────────────────────────────────
#
# 이게 없던 때는 마지막 회차 금액(last_amount) 하나를 열두 달에 다 썼다.
# 분기배당은 회차마다 금액이 다르다 — 결산배당이 붙는 분기가 특히 크다.
# 마지막 회차가 그 큰 회차면 한 해 예상이 통째로 부풀고, 작은 회차면
# 반대로 깎인다.
#
# 예: 0.20 / 0.25 / 0.30 / 0.35 를 주는 종목이면 한 해 1.10 인데,
# 마지막(0.35)을 네 번 곱하면 1.40 — 27% 를 더 받는 것으로 나온다.

class Test월별일정:
    def _일정(self, 내역):
        날들 = [d for d, _ in 내역]
        최근 = [{"date": d.isoformat(), "amount": a} for d, a in 내역]
        return DV._월별일정(최근, 날들, "분기")

    def test_달마다_그_달_실제_금액을_쓴다(self):
        """네 회차 금액이 다 다른 종목. 마지막 회차를 네 번 곱하면
        1.40 이 되지만 실제로는 1.10 이다.

        날짜를 해로 못 박는다 — 오늘로부터 며칠 전으로 잡으면 달이
        오늘 날짜에 따라 달라져서 어느 달에 얼마인지를 검사할 수 없다."""
        해 = date.today().year - 1
        내역 = [(date(해, 3, 25), 0.20), (date(해, 6, 25), 0.25),
                (date(해, 9, 25), 0.30), (date(해, 12, 25), 0.35)]
        일정 = self._일정(내역)
        assert {x["month"]: x["amount"] for x in 일정} == {
            3: pytest.approx(0.20), 6: pytest.approx(0.25),
            9: pytest.approx(0.30), 12: pytest.approx(0.35),
        }
        assert sum(x["amount"] for x in 일정) == pytest.approx(1.10)
        # 마지막 회차 × 4 로 어림하던 옛 방식과 확실히 다르다
        assert sum(x["amount"] for x in 일정) != pytest.approx(0.35 * 4)

    def test_그_달에_준_날을_같이_준다(self):
        """'3월' 이라고만 적으면 언제 사야 받는지 알 수 없다."""
        내역 = [(date(date.today().year - 1, 3, 25), 0.25)]
        일정 = DV._월별일정(
            [{"date": d.isoformat(), "amount": a} for d, a in 내역],
            [d for d, _ in 내역], "분기")
        칸 = 일정[0]
        assert (칸["month"], 칸["day"], 칸["amount"]) == (3, 25, 0.25)
        assert 칸["actual"] is True
        # 작년 3월 지급뿐이니 올해 확정은 아니다 — 화면이 그렇게 적어야 한다
        assert 칸["year"] == date.today().year - 1
        assert 칸["올해확정"] is False
        # 그 달에 며칠에 얼마씩 받았는지도 같이 온다(주배당을 위해)
        assert [x["amount"] for x in 칸["days"]] == [0.25]

    def test_한_달에_여러_번_주면_합친다(self):
        """주배당·월배당은 한 달에 여러 번 들어온다. 하나만 세면
        그 달 금액이 4분의 1로 줄어든다."""
        해 = date.today().year - 1
        내역 = [(date(해, 5, d), 0.06) for d in (2, 9, 16, 23)]
        일정 = DV._월별일정(
            [{"date": d.isoformat(), "amount": a} for d, a in 내역],
            [d for d, _ in 내역], "주")
        assert len(일정) == 1
        assert 일정[0]["amount"] == pytest.approx(0.24)

    def test_두_해가_있으면_최근_해만_쓴다(self):
        """두 해를 다 더하면 그 달 금액이 두 배가 된다."""
        올 = date.today().year - 1
        전 = date.today().year - 2
        내역 = [(date(전, 3, 25), 0.20), (date(올, 3, 25), 0.30)]
        일정 = DV._월별일정(
            [{"date": d.isoformat(), "amount": a} for d, a in 내역],
            [d for d, _ in 내역], "분기")
        assert len(일정) == 1
        assert 일정[0]["amount"] == pytest.approx(0.30)
        assert 일정[0]["year"] == 올

    def test_아주_오래된_것은_안_본다(self):
        """5년 전에 주다 만 달이 배당월로 살아나면 안 된다."""
        옛날 = date.today().replace(year=date.today().year - 5)
        일정 = DV._월별일정([{"date": 옛날.isoformat(), "amount": 1.0}], [옛날], "연")
        assert 일정 == []

    def test_내역이_없으면_빈_목록(self):
        assert DV._월별일정([], [], "분기") == []


class Test다음일정:
    def test_실제로_준_달과_날을_그대로_쓴다(self):
        """예전에는 '마지막 기준일 + 91일' 이었다. 네 번 밀면 364일이라
        한 해에 하루씩 앞당겨지고, 몇 해 지나면 달이 바뀐다 —
        3월 말에 주던 종목이 4월로 넘어간다."""
        오늘 = date(2026, 5, 10)
        일정 = [{"month": 3, "day": 31}, {"month": 6, "day": 30},
                {"month": 9, "day": 30}, {"month": 12, "day": 31}]
        assert DV._다음_일정(일정, 오늘) == date(2026, 6, 30)

    def test_올해_남은_게_없으면_내년_첫_회차(self):
        오늘 = date(2026, 12, 31)
        일정 = [{"month": 3, "day": 31}, {"month": 6, "day": 30}]
        assert DV._다음_일정(일정, 오늘) == date(2027, 3, 31)

    def test_오늘이_바로_그날이면_오늘이다(self):
        오늘 = date(2026, 6, 30)
        assert DV._다음_일정([{"month": 6, "day": 30}], 오늘) == 오늘

    def test_그_달에_없는_날은_그_달_끝으로_민다(self):
        """2월 30일 같은 날짜를 만들면 그 종목만 통째로 사라진다."""
        오늘 = date(2026, 1, 5)
        assert DV._다음_일정([{"month": 2, "day": 31}], 오늘) == date(2026, 2, 28)

    def test_일정이_없으면_모른다고_한다(self):
        assert DV._다음_일정([], date(2026, 5, 10)) is None


class Test한해계획:
    def test_plan_year_는_달마다_실제_금액의_합이다(self, 야후):
        """화면의 월별 막대를 다 더한 값과 같아야 한다. 다르면 같은
        화면 안에서 '연간 배당금' 과 막대 합이 서로 다른 말을 한다."""
        해 = date.today().year - 1
        내역 = [(date(해, 2, 28), 361.0), (date(해, 5, 31), 361.0),
                (date(해, 8, 31), 361.0), (date(해, 11, 30), 1083.0)]
        야후(_가짜티커(내역))
        r = DV.한종목("005930", "KR")
        assert r["plan_year"] == pytest.approx(361 * 3 + 1083)
        assert sum(x["amount"] for x in r["schedule"]) == pytest.approx(r["plan_year"])

    def test_반년_전에_시작한_종목도_한_해로_센다(self, 야후):
        """per_year(지난 1년 실제 합)만 쓰면 반년치라 절반으로 나온다."""
        내역 = [(날(150), 0.25), (날(60), 0.25)]
        야후(_가짜티커(내역))
        r = DV.한종목("SCHD", "ETF")
        assert r["per_year"] == pytest.approx(0.5)      # 실제로 받은 것
        assert r["plan_year"] == pytest.approx(0.5)     # 아직 두 달치뿐이라 같다
        assert len(r["schedule"]) == 2

    def test_다음_날짜를_주기가_아니라_달_패턴으로_잡는다(self, 야후, monkeypatch):
        """예전에는 '마지막 기준일 + 주기일수' 였다.

        반기배당(182일)을 두 번 밀면 하루씩 어긋난다. 네 번, 여섯 번
        밀수록 벌어져서 몇 해 지나면 달이 바뀐다 — 4월에 주던 종목이
        3월로 넘어가 버린다. 배당월 막대와 다음 배당일이 서로 다른
        달을 가리키게 되는 셈이다.

        오늘을 고정한다. 안 그러면 검사를 돌린 날에 따라 '주기로 민 날'
        과 '달 패턴으로 잡은 날' 이 우연히 같아져서, 옛 방식으로
        되돌려 놔도 안 걸리는 날이 생긴다(실제로 그랬다)."""
        class _고정날(date):
            @classmethod
            def today(cls):
                return date(2026, 8, 27)
        monkeypatch.setattr(DV, "date", _고정날)

        내역 = [(date(2024, 10, 20), 0.5), (date(2025, 4, 20), 0.5),
                (date(2025, 10, 20), 0.5)]
        야후(_가짜티커(내역))
        r = DV.한종목("ABBV", "US")

        assert r["cycle"] == "반기"
        예상 = date.fromisoformat(r["estimated_date"])
        # 실제로 준 날(10월 20일)이어야 한다
        assert (예상.month, 예상.day) == (10, 20), f"{예상} 은 실제로 준 날이 아니다"
        # 주기로 밀면 하루가 어긋난다 — 그 방식으로 되돌리면 여기서 걸린다
        주기로 = DV._다음_예상(내역[-1][0], r["cycle"])
        assert 예상 != 주기로, f"주기로 민 날({주기로})과 같다 — 달 패턴을 안 쓴 것이다"


class Test달력이쓰는한해:
    def test_한_해_예상을_plan_year_로_센다(self, 야후):
        """per_year(지난 1년 실제 합)를 쓰면 화면의 월별 막대 합계와
        다른 숫자가 나온다 — 같은 카드 안에서 두 값이 어긋난다.

        한 회차가 1년 밖으로 밀려난 종목으로 확인한다."""
        내역 = [(날(380), 0.25), (날(289), 0.25), (날(198), 0.25), (날(107), 0.25)]
        야후(_가짜티커(내역))
        정보 = DV.한종목("SCHD", "ETF")
        # 지난 1년에는 세 번뿐이지만, 한 해 계획은 네 번이다
        assert 정보["per_year"] == pytest.approx(0.75)
        assert 정보["plan_year"] == pytest.approx(1.0)

        답 = DV.달력([{"symbol": "SCHD", "market": "ETF", "name": "SCHD", "shares": 10}])
        줄 = 답["items"][0]
        assert 줄["expected_year"] == pytest.approx(10.0)     # 10주 × 1.0
        assert 줄["expected_year"] != pytest.approx(7.5)      # per_year 를 쓰면 이 값이다


class Test공개경로:
    """로그인 없이 한 종목 배당을 볼 수 있어야 한다.

    내 자산 화면의 미리보기(로그인 전)가 배당 탭을 보여 준다. 예전에는
    그 자리에 지어낸 예시를 넣었는데, 그러면 화면이 무엇을 할 수 있는지
    보여 주려다 **없는 값을 진짜처럼** 보여 주는 셈이 된다.
    """

    def test_경로가_있다(self):
        from app.main import app
        assert "/api/v1/stocks/{market}/{symbol}/dividends" in app.openapi()["paths"]

    def test_로그인을_요구하지_않는다(self):
        from app.main import app
        것 = app.openapi()["paths"]["/api/v1/stocks/{market}/{symbol}/dividends"]["get"]
        assert not 것.get("security"), "미리보기가 못 쓴다"

    def test_배당_달력과_같은_서비스를_쓴다(self):
        """서비스가 갈리면 같은 종목에 두 값이 생긴다. 캐시도 두 벌이
        되어 야후를 두 번 친다."""
        import inspect
        from app.api.routes.stocks import analyst as A
        본문 = inspect.getsource(A.get_stock_dividends)
        assert "dividend_service" in 본문
        assert "한종목" in 본문

    @staticmethod
    def _불러보기(market, symbol):
        """레이트리미터(slowapi)가 진짜 Request 를 요구한다. 최소한만 만든다."""
        import asyncio
        from starlette.requests import Request
        from app.api.routes.stocks import analyst as A

        요청 = Request({
            "type": "http", "method": "GET", "path": "/", "headers": [],
            "query_string": b"", "client": ("127.0.0.1", 1),
            "app": None, "server": ("test", 80), "scheme": "http",
        })
        return asyncio.new_event_loop().run_until_complete(
            A.get_stock_dividends(request=요청, market=market, symbol=symbol))

    def test_배당이_없으면_빈_것을_준다(self, 야후):
        """404 로 만들면 화면이 오류 상자를 띄운다. '배당이 없다' 는
        오류가 아니다 — 무배당 종목이 훨씬 많다."""
        야후(_가짜티커([]))
        assert self._불러보기("US", "BRK.B") == {}

    def test_실제_값을_그대로_준다(self, 야후):
        """미리보기가 이 값으로 배당 화면을 그린다 — 달마다 얼마·언제가
        다 들어 있어야 한다. 지어낸 값이 아니라는 것이 요점이다."""
        해 = date.today().year - 1
        야후(_가짜티커([(date(해, 5, 31), 361.0), (date(해, 11, 30), 1083.0)]))
        답 = self._불러보기("KR", "005930")
        assert 답["schedule"], "달마다 얼마 주는지가 없다"
        assert 답["plan_year"] == pytest.approx(361 + 1083)
        assert 답["recent"]
        # 달마다 금액이 다른 것이 그대로 실려야 한다
        assert {x["month"]: x["amount"] for x in 답["schedule"]} == {
            5: pytest.approx(361.0), 11: pytest.approx(1083.0),
        }


# ── 이번 회차 금액 ────────────────────────────────────────────
class Test이번회차금액:
    """'다음에 얼마 받나' 를 마지막 회차 금액으로 답하고 있었다.

    분기배당은 회차마다 금액이 다르다 — 결산배당이 붙는 분기가 특히
    크다. 0.20 / 0.25 / 0.30 / 0.35 를 주는 종목이 다음에 0.20 을 줄
    차례인데 마지막이 0.35 였으면, 화면은 75% 를 더 받는다고 말한다.

    그 값으로 생활비 계획을 세우는 사람이 있다. 실제로 준 그 달의
    금액을 쓴다.
    """

    @staticmethod
    def _담기(달, 금액, 마지막):
        """schedule 이 있는 배당 정보를 캐시에 넣는다."""
        from app.core.cache import cache
        그날 = date.today() + timedelta(days=20)
        cache.set("div:US:XYZ", {
            "symbol": "XYZ", "market": "US", "recent": [],
            "per_year": 1.10, "plan_year": 1.10, "cycle": "분기",
            "schedule": [{"month": 달, "day": 그날.day, "amount": 금액,
                          "year": 그날.year, "actual": True}],
            "months": [달], "per_month": 1.0, "currency": "USD",
            "last_date": 날(90).isoformat(), "last_amount": 마지막,
            "ex_date": 그날.isoformat(), "pay_date": None, "estimated_date": None,
        }, 60)
        return 그날

    def test_그_달의_실제_금액을_쓴다(self, 야후):
        그날 = self._담기(달=(date.today() + timedelta(days=20)).month,
                          금액=0.20, 마지막=0.35)
        야후(_가짜티커([]))
        r = DV.달력([{"symbol": "XYZ", "market": "US", "name": "XYZ", "shares": 100}])
        줄 = r["items"][0]
        assert 줄["next_amount"] == pytest.approx(0.20)
        # 마지막 회차(0.35)를 썼다면 35 가 나온다 — 75% 가 부풀려진다
        assert 줄["expected"] == pytest.approx(20.0)
        assert 그날.isoformat() == 줄["date"]

    def test_그_달이_일정에_없으면_마지막_회차로_떨어진다(self, 야후):
        """공시된 기준일이 지난해 일정에 없는 달일 수 있다. 그때는
        아무 값도 안 주는 것보다 마지막 회차라도 주는 편이 낫다 —
        다만 그게 어림이라는 것은 화면이 밝힌다."""
        딴달 = (date.today() + timedelta(days=20)).month % 12 + 1
        self._담기(달=딴달, 금액=0.20, 마지막=0.35)
        야후(_가짜티커([]))
        r = DV.달력([{"symbol": "XYZ", "market": "US", "name": "XYZ", "shares": 100}])
        assert r["items"][0]["next_amount"] == pytest.approx(0.35)

    def test_수량이_0이면_여전히_금액을_안_낸다(self, 야후):
        self._담기(달=(date.today() + timedelta(days=20)).month, 금액=0.20, 마지막=0.35)
        야후(_가짜티커([]))
        r = DV.달력([{"symbol": "XYZ", "market": "US", "name": "XYZ", "shares": 0}])
        assert r["items"][0]["expected"] is None
        # 주당 금액 자체는 남는다 — 관심종목도 '한 주에 얼마 주나' 는 볼 수 있다
        assert r["items"][0]["next_amount"] == pytest.approx(0.20)


# ── 실제로 준 것과 메운 것 ────────────────────────────────────
class Test실제와메움을_가른다:
    """주·월배당은 아직 한 해가 안 찬 종목에서 빈 달이 생긴다. 그걸
    있는 달들의 평균으로 메우는데, 그건 **실제로 받은 값이 아니다**.

    메운 값을 실제인 척 보여 주면 그 숫자로 한 해 계획을 세우는 사람이
    생긴다. 어느 칸이 실제인지 화면이 말할 수 있어야 한다."""

    def test_실제_지급에서_나온_칸은_actual_이_참이다(self):
        내역 = [(date.today() - timedelta(days=90), 0.25)]
        일정 = DV._월별일정(
            [{"date": d.isoformat(), "amount": a} for d, a in 내역],
            [d for d, _ in 내역], "분기")
        assert 일정[0]["actual"] is True

    def test_평균으로_메운_칸은_actual_이_거짓이다(self, 야후):
        """월배당인데 석 달치만 있는 종목 — 나머지 아홉 달이 메워진다."""
        내역 = [(날(60), 0.10), (날(30), 0.12), (날(1), 0.11)]
        야후(_가짜티커(내역))
        r = DV.한종목("MONTHLY", "US")
        일정 = r["schedule"]
        assert len(일정) == 12, "월배당은 열두 달을 다 채운다"
        실제 = [x for x in 일정 if x.get("actual")]
        메움 = [x for x in 일정 if not x.get("actual")]
        assert len(실제) == 3 and len(메움) == 9
        # 메운 값은 있는 달들의 평균이다
        assert 메움[0]["amount"] == pytest.approx((0.10 + 0.12 + 0.11) / 3, abs=1e-6)

    def test_분기배당은_메우지_않는다(self, 야후):
        """2·5·8·11월에만 주는 종목의 3월을 메우면 '3월에도 준다' 는
        거짓말이 된다. 안 주는 달은 그냥 없어야 한다."""
        내역 = [(날(365), 0.20), (날(274), 0.25), (날(183), 0.30), (날(91), 0.35)]
        야후(_가짜티커(내역))
        r = DV.한종목("QTR", "US")
        assert all(x.get("actual") for x in r["schedule"])
        assert len(r["schedule"]) <= 4


# ── 전체가 부분보다 작아 보이던 것 ────────────────────────────
class Test전체가_부분보다_작아_보이면_안_된다:
    """실제로 받은 제보 —

        포트폴리오1 배당금액 34만원
        포트폴리오2 배당금액 89만원
        전체 포트폴리오 배당금액 **34만원**

    기전은 이렇다. 한 요청에 새로 받아 올 종목 수에 상한(한번에)이 있고,
    못 받은 수를 pending 으로 내보낸다. 그런데 화면이 pending 을 안 보고
    10분간 캐시했다. '전체' 를 먼저 열면 상한에 걸려 일부만 받아지고,
    그 부분합이 '한 해 배당금' 으로 굳는다. 그 뒤 포트폴리오를 하나씩
    열면 각각은 온전히 나오므로 전체가 부분보다 작아진다.

    서버 쪽에서 못 박을 것 —
      1) 못 받은 수를 정직하게 pending 으로 낸다(화면이 다시 물어볼 근거)
      2) 다 캐시된 뒤에는 몇 종목이든 전부 낸다
      3) 상한이 흔한 보유 규모보다는 넉넉하다
    """

    @staticmethod
    def _티커(_sym=None, *a, **k):
        return _가짜티커([(날(365), 100.0), (날(274), 100.0),
                          (날(183), 100.0), (날(91), 100.0)])

    @staticmethod
    def _보유(n, 시작=0):
        return [{"symbol": f"S{i}", "market": "US", "name": f"S{i}", "shares": 10}
                for i in range(시작, 시작 + n)]

    @staticmethod
    def _합(r):
        return sum(x["expected_year"] or 0 for x in r["items"])

    def test_다_캐시되면_전체가_부분의_합과_같다(self, 야후):
        """이게 어긋나면 사용자가 보는 숫자가 그냥 틀린 것이다."""
        야후(self._티커())
        P1, P2 = self._보유(5, 0), self._보유(5, 5)

        # 각각 먼저 열어 캐시를 채운다
        r1, r2 = DV.달력(list(P1)), DV.달력(list(P2))
        assert r1["pending"] == 0 and r2["pending"] == 0

        전체 = DV.달력(P1 + P2)
        assert 전체["pending"] == 0
        assert len(전체["items"]) == 10
        assert self._합(전체) == pytest.approx(self._합(r1) + self._합(r2))

    def test_못_받은_수를_숨기지_않는다(self, 야후):
        """숨기면 화면은 부분합을 전체로 믿고 다시 물어볼 이유도 없다."""
        야후(self._티커())
        많이 = self._보유(DV.한번에 + 4)
        r = DV.달력(많이)
        assert r["pending"] == 4, f"pending 이 {r['pending']} 이다 — 빠진 것을 안 세고 있다"
        assert len(r["items"]) == DV.한번에

    def test_다시_물어보면_나머지가_채워진다(self, 야후):
        """화면이 pending>0 인 동안 다시 묻는다. 그때 채워져야 뜻이 있다."""
        야후(self._티커())
        많이 = self._보유(DV.한번에 + 4)
        DV.달력(많이)                      # 1회차 — 상한까지만
        r = DV.달력(많이)                  # 2회차 — 나머지
        assert r["pending"] == 0
        assert len(r["items"]) == DV.한번에 + 4

    def test_상한이_흔한_보유_규모보다_넉넉하다(self):
        """6 이면 종목 열 개짜리 사람이 매번 첫 화면에서 틀린 합계를 본다.
        캐시에 없는 종목에만 걸리는 상한이라 넉넉해도 손해가 적다."""
        assert DV.한번에 >= 10

    def test_상한이_무한은_아니다(self):
        """상한을 없애면 스무 종목 가진 사람이 첫 요청에서 HTTP 40번을
        기다린다. 상한이 있는 이유가 사라지면 안 된다."""
        assert DV.한번에 <= 30


# ── 응답 무게 ────────────────────────────────────────────────
class Test응답을_가볍게:
    """지난 지급 원본(recent)을 통째로 실어 보내고 있었다.

    주배당(연 52회)이면 한 종목에 104건이다. 열두 종목이면 그 배열만
    51KB — **응답의 절반**이고, 화면이 쓰는 것은 '그 달에 해마다
    얼마였나' 두 줄뿐이다. 받아서 버리는 몫을 싱가포르에서 한국까지
    나르는 셈이다.

    해·달별 합계로 묶어 보낸다. 주배당에서 104건 → 24건(2년 × 12달)이다.
    """

    @staticmethod
    def _주배당티커():
        오늘 = date.today()
        내역 = [(오늘 - timedelta(weeks=i), 0.063) for i in range(104)][::-1]
        return _가짜티커(내역)

    def test_해달별_합계를_같이_준다(self, 야후):
        야후(self._주배당티커())
        r = DV.한종목("WKLY", "US")
        묶음 = r["월별지난"]
        assert 묶음, "월별지난이 비었다"
        # 2년치 주배당이면 달마다 한 줄씩 최대 24줄
        assert len(묶음) <= 24
        # 한 달 안의 회차를 합쳤는지 — 주배당은 달마다 4~5회다
        이번달 = next(x for x in 묶음 if (x["year"], x["month"]) ==
                      (date.today().year, date.today().month))
        assert 이번달["amount"] > 0.063, "한 회차만 세고 있다"

    def test_최신부터_적는다(self, 야후):
        야후(self._주배당티커())
        묶음 = DV.한종목("WKLY", "US")["월별지난"]
        연월 = [(x["year"], x["month"]) for x in 묶음]
        assert 연월 == sorted(연월, reverse=True)

    def test_달력_응답에는_원본을_안_싣는다(self, 야후):
        """화면이 안 쓰는 배열이다. 한 종목이면 몰라도 스무 종목이면
        응답의 절반이 된다."""
        야후(self._주배당티커())
        보유 = [{"symbol": "WKLY", "market": "US", "name": "WKLY", "shares": 10}]
        DV.달력(list(보유))
        r = DV.달력(list(보유))
        줄 = r["items"][0]
        assert "recent" not in 줄, "지난 내역 원본이 아직 실려 있다"
        assert 줄["월별지난"], "대신 쓸 묶음이 없다"

    def test_종목_상세_경로에는_원본이_남는다(self, 야후):
        """거기는 한 종목뿐이라 값이 싸고, 앞으로 원본이 필요한 화면이
        생길 수 있다."""
        야후(self._주배당티커())
        r = DV.한종목("WKLY", "US")
        assert len(r["recent"]) > 24

    def test_실제로_가벼워졌는지_재_본다(self, 야후):
        import json
        야후(self._주배당티커())
        보유 = [{"symbol": f"W{i}", "market": "US", "name": f"W{i}", "shares": 10}
                for i in range(12)]
        DV.달력(list(보유))
        r = DV.달력(list(보유))
        크기 = len(json.dumps(r, ensure_ascii=False).encode())
        # 원본을 실으면 10만 바이트를 넘었다. 넉넉히 잡아도 8만 밑이어야 한다
        assert 크기 < 80_000, f"응답이 {크기:,}바이트다"


# ── 뮤테이션이 잡아낸 빈 자리들 ──────────────────────────────
class Test빈손_종목이_칸을_안_태운다:
    """조사에서 나온 것 — 배당을 **안 주는** 종목이 매 요청마다 조회
    칸을 하나씩 태우고 있었다.

    무배당 종목은 값 캐시에 아무것도 안 담긴다. 대신 다른 열쇠에
    '빈손' 표시만 남는다. 그래서 '아직 못 받았다' 로 오해받아 칸을
    쓰는데, 정작 조회는 곧바로 빈손을 돌려주므로 목록에 한 줄도 안
    보탠다 — **칸만 태우고 아무것도 안 채운다.**

    무배당 종목이 상한(한번에)만큼 있으면 배당 주는 종목은 한 개도
    새로 못 받는다. 그리고 pending 이 영영 0 이 안 되므로 화면이
    4초마다 영원히 서버를 두드린다.
    """

    @staticmethod
    def _반반(sym=None, *a, **k):
        """S0~S4 만 배당을 준다. 나머지는 무배당"""
        번호 = int(str(sym).lstrip("S").split(".")[0] or 0)
        if 번호 >= 5:
            return _가짜티커([])
        return _가짜티커([(날(365), 100.0), (날(274), 100.0),
                          (날(183), 100.0), (날(91), 100.0)])

    @staticmethod
    def _보유(n):
        return [{"symbol": f"S{i}", "market": "US", "name": f"S{i}", "shares": 10}
                for i in range(n)]

    def test_무배당이_많아도_pending_이_0_으로_내려간다(self, 야후, monkeypatch):
        import yfinance as yf
        monkeypatch.setattr(yf, "Ticker", self._반반)
        보유 = self._보유(DV.한번에 + 8)          # 배당 5 + 무배당 나머지

        for _ in range(4):
            r = DV.달력(list(보유))
        assert r["pending"] == 0, \
            f"무배당 종목이 칸을 태우고 있다 — pending 이 {r['pending']} 에서 안 내려간다"
        assert len(r["items"]) == 5

    def test_무배당이_배당_종목을_한_회차만_늦춘다(self, monkeypatch):
        """무배당이 상한만큼 앞에 있으면 배당 종목이 뒤로 밀린다.

        **첫 요청은 어쩔 수 없다.** 배당을 주는지 안 주는지는 물어봐야
        아는 것이라, 첫 회차는 무배당 종목에도 칸을 쓴다. 여기서 못
        박는 것은 그다음이다 — 한 번 물어본 뒤로는 그 종목이 칸을 안
        쓰므로, **두 번째 요청에 전부 들어와야 한다.**

        고치기 전에는 그 '그다음' 이 없었다. 빈손 표시가 값 캐시와
        다른 열쇠에 남아서, 무배당 종목이 매 요청마다 영원히 칸을
        태웠다 — 배당 종목은 영영 못 들어왔다."""
        import yfinance as yf
        monkeypatch.setattr(yf, "Ticker", self._반반)
        # 무배당(S5~)을 앞에, 배당(S0~S4)을 뒤에 둔다
        보유 = ([{"symbol": f"S{i}", "market": "US", "name": f"S{i}", "shares": 10}
                 for i in range(5, 5 + DV.한번에 + 4)]
                + [{"symbol": f"S{i}", "market": "US", "name": f"S{i}", "shares": 10}
                   for i in range(5)])
        DV.달력(list(보유))                    # 1회차 — 무배당을 알아 가는 회차
        r = DV.달력(list(보유))                # 2회차
        assert len(r["items"]) == 5, \
            f"두 번째인데도 배당 종목이 {len(r['items'])}개만 들어왔다"
        assert r["pending"] == 0


class Test올해_것을_먼저_쓴다:
    """'작년 기준이 아니라 올해 확정된 데이터로' 라는 말을 들었다.

    실제로는 계산이 이미 올해 것을 쓰고 있었지만, 규칙이 '자료의
    마지막에 나온 해' 라 **우연**이었다. 자료 순서가 흔들리면 조용히
    작년 것을 쓰게 된다. 규칙을 명시로 바꿨으니 그걸 못 박는다.
    """

    def test_같은_달에_두_해가_있으면_올해_것을_쓴다(self):
        올해 = date.today().year
        내역 = [(date(올해 - 1, 3, 20), 0.20), (date(올해, 3, 25), 0.30)]
        일정 = DV._월별일정(
            [{"date": d.isoformat(), "amount": a} for d, a in 내역],
            [d for d, _ in 내역], "분기")
        칸 = 일정[0]
        assert 칸["year"] == 올해 and 칸["amount"] == pytest.approx(0.30)
        assert 칸["올해확정"] is True

    def test_자료_순서가_거꾸로여도_올해를_고른다(self):
        """'마지막에 나온 해' 규칙은 순서에 기댄다. 순서가 흔들리면
        조용히 작년 값을 쓰게 된다."""
        올해 = date.today().year
        내역 = [(date(올해, 3, 25), 0.30), (date(올해 - 1, 3, 20), 0.20)]
        일정 = DV._월별일정(
            [{"date": d.isoformat(), "amount": a} for d, a in 내역],
            [d for d, _ in 내역], "분기")
        assert 일정[0]["year"] == 올해
        assert 일정[0]["amount"] == pytest.approx(0.30)

    def test_올해_것이_없으면_작년으로_떨어진다(self):
        """아직 안 온 달은 작년 값을 쓸 수밖에 없다. 다만 그렇다고
        표시해야 화면이 '작년 기준' 이라고 정직하게 적는다."""
        올해 = date.today().year
        내역 = [(date(올해 - 1, 11, 20), 0.35)]
        일정 = DV._월별일정(
            [{"date": d.isoformat(), "amount": a} for d, a in 내역],
            [d for d, _ in 내역], "분기")
        assert 일정[0]["year"] == 올해 - 1
        assert 일정[0]["올해확정"] is False


class Test주배당_다음_날짜:
    """주배당의 '다음 배당일' 이 최대 한 달까지 어긋났다.

    월별 일정 칸에는 그 달에 **마지막으로 준 날** 하나만 있다.
    주배당(7일마다)에 그걸 쓰면, 이번 달 지급이 끝난 뒤부터는 다음
    달 마지막 주까지 통째로 건너뛴다 — 매주 받는 사람에게 '다음
    배당은 한 달 뒤' 라고 말하는 셈이다.
    """

    def test_주배당은_한_주_안에_다음_날짜가_잡힌다(self, 야후):
        내역 = [(날(7 * i), 0.063) for i in range(1, 60)][::-1]
        야후(_가짜티커(내역))
        r = DV.한종목("WKLY", "US")
        assert r["cycle"] == "주"
        다음 = date.fromisoformat(r["estimated_date"])
        간격 = (다음 - date.today()).days
        assert 0 <= 간격 <= 8, f"주배당인데 다음 배당이 {간격}일 뒤다"

    def test_분기배당은_실제로_준_달을_그대로_쓴다(self, 야후):
        """주기로 밀면(91일씩) 회차마다 며칠씩 밀려 몇 해 뒤에는 달이
        바뀐다 — 3월 말에 주던 종목이 4월로 넘어간다."""
        올해 = date.today().year
        내역 = [(date(올해 - 1, m, 20), 0.25) for m in (2, 5, 8, 11)]
        야후(_가짜티커(내역))
        r = DV.한종목("QTR", "US")
        assert r["cycle"] == "분기"
        다음 = date.fromisoformat(r["estimated_date"])
        assert 다음.day == 20, f"실제로 준 날(20일)이 아니라 {다음.day}일로 밀었다"
        assert 다음.month in (2, 5, 8, 11)

    def test_주배당은_앞으로의_날짜를_따로_준다(self, 야후):
        """'언제 받나' 가 곧 '매주 무슨 요일' 인 종목이다. 날짜 하나로는
        그 모양을 못 보여 준다."""
        내역 = [(날(7 * i), 0.063) for i in range(1, 60)][::-1]
        야후(_가짜티커(내역))
        r = DV.한종목("WKLY", "US")
        앞 = r["upcoming"]
        assert len(앞) == DV.앞으로_최대
        날짜들 = [date.fromisoformat(x["date"]) for x in 앞]
        assert all(d >= date.today() for d in 날짜들), "지난 날짜가 섞였다"
        assert 날짜들 == sorted(날짜들)
        # 7일 간격이어야 한다
        assert all((b - a).days == 7 for a, b in zip(날짜들, 날짜들[1:]))

    def test_분기배당에는_앞으로_목록을_안_만든다(self, 야후):
        """석 달에 한 번 주는 종목에 여덟 줄을 적으면 어지럽기만 하다"""
        올해 = date.today().year
        내역 = [(date(올해 - 1, m, 20), 0.25) for m in (2, 5, 8, 11)]
        야후(_가짜티커(내역))
        assert DV.한종목("QTR", "US")["upcoming"] == []


class Test달력_병렬:
    """열두 종목을 차례로 받으면 왕복 열두 번이고, 그게 그대로 화면 대기다.

    실제로 쟀다 — 아홉 종목에 2,242ms. 배당 달력만 유독 느렸고,
    같은 화면의 나머지 다섯 경로는 전부 10~15ms 였다.

    받는 일은 바깥을 기다리는 일(I/O)이라 겹쳐 두면 제일 느린 하나만큼만
    걸린다. 0.15 CPU 서버에서도 손해가 없다 — CPU 를 쓰는 일이 아니라
    답을 기다리는 일이라서다.
    """

    @staticmethod
    def _보유(n: int) -> list:
        return [{"symbol": f"PARSYM{i}", "market": "US", "name": f"종목{i}", "shares": 10}
                for i in range(n)]

    @staticmethod
    def _치우기(보유):
        from app.core.cache import cache
        from app.core import fetchcache
        for it in 보유:
            ck = f"div:{it['market']}:{it['symbol']}"
            cache.delete(ck); cache.delete(f"{ck}:miss")
            DV.쉼.잊기(ck)
        fetchcache.잊기()

    def _대역(self, 걸리는시간: float, 동시: dict):
        import threading, time
        자물쇠 = threading.Lock()

        def 가져오기(symbol, market):
            with 자물쇠:
                동시["지금"] = 동시.get("지금", 0) + 1
                동시["최대"] = max(동시.get("최대", 0), 동시["지금"])
            time.sleep(걸리는시간)
            with 자물쇠:
                동시["지금"] -= 1
            return {"symbol": symbol, "market": market, "ex_date": "2026-09-15",
                    "last_amount": 0.5, "per_year": 2.0, "plan_year": 2.0,
                    "currency": "USD", "cycle": "분기", "months": [3, 6, 9, 12],
                    "schedule": [{"month": 9, "day": 15, "amount": 0.5, "year": 2026}]}
        return 가져오기

    def test_여러_종목을_동시에_받는다(self, monkeypatch):
        import time
        보유 = self._보유(9)
        self._치우기(보유)
        동시: dict = {}
        한번 = 0.25
        monkeypatch.setattr(DV, "_가져오기", self._대역(한번, 동시))
        시작 = time.perf_counter()
        답 = DV.달력(보유)
        걸림 = time.perf_counter() - 시작
        self._치우기(보유)

        assert 동시.get("최대", 0) >= 2, "한 번에 하나씩만 받고 있다"
        차례로 = 한번 * len(보유)
        assert 걸림 < 차례로 * 0.6, f"{걸림:.2f}초 — 차례로 받는 것과 다를 바 없다"
        # 빨라졌다고 빠뜨리면 안 된다
        assert len(답["items"]) == len(보유)
        assert 답["pending"] == 0

    def test_상한을_넘겨_받지_않는다(self, monkeypatch):
        """동시에 받는다고 상한이 풀리면 안 된다. 스무 종목을 가진
        사람이 처음 열 때 스무 번을 한꺼번에 나가면, 그건 화면을
        빠르게 한 게 아니라 서버를 때린 것이다."""
        보유 = self._보유(DV.한번에 + 5)
        self._치우기(보유)
        센다: dict = {"수": 0}

        def 세기(symbol, market):
            센다["수"] += 1
            return {"symbol": symbol, "market": market, "ex_date": "2026-09-15",
                    "last_amount": 0.5, "per_year": 2.0, "plan_year": 2.0,
                    "currency": "USD", "cycle": "분기", "months": [9],
                    "schedule": [{"month": 9, "day": 15, "amount": 0.5, "year": 2026}]}

        monkeypatch.setattr(DV, "_가져오기", 세기)
        답 = DV.달력(보유)
        self._치우기(보유)
        assert 센다["수"] <= DV.한번에, f"{센다['수']}개나 받았다 (상한 {DV.한번에})"
        assert 답["pending"] == len(보유) - DV.한번에

    def test_이미_담긴_것은_다시_안_받는다(self, monkeypatch):
        """두 번째 요청은 바깥을 한 번도 안 쳐야 한다."""
        보유 = self._보유(4)
        self._치우기(보유)
        센다: dict = {"수": 0}

        def 세기(symbol, market):
            센다["수"] += 1
            return {"symbol": symbol, "market": market, "ex_date": "2026-09-15",
                    "last_amount": 0.5, "per_year": 2.0, "plan_year": 2.0,
                    "currency": "USD", "cycle": "분기", "months": [9],
                    "schedule": [{"month": 9, "day": 15, "amount": 0.5, "year": 2026}]}

        monkeypatch.setattr(DV, "_가져오기", 세기)
        DV.달력(보유)
        첫번째 = 센다["수"]
        DV.달력(보유)
        self._치우기(보유)
        assert 첫번째 == 4
        assert 센다["수"] == 4, "캐시에 있는데 또 받았다"

    def test_하나가_터져도_나머지는_나온다(self, monkeypatch):
        """겹쳐서 받는다고 한 종목의 실패가 전체를 무너뜨리면 안 된다."""
        보유 = self._보유(5)
        self._치우기(보유)

        def 하나만터짐(symbol, market):
            if symbol.endswith("2"):
                raise RuntimeError("야후 막힘")
            return {"symbol": symbol, "market": market, "ex_date": "2026-09-15",
                    "last_amount": 0.5, "per_year": 2.0, "plan_year": 2.0,
                    "currency": "USD", "cycle": "분기", "months": [9],
                    "schedule": [{"month": 9, "day": 15, "amount": 0.5, "year": 2026}]}

        monkeypatch.setattr(DV, "_가져오기", 하나만터짐)
        답 = DV.달력(보유)
        self._치우기(보유)
        assert len(답["items"]) == 4, [x["symbol"] for x in 답["items"]]

    def test_받는_중_예외가_요청을_통째로_무너뜨리지_않는다(self, monkeypatch):
        """스레드 안에서 터진 것은 result() 에서 다시 튀어나온다.

        지금은 한종목() 이 안에서 삼키므로 여기까지 안 온다. 그런데 그건
        **다른 모듈의 사정**이다 — 캐시가 터지거나, 한종목() 이 나중에
        예외를 그대로 올리도록 바뀌면 이 자리가 그대로 500 이 된다.
        배당 하나 때문에 내 자산 화면 전체가 죽는 것은 너무 큰 대가다.

        그 경계를 여기서 막는지 본다."""
        보유 = self._보유(3)
        self._치우기(보유)

        원래 = DV.한종목
        def 터지는것(symbol, market, 받아도되나=True):
            if 받아도되나:                      # 미리받기 단계에서만 터진다
                raise RuntimeError("스레드에서 터짐")
            return 원래(symbol, market, False)

        monkeypatch.setattr(DV, "한종목", 터지는것)
        답 = DV.달력(보유)                      # 500 이 아니라 답이 나와야 한다
        self._치우기(보유)
        assert 답["items"] == []
        assert 답["pending"] == 3               # 못 받았다고 정직하게 적는다
