"""
실시간 가격 조회
- 한국 주식/지수: 네이버 금융 모바일 API (무료, 실시간)
- 미국 주식: Yahoo Finance v7/v8 (query1/query2 교차)
- 환율: 네이버 금융
"""
import httpx
import asyncio
import os
import re
import logging
from app.core.cache import cache
from app.core.backoff import 쉼표
from app.core.utils import safe_float as _safe

log = logging.getLogger(__name__)

NAVER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Linux; Android 10; SM-G981B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.162 Mobile Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "ko-KR,ko;q=0.9",
    "Referer": "https://m.stock.naver.com/",
    "Origin": "https://m.stock.naver.com",
}

YF_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
}

_yf_base_counter = 0  # query1/query2 교차용


def _yf_base() -> str:
    global _yf_base_counter
    _yf_base_counter += 1
    return "query2" if _yf_base_counter % 2 == 0 else "query1"


# ── 네이버 모바일 — 한국 주식 ──────────────────────────────
def _parse_kr_num(s) -> float:
    """'1,853조 2,703억', '29,704,413백만' 같은 한국식 숫자 파싱"""
    if s is None:
        return 0
    s = str(s).replace(",", "").replace(" ", "")
    total = 0.0
    try:
        if "조" in s:
            parts = s.split("조")
            total += float(parts[0] or 0) * 1e12
            s = parts[1] if len(parts) > 1 else ""
        if "억" in s:
            parts = s.split("억")
            total += float(parts[0] or 0) * 1e8
            s = parts[1] if len(parts) > 1 else ""
        if "백만" in s:  # "만" 전에 먼저 처리 (거래대금 단위)
            parts = s.split("백만")
            total += float(parts[0] or 0) * 1e6
            s = parts[1] if len(parts) > 1 else ""
        elif "만" in s:
            parts = s.split("만")
            total += float(parts[0] or 0) * 1e4
    except (ValueError, TypeError):
        pass
    return total or _safe(s) or 0


async def _fetch_naver_one(cl: httpx.AsyncClient, code6: str) -> dict | None:
    """공유 AsyncClient로 단일 네이버 종목 조회 (connection pool 재사용)"""
    try:
        basic_r, intg_r = await asyncio.gather(
            cl.get(f"https://m.stock.naver.com/api/stock/{code6}/basic"),
            cl.get(f"https://m.stock.naver.com/api/stock/{code6}/integration"),
            return_exceptions=True,
        )

        if not isinstance(basic_r, Exception) and basic_r.status_code == 200:
            b = basic_r.json()
        else:
            return None
        curr = _safe(b.get("closePrice"))
        if curr is None:
            return None
        chg  = _safe(b.get("compareToPreviousClosePrice")) or 0
        chgr = _safe(b.get("fluctuationsRatio")) or 0

        info: dict = {}
        if not isinstance(intg_r, Exception) and intg_r.status_code == 200:
            for item in (intg_r.json().get("totalInfos") or []):
                code_key = str(item.get("code","")).lower()
                info[code_key] = item.get("value","")

        def num(key): return _parse_kr_num(info.get(key.lower()))
        def pct(key):
            v = str(info.get(key.lower(),"")).replace("%","").replace("배","").replace(",","")
            return _safe(v)

        exchange = str(b.get("stockExchangeType", {}).get("code", "KS"))
        market_suffix = ".KQ" if "KQ" in exchange or "KOSDAQ" in exchange.upper() else ".KS"

        return {
            "symbol":         f"{code6}{market_suffix}",
            "name":           b.get("stockName",""),
            "price":          curr,
            "prev_close":     _parse_kr_num(info.get("lastcloseprice")) or (curr - chg),
            "change":         round(chg, 2),
            "change_rate":    round(chgr, 2),
            "open":           num("openPrice") or None,
            "high":           num("highPrice") or None,
            "low":            num("lowPrice") or None,
            "volume":         int(num("accumulatedTradingVolume")),
            "amount":         int(num("accumulatedTradingValue")),
            "market_cap":     int(num("marketValue")),
            "per":            pct("per"),
            "forward_per":    pct("cnsPer"),
            "pbr":            pct("pbr"),
            "eps":            _parse_kr_num(info.get("eps")) or None,
            "forward_eps":    _parse_kr_num(info.get("cnsEps")) or None,
            "bps":            _parse_kr_num(info.get("bps")) or None,
            "dividend_yield": pct("dividendYieldRatio"),
            "week52_high":    num("highPriceOf52Weeks") or None,
            "week52_low":     num("lowPriceOf52Weeks") or None,
            "foreign_rate":   pct("foreignRate"),
            "currency":       "KRW",
            "market":         "KOSDAQ" if "KQ" in exchange else "KOSPI",
        }
    except Exception as e:
        log.debug(f"네이버 주식 {code6} 실패: {e}")
        return None


async def fetch_naver_stock(code6: str) -> dict | None:
    """네이버 모바일 API (basic + integration) 로 한국 종목 실시간 조회"""
    async with httpx.AsyncClient(timeout=10, headers=NAVER_HEADERS) as cl:
        return await _fetch_naver_one(cl, code6)


