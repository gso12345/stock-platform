"""
주식 순위 서비스
- 한국: FDR 전체 KRX 종목(~2500개) + Naver 실시간 순위
- 미국: Yahoo Finance 캐시 기반
"""
import asyncio
import logging
import os
import threading
import time
import httpx
from app.core.http import SSL
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


def _칸숫자(td) -> "float | None":
    """시세표 칸 하나의 숫자. '+1.50%'·'4,200,000' 같은 꼴을 읽는다. 숫자가 아니면 None."""
    txt = td.get_text(strip=True).replace(",", "").replace("+", "").replace("%", "").strip()
    try:
        return float(txt)
    except Exception:
        return None


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
    try:
        async with httpx.AsyncClient(timeout=8, headers=NAVER_PC_HEADERS, verify=SSL) as cl:
            r = await cl.get(url, params={"sosok": market_code})
        if r.status_code != 200:
            return []
        # 받은 HTML 을 읽는 일은 스레드에서 한다.
        #
        # 예전에는 여기(async 함수 안)에서 바로 BeautifulSoup 으로 읽었다.
        # 한 페이지에 0.05~0.4초인데 0.15 CPU 에서는 그 일곱 배라, 장중 1분마다
        # 여덟 페이지를 읽는 동안 이벤트 루프가 통째로 멈췄다 — 그 순간 들어온
        # 모든 사람의 요청이 같이 섰다. 스레드로 보내면 일하는 양은 같아도
        # 루프는 그사이 다른 요청을 받는다.
        return await asyncio.to_thread(_시세표_읽기, r.text, market_code, has_market_cap)
    except Exception as e:
        log.debug(f"Naver sise 받기 실패 ({url}): {e}")
        return []


#: 표 머리줄의 칸 이름 → 우리가 쓰는 이름.
#:
#: 예전에는 '종목명 다음 몇 번째 칸' 으로만 읽었다. 그런데 시가총액 페이지에는
#: 등락률과 시가총액 사이에 **액면가** 칸이 있다. 칸 하나가 밀리면 시가총액
#: 자리에서 액면가를(삼성전자가 시가총액 순위에서 사라진 일), 거래량 자리에서
#: 외국인비율을 읽는다 — 숫자가 나오긴 하므로 아무도 눈치채지 못한다.
#: 머리줄이 있으면 칸 이름으로 찾는다. 없으면(머리줄 모양이 바뀌었을 때) 예전
#: 위치로 읽는다.
_머리칸 = {
    "종목명": "name",
    "현재가": "price", "전일비": "change", "등락률": "change_rate",
    "거래량": "volume", "시가총액": "market_cap",
}


#: 이 칸들이 머리줄에 다 있어야 머리줄을 믿는다. 이름이 바뀌어(예: '등락률(%)')
#: 하나라도 못 찾으면 머리줄을 버리고 예전 위치로 읽는다 — 반쯤 맞는 머리줄로
#: 읽으면 등락률이 통째로 0 이 되는 식으로 조용히 틀린다.
_꼭있어야할칸 = ("종목명", "현재가", "등락률", "거래량")


def _머리줄_읽기(soup) -> dict[str, int]:
    """시세표 머리줄에서 칸 이름 → 위치. 믿을 만한 머리줄이 없으면 빈 dict."""
    for 표 in soup.select("table"):
        이름들 = [th.get_text(strip=True) for th in 표.select("tr th")]
        if all(n in 이름들 for n in _꼭있어야할칸):
            return {_머리칸[n]: i for i, n in enumerate(이름들) if n in _머리칸}
    return {}


def _시세표_읽기(html: str, market_code: int, has_market_cap: bool) -> list[dict]:
    """네이버 시세 페이지 HTML → 순위 줄. 스레드에서 돈다 (_fetch_naver_sise_page 참고)."""
    soup = None
    try:
        from bs4 import BeautifulSoup
        suffix   = ".KS" if market_code == 0 else ".KQ"
        mkt_name = "KOSPI" if market_code == 0 else "KOSDAQ"
        soup = BeautifulSoup(html, "lxml")
        머리 = _머리줄_읽기(soup)
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
                nums.append(_칸숫자(td))

            if len(nums) < 4:
                continue

            # 머리줄이 있으면 칸 이름으로 읽는다(_머리칸 참고). 줄 앞에 머리줄에
            # 없는 칸이 더 있으면 종목명 칸 위치로 그만큼 밀어 맞춘다
            어긋남 = name_idx - 머리["name"] if "name" in 머리 else None

            def 칸(필드: str, 예전위치: int):
                if 어긋남 is not None:
                    # 머리줄을 읽었으면 그것만 믿는다. 머리줄에 없는 칸은 그
                    # 페이지에 없는 것이다(상승률 페이지에는 시가총액이 없다) —
                    # 예전 위치로 읽으면 매도호가 같은 옆 칸을 시가총액으로 읽는다
                    if 필드 not in 머리:
                        return None
                    i = 머리[필드] + 어긋남
                    return _칸숫자(tds[i]) if 0 <= i < len(tds) else None
                return nums[예전위치] if len(nums) > 예전위치 else None

            # 머리줄이 없을 때의 예전 위치(종목명 다음부터 0):
            #   시가총액 페이지  [0]현재가 [1]전일비 [2]등락률 [3]시총(억) … [6]거래량
            #   나머지 페이지    [0]현재가 [1]전일비 [2]등락률 [3]거래량 … [5]시총(억)
            현재가, 전일비, 등락률 = 칸("price", 0), 칸("change", 1), 칸("change_rate", 2)
            거래량 = 칸("volume", 6 if has_market_cap else 3)
            시총억 = 칸("market_cap", 3 if has_market_cap else 5)

            price       = 현재가 if 현재가 and 현재가 > 0 else 0
            change_raw  = 전일비 if 전일비 is not None else 0
            change_rate = 등락률 if 등락률 is not None and abs(등락률) <= 100 else 0
            volume      = int(거래량) if 거래량 and 거래량 > 0 else 0
            market_cap  = int(시총억 * 1e8) if 시총억 and 시총억 > 0 else 0

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
        log.debug(f"Naver sise 파싱 실패: {e}")
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

    # 번호는 복사본에 매긴다(_sort_us 와 같은 이유) — 내보낼 100줄만
    return [dict(r, rank=i + 1) for i, r in enumerate(sortable[:100])]


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
            "market_cap":  p.get("market_cap") or _주식수로_시총(sym, price),
            "regular_time": p.get("regular_time") or 0,
            "_demo":       p.get("_demo", False),
        })
    return rows


