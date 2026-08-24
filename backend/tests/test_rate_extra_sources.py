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
