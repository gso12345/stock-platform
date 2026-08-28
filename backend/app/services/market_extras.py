"""
국내 시장 부가 데이터
- 선물 (KOSPI200 선물)
- 환율 (원/달러, 원/100엔)
- 금리 (기준금리, CD, 국채)
- 변동성 (VKOSPI)
"""
import os
import logging
import httpx
import yfinance as yf
from concurrent.futures import ThreadPoolExecutor as _ThreadPool
from app.core.config import settings
from app.core.cache import cache
from app.core.backoff import 쉼표
from app.core.fetchcache import 캐시_우선

log = logging.getLogger(__name__)


# ── 안 되는 주소는 그만 물어본다 ───────────────────────────
#
# 금리 조회는 '되는 주소를 모르니 후보를 차례로 걸어 본다' 는 방식이다.
# 뜻은 맞는데, 실패한 후보를 기억하지 않아서 5분마다 처음부터 전부
# 다시 걸었다. 목록 API 3개 × 8초 + 개별 코드 27개 × 5초 — 다 실패하면
# 한 번 갱신에 2분 넘게 잡아먹는다. 0.15 CPU 서버에서는 이것만으로
# 다른 요청이 밀린다.
#
# 뉴스 피드·국내 지수에 쓰던 것을 공용으로 뽑아 그대로 쓴다. 안 되는
# 후보는 몇 번 만에 스스로 빠지고, 20회차(약 100분)에 한 번만 다시
# 찔러본다. 후보를 더 넣어도 값이 거의 안 든다는 뜻이라, 아래에
# 콜금리·회사채·CP·코픽스 후보를 마음 놓고 늘렸다.
# 후보가 50개가 넘어서 '주기마다 전부 깨우기' 는 안 쓴다 — 깨우는 회차
# 하나가 통째로 4분짜리가 되고, 그 회차가 중간에 끊기면 뒷부분은 영영
# 안 깨어난다. 회차마다 두 칸씩 돌아가며 깨운다.
금리쉼표 = 쉼표(쉼_기준=int(os.getenv("RATE_REST_AFTER", 3)),
                되살림_칸=int(os.getenv("RATE_PROBE_SLOTS", 2)))


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

    # 아무 데서도 못 받았으면 빈 목록으로 둔다.
    #
    # 예전에는 여기서 만들어 둔 숫자(373.85)를 돌려줬다. _demo 표시가
    # 붙긴 하지만, 화면에 뜨는 순간 사람은 그 숫자를 본다. 금융 화면에서
    # 지어낸 값은 없는 것보다 나쁘다 — 없으면 다른 데서 찾아보지만
    # 있으면 그대로 믿는다. 카드를 안 그리는 편이 옳다.
    #
    # (yfinance 폴백은 사실상 비어 있다. _fetch_futures_yf 의 specs 가
    #  빈 목록이다 — ETF 값을 선물이라고 보여 주는 것이 맞지 않아
    #  일부러 걷어낸 자리다. 즉 선물은 KIS 키가 있어야 나온다.)
    if not futures:
        cache.set(ck, [], 300)      # 없다는 사실도 잠깐 담아 둔다
        return []

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
        """네이버가 준 이름 → 화면에 쓸 이름. 모르는 것은 None 이라 버려진다.

        여기가 좁아서 받아 놓고 버리던 것이 있었다. 위의 목록 API 는 국내
        금리를 통째로 주는데, 이 함수가 다섯 개만 알아보고 나머지는 전부
        None 으로 떨궜다. 선물을 응답에 담아 놓고 화면에서 안 쓰던 것과
        같은 모양이다.

        아래를 더 알아보게 했다 — 콜금리, 회사채(AA-/BBB-), CP, COFIX.
        전부 금리 화면에 흔히 함께 놓이는 것들이다.

        새 주소를 찍는 것이 아니라 이미 오는 것을 안 버리는 것뿐이라,
        네이버가 그 항목을 안 주면 예전과 똑같이 아무 일도 안 일어난다.
        없던 실패가 생기지 않는다."""
        if not raw: return None
        if "기준금리" in raw: return "한국 기준금리"
        if "CD" in raw and ("91" in raw or "일" in raw): return "CD금리(91일)"
        if ("국고채" in raw or "국고" in raw) and "3년" in raw: return "국고채 3년"
        if ("국고채" in raw or "국고" in raw) and "5년" in raw: return "국고채 5년"
        if ("국고채" in raw or "국고" in raw) and "10년" in raw: return "국고채 10년"
        # ── 여기부터가 예전에 버려지던 것들 ──
        if "콜" in raw and "금리" in raw: return "콜금리(1일)"
        if "회사채" in raw and "AA" in raw.upper(): return "회사채 AA- 3년"
        if "회사채" in raw and "BBB" in raw.upper(): return "회사채 BBB- 3년"
        if raw.upper().startswith("CP") or ("CP" in raw.upper() and "91" in raw):
            return "CP금리(91일)"
        if "COFIX" in raw.upper() or "코픽스" in raw: return "코픽스"
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
    # 목록 주소와 아래 개별 코드를 한 목록으로 모아 한 번만 거른다.
    # 갱신 한 번이 한 회차여야 '몇 회차마다 하나씩 깨운다' 가 뜻대로 돈다.
    이번에 = 금리쉼표.돌아가며_깨우기(
        [("목록", None, u) for u in _네이버_금리목록주소]
        + [(이름, is_cd, 코드)
           for 이름, is_cd, 코드들 in _네이버_금리후보 for 코드 in 코드들],
        lambda t: f"rate:{t[2]}")

    for list_url in [t[2] for t in 이번에 if t[0] == "목록"]:
        try:
            r = httpx.get(list_url, headers=_H, timeout=8)
            if r.status_code != 200:
                금리쉼표.기록(f"rate:{list_url}", True)
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
            금리쉼표.기록(f"rate:{list_url}", not (rates or cd_rate))
            if rates:
                return rates, cd_rate
        except Exception:
            금리쉼표.기록(f"rate:{list_url}", True)
            continue

    # ── 2순위: 개별 코드 조회 (후보 코드 여러 개 시도) ────────
    # 네이버 내부 코드를 확인할 방법이 없어 그럴듯한 후보를 차례로 건다.
    # 콜금리·회사채·CP·코픽스는 예전에는 아예 없었다 — 후보를 넣으면
    # 실패해도 5분마다 그 값을 다시 치르니 넣기가 부담스러웠다.
    # 이제 실패한 후보는 세 번 만에 스스로 빠지므로 넉넉히 넣는다.
    찾음: set = set()
    for name, is_cd, code in 이번에:
        if name == "목록" or name in 찾음:
            continue                      # 이 이름은 앞 후보에서 이미 됐다
        열쇠 = f"rate:{code}"
        try:
            r = httpx.get(
                f"https://m.stock.naver.com/api/rate/{code}/basic",
                headers=_H, timeout=5,
            )
            if r.status_code != 200:
                금리쉼표.기록(열쇠, True)
                continue
            d = r.json()
            if isinstance(d, list):
                d = d[0] if d else {}
            val, chg = _extract(d)
            if val <= 0:
                금리쉼표.기록(열쇠, True)
                continue
            금리쉼표.기록(열쇠, False)
            e = _entry(name, val, chg)
            if is_cd:
                cd_rate = e
            else:
                rates.append(e)
            찾음.add(name)
        except Exception:
            금리쉼표.기록(열쇠, True)
            continue

    return rates, cd_rate