# ── 전종목 — 나스닥 종목 목록 ──────────────────────────────────
# 해외 순위표는 미국 상장 전종목(약 6,800)을 기준으로 해야 한다. 그런데 표를
# 채우는 길이 야후뿐이었고, 프로덕션에서는 야후 일괄 시세(v7/quote, 인증 토큰
# 필요)가 막혀 spark 로만 받는다(관리자 화면 '해외 순위표 · 야후 spark(v7)').
#   · spark 는 시가총액을 안 준다 — 해외 순위의 첫 탭 '시가총액' 이 서지 못했다
#   · 서버가 뜨면 300종목만 훑고(메모리) 나머지는 30분마다 1,500개씩 이어 훑어,
#     전종목이 차기까지 두 시간이 넘었다. 재배포·재시작마다 300 부터 다시였다
#     — 관리자 화면에 '279/300종목 · 표 352줄' 로 찍힌 것이 그 상태다
#
# 나스닥 종목 목록(screener)은 요청 한 번에 전종목의 가격·등락·거래량·시가총액을
# 준다. 서버가 뜰 때와 장이 하나 끝날 때마다 받아 표를 전종목으로 채운다.
# 같은 응답에서 '주식 수'(시가총액 ÷ 가격)도 구해 두고, 야후 spark 로 받은 지금
# 가격에 곱해 시가총액을 낸다.
#
# 장중에는 이 목록이 오늘 값인지 어제 마감 값인지 여기서 가릴 수 없다. 그래서
# '마지막으로 끝난 장' 의 값으로 넣는다 — 오늘 등락률 순위(한 장끼리만 견준다)
# 에는 야후로 방금 받은 종목만 들어가고, 이 줄들은 장이 끝나 다시 받을 때 든다.
NASDAQ_SCREENER = "https://api.nasdaq.com/api/screener/stocks"
_나스닥_H = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Origin": "https://www.nasdaq.com",
    "Referer": "https://www.nasdaq.com/",
}
#: 못 받았으면 다시 묻기까지(초)
나스닥_실패쉼 = int(os.getenv("US_NASDAQ_RETRY_SEC", 3600))
#: 장이 끝나고 이만큼 지나서 받는다(분) — 마감 직후에는 목록이 덜 고쳐져 있을 수 있다
나스닥_마감여유분 = 30
_주식수: dict = {}
_나스닥_장 = None            # 이 프로세스가 표에 넣은 나스닥 목록이 어느 장의 것인지
_나스닥_줄수 = 0
_나스닥_시도때 = 0.0
_주식수_불러옴 = False
_나스닥_자물쇠 = threading.Lock()
#: 훑기가 이 프로세스에서 전종목을 한 바퀴 돌았나
_한바퀴 = False


def _주식수로_시총(sym: str, 가격) -> float:
    n = _주식수.get(sym)
    return n * 가격 if n and 가격 else 0


def 전종목_채움() -> bool:
    """순위표가 전종목을 담았나 — 나스닥 전종목을 넣었거나 훑기가 한 바퀴를 돌았다.

    아직이면 스케줄러가 장이 닫혀 있어도 10분마다 이어 훑는다(나스닥이 막혔을 때)."""
    return _나스닥_장 is not None or _한바퀴


def _나스닥수(v) -> "float | None":
    """'$227.52' · '3,456,789,000,000.00' · '-0.537%' → 수. 'NA'·빈칸은 None."""
    글 = str(v or "").replace("$", "").replace(",", "").replace("%", "").strip()
    try:
        return float(글)
    except ValueError:
        return None


_이름꼬리 = re.compile(
    r"\s+(?:Class [A-Z]\s+)?(?:Common Stock|Common Shares|Ordinary Shares?|"
    r"American Depositary Shares?|American Depository Shares?|Depositary Shares?)\b.*$", re.I)


def 나스닥_목록_읽기(j) -> list:
    """나스닥 종목 목록 응답 → 표의 줄 모양(가격이 있는 것만).

    download=true 면 data.rows, 아니면 data.table.rows 에 줄이 온다. 우선주·
    클래스는 'BRK/B' 처럼 오는데 우리(야후) 꼴은 'BRK-B' 다. 이름 끝의
    'Common Stock' 같은 꼬리는 뗀다."""
    if not isinstance(j, dict):
        return []
    data = j.get("data") or {}
    줄들 = data.get("rows") or (data.get("table") or {}).get("rows") or []
    out = []
    for z in 줄들:
        if not isinstance(z, dict):
            continue
        sym = str(z.get("symbol") or "").strip().upper().replace("/", "-").replace("^", "-")
        가격 = _나스닥수(z.get("lastsale"))
        if not sym or not 가격 or 가격 <= 0:
            continue
        cap = _나스닥수(z.get("marketCap"))
        거래량 = _나스닥수(z.get("volume")) or 0
        이름 = _이름꼬리.sub("", str(z.get("name") or "")).strip() or sym
        out.append({
            "symbol": sym, "name": 이름, "price": 가격,
            "change": _나스닥수(z.get("netchange")) or 0,
            "change_rate": _나스닥수(z.get("pctchange")) or 0,
            "volume": int(거래량), "amount": 가격 * 거래량,
            "market_cap": cap if cap and cap > 0 else 0,
        })
    return out


def 나스닥_주식수_읽기(j) -> dict:
    """나스닥 종목 목록 응답 → {심볼: 주식 수(시가총액 ÷ 가격)}."""
    return {r["symbol"]: r["market_cap"] / r["price"] for r in 나스닥_목록_읽기(j) if r["market_cap"]}


