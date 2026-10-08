"""
사용자 보고: "검색으로 찾은 종목이랑 기능별 사용통계는 배포 이후에도 유지될
수 있도록 만들어줘"

DB 에 저장하고는 있었다(system_settings 의 JSON 한 칸). 그런데도 배포하면
사라졌다. 구멍이 셋이었다 —

  1. 서버가 꺼질 때 저장하는 단계가 없었다. 마지막 저장(5분 주기) 뒤에 센
     것은 배포·잠들기 때마다 사라졌다. 저장도 '사람이 안 쓰면 쉰다' 는
     가드 뒤에 있어서, 쓰고 나간 뒤 쉬다가 잠들면 그대로 잃었다.
  2. 새 서버가 DB 에서 읽어 오다 실패하면 빈 카운터로 시작했고, 다음 저장이
     그 빈 카운터로 **지금까지의 기록을 통째로 덮어썼다.**
  3. 배포하는 동안 옛 서버와 새 서버가 함께 돌면 서로 자기 숫자로 덮어썼다.

이제 한 줄에 한 항목을 두고 늘어난 만큼만 더한다(app/models/usage.py).
여기서는 '서버가 바뀌어도 남는가' 를 서버를 바꿔 가며 본다 — 같은 DB 를
두고 메모리(아직 저장 안 한 증가분)만 비우면, 새로 뜬 서버와 같다.
"""
import ast
import inspect
import json
import textwrap

import pytest
from sqlalchemy import create_engine, text

from app.core import trends


@pytest.fixture
def DB(tmp_path, monkeypatch):
    엔진 = create_engine(f"sqlite:///{tmp_path}/통계.db")
    monkeypatch.setattr(trends, "_엔진", lambda: 엔진)
    새서버(monkeypatch)
    yield 엔진
    엔진.dispose()


def 새서버(monkeypatch) -> None:
    """서버가 새로 뜬 것과 같게 — 메모리에 든 것을 모두 비운다."""
    monkeypatch.setattr(trends, "_search_pending", trends.Counter())
    monkeypatch.setattr(trends, "_search_names", {})
    monkeypatch.setattr(trends, "_usage_pending", trends.Counter())


def 표에서(엔진, kind: str) -> dict:
    with 엔진.connect() as c:
        return {k: n for k, n in c.execute(
            text("SELECT key, count FROM usage_counters WHERE kind = :k"), {"k": kind})}


def 옛칸_심기(엔진, 칸들: dict) -> None:
    with 엔진.begin() as c:
        c.execute(text("CREATE TABLE IF NOT EXISTS system_settings ("
                       "key VARCHAR(100) PRIMARY KEY, value TEXT NOT NULL)"))
        for k, v in 칸들.items():
            c.execute(text("INSERT INTO system_settings (key, value) VALUES (:k, :v) "
                           "ON CONFLICT (key) DO UPDATE SET value = :v"), {"k": k, "v": v})


def 옛칸(엔진) -> dict:
    with 엔진.connect() as c:
        return dict(c.execute(text("SELECT key, value FROM system_settings")).fetchall())


