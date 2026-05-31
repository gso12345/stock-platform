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
RANK_TTL = 60

NAVER_PC_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "ko-KR,ko;q=0.9",
    "Referer": "https://finance.naver.com/",
}

# Naver Finance 시세 페이지 URL 매핑
NAVER_SISE_URLS = {
    "시가총액": ("https://finance.naver.com/sise/sise_market_sum.nhn?sosok=0",
                 "https://finance.naver.com/sise/sise_market_sum.nhn?sosok=1"),
    "상승률":   ("https://finance.naver.com/sise/sise_rise.nhn",),
    "하락률":   ("https://finance.naver.com/sise/sise_fall.nhn",),
    "거래대금": ("https://finance.naver.com/sise/sise_trading.nhn",),
    "거래량":   ("https://finance.naver.com/sise/sise_quant.nhn",),
    "신고가":   ("https://finance.naver.com/sise/sise_new_high.nhn",),
    "신저가":   ("https://finance.naver.com/sise/sise_new_low.nhn",),
}


def _parse_num(s: str) -> float:
    if not s:
        return 0.0
    s = str(s).replace(",", "").replace("%", "").strip()
    try:
        return float(s)
    except Exception:
        return 0.0


async def _fetch_naver_sise_page(url: str) -> list[dict]:
    """Naver Finance 시세 HTML 페이지 파싱"""
    try:
        from bs4 import BeautifulSoup
        async with httpx.AsyncClient(timeout=12, headers=NAVER_PC_HEADERS) as cl:
            r = await cl.get(url)
        if r.status_code != 200:
            return []
        soup = BeautifulSoup(r.text, "lxml")
        tbody = soup.select_one("table.type_2 tbody") or soup.select_one("table.type2 tbody")
        if not tbody:
            return []
        rows = []
        for tr in tbody.find_all("tr"):
            tds = tr.find_all("td")
            if len(tds) < 4:
                continue
            # 종목명과 링크
            name_td = tr.select_one("td.name a") or tr.select_one("td a[href*='code']")
            if not name_td:
                continue
            href = name_td.get("href", "")
            code_match = re.search(r"code=(\d{6})", href)
            if not code_match:
                continue
            code = code_match.group(1)
            name = name_td.get_text(strip=True)
            # 시장 구분 (없으면 KOSPI 기본)
            market_td = tr.select_one("td.market")
            mkt_text = (market_td.get_text(strip=True) if market_td else "").upper()
            suffix = ".KQ" if "KOSDAQ" in mkt_text else ".KS"
            sym = f"{code}{suffix}"
            # 숫자 필드 추출 (td 순서는 페이지마다 다름)
            nums = [_parse_num(td.get_text(strip=True)) for td in tds]
            price = nums[1] if len(nums) > 1 else 0
            change_rate = 0.0
            for td in tds:
                txt = td.get_text(strip=True).replace("+","")
                if "%" in txt:
                    change_rate = _parse_num(txt)
                    break
            rows.append({
                "symbol":      sym,
                "name":        name,
                "market":      "KOSPI" if suffix == ".KS" else "KOSDAQ",
                "price":       price,
                "change":      0,
                "change_rate": change_rate,
                "volume":      nums[-1] if len(nums) > 3 else 0,
                "amount":      0,
                "market_cap":  nums[2] if len(nums) > 2 else 0,
            })
        return rows
    except Exception as e:
        log.debug(f"Naver sise 파싱 실패 ({url}): {e}")
        return []


async def fetch_naver_rank(category: str) -> list[dict]:
    """Naver Finance 순위 HTML 파싱"""
    urls = NAVER_SISE_URLS.get(category, ())
    all_rows = []
    tasks = [_fetch_naver_sise_page(u) for u in urls]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    for r in results:
        if isinstance(r, list):
            all_rows.extend(r)
    if all_rows:
        log.info(f"Naver sise 순위: {category} {len(all_rows)}개")
    return all_rows


# ── FDR 전체 종목 기반 순위 ────────────────────────────────
def _build_all_kr_rows() -> list[dict]:
    """FDR 캐시에서 전체 KRX 종목 데이터 구성"""
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
    return rows


def _sort_kr(rows: list[dict], category: str) -> list[dict]:
    sortable   = [r for r in rows if r.get("price")]
    unsortable = [r for r in rows if not r.get("price")]

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

    merged = sortable + unsortable
    for i, r in enumerate(merged):
        r["rank"] = i + 1
    return merged[:100]


def _build_us_rows() -> list[dict]:
    rows = []
    for sym in SP500_SYMBOLS:
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
    return sortable[:50]


# ── 공개 인터페이스 ────────────────────────────────────────
def get_kr_rankings(category: str = "시가총액") -> list[dict]:
    ck = f"rank:kr:{category}"
    cached = cache.get(ck)
    if cached:
        return cached

    rows = _build_all_kr_rows()
    result = _sort_kr(rows, category)

    if result:
        cache.set(ck, result, RANK_TTL)
    return result


async def refresh_kr_rankings_from_naver():
    """Naver Finance 순위 HTML 파싱으로 캐시 갱신"""
    for cat in NAVER_SISE_URLS.keys():
        rows = await fetch_naver_rank(cat)
        if rows:
            for i, r in enumerate(rows):
                r["rank"] = i + 1
            cache.set(f"rank:kr:{cat}", rows, RANK_TTL)
    log.info("Naver 순위 갱신 완료")


def get_us_rankings(category: str = "시가총액") -> list[dict]:
    ck = f"rank:us:{category}"
    cached = cache.get(ck)
    if cached:
        return cached

    rows   = _build_us_rows()
    result = _sort_us(rows, category)

    if result:
        cache.set(ck, result, RANK_TTL)
    return result