async def _fetch_naver_price_only(cl: httpx.AsyncClient, code6: str) -> dict | None:
    """가격·등락만 가져온다 (basic 1회).

    전체 조회(_fetch_naver_one)는 종목당 basic + integration 2회를 쓴다.
    integration 이 주는 값(시가총액·PER·52주 등)은 초 단위로 변하지 않으므로,
    자주 도는 실시간 갱신에서는 가격만 받아 기존 캐시에 덮어쓰면 된다.
    요청 수가 절반이 되어 그만큼 주기를 당길 수 있다."""
    try:
        r = await cl.get(f"https://m.stock.naver.com/api/stock/{code6}/basic")
        if r.status_code != 200:
            return None
        b = r.json()
        curr = _safe(b.get("closePrice"))
        if curr is None:
            return None
        exchange = str(b.get("stockExchangeType", {}).get("code", "KS"))
        suffix = ".KQ" if "KQ" in exchange or "KOSDAQ" in exchange.upper() else ".KS"
        return {
            "symbol":      f"{code6}{suffix}",
            "name":        b.get("stockName", ""),
            "price":       curr,
            "change":      round(_safe(b.get("compareToPreviousClosePrice")) or 0, 2),
            "change_rate": round(_safe(b.get("fluctuationsRatio")) or 0, 2),
            "currency":    "KRW",
            "market":      "KOSDAQ" if "KQ" in exchange else "KOSPI",
        }
    except Exception:
        return None


async def fetch_naver_prices_light(codes: list[str], concurrency: int = 20) -> dict[str, dict]:
    """여러 국내 종목의 가격만 조회.

    동시 요청 수를 제한한다. 예전 fetch_naver_stocks 는 종목 수만큼 무제한으로
    gather 해서, 종목이 많으면 httpx 커넥션 풀(기본 100)을 넘겨 대기하다
    타임아웃으로 조용히 실패했다."""
    if not codes:
        return {}
    sem = asyncio.Semaphore(concurrency)

    async def one(cl, code):
        async with sem:
            return await _fetch_naver_price_only(cl, code)

    async with httpx.AsyncClient(timeout=8, headers=NAVER_HEADERS) as cl:
        results = await asyncio.gather(*[one(cl, c) for c in codes], return_exceptions=True)
    return {c: r for c, r in zip(codes, results) if isinstance(r, dict) and r}


async def fetch_naver_stocks(codes: list[str]) -> dict[str, dict]:
    """여러 한국 종목 병렬 조회 — 단일 AsyncClient로 connection pool 재사용"""
    if not codes:
        return {}
    async with httpx.AsyncClient(timeout=10, headers=NAVER_HEADERS) as cl:
        results = await asyncio.gather(
            *[_fetch_naver_one(cl, c) for c in codes],
            return_exceptions=True,
        )
    out = {}
    for code, r in zip(codes, results):
        if isinstance(r, dict) and r:
            out[code] = r
    return out


# ── 네이버 모바일 — 한국 지수 ──────────────────────────────
# 네이버가 지수를 부르는 내부 코드.
#
# 코스닥150 이 화면에 0 으로 떠 있었다. 조회 경로는 넷이나 되는데
# (네이버 → 야후 → pykrx → KIS) 그중 어느 것도 이 지수를 못 가져왔다.
# 코드가 하나뿐이면 그게 틀렸을 때 그냥 조용히 실패한다 — 그래서
# 후보를 여러 개 두고 되는 것을 만나면 거기서 멈춘다.
# (금리·VKOSPI 조회가 이미 쓰는 방식이다)
#
# 아래 셋(KOSPI·KOSDAQ·KOSPI200)은 프로덕션에서 실제로 되는 것이 확인됐다.
# 그 아래 후보들은 확인하지 못했다 — 이 작업 환경은 네이버가 막혀 있다.
#
# 그래도 넣는 이유는, 위의 백오프가 붙어서 넣어 보는 값이 거의 0 이
# 됐기 때문이다. 다섯 회차 안에 안 되면 스스로 물러나고, 그 뒤로는
# 60회차(약 30분)에 한 번만 다시 찔러본다. 관리자 화면에는 왜 안 되는지가
# 이름과 함께 남는다.
#
# 확인 못 한 것을 넣는 것 자체가 코스닥150 을 만든 원인이었다. 달라진
# 것은 '넣어도 안전한가' 다 — 예전에는 안 되는 지수 하나가 매 회차
# 네 원천을 두드리며 나머지를 붙잡고 있었다.
NAVER_INDEX_CODES = {
    # ── 되는 것이 확인됨 ──
    "KOSPI":     ["KOSPI"],
    "KOSDAQ":    ["KOSDAQ"],
    "KOSPI200":  ["KPI200", "KOSPI200"],
    # ── 후보 (안 되면 스스로 물러난다) ──
    "KRX300":    ["KRX300", "KRX_300", "KRX300I"],
    "KOSPI100":  ["KPI100", "KOSPI100", "KOSPI_100"],
}
# 예전 이름 — 밖에서 쓰는 곳이 생기면 첫 후보를 돌려준다
NAVER_INDEX_CODE = {k: v[0] for k, v in NAVER_INDEX_CODES.items()}

