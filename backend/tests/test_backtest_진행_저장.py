"""백테스트 — 단일 종목·유니버스 진행률, 결과에서 저장(돌린 설정까지), 상세 분석에 쓰는 것.

사용자:
  "단일종목 유니버스도 %로 진행률 확인할 수 있게 해줘"
  "결과나오면 저장을 어떻게해"
  "백테스팅 결과를 더 상세분석할 수 있도록"

  · 진행률 — 자산배분(/portfolio)과 같은 '열쇠 + 물어보기'. 화면이 열쇠를 실어 보내면 서버가 단계·종목 수를 적고,
    화면은 /backtest/progress/{열쇠} 로 따로 묻는다. 퍼센트는 뒤로 가지 않고 99 를 넘지 않는다
  · 유니버스 — 손으로 고른 목록에 겹친 종목이 있었다(SP500 에 AMZN·NFLX 등 다섯). 같은 종목을 두 번 돌리지
    않는다. 결과 줄에 이름, 돌린 모든 종목의 수익률(분포용)을 싣는다
  · 저장 — 예전 전략 저장은 진입·청산 조건만 담았다. 종목·기간·자본(run_settings)까지 담아 불러오면 그대로 열린다
  · 들고 있기 곡선 — 내 전략 곡선 날짜마다 값 하나(화면이 수익·낙폭·해마다를 나란히 그린다)
"""
import pathlib
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app.api.routes import backtest as R
from app.core.cache import cache
from app.main import app

늘삼 = {"logic": "AND", "conditions": [{"indicator": "PRICE", "operator": ">", "value": 0}]}
안팜 = {"logic": "AND", "conditions": []}
#: 오르내리며 사고팔게 — MA5 가 MA20 을 넘으면 사고 밑돌면 판다
엇갈림_사기 = {"logic": "AND", "conditions": [{"indicator": "MA", "operator": "crosses_above", "value": "MA", "period": 5}]}
엇갈림_팔기 = {"logic": "OR", "conditions": [{"indicator": "RSI", "operator": ">", "value": 60}]}


@pytest.fixture
def 가짜야후(monkeypatch):
    """종목마다 다른 물결 — 같은 규칙(period 를 오늘 기준)으로 준다"""
    불림 = []
    오늘 = date.today()

    def 시세(symbol, period, interval, market):
        import math
        불림.append(symbol)
        씨 = sum(ord(c) for c in symbol)
        나온것, d, i = [], 오늘 - timedelta(days=900), 0
        while d <= 오늘:
            if d.weekday() < 5:
                c = 100 * (1 + 0.25 * math.sin(i / (9 + 씨 % 7))) * (1 + i * 0.0004)
                나온것.append({"date": d.isoformat(), "open": c, "high": c * 1.01, "low": c * 0.99,
                               "close": c, "volume": 1000})
                i += 1
            d += timedelta(days=1)
        return 나온것

    monkeypatch.setattr(R.yf_service, "get_ohlcv", 시세)
    return 불림


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _횟수리셋():
    def 지우기():
        try:
            R.limiter._storage.reset()
        except Exception:
            pass
    지우기()
    yield
    지우기()


def _몸(**더):
    오늘 = date.today()
    기본 = {"symbol": "AAPL", "market": "US", "start_date": (오늘 - timedelta(days=500)).isoformat(),
            "end_date": 오늘.isoformat(), "entry_conditions": 엇갈림_사기, "exit_conditions": 엇갈림_팔기,
            "initial_capital": 10_000_000}
    기본.update(더)
    return 기본


@pytest.fixture
def 진행기록(monkeypatch):
    """_진행쓰기 를 부른 차례를 남긴다(진짜도 그대로 부른다)"""
    기록 = []
    진짜 = R._진행쓰기

    def 남기기(열쇠, 단계, 된것=1, 전체=1, 글="", 무게=None, 순서=None):
        진짜(열쇠, 단계, 된것, 전체, 글, 무게, 순서)
        if 열쇠:
            기록.append((단계, 된것, 전체, (cache.get(f"진행:{열쇠}") or {}).get("percent")))

    monkeypatch.setattr(R, "_진행쓰기", 남기기)
    return 기록


