"""
국내 종목 목록 — 프로덕션이 115개로 돌고 있었던 문제.

일어난 일을 순서대로 적으면 이렇다.
  1) 1순위 FinanceDataReader 가 requirements.txt 에 없어서 서버에는 아예
     설치가 안 됐다. import 하는 순간 ModuleNotFoundError.
  2) 그게 `except Exception: log.debug(...)` 로 삼켜졌다. 로그에도 안 남았다.
  3) 2순위 pykrx 로 넘어갔는데, pykrx/__init__.py 가 한글 폰트를 지정하려고
     matplotlib 을 import 한다. 그것만으로 약 120MB 가 올라왔다.
  4) 그 pykrx 도 실패했다. 결국 코드에 적어둔 115개로 서비스했다.
     그 목록에 없는 종목은 검색도 시세 조회도 되지 않았다.
  5) 화면에는 그냥 '종목 목록'으로 똑같이 보였다. 관리자 화면에 건수가
     찍히기 전까지 아무도 몰랐다.

그래서 여기서 못 박는 것은 네 가지다.
  · matplotlib 없이 pykrx 를 쓸 수 있어야 한다
  · 폴백 실패가 조용히 지나가지 않아야 한다
  · 목록은 DB 에 남아, 재시작 때 외부 호출 없이 복구되어야 한다
  · 축소 동작 중이라는 사실이 관리자 화면에 드러나야 한다
"""
import ast
import inspect
import logging
import sys

import pytest

from app.core import pykrx_light
from app.services import ticker_service as ts


def _새프로세스에서(본문: str) -> str:
    """깨끗한 파이썬에서 코드를 돌리고 표준출력을 돌려준다"""
    import subprocess
    r = subprocess.run(
        [sys.executable, "-c", "import sys\n" + 본문],
        capture_output=True, text=True, timeout=180,
    )
    assert r.returncode == 0, f"자식 프로세스 실패:\n{r.stderr[-1500:]}"
    return r.stdout


def _pykrx_적재비용(차단: bool) -> float:
    """pykrx import 로 늘어나는 메모리(MB). pandas 등 어차피 쓰는 것은 미리 올려둔다."""
    본문 = f"""
def rss():
    with open("/proc/self/statm") as f: return int(f.read().split()[1]) * 4096 / 1024 / 1024
import pandas, numpy          # 우리가 어차피 쓰는 것 — 기준선에서 제외
if {차단}:
    from app.core import pykrx_light
    b = rss(); pykrx_light.stock(); a = rss()
else:
    b = rss()
    from pykrx import stock
    a = rss()
print(f"{{a-b:.2f}}")
"""
    return float(_새프로세스에서(본문).strip().splitlines()[-1])


