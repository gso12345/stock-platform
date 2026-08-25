"""콜금리·회사채가 화면에 오기까지.

"콜금리 회사채 안 뜸" 의 원인은 두 갈래였다.

  1) 회사채는 이미 받고 있었다. KRX 장외 채권수익률 표에 회사채 AA-/BBB-
     두 줄이 들어 있는데, 읽는 코드가 국고채와 CD만 집어 가고 나머지를
     버렸다. 받아 놓고 안 쓰는 자리가 또 하나 있었던 셈이다.
  2) 콜금리는 그 표에 없다. 한국은행 ECOS 시장금리표에서 따로 받아야
     하는데 그 경로가 아예 없었다.

또 하나 — pykrx 호출이 `if not bonds` 안에 있었다. 국고채를 다른 데서
얻으면 이 줄이 통째로 안 돌았고, 그래서 이 표에만 있는 회사채도 같이
못 받았다.
"""
import types
import pytest
import pandas as pd

from app.core import pykrx_light
from app.core.cache import cache
import app.services.market_extras as M


# pykrx 문서(website/krx/bond/wrap.py)에 적힌 표 그대로
_KRX표 = pd.DataFrame(
    {"수익률": [1.467, 1.995, 2.194, 2.418, 2.619, 2.639, 2.559, 2.570,
               2.771, 8.637, 1.500],
     "대비":   [0.015, 0.026, 0.036, 0.045, 0.053, 0.055, 0.057, 0.048,
               0.038, 0.036, 0.000]},
    index=pd.Index(
        ["국고채 1년", "국고채 2년", "국고채 3년", "국고채 5년", "국고채 10년",
         "국고채 20년", "국고채 30년", "국민주택 1종 5년",
         "회사채 AA-(무보증 3년)", "회사채 BBB- (무보증 3년)", "CD(91일)"],
        name="채권종류"))


@pytest.fixture
def KRX표(monkeypatch):
    def _쓰기(표=_KRX표):
        monkeypatch.setattr(
            pykrx_light, "bond",
            lambda: types.SimpleNamespace(get_otc_treasury_yields=lambda d: 표))
    return _쓰기


class Test회사채는_이미_오고_있었다:
    def test_KRX표에서_회사채_두_줄을_집어_온다(self, KRX표):
        KRX표()
        bonds, cd, 그밖 = M._fetch_kr_bonds_pykrx()
        이름들 = [x["name"] for x in 그밖]
        assert "회사채 AA- 3년" in 이름들
        assert "회사채 BBB- 3년" in 이름들

    def test_값과_전일대비를_그대로_옮긴다(self, KRX표):
        KRX표()
        _, _, 그밖 = M._fetch_kr_bonds_pykrx()
        aa = next(x for x in 그밖 if x["name"] == "회사채 AA- 3년")
        assert aa["value"] == pytest.approx(2.771, abs=0.001)
        assert aa["change"] == pytest.approx(0.038, abs=0.001)
        assert aa["unit"] == "%" and aa["is_rate"] is True

    def test_국고채와_CD는_예전대로_나온다(self, KRX표):
        """회사채를 살리면서 원래 되던 것을 깨뜨리면 고친 게 아니다."""
        KRX표()
        bonds, cd, _ = M._fetch_kr_bonds_pykrx()
        assert [b["name"] for b in bonds] == ["국고채 3년", "국고채 5년", "국고채 10년"]
        assert cd and cd["name"] == "CD금리(91일)"

    def test_이름에_공백이_다르게_들어와도_찾는다(self, KRX표):
        """KRX 표는 괄호 앞 공백이 줄마다 들쭉날쭉하다."""
        표 = _KRX표.copy()
        표.index = pd.Index(
            [i.replace(" ", "") for i in _KRX표.index], name="채권종류")
        KRX표(표)
        _, cd, 그밖 = M._fetch_kr_bonds_pykrx()
        assert [x["name"] for x in 그밖] == ["회사채 AA- 3년", "회사채 BBB- 3년"]
        assert cd is not None

    def test_표가_비면_빈손_세_개를_돌려준다(self, KRX표):
        KRX표(pd.DataFrame())
        assert M._fetch_kr_bonds_pykrx() == ([], None, [])


