"""
주식 순위 서비스
- 한국: FDR 전체 KRX 종목(~2500개) + Naver 실시간 순위
- 미국: Yahoo Finance 캐시 기반
"""
import asyncio
import logging
import os
import httpx
import re
from app.core.cache import cache
from app.core import memory
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


def _트리끊기(soup) -> None:
    """다 쓴 HTML 트리를 즉시 놓아준다.

    트리는 부모와 자식이 서로를 가리키는 구조라, 변수를 놓아도 참조가
    얽혀 있어 참조 세기만으로는 정리되지 않는다. 순환참조 수집기가 와야
    치워지는데 객체가 많을수록 그게 뜸하게 오고, 그 사이 계속 쌓인다.
    순위 갱신은 장중 60초마다 8페이지를 파싱하므로 그동안 계속 불어난다
    — 프로덕션 메모리에서 파싱 결과 문자열이 47,409개 남아 있었다.

    루트에 대고 soup.decompose() 를 부르면 안 된다. bs4 4.15 기준 루트의
    next_element 가 None 이라 순회가 첫걸음에서 끝나고, 정작 자식 트리는
    통째로 남는다(재 봤다: 태그 140,400개 그대로, +118MB). 실제로 듣는 건
    자식마다 끊는 쪽이다.

        100줄짜리 페이지를 수집기 끈 채 100번 파싱
          아무것도 안 함    +126.5MB   태그 140,400개 잔존
          soup.decompose()  +118.4MB   태그 140,400개 잔존
          자식마다 끊기       -1.1MB   태그     100개 잔존
    """
    if soup is None:          # 응답이 200 이 아니면 파싱을 안 했다 — 정상 경로다
        return
    try:
        from bs4.element import Tag
        for 자식 in list(soup.contents or ()):
            if isinstance(자식, Tag):
                자식.decompose()
        soup.contents = []
    except Exception as e:
        # 정리하다 터져서 순위표가 통째로 사라지면 본말전도라 삼킨다.
        # 다만 조용히 삼키면 '끊고 있다고 믿는데 사실은 매번 실패' 를
        # 알아챌 방법이 없으므로 흔적은 남긴다.
        log.debug(f"HTML 트리 정리 실패: {e}")


async def _fetch_naver_sise_page(url: str, market_code: int = 0, has_market_cap: bool = False) -> list[dict]:
    """Naver Finance 시세 HTML 파싱 — name TD 기준 상대 인덱스 사용
    체크박스 TD 등 앞쪽 TD 개수와 무관하게 정확한 컬럼 추출.

    시가총액 페이지 (name 이후): 현재가|전일비|등락률|시총(억)|상장주식수|외인비율|거래량|PER|ROE
    상승률/하락률/거래량 페이지 (name 이후): 현재가|전일비|등락률|거래량|거래대금(억)|시총(억)|PER
    """
    soup = None
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
        # 아래에서 뽑는 값은 전부 평범한 str/float 다. 트리에 매달린
        # 문자열(NavigableString)을 그대로 담으면 그 하나가 트리 전체를
        # 붙잡으므로, 끝의 _트리끊기 가 무의미해진다.
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
    finally:
        # 성공하든 실패하든 트리는 끊는다. rows 에 담은 것은 이미 평범한
        # 문자열·숫자라 트리를 끊어도 멀쩡하다.
        _트리끊기(soup)


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


def 상장주식수(symbol: str) -> int:
    """종목의 상장주식수. 모르면 0.

    KRX(또는 그 CSV 사본)가 종목 목록과 함께 주는 값이라 정확하고, 분할·
    증자 때만 바뀌므로 하루 한 번 받아도 충분하다."""
    p = get_fdr_price(symbol) or {}
    return int(p.get("shares") or 0)


