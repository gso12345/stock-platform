"""
라이브러리별 메모리 계측.

관리자 화면의 메모리 항목이 오랫동안 '캐시 8MB / 나머지 411MB' 두 줄이었다.
나머지가 무엇인지 모르면 512MB 한도에 걸렸을 때 무엇을 줄일지 판단할 수 없다.

여기서 못 박아 두는 것은 두 가지다.
  1) 숫자가 하드코딩이 아니라 실제 측정값일 것
  2) 계측이 잘못돼도 import 자체는 절대 깨지지 않을 것 —
     계측은 부가 기능이고, 앱이 안 뜨는 것과 바꿀 수 없다
"""
import ast
import builtins
import inspect
import sys
import types

import pytest

from app.core import libmem, memory


class Test계측_동작:
    @pytest.fixture(autouse=True)
    def _격리(self):
        """계측기를 잠시 떼어 놓고 함수만 직접 부른다.

        `_tracking_import` 는 지금 실제 `builtins.__import__` 로 꽂혀 있다.
        떼지 않은 채 `_real_import` 를 가짜로 바꾸면 테스트가 도는 동안
        파이썬의 모든 import 가 그 가짜로 흘러가 pytest 자체가 무너진다."""
        원래측정 = dict(libmem._measured)
        진짜import = libmem._real_import or builtins.__import__
        꽂혀있던것 = builtins.__import__
        builtins.__import__ = 진짜import
        libmem.reset()
        try:
            yield
        finally:
            builtins.__import__ = 꽂혀있던것
            libmem.reset()
            libmem._measured.update(원래측정)

    def test_이미_로드된_것은_다시_세지_않는다(self, monkeypatch):
        # 같은 모듈을 두 번 세면 그만큼 합계가 부풀려진다
        assert "json" in sys.modules
        monkeypatch.setattr(
            libmem, "rss_bytes",
            lambda: (_ for _ in ()).throw(AssertionError("이미 로드된 것을 재고 있다")),
        )
        monkeypatch.setattr(libmem, "_real_import", lambda n, *a, **k: sys.modules[n])
        libmem._tracking_import("json")
        assert "json" not in libmem._measured

    def test_자식이_쓴_만큼은_부모에서_뺀다(self, monkeypatch):
        """pandas 가 numpy 를 끌어와도 numpy 는 numpy 줄에서만 세어야 한다.
        안 그러면 항목을 더한 값이 실제 사용량의 두 배가 된다."""
        # RSS 를 재는 순서: 부모 시작 → 자식 시작 → 자식 끝 → 부모 끝
        눈금 = iter([0, 10, 30, 50])

        def 가짜rss():
            return next(눈금) * 1024 * 1024

        def 가짜import(name, *a, **k):
            if name == "부모라이브러리":
                libmem._tracking_import("자식라이브러리")
            return types.ModuleType(name)

        monkeypatch.setattr(libmem, "rss_bytes", 가짜rss)
        monkeypatch.setattr(libmem, "_real_import", 가짜import)
        libmem._tracking_import("부모라이브러리")

        부모 = libmem._measured["부모라이브러리"]
        자식 = libmem._measured["자식라이브러리"]
        assert 자식["self"] == 20 * 1024 * 1024
        assert 부모["total"] == 50 * 1024 * 1024
        assert 부모["self"] == 30 * 1024 * 1024, \
            "자식이 쓴 20MB를 부모에서 빼지 않으면 합계가 두 배로 부풀려진다"

    def test_모든_항목의_self를_더하면_measured_mb가_된다(self, monkeypatch):
        libmem._measured.update({
            "가": {"total": 30 * libmem.MB, "self": 10 * libmem.MB},
            "나": {"total": 20 * libmem.MB, "self": 20 * libmem.MB},
        })
        r = libmem.report(min_bytes=0)
        assert r["measured_mb"] == 30.0
        assert sum(i["mb"] for i in r["items"]) == pytest.approx(30.0, abs=0.2)

    def test_계측_실패가_import를_깨뜨리지_않는다(self, monkeypatch):
        # RSS 를 못 읽는 순간이 와도 모듈은 정상적으로 돌아와야 한다
        상태 = {"n": 0}

        def 불안정한rss():
            상태["n"] += 1
            if 상태["n"] > 1:
                raise OSError("사라짐")
            return 100

        monkeypatch.setattr(libmem, "rss_bytes", 불안정한rss)
        monkeypatch.setattr(libmem, "_real_import", lambda n, *a, **k: types.ModuleType(n))
        결과 = libmem._tracking_import("깨지는라이브러리")
        assert isinstance(결과, types.ModuleType)

    def test_import가_실패해도_그대로_전달한다(self, monkeypatch):
        # 계측이 예외를 삼키면 없는 모듈을 있는 것처럼 만들어 버린다
        def 실패(*a, **k):
            raise ModuleNotFoundError("없는라이브러리")

        monkeypatch.setattr(libmem, "rss_bytes", lambda: 0)
        monkeypatch.setattr(libmem, "_real_import", 실패)
        with pytest.raises(ModuleNotFoundError):
            libmem._tracking_import("없는라이브러리")

    def test_상대import는_건드리지_않는다(self, monkeypatch):
        # level>0 은 패키지 내부 import 라 최상위 이름이 의미가 없다
        monkeypatch.setattr(libmem, "rss_bytes", lambda: (_ for _ in ()).throw(AssertionError("재면 안 된다")))
        monkeypatch.setattr(libmem, "_real_import", lambda n, *a, **k: types.ModuleType(n or "x"))
        libmem._tracking_import("형제모듈", None, None, (), 1)
        assert libmem._measured == {}

    def test_측정할_수_없는_환경에서는_설치하지_않는다(self, monkeypatch):
        # 맥·윈도우에는 /proc 이 없다. 여기서 앱이 안 뜨면 개발이 막힌다
        monkeypatch.setattr(libmem, "_installed", False)
        monkeypatch.setattr(libmem, "rss_bytes", lambda: None)
        원래 = builtins.__import__
        assert libmem.install() is False
        assert builtins.__import__ is 원래


