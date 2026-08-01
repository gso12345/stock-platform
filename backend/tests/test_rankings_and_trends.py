"""
순위표·검색 트렌드·스레드 누수 — 사용자가 직접 겪은 세 가지.

  1. "국내순위, 해외순위가 정확하지 않아. 불러오는 속도도 너무 느려"
  2. "관리자 검색트렌드를 어떤 종목을 찾았는지 기준으로"
  3. "10분만에 메모리가 다 차면서 재시작됐어"

셋 다 '있는 그대로 재현되는' 원인이 있었고, 여기서 그 원인이 되살아나지
않게 못 박는다.
"""
import ast
import inspect
import threading
import time

import pytest

from app.core import trends
from app.services import ranking_service as rs, scheduler


# ── 1. 순위표 ────────────────────────────────────────────────
class Test순위_캐시_수명:
    """캐시가 갱신 주기보다 짧으면 그 사이 구멍으로 전일 데이터가 샌다."""

    def test_캐시가_갱신_주기보다_길다(self):
        """스케줄러가 캐시를 채우는 간격보다 캐시가 먼저 죽으면,
        그 틈에 들어온 요청은 전부 어제 종가로 순위를 새로 만든다.
        예전에는 캐시 60초 / 휴장 갱신 600초라 9분이 그 틈이었다."""
        import textwrap
        나무 = ast.parse(textwrap.dedent(inspect.getsource(scheduler.periodic_refresh)))

        틱 = None
        for n in ast.walk(나무):
            if isinstance(n, ast.If) and "refresh_kr_rankings_from_naver" in ast.unparse(n):
                # counter % (6 if 장중 else N) == 0  에서 N 을 꺼낸다
                수 = [c.value for c in ast.walk(n.test) if isinstance(c, ast.Constant)
                      and isinstance(c.value, int)]
                틱 = max(수)
                break
        assert 틱 is not None, "순위 갱신 주기를 찾지 못했다"
        갱신초 = 틱 * 10          # 루프가 10초마다 돈다
        assert rs.RANK_TTL > 갱신초, (
            f"순위 캐시 {rs.RANK_TTL}초 < 갱신 주기 {갱신초}초 — "
            f"그 사이 {갱신초 - rs.RANK_TTL}초 동안 전일 데이터가 나간다")

    def test_캐시가_만료돼도_전일_데이터로_바꾸지_않는다(self, monkeypatch):
        """몇 분 지난 실시간 순위가, 어제 종가로 새로 만든 순위보다 낫다."""
        from app.core.cache import cache
        cache.clear()
        실시간 = [{"symbol": "005930", "name": "삼성전자", "price": 70000, "rank": 1}]
        cache.set("rank:kr:거래량", 실시간, 1)
        time.sleep(1.1)                       # 만료시킨다

        def 전일데이터로_새로만들기():
            raise AssertionError("만료됐다고 전일 종가로 다시 만들면 안 된다")
        monkeypatch.setattr(rs, "_build_all_kr_rows", 전일데이터로_새로만들기)

        assert rs.get_kr_rankings("거래량") == 실시간

    def test_미국_순위도_같다(self, monkeypatch):
        from app.core.cache import cache
        cache.clear()
        cache.set("rank:us:거래량", [{"symbol": "AAPL", "rank": 1}], 1)
        time.sleep(1.1)
        monkeypatch.setattr(rs, "_build_us_rows",
                            lambda: pytest.fail("만료됐다고 새로 만들면 안 된다"))
        assert rs.get_kr_rankings and rs.get_us_rankings("거래량")[0]["symbol"] == "AAPL"


class Test순위표_내용:
    def test_가격_없는_종목은_순위에_넣지_않는다(self):
        """'거래량 순위'인데 거래량을 모르는 종목이 43위에 앉아 있으면
        그건 순위표가 아니다."""
        rows = [
            {"symbol": "A", "price": 100, "volume": 50},
            {"symbol": "B", "price": 0,   "volume": 0},     # 시세 없음
            {"symbol": "C", "price": 200, "volume": 10},
            {"symbol": "D", "price": None, "volume": None},  # 시세 없음
        ]
        out = rs._sort_kr([dict(r) for r in rows], "거래량")
        assert [r["symbol"] for r in out] == ["A", "C"]
        assert [r["rank"] for r in out] == [1, 2]

    def test_전체_종목_표를_카테고리마다_다시_만들지_않는다(self, monkeypatch):
        """카테고리가 7개라, 재사용하지 않으면 2,872 종목 순회를 7번 한다."""
        from app.core.cache import cache
        cache.clear()
        횟수 = {"n": 0}
        원본 = rs.get_kr_db

        def 세면서(*a, **k):
            횟수["n"] += 1
            return [{"s": "005930", "n": "삼성전자", "x": "KOSPI"}]
        monkeypatch.setattr(rs, "get_kr_db", 세면서)
        monkeypatch.setattr(rs, "get_fdr_price",
                            lambda s: {"price": 70000, "volume": 100, "market_cap": 4e14})

        rs._build_all_kr_rows()
        rs._build_all_kr_rows()
        rs._build_all_kr_rows()
        assert 횟수["n"] == 1, f"전체 종목을 {횟수['n']}번 훑었다"
        assert 원본 is not None


