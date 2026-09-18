"""백테스트 전체 점검에서 나온 11건 — 고친 것을 못으로 박는다.

전부 **실제로 돌려서 숫자로 확인한** 것들이다. 검사마다 고치기 전
실측값을 적어 둔다 — 나중에 누가 되돌리면 그 수가 다시 나오므로,
무엇이 왜 틀렸었는지 검사만 읽어도 알 수 있어야 한다.

라우트까지 봐야 하는 것(기간·워밍업·생존편향)은 야후 대신 **yfinance 와
같은 규칙으로 움직이는 가짜 시세**를 끼운다. period 를 오늘 기준으로
해석하는 그 규칙 자체가 버그의 원인이었으므로, 거기를 흉내 내지 않으면
검사가 아무것도 못 잡는다.
"""
import random
import pytest
from datetime import date, timedelta

from fastapi.testclient import TestClient

from app.main import app
from app.api.routes import backtest as R
from app.services.backtest_engine import backtest_engine as E, BacktestEngine
from app.services.portfolio_backtest import 돌리기, 월말만


# ── 자료 만들기 ──────────────────────────────────────────

def 거래일(n=None, 시작=date(2014, 1, 2), 끝=None):
    나온것, d = [], 시작
    while (len(나온것) < n) if n else (d <= 끝):
        if d.weekday() < 5:
            나온것.append(d)
        d += timedelta(days=1)
    return 나온것


def 흔들리는봉(n, 씨=7, 시작=date(2014, 1, 2)):
    """실제 주가에 가까운 흔들림. 매끄러운 값으로는 크로스가 안 난다."""
    rnd = random.Random(씨)
    c, 나온것 = 100.0, []
    for d in 거래일(n, 시작):
        c *= (1 + rnd.gauss(0.0004, 0.014))
        나온것.append({"date": d.isoformat(), "open": c, "high": c * 1.008,
                       "low": c * 0.992, "close": c, "volume": 1000})
    return 나온것


def 곧은봉(n, 시작=date(2020, 1, 2), 값=100.0, 기울기=0.0):
    return [{"date": d.isoformat(), "open": 값 + i * 기울기,
             "high": 값 + i * 기울기, "low": 값 + i * 기울기,
             "close": 값 + i * 기울기, "volume": 1000}
            for i, d in enumerate(거래일(n, 시작))]


교차진입 = lambda p: {"logic": "AND", "conditions": [
    {"indicator": "PRICE", "operator": "crosses_above", "value": "MA", "period": p}]}
교차청산 = lambda p: {"logic": "AND", "conditions": [
    {"indicator": "PRICE", "operator": "crosses_below", "value": "MA", "period": p}]}
늘삼 = {"logic": "AND", "conditions": [{"indicator": "PRICE", "operator": ">", "value": 0}]}
안팜 = {"logic": "AND", "conditions": []}


# ── 라우트 검사용 가짜 야후 ──────────────────────────────

기간길이 = {"1mo": 30, "3mo": 90, "6mo": 180, "1y": 365, "2y": 730,
            "5y": 1825, "10y": 3650, "max": 12000}


@pytest.fixture
def 가짜야후(monkeypatch):
    """**yfinance 와 똑같이** period 를 오늘 기준으로 해석한다.

    이게 이 버그의 핵심이다. period='5y' 는 '5년짜리 구간' 이 아니라
    '오늘부터 5년 전까지' 다. 흉내 내지 않으면 라우트가 기간을 어떻게
    고르든 검사가 다 통과해 버린다.
    """
    오늘 = date.today()

    def 시세(symbol, period, interval, market):
        n = 기간길이.get(period, 365)
        나온것, d, c = [], 오늘 - timedelta(days=n), 100.0
        while d <= 오늘:
            if d.weekday() < 5:
                c *= 1.0004
                나온것.append({"date": d.isoformat(), "open": c, "high": c * 1.01,
                               "low": c * 0.99, "close": c, "volume": 1000})
            d += timedelta(days=1)
        return 나온것

    monkeypatch.setattr(R.yf_service, "get_ohlcv", 시세)
    return 오늘


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _횟수리셋():
    """/run 에는 분당 20회 제한이 있다. 이 파일은 그보다 많이 부른다."""
    def 지우기():
        try:
            R.limiter._storage.reset()
        except Exception:
            pass
    지우기()
    yield
    지우기()


def _몸(시작, 끝, **더):
    기본 = {"symbol": "AAPL", "market": "US",
            "start_date": 시작.isoformat() if hasattr(시작, "isoformat") else 시작,
            "end_date": 끝.isoformat() if hasattr(끝, "isoformat") else 끝,
            "entry_conditions": 늘삼, "exit_conditions": 안팜,
            "initial_capital": 10_000_000}
    기본.update(더)
    return 기본


# ══════════════════════════════════════════════════════════
# A1. 요청한 기간을 그대로 잰다
# ══════════════════════════════════════════════════════════
class Test기간:
    """yfinance period 는 **오늘 기준**인데 라우트가 기간 '길이' 로
    골랐다. 3년을 요청하면 '5y' 를 받아 와 겹치는 1.28년만 남았고
    화면은 3년을 쟀다고 믿었다(실측). 2015년·2008년처럼 안 겹치는
    구간은 400 '데이터가 부족합니다' 로 막혔다. 10년만 우연히 맞았다 —
    period_map 을 넘어가 'max' 로 떨어졌기 때문이다."""

    def test_과거_3년을_요청하면_3년을_잰다(self, client, 가짜야후):
        r = client.post("/api/v1/backtest/run",
                        json=_몸(date(2020, 1, 1), date(2023, 1, 1)))
        assert r.status_code == 200, r.text[:200]
        d = r.json()
        assert d["start_date"] <= "2020-01-05", \
            f"3년을 요청했는데 {d['start_date']} 부터 쟀다 — 앞이 잘렸다"
        assert 2.9 <= d["years"] <= 3.1, f"3년을 요청했는데 {d['years']}년을 쟀다"

    def test_아주_옛날_구간도_잰다(self, client, 가짜야후):
        """2008년 금융위기를 재 보려는 것은 백테스트의 가장 흔한 쓰임이다.
        예전에는 여기서 400 이 났다."""
        r = client.post("/api/v1/backtest/run",
                        json=_몸(date(2008, 1, 1), date(2009, 1, 1)))
        assert r.status_code == 200, \
            f"옛날 구간이 막혔다 — {r.status_code} {r.text[:160]}"
        assert r.json()["start_date"].startswith("2008")

    def test_실제로_잰_구간을_적어_보낸다(self, client, 가짜야후, 오늘=None):
        """짧아질 수 있는 이상(늦게 상장한 종목 등), 요청한 기간을
        쟀다고 화면이 믿게 두면 안 된다."""
        r = client.post("/api/v1/backtest/run",
                        json=_몸(date(2019, 3, 1), date(2021, 3, 1))).json()
        for 칸 in ("start_date", "end_date"):
            assert 칸 in r, f"응답에 {칸} 이 없다 — 화면이 무엇을 쟀는지 모른다"
        assert r["start_date"] == r["equity_curve"][0]["date"]
        assert r["end_date"] == r["equity_curve"][-1]["date"]

    def test_기간이름은_오늘부터_거꾸로_센다(self):
        """길이로 세면 안 된다는 것을 함수 수준에서도 박는다."""
        옛날 = (date.today() - timedelta(days=4000)).isoformat()
        끝 = (date.today() - timedelta(days=3800)).isoformat()
        #: 200일짜리 구간이지만 11년 전이므로 'max' 여야 한다
        assert R._기간이름(옛날, 끝) == "max", \
            "구간 길이로 골랐다 — 오늘부터 얼마나 거슬러 가는지로 골라야 한다"