class Testmatplotlib_차단:
    def test_대체모듈이_pykrx가_쓰는_것을_모두_갖췄다(self):
        # pykrx/__init__.py 는 plt.rc, plt.rcParams, fm.FontEntry,
        # fm.fontManager.ttflist 를 쓴다. 하나라도 없으면 import 가 터진다
        assert pykrx_light._install_stub() in (True, False)
        plt = sys.modules.get("matplotlib.pyplot")
        fm = sys.modules.get("matplotlib.font_manager")
        if not pykrx_light.stubbed():
            pytest.skip("이 프로세스에는 이미 진짜 matplotlib 이 올라와 있다")
        plt.rc("font", family="NanumBarunGothic")      # 터지지 않아야 한다
        plt.rcParams["axes.unicode_minus"] = False
        fe = fm.FontEntry(fname="/x/y.ttf", name="NanumBarunGothic")
        fm.fontManager.ttflist.insert(0, fe)
        assert fe.name == "NanumBarunGothic"

    def test_pykrx를_불러도_matplotlib이_안_올라온다(self):
        """새 프로세스에서 확인한다.

        같은 프로세스에서 재면 앞선 테스트가 이미 대체 모듈을 꽂아 둔 상태라,
        `stock()` 이 차단을 건너뛰도록 망가뜨려도 통과한다. 실제로 그 돌연변이를
        놓쳤다. 서버는 늘 깨끗한 프로세스로 시작하므로 그 조건에서 봐야 한다."""
        out = _새프로세스에서("""
from app.core import pykrx_light
stock = pykrx_light.stock()
assert callable(stock.get_market_ticker_list)
진짜 = [m for m in sys.modules
        if m.startswith("matplotlib") and getattr(sys.modules[m], "__file__", None)]
print("matplotlib:", 진짜)
print("딸린것:", [m for m in ("PIL", "pyparsing", "fontTools") if m in sys.modules])
""")
        assert "matplotlib: []" in out, f"진짜 matplotlib 이 올라왔다\n{out}"
        assert "딸린것: []" in out, f"matplotlib 차단이 새고 있다\n{out}"

    def test_차단하면_메모리가_실제로_덜_든다(self):
        # '안 올라온다'만 보면 숫자가 없다. 실제 절감폭을 재서 못 박아 둔다
        그대로 = _pykrx_적재비용(차단=False)
        차단 = _pykrx_적재비용(차단=True)
        assert 차단 < 그대로 / 2, \
            f"차단해도 절반 이하로 안 줄었다 (그대로 {그대로:.1f}MB → 차단 {차단:.1f}MB)"

    def test_진짜가_이미_있으면_덮지_않는다(self, monkeypatch):
        # 누군가 실제로 matplotlib 을 쓰고 있는데 가짜로 덮으면 그쪽이 깨진다
        monkeypatch.setattr(pykrx_light, "_stub_installed", False)
        monkeypatch.setitem(sys.modules, "matplotlib", object())
        assert pykrx_light._install_stub() is False

    def test_bond도_같은_경로로_불러온다(self):
        bond = pykrx_light.bond()
        assert callable(bond.get_otc_treasury_yields)

    def test_어디서도_pykrx를_직접_import하지_않는다(self):
        # 한 곳만 놓쳐도 그 경로가 실행되는 순간 120MB 가 올라온다
        import subprocess
        r = subprocess.run(
            ["grep", "-rn", "--include=*.py", "-E", r"^\s*(from pykrx import|import pykrx)", "app/"],
            capture_output=True, text=True,
        )
        새는곳 = [
            ln for ln in r.stdout.splitlines()
            if ln.strip() and "app/core/pykrx_light.py" not in ln
        ]
        assert not 새는곳, "pykrx 를 직접 import 하는 곳:\n" + "\n".join(새는곳)


class Test조용한_실패_방지:
    """`except Exception: log.debug(...)` 가 이 사고의 절반이었다."""

    def test_FDR_미설치를_경고로_남긴다(self, monkeypatch, caplog):
        real = __import__

        def 없는척(name, *a, **k):
            if name == "FinanceDataReader":
                raise ModuleNotFoundError("No module named 'FinanceDataReader'")
            return real(name, *a, **k)

        monkeypatch.setattr("builtins.__import__", 없는척)
        with caplog.at_level(logging.WARNING):
            assert ts._load_kr_from_fdr() is False
        assert any("FinanceDataReader" in r.message for r in caplog.records), \
            "설치가 안 된 것을 로그로 알 수 없으면 이 사고가 또 난다"

    def test_내장_폴백으로_떨어지면_error로_남긴다(self, monkeypatch, caplog):
        monkeypatch.setattr(ts, "_load_kr_from_db", lambda: False)
        monkeypatch.setattr(ts, "_load_kr_from_fdr", lambda: False)
        monkeypatch.setattr(ts, "_save_kr_to_db", lambda *a: True)
        monkeypatch.setattr(pykrx_light, "stock", lambda: (_ for _ in ()).throw(RuntimeError("망함")))
        with caplog.at_level(logging.WARNING):
            ts._load_kr_from_pykrx()
        errors = [r for r in caplog.records if r.levelno >= logging.ERROR]
        assert errors, "115개로 축소 동작하는 것은 ERROR 여야 한다"
        assert "검색" in errors[-1].message, "무엇이 안 되는지까지 적어야 한다"

    def test_수집_이력에도_실패로_기록된다(self, monkeypatch):
        from app.core import health
        health.reset()
        monkeypatch.setattr(ts, "_load_kr_from_db", lambda: False)
        monkeypatch.setattr(ts, "_load_kr_from_fdr", lambda: False)
        monkeypatch.setattr(ts, "_save_kr_to_db", lambda *a: True)
        monkeypatch.setattr(pykrx_light, "stock", lambda: (_ for _ in ()).throw(RuntimeError("x")))
        ts._load_kr_from_pykrx()
        기록 = {h["name"]: h for h in health.snapshot()}
        assert "종목목록" in 기록 and 기록["종목목록"]["fail"] >= 1
        health.reset()


