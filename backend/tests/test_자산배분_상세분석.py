"""
자산배분 — 더 상세한 분석. 사용자: "백테스팅 자산배분 더 상세하게 분석해주고"

조합 하나의 성적만으로는 누가 벌고 누가 깎았는지, 나눠 담은 효과가 있었는지, 언제 샀느냐에 따라 얼마나
달랐는지가 안 보인다. 그래서 엔진이 넷을 더 낸다.

  ① 자산마다(asset_stats) — 조합 안에서 번 돈(기여)과, 따로 들고 있었으면의 성적
     · **수익 = Σ 기여 − 수수료** 가 늘 맞는다(적립·리밸런싱·배당·현금 이자·수수료를 다 켜도)
  ② 상관(correlation) — 자산끼리 달마다 수익률이 얼마나 같이 움직였나
  ③ 롤링(rolling) — 아무 달에나 사서 1·3·5년 들고 있었으면 연 몇 %였나, 그 모든 경우
  ④ 넣은 돈(curve[].invested) — 그래프에 평가액과 나란히 그린다
"""
import math
import random
import statistics
from datetime import date, timedelta

import pytest

from app.services.backtest import portfolio_backtest as PB


def 거래일(n: int, 시작: date = date(2015, 1, 2)) -> list[date]:
    날, d = [], 시작
    while len(날) < n:
        if d.weekday() < 5:
            날.append(d)
        d += timedelta(days=1)
    return 날


def 걸음(날: list[date], 시작: float, 기울기: float, 흔들: float, 씨: int) -> dict[date, float]:
    rng = random.Random(씨)
    v, 표 = 시작, {}
    for d in 날:
        v *= 1 + rng.gauss(기울기, 흔들)
        표[d] = v
    return 표


# ── ① 자산마다 ─────────────────────────────────────────────────

