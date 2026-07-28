"""
지금 누군가 화면에서 보고 있는 종목 목록.

시세를 자주 갱신하려면 '무엇을' 갱신할지부터 좁혀야 한다. 지금까지는
스케줄러가 모든 사용자의 포트폴리오·관심종목을 통째로(1년째 로그인 안 한
사용자 것까지) 5분마다 긁어왔다. 그래서 주기를 줄일 수가 없었다 —
사용자 1000명이면 한 사이클에 네이버로만 약 2,900회가 나간다.

WebSocket이 열려 있다는 건 그 종목을 지금 누가 보고 있다는 뜻이다.
그 집합만 갱신하면 호출량이 한 자릿수 배로 줄고, 그만큼 주기를 당길 수 있다.

연결이 닫히면 참조를 빼고, 참조가 0이 되면 목록에서 사라진다.
"""
from __future__ import annotations

import asyncio
from collections import defaultdict

# symbol -> 이 종목을 보고 있는 연결 수
_refcount: dict[str, int] = defaultdict(int)
# symbol -> market (마지막으로 관측한 값)
_market_of: dict[str, str] = {}
_lock = asyncio.Lock()

# 한 번에 갱신할 최대 종목 수. 접속자가 몰려도 외부 API 호출이 무한정
# 늘어나지 않도록 상한을 둔다. 넘치면 참조가 많은(=많이 보고 있는) 종목 우선.
MAX_WATCHED = 300


async def subscribe(pairs: list[tuple[str, str]]) -> None:
    async with _lock:
        for sym, mkt in pairs:
            if not sym:
                continue
            _refcount[sym] += 1
            _market_of[sym] = mkt


async def unsubscribe(pairs: list[tuple[str, str]]) -> None:
    async with _lock:
        for sym, _ in pairs:
            if not sym or sym not in _refcount:
                continue
            _refcount[sym] -= 1
            if _refcount[sym] <= 0:
                _refcount.pop(sym, None)
                _market_of.pop(sym, None)


def snapshot() -> list[tuple[str, str]]:
    """지금 보고 있는 (종목, 시장) 목록 — 많이 보는 순.

    락 없이 읽는다. 갱신 태스크가 한 틱 늦게 반영해도 문제가 없고,
    매 틱 락을 잡으면 연결/해제가 밀린다."""
    items = sorted(_refcount.items(), key=lambda kv: -kv[1])[:MAX_WATCHED]
    return [(sym, _market_of.get(sym, "US")) for sym, _ in items]


def stats() -> dict:
    return {"symbols": len(_refcount), "connections": sum(_refcount.values())}
