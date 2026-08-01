"""
주식 순위 서비스
- 한국: FDR 전체 KRX 종목(~2500개) + Naver 실시간 순위
- 미국: Yahoo Finance 캐시 기반
"""
import asyncio
import logging
import httpx
import re
from app.core.cache import cache
from app.services.ticker_service import get_kr_db, get_fdr_price
from app.services.yf_service import SP500_SYMBOLS

log = logging.getLogger(__name__)

# 순위 캐시 수명.
#
# 예전에는 60초였다. 그런데 이 캐시를 채우는 Naver 갱신은 장중 60초,
# 휴장 중 10분 주기다. 즉 휴장 중에는 9분 동안 캐시가 비어 있었고, 그
# 사이 들어온 요청은 전부 '전일 종가(FDR)'로 순위를 새로 만들었다.
# 한국장은 하루 6시간 반만 열리므로, 대부분의 시간 동안 화면에 뜨는
# 순위가 어제 것이었다는 뜻이다. 게다가 그 계산은 2,872 종목을 훑는
# 일이라 요청이 몇 개만 겹쳐도 눈에 띄게 느려졌다.
#
# 캐시는 갱신 주기보다 넉넉히 길어야 한다. 스케줄러가 갱신할 때마다
# 덮어쓰므로, 길다고 값이 묵지 않는다 — 갱신과 갱신 사이에 구멍이
# 생기지 않게 하는 것이 목적이다.
RANK_TTL = 900          # 15분 (휴장 중 갱신 주기 10분보다 길게)

# 전체 종목을 훑어 만든 표를 잠깐 재사용한다. 카테고리가 7개라 이걸
# 안 하면 같은 계산을 7번 한다.
ROWS_TTL = 60

NAVER_PC_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "ko-KR,ko;q=0.9",
    "Referer": "https://finance.naver.com/",
}

# Naver Finance 시세 페이지 URL 매핑
# (url, kospi_code, kosdaq_code)
NAVER_SISE_PAGES = {
    "시가총액": "https://finance.naver.com/sise/sise_market_sum.nhn",
    "상승률":   "https://finance.naver.com/sise/sise_rise.nhn",
    "하락률":   "https://finance.naver.com/sise/sise_fall.nhn",
    "거래량":   "https://finance.naver.com/sise/sise_quant.nhn",
}

# 거래대금 / 신고가 / 신저가는 상승률/하락률/거래량 데이터에서 계산
DERIVED_CATEGORIES = {"거래대금", "신고가", "신저가"}

# 허용된 순위 카테고리 — 이 목록에 없는 값은 라우트에서 거절한다.
#
# 예전에는 검증이 없었다. category 가 그대로 캐시 키(rank:kr:{category})가 되고,
# 모르는 값이면 '시가총액'으로 취급해 2,873개 종목을 전부 정렬한 뒤 그 임의
# 키로 저장했다. 인증 없이 40번만 불러도 캐시가 4.3MB → 10.2MB 로 불었고,
# 500번이면 시세·차트·뉴스 캐시가 전부 밀려난다.
ALLOWED_CATEGORIES = tuple(NAVER_SISE_PAGES.keys()) + tuple(sorted(DERIVED_CATEGORIES))
CATEGORY_PATTERN = "^(" + "|".join(ALLOWED_CATEGORIES) + ")$"


def _parse_num(s: str) -> float:
    if not s:
        return 0.0
    s = str(s).replace(",", "").replace("%", "").strip()
    try:
        return float(s)
    except Exception:
        return 0.0


