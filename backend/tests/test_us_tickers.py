"""
미국 종목 목록을 실제로 쓰는 쪽 — "미국 모든 종목이 조회 가능하면 좋겠어"

목록을 받아오는 것(test_us_listing)과 그걸 쓰는 것은 다른 문제다. 받아오기가
잘 돼도

  · 목록이 커지면서 검색 결과가 엉뚱해지거나
  · 갱신 실패가 지난 목록을 날려버리거나
  · 512MB 짜리 서버에서 메모리를 감당 못 하면

고친 게 아니라 옮긴 것이다. 여기서 그 셋을 본다.
"""
import gc

import pytest

from app.services import ticker_service as ts


@pytest.fixture
def 큰목록(monkeypatch):
    """9천 개짜리 미국 목록을 끼워 넣는다 — 실제 규모와 같게.

    앞·뒤 어디에 넣는지가 중요하다. 등수를 안 매겨도 '목록에 담긴 순서'
    덕분에 우연히 맞는 경우가 있어서, 그걸 가리려면 경쟁 상대를 찾는
    종목보다 **앞에** 둬야 한다."""
    def _설치(뒤에=(), 앞에=()):
        rows = list(앞에) + list(ts.US_TICKERS)
        본것 = {r["s"] for r in rows}
        for r in 뒤에:
            if r["s"] not in 본것:
                rows.append(r)
                본것.add(r["s"])
        i = 0
        while len(rows) < 9000:
            s = f"ZZ{i:05d}"
            i += 1
            if s in 본것:
                continue
            rows.append({"s": s, "n": f"Filler {i} Corporation", "x": "NASDAQ", "m": "US"})
        monkeypatch.setattr(ts, "_us_db", rows)
        return rows
    return _설치


def _심볼(결과):
    return [r["symbol"] for r in 결과]


# ── 1. 목록이 커져도 원하는 게 위에 오는가 ────────────────────
class Test검색_순서:
    def test_심볼이_정확히_맞으면_맨_위다(self, 큰목록):
        """목록이 9천 개가 되면 'AB' 같은 짧은 입력에 수백 건이 걸린다.
        걸리는 대로 담으면 정작 심볼이 'AB' 인 종목이 밀려서 안 나온다.

        정답을 일부러 경쟁자들보다 **뒤에** 둔다. 앞에 두면 등수를 안
        매겨도 목록 순서 덕에 우연히 1등이 되어, 검사가 아무 힘이 없다."""
        큰목록(뒤에=[
            *[{"s": f"AB{i:03d}", "n": f"Ab Something {i}", "x": "NYSE", "m": "US"}
              for i in range(300)],
            {"s": "AB", "n": "AllianceBernstein Holding L.P.", "x": "NYSE", "m": "US"},
        ])
        assert _심볼(ts.search_stocks("AB", "US"))[0] == "AB"

    def test_한국어로_찾으면_그_종목이_맨_위다(self, 큰목록):
        """별칭을 우대하지 않으면 '애플' 은 그냥 어딘가 들어 있는 것과
        같은 취급이 되어, 이름이 '애플'로 시작하는 엉뚱한 회사에 밀린다."""
        큰목록(앞에=[{"s": "XAPL", "n": "애플비슷한이름의회사", "x": "NYSE", "m": "US"}])
        assert _심볼(ts.search_stocks("애플", "US"))[0] == "AAPL"

    def test_이름_앞부터_맞는_것이_어중간한_것보다_먼저다(self, 큰목록):
        큰목록(앞에=[{"s": "QQAA", "n": "Zeta Apple-adjacent Corp", "x": "NYSE", "m": "US"}])
        결과 = _심볼(ts.search_stocks("apple", "US"))
        assert 결과.index("AAPL") < 결과.index("QQAA")

    def test_뒤쪽에_있어도_정확히_맞으면_찾는다(self, 큰목록):
        """느슨한 매치 개수로 훑기를 끊으면, 목록 뒤에 있는 정답이 잘린다."""
        큰목록(뒤에=[{"s": "ZUMZ", "n": "Zumiez Inc.", "x": "NASDAQ", "m": "US"}])
        assert "ZUMZ" in _심볼(ts.search_stocks("ZUMZ", "US"))

    def test_ETF_필터가_ETF만_돌려준다(self, 큰목록):
        """주식과 ETF 가 같은 낱말로 걸리는 경우로 본다. 겹치지 않는
        낱말로 검사하면 필터를 없애도 통과한다."""
        큰목록(뒤에=[{"s": "GOLD", "n": "Barrick Gold Corporation", "x": "NYSE", "m": "US"},
                  {"s": "GLDM", "n": "SPDR Gold MiniShares", "x": "NYSE ARCA", "m": "ETF"}])
        결과 = ts.search_stocks("gold", "ETF")
        assert 결과 and all(r["market"] == "ETF" for r in 결과), _심볼(결과)
        assert "GLDM" in _심볼(결과) and "GOLD" not in _심볼(결과)

    def test_주식_필터에_ETF가_섞이지_않는다(self, 큰목록):
        큰목록(뒤에=[{"s": "GOLD", "n": "Barrick Gold Corporation", "x": "NYSE", "m": "US"},
                  {"s": "GLDM", "n": "SPDR Gold MiniShares", "x": "NYSE ARCA", "m": "ETF"}])
        결과 = ts.search_stocks("gold", "US")
        assert all(r["market"] != "ETF" for r in 결과), _심볼(결과)
        assert "GOLD" in _심볼(결과)

    def test_빈_입력에는_아무것도_안_돌려준다(self, 큰목록):
        큰목록()
        assert ts._us_등수매기기("", "", "ALL") == []

    def test_아무리_많이_걸려도_스무_개까지만(self, 큰목록):
        큰목록()
        assert len(ts.search_stocks("a", "US")) <= 20


