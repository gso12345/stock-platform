"""외부 호출이 SSL 설정을 매번 새로 짓지 않는다.

httpx 는 클라이언트마다 인증서 묶음을 다시 읽는다 — 0.15 CPU 에서 한 번에
0.2초씩 이벤트 루프를 멈췄고, 깨어난 직후 10초 동안만 130번 넘게 그랬다.
app/core/http.py 의 SSL 하나를 모두 넘겨받게 했다. 새 호출이 생길 때
그걸 빠뜨리면 여기서 걸린다.
"""
import ast
import asyncio
import ssl
from pathlib import Path

import httpx
import pytest

APP = Path(__file__).resolve().parents[1] / "app"
#: 클라이언트를 만드는 것들 — httpx.get 등도 속으로 하나 만든다
짓는것 = {"AsyncClient", "Client", "get", "post", "put", "patch", "delete", "head", "request", "stream"}


def _httpx_부르는곳():
    for 파일 in sorted(APP.rglob("*.py")):
        나무 = ast.parse(파일.read_text(encoding="utf-8-sig"))  # BOM 붙은 파일이 있다
        for 마디 in ast.walk(나무):
            if (isinstance(마디, ast.Call) and isinstance(마디.func, ast.Attribute)
                    and isinstance(마디.func.value, ast.Name)
                    and 마디.func.value.id in ("httpx", "_httpx")
                    and 마디.func.attr in 짓는것):
                yield 파일.relative_to(APP.parent), 마디


def test_모든_httpx_호출이_공유_SSL을_넘긴다():
    곳들 = list(_httpx_부르는곳())
    assert len(곳들) > 30, "찾는 방법이 틀렸다 — 서른 곳 넘게 있어야 한다"
    빠진곳 = [f"{파일}:{마디.lineno}" for 파일, 마디 in 곳들
              if not any(k.arg == "verify" for k in 마디.keywords)]
    assert not 빠진곳, f"verify=SSL 이 빠졌다: {빠진곳}"


def test_넘기는_것이_공유_설정이다():
    """verify=True 를 넘기면 결국 또 새로 짓는다 — 이름까지 확인한다."""
    다른것 = []
    for 파일, 마디 in _httpx_부르는곳():
        값 = next(k.value for k in 마디.keywords if k.arg == "verify")
        if not (isinstance(값, ast.Name) and 값.id == "SSL"):
            다른것.append(f"{파일}:{마디.lineno}")
    assert not 다른것, f"공유 SSL 이 아닌 것을 넘긴다: {다른것}"


@pytest.fixture
def 짓기세기(monkeypatch):
    """인증서 묶음을 읽는 횟수를 센다. 바깥으로 나가는 요청은 막는다."""
    횟수 = {"n": 0}
    원래 = ssl.SSLContext.load_verify_locations

    def 세며읽기(self, *a, **k):
        횟수["n"] += 1
        return 원래(self, *a, **k)

    monkeypatch.setattr(ssl.SSLContext, "load_verify_locations", 세며읽기)

    async def 막기(self, request, **k):
        raise httpx.ConnectError("막음", request=request)

    def 막기동기(self, request, **k):
        raise httpx.ConnectError("막음", request=request)

    monkeypatch.setattr(httpx.AsyncClient, "send", 막기)
    monkeypatch.setattr(httpx.Client, "send", 막기동기)
    return 횟수


def test_실제_호출에서_인증서를_다시_읽지_않는다(짓기세기):
    from app.core.http import SSL  # noqa: F401 — 미리 지어 둔다
    from app.services import price_fetcher as pf, news_service as ns
    from app.api.routes import search

    짓기세기["n"] = 0

    async def 여러번():
        await pf.fetch_naver_stock("005930")
        await pf.fetch_naver_prices_light(["005930", "000660"])
        await pf.fetch_naver_index("KOSPI")
        await search._naver_search("삼성")

    asyncio.run(여러번())
    with pytest.raises(Exception):
        ns._parse_feed("https://example.com/rss", "테스트")
    assert 짓기세기["n"] == 0, f"인증서 묶음을 {짓기세기['n']}번 다시 읽었다"


def test_비교_그냥_만들면_매번_읽는다(짓기세기):
    """위 검사가 실제로 무언가를 재고 있는지 — 공유 설정 없이 만들면 센다."""
    httpx.AsyncClient()
    httpx.Client()
    assert 짓기세기["n"] >= 2