# ── 진행률 ─────────────────────────────────────────────────

class Test단일_진행률:
    def test_단계마다_적고_퍼센트는_뒤로_안_간다(self, client, 가짜야후, 진행기록):
        r = client.post("/api/v1/backtest/run", json=_몸(progress_key="singlekey0001"))
        assert r.status_code == 200, r.text[:300]
        assert [(s, d, t) for s, d, t, _ in 진행기록] == [
            ("시세", 0, 1), ("시세", 1, 1), ("계산", 0, 1), ("견주기", 0, 1), ("견주기", 1, 1)]
        퍼센트 = [p for *_, p in 진행기록]
        assert 퍼센트 == sorted(퍼센트), f"퍼센트가 뒤로 갔다: {퍼센트}"
        assert 퍼센트[0] == 0 and 퍼센트[1] == 70 and 퍼센트[2] == 70 and 퍼센트[3] == 90
        assert 퍼센트[-1] == 99, "100 은 응답이 실제로 왔을 때만이다 — 서버는 99 까지"

    def test_물어보면_마지막_상황이_온다(self, client, 가짜야후):
        client.post("/api/v1/backtest/run", json=_몸(progress_key="singlekey0002"))
        for 길 in ("/api/v1/backtest/progress/singlekey0002", "/api/v1/backtest/portfolio/progress/singlekey0002"):
            d = client.get(길).json()
            assert d["단계"] == "견주기" and d["percent"] == 99 and d["글"] == "다 됐어요", 길

    def test_열쇠가_없으면_아무것도_안_적는다(self, client, 가짜야후, 진행기록):
        assert client.post("/api/v1/backtest/run", json=_몸()).status_code == 200
        assert 진행기록 == []

    @pytest.mark.parametrize("열쇠", ["짧음", "a" * 65, "bad key!!", "../../x"])
    def test_이상한_열쇠는_막는다(self, client, 가짜야후, 열쇠):
        assert client.post("/api/v1/backtest/run", json=_몸(progress_key=열쇠)).status_code == 422