# ── 2. 갱신이 실패해도 지난 목록이 남는가 ─────────────────────
class Test갱신_실패:
    def test_빈손으로_와도_지난_목록을_유지한다(self, monkeypatch):
        """받아오기가 실패했다고 128개로 떨어지면, 국내에서 겪은 일을
        그대로 반복하는 것이다."""
        전 = list(ts._us_db)
        monkeypatch.setattr("app.services.us_listing.fetch_listing",
                            lambda: ([], "접속 실패"))
        assert ts._refresh_us_outside() is False
        assert ts._us_db == 전, "받지도 못한 목록으로 기존 것을 덮었다"

    def test_터져도_지난_목록을_유지한다(self, monkeypatch, 큰목록):
        """이미 9천 개를 들고 있는 상태에서 봐야 한다. 내장 128개인
        상태로 검사하면, 목록을 통째로 비우는 사고가 '내장으로 복구된
        것'과 구분되지 않는다."""
        전 = list(큰목록())
        def 폭발():
            raise RuntimeError("무언가 실패")
        monkeypatch.setattr("app.services.us_listing.fetch_listing", 폭발)
        assert ts._refresh_us_outside() is False
        assert ts._us_db == 전, f"{len(전)}개였는데 {len(ts._us_db)}개로 줄었다"

    def test_실패를_건강_기록에_남긴다(self, monkeypatch):
        """조용히 실패하면 '왜 128개지' 를 또 몇 주 헤맨다."""
        기록 = []
        monkeypatch.setattr(ts.health, "record_fail",
                            lambda 이름, 사유=None, *a, **k: 기록.append((이름, 사유)))
        monkeypatch.setattr("app.services.us_listing.fetch_listing",
                            lambda: ([], "접속 실패"))
        ts._refresh_us_outside()
        assert 기록, "실패가 건강 기록에 안 남는다"