#: 국내 금리를 통째로 준다고 알려진 목록 주소 후보
_네이버_금리목록주소 = [
    "https://m.stock.naver.com/api/rate/domestic",
    "https://m.stock.naver.com/api/rate/index",
    "https://m.stock.naver.com/api/market/domestic/interest",
]

#: 네이버 개별 금리 코드 후보. (화면 이름, CD인가, 후보 코드들)
_네이버_금리후보: list = [
    ("한국 기준금리", False, ["BASERATE", "IRR_BASERATE"]),
    ("CD금리(91일)",  True,  ["CD91", "IRR_CD91", "CD_91"]),
    ("국고채 3년",    False, ["GOV3YR", "GOV3Y", "KTB3YR", "KTB3Y", "IRR_GOV3YR",
                               "IRR_GOV3Y", "GB3YR", "NGS3Y", "NGOV3Y"]),
    ("국고채 5년",    False, ["GOV5YR", "GOV5Y", "KTB5YR", "KTB5Y", "IRR_GOV5YR",
                               "IRR_GOV5Y", "GB5YR", "NGS5Y"]),
    ("국고채 10년",   False, ["GOV10YR", "GOV10Y", "KTB10YR", "KTB10Y", "IRR_GOV10YR",
                                "IRR_GOV10Y", "GB10YR", "NGS10Y"]),
    ("콜금리(1일)",   False, ["CALL", "CALLRATE", "CALL1D", "IRR_CALL", "KORCALL"]),
    ("회사채 AA- 3년", False, ["CB3YR_AA", "CORP3YR_AA", "CORPAA3Y", "CB_AA3Y",
                                "IRR_CB3YR_AA"]),
    ("회사채 BBB- 3년", False, ["CB3YR_BBB", "CORP3YR_BBB", "CORPBBB3Y", "CB_BBB3Y",
                                 "IRR_CB3YR_BBB"]),
    ("CP금리(91일)",  False, ["CP91", "CP_91", "IRR_CP91"]),
    ("코픽스",        False, ["COFIX", "COFIX_NEW", "IRR_COFIX"]),
]


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


#: 한국은행 ECOS '시장금리(일별)' 통계표. 콜금리·CD·CP·회사채가 한 표에 있다.
_ECOS_시장금리 = "817Y002"
_ECOS_항목_CK = f"extra:ecos_items:{_ECOS_시장금리}"


def _ecos_주소() -> str:
    키 = getattr(settings, "BOK_API_KEY", "sample") or "sample"
    return f"https://ecos.bok.or.kr/api/StatisticSearch/{키}/json/kr"


