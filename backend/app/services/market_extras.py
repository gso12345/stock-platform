"""
국내 시장 부가 데이터
- 선물 (KOSPI200 선물)
- 환율 (원/달러, 원/100엔)
- 금리 (기준금리, CD, 국채)
- 변동성 (VKOSPI)
"""
import logging
import httpx
import yfinance as yf
from concurrent.futures import ThreadPoolExecutor
from app.core.config import settings
from app.core.cache import cache
from app.core.executor import background_executor

log = logging.getLogger(__name__)


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


def _fetch_kr_rates_naver() -> "tuple[list, dict | None]":
    """네이버 모바일 API (m.stock.naver.com) — 한국 금리 조회.
    주식·환율과 동일 도메인이라 서버 환경에서 접근 가능.
    전체 목록 API → 개별 코드 순으로 시도.
    """
    _H = {
        "User-Agent": "Mozilla/5.0 (Linux; Android 10; SM-G981B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.162 Mobile Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "ko-KR,ko;q=0.9",
        "Referer": "https://m.stock.naver.com/",
        "Origin": "https://m.stock.naver.com",
    }

    def _sf(v) -> float:
        try: return float(str(v or 0).replace(",", ""))
        except: return 0.0

    def _display(raw: str) -> "str | None":
        if not raw: return None
        if "기준금리" in raw: return "한국 기준금리"
        if "CD" in raw and ("91" in raw or "일" in raw): return "CD금리(91일)"
        if ("국고채" in raw or "국고" in raw) and "3년" in raw: return "국고채 3년"
        if ("국고채" in raw or "국고" in raw) and "5년" in raw: return "국고채 5년"
        if ("국고채" in raw or "국고" in raw) and "10년" in raw: return "국고채 10년"
        return None

    def _extract(d: dict) -> "tuple[float, float]":
        val = _sf(d.get("closePrice") or d.get("currentPrice") or d.get("close") or 0)
        chg = _sf(d.get("compareToPreviousClosePrice") or d.get("change") or
                  d.get("priceChange") or 0)
        return val, chg

    def _entry(name: str, val: float, chg: float) -> dict:
        return {"name": name, "value": round(val, 3), "change": round(chg, 3),
                "change_rate": round(chg, 3), "unit": "%", "is_rate": True}

    rates: list = []
    cd_rate = None

    # ── 1순위: 전체 목록 API (한 번에 모든 금리 반환) ─────────
    for list_url in [
        "https://m.stock.naver.com/api/rate/domestic",
        "https://m.stock.naver.com/api/rate/index",
        "https://m.stock.naver.com/api/market/domestic/interest",
    ]:
        try:
            r = httpx.get(list_url, headers=_H, timeout=8)
            if r.status_code != 200:
                continue
            data = r.json()
            items = data if isinstance(data, list) else next(
                (v for v in (data.values() if isinstance(data, dict) else []) if isinstance(v, list)), []
            )
            seen: set = set()
            for item in items:
                raw_name = (item.get("rateName") or item.get("name") or
                            item.get("symbolName") or item.get("itemName") or "")
                name = _display(raw_name)
                if not name or name in seen:
                    continue
                val, chg = _extract(item)
                if val <= 0:
                    continue
                seen.add(name)
                e = _entry(name, val, chg)
                if name == "CD금리(91일)":
                    cd_rate = e
                else:
                    rates.append(e)
            if rates:
                return rates, cd_rate
        except Exception:
            continue

    # ── 2순위: 개별 코드 조회 (후보 코드 여러 개 시도) ────────
    # 국고채 코드는 Naver 내부 코드가 불확실해 후보 다수 시도
    SPECS = [
        ("한국 기준금리", False, ["BASERATE", "IRR_BASERATE"]),
        ("CD금리(91일)",  True,  ["CD91", "IRR_CD91", "CD_91"]),
        ("국고채 3년",    False, ["GOV3YR", "GOV3Y", "KTB3YR", "KTB3Y", "IRR_GOV3YR",
                                   "IRR_GOV3Y", "GB3YR", "NGS3Y", "NGOV3Y"]),
        ("국고채 5년",    False, ["GOV5YR", "GOV5Y", "KTB5YR", "KTB5Y", "IRR_GOV5YR",
                                   "IRR_GOV5Y", "GB5YR", "NGS5Y"]),
        ("국고채 10년",   False, ["GOV10YR", "GOV10Y", "KTB10YR", "KTB10Y", "IRR_GOV10YR",
                                    "IRR_GOV10Y", "GB10YR", "NGS10Y"]),
    ]
    found: set = set()
    for name, is_cd, codes in SPECS:
        if name in found:
            continue
        for code in codes:
            try:
                r = httpx.get(
                    f"https://m.stock.naver.com/api/rate/{code}/basic",
                    headers=_H, timeout=5,
                )
                if r.status_code != 200:
                    continue
                d = r.json()
                if isinstance(d, list):
                    d = d[0] if d else {}
                val, chg = _extract(d)
                if val <= 0:
                    continue
                e = _entry(name, val, chg)
                if is_cd:
                    cd_rate = e
                else:
                    rates.append(e)
                found.add(name)
                break
            except Exception:
                continue

    return rates, cd_rate


