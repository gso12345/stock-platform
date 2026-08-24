"""방문자 수를 실제로 세는가.

수익화를 정하려고 숫자를 보러 갔다가 알았다 — 여기는 **로그인한 사람만**
세고 있었다. mark_active 를 부르는 자리가 'Authorization 헤더가 있을 때'
안에 들어 있었기 때문이다.

이 사이트는 로그인 없이도 대시보드·종목 상세·뉴스를 다 볼 수 있다.
즉 방문자의 대부분이 통째로 안 보였다. 광고든 증권사 제휴든 심사에서
묻는 것은 가입자 수가 아니라 방문자 수라, 이 숫자가 없으면 아무것도
시작할 수 없다.
"""
import time

import pytest
from fastapi.testclient import TestClient

from app.core import activity as A


@pytest.fixture(autouse=True)
def _비우기():
    def _싹():
        A._daily.clear()
        A._daily_로그인.clear()
        A._daily_요청.clear()
        A._last_seen.clear()
        A._db_base.clear()
    _싹()
    yield
    _싹()


@pytest.fixture
def 서버():
    from app.main import app
    with TestClient(app) as c:
        yield c


def _보기(c, ip: str, ua: str = "Mozilla/5.0 TestAgent", 경로: str = "/api/v1/dashboard/indices"):
    """프록시 뒤에서 온 요청 하나. Render 가 그렇다."""
    return c.get(경로, headers={"X-Forwarded-For": f"{ip}, 10.0.0.1", "User-Agent": ua})


class Test비로그인_방문자:
    def test_로그인_안_해도_세어진다(self, 서버):
        """여기가 고친 자리다. 예전에는 0 이었다."""
        _보기(서버, "203.0.113.10")
        assert A.오늘_방문_요약()["방문자"] == 1
        assert A.오늘_방문_요약()["비로그인"] == 1

    def test_한_사람이_여러_화면을_봐도_한_명이다(self, 서버):
        """화면 하나를 열면 API 를 여러 번 부른다. 그걸 다 세면
        방문자 수가 열 배로 부풀어 심사에서 되레 신뢰를 잃는다."""
        for 경로 in ("/api/v1/dashboard/indices", "/api/v1/dashboard/news/kr",
                     "/api/v1/dashboard/rankings/us", "/api/v1/dashboard/kr/rates"):
            _보기(서버, "203.0.113.10", 경로=경로)
        요약 = A.오늘_방문_요약()
        assert 요약["방문자"] == 1
        assert 요약["요청수"] == 4, "요청 수는 따로 세어야 한다"

    def test_다른_사람은_따로_세어진다(self, 서버):
        for ip in ("203.0.113.10", "203.0.113.20", "198.51.100.5"):
            _보기(서버, ip)
        assert A.오늘_방문_요약()["방문자"] == 3

    def test_같은_주소라도_브라우저가_다르면_다른_사람(self, 서버):
        """집 공유기 하나로 식구 여럿이 볼 수 있다."""
        _보기(서버, "203.0.113.10", ua="Chrome/120")
        _보기(서버, "203.0.113.10", ua="Safari/17")
        assert A.오늘_방문_요약()["방문자"] == 2

    def test_프록시_주소로_뭉뚱그리지_않는다(self, 서버):
        """Render 는 프록시 뒤에 있다. X-Forwarded-For 를 안 보면
        방문자 전부가 프록시 한 대로 세어져 늘 '1명' 이 된다."""
        for ip in ("203.0.113.10", "203.0.113.20", "198.51.100.5"):
            서버.get("/api/v1/dashboard/indices",
                     headers={"X-Forwarded-For": f"{ip}, 10.0.0.1"})
        assert A.오늘_방문_요약()["방문자"] == 3


