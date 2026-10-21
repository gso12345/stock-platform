"""종목 라우트가 다 같이 쓰는 것.

시세를 어디서 어떤 차례로 받아 오는지(국내는 KIS → 캐시 → 네이버 →
순위캐시 → 야후, 해외는 Finnhub → 야후)가 여기 있다. 화면 여러 곳이
같은 폴백을 타야 해서 한곳에 둔다.
"""
import asyncio
import logging

from fastapi import APIRouter
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.core.cache import cache
from app.core.config import settings
from app.services.market.finnhub_service import finnhub_service
from app.services.market.kis_service import kis_service
from app.services.listings.ticker_service import get_fdr_price
from app.services.market.yf_service import yf_service

log = logging.getLogger(__name__)

"""퀀트 지표를 얼마나 오래 신선하다고 볼지.

재무(하루 단위)와 가격(분 단위)이 섞인 값이다. 예전엔 5분이었는데, 만료된
뒤 들어온 사람이 종목마다 OHLCV 를 새로 받는 값을 다 치렀다 — 관심종목
20개면 20번이고, 그게 그대로 '퀀트 탭이 느리다' 였다."""
QMETRICS_TTL = 1800
#: 가치 지표나 시세(모멘텀)가 통째로 빈 지표(조회가 시한에 걸렸다)는 이만큼만 둔다 — 30분 동안 그
#: 회사의 가치·모멘텀 점수가 '—' 로 굳지 않게 곧 다시 받는다(quant_score.지표가_반쪽인가)
QMETRICS_PARTIAL_TTL = 120


def 퀀트지표_담기(ck: str, 지표: dict, 시장: str) -> dict:
    """새로 모은 지표를 메모리에 담고, 담은 것을 돌려준다(DB 는 quant_store.저장 이 따로 — 반쪽은 거른다).

    반쪽(가치 지표나 시세가 통째로 빈 것)이면 먼저 있던 값으로 빈 칸을 채워 담고, 짧게만 둔다.
    지난 값을 뒤에서 새로 받다가(또는 같은 종목을 두 요청이 겹쳐 받다가) 한쪽이 시한에 걸리면,
    멀쩡하던 가치·모멘텀 점수를 그 반쪽이 덮어 '—' 로 만들었다."""
    from app.services.quant.quant_score import 지표가_반쪽인가
    if not 지표가_반쪽인가(지표, 시장):
        cache.set(ck, 지표, QMETRICS_TTL)
        return 지표
    있던것 = cache.get_stale(ck)
    if 있던것:
        지표 = {**있던것, **{k: v for k, v in 지표.items() if v is not None}}
    cache.set(ck, 지표, QMETRICS_PARTIAL_TTL)
    return 지표


_퀀트갱신중: set[str] = set()


def _퀀트지표_뒤로미루기(sym: str, mkt: str, ck: str) -> None:
    """지난 값으로 먼저 답하고, 새 값은 뒤에서 받아 둔다.

    같은 종목을 여러 사람이 동시에 열면 갱신이 겹친다. 한 번에 하나만
    돌게 표시해 둔다 — 0.15 CPU 에서는 겹치는 것 자체가 비용이다."""
    if ck in _퀀트갱신중:
        return
    _퀀트갱신중.add(ck)

    def _받기():
        try:
            import asyncio as _a
            from app.services.quant.quant_score import collect_quant_metrics as _c
            m = _a.run(_c(sym, mkt, fetch_ohlcv=True))
            퀀트지표_담기(ck, dict(m), mkt)
            # 서버가 잠들었다 깨도 쓸 수 있게 남겨 둔다(quant_store) — 새로 다 모은 것만
            from app.services.quant.quant_store import 저장
            저장(sym, mkt, dict(m))
        except Exception as e:
            log.warning("퀀트 지표 배경 갱신 실패 %s %s: %s", mkt, sym, type(e).__name__)
        finally:
            _퀀트갱신중.discard(ck)

    try:
        from app.core.executor import background_executor
        background_executor.submit(_받기)
    except Exception:
        _퀀트갱신중.discard(ck)


limiter = Limiter(key_func=get_remote_address)


def router_새로() -> APIRouter:
    """조각마다 제 라우터를 만든다.

    접두사(/stocks)는 안 붙인다 — __init__ 이 하나로 모을 때 한 번만
    붙여야, 조각을 옮겨도 주소가 안 바뀐다."""
    return APIRouter()

_SYMBOL_PATTERN = r"^[A-Za-z0-9.\-]{1,20}$"


async def _run(fn, *args):
    loop = asyncio.get_running_loop()
    return await asyncio.wait_for(loop.run_in_executor(None, fn, *args), timeout=15)