# 하위 호환용 래퍼 (scheduler 등에서 직접 호출 시)
def _fetch_kr_base_cd() -> "tuple[dict | None, dict | None]":
    rates, cd = _fetch_kr_rates_naver()
    base = next((r for r in rates if "기준금리" in r["name"]), None)
    return base, cd


def _fetch_bok_rates_ecos() -> "tuple[dict | None, list]":
    """한국은행 ECOS Open API — 기준금리(월별) + 국고채 수익률(일별)
    API 키: settings.BOK_API_KEY (기본값 'sample' — 무료, 일부 통계 제한)
    기준금리 통계코드 722Y001/0101000, 국고채 817Y002/010190000~010400000
    """
    import datetime
    api_key = getattr(settings, "BOK_API_KEY", "sample") or "sample"
    base_url = f"https://ecos.bok.or.kr/api/StatisticSearch/{api_key}/json/kr"

    today = datetime.date.today()
    end_date  = today.strftime("%Y%m%d")
    start_date = (today - datetime.timedelta(days=14)).strftime("%Y%m%d")
    end_month  = today.strftime("%Y%m")
    start_month = (today - datetime.timedelta(days=180)).strftime("%Y%m")

    bok_base = None
    bok_bonds: list = []

    # ── 기준금리 (월별, 최근 6개월 중 최신값) ───────────────
    try:
        r = httpx.get(
            f"{base_url}/1/5/722Y001/M/{start_month}/{end_month}/0101000/",
            timeout=8,
        )
        if r.status_code == 200:
            rows = r.json().get("StatisticSearch", {}).get("row", [])
            if rows:
                val = float(rows[-1].get("DATA_VALUE") or 0)
                if val > 0:
                    bok_base = {
                        "name": "한국 기준금리", "value": round(val, 3),
                        "change": 0.0, "change_rate": 0.0,
                        "unit": "%", "is_rate": True,
                    }
                    cache.set("extra:kr_base_rate", bok_base, 86400)
    except Exception:
        pass

    # ── 국고채 수익률 (일별, 최근 14일 중 최신 2영업일 비교) ─
    bond_specs = [
        ("010190000", "국고채 3년"),
        ("010300000", "국고채 5년"),
        ("010400000", "국고채 10년"),
    ]
    for code, name in bond_specs:
        try:
            r = httpx.get(
                f"{base_url}/1/5/817Y002/D/{start_date}/{end_date}/{code}/",
                timeout=8,
            )
            if r.status_code == 200:
                rows = r.json().get("StatisticSearch", {}).get("row", [])
                if rows:
                    val = float(rows[-1].get("DATA_VALUE") or 0)
                    prev = float(rows[-2].get("DATA_VALUE") or val) if len(rows) >= 2 else val
                    if val > 0:
                        chg = round(val - prev, 3)
                        bok_bonds.append({
                            "name": name, "value": round(val, 3),
                            "change": chg, "change_rate": chg,
                            "unit": "%", "is_rate": True,
                        })
        except Exception:
            continue

    return bok_base, bok_bonds


