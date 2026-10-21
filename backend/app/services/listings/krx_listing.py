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
from app.core.http import SSL

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
    with httpx.Client(follow_redirects=True, verify=SSL) as client:
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


# ── 스크리닝용 일괄 — 전 종목의 지표·업종·기간 수익률을 한 번에 ─────────────────
#
# 스크리닝은 종목마다 야후 상세(info)를 받아 PER·배당·업종을 채웠는데, 운영 서버에서는 야후
# 상세가 막혀 가격만 남았다(사용자: "PER ... 배당 수익률 ... 안나와"). KRX 는 전 종목의 값을
# 요청 한 번에 준다 — 위의 목록·시세(MDCSTAT01501)와 같은 주소·같은 머리글이다.
# 요청 이름(bld)과 받는 칸 이름은 pykrx(1.0.45)의 KRX 요청 정의(website/krx/market/core.py)와 같다.
_BLD_지표 = "dbms/MDC/STAT/standard/MDCSTAT03501"     # [12021] PER/PBR/배당수익률 — 전종목
_BLD_업종 = "dbms/MDC/STAT/standard/MDCSTAT03901"     # 업종분류현황 — 시장별(STK·KSQ)
_BLD_등락 = "dbms/MDC/STAT/standard/MDCSTAT01602"     # [12002] 전종목 등락률 — 기간