class Test상태_노출:
    def test_출처와_건수를_보고한다(self):
        st = ts.kr_status()
        for 키 in ("source", "count", "degraded", "builtin_count", "prices", "age_sec", "ttl_sec"):
            assert 키 in st

    def test_내장_목록으로_돌면_축소로_표시한다(self, monkeypatch):
        monkeypatch.setattr(ts, "_kr_db", ts.KR_TICKERS_BUILTIN.copy())
        monkeypatch.setattr(ts, "_kr_source", "내장")
        assert ts.kr_status()["degraded"] is True

    def test_정상_목록이면_축소가_아니다(self, monkeypatch):
        많음 = [{"s": f"{i:06d}.KS", "n": f"종목{i}", "x": "KOSPI", "m": "KR", "c": f"{i:06d}"}
                for i in range(2800)]
        monkeypatch.setattr(ts, "_kr_db", 많음)
        monkeypatch.setattr(ts, "_kr_source", "DB")
        st = ts.kr_status()
        assert st["degraded"] is False and st["count"] == 2800

    def test_건수가_내장과_같으면_출처가_뭐라_적혀도_축소로_본다(self, monkeypatch):
        # 실제 사고 때 화면에 '국내 종목 DB 115건'과 '내장 목록 115건'이
        # 나란히 떠 있었다. 출처 문자열만 믿으면 이걸 놓친다
        monkeypatch.setattr(ts, "_kr_db", ts.KR_TICKERS_BUILTIN.copy())
        monkeypatch.setattr(ts, "_kr_source", "FinanceDataReader")
        assert ts.kr_status()["degraded"] is True

    def test_관리자_화면이_이_값을_받는다(self):
        from app.api.routes.admin import get_runtime
        상태 = get_runtime(_=None)
        assert "kr_tickers" in 상태
        assert 상태["kr_tickers"]["builtin_count"] == len(ts.KR_TICKERS_BUILTIN)

    def test_상주_데이터_설명에_출처가_들어간다(self, monkeypatch):
        from app.core import memory
        monkeypatch.setattr(ts, "_kr_source", "DB")
        monkeypatch.setattr(ts, "_kr_db", [{"s": "005930.KS", "n": "삼성전자", "x": "KOSPI",
                                            "m": "KR", "c": "005930"}] * 2800)
        설명 = {r["name"]: r["what"] for r in memory.data_stores()}["국내 종목 DB"]
        assert "DB" in 설명


@pytest.fixture
def 빈테이블():
    """kr_tickers 테이블을 만들고 비운 뒤 넘긴다.

    테이블 생성은 app.main 이 import 될 때 일어난다. 이 테스트는 라우터를
    안 쓰므로 여기서 직접 만들어야 한다 — 실제 서버에서 테이블이 안 만들어지는
    상황은 아래 Test마이그레이션 에서 따로 확인한다."""
    from app.db.database import Base, SessionLocal, engine
    from app.models.stock import KrTicker
    KrTicker.__table__.create(bind=engine, checkfirst=True)
    with SessionLocal() as db:
        db.query(KrTicker).delete()
        db.commit()
    yield
    with SessionLocal() as db:
        db.query(KrTicker).delete()
        db.commit()