def _시가총액(symbol: str, price: float, p: dict) -> int:
    """시가총액 = 현재가 × 상장주식수.

    남이 만든 숫자를 받아 쓰는 대신 직접 계산한다. 이유가 둘 있다.

    1) 정확하다. 예전에는 Naver 시세 HTML 의 표에서 '몇 번째 칸'인지로
       시총을 읽었다. 네이버가 컬럼을 하나 끼워 넣으면 옆 칸(액면가 같은
       것)을 시총으로 읽게 되는데, 숫자가 나오긴 하므로 아무도 눈치채지
       못한다. 실제로 시가총액 순위에서 삼성전자가 사라지는 일이 있었다.
       거래대금 순위는 다른 페이지라 멀쩡했던 것이 단서였다.

    2) 최신이다. 주식수는 거의 안 변하고 가격만 변하므로, 실시간 가격을
       곱하면 시총도 실시간이 된다. 받아온 시총 값은 전일 종가 기준이다.

    주식수를 모르는 종목만 받아온 값을 쓴다 (신규 상장 직후 등)."""
    n = int(p.get("shares") or 0) or 상장주식수(symbol)
    if n > 0 and price > 0:
        return int(price * n)

    # 여기까지 오면 계산을 못 한 것이다. 넘겨받은 p 에만 시총이 있는지
    # 보면 안 된다 — p 가 실시간 시세면 거기엔 시총 칸이 아예 없다.
    #
    # 그래서 실제로 이런 일이 났다. 사람이 많이 보는 종목일수록 실시간
    # 시세가 채워져 있는데, 그 종목들만 시총이 0 이 되어 순위에서 통째로
    # 빠졌다. 시가총액 1위인 삼성전자가 가장 먼저 사라졌다.
    #
    # 목록과 함께 받아 둔 값이 있으면 그걸 쓴다. 전일 종가 기준이라
    # 정확하진 않지만, 0 으로 만들어 순위에서 지워 버리는 것보다는 낫다.
    if 받아둔것 := int(p.get("market_cap") or 0):
        return 받아둔것
    from app.services.ticker_service import get_fdr_price
    return int((get_fdr_price(symbol) or {}).get("market_cap") or 0)


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
            "market_cap":  _시가총액(sym, price, p),
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


# 미국 순위표 자체를 담아 둔다.
#
# 화면에 다섯 종목만 나오던 원인이 여기 있었다. _build_us_rows 는 캐시에
# 이미 있는 종목만 주워 담을 뿐 아무것도 새로 받지 않는다. 그런데
#   · price:{sym} 수명이 120초이고
#   · 이를 채우는 refresh_us_stocks 는 미국장이 열렸을 때만 도는데
#     (한국 낮에는 미국장이 닫혀 있다)
#   · 지난 값 보관함은 전체 400칸뿐이라 미국 종목 335개가 금방 밀려난다
# 그래서 한국 낮에 들어오면 주울 것이 거의 없었다.
#
# 종목별 시세 대신 '완성된 순위표'를 따로 담는다. 한 번 만들어 두면
# 장이 닫혀 있는 동안에도 화면이 비지 않는다.
US_ROWS_CK = "rank:us:rows"
US_ROWS_TTL = 900        # 15분

#: 이보다 적으면 '제대로 못 만든 표' 로 보고 다시 채운다
US_MIN_ROWS = 50

#: 전종목 갱신이 겹치지 않게 하는 표시
_us_rows_refreshing = False


