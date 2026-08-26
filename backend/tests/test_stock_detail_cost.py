"""
종목상세가 외부에 몇 번 나가는가.

이 화면 하나가 야후에 수십 번 나간다. 재무·추정치·투자의견 세 곳이
각각 4~6가지를 한꺼번에 물어보기 때문이다. CPU 0.15개짜리 인스턴스에서는
그 횟수가 그대로 응답 속도이고, 받아온 pandas 표가 그대로 메모리다.

세 곳 중 재무지표 추이(metrics-history)만 메모리 캐시를 썼다. 무료 플랜은
재시작이 잦아서, 그때마다 그 6번을 처음부터 다시 했다.
"""
import ast
import inspect

import pytest

from app.api.routes import stocks


def _함수원문(name: str) -> str:
    return inspect.getsource(getattr(stocks, name))


class TestDB캐시:
    """메모리 캐시는 재시작하면 사라진다. 분기에 한 번 바뀌는 재무제표를
    그때마다 다시 받을 이유가 없다."""

    @pytest.mark.parametrize("함수, 테이블", [
        ("get_metrics_history", "MetricsHistoryCache"),
        ("get_forecasts",       "ForecastsCache"),
        ("get_analyst",         "AnalystCache"),
    ])
    def test_무거운_조회는_DB에도_남긴다(self, 함수, 테이블):
        본문 = _함수원문(함수)
        assert f"_db_get({테이블}" in 본문 or f"_db_get, {테이블}" in 본문, (
            f"{함수} 가 DB 캐시를 읽지 않는다 — 재시작마다 외부 API 를 다시 부른다")
        assert f"_db_set, {테이블}" in 본문, (
            f"{함수} 가 DB 에 저장하지 않는다 — 읽기만 하면 영원히 비어 있다")

    def test_DB에_있으면_외부로_안_나간다(self, monkeypatch):
        """가장 중요한 성질 — 캐시가 있으면 야후를 부르지 않아야 한다."""
        import asyncio
        from app.core.cache import cache
        from app.models.stock import MetricsHistoryCache
        cache.clear()

        저장된 = {"annual": [{"period": "2025", "revenue": 1}], "quarterly": []}

        def 가짜_db_get(model, symbol, market, max_age_h):
            assert model is MetricsHistoryCache
            return 저장된 if max_age_h <= 24 else None

        import app.services.fundamentals_service as fs
        monkeypatch.setattr(fs, "_db_get", 가짜_db_get)

        def 야후는_부르면_안된다(*a, **k):
            raise AssertionError("DB 에 있는데 야후를 불렀다")
        # 이름을 찾는 곳에 붙여야 한다. get_metrics_history 는 metrics
        # 조각에 있으므로 패키지(stocks)에 붙이면 아무 일도 안 일어난다
        from app.api.routes.stocks import metrics as _metrics
        monkeypatch.setattr(_metrics, "_resolve_kr_symbol", 야후는_부르면_안된다)

        class 가짜요청:
            class client:
                host = "127.0.0.1"
            headers: dict = {}
            scope: dict = {"type": "http"}

        결과 = asyncio.run(stocks.get_metrics_history.__wrapped__(
            가짜요청(), "KR", "005930"))
        assert 결과 == 저장된

    def test_새로_받았을_때_저장한다(self):
        """읽기만 하고 쓰지 않으면 DB 캐시는 영원히 비어 있다 —
        '있는 줄 알았는데 매번 외부로 나가는' 상태가 된다.

        '성공했을 때' 저장하는지가 핵심이다. 빈 결과까지 저장하면 실패가
        하루 동안 굳어버리므로, 성공 분기 안에 있어야 한다."""
        나무 = ast.parse(inspect.cleandoc(_함수원문("get_metrics_history")))
        성공분기 = [
            n for n in ast.walk(나무)
            if isinstance(n, ast.If) and "result.get" in ast.unparse(n.test)
        ]
        assert 성공분기, "결과가 있는지 확인하는 분기를 찾지 못했다"
        본문 = "\n".join(ast.unparse(x) for x in 성공분기[0].body)
        assert "_db_set" in 본문 and "MetricsHistoryCache" in 본문, (
            "새로 받아 성공했는데 DB 에 저장하지 않는다 — "
            f"저장 분기 내용: {본문[:200]}")
        빈결과분기 = "\n".join(ast.unparse(x) for x in 성공분기[0].orelse)
        assert "_db_set" not in 빈결과분기, (
            "빈 결과까지 DB 에 저장한다 — 실패가 하루 동안 굳는다")

    def test_메모리에_있으면_DB도_안_본다(self, monkeypatch):
        """캐시는 빠른 것부터 — 메모리 → DB → 외부 순이어야 한다."""
        import asyncio
        from app.core.cache import cache
        cache.clear()
        cache.set("metrics_hist5:005930", {"annual": [{"period": "메모리"}]}, 60)

        import app.services.fundamentals_service as fs
        monkeypatch.setattr(fs, "_db_get",
                            lambda *a, **k: pytest.fail("메모리에 있는데 DB 를 봤다"))

        class 가짜요청:
            class client:
                host = "127.0.0.1"
            headers: dict = {}
            scope: dict = {"type": "http"}

        결과 = asyncio.run(stocks.get_metrics_history.__wrapped__(
            가짜요청(), "KR", "005930"))
        assert 결과["annual"][0]["period"] == "메모리"


class Test요청마다_새_스레드풀을_안_만든다:
    """지난번에 고친 것이 되살아나지 않게 — 요청 안에서 풀을 새로 만들면
    시한을 넘긴 작업의 스레드가 그대로 쌓인다."""

    def test_공용_풀만_쓴다(self):
        from 도구 import 종목라우트_원문
        나무 = ast.parse(종목라우트_원문())
        만듦 = [ast.unparse(n) for n in ast.walk(나무)
                if isinstance(n, ast.Call) and "ThreadPoolExecutor" in ast.unparse(n.func)]
        assert not 만듦, 만듦


class Test화면이_안_볼_것까지_미리_받지_않는다:
    """종목상세는 탭이 다섯 개고, 탭마다 무거운 조회가 붙어 있다.
    안 열어본 탭까지 미리 받으면 0.15 CPU 에서 그대로 느려진다."""

    def test_탭을_지정하지_않은_선제_수집_분기가_없다(self):
        from pathlib import Path
        본문 = Path(__file__).resolve().parents[2].joinpath(
            "frontend/src/pages/StockDetail.tsx").read_text(encoding="utf-8")
        i = 본문.index("const prefetchSecondaryData")
        j = 본문.index("const { data: detail", i)
        블록 = 본문[i:j]
        assert 'tab === ""' not in 블록.replace(
            "(예전에는 tab === \"\" 일 때 전부 받는 분기가 있었는데, 실제로는 아무도", ""), (
            "탭을 지정하지 않으면 전부 받는 분기가 있다 — "
            "안 볼 탭까지 미리 받게 된다")
