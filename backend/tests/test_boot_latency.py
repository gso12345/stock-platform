"""
첫 요청이 왜 느렸나 — 그 자리들을 못 박는다.

서버가 자다 깨는 일(콜드 스타트)이 없어졌는데도 첫 요청이 느렸다.
실제로 재 보니 원인이 서버가 '일어나는 시간' 이 아니라 아래 셋이었다.

1) 같은 순위표를 한 화면에서 두 번 만들었다
   /dashboard/kr 이 순위표를 만들어 응답에 실었는데, 화면은 그 값을
   한 군데서도 안 읽는다 — 순위 카드는 기준(시가총액·거래량…)을 바꿔
   가며 봐야 해서 /dashboard/rankings/kr 로 따로 받는다. 그래서 대시보드
   한 번에 전 종목 정렬이 두 번 돌고, 그중 한 번은 만들자마자 버려지는
   20KB 를 싱가포르에서 한국까지 날랐다.

2) 오래 걸릴 수 있는 자리에 시간 상한이 없었다
   순위표(KIS·FDR), 뉴스 수집(RSS 여덟 곳), KIS 지수. 셋 다 '있으면
   좋은' 값인데, 늦으면 늦는 만큼 화면 전체가 멈췄다.

3) 놀다 깬 직후에 갱신이 안 돌았다
   10분 넘게 아무도 안 오면 배경 갱신이 쉰다. 그런데 깬 뒤에 실제로
   도는 시점은 counter 배수에 걸릴 때라, 휴장 중에는 최대 10분 뒤였다.
   그동안 처음 들어온 사람은 몇 시간 전 값을 본다.

이 검사들은 '빠른가' 를 재지 않는다(그건 기계 성능에 따라 흔들린다).
**느려질 수 있는 구조가 남아 있는가** 를 본다.
"""
import ast
import asyncio
import inspect
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api.routes import dashboard as D


@pytest.fixture(scope="module")
def client():
    return TestClient(app)


class Test순위표를_두_번_안_만든다:
    def test_kr_은_순위표를_안_싣는다(self, client):
        r = client.get("/api/v1/dashboard/kr")
        assert r.status_code == 200
        assert r.json()["rankings"] == []

    def test_us_도_순위표를_안_싣는다(self, client):
        r = client.get("/api/v1/dashboard/us")
        assert r.status_code == 200
        assert r.json()["rankings"] == []

    def test_칸_자체는_남겨_둔다(self, client):
        """배포가 엇갈려 옛 화면이 새 응답을 받을 수 있다.
        칸을 아예 없애면 그 화면은 없는 값을 읽다 터진다."""
        for path in ("/api/v1/dashboard/kr", "/api/v1/dashboard/us"):
            assert "rankings" in client.get(path).json(), path

    def test_순위_경로는_그대로_준다(self, client):
        """빼는 것은 대시보드 본문에서만이다. 순위 카드가 쓰는 경로까지
        비면 화면에서 순위표가 통째로 사라진다."""
        r = client.get("/api/v1/dashboard/rankings/kr", params={"category": "시가총액"})
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_대시보드_본문이_순위를_부르지_않는다(self):
        """응답만 비우고 계산은 그대로 두면 서버 일은 하나도 안 준다 —
        느린 원인은 20KB 를 나르는 것보다 전 종목을 정렬하는 쪽이다."""
        for fn in (D.get_kr_dashboard, D.get_us_dashboard):
            본문 = inspect.getsource(fn)
            assert "_get_kr_rankings" not in 본문, f"{fn.__name__} 이 아직 순위를 만든다"
            assert "_get_us_rankings_cached" not in 본문, f"{fn.__name__} 이 아직 순위를 만든다"

    def test_응답이_가벼워졌다(self, client):
        """순위표 20KB 가 빠졌는지 실제 크기로 확인한다."""
        본문 = client.get("/api/v1/dashboard/kr").content
        assert len(본문) < 8_000, f"/dashboard/kr 응답이 아직 {len(본문)}바이트다"


class Test오래_걸릴_수_있는_자리에_상한이_있다:
    """상한이 없는 await 를 소스에서 찾는다.

    값을 재는 대신 구조를 본다 — 외부가 늦는 상황은 여기서 못 만든다."""

    @pytest.mark.parametrize("이름,안에있어야할것", [
        ("_get_kr_rankings", "wait_for"),
        ("_get_us_rankings_cached", "wait_for"),
        ("_news_tab", "wait_for"),
        ("_get_kr_index", "wait_for"),
    ])
    def test_상한이_걸려_있다(self, 이름, 안에있어야할것):
        본문 = inspect.getsource(getattr(D, 이름))
        assert 안에있어야할것 in 본문, f"{이름} 에 시간 상한이 없다"

    def test_상한_값이_사람이_기다릴_만하다(self):
        """30초짜리 상한은 상한이 없는 것과 같다."""
        assert 0 < D._RANK_상한 <= 10
        assert 0 < D._뉴스_상한 <= 10
        assert 0 < D._KIS_지수_상한 <= 5

    def test_뉴스_수집은_상한을_넘겨도_계속_돈다(self):
        """shield 없이 취소하면 다음 요청도, 그다음 요청도 처음부터
        RSS 여덟 곳을 다시 돈다 — 영영 캐시가 안 찬다."""
        assert "shield" in inspect.getsource(D._news_tab)

    def test_국내_순위는_신선한_캐시를_KIS_보다_먼저_본다(self):
        """예전에는 KIS 를 먼저 불렀다. 키가 설정돼 있으면 캐시가 아무리
        신선해도 매 요청마다 외부 왕복이 하나씩 붙었다."""
        본문 = inspect.getsource(D._get_kr_rankings)
        캐시자리 = 본문.index("cache.get(f\"rank:kr:")
        KIS자리 = 본문.index("kis_service.get_rankings")
        assert 캐시자리 < KIS자리, "KIS 를 캐시보다 먼저 부른다"


