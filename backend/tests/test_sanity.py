"""
값이 이상하면 알아채는 자리.

'못 가져왔다' 는 이제 기록된다(뉴스 실패 이유, 지수별 원천). 그런데 더
무서운 쪽은 **가져왔는데 값이 틀린** 경우다. 실제로 겪은 것들 —

  · 원/100엔이 1엔당 값(9.32원)으로 몇 달 동안 떠 있었다. 이름은
    '원/100엔' 인데 값은 100배 작았고, 아무 오류도 안 났다.
  · 코스닥150이 0 으로 떠 있었다. 조회는 '성공' 이었다.

금융 화면에서 틀린 숫자는 없는 것보다 나쁘다. 없으면 사람이 다른 데서
찾아보지만, 틀린 값은 그대로 믿는다.

여기서 못 박는 것 —
  · 자릿수가 어긋난 값을 잡는가 (100배 틀린 엔화)
  · 0 을 성공으로 넘기지 않는가
  · 멀쩡한 값에 대고 울지 않는가 (거짓 경보가 잦으면 아무도 안 본다)
  · 값을 고치려 들지 않는가 (고칠 수 있으면 이상한 게 아니다)
"""
import pytest

from app.core import health, sanity  # noqa: E402


@pytest.fixture(autouse=True)
def _비우기():
    health.reset()
    sanity.비우기()
    yield


def _기록():
    return {x["name"]: x for x in health.snapshot()}


class Test엔화_100배_사건:
    """이 검사를 넣게 만든 실제 사건이다."""

    def test_1엔당_값이_원100엔_이름으로_오면_잡는다(self):
        assert sanity.확인("환율금리", "원/100엔", 9.32,
                           sanity.정상범위["원/100엔"]) is False
        이유 = _기록()["값:환율금리:원/100엔"]["last_error"]
        assert "범위" in 이유 and "단위" in 이유, 이유

    def test_제대로_된_값은_안_잡는다(self):
        assert sanity.확인("환율금리", "원/100엔", 932.0,
                           sanity.정상범위["원/100엔"]) is True
        assert _기록()["값:환율금리:원/100엔"]["streak"] == 0


class Test코스닥150_0_사건:
    def test_0_은_성공이_아니다(self):
        """조회가 성공해도 0 이면 화면에 0 이 뜬다."""
        assert sanity.확인("지수", "KOSDAQ150", 0,
                           sanity.지수범위["KOSDAQ150"]) is False
        assert "0" in _기록()["값:지수:KOSDAQ150"]["last_error"]

    def test_값이_없어도_잡는다(self):
        assert sanity.확인("지수", "KOSDAQ150", None) is False
        assert "없음" in _기록()["값:지수:KOSDAQ150"]["last_error"]

    def test_숫자가_아니면_잡는다(self):
        assert sanity.확인("지수", "KOSPI", "??") is False


class Test범위:
    @pytest.mark.parametrize("이름,값,정상인가", [
        ("원/달러",     1384.5, True),
        ("원/달러",     13.8,   False),   # 자릿수 어긋남
        ("원/달러",     138450, False),
        ("원/유로",     1490.0, True),
        ("원/100엔",    932.0,  True),
        ("원/100엔",    9.32,   False),
        ("VKOSPI",      15.2,   True),
        ("VKOSPI",      0.15,   False),
        ("한국 기준금리", 2.75,  True),
        ("한국 기준금리", 275.0, False),
        ("국고채 10년",  3.1,    True),
    ])
    def test_환율금리(self, 이름, 값, 정상인가):
        assert sanity.확인("환율금리", 이름, 값, sanity.정상범위.get(이름)) is 정상인가

    @pytest.mark.parametrize("이름,값,정상인가", [
        ("KOSPI",     2650.0,  True),
        ("KOSPI",     26.5,    False),
        ("KOSDAQ",    780.0,   True),
        ("KOSPI200",  350.0,   True),
        ("KOSDAQ150", 1412.0,  True),
        ("KOSDAQ150", 0,       False),
        ("NASDAQ",    18500.0, True),
        ("DOW",       43000.0, True),
    ])
    def test_지수(self, 이름, 값, 정상인가):
        assert sanity.확인("지수", 이름, 값, sanity.지수범위.get(이름)) is 정상인가

    def test_마이너스_금리도_정상으로_본다(self):
        """실제로 있었던 일이다. 0 이상으로 잡으면 거짓 경보가 난다."""
        assert sanity.확인("환율금리", "국고채 3년", -0.2,
                           sanity.정상범위["국고채 3년"]) is True