class Test마이그레이션:
    def test_빈_DB로_앱을_띄우면_테이블이_생긴다(self, tmp_path):
        """반드시 새 DB 로 확인한다.

        기존 DB 파일에는 앞선 테스트가 만든 테이블이 남아 있어서, main.py 가
        모델을 import 하지 않아도 통과한다. 실제로 그 돌연변이를 놓쳤다.
        배포 대상은 이미 27개 테이블이 있는 DB지만, 새 테이블이 추가되는
        상황은 '없던 것이 생기는가'로만 확인할 수 있다."""
        import os
        import subprocess

        env = {**os.environ, "DATABASE_URL": f"sqlite:///{tmp_path}/새DB.sqlite"}
        r = subprocess.run(
            [sys.executable, "-c",
             "import app.main\n"                      # 여기서 create_all 이 돈다
             "from sqlalchemy import inspect\n"
             "from app.db.database import engine\n"
             "print(sorted(inspect(engine).get_table_names()))\n"],
            capture_output=True, text=True, env=env, timeout=180,
        )
        assert r.returncode == 0, r.stderr[-1500:]
        # 부분 문자열로 보면 'kr_tickers_오타' 같은 이름도 통과한다.
        # 목록을 그대로 받아 정확히 비교한다
        생긴것 = set(ast.literal_eval(r.stdout.strip().splitlines()[-1]))
        assert "kr_tickers" in 생긴것, (
            f"새 DB 에 kr_tickers 가 안 생겼다. 생긴 테이블: {sorted(생긴것)}"
        )