class Test놀다_깨면_바로_갱신한다:
    """스케줄러 루프를 실제로 돌릴 수는 없다(무한 루프에 외부 호출).
    소스를 읽어 '깬 회차에 배수를 안 따지는가' 를 본다."""

    @staticmethod
    def _루프소스() -> str:
        from app.services import scheduler
        return inspect.getsource(scheduler.periodic_refresh)

    def test_쉬는중_표시를_남긴다(self):
        본문 = self._루프소스()
        assert "쉬는중 = True" in 본문, "쉬었다는 사실을 어디에도 안 남긴다"
        assert "방금깼나" in 본문

    @pytest.mark.parametrize("갱신", ["refresh_kr_indices", "refresh_us_indices", "refresh_exchange"])
    def test_깬_회차에는_배수를_안_따진다(self, 갱신):
        """깨어난 뒤 counter 배수를 기다리면, 휴장 중에는 최대 10분이다."""
        본문 = self._루프소스()
        줄들 = 본문.splitlines()
        for i, 줄 in enumerate(줄들):
            if f"await {갱신}()" in 줄:
                조건 = 줄들[i - 1]
                assert "방금깼나" in 조건, f"{갱신} 이 깬 회차에도 배수를 따진다: {조건.strip()}"
                return
        pytest.fail(f"{갱신} 호출을 못 찾았다")

    def test_비싼_것까지_같이_깨우지는_않는다(self):
        """깬 회차에 뉴스·순위표까지 돌리면, 사람이 기다리는 첫 요청과
        정면으로 부딪친다. 값이 싼 것(지수·환율)만 골라야 한다."""
        본문 = self._루프소스()
        for 줄 in 본문.splitlines():
            if "방금깼나" in 줄 and "=" not in 줄:
                assert "refresh_us_stocks" not in 줄 and "get_kr_news" not in 줄

    def test_쉬는중_초기값이_False_다(self):
        """True 로 시작하면 서버가 뜨자마자 '방금 깼다' 가 되어,
        이미 돌고 있는 초기 프리페치와 같은 일을 한 번 더 한다."""
        본문 = self._루프소스()
        assert "쉬는중 = False\n" in 본문.split("while True")[0]


class Test라우트가_실제로_안_막힌다:
    """상한을 넣다가 라우트 자체를 깨뜨리지 않았는지."""

    @pytest.mark.parametrize("path", [
        "/api/v1/dashboard/kr",
        "/api/v1/dashboard/us",
        "/api/v1/dashboard/us/rates",
        "/api/v1/dashboard/news/kr",
        "/api/v1/dashboard/news/us",
        "/api/v1/dashboard/exchange",
    ])
    def test_200_을_준다(self, client, path):
        assert client.get(path).status_code == 200

    def test_뉴스가_늦어도_빈_목록으로_답한다(self, monkeypatch):
        """상한을 넘겼을 때 500 이 나면 화면에 오류 상자가 뜬다.
        빈 목록이면 '기사가 없어요' 로 조용히 지나간다."""
        monkeypatch.setattr(D, "_뉴스_상한", 0.01)

        def 느린수집():
            import time as _t
            _t.sleep(2)
            return []

        monkeypatch.setattr(D, "get_kr_news", 느린수집)
        from app.core.cache import cache
        cache.delete("news:kr")
        결과 = asyncio.run(D._news_tab("kr", "latest", True))
        assert isinstance(결과, list)


class Test프론트가_안_쓰는_값을_안_보낸다:
    """category 를 아직 받고 있으면, 아무 일도 안 하는 값을 계속
    주고받게 된다 — 다음 사람이 '이게 뭐 하는 값이지' 로 시간을 쓴다."""

    def test_kr_us_는_category_를_안_받는다(self):
        for fn in (D.get_kr_dashboard, D.get_us_dashboard):
            assert "category" not in inspect.signature(fn).parameters, fn.__name__

    def test_응답에도_category_가_없다(self, client):
        for path in ("/api/v1/dashboard/kr", "/api/v1/dashboard/us"):
            assert "category" not in client.get(path).json(), path

    def test_모르는_값을_보내도_안_터진다(self, client):
        """옛 화면이 아직 category 를 붙여 보낼 수 있다. 422 로 막으면
        배포가 엇갈리는 동안 대시보드가 통째로 안 뜬다."""
        r = client.get("/api/v1/dashboard/kr", params={"category": "시가총액"})
        assert r.status_code == 200


class Test화면도_두_번_안_부른다:
    """서버에서 빼도 화면이 계속 보내면 응답만 가벼워질 뿐이다."""

    def test_getKR_getUS_가_category_를_안_보낸다(self):
        from pathlib import Path
        소스 = Path(__file__).resolve().parents[2] / "frontend" / "src" / "api" / "stocks.ts"
        글 = 소스.read_text(encoding="utf-8")
        시작 = 글.index("getKR:")
        끝 = 글.index("getRankings:")
        토막 = 글[시작:끝]
        assert "category" not in 토막, "대시보드 호출이 아직 category 를 보낸다"