def _fetch_kr_bonds_yf() -> list:
    """yfinance로 한국 국고채 금리 조회 (네이버 스크래핑 실패 시 폴백)"""
    bond_specs = [
        ("KR3YT=RR", "국고채 3년"),
        ("KR5YT=RR", "국고채 5년"),
        ("KR10YT=RR", "국고채 10년"),
    ]
    symbols = [s[0] for s in bond_specs]
    close_data = _batch_close(symbols)

    results = []
    for sym, name in bond_specs:
        try:
            if close_data is not None and sym in close_data.columns:
                c = close_data[sym].dropna()
            else:
                c = yf.Ticker(sym).history(period="5d")["Close"].dropna()
            if len(c) < 1:
                continue
            curr = float(c.iloc[-1])
            prev = float(c.iloc[-2]) if len(c) >= 2 else curr
            chg = round(curr - prev, 3)
            results.append({
                "name": name, "value": round(curr, 3),
                "change": chg, "change_rate": chg,
                "unit": "%", "is_rate": True,
            })
        except Exception:
            continue
    return results


def _fetch_kr_bonds_pykrx() -> "tuple[list, dict | None]":
    """pykrx로 KRX 장외 채권수익률 조회 (국고채 3/5/10년 + CD금리)"""
    try:
        import datetime
        from app.core import pykrx_light
        krx_bond = pykrx_light.bond()

        today = datetime.date.today()
        df = None
        for days_back in range(0, 7):
            d = today - datetime.timedelta(days=days_back)
            try:
                tmp = krx_bond.get_otc_treasury_yields(d.strftime("%Y%m%d"))
                if tmp is not None and not tmp.empty:
                    df = tmp
                    break
            except Exception:
                continue

        if df is None or df.empty:
            return [], None

        bonds = []
        for krx_name, display_name in [("국고채 3년", "국고채 3년"), ("국고채 5년", "국고채 5년"), ("국고채 10년", "국고채 10년")]:
            if krx_name in df.index:
                row = df.loc[krx_name]
                val = float(row["수익률"])
                chg = float(row["대비"]) if "대비" in row.index else 0.0
                bonds.append({
                    "name": display_name, "value": round(val, 3),
                    "change": round(chg, 3), "change_rate": round(chg, 3),
                    "unit": "%", "is_rate": True,
                })

        cd = None
        for cd_key in ["CD(91일)", "CD91일", "CD"]:
            if cd_key in df.index:
                row = df.loc[cd_key]
                val = float(row["수익률"])
                chg = float(row["대비"]) if "대비" in row.index else 0.0
                cd = {
                    "name": "CD금리(91일)", "value": round(val, 3),
                    "change": round(chg, 3), "change_rate": round(chg, 3),
                    "unit": "%", "is_rate": True,
                }
                break

        return bonds, cd
    except Exception:
        return [], None


_VKOSPI_CK = "extra:vkospi"

# 네이버 모바일이 이 지수를 무슨 코드로 부르는지 확인할 방법이 지금 없어서
# (작업 환경에서 외부 인터넷이 막혀 있다) 그럴듯한 후보를 차례로 걸어 본다.
# 금리 조회에서 이미 쓰고 있는 방식이다 — 되는 것을 만나면 거기서 멈춘다.
_VKOSPI_네이버코드 = ["VKOSPI", "VKOSPI200", "KOSPI200VOL"]


def _fetch_vkospi_naver() -> "dict | None":
    """네이버 모바일 지수 API. 국내 지수 4종이 이미 이 경로로 들어온다."""
    from app.services.price_fetcher import NAVER_HEADERS

    for code in _VKOSPI_네이버코드:
        try:
            r = httpx.get(f"https://m.stock.naver.com/api/index/{code}/basic",
                          headers=NAVER_HEADERS, timeout=6)
            if r.status_code != 200:
                continue
            d = r.json()
            값 = d.get("closePrice") or d.get("currentIndexValue") or d.get("indexValue")
            if 값 in (None, ""):
                continue
            def _수(x):
                try:
                    return float(str(x or 0).replace(",", ""))
                except (TypeError, ValueError):
                    return 0.0
            현재 = _수(값)
            if 현재 <= 0:
                continue
            return {
                "value": round(현재, 2),
                "change": round(_수(d.get("compareToPreviousClosePrice") or d.get("changeValue")), 2),
                "change_rate": round(_수(d.get("fluctuationsRatio") or d.get("changeRate")), 2),
            }
        except Exception:
            continue
    return None