def _ecos_항목목록() -> dict:
    """시장금리표가 담고 있는 항목의 '이름 → 코드' 를 받아 온다.

    코드를 외워 적지 않는 이유가 있다. 이 파일 위쪽 국고채 코드
    (010190000 등)는 누가 언젠가 적어 넣은 것인데, 맞는지 확인할 방법이
    지금은 없다. 코드를 잘못 적으면 오류가 아니라 '빈 결과' 가 조용히
    돌아온다 — 그러면 왜 안 나오는지 찾는 데 한참 걸린다. VKOSPI 를
    지수 이름으로 찾게 바꾼 것과 같은 이유다.

    ECOS 에 '이 표에 무슨 항목이 있느냐' 고 먼저 묻고, 돌아온 이름에서
    콜금리·회사채를 골라낸다. 이름은 사람이 읽는 것이라 잘 안 바뀐다.
    하루에 한 번만 물어본다.
    """
    if (c := cache.get(_ECOS_항목_CK)) is not None:
        return c
    키 = getattr(settings, "BOK_API_KEY", "sample") or "sample"
    표: dict = {}
    try:
        r = httpx.get(
            f"https://ecos.bok.or.kr/api/StatisticItemList/{키}/json/kr"
            f"/1/500/{_ECOS_시장금리}/",
            timeout=8,
        )
        if r.status_code == 200:
            for row in r.json().get("StatisticItemList", {}).get("row", []):
                이름, 코드 = row.get("ITEM_NAME"), row.get("ITEM_CODE")
                if 이름 and 코드:
                    표[str(이름)] = str(코드)
    except Exception as e:
        log.debug("ECOS 항목목록 실패: %s", type(e).__name__)
    # 빈손이어도 담아 둔다 — 5분마다 다시 묻지 않게. 다만 짧게.
    cache.set(_ECOS_항목_CK, 표, 86400 if 표 else 600)
    return 표


def _ecos_한줄(코드: str, 이름: str, 시작: str, 끝: str) -> "dict | None":
    """항목 하나의 최근 값과 전일 대비."""
    try:
        r = httpx.get(f"{_ecos_주소()}/1/5/{_ECOS_시장금리}/D/{시작}/{끝}/{코드}/",
                      timeout=8)
        if r.status_code != 200:
            return None
        rows = r.json().get("StatisticSearch", {}).get("row", [])
        if not rows:
            return None
        값 = float(rows[-1].get("DATA_VALUE") or 0)
        전 = float(rows[-2].get("DATA_VALUE") or 값) if len(rows) >= 2 else 값
        if 값 <= 0:
            return None
        변동 = round(값 - 전, 3)
        return {"name": 이름, "value": round(값, 3), "change": 변동,
                "change_rate": 변동, "unit": "%", "is_rate": True}
    except Exception:
        return None


#: 시장금리표에서 찾아 쓸 것들. (화면 이름, 항목 이름에 들어 있어야 할 말들)
_ECOS_그밖 = [
    ("콜금리(1일)",     ("콜금리",), ("중개",)),
    ("CP금리(91일)",    ("CP",), ()),
    ("회사채 AA- 3년",  ("회사채", "AA-"), ()),
    ("회사채 BBB- 3년", ("회사채", "BBB-"), ()),
]


def _fetch_bok_그밖_ecos() -> list:
    """콜금리·CP·회사채. 국고채와 같은 표에서 나온다.

    회사채는 KRX 쪽(_fetch_kr_bonds_pykrx)에서도 나오지만 콜금리는
    거기 없다. 그래서 이 경로가 따로 필요하다.
    """
    import datetime
    # 항목목록이 비면 아래 for 문이 후보를 하나도 못 찾아 그대로 지나간다.
    # 따로 막지 않는다 — 여기서 미리 돌려보내 봐야 같은 일이고, 대신
    # '없으면 코드를 외워 적어 두자' 는 유혹만 남는다. 그 코드가 틀리면
    # 오류가 아니라 빈 결과가 조용히 돌아온다.
    항목 = _ecos_항목목록()
    오늘 = datetime.date.today()
    끝 = 오늘.strftime("%Y%m%d")
    시작 = (오늘 - datetime.timedelta(days=14)).strftime("%Y%m%d")

    결과: list = []
    for 화면이름, 있어야할것, 없어야할것 in _ECOS_그밖:
        후보 = [(이름, 코드) for 이름, 코드 in 항목.items()
                if all(k in 이름 for k in 있어야할것)
                and not any(k in 이름 for k in 없어야할것)]
        if not 후보:
            continue
        # 이름이 짧은 쪽이 대표 항목이다 — '콜금리' 와 '콜금리(중개회사거래)'
        # 가 같이 있으면 앞의 것을 쓴다.
        후보.sort(key=lambda x: len(x[0]))
        열쇠 = f"ecos:{후보[0][1]}"
        if (한줄 := _ecos_한줄(후보[0][1], 화면이름, 시작, 끝)):
            금리쉼표.기록(열쇠, False)
            결과.append(한줄)
        else:
            금리쉼표.기록(열쇠, True)
    return 결과


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