class Test서버가_바뀌어도_남는다:
    def test_저장하면_새_서버에서도_보인다(self, DB, monkeypatch):
        for _ in range(3):
            trends.track_search("005930", "삼성전자", "KR")
        trends.track_usage("dashboard")
        assert trends.flush_to_db()

        새서버(monkeypatch)                                   # 배포
        assert trends.get_search_trends() == [
            {"symbol": "005930", "market": "KR", "name": "삼성전자", "count": 3}]
        assert trends.get_usage_stats() == [
            {"feature": "dashboard", "label": "대시보드", "count": 1}]

    def test_새_서버가_센_것은_예전_기록에_더해진다(self, DB, monkeypatch):
        """예전에는 새 서버가 DB 를 못 읽으면 빈 카운터로 시작해, 다음 저장이
        지금까지의 기록을 그 작은 숫자로 덮어썼다. 이제 덮어쓸 '전체 숫자'
        가 서버에 없다 — 늘어난 만큼만 더한다."""
        for _ in range(10):
            trends.track_usage("portfolio")
        trends.flush_to_db()

        새서버(monkeypatch)                     # 읽어 오는 단계가 아예 없다
        trends.track_usage("portfolio")
        trends.flush_to_db()
        assert 표에서(DB, "usage") == {"portfolio": 11}

    def test_두_서버가_함께_돌아도_서로_지우지_않는다(self, DB, monkeypatch):
        """배포하는 동안 옛 서버와 새 서버가 겹쳐 돈다. 예전에는 둘이 자기
        숫자로 번갈아 덮어써, 마지막에 쓴 쪽 것만 남았다."""
        옛서버 = trends.Counter({"KR|005930": 3})
        새서버_ = trends.Counter({"KR|005930": 2, "US|AAPL": 1})
        for 증가분 in (옛서버, 새서버_):
            새서버(monkeypatch)
            trends._search_pending.update(증가분)
            assert trends.flush_to_db()
        assert 표에서(DB, "search") == {"KR|005930": 5, "US|AAPL": 1}

    def test_저장한_것은_두_번_더하지_않는다(self, DB):
        trends.track_usage("search")
        trends.flush_to_db()
        trends.flush_to_db()
        trends.get_usage_stats()                # 읽을 때도 한 번 저장한다
        assert 표에서(DB, "usage") == {"search": 1}

    def test_이름은_새로_온_것이_빈값이면_알던_것을_남긴다(self, DB, monkeypatch):
        # 종목 목록에서 이름을 다시 채우는 길을 막는다 — 그 길이 잘못을 가린다
        monkeypatch.setattr(trends, "종목명_찾기", lambda *a: "")
        trends.track_search("005930", "삼성전자(보통주)", "KR")
        trends.flush_to_db()
        trends.track_search("005930", "", "KR")
        trends.flush_to_db()
        assert trends.get_search_trends()[0]["name"] == "삼성전자(보통주)"


class Test저장이_실패하면:
    def test_증가분을_돌려놓았다가_다음에_넣는다(self, DB, monkeypatch):
        def 끊김():
            raise RuntimeError("DB 연결 끊김")
        trends.track_search("005930", "삼성전자", "KR")
        trends.track_usage("dashboard")

        monkeypatch.setattr(trends, "_엔진", 끊김)
        assert trends.flush_to_db() is False
        assert trends._search_pending["KR|005930"] == 1, "못 넣은 것을 버렸다"
        assert trends._search_names["KR|005930"] == "삼성전자"

        monkeypatch.setattr(trends, "_엔진", lambda: DB)
        assert trends.flush_to_db()
        assert 표에서(DB, "search") == {"KR|005930": 1}
        assert 표에서(DB, "usage") == {"dashboard": 1}

    def test_DB_를_못_읽어도_화면은_아직_저장_안_한_것이라도_보인다(self, DB, monkeypatch):
        def 끊김():
            raise RuntimeError("DB 연결 끊김")
        monkeypatch.setattr(trends, "_엔진", 끊김)
        trends.track_usage("watchlist")
        assert trends.get_usage_stats() == [
            {"feature": "watchlist", "label": "관심종목", "count": 1}]

    def test_저장할_것이_없으면_DB_를_건드리지_않는다(self, DB, monkeypatch):
        """1분마다 도는데, 아무도 안 쓰는 동안 DB 를 두드리면 안 된다."""
        monkeypatch.setattr(trends, "_엔진", lambda: pytest.fail("DB 를 건드렸다"))
        assert trends.flush_to_db()