class Test유니버스_진행률:
    def _몸(self, 종목들, **더):
        오늘 = date.today()
        #: 늘 사고 RSI 가 높으면 판다 — 종목마다 거래가 생겨야 순위·이름·분포를 볼 수 있다
        #  (거래가 없는 종목은 결과에서 빠진다 — 처음엔 엇갈림 조건으로 짰다가 결과가 통째로 비어 헛통과했다)
        몸 = {"universe": "CUSTOM", "custom_symbols": 종목들, "market": "US",
              "start_date": (오늘 - timedelta(days=500)).isoformat(), "end_date": 오늘.isoformat(),
              "entry_conditions": 늘삼, "exit_conditions": 엇갈림_팔기}
        몸.update(더)
        return 몸

    def test_종목_수만큼_끝까지_센다(self, client, 가짜야후, 진행기록):
        r = client.post("/api/v1/backtest/universe", json=self._몸(["AAPL", "MSFT", "NVDA"], progress_key="unikey000001"))
        assert r.status_code == 200, r.text[:300]
        assert 진행기록[0][:3] == ("종목", 0, 3)
        assert [d for _, d, _, _ in 진행기록[1:]] == [1, 2, 3]
        assert [p for *_, p in 진행기록] == [0, 33, 67, 99]

    def test_겹친_종목은_한_번만_돌린다(self, client, 가짜야후):
        r = client.post("/api/v1/backtest/universe", json=self._몸(["AAPL", "MSFT", "AAPL", "MSFT"]))
        d = r.json()
        assert d["total_symbols"] == 2 and sorted(가짜야후) == ["AAPL", "MSFT"]
        assert sorted(x["symbol"] for x in d["results"]) == ["AAPL", "MSFT"], "같은 종목이 두 줄로 나왔다"

    def test_못_받은_종목도_센다(self, client, monkeypatch, 진행기록):
        """못 받은 것을 안 세면 막대가 끝에 못 닿는다"""
        def 실패(*a, **k):
            raise RuntimeError("막힘")
        monkeypatch.setattr(R.yf_service, "get_ohlcv", 실패)
        r = client.post("/api/v1/backtest/universe", json=self._몸(["AAA", "BBB"], progress_key="unikey000002"))
        assert r.status_code == 200
        assert 진행기록[-1][:3] == ("종목", 2, 2)

    def test_진행_열쇠가_달라도_같은_조건은_캐시가_듣는다(self, client, 가짜야후):
        몸 = self._몸(["AAPL", "MSFT"], top_n=7)
        client.post("/api/v1/backtest/universe", json={**몸, "progress_key": "unikey000003"})
        앞 = len(가짜야후)
        client.post("/api/v1/backtest/universe", json={**몸, "progress_key": "unikey000004"})
        assert len(가짜야후) == 앞, "열쇠가 캐시 열쇠에 들어가 같은 조건을 또 돌렸다"

    def test_이름과_모든_종목_수익률을_싣는다(self, client, 가짜야후, monkeypatch):
        from app.services.listings import ticker_service as ts
        monkeypatch.setattr(ts, "get_us_db", lambda: [{"s": "AAPL", "n": "Apple Inc.", "m": "US"},
                                                      {"s": "ZZZZ", "n": "Zeta Corp", "m": "US"}])
        monkeypatch.setitem(ts.KO_NAME_MAP, "AAPL", ["애플"])
        r = client.post("/api/v1/backtest/universe", json=self._몸(["AAPL", "ZZZZ", "QQQQ"], top_n=3))
        d = r.json()
        이름 = {x["symbol"]: x["name"] for x in d["results"]}
        assert 이름 == {"AAPL": "애플", "ZZZZ": "Zeta Corp", "QQQQ": "QQQQ"}, \
            "한국어 별칭 → DB 이름 → 코드 순으로"
        assert d["tested"] == 3 and len(d["all_returns"]) == 3, "돌린 모든 종목의 수익률이 와야 분포를 그린다"
        assert sorted(d["all_returns"]) == sorted(round(x["total_return"], 1) for x in d["results"])

    def test_분포는_윗줄만이_아니라_모든_종목(self, client, 가짜야후):
        d = client.post("/api/v1/backtest/universe", json=self._몸(["AAPL", "MSFT", "NVDA", "AMD"], top_n=1)).json()
        assert len(d["results"]) == 1 and len(d["all_returns"]) == d["tested"] == 4


class Test진행쓰기:
    def test_무게대로_더하고_99_를_안_넘는다(self):
        R._진행쓰기("calc000000001", "종목", 5, 10, "x", **R._유니버스진행)
        assert cache.get("진행:calc000000001")["percent"] == 50
        R._진행쓰기("calc000000001", "종목", 10, 10, "x", **R._유니버스진행)
        assert cache.get("진행:calc000000001")["percent"] == 99
        R._진행쓰기("calc000000002", "계산", 1, 1, "x", **R._신호진행)
        assert cache.get("진행:calc000000002")["percent"] == 90

    def test_무게를_안_주면_자산배분_것(self):
        R._진행쓰기("calc000000003", "배당", 0, 1)
        assert cache.get("진행:calc000000003")["percent"] == 45   # 시세 40 + 환율 5


# ── 들고 있기 곡선 ──────────────────────────────────────────

class Test들고있기_곡선:
    def test_내_곡선_날짜마다_값_하나(self, client, 가짜야후):
        d = client.post("/api/v1/backtest/run", json=_몸()).json()
        곡선 = d["buy_and_hold"]["curve"]
        assert len(곡선) == len(d["equity_curve"]) > 100
        assert all(isinstance(v, int) for v in 곡선)
        assert 곡선[0] == pytest.approx(10_000_000, rel=0.06)

    def test_날짜로_짝짓고_빈_날은_None(self):
        내것 = [{"date": "2020-01-02", "value": 1}, {"date": "2020-01-03", "value": 2},
                {"date": "2020-01-06", "value": 3}]
        저것 = [{"date": "2020-01-06", "value": 30.4}, {"date": "2020-01-02", "value": 10.6}]
        assert R._날짜맞춘곡선(내것, 저것) == [11, None, 30]
        assert R._날짜맞춘곡선([], 저것) == []


