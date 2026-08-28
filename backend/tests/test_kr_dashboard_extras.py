"""
한국 대시보드에 더한 두 가지 — 원/100엔 과 VKOSPI.

원/엔은 사실 '추가' 가 아니라 '고치기' 였다.
  해외 탭이 이미 JPYKRW=X 를 받아 "원/100엔" 이라는 이름으로 내보내고
  있었는데, 야후가 주는 값은 1엔당(약 9.3원)이다. 100 을 곱하는 곳이
  어디에도 없었다 — 이름은 100엔당인데 값은 1엔당이었다는 뜻이고,
  화면에는 "원/100엔 9.32원" 이 떠 있었다.

VKOSPI 는 새로 넣었다.
  해외 탭에는 VIX 가 있는데 국내에는 변동성 지표가 없었다. 지수가
  올랐는지만 봐서는 '왜 이렇게 출렁였는지' 가 안 보인다.

여기서 못 박는 것 —
  · 엔화 단위가 맞는가 (100배 어긋나지 않는가)
  · 변동폭도 같이 환산되는가 (값만 100배 하고 변동폭을 두면 더 이상해진다)
  · 곁들이 하나가 실패해도 금리 목록이 살아남는가
"""
import pytest

pytest.importorskip("yfinance")
pytest.importorskip("httpx")

from app.core.cache import cache  # noqa: E402
from app.services import market_extras as M  # noqa: E402


class Test엔화_단위:
    """1엔당(약 9.3원)과 100엔당(약 930원)은 자릿수가 완전히 다르다."""

    @pytest.mark.parametrize("들어온값,나와야할값", [
        (9.32, 932.0),      # 야후가 주는 그대로
        (8.5, 850.0),       # 엔저
        (15.0, 1500.0),     # 엔고
        (932.0, 932.0),     # 이미 100엔당이면 그대로 둔다
        (1500.0, 1500.0),
    ])
    def test_100엔당으로_맞춘다(self, 들어온값, 나와야할값):
        assert M.엔화_100엔당(들어온값) == pytest.approx(나와야할값)

    @pytest.mark.parametrize("이상한값", [0, -1, None, "", "abc"])
    def test_이상한_값에_손대지_않는다(self, 이상한값):
        """0이나 음수를 100배 하면 이상한 값이 더 이상해진다."""
        결과 = M.엔화_100엔당(이상한값)
        assert 결과 == 이상한값 or 결과 == 0

    def test_사람이_아는_범위로_나온다(self):
        """원/100엔은 500~2000원 사이다. 이 범위를 벗어나면
        단위가 어긋났다는 뜻이다."""
        assert 500 <= M.엔화_100엔당(9.32) <= 2000

    def test_경계에서_갈린다(self):
        # 100 미만이면 1엔당으로 보고 곱한다
        assert M.엔화_100엔당(99.0) == pytest.approx(9900.0)
        assert M.엔화_100엔당(100.0) == pytest.approx(100.0)


