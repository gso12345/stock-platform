"""백테스트 엔진 — 결과를 **한쪽으로 부풀리던** 네 가지.

── 왜 이 검사가 필요한가 ────────────────────────────────────

백테스트가 틀리는 것은 다른 고장과 성격이 다르다. 화면이 죽지도 않고
오류도 안 뜬다. 그냥 **숫자가 조금 좋게** 나올 뿐이다. 그 숫자를 보고
사람이 실제 돈을 넣는다. 그래서 여기는 눈으로 못 찾는 고장이 곧바로
손해로 이어지는 자리다.

여기 있는 넷은 전부 **한 방향으로만** 틀렸다 — 실제보다 좋아 보이는
쪽으로. 그게 제일 나쁜 종류다.
"""
import pytest

from app.services.backtest_engine import backtest_engine as E


def 봉(닫는값들, 고=None, 저=None, 시=None):
    """하루치 봉들. 안 주면 고·저·시가를 종가에서 만든다."""
    나온것 = []
    for i, c in enumerate(닫는값들):
        나온것.append({
            "date": f"2024-{(i // 28) + 1:02d}-{(i % 28) + 1:02d}",
            "open": 시[i] if 시 else c,
            "high": 고[i] if 고 else c * 1.01,
            "low": 저[i] if 저 else c * 0.99,
            "close": c,
            "volume": 1000,
        })
    return 나온것


항상삼 = {"logic": "AND", "conditions": [{"indicator": "PRICE", "operator": ">", "value": 0}]}
안팜 = {"logic": "AND", "conditions": []}


class Test손절이_장중을_본다:
    """예전에는 **종가로만** 손절을 판정했다.

    그래서 장중에 저가가 -30% 를 찍고 종가가 -1% 로 회복한 날,
    손절 10% 를 걸어 뒀는데도 한 번도 안 팔렸다(실측: 손절 0건).

    이게 왜 큰가 — 결과가 **한쪽으로만** 틀린다. 손절을 놓치면 그 뒤에
    값이 돌아온 경우만 살아남아, 실제보다 수익률이 높고 MDD 가 낮게
    나온다. 손절을 걸수록 성적이 좋아 보이는, 정반대의 그림이 된다.
    """

    def test_장중에_손절선을_뚫으면_판다(self):
        값 = [100] * 3 + [99, 100, 101] * 10
        봉들 = 봉(값)
        봉들[3]["low"] = 70               # 장중 -30%, 종가는 -1%
        r = E.run(봉들, 항상삼, 안팜, stop_loss=10)
        손절 = [t for t in r["trades"] if t["type"] == "손절"]
        assert len(손절) >= 1, "장중에 손절선을 뚫었는데 안 팔았다"

    def test_체결가는_손절선이지_저가가_아니다(self):
        """저가로 잡으면 실제보다 훨씬 나쁘게 나온다.
        -10% 에 걸어 둔 주문은 저가가 -30% 까지 갔어도 -10% 에서 체결된다."""
        값 = [100] * 3 + [99] * 20
        봉들 = 봉(값)
        봉들[3]["low"] = 70
        r = E.run(봉들, 항상삼, 안팜, stop_loss=10)
        손절 = [t for t in r["trades"] if t["type"] == "손절"][0]
        assert 손절["pnl_rate"] == pytest.approx(-10, abs=0.5), \
            f"손절선(-10%)이 아니라 {손절['pnl_rate']}% 로 잡았다"

    def test_갭_하락이면_시가로_체결한다(self):
        """손절선이 -10% 인데 시가가 이미 -25% 면, -10% 에 팔 수는 없다.
        그 자리를 안 보면 실제보다 좋게 나온다."""
        값 = [100] * 3 + [75] * 20
        봉들 = 봉(값)
        봉들[3]["open"] = 75
        봉들[3]["low"] = 74
        r = E.run(봉들, 항상삼, 안팜, stop_loss=10)
        손절 = [t for t in r["trades"] if t["type"] == "손절"][0]
        assert 손절["pnl_rate"] < -20, \
            f"갭 하락인데 {손절['pnl_rate']}% 로 잡았다 — 실제보다 좋게 나온다"

    def test_익절도_장중_고가를_본다(self):
        값 = [100] * 3 + [101] * 20
        봉들 = 봉(값)
        봉들[3]["high"] = 130             # 장중 +30%
        r = E.run(봉들, 항상삼, 안팜, take_profit=10)
        익절 = [t for t in r["trades"] if t["type"] == "익절"]
        assert len(익절) >= 1, "장중에 익절선에 닿았는데 안 팔았다"

    def test_한_봉에_둘_다_닿으면_손절을_먼저_본다(self):
        """일봉만으로는 어느 쪽이 먼저인지 알 수 없다.
        모르면 나쁜 쪽으로 세는 것이 백테스트의 규칙이다 —
        반대로 하면 실제로는 손절된 거래가 익절로 기록된다."""
        값 = [100] * 3 + [100] * 20
        봉들 = 봉(값)
        봉들[3]["low"] = 80               # -20%
        봉들[3]["high"] = 120             # +20%
        r = E.run(봉들, 항상삼, 안팜, stop_loss=10, take_profit=10)
        첫거래 = r["trades"][0]
        assert 첫거래["type"] == "손절", \
            f"손절·익절에 둘 다 닿았는데 {첫거래['type']} 으로 셌다"


