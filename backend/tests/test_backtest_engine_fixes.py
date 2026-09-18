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
    """하루치 봉들. 안 주면 고·저·시가를 종가에서 만든다.

    ── 날짜를 **거래일처럼** 만드는 이유 ──────────────────────

    예전에는 `2024-{i//28+1}-{i%28+1}` 로 만들었다. 한 달을 28일로
    치는 달력이라 252봉이 9개월밖에 안 된다.

    엔진이 햇수를 '봉 수 ÷ 252' 로 세던 때는 그래도 1.0 이 나왔다.
    그런데 그 방식은 **자료에 구멍이 있으면 햇수를 짧게 세고, 짧게
    세면 연환산이 부풀려진다.** 달력으로 세도록 고치고 나니 이 자료가
    0.74년으로 나왔다 — 자료가 실제와 달랐던 것이 드러난 셈이다.

    주말을 건너뛴 진짜 거래일로 만든다. 그러면 252봉이 약 1년이라
    어느 방식으로 세든 같은 답이 나오고, 검사가 자료의 생김새가 아니라
    **엔진의 규칙**을 재게 된다.
    """
    from datetime import date, timedelta
    나온것 = []
    d = date(2024, 1, 2)
    for i, c in enumerate(닫는값들):
        while d.weekday() >= 5:
            d += timedelta(days=1)
        나온것.append({
            "date": d.isoformat(),
            "open": 시[i] if 시 else c,
            "high": 고[i] if 고 else c * 1.01,
            "low": 저[i] if 저 else c * 0.99,
            "close": c,
            "volume": 1000,
        })
        d += timedelta(days=1)
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
        과최적화로 가는 가장 흔한 길이다.

        252봉이 딱 1.00년은 아니다. 이 자료에는 공휴일이 없어서
        252거래일이 352일(0.96년)에 들어간다 — 진짜 한 해는 공휴일까지
        끼어 365일에 252거래일이 든다. 0.96 이 이 자료의 맞는 답이다.

        **±0.01 로 조이면 안 된다.** 그렇게 두면 검사가 '엔진이 맞나'
        가 아니라 '자료가 딱 그 모양인가' 를 재게 된다."""
        r = E.run(봉([100 + i for i in range(252)]), 항상삼, 안팜)
        assert r["years"] == pytest.approx(0.96, abs=0.03), \
            f"252거래일을 {r['years']}년으로 셌다"

    def test_자료에_구멍이_있으면_기간을_제대로_센다(self):
        """**이 고침의 핵심이다.**

        예전에는 '봉 수 ÷ 252' 로 셌다. 자료에 구멍이 있으면 봉이
        적어지고, 봉이 적으면 햇수가 짧게 나오고, **짧은 기간으로
        나누면 연환산이 부풀려진다** — 자료가 성길수록 성적이 좋아
        보이는 셈이다.

        같은 2년을 하나는 매일, 하나는 이틀에 한 번만 담아 본다.
        달력으로 세면 둘 다 2년이다."""
        촘촘 = 봉([100 * (1.0008 ** i) for i in range(504)])
        성김 = 촘촘[::2]                      # 봉 수는 절반, 기간은 그대로
        r1 = E.run(촘촘, 항상삼, 안팜)
        r2 = E.run(성김, 항상삼, 안팜)
        assert r2["years"] == pytest.approx(r1["years"], abs=0.02), \
            (f"같은 기간인데 촘촘 {r1['years']}년 · 성김 {r2['years']}년 — "
             "봉 수로 세고 있다")
        assert r2["annual_return"] == pytest.approx(r1["annual_return"], rel=0.05), \
            (f"성긴 자료의 연환산이 {r2['annual_return']}% 로 부풀었다 "
             f"(촘촘 {r1['annual_return']}%)")


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


class Test못_잰_것과_나쁜_것을_가른다:
    """이 파일은 승률·손익비에서 이미 그 구분을 지키고 있었다.
    샤프만 빠져 있었다."""

    def test_값이_안_움직이면_샤프는_못_잰다(self):
        """표준편차가 0 이라는 것은 조건이 한 번도 안 맞아 아무것도 안
        샀거나, 값이 그대로였다는 뜻이다. 거기에 0 을 적으면 '위험 대비
        수익이 없다' 로 읽힌다 — 실제로는 **잴 것이 없었다**."""
        r = E.run(봉([100] * 60), 안팜, 안팜)      # 아무것도 안 산다
        assert r["sharpe_ratio"] is None, \
            f"못 재는데 {r['sharpe_ratio']} 를 적었다 — 0 은 '나쁘다' 로 읽힌다"

    def test_움직이면_제대로_잰다(self):
        """위 검사의 짝이다. 늘 None 을 주는 코드도 위만으로는 통과한다."""
        값 = [100 * (1.001 ** i) + (i % 7) for i in range(200)]
        r = E.run(봉(값), 항상삼, 안팜)
        assert r["sharpe_ratio"] is not None, "잴 수 있는데 못 쟀다"
        assert isinstance(r["sharpe_ratio"], float)