class Test자산별_기여:
    def test_수익은_기여의_합에서_수수료를_뺀_것(self):
        """적립·리밸런싱·배당·현금 이자·수수료를 다 켜도 맞아야 한다 — 하나라도 새면 '누가 벌었나' 가
        조합의 수익과 다른 말을 한다"""
        날 = 거래일(2600)
        가격표 = {"SPY": 걸음(날, 200, 0.0004, 0.011, 1), "TLT": 걸음(날, 120, 0.0001, 0.008, 2)}
        배당 = {"SPY": {날[i]: 1.2 for i in range(60, 2600, 63)}}
        r = PB.돌리기(가격표, [{"symbol": "SPY", "weight": 50}, {"symbol": "TLT", "weight": 30},
                              {"symbol": "현금", "weight": 20}],
                      10_000_000, 적립주기="monthly", 적립금액=500_000, 리밸런싱="quarterly",
                      배당=배당, 거래비용=0.001, 현금이자=0.03)
        합 = sum(x["contribution"] for x in r["asset_stats"]) - r["costs"]
        assert r["profit"] == pytest.approx(합, abs=0.05)
        assert [x["symbol"] for x in r["asset_stats"]] == ["SPY", "TLT", "현금"]
        assert [x["weight"] for x in r["asset_stats"]] == pytest.approx([0.5, 0.3, 0.2])

    def test_리밸런싱이_잦아도_맞는다(self):
        """가격 손익은 **그 전날 들고 있던 수**로 재야 한다. 리밸런싱으로 수가 바뀐 날을 바뀐 뒤의 수로
        재면 남의 몫을 가져와 합이 어긋난다"""
        날 = 거래일(800)
        가격표 = {"A": 걸음(날, 50, 0.0008, 0.02, 3), "B": 걸음(날, 80, -0.0002, 0.015, 4)}
        r = PB.돌리기(가격표, [{"symbol": "A", "weight": 1}, {"symbol": "B", "weight": 1}],
                      1_000_000, 리밸런싱="monthly")
        assert r["profit"] == pytest.approx(sum(x["contribution"] for x in r["asset_stats"]), abs=0.05)
        assert r["costs"] is None

    def test_배당은_자산마다_따로_센다(self):
        날 = 거래일(400)
        가격표 = {"SPY": {d: 100.0 for d in 날}, "TLT": {d: 100.0 for d in 날}}
        배당 = {"SPY": {날[100]: 2.0, 날[300]: 2.0}}
        r = PB.돌리기(가격표, [{"symbol": "SPY", "weight": 50}, {"symbol": "TLT", "weight": 50}],
                      1_000_000, 배당=배당)
        자산 = {x["symbol"]: x for x in r["asset_stats"]}
        assert 자산["SPY"]["dividends"] == pytest.approx(r["dividends"])
        assert 자산["TLT"]["dividends"] == 0
        assert 자산["SPY"]["contribution"] == pytest.approx(r["profit"], abs=0.01), "값이 그대로면 번 돈은 배당뿐"

    def test_배당을_안_받으면_배당은_None(self):
        날 = 거래일(300)
        r = PB.돌리기({"SPY": 걸음(날, 100, 0.0003, 0.01, 5)}, [{"symbol": "SPY", "weight": 1}], 1_000_000)
        assert r["asset_stats"][0]["dividends"] is None

    def test_현금은_이자로_불고_흔들리지_않는다(self):
        날 = 거래일(520)
        가격표 = {"SPY": {d: 100.0 for d in 날}}
        r = PB.돌리기(가격표, [{"symbol": "SPY", "weight": 50}, {"symbol": "현금", "weight": 50}],
                      1_000_000, 현금이자=0.03)
        현금 = r["asset_stats"][1]
        assert 현금["contribution"] == pytest.approx(r["cash_interest"]) == pytest.approx(r["profit"], abs=0.01)
        assert 현금["total_return"] == pytest.approx((1.03 ** r["years"] - 1) * 100, abs=0.05)
        assert (현금["cagr"], 현금["volatility"], 현금["mdd"], 현금["dividends"]) == (3.0, 0.0, 0.0, None)

    def test_현금_칸이_둘이면_이자를_비중대로_나눈다(self):
        날 = 거래일(520)
        r = PB.돌리기({"SPY": {d: 100.0 for d in 날}},
                      [{"symbol": "SPY", "weight": 40}, {"symbol": "현금", "weight": 45}, {"symbol": "예금", "weight": 15}],
                      1_000_000, 현금이자=0.03)
        현금, 예금 = r["asset_stats"][1], r["asset_stats"][2]
        assert (현금["symbol"], 예금["symbol"]) == ("현금", "예금")
        assert 현금["contribution"] == pytest.approx(r["cash_interest"] * 0.75, abs=0.01)
        assert 예금["contribution"] == pytest.approx(r["cash_interest"] * 0.25, abs=0.01)
        assert 현금["contribution"] + 예금["contribution"] == pytest.approx(r["profit"], abs=0.02)

    def test_1년이_안_되면_연환산은_없다(self):
        날 = 거래일(120)
        r = PB.돌리기({"SPY": 걸음(날, 100, 0.001, 0.01, 6)},
                      [{"symbol": "SPY", "weight": 1}, {"symbol": "현금", "weight": 1}], 1_000_000, 현금이자=0.03)
        assert [x["cagr"] for x in r["asset_stats"]] == [None, None]
        assert r["asset_stats"][0]["total_return"] is not None

    def test_따로_들고_있었으면의_성적은_배당을_재투자한_값(self):
        날 = 거래일(3)
        가격 = {날[0]: 10.0, 날[1]: 10.0, 날[2]: 11.0}
        assert PB.자산지수(날, 가격, {날[1]: 0.5}) == pytest.approx([1.0, 1.05, 1.155])
        assert PB.자산지수(날, 가격) == pytest.approx([1.0, 1.0, 1.1])

    def test_가격이_0_이하인_날은_앞의_값을_둔다(self):
        날 = 거래일(4)
        가격 = {날[0]: 10.0, 날[1]: 0.0, 날[2]: 12.0, 날[3]: 12.0}
        assert PB.자산지수(날, 가격) == [1.0, 1.0, 1.0, 1.0]

    def test_자산_성적(self):
        """두 해 동안 날마다 같은 비율로 두 배 — 기간 100%, 연 41.42%, 흔들림·낙폭 0"""
        날 = 거래일(505)
        늘 = 2 ** (1 / 504)
        지수 = [늘 ** i for i in range(505)]
        s = PB._자산성적(날, 지수, 2.0)
        assert s["total_return"] == pytest.approx(100.0)
        assert s["cagr"] == pytest.approx(41.42, abs=0.01)
        assert s["volatility"] == pytest.approx(0.0, abs=1e-6)
        assert s["mdd"] == 0
        assert PB._자산성적(날, 지수, 0.9)["cagr"] is None
        assert PB._자산성적(날[:1], [1.0], 2.0) == {"total_return": None, "cagr": None, "volatility": None, "mdd": None}

    def test_낙폭과_변동성(self):
        날 = 거래일(5)
        s = PB._자산성적(날, [1.0, 1.2, 0.9, 1.0, 1.1], 1.0)
        assert s["mdd"] == pytest.approx(25.0)       # 1.2 → 0.9
        assert s["total_return"] == pytest.approx(10.0)
        #: 변동성은 **연으로** 늘린 값 — 날마다 표준편차 × √(1년의 칸 수). 4칸이 1년이면 × 2
        일간 = [0.2, -0.25, 1 / 9, 0.1]
        assert s["volatility"] == pytest.approx(statistics.stdev(일간) * 2 * 100, abs=0.01)

    def test_딱_1년이면_연환산을_낸다(self):
        """1년 '미만' 만 안 낸다 — 딱 1년이면 연환산이 곧 기간 수익률이다"""
        s = PB._자산성적(거래일(5), [1.0, 1.2, 0.9, 1.0, 1.1], 1.0)
        assert s["cagr"] == pytest.approx(10.0)