def 마친장(now_utc=None) -> "tuple":
    """마지막으로 끝난 미국 정규장 — (그날, 마감 시각 유닉스 초).

    마감(16:00 ET) 뒤 나스닥_마감여유분 이 지나야 그날 장이 '끝난' 것으로 본다.
    휴장일(공휴일)은 모른다 — 그날을 끝난 장으로 볼 뿐, 값은 그 전 장 그대로다."""
    from datetime import datetime as _dt, time as _t, timedelta as _td, timezone as _tz
    from app.services.market_hours import _et_now
    et = _et_now(now_utc or _dt.now(_tz.utc))
    날 = et.date()
    if et.weekday() >= 5 or et.time() < _t(16, 나스닥_마감여유분):
        날 -= _td(days=1)
    while 날.weekday() >= 5:
        날 -= _td(days=1)
    마감 = _dt(날.year, 날.month, 날.day, 16, 0, tzinfo=et.tzinfo)
    return 날, int(마감.timestamp())


def _나스닥_쌓기(줄들: list, 마감: int) -> int:
    """전종목 줄을 표에 넣는다. 야후로 받은 더 새 값(같은 장이나 뒤 장)이 있으면 그
    가격은 두고 모르는 시가총액만 채운다. 표의 줄 수를 돌려준다."""
    표 = cache.get(US_ROWS_CK) or cache.get_stale(US_ROWS_CK) or []
    모음 = {r["symbol"]: r for r in 표 if r.get("symbol")}
    for z in 줄들:
        z = {**z, "regular_time": 마감}
        옛 = 모음.get(z["symbol"])
        if 옛 and (옛.get("regular_time") or 0) >= 마감:
            if not 옛.get("market_cap") and (n := _주식수.get(z["symbol"])) and 옛.get("price"):
                모음[z["symbol"]] = {**옛, "market_cap": n * 옛["price"]}
            continue
        모음[z["symbol"]] = _아는값_지키기(옛, z)
    cache.set(US_ROWS_CK, list(모음.values()), US_ROWS_TTL)
    return len(모음)


def _주식수_db(쓰기: "dict | None" = None) -> "tuple[dict, float]":
    """DB(ranking_snapshots 의 'US_SHARES' 줄)에서 읽거나 쓴다."""
    from datetime import datetime, timezone as _tz
    from app.db.database import SessionLocal
    from app.models.stock import RankingSnapshot
    db = SessionLocal()
    try:
        줄 = db.get(RankingSnapshot, "US_SHARES")
        if 쓰기 is None:
            if 줄 and isinstance(줄.data, dict) and 줄.data.get("shares"):
                at = 줄.fetched_at.replace(tzinfo=_tz.utc).timestamp() if 줄.fetched_at else 0.0
                return dict(줄.data["shares"]), at
            return {}, 0.0
        값 = {"shares": 쓰기, "source": "nasdaq"}
        if 줄:
            줄.data, 줄.fetched_at = 값, datetime.utcnow()
        else:
            db.add(RankingSnapshot(market="US_SHARES", data=값, fetched_at=datetime.utcnow()))
        db.commit()
        return 쓰기, time.time()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def 나스닥_챙기기() -> int:
    """전종목 목록을 준비한다. 이번에 받아 표에 넣은 줄 수(안 받았으면 0).

    · 처음 부르면 DB 의 주식 수부터 읽는다 — 받기 전에도 시가총액을 낼 수 있게
    · 이 프로세스에서 아직 안 받았거나 장이 하나 더 끝났으면 받는다. 못 받으면
      나스닥_실패쉼 동안 다시 묻지 않는다
    순위표를 쌓기 전에 부른다(뒤에서 도는 일이라 받는 동안 기다려도 된다)."""
    global _주식수, _나스닥_장, _나스닥_줄수, _나스닥_시도때, _주식수_불러옴
    from app.core import health
    if not _나스닥_자물쇠.acquire(blocking=False):
        return 0                       # 다른 쪽이 받는 중
    try:
        if not _주식수_불러옴:
            _주식수_불러옴 = True
            try:
                있던것, _ = _주식수_db()
                if 있던것:
                    _주식수 = 있던것
            except Exception as e:
                log.debug("주식 수 읽기 실패: %s", type(e).__name__)
        장, 마감 = 마친장()
        if _나스닥_장 == 장 or time.time() - _나스닥_시도때 < 나스닥_실패쉼:
            return 0
        if not memory.has_headroom("해외 전종목"):
            return 0
        _나스닥_시도때 = time.time()
        try:
            r = httpx.get(NASDAQ_SCREENER, params={"tableonly": "true", "download": "true"},
                          headers=_나스닥_H, timeout=30, verify=SSL)
        except Exception as e:
            health.record_fail("해외 전종목(나스닥)", f"연결 실패({type(e).__name__})")
            return 0
        if r.status_code != 200:
            health.record_fail("해외 전종목(나스닥)", f"HTTP {r.status_code}")
            return 0
        try:
            줄들 = 나스닥_목록_읽기(r.json())
        except Exception:
            줄들 = []
        r = None
        if len(줄들) < 500:
            health.record_fail("해외 전종목(나스닥)", f"목록이 비었거나 모양이 바뀜({len(줄들)}종목)")
            return 0
        _주식수 = {z["symbol"]: z["market_cap"] / z["price"] for z in 줄들 if z["market_cap"]}
        try:
            _주식수_db(_주식수)
        except Exception as e:
            log.debug("주식 수 남기기 실패: %s", type(e).__name__)
        표줄수 = _나스닥_쌓기(줄들, 마감)
        # 쉼(나스닥_실패쉼)은 못 받았을 때만이다 — 받았으면 다음 장이 끝나는 대로 받는다
        _나스닥_장, _나스닥_줄수, _나스닥_시도때 = 장, len(줄들), 0.0
        health.record_ok("해외 전종목(나스닥)", None,
                         f"{len(줄들):,}종목 · {장.month}/{장.day} 장 · 순위표 {표줄수:,}줄")
        return len(줄들)
    finally:
        _나스닥_자물쇠.release()