# ══════════════════════════════════════════════════════════
# A2. 지표 워밍업
# ══════════════════════════════════════════════════════════
class Test워밍업:
    """라우트가 요청 기간으로 딱 잘라 줘서 엔진이 만든 지표 앞부분이
    비어 있었다. 1년 백테스트에 MA200 이면 **199봉(79%)이 죽은 구간**
    이라 거래 1건, 데워서 재면 6건이었다(실측)."""

    def test_MA200_이_요청_첫날부터_신호를_낸다(self, client, 가짜야후):
        오늘 = 가짜야후
        r = client.post("/api/v1/backtest/run", json=_몸(
            오늘 - timedelta(days=365), 오늘,
            entry_conditions={"logic": "AND", "conditions": [
                {"indicator": "PRICE", "operator": ">", "value": "MA", "period": 200}]},
            exit_conditions=안팜)).json()
        assert r["trades"], "MA200 으로는 1년 안에 한 번도 못 샀다"
        assert r["trades"][0]["entry_date"] == r["start_date"], \
            (f"첫 매수가 {r['trades'][0]['entry_date']} 로 밀렸다 — 지표가 "
             f"데워지지 않아 앞부분이 죽은 구간이다(시작 {r['start_date']})")

    def test_데운_구간은_성과에_안_들어간다(self):
        """앞을 같이 재면 요청한 것보다 긴 기간의 성적이 나온다.
        지표는 데운 값으로, 성과는 요청한 구간만 — 둘을 섞으면 안 된다."""
        전부 = 흔들리는봉(452)
        평가시작 = 전부[200]["date"]
        r = E.run(전부, 늘삼, 안팜, 평가시작=평가시작)
        assert r["start_date"] == 평가시작, \
            f"데우는 구간까지 성과에 들어갔다 ({r['start_date']})"
        assert len(r["equity_curve"]) == 252

    def test_평가시작이_없으면_예전처럼_전부_잰다(self):
        전부 = 흔들리는봉(300)
        assert len(E.run(전부, 늘삼, 안팜)["equity_curve"]) == 300

    def test_데운_덕분에_신호가_더_잡힌다(self):
        """같은 구간인데 앞을 데우면 크로스가 더 잡힌다 —
        이게 워밍업이 하는 일의 전부다."""
        전부 = 흔들리는봉(452)
        창 = 전부[200:]
        데움 = E.run(전부, 교차진입(200), 교차청산(200), 평가시작=창[0]["date"])
        안데움 = E.run(창, 교차진입(200), 교차청산(200))
        assert 데움["total_trades"] > 안데움["total_trades"], \
            (f"데워도 거래 수가 안 늘었다 — 데움 {데움['total_trades']}건 · "
             f"안 데움 {안데움['total_trades']}건")


# ══════════════════════════════════════════════════════════
# A3. 벤치마크도 배당을 받는다
# ══════════════════════════════════════════════════════════
def test_벤치마크에도_배당을_넘긴다(client, monkeypatch):
    """라우트가 벤치마크는 돌리자(..., None) 으로 불렀다. '토탈 리턴'
    을 켜면 내 것만 배당을 받아, SPY 10년으로 재 보니 **16.6% 차이**
    가 났다(2,347만원 vs 2,013만원). 어떤 조합을 넣어도 '벤치마크를
    이겼다' 가 나오기 쉬운, 기울어진 비교였다.

    시세와 배당을 끼워 넣고 **라우트를 실제로 돌린다.** 소스에 글자가
    있는지만 보면 '만들어 놓고 안 쓰는' 경우를 못 잡는다(그렇게 짰다가
    뮤테이션에 걸렸다).
    """
    날 = 거래일(끝=date(2023, 12, 29), 시작=date(2014, 1, 2))
    값 = {d: 100.0 * 1.07 ** (i / 252) for i, d in enumerate(날)}

    def 시세(symbol, period, interval, market):
        return [{"date": d.isoformat(), "open": v, "high": v, "low": v,
                 "close": v, "volume": 1000} for d, v in 값.items()]

    monkeypatch.setattr(R.yf_service, "get_ohlcv", 시세)

    받은심볼 = []

    async def 가짜배당표(자산들, 시작, 끝, 표시통화, 환율, 알림=None):
        """연 6% 짜리 굵은 배당 — 반영되면 결과가 확실히 갈린다.

        `알림` 을 받아 둔다. 진짜 _배당표 는 하나 받을 때마다 진행바에
        알려 주는데, 흉내 내는 쪽이 그 인자를 안 받으면 TypeError 로
        터진다 — 실제로 진행 표시를 넣으면서 이 검사가 깨졌다."""
        받은심볼.append(sorted(a.symbol for a in 자산들))
        return {a.symbol: {d: 값[d] * 0.06 / 4
                           for i, d in enumerate(날) if i and i % 63 == 0}
                for a in 자산들 if a.symbol not in ("현금",)}

    monkeypatch.setattr(R, "_배당표", 가짜배당표)

    몸 = {"assets": [{"symbol": "AAPL", "market": "US", "name": "AAPL", "weight": 100}],
          "currency": "USD", "initial_amount": 10_000_000,
          "start_date": "2014-01-02", "end_date": "2023-12-29",
          "contribution_period": "none", "contribution_amount": 0,
          "rebalance_period": "none", "total_return": True,
          "benchmark": "spy"}
    r = client.post("/api/v1/backtest/portfolio", json=몸)
    assert r.status_code == 200, r.text[:300]
    d = r.json()
    assert d.get("benchmark"), "벤치마크가 아예 안 나왔다"

    assert len(받은심볼) >= 2, \
        (f"배당표를 {len(받은심볼)}번만 만들었다 — 내 자산만 받고 벤치마크는 "
         "안 받았다. 내 것만 배당을 받는 기울어진 비교다")

    """같은 값·같은 기간·같은 배당이므로 **둘이 거의 같아야 한다.**
    벤치마크만 배당을 못 받으면 10년에 수십 % 가 벌어진다."""
    내것 = d["final_value"]
    벤치 = d["benchmark"]["final_value"]
    assert abs(내것 - 벤치) < 내것 * 0.05, \
        (f"같은 자료인데 내 것 {내것:,.0f} · 벤치마크 {벤치:,.0f} 로 "
         f"{abs(내것-벤치)/벤치*100:.1f}% 벌어졌다 — 한쪽만 배당을 받고 있다")


def test_배당을_받으면_결과가_달라진다():
    """위 검사가 '넘기기만 하고 안 쓰는' 경우를 못 잡으므로,
    엔진이 배당을 실제로 굴리는지는 따로 본다."""
    날 = 거래일(끝=date(2023, 12, 29), 시작=date(2014, 1, 2))
    값 = {d: 100.0 * 1.07 ** (i / 252) for i, d in enumerate(날)}
    배당 = {"SPY": {d: 값[d] * 0.015 / 4 for i, d in enumerate(날) if i and i % 63 == 0}}
    자산 = [{"symbol": "SPY", "market": "US", "weight": 100}]
    있 = 돌리기({"SPY": 값}, 자산, 10_000_000, 배당=배당)["final_value"]
    없 = 돌리기({"SPY": 값}, 자산, 10_000_000, 배당=None)["final_value"]
    assert 있 > 없 * 1.10, f"배당 재투자가 거의 반영이 안 됐다 ({있:,.0f} vs {없:,.0f})"


# ══════════════════════════════════════════════════════════
# A4. 월별 모드의 연율화
# ══════════════════════════════════════════════════════════
class Test연율화:
    """늘 √252 를 곱했다. 화면에서 '월별로 재기' 를 고르면 한 칸이 한
    달인데도 그대로 √252 라, √252/√12 = 4.58배가 부풀려졌다 —
    실측으로 **변동성 17.6% → 82.1%, 샤프 0.77 → 3.54**. 샤프 3.54 는
    세계 최고 헤지펀드 수준의 수라 사람이 자기 전략을 오해한다."""

    def _두가지(self):
        rnd = random.Random(11)
        날 = 거래일(끝=date(2023, 12, 29), 시작=date(2014, 1, 2))
        c, 값 = 100.0, {}
        for d in 날:
            c *= (1 + rnd.gauss(0.0004, 0.011))
            값[d] = c
        자산 = [{"symbol": "SPY", "market": "US", "weight": 100}]
        남길 = set(월말만(sorted(값)))
        일별 = 돌리기({"SPY": 값}, 자산, 10_000_000)
        월별 = 돌리기({"SPY": {d: v for d, v in 값.items() if d in 남길}},
                      자산, 10_000_000)
        return 일별, 월별

    def test_월별로_재도_변동성이_같다(self):
        일별, 월별 = self._두가지()
        비 = 월별["volatility"] / 일별["volatility"]
        assert 0.8 < 비 < 1.25, \
            (f"같은 값인데 변동성이 {비:.1f}배 달라진다 "
             f"(일별 {일별['volatility']}% · 월별 {월별['volatility']}%)")

    def test_월별로_재도_샤프가_같다(self):
        일별, 월별 = self._두가지()
        비 = 월별["sharpe"] / 일별["sharpe"]
        assert 0.8 < 비 < 1.25, \
            f"샤프가 {비:.1f}배 달라진다 (일별 {일별['sharpe']} · 월별 {월별['sharpe']})"