class Test원엔_항목:
    def test_캐시에_있으면_새로_안_받는다(self, monkeypatch):
        """해외 탭이 5분마다 채워 둔다. 카드 하나 때문에 0.15 CPU
        서버에 요청을 또 얹을 이유가 없다."""
        def _못받게(*a, **k):
            raise AssertionError("캐시가 있는데 새로 받으려 했다")
        monkeypatch.setattr(M.yf, "Ticker", _못받게)

        cache.set("extra:jpykrw", {"value": 9.32, "change": 0.05,
                                   "change_rate": 0.54}, 300)
        항목 = M.get_jpykrw_100()
        assert 항목["value"] == pytest.approx(932.0)

    def test_변동폭도_같이_환산한다(self, monkeypatch):
        """값만 100배 하고 변동폭을 그대로 두면
        '932원, 어제보다 0.05원' 이라는 말이 안 되는 카드가 된다."""
        monkeypatch.setattr(M.yf, "Ticker", lambda *a, **k: pytest.fail("안 받아야 한다"))
        cache.set("extra:jpykrw", {"value": 9.32, "change": 0.05,
                                   "change_rate": 0.54}, 300)
        항목 = M.get_jpykrw_100()
        assert 항목["change"] == pytest.approx(5.0)

    def test_등락률은_그대로_둔다(self, monkeypatch):
        """비율은 단위와 무관하다. 여기까지 100배 하면 틀린다."""
        monkeypatch.setattr(M.yf, "Ticker", lambda *a, **k: pytest.fail("안 받아야 한다"))
        cache.set("extra:jpykrw", {"value": 9.32, "change": 0.05,
                                   "change_rate": 0.54}, 300)
        assert M.get_jpykrw_100()["change_rate"] == pytest.approx(0.54)

    def test_이미_100엔당으로_저장돼_있어도_두_번_곱하지_않는다(self, monkeypatch):
        """서버가 새 코드로 뜨면 캐시에 이미 932 가 들어간다.
        그걸 또 100배 하면 93,200원이 된다."""
        monkeypatch.setattr(M.yf, "Ticker", lambda *a, **k: pytest.fail("안 받아야 한다"))
        cache.set("extra:jpykrw", {"value": 932.0, "change": 5.0,
                                   "change_rate": 0.54}, 300)
        항목 = M.get_jpykrw_100()
        assert 항목["value"] == pytest.approx(932.0)
        assert 항목["change"] == pytest.approx(5.0)

    def test_이름과_단위가_붙어_나온다(self, monkeypatch):
        monkeypatch.setattr(M.yf, "Ticker", lambda *a, **k: pytest.fail("안 받아야 한다"))
        cache.set("extra:jpykrw", {"value": 9.32, "change": 0, "change_rate": 0}, 300)
        항목 = M.get_jpykrw_100()
        assert 항목["name"] == "원/100엔" and 항목["unit"] == "원"


class Test원유로:
    """엔화와 달리 단위를 손댈 것이 없다 — 손대면 그게 버그다."""

    def test_캐시_값을_그대로_쓴다(self, monkeypatch):
        monkeypatch.setattr(M.yf, "Ticker", lambda *a, **k: pytest.fail("안 받아야 한다"))
        cache.set("extra:eurkrw", {"value": 1490.25, "change": -3.5,
                                   "change_rate": -0.23}, 300)
        항목 = M.get_eurkrw()
        assert 항목["value"] == pytest.approx(1490.25)
        assert 항목["change"] == pytest.approx(-3.5)
        assert 항목["change_rate"] == pytest.approx(-0.23)

    def test_엔화_환산이_유로에_새지_않는다(self, monkeypatch):
        """엔화용 100배 환산이 유로까지 걸리면 149,025원이 된다.
        유로는 1000 넘는 값이라 엔화 규칙(100 미만이면 곱하기)에
        걸리지 않아야 정상이다."""
        monkeypatch.setattr(M.yf, "Ticker", lambda *a, **k: pytest.fail("안 받아야 한다"))
        cache.set("extra:eurkrw", {"value": 1490.25, "change": 0, "change_rate": 0}, 300)
        assert M.get_eurkrw()["value"] < 2000

    def test_유로는_값을_아예_건드리지_않는다(self, monkeypatch):
        """받은 값을 그대로 쓴다 — 이게 유로의 계약이다.

        실제 유로 환율(약 1490원)로는 엔화 환산을 걸어도 결과가 같아서
        (100 이상이라 곱하지 않는다) 잘못 걸어 둔 것을 못 잡는다.
        환산이 붙었는지 자체를 보려면 규칙이 갈리는 값을 넣어야 한다.
        50원짜리 유로는 현실에 없지만, 여기서 보려는 것은 환율의 크기가
        아니라 '이 함수가 값을 바꾸는가' 다."""
        monkeypatch.setattr(M.yf, "Ticker", lambda *a, **k: pytest.fail("안 받아야 한다"))
        cache.set("extra:eurkrw", {"value": 50.0, "change": 1.0,
                                   "change_rate": 2.0}, 300)
        항목 = M.get_eurkrw()
        assert 항목["value"] == pytest.approx(50.0), "유로에 단위 환산이 걸려 있다"
        assert 항목["change"] == pytest.approx(1.0)

    def test_이름과_단위(self, monkeypatch):
        monkeypatch.setattr(M.yf, "Ticker", lambda *a, **k: pytest.fail("안 받아야 한다"))
        cache.set("extra:eurkrw", {"value": 1490.25, "change": 0, "change_rate": 0}, 300)
        항목 = M.get_eurkrw()
        assert 항목["name"] == "원/유로" and 항목["unit"] == "원"

    def test_엔화와_다른_캐시를_본다(self, monkeypatch):
        """캐시 키를 잘못 쓰면 유로 카드에 엔화 값이 뜬다."""
        monkeypatch.setattr(M.yf, "Ticker", lambda *a, **k: pytest.fail("안 받아야 한다"))
        cache.set("extra:eurkrw", {"value": 1490.0, "change": 0, "change_rate": 0}, 300)
        cache.set("extra:jpykrw", {"value": 9.32, "change": 0, "change_rate": 0}, 300)
        assert M.get_eurkrw()["value"] == pytest.approx(1490.0)
        assert M.get_jpykrw_100()["value"] == pytest.approx(932.0)


