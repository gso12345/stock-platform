"""시세를 **일부만** 받은 날은 기록하지 않는다.

── 무엇이 문제였나 ─────────────────────────────────────────

합계내기() 가 돌려주는 두 칸의 뜻은 이렇다 —

    priced  시세가 있어야 하는 종목 수 (현금 등 제외)
    filled  실제로 시세를 구한 종목 수

그러니 **온전한 합은 filled == priced** 다. 그런데 찍기() 와 /history
라우트는 `filled == 0`(하나도 못 받음)일 때만 걸렀다. 세 종목 중 하나만
받아도 그 줄이 그대로 적혔다.

못 받은 종목은 **매입가**로 센다(합계내기 안에 그렇게 되어 있다).
그래서 그날 평가금액이 실제보다 훨씬 낮게 찍힌다 — 두 종목 중 하나만
받으면 **25% 아래**다(이 파일에서 재고 있다).

찍기() 의 설명에는 이미 `filled < priced 인 줄은 '아직 덜 됐다' 로
둔다` 고 적혀 있었다. **의도는 맞았고 코드가 그대로 안 돼 있었다.**

── 왜 '없는 것보다 나쁜가' ───────────────────────────────

빠진 날은 메우기() 가 나중에 그날 **실제 종가**로 채운다. 그런데
반쪽 줄은 '구멍' 이 아니라서 메우기가 건드리지도 않는다. 한 번 잘못
적히면 영영 남는다.

그리고 그 줄이 기간의 첫날이 되면 화면의 모든 퍼센트가 그 낮은 값을
기준으로 잡힌다 — 앱을 안 연 날의 수익률이 볼 때마다 달라 보이던
이유가 이것이다.

── 이 검사가 지키는 것 ─────────────────────────────────────

이 고장은 **화면에 오류로 안 나타난다.** 그래프는 그려지고 숫자도
나온다. 그냥 그날만 아래로 찍힐 뿐이라 눈으로는 못 찾는다.
"""
import pytest

from app.services import portfolio_snapshot as PS


class _항목:
    def __init__(self, symbol, market="KR", shares=10, avg=70_000,
                 currency=None, asset_class=None):
        self.symbol, self.market = symbol, market
        self.shares, self.avg_price = shares, avg
        self.currency, self.asset_class = currency, asset_class
        self.input_exchange_rate = None
        self.user_id, self.portfolio_id = 1, 1


@pytest.fixture
def 두종목():
    return [_항목("005930", avg=70_000), _항목("000660", avg=200_000)]


def _시세흉내(monkeypatch, 표: dict):
    monkeypatch.setattr(PS, "시세", lambda sym: 표.get(
        sym.replace(".KS", "").replace(".KQ", "")))


class Test반쪽값이_얼마나_틀리나:
    def test_하나만_받으면_그날이_통째로_아래로_찍힌다(self, 두종목, monkeypatch):
        """못 받은 종목을 매입가로 세기 때문이다.
        이 수가 이 파일이 존재하는 이유다."""
        _시세흉내(monkeypatch, {"005930": 100_000.0, "000660": 300_000.0})
        온전 = PS.합계내기(두종목, 1400)

        _시세흉내(monkeypatch, {"005930": 100_000.0})
        반쪽 = PS.합계내기(두종목, 1400)

        assert 온전["filled"] == 온전["priced"] == 2
        assert 반쪽["filled"] == 1 and 반쪽["priced"] == 2
        틀린정도 = (온전["value"] - 반쪽["value"]) / 온전["value"] * 100
        assert 틀린정도 > 20, f"{틀린정도:.1f}% 밖에 안 틀렸다 — 검사 자료를 다시 보라"


class Test못_받은_종목을_어떻게_세나:
    """매입가로 센다. 0 으로 세면 안 된다.

    0 으로 세면 그날 자산이 통째로 사라진 것처럼 보인다 — 그래프가
    바닥까지 떨어졌다 이튿날 되돌아오는 톱니가 된다. 매입가는 적어도
    '그 종목을 갖고 있다' 는 사실은 지킨다.

    (지금은 반쪽 줄을 아예 안 적으므로 이 값이 기록에 남지는 않는다.
     그래도 합계내기() 는 다른 데서도 쓰이므로 규칙을 못 박아 둔다.)
    """

    def test_못_받으면_매입가로_센다(self, 두종목, monkeypatch):
        _시세흉내(monkeypatch, {})              # 하나도 못 받음
        r = PS.합계내기(두종목, 1400)
        기대 = 10 * 70_000 + 10 * 200_000
        assert r["value"] == pytest.approx(기대), \
            "못 받은 종목을 매입가로 안 셌다 — 0 으로 세면 자산이 사라진 것처럼 보인다"
        assert r["cost"] == pytest.approx(기대)
        assert r["filled"] == 0 and r["priced"] == 2