def _fetch_kr_bonds_pykrx() -> "tuple[list, dict | None, list]":
    """pykrx로 KRX 장외 채권수익률 조회.

    KRX 가 이 한 번의 요청에 돌려주는 표는 이렇다:

        국고채 1/2/3/5/10/20/30년, 국민주택 1종 5년,
        회사채 AA-(무보증 3년), 회사채 BBB- (무보증 3년), CD(91일)

    회사채 두 줄이 여기 이미 들어 있었다. 그런데 아래 for 문이 국고채
    3·5·10년과 CD 만 집어 가고 나머지는 버렸다 — 받아 놓고 안 쓰는
    자리가 또 하나 있었던 것이다. '콜금리·회사채가 안 뜬다' 의 절반은
    새 원천이 없어서가 아니라 오던 것을 버리고 있어서였다.

    돌려주는 것: (국고채, CD, 그 밖의 금리)
    """
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
            return [], None, []

        def _줄(krx_name: str, display_name: str) -> "dict | None":
            if krx_name not in df.index:
                return None
            row = df.loc[krx_name]
            val = float(row["수익률"])
            chg = float(row["대비"]) if "대비" in row.index else 0.0
            return {"name": display_name, "value": round(val, 3),
                    "change": round(chg, 3), "change_rate": round(chg, 3),
                    "unit": "%", "is_rate": True}

        def _찾기(후보: list, display_name: str) -> "dict | None":
            """KRX 가 이름에 공백을 어떻게 넣는지가 표마다 조금씩 다르다
            ('회사채 BBB- (무보증 3년)' 처럼 괄호 앞에 공백이 있는 줄이 있다).
            정확히 일치하는 것을 먼저 보고, 없으면 공백을 지우고 견준다."""
            for 이름 in 후보:
                if (r := _줄(이름, display_name)):
                    return r
            납작 = {str(i).replace(" ", ""): i for i in df.index}
            for 이름 in 후보:
                키 = 이름.replace(" ", "")
                if 키 in 납작:
                    return _줄(납작[키], display_name)
            return None

        bonds = [b for b in (_줄(n, n) for n in
                             ("국고채 3년", "국고채 5년", "국고채 10년")) if b]

        cd = _찾기(["CD(91일)", "CD91일", "CD"], "CD금리(91일)")

        # 표에 이미 들어 있던 회사채 두 줄. 예전에는 여기서 버려졌다.
        그밖 = [x for x in (
            _찾기(["회사채 AA-(무보증 3년)", "회사채 AA- (무보증 3년)",
                   "회사채AA-(무보증3년)"], "회사채 AA- 3년"),
            _찾기(["회사채 BBB- (무보증 3년)", "회사채 BBB-(무보증 3년)",
                   "회사채BBB-(무보증3년)"], "회사채 BBB- 3년"),
        ) if x]

        return bonds, cd, 그밖
    except Exception:
        return [], None, []


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

    """**해외 탭이 실제로 그리는 목록** 하나만 본다.

    지난번에 '해외 탭이 쓰는 묶음을 부른다' 로 고쳤는데도 여전히 안
    나왔다. 재현해 보고 알았다 — 값이 두 군데 있고 수명이 어긋난다.

      extra:us_rates  300초   해외 탭이 그리는 목록
      extra:eurkrw    360초   같은 함수가 낱개로도 담아 둔 값

    그런데 get_us_rates() 는 **캐시 우선**이다. extra:us_rates 가 살아
    있으면 _do_fetch_us_rates 를 아예 안 부른다. 그래서 낱개 열쇠가
    먼저 비면 아무도 다시 안 채운다 — 해외 탭에는 목록이 멀쩡히 떠
    있는데 국내 탭만 비는 상태가 그대로 굳는다. 재현 결과:

      extra:us_rates 살아 있음 · extra:eurkrw 만 만료
        → 국내 목록 ['한국 기준금리', 'CD금리(91일)']   · 묶음 조회 0회

    수명만 맞춰서는 부족하다. 값이 두 군데 있는 한 언젠가 또 어긋난다.
    해외 탭이 그리는 목록에서 같은 이름을 꺼내 쓴다."""
    def 만들기(항목: "dict | None") -> "dict | None":
        """어디서 꺼냈든 **같은 규칙**으로 카드를 만든다.

        두 경로에 각각 계산을 두면 언젠가 한쪽만 고쳐진다. 실제로
        엔화 단위(1엔당 vs 100엔당)가 그렇게 어긋나 100배 틀린 값이
        몇 달 떠 있었다.

        환산을 목록 값에도 그대로 건다. 목록에는 이미 100엔당으로
        담기지만(_do_fetch_us_rates), 엔화_100엔당() 은 100 이상이면
        그냥 두므로 두 번 걸어도 값이 안 바뀐다. 뮤테이션으로 확인했다 —
        환산을 빼도 검사가 안 깨진다. 그래서 '빼도 되는 줄' 이 아니라
        '걸어 두는 편이 안전한 줄' 로 남긴다. 원천이 1엔당을 흘려보내는
        날 이쪽만 못 잡으면 그게 바로 지난번 사고다."""
        if not (항목 and 항목.get("value")):
            return None
        원값 = float(항목["value"])
        값 = 환산(원값)
        배수 = (값 / 원값) if 원값 else 1
        return {"name": 이름, "unit": "원", "value": round(값, 2),
                "change": round(float(항목.get("change") or 0) * 배수, 2),
                "change_rate": round(float(항목.get("change_rate") or 0), 2)}

    for x in (cache.get("extra:us_rates") or cache.get_stale("extra:us_rates") or []):
        if x.get("name") == 이름 and x.get("value"):
            return 만들기(x)

    """목록에 없으면 낱개 열쇠를 본다.

    목록이 통째로 비었는데 낱개는 남아 있는, 위와 반대인 어긋남도
    있을 수 있다. 여기서는 받지 않는다 — 채우는 일은 부르는 쪽이
    한 번에 한다(_환율_채워두기)."""
    return 만들기(cache.get(캐시키) or cache.get_stale(캐시키))


def _환율_채워두기() -> None:
    """원/달러·원/유로·원/100엔을 **해외 탭이 쓰는 그 묶음**으로 채운다.

    get_us_rates() 는 여덟 심볼을 한 번에 받고(_batch_close), 받은 환율을
    extra:usdkrw·extra:eurkrw·extra:jpykrw 에 그대로 담는다. 캐시 우선이라
    해외 탭이 이미 받아 뒀으면 요청이 하나도 안 늘어난다.

    이미 꺼낼 수 있으면 아예 안 부른다 — 국내 탭 때문에 미국 금리까지
    받아 올 이유는 없다.

    '있나' 를 낱개 열쇠로만 보면 안 된다. 해외 탭이 그리는 목록에는
    멀쩡히 있는데 낱개만 만료된 상태가 흔하고(수명이 300초 대 360초로
    다르다), 그때 여기서 또 받으면 이미 손에 있는 값을 위해 왕복을
    하나 더 태우는 셈이다. **화면이 실제로 꺼내 쓰는 그 경로**로 본다.
    """
    if get_eurkrw() and get_jpykrw_100():
        return
    try:
        get_us_rates()
    except Exception as e:
        log.debug("환율 묶음 받기 실패: %s", type(e).__name__)