def _값(v) -> float | None:
    """KRX 숫자 칸 → 수. '-'·빈칸은 **모름**이다 — _num 처럼 0 으로 두면 적자 회사(PER '-')가
    'PER 0' 이 되어 PER 낮은 순 맨 앞에 깔린다."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).replace(",", "").strip()
    if not s or s == "-":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _코드(v) -> str | None:
    """종목코드 → 6자리(우선주처럼 영문이 섞인 것도 — _row 참고). 쓸 수 없으면 None"""
    raw = str(v or "").strip().upper()
    if not raw or not raw.isalnum() or len(raw) > 6:
        return None
    return raw.zfill(6)


def _묻기(client: httpx.Client, bld: str, **params) -> dict:
    r = client.post(_LIVE_URL, headers=_HEADERS, timeout=_TIMEOUT, data={"bld": bld, **params})
    r.raise_for_status()
    return json.loads(r.text)


def fetch_valuation(client: httpx.Client, ymd: str) -> dict[str, dict]:
    """전 종목 EPS·PER·BPS·PBR·주당배당(DPS)·배당수익률 → {6자리 코드: {...}}"""
    j = _묻기(client, _BLD_지표, mktId="ALL", trdDd=ymd)
    out: dict[str, dict] = {}
    for it in j.get("output") or j.get("OutBlock_1") or []:
        code = _코드(it.get("ISU_SRT_CD"))
        if code:
            out[code] = {"eps": _값(it.get("EPS")), "per": _값(it.get("PER")),
                         "bps": _값(it.get("BPS")), "pbr": _값(it.get("PBR")),
                         "dps": _값(it.get("DPS")), "dividend_yield": _값(it.get("DVD_YLD"))}
    return out


def fetch_sectors(client: httpx.Client, ymd: str) -> dict[str, str]:
    """전 종목 업종(한글, 예: '전기전자') → {6자리 코드: 업종}. 코넥스는 KRX 가 업종을 안 준다"""
    out: dict[str, str] = {}
    for 시장 in ("STK", "KSQ"):
        j = _묻기(client, _BLD_업종, mktId=시장, trdDd=ymd)
        for it in j.get("block1") or j.get("OutBlock_1") or []:
            code, 업종 = _코드(it.get("ISU_SRT_CD")), str(it.get("IDX_IND_NM") or "").strip()
            if code and 업종:
                out[code] = 업종
    return out


def fetch_returns(client: httpx.Client, 시작: str, 끝: str) -> dict[str, float]:
    """전 종목의 시작일 → 끝일 등락률(%, 수정주가) → {6자리 코드: 등락률}"""
    j = _묻기(client, _BLD_등락, mktId="ALL", adjStkPrc=2, strtDd=시작, endDd=끝)
    out: dict[str, float] = {}
    for it in j.get("OutBlock_1") or j.get("output") or []:
        code, 등락 = _코드(it.get("ISU_SRT_CD")), _값(it.get("FLUC_RT"))
        if code and 등락 is not None:
            out[code] = 등락
    return out


def _달전(ymd: str, 달: int) -> date:
    """YYYYMMDD 에서 `달` 개월 전 같은 날(그 달에 없는 날이면 그 달 마지막 날)"""
    끝 = date(int(ymd[:4]), int(ymd[4:6]), int(ymd[6:]))
    해, 월 = divmod(끝.year * 12 + 끝.month - 1 - 달, 12)
    월 += 1
    for 일 in range(끝.day, 0, -1):
        try:
            return date(해, 월, 일)
        except ValueError:
            continue
    return date(해, 월, 1)


#: 기간 수익률의 시작일이 휴일이면 KRX 가 빈 표를 준다 — 이만큼 하루씩 앞당겨 다시 묻는다
_시작일_앞당김 = 5


def _장날들(끝: str, 달: int):
    """`달` 개월 전 그날부터 하루씩 앞당긴 평일들(YYYYMMDD) — 휴일이면 KRX 가 빈 표를 준다"""
    시작 = _달전(끝, 달)
    for i in range(_시작일_앞당김):
        d = 시작 - timedelta(days=i)
        if d.weekday() < 5:
            yield d.strftime("%Y%m%d")


def _기간등락(client: httpx.Client, 끝: str, 달: int) -> dict[str, float]:
    for ymd in _장날들(끝, 달):
        try:
            값들 = fetch_returns(client, ymd, 끝)
        except Exception as e:
            log.debug(f"KRX 기간 등락 {달}개월 {ymd} 실패: {type(e).__name__}: {e}")
            continue
        if len(값들) >= MIN_ROWS:
            return 값들
    return {}


#: EPS 흐름(스크리닝의 4년 막대) — 1·2·3년 전 같은 날의 지표. 그날의 EPS 는 그때의 직전 사업연도 것이다
_EPS_몇해전 = (3, 2, 1)


def 사업연도(ymd: str) -> int:
    """그날 KRX 지표의 EPS 가 어느 사업연도 것인가 — 사업보고서가 3월 말까지 나오므로 4월부터는 지난해"""
    해, 달 = int(ymd[:4]), int(ymd[4:6])
    return 해 - 1 if 달 >= 4 else 해 - 2


def _지난_EPS(client: httpx.Client, 끝: str, 몇해: int) -> tuple[dict[str, float], int]:
    """`몇해` 전 그날(휴일이면 앞당겨)의 전 종목 EPS → ({코드: EPS}, 그 사업연도). 못 받으면 ({}, 0)"""
    for ymd in _장날들(끝, 12 * 몇해):
        try:
            지표 = fetch_valuation(client, ymd)
        except Exception as e:
            log.debug(f"KRX 지난 지표 {ymd} 실패: {type(e).__name__}: {e}")
            continue
        if len(지표) >= MIN_ROWS:
            return {c: 줄["eps"] for c, 줄 in 지표.items() if 줄.get("eps") is not None}, 사업연도(ymd)
    return {}, 0


def fetch_screening_bulk() -> tuple[dict[str, dict], str]:
    """스크리닝 전 종목 칸 — 지표(PER·PBR·EPS·BPS·DPS·배당수익률)·업종·1/3/12개월 수익률·
    4년 EPS(eps_years·eps_hist — 오래된 해부터).

    반환: ({6자리 코드: {...}}, 기준일 YYYYMMDD). 지표를 못 받으면 ({}, "") — 업종·수익률·지난 EPS 는
    못 받아도 지표만으로 돌려준다(한 갈래가 막혔다고 전부 버리지 않는다)."""
    with httpx.Client(follow_redirects=True, verify=SSL) as client:
        지표: dict[str, dict] = {}
        기준일 = ""
        for ymd in _candidate_days(client):
            try:
                지표 = fetch_valuation(client, ymd)
            except Exception as e:
                log.debug(f"KRX 지표 {ymd} 실패: {type(e).__name__}: {e}")
                continue
            if len(지표) >= MIN_ROWS:
                기준일 = ymd
                break
        if not 기준일:
            log.warning("KRX 지표(PER·PBR·배당) 조회 실패")
            return {}, ""
        try:
            업종 = fetch_sectors(client, 기준일)
        except Exception as e:
            log.debug(f"KRX 업종 실패: {type(e).__name__}: {e}")
            업종 = {}
        수익률: dict[str, dict] = {}
        for 키, 달 in (("return_1m", 1), ("return_3m", 3), ("return_1y", 12)):
            for code, v in _기간등락(client, 기준일, 달).items():
                수익률.setdefault(code, {})[키] = v
        eps흐름: dict[str, dict[int, float]] = {}
        for 몇해 in _EPS_몇해전:
            지난, 그해 = _지난_EPS(client, 기준일, 몇해)
            for code, v in 지난.items():
                eps흐름.setdefault(code, {})[그해] = v
    올해 = 사업연도(기준일)
    out: dict[str, dict] = {}
    for code, 줄 in 지표.items():
        out[code] = {k: v for k, v in 줄.items() if v is not None}
        if code in 업종:
            out[code]["sector"] = 업종[code]
        out[code].update(수익률.get(code, {}))
        해마다 = dict(eps흐름.get(code, {}))
        if 줄.get("eps") is not None:
            해마다[올해] = 줄["eps"]
        if len(해마다) >= 2:
            out[code]["eps_years"] = sorted(해마다)
            out[code]["eps_hist"] = [해마다[y] for y in out[code]["eps_years"]]
    log.info(f"KRX 스크리닝 일괄({기준일}) — 지표 {len(지표)} · 업종 {len(업종)} · 수익률 {len(수익률)}"
             f" · 지난 EPS {len(eps흐름)}")
    return out, 기준일