def _build_us_rows() -> list[dict]:
    """순위를 만들 표를 돌려준다.

    담긴 표가 있으면 그것을, 없으면 지금 있는 시세를 지난 표 위에 쌓는다.

    여기가 '엔비디아가 순위에 안 뜬다' 의 주범이었다. 훑는 쪽
    (refresh_us_rows)은 표를 쌓게 고쳤는데, 사용자가 순위를 열 때 도는
    이 함수는 그대로 새로 만들고 있었다. 그래서 이런 일이 벌어졌다 —

      1. 훑기를 여러 회차 돌려 6,882 종목짜리 표를 쌓아 둔다. 1위 엔비디아.
      2. 15분이 지나 US_ROWS_CK 가 만료된다.
      3. 그때 사용자가 순위를 연다. 이 함수가 price:{sym} 를 주워 담는데,
         보관함이 400칸뿐이라 살아남은 건 마지막 회차 몇백 개뿐이다.
      4. 그 몇백 개가 US_MIN_ROWS(50)보다 많으니 '쓸 만한 표' 로 보고
         6,882줄짜리 표를 덮어써 버린다.
      5. 엔비디아는 한참 전 회차에 훑은 종목이라 그 몇백 개에 없다.
         시가총액 1위가 목록에서 사라진다.

    재현해 보면 그대로다 — 누적 371줄(1위 NVDA)이 60줄로 덮이고 1위가
    엉뚱한 ETF 가 된다.

    쌓기로 바꾸면 만료는 '다시 담을 때가 됐다' 는 뜻일 뿐, 표를 버리라는
    뜻이 아니게 된다. 표는 한 덩어리로 담기므로 보관함 한도와 무관하다."""
    if 담긴표 := cache.get(US_ROWS_CK):
        return 담긴표

    rows = _표에_쌓기(_us_rows_from_cache())
    if len(rows) >= US_MIN_ROWS:
        cache.set(US_ROWS_CK, rows, US_ROWS_TTL)
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
        sym = r.get("symbol")
        if not sym:
            continue
        옛 = 모음.get(sym)
        # 표에 더 뒤 장의 값이 있으면 지킨다 — 장이 끝나고 나스닥 전종목(마감값)을
        # 넣은 뒤, 몇 시간 묵은 시세 캐시가 그것을 덮어 되돌리지 않게
        if 옛 and (옛.get("regular_time") or 0) > (r.get("regular_time") or 0) > 0:
            continue
        모음[sym] = _아는값_지키기(옛, r)
    return list(모음.values())


#: 0 은 '0' 이 아니라 '모른다' 는 뜻인 항목들.
#
# 시가총액이 0인 회사는 없다. 거래량 0은 있을 수 있지만(거래 정지) 이름이
# 빈 것은 없다. 이런 자리에 0/빈값이 들어오면 값이 아니라 '이번엔 못 받았다'
# 는 뜻이다.
_모르면_0으로_오는것 = ("market_cap", "name")


def _아는값_지키기(옛줄: "dict | None", 새줄: dict) -> dict:
    """새로 받은 줄에 빠진 것이 있으면 알던 값을 남긴다.

    엔비디아가 시가총액 순위에서 통째로 사라진 두 번째 원인이 여기다.
    price:{sym} 를 쓰는 곳이 열 군데가 넘는데, 그중 몇은 시가총액을 안 담는다 —

      · 배치 조회가 안 되는 종목의 단건 폴백(_fetch_yf_quote_single_sync)은
        market_cap 을 0 으로 박아 넣는다. fast_info 에 그 값이 없어서다.
      · 종목 상세 화면을 열면 그 응답으로 price:{sym} 를 덮어쓴다. 거기엔
        시가총액이 없을 수 있다.

    그렇게 한 번 0 으로 덮이면, 시가총액 순위는 그 종목을 아예 빼 버린다
    (0 을 '시가총액 0원' 으로 보여 주는 것보다 빼는 게 맞다). 인기 종목일수록
    상세 화면이 자주 열리니, 하필 제일 큰 회사부터 사라진다.

    그래서 덮어쓸 때 이 항목들만 지킨다. 새 값이 있으면 새 값이 이긴다 —
    시가총액은 실제로 변하니까. 새 값이 0/빈값일 때만 알던 값을 남긴다."""
    if not 옛줄:
        return 새줄
    지킬것 = {k: 옛줄[k] for k in _모르면_0으로_오는것
              if not 새줄.get(k) and 옛줄.get(k)}

    # 이름은 빈값으로 안 온다 — 단건 폴백이 name 을 심볼로 채운다
    # ("NVDA"). 빈값 검사로는 안 걸리는데, 목록에는 회사 이름 대신
    # 티커만 뜨게 된다. 이름이 심볼과 같으면 '모른다' 로 본다.
    이름, 심볼 = 새줄.get("name"), 새줄.get("symbol")
    if 이름 and 심볼 and 이름 == 심볼 and 옛줄.get("name") not in (None, "", 심볼):
        지킬것["name"] = 옛줄["name"]

    return {**새줄, **지킬것} if 지킬것 else 새줄


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
    global _us_rows_refreshing, _us_cursor, _한바퀴
    if _us_rows_refreshing:
        return 0
    _us_rows_refreshing = True
    try:
        from collections import Counter
        from app.services.price_fetcher import fetch_yf_quotes
        from app.services import market_hours, price_fetcher as _pf

        # 표를 쌓기 전에 DB 에 남긴 마지막 순위부터 깐다(프로세스당 한 번).
        # 시가총액을 아는 줄이 먼저 있어야, spark(시가총액 없음)로만 받는
        # 동안에도 그 값이 지켜져 시가총액 순위가 선다
        await asyncio.to_thread(해외순위_사진_불러오기)
        # 전종목을 먼저 표에 넣는다(나스닥 목록 한 번). 시가총액을 안 주는 spark
        # 로만 받아도 시가총액이 서게 주식 수도 같이 챙긴다
        await asyncio.to_thread(나스닥_챙기기)

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
        한바퀴됨 = 시작 + len(훑을것) >= len(전체)

        받은수 = 0
        길: Counter = Counter()          # 묶음마다 야후의 어느 길로 받았나
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
                한바퀴됨 = False
                log.info("메모리 여유 부족 — %d개까지만 훑고 멈춥니다", i)
                break
            묶음 = 훑을것[i:i + US_BATCH]
            try:
                받음 = await asyncio.wait_for(fetch_yf_quotes(묶음), timeout=25)
            except Exception as e:
                log.debug("미국 시세 묶음 실패: %s", type(e).__name__)
                continue
            if 받음:
                길[_pf.마지막_야후경로] += 1
            for sym, q in 받음.items():
                if q.get("price"):
                    q["symbol"] = sym
                    _시세_담기(sym, q, 시세수명)
                    받은수 += 1
            받음 = None          # 다음 묶음을 받기 전에 놓아준다
            await asyncio.sleep(0.3)

        rows = _표에_쌓기(_us_rows_from_cache())
        if rows:
            cache.set(US_ROWS_CK, rows, US_ROWS_TTL)
            # 분류별 순위도 새 표로 이 자리에서 다시 만든다(미국표_다시쌓기 참고)
            _미국순위_모두_담기(rows)
        if 한바퀴됨:
            _한바퀴 = True
        _순위표_상태_남기기(받은수, len(훑을것), len(rows), 길, len(전체))
        log.info("미국 순위표 %d종목 / 전체 %d — 이번에 %d건 갱신 (다음 시작 %d)",
                 len(rows), len(전체), 받은수, _us_cursor)
        return len(rows)
    finally:
        _us_rows_refreshing = False