# ══════════════════════════════════════════════════════════
# A5. 승률·손익비에 수수료
# ══════════════════════════════════════════════════════════
class Test승률:
    """거래별 손익을 가격만으로 쟀다. 수수료 0.25% 에서 **승률 100% 인데
    실제 수익률 -6.74%** 가 같이 찍혔다 — 화면의 두 숫자가 정반대를
    말한 셈이다."""

    def _아슬아슬한거래(self):
        """수수료보다 조금 더 오르내리는 값 — 가격으로는 이기고
        수수료를 내면 지는 거래를 만든다."""
        날 = 거래일(40, 시작=date(2020, 1, 2))
        값, c = [100.0], 100.0
        for i in range(1, 40):
            c *= (1.001 if i % 2 else 0.9999)
            값.append(c)
        return [{"date": d.isoformat(), "open": 값[i], "high": 값[i],
                 "low": 값[i], "close": 값[i], "volume": 1000}
                for i, d in enumerate(날)]

    들 = {"logic": "AND", "conditions": [{"indicator": "ROC_1", "operator": "<", "value": 0}]}
    나 = {"logic": "AND", "conditions": [{"indicator": "ROC_1", "operator": ">", "value": 0}]}

    def test_수수료를_내면_승률이_내려간다(self):
        자료 = self._아슬아슬한거래()
        공짜 = E.run(자료, self.들, self.나, 거래비용=0.0, initial_capital=10_000_000)
        비쌈 = E.run(자료, self.들, self.나, 거래비용=0.0025, initial_capital=10_000_000)
        assert 비쌈["total_return"] < 0, "검사 자료가 틀렸다 — 손해가 나야 한다"
        assert 비쌈["win_rate"] < 공짜["win_rate"], \
            (f"수수료를 넣었는데 승률이 그대로다 — 공짜 {공짜['win_rate']}% · "
             f"수수료 {비쌈['win_rate']}% (실제 수익률 {비쌈['total_return']}%)")

    def test_승률과_수익률이_같은_말을_한다(self):
        자료 = self._아슬아슬한거래()
        r = E.run(자료, self.들, self.나, 거래비용=0.0025, initial_capital=10_000_000)
        졌다 = r["total_return"] < 0
        승률낮음 = r["win_rate"] < 50
        assert 졌다 == 승률낮음, \
            (f"수익률 {r['total_return']}% 인데 승률이 {r['win_rate']}% 다 — "
             "두 수가 정반대를 말한다")

    def test_거래마다_수수료_뺀_손익을_같이_준다(self):
        자료 = 곧은봉(40, 기울기=1.0)
        r = E.run(자료, 늘삼, 안팜, 거래비용=0.0025, initial_capital=10_000_000)
        t = r["trades"][0]
        assert "net_pnl_rate" in t, "수수료 뺀 손익이 없다"
        assert t["net_pnl_rate"] < t["pnl_rate"], \
            "수수료를 냈는데 순손익이 가격 손익보다 작지 않다"

    def test_수수료가_0이면_두_수가_같다(self):
        자료 = 곧은봉(40, 기울기=1.0)
        t = E.run(자료, 늘삼, 안팜, 거래비용=0.0)["trades"][0]
        assert abs(t["net_pnl_rate"] - t["pnl_rate"]) < 0.01


# ══════════════════════════════════════════════════════════
# B6. 적립식 낙폭
# ══════════════════════════════════════════════════════════
class Test적립식낙폭:
    """낙폭을 평가액 곡선으로 쟀다. 매달 넣는 돈이 곡선을 밀어 올려
    하락을 가려서, 똑같이 -40% 를 맞은 자료인데 거치식 37.7% · 적립식
    32.8% 가 나왔다. '내 돈이 얼마나 줄었나' 를 새로 넣은 돈이 좋게
    만든 셈이다."""

    def _폭락표(self):
        날 = 거래일(끝=date(2023, 12, 29), 시작=date(2014, 1, 2))
        값 = {}
        for i, d in enumerate(날):
            기본 = 100.0 * 1.07 ** (i / 252)
            깎기 = 1.0
            if 1260 <= i < 1400:
                깎기 = 1 - 0.40 * (i - 1260) / 140
            elif 1400 <= i < 1700:
                깎기 = 0.60 + 0.40 * (i - 1400) / 300
            값[d] = 기본 * 깎기
        return {"SPY": 값}

    자산 = [{"symbol": "SPY", "market": "US", "weight": 100}]

    def test_적립해도_낙폭이_같게_나온다(self):
        표 = self._폭락표()
        거치 = 돌리기(표, self.자산, 10_000_000)["mdd"]
        적립 = 돌리기(표, self.자산, 10_000_000,
                      적립주기="monthly", 적립금액=500_000)["mdd"]
        assert abs(거치 - 적립) < 1.0, \
            (f"같은 폭락인데 낙폭이 다르다 — 거치 {거치}% · 적립 {적립}%. "
             "넣은 돈이 하락을 가리고 있다")

    def test_거치식_낙폭은_안_바뀐다(self):
        """고치면서 거치식 값까지 바뀌면 그건 다른 버그를 넣은 것이다."""
        표 = self._폭락표()
        assert 36.0 < 돌리기(표, self.자산, 10_000_000)["mdd"] < 39.0


# ══════════════════════════════════════════════════════════
# B7. 마지막 청산 수수료
# ══════════════════════════════════════════════════════════
def test_마지막_청산_수수료가_수익률에도_들어간다():
    """곡선은 봉마다 그 봉의 매매를 하기 **전** 값을 적는다. 중간 봉의
    수수료는 다음 봉 값에 나타나는데 마지막 봉에는 다음이 없어서,
    마지막에 판 수수료가 수익률에 영영 안 들어갔다 — 실측으로 수수료
    합 56,621원 중 32,930원이 빠져 36.72% 와 36.39% 가 갈렸다.

    **값이 한 번도 안 움직이는 자료**로 잰다. 그러면 답이 하나로
    정해진다 — 번 것도 잃은 것도 없으니 줄어든 돈은 정확히 수수료다.
    수수료가 곡선에서 한 푼이라도 빠지면 이 등식이 깨진다.
    """
    자료 = 곧은봉(40)                      # 40봉 내내 100원
    자본 = 10_000_000
    r = E.run(자료, 늘삼, 안팜, 거래비용=0.0025, initial_capital=자본)

    곡선끝 = r["equity_curve"][-1]["value"]
    낸수수료 = r["costs"]
    assert 낸수수료 > 0, "검사 자료가 틀렸다 — 수수료가 나와야 한다"
    assert abs((자본 - 곡선끝) - 낸수수료) < 2, \
        (f"값이 하나도 안 움직였는데 줄어든 돈({자본 - 곡선끝:,.0f})과 "
         f"낸 수수료({낸수수료:,.0f})가 다르다 — 곡선에서 빠진 수수료가 "
         f"{낸수수료 - (자본 - 곡선끝):,.0f}원 있다")


