"""자산배분 설정 **열일곱 개가 하나도 빠짐없이 결과를 바꾸는가.**

── 왜 이 파일이 따로 있나 ─────────────────────────────────

화면에 조작칸이 있다고 그 값이 계산에 닿는다는 뜻은 아니다. 칸은
있는데 서버로 안 보내거나, 보내는데 엔진 인자로 안 넘기거나, 넘기는데
엔진이 안 쓰는 — 세 군데 중 하나만 끊겨도 **아무 일도 안 일어난다.**
오류도 안 난다. 사용자는 수수료를 0.25%로 올려 놓고 '별 차이 없네'
라고 생각하며 돌아간다. 백테스트에서 제일 조용한 실패다.

다른 검사들은 *엔진이 맞게 계산하는가*를 본다. 여기서는 **설정이
실제로 엔진까지 닿는가**만 본다 — 값이 정확한지가 아니라, 켜고 끈
것이 결과에 나타나는지.

── 어떻게 보나 ────────────────────────────────────────────

설정 **하나만** 바꿔 두 번 돌리고 결과가 다른지 본다. 둘이 같으면
그 칸은 죽은 칸이다. 시세는 가짜를 넣어 고정한다 — 야후가 매번
다른 수를 주면 '달라졌다' 가 설정 때문인지 시세 때문인지 알 수 없다.

가짜 시세는 두 자산이 **서로 다르게 움직이게** 만든다. 둘이 똑같이
움직이면 리밸런싱을 해도 팔 것도 살 것도 없어서, 리밸런싱 칸이
죽어 있어도 검사가 통과한다.
"""
import math
import pytest
from datetime import date, timedelta
from fastapi.testclient import TestClient

from app.main import app


시작일 = date(2016, 1, 4)
끝일 = date(2021, 12, 30)


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _횟수제한_지우기():
    """/portfolio 는 분당 10회 제한이 걸려 있다. 이 파일은 그보다
    훨씬 많이 부르므로 호출 수만 지운다(제한 자체는 그대로 둔다 —
    누가 데코레이터를 떼면 다른 검사가 잡아야 한다)."""
    _리셋()
    yield
    _리셋()


def _리셋():
    from app.api.routes import backtest as R
    try:
        R.limiter._storage.reset()
    except Exception:
        pass


# ═══════════════════════════════════════════════════════════
#  가짜 시세 — 자산마다 **다르게** 움직인다
# ═══════════════════════════════════════════════════════════

def 장날들(부터: date = 시작일, 까지: date = 끝일) -> list[date]:
    나온것, d = [], 부터
    while d <= 까지:
        if d.weekday() < 5:
            나온것.append(d)
        d += timedelta(days=1)
    return 나온것


def _값(심볼: str, i: int) -> float:
    """i 번째 장날의 종가.

    AAA 는 꾸준히 오르고 BBB 는 크게 출렁인다. 둘이 어긋나야
    리밸런싱이 실제로 사고팔 것을 만든다 — 같이 움직이면 리밸런싱
    칸이 죽어 있어도 결과가 안 달라져서 검사가 못 잡는다.
    """
    if 심볼 == "AAA":
        return 100.0 * (1.0004 ** i)
    if 심볼 == "BBB":
        return 100.0 * (1 + 0.35 * math.sin(i / 90.0))
    if 심볼 == "USDKRW=X":
        return 1100.0 + 200.0 * math.sin(i / 200.0)
    if 심볼.startswith("^"):
        return 1000.0 * (1.0003 ** i)
    return 100.0 * (1.0002 ** i)          # 나머지(벤치마크 ETF 등)


#: 이 종목만 **늦게 상장**한 것으로 친다 — '확장' 설정을 보려면
#  ETF 앞이 비어 있어야 한다. SPY 는 지수잇기 표에서 ^GSPC 로 이어진다.
늦게생긴것 = {"SPY": date(2019, 1, 2)}


def 봉들(심볼: str) -> list[dict]:
    부터 = 늦게생긴것.get(심볼, 시작일)
    나온것 = []
    for i, d in enumerate(장날들()):
        if d < 부터:
            continue
        v = _값(심볼, i)
        나온것.append({"date": d.isoformat(), "open": v, "high": v,
                       "low": v, "close": v, "volume": 1000})
    return 나온것