# ── ② 상관 ─────────────────────────────────────────────────────

def 달마다(n_달: int, 수익들: list[float]) -> tuple[list[date], list[float]]:
    """달말 하루씩만 — 달마다 수익률이 그대로 나온다"""
    날, 값 = [], [1.0]
    for i in range(n_달 + 1):
        y, m = 2015 + i // 12, i % 12 + 1
        날.append(date(y, m, 28))
    for r in 수익들[:n_달]:
        값.append(값[-1] * (1 + r))
    return 날, 값


class Test상관:
    def test_똑같이_움직이면_1_거꾸로면_마이너스_1(self):
        rng = random.Random(7)
        수익 = [rng.gauss(0.01, 0.04) for _ in range(36)]
        날, A = 달마다(36, 수익)
        _, B = 달마다(36, [2 * r for r in 수익])          # 같은 방향, 크기만 두 배
        _, C = 달마다(36, [-r for r in 수익])
        t = PB.상관표(날, {"A": A, "B": B, "C": C})
        assert t["symbols"] == ["A", "B", "C"] and t["months"] == 36
        m = t["matrix"]
        assert m[0][0] == m[1][1] == m[2][2] == 1.0
        assert m[0][1] == m[1][0] == pytest.approx(1.0)
        assert m[0][2] == m[2][0] == pytest.approx(-1.0)

    def test_따로_움직이면_0_이고_마이너스_0_으로_나가지_않는다(self):
        """+ − + − 와 + + − − 는 정확히 0 — 계산 끝자리 때문에 '-0.0' 이 나가면 화면에 '-0.00' 이 찍힌다"""
        가 = [0.05, -0.05] * 12
        나 = [0.05, 0.05, -0.05, -0.05] * 6
        날, A = 달마다(24, 가)
        _, B = 달마다(24, 나)
        v = PB.상관표(날, {"A": A, "B": B})["matrix"][0][1]
        assert v == 0 and math.copysign(1.0, v) == 1.0

    def test_12개월이면_내고_11개월이면_안_낸다(self):
        """상관최소달 을 바꾸면 따라 바뀌는 시험은 그 값이 틀려도 통과한다 — 숫자로 못 박는다"""
        수익 = [0.03, -0.01, 0.02, -0.04, 0.05, 0.01, -0.02, 0.04, -0.03, 0.02, 0.01, -0.05]
        날, A = 달마다(12, 수익)
        _, B = 달마다(12, [r * 0.5 + 0.01 for r in 수익])
        t = PB.상관표(날, {"A": A, "B": B})
        assert t is not None and t["months"] == 12
        assert PB.상관표(날[:-1], {"A": A[:-1], "B": B[:-1]}) is None

    def test_아주_작은_음수_상관도_마이너스_0_으로_나가지_않는다(self):
        """상관이 -0.0025 면 round(·, 2) 가 -0.0 이다 — 화면에 '-0.00' 이 찍힌다"""
        가 = [0.05, -0.05] * 12
        나 = [0.05, 0.053, -0.05, -0.05] + [0.05, 0.05, -0.05, -0.05] * 5
        날, A = 달마다(24, 가)
        _, B = 달마다(24, 나)
        달A = [A[i] / A[i - 1] - 1 for i in range(1, len(A))]
        달B = [B[i] / B[i - 1] - 1 for i in range(1, len(B))]
        assert -0.005 < PB._피어슨(달A, 달B) < 0           # 이 자료가 정말 그 자리인지 먼저
        v = PB.상관표(날, {"A": A, "B": B})["matrix"][0][1]
        assert v == 0 and math.copysign(1.0, v) == 1.0

    def test_계산_끝자리로_1_을_넘지_않는다(self):
        """똑같이 움직이면 1 — 소수 끝자리가 1.0000000002 로 나가도 1 로 자른다"""
        가 = [0.1, 0.2, 0.3, 0.4, 0.5, 0.7]
        assert -1.0 <= PB._피어슨(가, [x * 3 for x in 가]) <= 1.0
        assert -1.0 <= PB._피어슨(가, [-x * 3 for x in 가]) <= 1.0
        assert PB._피어슨(가, [x * 3 for x in 가]) == pytest.approx(1.0)

    def test_달이_모자라거나_자산이_하나면_없다(self):
        날, A = 달마다(PB.상관최소달 - 1, [0.01] * 40)
        _, B = 달마다(PB.상관최소달 - 1, [0.02, -0.01] * 20)
        assert PB.상관표(날, {"A": A, "B": B}) is None
        날, A = 달마다(24, [0.01] * 24)
        assert PB.상관표(날, {"A": A}) is None

    def test_안_움직인_자산과의_상관은_없다(self):
        날, A = 달마다(24, [0.01, -0.02] * 12)
        _, B = 달마다(24, [0.0] * 24)
        assert PB.상관표(날, {"A": A, "B": B})["matrix"][0][1] is None

    def test_엔진은_위험자산끼리만(self):
        날 = 거래일(700)
        r = PB.돌리기({"SPY": 걸음(날, 100, 0.0004, 0.01, 8), "TLT": 걸음(날, 100, 0.0001, 0.008, 9)},
                      [{"symbol": "SPY", "weight": 6}, {"symbol": "TLT", "weight": 3}, {"symbol": "현금", "weight": 1}],
                      1_000_000)
        assert r["correlation"]["symbols"] == ["SPY", "TLT"]
        r1 = PB.돌리기({"SPY": 걸음(날, 100, 0.0004, 0.01, 8)},
                       [{"symbol": "SPY", "weight": 1}, {"symbol": "현금", "weight": 1}], 1_000_000)
        assert r1["correlation"] is None

    def test_달말값(self):
        날 = [date(2020, 1, 30), date(2020, 1, 31), date(2020, 2, 3), date(2020, 2, 28), date(2020, 3, 2)]
        assert PB.달말값(날, [1, 2, 3, 4, 5]) == [("2020-01", 2), ("2020-02", 4), ("2020-03", 5)]