async def _fetch_naver_sise_page(url: str, market_code: int = 0, has_market_cap: bool = False) -> list[dict]:
    """Naver Finance 시세 HTML 파싱 — name TD 기준 상대 인덱스 사용
    체크박스 TD 등 앞쪽 TD 개수와 무관하게 정확한 컬럼 추출.

    시가총액 페이지 (name 이후): 현재가|전일비|등락률|시총(억)|상장주식수|외인비율|거래량|PER|ROE
    상승률/하락률/거래량 페이지 (name 이후): 현재가|전일비|등락률|거래량|거래대금(억)|시총(억)|PER
    """
    try:
        from bs4 import BeautifulSoup
        suffix   = ".KS" if market_code == 0 else ".KQ"
        mkt_name = "KOSPI" if market_code == 0 else "KOSDAQ"
        async with httpx.AsyncClient(timeout=8, headers=NAVER_PC_HEADERS) as cl:
            r = await cl.get(url, params={"sosok": market_code})
        if r.status_code != 200:
            return []
        soup = BeautifulSoup(r.text, "lxml")
        rows = []
        for a_tag in soup.select('a[href*="/item/main.naver?code="]'):
            code_match = re.search(r"code=(\d{6})", a_tag.get("href", ""))
            if not code_match:
                continue
            code = code_match.group(1)
            name = a_tag.get_text(strip=True)
            tr = a_tag.find_parent("tr")
            if not tr:
                continue
            tds = tr.find_all("td")

            # name TD 위치 찾기 (a 태그에 해당 code가 있는 td)
            name_idx = None
            for i, td in enumerate(tds):
                if td.find("a", href=lambda h: h and f"code={code}" in h):
                    name_idx = i
                    break
            if name_idx is None:
                continue

            # name TD 이후 데이터 TD만 숫자로 파싱
            nums: list = []
            for td in tds[name_idx + 1:]:
                txt = td.get_text(strip=True).replace(",", "").replace("+", "").replace("%", "").strip()
                try:
                    nums.append(float(txt))
                except Exception:
                    nums.append(None)

            if len(nums) < 4:
                continue

            # name 다음: [0]=현재가 [1]=전일비 [2]=등락률
            price       = nums[0] if nums[0] and nums[0] > 0 else 0
            change_raw  = nums[1] if nums[1] is not None else 0
            change_rate = nums[2] if nums[2] is not None and abs(nums[2]) <= 100 else 0

            if has_market_cap:
                # [3]=시총(억) [4]=상장주식수 [5]=외인비율 [6]=거래량 [7]=PER [8]=ROE
                market_cap = int((nums[3] or 0) * 1e8) if len(nums) > 3 and nums[3] and nums[3] > 0 else 0
                volume     = int(nums[6]) if len(nums) > 6 and nums[6] and nums[6] > 0 else 0
            else:
                # [3]=거래량 [4]=거래대금(억) [5]=시총(억) [6]=PER
                volume     = int(nums[3]) if len(nums) > 3 and nums[3] and nums[3] > 0 else 0
                market_cap = int((nums[5] or 0) * 1e8) if len(nums) > 5 and nums[5] and nums[5] > 0 else 0

            change = round(price * change_rate / 100, 2) if price and change_rate else round(change_raw, 2)
            rows.append({
                "symbol":      f"{code}{suffix}",
                "name":        name,
                "market":      mkt_name,
                "price":       price,
                "change":      change,
                "change_rate": change_rate,
                "volume":      volume,
                "amount":      price * volume if price and volume else 0,
                "market_cap":  market_cap,
            })
            if len(rows) >= 100:
                break
        return rows
    except Exception as e:
        log.debug(f"Naver sise 파싱 실패 ({url}): {e}")
        return []


async def fetch_naver_rank(category: str) -> list[dict]:
    """Naver Finance 순위 HTML 파싱 (KOSPI + KOSDAQ 합산 후 재정렬)"""
    url = NAVER_SISE_PAGES.get(category)
    if not url:
        return []
    has_mc = (category == "시가총액")
    results = await asyncio.gather(
        _fetch_naver_sise_page(url, market_code=0, has_market_cap=has_mc),
        _fetch_naver_sise_page(url, market_code=1, has_market_cap=has_mc),
        return_exceptions=True,
    )
    all_rows = []
    for r in results:
        if isinstance(r, list):
            all_rows.extend(r)

    # KOSPI+KOSDAQ 합산 후 카테고리별 재정렬 (101위가 100위보다 더 상승/하락인 문제 방지)
    if all_rows:
        if category == "상승률":
            all_rows.sort(key=lambda x: x.get("change_rate") or -9999, reverse=True)
        elif category == "하락률":
            all_rows.sort(key=lambda x: x.get("change_rate") or 9999)
        elif category == "거래량":
            all_rows.sort(key=lambda x: x.get("volume") or 0, reverse=True)
        elif category == "시가총액":
            all_rows.sort(key=lambda x: x.get("market_cap") or 0, reverse=True)
        log.info(f"Naver 순위: {category} {len(all_rows)}개")
    return all_rows