#: 등락·거래 순위를 한 장(같은 날 정규장)의 값으로만 매기려면 그 장에서 이만큼은
#: 모여야 한다 — 장이 막 열려 아직 몇 종목만 받았으면 그 앞 장으로 줄 세운다
US_SESSION_MIN_ROWS = 20


def _미국_하루시작(t: int) -> int:
    """정규장 마지막 체결 시각(유닉스 초) → 그날 0시(뉴욕 기준)의 유닉스 초.

    market_hours 와 같은 동부시각 계산을 쓴다(서머타임 근사). 줄마다 날짜로
    바꾸지 않고 '하루의 시작' 하나와 견준다 — 6천 줄을 매번 변환하면 0.15
    CPU 에서 그것만으로 눈에 띄게 걸린다."""
    from datetime import datetime, timezone
    from app.services.market_hours import _et_now
    뉴욕 = _et_now(datetime.fromtimestamp(t, timezone.utc))
    return int(뉴욕.replace(hour=0, minute=0, second=0, microsecond=0).timestamp())


def _마지막_장만(rows: list[dict]) -> list[dict]:
    """가장 최근 정규장의 값만 남긴다 (등락률·거래량·거래대금 순위용).

    표는 여러 번에 걸쳐 나눠 쌓는다. 미국장이 열려 있는 동안 인기·S&P500 은
    자주 받지만 나머지는 전날 장 마감 값 그대로였다 — 그래서 상승률 순위에
    **어제 오른 종목** 이 오늘 오른 종목과 섞여 위에 앉아 있었다.

    정규장 마지막 체결 시각(regular_time)의 날짜로 장을 가른다. 가장 최근
    장에 충분히(US_SESSION_MIN_ROWS) 모였으면 그 장 것만, 아직 덜 모였으면
    (장이 막 열려 받는 중) 그 앞 장 것만 쓴다 — 어느 쪽이든 한 장의 값끼리만
    견준다. 체결 시각을 아는 줄이 없으면(옛 캐시) 거르지 않는다."""
    남은 = [r for r in rows if (r.get("regular_time") or 0) > 0]
    while 남은:
        시작 = _미국_하루시작(max(r["regular_time"] for r in 남은))
        그날 = [r for r in 남은 if r["regular_time"] >= 시작]
        if len(그날) >= US_SESSION_MIN_ROWS:
            return 그날
        남은 = [r for r in 남은 if r["regular_time"] < 시작]
    return rows


def _시세_담기(sym: str, q: dict, 수명: int) -> None:
    """새 시세를 담되, 새 값에 시가총액이 없으면 알던 것을 남긴다.

    야후 일괄 시세가 막혀 spark 로 받으면 시가총액이 안 온다. 그대로 덮으면
    종목 시세에서 시가총액이 사라진다(순위표는 _아는값_지키기 가 지킨다)."""
    if not q.get("market_cap"):
        알던 = (cache.get_stale(f"price:{sym}") or {}).get("market_cap")
        if 알던:
            q = {**q, "market_cap": 알던}
    cache.set(f"price:{sym}", q, 수명)


def _순위표_상태_남기기(받은수: int, 물은수: int, 표줄수: int,
                     길: "dict | None" = None, 전체수: int = 0) -> None:
    """관리자 화면 '데이터 수집' 에 해외 순위표를 어떻게 채웠는지 남긴다.

    해외 순위가 통째로 비어도 왜 그런지 볼 곳이 없었다 — '야후 시세' 줄은
    보고 있는 종목 갱신만 적었고, 순위표를 채우는 일괄 조회는 아무 데도
    안 적었다."""
    try:
        from app.core import health
        # 순위가 몇 종목을 두고 매긴 것인지가 먼저다 — 예전에는 이번 회차에 받은
        # 수('279/300종목')만 앞에 있어, 그게 순위의 기준인 줄로 읽혔다
        표글 = f"순위표 {표줄수:,}종목" + (f"(전체 목록 {전체수:,})" if 전체수 else "")
        if _나스닥_장 is not None:
            표글 += f" · 나스닥 전종목 {_나스닥_줄수:,}"
        if 받은수:
            어디서 = " · ".join(f"{k} {n}묶음" for k, n in (길 or {}).items())
            health.record_ok("해외 순위표", None,
                             f"{표글} · 이번에 야후 {받은수}/{물은수}종목"
                             + (f"({어디서})" if 어디서 else ""))
        else:
            health.record_fail("해외 순위표",
                               f"{표글} · 이번에 야후 0/{물은수}종목 — 일괄 시세·spark 모두 빈손")
    except Exception:
        pass