def us_universe() -> list[str]:
    """순위를 매길 대상 — 미국에 상장된 모든 종목.

    예전에는 코드에 적어 둔 335개(인기 20 + S&P500 발췌 315)가 전부였다.
    그러면 'S&P500 안에서의 순위' 이지 미국 시장 순위가 아니다. 러셀
    소형주도, 나스닥 중소형도, ETF 도 아예 후보에 없었다.

    목록은 이미 갖고 있다. us_tickers 가 NASDAQ Trader 의 심볼 디렉터리를
    받아 두는데(나스닥 + NYSE·AMEX·ARCA·BATS·IEX), 우선주·워런트·유닛 같은
    조회 안 되는 것은 그쪽에서 이미 걸러진다. 약 8~9천 종목이다.

    차례가 중요하다. 인기종목과 S&P500 을 앞에 둔다 —
    전종목을 한 번에 다 받을 수는 없어서 나눠 훑는데(refresh_us_rows),
    앞에서부터 채워지므로 아직 절반만 받은 상태에서도 시가총액 상위는
    제대로 나온다. 알파벳 순으로 훑으면 A 로 시작하는 종목만 있는
    엉뚱한 순위가 한동안 뜬다.

    목록을 못 받았으면(내장 182개로 떨어진 상태) 예전처럼 335개로 돈다 —
    적은 목록으로 도는 것과 아예 안 나오는 것 중에는 전자가 낫다.
    """
    from app.services.scheduler import POPULAR_US

    """대표 ETF 를 앞줄에 함께 둔다.

    미국 목록을 GitHub 거울에서 받게 했는데(NASDAQ Trader 가 막힐 때),
    그 거울에는 NYSE Arca 가 없다. SPY·QQQ 같은 대표 ETF 가 거기 있어서
    거울로만 돌면 순위에서 통째로 빠진다 — 6,813 종목을 받아 놓고
    정작 거래대금 1위를 잃는 셈이다.

    앞줄에 박아 두면 어느 목록이 오든 안 잃는다. 순위표는 시세를 받은
    것만 담으므로, 거래소가 어디든 값만 오면 제자리를 찾아간다."""
    대표ETF = ["SPY", "QQQ", "IWM", "DIA", "VOO", "VTI", "GLD", "SLV",
               "TQQQ", "SQQQ", "SOXL", "SOXS", "ARKK", "XLK", "XLF", "XLE"]

    앞줄 = list(dict.fromkeys(POPULAR_US + 대표ETF + SP500_SYMBOLS))
    try:
        from app.services.ticker_service import get_us_db
        전체 = [t["s"] for t in get_us_db() if t.get("s")]
    except Exception as e:
        log.debug("미국 종목 목록을 못 읽음: %s", type(e).__name__)
        전체 = []

    # 목록을 못 받았어도(내장 182개로 떨어진 상태) 그냥 이어 붙이면 된다.
    # 앞줄이 늘 먼저 오므로 결과는 '앞줄 + 조금' 이고, 예전 335개보다
    # 나쁠 수 없다. 따로 막을 것이 없어서 가드를 두지 않는다.
    본것 = set(앞줄)
    return 앞줄 + [s for s in 전체 if s not in 본것]


def _us_rows_from_cache() -> list[dict]:
    """지금 캐시에 있는 것만 주워 담는다 (새로 받지 않는다)."""
    rows = []
    for sym in us_universe():
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


def _build_us_rows() -> list[dict]:
    """순위를 만들 표를 돌려준다.

    완성된 표를 캐시에서 먼저 찾고, 없으면 지금 있는 시세로 만든다.
    만든 표가 쓸 만하면(US_MIN_ROWS 이상) 담아 두고, 모자라면 지난 표라도
    쓴다 — 다섯 줄짜리 순위를 보여 주느니 15분 지난 순위가 낫다."""
    if 담긴표 := cache.get(US_ROWS_CK):
        return 담긴표

    rows = _us_rows_from_cache()
    if len(rows) >= US_MIN_ROWS:
        cache.set(US_ROWS_CK, rows, US_ROWS_TTL)
        return rows

    지난표 = cache.get_stale(US_ROWS_CK)
    if 지난표 and len(지난표) > len(rows):
        return 지난표
    return rows


#: 한 요청에 담는 종목 수. 주소 길이 한계가 있어 늘리기 어렵다
US_BATCH = 100

#: 한 번 돌 때 훑는 종목 수.
#
# 전종목이 8~9천이라 한 번에 다 받으면 몇 분씩 걸리고, 그동안 0.15 CPU 를
# 통째로 물고 있게 된다. 나눠서 훑고 다음 번에 이어 받는다 — 뉴스 수집이
# 언론사를 돌아가며 가져오는 것과 같은 방식이다.
# 1500개면 요청 15번, 대략 30초 안팎이다.
US_SWEEP = int(os.getenv("US_SWEEP", 1500))

#: 서버가 막 시작했을 때만 쓰는, 더 작은 양.
#
# 시작 직후는 라이브러리를 다 올린 직후라 메모리가 가장 높다. 거기서
# 1500개를 훑다가 프로덕션이 3분 만에 96%(493/512MB)까지 올라가 강제
# 재시작을 반복했다. 화면이 비지 않을 만큼만 채우고(앞쪽이 인기종목·
# S&P500 이라 300개면 상위 순위는 제대로 나온다) 나머지는 주기 갱신이
# 이어서 돈다 — 커서가 남아 있으므로 훑던 자리에서 계속된다.
US_STARTUP_SWEEP = int(os.getenv("US_STARTUP_SWEEP", 300))

