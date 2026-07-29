"""
관리자 화면의 서버 상태.

이 화면이 없어서 메모리 한도 초과를 Render 알림 메일로, 뉴스가 한 언론사만
나오는 것을 사용자 제보로 알았다. 문제가 생긴 뒤 원인을 찾는 데 매번 오래
걸린 이유이기도 하다. 무엇이 돌고 있고 자원을 얼마나 쓰는지 한 화면에서
보이게 하고, 그 화면이 조용히 망가지지 않도록 못 박아 둔다.
"""
import inspect

import pytest

from app.api.routes.admin import get_runtime
from app.services import scheduler, watched


@pytest.fixture
def 상태():
    return get_runtime(_=None)


class Test필수_항목:
    @pytest.mark.parametrize("키", [
        "memory", "cpu", "tasks", "market", "watched", "idle", "news",
        "heavy_prefetch", "server_time",
    ])
    def test_한_화면에_필요한_정보가_다_있다(self, 상태, 키):
        assert 키 in 상태

    def test_메모리를_한도와_함께_보여준다(self, 상태):
        # 숫자만 있으면 위험한지 알 수 없다
        m = 상태["memory"]
        assert m["limit_mb"] > 0
        assert m["used_mb"] is None or 0 < m["used_mb"] < m["limit_mb"] * 10
        assert m["percent"] is None or 0 <= m["percent"] <= 1000

    def test_캐시_사용량도_한도와_함께_보여준다(self, 상태):
        m = 상태["memory"]
        assert m["cache_limit_mb"] > 0
        assert m["cache_mb"] >= 0

    def test_실제_CPU_할당량을_보여준다(self, 상태):
        # 컨테이너에서 os.cpu_count() 는 호스트 코어 수라 오해를 부른다
        c = 상태["cpu"]
        assert c["quota"] > 0
        assert "reported" in c and c["news_workers"] >= 1


class Test백그라운드_상태:
    def test_떠_있어야_할_루프를_모두_보여준다(self, 상태):
        이름들 = {t["name"] for t in 상태["tasks"]}
        assert {"periodic-refresh", "watched-prices", "startup-prefetch"} <= 이름들

    def test_시작되지_않은_루프도_드러난다(self, 상태):
        # 목록에 없으면 '없다'는 사실 자체가 안 보인다 —
        # 스케줄러가 통째로 안 돌던 문제를 몇 주간 아무도 몰랐던 이유다
        보고 = {t["name"]: t for t in 상태["tasks"]}
        for name in ("periodic-refresh", "watched-prices"):
            assert "running" in 보고[name]

    def test_죽은_루프의_원인을_함께_보여준다(self, 상태):
        for t in 상태["tasks"]:
            assert "error" in t

    def test_구현이_실제_태스크_목록을_읽는다(self):
        # 고정값을 돌려주면 화면은 늘 정상으로 보인다
        src = inspect.getsource(get_runtime)
        assert "scheduler._tasks" in src


class Test운영_판단에_필요한_값:
    def test_지금_몇_종목을_갱신하는지_보여준다(self, 상태):
        assert set(상태["watched"]) == {"symbols", "connections"}

    def test_현재_갱신_주기를_보여준다(self, 상태):
        # '실시간인데 왜 안 움직이지'를 판단하려면 이 값이 필요하다
        assert 상태["market"]["price_interval_sec"] > 0
        assert 상태["market"]["kr_label"] and 상태["market"]["us_label"]

    def test_유휴로_쉬는_중인지_보여준다(self, 상태):
        i = 상태["idle"]
        assert isinstance(i["paused"], bool)
        assert i["pause_after_sec"] == scheduler.IDLE_PAUSE_SEC

    def test_뉴스가_몇_곳에서_수집됐는지_보여준다(self, 상태):
        # '아시아경제만 나온다'를 화면에서 바로 확인할 수 있어야 한다
        n = 상태["news"]
        assert n["kr_feeds"] > 0 and n["batch"] > 0
        assert isinstance(n["kr_sources"], list)
        assert n["kr_cached"] >= 0

    def test_선제_캐싱_여부를_보여준다(self, 상태):
        assert isinstance(상태["heavy_prefetch"], bool)