def _fetch_vkospi_pykrx() -> "dict | None":
    """KRX 공식 데이터. 네이버가 안 되면 이쪽으로.

    지수 코드를 외우지 않고 이름으로 찾는다 — 코드를 잘못 적으면 빈
    데이터가 조용히 돌아와서(지난번 ETF 보유비중 때 그랬다) 원인을
    찾는 데 한참 걸린다."""
    try:
        from app.core import pykrx_light
        import datetime as dt

        pkrx = pykrx_light.stock()
        티커 = None
        for t in pkrx.get_index_ticker_list(market="KRX"):
            이름 = pkrx.get_index_ticker_name(t) or ""
            if "변동성" in 이름:
                티커 = t
                break
        if not 티커:
            return None

        오늘 = dt.date.today()
        df = pkrx.get_index_ohlcv_by_date(
            (오늘 - dt.timedelta(days=10)).strftime("%Y%m%d"),
            오늘.strftime("%Y%m%d"), 티커)
        df = df[df["종가"] > 0]
        if len(df) < 1:
            return None
        현재 = float(df["종가"].iloc[-1])
        if len(df) >= 2:
            전일 = float(df["종가"].iloc[-2])
            변동 = 현재 - 전일
            비율 = (변동 / 전일 * 100) if 전일 else 0.0
        else:
            변동 = 비율 = 0.0
        return {"value": round(현재, 2), "change": round(변동, 2),
                "change_rate": round(비율, 2)}
    except Exception as e:
        log.debug("VKOSPI pykrx 실패: %s", type(e).__name__)
        return None


def get_vkospi() -> "dict | None":
    """코스피200 변동성지수.

    해외 탭에는 VIX 가 있는데 국내에는 변동성 지표가 없었다. 지수가
    올랐는지만 보면 '왜 이렇게 출렁였는지' 는 안 보인다.

    못 가져오면 None 을 돌려준다 — 화면에서는 카드가 안 그려질 뿐이고,
    엉뚱한 값을 채워 넣지 않는다."""
    if c := cache.get(_VKOSPI_CK):
        return c
    결과 = _fetch_vkospi_naver() or _fetch_vkospi_pykrx()
    if not 결과:
        # 장 마감 뒤나 일시 장애일 수 있다. 지난 값이라도 있으면 그걸 쓴다
        return cache.get_stale(_VKOSPI_CK)
    항목 = {"name": "VKOSPI", "unit": "pt", **결과}
    cache.set(_VKOSPI_CK, 항목, 300)
    return 항목


def _환율카드(캐시키: str, 이름: str, 야후심볼: str, 환산=None) -> "dict | None":
    """해외 탭이 이미 받아 둔 환율을 한국 대시보드 카드 모양으로 꺼낸다.

    해외 탭이 5분마다 받아 캐시에 넣어 두므로(extra:usdkrw 등) 대개 새로
    받을 일이 없다. 비었을 때만 직접 받는다 — 카드 하나 때문에 0.15 CPU
    서버에 요청을 더 얹을 이유가 없다.

    환산은 단위가 다른 통화용이다(엔화는 1엔당으로 오는 것을 100엔당으로).
    값을 바꾸면 변동폭도 같은 배수로 바뀌어야 한다 — 값만 100배 하고
    변동폭을 두면 "932원, 어제보다 0.05원" 이라는 말이 안 되는 카드가 된다.
    등락률은 비율이라 단위와 무관하므로 그대로 둔다."""
    환산 = 환산 or (lambda v: v)
    항목 = cache.get(캐시키) or cache.get_stale(캐시키)
    if 항목 and 항목.get("value"):
        값 = 환산(항목["value"])
        배수 = (값 / 항목["value"]) if 항목["value"] else 1
        return {"name": 이름, "unit": "원", "value": round(값, 2),
                "change": round((항목.get("change") or 0) * 배수, 2),
                "change_rate": round(항목.get("change_rate") or 0, 2)}
    try:
        c = yf.Ticker(야후심볼).history(period="5d")["Close"].dropna()
        if len(c) < 1:
            return None
        현재 = 환산(float(c.iloc[-1]))
        전일 = 환산(float(c.iloc[-2])) if len(c) >= 2 else 현재
        변동 = 현재 - 전일
        return {"name": 이름, "unit": "원", "value": round(현재, 2),
                "change": round(변동, 2),
                "change_rate": round(변동 / 전일 * 100 if 전일 else 0, 2)}
    except Exception:
        return None


def get_jpykrw_100() -> "dict | None":
    """원/100엔. 야후는 1엔당으로 주므로 100을 곱한다."""
    return _환율카드("extra:jpykrw", "원/100엔", "JPYKRW=X", 엔화_100엔당)


