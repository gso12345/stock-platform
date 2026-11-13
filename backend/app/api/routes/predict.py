"""주가예측 — 일봉을 받아 services/predict/forecast 에 넘긴다(사용자: "주가예측 메뉴도 만들어줘").

로그인 없이 본다(누구나 보는 시세로 셈한다). 셈은 가볍지만(수십 ms) 5년치 일봉을 받는 일이 무겁다 — 일봉은
yf_service 가 6시간 들고 있고, 셈한 결과는 여기서 한 시간 들고 있는다(하루 한 번 바뀌는 종가로 셈하니까).

시세를 못 받았을 때 데모 시세로 채우지 않는다. 종목 상세의 차트는 빈 화면보다 낫다며 데모로 채우는 길이 있는데
(routes/stocks/price), 예측을 가짜 시세로 셈하면 그럴듯한 거짓말이 된다.

가치 위치(/valuation)는 따로 묻는다 — 재무를 처음 받을 때 몇 초 걸려도 예측 화면의 본론을 붙잡지 않게.
"""
import asyncio
import logging
import math
from typing import Literal

from fastapi import APIRouter, HTTPException, Path, Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.api.routes.stocks._공용 import _SYMBOL_PATTERN
from app.core.cache import cache
from app.services.fundamentals import fundamentals_service
from app.services.market.yf_service import yf_service
from app.services.predict import forecast, technical, valuation

router = APIRouter(prefix="/predict", tags=["주가예측"])
limiter = Limiter(key_func=get_remote_address)
log = logging.getLogger(__name__)

#: 셈한 결과를 들고 있는 시간(초) — 종가가 하루 한 번 바뀌니 한 시간이면 넉넉하다
보관초 = 3600
#: 받는 일봉 — 검증(지난 3년 매주)과 1년 뒤 예측까지 하려면 5년은 있어야 한다
받을기간 = "5y"
#: 기술적 분석의 '시장 흐름' — 국내는 코스피, 해외는 S&P 500(공모주 예측의 '최근 공모주 분위기' 자리)
시장지수 = {"KR": ("^KS11", "코스피"), "US": ("^GSPC", "S&P 500")}
#: 가치 위치 — 재무·투자지표가 어디에도 없을 때 받아 오기를 기다려 주는 상한(초). 퀀트 점수와 같다
재무기다림 = 15
#: 실적을 못 받았을 때는 짧게만 들고 있는다 — 뒤에서 마저 받은 것을 곧 다시 셈하게
빈손보관초 = 300


def _이름(symbol: str, market: str) -> str:
    """이미 읽어 둔 종목 목록에서 이름을 찾는다(새로 받지 않는다). 못 찾으면 코드 그대로"""
    try:
        from app.services.listings import ticker_service as ts
        if market == "KR":
            표 = {str(r.get("c") or "").upper(): r.get("n") for r in (ts._kr_db or ts.KR_TICKERS_BUILTIN)}
            return 표.get(symbol.split(".")[0].upper()) or symbol
        표 = {str(r.get("s") or "").upper(): r.get("n") for r in ts.get_us_db()}
        return ts.get_display_name(symbol, "US", 표.get(symbol.upper()) or symbol)
    except Exception:
        return symbol


def _셈(market: str, symbol: str) -> dict:
    """일봉을 받아 예측한다 — 스레드에서 돈다(받기도 셈도 이벤트 루프를 막지 않게)"""
    시장 = "KR" if market == "KR" else "US"
    try:
        봉들 = yf_service.get_ohlcv(symbol, 받을기간, "1d", 시장)
    except Exception as e:
        log.info("주가예측 시세 실패 %s:%s %s", market, symbol, type(e).__name__)
        raise HTTPException(status_code=503, detail="시세를 받지 못했어요. 잠시 뒤 다시 해 주세요")
    날들, 종가 = forecast.종가정리(봉들)
    if not 날들:
        raise HTTPException(status_code=404, detail="이 종목의 시세를 찾지 못했어요. 종목을 다시 골라 주세요")
    try:
        결과 = forecast.예측(날들, 종가, 정수=시장 == "KR")
    except forecast.자료부족:
        raise HTTPException(
            status_code=422,
            detail=f"상장한 지 얼마 안 됐거나 거래가 적어 예측할 시세가 모자라요(1년 남짓 필요 — 지금 {len(날들)}일)")
    결과.update(symbol=symbol, market=market, name=_이름(symbol, 시장),
              currency="KRW" if 시장 == "KR" else "USD")
    결과["technical"] = _기술(봉들, 날들, 종가, 시장)
    return 결과