class Test국고채가_이미_있어도_회사채는_받는다:
    def _네이버가_국고채만(self):
        국고채 = [{"name": f"국고채 {n}년", "value": 3.0 + n / 10, "change": 0.0,
                   "change_rate": 0.0, "unit": "%", "is_rate": True}
                  for n in (3, 5, 10)]
        return 국고채, None

    def test_국고채를_먼저_얻어도_KRX_표를_읽는다(self, monkeypatch, KRX표):
        """예전 조건은 `if not bonds` 였다. 국고채가 이미 있으면 이 줄이
        통째로 안 돌아서 회사채도 같이 못 받았다."""
        KRX표()
        monkeypatch.setattr(M, "_fetch_kr_rates_naver", self._네이버가_국고채만)
        monkeypatch.setattr(M, "_fetch_bok_그밖_ecos", lambda: [])
        cache.delete("extra:kr_rates")

        이름들 = [r["name"] for r in M._do_fetch_kr_rates()]
        assert "회사채 AA- 3년" in 이름들
        assert "국고채 3년" in 이름들, "원래 오던 국고채가 밀려나면 안 된다"

    def test_회사채는_국고채_뒤에_놓인다(self, monkeypatch, KRX표):
        """국고채 3/5/10년은 한 묶음으로 읽는 값이라 사이에 다른 것이
        끼면 눈이 걸린다."""
        KRX표()
        monkeypatch.setattr(M, "_fetch_kr_rates_naver", self._네이버가_국고채만)
        monkeypatch.setattr(M, "_fetch_bok_그밖_ecos", lambda: [])
        cache.delete("extra:kr_rates")

        이름들 = [r["name"] for r in M._do_fetch_kr_rates()]
        국고채자리 = [i for i, n in enumerate(이름들) if "국고채" in n]
        회사채자리 = [i for i, n in enumerate(이름들) if "회사채" in n]
        assert 국고채자리 == list(range(국고채자리[0], 국고채자리[0] + 3)), "국고채가 흩어졌다"
        assert min(회사채자리) > max(국고채자리)


