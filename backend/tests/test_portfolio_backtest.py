"""자산배분 백테스트 — 답을 아는 자료로 따져 본다.

── 왜 이 검사가 특히 중요한가 ───────────────────────────────

이 화면이 내는 수를 보고 사람이 실제 돈을 넣는다. 그런데 틀려도
화면은 안 죽고 오류도 안 난다 — 그냥 숫자가 조금 좋게 나올 뿐이다.
눈으로는 절대 못 찾는다.

특히 **적립식**이 위험하다. 매달 넣는 돈을 수익으로 뭉개면 어떤
전략이든 그럴듯해 보인다. 그래서 여기 검사의 절반이 '넣은 돈과 번 돈을
갈라 놓았는가' 를 본다.
"""
from datetime import date, timedelta

import pytest

from app.services import portfolio_backtest as P


def 날들만들기(n: int, 시작=date(2020, 1, 1)) -> list[date]:
    """거래일 흉내 — 주말을 건너뛴다"""
    나온것, d = [], 시작
    while len(나온것) < n:
        if d.weekday() < 5:
            나온것.append(d)
        d += timedelta(days=1)
    return 나온것


def 표(날들, 값들) -> dict:
    return dict(zip(날들, 값들))


class Test정규화:
    def test_100_으로_줘도_1_로_줘도_같다(self):
        """화면에서 60/20/20 을 넣기도 하고 0.6/0.2/0.2 를 넣기도 한다.
        사용자가 단위를 신경 쓸 이유가 없다."""
        백 = P.정규화([{"symbol": "A", "weight": 60}, {"symbol": "B", "weight": 40}])
        하나 = P.정규화([{"symbol": "A", "weight": 0.6}, {"symbol": "B", "weight": 0.4}])
        assert [x["weight"] for x in 백] == pytest.approx([x["weight"] for x in 하나])
        assert sum(x["weight"] for x in 백) == pytest.approx(1.0)

    def test_비중을_안_주면_똑같이_나눈다(self):
        """'일단 세 개 넣어 보자' 가 가장 흔한 첫 사용이다.
        거기서 막히면 기능을 못 쓴다."""
        r = P.정규화([{"symbol": "A"}, {"symbol": "B"}, {"symbol": "C"}])
        assert [x["weight"] for x in r] == pytest.approx([1 / 3] * 3)


class Test주기날들:
    def test_달이_바뀌는_첫_거래일을_고른다(self):
        """'1일' 을 찾으면 안 된다. 1일이 휴장이면 그 달 적립이 통째로
        빠지는데, 8년이면 반드시 몇 번은 걸린다."""
        날들 = 날들만들기(200, date(2020, 1, 1))
        고른것 = P.주기날들(날들, "monthly")
        달들 = sorted({(d.year, d.month) for d in 고른것})
        assert len(고른것) == len(달들), "한 달에 두 번 고른 달이 있다"
        assert all(d in 날들 for d in 고른것), "거래일이 아닌 날을 골랐다"

    def test_첫날은_안_넣는다(self):
        """첫날은 초기 투자가 들어가는 날이다.
        같이 넣으면 첫 달만 두 번 납입된다."""
        날들 = 날들만들기(100)
        assert 날들[0] not in P.주기날들(날들, "monthly")

    def test_없음이면_하나도_안_고른다(self):
        assert P.주기날들(날들만들기(100), "none") == set()

    def test_분기와_해도_센다(self):
        날들 = 날들만들기(760, date(2020, 1, 1))     # 약 3년
        분기 = P.주기날들(날들, "quarterly")
        해 = P.주기날들(날들, "yearly")
        assert 10 <= len(분기) <= 12, f"3년인데 분기가 {len(분기)}번"
        assert 2 <= len(해) <= 3, f"3년인데 해가 {len(해)}번"