class Test옛_기록을_옮긴다:
    """예전 자리(system_settings 의 JSON 한 칸)에 쌓인 것을 잃지 않는다."""

    def test_한_번만_옮기고_옛_칸은_치운다(self, DB):
        옛칸_심기(DB, {
            "trends_search": json.dumps({"c": {"KR|005930": 7, "US|AAPL": 2},
                                          "n": {"KR|005930": "삼성전자"}}),
            "trends_usage": json.dumps({"dashboard": 40, "몰라": 3}),
            "jwt_secret": "건드리면_안_되는_값",
        })
        assert trends.옛기록_옮기기() == 3
        assert 표에서(DB, "search") == {"KR|005930": 7, "US|AAPL": 2}
        assert 표에서(DB, "usage") == {"dashboard": 40}      # 모르는 기능은 버린다
        assert trends.get_search_trends()[0]["name"] == "삼성전자"
        남은칸 = 옛칸(DB)
        assert "trends_search" not in 남은칸 and "trends_usage" not in 남은칸
        assert 남은칸["jwt_secret"] == "건드리면_안_되는_값"

    def test_다시_떠도_두_번_옮기지_않는다(self, DB):
        옛칸_심기(DB, {"trends_usage": json.dumps({"dashboard": 40})})
        trends.옛기록_옮기기()
        # 배포하는 몇 분 동안 옛 서버가 옛 칸을 다시 써 놓는다
        옛칸_심기(DB, {"trends_usage": json.dumps({"dashboard": 41})})
        assert trends.옛기록_옮기기() == 0
        assert 표에서(DB, "usage") == {"dashboard": 40}, "옛 칸을 두 번 더했다"
        assert "trends_usage" not in 옛칸(DB), "다시 써 놓은 옛 칸이 남았다"

    def test_더_옛날_모양도_읽는다(self, DB):
        """처음에는 {키: 횟수} 만 저장했다"""
        옛칸_심기(DB, {"trends_search": json.dumps({"KR|005930": 4})})
        trends.옛기록_옮기기()
        assert 표에서(DB, "search") == {"KR|005930": 4}

    def test_옛_자리가_없는_새_DB_에서도_터지지_않는다(self, DB):
        assert trends.옛기록_옮기기() == 0

    def test_망가진_옛_칸이_있어도_나머지는_옮긴다(self, DB):
        옛칸_심기(DB, {"trends_search": "{망가짐", "trends_usage": json.dumps({"backtest": 2})})
        trends.옛기록_옮기기()
        assert 표에서(DB, "usage") == {"backtest": 2}


class Test언제_저장하는가:
    def test_서버가_꺼질_때_저장한다(self, DB, monkeypatch):
        """배포·잠들기 때마다 마지막 저장 뒤에 센 것이 사라지던 자리."""
        from fastapi.testclient import TestClient
        import app.main as M
        monkeypatch.setattr(M, "start_background_tasks", lambda *a, **k: None)
        with TestClient(M.app):
            trends.track_usage("screening")
            assert 표에서(DB, "usage") == {}           # 아직 저장 전
        assert 표에서(DB, "usage") == {"screening": 1}, "꺼질 때 저장하지 않았다"

    def test_서버가_뜰_때_옛_기록을_옮긴다(self, DB, monkeypatch):
        from fastapi.testclient import TestClient
        import app.main as M
        monkeypatch.setattr(M, "start_background_tasks", lambda *a, **k: None)
        옛칸_심기(DB, {"trends_usage": json.dumps({"community": 12})})
        with TestClient(M.app):
            pass
        assert 표에서(DB, "usage") == {"community": 12}, "뜰 때 옛 기록을 안 옮겼다"

    @staticmethod
    def _루프():
        from app.services import scheduler
        return ast.parse(textwrap.dedent(inspect.getsource(scheduler.periodic_refresh)))

    def test_1분마다_저장한다(self):
        for n in ast.walk(self._루프()):
            if isinstance(n, ast.If) and "flush_to_db" in ast.unparse(n.body[0]) \
                    and "counter %" in ast.unparse(n.test):
                수 = [c.value for c in ast.walk(n.test) if isinstance(c, ast.Constant)
                      and isinstance(c.value, int) and c.value > 0]
                assert max(수) * 10 <= 60, f"{max(수) * 10}초마다 저장한다"
                return
        pytest.fail("주기 저장을 못 찾았다")

    def test_쉬는_동안에도_저장이_돈다(self):
        """'사람이 안 쓰면 쉰다' 가드 뒤에 있으면, 쓰고 나간 뒤 쉬다가 그대로
        잠들 때 마지막 몇 분이 사라진다."""
        본문 = ast.unparse(self._루프())
        assert 본문.index("flush_to_db") < 본문.index("seconds_since_last_request"), \
            "저장이 쉬는 가드 뒤에 있다"


class Test관리자_화면:
    def test_검색_종목과_사용_통계를_표에서_읽어_준다(self, DB, monkeypatch):
        trends.track_search("005930", "삼성전자", "KR")
        trends.track_usage("backtest")
        trends.flush_to_db()
        새서버(monkeypatch)

        from app.api.routes import admin as A
        assert A.get_search_trends(_=None)[0]["symbol"] == "005930"
        assert A.get_usage_stats(_=None) == [
            {"feature": "backtest", "label": "백테스트", "count": 1}]