class Test콜금리는_ECOS에서:
    """콜금리는 KRX 표에 없다. 한국은행 시장금리표에서만 온다."""

    def _ECOS(self, monkeypatch, 항목: dict, 값: float = 3.11):
        cache.delete(M._ECOS_항목_CK)

        class _R:
            def __init__(self, d):
                self.status_code = 200
                self._d = d

            def json(self):
                return self._d

        def _가짜(url, **kw):
            if "StatisticItemList" in url:
                return _R({"StatisticItemList": {"row": [
                    {"ITEM_NAME": n, "ITEM_CODE": c} for n, c in 항목.items()]}})
            return _R({"StatisticSearch": {"row": [
                {"DATA_VALUE": str(값 - 0.02)}, {"DATA_VALUE": str(값)}]}})

        monkeypatch.setattr(M.httpx, "get", _가짜)

    def test_항목_이름으로_코드를_찾아_받는다(self, monkeypatch):
        """코드를 외워 적으면 틀렸을 때 오류가 아니라 '빈 결과' 가 조용히
        돌아온다. 이름으로 찾으면 그 일이 안 생긴다."""
        self._ECOS(monkeypatch, {"콜금리(1일물)": "010101000",
                                 "회사채(3년, AA-)": "010320000"})
        결과 = M._fetch_bok_그밖_ecos()
        이름들 = [x["name"] for x in 결과]
        assert "콜금리(1일)" in 이름들
        assert next(x for x in 결과 if x["name"] == "콜금리(1일)")["value"] == \
            pytest.approx(3.11, abs=0.001)

    def test_이름이_비슷한_것_중_대표를_고른다(self, monkeypatch):
        """'콜금리(1일물)' 과 '콜금리(1일물, 중개회사거래)' 가 같이 있다."""
        self._ECOS(monkeypatch, {"콜금리(1일물, 중개회사거래)": "010102000",
                                 "콜금리(1일물)": "010101000"})
        결과 = M._fetch_bok_그밖_ecos()
        assert len(결과) == 1 and 결과[0]["name"] == "콜금리(1일)"

    def test_ECOS가_그_항목을_안_주면_아무_일도_안_일어난다(self, monkeypatch):
        self._ECOS(monkeypatch, {"국고채(3년)": "010190000"})
        assert M._fetch_bok_그밖_ecos() == []

    def test_항목목록이_비면_값을_받으러_가지_않는다(self, monkeypatch):
        """없는 표에 대고 항목마다 요청을 날리면 헛일만 네 번이다."""
        cache.delete(M._ECOS_항목_CK)
        본것: list = []

        class _R:
            status_code = 500

            def json(self):
                return {}

        def _가짜(url, **kw):
            본것.append(url)
            return _R()

        monkeypatch.setattr(M.httpx, "get", _가짜)
        assert M._fetch_bok_그밖_ecos() == []
        assert len(본것) == 1, f"항목목록 한 번만 물어야 한다: {본것}"

    def test_회사채를_KRX에서_이미_받았으면_ECOS_것을_겹쳐_넣지_않는다(
            self, monkeypatch, KRX표):
        KRX표()
        self._ECOS(monkeypatch, {"콜금리(1일물)": "010101000",
                                 "회사채(3년, AA-)": "010320000"})
        monkeypatch.setattr(M, "_fetch_kr_rates_naver", lambda: ([], None))
        monkeypatch.setattr(M, "_fetch_bok_rates_ecos", lambda: (None, []))
        cache.delete("extra:kr_rates")

        이름들 = [r["name"] for r in M._do_fetch_kr_rates()]
        assert 이름들.count("회사채 AA- 3년") == 1
        assert "콜금리(1일)" in 이름들


class Test왜_안_왔는지_남기는가:
    """"콜금리 회사채 안뜸" 을 두 번 들었다. 두 번 다 원인을 못 짚은 게
    아니라 짚을 방법이 없었다 — 작업 환경에서 네이버·KRX·ECOS 가 전부
    막혀 있어 고친 게 맞는지 알 수 없고, 배포한 뒤에도 '안 나온다' 만
    보일 뿐 서버가 뭘 시도했는지는 아무 데도 안 보였다."""

    def _아무것도_안_되게(self, monkeypatch):
        monkeypatch.setattr(M, "_fetch_kr_rates_naver", lambda: ([], None))
        monkeypatch.setattr(M, "_fetch_kr_rates_시장지표", lambda: [])
        monkeypatch.setattr(M, "_fetch_bok_rates_ecos", lambda: (None, []))
        monkeypatch.setattr(M, "_fetch_kr_bonds_yf", lambda: [])
        monkeypatch.setattr(M, "_fetch_kr_bonds_pykrx", lambda: ([], None, []))
        monkeypatch.setattr(M, "_fetch_bok_그밖_ecos", lambda: [])
        cache.delete("extra:kr_rates")
        M._금리진단.clear()

    def test_원천마다_결과를_남긴다(self, monkeypatch):
        self._아무것도_안_되게(monkeypatch)
        M._do_fetch_kr_rates()
        진단 = M.금리진단()
        for 원천 in ("네이버 모바일 API", "네이버 시장지표(HTML)",
                     "ECOS 기준금리·국고채", "KRX 장외채권(pykrx)", "ECOS 시장금리표"):
            assert 원천 in 진단, f"{원천} 결과가 안 남았다"
            assert 진단[원천]["결과"], f"{원천} 결과가 비어 있다"

    def test_실패와_빈손을_갈라_적는다(self, monkeypatch):
        """'못 닿는다' 와 '닿는데 그 항목이 없다' 는 고치는 방법이 다르다.
        앞은 접근 문제고, 뒤는 코드가 틀린 것이다."""
        self._아무것도_안_되게(monkeypatch)

        def _터짐():
            raise ConnectionError("차단됨")
        monkeypatch.setattr(M, "_fetch_kr_rates_시장지표", _터짐)

        M._do_fetch_kr_rates()
        진단 = M.금리진단()
        assert 진단["네이버 시장지표(HTML)"]["결과"].startswith("실패")
        assert "ConnectionError" in 진단["네이버 시장지표(HTML)"]["결과"]
        assert 진단["네이버 모바일 API"]["결과"] == "빈손"

    def test_받은_것의_이름을_적어_둔다(self, monkeypatch):
        self._아무것도_안_되게(monkeypatch)
        monkeypatch.setattr(M, "_fetch_kr_rates_시장지표", lambda: [
            {"name": "콜금리(1일)", "value": 3.1, "change": 0,
             "change_rate": 0, "unit": "%", "is_rate": True}])
        M._do_fetch_kr_rates()
        진단 = M.금리진단()["네이버 시장지표(HTML)"]
        assert 진단["결과"] == "받음"
        assert "콜금리(1일)" in 진단["받은것"]