class Test해외탭_엔화도_같이_고쳐졌는가:
    """원/100엔 은 원래 해외 탭에 있던 항목이다.

    한국 탭에만 맞춰 놓고 해외 탭을 그대로 두면, 같은 이름의 카드가
    두 화면에서 100배 다른 값을 보여 준다. 그래서 여기도 태워 본다 —
    뮤테이션에서 이 보정만 되돌렸을 때 검사가 통째로 빠져나갔다."""

    def _가짜종가(self, monkeypatch, 값들):
        """yfinance 를 걷어내고 종가만 흉내 낸다 — 네트워크가 막혀 있고,
        보려는 것은 환산이지 조회가 아니다."""
        import pandas as pd

        monkeypatch.setattr(M, "_batch_close", lambda syms: None)

        class _가짜:
            def __init__(self, sym):
                self.sym = sym

            def history(self, period="5d"):
                v = 값들.get(self.sym, [1.0, 1.0])
                return pd.DataFrame({"Close": v})

        monkeypatch.setattr(M.yf, "Ticker", _가짜)

    def test_해외탭_원100엔도_100엔당으로_나온다(self, monkeypatch):
        cache.delete("extra:us_rates")
        self._가짜종가(monkeypatch, {"JPYKRW=X": [9.27, 9.32]})
        엔 = next(r for r in M._do_fetch_us_rates() if r["name"] == "원/100엔")
        assert 500 <= 엔["value"] <= 2000, f"1엔당 값이 그대로 나온다: {엔['value']}"
        assert 엔["value"] == pytest.approx(932.0)

    def test_해외탭_변동폭도_같이_환산된다(self, monkeypatch):
        cache.delete("extra:us_rates")
        self._가짜종가(monkeypatch, {"JPYKRW=X": [9.27, 9.32]})
        엔 = next(r for r in M._do_fetch_us_rates() if r["name"] == "원/100엔")
        assert 엔["change"] == pytest.approx(5.0, abs=0.01)

    def test_달러는_건드리지_않는다(self, monkeypatch):
        """엔화만 손대야 한다. 원/달러까지 100배 하면 138,450원이 된다."""
        cache.delete("extra:us_rates")
        self._가짜종가(monkeypatch, {"USDKRW=X": [1386.8, 1384.5]})
        달러 = next(r for r in M._do_fetch_us_rates() if r["name"] == "원/달러")
        assert 달러["value"] == pytest.approx(1384.5)


