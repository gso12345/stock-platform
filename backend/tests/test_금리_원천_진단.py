"""
관리자 화면 '국내 금리 원천' 여섯 줄이 모두 '빈손' 이었다(2026-10-09).

'빈손' 한 마디로는 고칠 수가 없었다. 막혔는지(접근 문제), 닿았는데 모양이
바뀌었는지(코드 문제) 가를 수 없어서다. 그리고 들여다보니 —

  · yfinance 국고채는 로이터 코드(KR3YT=RR)로 야후에 묻고 있었다. 야후에는
    그런 종목이 없어 처음부터 받을 수 없는 경로였다.
  · ECOS 국고채 코드는 '맞는지 확인할 방법이 없다' 고 적혀 있던 짐작이었다.
    키를 넣으면 다른 금리가 '국고채' 이름으로 뜰 수 있었다.
  · 네이버 시장지표 페이지가 다른 주소로 옮겨 가면(3xx) 따라가지 않았다.
"""
import pytest

from app.core.cache import cache
from app.services import market_extras as M


class _R:
    def __init__(self, status=200, text="", data=None, host="finance.naver.com"):
        self.status_code = status
        self.text = text
        self._d = data

        class _U:
            pass
        self.url = _U()
        self.url.host = host

    def json(self):
        return self._d


@pytest.fixture(autouse=True)
def _비우기():
    M.금리쉼표.잊기()
    M.지표쉼표.잊기()
    M._응답기록.clear()
    M._금리진단.clear()
    cache.delete(M._ECOS_항목_CK)
    cache.delete("extra:kr_rates")
    yield
    M.금리쉼표.잊기()
    M.지표쉼표.잊기()
    M._응답기록.clear()


def _나머지_막기(monkeypatch, 빼고=()):
    """금리 원천을 모두 '아무것도 안 줌' 으로 — 빼고 에 적은 것만 진짜로 둔다."""
    원천들 = {
        "_fetch_kr_rates_naver": lambda: ([], None),
        "_fetch_kr_rates_시장지표": lambda: [],
        "_fetch_bok_rates_ecos": lambda: (None, []),
        "_fetch_kr_bonds_pykrx": lambda: ([], None, []),
        "_fetch_bok_그밖_ecos": lambda: [],
    }
    for 이름, 가짜 in 원천들.items():
        if 이름 not in 빼고:
            monkeypatch.setattr(M, 이름, 가짜)
    monkeypatch.setattr(M, "_환율_채워두기", lambda: None)
    monkeypatch.setattr(M, "get_vkospi", lambda: None)