class Test시장지표_경로:
    """네이버 모바일 JSON API 의 금리 코드는 짐작이었다. 시장지표 페이지는
    코드가 공개된 주소에 그대로 들어 있어서 짐작이 아니다."""

    def test_콜금리와_회사채_후보가_들어_있다(self):
        이름들 = [이름 for 이름, _ in M._시장지표_금리]
        assert "콜금리(1일)" in 이름들
        assert "회사채 AA- 3년" in 이름들

    def _응답(self, 본문: str):
        class _R:
            status_code = 200
            text = 본문
        return _R()

    def test_표에서_최근_값과_전일_대비를_읽는다(self, monkeypatch):
        M.금리쉼표.잊기()
        본문 = ("<table><tr><td>2026.08.24</td><td> 3.115 </td></tr>"
                "<tr><td>2026.08.23</td><td> 3.095 </td></tr></table>")
        monkeypatch.setattr(M.httpx, "get", lambda *a, **k: self._응답(본문))
        결과 = M._fetch_kr_rates_시장지표()
        assert 결과, "아무것도 못 읽었다"
        첫줄 = 결과[0]
        assert 첫줄["value"] == 3.115
        assert 첫줄["change"] == pytest.approx(0.02, abs=0.001)

    def test_금리_범위를_벗어난_숫자는_버린다(self, monkeypatch):
        """표 구조가 바뀌면 엉뚱한 숫자가 첫 번째로 걸릴 수 있다.
        틀린 금리를 보여 주느니 안 보여 주는 게 낫다."""
        M.금리쉼표.잊기()
        본문 = "<table><tr><td> 1234.56 </td><td> 99.99 </td></tr></table>"
        monkeypatch.setattr(M.httpx, "get", lambda *a, **k: self._응답(본문))
        assert M._fetch_kr_rates_시장지표() == []

    def test_안_되는_코드는_그만_묻는다(self, monkeypatch):
        M.금리쉼표.잊기()
        센것 = {"n": 0}

        class _R:
            status_code = 404
            text = ""

        def _가짜(*a, **k):
            센것["n"] += 1
            return _R()

        monkeypatch.setattr(M.httpx, "get", _가짜)
        for _ in range(M.금리쉼표.쉼_기준 + 1):
            M._fetch_kr_rates_시장지표()
        센것["n"] = 0
        M._fetch_kr_rates_시장지표()
        assert 센것["n"] <= M.금리쉼표.되살림_칸, \
            f"쉬어야 하는데 {센것['n']}번 물었다"
        M.금리쉼표.잊기()