# ── 2. 검색 트렌드 ───────────────────────────────────────────
class Test검색_트렌드:
    @pytest.fixture(autouse=True)
    def _비우기(self, monkeypatch):
        monkeypatch.setattr(trends, "_search_counter", trends.Counter())
        monkeypatch.setattr(trends, "_search_names", {})

    def test_같은_종목은_어떻게_검색했든_한_줄이다(self):
        """예전에는 사람이 친 글자를 셌다. '삼성', '삼성전자', '005930' 이
        전부 다른 줄이 되어 무엇이 인기인지 알 수 없었다."""
        for _ in range(3):
            trends.track_search("005930", "삼성전자", "KR")
        t = trends.get_search_trends()
        assert len(t) == 1
        assert t[0] == {"symbol": "005930", "market": "KR", "name": "삼성전자", "count": 3}

    def test_시장이_다르면_다른_종목이다(self):
        trends.track_search("A", "에이", "KR")
        trends.track_search("A", "Agilent", "US")
        assert {r["market"] for r in trends.get_search_trends()} == {"KR", "US"}

    def test_많이_찾은_순으로_준다(self):
        trends.track_search("AAPL", "애플", "US")
        for _ in range(5):
            trends.track_search("005930", "삼성전자", "KR")
        assert [r["symbol"] for r in trends.get_search_trends()] == ["005930", "AAPL"]

    def test_키가_무한정_늘지_않는다(self, monkeypatch):
        """예전 방식은 키가 '사람이 칠 수 있는 모든 문자열'이라 상한이
        없었다. 그 카운터는 통째로 DB 에 저장되고 서버가 뜰 때마다 다시
        메모리로 올라온다 — 아무나 늘릴 수 있는 메모리였다."""
        monkeypatch.setattr(trends, "_MAX_SEARCH_KEYS", 50)
        for i in range(500):
            trends.track_search(f"S{i}", f"종목{i}", "KR")
        assert len(trends._search_counter) <= 50
        assert len(trends._search_names) <= 50, "이름 목록만 따로 자라면 안 된다"

    def test_이상한_입력은_무시한다(self):
        trends.track_search("", "빈값", "KR")
        trends.track_search("   ", "공백", "KR")
        trends.track_search("X" * 50, "너무김", "KR")
        assert trends.get_search_trends() == []

    def test_예전에_쌓인_검색어는_버린다(self):
        """종목 기준 순위표에 옛날 검색어가 섞이면 무슨 기준인지 알 수 없다."""
        import json
        옛날 = json.dumps({"삼성전자": 10, "005930": 3, "KR|005930": 7})
        counts = json.loads(옛날)
        살아남 = {k: v for k, v in counts.items() if trends._SEARCH_KEY_SEP in k}
        assert 살아남 == {"KR|005930": 7}

    def test_검색_결과를_보기만_한_것은_세지_않는다(self):
        """'무엇을 쳤나'가 아니라 '무엇을 찾았나'를 세기로 했으므로,
        검색 라우트에서는 더 이상 기록하지 않는다."""
        from app.api.routes import search as search_route
        본문 = inspect.getsource(search_route.search_route)
        assert "track_search" not in 본문


# ── 3. 스레드 누수 ───────────────────────────────────────────
class Test스레드가_쌓이지_않는다:
    def test_요청마다_새_스레드풀을_만들지_않는다(self):
        """ThreadPoolExecutor 를 요청 안에서 만들고 shutdown(wait=False) 로
        끝내면, 시한을 넘긴 작업의 스레드가 그대로 남는다. yfinance 는
        요청 시한이 없어서 야후가 늦으면 그 스레드는 영영 살아 있는다.
        실제로 요청 10번에 스레드 61개가 남았고, 종목상세를 10분쯤
        돌아다니면 512MB 한도를 넘겨 프로세스가 강제 재시작됐다."""
        from app.api.routes import stocks
        나무 = ast.parse(inspect.getsource(stocks))
        만드는곳 = [
            ast.unparse(n) for n in ast.walk(나무)
            if isinstance(n, ast.Call)
            and "ThreadPoolExecutor" in ast.unparse(n.func)
        ]
        assert not 만드는곳, (
            "요청 처리 중에 스레드풀을 새로 만든다 — "
            f"app.core.executor 의 공유 풀을 쓸 것: {만드는곳}")

    def test_공유_풀은_크기가_정해져_있다(self):
        from app.core.executor import detail_executor
        n = detail_executor._max_workers
        assert 1 <= n <= 32, f"공유 풀 크기 {n} — 상한이 없으면 나눈 의미가 없다"

    def test_요청이_늘어도_스레드는_상한을_넘지_않는다(self):
        """야후가 통째로 응답을 미루는 상황을 재현한다."""
        from app.core.executor import detail_executor
        멈춤 = threading.Event()

        def 응답없는_외부호출():
            멈춤.wait(30)

        시작 = threading.active_count()
        try:
            for _ in range(20):                     # 요청 20번
                futs = [detail_executor.submit(응답없는_외부호출) for _ in range(6)]
                for f in futs:
                    try:
                        f.result(timeout=0.01)
                    except Exception:
                        f.cancel()
            늘어난 = threading.active_count() - 시작
            assert 늘어난 <= detail_executor._max_workers, (
                f"요청 20번에 스레드가 {늘어난}개 늘었다 "
                f"(상한 {detail_executor._max_workers})")
        finally:
            멈춤.set()