class Test빈손의_이유를_적는다:
    def test_네이버_시장지표가_404면_그렇게_적는다(self, monkeypatch):
        _나머지_막기(monkeypatch, 빼고=("_fetch_kr_rates_시장지표",))
        monkeypatch.setattr(M.httpx, "get", lambda *a, **k: _R(status=404))
        M._do_fetch_kr_rates()
        결과 = M.금리진단()["네이버 시장지표(HTML)"]["결과"]
        assert 결과.startswith("빈손") and "HTTP 404" in 결과, 결과

    def test_200_인데_숫자가_없으면_모양이_바뀐_것이다(self, monkeypatch):
        """로그인 화면·새 화면으로 바뀐 페이지는 200 을 주면서 금리가 없다"""
        _나머지_막기(monkeypatch, 빼고=("_fetch_kr_rates_시장지표",))
        monkeypatch.setattr(M.httpx, "get", lambda *a, **k: _R(text="<html>새 화면</html>"))
        M._do_fetch_kr_rates()
        assert "금리 숫자 없음" in M.금리진단()["네이버 시장지표(HTML)"]["결과"]

    def test_다른_주소로_옮겨_가면_따라가고_어디로_갔는지_적는다(self, monkeypatch):
        _나머지_막기(monkeypatch, 빼고=("_fetch_kr_rates_시장지표",))
        받은인자: list = []

        def _가짜(*a, **k):
            받은인자.append(k)
            return _R(text="<td>3.115</td><td>3.095</td>", host="stock.naver.com")
        monkeypatch.setattr(M.httpx, "get", _가짜)
        M._do_fetch_kr_rates()
        assert all(k.get("follow_redirects") for k in 받은인자), "옮겨 간 주소를 안 따라간다"
        결과 = M.금리진단()["네이버 시장지표(HTML)"]
        assert 결과["결과"] == "받음"                 # 따라가서 받았다

    def test_네이버_모바일_API_는_상태와_쉬는_후보를_적는다(self, monkeypatch):
        _나머지_막기(monkeypatch, 빼고=("_fetch_kr_rates_naver",))
        monkeypatch.setattr(M.httpx, "get", lambda *a, **k: _R(status=404))
        # 쉼_기준 번 실패하면 그다음 회차부터 쉰다
        for _ in range(M.금리쉼표.쉼_기준 + 1):
            M._do_fetch_kr_rates()
        결과 = M.금리진단()["네이버 모바일 API"]["결과"]
        assert "HTTP 404" in 결과
        assert "쉬는 후보" in 결과, 결과

    def test_ECOS_가_키를_거절하면_그_메시지를_적는다(self, monkeypatch):
        _나머지_막기(monkeypatch, 빼고=("_fetch_bok_rates_ecos",))
        monkeypatch.setattr(M.httpx, "get", lambda *a, **k: _R(data={
            "RESULT": {"CODE": "INFO-100", "MESSAGE": "인증키가 유효하지 않습니다."}}))
        M._do_fetch_kr_rates()
        결과 = M.금리진단()["ECOS 기준금리·국고채"]["결과"]
        assert "인증키가 유효하지 않습니다" in 결과, 결과

    def test_받았으면_이유를_덧붙이지_않는다(self, monkeypatch):
        _나머지_막기(monkeypatch)
        monkeypatch.setattr(M, "_fetch_kr_rates_시장지표", lambda: [
            {"name": "콜금리(1일)", "value": 3.1, "change": 0, "change_rate": 0,
             "unit": "%", "is_rate": True}])
        M._응답_남기기("네이버 시장지표(HTML)", "HTTP 404")    # 일부 실패가 있었어도
        M._do_fetch_kr_rates()
        assert M.금리진단()["네이버 시장지표(HTML)"]["결과"] == "받음"

    def test_지난_회차의_이유가_다음_회차로_새지_않는다(self, monkeypatch):
        _나머지_막기(monkeypatch)
        M._응답_남기기("네이버 시장지표(HTML)", "HTTP 500")
        M._do_fetch_kr_rates()                     # 이번 회차에 소비
        M._do_fetch_kr_rates()
        assert M.금리진단()["네이버 시장지표(HTML)"]["결과"] == "빈손"


class Test처음부터_못_받는_경로는_없앴다:
    def test_yfinance_국고채_경로가_없다(self):
        assert not hasattr(M, "_fetch_kr_bonds_yf")

    def test_관리자_화면에_그_줄이_안_뜬다(self, monkeypatch):
        _나머지_막기(monkeypatch)
        M._do_fetch_kr_rates()
        assert "yfinance 국고채" not in M.금리진단()


def _ECOS(monkeypatch, 항목: dict, 줄이름: "dict | None" = None, 값: float = 2.6):
    """항목목록과 값을 흉내 낸다. 줄이름 — 코드별로 돌려줄 ITEM_NAME1(기본: 항목 이름)."""
    코드별 = {c: n for n, c in 항목.items()}
    코드별.update(줄이름 or {})
    물은코드: list = []

    def _가짜(url, **k):
        if "StatisticItemList" in url:
            return _R(data={"StatisticItemList": {"row": [
                {"ITEM_NAME": n, "ITEM_CODE": c} for n, c in 항목.items()]}})
        코드 = url.rstrip("/").rsplit("/", 1)[-1]
        물은코드.append(코드)
        if "722Y001" in url:
            return _R(data={"StatisticSearch": {"row": [
                {"ITEM_NAME1": "한국은행 기준금리", "DATA_VALUE": "2.5"}]}})
        이름 = 코드별.get(코드, "")
        return _R(data={"StatisticSearch": {"row": [
            {"ITEM_NAME1": 이름, "DATA_VALUE": str(값 - 0.01)},
            {"ITEM_NAME1": 이름, "DATA_VALUE": str(값)}]}})
    monkeypatch.setattr(M.httpx, "get", _가짜)
    return 물은코드