class Test국고채가_하나만_와도_나머지를_찾는가:
    """관리자 화면 실측에서 드러났다.

    네이버 시장지표가 콜금리·CD·국고채 3년·회사채 AA- 넉 줄을 줬다.
    그런데 국고채 3년 하나로 bonds 가 채워지자 조건이 `if not bonds` 라
    yfinance 도 pykrx 도 "건너뜀(이미 있음)" 이 됐다. 5년·10년이 들어올
    자리가 없어진 것이다 — 실제로 화면에 3년만 떴다.

    오늘 회사채에서 고친 것과 같은 종류다. '몇 개 있느냐' 가 아니라
    '무엇이 빠졌느냐' 를 물어야 한다."""

    def _삼년만(self):
        return ([{"name": "국고채 3년", "value": 3.185, "change": 0.0,
                  "change_rate": 0.0, "unit": "%", "is_rate": True}], None)

    def test_빠진_국고채를_찾아낸다(self):
        삼년만 = [{"name": "국고채 3년"}]
        assert M._빠진_국고채(삼년만) == ["국고채 5년", "국고채 10년"]
        assert M._빠진_국고채([]) == ["국고채 3년", "국고채 5년", "국고채 10년"]
        assert M._빠진_국고채(
            [{"name": n} for n in ("국고채 3년", "국고채 5년", "국고채 10년")]) == []

    def test_채울_때_먼저_온_것을_안_덮는다(self):
        """앞 원천이 더 믿을 만하다(네이버 시장지표 > yfinance).
        그리고 같은 이름이 두 줄 뜨는 것을 막는다."""
        결과 = M._국고채_채우기(
            [{"name": "국고채 3년", "value": 3.185}],
            [{"name": "국고채 3년", "value": 9.99}, {"name": "국고채 5년", "value": 3.3}])
        삼년 = [x for x in 결과 if x["name"] == "국고채 3년"]
        assert len(삼년) == 1 and 삼년[0]["value"] == 3.185
        assert any(x["name"] == "국고채 5년" for x in 결과)

    def test_채운_뒤_3_5_10년_차례로_놓인다(self):
        """한 묶음으로 읽는 값이라 사이가 뒤바뀌면 눈이 걸린다."""
        결과 = M._국고채_채우기(
            [{"name": "국고채 3년"}],
            [{"name": "국고채 10년"}, {"name": "국고채 5년"}])
        assert [x["name"] for x in 결과] == ["국고채 3년", "국고채 5년", "국고채 10년"]

    def test_삼년만_와도_KRX_표를_읽어_5년_10년을_채운다(self, monkeypatch, KRX표):
        """스크린샷에 찍힌 그 상황이다."""
        KRX표()
        monkeypatch.setattr(M, "_fetch_kr_rates_naver", lambda: ([], None))
        monkeypatch.setattr(M, "_fetch_kr_rates_시장지표",
                            lambda: [{"name": "국고채 3년", "value": 3.185, "change": 0.0,
                                      "change_rate": 0.0, "unit": "%", "is_rate": True}])
        monkeypatch.setattr(M, "_fetch_bok_rates_ecos", lambda: (None, []))
        monkeypatch.setattr(M, "_fetch_bok_그밖_ecos", lambda: [])
        cache.delete("extra:kr_rates")

        이름들 = [r["name"] for r in M._do_fetch_kr_rates()]
        for n in ("국고채 3년", "국고채 5년", "국고채 10년"):
            assert n in 이름들, f"{n} 이 안 들어왔다 — 3년만 받고 나머지를 건너뛴 것"

    def test_회사채_AA만_와도_BBB를_채운다(self, monkeypatch, KRX표):
        """시장지표는 AA- 만 준다. BBB- 는 KRX 표에만 있다."""
        KRX표()
        monkeypatch.setattr(M, "_fetch_kr_rates_naver", lambda: ([], None))
        monkeypatch.setattr(M, "_fetch_kr_rates_시장지표",
                            lambda: [{"name": "회사채 AA- 3년", "value": 3.5, "change": 0.0,
                                      "change_rate": 0.0, "unit": "%", "is_rate": True}])
        monkeypatch.setattr(M, "_fetch_bok_rates_ecos", lambda: (None, []))
        monkeypatch.setattr(M, "_fetch_bok_그밖_ecos", lambda: [])
        cache.delete("extra:kr_rates")

        이름들 = [r["name"] for r in M._do_fetch_kr_rates()]
        assert "회사채 AA- 3년" in 이름들
        assert "회사채 BBB- 3년" in 이름들

    def test_셋_다_있으면_더_안_부른다(self, monkeypatch):
        """다 있는데 또 부르면 0.15 CPU 서버에 헛일만 얹는다."""
        불렸나 = {"yf": False, "krx": False}

        def _yf():
            불렸나["yf"] = True
            return []

        def _krx():
            불렸나["krx"] = True
            return ([], None, [])

        국고채 = [{"name": f"국고채 {n}년", "value": 3.0, "change": 0.0,
                   "change_rate": 0.0, "unit": "%", "is_rate": True}
                  for n in (3, 5, 10)]
        회사채 = [{"name": f"회사채 {g} 3년", "value": 3.5, "change": 0.0,
                   "change_rate": 0.0, "unit": "%", "is_rate": True}
                  for g in ("AA-", "BBB-")]
        monkeypatch.setattr(M, "_fetch_kr_rates_naver", lambda: (국고채, None))
        monkeypatch.setattr(M, "_fetch_kr_rates_시장지표", lambda: 회사채)
        monkeypatch.setattr(M, "_fetch_bok_rates_ecos", lambda: (None, []))
        monkeypatch.setattr(M, "_fetch_kr_bonds_yf", _yf)
        monkeypatch.setattr(M, "_fetch_kr_bonds_pykrx", _krx)
        monkeypatch.setattr(M, "_fetch_bok_그밖_ecos", lambda: [])
        cache.delete("extra:kr_rates")

        M._do_fetch_kr_rates()
        assert not 불렸나["yf"] and not 불렸나["krx"]