def _시한내결과(fut, timeout: float):
    """시한 안에 온 결과만 쓰고, 늦은 것은 없는 셈 친다.

    화면 하나가 야후에 대여섯 가지를 물어보는데, 그중 하나가 늦다고 응답
    전체를 붙들고 있을 수는 없다. 늦은 것은 다음 요청에서 캐시로 채워진다.

    cancel() 을 같이 부르는 이유 — 아직 시작도 안 한 작업까지 굳이 돌릴
    이유가 없다. 이미 시작한 작업은 취소되지 않지만, 공용 풀 위에서 도니
    끝나면 스레드가 풀로 돌아온다."""
    try:
        return fut.result(timeout=timeout)
    except Exception:
        fut.cancel()
        return None


# ── 국내 주식 ──────────────────────────────────────────────
async def get_kr_price(symbol: str) -> dict:
    """KIS → 캐시 → Naver → 순위캐시 → yfinance 순으로 폴백"""
    from app.services.market.price_fetcher import fetch_naver_stock
    code6 = symbol.replace(".KS","").replace(".KQ","")
    ck = f"price:{symbol}"

    # 0순위: 신선한 캐시
    fresh = cache.get(ck)
    if fresh and fresh.get("price") and not fresh.get("_demo"):
        return fresh

    # 1순위: KIS 실시간
    if settings.KIS_APP_KEY:
        result = await kis_service.get_price(code6)
        if result and result.get("price"):
            cache.set(ck, result, 15)
            return result

    # 2순위: Naver 모바일 API
    try:
        naver = await fetch_naver_stock(code6)
        if naver and naver.get("price"):
            cache.set(ck, naver, 15)
            return naver
    except Exception:
        pass

    # 3순위: stale 캐시
    stale = cache.get_stale(ck)
    if stale and stale.get("price") and not stale.get("_demo"):
        return stale

    # 4순위: 순위 캐시에서 해당 종목 가격 추출
    for cat in ("시가총액", "상승률", "거래량"):
        rank_cache = cache.get_stale(f"rank:kr:{cat}") or []
        for r in rank_cache:
            if r.get("symbol") == symbol and r.get("price"):
                result = {
                    "symbol": symbol, "name": r.get("name", ""),
                    "price": r["price"], "change": r.get("change", 0),
                    "change_rate": r.get("change_rate", 0),
                    "volume": r.get("volume", 0), "market_cap": r.get("market_cap", 0),
                    "currency": "KRW",
                }
                cache.set(ck, result, 30)
                return result

    # 5순위: FDR 전일 종가
    fdr = get_fdr_price(symbol) or get_fdr_price(code6+".KS") or get_fdr_price(code6+".KQ")
    if fdr and fdr.get("price"):
        return fdr

    # 6순위: yfinance (최후 수단)
    try:
        result = await asyncio.wait_for(
            asyncio.get_running_loop().run_in_executor(None, yf_service.get_stock_price, symbol, "KR"),
            timeout=10
        )
        if result and result.get("price"):
            cache.set(ck, result, 30)
            return result
    except Exception:
        pass

    return {"symbol": symbol, "price": None, "change_rate": 0, "currency": "KRW"}


async def get_us_price(symbol: str) -> dict:
    """Finnhub → Yahoo Finance → yfinance 순으로 폴백"""
    from app.services.market.price_fetcher import fetch_yf_quotes
    ck = f"price:{symbol}"

    # 신선한 캐시 (30초 이내)
    fresh = cache.get(ck)
    if fresh and fresh.get("price") and not fresh.get("_demo"):
        return fresh

    # 1순위: Finnhub (실시간, IP 차단 없음)
    if settings.FINNHUB_API_KEY:
        try:
            result = await _run(finnhub_service.get_quote, symbol)
            if result and result.get("price"):
                cache.set(ck, result, 15)
                return result
        except Exception:
            pass

    # 2순위: Yahoo Finance 직접 조회
    try:
        data = await fetch_yf_quotes([symbol])
        q = data.get(symbol)
        if q and q.get("price"):
            cache.set(ck, q, 30)
            return q
    except Exception:
        pass

    # stale 캐시
    stale = cache.get_stale(ck)
    if stale and stale.get("price") and not stale.get("_demo"):
        return stale

    # 3순위: yfinance 직접 호출
    try:
        result = await _run(yf_service.get_stock_price, symbol, "US")
        if result and result.get("price"):
            cache.set(ck, result, 30)
            return result
    except Exception:
        pass

    return {"symbol": symbol, "price": None, "change_rate": 0, "currency": "USD"}