# ── FDR 전체 종목 기반 순위 ────────────────────────────────
def _build_all_kr_rows() -> list[dict]:
    """FDR 캐시에서 전체 KRX 종목 데이터 구성.

    2,872 종목을 훑는다. 카테고리마다 새로 만들면 같은 일을 7번 하므로
    결과를 짧게 캐시해 둔다."""
    if cached := cache.get("rank:kr:_rows"):
        return cached
    kr_db = get_kr_db()
    rows = []
    for item in kr_db:
        sym = item["s"]
        fdr = get_fdr_price(sym)
        live = cache.get(f"price:{sym}") or cache.get_stale(f"price:{sym}")
        # 실시간 캐시 우선, 없으면 FDR 일봉 데이터
        p = (live if live and live.get("price") and not live.get("_demo") else None) or fdr
        if not p or not p.get("price"):
            continue
        price  = p.get("price") or 0
        volume = p.get("volume") or 0
        rows.append({
            "symbol":      sym,
            "name":        item["n"],
            "market":      item["x"],
            "price":       price,
            "change":      p.get("change") or 0,
            "change_rate": p.get("change_rate") or 0,
            "volume":      volume,
            "amount":      (price * volume) if price and volume else 0,
            "market_cap":  p.get("market_cap") or 0,
            "high":        p.get("high") or 0,
            "low":         p.get("low") or 0,
        })
    if rows:
        cache.set("rank:kr:_rows", rows, ROWS_TTL)
    return rows


def _sort_kr(rows: list[dict], category: str) -> list[dict]:
    # 가격을 모르는 종목은 순위표에 넣지 않는다. 예전에는 뒤에 붙여
    # 100위 안을 채웠는데, '거래량 순위'인데 거래량을 모르는 종목이
    # 43위에 앉아 있으면 그 표는 순위표가 아니다.
    sortable = [r for r in rows if r.get("price")]

    if category == "상승률":
        sortable.sort(key=lambda x: x.get("change_rate") or -9999, reverse=True)
    elif category == "하락률":
        sortable.sort(key=lambda x: x.get("change_rate") or 9999)
    elif category == "거래대금":
        sortable.sort(key=lambda x: x.get("amount") or 0, reverse=True)
    elif category == "거래량":
        sortable.sort(key=lambda x: x.get("volume") or 0, reverse=True)
    elif category == "신고가":
        # 당일 등락률 상위 (신고가 근접)
        sortable = [r for r in sortable if (r.get("change_rate") or 0) > 0]
        sortable.sort(key=lambda x: x.get("change_rate") or 0, reverse=True)
    elif category == "신저가":
        # 당일 등락률 하위 (신저가 근접)
        sortable = [r for r in sortable if (r.get("change_rate") or 0) < 0]
        sortable.sort(key=lambda x: x.get("change_rate") or 0)
    else:  # 시가총액
        sortable.sort(key=lambda x: x.get("market_cap") or 0, reverse=True)

    for i, r in enumerate(sortable):
        r["rank"] = i + 1
    return sortable[:100]


def _build_us_rows() -> list[dict]:
    from app.services.scheduler import POPULAR_US
    all_syms = list(dict.fromkeys(POPULAR_US + SP500_SYMBOLS))  # 인기종목 우선
    rows = []
    for sym in all_syms:
        p = cache.get(f"price:{sym}") or cache.get_stale(f"price:{sym}")
        if not p:
            continue
        price  = p.get("price") or 0
        volume = p.get("volume") or 0
        rows.append({
            "symbol":      sym,
            "name":        p.get("name", sym),
            "price":       price,
            "change":      p.get("change") or 0,
            "change_rate": p.get("change_rate") or 0,
            "volume":      volume,
            "amount":      price * volume if price and volume else 0,
            "market_cap":  p.get("market_cap") or 0,
            "_demo":       p.get("_demo", False),
        })
    return rows