@pytest.fixture(autouse=True)
def _가짜시세(monkeypatch):
    from app.api.routes import backtest as R
    from app.services import dividend_service as DV

    def 시세(symbol, period, interval, market):
        return 봉들(symbol)

    def 배당(symbol, market, 받아도되나=True):
        """분기마다 주당 0.5. '토탈 리턴' 을 껐을 때와 켰을 때가
        달라지려면 배당이 실제로 있어야 한다."""
        if symbol == "BBB":
            return {}
        나온것 = []
        for d in 장날들():
            if d.month in (3, 6, 9, 12) and d.day in (15, 16, 17) \
                    and not any(x["date"][:7] == d.isoformat()[:7] for x in 나온것):
                나온것.append({"date": d.isoformat(), "amount": 0.5})
        return {"recent": 나온것}

    monkeypatch.setattr(R.yf_service, "get_ohlcv", 시세)
    monkeypatch.setattr(DV, "한종목", 배당)


기본자산 = [{"symbol": "AAA", "market": "US", "weight": 60},
            {"symbol": "BBB", "market": "US", "weight": 40}]


def 몸(**더) -> dict:
    기본 = {
        "assets": 기본자산,
        "currency": "USD",
        "initial_amount": 10_000_000,
        "start_date": 시작일.isoformat(),
        "end_date": 끝일.isoformat(),
        "contribution_period": "none",
        "contribution_amount": 0,
        "rebalance_period": "none",
        "total_return": False,
        "benchmark": "none",
    }
    기본.update(더)
    return 기본


def 돌려(client, **더) -> dict:
    r = client.post("/api/v1/backtest/portfolio", json=몸(**더))
    assert r.status_code == 200, f"{더} → {r.status_code} {r.text[:300]}"
    return r.json()


# ═══════════════════════════════════════════════════════════
#  ① 담은 자산 · 비중
# ═══════════════════════════════════════════════════════════

class Test담을_수_있는_자산_수:
    """상한이 **두 군데**에 있다 — 요청 모델과 엔진.

    둘이 갈리면 조용히 틀린다. 요청 모델이 더 크면 엔진이 뒤를 잘라,
    스무 개를 담은 사람이 열두 개짜리 결과를 **오류 하나 없이** 본다.
    엔진이 더 크면 담을 수 있는 것을 422 로 막는다.
    """

    def test_요청_상한과_엔진_상한이_같다(self):
        from app.api.routes.backtest import 자산배분요청
        from app.services.portfolio_backtest import 최대자산
        칸 = 자산배분요청.model_fields["assets"]
        위 = next(m for m in 칸.metadata if hasattr(m, "max_length"))
        assert 위.max_length == 최대자산, \
            f"요청은 {위.max_length}개까지 받는데 엔진은 {최대자산}개만 쓴다"

    def test_스무_개를_담아도_스무_개를_다_쓴다(self, client):
        자산 = [{"symbol": f"S{i:02d}", "market": "US", "weight": 5}
                for i in range(20)]
        d = 돌려(client, assets=자산)
        assert len(d["assets"]) == 20, \
            f"스무 개를 보냈는데 {len(d['assets'])}개만 쟀다"
        #: 비중도 스무 개로 나뉘어야 한다
        assert abs(sum(a["weight"] for a in d["assets"]) - 1.0) < 1e-6

    def test_상한을_넘기면_조용히_자르지_않고_거절한다(self, client):
        from app.services.portfolio_backtest import 최대자산
        자산 = [{"symbol": f"S{i:02d}", "market": "US", "weight": 1}
                for i in range(최대자산 + 1)]
        r = client.post("/api/v1/backtest/portfolio", json=몸(assets=자산))
        assert r.status_code == 422, \
            "상한을 넘겼는데 조용히 잘라서 계산했다 — 담은 줄 아는 것이 안 담긴다"