class Test내장_목록_유지:
    def test_새_목록을_받아도_내장_종목이_남는다(self, monkeypatch):
        """SPCX 처럼 NASDAQ Trader 에 없는 것이 있고, 한국어 별칭이 붙은
        주요 종목은 검색에서 먼저 걸려야 한다."""
        monkeypatch.setattr(ts, "_us_db", [])
        ts._apply_us([{"s": "NEWCO", "n": "New Co", "x": "NASDAQ", "m": "US"}], "테스트")
        심볼 = {r["s"] for r in ts._us_db}
        assert "AAPL" in 심볼 and "NEWCO" in 심볼

    def test_내장_종목이_앞에_온다(self, monkeypatch):
        monkeypatch.setattr(ts, "_us_db", [])
        ts._apply_us([{"s": "NEWCO", "n": "New Co", "x": "NASDAQ", "m": "US"}], "테스트")
        assert ts._us_db[0]["s"] == ts.US_TICKERS[0]["s"]

    def test_겹치는_종목을_두_번_담지_않는다(self, monkeypatch):
        monkeypatch.setattr(ts, "_us_db", [])
        ts._apply_us([{"s": "AAPL", "n": "Apple Inc. - Common Stock",
                       "x": "NASDAQ", "m": "US"}], "테스트")
        assert [r["s"] for r in ts._us_db].count("AAPL") == 1


# ── 3. 512MB 짜리 서버가 감당하는가 ───────────────────────────
class Test메모리:
    def test_구천_개를_들고_있어도_15MB_를_넘지_않는다(self):
        """Render 무료 플랜은 512MB 다. 검색 하나 좋자고 여기서 20MB 를
        쓰면, 방금 파서에서 확보한 여유를 도로 까먹는 셈이다."""
        def rss():
            with open("/proc/self/statm") as f:
                return int(f.read().split()[1]) * 4096 / 1e6

        gc.collect()
        시작 = rss()
        보관 = [{"s": f"SYM{i:05d}",
                "n": f"Some Company Number {i} Incorporated Common Stock",
                "x": "NASDAQ", "m": "US"} for i in range(9000)]
        늘어난것 = rss() - 시작
        assert len(보관) == 9000
        assert 늘어난것 < 15, f"9천 개에 {늘어난것:.1f}MB 를 썼다"
        del 보관
        gc.collect()


# ── 4. DB 를 실제로 오가는가 ─────────────────────────────────
@pytest.fixture
def 빈테이블():
    """us_tickers 테이블을 만들고 비운 뒤 넘긴다.

    테이블 생성은 app.main 이 import 될 때 일어난다. 이 테스트는 라우터를
    안 쓰므로 여기서 직접 만든다 — 실제 서버에서 테이블이 생기는지는
    아래 Test마이그레이션 에서 따로 확인한다."""
    from app.db.database import SessionLocal, engine
    from app.models.stock import UsTicker
    UsTicker.__table__.create(bind=engine, checkfirst=True)
    with SessionLocal() as db:
        db.query(UsTicker).delete()
        db.commit()
    yield
    with SessionLocal() as db:
        db.query(UsTicker).delete()
        db.commit()