#: 네이버에서 왜 못 가져왔는지 — 갱신 쪽에서 관리자 화면에 남길 때 쓴다
_네이버_지수_실패이유: dict[str, str] = {}
INDEX_DISPLAY = {
    "KOSPI":"코스피","KOSDAQ":"코스닥","KOSPI200":"코스피 200",
    "KRX300":"KRX 300","KOSPI100":"코스피 100",
}


async def fetch_naver_index(name: str) -> dict | None:
    """네이버 모바일 API로 한국 지수 조회.

    코드 후보를 차례로 걸어 본다. 되는 것을 만나면 그 코드를 기억해
    다음부터는 그것만 쓴다 — 매번 네 번씩 두드릴 이유가 없다."""
    codes = NAVER_INDEX_CODES.get(name)
    if not codes:
        return None

    # 지난번에 통한 코드가 있으면 그것부터
    if 기억 := cache.get(f"naver_idx_code:{name}"):
        codes = [기억] + [c for c in codes if c != 기억]

    마지막이유 = "코드 후보를 다 걸어 봤지만 응답이 없다"
    try:
        async with httpx.AsyncClient(timeout=8, headers=NAVER_HEADERS) as cl:
            for code in codes:
                try:
                    r = await cl.get(f"https://m.stock.naver.com/api/index/{code}/basic")
                except Exception as e:
                    마지막이유 = f"연결 실패 ({type(e).__name__})"
                    continue
                if r.status_code != 200:
                    마지막이유 = f"HTTP {r.status_code} (코드 {code})"
                    continue
                try:
                    d = r.json()
                except Exception:
                    마지막이유 = f"JSON 이 아님 (코드 {code})"
                    continue
                curr = _safe(d.get("closePrice") or d.get("currentIndexValue") or d.get("indexValue"))
                if curr is None or curr <= 0:
                    마지막이유 = f"값이 비어 있음 (코드 {code})"
                    continue
                chg  = _safe(d.get("compareToPreviousClosePrice") or d.get("changeValue") or d.get("priceChange"))
                chgr = _safe(d.get("fluctuationsRatio") or d.get("changeRate") or d.get("rateOfChange"))
                # 통한 코드를 기억해 둔다 (하루)
                cache.set(f"naver_idx_code:{name}", code, 86400)
                return {
                    "index":       name,
                    "name":        INDEX_DISPLAY.get(name, name),
                    "value":       round(curr, 2),
                    "change":      round(chg or 0, 2),
                    "change_rate": round(chgr or 0, 2),
                }
    except Exception as e:
        마지막이유 = f"{type(e).__name__}"
    log.debug("네이버 지수 %s 실패: %s", name, 마지막이유)
    _네이버_지수_실패이유[name] = 마지막이유
    return None


# ── 안 되는 지수는 스스로 물러난다 ──────────────────────────
#
# 코스닥150 을 빼면서 배운 것. 안 되는 지수 하나가 목록에 남아 있으면
# 매 회차 네 원천(네이버·야후·pykrx·KIS)을 순서대로 두드리고, 그동안
# 나머지 지수도 함께 기다린다. 몇 달을 그렇게 돌았다.
#
# 그래서 지수 목록에 새 후보를 넣는 것 자체가 위험한 일이 됐다 —
# 맞는지 확인할 방법이 없으면 넣어 볼 수도 없다.
#
# 뉴스 피드에 쓴 방식을 그대로 가져온다. 연속으로 실패하면 쉬게 하고,
# 가끔만 다시 찔러본다. 그러면 후보를 넣어 보는 값이 거의 0 이 된다 —
# 되면 얻고, 안 되면 몇 분 만에 스스로 빠진다. 관리자 화면에는 왜
# 안 되는지가 남는다.
# 세는 일은 app/core/backoff.py 에 모았다 — 뉴스 피드·국내 금리도 같은
# 것을 각자 들고 있었다. 여기 이름들은 그대로 두고 속만 공용으로 바꾼다.
#
# 지수는 다섯 개뿐이라 '주기마다 전부 깨우기' 를 그대로 쓴다. 후보가
# 쉰 개가 넘는 금리 쪽과 달리, 다섯 개를 한꺼번에 깨워도 부담이 없다.
지수쉼표 = 쉼표(
    쉼_기준=int(os.getenv("INDEX_REST_AFTER", 5)),        #: 이만큼 연속 실패하면 쉰다
    되살림_주기=int(os.getenv("INDEX_PROBE_EVERY", 60)),   #: 몇 회차마다 다시 찔러보는지
)

#: 같은 딕셔너리를 가리킨다 (새로 만들면 두 벌이 따로 논다)
_지수_연속실패: dict[str, int] = 지수쉼표._연속실패
_지수_쉼_기준 = 지수쉼표.쉼_기준
_지수_되살림_주기 = 지수쉼표.되살림_주기


def 지수_쉬는가(이름: str) -> bool:
    return 지수쉼표.쉬는가(이름)


def 지수_실패기록(이름: str, 실패했나: bool) -> None:
    지수쉼표.기록(이름, 실패했나)