class TestVKOSPI:
    def test_네이버가_되면_pykrx_는_안_부른다(self, monkeypatch):
        cache.delete(M._VKOSPI_CK)
        monkeypatch.setattr(M, "_fetch_vkospi_naver",
                            lambda: {"value": 15.2, "change": -0.8, "change_rate": -5.0})
        monkeypatch.setattr(M, "_fetch_vkospi_pykrx",
                            lambda: pytest.fail("네이버가 됐는데 pykrx 까지 불렀다"))
        항목 = M.get_vkospi()
        assert 항목["value"] == 15.2
        assert 항목["name"] == "VKOSPI" and 항목["unit"] == "pt"

    def test_네이버가_안되면_pykrx_로_넘어간다(self, monkeypatch):
        cache.delete(M._VKOSPI_CK)
        monkeypatch.setattr(M, "_fetch_vkospi_naver", lambda: None)
        monkeypatch.setattr(M, "_fetch_vkospi_pykrx",
                            lambda: {"value": 14.0, "change": 0.2, "change_rate": 1.4})
        assert M.get_vkospi()["value"] == 14.0

    def test_둘_다_안되면_엉뚱한_값을_지어내지_않는다(self, monkeypatch):
        """0 이나 임의의 숫자를 채우면 화면에 거짓말이 뜬다.
        아예 없으면 카드를 안 그리는 편이 옳다."""
        cache.delete(M._VKOSPI_CK)
        monkeypatch.setattr(M, "_fetch_vkospi_naver", lambda: None)
        monkeypatch.setattr(M, "_fetch_vkospi_pykrx", lambda: None)
        assert M.get_vkospi() is None

    def test_일시_장애면_지난_값이라도_쓴다(self, monkeypatch):
        """장 마감 뒤나 잠깐 안 될 때 카드가 사라졌다 나타났다 하면
        고장난 것처럼 보인다."""
        cache.set(M._VKOSPI_CK, {"name": "VKOSPI", "unit": "pt", "value": 13.1,
                                 "change": 0, "change_rate": 0}, 1)
        import time
        time.sleep(1.1)                      # 수명을 넘긴다
        monkeypatch.setattr(M, "_fetch_vkospi_naver", lambda: None)
        monkeypatch.setattr(M, "_fetch_vkospi_pykrx", lambda: None)
        항목 = M.get_vkospi()
        assert 항목 and 항목["value"] == 13.1

    def test_네이버_코드_후보를_여러_개_시도한다(self):
        """이 환경에서는 네이버가 이 지수를 무슨 코드로 부르는지
        확인할 방법이 없다. 하나만 걸어 두면 틀렸을 때 그냥 안 나온다."""
        assert len(M._VKOSPI_네이버코드) >= 2

    def test_pykrx_는_코드가_아니라_이름으로_찾는다(self):
        """코드를 잘못 적으면 빈 데이터가 조용히 돌아온다 —
        지난번 ETF 보유비중 때 그래서 한참 헤맸다."""
        import inspect
        본문 = inspect.getsource(M._fetch_vkospi_pykrx)
        assert "변동성" in 본문 and "get_index_ticker_name" in 본문