class TestDB_저장:
    def test_쓰고_다시_읽으면_같은_목록이_나온다(self, 빈테이블, monkeypatch):
        rows = [{"s": f"SYM{i:04d}", "n": f"Test Company {i}",
                 "x": "NASDAQ", "m": "ETF" if i % 3 == 0 else "US"} for i in range(50)]
        assert ts._save_us_to_db(rows) is True

        monkeypatch.setattr(ts, "_us_db", [])
        assert ts._load_us_from_db() is True
        담긴것 = {r["s"]: r for r in ts._us_db}
        assert 담긴것["SYM0000"]["m"] == "ETF" and 담긴것["SYM0001"]["m"] == "US"
        assert 담긴것["SYM0007"]["n"] == "Test Company 7"
        assert ts.us_status()["db_rows"] == 50

    def test_상장폐지된_종목은_지운다(self, 빈테이블):
        from app.db.database import SessionLocal
        from app.models.stock import UsTicker
        ts._save_us_to_db([{"s": "AAA", "n": "가", "x": "NYSE", "m": "US"},
                           {"s": "BBB", "n": "나", "x": "NYSE", "m": "US"}])
        ts._save_us_to_db([{"s": "AAA", "n": "가", "x": "NYSE", "m": "US"}])
        with SessionLocal() as db:
            assert {r.symbol for r in db.query(UsTicker).all()} == {"AAA"}

    def test_이름이_길어도_저장이_통째로_실패하지_않는다(self, 빈테이블):
        """국내에서 'KOSDAQ GLOBAL'(13자) 하나가 2,873개 저장을 무너뜨린
        적이 있다.

        '저장이 됐는가'만 보면 안 된다 — 테스트 DB 는 SQLite 라 길이 제한을
        아예 무시해서, 안 자르고 넣어도 통과한다. 그때도 그래서 못 잡았고
        PostgreSQL 에 올린 뒤에야 알았다. 그러니 되읽어서 실제로 잘렸는지
        본다."""
        from app.db.database import SessionLocal
        from app.models.stock import UsTicker

        한도 = UsTicker.__table__.c.name.type.length
        assert ts._save_us_to_db([{"s": "LONG", "n": "가" * 500,
                                   "x": "NYSE", "m": "US"}]) is True
        with SessionLocal() as db:
            저장된것 = db.query(UsTicker).filter(UsTicker.symbol == "LONG").one()
        assert len(저장된것.name) <= 한도, (
            f"이름을 {len(저장된것.name)}자로 넣었다 — PostgreSQL 이면 저장이 통째로 실패한다")

    def test_저장이_실패하면_이유를_남긴다(self, monkeypatch):
        """조용히 실패하면 재시작마다 다시 밖으로 나가고, 그때마다 실패한다."""
        class 터지는세션:
            def __enter__(self): raise RuntimeError("DB 없음")
            def __exit__(self, *a): return False
        monkeypatch.setattr("app.db.database.SessionLocal", lambda: 터지는세션())
        assert ts._save_us_to_db([{"s": "A", "n": "가", "x": "NYSE", "m": "US"}]) is False
        assert ts.us_status()["db_error"]


class Test마이그레이션:
    def test_빈_DB로_앱을_띄우면_테이블이_생긴다(self, tmp_path):
        """반드시 새 DB 로 확인한다. 기존 DB 파일에는 앞선 테스트가 만든
        테이블이 남아 있어서, main.py 가 모델을 import 하지 않아도 통과한다."""
        import ast
        import os
        import subprocess
        import sys

        env = {**os.environ, "DATABASE_URL": f"sqlite:///{tmp_path}/새DB.sqlite"}
        r = subprocess.run(
            [sys.executable, "-c",
             "import app.main\n"
             "from sqlalchemy import inspect\n"
             "from app.db.database import engine\n"
             "print(sorted(inspect(engine).get_table_names()))\n"],
            capture_output=True, text=True, env=env, timeout=180,
        )
        assert r.returncode == 0, r.stderr[-1500:]
        생긴것 = set(ast.literal_eval(r.stdout.strip().splitlines()[-1]))
        assert "us_tickers" in 생긴것, (
            f"새 DB 에 us_tickers 가 안 생겼다. 생긴 테이블: {sorted(생긴것)}")


# ── 5. 관리자 화면이 상태를 감추지 않는가 ─────────────────────
class Test상태_표시:
    def test_내장으로_돌면_축소로_표시한다(self, monkeypatch):
        """이걸 표시하지 않아서 국내가 115개로 도는 걸 몇 주 몰랐다."""
        monkeypatch.setattr(ts, "_us_db", list(ts.US_TICKERS))
        monkeypatch.setattr(ts, "_us_source", "내장")
        assert ts.us_status()["degraded"] is True

    def test_제대로_받아오면_축소가_아니다(self, monkeypatch, 큰목록):
        큰목록()
        monkeypatch.setattr(ts, "_us_source", "NASDAQ Trader")
        상태 = ts.us_status()
        assert 상태["degraded"] is False and 상태["count"] == 9000

    def test_ETF_개수를_따로_알려준다(self, monkeypatch):
        """ETF 가 0개면 otherlisted 를 못 받은 것이다 — 건수만 봐서는 모른다."""
        monkeypatch.setattr(ts, "_us_db", [
            {"s": "AAPL", "n": "Apple", "x": "NASDAQ", "m": "US"},
            {"s": "SPY", "n": "SPDR", "x": "NYSE ARCA", "m": "ETF"},
        ])
        assert ts.us_status()["etf_count"] == 1