def get_jpykrw_100() -> "dict | None":
    """원/100엔. 야후는 1엔당으로 주므로 100을 곱한다."""
    return _환율카드("extra:jpykrw", "원/100엔", "JPYKRW=X", 엔화_100엔당)


def get_eurkrw() -> "dict | None":
    """원/유로. 달러·엔과 달리 단위를 손댈 것이 없다."""
    return _환율카드("extra:eurkrw", "원/유로", "EURKRW=X")


# ── 왜 안 왔는지 남긴다 ────────────────────────────────────
#
# "콜금리 회사채 안뜸" 을 두 번 들었다. 첫 번째에 고쳤다고 했는데 또
# 안 됐다. 원인을 못 짚은 게 아니라 **짚을 방법이 없었다** — 작업
# 환경에서는 네이버·KRX·ECOS 가 전부 막혀 있어서, 코드를 고쳐도 그게
# 맞는지 프로덕션에 올려 보기 전에는 알 수가 없다. 그리고 올린 뒤에도
# 화면에 안 뜨는 것만 보일 뿐 왜 안 뜨는지는 안 보인다.
#
# 그래서 원천마다 '뭘 해 봤고 뭐가 돌아왔는지' 를 남긴다. 관리자 화면에서
# 이걸 보면 다음 한 번에 고칠 수 있다 — 지금처럼 짐작으로 후보를 바꿔
# 가며 배포를 되풀이하지 않아도 된다.
_금리진단: dict = {}


def 금리진단() -> dict:
    """관리자 화면용 — 원천별 마지막 시도 결과."""
    return dict(_금리진단)


def _남기기(원천: str, 결과: str, 개수: int = 0, 받은것: "list | None" = None):
    import datetime
    _금리진단[원천] = {
        "결과": 결과, "개수": 개수,
        "받은것": [x.get("name") for x in (받은것 or [])][:12],
        "언제": datetime.datetime.now().strftime("%m/%d %H:%M:%S"),
    }


#: 네이버 시장지표 페이지의 금리 코드. 주소에 그대로 드러나 있는 값들이라
#: (finance.naver.com/marketindex/interestDailyQuote.naver?marketindexCd=…)
#: 모바일 JSON API 코드를 짐작하던 것보다 근거가 있다.
지표쉼표 = 쉼표(쉼_기준=int(os.getenv("RATE_REST_AFTER", 3)),
                되살림_칸=int(os.getenv("RATE_PROBE_SLOTS", 2)))

_시장지표_금리 = [
    ("콜금리(1일)",      "IRR_CALL"),
    ("CD금리(91일)",     "IRR_CD91"),
    ("CP금리(91일)",     "IRR_CP91"),
    ("국고채 3년",       "IRR_GOVT03Y"),
    ("국고채 5년",       "IRR_GOVT05Y"),
    ("국고채 10년",      "IRR_GOVT10Y"),
    ("회사채 AA- 3년",   "IRR_CORP03Y"),
]


def _fetch_kr_rates_시장지표() -> list:
    """네이버 금융 '시장지표' 페이지에서 금리를 읽는다.

    지금까지 두드리던 곳은 m.stock.naver.com 의 JSON API 였는데, 거기
    금리 코드는 짐작이었다. 이 페이지는 다르다 — 코드가 공개된 주소에
    그대로 들어 있다. 사람이 브라우저로 열어 확인할 수 있는 값이라
    짐작이 아니다.

    HTML 을 읽는 것이 마음에 들지는 않는다. 그래도 —
      · 이 페이지는 십수 년째 같은 모양이다(표 한 줄에 날짜·금리)
      · 키가 필요 없다. ECOS 는 한국은행 API 키가 있어야 하는데
        기본값이 'sample' 이라 대부분의 통계가 막혀 있다
      · 실패해도 백오프가 알아서 물러난다

    숫자를 아주 헐겁게 찾는다. 표 구조가 바뀌어도 '첫 번째로 나오는
    소수점 있는 숫자' 는 대개 그대로다. 금리 범위(0~20%)를 벗어나면
    버린다 — 엉뚱한 숫자를 금리라고 보여 주느니 안 보여 주는 게 낫다."""
    import re as _re
    _H = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
          "Accept-Language": "ko-KR,ko;q=0.9",
          "Referer": "https://finance.naver.com/marketindex/"}
    결과: list = []
    # 쉼표를 따로 둔다. 금리쉼표와 후보 목록이 달라서, 같이 쓰면 깨울
    # 자리를 세는 커서가 서로 엇갈린다.
    for 이름, 코드 in 지표쉼표.돌아가며_깨우기(_시장지표_금리, lambda t: f"지표:{t[1]}"):
        열쇠 = f"지표:{코드}"
        try:
            r = httpx.get(
                "https://finance.naver.com/marketindex/interestDailyQuote.naver",
                params={"marketindexCd": 코드}, headers=_H, timeout=6)
            if r.status_code != 200:
                지표쉼표.기록(열쇠, True)
                continue
            본문 = r.text
            # 표의 첫 줄이 가장 최근 값이다. 날짜(2026.08.24)는 건너뛰고
            # 소수점 있는 두 자리 이하 숫자만 본다.
            숫자들 = _re.findall(r">\s*(\d{1,2}\.\d{2,3})\s*<", 본문)
            값 = next((float(x) for x in 숫자들 if 0 < float(x) < 20), None)
            if 값 is None:
                지표쉼표.기록(열쇠, True)
                continue
            전 = next((float(x) for x in 숫자들[1:] if 0 < float(x) < 20), 값)
            지표쉼표.기록(열쇠, False)
            결과.append({"name": 이름, "value": round(값, 3),
                         "change": round(값 - 전, 3), "change_rate": round(값 - 전, 3),
                         "unit": "%", "is_rate": True})
        except Exception:
            지표쉼표.기록(열쇠, True)
            continue
    return 결과