class Test안전:
    def test_관리자만_볼_수_있다(self):
        src = inspect.getsource(get_runtime)
        assert "require_admin" in src

    def test_구독_종목이_있어도_터지지_않는다(self):
        import asyncio
        asyncio.run(watched.subscribe([("005930", "KR"), ("AAPL", "US")]))
        try:
            상태 = get_runtime(_=None)
            assert 상태["watched"]["symbols"] == 2
            assert 상태["market"]["price_interval_sec"] > 0
        finally:
            asyncio.run(watched.unsubscribe([("005930", "KR"), ("AAPL", "US")]))


class Test패널_자체_비용:
    def test_뉴스_캐시를_한_번만_읽는다(self):
        # 뉴스 캐시는 압축돼 있어 읽을 때마다 압축을 푼다.
        # 감시용 화면이 스스로 부하를 만들면 안 된다
        from app.api.routes.admin import _news_status
        src = inspect.getsource(_news_status)
        assert src.count('get_stale("news:kr")') == 1
        assert src.count('get_stale("news:us")') == 1


class Test진단_정보:
    """'동작 중'이라는 말만으로는 문제를 못 찾는다. 마지막으로 성공한 때,
    실패 횟수, 실패 이유까지 있어야 원인을 좁힐 수 있다."""

    @pytest.mark.parametrize("키", ["health", "cache_breakdown", "websocket", "uptime_sec"])
    def test_진단에_필요한_항목이_있다(self, 상태, 키):
        assert 키 in 상태

    def test_수집_이력이_성공률과_마지막_시각을_담는다(self):
        from app.core import health
        health.reset()
        health.record_ok("테스트작업", 120, "5/5개")
        health.record_fail("테스트작업", "타임아웃")
        h = {x["name"]: x for x in health.snapshot()}["테스트작업"]
        assert h["ok"] == 1 and h["fail"] == 1
        assert h["success_pct"] == 50
        assert h["last_ok_sec"] is not None and h["last_fail_sec"] is not None
        assert h["last_error"] == "타임아웃"
        assert h["detail"] == "5/5개"
        health.reset()

    def test_기록이_무한정_쌓이지_않는다(self):
        from app.core import health
        health.reset()
        for i in range(health.MAX_TRACKED + 30):
            health.record_ok(f"작업{i}")
        assert len(health.snapshot()) <= health.MAX_TRACKED
        health.reset()

    def test_캐시를_종류별로_나눠_보여준다(self):
        # 무엇이 캐시를 채우는지 모르면 무엇을 줄일지도 알 수 없다
        from app.core.cache import TTLCache
        c = TTLCache()
        c.set("price:005930", {"p": 1}, 60)
        c.set("price:AAPL", {"p": 2}, 60)
        c.set("news:kr", [{"t": "x"}] * 50, 60)
        by = {b["prefix"]: b for b in c.by_prefix()}
        assert by["price"]["items"] == 2
        assert by["news"]["items"] == 1

    def test_가동_시간을_보여준다(self, 상태):
        # 재시작이 잦은지 판단하는 유일한 단서다
        assert isinstance(상태["uptime_sec"], int) and 상태["uptime_sec"] >= 0

    def test_웹소켓_연결_수를_보여준다(self, 상태):
        w = 상태["websocket"]
        assert w["connections"] >= 0 and w["limit_per_ip"] > 0

    def test_뉴스는_언론사별로_실패를_기록한다(self):
        # '아시아경제만 나온다'를 화면에서 바로 확인할 수 있어야 한다
        import inspect as _i
        from app.services import news_service
        src = _i.getsource(news_service._fetch_all_feeds)
        assert 'health.record_fail(f"뉴스:{source}"' in src