def get_eurkrw() -> "dict | None":
    """원/유로. 달러·엔과 달리 단위를 손댈 것이 없다."""
    return _환율카드("extra:eurkrw", "원/유로", "EURKRW=X")


def _do_fetch_kr_rates() -> list:
    ck = "extra:kr_rates"

    base: "dict | None" = None
    bonds: list = []
    cd_override: "dict | None" = None

    # 1순위: 네이버 모바일 API (주식/환율과 동일 도메인, 서버에서 작동)
    try:
        naver_rates, naver_cd = _fetch_kr_rates_naver()
        if not base:
            base = next((r for r in naver_rates if "기준금리" in r["name"]), None)
            if base:
                cache.set("extra:kr_base_rate", base, 86400)
        if not bonds:
            bonds = [r for r in naver_rates if "국고채" in r["name"]]
        if naver_cd:
            cd_override = naver_cd
    except Exception:
        pass

    # 2순위: 한국은행 ECOS API (정부 공개 API, 클라우드 IP 차단 없음)
    if not base or not bonds:
        try:
            bok_base, bok_bonds = _fetch_bok_rates_ecos()
            if not base and bok_base:
                base = bok_base
            if not bonds and bok_bonds:
                bonds = bok_bonds
        except Exception:
            pass

    # 3순위: yfinance (KR3YT=RR 등)
    if not bonds:
        try:
            bonds = _fetch_kr_bonds_yf()
        except Exception:
            pass

    # 4순위: pykrx (KRX 장외채권수익률)
    if not bonds:
        try:
            pkrx_bonds, pkrx_cd = _fetch_kr_bonds_pykrx()
            if pkrx_bonds:
                bonds = pkrx_bonds
            if pkrx_cd and not cd_override:
                cd_override = pkrx_cd
        except Exception:
            pass

    # CD금리: 위 소스 중 하나에서 얻었거나, 캐시·정적 값
    cd_rate = cd_override or cache.get_stale("extra:cd_rate") or \
        {"name": "CD금리(91일)", "value": 3.62, "change": 0.0, "change_rate": 0.0, "unit": "%", "is_rate": True, "_static": True}
    cache.set("extra:cd_rate", cd_rate, 86400)

    # 기준금리: 위 소스 없으면 캐시 or 정적 값 (BOK 변경 빈도 낮음)
    if not base:
        base = cache.get_stale("extra:kr_base_rate") or \
            {"name": "한국 기준금리", "value": 2.75, "change": 0.0, "change_rate": 0.0, "unit": "%", "is_rate": True, "_static": True}

    # 순서: 원/유로 → 원/100엔 → 기준금리 → CD금리 → 국고채 3/5/10년 → VKOSPI
    #
    # 환율을 맨 앞에 두는 이유 — 화면은 원/달러를 이 목록보다 먼저 그린다.
    # 그래야 환율 셋이 붙어 있고 금리가 그 뒤로 이어진다.
    # 달러·유로·엔 순서는 해외 탭이 쓰는 차례와 맞췄다.
    # VKOSPI 는 성격이 달라서(변동성) 맨 뒤에 둔다.
    #
    # 하나가 실패해도 금리 목록은 그대로 나와야 한다. 곁들이 때문에
    # 있던 것까지 사라지면 고친 게 아니라 망가뜨린 것이다.
    곁들이: dict[str, "dict | None"] = {}
    for 키, 부르기 in (("유로", get_eurkrw), ("엔화", get_jpykrw_100), ("vkospi", get_vkospi)):
        try:
            곁들이[키] = 부르기()
        except Exception as e:
            log.debug("%s 실패: %s", 키, type(e).__name__)
            곁들이[키] = None

    rates = [x for x in ([곁들이["유로"], 곁들이["엔화"]]
                         + [base, cd_rate] + bonds
                         + [곁들이["vkospi"]]) if x]

    cache.set(ck, rates, 300)
    return rates


def get_kr_rates() -> list:
    ck = "extra:kr_rates"
    if c := cache.get(ck):
        return c
    stale = cache.get_stale(ck)
    if stale:
        background_executor.submit(_do_fetch_kr_rates)
        return stale
    return _do_fetch_kr_rates()