class Test기본계산:
    def test_두_배_오르면_두_배가_된다(self):
        날들 = 날들만들기(300)
        값 = [100 + i * 100 / 299 for i in range(300)]      # 100 → 200
        r = P.돌리기({"A": 표(날들, 값)}, [{"symbol": "A", "weight": 1}], 1_000_000)
        assert r["final_value"] == pytest.approx(2_000_000, rel=0.01)
        assert r["total_return"] == pytest.approx(100, abs=1)

    def test_비중대로_나눠_담는다(self):
        """A 는 두 배, B 는 그대로. 반씩 담았으면 전체는 1.5배다."""
        날들 = 날들만들기(300)
        r = P.돌리기(
            {"A": 표(날들, [100 + i * 100 / 299 for i in range(300)]),
             "B": 표(날들, [100] * 300)},
            [{"symbol": "A", "weight": 50}, {"symbol": "B", "weight": 50}],
            1_000_000)
        assert r["final_value"] == pytest.approx(1_500_000, rel=0.01)

    def test_현금은_값이_안_변한다(self):
        """이자를 지어내지 않는다. 현금 30% 를 섞으면 그만큼 덜 오른다."""
        날들 = 날들만들기(300)
        r = P.돌리기(
            {"A": 표(날들, [100 + i * 100 / 299 for i in range(300)])},
            [{"symbol": "A", "weight": 70}, {"symbol": "현금", "weight": 30}],
            1_000_000)
        # 70% 가 두 배 → 140만, 현금 30만 그대로 = 170만
        assert r["final_value"] == pytest.approx(1_700_000, rel=0.01)


class Test적립식에서_넣은_돈과_번_돈을_가른다:
    """여기가 이 파일에서 제일 중요한 자리다.

    매달 넣는 사람에게 `(최종 - 초기) / 초기` 는 완전히 틀린 수다.
    1,000만원으로 시작해 매달 넣으면 원금만 수천만원이 되는데, 그걸
    '초기 대비 몇 %' 로 적으면 수익이 몇 배로 부풀려진다.
    """

    def test_총납입에_적립이_들어간다(self):
        날들 = 날들만들기(500)                                # 약 2년
        r = P.돌리기({"A": 표(날들, [100] * 500)},
                     [{"symbol": "A", "weight": 1}],
                     1_000_000, 적립주기="monthly", 적립금액=100_000)
        달수 = len(P.주기날들(날들, "monthly"))
        assert r["contributed"] == pytest.approx(1_000_000 + 달수 * 100_000)

    def test_값이_안_변하면_수익은_0_이다(self):
        """가격이 그대로인데 매달 넣었다면, 늘어난 것은 **넣은 돈뿐**이다.
        수익률이 0 이 아니면 납입을 수익으로 세고 있는 것이다."""
        날들 = 날들만들기(500)
        r = P.돌리기({"A": 표(날들, [100] * 500)},
                     [{"symbol": "A", "weight": 1}],
                     1_000_000, 적립주기="monthly", 적립금액=100_000)
        assert r["total_return"] == pytest.approx(0, abs=0.01), \
            f"넣은 돈이 수익으로 잡혔다 — {r['total_return']}%"
        assert r["profit"] == pytest.approx(0, abs=1)

    def test_값이_안_변하면_연환산도_0_이다(self):
        """TWR 도 같은 함정에 빠질 수 있다. 납입이 있던 날을 그냥
        비교하면 '하루 만에 +10%' 로 잡혀서, 많이 넣을수록 성적이
        좋아지는 엉터리 수가 된다."""
        날들 = 날들만들기(600)
        r = P.돌리기({"A": 표(날들, [100] * 600)},
                     [{"symbol": "A", "weight": 1}],
                     1_000_000, 적립주기="monthly", 적립금액=500_000)
        assert r["twr_annual"] == pytest.approx(0, abs=0.5), \
            f"납입이 수익률로 샜다 — TWR {r['twr_annual']}%"

    def test_앞에서_다_오른_장이면_IRR_이_TWR_보다_낮다(self):
        """늦게 넣은 돈은 그 상승을 못 누렸다는 것이 IRR 에 반영돼야 한다.

        처음에는 '매일 같은 비율로 오르는' 자료로 검사했는데 둘이 똑같이
        나왔다. **그게 맞다** — 어느 날 넣든 같은 비율로 굴면 넣은 시점이
        결과를 안 바꾼다. 둘이 갈리는 것은 수익이 **한쪽에 몰렸을 때**다.

        그래서 첫해에만 오르고 그 뒤로는 제자리인 자료를 쓴다. 초기 자금은
        그 상승을 다 누렸고, 2·3년차에 넣은 돈은 하나도 못 누렸다.
        그러면 내가 실제로 번 연 수익률(IRR)이 전략 자체의 성적(TWR)보다
        낮아야 한다 — 적립식에서 둘을 같이 보여 주는 이유가 이것이다."""
        날들 = 날들만들기(760)                                # 약 3년
        값 = [100 * (1.003 ** min(i, 250)) for i in range(760)]   # 1년만 오르고 평평
        r = P.돌리기({"A": 표(날들, 값)},
                     [{"symbol": "A", "weight": 1}],
                     1_000_000, 적립주기="monthly", 적립금액=300_000)
        assert r["twr_annual"] is not None and r["irr_annual"] is not None
        assert r["irr_annual"] < r["twr_annual"], \
            f"IRR {r['irr_annual']} 이 TWR {r['twr_annual']} 보다 낮아야 한다"

    def test_매일_같은_비율로_오르면_IRR_과_TWR_이_같다(self):
        """위 검사의 짝이다. 넣은 시점이 결과를 안 바꾸는 자료에서는
        둘이 같아야 한다 — 다르게 나오면 둘 중 하나가 잘못 계산된 것이다."""
        날들 = 날들만들기(760)
        r = P.돌리기({"A": 표(날들, [100 * (1.0015 ** i) for i in range(760)])},
                     [{"symbol": "A", "weight": 1}],
                     1_000_000, 적립주기="monthly", 적립금액=300_000)
        assert r["irr_annual"] == pytest.approx(r["twr_annual"], abs=0.5)


