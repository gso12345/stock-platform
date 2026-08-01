"""KRX 전 종목 목록·시세를 라이브러리 없이 직접 받아온다.

왜 직접 하는가
--------------
예전에는 FinanceDataReader 로 받았다. 그 자체는 잘 됐지만, 목록 한 번
받으려고 라이브러리를 import 하면 그때부터 프로세스가 죽을 때까지
메모리를 붙들고 있다. 파이썬은 한 번 올린 모듈을 내려놓지 못한다.
프로덕션 관리자 화면에 FinanceDataReader 73.8MB(딸린 것까지 119.8MB)로
찍혔고, 512MB 한도에서 그만한 값을 낼 일이 아니다.

FDR 코드를 열어보니 하는 일은 HTTP 요청 두 번이었다. 그래서 이미 쓰고 있는
httpx 와 표준 라이브러리로 같은 일을 한다. 추가 의존성은 0이고, 메모리도
0MB 다.

두 경로를 둔 이유
----------------
1순위 KRX 공식 API — 원본이다. 남의 저장소에 의존하지 않는다.
2순위 GitHub CSV — FDR 이 실제로 쓰던 경로(FinanceData/fdr_krx_data_cache).
      KRX 가 POST 를 막을 때를 대비한다.

둘 다 최근 영업일을 알아야 한다. KRX 가 알려주지 않으면 오늘부터 며칠
거슬러 올라가며 시도한다 — 주말·연휴에는 당일 데이터가 없다. 최악의 경우
(두 경로 × 날짜 후보 × 20초 타임아웃) 몇 분이 걸리지만, 시작 시 백그라운드
스레드에서 한 번만 도는 일이라 요청 처리를 막지 않는다.

이 함수는 예외를 밖으로 던지지 않는다. 실패하면 빈 목록을 돌려주고, 부르는
쪽(ticker_service)이 다음 폴백으로 넘어간다.
"""
from __future__ import annotations

import csv
import io
import json
import logging
from datetime import date, timedelta

import httpx

log = logging.getLogger(__name__)

# KRX 는 브라우저에서 온 요청만 받는다. FDR 이 쓰던 값과 같게 맞춘다
_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://data.krx.co.kr/contents/MDC/MDI/outerLoader/index.cmd",
}
_DATE_URL = ("http://data.krx.co.kr/comm/bldAttendant/executeForResourceBundle.cmd"
             "?baseName=krx.mdc.i18n.component&key=B128.bld")
_LIVE_URL = "https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd"
_CSV_URL = ("https://raw.githubusercontent.com/FinanceData/fdr_krx_data_cache"
            "/refs/heads/master/data/listing/krx/{ymd}.csv")

_TIMEOUT = 20.0
_MAX_DAYS_BACK = 7          # 연휴가 길어도 이 안에는 영업일이 있다


def _num(v) -> float:
    """KRX 는 숫자를 '1,234' 같은 문자열로 준다. 없으면 '-' 또는 빈 문자열."""
    if v is None:
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).replace(",", "").strip()
    if not s or s == "-":
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


def _row(code: str, name: str, market: str) -> dict | None:
    """종목 하나를 우리 형식으로. 쓸 수 없으면 None.

    두 가지를 실제 데이터로 확인해서 고쳤다.

    1) 앞의 0을 채우는 것과 빈 값을 거르는 것은 이 순서여야 한다. CSV·JSON 이
       코드를 숫자로 담으면 000660 이 660 으로 오므로 채워야 하는데, 빈 값을
       먼저 거르지 않으면 ''가 '000000' 이 되어 유령 종목이 생긴다.

    2) 종목코드는 숫자만이 아니다. 우선주·전환주·신주는 영문자가 섞인다 —
       00680K(미래에셋증권2우B), 02826K(삼성물산우B), 0126Z0(삼성에피스홀딩스),
       0009K0(에임드바이오). 처음에 숫자만 받도록 짰다가 실제 종목 79개를
       버렸다. 6자리 영숫자면 받는다."""
    raw = str(code or "").strip().upper()
    name = str(name or "").strip()
    market = str(market or "").strip() or "KOSPI"
    if not raw or not name or not raw.isalnum() or len(raw) > 6:
        return None
    code = raw.zfill(6)
    # 예전 동작을 그대로 유지한다 — KOSPI 만 .KS, 나머지(KOSDAQ·KONEX)는 .KQ
    suffix = ".KS" if market == "KOSPI" else ".KQ"
    return {"s": f"{code}{suffix}", "n": name, "x": market, "m": "KR", "c": code}


def _price(row: dict, close: float, **kw) -> dict:
    return {
        "symbol": row["s"], "name": row["n"], "price": close,
        "change": kw.get("change", 0.0),
        "change_rate": kw.get("change_rate", 0.0),
        "volume": int(kw.get("volume", 0)),
        "market_cap": int(kw.get("market_cap", 0)),
        # 상장주식수. 시가총액을 남의 숫자로 받아 오는 대신 직접 계산하려고
        # 함께 들고 온다 — 시총 = 현재가 × 상장주식수 다.
        # 주식수는 분할·증자 때만 바뀌므로 하루 한 번 받아도 충분하고,
        # 가격 쪽만 실시간으로 갈아 끼우면 시총도 저절로 최신이 된다.
        "shares": int(kw.get("shares", 0)),
        "currency": "KRW",
        "high": kw.get("high", 0.0),
        "low": kw.get("low", 0.0),
        "open": kw.get("open", 0.0),
    }