# ── ③ 롤링 ─────────────────────────────────────────────────────

class Test롤링:
    def test_달마다_1퍼센트씩이면_어느_때나_연_12_68퍼센트(self):
        날, 값 = 달마다(72, [0.01] * 72)
        r = {x["years"]: x for x in PB.롤링(날, 값)}
        assert set(r) == {1, 3, 5}
        for 해, x in r.items():
            assert x["count"] == len(x["series"]) == 73 - 해 * 12
            assert x["best"] == x["worst"] == x["median"] == pytest.approx(12.68, abs=0.01)
            assert x["positive_ratio"] == 100.0
        assert r[1]["series"][0]["month"] == "2016-01"      # 첫 창은 2015-01 → 2016-01

    def test_기간이_N년보다_짧으면_그_N은_없다(self):
        날, 값 = 달마다(40, [0.01] * 40)
        assert [x["years"] for x in PB.롤링(날, 값)] == [1, 3]

    def test_가운데값_최고_최저_플러스_비율(self):
        """한 해 오르고 한 해 내리면 — 1년씩 잰 값이 고루 나뉜다"""
        날, 값 = 달마다(36, [0.02] * 12 + [-0.02] * 12 + [0.02] * 12)
        x = next(v for v in PB.롤링(날, 값) if v["years"] == 1)
        값들 = sorted(s["return"] for s in x["series"])
        assert (x["best"], x["worst"]) == (값들[-1], 값들[0])
        n = len(값들)
        assert x["median"] == pytest.approx((값들[n // 2 - 1] + 값들[n // 2]) / 2 if n % 2 == 0 else 값들[n // 2])
        assert x["positive_ratio"] == pytest.approx(sum(v > 0 for v in 값들) / n * 100, abs=0.05)
        assert 0 < x["positive_ratio"] < 100

    #: 달마다 수익 — 되풀이되지 않게 고른다. 3·4달 주기를 되풀이하면 12달 창이 모두 같은 값이 되어
    #  가운데 값 시험이 아무것도 못 본다(실제로 그렇게 짰다가 변이가 살아남았다)
    고른수익 = [0.01, 0.03, -0.02, 0.05, 0.0, 0.02, -0.01, 0.04, 0.01, -0.03, 0.02, 0.06, -0.04, 0.025, 0.02, -0.02]

    def test_짝수개면_가운데_둘의_평균(self):
        날, 값 = 달마다(15, self.고른수익)
        x = next(v for v in PB.롤링(날, 값) if v["years"] == 1)
        assert x["count"] == 16 - 12               # 달말 16개 − 12
        값들 = sorted(s["return"] for s in x["series"])
        assert len(set(값들)) == 4                 # 창마다 다른 값이어야 시험이 뜻이 있다
        assert x["median"] == pytest.approx(round((값들[1] + 값들[2]) / 2, 2))
        assert x["median"] != pytest.approx(값들[2])

    def test_홀수개면_한가운데_값(self):
        날, 값 = 달마다(16, self.고른수익)
        x = next(v for v in PB.롤링(날, 값) if v["years"] == 1)
        assert x["count"] == 17 - 12
        값들 = sorted(s["return"] for s in x["series"])
        assert len(set(값들)) == 5
        assert x["median"] == 값들[2]
        assert x["median"] != pytest.approx((값들[1] + 값들[2]) / 2)

    def test_0_퍼센트는_플러스가_아니다(self):
        """값이 그대로면 어느 창이든 0% — '플러스였던 경우 100%' 라고 하면 거짓이다"""
        날, 값 = 달마다(24, [0.0] * 24)
        x = next(v for v in PB.롤링(날, 값) if v["years"] == 1)
        assert x["positive_ratio"] == 0.0 and x["best"] == x["worst"] == 0.0

    def test_길이가_다르면_빈_것(self):
        assert PB.롤링([date(2020, 1, 1)], [1.0, 2.0]) == []
        #: 짧은 쪽에 맞춰 자르면 값이 날짜와 어긋난다 — 창이 나올 만큼 길어도 내지 않는다
        날, 값 = 달마다(30, [0.01] * 30)
        assert PB.롤링(날, 값 + [2.0]) == []
        assert PB.롤링(날[:-1], 값) == []

    def test_엔진은_넣은_돈을_지운_곡선에서_잰다(self):
        """매달 큰돈을 넣어도 값이 그대로면 롤링은 0% 근처 — 넣은 돈이 수익으로 둔갑하면 안 된다"""
        날 = 거래일(800)
        r = PB.돌리기({"SPY": {d: 100.0 for d in 날}}, [{"symbol": "SPY", "weight": 1}],
                      1_000_000, 적립주기="monthly", 적립금액=5_000_000)
        x = next(v for v in r["rolling"] if v["years"] == 1)
        assert x["best"] == pytest.approx(0.0, abs=1e-6) and x["worst"] == pytest.approx(0.0, abs=1e-6)


# ── ④ 넣은 돈 ──────────────────────────────────────────────────

class Test넣은_돈:
    def test_곡선마다_그날까지_넣은_돈(self):
        날 = 거래일(300)
        r = PB.돌리기({"SPY": 걸음(날, 100, 0.0003, 0.01, 10)}, [{"symbol": "SPY", "weight": 1}],
                      1_000_000, 적립주기="monthly", 적립금액=100_000)
        넣은 = [x["invested"] for x in r["curve"]]
        assert 넣은[0] == 1_000_000 and 넣은[-1] == r["contributed"]
        assert all(b >= a for a, b in zip(넣은, 넣은[1:]))
        늘어난 = {round(b - a, 2) for a, b in zip(넣은, 넣은[1:])} - {0}
        assert 늘어난 == {100_000}

    def test_솎아도_넣은_돈이_남는다(self):
        날 = 거래일(2000)
        r = PB.돌리기({"SPY": 걸음(날, 100, 0.0003, 0.01, 11)}, [{"symbol": "SPY", "weight": 1}],
                      1_000_000, 적립주기="monthly", 적립금액=100_000)
        솎은것 = PB.곡선솎기(r["curve"])
        assert len(솎은것) < len(r["curve"])
        assert all("invested" in x for x in 솎은것)
        assert 솎은것[-1]["invested"] == r["contributed"]


# ── 라우트 ─────────────────────────────────────────────────────

class Test라우트:
    def test_자산마다·상관·롤링이_화면까지_가고_벤치마크도_롤링을_준다(self, monkeypatch):
        from fastapi.testclient import TestClient
        from app.api.routes import backtest as R
        from app.main import app

        try:
            R.limiter._storage.reset()
        except Exception:
            pass

        def 봉들(symbol, period, interval, market):
            rng = random.Random(sum(map(ord, symbol)))
            나온것, d, v = [], date(2018, 1, 2), 100.0
            while len(나온것) < 1100:
                if d.weekday() < 5:
                    v *= 1 + rng.gauss(0.0004, 0.01)
                    나온것.append({"date": d.isoformat(), "open": v, "high": v, "low": v, "close": v,
                                   "volume": 1000})
                d += timedelta(days=1)
            return 나온것

        monkeypatch.setattr(R.yf_service, "get_ohlcv", 봉들)
        r = TestClient(app).post("/api/v1/backtest/portfolio", json={
            "assets": [{"symbol": "SPY", "market": "US", "weight": 60, "name": "S&P 500"},
                       {"symbol": "TLT", "market": "US", "weight": 40, "name": "미국 장기국채"}],
            "currency": "USD", "initial_amount": 10_000_000,
            "start_date": "2018-01-02", "end_date": "2022-03-30",
            "contribution_period": "monthly", "contribution_amount": 100_000,
            "rebalance_period": "yearly", "total_return": False, "benchmark": "spy"})
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert [x["symbol"] for x in d["asset_stats"]] == ["SPY", "TLT"]
        assert d["profit"] == pytest.approx(sum(x["contribution"] for x in d["asset_stats"]) - (d["costs"] or 0),
                                            abs=0.05)
        assert d["correlation"]["symbols"] == ["SPY", "TLT"]
        assert [x["years"] for x in d["rolling"]] == [1, 3]
        assert [x["years"] for x in d["benchmark"]["rolling"]] == [1, 3]
        assert d["curve"][-1]["invested"] == d["contributed"]