def _기술(봉들: list, 날들: list[str], 종가, 시장: str):
    """기술적 분석 예측 — 못 셈해도(지수를 못 받았다 · 셈이 터졌다) 위의 범위 예측은 그대로 내보낸다"""
    지수기호, 지수이름 = 시장지수[시장]
    지수 = None
    try:
        지수날들, 지수종가 = forecast.종가정리(yf_service.get_ohlcv(지수기호, 받을기간, "1d", 시장))
        지수 = technical.지수맞추기(날들, 지수날들, 지수종가)
    except Exception as e:
        log.info("주가예측 시장 지수 실패 %s %s", 지수기호, type(e).__name__)
    try:
        기술 = technical.예측(날들, 종가, technical.거래량맞추기(봉들, 날들), 지수, 정수=시장 == "KR")
    except Exception:
        log.exception("기술적 분석 예측 실패")
        return None
    if 기술 is not None:
        기술["market"] = 지수이름 if any(i["used"] and i["key"].startswith("mkt_") for i in 기술["indicators"]) else None
    return 기술


@router.get("/{market}/{symbol}")
@limiter.limit("30/minute")
async def predict(
    request: Request,
    market: Literal["KR", "US", "ETF"],
    symbol: str = Path(..., pattern=_SYMBOL_PATTERN),
):
    """앞으로의 주가 범위(1주·1개월·3개월·6개월·1년)·오를 확률·같은 방식의 지난 3년 검증·근거 셋,
    그리고 기술적 분석 예측(technical — 1주·1개월·3개월, 공모주 예측처럼)"""
    열쇠 = f"predict:v1:{market}:{symbol.upper()}"
    if (있던것 := cache.get(열쇠)) is not None:
        return 있던것
    loop = asyncio.get_running_loop()
    결과 = await loop.run_in_executor(None, _셈, market, symbol)
    cache.set(열쇠, 결과, 보관초)
    return 결과


def _공식값(v) -> float | None:
    """투자지표의 PER·PBR — 0 보다 큰 수만(적자면 원천이 비우거나 음수를 준다)"""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) and f > 0 else None


async def _받기(일, 기본):
    """재무·투자지표 받기 — 실패하면 기본(이 칸이 없을 뿐 화면은 그대로)"""
    try:
        return await 일
    except Exception as e:
        log.info("가치 위치 재무 실패 %s", type(e).__name__)
        return 기본


@router.get("/{market}/{symbol}/valuation")
@limiter.limit("30/minute")
async def valuation_position(
    request: Request,
    market: Literal["KR", "US", "ETF"],
    symbol: str = Path(..., pattern=_SYMBOL_PATTERN),
):
    """가치 위치 — 지금 PER·PBR 이 이 종목의 지난날(최대 5년) 가운데 어디쯤인지(services/predict/valuation). 예측이
    아니다. now 는 종목 정보와 같은 공식 값, 위치는 날마다 '주가 ÷ 그날 알려진 최근 1년 순이익(순자산)' 으로 센 것"""
    if market == "ETF":
        raise HTTPException(status_code=404, detail="ETF 는 PER·PBR 위치를 셈하지 않아요")
    열쇠 = f"predict:valuation:v1:{market}:{symbol.upper()}"
    if (있던것 := cache.get(열쇠)) is not None:
        return 있던것
    loop = asyncio.get_running_loop()
    try:
        봉들 = await loop.run_in_executor(None, yf_service.get_ohlcv, symbol, 받을기간, "1d", market)
    except Exception as e:
        log.info("가치 위치 시세 실패 %s:%s %s", market, symbol, type(e).__name__)
        raise HTTPException(status_code=503, detail="시세를 받지 못했어요. 잠시 뒤 다시 해 주세요")
    날들, 종가 = forecast.종가정리(봉들)
    if not 날들:
        raise HTTPException(status_code=404, detail="이 종목의 시세를 찾지 못했어요. 종목을 다시 골라 주세요")
    재무, 지표 = await asyncio.gather(
        _받기(fundamentals_service.get_financials(symbol, market, 기다림=재무기다림), {}),
        _받기(fundamentals_service.get_fundamentals(symbol, market, 기다림=재무기다림), {}))
    결과 = valuation.가치위치(날들, 종가, 재무 if isinstance(재무, dict) else None)
    지표 = 지표 if isinstance(지표, dict) else {}
    for 칸 in ("per", "pbr"):
        결과[칸]["now"] = _공식값(지표.get(칸))
    결과.update(symbol=symbol, market=market)
    받았나 = isinstance(재무, dict) and bool(재무.get("annual") or 재무.get("quarterly"))
    cache.set(열쇠, 결과, 보관초 if 받았나 else 빈손보관초)
    return 결과