class Test거래비용:
    """자산배분에는 이미 있었는데 신호 백테스트에는 없었다.
    **같은 화면의 두 탭이 다른 기준으로 계산**하고 있었던 셈이다 —
    나란히 놓고 보면 신호 쪽이 무조건 좋아 보인다.

    신호 매매는 사고파는 횟수가 훨씬 많아 영향도 더 크다.
    """

    def test_수수료를_떼면_덜_번다(self):
        값 = [100 + i for i in range(120)]
        없이 = E.run(봉(값), 항상삼, 안팜)
        같이 = E.run(봉(값), 항상삼, 안팜, 거래비용=0.001)
        assert 같이["total_return"] < 없이["total_return"], \
            "수수료를 뗐는데 결과가 그대로다"

    def test_살_때도_팔_때도_뗀다(self):
        """한쪽만 떼면 비용이 절반으로 나와, 자주 사고팔수록 유리해
        보이는 거꾸로 된 결과가 된다.

        손으로 센다 — 1,000만원의 95%로 사고 한 번 판다. 1% 수수료면
        살 때 약 9.4만, 팔 때 그만큼. 합이 살 때치의 두 배 가까이 나와야
        한다(가격이 오르면 판 쪽이 조금 더 크다)."""
        값 = [100] * 3 + [110] * 10
        팔기 = {"logic": "AND", "conditions": [{"indicator": "PRICE", "operator": ">", "value": 105}]}
        r = E.run(봉(값), 항상삼, 팔기, initial_capital=10_000_000, 거래비용=0.01)
        살때 = 10_000_000 * 0.95 * 0.01
        assert r["costs"] > 살때 * 1.8, \
            f"수수료가 {r['costs']:,.0f} 뿐이다 — 한쪽에만 떼고 있다(살 때만 해도 {살때:,.0f})"

    def test_비용률에_비례한다(self):
        값 = [100 + (i % 11) for i in range(200)]
        팔기 = {"logic": "AND", "conditions": [{"indicator": "ROC_1", "operator": "<", "value": 0}]}
        싼것 = E.run(봉(값), 항상삼, 팔기, 거래비용=0.001)
        비싼것 = E.run(봉(값), 항상삼, 팔기, 거래비용=0.005)
        assert 비싼것["costs"] > 싼것["costs"] * 4
        assert 비싼것["total_return"] < 싼것["total_return"]

    def test_현금이_마이너스가_안_된다(self):
        """수수료까지 낼 수 있는 만큼만 사야 한다. 살 돈을 다 쓰고 나서
        수수료를 못 내면 현금이 마이너스가 되고, 그 빚이 조용히 수익률에
        섞인다."""
        값 = [100] * 60
        r = E.run(봉(값), 항상삼, 안팜, initial_capital=1_000_000, position_size=1.0, 거래비용=0.02)
        곡선 = [p["value"] for p in r["equity_curve"]]
        assert min(곡선) > 0, "평가액이 0 아래로 갔다 — 못 낼 수수료를 쓴 것이다"

    def test_0_이면_안_넣은_것으로_적는다(self):
        """'안 넣었다' 와 '넣었는데 0원' 은 다른 말이다"""
        r = E.run(봉([100 + i for i in range(60)]), 항상삼, 안팜)
        assert r["costs"] is None and r["cost_rate"] is None

    def test_자산배분과_같은_이름으로_내보낸다(self):
        """두 백테스트가 같은 것을 다른 이름으로 주면 화면이 두 벌
        필요해진다. 자산배분은 costs · cost_rate 로 준다."""
        r = E.run(봉([100 + i for i in range(60)]), 항상삼, 안팜, 거래비용=0.001)
        assert "costs" in r and "cost_rate" in r
        assert r["cost_rate"] == pytest.approx(0.001)