class Test자산과_비중:
    def test_비중을_바꾸면_결과가_바뀐다(self, client):
        많이 = 돌려(client, assets=[{"symbol": "AAA", "market": "US", "weight": 90},
                                    {"symbol": "BBB", "market": "US", "weight": 10}])
        적게 = 돌려(client, assets=[{"symbol": "AAA", "market": "US", "weight": 10},
                                    {"symbol": "BBB", "market": "US", "weight": 90}])
        assert 많이["final_value"] != 적게["final_value"], \
            "비중 칸이 죽어 있다 — 90/10 과 10/90 이 같은 결과를 낸다"
        #: AAA 가 오르는 자산이므로 많이 담은 쪽이 더 나와야 방향도 맞다
        assert 많이["final_value"] > 적게["final_value"]

    def test_담은_비중을_그대로_돌려준다(self, client):
        d = 돌려(client)
        몫 = {a["symbol"]: a["weight"] for a in d["assets"]}
        assert abs(몫["AAA"] - 0.6) < 1e-9 and abs(몫["BBB"] - 0.4) < 1e-9, \
            f"화면에 되비칠 비중이 어긋난다 — {몫}"

    def test_자산을_더하면_결과가_바뀐다(self, client):
        둘 = 돌려(client)
        셋 = 돌려(client, assets=기본자산 + [{"symbol": "CCC", "market": "US", "weight": 40}])
        assert 둘["final_value"] != 셋["final_value"]
        assert len(셋["assets"]) == 3


# ═══════════════════════════════════════════════════════════
#  ② 통화 · ③ 초기금액 · ④ 기간
# ═══════════════════════════════════════════════════════════

class Test통화_금액_기간:
    def test_통화를_바꾸면_환율이_수익률에_들어온다(self, client):
        """원금은 **표시 통화 그대로** 들어간다(10,000,000원이지
        10,000,000달러가 아니다). 그래서 통화를 바꿨다고 결과가 1,100배가
        되는 것이 아니라, **환율 변동만큼 수익률이 달라진다.**
        2022년처럼 환율이 20% 오른 해는 이 항이 작지 않다."""
        달러 = 돌려(client, currency="USD")
        원화 = 돌려(client, currency="KRW")
        assert 원화["currency"] == "KRW" and 달러["currency"] == "USD"
        assert abs(원화["total_return"] - 달러["total_return"]) > 1e-6, \
            ("통화 칸이 죽어 있다 — 환율이 오르내렸는데 원화 수익률과 "
             f"달러 수익률이 같다({원화['total_return']})")

    def test_초기금액이_두_배면_결과도_두_배다(self, client):
        하나 = 돌려(client, initial_amount=10_000_000)
        둘 = 돌려(client, initial_amount=20_000_000)
        #: 정수 주식 수 때문에 딱 두 배는 아니다 — 근처면 된다
        assert abs(둘["final_value"] / 하나["final_value"] - 2) < 0.01, \
            f"초기금액이 안 먹는다 — {하나['final_value']} → {둘['final_value']}"

    def test_기간을_바꾸면_잰_구간이_따라간다(self, client):
        길게 = 돌려(client)
        짧게 = 돌려(client, start_date="2019-01-02")
        assert 길게["start_date"] != 짧게["start_date"], "시작일 칸이 안 먹는다"
        assert 짧게["start_date"] >= "2019-01-02"
        assert len(길게["curve"]) > len(짧게["curve"])

    def test_종료일_칸도_먹는다(self, client):
        끝까지 = 돌려(client)
        일찍 = 돌려(client, end_date="2019-12-30")
        assert 끝까지["end_date"] != 일찍["end_date"], "종료일 칸이 안 먹는다"
        assert 일찍["end_date"] <= "2019-12-30"


# ═══════════════════════════════════════════════════════════
#  ⑤⑥ 적립 주기 · 적립 금액
# ═══════════════════════════════════════════════════════════

class Test적립:
    def test_적립을_켜면_납입액이_늘어난다(self, client):
        안함 = 돌려(client, contribution_period="none", contribution_amount=0)
        매달 = 돌려(client, contribution_period="monthly", contribution_amount=100_000)
        assert 매달["contributed"] > 안함["contributed"], "적립 칸이 죽어 있다"
        assert 매달["final_value"] > 안함["final_value"]

    def test_주기_셋이_서로_다른_결과를_낸다(self, client):
        나온것 = {}
        for 주기 in ("monthly", "quarterly", "yearly"):
            d = 돌려(client, contribution_period=주기, contribution_amount=100_000)
            나온것[주기] = d["contributed"]
        assert len(set(나온것.values())) == 3, \
            f"적립 주기 셋 중 겹치는 것이 있다 — {나온것}"
        assert 나온것["monthly"] > 나온것["quarterly"] > 나온것["yearly"]

    def test_적립금액_칸이_먹는다(self, client):
        #: contributed 는 **원금을 포함한** 총 납입액이다 — 원금을 빼고 견준다
        원금 = 10_000_000
        작게 = 돌려(client, contribution_period="monthly", contribution_amount=100_000)
        크게 = 돌려(client, contribution_period="monthly", contribution_amount=500_000)
        assert 크게["contributed"] - 원금 == pytest.approx(
            (작게["contributed"] - 원금) * 5, rel=1e-9), \
            f"적립금액이 안 먹는다 — {작게['contributed']} vs {크게['contributed']}"