class Test목록_통째로:
    def test_이상한_것_수를_돌려준다(self):
        수 = sanity.환율금리_확인([
            {"name": "원/달러", "value": 1384.5},      # 정상
            {"name": "원/100엔", "value": 9.32},       # 100배 어긋남
            {"name": "VKOSPI", "value": 0},            # 0
        ])
        assert 수 == 2

    def test_모르는_이름도_0_인지는_본다(self):
        """범위를 모른다고 넘기면 새로 넣은 지표가 검사에서 빠진다."""
        assert sanity.환율금리_확인([{"name": "새로운지표", "value": 0}]) == 1
        assert sanity.환율금리_확인([{"name": "새로운지표2", "value": 123}]) == 0

    def test_지수_목록도_같은_규칙(self):
        수 = sanity.지수_확인([
            {"index": "KOSPI", "value": 2650.0},
            {"index": "KOSDAQ150", "value": 0},
        ])
        assert 수 == 1
        assert _기록()["값:지수:KOSDAQ150"]["streak"] == 1
        assert _기록()["값:지수:KOSPI"]["streak"] == 0

    def test_빈_목록에_울지_않는다(self):
        assert sanity.환율금리_확인([]) == 0
        assert sanity.지수_확인(None) == 0

    def test_이상한_모양이_섞여도_안_터진다(self):
        assert sanity.환율금리_확인([None, "글자", 3, {"name": "원/달러", "value": 1384}]) == 0


class Test멈춘_값:
    """조회도 되고 범위도 정상인데 갱신이 멈춘 경우."""

    def test_계속_같으면_알린다(self):
        """횟수만으로는 안 된다 — 시간도 함께 채워야 한다.

        예전에는 횟수만 봤다. 그런데 부르는 주기가 자리마다 달라서
        같은 30번이 15분일 수도 5시간일 수도 있다(장중 지수 30초,
        휴장 지수 10분, 환율·금리 3분). 그래서 밤새 휴장인 동안
        지수 셋이 전부 '멈췄다' 로 걸렸다 — 값이 안 변하는 게
        당연한 시간이었는데도."""
        for i in range(sanity.멈춤_기준):
            sanity.움직이는지_확인("지수:KOSPI", 2650.0,
                                   지금=1_000_000.0 + i * 600)
        이유 = _기록()["값:멈춤:지수:KOSPI"]["last_error"]
        assert "연속 같은 값" in 이유
        assert "시간째" in 이유

    def test_기준에_못_미치면_안_알린다(self):
        """장 마감 뒤에는 안 변하는 게 정상이다.
        조금 같다고 울면 거짓 경보만 쌓인다."""
        for _ in range(sanity.멈춤_기준 - 1):
            sanity.움직이는지_확인("지수:KOSPI", 2650.0)
        assert "값:멈춤:지수:KOSPI" not in _기록()

    def test_값이_바뀌면_다시_센다(self):
        """움직인 순간 셈이 1부터 다시 시작해야 한다.
        안 그러면 하루 종일 움직이던 지표도 언젠가는 '멈췄다' 고 뜬다."""
        for _ in range(sanity.멈춤_기준 - 1):
            sanity.움직이는지_확인("지수:KOSPI", 2650.0)
        sanity.움직이는지_확인("지수:KOSPI", 2651.0)      # 움직였다 → 1로
        assert sanity._멈춤["지수:KOSPI"][1] == 1, "셈을 안 되돌렸다"

        # 다시 세기 시작했으므로, 기준에 하나 못 미치게 더 해도 안 울어야 한다
        for _ in range(sanity.멈춤_기준 - 2):
            sanity.움직이는지_확인("지수:KOSPI", 2651.0)
        assert "값:멈춤:지수:KOSPI" not in _기록()

    def test_한_번만_알린다(self):
        """계속 쌓으면 연속실패가 수백이 되어 화면이 어지럽다."""
        for i in range(sanity.멈춤_기준 * 3):
            sanity.움직이는지_확인("지수:KOSPI", 2650.0,
                                   지금=1_000_000.0 + i * 600)
        assert _기록()["값:멈춤:지수:KOSPI"]["streak"] == 1

    def test_기준이_거짓_경보가_안_날_만큼_넉넉하다(self):
        """장 마감 뒤에는 값이 안 변하는 게 정상이다. 게다가 이 검사는
        갱신이 돌 때마다 불리므로(휴장 중 10분 주기) 기준이 낮으면
        매일 밤 '멈췄다' 는 경보가 뜬다. 그러면 아무도 안 보게 된다.

        뮤테이션에서 기준을 2로 낮춰도 아무 검사가 안 울었다 —
        '너무 예민하지 않은가' 를 보는 검사가 없었기 때문이다."""
        assert sanity.멈춤_기준 >= 20, \
            f"{sanity.멈춤_기준}번이면 휴장 중에 거짓 경보가 난다"

    def test_휴장_한나절은_견딘다(self):
        """국내 휴장 중 갱신은 10분마다다. 기준이 30이면 5시간은
        조용하다 — 하룻밤을 넘기지는 않지만 장 마감 직후에는 안 운다."""
        for _ in range(19):                       # 약 3시간 분량
            sanity.움직이는지_확인("지수:KOSPI", 2650.0)
        assert "값:멈춤:지수:KOSPI" not in _기록()

    def test_지표마다_따로_센다(self):
        for i in range(sanity.멈춤_기준):
            때 = 1_000_000.0 + i * 600
            sanity.움직이는지_확인("A", 1.0, 지금=때)
            sanity.움직이는지_확인("B", 2.0, 지금=때)
        기록 = _기록()
        assert "값:멈춤:A" in 기록 and "값:멈춤:B" in 기록