#: 화면에 늘 함께 놓는 국고채 세 줄. 하나만 있으면 나머지를 더 찾아야 한다.
_국고채_세줄 = ("국고채 3년", "국고채 5년", "국고채 10년")


def _빠진_국고채(bonds: list) -> list:
    """세 줄 중 아직 없는 것.

    `if not bonds` 로 판단하던 자리를 대신한다. 그 조건은 국고채 3년
    하나만 받아도 "있음" 으로 봐서, 5년·10년을 받을 기회를 없앴다.
    실제로 그랬다 — 네이버 시장지표가 3년만 주는데 그걸로 bonds 가
    채워져서 yfinance 도 pykrx 도 안 돌았다.

    '몇 개 있느냐' 가 아니라 '무엇이 빠졌느냐' 를 물어야 한다."""
    있는것 = {x.get("name") for x in bonds}
    return [n for n in _국고채_세줄 if n not in 있는것]


def _국고채_채우기(bonds: list, 새것: list) -> list:
    """빠진 것만 채운다. 이미 있는 것은 먼저 온 원천을 그대로 둔다.

    앞 원천이 더 믿을 만해서다(네이버 시장지표 > yfinance). 그리고
    같은 이름이 두 줄 뜨는 것을 막는다.

    화면에서 3·5·10년이 순서대로 붙어 보이도록 정렬해서 돌려준다 —
    한 묶음으로 읽는 값이라 사이가 뒤바뀌면 눈이 걸린다."""
    있는것 = {x.get("name") for x in bonds}
    합친것 = bonds + [x for x in (새것 or []) if x.get("name") not in 있는것]
    차례 = {n: i for i, n in enumerate(_국고채_세줄)}
    return sorted(합친것, key=lambda x: 차례.get(x.get("name"), 99))