class Test실제_측정값:
    """하드코딩된 표가 아니라 이 서버에서 실제로 잰 값이어야 한다."""

    def test_무거운_라이브러리가_실제로_잡힌다(self):
        # 앱을 띄우면 pandas 는 반드시 로드된다
        import app.main  # noqa: F401
        assert "pandas" in libmem._measured, \
            "계측이 앱 import 보다 늦게 켜지면 무거운 라이브러리를 하나도 못 잡는다"
        assert libmem._measured["pandas"]["self"] > 5 * libmem.MB

    def test_앱_패키지가_로드되는_순간_켜진다(self):
        # app/__init__.py 가 가장 이른 시점이다. main.py 에서 켜면 이미 늦다.
        # 주석이나 import 문만으로 통과하지 않도록 '호출'을 직접 확인한다
        import app
        tree = ast.parse(inspect.getsource(app))
        가져온이름 = {
            (a.asname or a.name)
            for n in ast.walk(tree) if isinstance(n, ast.ImportFrom) and "libmem" in (n.module or "")
            for a in n.names
        }
        불린것 = {n.func.id for n in ast.walk(tree)
                if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)}
        assert 가져온이름 & 불린것, "app/__init__.py 가 libmem 설치 함수를 실제로 호출하지 않는다"

    def test_보고에_필요한_항목이_다_있다(self):
        import app.main  # noqa: F401
        r = libmem.report()
        for 키 in ("tracked", "items", "measured_mb", "other_count",
                   "other_mb", "baseline_mb", "preloaded", "modules"):
            assert 키 in r

    def test_측정_합계가_실제_사용량을_넘지_않는다(self):
        import app.main  # noqa: F401
        r = libmem.report()
        rss = memory.rss_mb()
        if rss is None:
            pytest.skip("이 환경에서는 RSS 를 읽을 수 없다")
        assert r["measured_mb"] <= rss, \
            f"라이브러리 합계 {r['measured_mb']}MB 가 전체 {rss:.0f}MB 보다 크다 — 중복 계산"

    def test_큰_것부터_보여준다(self):
        import app.main  # noqa: F401
        mbs = [i["mb"] for i in libmem.report()["items"]]
        assert mbs == sorted(mbs, reverse=True)

    def test_용도를_함께_보여준다(self):
        # 크기만 있으면 '줄여도 되는 것'과 '없으면 안 뜨는 것'을 구분할 수 없다
        import app.main  # noqa: F401
        items = {i["name"]: i for i in libmem.report(limit=50)["items"]}
        붙은것 = [n for n in items if items[n]["purpose"]]
        assert len(붙은것) >= 5, f"용도가 적힌 항목이 {len(붙은것)}개뿐이다"
        assert libmem.PURPOSE["pandas"]


class Test상주_데이터:
    def test_무슨_데이터가_몇_건_있는지_보여준다(self):
        rows = {r["name"]: r for r in memory.data_stores()}
        assert "국내 종목 DB" in rows and "응답 캐시" in rows
        for r in rows.values():
            assert r["what"], f"{r['name']} 에 '무슨 데이터인지' 설명이 없다"
            assert r["items"] >= 0 and r["mb"] >= 0
            assert isinstance(r["movable"], bool)

    def test_실제_건수를_읽는다(self):
        # 고정값을 돌려주면 종목 DB 가 비어도 화면은 정상으로 보인다
        from app.services import ticker_service as ts
        원래 = ts._kr_db
        try:
            ts._kr_db = [{"s": f"{i:06d}.KS", "n": "테스트", "x": "KOSPI", "m": "KR", "c": f"{i:06d}"}
                         for i in range(1234)]
            rows = {r["name"]: r for r in memory.data_stores()}
            assert rows["국내 종목 DB"]["items"] == 1234
            assert rows["국내 종목 DB"]["bytes"] > 0
        finally:
            ts._kr_db = 원래

    def test_큰_것부터_보여준다(self):
        b = [r["bytes"] for r in memory.data_stores()]
        assert b == sorted(b, reverse=True)

    def test_종목_DB가_비어도_터지지_않는다(self):
        from app.services import ticker_service as ts
        원래 = ts._kr_db
        try:
            ts._kr_db = []
            assert any(r["name"] == "국내 종목 DB" for r in memory.data_stores())
        finally:
            ts._kr_db = 원래


class Test관리자_화면_연결:
    def test_runtime이_라이브러리와_데이터를_함께_준다(self):
        from app.api.routes.admin import get_runtime
        상태 = get_runtime(_=None)
        assert "libraries" in 상태 and "data_stores" in 상태
        assert 상태["libraries"]["measured_mb"] >= 0
        assert len(상태["data_stores"]) > 0

    def test_고정값이_아니라_계측_모듈을_읽는다(self):
        from app.api.routes.admin import get_runtime
        tree = ast.parse(inspect.getsource(get_runtime))
        호출 = {
            f"{n.func.value.id}.{n.func.attr}"
            for n in ast.walk(tree)
            if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
            and isinstance(n.func.value, ast.Name)
        }
        assert "libmem.report" in 호출
        assert "memory.data_stores" in 호출