def 이번회차_지수(전체: list) -> list:
    """이번에 물어볼 지수. 쉬는 것은 가끔만 낀다.

    전부 쉬는 중이면 그래도 하나는 본다 — 아무것도 안 하면 되살아날
    길까지 막힌다. (골라내기가 그 규칙을 갖고 있다)"""
    return 지수쉼표.골라내기(전체)


async def fetch_naver_indices(names: "list[str] | None" = None) -> dict[str, dict]:
    """국내 지수 병렬 조회. 쉬는 지수는 빼고 묻는다."""
    전체 = names if names is not None else list(NAVER_INDEX_CODES)
    물어볼것 = 이번회차_지수(전체)
    results = await asyncio.gather(*[fetch_naver_index(n) for n in 물어볼것],
                                   return_exceptions=True)
    out = {}
    for name, r in zip(물어볼것, results):
        됐나 = isinstance(r, dict) and bool(r)
        지수_실패기록(name, not 됐나)
        if 됐나:
            out[name] = r
    return out


# ── pykrx(KRX 공식 데이터) — 네이버/야후 모두 실패한 지수용 최종 폴백 ──
PYKRX_INDEX_MARKET = {
    "KOSPI": "KOSPI", "KOSPI200": "KOSPI",
    "KOSDAQ": "KOSDAQ",
}
PYKRX_INDEX_NAME = {
    "KOSPI": "코스피", "KOSPI200": "코스피200",
    "KOSDAQ": "코스닥지수",
}
#: 이름 표기가 흔들리는 지수용. 지금은 비어 있다 — 코스닥150 을 빼면서
#: 유일한 항목이 없어졌다. 자리를 남겨 두는 이유는 KRX 가 표기를 바꾸는
#: 일이 실제로 있어서다(띄어쓰기 하나로 이름 대조가 어긋난다).
PYKRX_INDEX_NAME_ALIASES: dict[str, list[str]] = {}

#: KRX 가 쓰는 지수 코드. 이름으로 찾기 전에 이걸 먼저 걸어 본다.
#
# 이름 대조는 두 가지가 약하다.
#   · KRX 가 표기를 조금만 바꿔도(띄어쓰기 하나) 못 찾는다. 별칭을 세 개나
#     둔 것 자체가 그 증거다.
#   · 코스닥 지수가 백 개가 넘는데 하나하나 이름을 물어본다. 찾는 것이
#     목록 뒤쪽이면 그만큼 왕복한다.
#
# 코드는 안 바뀐다. 실제로 이 저장소는 이미 2203 을 알고 있었다 —
# scheduler 의 KIS 코드표에 적혀 있다. 그런데 pykrx 쪽은 이름으로만
# 찾고 있었다.
#
# 코드가 틀렸으면 빈 표가 오고, 그러면 예전처럼 이름으로 찾는다.
# 없던 실패가 생기지는 않는다.
PYKRX_INDEX_TICKER = {
    "KOSPI":     "1001",
    "KOSPI200":  "1028",
    "KOSDAQ":    "2001",
}


def fetch_pykrx_index(name: str) -> dict | None:
    """KRX 공식 데이터(pykrx)로 지수 조회 — 네이버 내부 코드/야후 심볼이 안 맞을 때 보강용.
    동기 함수이므로 호출 측에서 run_in_executor로 실행해야 함."""
    market = PYKRX_INDEX_MARKET.get(name)
    target_name = PYKRX_INDEX_NAME.get(name)
    if not market or not target_name:
        return None
    try:
        from app.core import pykrx_light
        pkrx = pykrx_light.stock()
        import datetime as dt

        today = dt.date.today()
        fromdate = (today - dt.timedelta(days=10)).strftime("%Y%m%d")
        todate = today.strftime("%Y%m%d")

        def 받기(t):
            try:
                d = pkrx.get_index_ohlcv_by_date(fromdate, todate, t)
                return d[d["종가"] > 0] if d is not None and len(d) else None
            except Exception:
                return None

        # 1) 아는 코드로 바로 — 이름 대조 없이 한 번에 끝난다
        df = 받기(PYKRX_INDEX_TICKER.get(name)) if PYKRX_INDEX_TICKER.get(name) else None

        # 2) 코드가 안 통하면 예전처럼 이름으로 찾는다
        if df is None or len(df) < 1:
            aliases = [target_name] + PYKRX_INDEX_NAME_ALIASES.get(name, [])
            ticker = None
            for t in pkrx.get_index_ticker_list(market=market):
                t_name = pkrx.get_index_ticker_name(t)
                if t_name in aliases:
                    ticker = t
                    break
            if not ticker:
                return None
            df = 받기(ticker)

        if df is None or len(df) < 1:
            return None

        curr = float(df["종가"].iloc[-1])
        if len(df) >= 2:
            prev = float(df["종가"].iloc[-2])
            change = curr - prev
            change_rate = (change / prev) * 100 if prev else 0.0
        else:
            change = change_rate = 0.0

        return {
            "index":       name,
            "name":        INDEX_DISPLAY.get(name, name),
            "value":       round(curr, 2),
            "change":      round(change, 2),
            "change_rate": round(change_rate, 2),
        }
    except Exception as e:
        log.debug(f"pykrx 지수 {name} 실패: {e}")
        return None