def test_마지막_봉에_조건으로_팔려도_똑같다():
    """만기청산만 고치면 **마지막 봉에서 조건으로 팔린 경우**가 그대로
    남는다. 둘은 같은 봉·같은 종가에 같은 수량을 파니 끝값도 같아야
    한다."""
    자료 = 곧은봉(40, 기울기=1.0)
    자본, 비용 = 10_000_000, 0.0025
    만기 = E.run(자료, 늘삼, 안팜, 거래비용=비용, initial_capital=자본)
    조건 = E.run(자료, 늘삼,
                 {"logic": "AND", "conditions": [
                     {"indicator": "PRICE", "operator": ">=",
                      "value": 자료[-1]["close"]}]},
                 거래비용=비용, initial_capital=자본)
    assert abs(만기["equity_curve"][-1]["value"]
               - 조건["equity_curve"][-1]["value"]) < 2, \
        (f"같은 날 같은 값에 팔았는데 끝값이 다르다 — 만기청산 "
         f"{만기['equity_curve'][-1]['value']:,.0f} · 조건청산 "
         f"{조건['equity_curve'][-1]['value']:,.0f}")


def test_수수료가_0이면_곡선이_안_바뀐다():
    """고치면서 수수료 없는 옛날 결과까지 움직이면 그건 다른 버그다."""
    자료 = 곧은봉(40, 기울기=1.0)
    r = E.run(자료, 늘삼, 안팜, 거래비용=0.0, initial_capital=10_000_000)
    마지막 = [x for x in r["trades"] if x["type"] == "만기청산"][0]
    판돈 = 마지막["shares"] * 마지막["exit_price"]
    남은현금 = 10_000_000 - 마지막["shares"] * 마지막["entry_price"]
    assert abs(r["equity_curve"][-1]["value"] - (남은현금 + 판돈)) < 2


# ══════════════════════════════════════════════════════════
# B8. 생존 편향을 알린다
# ══════════════════════════════════════════════════════════
def test_유니버스가_생존편향을_알린다(client, 가짜야후):
    """종목 목록이 '오늘 살아남아 시총 상위에 있는 것들' 316개로 고정돼
    있다. 망했거나 밀려난 회사는 애초에 없어서 어떤 전략을 넣어도 실제
    보다 좋게 나온다. 과거 시점의 구성표가 없으면 **없다고 말하는 것**
    이 맞다 — 조용히 두면 사용자는 이 결과를 실제 성적으로 읽는다."""
    오늘 = 가짜야후
    r = client.post("/api/v1/backtest/universe", json={
        "universe": "CUSTOM", "custom_symbols": ["AAPL", "MSFT"], "market": "US",
        "start_date": (오늘 - timedelta(days=365)).isoformat(),
        "end_date": 오늘.isoformat(),
        "entry_conditions": 늘삼, "exit_conditions": 안팜})
    assert r.status_code == 200, r.text[:200]
    d = r.json()
    assert d.get("생존편향"), "생존 편향을 한 글자도 안 알린다"
    assert "오늘" in d["생존편향"]


# ══════════════════════════════════════════════════════════
# B9. 판 봉에서는 다시 안 산다
# ══════════════════════════════════════════════════════════
def test_판_봉에서는_되사지_않는다():
    """손절·익절은 `continue` 로 그 봉의 매수를 건너뛰는데 조건 청산만
    빠져 있었다. 파는 조건과 사는 조건이 같은 봉에 맞으면 같은 값에
    그대로 되샀다 — 값이 40봉 내내 그대로인 자료로 **거래 40건, 수수료
    173만원, 수익률 -16.71%** 가 나왔다."""
    자료 = 곧은봉(40)                     # 값이 하나도 안 움직인다
    r = E.run(자료, 늘삼, 늘삼, 거래비용=0.0025, initial_capital=10_000_000)
    assert r["total_trades"] <= len(자료) / 2 + 1, \
        (f"봉 {len(자료)}개에 거래가 {r['total_trades']}건이다 — "
         "판 봉에서 같은 값에 되사고 있다")


# ══════════════════════════════════════════════════════════
# C10·C11. 무위험수익률 · 현금 이자
# ══════════════════════════════════════════════════════════
class Test가정을_숨기지_않는다:
    """샤프는 '무위험으로 그냥 둬도 얻었을 것' 을 뺀 초과수익을 위험으로
    나눈 값이다. 0 으로 두면 금리 5% 인 해에 연 5% 를 번 전략이
    초과수익 0 인데도 샤프 0.5 로 나온다. 현금도 마찬가지로 이자가
    0 이면 현금을 담을수록 실제보다 나쁘게 나온다.

    기본값은 둘 다 0 이지만 **무엇을 가정했는지 응답에 적는다** —
    가정이 화면에 안 보이는 것이 0 자체보다 나쁘다."""

    def _표(self):
        rnd = random.Random(11)
        날 = 거래일(끝=date(2023, 12, 29), 시작=date(2014, 1, 2))
        c, 값 = 100.0, {}
        for d in 날:
            c *= (1 + rnd.gauss(0.0004, 0.011))
            값[d] = c
        return {"SPY": 값}

    def test_무위험수익률을_올리면_샤프가_내려간다(self):
        표 = self._표()
        자산 = [{"symbol": "SPY", "market": "US", "weight": 100}]
        높음 = 돌리기(표, 자산, 10_000_000, 무위험수익률=0.0)["sharpe"]
        낮음 = 돌리기(표, 자산, 10_000_000, 무위험수익률=0.05)["sharpe"]
        assert 낮음 < 높음, f"무위험수익률을 빼지 않는다 ({높음} → {낮음})"

    def test_무엇을_가정했는지_응답에_적는다(self):
        표 = self._표()
        자산 = [{"symbol": "SPY", "market": "US", "weight": 100}]
        r = 돌리기(표, 자산, 10_000_000, 무위험수익률=0.03, 현금이자=0.02)
        assert r["risk_free_rate"] == 3.0
        assert r["cash_rate"] == 2.0
        기본 = 돌리기(표, 자산, 10_000_000)
        assert 기본["risk_free_rate"] == 0.0, "0 도 가정이므로 적어야 한다"
        assert 기본["cash_rate"] == 0.0

    def test_구멍이_많으면_연율화도_따라간다(self):
        """신호 엔진은 늘 일봉을 받지만, 거래정지가 잦은 종목이면 한 해
        봉 수가 252 보다 훨씬 적다. √252 로 박아 두면 그런 종목의 위험이
        실제보다 크게 잡힌다. 자료에 몇 칸이 1년인지 물어봐야 한다."""
        빽빽 = 흔들리는봉(504)                      # 2년치, 하루도 안 빠짐
        듬성 = [b for i, b in enumerate(빽빽) if i % 2 == 0]   # 이틀에 한 번만
        a = E.run(빽빽, 늘삼, 안팜)["sharpe_ratio"]
        b = E.run(듬성, 늘삼, 안팜)["sharpe_ratio"]
        """같은 값을 성기게 본 것이라 샤프는 **거의 그대로**여야 한다
        (실측 1.000). √252 로 박아 두면 봉이 절반일 때 √2 = 1.41배로
        뛴다 — 그 차이를 잡으려면 범위를 좁게 잡아야 한다."""
        assert 0.90 < b / a < 1.12, \
            (f"봉이 절반으로 줄었다고 샤프가 {b/a:.2f}배 달라진다 "
             f"(빽빽 {a} · 듬성 {b}) — 연율화가 자료를 안 보고 √252 로 "
             "박혀 있다")

    def test_신호_백테스트도_같은_것을_적는다(self):
        """같은 화면의 두 탭이 다른 기준으로 재면 나란히 볼 수 없다."""
        자료 = 흔들리는봉(300)
        높음 = E.run(자료, 늘삼, 안팜, 무위험수익률=0.0)
        낮음 = E.run(자료, 늘삼, 안팜, 무위험수익률=0.05)
        assert 낮음["sharpe_ratio"] < 높음["sharpe_ratio"]
        assert 높음["risk_free_rate"] == 0.0

    def test_현금이_이자를_받는다(self):
        """올웨더처럼 현금을 20% 담는 조합을 30년 돌리면 그 몫이 30년
        내내 한 푼도 안 불어난 셈이 됐다."""
        표 = self._표()
        섞임 = [{"symbol": "SPY", "market": "US", "weight": 80},
                {"symbol": "현금", "market": "KR", "weight": 20}]
        무이자 = 돌리기(표, 섞임, 10_000_000, 현금이자=0.0)["final_value"]
        이자 = 돌리기(표, 섞임, 10_000_000, 현금이자=0.03)["final_value"]
        assert 이자 > 무이자, f"현금 이자가 안 붙는다 ({무이자:,.0f} → {이자:,.0f})"

    def test_현금이_없으면_이자도_영향이_없다(self):
        표 = self._표()
        전부주식 = [{"symbol": "SPY", "market": "US", "weight": 100}]
        a = 돌리기(표, 전부주식, 10_000_000, 현금이자=0.0)["final_value"]
        b = 돌리기(표, 전부주식, 10_000_000, 현금이자=0.05)["final_value"]
        assert abs(a - b) < 1.0, "현금이 없는데 이자가 붙었다"