class Test금리_목록에_섞여도_안전한가:
    def _금리만(self):
        """국고채까지 넣어 준다.

        안 넣으면 _do_fetch_kr_rates 가 채권을 못 구한 줄 알고 ECOS·
        yfinance·pykrx 를 차례로 두드린다. 막힌 환경에서는 그게 전부
        타임아웃이라 검사 하나가 수십 초씩 걸렸다."""
        return [{"name": "한국 기준금리", "value": 2.75},
                {"name": "CD금리(91일)", "value": 3.62},
                {"name": "국고채 3년", "value": 2.9},
                {"name": "국고채 10년", "value": 3.1}]

    def test_셋_다_붙는다(self, monkeypatch):
        cache.delete("extra:kr_rates")
        monkeypatch.setattr(M, "_fetch_kr_rates_naver", lambda: (self._금리만(), None))
        monkeypatch.setattr(M, "get_eurkrw", lambda: {"name": "원/유로", "value": 1490.0})
        monkeypatch.setattr(M, "get_jpykrw_100",
                            lambda: {"name": "원/100엔", "value": 932.0})
        monkeypatch.setattr(M, "get_vkospi",
                            lambda: {"name": "VKOSPI", "value": 15.2})
        이름들 = [r["name"] for r in M._do_fetch_kr_rates()]
        for 있어야할것 in ("원/유로", "원/100엔", "VKOSPI"):
            assert 있어야할것 in 이름들

    def test_환율이_앞_VKOSPI_가_맨_뒤(self, monkeypatch):
        """화면은 원/달러를 이 목록보다 먼저 그린다. 환율이 앞에 와야
        달러·유로·엔 셋이 붙는다(해외 탭이 쓰는 차례와 같다).
        VKOSPI 는 성격이 달라 맨 뒤다."""
        cache.delete("extra:kr_rates")
        monkeypatch.setattr(M, "_fetch_kr_rates_naver", lambda: (self._금리만(), None))
        monkeypatch.setattr(M, "get_eurkrw", lambda: {"name": "원/유로", "value": 1490.0})
        monkeypatch.setattr(M, "get_jpykrw_100", lambda: {"name": "원/100엔", "value": 932.0})
        monkeypatch.setattr(M, "get_vkospi", lambda: {"name": "VKOSPI", "value": 15.2})
        이름들 = [r["name"] for r in M._do_fetch_kr_rates()]
        assert 이름들[0] == "원/유로"
        assert 이름들[1] == "원/100엔"
        assert 이름들[-1] == "VKOSPI"

    @pytest.mark.parametrize("고장난것", ["get_eurkrw", "get_jpykrw_100", "get_vkospi"])
    def test_하나가_터져도_금리는_그대로_나온다(self, monkeypatch, 고장난것):
        """곁들이 하나 때문에 있던 것까지 사라지면
        고친 게 아니라 망가뜨린 것이다."""
        cache.delete("extra:kr_rates")
        monkeypatch.setattr(M, "_fetch_kr_rates_naver", lambda: (self._금리만(), None))
        monkeypatch.setattr(M, "get_eurkrw", lambda: {"name": "원/유로", "value": 1490.0})
        monkeypatch.setattr(M, "get_jpykrw_100", lambda: {"name": "원/100엔", "value": 932.0})
        monkeypatch.setattr(M, "get_vkospi", lambda: {"name": "VKOSPI", "value": 15.2})

        def _터짐():
            raise RuntimeError("일부러 터뜨림")
        monkeypatch.setattr(M, 고장난것, _터짐)

        이름들 = [r["name"] for r in M._do_fetch_kr_rates()]
        assert "한국 기준금리" in 이름들, "금리가 통째로 사라졌다"

    @pytest.mark.parametrize("없는것", ["get_eurkrw", "get_jpykrw_100", "get_vkospi"])
    def test_값이_없으면_빈칸_대신_아예_안_넣는다(self, monkeypatch, 없는것):
        """None 이 목록에 들어가면 화면에서 카드가 깨진다."""
        cache.delete("extra:kr_rates")
        monkeypatch.setattr(M, "_fetch_kr_rates_naver", lambda: (self._금리만(), None))
        monkeypatch.setattr(M, "get_eurkrw", lambda: {"name": "원/유로", "value": 1490.0})
        monkeypatch.setattr(M, "get_jpykrw_100", lambda: {"name": "원/100엔", "value": 932.0})
        monkeypatch.setattr(M, "get_vkospi", lambda: {"name": "VKOSPI", "value": 15.2})
        monkeypatch.setattr(M, 없는것, lambda: None)
        목록 = M._do_fetch_kr_rates()
        assert all(r is not None for r in 목록)
        assert all(isinstance(r, dict) for r in 목록)