#: 어디까지 훑었는지. 다음 번에 그 다음부터 이어 간다
_us_cursor = 0


#: 표를 담아 두는 자리는 US_ROWS_CK 다. 여기서는 그 표에 이번 회차 결과를
#: 덮어쓴다 — 매번 새로 만들지 않는다.
def _표에_쌓기(이번회차: list[dict]) -> list[dict]:
    """지난 표에 이번에 받은 것을 덮어쓴다.

    왜 새로 안 만드는가 —

    _us_rows_from_cache 는 종목마다 price:{sym} 를 캐시에서 읽는다. 그런데
    지난 값 보관함이 400칸뿐인데(STALE_MAX_ITEMS) 종목이 6,884개다. 한 바퀴를
    도는 데 다섯 회차가 걸리므로, 5회차를 훑을 때쯤이면 1회차에 받은 것은
    신선 캐시에서 만료되고 400칸에서도 밀려나 있다.

    그래서 매 회차 표를 새로 만들면 '방금 훑은 1,500개 언저리' 만 남는다.
    시가총액 순위인데 그 1,500개 안에서의 순위가 뜬다 — 종목을 372개에서
    6,884개로 늘리자 오히려 순위가 더 이상해진 이유가 이것이다.

    표 자체는 한 덩어리로 담기므로(항목 하나로 세어진다) 보관함 한도와
    상관없다. 거기에 쌓으면 한 바퀴를 다 돌았을 때 전종목이 모인다.

    오래된 줄은 그대로 둔다. 종가는 안 변하고, 장중이라도 몇십 분 전
    가격이 아예 빠지는 것보다 낫다 — 빠지면 그 종목이 순위에서 사라진다."""
    지난표 = cache.get(US_ROWS_CK) or cache.get_stale(US_ROWS_CK) or []
    모음 = {r["symbol"]: r for r in 지난표 if r.get("symbol")}
    for r in 이번회차:
        if r.get("symbol"):
            모음[r["symbol"]] = r
    return list(모음.values())