# ═══════════════════════════════════════════════════════════
#  ⑦ 리밸런싱 주기
# ═══════════════════════════════════════════════════════════

class Test리밸런싱:
    def test_주기_넷이_서로_다른_결과를_낸다(self, client):
        나온것 = {주기: 돌려(client, rebalance_period=주기)["final_value"]
                  for 주기 in ("none", "monthly", "quarterly", "yearly")}
        assert len(set(나온것.values())) == 4, \
            f"리밸런싱 주기 중 겹치는 것이 있다 — {나온것}"

    def test_리밸런싱하면_사고판_기록이_남는다(self, client):
        안함 = 돌려(client, rebalance_period="none", cost_rate=0.25)
        매년 = 돌려(client, rebalance_period="yearly", cost_rate=0.25)
        assert 매년["costs"] > 안함["costs"], \
            "리밸런싱을 켰는데 거래비용이 안 늘었다 — 사고판 것이 없다는 뜻"


# ═══════════════════════════════════════════════════════════
#  ⑧ 토탈 리턴(배당 재투자)
# ═══════════════════════════════════════════════════════════

class Test배당:
    def test_배당을_켜면_결과가_커진다(self, client):
        끔 = 돌려(client, total_return=False)
        켬 = 돌려(client, total_return=True)
        assert 켬["final_value"] > 끔["final_value"], \
            "토탈 리턴 칸이 죽어 있다 — 배당을 재투자해도 결과가 같다"


# ═══════════════════════════════════════════════════════════
#  ⑨ 리밸런싱·적립 날짜
# ═══════════════════════════════════════════════════════════

class Test날짜:
    def test_리밸런싱_날짜가_결과를_바꾼다(self, client):
        첫날 = 돌려(client, rebalance_period="monthly", rebalance_day=1)
        보름 = 돌려(client, rebalance_period="monthly", rebalance_day=15)
        assert 첫날["final_value"] != 보름["final_value"], \
            "리밸런싱 날짜 칸이 죽어 있다"

    def test_같은_칸이_적립일도_함께_움직인다(self, client):
        """화면에는 칸이 하나인데 서버는 리밸런싱날·적립날짜 둘 다에
        같은 값을 넣는다. 리밸런싱을 끈 채로도 날짜가 먹어야 그
        칸이 적립에도 닿는다는 뜻이다."""
        첫날 = 돌려(client, rebalance_period="none",
                    contribution_period="monthly", contribution_amount=100_000,
                    rebalance_day=1)
        보름 = 돌려(client, rebalance_period="none",
                    contribution_period="monthly", contribution_amount=100_000,
                    rebalance_day=15)
        assert 첫날["final_value"] != 보름["final_value"], \
            "적립일이 안 움직인다 — 화면의 날짜 칸이 적립에는 안 닿는다"


# ═══════════════════════════════════════════════════════════
#  ⑩ 거래비용
# ═══════════════════════════════════════════════════════════

class Test거래비용:
    def test_비용을_올리면_결과가_줄고_비용이_잡힌다(self, client):
        공짜 = 돌려(client, rebalance_period="monthly", cost_rate=0)
        비쌈 = 돌려(client, rebalance_period="monthly", cost_rate=0.25)
        assert 비쌈["final_value"] < 공짜["final_value"], "거래비용 칸이 죽어 있다"
        #: 0 일 때는 0 이 아니라 None 이다 — 화면이 '반영 안 함' 으로 적는다.
        #  0 으로 두면 '수수료 0원이 들었다' 로 읽혀, 안 쟀다는 사실이 감춰진다.
        assert 비쌈["costs"] > 0 and 공짜["costs"] is None
        assert 비쌈["costs_included"] is True and 공짜["costs_included"] is False

    def test_퍼센트로_받아_비율로_넘긴다(self, client):
        """화면은 0.25(%)를 주고 서버가 100으로 나눈다. 안 나누면
        수수료가 100배가 되어 결과가 통째로 무너지는데 오류는 안 난다."""
        d = 돌려(client, rebalance_period="monthly", cost_rate=0.25, initial_amount=10_000_000)
        #: 0.25% 를 그대로 비율로 넘기면(=25%) 달마다 원금의 1/4 이 날아가
        #  여섯 해 뒤에는 남는 것이 없다. 원금의 10%도 안 넘어야 한다.
        assert 0 < d["costs"] < 1_000_000, \
            f"수수료가 원금의 10%를 넘었다 — 퍼센트를 비율로 안 나눴다 ({d['costs']})"
        assert d["final_value"] > 0


