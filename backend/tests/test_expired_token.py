"""
만료된 토큰으로 부르면 '빈 목록'이 아니라 401 이어야 한다.

사용자가 "기존 계정에 있는 관심종목 데이터가 날라갔어" 라고 알려온 일이
있었다. 확인해보니 데이터는 DB 에 그대로 있었다. 토큰이 더 이상 유효하지
않았을 뿐인데, 서버가 그것을 '비로그인'으로 취급해 게스트(user_id=None)
관심목록 — 즉 빈 목록 — 을 200 으로 돌려주고 있었다. 브라우저는 여전히
로그인한 것처럼 보이므로, 사용자 눈에는 전부 사라진 것으로 읽혔다.

'토큰이 없다'와 '토큰이 있는데 못 쓴다'는 완전히 다른 상황이다. 앞은
비로그인 미리보기가 정상 동작이고, 뒤는 다시 로그인해야 한다는 뜻이다.
"""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.core.security import create_access_token


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def 사용자(client):
    """가입 → 관심종목 3개를 담아 둔 계정"""
    이름 = "tok_expired_user"
    client.post("/api/v1/auth/register", json={
        "username": 이름, "password": "Passw0rd!23", "email": f"{이름}@x.com"})
    r = client.post("/api/v1/auth/login", json={"username": 이름, "password": "Passw0rd!23"})
    tok = r.json()["access_token"]
    H = {"Authorization": f"Bearer {tok}"}
    for s in ("005930", "000660", "AAPL"):
        client.post("/api/v1/watchlist/items", headers=H,
                    json={"symbol": s, "market": "KR", "name": s, "watchlist_id": 1})
    return {"token": tok, "headers": H}


# 서명이 맞지 않는 토큰 (시크릿이 바뀐 상황과 같다)
위조_토큰 = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.aaaaaaaaaaaaaaaa"


class Test만료된_토큰:
    def test_정상_토큰은_내_종목을_돌려준다(self, client, 사용자):
        r = client.get("/api/v1/watchlist/items", headers=사용자["headers"])
        assert r.status_code == 200
        assert {i["symbol"] for i in r.json()} == {"005930", "000660", "AAPL"}

    @pytest.mark.parametrize("경로", [
        "/api/v1/watchlist/items",
        "/api/v1/watchlist/folders",
        "/api/v1/watchlist/",
    ])
    def test_못_쓰는_토큰이면_빈_목록_대신_401(self, client, 사용자, 경로):
        """여기서 200 + [] 를 돌려주면 사용자는 '데이터가 지워졌다'고 읽는다."""
        r = client.get(경로, headers={"Authorization": f"Bearer {위조_토큰}"})
        assert r.status_code == 401, (
            f"{경로} 가 {r.status_code} 를 돌려줬다 — "
            f"만료된 토큰에 빈 목록을 주면 데이터가 사라진 것처럼 보인다: {r.text[:200]}")

    def test_기한이_지난_진짜_토큰도_401(self, client, 사용자):
        from datetime import timedelta
        옛날 = create_access_token({"sub": "1"}, expires_delta=timedelta(seconds=-10))
        r = client.get("/api/v1/watchlist/items", headers={"Authorization": f"Bearer {옛날}"})
        assert r.status_code == 401

    def test_없는_사용자를_가리키는_토큰도_401(self, client):
        """토큰 서명은 멀쩡한데 그 계정이 없는 경우 — 탈퇴했거나 DB 가 바뀌었다"""
        유령 = create_access_token({"sub": "99999999"})
        r = client.get("/api/v1/watchlist/items", headers={"Authorization": f"Bearer {유령}"})
        assert r.status_code == 401

    def test_401_이_왜_그런지_알려준다(self, client):
        r = client.get("/api/v1/watchlist/items", headers={"Authorization": f"Bearer {위조_토큰}"})
        assert "로그인" in r.json().get("detail", "")

    def test_데이터는_그대로_있다(self, client, 사용자):
        """401 을 받은 뒤 다시 로그인하면 종목이 그대로 보여야 한다.
        '사라진 것처럼 보였을 뿐'이라는 것이 이 문제의 핵심이다."""
        client.get("/api/v1/watchlist/items", headers={"Authorization": f"Bearer {위조_토큰}"})
        r = client.get("/api/v1/watchlist/items", headers=사용자["headers"])
        assert {i["symbol"] for i in r.json()} == {"005930", "000660", "AAPL"}


class Test비로그인은_계속_열려_있다:
    """토큰이 아예 없는 것은 잘못이 아니다 — 미리보기가 정상 동작이다."""

    @pytest.mark.parametrize("경로", [
        "/api/v1/watchlist/items",
        "/api/v1/watchlist/folders",
        "/api/v1/dashboard/indices",
    ])
    def test_토큰이_없으면_401_이_아니다(self, client, 경로):
        r = client.get(경로)
        assert r.status_code != 401, f"{경로} 가 비로그인 방문자를 막는다"

    def test_형식이_깨진_인증_헤더는_토큰_없음으로_본다(self, client):
        """'Bearer' 형식이 아니면 HTTPBearer 가 걸러낸다 — 그건 미인증이지
        '만료'가 아니다"""
        r = client.get("/api/v1/watchlist/items", headers={"Authorization": "Basic abc"})
        assert r.status_code == 200