class Test리밸런싱:
    def test_리밸런싱을_하면_결과가_달라진다(self):
        """한쪽만 오르는 장에서는 리밸런싱이 오른 쪽을 팔므로 덜 번다.
        값이 같다면 리밸런싱이 아무 일도 안 한 것이다."""
        날들 = 날들만들기(760)
        가격 = {"A": 표(날들, [100 * (1.002 ** i) for i in range(760)]),
                "B": 표(날들, [100] * 760)}
        자산 = [{"symbol": "A", "weight": 50}, {"symbol": "B", "weight": 50}]
        안함 = P.돌리기(가격, 자산, 1_000_000, 리밸런싱="none")
        해마다 = P.돌리기(가격, 자산, 1_000_000, 리밸런싱="yearly")
        assert 해마다["final_value"] < 안함["final_value"]

    def test_리밸런싱이_비중을_되돌린다(self):
        """되돌린 직후에는 목표 비중과 같아야 한다.
        값을 직접 볼 수 없으니, 자주 할수록 한쪽에 쏠린 정도가
        줄어드는 것으로 확인한다."""
        날들 = 날들만들기(760)
        가격 = {"A": 표(날들, [100 * (1.002 ** i) for i in range(760)]),
                "B": 표(날들, [100] * 760)}
        자산 = [{"symbol": "A", "weight": 50}, {"symbol": "B", "weight": 50}]
        해마다 = P.돌리기(가격, 자산, 1_000_000, 리밸런싱="yearly")
        달마다 = P.돌리기(가격, 자산, 1_000_000, 리밸런싱="monthly")
        assert 달마다["final_value"] < 해마다["final_value"]