class Test로그인한_사람:
    def test_계정으로_세어_기기를_옮겨도_한_명이다(self):
        """휴대폰에서 보다가 노트북으로 옮기면 지문이 달라진다.
        같은 사람이 두 명으로 세어지면 안 된다."""
        A.mark_visit(42, "1.1.1.1", "휴대폰")
        A.mark_visit(42, "2.2.2.2", "노트북")
        요약 = A.오늘_방문_요약()
        assert 요약["방문자"] == 1
        assert 요약["로그인"] == 1
        assert 요약["비로그인"] == 0

    def test_로그인과_비로그인을_갈라_준다(self):
        """구독은 로그인한 사람에게만 팔 수 있고, 광고·제휴는 둘 다에게
        걸린다. 나눠 보이지 않으면 어느 쪽을 먼저 할지 정할 수 없다."""
        A.mark_visit(42, "1.1.1.1", "브라우저")
        A.mark_visit(None, "3.3.3.3", "브라우저")
        A.mark_visit(None, "4.4.4.4", "브라우저")
        요약 = A.오늘_방문_요약()
        assert (요약["방문자"], 요약["로그인"], 요약["비로그인"]) == (3, 1, 2)


class Test사람이_아닌_것:
    def test_헬스체크는_안_센다(self, 서버):
        """Render 가 몇 분마다 두드린다. 이걸 세면 아무도 안 왔는데도
        방문자가 하루 수백 명으로 뜬다."""
        for _ in range(5):
            서버.get("/health")
        assert A.오늘_방문_요약()["방문자"] == 0
        assert A.오늘_방문_요약()["요청수"] == 0


class Test개인을_알아보지_못하게:
    def test_지문에_주소가_안_들어_있다(self):
        지문 = A._지문("203.0.113.10", "Chrome/120", "2026-08-24")
        assert "203.0.113.10" not in 지문
        assert "Chrome" not in 지문

    def test_날이_바뀌면_지문이_이어지지_않는다(self):
        """소금이 매일 바뀌므로 '몇 명이 왔나' 는 알 수 있고
        '누가 계속 오나' 는 알 수 없다. 우리에게 필요한 건 앞의 것뿐이다."""
        어제 = A._지문("203.0.113.10", "Chrome/120", "2026-08-23")
        오늘 = A._지문("203.0.113.10", "Chrome/120", "2026-08-24")
        assert 어제 != 오늘

    def test_같은_날_같은_사람은_같은_지문이다(self):
        가 = A._지문("203.0.113.10", "Chrome/120", "2026-08-24")
        나 = A._지문("203.0.113.10", "Chrome/120", "2026-08-24")
        assert 가 == 나


class Test서버가_안_죽게:
    def test_지문을_무한정_쌓지_않는다(self, monkeypatch):
        """512MB 짜리 서버다. 세는 정확도보다 안 죽는 게 우선이다."""
        monkeypatch.setattr(A, "MAX_FINGERPRINTS", 10)
        for i in range(50):
            A.mark_visit(None, f"10.0.0.{i}", "브라우저")
        요약 = A.오늘_방문_요약()
        assert 요약["방문자"] == 10
        assert 요약["지문한도_도달"] is True
        assert 요약["요청수"] == 50, "한도에 걸려도 요청 수는 그대로 센다"

    def test_지난_날은_메모리에서_비운다(self):
        """날마다 지문 집합이 하나씩 쌓인다. 지난 날 숫자는 DB 에 이미
        넘어가 있으므로 메모리에 들고 있을 이유가 없다."""
        A._daily["2020-01-01"] = {"a1", "a2"}
        A._daily_로그인["2020-01-01"] = {"u1"}
        A._daily_요청["2020-01-01"] = 99
        A._오래된날_버리기()
        assert "2020-01-01" not in A._daily
        assert "2020-01-01" not in A._daily_로그인
        assert "2020-01-01" not in A._daily_요청

    def test_접속중_목록도_같이_비운다(self):
        """여기는 방문자마다 한 칸씩 쌓이는데, 지우는 자리가
        online_count() 안에만 있었다 — 관리자 화면을 안 열면 영영
        안 지워진다."""
        A._last_seen["오래된것"] = time.monotonic() - A.ONLINE_WINDOW - 10
        A._last_seen["방금것"] = time.monotonic()
        A._오래된날_버리기()
        assert "오래된것" not in A._last_seen
        assert "방금것" in A._last_seen


class Test관리자_화면에_나오는가:
    def test_stats_응답에_방문_요약이_실린다(self):
        from app.api.routes import admin
        import inspect
        본문 = inspect.getsource(admin.get_stats)
        assert "오늘_방문_요약" in 본문
        assert '"visits"' in 본문
