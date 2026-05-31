"""
국내 시장 부가 데이터
- 선물 (KOSPI200 선물)
- 원달러 환율
- 금리 (기준금리, CD, 국채)
"""
import httpx
import yfinance as yf
from app.core.config import settings
from app.core.cache import cache


# ── 환율 ──────────────────────────────────────────────────
def get_exchange_rate() -> dict:
    ck = "extra:usdkrw"
    if c := cache.get(ck):
        return c
    try:
        t    = yf.Ticker("USDKRW=X")
        hist = t.history(period="5d")
        cls  = hist["Close"].dropna()
        if len(cls) >= 2:
            curr = float(cls.iloc[-1])
            prev = float(cls.iloc[-2])
            chg  = curr - prev
            chgr = chg / prev * 100
        elif len(cls) == 1:
            curr = float(cls.iloc[-1]); chg = chgr = 0.0
        else:
            return _demo_exchange()
        result = {
            "symbol": "USDKRW",
            "name":   "원/달러 환율",
            "value":  round(curr, 2),
            "change": round(chg, 2),
            "change_rate": round(chgr, 4),
            "unit":   "원",
        }
        cache.set(ck, result, 60)
        return result
    except Exception:
        return cache.get_stale(ck) or _demo_exchange()


def _demo_exchange() -> dict:
    return {"symbol":"USDKRW","name":"원/달러 환율","value":1384.50,"change":-2.30,"change_rate":-0.17,"unit":"원","_demo":True}


# ── 국내 선물 (KIS API 또는 yfinance 근사) ─────────────────
async def get_kr_futures() -> list:
    ck = "extra:kr_futures"
    if c := cache.get(ck):
        return c

    futures = []

    # KIS API로 선물 조회 시도
    if settings.KIS_APP_KEY:
        try:
            from app.services.kis_service import kis_service
            token = await kis_service._get_token()
            if token:
                import httpx as _httpx
                async with _httpx.AsyncClient(timeout=8) as cl:
                    # KOSPI200 선물 근월물
                    r = await cl.get(
                        f"{kis_service.base}/uapi/domestic-futureoption/v1/quotations/inquire-futureoption-daily",
                        headers=kis_service._headers(token, "FHKIF03020100"),
                        params={"FID_COND_MRKT_DIV_CODE":"F","FID_INPUT_ISCD":"101V3000"},
                    )
                    o = r.json().get("output1", {})
                    if o.get("stck_prpr"):
                        futures.append({
                            "name":   "KOSPI200 선물",
                            "symbol": "101V3000",
                            "price":  float(o.get("stck_prpr", 0)),
                            "change": float(o.get("prdy_vrss", 0)),
                            "change_rate": float(o.get("prdy_ctrt", 0)),
                        })
        except Exception:
            pass

    # KIS 실패 또는 키 없으면 yfinance 근사 (코스피200 ETF 기반)
    if not futures:
        try:
            import asyncio as _asyncio
            loop = _asyncio.get_running_loop()
            r = await loop.run_in_executor(None, _fetch_futures_yf)
            futures = r
        except Exception:
            pass

    # 데모 폴백
    if not futures:
        futures = _demo_futures()

    cache.set(ck, futures, 30)
    return futures


def _fetch_futures_yf() -> list:
    """yfinance로 선물 근사 (ETF 사용)"""
    results = []
    specs: list = []  # KOSPI200 ETF, KODEX 레버리지 제거
    for sym, name, unit in specs:
        try:
            t = yf.Ticker(sym)
            h = t.history(period="5d")
            c = h["Close"].dropna()
            if len(c) < 1:
                continue
            curr = float(c.iloc[-1])
            prev = float(c.iloc[-2]) if len(c) >= 2 else curr
            results.append({
                "name":   name,
                "symbol": sym,
                "price":  round(curr, 2),
                "change": round(curr - prev, 2),
                "change_rate": round((curr - prev) / prev * 100, 2) if prev else 0,
                "unit":   unit,
            })
        except Exception:
            continue
    return results


def _demo_futures() -> list:
    return [
        {"name":"KOSPI200 선물","symbol":"101V3000","price":373.85,"change":-0.95,"change_rate":-0.25,"unit":"포인트","_demo":True},
        {"name":"미니코스피200","symbol":"105V3000","price":373.85,"change":-0.95,"change_rate":-0.25,"unit":"포인트","_demo":True},
    ]


# ── 금리 ──────────────────────────────────────────────────
def get_kr_rates() -> list:
    ck = "extra:kr_rates"
    if c := cache.get(ck):
        return c

    rates = []

    # yfinance로 조회 가능한 금리
    rate_specs = [
        ("^IRX",  "미국 단기 금리(13W)",  "%"),
        ("^TNX",  "미국 10년 국채",        "%"),
        ("^TYX",  "미국 30년 국채",        "%"),
    ]
    for sym, name, unit in rate_specs:
        try:
            t = yf.Ticker(sym)
            h = t.history(period="5d")
            c = h["Close"].dropna()
            if len(c) < 1:
                continue
            curr = float(c.iloc[-1])
            prev = float(c.iloc[-2]) if len(c) >= 2 else curr
            rates.append({
                "name":        name,
                "value":       round(curr, 3),
                "change":      round(curr - prev, 3),
                "change_rate": round(curr - prev, 3),  # 금리는 절대값 변화
                "unit":        unit,
            })
        except Exception:
            continue

    # 한국 기준금리는 API 없으면 데모
    kr_base = cache.get_stale("extra:kr_base_rate")
    if not kr_base:
        kr_base = {"name":"한국 기준금리","value":3.50,"change":0.0,"change_rate":0.0,"unit":"%","_static":True}
        cache.set("extra:kr_base_rate", kr_base, 86400)
    rates.insert(0, kr_base)

    # CD 91일물 (근사)
    cd_rate = {"name":"CD금리(91일)","value":3.62,"change":0.0,"change_rate":0.0,"unit":"%","_static":True}
    rates.insert(1, cd_rate)

    if rates:
        cache.set(ck, rates, 300)
    return rates or _demo_rates()


def _demo_rates() -> list:
    return [
        {"name":"한국 기준금리","value":3.50,"change":0.0,"change_rate":0.0,"unit":"%","_static":True},
        {"name":"CD금리(91일)","value":3.62,"change":0.01,"change_rate":0.0,"unit":"%","_static":True},
        {"name":"국채 3년","value":3.45,"change":-0.02,"change_rate":0.0,"unit":"%","_demo":True},
        {"name":"국채 10년","value":3.78,"change":0.01,"change_rate":0.0,"unit":"%","_demo":True},
        {"name":"미국 10년 국채","value":4.52,"change":-0.03,"change_rate":0.0,"unit":"%","_demo":True},
    ]