def _do_fetch_kr_rates() -> list:
    ck = "extra:kr_rates"

    base: "dict | None" = None
    bonds: list = []
    그밖: list = []                  # 콜금리·회사채·CP·코픽스 등
    cd_override: "dict | None" = None

    # 1순위: 네이버 모바일 API (주식/환율과 동일 도메인, 서버에서 작동)
    try:
        naver_rates, naver_cd = _fetch_kr_rates_naver()
        if not base:
            base = next((r for r in naver_rates if "기준금리" in r["name"]), None)
            if base:
                cache.set("extra:kr_base_rate", base, 86400)
        """국고채와 '그 밖의 금리' 를 갈라 담는다.

        예전에는 국고채만 골라 담고 나머지는 버렸다. 위 _display 가
        새로 알아보게 된 것들(콜금리·회사채·CP·코픽스)이 여기서 또
        떨어지면 살린 뜻이 없다.

        둘을 `if not bonds` 안에 같이 묶어 두지 않는다 — 네이버가
        국고채는 안 주고 콜금리만 줄 수도 있는데, 묶어 두면 그때
        국고채가 없다는 이유로 콜금리까지 못 담는다."""
        bonds = [r for r in naver_rates if "국고채" in r["name"]]
        그밖 = [r for r in naver_rates
                if "국고채" not in r["name"] and "기준금리" not in r["name"]]
        if naver_cd:
            cd_override = naver_cd
        _남기기("네이버 모바일 API", "받음" if naver_rates else "빈손",
                len(naver_rates), naver_rates)
    except Exception as e:
        _남기기("네이버 모바일 API", f"실패({type(e).__name__})")

    def _채우기(원천: str, 부르기, 조건: bool = True):
        """원천 하나를 시도하고, 없던 것만 채우고, 결과를 남긴다.

        예전에는 원천마다 try/except 를 따로 썼고 실패는 pass 로 삼켰다.
        그래서 '콜금리가 왜 안 오는지' 를 볼 방법이 아무 데도 없었다."""
        nonlocal 그밖
        if not 조건:
            _남기기(원천, "건너뜀(이미 있음)")
            return
        try:
            받은것 = 부르기() or []
            있는것 = {x["name"] for x in 그밖} | {x["name"] for x in bonds}
            새것 = [x for x in 받은것 if x["name"] not in 있는것]
            그밖 = 그밖 + 새것
            _남기기(원천, "받음" if 받은것 else "빈손", len(받은것), 받은것)
        except Exception as e:
            _남기기(원천, f"실패({type(e).__name__}: {str(e)[:60]})")

    # 2순위: 네이버 시장지표 페이지 (키가 필요 없고, 코드가 주소에 드러나 있다)
    #
    # 콜금리·회사채·CP 가 여기 다 있다. 위 모바일 API 는 금리 코드가
    # 짐작이었는데 이쪽은 사람이 브라우저로 열어 확인할 수 있는 주소다.
    부족한것 = {"콜금리", "회사채", "CP"}
    있는이름 = " ".join(x["name"] for x in 그밖)
    if any(k not in 있는이름 for k in 부족한것):
        _채우기("네이버 시장지표(HTML)", _fetch_kr_rates_시장지표)
        # 여기서 국고채도 같이 오면 그쪽으로도 채운다
        국고채들 = [x for x in 그밖 if "국고채" in x["name"]]
        if 국고채들 and not bonds:
            bonds = 국고채들
            그밖 = [x for x in 그밖 if "국고채" not in x["name"]]
        if not cd_override:
            cd_override = next((x for x in 그밖 if "CD금리" in x["name"]), None)
            if cd_override:
                그밖 = [x for x in 그밖 if "CD금리" not in x["name"]]

    # 3순위: 한국은행 ECOS API — 기준금리·국고채
    if not base or _빠진_국고채(bonds):
        try:
            bok_base, bok_bonds = _fetch_bok_rates_ecos()
            if not base and bok_base:
                base = bok_base
            bonds = _국고채_채우기(bonds, bok_bonds)
            _남기기("ECOS 기준금리·국고채",
                    "받음" if (bok_base or bok_bonds) else "빈손(API 키 확인)",
                    len(bok_bonds) + (1 if bok_base else 0), bok_bonds)
        except Exception as e:
            _남기기("ECOS 기준금리·국고채", f"실패({type(e).__name__})")
    else:
        _남기기("ECOS 기준금리·국고채", "건너뜀(이미 있음)")

    # 4순위: yfinance (KR3YT=RR 등)
    #
    # 조건이 `if not bonds` 였다. 국고채 3년 하나만 받아도 "있음" 으로
    # 보고 여기를 건너뛰어서, 5년·10년이 영영 안 왔다. 실제로 그랬다 —
    # 네이버 시장지표가 3년만 주는데 그걸로 bonds 가 채워져서 yfinance 도
    # pykrx 도 안 돌았다. 오늘 회사채에서 고친 것과 같은 종류의 버그다.
    #
    # 이제 '몇 개 있느냐' 가 아니라 '무엇이 빠졌느냐' 를 본다.
    if _빠진_국고채(bonds):
        try:
            새것 = _fetch_kr_bonds_yf()
            bonds = _국고채_채우기(bonds, 새것)
            _남기기("yfinance 국고채", "받음" if 새것 else "빈손", len(새것), 새것)
        except Exception as e:
            _남기기("yfinance 국고채", f"실패({type(e).__name__})")
    else:
        _남기기("yfinance 국고채", "건너뜀(3·5·10년 다 있음)")

    # 5순위: pykrx (KRX 장외채권수익률)
    #
    # 이 표 하나에 국고채 1~30년과 회사채 AA-/BBB- 가 다 들어 있다.
    # 위 원천들이 국고채 3년·회사채 AA- 만 주는 일이 잦아서, 여기가
    # 나머지를 메우는 자리가 된다.
    #
    # 조건을 두 번 고쳤다. 처음엔 `if not bonds` 라 국고채가 하나만
    # 있어도 건너뛰었고, 다음엔 회사채만 봤다. 지금은 국고채 3·5·10년과
    # 회사채 AA-·BBB- 중 하나라도 빠졌으면 부른다 — 어차피 요청 한 번에
    # 표 전체가 온다.
    빠진회사채 = [n for n in ("회사채 AA- 3년", "회사채 BBB- 3년")
                  if not any(x["name"] == n for x in 그밖)]
    if _빠진_국고채(bonds) or 빠진회사채:
        try:
            pkrx_bonds, pkrx_cd, pkrx_그밖 = _fetch_kr_bonds_pykrx()
            bonds = _국고채_채우기(bonds, pkrx_bonds)
            if pkrx_cd and not cd_override:
                cd_override = pkrx_cd
            있는것 = {x["name"] for x in 그밖}
            그밖 = 그밖 + [x for x in pkrx_그밖 if x["name"] not in 있는것]
            _남기기("KRX 장외채권(pykrx)",
                    "받음" if (pkrx_bonds or pkrx_그밖) else "빈손",
                    len(pkrx_bonds) + len(pkrx_그밖), pkrx_bonds + pkrx_그밖)
        except Exception as e:
            _남기기("KRX 장외채권(pykrx)", f"실패({type(e).__name__}: {str(e)[:60]})")
    else:
        _남기기("KRX 장외채권(pykrx)", "건너뜀(국고채·회사채 다 있음)")

    # 6순위: ECOS 시장금리표 — 콜금리가 여기에도 있다
    _채우기("ECOS 시장금리표", _fetch_bok_그밖_ecos,
            조건=not any("콜금리" in x["name"] for x in 그밖))

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
    #
    # 셋을 **동시에** 부른다. 차례로 부르면 셋이 다 캐시에 없을 때
    # 왕복이 셋으로 줄줄이 이어진다 — 위 금리 원천들이 이미 몇 초를
    # 쓰고 난 뒤라, 그 뒤에 붙는 시간이 그대로 화면 대기가 된다.
    # (셋 다 캐시에 있으면 어차피 즉시라, 손해 볼 것이 없다)
    #
    # 환율 묶음과 VKOSPI 를 **동시에** 받는다. 서로 상관없는 원천이라
    # 차례로 부르면 왕복이 줄줄이 이어진다 — 위 금리 원천들이 이미 몇
    # 초를 쓰고 난 뒤라, 뒤에 붙는 시간이 그대로 화면 대기가 된다.
    # (둘 다 캐시에 있으면 어차피 즉시라 손해 볼 것이 없다)
    #
    # 유로·엔은 여기 안 넣는다. 그 둘은 환율 묶음이 채워 둔 캐시를
    # **읽기만** 하므로, 같이 돌리면 아직 안 채워진 캐시를 읽는다.
    곁들이: dict[str, "dict | None"] = {}
    with _ThreadPool(max_workers=2) as 풀:
        맡김 = {"환율묶음": 풀.submit(_환율_채워두기),
                "vkospi": 풀.submit(get_vkospi)}
    for 키, 일 in 맡김.items():
        try:
            곁들이[키] = 일.result()
        except Exception as e:
            log.debug("%s 실패: %s", 키, type(e).__name__)
            곁들이[키] = None
    # 묶음이 끝난 뒤에 읽는다 — 둘 다 캐시만 보므로 즉시다
    for 키, 부르기 in (("유로", get_eurkrw), ("엔화", get_jpykrw_100)):
        try:
            곁들이[키] = 부르기()
        except Exception as e:
            log.debug("%s 실패: %s", 키, type(e).__name__)
            곁들이[키] = None

    # 순서: 환율 → 정책·단기금리 → 국고채 → 그 밖의 금리 → VKOSPI
    #
    # '그 밖' 을 국고채 뒤에 두는 이유 — 국고채 3/5/10년은 한 묶음으로
    # 읽는 값이라 사이에 다른 것이 끼면 눈이 걸린다.
    rates = [x for x in ([곁들이["유로"], 곁들이["엔화"]]
                         + [base, cd_rate] + bonds + 그밖
                         + [곁들이["vkospi"]]) if x]

    # 값이 상식 범위를 벗어나면 기록해 둔다.
    #
    # 원/100엔이 1엔당 값으로 몇 달 떠 있었는데 아무 오류도 안 났다.
    # 조회가 성공하면 그걸로 끝이었기 때문이다. 금융 화면에서 틀린 숫자는
    # 없는 것보다 나쁘다 — 없으면 다른 데서 찾아보지만 틀린 값은 믿는다.
    # 값을 고치지는 않는다(고칠 수 있으면 이상한 게 아니다). 관리자 화면에
    # 뜨게만 한다.
    try:
        from app.core import sanity
        sanity.환율금리_확인(rates)
        for it in rates:
            sanity.움직이는지_확인(f"환율금리:{it.get('name')}", it.get("value"))
    except Exception as e:
        log.debug("이상값 확인 건너뜀: %s", type(e).__name__)

    """반쪽짜리 목록은 **짧게만** 담는다.

    환율 둘이 빠진 채로 300초를 담아 두면, 그 사이에 해외 탭이 열려
    extra:eurkrw 가 채워져도 국내 탭은 5분 내내 옛 목록을 준다. 실제로
    재 봤을 때 그렇게 나왔다 — 두 화면이 같은 값을 두고 5분 동안 서로
    다른 말을 하는 셈이고, 사용자에게는 '안 나올 때가 있다' 로 보인다.

    빠진 것이 있으면 30초만 담는다. 다음 요청이 곧 다시 시도해서,
    묶음이 도착하는 대로 채워진다. 자산 스냅샷에서 고친 것과 같은
    결함이다 — 덜 채워진 값을 완성품처럼 얼려 두는 것."""
    있는이름 = " ".join(x.get("name", "") for x in rates)
    온전한가 = "유로" in 있는이름 and "100엔" in 있는이름
    cache.set(ck, rates, 300 if 온전한가 else 30)
    return rates