class Test온전한지_판정하는_규칙:
    """`filled == 0` 이 아니라 `filled < priced` 여야 한다.

    이 둘은 '하나도 못 받았을 때' 만 같고, **일부만 받았을 때 갈린다** —
    그리고 실제로 문제가 되는 것이 그 경우다.
    """

    @pytest.mark.parametrize("filled,priced,적어야하나", [
        (2, 2, True),    # 다 받음 — 적는다
        (1, 2, False),   # 반쪽 — 안 적는다  ← 예전에는 적었다
        (0, 2, False),   # 하나도 못 받음 — 안 적는다
        (0, 0, True),    # 현금만 — 잴 것이 없으니 그대로 적는다
    ])
    def test_규칙(self, filled, priced, 적어야하나):
        덜됐나 = priced > 0 and filled < priced
        assert (not 덜됐나) == 적어야하나

    def test_옛_규칙은_반쪽을_못_걸렀다(self):
        """왜 고쳐야 했는지를 검사에 남긴다"""
        filled, priced = 1, 2
        옛규칙_거름 = priced > 0 and filled == 0
        새규칙_거름 = priced > 0 and filled < priced
        assert not 옛규칙_거름, "옛 규칙은 반쪽을 그냥 통과시켰다"
        assert 새규칙_거름


class Test코드가_그_규칙을_쓰고_있다:
    """규칙만 맞고 코드가 안 바뀌면 아무것도 안 고쳐진다.

    함수 안을 들여다보는 검사라 좀 거칠지만, 이 고장은 값으로는
    재현하기가 아주 번거롭다(스케줄러·DB·시세 캐시가 다 얽힌다).
    한 글자가 되돌아가면 곧바로 걸리게 해 둔다.
    """

    def test_찍기가_덜_채워진_줄을_거른다(self):
        """전체 합과 **포트폴리오별 줄** 둘 다 봐야 한다.

        찍기() 는 사람 단위 합계(합)와 포트폴리오 단위 합계(쪽)를 따로
        적는다. 한쪽만 고치면 다른 쪽에 반쪽 줄이 계속 쌓이고, 화면에서
        포트폴리오를 하나 골랐을 때만 틀린 값이 나온다 — 전체로 보면
        멀쩡한데 골라 보면 이상한, 제일 찾기 어려운 모양이다.
        (실제로 한쪽만 고친 채로 뮤테이션을 돌렸더니 안 걸렸다.)"""
        import inspect, re
        소스 = inspect.getsource(PS.찍기)
        for 이름 in ("합", "쪽"):
            assert f'{이름}["filled"] < {이름}["priced"]' in 소스, \
                f"{이름} 쪽이 반쪽 줄을 다시 적고 있다"
        # 주석에는 옛 규칙 이야기가 남아 있으므로 코드 줄만 본다
        코드만 = "\n".join(l for l in 소스.splitlines()
                            if not l.lstrip().startswith("#"))
        되살아남 = re.findall(r'(?:합|쪽)\["filled"\]\s*==\s*0', 코드만)
        assert not 되살아남, "옛 규칙(filled == 0)이 되살아났다"

    def test_history_라우트도_같은_규칙을_쓴다(self):
        import inspect
        from app.api.routes.portfolio import 자산흐름
        소스 = inspect.getsource(자산흐름)
        assert '합["filled"] >= 합["priced"]' in 소스, \
            "오늘 점을 덜 채워진 값으로 붙이고 있다"

    def test_메우기가_반쪽_줄을_다시_만든다(self):
        """찍기() 를 고쳐도 **이미 쌓인 반쪽 줄**은 그대로 남는다.
        메우기가 그 줄을 지우고 실제 종가로 다시 채워야 한다.

        함수가 있는지만 보면 안 된다 — 정의해 놓고 안 쓰면 그대로
        통과한다(그 상태로 뮤테이션이 살아남았다). 지울 줄을 고르는
        자리에서 실제로 불리는지까지 본다."""
        import inspect
        소스 = inspect.getsource(PS.메우기)
        assert "def _반쪽인가" in 소스, "메우기에 반쪽 판정이 없다"
        """조건 안에 괄호가 또 있어서 정규식으로 잘라 내려다 틀렸다
        (`[^)]*` 가 첫 `)` 에서 멈춘다). 줄 통째로 보는 편이 확실하다."""
        고르는줄 = [l for l in 소스.splitlines() if "지울것 if" in l]
        assert 고르는줄, "지울 줄을 고르는 자리를 못 찾았다"
        assert any("_반쪽인가" in l for l in 고르는줄), \
            "반쪽 판정을 만들어만 놓고 지울 줄을 고를 때 안 쓴다"