# ═══════════════════════════════════════════════════════════
#  ⑪ 일별 / 월별
# ═══════════════════════════════════════════════════════════

class Test데이터간격:
    def test_월별로_바꾸면_곡선이_짧아진다(self, client):
        일별 = 돌려(client, data_interval="daily")
        월별 = 돌려(client, data_interval="monthly")
        assert len(월별["curve"]) < len(일별["curve"]) / 5, \
            f"월별인데 점이 그대로다 — {len(일별['curve'])} vs {len(월별['curve'])}"
        assert 월별["data_interval"] == "monthly"

    def test_월별에서도_배당이_사라지지_않는다(self, client):
        """달 안에 흩어진 배당을 월말로 모아야 한다. 안 모으면 같은
        설정인데 '월' 로 바꾸기만 해도 성적이 뚝 떨어진다."""
        끔 = 돌려(client, data_interval="monthly", total_return=False)
        켬 = 돌려(client, data_interval="monthly", total_return=True)
        assert 켬["final_value"] > 끔["final_value"], \
            "월별로 바꿨더니 배당이 통째로 사라졌다"


# ═══════════════════════════════════════════════════════════
#  ⑫ 벤치마크 일곱
# ═══════════════════════════════════════════════════════════

class Test벤치마크:
    def test_없음이면_비교가_없다(self, client):
        assert 돌려(client, benchmark="none")["benchmark"] is None

    @pytest.mark.parametrize("열쇠,이름", [
        ("spy", "S&P500"), ("qqq", "나스닥100"), ("kospi_index", "코스피"),
        ("kospi", "코스피200"), ("6040", "주식 60 · 채권 40"),
        ("allweather", "올웨더"),
    ])
    def test_고른_벤치마크가_실제로_돌아온다(self, client, 열쇠, 이름):
        b = 돌려(client, benchmark=열쇠)["benchmark"]
        assert b is not None, f"{열쇠} 를 골랐는데 비교가 안 왔다"
        assert b["key"] == 열쇠 and b["name"] == 이름
        assert b["final_value"] and b["final_value"] > 0
        assert b["curve"] and len(b["curve"]) > 1
        assert b["drawdown"], "낙폭 곡선이 비었다 — 나란히 못 그린다"

    def test_해마다를_같이_줘서_해별로_견줄_수_있다(self, client):
        """전체 수익률 하나로는 **언제** 이겼는지 알 수 없다.

        8년 중 6년을 지고도 한 해에 몰아쳐서 총합만 이긴 조합과,
        해마다 조금씩 이긴 조합은 전혀 다른 것인데 합계는 비슷하게
        나온다. 2008년·2022년 같은 하락장에서 어땠는지도 여기서만
        보인다 — '내 것 -35%, S&P500 -37%' 는 총 수익률 어디에도
        안 나온다.
        """
        d = 돌려(client, benchmark="spy")
        b = d["benchmark"]
        assert b["yearly"], "벤치마크의 해마다가 없다 — 해별로 견줄 수 없다"
        assert len(b["yearly"]) > 1

        #: 내 것과 **같은 해**를 재야 나란히 놓을 수 있다
        내해 = {y["year"] for y in d["yearly"]}
        벤해 = {y["year"] for y in b["yearly"]}
        assert 벤해 <= 내해, \
            f"벤치마크가 내 것에 없는 해를 잰다 — {sorted(벤해 - 내해)}"

        for y in b["yearly"]:
            assert isinstance(y["return"], (int, float))

    def test_지수는_배당이_없다고_알린다(self, client):
        assert 돌려(client, benchmark="kospi_index")["benchmark"]["index_only"] is True
        assert 돌려(client, benchmark="kospi")["benchmark"]["index_only"] is False

    def test_벤치마크도_같은_구간에서_잰다(self, client):
        """더 긴 구간의 수익률과 견주면 둘 다 맞고 비교만 틀린다."""
        d = 돌려(client, benchmark="spy")
        내곡선, 벤곡선 = d["curve"], d["benchmark"]["curve"]
        assert 내곡선[0]["date"] <= 벤곡선[0]["date"]
        assert 벤곡선[-1]["date"] <= 내곡선[-1]["date"]

    @pytest.mark.parametrize("통화,자산,벤치", [
        #: 제일 흔한 조합 — 원화로 한국 종목만 담고 S&P500 과 견준다
        ("KRW", [{"symbol": "005930", "market": "KR", "weight": 100}], "spy"),
        ("KRW", [{"symbol": "005930", "market": "KR", "weight": 100}], "qqq"),
        ("KRW", [{"symbol": "005930", "market": "KR", "weight": 100}], "6040"),
        ("KRW", [{"symbol": "005930", "market": "KR", "weight": 100}], "allweather"),
        #: 반대쪽 — 달러로 미국 종목만 담고 코스피와 견준다
        ("USD", 기본자산, "kospi"),
        ("USD", 기본자산, "kospi_index"),
    ])
    def test_벤치마크가_다른_통화여도_사라지지_않는다(self, client, 통화, 자산, 벤치):
        """환율을 내 자산만 보고 받으면 안 된다.

        원화로 한국 종목만 담은 사람은 환율이 필요 없다 — 그래서
        예전에는 환율을 아예 안 받았다. 그런데 벤치마크로 S&P500 을
        고르면 그건 달러라, 바꿀 환율이 없어 통째로 빠졌다. 화면에는
        **아무 말도 없이** 비교 줄만 사라져서, 고른 것이 왜 안 나오는지
        알 길이 없었다(실측으로 확인했다).
        """
        b = 돌려(client, currency=통화, assets=자산, benchmark=벤치)["benchmark"]
        assert b is not None, \
            f"{통화} 포트폴리오에서 {벤치} 를 골랐는데 비교가 조용히 사라졌다"
        assert b["final_value"] and b["final_value"] > 0

    def test_지수_티커에는_KS_를_붙이지_않는다(self):
        """벤치마크 '코스피'(^KS11)와 한국 ETF 의 '확장'(069500→^KS11)은
        둘 다 이 한 줄에 달려 있다.

        한국 종목은 야후에서 '005930.KS' 라 코드 뒤에 .KS 를 붙인다.
        그런데 지수는 '^KS11' 이 이미 완성된 이름이라, 붙이면
        '^KS11.KS' 라는 없는 종목이 되어 빈손이 온다. 빈손은 예외가
        아니므로 오류도 안 나고, 벤치마크 줄만 **조용히** 사라진다.
        (위의 가짜 시세는 이 함수 뒤에 끼어들므로 여기서 따로 본다.)
        """
        from app.services.yf_service import _resolve_kr_symbol
        assert _resolve_kr_symbol("005930", "KS") == "005930.KS"
        assert _resolve_kr_symbol("069500", "KS") == "069500.KS"
        assert _resolve_kr_symbol("^KS11", "KS") == "^KS11", "코스피 지수에 .KS 를 붙였다"
        assert _resolve_kr_symbol("^KQ11", "KQ") == "^KQ11", "코스닥 지수에 .KQ 를 붙였다"

    def test_모르는_벤치마크는_거절한다(self, client):
        r = client.post("/api/v1/backtest/portfolio", json=몸(benchmark="없는것"))
        assert r.status_code == 422