# ── 마지막 해외 순위를 DB 에 남긴다 ─────────────────────────────
#: 이만큼은 쌓인 표로 만든 순위만 남긴다 — 재시작 직후 얇은 표로 만든 순위가
#: 좋은 사진을 덮어쓰지 않게
US_SNAPSHOT_MIN_ROWS = 300
#: 남기는 간격(초). 표는 5~10분마다 바뀐다 — 그때마다 쓸 까닭은 없다
US_SNAPSHOT_EVERY = 600
_사진_남긴때 = 0.0
_사진_불러옴 = False


def _순위사진_남기기(모두: dict) -> None:
    global _사진_남긴때
    지금 = time.time()
    # DB 에 있는 것을 읽기 전에는 쓰지 않는다 — 재시작 직후 얇은 표로 만든
    # 순위가 남겨 둔 좋은 순위를 읽히기도 전에 덮지 않게
    if not _사진_불러옴 or 지금 - _사진_남긴때 < US_SNAPSHOT_EVERY:
        return
    _사진_남긴때 = 지금
    # DB 왕복을 부르는 쪽(갱신은 async 다)의 이벤트 루프에서 하지 않는다
    threading.Thread(target=_순위사진_쓰기, args=("US", 모두), daemon=True).start()


def _순위사진_쓰기(시장: str, 모두: dict) -> None:
    try:
        import math
        from datetime import datetime
        from app.db.database import SessionLocal
        from app.models.stock import RankingSnapshot
        깨끗 = {c: [{k: (None if isinstance(v, float) and not math.isfinite(v) else v)
                     for k, v in r.items()} for r in 줄들]
                for c, 줄들 in 모두.items() if 줄들}
        if not 깨끗:
            return
        db = SessionLocal()
        try:
            줄 = db.get(RankingSnapshot, 시장)
            if 줄:
                # 이번에 못 만든 분류는 지난 것을 둔다 — spark 로만 받는 동안은
                # 시가총액을 몰라 시가총액 순위가 안 서는데, 그걸로 남겨 둔
                # 시가총액 순위를 지우면 안 된다
                지난 = 줄.data if isinstance(줄.data, dict) else {}
                줄.data, 줄.fetched_at = {**지난, **깨끗}, datetime.utcnow()
            else:
                db.add(RankingSnapshot(market=시장, data=깨끗, fetched_at=datetime.utcnow()))
            db.commit()
        except Exception:
            db.rollback()
        finally:
            db.close()
    except Exception as e:
        log.debug("해외 순위 사진 남기기 실패: %s", type(e).__name__)


def 해외순위_사진_불러오기() -> bool:
    """DB 에 남긴 마지막 해외 순위를 캐시에 깐다(프로세스당 한 번).

    해외 순위표는 메모리에만 있어, 서버가 다시 뜨면 훑기가 표를 다시 쌓을
    때까지(그동안 야후가 막혀 있으면 계속) 해외 순위 카드가 비었다. 남겨 둔
    순위를 곧바로 보여 준다 — 줄마다 '언제 장의 값인지(as_of)' 가 실려 있어
    화면이 'M/D HH:MM 기준' 으로 알린다.

    표가 비어 있으면 그 종목들로 표도 채운다. 시가총액을 아는 줄이 생겨서,
    야후 일괄 시세가 막혀 spark(시가총액 없음)로만 받을 때도 시가총액 순위가
    선다."""
    global _사진_불러옴
    if _사진_불러옴:
        return False
    _사진_불러옴 = True
    try:
        from app.db.database import SessionLocal
        from app.models.stock import RankingSnapshot
        db = SessionLocal()
        try:
            줄 = db.get(RankingSnapshot, "US")
        finally:
            db.close()
    except Exception as e:
        log.debug("해외 순위 사진 읽기 실패: %s", type(e).__name__)
        return False
    if not 줄 or not isinstance(줄.data, dict) or not 줄.data:
        return False
    for c, 줄들 in 줄.data.items():
        if c in ALLOWED_CATEGORIES and 줄들 and not cache.get(f"rank:us:{c}"):
            cache.set(f"rank:us:{c}", 줄들, US_SORTED_TTL)
    if not (cache.get(US_ROWS_CK) or cache.get_stale(US_ROWS_CK)):
        모음: dict = {}
        for 줄들 in 줄.data.values():
            for r in 줄들 or []:
                if r.get("symbol"):
                    모음[r["symbol"]] = {k: v for k, v in r.items() if k not in ("rank", "as_of")}
        if 모음:
            cache.set(US_ROWS_CK, list(모음.values()), US_ROWS_TTL)
    log.info("해외 순위 사진을 깔았다 (%s)", ", ".join(f"{c} {len(v)}" for c, v in 줄.data.items()))
    return True


def _sort_us(rows: list[dict], category: str, 장거름: bool = True) -> list[dict]:
    """미국 순위 하나. 장거름=False 면 이미 한 장으로 거른 줄을 받은 것이다
    (_미국순위_모두_담기 가 일곱 가지를 만들며 한 번만 거른다)."""
    sortable = [r for r in rows if r.get("price")]
    if 장거름 and category != "시가총액":
        sortable = _마지막_장만(sortable)
    if category == "상승률":
        sortable.sort(key=lambda x: x.get("change_rate") or -9999, reverse=True)
    elif category == "하락률":
        sortable.sort(key=lambda x: x.get("change_rate") or 9999)
    elif category == "거래대금":
        # 거래량을 모르는 줄(spark v8 은 거래량을 안 준다)은 뺀다 — 시가총액과
        # 같은 규칙이다. 두면 '거래대금 0' 인 종목이 순위를 채운다
        sortable = [r for r in sortable if (r.get("amount") or 0) > 0]
        sortable.sort(key=lambda x: x.get("amount") or 0, reverse=True)
    elif category == "거래량":
        sortable = [r for r in sortable if (r.get("volume") or 0) > 0]
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
    # 번호는 복사본에 매긴다 — 표의 줄에 매기면 분류마다 서로 덮어쓴다.
    # 복사는 내보낼 100줄만(6천 줄을 다 복사할 이유가 없다)
    위 = []
    for i, r in enumerate(sortable[:100]):
        줄 = dict(r, rank=i + 1)
        # 언제 장의 값인가 — 화면이 'M/D HH:MM 기준' 으로 보여 준다
        if r.get("regular_time"):
            줄["as_of"] = r["regular_time"]
        위.append(줄)
    return 위