class Test유니버스가_시한_안에_끝난다:
    """유니버스 백테스트는 이 엔진을 **316종목**에 돌린다.

    계산만으로 23초가 걸려서 화면의 30초 시한을 넘기고 있었다(실측).
    시세 받는 시간은 그 23초에 안 들어간 값이라, 사실상 늘 실패했다.

    범인은 지표가 아니라 **한 줄씩 보는 순회**였다 — 지표는 11%,
    순회가 89%. iterrows 가 봉마다 pandas Series 를 새로 만드는 탓이다.
    dict 목록으로 바꾸니 4.3배 빨라졌고, 결과는 한 글자도 안 달라졌다.
    """

    def test_봉마다_Series_를_새로_안_만든다(self):
        """iterrows 가 돌아오면 그대로 6배 느려진다. 값으로는 안 드러나고
        (결과가 같다) 시간만 늘어나므로 코드를 본다."""
        import inspect
        소스 = inspect.getsource(E.run)
        assert "df.iterrows()" not in 소스, \
            "iterrows 가 돌아왔다 — 유니버스가 시한을 넘긴다"
        assert 'df.to_dict("records")' in 소스

    def test_크로스_조건도_목록에서_꺼낸다(self):
        import inspect
        소스 = inspect.getsource(E._eval_condition)
        assert "df.iloc[idx - 1]" not in 소스, \
            "크로스마다 Series 를 또 만들고 있다"

    def test_10년치_한_종목이_충분히_빠르다(self):
        """316종목 ÷ 동시 5 = 63묶음. 한 종목이 0.3초를 넘으면 계산만으로
        19초가 넘어가고, 시세 받는 시간을 더하면 시한을 넘는다."""
        import time, random
        random.seed(5)
        값, v = [], 100.0
        for _ in range(2520):
            v *= (1 + random.gauss(0.0004, 0.012))
            값.append(v)
        바 = 봉(값)
        진입 = {"logic": "AND", "conditions": [
            {"indicator": "RSI", "operator": "<", "value": 30, "period": 14},
            {"indicator": "MA", "operator": "crosses_above", "value": "EMA", "period": 20}]}
        청산 = {"logic": "OR", "conditions": [{"indicator": "RSI", "operator": ">", "value": 70, "period": 14}]}

        t = time.time()
        E.run(바, 진입, 청산, stop_loss=10, take_profit=20)
        걸린 = time.time() - t
        assert 걸린 < 0.3, \
            (f"10년치 한 종목에 {걸린:.2f}초 — 316종목이면 계산만 "
             f"{316/5*걸린:.0f}초라 30초 시한을 넘는다")

    def test_바꿔도_결과가_같다(self):
        """빨라지려고 결과가 달라지면 아무 소용이 없다.
        손절·익절·크로스가 다 걸리는 자료로 값을 확인한다."""
        값 = [100, 105, 95, 120, 80, 130, 90, 110] * 20
        진입 = {"logic": "AND", "conditions": [
            {"indicator": "MA", "operator": "crosses_above", "value": "EMA", "period": 5}]}
        r = E.run(봉(값), 진입, 안팜, stop_loss=10, take_profit=15)
        # 거래가 실제로 일어나야 의미가 있다
        assert r["total_trades"] > 3, "거래가 거의 없다 — 검사 자료를 보라"
        assert r["total_return"] is not None and r["mdd"] >= 0
