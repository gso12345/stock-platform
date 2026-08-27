"""
대시보드 순위 API — 인증 없이 서비스를 마비시킬 수 있던 구멍.

category 파라미터에 검증이 없었다. 그 값이 그대로 캐시 키(rank:kr:{category})가
되고, 모르는 값이면 '시가총액'으로 취급해 2,873개 종목을 전부 정렬한 뒤 그
임의 키로 캐시에 저장했다.

실제로 재현했다 — 로그인 없이 40번 부르자 캐시가 4.3MB → 10.2MB 로 늘었다.
요청 하나당 약 150KB다. 캐시 상한이 80MB이므로 500번이면 시세·차트·뉴스가
전부 밀려난다. 그리고 매 요청이 0.15 CPU 에서 전체 정렬을 돌린다.

요청 제한도 실제로는 걸려 있지 않았다. Limiter 의 default_limits 는
SlowAPIMiddleware 가 있어야 적용되는데 그게 등록돼 있지 않아서, @limiter.limit
을 붙인 라우트만 제한됐다. 대시보드 라우트의 데코레이터 수는 0이었다.
"""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.ranking_service import ALLOWED_CATEGORIES


@pytest.fixture(scope="module")
def client():
    return TestClient(app)


class Test카테고리_검증:
    @pytest.mark.parametrize("category", ALLOWED_CATEGORIES)
    def test_정상_카테고리는_받는다(self, client, category):
        for path in ("/api/v1/dashboard/rankings/kr", "/api/v1/dashboard/rankings/us"):
            r = client.get(path, params={"category": category})
            assert r.status_code == 200, f"{path}?category={category} → {r.status_code}"

    @pytest.mark.parametrize("category", [
        "attack1", "", "시가총액x", "../../etc/passwd", "'; DROP TABLE--",
        "시가총액 ", "SIGATCHONGAEK", "a" * 500,
    ])
    def test_모르는_카테고리는_거절한다(self, client, category):
        """하나만 통과해도 그 값이 캐시 키가 되고 전체 정렬이 돈다."""
        r = client.get("/api/v1/dashboard/rankings/kr", params={"category": category})
        assert r.status_code == 422, f"'{category[:20]}' 가 통과했다 → {r.status_code}"

    def test_대시보드_본문은_아예_순위를_안_만든다(self, client):
        """예전에는 /rankings 만 막고 /kr, /us 를 두면 같은 경로로 그대로
        들어왔다. 그래서 두 라우트에도 같은 검증을 걸어 422 로 막았다.

        지금은 더 강하다 — /kr, /us 가 순위표를 **아예 안 만든다**.
        화면이 그 값을 안 읽는데 매번 만들어 20KB 를 실어 보내고 있었다.
        만들지 않으니 임의 category 로 캐시를 밀어낼 길 자체가 없고,
        모르는 값을 보내도 그냥 무시된다(422 로 막을 것이 없다).

        검증을 되돌리는 것보다 이쪽이 낫다 — 막아야 할 일이 없어졌다."""
        from app.core.cache import cache

        def 순위칸수() -> int:
            """rank: 로 시작하는 캐시 항목만 센다.

            캐시 전체를 세면 안 된다 — 이 두 라우트는 환율·금리·선물도
            같이 받아 오고, 그것들은 정상적으로 캐시에 한 자리씩 잡는다.
            여기서 보려는 것은 '임의 category 가 새 캐시 키를 만드는가'다."""
            return sum(1 for x in cache.keys_with_ttl() if str(x["key"]).startswith("rank:"))

        전 = 순위칸수()
        for i in range(30):
            for path in ("/api/v1/dashboard/kr", "/api/v1/dashboard/us"):
                r = client.get(path, params={"category": f"attack{i}"})
                assert r.status_code == 200
                assert r.json()["rankings"] == [], "순위표를 만들어 실어 보내고 있다"
        assert 순위칸수() - 전 == 0, \
            f"임의 category 60회로 순위 캐시가 {순위칸수() - 전}건 늘었다"

    def test_임의_카테고리로_캐시가_늘지_않는다(self, client):
        from app.core.cache import cache
        전 = cache.size()
        for i in range(30):
            client.get("/api/v1/dashboard/rankings/kr", params={"category": f"junk{i}"})
        assert cache.size() - 전 == 0, \
            f"임의 카테고리 30회로 캐시가 {cache.size() - 전}건 늘었다"

    def test_허용_목록이_실제_구현과_맞는다(self):
        # 목록에서 빠뜨리면 정상 기능이 422 가 된다
        from app.services.ranking_service import NAVER_SISE_PAGES, DERIVED_CATEGORIES
        assert set(ALLOWED_CATEGORIES) == set(NAVER_SISE_PAGES) | DERIVED_CATEGORIES


class Test요청_제한:
    def test_미들웨어가_등록돼_있다(self):
        """이게 없으면 Limiter 의 default_limits 가 아무 데도 적용되지 않는다."""
        from slowapi.middleware import SlowAPIMiddleware
        assert any(m.cls is SlowAPIMiddleware for m in app.user_middleware), \
            "SlowAPIMiddleware 가 없다 — default_limits 가 실제로는 무효다"

    def test_한도가_정상_사용을_막지_않을_만큼_넉넉하다(self):
        """대시보드 한 번 열면 8건 넘게 나가고, 화면 몇 개 넘기면 금방 쌓인다.
        프록시 뒤에서 IP 가 하나로 보이면 이 값이 서비스 전체 상한이 된다."""
        # slowapi 내부 구조에 기대지 않고 소스에 적힌 값을 읽는다 —
        # LimitGroup 은 버전마다 모양이 달라 문자열 파싱이 깨지기 쉽다
        import re
        import inspect as _i
        import app.main as m
        src = _i.getsource(m)
        found = re.search(r'default_limits=\["(\d+)/minute"\]', src)
        assert found, "기본 한도를 찾을 수 없다"
        n = int(found.group(1))
        assert n >= 200, f"기본 한도 {n}/분은 정상 사용자를 막을 수 있다"


class Test응답_다이어트:
    def test_요청하지_않은_뉴스를_싣지_않는다(self, client):
        """화면은 이 필드를 안 쓰고 /dashboard/news/kr 로 따로 받는다.
        예전에는 include_news=False 인데도 캐시에서 최대 80건을 꺼내 보냈다.

        반드시 캐시를 채워 놓고 확인해야 한다. 비어 있으면 옛 코드로 되돌려도
        결과가 []라서 테스트가 그냥 통과한다 — 실제로 그렇게 놓쳤다."""
        from app.core.cache import cache
        기사 = [{"title": f"기사{i}", "link": f"https://x/{i}", "source": "테스트",
                "published": "2026-07-30T00:00:00", "image": ""} for i in range(80)]
        for mkt in ("kr", "us"):
            cache.set(f"news:{mkt}", list(기사), 300)
        try:
            for path in ("/api/v1/dashboard/kr", "/api/v1/dashboard/us"):
                r = client.get(path)
                assert r.status_code == 200
                assert r.json()["news"] == [], \
                    f"{path} 가 요청하지도 않은 뉴스 {len(r.json()['news'])}건을 실어 보낸다"
        finally:
            for mkt in ("kr", "us"):
                cache.delete(f"news:{mkt}")

    def test_요청하면_실어_보낸다(self, client):
        r = client.get("/api/v1/dashboard/kr", params={"include_news": "true"})
        assert r.status_code == 200
        assert "news" in r.json()