# ══════════════════════════════════════════════════════════
# 저장까지 이어지는가
# ══════════════════════════════════════════════════════════
def test_새_설정이_저장에도_담긴다():
    """설정만 담고 결과는 안 담는 것이 실험 표의 방침이다. 그 방침이
    성립하려면 설정이 빠짐없이 있어야 한다 — 하나라도 빠지면 불러와
    다시 돌렸을 때 저장할 때와 다른 수가 나온다."""
    from app.models.stock import PortfolioExperiment
    import inspect
    칸들 = {c.name for c in PortfolioExperiment.__table__.columns}
    소스 = inspect.getsource(R.save_experiment)
    for 이름 in ("cash_rate", "risk_free_rate"):
        assert 이름 in 칸들, f"표에 {이름} 칸이 없다"
        assert f"{이름}=req.{이름}" in 소스, f"저장할 때 {이름} 을 안 담는다"


# ══════════════════════════════════════════════════════════
# 낙폭 곡선과 순위 (새 기능)
# ══════════════════════════════════════════════════════════
class Test낙폭:
    """최대 낙폭 하나만 보면 '한 번 크게 맞았다' 는 것밖에 모른다.
    실제로 견딜 수 있는지는 **얼마나 오래 잠겨 있었나**가 더 크게
    좌우한다 — -50% 를 1년 만에 회복한 것과 -35% 로 7년을 보낸 것은
    전혀 다른 경험이다."""

    def _폭락표(self):
        """5년째에 -40% 를 맞고 천천히 회복하는 값"""
        날 = 거래일(끝=date(2023, 12, 29), 시작=date(2014, 1, 2))
        값 = {}
        for i, d in enumerate(날):
            기본 = 100.0 * 1.07 ** (i / 252)
            깎기 = 1.0
            if 1260 <= i < 1400:
                깎기 = 1 - 0.40 * (i - 1260) / 140
            elif 1400 <= i < 1700:
                깎기 = 0.60 + 0.40 * (i - 1400) / 300
            값[d] = 기본 * 깎기
        return {"SPY": 값}

    자산 = [{"symbol": "SPY", "market": "US", "weight": 100}]

    def test_그래프_최저점이_MDD_와_같다(self):
        """솎으면서 바닥이 빠지면 그래프는 -31% 인데 옆 숫자는 -37% 인,
        한 화면에서 두 수가 다른 말을 하는 상태가 된다."""
        r = 돌리기(self._폭락표(), self.자산, 10_000_000)
        바닥 = min(x["dd"] for x in r["drawdown"])
        assert abs(abs(바닥) - r["mdd"]) < 0.01, \
            f"그래프 최저점 {바닥}% 인데 적어 놓은 MDD 는 -{r['mdd']}% 다"

    def test_적립해도_두_수가_안_어긋난다(self):
        """낙폭 곡선도 mdd 와 **같은 곡선**(납입을 지운 것)에서 재야 한다.
        평가액 곡선으로 재면 넣는 돈이 하락을 가린다."""
        r = 돌리기(self._폭락표(), self.자산, 10_000_000,
                   적립주기="monthly", 적립금액=500_000)
        바닥 = min(x["dd"] for x in r["drawdown"])
        assert abs(abs(바닥) - r["mdd"]) < 0.01

    def test_솎아도_날짜_순서가_유지된다(self):
        r = 돌리기(self._폭락표(), self.자산, 10_000_000)
        날들 = [x["date"] for x in r["drawdown"]]
        assert 날들 == sorted(날들), "솎으면서 날짜가 뒤섞였다"
        assert len(날들) == len(set(날들)), "같은 날이 두 번 들어갔다"

    def test_긴_기간은_솎아_보낸다(self):
        """10년치를 안 솎으면 이 배열 하나가 95KB 고, 벤치마크까지
        붙으면 응답이 406KB 가 된다(실측)."""
        r = 돌리기(self._폭락표(), self.자산, 10_000_000)
        assert len(r["curve"]) > 2000, "검사 자료가 짧다"
        assert len(r["drawdown"]) <= 560, \
            f"낙폭 곡선이 {len(r['drawdown'])}칸이다 — 안 솎고 있다"

    def test_짧은_기간은_안_솎는다(self):
        날 = 거래일(끝=date(2020, 6, 30), 시작=date(2020, 1, 2))
        값 = {d: 100.0 + i for i, d in enumerate(날)}
        r = 돌리기({"SPY": 값}, self.자산, 10_000_000)
        assert len(r["drawdown"]) == len(r["curve"])

    def _여러번폭락(self):
        """크고 작은 낙폭이 여러 번 오는 값 — 순서를 확인하려면
        낙폭이 하나뿐인 자료로는 아무것도 못 가른다."""
        rnd = random.Random(5)
        날 = 거래일(끝=date(2023, 12, 29), 시작=date(2014, 1, 2))
        c, 값 = 100.0, {}
        for d in 날:
            c *= (1 + rnd.gauss(0.0002, 0.016))
            값[d] = c
        return {"SPY": 값}

    def test_깊은_순서로_준다(self):
        r = 돌리기(self._여러번폭락(), self.자산, 10_000_000)
        깊이들 = [x["depth"] for x in r["drawdowns"]]
        assert len(깊이들) >= 3, f"낙폭이 {len(깊이들)}개뿐이라 순서를 못 가린다"
        assert 깊이들 == sorted(깊이들), f"깊은 순서가 아니다: {깊이들}"
        assert all(d < 0 for d in 깊이들), "낙폭이 양수로 들어 있다"

    def test_제일_깊은_것이_MDD_와_같다(self):
        r = 돌리기(self._폭락표(), self.자산, 10_000_000)
        assert abs(abs(r["drawdowns"][0]["depth"]) - r["mdd"]) < 0.01

    def test_적립해도_순위가_MDD_와_안_어긋난다(self):
        """순위도 mdd·낙폭곡선과 **같은 곡선**에서 재야 한다. 평가액
        곡선으로 재면 넣는 돈이 하락을 가려 제일 깊은 낙폭이 얕게
        나오고, 옆의 MDD 숫자와 다른 말을 한다."""
        r = 돌리기(self._폭락표(), self.자산, 10_000_000,
                   적립주기="monthly", 적립금액=500_000)
        assert r["drawdowns"], "낙폭 순위가 비었다"
        assert abs(abs(r["drawdowns"][0]["depth"]) - r["mdd"]) < 0.01, \
            (f"순위 맨 위는 {r['drawdowns'][0]['depth']}% 인데 MDD 는 "
             f"-{r['mdd']}% 다 — 서로 다른 곡선에서 쟀다")

    def test_고점_바닥_회복_날짜가_순서대로다(self):
        r = 돌리기(self._폭락표(), self.자산, 10_000_000)
        for d in r["drawdowns"]:
            assert d["start"] <= d["trough"], f"바닥이 고점보다 앞이다: {d}"
            if d["end"]:
                assert d["trough"] <= d["end"], f"회복이 바닥보다 앞이다: {d}"

    def test_아직_회복_못_했으면_비워_둔다(self):
        """마지막 날짜를 넣으면 회복한 것처럼 읽힌다."""
        날 = 거래일(끝=date(2023, 12, 29), 시작=date(2014, 1, 2))
        #: 중간까지 오르다가 끝까지 떨어지기만 하는 값
        값 = {}
        for i, d in enumerate(날):
            값[d] = (100.0 + i * 0.05) if i < 1500 else (175.0 - (i - 1500) * 0.03)
        r = 돌리기({"SPY": 값}, self.자산, 10_000_000)
        못한것 = [x for x in r["drawdowns"] if x["end"] is None]
        assert 못한것, "끝까지 떨어지는 자료인데 '아직' 인 낙폭이 없다"
        x = 못한것[0]
        assert x["recovery_days"] is None, "회복 못 했는데 회복 날짜가 들어 있다"
        assert x["underwater_days"] > 0

    def test_잠긴_날이_고점부터_회복까지다(self):
        r = 돌리기(self._폭락표(), self.자산, 10_000_000)
        for d in r["drawdowns"]:
            if d["end"]:
                assert d["underwater_days"] == \
                    d["to_trough_days"] + (d["recovery_days"] or 0), \
                    f"잠긴 날이 '고점→바닥' + '바닥→회복' 과 안 맞는다: {d}"

    def test_거의_안_떨어진_것은_순위에_안_넣는다(self):
        """현금이 많은 조합처럼 거의 안 흔들리는 자료에서는 -0.001%
        짜리 흔들림이 '깊었던 순서' 다섯 칸을 채워 버린다. 그건 낙폭이
        아니라 소수점 noise 라, 보여 주면 읽는 사람만 헷갈린다."""
        날 = 거래일(끝=date(2020, 12, 30), 시작=date(2020, 1, 2))
        값 = {}
        for i, d in enumerate(날):
            """꾸준히 오르되 이따금 **정말로 조금** 내린다.

            빼는 양이 오르는 양보다 커야 실제로 내려간다 — 처음에는
            0.002 를 뺐는데 한 칸에 0.01 씩 오르고 있어서 값이 그대로
            올랐다. 그러면 낙폭이 아예 0 이라 이 검사가 아무것도 안
            가린다(뮤테이션에 살아남아서 알았다).

            한 칸당 0.01 오르는데 0.015 를 빼니 0.005 내린다 —
            100 대비 0.005% 로, 걸러야 할 noise 수준이다."""
            값[d] = 100.0 + i * 0.01 - (0.015 if i % 7 == 3 else 0.0)
        #: 정말로 내려가는 자료인지부터 확인한다 — 안 내려가면 검사가 헛돈다
        값들 = [값[d] for d in sorted(값)]
        assert any(b < a for a, b in zip(값들, 값들[1:])), \
            "검사 자료가 한 번도 안 내려간다 — 이러면 아무것도 못 가린다"

        r = 돌리기({"SPY": 값}, self.자산, 10_000_000)
        assert r["drawdowns"] == [], \
            (f"noise 수준 낙폭이 순위에 들어갔다: "
             f"{[x['depth'] for x in r['drawdowns']]} — 거르기를 끄면 "
             "'-0.0%' 다섯 줄이 표를 채운다")

    def test_안_떨어졌으면_순위가_빈다(self):
        """계속 오르기만 한 자료에 낙폭 줄을 만들면 안 된다."""
        날 = 거래일(끝=date(2020, 12, 30), 시작=date(2020, 1, 2))
        값 = {d: 100.0 + i for i, d in enumerate(날)}
        r = 돌리기({"SPY": 값}, self.자산, 10_000_000)
        assert r["drawdowns"] == []
        assert all(x["dd"] == 0 for x in r["drawdown"])

    def test_다섯_개까지만_준다(self):
        r = 돌리기(self._폭락표(), self.자산, 10_000_000)
        assert len(r["drawdowns"]) <= 5


