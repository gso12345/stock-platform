"""시세·지수는 **값이 바뀌면 곧바로** 화면에 간다.

예전에는 '몇 초마다 보낸다' 였고 그 바닥이 시세 10초·지수 15초로 박혀
있었다. 서버가 새 값을 받아 와도 화면에는 10~15초 뒤에야 떴다. 이제는
1초마다 캐시를 보고 바뀌었을 때만 보낸다.
"""
import asyncio
import json

import pytest

from app.api.websocket import price_stream as P
from app.core.cache import cache
from app.services import market_hours as mh


class 가짜소켓:
    def __init__(self):
        self.보낸것 = []
        self.client = None

    async def accept(self):
        pass

    async def send_text(self, t):
        self.보낸것.append(json.loads(t))


@pytest.fixture
def 빠르게(monkeypatch):
    monkeypatch.setattr(P, "살피는_간격", 0.01)
    monkeypatch.setattr(P, "최소_전송_간격", 10.0)


async def _돌리기(만들기, 초, 사이에=None):
    ws = 가짜소켓()
    할일 = asyncio.create_task(P._바뀔때_보내기(ws, 만들기, "prices"))
    if 사이에:
        await 사이에(ws)
    await asyncio.sleep(초)
    할일.cancel()
    try:
        await 할일
    except asyncio.CancelledError:
        pass
    return ws.보낸것


def test_값이_안_바뀌면_처음_한_번만_보낸다(빠르게):
    보낸것 = asyncio.run(_돌리기(lambda: [{"symbol": "A", "price": 1}], 0.2))
    assert len(보낸것) == 1


def test_값이_바뀌면_곧바로_보낸다(빠르게):
    값 = {"p": 1}

    async def 사이에(ws):
        await asyncio.sleep(0.05)
        값["p"] = 2
        await asyncio.sleep(0.05)
        assert ws.보낸것[-1]["data"][0]["price"] == 2, "바뀐 값이 1초 안에 안 갔다"

    보낸것 = asyncio.run(_돌리기(lambda: [{"symbol": "A", "price": 값["p"]}], 0.05, 사이에))
    assert [m["data"][0]["price"] for m in 보낸것] == [1, 2]


def test_나이만_늘어난_것은_바뀐_것으로_치지_않는다(빠르게):
    """age 는 매초 늘어난다 — 이걸 비교에 넣으면 1초마다 보내게 된다"""
    몇초 = {"n": 0}

    def 만들기():
        몇초["n"] += 1
        return [{"symbol": "A", "price": 1, "age": 몇초["n"]}]

    assert len(asyncio.run(_돌리기(만들기, 0.2))) == 1


def test_안_바뀌어도_가끔은_보낸다(monkeypatch):
    """연결이 살아 있다는 표시이자, '몇 초 전 값' 을 화면이 새로 그리도록"""
    monkeypatch.setattr(P, "살피는_간격", 0.01)
    monkeypatch.setattr(P, "최소_전송_간격", 0.05)
    assert len(asyncio.run(_돌리기(lambda: [{"symbol": "A", "price": 1}], 0.2))) >= 3


def test_시세_스트림이_캐시_변화를_곧바로_보낸다(빠르게, monkeypatch):
    """실제 stream_prices 를 돌려 본다 — 캐시에 새 값이 들어가면 나간다"""
    async def 구독(pairs): pass
    monkeypatch.setattr(P.watched, "subscribe", 구독)
    monkeypatch.setattr(P.watched, "unsubscribe", 구독)
    cache.set("price:RTTEST", {"symbol": "RTTEST", "price": 10.0}, 60)

    async def 본판():
        ws = 가짜소켓()
        할일 = asyncio.create_task(P.stream_prices(ws, ["RTTEST"], ["US"], interval=15))
        await asyncio.sleep(0.05)
        cache.set("price:RTTEST", {"symbol": "RTTEST", "price": 11.0}, 60)
        await asyncio.sleep(0.05)
        할일.cancel()
        try:
            await 할일
        except asyncio.CancelledError:
            pass
        return ws.보낸것

    보낸것 = asyncio.run(본판())
    cache.delete("price:RTTEST")
    assert [m["data"][0]["price"] for m in 보낸것] == [10.0, 11.0]
    assert "sent_at" in 보낸것[-1]


def test_지수_스트림도_바뀔_때_보낸다(빠르게):
    async def 본판():
        ws = 가짜소켓()
        할일 = asyncio.create_task(P.stream_indices(ws, interval=30))
        await asyncio.sleep(0.1)
        할일.cancel()
        try:
            await 할일
        except asyncio.CancelledError:
            pass
        return ws.보낸것

    보낸것 = asyncio.run(본판())
    assert len(보낸것) == 1 and 보낸것[0]["type"] == "indices"


def test_장중에는_5초마다_받아_온다():
    assert mh.refresh_interval(["regular"]) <= 5
    assert mh.refresh_interval(["pre"]) <= 15 and mh.refresh_interval(["after"]) <= 15
    #: 종목이 많으면 초당 요청 상한에 맞춰 늘어난다 — 차단 방지 장치는 그대로
    assert 200 / mh.refresh_interval(["regular"], symbol_count=200) <= mh.MAX_REQ_PER_SEC + 0.5