# ═══════════════════════════════════════════════════════════
#  ⑬ 동일 비중
# ═══════════════════════════════════════════════════════════

class Test동일비중:
    def test_켜면_적은_비중을_무시하고_똑같이_나눈다(self, client):
        끔 = 돌려(client, equal_weight=False)
        켬 = 돌려(client, equal_weight=True)
        몫 = {a["symbol"]: a["weight"] for a in 켬["assets"]}
        assert abs(몫["AAA"] - 0.5) < 1e-9 and abs(몫["BBB"] - 0.5) < 1e-9, \
            f"동일 비중인데 반반이 아니다 — {몫}"
        assert 켬["final_value"] != 끔["final_value"]


# ═══════════════════════════════════════════════════════════
#  ⑭ 현금 이자
# ═══════════════════════════════════════════════════════════

class Test현금이자:
    def test_현금을_담았을_때_이자가_붙는다(self, client):
        자산 = [{"symbol": "AAA", "market": "US", "weight": 50},
                {"symbol": "현금", "market": "US", "weight": 50}]
        없음 = 돌려(client, assets=자산, cash_rate=0)
        있음 = 돌려(client, assets=자산, cash_rate=5)
        assert 있음["final_value"] > 없음["final_value"], \
            "현금 이자 칸이 죽어 있다 — 연 5%를 넣어도 결과가 같다"