def fetch_pykrx_index_ohlcv(name: str, period: str = "1y") -> list:
    """KRX 공식 데이터(pykrx)로 지수 일봉 OHLCV 조회 — 야후 심볼이 안 맞을 때 보강용.
    동기 함수이므로 호출 측에서 run_in_executor로 실행해야 함."""
    market = PYKRX_INDEX_MARKET.get(name)
    target_name = PYKRX_INDEX_NAME.get(name)
    if not market or not target_name:
        return []
    try:
        from app.core import pykrx_light
        pkrx = pykrx_light.stock()
        import datetime as dt

        aliases = [target_name] + PYKRX_INDEX_NAME_ALIASES.get(name, [])
        ticker = None
        for t in pkrx.get_index_ticker_list(market=market):
            t_name = pkrx.get_index_ticker_name(t)
            if t_name in aliases:
                ticker = t
                break
        if not ticker:
            return []

        days_map = {
            "1d": 5, "5d": 9,
            "1mo": 31, "3mo": 92, "6mo": 183,
            "1y": 366, "2y": 731, "3y": 1100, "5y": 1830, "10y": 3660, "max": 3660,
        }
        days = days_map.get(period, 366)
        today = dt.date.today()
        fromdate = (today - dt.timedelta(days=days)).strftime("%Y%m%d")
        todate = today.strftime("%Y%m%d")
        df = pkrx.get_index_ohlcv_by_date(fromdate, todate, ticker)
        df = df[df["종가"] > 0]
        return [
            {
                "date":   idx.strftime("%Y-%m-%d"),
                "open":   round(float(row["시가"]), 2),
                "high":   round(float(row["고가"]), 2),
                "low":    round(float(row["저가"]), 2),
                "close":  round(float(row["종가"]), 2),
                "volume": int(row.get("거래량", 0)),
            }
            for idx, row in df.iterrows()
        ]
    except Exception as e:
        log.debug(f"pykrx 지수 OHLCV {name} 실패: {e}")
        return []


# ── 네이버 — 환율 (파라미터화) ────────────────────────────
async def _fetch_naver_fx(naver_symbol: str, display_name: str, symbol: str) -> dict | None:
    """네이버 환율 — naver_symbol: FX_USDKRW / FX_EURKRW 등"""
    url = f"https://m.stock.naver.com/api/forex/basic?symbol={naver_symbol}"
    try:
        async with httpx.AsyncClient(timeout=8, headers=NAVER_HEADERS) as cl:
            r = await cl.get(url)
            if r.status_code == 200:
                d = r.json()
                curr = _safe(d.get("closePrice") or d.get("currentPrice") or d.get("price"))
                chg  = _safe(d.get("compareToPreviousClosePrice") or d.get("changePrice") or d.get("change"))
                chgr = _safe(d.get("fluctuationsRatio") or d.get("changeRate") or d.get("rateOfChange"))
                if curr and curr > 100:
                    if chgr is not None and abs(chgr) < 1:
                        chgr = chgr * 100
                    if chgr is None and chg is not None and curr:
                        prev = curr - chg
                        chgr = (chg / prev * 100) if prev else 0
                    return {"symbol": symbol, "name": display_name, "value": round(curr, 2), "change": round(chg or 0, 2), "change_rate": round(chgr or 0, 2), "unit": "원"}
    except Exception:
        pass
    for url2 in [
        f"https://api.stock.naver.com/forex/close/history?stockEndType=index&code={naver_symbol}&timeframe=day&count=2&requestType=0",
        f"https://m.stock.naver.com/api/forex/history?symbol={naver_symbol}&timeframe=day&count=2",
    ]:
        try:
            async with httpx.AsyncClient(timeout=8, headers=NAVER_HEADERS) as cl:
                r = await cl.get(url2)
                if r.status_code == 200:
                    items = r.json()
                    if isinstance(items, list) and len(items) >= 2:
                        curr = _safe(items[-1].get("closePrice") or items[-1].get("value") or items[-1].get("price"))
                        prev = _safe(items[-2].get("closePrice") or items[-2].get("value") or items[-2].get("price"))
                        if curr and curr > 100:
                            chg = round(curr - (prev or curr), 2)
                            chgr = round(chg / (prev or 1) * 100, 2) if prev else 0
                            return {"symbol": symbol, "name": display_name, "value": round(curr, 2), "change": chg, "change_rate": chgr, "unit": "원"}
        except Exception:
            pass
    return None


async def fetch_naver_exchange() -> dict | None:
    """하위호환 래퍼 — USD/KRW 전용"""
    return await _fetch_naver_fx("FX_USDKRW", "원/달러 환율", "USDKRW")


# ── Yahoo Finance — 미국 주식 ──────────────────────────────
# v7/quote 가 검증하는 화이트리스트. 항목을 추가하면 요청 전체가 빈 응답으로
# 실패한다 — 프리/애프터마켓 등이 필요하면 fetch_yf_quote_extended(단건)를 쓸 것
_YF_QUOTE_FIELDS = (
    "regularMarketPrice,regularMarketChange,regularMarketChangePercent,"
    "regularMarketPreviousClose,regularMarketOpen,regularMarketDayHigh,"
    "regularMarketDayLow,regularMarketVolume,marketCap,shortName,longName,currency"
)