# ── 이름 ─────────────────────────────────────────────────────

class Test이름:
    def test_국내는_국내_DB_에서(self, monkeypatch):
        from app.services.listings import ticker_service as ts
        monkeypatch.setattr(ts, "_kr_db", [{"c": "005930", "n": "삼성전자"}])
        assert R._종목이름들(["005930.KS", "000660.KS"], "KR") == {"005930.KS": "삼성전자", "000660.KS": "000660.KS"}

    def test_국내_DB_를_새로_받지_않는다(self, monkeypatch):
        from app.services.listings import ticker_service as ts
        monkeypatch.setattr(ts, "get_kr_db", lambda: pytest.fail("국내 종목 DB 를 새로 받으려 했다"))
        monkeypatch.setattr(ts, "_kr_db", [])
        R._종목이름들(["005930.KS"], "KR")

    def test_터져도_코드_그대로(self, monkeypatch):
        from app.services.listings import ticker_service as ts
        monkeypatch.setattr(ts, "get_us_db", lambda: 1 / 0)
        assert R._종목이름들(["AAPL"], "US") == {"AAPL": "AAPL"}


# ── 저장 — 돌린 설정까지 ──────────────────────────────────────

@pytest.fixture
def 로그인한손님():
    from app.api.routes.backtest import require_user, get_current_user

    class 아무개:
        id = 876543
        email = "strategy@test.local"

    app.dependency_overrides[require_user] = lambda: 아무개()
    app.dependency_overrides[get_current_user] = lambda: 아무개()
    yield TestClient(app)
    app.dependency_overrides.pop(require_user, None)
    app.dependency_overrides.pop(get_current_user, None)
    from app.db.database import SessionLocal
    from app.models.stock import Strategy
    s = SessionLocal()
    try:
        s.query(Strategy).filter(Strategy.user_id == 아무개.id).delete()
        s.commit()
    finally:
        s.close()


돌린것 = {"kind": "single", "symbol": "005930.KS", "market": "KR", "name": "삼성전자",
          "start_date": "2021-01-04", "end_date": "2025-12-30", "capital": 10_000_000,
          "position_size": 95, "cost_rate": 0.1}


class Test전략저장:
    def _전략(self, **더):
        몸 = {"name": "삼성 골든크로스", "market": "KR", "entry_conditions": 엇갈림_사기,
              "exit_conditions": 엇갈림_팔기, "stop_loss": 5}
        몸.update(더)
        return 몸

    def test_돌린_설정까지_담고_목록에서_되돌아온다(self, 로그인한손님):
        c = 로그인한손님
        r = c.post("/api/v1/backtest/strategies", json=self._전략(run_settings=돌린것))
        assert r.status_code == 200, r.text[:300]
        목록 = c.get("/api/v1/backtest/strategies").json()
        것 = next(x for x in 목록 if x["name"] == "삼성 골든크로스")
        assert 것["run_settings"] == 돌린것

    def test_예전처럼_조건만_보내도_된다(self, 로그인한손님):
        r = 로그인한손님.post("/api/v1/backtest/strategies", json=self._전략())
        assert r.status_code == 200 and r.json()["run_settings"] is None

    def test_고칠_때_안_보내면_지우지_않는다(self, 로그인한손님):
        c = 로그인한손님
        번호 = c.post("/api/v1/backtest/strategies", json=self._전략(run_settings=돌린것)).json()["id"]
        r = c.put(f"/api/v1/backtest/strategies/{번호}", json=self._전략(name="이름만 바꿈"))
        assert r.status_code == 200 and r.json()["run_settings"] == 돌린것
        새것 = {**돌린것, "capital": 5_000_000}
        r = c.put(f"/api/v1/backtest/strategies/{번호}", json=self._전략(run_settings=새것))
        assert r.json()["run_settings"]["capital"] == 5_000_000

    def test_너무_크면_막는다(self, 로그인한손님):
        r = 로그인한손님.post("/api/v1/backtest/strategies",
                            json=self._전략(run_settings={"x": "가" * (R.돌린설정최대 + 1)}))
        assert r.status_code == 422


