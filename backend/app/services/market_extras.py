"""
국내 시장 부가 데이터
- 선물 (KOSPI200 선물)
- 원달러 환율
- 금리 (기준금리, CD, 국채)
"""
import httpx
import yfinance as yf
from concurrent.futures import ThreadPoolExecutor
from app.core.config import settings
from app.core.cache import cache
from app.core.executor import background_executor


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
def _batch_close(symbols: list) -> "pd.DataFrame | None":
    """여러 심볼을 yf.download 1회로 배치 조회 — 순차 N회 → 1회"""
    try:
        import pandas as pd
        raw = yf.download(symbols, period="5d", progress=False, auto_adjust=True)
        if raw.empty:
            return None
        if hasattr(raw.columns, "levels"):
            return raw["Close"]          # MultiIndex: (metric, ticker) → DataFrame
        else:
            return raw[["Close"]].rename(columns={"Close": symbols[0]})  # 단일 ticker
    except Exception:
        return None


def _fetch_kr_base_cd() -> "tuple[dict | None, dict | None]":
    """네이버 금융 국내금리 페이지에서 한국 기준금리 · CD(91일) 실시간 조회 (API 키 불필요)"""
    try:
        from bs4 import BeautifulSoup
        r = httpx.get(
            "https://finance.naver.com/marketindex/interestList.naver",
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
                "Referer": "https://finance.naver.com/",
            },
            timeout=8,
        )
        if r.status_code != 200:
            return None, None
        soup = BeautifulSoup(r.text, "lxml")
        base_rate = cd_rate = None
        for row in soup.select("table tbody tr"):
            cells = [c.get_text(strip=True) for c in row.find_all("td")]
            if len(cells) < 2:
                continue
            name = cells[0]
            try:
                val = float(cells[1].replace(",", ""))
            except (ValueError, IndexError):
                continue
            if base_rate is None and "기준금리" in name:
                base_rate = {"name": "한국 기준금리", "value": val, "change": 0.0, "change_rate": 0.0, "unit": "%"}
            elif cd_rate is None and "CD" in name and "91" in name:
                cd_rate = {"name": "CD금리(91일)", "value": val, "change": 0.0, "change_rate": 0.0, "unit": "%"}
        return base_rate, cd_rate
    except Exception:
        return None, None


def _do_fetch_kr_rates() -> list:
    ck = "extra:kr_rates"
    rate_specs = [
        ("^IRX",  "미국 단기 금리(13W)",  "%"),
        ("^TNX",  "미국 10년 국채",        "%"),
        ("^TYX",  "미국 30년 국채",        "%"),
    ]
    # yfinance 배치 조회와 네이버 CD금리 조회를 병렬화 — 순차 대비 응답 시간 단축
    ex = ThreadPoolExecutor(max_workers=2)
    try:
        f_close = ex.submit(_batch_close, [s[0] for s in rate_specs])
        f_naver = ex.submit(_fetch_kr_base_cd)
        try:
            close_data = f_close.result(timeout=15)
        except Exception:
            close_data = None
        try:
            _naver_base, naver_cd = f_naver.result(timeout=10)
        except Exception:
            naver_cd = None
    finally:
        ex.shutdown(wait=False)

    rates = []
    for sym, name, unit in rate_specs:
        try:
            c = close_data[sym].dropna() if (close_data is not None and sym in close_data.columns) \
                else yf.Ticker(sym).history(period="5d")["Close"].dropna()
            if len(c) < 1:
                continue
            curr, prev = float(c.iloc[-1]), float(c.iloc[-2]) if len(c) >= 2 else float(c.iloc[-1])
            rates.append({"name": name, "value": round(curr, 3),
                          "change": round(curr - prev, 3), "change_rate": round(curr - prev, 3), "unit": unit})
        except Exception:
            continue

    cd_rate = naver_cd or cache.get_stale("extra:cd_rate") or \
        {"name":"CD금리(91일)","value":3.62,"change":0.0,"change_rate":0.0,"unit":"%","_static":True}
    cache.set("extra:cd_rate", cd_rate, 86400)

    rates.insert(0, cd_rate)

    if rates:
        cache.set(ck, rates, 300)
    return rates or _demo_rates()