def _parse_yf_quotes(res_list: list) -> dict[str, dict]:
    """v7/quote 응답을 우리 형식으로. 어떤 경로로 받아왔든 파싱은 하나뿐이다."""
    out: dict[str, dict] = {}
    for q in res_list or []:
        sym = q.get("symbol", "")
        curr = _safe(q.get("regularMarketPrice"))
        if not sym or not curr:
            continue
        out[sym] = {
            "symbol":      sym,
            "name":        q.get("longName") or q.get("shortName") or sym,
            "price":       curr,
            "prev_close":  _safe(q.get("regularMarketPreviousClose")),
            "change":      round(_safe(q.get("regularMarketChange")) or 0, 4),
            "change_rate": round(_safe(q.get("regularMarketChangePercent")) or 0, 4),
            "volume":      int(q.get("regularMarketVolume") or 0),
            "market_cap":  int(q.get("marketCap") or 0),
            "currency":    q.get("currency", "USD"),
            "open":        _safe(q.get("regularMarketOpen")),
            "high":        _safe(q.get("regularMarketDayHigh")),
            "low":         _safe(q.get("regularMarketDayLow")),
        }
    return out


def _fetch_yf_quotes_authed_sync(symbols: list[str]) -> list | None:
    """yfinance 의 인증된 세션으로 v7/quote 배치를 부른다. 못 쓰면 None.

    야후는 언젠가부터 v7/quote 에 crumb(인증 토큰)를 요구한다. 우리가 httpx 로
    직접 부르면 crumb 이 없어 늘 빈 응답이 돌아왔고, 프로덕션에서 '야후 시세
    0% — 응답 없음'으로 몇 주를 보냈다. 그런데 종목별 단건 폴백은 잘 됐다 —
    그쪽은 yfinance 패키지를 쓰고, yfinance 가 crumb·쿠키·브라우저 흉내를
    전부 처리하기 때문이다. 같은 세션을 배치에도 쓰면 요청 한 번으로 끝난다.

    yfinance 내부 API에 기대는 코드라 버전이 바뀌면 깨질 수 있다. 그래서
    실패는 전부 None 으로 돌려보내고, 부르는 쪽이 기존 경로로 넘어간다."""
    try:
        from yfinance.data import YfData
    except Exception:
        return None
    try:
        j = YfData().get_raw_json(
            f"https://{_yf_base()}.finance.yahoo.com/v7/finance/quote",
            params={"symbols": ",".join(symbols), "fields": _YF_QUOTE_FIELDS},
            timeout=12,
        )
        return (j or {}).get("quoteResponse", {}).get("result", [])
    except Exception as e:
        log.debug(f"YF 인증 배치 실패: {type(e).__name__}: {e}")
        return None


async def _fetch_yf_quotes_raw(symbols: list[str]) -> list | None:
    """crumb 없이 그냥 호출 — 야후가 인증을 요구하기 전의 경로."""
    base = _yf_base()
    url = (f"https://{base}.finance.yahoo.com/v7/finance/quote"
           f"?symbols={','.join(symbols)}&fields={_YF_QUOTE_FIELDS}")
    try:
        async with httpx.AsyncClient(timeout=12, headers=YF_HEADERS) as cl:
            r = await cl.get(url)
        if r.status_code != 200:
            log.debug(f"YF {base} 인증 없는 배치 status={r.status_code}")
            return None
        return r.json().get("quoteResponse", {}).get("result", [])
    except Exception as e:
        log.debug(f"YF 인증 없는 배치 실패: {e}")
        return None


async def fetch_yf_quotes(symbols: list[str]) -> dict[str, dict]:
    """Yahoo Finance v7 멀티쿼트 — 인증 세션 우선, 안 되면 맨몸 호출."""
    if not symbols:
        return {}
    loop = asyncio.get_running_loop()
    try:
        # 인증 경로는 yfinance 내부 구조에 기댄다. 그쪽에서 예외가 새어 나와도
        # 시세 조회 전체가 죽으면 안 되므로 여기서 한 번 더 막는다
        res = await loop.run_in_executor(None, _fetch_yf_quotes_authed_sync, symbols)
    except Exception as e:
        log.debug(f"YF 인증 배치에서 예외: {type(e).__name__}: {e}")
        res = None
    if res:
        return _parse_yf_quotes(res)
    return _parse_yf_quotes(await _fetch_yf_quotes_raw(symbols) or [])