class Test값을_고치지_않는가:
    def test_확인은_판단만_한다(self):
        """고칠 수 있으면 애초에 이상한 게 아니다. 몰래 고치면
        화면에는 그럴듯한 값이 뜨고 원인은 영영 안 드러난다."""
        원본 = {"name": "원/100엔", "value": 9.32}
        sanity.환율금리_확인([원본])
        assert 원본["value"] == 9.32, "값을 몰래 바꿨다"


class Test화면에_붙어_있는가:
    def test_환율금리_목록이_검사를_지난다(self):
        import inspect
        from app.services import market_extras as M
        본문 = inspect.getsource(M._do_fetch_kr_rates)
        assert "환율금리_확인" in 본문

    def test_지수도_검사를_지난다(self):
        import inspect
        from app.services import scheduler as S
        본문 = inspect.getsource(S.refresh_kr_indices)
        assert "지수_확인" in 본문

    def test_검사가_터져도_본_기능을_막지_않는다(self):
        """이상값 확인은 곁들이다. 그것 때문에 금리 목록이나 지수
        갱신이 통째로 실패하면 고친 게 아니라 망가뜨린 것이다."""
        import inspect
        from app.services import market_extras as M
        본문 = inspect.getsource(M._do_fetch_kr_rates)
        자리 = 본문[본문.find("환율금리_확인") - 300:본문.find("환율금리_확인") + 300]
        assert "try" in 자리 and "except" in 자리

    def test_기록_이름이_화면_규칙과_맞는다(self):
        """관리자 화면은 '값:' 앞머리로 갈라 본다."""
        sanity.확인("환율금리", "원/달러", 0)
        assert any(n.startswith("값:") for n in _기록())


