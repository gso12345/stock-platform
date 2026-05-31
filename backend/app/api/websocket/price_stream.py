"""
WebSocket — 캐시에서만 읽음 (네트워크 호출 없음)
데이터 갱신은 scheduler.py가 담당
"""
import asyncio
import json
from collections import defaultdict
from fastapi import WebSocket, WebSocketDisconnect
from app.core.cache import cache
from app.services.yf_service import INDEX_NAMES

_ws_connections: dict[str, int] = defaultdict(int)
MAX_WS_PER_IP = 10  # IP당 최대 WebSocket 연결 수

KR_INDICES = ["KOSPI", "KOSDAQ", "KOSPI200", "KOSDAQ150"]
US_INDICES = ["SP500", "NASDAQ", "DOW", "SOX", "RUSSELL"]


def _cached_index(name: str) -> dict:
    # fresh 캐시 우선 (스케줄러가 갱신한 실제 데이터)
    fresh = cache.get(f"idx:{name}")
    if fresh and fresh.get("value", 0) > 0:
        return fresh
    # stale 캐시 (신선하지 않지만 데모보다 낫다면)
    stale = cache.get_stale(f"idx:{name}")
    if stale and stale.get("value", 0) > 0:
        return stale
    return {"index": name, "name": INDEX_NAMES.get(name, name), "value": 0, "change": 0, "change_rate": 0}


def _cached_price(symbol: str, market: str) -> dict:
    data = cache.get_stale(f"price:{symbol}")
    if data:
        return {**data, "market": market}
    return {"symbol": symbol, "market": market, "price": None, "change_rate": 0}


async def stream_indices(ws: WebSocket, interval: int = 30):
    client_ip = ws.client.host if ws.client else "unknown"
    if _ws_connections[client_ip] >= MAX_WS_PER_IP:
        await ws.close(code=1008)
        return
    _ws_connections[client_ip] += 1
    await ws.accept()
    try:
        while True:
            kr = [_cached_index(n) for n in KR_INDICES]
            us = [_cached_index(n) for n in US_INDICES]
            try:
                await ws.send_text(json.dumps({"type": "indices", "data": {"kr": kr, "us": us}}))
            except Exception:
                break
            await asyncio.sleep(max(interval, 15))
    except WebSocketDisconnect:
        pass
    finally:
        _ws_connections[client_ip] = max(0, _ws_connections[client_ip] - 1)


async def stream_prices(ws: WebSocket, symbols: list[str], markets: list[str], interval: int = 15):
    client_ip = ws.client.host if ws.client else "unknown"
    if _ws_connections[client_ip] >= MAX_WS_PER_IP:
        await ws.close(code=1008)
        return
    _ws_connections[client_ip] += 1
    await ws.accept()
    try:
        while True:
            results = [_cached_price(s, m) for s, m in zip(symbols, markets)]
            try:
                await ws.send_text(json.dumps({"type": "prices", "data": results}))
            except Exception:
                break
            await asyncio.sleep(max(interval, 15))
    except WebSocketDisconnect:
        pass
    finally:
        _ws_connections[client_ip] = max(0, _ws_connections[client_ip] - 1)