class Test국내와_해외가_같은_환율을_본다:
    """국내 대시보드에 원/유로·원/100엔이 '나올 때도 있고 안 나올 때도' 있었다.

    원인은 원천이 둘이었던 것이다.

      해외 탭 : 여덟 심볼을 한 번에 받고(_do_fetch_us_rates), 환율은
                extra:eurkrw · extra:jpykrw 에도 담는다
      국내 탭 : 그 캐시를 보다가, 비었으면 **카드마다 따로** 야후를 쳤다

    그래서 어느 탭을 먼저 열었느냐가 결과를 갈랐다. 실제로 재 봤다.

      해외 탭을 먼저 연 뒤 : ['원/유로', '원/100엔', 기준금리, CD금리]
      국내 탭을 먼저 연 뒤 : [기준금리, CD금리]            ← 환율 둘이 없다

    게다가 그 반쪽짜리 목록이 300초 캐시됐다. 그 사이에 해외 탭을 열어
    환율이 채워져도 국내 탭은 5분 내내 옛 목록을 줬다.
    """

    @pytest.fixture(autouse=True)
    def _치우기(self):
        열쇠 = ("extra:kr_rates", "extra:eurkrw", "extra:jpykrw",
                "extra:vkospi", "extra:us_rates", "extra:usdkrw")
        for k in 열쇠:
            cache.delete(k); cache.delete(f"{k}:miss")
        yield
        for k in 열쇠:
            cache.delete(k); cache.delete(f"{k}:miss")

    def _묶음대역(self, 센다: dict):
        """_do_fetch_us_rates 가 하는 일 — 한 번에 받아 개별 캐시에도 담는다"""
        def 가짜():
            센다["횟수"] = 센다.get("횟수", 0) + 1
            cache.set("extra:eurkrw", {"value": 1620.5, "change": 3.2, "change_rate": 0.2}, 360)
            cache.set("extra:jpykrw", {"value": 932.1, "change": -1.1, "change_rate": -0.12}, 360)
            return []
        return 가짜

    def _국내금리만(self, monkeypatch, 센다):
        """국내 금리 원천은 다 막고, 환율 묶음만 살려 둔다"""
        for 이름 in ("_fetch_kr_rates_naver", "_fetch_kr_rates_시장지표",
                     "_fetch_bok_rates_ecos"):
            monkeypatch.setattr(M, 이름, lambda *a, **k: (_ for _ in ()).throw(RuntimeError("막힘")))
        monkeypatch.setattr(M, "_빠진_국고채", lambda *a, **k: False)
        monkeypatch.setattr(M, "get_vkospi", lambda *a, **k: None)
        monkeypatch.setattr(M, "get_us_rates", self._묶음대역(센다))

    def test_국내_탭을_먼저_열어도_환율_둘이_나온다(self, monkeypatch):
        센다: dict = {}
        self._국내금리만(monkeypatch, 센다)
        이름들 = [x["name"] for x in M._do_fetch_kr_rates()]
        assert any("유로" in n for n in 이름들), 이름들
        assert any("100엔" in n for n in 이름들), 이름들

    def test_해외_탭이_먼저면_묶음을_다시_안_부른다(self, monkeypatch):
        """국내 탭 때문에 미국 금리까지 또 받아 올 이유는 없다.
        0.15 CPU 서버라 왕복 하나가 그대로 화면 대기다."""
        센다: dict = {}
        self._국내금리만(monkeypatch, 센다)
        # 해외 탭이 이미 받아 둔 상태
        cache.set("extra:eurkrw", {"value": 1620.5, "change": 3.2, "change_rate": 0.2}, 360)
        cache.set("extra:jpykrw", {"value": 932.1, "change": -1.1, "change_rate": -0.12}, 360)
        이름들 = [x["name"] for x in M._do_fetch_kr_rates()]
        assert 센다.get("횟수", 0) == 0, "캐시가 따뜻한데도 묶음을 불렀다"
        assert any("유로" in n for n in 이름들)

    def test_카드마다_따로_야후를_치지_않는다(self, monkeypatch):
        """여기가 원천이 둘로 갈리던 자리다. 카드가 스스로 받으면
        국내 탭만 다른 값을 볼 수 있다."""
        monkeypatch.setattr(M.yf, "Ticker",
                            lambda *a, **k: pytest.fail("환율 카드가 직접 받았다"))
        assert M.get_eurkrw() is None          # 캐시에 없으면 없다고 답한다
        assert M.get_jpykrw_100() is None

    def test_환율이_빠진_목록은_오래_안_담긴다(self, monkeypatch):
        """300초를 담아 두면, 그 사이 해외 탭이 환율을 채워도 국내 탭은
        5분 내내 옛 목록을 준다 — 두 화면이 5분 동안 다른 말을 한다."""
        for 이름 in ("_fetch_kr_rates_naver", "_fetch_kr_rates_시장지표",
                     "_fetch_bok_rates_ecos"):
            monkeypatch.setattr(M, 이름, lambda *a, **k: (_ for _ in ()).throw(RuntimeError("막힘")))
        monkeypatch.setattr(M, "_빠진_국고채", lambda *a, **k: False)
        monkeypatch.setattr(M, "get_vkospi", lambda *a, **k: None)
        monkeypatch.setattr(M, "get_us_rates", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("막힘")))
        M._do_fetch_kr_rates()
        남은 = next((x["ttl_remaining"] for x in cache.keys_with_ttl()
                     if x.get("key") == "extra:kr_rates"), None)
        assert 남은 is not None and 남은 <= 60, f"반쪽짜리 목록이 {남은}초나 담겼다"

    def test_온전하면_제대로_담는다(self, monkeypatch):
        """환율이 다 왔으면 300초다. 매번 30초로 두면 같은 것을
        열 배 더 자주 받는다."""
        센다: dict = {}
        self._국내금리만(monkeypatch, 센다)
        M._do_fetch_kr_rates()
        남은 = next((x["ttl_remaining"] for x in cache.keys_with_ttl()
                     if x.get("key") == "extra:kr_rates"), None)
        assert 남은 is not None and 남은 > 60, f"온전한 목록인데 {남은}초만 담겼다"

    def test_환율_묶음과_vkospi_를_동시에_받는다(self, monkeypatch):
        """서로 상관없는 원천이라 차례로 부르면 왕복이 줄줄이 이어진다.
        위 금리 원천들이 이미 몇 초를 쓰고 난 뒤라, 뒤에 붙는 시간이
        그대로 화면 대기가 된다."""
        import time
        센다: dict = {}
        for 이름 in ("_fetch_kr_rates_naver", "_fetch_kr_rates_시장지표",
                     "_fetch_bok_rates_ecos"):
            monkeypatch.setattr(M, 이름, lambda *a, **k: (_ for _ in ()).throw(RuntimeError("막힘")))
        monkeypatch.setattr(M, "_빠진_국고채", lambda *a, **k: False)

        느림 = 0.5

        def 느린묶음():
            time.sleep(느림)
            return self._묶음대역(센다)()

        def 느린vkospi():
            time.sleep(느림)
            return None

        monkeypatch.setattr(M, "get_us_rates", 느린묶음)
        monkeypatch.setattr(M, "get_vkospi", 느린vkospi)

        시작 = time.perf_counter()
        M._do_fetch_kr_rates()
        걸림 = time.perf_counter() -시작
        # 차례로 부르면 1.0초, 동시에 부르면 0.5초다. 넉넉히 0.85초로 건다
        assert 걸림 < 느림 * 1.7, f"{걸림:.2f}초 — 차례로 부르고 있다"

    def test_낱개_열쇠가_먼저_비어도_목록에서_꺼낸다(self, monkeypatch):
        """지난번 수정이 안 통한 진짜 이유다. 값이 두 군데 있고
        수명이 어긋난다.

          extra:us_rates  300초   해외 탭이 그리는 목록
          extra:eurkrw    360초   같은 함수가 낱개로도 담는 값

        get_us_rates() 는 캐시 우선이라 extra:us_rates 가 살아 있으면
        _do_fetch_us_rates 를 아예 안 부른다 — 낱개가 먼저 비면 아무도
        다시 안 채운다. 해외 탭에는 목록이 멀쩡히 떠 있는데 국내 탭만
        비는 상태가 그대로 굳는다."""
        센다: dict = {}
        # 해외 탭이 그리는 목록만 살아 있다. 낱개 열쇠는 비었다
        cache.set("extra:us_rates", [
            {"name": "원/달러", "value": 1385.0, "change": 2.0, "change_rate": 0.14},
            {"name": "원/유로", "value": 1620.5, "change": 3.2, "change_rate": 0.2},
            {"name": "원/100엔", "value": 932.1, "change": -1.1, "change_rate": -0.12},
        ], 300)
        cache.delete("extra:eurkrw"); cache.delete("extra:jpykrw")
        self._국내금리만(monkeypatch, 센다)

        이름들 = [x["name"] for x in M._do_fetch_kr_rates()]
        assert any("유로" in n for n in 이름들), 이름들
        assert any("100엔" in n for n in 이름들), 이름들
        assert 센다.get("횟수", 0) == 0, "목록에 있는데도 다시 받았다"

    def test_목록에서_꺼낸_엔화에_100을_또_곱하지_않는다(self):
        """extra:us_rates 의 '원/100엔' 은 이미 100엔당이다.
        여기서 또 곱하면 93,210원이 된다 — 예전에 100배 어긋난 값이
        몇 달 떠 있었던 바로 그 자리다."""
        cache.set("extra:us_rates", [
            {"name": "원/100엔", "value": 932.1, "change": -1.1, "change_rate": -0.12},
        ], 300)
        cache.delete("extra:jpykrw")
        항목 = M.get_jpykrw_100()
        assert 항목 is not None
        assert 항목["value"] == pytest.approx(932.1)
        assert 항목["change"] == pytest.approx(-1.1)

    def test_목록이_비면_낱개_열쇠를_본다(self):
        """반대 방향의 어긋남도 있다 — 목록은 비었는데 낱개는 남은 경우"""
        cache.delete("extra:us_rates")
        cache.set("extra:eurkrw", {"value": 1490.25, "change": -3.5, "change_rate": -0.23}, 300)
        항목 = M.get_eurkrw()
        assert 항목 is not None and 항목["value"] == pytest.approx(1490.25)