class Test이미_나가는_금리를_못받았다고_하지_않는가:
    """관리자 화면이 스스로 모순되는 말을 했다.

    위 칸에는 '콜금리(1일)·회사채 AA- 3년' 이 나가는 것으로 떠 있는데,
    아래 '아직 못 받은 금리' 에도 같은 이름이 있었다.

    원인 — 콜금리는 네이버 모바일 API 후보(CALL·CALLRATE…)가 전부 쉬고
    있지만 시장지표(HTML) 경로에서는 멀쩡히 받아 온다. 후보만 보면
    '못 받았다' 가 되고, 결과를 보면 '받았다' 가 된다."""

    def test_나가는_금리는_못받은_목록에서_빠진다(self, monkeypatch):
        from app.api.routes import admin
        # 콜금리 후보를 전부 쉬게 만든다 (모바일 API 는 실제로 죽어 있다)
        M.금리쉼표.잊기()
        for _, _, 코드들 in M._네이버_금리후보:
            for c in 코드들:
                for _ in range(M.금리쉼표.쉼_기준):
                    M.금리쉼표.기록(f"rate:{c}", True)

        지금값 = [{"name": "콜금리(1일)"}, {"name": "회사채 AA- 3년"}]
        못받은것 = admin._쉬는금리(지금값)
        M.금리쉼표.잊기()

        assert "콜금리(1일)" not in 못받은것
        assert "회사채 AA- 3년" not in 못받은것

    def test_정말_못_받은_것은_그대로_남는다(self, monkeypatch):
        """빼는 데만 급해서 다 지워 버리면 화면이 쓸모없어진다."""
        from app.api.routes import admin
        M.금리쉼표.잊기()
        for _, _, 코드들 in M._네이버_금리후보:
            for c in 코드들:
                for _ in range(M.금리쉼표.쉼_기준):
                    M.금리쉼표.기록(f"rate:{c}", True)

        못받은것 = admin._쉬는금리([{"name": "콜금리(1일)"}])
        M.금리쉼표.잊기()
        assert 못받은것, "쉬는 후보가 있는데 목록이 통째로 비었다"
        assert "코픽스" in 못받은것