def test_벤치마크도_낙폭_곡선을_준다(client, monkeypatch):
    """낙폭을 나란히 그리려면 벤치마크 것도 와야 한다. 'mdd 는 6040 이
    더 작았다' 만으로는 언제 얼마나 오래 잠겨 있었는지를 알 수 없다.

    안 보내면 화면에 단추만 있고 선은 안 그려진다 — 눌러도 아무 일이
    안 일어나는 단추는 '고장' 으로 읽힌다."""
    rnd = random.Random(9)
    날 = 거래일(끝=date(2023, 12, 29), 시작=date(2014, 1, 2))
    c, 값 = 100.0, {}
    for d in 날:
        c *= (1 + rnd.gauss(0.0003, 0.013))
        값[d] = c

    def 시세(symbol, period, interval, market):
        return [{"date": d.isoformat(), "open": v, "high": v, "low": v,
                 "close": v, "volume": 1000} for d, v in 값.items()]

    monkeypatch.setattr(R.yf_service, "get_ohlcv", 시세)

    async def 배당없음(자산들, 시작, 끝, 표시통화, 환율, 알림=None):
        #: 알림 을 안 받으면 진짜를 대신할 수 없다 — TypeError 로 터진다
        return {}
    monkeypatch.setattr(R, "_배당표", 배당없음)

    r = client.post("/api/v1/backtest/portfolio", json={
        "assets": [{"symbol": "AAPL", "market": "US", "name": "AAPL", "weight": 100}],
        "currency": "USD", "initial_amount": 10_000_000,
        "start_date": "2014-01-02", "end_date": "2023-12-29",
        "contribution_period": "none", "contribution_amount": 0,
        "rebalance_period": "none", "total_return": False,
        "benchmark": "spy"})
    assert r.status_code == 200, r.text[:300]
    d = r.json()
    assert d.get("benchmark"), "벤치마크가 아예 안 나왔다"
    assert d["benchmark"].get("drawdown"), \
        "벤치마크 낙폭 곡선이 없다 — 화면이 나란히 그릴 수가 없다"
    #: 내 것과 같은 모양이어야 화면이 날짜로 맞출 수 있다
    첫칸 = d["benchmark"]["drawdown"][0]
    assert set(첫칸) == {"date", "dd"}, f"모양이 다르다: {첫칸}"


