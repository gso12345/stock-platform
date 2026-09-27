"""소셜 로그인 버튼은 **끝까지 로그인할 수 있을 때만** 켠다.

버튼만 있고 설정이 덜 됐으면 누른 사람은 오류 화면으로 간다:
  · client_id 없음 → 404
  · 비밀키 없음 → 공급자 화면까지 갔다가 돌아와서 토큰 교환 실패
  · 돌아올 주소가 localhost → 배포 서버에서 누르면 자기 컴퓨터로 튕김
"""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.core import oauth
from app.core.config import settings


@pytest.fixture
def client():
    return TestClient(app, base_url="https://api.example.com")


@pytest.fixture
def 설정(monkeypatch):
    def 바꾸기(공급자, id="", secret="", 돌아올곳="https://api.example.com"):
        monkeypatch.setitem(oauth.PROVIDERS[공급자], "client_id", id)
        monkeypatch.setitem(oauth.PROVIDERS[공급자], "client_secret", secret)
        monkeypatch.setattr(settings, "OAUTH_REDIRECT_BASE", 돌아올곳)
    for p in oauth.PROVIDERS:
        monkeypatch.setitem(oauth.PROVIDERS[p], "client_id", "")
        monkeypatch.setitem(oauth.PROVIDERS[p], "client_secret", "")
    return 바꾸기


def _켜진것(client):
    r = client.get("/api/v1/auth/oauth/providers")
    assert r.status_code == 200
    return r.json()["providers"]


def test_아무것도_설정_안하면_하나도_안_켜진다(client, 설정):
    assert _켜진것(client) == []


def test_열쇠와_비밀키가_다_있으면_켜진다(client, 설정):
    설정("google", id="g", secret="s")
    assert _켜진것(client) == ["google"]


def test_비밀키가_없으면_안_켜진다__카카오만_예외(client, 설정):
    설정("naver", id="n")
    설정("kakao", id="k")
    assert _켜진것(client) == ["kakao"]


def test_돌아올_주소가_localhost면_배포서버에서는_안_켜진다(client, 설정):
    설정("google", id="g", secret="s", 돌아올곳="http://localhost:8000")
    assert _켜진것(client) == []


def test_내_컴퓨터에서_돌릴때는_localhost여도_켜진다(설정):
    설정("google", id="g", secret="s", 돌아올곳="http://localhost:8000")
    로컬 = TestClient(app, base_url="http://localhost:8000")
    assert _켜진것(로컬) == ["google"]


def test_안_켜진_공급자로_로그인을_시작하면_404(client, 설정):
    설정("naver", id="n")      # 비밀키 없음
    r = client.get("/api/v1/auth/oauth/naver/login", follow_redirects=False)
    assert r.status_code == 404


def test_켜진_공급자는_공급자_화면으로_보낸다(client, 설정):
    설정("google", id="g", secret="s")
    r = client.get("/api/v1/auth/oauth/google/login", follow_redirects=False)
    assert r.status_code in (302, 307)
    assert r.headers["location"].startswith("https://accounts.google.com/")
    assert "redirect_uri=https%3A%2F%2Fapi.example.com%2Fapi%2Fv1%2Fauth%2Foauth%2Fgoogle%2Fcallback" in r.headers["location"]