# ── 공개 인터페이스 ────────────────────────────────────────
#: 네이버를 못 받아 전일 종가(FDR)로 만든 대체 순위의 수명.
#: 오래 담아 두면 네이버가 돌아와도 그동안 어제 순위를 낸다.
FDR_RANK_TTL = 60


def get_kr_rankings(category: str = "시가총액") -> list[dict]:
    """국내 순위 — 담아 둔 것이 없을 때만 쓰는 **대체 경로**(전일 종가 기준).

    평소 순위는 refresh_kr_rankings_from_naver 가 네이버 시세표로 만든다."""
    ck = f"rank:kr:{category}"
    cached = cache.get(ck)
    if cached:
        return cached

    # 캐시가 막 만료됐을 뿐이라면, 몇 분 전 실시간 순위가 어제 종가로 새로
    # 만든 순위보다 훨씬 정확하다. 스케줄러가 곧 갱신해 준다.
    if stale := cache.get_stale(ck):
        return stale

    rows = _build_all_kr_rows()
    result = _sort_kr(rows, category)
    if result:
        cache.set(ck, result, FDR_RANK_TTL)
    return result


def _시가총액_다시매기기(rows: list[dict]) -> list[dict]:
    """시가총액 순위를 현재가 × 상장주식수 로 다시 매겨 줄 세운다.

    HTML 에서 읽은 시가총액을 그대로 믿지 않는다. 예전에는 '캐시 값과 파싱
    값 중 큰 쪽' 을 골랐는데, 한쪽이 엉뚱하게 크면 그 종목이 그대로 1위가
    됐다. 실제로 시가총액 순위에서 삼성전자가 사라졌다. 현재가 × 상장주식수는
    추측이 아니다 — 계산할 수 없는 종목만 받아 온 값을 쓴다.

    가격은 방금 받은 네이버 값을 쓰고, **신선한** 실시간 시세가 있을 때만
    그것으로 바꾼다. 예전에는 지난 값(get_stale)까지 꺼내 덮었다. 그 값은
    몇 시간·며칠 묵은 것일 수 있어서, 1분 전에 받은 가격을 어제 가격으로
    바꿔 놓고 등락률은 네이버 것 그대로 두었다 — 가격과 등락률이 서로
    맞지 않는 줄이 순위에 섞였다. 실시간 값으로 바꿀 때는 등락도 같이 바꾼다."""
    for r in rows:
        sym = r["symbol"]
        실시간 = cache.get(f"price:{sym}") or {}
        if 실시간.get("price") and not 실시간.get("_demo"):
            r["price"] = 실시간["price"]
            if 실시간.get("change_rate") is not None:
                r["change_rate"] = 실시간["change_rate"]
                r["change"] = 실시간.get("change", r.get("change"))
        # 주식수를 모를 때 쓸 값 — 방금 읽은 이 줄의 시가총액이 전일 값보다 낫다
        계산 = _시가총액(sym, r.get("price") or 0, {**r, **실시간})
        if 계산 > 0:
            r["market_cap"] = 계산
    rows.sort(key=lambda x: x.get("market_cap") or 0, reverse=True)
    return rows


def _거래대금_순위(표: dict[str, list[dict]]) -> list[dict]:
    """거래대금 순위 — 받은 네 페이지(시총·상승·하락·거래량)의 줄을 모두 합쳐 매긴다.

    예전에는 '거래량 상위 100' 안에서만 다시 줄 세웠다. 거래량 상위는 값싼
    종목과 ETF 가 채우므로, 주가가 높은 대형주(SK하이닉스·삼성바이오로직스
    같은)는 거래대금이 1·2위권인데도 후보에 아예 없었다. 시총 상위를 합치면
    대형주가, 상승·하락 상위를 합치면 크게 움직인 종목이 들어온다 — 실제
    거래대금 상위는 이 넷 중 어딘가에 있다.

    같은 종목이 여러 페이지에 있으면 거래량이 가장 큰(가장 나중에 받은) 줄을 쓴다."""
    모음: dict[str, dict] = {}
    for 줄들 in 표.values():
        for r in 줄들:
            sym, 가격, 거래량 = r.get("symbol"), r.get("price") or 0, r.get("volume") or 0
            if not sym or not 가격 or not 거래량:
                continue
            if sym not in 모음 or 거래량 > (모음[sym].get("volume") or 0):
                모음[sym] = r
    줄들 = [dict(r, amount=r["price"] * r["volume"]) for r in 모음.values()]
    줄들.sort(key=lambda r: r["amount"], reverse=True)
    return 줄들[:100]