class Test없는_것과_나쁜_것을_구분한다:
    """0 은 '쟀더니 0' 이라는 뜻이다. '못 쟀다' 와 같은 얼굴이면 안 된다."""

    def test_손실이_하나도_없으면_손익비는_None(self):
        """예전에는 0 이었다. 손익비 0 은 '번 돈이 없다' 는 뜻이라,
        **한 번도 안 진 전략이 화면에서 최악으로 보였다**."""
        값 = [100 + i for i in range(40)]
        r = E.run(봉(값), 항상삼, {"logic": "AND",
                                   "conditions": [{"indicator": "ROC_1", "operator": "<", "value": -99}]})
        assert r["total_trades"] >= 1
        assert r["profit_factor"] is None, "손실이 없는데 손익비를 숫자로 냈다"

    def test_거래가_없으면_승률도_평균도_None(self):
        """조건이 한 번도 안 맞아 **아무것도 안 산 것**과
        사서 다 진 것은 정반대인데, 예전에는 둘 다 '승률 0%' 였다."""
        r = E.run(봉([100] * 60), 안팜, 안팜)
        assert r["total_trades"] == 0
        assert r["win_rate"] is None
        assert r["avg_profit"] is None
        assert r["avg_loss"] is None

    def test_거래가_없어도_수익률은_0_이_맞다(self):
        """안 산 채로 현금을 들고 있던 기간의 성과는 실제로 0% 다.
        이것까지 None 으로 만들면 볼 것이 없어진다."""
        r = E.run(봉([100] * 60), 안팜, 안팜)
        assert r["total_return"] == 0
        assert r["mdd"] == 0


class Test짧은_기간을_연으로_부풀리지_않는다:
    """6주에 +9.5% 를 연으로 늘리면 '연 114%' 가 찍힌다(실측).

    수식은 표준이지만, 그 가정이 화면에 한 글자도 안 적힌다.
    사람은 그냥 '이 전략은 연 114%' 로 읽고, 그건 거짓이다.
    """

    def test_1년_미만이면_연환산을_안_낸다(self):
        값 = [100 + i * 10 / 29 for i in range(30)]     # 30봉 ≈ 0.12년
        r = E.run(봉(값), 항상삼, 안팜)
        assert r["total_return"] > 0, "총수익률은 그대로 나와야 한다"
        assert r["annual_return"] is None, "1년도 안 되는데 연환산을 냈다"

    def test_1년_넘으면_연환산을_낸다(self):
        값 = [100 + i * 20 / 299 for i in range(300)]   # 300봉 ≈ 1.19년
        r = E.run(봉(값), 항상삼, 안팜)
        assert r["annual_return"] is not None

    def test_몇_년치인지_같이_알려_준다(self):
        """3개월 성적과 10년 성적을 같은 얼굴로 보여 주는 것이
        과최적화로 가는 가장 흔한 길이다."""
        r = E.run(봉([100 + i for i in range(252)]), 항상삼, 안팜)
        assert r["years"] == pytest.approx(1.0, abs=0.01)


class Test투자비중이_실제로_먹는다:
    """화면에 '투자비중' 슬라이더가 있는데 서버가 그 값을 안 받았다.
    50% 로 내려도 늘 95% 로 계산했다 — 아무 일도 안 하는 조작칸이다."""

    def test_비중을_줄이면_수익도_줄어든다(self):
        값 = [100 + i for i in range(60)]
        높게 = E.run(봉(값), 항상삼, 안팜, position_size=0.95)
        낮게 = E.run(봉(값), 항상삼, 안팜, position_size=0.30)
        assert 낮게["total_return"] < 높게["total_return"], \
            "비중을 3분의 1로 줄였는데 결과가 같다"


class Test숫자가_그대로_저장될_수_있다:
    """pandas 에서 나온 값은 np.float64 다. 그대로 두면 응답으로도 나가고
    **DB 의 JSON 칸에도** 들어가는데, 드라이버에 따라 거기서 직렬화가
    터진다. 값이 맞는데 저장만 실패하는, 원인을 찾기 어려운 자리다."""

    def test_결과를_JSON_으로_쓸_수_있다(self):
        import json
        값 = [100 + i for i in range(60)]
        r = E.run(봉(값), 항상삼, 안팜, stop_loss=5, take_profit=5)
        json.dumps(r)                     # 터지면 여기서 끝난다

    def test_거래와_자산곡선이_순수_파이썬_수다(self):
        값 = [100 + i for i in range(60)]
        r = E.run(봉(값), 항상삼, 안팜)
        for t in r["trades"]:
            assert type(t["exit_price"]) is float, f"{type(t['exit_price'])} 이 섞였다"
            assert type(t["pnl_rate"]) is float
            assert type(t["shares"]) is int
        for e in r["equity_curve"]:
            assert type(e["value"]) is float