async def refresh_us_rows(sweep: int | None = None) -> int:
    """미국 상장 종목의 시세를 받아 순위표를 다시 만든다.

    범위는 us_universe() — NASDAQ Trader 목록 전부다(약 8~9천). 예전에는
    코드에 적어 둔 335개뿐이라 'S&P500 안에서의 순위' 였다.

    한 번에 다 받지는 않는다. 8~9천을 한꺼번에 훑으면 몇 분이 걸리고
    그동안 서버가 다른 일을 못 한다. US_SWEEP 개씩 이어 훑어서 몇 번에
    걸쳐 한 바퀴를 돈다. 목록 앞쪽이 인기종목·S&P500 이라, 한 바퀴를 다
    돌기 전에도 시가총액 상위는 제대로 나온다.

    장이 닫혀 있어도 돈다 — 닫혀 있으면 종가가 안 변하므로 오히려 오래
    담아 둘 수 있다. 예전에는 장이 닫히면 아무것도 안 받아서, 한국 낮에
    들어온 사람은 순위가 거의 비어 있었다."""
    global _us_rows_refreshing, _us_cursor
    if _us_rows_refreshing:
        return 0
    _us_rows_refreshing = True
    try:
        from app.services.price_fetcher import fetch_yf_quotes
        from app.services import market_hours

        열림 = market_hours.us_session() != "closed"
        # 닫혀 있으면 종가라 값이 안 변한다. 길게 담아 둬야 한 바퀴 도는
        # 동안 앞서 받은 것이 만료되지 않는다
        시세수명 = 300 if 열림 else 21600   # 6시간

        전체 = us_universe()
        if not 전체:
            return 0
        시작 = _us_cursor % len(전체)
        # 목록을 두 번 이어 붙여 놓고 잘라 낸다 — 끝에서 앞으로 넘어간다
        훑을것 = (전체 + 전체)[시작:시작 + min(sweep or US_SWEEP, len(전체))]
        _us_cursor = (시작 + len(훑을것)) % len(전체)

        받은수 = 0
        for i in range(0, len(훑을것), US_BATCH):
            # 묶음 사이마다 여유를 본다.
            #
            # 예전에는 한 번 시작하면 끝까지 갔다. 야후 응답은 파싱 중간물이
            # 크게 잡히는데(프로덕션에서 '중간 크기 버퍼' 131.5MB), 15묶음을
            # 쉬지 않고 돌면 그 사이에 한도를 넘어 프로세스가 죽는다.
            # 죽으면 담아 둔 것까지 다 잃으므로, 받은 데까지로 표를 만들고
            # 멈추는 쪽이 낫다 — 커서는 남으니 다음 회차가 이어서 훑는다.
            if i and not memory.has_headroom("미국 시세 묶음"):
                _us_cursor = (시작 + i) % len(전체)
                log.info("메모리 여유 부족 — %d개까지만 훑고 멈춥니다", i)
                break
            묶음 = 훑을것[i:i + US_BATCH]
            try:
                받음 = await asyncio.wait_for(fetch_yf_quotes(묶음), timeout=25)
            except Exception as e:
                log.debug("미국 시세 묶음 실패: %s", type(e).__name__)
                continue
            for sym, q in 받음.items():
                if q.get("price"):
                    q["symbol"] = sym
                    cache.set(f"price:{sym}", q, 시세수명)
                    받은수 += 1
            받음 = None          # 다음 묶음을 받기 전에 놓아준다
            await asyncio.sleep(0.3)

        rows = _표에_쌓기(_us_rows_from_cache())
        if rows:
            cache.set(US_ROWS_CK, rows, US_ROWS_TTL)
            # 카테고리별 순위도 다시 만들게 비운다
            for c in ("시가총액", "상승률", "하락률", "거래대금", "거래량", "신고가", "신저가"):
                cache.delete(f"rank:us:{c}")
        log.info("미국 순위표 %d종목 / 전체 %d — 이번에 %d건 갱신 (다음 시작 %d)",
                 len(rows), len(전체), 받은수, _us_cursor)
        return len(rows)
    finally:
        _us_rows_refreshing = False


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
        """시가총액을 모르는 종목은 순위에서 뺀다.

        0 은 '0원' 이 아니라 '모른다' 는 뜻이다. 야후 v7 배치가 marketCap 을
        늘 주지는 않는다 — ETF 는 시가총액 대신 순자산(totalAssets)을 쓰고,
        배치가 실패해 단건 폴백으로 받은 것은 아예 0 으로 채운다.

        그것들을 그냥 두면 '거래량 순위인데 거래량을 모르는 종목이 43위에
        앉아 있는' 것과 같은 표가 된다. 국내 순위는 진작 이렇게 하고 있다."""
        sortable = [r for r in sortable if (r.get("market_cap") or 0) > 0]
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

        # 시가총액은 HTML 에서 읽은 값을 쓰지 않고 직접 계산해 덮어쓴다.
        #
        # 예전에는 '캐시 값과 파싱 값 중 큰 쪽'을 골랐다. 둘 중 무엇이 맞는지
        # 모르니 큰 쪽을 고른다는 뜻인데, 한쪽이 엉뚱하게 크면 그 종목이
        # 그대로 1위가 된다. 실제로 시가총액 순위에서 삼성전자가 사라졌다.
        #
        # 현재가 × 상장주식수는 추측이 아니다. 계산할 수 없는 종목만
        # 파싱한 값을 남겨 둔다.
        if cat == "시가총액":
            for r in rows:
                sym = r["symbol"]
                p = cache.get(f"price:{sym}") or cache.get_stale(f"price:{sym}") or {}
                가격 = p.get("price") or r.get("price") or 0
                계산 = _시가총액(sym, 가격, p)
                if 계산 > 0:
                    r["market_cap"] = 계산
                if p.get("price"):
                    r["price"] = p["price"]          # 시총을 낸 가격과 화면 가격을 맞춘다
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