def latest_trading_day(client: httpx.Client) -> str | None:
    """KRX 가 알려주는 최근 영업일(YYYYMMDD). 못 받으면 None."""
    try:
        r = client.get(_DATE_URL, headers=_HEADERS, timeout=_TIMEOUT)
        r.raise_for_status()
        return json.loads(r.text)["result"]["output"][0]["max_work_dt"]
    except Exception as e:
        log.warning(f"KRX 영업일 조회 실패: {type(e).__name__}: {e}")
        return None


def _candidate_days(client: httpx.Client) -> list[str]:
    """시도할 날짜들. KRX 가 알려준 날을 맨 앞에 두고, 오늘부터 거슬러 올라간다."""
    days: list[str] = []
    krx_day = latest_trading_day(client)
    if krx_day:
        days.append(krx_day)
    today = date.today()
    for i in range(_MAX_DAYS_BACK):
        d = (today - timedelta(days=i)).strftime("%Y%m%d")
        if d not in days:
            days.append(d)
    return days


def fetch_live(client: httpx.Client, ymd: str) -> tuple[list[dict], dict]:
    """KRX 공식 API — 목록과 시세를 한 번에 받는다."""
    r = client.post(
        _LIVE_URL, headers=_HEADERS, timeout=_TIMEOUT,
        data={
            "bld": "dbms/MDC/STAT/standard/MDCSTAT01501",
            "mktId": "ALL",          # KOSPI+KOSDAQ+KONEX
            "trdDd": ymd,
            "share": "1", "money": "1", "csvxls_isNo": "false",
        },
    )
    r.raise_for_status()
    rows = json.loads(r.text).get("OutBlock_1") or []
    listing, prices = [], {}
    for it in rows:
        row = _row(it.get("ISU_SRT_CD"), it.get("ISU_ABBRV"), it.get("MKT_NM"))
        if row is None:
            continue
        listing.append(row)
        close = _num(it.get("TDD_CLSPRC"))
        if close > 0:
            prices[row["s"]] = _price(
                row, close,
                change=_num(it.get("CMPPREVDD_PRC")),
                change_rate=_num(it.get("FLUC_RT")),
                volume=_num(it.get("ACC_TRDVOL")),
                market_cap=_num(it.get("MKTCAP")),
                shares=_num(it.get("LIST_SHRS")),
                open=_num(it.get("TDD_OPNPRC")),
                high=_num(it.get("TDD_HGPRC")),
                low=_num(it.get("TDD_LWPRC")),
            )
    return listing, prices


def fetch_csv_cache(client: httpx.Client, ymd: str) -> tuple[list[dict], dict]:
    """FinanceData 가 GitHub 에 올려두는 일별 CSV — KRX 가 막힐 때의 우회로.

    컬럼 이름은 FDR 이 쓰던 것과 같다 (Code/Name/Market/Close/…)."""
    url = _CSV_URL.format(ymd=f"{ymd[:4]}-{ymd[4:6]}-{ymd[6:]}")
    r = client.get(url, timeout=_TIMEOUT)
    r.raise_for_status()
    listing, prices = [], {}
    for it in csv.DictReader(io.StringIO(r.text)):
        row = _row(it.get("Code"), it.get("Name"), it.get("Market"))
        if row is None:
            continue
        listing.append(row)
        close = _num(it.get("Close"))
        if close > 0:
            prices[row["s"]] = _price(
                row, close,
                change=_num(it.get("Changes")),
                change_rate=_num(it.get("ChagesRatio")),   # FDR 쪽 오타를 그대로 따른다
                volume=_num(it.get("Volume")),
                market_cap=_num(it.get("Marcap")),
                shares=_num(it.get("Stocks")),
                open=_num(it.get("Open")),
                high=_num(it.get("High")),
                low=_num(it.get("Low")),
            )
    return listing, prices


# 최소 이만큼은 나와야 '받아왔다'고 본다. KOSPI 만도 800개가 넘으므로,
# 이보다 적으면 응답이 잘렸거나 엉뚱한 것을 받은 것이다
MIN_ROWS = 500


def fetch_listing() -> tuple[list[dict], dict, str]:
    """국내 전 종목 목록과 시세. 반환: (목록, 시세맵, 출처).

    실패하면 목록이 빈 리스트다 — 부르는 쪽에서 다음 폴백으로 넘어간다."""
    경로 = (("KRX", fetch_live), ("CSV", fetch_csv_cache))
    with httpx.Client(follow_redirects=True) as client:
        days = _candidate_days(client)
        for 이름, fn in 경로:
            for ymd in days:
                try:
                    listing, prices = fn(client, ymd)
                except Exception as e:
                    log.debug(f"KRX 목록 {이름} {ymd} 실패: {type(e).__name__}: {e}")
                    continue
                if len(listing) >= MIN_ROWS:
                    출처 = f"KRX 직접({이름} {ymd})"
                    log.info(f"{출처} — 종목 {len(listing)}개, 시세 {len(prices)}개")
                    return listing, prices, 출처
                if listing:
                    log.warning(f"KRX 목록 {이름} {ymd}: {len(listing)}개뿐이라 버림")
    log.warning("KRX 직접 조회 실패 — 두 경로 모두 안 됨")
    return [], {}, ""