_FX_CACHE_MAP = {
    "USDKRW=X": ("extra:usdkrw", "USDKRW", "원/달러 환율"),
    "EURKRW=X": ("extra:eurkrw", "EURKRW", "원/유로 환율"),
    "JPYKRW=X": ("extra:jpykrw", "JPYKRW", "원/100엔"),
}


def 엔화_100엔당(값: float) -> float:
    """야후의 JPYKRW=X 는 1엔당 원화(약 9.3원)를 준다.

    한국에서는 엔화를 늘 100엔당으로 말한다(약 930원). 그런데 이름만
    '원/100엔' 으로 붙여 놓고 값은 1엔당 그대로 내보내고 있었다 —
    해외 탭에 "원/100엔 9.32원" 이 떠 있었다는 뜻이다. 100배 어긋난 값이다.

    원천이 이미 100엔당으로 주는 경우도 있어서 자릿수를 보고 판단한다.
    1엔당은 5~20원, 100엔당은 500~2000원이라 두 범위가 겹치지 않는다.
    (엔화가 100엔당 100원 밑으로 가는 일은 현실적으로 없다)
    """
    try:
        v = float(값)
    except (TypeError, ValueError):
        return 값
    if v <= 0:
        return v
    return v * 100 if v < 100 else v


def _do_fetch_us_rates() -> list:
    ck = "extra:us_rates"
    # 원달러·원유로·원엔 모두 yfinance history 방식으로 통일 (rt_cache_key 없음)
    specs = [
        ("USDKRW=X",  "원/달러",          "원",  False),
        ("EURKRW=X",  "원/유로",          "원",  False),
        ("JPYKRW=X",  "원/100엔",         "원",  False),
        ("^IRX",      "미국 단기금리(3M)", "%",   True),
        ("^FVX",      "미국 5년 국채",     "%",   True),
        ("^TNX",      "미국 10년 국채",    "%",   True),
        ("^TYX",      "미국 30년 국채",    "%",   True),
        ("^VIX",      "VIX 공포지수",      "pt",  False),
    ]
    close_data = _batch_close([s[0] for s in specs])

    results = []
    for sym, name, unit, is_rate in specs:
        try:
            c2 = close_data[sym].dropna() if (close_data is not None and sym in close_data.columns) \
                 else yf.Ticker(sym).history(period="5d")["Close"].dropna()
            if len(c2) < 1:
                continue
            curr, prev = float(c2.iloc[-1]), float(c2.iloc[-2]) if len(c2) >= 2 else float(c2.iloc[-1])
            # 엔화만 단위를 맞춘다 — 이름은 '원/100엔' 인데 값은 1엔당이었다.
            # 등락률은 비율이라 단위와 무관하지만, 변동폭(chg)은 같이 100배가
            # 되어야 하므로 나누기 전에 바꾼다
            if sym == "JPYKRW=X":
                curr, prev = 엔화_100엔당(curr), 엔화_100엔당(prev)
            chg  = curr - prev
            chgr = chg / prev * 100 if prev and not is_rate else chg
            item = {
                "name": name, "value": round(curr, 3 if is_rate else 2),
                "change": round(chg, 3 if is_rate else 2),
                "change_rate": round(chgr, 3 if is_rate else 2),
                "unit": unit, "is_rate": is_rate,
            }
            results.append(item)
            # 환율은 개별 캐시에도 저장 (get_usdkrw/get_eurkrw 하위 호환)
            if sym in _FX_CACHE_MAP and curr > 0:
                fx_ck, symbol, fx_name = _FX_CACHE_MAP[sym]
                cache.set(fx_ck, {**item, "symbol": symbol, "name": fx_name, "value": round(curr, 2)}, 360)
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
        {"name":"한국 기준금리","value":2.75,"change":0.0,"change_rate":0.0,"unit":"%","is_rate":True,"_demo":True},
        {"name":"CD금리(91일)","value":3.62,"change":0.01,"change_rate":0.01,"unit":"%","is_rate":True,"_demo":True},
        {"name":"국고채 3년","value":3.45,"change":-0.02,"change_rate":-0.02,"unit":"%","is_rate":True,"_demo":True},
        {"name":"국고채 5년","value":3.61,"change":-0.01,"change_rate":-0.01,"unit":"%","is_rate":True,"_demo":True},
        {"name":"국고채 10년","value":3.78,"change":0.01,"change_rate":0.01,"unit":"%","is_rate":True,"_demo":True},
    ]