# ═══════════════════════════════════════════════════════════
#  ⑮ 무위험수익률
# ═══════════════════════════════════════════════════════════

class Test무위험수익률:
    def test_올리면_샤프가_낮아진다(self, client):
        영 = 돌려(client, risk_free_rate=0)
        오 = 돌려(client, risk_free_rate=5)
        assert 오["sharpe"] != 영["sharpe"], "무위험수익률 칸이 죽어 있다"
        assert 오["sharpe"] < 영["sharpe"], \
            f"무위험수익률을 올렸는데 샤프가 안 낮아졌다 — {영['sharpe']} → {오['sharpe']}"


# ═══════════════════════════════════════════════════════════
#  ⑯ 확장된 ETF 가격
# ═══════════════════════════════════════════════════════════

class Test확장:
    """SPY 는 2019년부터만 있는 것으로 꾸며 놨다. 확장을 켜면
    그 앞은 ^GSPC 로 이어져 2016년부터 재야 한다."""

    def test_끄면_ETF_가_생긴_날부터_잰다(self, client):
        d = 돌려(client, assets=[{"symbol": "SPY", "market": "US", "weight": 100}],
                 extended=False)
        assert d["start_date"] >= "2019-01-02", f"{d['start_date']}"
        assert d["extended_from"] == {}

    def test_켜면_지수로_이어_더_길게_잰다(self, client):
        d = 돌려(client, assets=[{"symbol": "SPY", "market": "US", "weight": 100}],
                 extended=True)
        assert d["start_date"] < "2019-01-02", \
            f"확장을 켰는데 구간이 안 늘었다 — {d['start_date']}"
        assert "SPY" in d["extended_from"], \
            "이어 놓고 말을 안 했다 — 사용자는 SPY 자료인 줄 안다"

    def test_이어도_가격이_튀지_않는다(self, client):
        """가격을 그대로 이어 붙이면 안 된다.

        SPY 는 400 근처이고 ^GSPC 는 5,000 근처라, 그냥 붙이면 ETF 가
        시작하는 날 **하루 만에 92% 폭락**한 것으로 잡힌다. 이어야 할
        것은 가격이 아니라 수익률이다.

        (mdd 는 **양수 퍼센트**다 — 17.69 는 -17.69% 라는 뜻. 비율로
        알고 '> -0.5' 라고 쓰면 어떤 값이든 통과해 버린다.)
        """
        d = 돌려(client, assets=[{"symbol": "SPY", "market": "US", "weight": 100}],
                 extended=True)
        #: 꾸민 자료는 죽 오르기만 한다 — 이음매만 잘 맞으면 낙폭이 거의 없다
        assert d["mdd"] < 5, f"이음매에서 값이 튀었다 — MDD {d['mdd']}%"


# ═══════════════════════════════════════════════════════════
#  ⑰ 진행 열쇠
# ═══════════════════════════════════════════════════════════

class Test진행:
    def test_열쇠를_주면_진행이_적힌다(self, client):
        열쇠 = "abcd1234efgh"
        돌려(client, progress_key=열쇠)
        r = client.get(f"/api/v1/backtest/portfolio/progress/{열쇠}")
        assert r.status_code == 200, "경로 칸이 안 잡힌다(한글 칸 이름?)"
        d = r.json()
        #: 99 가 끝이다. 100 은 응답이 실제로 왔을 때만이고 그 몫은
        #  화면이 맡는다 — 다 됐다고 해 놓고 계속 도는 것이 제일 나쁘다.
        assert d.get("percent") == 99, f"다 끝났는데 99 가 아니다 — {d}"
        assert d.get("단계") == "벤치마크", f"마지막 단계가 아니다 — {d}"

    def test_안_줘도_계산은_그대로_돈다(self, client):
        assert 돌려(client)["final_value"] > 0

    def test_모르는_열쇠는_404_가_아니라_빈_값이다(self, client):
        r = client.get("/api/v1/backtest/portfolio/progress/없던열쇠12345")
        assert r.status_code == 200 and r.json() == {}