async def fetch_yf_quote_extended(symbol: str) -> dict | None:
    """단건 조회 + 프리마켓/애프터마켓 시세(marketState=PRE/POST). 종목 상세 페이지에서만 사용 —
    fields 화이트리스트 검증 실패 위험을 배치 조회(fetch_yf_quotes)와 분리해 격리."""
    base = _yf_base()
    fields = (
        "regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketPreviousClose,"
        "regularMarketOpen,regularMarketDayHigh,regularMarketDayLow,regularMarketVolume,marketCap,"
        "shortName,longName,currency,marketState,"
        "preMarketPrice,preMarketChange,preMarketChangePercent,"
        "postMarketPrice,postMarketChange,postMarketChangePercent"
    )
    url = f"https://{base}.finance.yahoo.com/v7/finance/quote?symbols={symbol}&fields={fields}"
    try:
        async with httpx.AsyncClient(timeout=10, headers=YF_HEADERS) as cl:
            r = await cl.get(url)
        if r.status_code != 200:
            return None
        res_list = r.json().get("quoteResponse", {}).get("result", [])
        if not res_list:
            return None
        q = res_list[0]
        market_state = q.get("marketState")
        pre_price  = _safe(q.get("preMarketPrice"))
        post_price = _safe(q.get("postMarketPrice"))
        return {
            "market_state":      market_state,
            "pre_market_price":        pre_price if market_state == "PRE" else None,
            "pre_market_change":       round(_safe(q.get("preMarketChange")) or 0, 4) if market_state == "PRE" and pre_price else None,
            "pre_market_change_rate":  round(_safe(q.get("preMarketChangePercent")) or 0, 4) if market_state == "PRE" and pre_price else None,
            "post_market_price":       post_price if market_state == "POST" else None,
            "post_market_change":      round(_safe(q.get("postMarketChange")) or 0, 4) if market_state == "POST" and post_price else None,
            "post_market_change_rate": round(_safe(q.get("postMarketChangePercent")) or 0, 4) if market_state == "POST" and post_price else None,
        }
    except Exception as e:
        log.debug(f"YF 확장 시세(프리/애프터마켓) {symbol} 실패: {e}")
        return None


async def fetch_yf_index_quotes(symbols: list[str]) -> dict[str, dict]:
    return await fetch_yf_quotes(symbols)


def _fetch_yf_quote_single_sync(symbol: str) -> dict | None:
    """YF v7 멀티쿼트가 인식하지 못하는(상장 직후/희귀 ETF 등) 종목 대비 폴백 —
    yfinance 패키지(fast_info → history 순)로 단건 조회"""
    import yfinance as yf
    try:
        fi = yf.Ticker(symbol).fast_info
        price = float(getattr(fi, "last_price", 0) or 0)
        prev  = float(getattr(fi, "previous_close", 0) or 0)
        if price > 0:
            chg  = round(price - prev, 4) if prev else 0
            chgr = round(chg / prev * 100, 4) if prev else 0
            return {"symbol": symbol, "name": symbol, "price": price, "prev_close": prev,
                    "change": chg, "change_rate": chgr, "volume": 0, "market_cap": 0, "currency": "USD"}
    except Exception:
        pass
    try:
        hist = yf.Ticker(symbol).history(period="2d", interval="1d")
        if not hist.empty:
            price = float(hist["Close"].iloc[-1])
            prev  = float(hist["Close"].iloc[-2]) if len(hist) >= 2 else price
            chg   = round(price - prev, 4)
            chgr  = round(chg / prev * 100, 4) if prev else 0
            return {"symbol": symbol, "name": symbol, "price": price, "prev_close": prev,
                    "change": chg, "change_rate": chgr, "volume": 0, "market_cap": 0, "currency": "USD"}
    except Exception:
        pass
    return None


# 배치가 실패했을 때 단건으로 다시 물어볼 최대 종목 수.
# 단건은 종목당 요청 하나라 비싸다 — 0.15 CPU 에서 수십 개를 매 주기마다
# 돌리면 그것만으로 CPU 를 다 쓴다. 배치가 정상이면 여기까지 오지 않는다.
MAX_SINGLE_FALLBACK = int(os.getenv("YF_MAX_SINGLE_FALLBACK", 20))


async def fetch_yf_quotes_with_fallback(
    symbols: list[str], max_fallback: int | None = None,
) -> tuple[dict[str, dict], int]:
    """배치 우선 → 빠진 종목만 yfinance 단건으로 보강.

    반환: (시세, 단건으로 메운 종목 수). 두 번째 값은 계측용이다 — 배치가
    죽었는데 폴백이 받쳐주고 있는 상태를 '정상'과 구분하기 위해 쓴다."""
    out = await fetch_yf_quotes(symbols)
    missing = [s for s in symbols if s not in out]
    if not missing:
        return out, 0

    cap = MAX_SINGLE_FALLBACK if max_fallback is None else max_fallback
    if len(missing) > cap:
        log.info(f"YF 단건 폴백 {len(missing)}종목 중 {cap}개만 시도 (비용 제한)")
        missing = missing[:cap]

    loop = asyncio.get_running_loop()
    results = await asyncio.gather(
        *(loop.run_in_executor(None, _fetch_yf_quote_single_sync, s) for s in missing),
        return_exceptions=True,
    )
    filled = 0
    for sym, r in zip(missing, results):
        if isinstance(r, dict):
            out[sym] = r
            filled += 1
    return out, filled


# ── 통합 단일 조회 ─────────────────────────────────────────
async def get_price(symbol: str, ttl: int = 30) -> dict | None:
    """캐시 우선 반환 — 실제 fetch는 스케줄러가 처리"""
    ck = f"price:{symbol}"
    return cache.get(ck) or cache.get_stale(ck)


async def get_index_price(yf_sym: str, name: str, display: str, ttl: int = 30) -> dict | None:
    ck = f"idx:{name}"
    return cache.get(ck) or cache.get_stale(ck)