# ══════════════════════════════════════════════════════════
# 사진과 견줘 빠져 있던 지표들 (새 기능)
# ══════════════════════════════════════════════════════════
class Test지표:
    """연 수익률만 보면 한 해 안에서 얼마나 출렁였는지가 통째로
    사라진다. +20% 인 해도 한 달에 -12% 를 맞았을 수 있고, 그걸
    견디는 것이 실제 경험이다."""

    def _표(self, 씨=4, 시작=date(2014, 1, 2), 끝=date(2026, 9, 17)):
        rnd = random.Random(씨)
        날 = 거래일(끝=끝, 시작=시작)
        c, 값 = 100.0, {}
        for d in 날:
            c *= (1 + rnd.gauss(0.0005, 0.011))
            값[d] = c
        return {"SPY": 값}

    자산 = [{"symbol": "SPY", "market": "US", "weight": 100}]

    def test_달마다_수익률이_달_수만큼_나온다(self):
        r = 돌리기(self._표(), self.자산, 10_000_000)
        assert len(r["monthly"]) == r["total_months"]
        #: 첫 달은 시작값이 없어 안 센다 — 12년치면 150개 언저리다
        assert 140 < r["total_months"] < 160, r["total_months"]

    def test_첫_달은_안_센다(self):
        """첫 달은 **비교할 시작값이 없다.** 값들[0] 을 쓰면 그 달만
        0% 가 되어 '한 번도 안 움직인 달' 로 잡히고, 음수 칸을 쓰면
        마지막 값과 견주게 되어 터무니없는 수가 나온다."""
        r = 돌리기(self._표(), self.자산, 10_000_000)
        assert r["monthly"][0]["month"] == "2014-02", \
            f"첫 달(2014-01)이 섞여 있다: {r['monthly'][0]}"
        #: 섞였으면 마지막 값과 견준 말도 안 되는 수가 끼어든다
        assert all(-60 < x["return"] < 60 for x in r["monthly"]), \
            f"달 수익률에 터무니없는 수가 있다: {max(r['monthly'], key=lambda x: abs(x['return']))}"

    def test_월_최고최저가_달마다_안에_있다(self):
        r = 돌리기(self._표(), self.자산, 10_000_000)
        값들 = [x["return"] for x in r["monthly"]]
        assert r["best_month"] == max(값들)
        assert r["worst_month"] == min(값들)

    def test_오른_달_수가_실제와_맞는다(self):
        r = 돌리기(self._표(), self.자산, 10_000_000)
        assert r["positive_months"] == sum(1 for x in r["monthly"] if x["return"] > 0)
        assert 0 < r["positive_months"] < r["total_months"]

    def test_적립해도_달_수익률이_부풀지_않는다(self):
        """납입을 안 빼면 매달 넣는 사람은 **어떤 달이든 플러스**가
        나온다 — 넣은 돈이 수익으로 둔갑한다."""
        표 = self._표()
        거치 = 돌리기(표, self.자산, 10_000_000)
        적립 = 돌리기(표, self.자산, 10_000_000,
                      적립주기="monthly", 적립금액=2_000_000)
        assert 적립["positive_months"] < 적립["total_months"], \
            "적립하니 모든 달이 플러스가 됐다 — 납입을 안 뺐다"
        #: 같은 값이므로 오른 달 수가 크게 다르면 안 된다
        assert abs(적립["positive_months"] - 거치["positive_months"]) <= 3

    def test_자료가_짧으면_긴_구간은_못_잰다(self):
        """3개월치를 '1년 수익률' 이라 적으면 안 된다."""
        짧은표 = self._표(시작=date(2026, 1, 2), 끝=date(2026, 9, 17))
        r = 돌리기(짧은표, self.자산, 10_000_000)
        assert r["return_1y"] is None, "8개월치로 1년 수익률을 냈다"
        assert r["return_3y"] is None
        assert r["std_1y"] is None

    def test_자료가_길면_1_3_5년을_다_잰다(self):
        r = 돌리기(self._표(), self.자산, 10_000_000)
        for 칸 in ("return_1y", "return_3y", "return_5y",
                   "std_1y", "std_3y", "std_5y"):
            assert r[칸] is not None, f"{칸} 을 못 쟀다"

    def test_소티노_분모를_전체_칸으로_나눈다(self):
        """분모는 **전체 칸 수**로 나눈다(내려간 칸 수가 아니다).

        내려간 칸 수로 나누면 합은 그대로인데 나누는 수가 확 작아져
        하방편차가 커지고, 소티노가 바닥으로 떨어진다 — 거의 안
        흔들리다 딱 한 번 빠진 자료로 재 보니 **1.106 이 0.031** 이
        됐다. 한 번 빠진 것을 '늘 그만큼 위험하다' 로 세는 셈이다.

        그런 자료에서는 내려간 흔들림이 곧 전체 흔들림이라, 소티노가
        샤프와 비슷하게 나오는 것이 맞는다."""
        날 = 거래일(끝=date(2024, 12, 31), 시작=date(2020, 1, 2))
        값, c = {}, 100.0
        for i, d in enumerate(날):
            #: 꾸준히 조금씩 오르다가 한 번만 -15%
            c *= 0.85 if i == 600 else 1.0004
            값[d] = c
        r = 돌리기({"SPY": 값}, self.자산, 10_000_000)
        assert r["sortino"] is not None and r["sharpe"] is not None
        assert 0.5 < r["sortino"] / r["sharpe"] < 2.0, \
            (f"소티노 {r['sortino']} · 샤프 {r['sharpe']} — 내려간 흔들림이 곧 "
             "전체 흔들림인 자료인데 둘이 크게 다르다. 분모를 내려간 칸 "
             "수로 나누고 있다")

    def test_소티노가_샤프보다_크다(self):
        """소티노는 **내려간 흔들림만** 위험으로 센다. 오르는 쪽을 빼니
        분모가 작아져, 오름이 큰 자료에서는 샤프보다 커야 맞는다."""
        r = 돌리기(self._표(), self.자산, 10_000_000)
        assert r["sortino"] is not None
        assert r["sortino"] > r["sharpe"], \
            f"소티노 {r['sortino']} 가 샤프 {r['sharpe']} 보다 작다"

    def test_소티노도_무위험수익률을_뺀다(self):
        표 = self._표()
        높음 = 돌리기(표, self.자산, 10_000_000, 무위험수익률=0.0)["sortino"]
        낮음 = 돌리기(표, self.자산, 10_000_000, 무위험수익률=0.05)["sortino"]
        assert 낮음 < 높음

    def test_MDD_바닥_날짜가_낙폭_순위와_맞는다(self):
        """같은 -30% 라도 2008년이었는지 작년이었는지에 따라 읽는 뜻이
        전혀 다르다."""
        r = 돌리기(self._표(), self.자산, 10_000_000)
        assert r["mdd_date"] == r["drawdowns"][0]["trough"]


class Test폭락때:
    """'최대 낙폭 -30%' 만 보면 언제 어떤 일로 그랬는지 모른다. 사람이
    실제로 묻는 것은 '내 조합이 코로나 때 어땠나' 다."""

    자산 = [{"symbol": "SPY", "market": "US", "weight": 100}]

    def _표(self, 시작=date(2005, 1, 3), 끝=date(2026, 9, 17)):
        rnd = random.Random(4)
        날 = 거래일(끝=끝, 시작=시작)
        c, 값 = 100.0, {}
        for d in 날:
            흔들 = rnd.gauss(0.0005, 0.011)
            if date(2007, 10, 9) <= d <= date(2009, 3, 9):
                흔들 -= 0.0018
            if date(2020, 2, 19) <= d <= date(2020, 3, 23):
                흔들 -= 0.016
            c *= (1 + 흔들)
            값[d] = c
        return {"SPY": 값}

    def test_금융위기와_코로나에_크게_빠진다(self):
        r = 돌리기(self._표(), self.자산, 10_000_000)
        이름들 = {x["name"]: x["return"] for x in r["crises"]}
        assert 이름들["미국 금융위기"] < -20, 이름들
        assert 이름들["코로나"] < -15, 이름들

    def test_자료가_없는_구간은_아예_안_낸다(self):
        """0% 로 적으면 '안 빠졌다' 로 읽히는데, 사실은 그때 이 조합이
        없었던 것이다."""
        r = 돌리기(self._표(), self.자산, 10_000_000)
        이름들 = [x["name"] for x in r["crises"]]
        assert "닷컴버블 붕괴" not in 이름들, \
            "2005년부터인데 2000년 닷컴버블 성적을 냈다"

    def test_일부만_겹치면_실제로_잰_기간을_적는다(self):
        표 = self._표(시작=date(2008, 6, 2))
        r = 돌리기(표, self.자산, 10_000_000)
        금융 = [x for x in r["crises"] if x["key"] == "gfc"]
        assert 금융, "금융위기 구간에 자료가 걸치는데 안 냈다"
        x = 금융[0]
        assert x["partial"] is True
        assert x["measured_start"] >= "2008-06-02"
        assert x["start"] == "2007-10-09"      # 요청한 구간은 그대로 적는다

    def test_며칠짜리_조각으로는_안_낸다(self):
        """'코로나 때 -3%' 를 이틀치로 적으면 안 된다."""
        표 = self._표(시작=date(2020, 3, 19))
        r = 돌리기(표, self.자산, 10_000_000)
        assert not [x for x in r["crises"] if x["key"] == "covid"]

    def test_구간_직전_값부터_잰다(self):
        """구간 첫날을 시작으로 잡으면 그날의 하락이 통째로 빠진다."""
        r = 돌리기(self._표(), self.자산, 10_000_000)
        코로나 = [x for x in r["crises"] if x["key"] == "covid"][0]
        assert 코로나["measured_start"] < "2020-02-19", \
            f"구간 첫날({코로나['measured_start']})부터 쟀다 — 그날 하락이 빠진다"