# ── 멈춤 경보가 풀리는가 ────────────────────────────────────
#
# 관리자 화면에 이렇게 떴다 — 지수 셋과 환율·금리 넷이 '30번 연속 같은 값'.
# 그런데 그때는 한국 장이 열려 있었고 값은 움직이고 있었다.
#
# 두 가지가 겹쳤다.
#   1) 값이 다시 움직여도 record_ok 를 안 해서, 밤새 걸린 경보가 아침까지
#      그대로 남았다. 관리자 화면이 지난밤 일을 지금 일처럼 보여 준 셈이다.
#   2) 횟수만 셌다. 부르는 주기가 자리마다 달라서 같은 30번이 15분일 수도
#      5시간일 수도 있다. 휴장 중 지수는 10분마다 부르므로 밤새 반드시 걸린다.
#   3) 한국 기준금리는 몇 달에 한 번 바뀐다. 그걸 '멈췄다' 고 알리면
#      화면이 늘 빨갛고, 그러면 진짜 멈춘 것도 같이 묻힌다.
class Test멈춤_경보:
    def setup_method(self):
        sanity.비우기()

    def _여러번(self, 이름, 값, 횟수, 간격=600, 시작=1_000_000.0):
        결과 = []
        for i in range(횟수):
            결과.append(sanity.움직이는지_확인(이름, 값, 지금=시작 + i * 간격))
        return 결과

    def test_횟수만_채워도_시간이_안_되면_안_알린다(self):
        """장중 지수는 30초마다 부른다 — 30번은 15분이다."""
        남긴것 = []
        _원래 = sanity.health.record_fail
        sanity.health.record_fail = lambda 이름, 사유=None, *a, **kw: 남긴것.append(이름)
        try:
            self._여러번("지수:KOSPI", 2500.0, 40, 간격=30)
        finally:
            sanity.health.record_fail = _원래
        assert 남긴것 == [], f"15분 만에 알렸다: {남긴것}"

    def test_오래_멈춰_있으면_알린다(self):
        남긴것 = []
        _원래 = sanity.health.record_fail
        sanity.health.record_fail = lambda 이름, 사유=None, *a, **kw: 남긴것.append((이름, 사유))
        try:
            self._여러번("지수:KOSPI", 2500.0, 40, 간격=600)     # 6시간 40분
        finally:
            sanity.health.record_fail = _원래
        assert len(남긴것) == 1, f"{len(남긴것)}번 알렸다"
        assert "시간째" in 남긴것[0][1]

    def test_다시_움직이면_경보를_푼다(self):
        """이게 화면에 지난밤 경보가 남아 있던 이유다."""
        푼것 = []
        _ok, _fail = sanity.health.record_ok, sanity.health.record_fail
        sanity.health.record_ok = lambda 이름, detail=None, *a, **kw: 푼것.append(이름)
        sanity.health.record_fail = lambda *a, **kw: None
        try:
            self._여러번("지수:KOSPI", 2500.0, 40, 간격=600)     # 경보가 걸린다
            sanity.움직이는지_확인("지수:KOSPI", 2501.3, 지금=1_100_000.0)
        finally:
            sanity.health.record_ok, sanity.health.record_fail = _ok, _fail
        assert "값:멈춤:지수:KOSPI" in 푼것, "다시 움직였는데 경보를 안 풀었다"

    def test_안_걸렸으면_괜히_풀지도_않는다(self):
        푼것 = []
        _원래 = sanity.health.record_ok
        sanity.health.record_ok = lambda 이름, detail=None, *a, **kw: 푼것.append(이름)
        try:
            sanity.움직이는지_확인("지수:KOSPI", 2500.0, 지금=1.0)
            sanity.움직이는지_확인("지수:KOSPI", 2501.0, 지금=2.0)
        finally:
            sanity.health.record_ok = _원래
        assert 푼것 == [], "걸린 적도 없는데 풀었다고 기록했다"

    def test_한_번만_알린다(self):
        남긴것 = []
        _원래 = sanity.health.record_fail
        sanity.health.record_fail = lambda *a, **kw: 남긴것.append(1)
        try:
            self._여러번("지수:KOSPI", 2500.0, 200, 간격=600)
        finally:
            sanity.health.record_fail = _원래
        assert len(남긴것) == 1, f"{len(남긴것)}번 알렸다 — 화면이 같은 말로 덮인다"

    def test_정책금리는_봐준다(self):
        """한국은행 기준금리는 몇 달에 한 번 바뀐다."""
        남긴것 = []
        _원래 = sanity.health.record_fail
        sanity.health.record_fail = lambda *a, **kw: 남긴것.append(1)
        try:
            self._여러번("환율금리:한국 기준금리", 2.75, 500, 간격=180)
            self._여러번("환율금리:CD금리(91일)", 3.62, 500, 간격=180)
        finally:
            sanity.health.record_fail = _원래
        assert 남긴것 == [], "정책금리를 멈췄다고 알렸다"

    def test_환율은_봐주지_않는다(self):
        """장중에 몇 시간씩 소수점까지 같으면 그건 진짜 멈춘 것이다."""
        남긴것 = []
        _원래 = sanity.health.record_fail
        sanity.health.record_fail = lambda *a, **kw: 남긴것.append(1)
        try:
            self._여러번("환율금리:원/유로", 1618.0, 100, 간격=180)
        finally:
            sanity.health.record_fail = _원래
        assert len(남긴것) == 1

    def test_숫자가_아니면_넘어간다(self):
        assert sanity.움직이는지_확인("지수:KOSPI", None) is True
        assert sanity.움직이는지_확인("지수:KOSPI", "없음") is True

    def test_멈춤_시간_기준이_너무_짧지_않다(self):
        """짧게 잡으면 휴장마다 거짓 경보가 나고, 그러면 아무도 안 본다."""
        assert sanity.멈춤_시간_기준 >= 2 * 3600