class TestDB_저장:
    def test_DB에_쓰고_다시_읽으면_같은_목록이_나온다(self, 빈테이블):
        from app.db.database import SessionLocal
        from app.models.stock import KrTicker

        rows = [{"s": f"{i:06d}.KS", "n": f"테스트{i}", "x": "KOSPI", "m": "KR", "c": f"{i:06d}"}
                for i in range(1, 51)]
        prices = {"000001.KS": {"symbol": "000001.KS", "name": "테스트1", "price": 1234.0,
                                "change": 10.0, "change_rate": 0.8, "volume": 100,
                                "market_cap": 999, "currency": "KRW",
                                "high": 1300.0, "low": 1200.0, "open": 1250.0}}
        try:
            assert ts._save_kr_to_db(rows, prices) is True
            원래목록, 원래시세 = ts._kr_db, ts._fdr_price_cache
            try:
                assert ts._load_kr_from_db() is True
                assert len(ts._kr_db) == 50
                assert ts._fdr_price_cache["000001.KS"]["price"] == 1234.0
                assert ts.kr_status()["source"] == "DB"
            finally:
                ts._kr_db, ts._fdr_price_cache = 원래목록, 원래시세
        finally:
            with SessionLocal() as db:
                db.query(KrTicker).delete()
                db.commit()

    def test_상장폐지된_종목은_지운다(self, 빈테이블):
        from app.db.database import SessionLocal
        from app.models.stock import KrTicker
        try:
            ts._save_kr_to_db([{"s": "A.KS", "n": "가", "x": "KOSPI", "m": "KR", "c": "000001"},
                               {"s": "B.KS", "n": "나", "x": "KOSPI", "m": "KR", "c": "000002"}], {})
            ts._save_kr_to_db([{"s": "A.KS", "n": "가", "x": "KOSPI", "m": "KR", "c": "000001"}], {})
            with SessionLocal() as db:
                assert {r.symbol for r in db.query(KrTicker).all()} == {"A.KS"}
        finally:
            with SessionLocal() as db:
                db.query(KrTicker).delete()
                db.commit()

    def test_DB가_비면_False를_돌려준다(self, 빈테이블):
        from app.db.database import SessionLocal
        from app.models.stock import KrTicker
        with SessionLocal() as db:
            db.query(KrTicker).delete()
            db.commit()
        assert ts._load_kr_from_db() is False

    def test_DB를_가장_먼저_본다(self, monkeypatch):
        """평소 재시작에서 FDR·pykrx 를 아예 부르지 않는 것이 핵심이다."""
        불린것 = []
        monkeypatch.setattr(ts, "_load_kr_from_db", lambda: (불린것.append("db"), True)[1])
        monkeypatch.setattr(ts, "_load_kr_from_fdr", lambda: (불린것.append("fdr"), True)[1])
        monkeypatch.setitem(ts.__dict__, "_db_rows_at", None)
        ts._load_kr_from_pykrx()
        assert 불린것[0] == "db"

    def test_DB가_신선하면_외부를_안_부른다(self, monkeypatch):
        from datetime import datetime, timedelta
        불린것 = []
        monkeypatch.setattr(ts, "_load_kr_from_db", lambda: (불린것.append("db"), True)[1])
        monkeypatch.setattr(ts, "_load_kr_from_fdr", lambda: (불린것.append("fdr"), True)[1])
        ts.__dict__["_db_rows_at"] = datetime.now() - timedelta(seconds=60)
        ts._load_kr_from_pykrx()
        assert 불린것 == ["db"], "신선한 DB 가 있는데 외부를 불렀다"

    def test_DB가_오래되면_갱신한다(self, monkeypatch):
        from datetime import datetime, timedelta
        불린것 = []
        monkeypatch.setattr(ts, "_load_kr_from_db", lambda: (불린것.append("db"), True)[1])
        monkeypatch.setattr(ts, "_load_kr_from_fdr", lambda: (불린것.append("fdr"), True)[1])
        monkeypatch.setattr(ts.memory, "has_headroom", lambda *a: True)
        ts.__dict__["_db_rows_at"] = datetime.now() - timedelta(seconds=ts.KR_TICKER_TTL_SEC + 60)
        ts._load_kr_from_pykrx()
        assert "fdr" in 불린것

    def test_메모리가_빡빡하면_갱신을_건너뛴다(self, monkeypatch):
        # 갱신하려고 FDR 을 올리다가 한도를 넘겨 재시작되면 더 손해다
        from datetime import datetime, timedelta
        불린것 = []
        monkeypatch.setattr(ts, "_load_kr_from_db", lambda: True)
        monkeypatch.setattr(ts, "_load_kr_from_fdr", lambda: (불린것.append("fdr"), True)[1])
        monkeypatch.setattr(ts.memory, "has_headroom", lambda *a: False)
        ts.__dict__["_db_rows_at"] = datetime.now() - timedelta(seconds=ts.KR_TICKER_TTL_SEC + 60)
        ts._load_kr_from_pykrx()
        assert 불린것 == []

    def test_받아온_목록을_DB에_저장한다(self):
        # 저장을 안 하면 다음 재시작에서 또 외부로 나가고, 또 실패할 수 있다
        for fn in (ts._load_kr_from_fdr, ts._load_kr_from_pykrx):
            tree = ast.parse(inspect.getsource(fn))
            호출 = {n.func.id for n in ast.walk(tree)
                   if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)}
            assert "_save_kr_to_db" in 호출, f"{fn.__name__} 가 결과를 DB에 저장하지 않는다"


class Test설치_목록:
    def test_FinanceDataReader가_requirements에_있다(self):
        # 이 한 줄이 빠져서 1순위가 프로덕션에서 항상 죽었다
        import pathlib
        req = pathlib.Path(__file__).resolve().parents[1] / "requirements.txt"
        내용 = req.read_text().lower()
        assert "finance-datareader" in 내용 or "financedatareader" in 내용

    def test_실제로_설치돼_있다(self):
        import importlib.util
        assert importlib.util.find_spec("FinanceDataReader") is not None, \
            "requirements 에만 있고 설치가 안 되면 프로덕션과 같은 상태다"