class TestECOS_국고채는_이름으로_찾는다:
    def test_항목목록에서_코드를_찾는다(self, monkeypatch):
        물은 = _ECOS(monkeypatch, {"국고채(3년)": "A3", "국고채(5년)": "A5", "국고채(10년)": "A10"})
        _, 국고채 = M._fetch_bok_rates_ecos()
        assert [x["name"] for x in 국고채] == ["국고채 3년", "국고채 5년", "국고채 10년"]
        assert {"A3", "A5", "A10"} <= set(물은)

    def test_예전_짐작_코드를_쓰지_않는다(self, monkeypatch):
        물은 = _ECOS(monkeypatch, {"국고채(3년)": "A3", "국고채(5년)": "A5", "국고채(10년)": "A10"})
        M._fetch_bok_rates_ecos()
        assert not ({"010190000", "010300000", "010400000"} & set(물은))

    def test_받은_줄의_이름이_다르면_버린다(self, monkeypatch):
        """코드가 틀려 다른 금리가 오면, 그것을 국고채라고 보여 주지 않는다"""
        _ECOS(monkeypatch, {"국고채(3년)": "A3", "국고채(5년)": "A5", "국고채(10년)": "A10"},
              줄이름={"A5": "회사채(3년, AA-)"})
        _, 국고채 = M._fetch_bok_rates_ecos()
        assert [x["name"] for x in 국고채] == ["국고채 3년", "국고채 10년"]
        assert "항목 이름이 다름" in M._응답_요약("ECOS 기준금리·국고채")

    def test_10년을_1년으로_30년을_3년으로_착각하지_않는다(self, monkeypatch):
        _ECOS(monkeypatch, {"국고채(3년)": "A3", "국고채(5년)": "A5", "국고채(10년)": "A10"},
              줄이름={"A3": "국고채(30년)", "A10": "국고채(1년)"})
        _, 국고채 = M._fetch_bok_rates_ecos()
        assert [x["name"] for x in 국고채] == ["국고채 5년"]

    def test_항목목록을_못_받으면_예비_코드로_묻되_이름이_맞아야_쓴다(self, monkeypatch):
        _ECOS(monkeypatch, {}, 줄이름={"010200000": "국고채(3년)", "010200001": "국고채(5년)",
                                       "010210000": "국고채(10년)"})
        _, 국고채 = M._fetch_bok_rates_ecos()
        assert [x["name"] for x in 국고채] == ["국고채 3년", "국고채 5년", "국고채 10년"]


class TestCD금리도_ECOS_에서:
    def test_시장금리표의_CD_가_CD_자리로_간다(self, monkeypatch):
        """CD 는 늘 고정값(3.62%, 정적)으로 떠 있었다"""
        _나머지_막기(monkeypatch, 빼고=("_fetch_bok_그밖_ecos",))
        _ECOS(monkeypatch, {"CD(91일)": "C1", "콜금리(1일, 전체거래)": "K1"}, 값=2.75)
        목록 = M._do_fetch_kr_rates()
        cd = next(x for x in 목록 if x["name"] == "CD금리(91일)")
        assert cd["value"] == pytest.approx(2.75) and not cd.get("_static")
        assert [x["name"] for x in 목록].count("CD금리(91일)") == 1, "CD 가 두 줄 떴다"