def _sort_us(rows: list[dict], category: str) -> list[dict]:
    sortable = [r for r in rows if r.get("price")]
    if category == "상승률":
        sortable.sort(key=lambda x: x.get("change_rate") or -9999, reverse=True)
    elif category == "하락률":
        sortable.sort(key=lambda x: x.get("change_rate") or 9999)
    elif category == "거래대금":
        sortable.sort(key=lambda x: x.get("amount") or 0, reverse=True)
    elif category == "거래량":
        sortable.sort(key=lambda x: x.get("volume") or 0, reverse=True)
    elif category in ("신고가", "신저가"):
        rev = (category == "신고가")
        sortable.sort(key=lambda x: x.get("change_rate") or 0, reverse=rev)
    else:
        sortable.sort(key=lambda x: x.get("market_cap") or 0, reverse=True)
    for i, r in enumerate(sortable):
        r["rank"] = i + 1
    return sortable[:100]


# ── 공개 인터페이스 ────────────────────────────────────────
def get_kr_rankings(category: str = "시가총액") -> list[dict]:
    ck = f"rank:kr:{category}"
    cached = cache.get(ck)
    if cached:
        return cached

    # 캐시가 막 만료됐을 뿐이라면, 몇 분 전 실시간 순위가 어제 종가로 새로
    # 만든 순위보다 훨씬 정확하다. 스케줄러가 곧 갱신해 준다.
    if stale := cache.get_stale(ck):
        return stale

    # 거래대금/신고가/신저가는 거래량/상승률 캐시를 활용해 계산
    if category == "거래대금":
        vol_rows = cache.get_stale("rank:kr:거래량") or []
        if vol_rows:
            for r in vol_rows:
                r["amount"] = (r.get("price") or 0) * (r.get("volume") or 0)
            sorted_rows = sorted(vol_rows, key=lambda x: x.get("amount") or 0, reverse=True)
            for i, r in enumerate(sorted_rows):
                r["rank"] = i + 1
            cache.set(ck, sorted_rows, RANK_TTL)
            return sorted_rows
    elif category == "신고가":
        rise_rows = cache.get_stale("rank:kr:상승률") or []
        result = [r for r in rise_rows if (r.get("change_rate") or 0) > 0][:100]
        for i, r in enumerate(result):
            r["rank"] = i + 1
        if result:
            cache.set(ck, result, RANK_TTL)
        return result
    elif category == "신저가":
        fall_rows = cache.get_stale("rank:kr:하락률") or []
        result = [r for r in fall_rows if (r.get("change_rate") or 0) < 0][:100]
        for i, r in enumerate(result):
            r["rank"] = i + 1
        if result:
            cache.set(ck, result, RANK_TTL)
        return result

    rows = _build_all_kr_rows()

    # 시가총액 순위: 모바일 API 캐시 market_cap 우선 사용
    if category == "시가총액":
        for r in rows:
            p = cache.get(f"price:{r['symbol']}") or cache.get_stale(f"price:{r['symbol']}")
            if p and p.get("market_cap") and p["market_cap"] > r.get("market_cap", 0):
                r["market_cap"] = p["market_cap"]

    result = _sort_kr(rows, category)

    if result:
        cache.set(ck, result, RANK_TTL)
    return result


async def refresh_kr_rankings_from_naver():
    """Naver Finance 순위 HTML 파싱으로 캐시 갱신
    시가총액 순위: HTML 파싱 후 모바일 API 캐시로 market_cap 교정 → 재정렬
    """
    for cat in NAVER_SISE_PAGES.keys():
        rows = await fetch_naver_rank(cat)
        if not rows:
            continue

        # 시가총액 순위는 모바일 API 캐시 값으로 교정 후 재정렬
        # (HTML 파싱 오류로 인한 순위 역전 방지)
        if cat == "시가총액":
            for r in rows:
                sym = r["symbol"]
                p = cache.get(f"price:{sym}") or cache.get_stale(f"price:{sym}")
                if p and p.get("market_cap") and p["market_cap"] > r.get("market_cap", 0):
                    r["market_cap"] = p["market_cap"]
            rows.sort(key=lambda x: x.get("market_cap") or 0, reverse=True)

        for i, r in enumerate(rows):
            r["rank"] = i + 1
        cache.set(f"rank:kr:{cat}", rows, RANK_TTL)
    log.info("Naver 순위 갱신 완료")


def get_us_rankings(category: str = "시가총액") -> list[dict]:
    ck = f"rank:us:{category}"
    cached = cache.get(ck)
    if cached:
        return cached
    if stale := cache.get_stale(ck):
        return stale

    rows   = _build_us_rows()
    result = _sort_us(rows, category)

    if result:
        cache.set(ck, result, RANK_TTL)
    return result