# ── 환율 ───────────────────────────────────────────────────
#
# 여기가 한국 대시보드를 통째로 막고 있던 자리다. 서버를 띄워 조각별로
# 재보니 이랬다.
#
#     지수 209ms · 순위 5ms · 금리 3ms · 선물 3ms · 환율 12,018ms
#     → /dashboard/kr 전체 12,563ms
#
# 12.5초 중 12초가 환율 하나였다. 세 가지가 겹쳤다.
#
#   1) 타임아웃이 없었다. 같은 gather 에 묶인 나머지 넷은 전부
#      wait_for(timeout=5) 가 걸려 있는데 환율만 없어서, 얼마가 걸리든
#      끝까지 기다렸다.
#   2) 환율 하나를 얻으려고 미국 금리 전체 배치(VIX·10년물·30년물·
#      5년물·13주…)를 사용자 요청 경로에서 돌렸다.
#   3) 중복 실행을 안 막았다. 동시 5명으로 재보니 각자 28~30초가 나왔다 —
#      혼자면 12초인 일이다. 다섯이 같은 배치를 동시에 돌려 서로를
#      느리게 만든다. 0.15 CPU 에서는 이게 훨씬 심하다.
#
# 순위 쪽은 진작 제대로 하고 있었다(_bg_refresh_in_flight 로 겹침을 막고
# 지난 값을 즉시 돌려준다). 그 방식을 그대로 가져온다.

#: 못 받았을 때 이만큼은 다시 안 물어본다. 실패도 캐시해야 한다 —
#: 안 하면 들어오는 요청마다 같은 실패를 처음부터 다시 겪는다.
FX_MISS_TTL = int(os.getenv("FX_MISS_TTL", 60))

#: 요청 경로에서 기다려 주는 시간. 이걸 넘기면 지난 값으로 답하고,
#: 받아 오는 일은 배경에서 계속 돈다(다음 요청이 그 결과를 쓴다).
FX_WAIT_SEC = float(os.getenv("FX_WAIT_SEC", 3))

#: 지금 돌고 있는 배치. 여럿이 동시에 들어와도 하나만 돈다.
_fx_배치: "asyncio.Future | None" = None


async def _환율배치_한번만(대기: float) -> None:
    """미국 금리 배치를 돌린다 — 이미 돌고 있으면 그것을 같이 기다린다.

    shield 로 감싸는 이유: wait_for 가 시간을 넘기면 감싼 것을 취소하는데,
    여기서 취소되면 먼저 들어온 사람이 시작해 둔 배치가 죽는다. 그러면
    아무도 못 받고 다음 요청이 또 처음부터 시작한다."""
    global _fx_배치
    loop = asyncio.get_running_loop()
    if _fx_배치 is None or _fx_배치.done():
        from app.services.market_extras import _do_fetch_us_rates
        _fx_배치 = loop.run_in_executor(None, _do_fetch_us_rates)
    await asyncio.wait_for(asyncio.shield(_fx_배치), 대기)


async def _get_fx_cached(cache_key: str, symbol: str, display_name: str) -> dict:
    """환율 조회. 요청 경로를 절대 오래 잡지 않는다."""
    빈값 = {"symbol": symbol, "name": display_name, "value": 0,
            "change": 0, "change_rate": 0, "unit": "원"}

    def 지금값():
        return cache.get(cache_key) or cache.get_stale(cache_key)

    쓸만한가 = lambda v: bool(v) and (v.get("value") or 0) > 0

    if 쓸만한가(값 := 지금값()):
        return 값

    # 방금 훑었는데 빈손이었다면 다시 묻지 않는다. 이 표시가 없으면
    # 요청이 올 때마다 12초짜리 배치를 새로 돌린다.
    if cache.get(f"{cache_key}:miss"):
        return 값 or 빈값

    try:
        await _환율배치_한번만(FX_WAIT_SEC)
    except asyncio.TimeoutError:
        # 배치는 배경에서 계속 돈다. 여기서 더 기다리면 화면 전체가 멈춘다.
        #
        # 시간을 넘긴 것도 실패로 담아 둔다. 안 담으면 늦는 동안 들어오는
        # 요청이 전부 이 상한만큼 잡힌다 — 실제로 그렇게 나왔다(모든
        # 요청이 정확히 3.0초). 뒤늦게 배치가 성공하면 위의 캐시 검사가
        # 먼저 걸리므로, 이 표시가 값을 가리지는 않는다.
        if not 쓸만한가(값 := 지금값()):
            cache.set(f"{cache_key}:miss", True, FX_MISS_TTL)
        return 값 or 빈값
    except Exception:
        pass

    if 쓸만한가(값 := 지금값()):
        return 값
    cache.set(f"{cache_key}:miss", True, FX_MISS_TTL)
    return 값 or 빈값


async def get_usdkrw() -> dict:
    return await _get_fx_cached("extra:usdkrw", "USDKRW", "원/달러 환율")


async def get_eurkrw() -> dict:
    return await _get_fx_cached("extra:eurkrw", "EURKRW", "원/유로 환율")


async def get_jpykrw() -> dict:
    return await _get_fx_cached("extra:jpykrw", "JPYKRW", "원/100엔")