async def _국내순위_만들기() -> bool:
    """네이버 시세표 네 페이지로 국내 순위 일곱 가지를 한꺼번에 만든다.

    거래대금·신고가·신저가는 따로 받는 페이지가 없어 네 페이지에서 만든다.
    예전에는 이 셋을 '누가 순위를 열 때' 지난 캐시에서 만들었고, 스케줄러는
    네 가지만 새로 받았다. 그래서 거래대금은 처음 한 번 만든 것이 그 뒤로
    **계속** 나갔다 — 15분이 지나 만료되면 KIS 를 거쳐(최대 6초) 다시 지난
    것을 꺼내 주었고, 그걸 새로 만들 길이 없었다."""
    분류들 = list(NAVER_SISE_PAGES)
    # 네 페이지를 한꺼번에 받는다(각 페이지는 코스피·코스닥 둘). 차례로 받으면
    # 네 배가 걸린다 — 순위를 처음 여는 사람은 그동안 기다린다
    받은것 = await asyncio.gather(*(fetch_naver_rank(c) for c in 분류들),
                                  return_exceptions=True)
    표 = {c: r for c, r in zip(분류들, 받은것) if isinstance(r, list) and r}
    if "시가총액" in 표:
        _시가총액_다시매기기(표["시가총액"])
    if "거래량" in 표:
        표["거래대금"] = _거래대금_순위(표)
    if "상승률" in 표:
        표["신고가"] = [r for r in 표["상승률"] if (r.get("change_rate") or 0) > 0]
    if "하락률" in 표:
        표["신저가"] = [r for r in 표["하락률"] if (r.get("change_rate") or 0) < 0]

    # 언제 받은 순위인가 — 화면이 'HH:MM 기준' 으로 보여 준다
    기준 = int(time.time())
    for 분류, 줄들 in 표.items():
        # 분류마다 새 dict 로 — 같은 종목 줄을 두 분류가 함께 쓰면 순위 번호를 서로 덮어쓴다
        담을것 = [dict(r, rank=i + 1, as_of=기준) for i, r in enumerate(줄들[:100])]
        cache.set(f"rank:kr:{분류}", 담을것, RANK_TTL)
    global _국내갱신_실패
    if 표:
        _국내갱신_실패 = 0.0
        log.info("국내 순위 갱신: %s", ", ".join(f"{k} {len(v)}" for k, v in 표.items()))
    else:
        _국내갱신_실패 = time.time()
        log.warning("국내 순위: 네이버 시세표를 하나도 못 받았다")
    return bool(표)


#: 지금 돌고 있는 국내 순위 갱신 (refresh_kr_rankings_from_naver 참고)
_국내갱신: "asyncio.Task | None" = None

#: 마지막으로 네이버에서 하나도 못 받은 시각. 막혀 있는 동안 순위를 여는
#: 사람마다 새로 받기를 기다리게(최대 6초) 하지 않으려고 둔다
_국내갱신_실패: float = 0.0
국내갱신_쉬는초 = 60


def 국내갱신_막힘() -> bool:
    """방금(국내갱신_쉬는초 안에) 네이버에서 하나도 못 받았는가."""
    return time.time() - _국내갱신_실패 < 국내갱신_쉬는초


async def refresh_kr_rankings_from_naver() -> bool:
    """국내 순위를 새로 만든다. 이미 만드는 중이면 그 결과를 같이 기다린다.

    스케줄러·시작 프리페치·순위를 여는 사람이 같은 순간에 부를 수 있다.
    따로 돌면 네이버에 같은 여덟 페이지를 겹쳐 묻는다. 기다리던 쪽이 시간
    상한으로 그만둬도(wait_for) 갱신 자체는 끝까지 돈다(shield)."""
    global _국내갱신
    loop = asyncio.get_running_loop()
    작업 = _국내갱신
    if 작업 is None or 작업.done() or 작업.get_loop() is not loop:
        작업 = _국내갱신 = loop.create_task(_국내순위_만들기())
    return await asyncio.shield(작업)


#: 정렬해 둔 미국 순위의 수명.
#:
#: 표가 바뀌면(미국표_다시쌓기·refresh_us_rows) 그 자리에서 일곱 가지를 다시
#: 만들어 담으므로, 이 수명은 그 길이 빠졌을 때를 위한 안전망이다. 예전에는
#: 15분이었고, 만료되면 지난 것을 **계속** 꺼내 줘서(get_stale) 미국장이
#: 열려 있는 동안 순위가 처음 만든 그대로 멈춰 있었다.
US_SORTED_TTL = 300


def _미국순위_모두_담기(rows: list[dict]) -> dict[str, list[dict]]:
    """표 하나로 일곱 가지 순위를 한꺼번에 만들어 담는다.

    표는 6천 줄이 넘는다. 분류마다 따로 만들면 표를 풀고(압축돼 담겨 있다)
    장을 가르는 일을 일곱 번 한다 — 해외 탭을 열면 다섯 탭을 한꺼번에 미리
    받으므로 0.15 CPU 에서 그게 겹친다. 한 번 풀고 한 번 가른다."""
    가격있는 = [r for r in rows if r.get("price")]
    한장 = _마지막_장만(가격있는)
    모두 = {}
    for c in ALLOWED_CATEGORIES:
        줄들 = (_sort_us(가격있는, c) if c == "시가총액"
               else _sort_us(한장, c, 장거름=False))
        if 줄들:
            cache.set(f"rank:us:{c}", 줄들, US_SORTED_TTL)
        모두[c] = 줄들
    if len(rows) >= US_SNAPSHOT_MIN_ROWS:
        _순위사진_남기기(모두)
    return 모두


def get_us_rankings(category: str = "시가총액") -> list[dict]:
    ck = f"rank:us:{category}"
    cached = cache.get(ck)
    if cached:
        return cached

    rows = _build_us_rows()
    if len(rows) >= US_MIN_ROWS:
        if result := _미국순위_모두_담기(rows).get(category):
            return result
    # 표가 얇으면(재시작 직후 등) 그걸로 새로 줄 세운 것보다 지난 순위가 낫다
    if stale := cache.get_stale(ck):
        return stale
    # 지난 순위도 없으면(재시작 직후) DB 에 남겨 둔 마지막 순위를 꺼낸다
    if 해외순위_사진_불러오기() and (깐것 := cache.get(ck)):
        return 깐것
    result = _sort_us(rows, category)
    if result:
        cache.set(ck, result, US_SORTED_TTL)
    return result


def 미국표_다시쌓기() -> int:
    """지금 캐시에 있는 미국 시세를 순위표에 쌓고, 정렬해 둔 순위를 비운다.

    미국장이 열려 있는 동안 인기·S&P500 은 5분마다 새로 받는데(refresh_us_stocks),
    그 값이 표에는 표가 만료될 때(15분)에야 들어갔다. 받는 쪽에서 바로 쌓는다."""
    rows = _표에_쌓기(_us_rows_from_cache())
    if len(rows) >= US_MIN_ROWS:
        cache.set(US_ROWS_CK, rows, US_ROWS_TTL)
        # 순위도 이 자리에서 다시 만든다 — 비워만 두면 다음에 여는 사람이
        # 표를 다시 풀어 만드는 동안 기다린다
        _미국순위_모두_담기(rows)
    return len(rows)