def get_kr_rates() -> list:
    ck = "extra:kr_rates"
    if c := cache.get(ck):
        return c
    stale = cache.get_stale(ck)
    if stale:
        background_executor.submit(_do_fetch_kr_rates)
        return stale
    return _do_fetch_kr_rates()


def _do_fetch_us_rates() -> list:
    ck = "extra:us_rates"
    # (yf_sym, display_name, unit, is_rate, rt_cache_key)
    # rt_cache_key: 실시간 캐시 키 — get_usdkrw/get_eurkrw가 채워 둔 값 우선 사용
    specs = [
        ("USDKRW=X",  "원/달러",          "원",  False, "extra:usdkrw"),
        ("EURKRW=X",  "원/유로",          "원",  False, "extra:eurkrw"),
        ("JPYKRW=X",  "원/100엔",         "원",  False, None),
        ("^IRX",      "미국 단기금리(3M)", "%",   True,  None),
        ("^FVX",      "미국 5년 국채",     "%",   True,  None),
        ("^TNX",      "미국 10년 국채",    "%",   True,  None),
        ("^TYX",      "미국 30년 국채",    "%",   True,  None),
        ("^VIX",      "VIX 공포지수",      "pt",  False, None),
    ]
    # 실시간 캐시가 없는 종목만 yfinance 배치 조회
    need_yf = [s[0] for s in specs if not s[4] or not (cache.get(s[4]) or cache.get_stale(s[4]))]
    close_data = _batch_close(need_yf) if need_yf else None

    results = []
    for sym, name, unit, is_rate, rt_key in specs:
        # 실시간 환율 캐시 우선 (USD/EUR — get_fxkrw가 채운 값)
        if rt_key:
            rt = cache.get(rt_key) or cache.get_stale(rt_key)
            if rt and rt.get("value", 0) > 0:
                results.append({
                    "name": name, "value": rt["value"],
                    "change": rt.get("change", 0), "change_rate": rt.get("change_rate", 0),
                    "unit": unit, "is_rate": is_rate,
                })
                continue
        # 폴백: yfinance 히스토리
        try:
            c2 = close_data[sym].dropna() if (close_data is not None and sym in close_data.columns) \
                 else yf.Ticker(sym).history(period="5d")["Close"].dropna()
            if len(c2) < 1:
                continue
            curr, prev = float(c2.iloc[-1]), float(c2.iloc[-2]) if len(c2) >= 2 else float(c2.iloc[-1])
            chg  = curr - prev
            chgr = chg / prev * 100 if prev and not is_rate else chg
            results.append({
                "name": name, "value": round(curr, 3 if is_rate else 2),
                "change": round(chg, 3 if is_rate else 2),
                "change_rate": round(chgr, 3 if is_rate else 2),
                "unit": unit, "is_rate": is_rate,
            })
        except Exception:
            continue

    if results:
        cache.set(ck, results, 300)
    return results


def get_us_rates() -> list:
    ck = "extra:us_rates"
    if c := cache.get(ck):
        return c
    stale = cache.get_stale(ck)
    if stale:
        background_executor.submit(_do_fetch_us_rates)
        return stale
    return _do_fetch_us_rates()


def _demo_rates() -> list:
    return [
        {"name":"CD금리(91일)","value":3.62,"change":0.01,"change_rate":0.0,"unit":"%","_static":True},
        {"name":"국채 3년","value":3.45,"change":-0.02,"change_rate":0.0,"unit":"%","_demo":True},
        {"name":"국채 10년","value":3.78,"change":0.01,"change_rate":0.0,"unit":"%","_demo":True},
        {"name":"미국 10년 국채","value":4.52,"change":-0.03,"change_rate":0.0,"unit":"%","_demo":True},
    ]