class Test배당재투자:
    def test_배당을_켜면_더_번다(self):
        """S&P500 을 30년 굴리면 배당 재투자 여부로 최종 금액이
        두 배 가까이 갈린다. 작은 항이 아니다."""
        날들 = 날들만들기(500)
        가격 = {"A": 표(날들, [100] * 500)}
        자산 = [{"symbol": "A", "weight": 1}]
        배당날 = sorted(P.주기날들(날들, "quarterly"))
        배당 = {"A": {d: 1.0 for d in 배당날}}
        없이 = P.돌리기(가격, 자산, 1_000_000)
        같이 = P.돌리기(가격, 자산, 1_000_000, 배당=배당)
        assert 같이["final_value"] > 없이["final_value"]
        assert 같이["dividends"] > 0

    def test_배당을_안_주면_배당합이_None(self):
        """0 과 '안 켰다' 는 다른 말이다"""
        날들 = 날들만들기(300)
        r = P.돌리기({"A": 표(날들, [100] * 300)}, [{"symbol": "A", "weight": 1}], 1_000_000)
        assert r["dividends"] is None


class Test겹치는_구간만_쓴다:
    def test_자산마다_시작일이_다르면_겹치는_데만(self):
        """없는 쪽을 0 으로 치면 포트폴리오가 반토막 난 것처럼 보이고,
        마지막 값을 끌어다 쓰면 상장 전에 이미 갖고 있던 셈이 된다.
        둘 다 거짓이므로 겹치는 구간만 쓴다."""
        날들 = 날들만들기(400)
        가격 = {"A": 표(날들, [100] * 400),
                "B": 표(날들[100:], [100] * 300)}          # B 는 늦게 상장
        r = P.돌리기(가격, [{"symbol": "A", "weight": 50}, {"symbol": "B", "weight": 50}],
                     1_000_000)
        assert r["start_date"] == 날들[100].isoformat()
        assert len(r["curve"]) == 300

    def test_얼마나_쟀는지_알려_준다(self):
        """조용히 짧게 재면 사용자는 요청한 기간을 다 잰 줄 안다"""
        날들 = 날들만들기(760)
        r = P.돌리기({"A": 표(날들, [100] * 760)}, [{"symbol": "A", "weight": 1}], 1_000_000)
        assert r["years"] == pytest.approx(3.0, abs=0.1)
        assert r["start_date"] == 날들[0].isoformat()
        assert r["end_date"] == 날들[-1].isoformat()


class Test해마다_수익:
    def test_그해_납입을_빼고_센다(self):
        """안 빼면 매달 넣는 사람은 **어떤 해든 플러스**가 나온다 —
        넣은 돈이 수익으로 둔갑한다."""
        날들 = 날들만들기(760)
        r = P.돌리기({"A": 표(날들, [100] * 760)},
                     [{"symbol": "A", "weight": 1}],
                     1_000_000, 적립주기="monthly", 적립금액=200_000)
        for 줄 in r["yearly"]:
            assert 줄["return"] == pytest.approx(0, abs=0.5), \
                f"{줄['year']}년에 납입이 수익으로 잡혔다 — {줄['return']}%"