# ── 캐시 우선으로 내주는 공통 규칙 ─────────────────────────
#
# 여기 있던 `_캐시_우선` 을 app/core/fetchcache.py 로 옮겼다. 같은 결함이
# 환율·국내 금리·미국 금리에 이어 재무제표·컨센서스에도 있었다 — 다섯
# 곳이면 더는 '여기 사정' 이 아니라 공통 규칙이다.
#
# 이름은 그대로 둔다. 이 파일 안에서 부르는 자리와 시험이 이 이름을 쓴다.
MISS_TTL = int(os.getenv("EXTRAS_MISS_TTL", 60))


def _캐시_우선(ck: str, 받기, 빈값):
    """캐시 → 지난 값 → (한 번만) 직접. 요청을 오래 잡지 않는 것이 규칙이다."""
    return 캐시_우선(ck, 받기, 빈값, miss_ttl=MISS_TTL)


def get_kr_rates() -> list:
    return _캐시_우선("extra:kr_rates", _do_fetch_kr_rates, [])


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
    return _캐시_우선("extra:us_rates", _do_fetch_us_rates, [])


def _demo_rates() -> list:
    return [
        {"name":"한국 기준금리","value":2.75,"change":0.0,"change_rate":0.0,"unit":"%","is_rate":True,"_demo":True},
        {"name":"CD금리(91일)","value":3.62,"change":0.01,"change_rate":0.01,"unit":"%","is_rate":True,"_demo":True},
        {"name":"국고채 3년","value":3.45,"change":-0.02,"change_rate":-0.02,"unit":"%","is_rate":True,"_demo":True},
        {"name":"국고채 5년","value":3.61,"change":-0.01,"change_rate":-0.01,"unit":"%","is_rate":True,"_demo":True},
        {"name":"국고채 10년","value":3.78,"change":0.01,"change_rate":0.01,"unit":"%","is_rate":True,"_demo":True},
    ]