def test_벤치마크_키의_뜻을_바꾸지_않는다():
    """저장된 실험이 이 키를 들고 있다.

    'kospi' 는 처음부터 069500(KODEX 200)이었다. 뜻을 바꾸면 같은
    실험을 다시 열었을 때 **조용히 다른 것과 견주게 된다** — 결과만
    달라지고 아무 오류도 안 난다.

    코스피 지수는 새 키(kospi_index)로 더했다. 지수는 ETF 가 아니라
    배당이 없으므로 index_only 로 표시한다."""
    표 = R.벤치마크표
    assert 표["kospi"]["assets"][0]["symbol"] == "069500", \
        "'kospi' 가 더 이상 KODEX 200 이 아니다 — 저장된 실험의 뜻이 바뀐다"
    assert 표["kospi"]["name"] == "코스피200"

    assert "kospi_index" in 표, "코스피 지수 벤치마크가 없다"
    assert 표["kospi_index"]["assets"][0]["symbol"] == "^KS11"
    assert 표["kospi_index"].get("index_only") is True, \
        "지수는 배당이 없다는 표시가 없다 — 토탈 리턴과 기준이 다르다"

    #: 두 키가 다른 것을 가리켜야 '코스피' 와 '코스피200' 이 뜻이 있다
    assert (표["kospi"]["assets"][0]["symbol"]
            != 표["kospi_index"]["assets"][0]["symbol"])


# ══════════════════════════════════════════════════════════
# 진행 상황 — 92% 에서 멈춰 보이던 것
# ══════════════════════════════════════════════════════════
class Test진행:
    """화면의 진행바가 순전히 추측이었다. '어림한 시간 대비 지난 시간'
    이라 92% 에서 박혀 놓고 실제로는 30초를 더 기다렸다 — 자산 둘이면
    어림이 4.2초인데 무료 서버가 자고 있었으면 첫 요청이 30초를 넘는다.

    이제 서버가 **실제로 한 일**을 적어 둔다. 시세를 여덟 중 셋 받았으면
    셋이라고 적혀 있고, 화면은 그걸 그대로 그린다."""

    def test_단계마다_퍼센트가_커진다(self):
        """앞 단계의 몫을 다 더하고 지금 단계는 된 만큼만 더한다 —
        그래서 뒤로 가지 않는다. 뒤로 가는 막대는 고장으로 읽힌다."""
        본것 = []
        for 단계, 된, 전 in [("시세", 0, 5), ("시세", 3, 5), ("시세", 5, 5),
                             ("환율", 1, 1), ("배당", 2, 5), ("배당", 5, 5),
                             ("계산", 1, 1), ("벤치마크", 1, 1)]:
            R._진행쓰기("k-test-0001", 단계, 된, 전)
            본것.append(R.cache.get("진행:k-test-0001")["percent"])
        assert 본것 == sorted(본것), f"퍼센트가 뒤로 갔다: {본것}"
        assert 본것[0] == 0
        assert 본것[-1] == 99

    def test_100_을_먼저_안_찍는다(self):
        """다 됐다고 해 놓고 계속 도는 것이 제일 나쁘다 — 진짜 100 은
        응답이 실제로 왔을 때만이다."""
        R._진행쓰기("k-test-0002", "벤치마크", 1, 1)
        assert R.cache.get("진행:k-test-0002")["percent"] == 99

    def test_열쇠가_없으면_아무것도_안_한다(self):
        """열쇠를 안 보내도 계산은 그대로 돈다 — 진행 표시는 덤이다."""
        R._진행쓰기(None, "시세", 1, 2)      # 터지면 안 된다
        R._진행쓰기("", "시세", 1, 2)

    def test_전체가_0_이어도_안_터진다(self):
        R._진행쓰기("k-test-0003", "시세", 0, 0)
        assert R.cache.get("진행:k-test-0003") is not None

    def test_진행_보기가_없는_열쇠에_빈_값을_준다(self, client):
        """404 를 내면 화면이 '실패' 로 읽어 에러를 띄우는데, 진행
        표시가 없다고 계산이 실패한 것이 아니다."""
        r = client.get("/api/v1/backtest/portfolio/progress/없는열쇠abcdefg")
        assert r.status_code == 200, r.text[:200]
        assert r.json() == {}

    def test_적어_둔_것을_그대로_읽는다(self, client):
        R._진행쓰기("k-test-0004", "배당", 3, 8, "TLT 배당")
        d = client.get("/api/v1/backtest/portfolio/progress/k-test-0004").json()
        assert d["단계"] == "배당"
        assert (d["done"], d["total"]) == (3, 8)
        assert d["글"] == "TLT 배당"
        assert 0 < d["percent"] < 99

    def test_경로_칸_이름이_영문이다(self):
        """Starlette 이 경로에서 칸을 찾을 때 쓰는 규칙이
        [a-zA-Z_][a-zA-Z0-9_]* 다. 한글로 지으면 칸으로 안 잡히고
        **글자 그대로**가 되어, 라우트 목록에는 보이는데 부르면 404 가
        난다 — 눈으로는 못 찾는 모양이다(실제로 그렇게 짰다가 걸렸다)."""
        길 = [r.path for r in app.routes
              if "portfolio/progress" in getattr(r, "path", "")]
        assert 길, "진행 보기 경로가 없다"
        import re
        for p in 길:
            for 칸 in re.findall(r"\{([^}]+)\}", p):
                assert re.fullmatch(r"[a-zA-Z_][a-zA-Z0-9_]*", 칸), \
                    f"경로 칸 이름 '{칸}' 이 영문이 아니다 — 부르면 404 가 난다"

    def test_라우트가_단계마다_실제로_적는다(self, client, monkeypatch):
        """함수만 따로 검사하면 '잘 만들어 놓고 안 부르는' 경우를 못
        잡는다 — 실제로 배당 알림을 떼어 봤더니 아무 검사도 안 죽었다.

        적는 것을 전부 받아 적고, **시세와 배당이 하나씩 올라가는지**
        본다. gather 가 다 끝난 뒤 한 번만 알리면 그 사이 내내 막대가
        멈춰 있다 — 자산이 많을수록 제일 오래 걸리는 구간이 통째로
        죽은 시간이 된다."""
        적힌것 = []
        원래 = R._진행쓰기
        monkeypatch.setattr(R, "_진행쓰기",
                            lambda 열쇠, 단계, 된것=1, 전체=1, 글="":
                            (적힌것.append((단계, 된것, 전체)),
                             원래(열쇠, 단계, 된것, 전체, 글))[1])

        날 = 거래일(끝=date(2023, 12, 29), 시작=date(2014, 1, 2))
        값 = {d: 100.0 * 1.07 ** (i / 252) for i, d in enumerate(날)}
        monkeypatch.setattr(R.yf_service, "get_ohlcv",
                            lambda *a, **k: [{"date": d.isoformat(), "open": v,
                                              "high": v, "low": v, "close": v,
                                              "volume": 1000} for d, v in 값.items()])

        async def 배당없음(자산들, 시작, 끝, 표시통화, 환율, 알림=None):
            """진짜 _배당표 처럼 **하나씩 알린다**"""
            for i, a in enumerate(자산들, 1):
                if 알림:
                    알림(i, len(자산들), a.symbol)
            return {}
        monkeypatch.setattr(R, "_배당표", 배당없음)

        자산 = [{"symbol": s, "market": "US", "name": s, "weight": 25}
                for s in ["SPY", "QQQ", "TLT", "GLD"]]
        r = client.post("/api/v1/backtest/portfolio", json={
            "assets": 자산, "currency": "USD", "initial_amount": 10_000_000,
            "start_date": "2014-01-02", "end_date": "2023-12-29",
            "contribution_period": "none", "contribution_amount": 0,
            "rebalance_period": "none", "total_return": True,
            "benchmark": "none", "progress_key": "k-route-000001"})
        assert r.status_code == 200, r.text[:300]

        시세것 = [x for x in 적힌것 if x[0] == "시세"]
        배당것 = [x for x in 적힌것 if x[0] == "배당"]
        assert len({x[1] for x in 시세것}) >= 3, \
            f"시세를 하나씩 안 알린다: {시세것}"
        assert len({x[1] for x in 배당것}) >= 3, \
            f"배당을 하나씩 안 알린다: {배당것}"
        #: 마지막에는 다 됐다고 적어야 화면이 92%에 걸려 있지 않는다
        assert 적힌것[-1][0] == "벤치마크"

    def test_요청에_진행_열쇠를_받는다(self):
        assert "progress_key" in R.자산배분요청.model_fields, \
            "화면이 열쇠를 보낼 곳이 없다 — 서버가 진행을 적어 둘 데가 없다"
