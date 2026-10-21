"""
사용자: "대시보드 국내에는 원달러환율 밖에 안나와"

국내 금리 목록이 한 번도 안 채워졌다. 원천 하나인 pykrx 가 KRX 에 물을 때 시간
상한이 없어(webio 의 requests.get·post 에 timeout 이 없다), KRX 가 답을 안 주면
목록 만들기가 그 자리에서 끝없이 멈췄다. '받는 중' 표시도 안 풀려 아무도 다시
받지 않았고, 주기 갱신 루프도 같은 자리를 기다리느라 뒤의 갱신까지 섰다.
원/달러는 다른 길(실시간 환율)로 오니 그것만 남았다.
"""
import asyncio
import threading
import time

import pytest

from app.core import fetchcache, pykrx_light
from app.core.cache import cache
from app.services.market import market_extras as M


@pytest.fixture(autouse=True)
def _비우기():
    M._응답기록.clear()
    M._금리진단.clear()
    cache.delete("extra:kr_rates")
    yield
    cache.delete("extra:kr_rates")


def _원천_막기(monkeypatch):
    """금리 원천을 모두 '아무것도 안 줌' 으로"""
    for 이름, 가짜 in {
        "_fetch_kr_rates_naver": lambda: ([], None),
        "_fetch_kr_rates_시장지표": lambda: [],
        "_fetch_bok_rates_ecos": lambda: (None, []),
        "_fetch_kr_bonds_pykrx": lambda: ([], None, []),
        "_fetch_bok_그밖_ecos": lambda: [],
    }.items():
        monkeypatch.setattr(M, 이름, 가짜)
    monkeypatch.setattr(M, "_환율_채워두기", lambda: None)
    monkeypatch.setattr(M, "get_vkospi", lambda: None)


def test_pykrx_는_묻기마다_시간_상한을_둔다(monkeypatch):
    import requests
    받은: list = []
    monkeypatch.setattr(requests, "get", lambda url, **k: 받은.append(k) or "응답")
    monkeypatch.setattr(requests, "post", lambda url, **k: 받은.append(k) or "응답")
    pykrx_light.bond()
    from pykrx.website.comm import webio
    assert webio.requests.get("http://data.krx.co.kr", params={}) == "응답"
    webio.requests.post("http://data.krx.co.kr", data={}, timeout=3)
    assert 받은[0]["timeout"] == pykrx_light.PYKRX_TIMEOUT, "상한 없이 물었다"
    assert 받은[1]["timeout"] == 3, "따로 준 상한을 덮었다"
    pykrx_light.stock()
    assert not isinstance(webio.requests._원래, pykrx_light._상한요청), "두 번 씌웠다"
    assert webio.requests.codes is requests.codes, "requests 의 다른 것은 그대로 써야 한다"


def test_KRX_가_답을_안_줘도_나머지로_목록을_채운다(monkeypatch):
    _원천_막기(monkeypatch)
    풀림 = threading.Event()
    monkeypatch.setattr(M, "_fetch_kr_bonds_pykrx", lambda: (풀림.wait(10), ([], None, []))[1])
    monkeypatch.setattr(M, "get_vkospi", lambda: (풀림.wait(10), None)[1])
    monkeypatch.setattr(M, "느린원천_상한", 0.2)
    try:
        t = time.time()
        rates = M._do_fetch_kr_rates()
        assert time.time() - t < 3, "답 없는 원천을 끝까지 기다렸다"
        assert any("기준금리" in r["name"] for r in rates)
        assert cache.get("extra:kr_rates"), "목록을 담지 못했다 — 대시보드가 계속 빈다"
        assert "TimeoutError" in M.금리진단()["KRX 장외채권(pykrx)"]["결과"], "왜 빠졌는지 관리자 화면에"
    finally:
        풀림.set()


def test_받는_중_표시가_오래되면_다시_받는다():
    ck = "시험:멈춘받기"
    fetchcache.잊기(ck)
    불림: list = []
    try:
        fetchcache._받는중[ck] = time.time()                       # 방금 누가 받기 시작했다
        assert fetchcache.캐시_우선(ck, lambda: 불림.append(1) or [1], []) == []
        assert 불림 == [], "받는 중인데 또 받았다"
        fetchcache._받는중[ck] = time.time() - fetchcache.받는중_상한 - 1   # 그 일이 멈춰 버렸다
        assert fetchcache.캐시_우선(ck, lambda: 불림.append(1) or [1], []) == [1]
        assert 불림 == [1], "멈춘 받기 때문에 영영 다시 받지 않았다"
    finally:
        fetchcache.잊기(ck)


def test_대시보드_배경_채우기도_멈췄으면_다시_띄운다():
    from app.api.routes import dashboard as D
    불림: list = []

    async def 시험():
        D._bg_refresh_in_flight["시험표"] = time.time()            # 지금 채우는 중
        D.받아둔것만("시험:비어있음", lambda: 불림.append("새로"), "시험표")
        await asyncio.sleep(0.2)
        assert 불림 == [], "채우는 중인데 또 띄웠다"
        D._bg_refresh_in_flight["시험표"] = time.time() - D.배경채우기_상한 - 1
        D.받아둔것만("시험:비어있음", lambda: 불림.append("다시"), "시험표")
        await asyncio.sleep(0.2)

    try:
        asyncio.run(시험())
        assert 불림 == ["다시"], "멈춘 채우기 때문에 영영 다시 띄우지 않았다"
        assert "시험표" not in D._bg_refresh_in_flight, "끝나면 표시를 지운다"
    finally:
        D._bg_refresh_in_flight.pop("시험표", None)


def test_주기_루프는_국내_금리를_끝없이_기다리지_않고_겹쳐_띄우지_않는다(monkeypatch):
    from app.services import scheduler as SC
    풀림 = threading.Event()
    불림: list = []
    monkeypatch.setattr(M, "_do_fetch_kr_rates", lambda: (불림.append(1), 풀림.wait(10)))
    monkeypatch.setattr(SC, "국내금리_상한", 0.2)
    monkeypatch.setattr(SC, "_국내금리일", None)

    async def 시험():
        t = time.time()
        await SC.국내금리_갱신()
        assert time.time() - t < 2, "주기 루프가 국내 금리를 끝없이 기다렸다"
        await SC.국내금리_갱신()
        assert 불림 == [1], "앞선 갱신이 아직 도는데 또 띄웠다 — 멈춘 스레드가 쌓인다"
        풀림.set()
        await asyncio.sleep(0.2)
        await SC.국내금리_갱신()
        assert 불림 == [1, 1], "앞선 갱신이 끝났는데 다시 띄우지 않았다"

    try:
        asyncio.run(시험())
    finally:
        풀림.set()