def test_운영_DB_에_칸을_더하는_목록에_있다():
    """운영 DB(PostgreSQL)는 표를 다시 만들지 않는다 — 시작할 때 빠진 칸을 더하는 목록(main._MIGRATIONS)에 있어야
    옛 strategies 표에 run_settings 가 생긴다. 없으면 전략 목록을 읽는 순간 'no column' 으로 죽는다"""
    원문 = (pathlib.Path(__file__).resolve().parents[1] / "app" / "main.py").read_text(encoding="utf-8")
    assert '("strategies", "run_settings", "TEXT" if _is_sqlite else "JSON")' in 원문


# ── 상세 분석 — 자산배분과 같은 함수로 ────────────────────────────

class Test상세분석:
    def test_낙폭_순위_해마다_달마다가_온다(self, client, 가짜야후):
        d = client.post("/api/v1/backtest/run", json=_몸(entry_conditions=늘삼)).json()
        a = d["analysis"]
        assert {"drawdown", "drawdowns", "yearly", "monthly", "buy_and_hold"} <= set(a)
        # 낙폭 흐름의 바닥이 최대 낙폭과 같은 말을 한다(같은 곡선에서 잰다)
        assert min(x["dd"] for x in a["drawdown"]) == pytest.approx(-d["mdd"], abs=0.05)
        assert a["drawdowns"] and a["drawdowns"][0]["depth"] == pytest.approx(-d["mdd"], abs=0.05)
        assert all(x["dd"] <= 0 for x in a["drawdown"])
        # 달마다는 'YYYY-MM' — 첫 달은 시작값이 없어 안 센다
        assert all(len(m["month"]) == 7 for m in a["monthly"])
        assert a["monthly"][0]["month"] != d["equity_curve"][0]["date"][:7]
        assert {"drawdown", "yearly"} <= set(a["buy_and_hold"])

    def test_첫해는_초기_자본에서_잰다(self, client, 가짜야후):
        d = client.post("/api/v1/backtest/run", json=_몸(entry_conditions=늘삼)).json()
        곡선 = d["equity_curve"]
        첫해 = 곡선[0]["date"][:4]
        첫해끝 = [x for x in 곡선 if x["date"][:4] == 첫해][-1]["value"]
        y = d["analysis"]["yearly"][0]
        assert y["year"] == int(첫해)
        assert y["return"] == pytest.approx((첫해끝 - 10_000_000) / 10_000_000 * 100, abs=0.01)

    def test_해마다를_다_곱하면_총수익률(self, client, 가짜야후):
        d = client.post("/api/v1/backtest/run", json=_몸(entry_conditions=늘삼)).json()
        곱 = 1.0
        for y in d["analysis"]["yearly"]:
            곱 *= 1 + y["return"] / 100
        assert (곱 - 1) * 100 == pytest.approx(d["total_return"], abs=0.1)

    def test_곡선이_짧으면_빈_것(self):
        assert R._신호분석([{"date": "2024-01-02", "value": 1}], None, 1) == {}

    def test_들고_있기_곡선이_비어도_내_것은_잰다(self):
        곡선 = [{"date": f"2024-01-{d:02d}", "value": 100 + d} for d in range(2, 20)]
        a = R._신호분석(곡선, [None] * len(곡선), 100)
        assert "yearly" in a and "buy_and_hold" not in a

    def test_분석이_터져도_결과는_간다(self, client, 가짜야후, monkeypatch):
        monkeypatch.setattr(R, "_신호분석", lambda *a: 1 / 0)
        r = client.post("/api/v1/backtest/run", json=_몸())
        assert r.status_code == 200 and "analysis" not in r.json() and "total_return" in r.json()