class Test못_재는_경우:
    def test_자료가_너무_짧으면_안_잰다(self):
        날들 = 날들만들기(10)
        assert P.돌리기({"A": 표(날들, [100] * 10)},
                       [{"symbol": "A", "weight": 1}], 1_000_000) == {}

    def test_자산이_없으면_안_잰다(self):
        assert P.돌리기({}, [], 1_000_000) == {}

    def test_전부_현금이면_안_잰다(self):
        """굴릴 것이 없다. 이자를 지어내느니 안 재는 편이 낫다."""
        assert P.돌리기({}, [{"symbol": "현금", "weight": 1}], 1_000_000) == {}

    def test_답이_구간_밖이면_IRR_을_지어내지_않는다(self):
        """IRR 은 닫힌 해가 없어 이분법으로 찾는다. 이분법은 **찾는
        구간 안에 답이 있을 때만** 맞는다 — 밖에 있으면 구간 끝으로
        수렴한 엉뚱한 수를 아주 그럴듯하게 돌려준다.

        상장폐지 직전까지 간 종목이면 진짜 IRR 이 -99% 보다 아래다.
        그때 구간 검사를 안 하면 '-45%' 같은 수가 나오는데, 실제로는
        거의 다 날린 것이다. 오류도 안 나고 화면도 안 죽는다 —
        그냥 **손실이 절반쯤으로 줄어 보인다.**

        모르면 None 이 맞다. 빈칸은 사람이 알아채지만, 지어낸 수는
        아무도 못 알아챈다.
        """
        날들 = 날들만들기(520)                                  # 약 2년
        # 100원 → 0.001원. 진짜 IRR 은 -99% 보다 한참 아래다
        거의전손 = [100 * (0.00001 ** (i / 519)) for i in range(520)]
        r = P.돌리기({"A": 표(날들, 거의전손)},
                     [{"symbol": "A", "weight": 1}], 1_000_000)
        assert r["irr_annual"] is None, \
            f"구간 밖인데 수를 지어냈다 — IRR {r['irr_annual']}%"
        # TWR 은 이분법을 안 쓰므로 그대로 나와야 한다.
        # IRR 하나 때문에 나머지까지 비면 화면이 통째로 빈칸이 된다.
        assert r["twr_annual"] is not None and r["twr_annual"] < -90

    def test_말도_안_되게_올라도_마찬가지다(self):
        """반대쪽 끝도 같다. +1000%/년 위로 가면 구간 밖이라 못 푼다.
        (검사 자료로는 2년에 1만 배 — 실제로 이런 코인이 있었다.)"""
        날들 = 날들만들기(520)
        r = P.돌리기({"A": 표(날들, [100 * (10000 ** (i / 519)) for i in range(520)])},
                     [{"symbol": "A", "weight": 1}], 1_000_000)
        assert r["irr_annual"] is None
        assert r["twr_annual"] is not None and r["twr_annual"] > 1000

    def test_1년_미만이면_연환산을_안_낸다(self):
        """짧은 기간을 연으로 늘리면 터무니없는 수가 나온다 —
        신호 백테스트에서 이미 같은 것을 고쳤다."""
        날들 = 날들만들기(100)                                 # 약 5개월
        r = P.돌리기({"A": 표(날들, [100 + i for i in range(100)])},
                     [{"symbol": "A", "weight": 1}], 1_000_000)
        assert r["total_return"] > 0, "총수익률은 그대로 나와야 한다"
        assert r["twr_annual"] is None
        assert r["irr_annual"] is None


class Test결과를_그대로_저장할_수_있다:
    def test_JSON_으로_쓸_수_있다(self):
        import json
        날들 = 날들만들기(500)
        r = P.돌리기({"A": 표(날들, [100 + i * 0.1 for i in range(500)])},
                     [{"symbol": "A", "weight": 1}],
                     1_000_000, 적립주기="monthly", 적립금액=100_000,
                     리밸런싱="yearly")
        json.dumps(r)


class Test배당_이중계산을_막는다:
    """배당 재투자가 맞으려면 **시세가 조정되지 않은 실제 종가**여야 한다.

    yfinance 는 기본값(auto_adjust=True)이면 배당이 이미 반영된 조정
    종가를 준다. 그 값에 배당을 또 더하면 배당을 두 번 세는 것이고,
    30년을 굴리면 최종 금액이 크게 부풀려진다.

    그런데 이 고장은 **화면에 아무 표시가 안 난다.** 값은 그럴듯하고
    오류도 안 난다. 그래서 눈으로는 영영 못 찾는다 — 설정이 바뀌는
    순간 여기서 걸리게 해 둔다.
    """

    def test_시세를_조정_안_된_종가로_받는다(self):
        import inspect
        from app.services.yf_service import yf_service
        소스 = inspect.getsource(yf_service.get_ohlcv)
        assert "auto_adjust=False" in 소스, \
            ("시세가 배당 조정 종가로 바뀌었다. 그러면 자산배분 백테스트의 "
             "배당 재투자가 이중 계산이 된다 — portfolio_backtest.돌리기 의 "
             "배당 처리를 같이 손봐야 한다.")
