"""
WebSocket — 캐시에서만 읽음 (네트워크 호출 없음)
데이터 갱신은 scheduler.py가 담당

연결이 열려 있는 동안 그 종목을 watched 레지스트리에 등록한다. 스케줄러는
그 목록만 빠르게 갱신하므로, 여기서 등록을 빠뜨리면 해당 종목은 실시간이
아니라 5분짜리 느린 경로로 떨어진다.
"""
import asyncio
import json
import logging
import time
from collections import defaultdict
from fastapi import WebSocket, WebSocketDisconnect
from app.core.cache import cache
from app.services.yf_service import INDEX_NAMES
from app.services import watched

log = logging.getLogger(__name__)

_ws_connections: dict[str, int] = defaultdict(int)
_ws_lock = asyncio.Lock()
# 한 IP가 열 수 있는 최대 WebSocket 수.
#
# Render처럼 프록시 뒤에 있으면 모든 사용자의 client.host가 프록시 주소로
# 동일하게 잡혀, 이 값이 'IP당'이 아니라 '서비스 전체' 상한으로 작동한다.
# 그 상태에서 10이면 11번째 접속자부터 시세를 아예 못 받는다.
# uvicorn에 --forwarded-allow-ips 를 주어 실제 IP를 보게 하되(render.yaml),
# 설정이 빠진 환경에서도 서비스가 죽지 않도록 상한 자체를 넉넉히 잡는다.
MAX_WS_PER_IP = 200

# 이 나이를 넘긴 캐시는 '멈춘 값'으로 표시해 내보낸다.
# 외부 API가 막혀 갱신이 끊겨도 화면은 정상으로 보이던 문제를 드러내기 위한 것이다.
STALE_AFTER_SEC = 180

# 한 연결이 구독할 수 있는 최대 종목 수.
# 스트림 자체는 캐시만 읽으므로 비용이 거의 없지만, 이 종목들이 곧
# '갱신 대상'이 되므로 무한정 열어두지는 않는다.
MAX_STREAM_SYMBOLS = 200

KR_INDICES = ["KOSPI", "KOSDAQ", "KOSPI200"]
US_INDICES = ["SP500", "NASDAQ", "DOW", "SOX", "RUSSELL"]


def _cached_index(name: str) -> dict:
    fresh = cache.get(f"idx:{name}")
    if fresh and fresh.get("value", 0) > 0:
        return fresh
    stale = cache.get_stale(f"idx:{name}")
    if stale and stale.get("value", 0) > 0:
        return stale
    return {"index": name, "name": INDEX_NAMES.get(name, name), "value": 0, "change": 0, "change_rate": 0}


def _cached_price(symbol: str, market: str) -> dict:
    """캐시 값에 '언제 것인지'를 붙여 보낸다.

    예전에는 만료 여부를 구분하지 않고 그대로 내보내, 외부 API가 막혀
    몇 시간 된 값이 반복 전송돼도 화면은 정상 갱신과 똑같아 보였다."""
    data = cache.get_stale(f"price:{symbol}")
    if not data:
        return {"symbol": symbol, "market": market, "price": None, "change_rate": 0}
    age = cache.age(f"price:{symbol}")
    out = {**data, "market": market}
    if age is not None:
        out["age"] = round(age)
        out["stale"] = age > STALE_AFTER_SEC
    return out


def _cached_forex() -> dict:
    """환율·금리 캐시 반환 (WebSocket 실시간 스트림용)"""
    usdkrw = cache.get_stale("extra:usdkrw")
    result: dict = {}
    if usdkrw:
        result["usdkrw"] = usdkrw
    us_rates = cache.get_stale("extra:us_rates")
    if us_rates and isinstance(us_rates, list):
        # 금(Gold) 항목 추출
        gold = next((r for r in us_rates if "금" in r.get("name", "") or "Gold" in r.get("name", "")), None)
        if gold:
            result["gold"] = gold
    return result


async def stream_indices(ws: WebSocket, interval: int = 30):
    client_ip = ws.client.host if ws.client else "unknown"
    async with _ws_lock:
        if _ws_connections[client_ip] >= MAX_WS_PER_IP:
            await ws.close(code=1008)
            return
        _ws_connections[client_ip] += 1
    try:
        # accept()는 반드시 try 안에서 — 밖에 두면 핸드셰이크 실패 시
        # 위에서 올린 카운터가 영원히 안 내려간다
        await ws.accept()
        while True:
            kr = [_cached_index(n) for n in KR_INDICES]
            us = [_cached_index(n) for n in US_INDICES]
            forex = _cached_forex()
            payload = {"kr": kr, "us": us}
            if forex:
                payload["forex"] = forex
            try:
                await ws.send_text(json.dumps({"type": "indices", "data": payload}))
            except Exception:
                break
            await asyncio.sleep(max(interval, 15))
    except WebSocketDisconnect:
        pass
    finally:
        async with _ws_lock:
            _ws_connections[client_ip] = max(0, _ws_connections[client_ip] - 1)


async def stream_prices(ws: WebSocket, symbols: list[str], markets: list[str], interval: int = 15):
    client_ip = ws.client.host if ws.client else "unknown"
    async with _ws_lock:
        if _ws_connections[client_ip] >= MAX_WS_PER_IP:
            await ws.close(code=1008)
            return
        _ws_connections[client_ip] += 1

    pairs = list(zip(symbols, markets))
    subscribed = False
    try:
        # accept()가 try 밖에 있으면 핸드셰이크 도중 끊겼을 때 위에서 올린
        # 카운터가 영원히 안 내려간다. 재접속을 반복하는 사용자가 스스로를
        # 차단하게 되므로 반드시 try 안에서 호출한다.
        await ws.accept()
        # 이 연결이 살아 있는 동안 이 종목들을 '보고 있는 중'으로 등록한다.
        # 스케줄러는 이 목록만 짧은 주기로 갱신한다.
        await watched.subscribe(pairs)
        subscribed = True

        while True:
            results = [_cached_price(s, m) for s, m in zip(symbols, markets)]
            try:
                await ws.send_text(json.dumps({
                    "type": "prices",
                    "data": results,
                    # 화면이 '언제 값인지'를 표시할 수 있도록 서버 시각을 함께 보낸다
                    "sent_at": int(time.time() * 1000),
                }))
            except Exception:
                break
            await asyncio.sleep(max(interval, 10))
    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.debug(f"시세 스트림 종료: {type(e).__name__}")
    finally:
        if subscribed:
            await watched.unsubscribe(pairs)
        async with _ws_lock:
            _ws_connections[client_ip] = max(0, _ws_connections[client_ip] - 1)
