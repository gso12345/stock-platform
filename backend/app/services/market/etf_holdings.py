"""ETF 보유비중 — 구성종목을 어디서 받나.

사용자: "종목상세탭 ETF 보유비중 정보 안불러오는 종목이 있어"

예전 길이 막힌 곳
  · 국내 ETF — 한국거래소(KRX) 정보데이터시스템에 묻고 있었다. KRX 는 이제 로그인한 세션에만 자료를 준다
    (로그인 없이 물으면 'LOGOUT' — screening/sources 의 KRX_로그인막힘 과 같은 일). 그래서 국내 ETF 는
    '한국거래소에서 자료를 받지 못했습니다' 로 비었다.
  · 영문이 섞인 새 국내 코드(0193W0 따위) — 6자리 숫자가 바닥나 새로 상장하는 종목은 영문을 섞는다
    (krx_listing._row 주석: 0126Z0·00680K). 숫자만 국내로 봐서, 이런 ETF 는 국내 길로 가지도 못하고
    야후에 '0193W0' 으로 물었다.
  · 미국 ETF — 야후 funds_data 는 야후 '상세'(quoteSummary)다. 운영 서버에서는 그 상세가 막혀 있다
    (screening·fundamentals 주석). 그래서 미국 ETF 도 비기 쉬웠다.

새 길
  · 국내: 네이버 증권 m.stock.naver.com/api/stock/{코드}/etfAnalysis 의 etfTop10MajorConstituentAssets
    (구성 상위 10종목 — itemCode·itemName·etfWeight '9.34%'). 로그인이 필요 없고, 이 앱은 시세·실적을 이미
    네이버 모바일 API 로 받는다. 못 받으면 라우트가 KRX 를 한 번 더 본다.
  · 미국: 라우트가 야후와 네이버 해외 ETF 구성(stock.naver.com/api/stockSecurity/etfs/v2/foreign/{코드}/
    composition)을 함께 묻고, 야후가 주면 야후(섹터 비중까지 준다), 아니면 네이버를 쓴다.

네이버 해외 구성 응답의 칸 이름은 여기서 확인할 수 없었다(검사 환경은 바깥에 못 나간다 — naver_world 와 같은
사정). 그래서 'holdings' 목록을 찾아 이름·비중 칸을 넉넉한 후보 이름으로 읽되, 비중이 말이 안 되면(합이 100%
를 넘는다) 버린다 — 틀린 숫자를 보여 주느니 비운다. 못 읽으면 칸 이름을 로그에 남겨 다음에 고칠 수 있게 한다.
"""
from __future__ import annotations

import contextlib
import logging
import math
import re

import httpx

from app.core.http import SSL

log = logging.getLogger(__name__)

국내주소 = "https://m.stock.naver.com/api/stock/{코드}/etfAnalysis"
해외주소 = "https://stock.naver.com/api/stockSecurity/etfs/v2/foreign/{코드}/composition"
_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
_국내머리 = {"User-Agent": _UA, "Referer": "https://m.stock.naver.com/",
            "Accept": "application/json, text/plain, */*"}
_해외머리 = {"User-Agent": _UA, "Referer": "https://stock.naver.com/",
            "Accept": "application/json, text/plain, */*"}
#: 한 번 묻는 시한(초). 라우트의 _run 이 15초에서 자르므로, 해외 후보 두 번을 묻고도 그 안에 끝나게
시한 = 6

#: 국내 종목 코드 — 6자리, 숫자로 시작한다. 영문이 섞일 수 있다(0193W0·00680K). 미국 티커는 숫자로 시작하지 않는다
_국내꼴 = re.compile(r"^[0-9][0-9A-Z]{5}$")
#: 거래소 꼬리가 없는 미국 티커 — NVDA, BRK-B
_미국꼴 = re.compile(r"^[A-Z]{1,5}(-[A-Z])?$")


def 국내코드(symbol: str) -> str | None:
    """'069500' · '069500.KS' · '0193W0' → 6자리 국내 코드. 국내 꼴이 아니면 None"""
    s = (symbol or "").strip().upper()
    for 꼬리 in (".KS", ".KQ"):
        if s.endswith(꼬리):
            s = s[: -len(꼬리)]
            break
    return s if _국내꼴.match(s) else None


def 비중값(v) -> float | None:
    """'9.34%' · '9.34' · 9.34 → 9.34. 못 읽으면 None — None·True 도 글자로 바꾸면 숫자가 아니라 여기서 걸린다"""
    try:
        f = float(str(v).replace(",", "").replace("%", "").strip())
    except ValueError:
        return None
    return f if math.isfinite(f) else None


def _빈것(이유: str) -> dict:
    return {"holdings": [], "sector_weights": [], "reason": 이유}


@contextlib.contextmanager
def _클라이언트(client: httpx.Client | None):
    """넘겨받은 client 는 그대로 쓰고(시험), 없으면 새로 열고 닫는다"""
    if client is not None:
        yield client
        return
    with httpx.Client(follow_redirects=True, verify=SSL) as c:
        yield c


# ── 국내 — 네이버 etfAnalysis ─────────────────────────────────────

def 국내_구성_읽기(j, 자기코드: str = "") -> list[dict]:
    """etfAnalysis 응답 → 구성종목(비중 큰 순). 비중이 0 이하인 것(공매도·빈 칸)과 ETF 자신은 뺀다"""
    목록 = j.get("etfTop10MajorConstituentAssets") if isinstance(j, dict) else None
    rows: list[dict] = []
    for it in 목록 if isinstance(목록, list) else []:
        if not isinstance(it, dict):
            continue
        코드 = str(it.get("itemCode") or "").strip().upper()
        이름 = str(it.get("itemName") or "").strip()
        비중 = 비중값(it.get("etfWeight"))
        if 비중 is None or 비중 <= 0 or not (이름 or 코드) or (코드 and 코드 == 자기코드):
            continue
        rows.append({"symbol": 코드, "name": 이름 or 코드, "pct": 비중, "value": 0.0})
    rows.sort(key=lambda r: r["pct"], reverse=True)
    return rows


def 네이버_국내(코드: str, client: httpx.Client | None = None) -> dict:
    """국내 ETF 구성 상위 10종목 → {"holdings", "sector_weights", "source" | "reason"}"""
    try:
        with _클라이언트(client) as c:
            r = c.get(국내주소.format(코드=코드), headers=_국내머리, timeout=시한)
            r.raise_for_status()
            rows = 국내_구성_읽기(r.json(), 코드)
    except Exception as e:
        # 예외 이름은 로그에만 — 화면에는 사람이 읽는 한 문장만 간다
        log.warning("네이버 국내 ETF 구성 실패 %s: %s", 코드, type(e).__name__)
        return _빈것("네이버 증권에서 구성종목을 받지 못했습니다")
    if not rows:
        log.info("네이버 국내 ETF 구성 없음 %s", 코드)
        return _빈것("네이버 증권에 공개된 구성종목이 없습니다")
    log.info("네이버 국내 ETF 구성 %s: %d개", 코드, len(rows))
    return {"holdings": rows, "sector_weights": [], "source": "네이버 증권"}


# ── 해외 — 네이버 해외 ETF 구성 ───────────────────────────────────

_이름칸 = ("stockName", "korName", "koreanName", "nameKor", "itemName", "name", "holdingName",
          "securityName", "stockNameEng", "engName", "nameEng", "englishName")
_코드칸 = ("symbolCode", "ticker", "symbol", "reutersCode", "itemCode", "stockCode", "code")
_비중칸 = ("weight", "etfWeight", "holdingWeight", "weightRatio", "holdingRatio", "ratio",
          "assetRatio", "holdingPercent", "percent", "pct", "proportion")
#: 이름에 'weight' 가 들어도 비중이 아닌 칸 — 등락률·가격 따위
_비중아님 = re.compile(r"fluctuat|change|return|price|rate", re.I)


def _첫글(it: dict, 칸들) -> str:
    for k in 칸들:
        v = it.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


def _비중(it: dict) -> float | None:
    for k in _비중칸:
        if k in it and (v := 비중값(it[k])) is not None:
            return v
    for k, v in it.items():
        if "weight" in k.lower() and not _비중아님.search(k) and (f := 비중값(v)) is not None:
            return f
    return None


def _dict목록(x) -> bool:
    return isinstance(x, list) and bool(x) and all(isinstance(v, dict) for v in x)


def _구성목록(j) -> list[dict]:
    """응답에서 구성종목 목록을 찾는다. 'holdings' 라는 이름 아래를 먼저 본다(바로 목록이거나 그 안의 첫 목록).
    없으면 이름·비중 칸을 함께 가진 첫 목록 — 단 'exposure' 아래(섹터·국가 비중)는 보지 않는다"""
    할일 = [j]
    while 할일:
        x = 할일.pop(0)
        if isinstance(x, dict):
            안 = x.get("holdings")
            if _dict목록(안):
                return 안
            if isinstance(안, dict):
                for v in 안.values():
                    if _dict목록(v):
                        return v
            할일.extend(v for v in x.values() if isinstance(v, (dict, list)))
        elif isinstance(x, list):
            할일.extend(v for v in x if isinstance(v, (dict, list)))
    할일 = [j]
    while 할일:
        x = 할일.pop(0)
        if _dict목록(x) and any(_첫글(v, _이름칸) and _비중(v) is not None for v in x):
            return x
        if isinstance(x, dict):
            할일.extend(v for k, v in x.items()
                       if isinstance(v, (dict, list)) and "exposure" not in str(k).lower())
        elif isinstance(x, list):
            할일.extend(v for v in x if isinstance(v, (dict, list)))
    return []


def 해외_구성_읽기(j) -> list[dict]:
    """해외 ETF 구성 응답 → 구성종목(비중 큰 순, % 단위). 비중을 믿을 수 없으면 빈 목록"""
    목록 = _구성목록(j)
    rows: list[dict] = []
    for it in 목록:
        이름 = _첫글(it, _이름칸)
        코드 = _첫글(it, _코드칸).upper()
        비중 = _비중(it)
        if 비중 is None or 비중 <= 0 or not (이름 or 코드):
            continue
        rows.append({"symbol": 코드, "name": 이름 or 코드, "pct": 비중, "value": 0.0})
    if not rows:
        if 목록:
            log.warning("네이버 해외 ETF 구성 — 못 읽음, 칸: %s", sorted(목록[0])[:20])
        return []
    합 = sum(r["pct"] for r in rows)
    if 합 <= 1.0001:          # 0~1 비율로 왔다
        for r in rows:
            r["pct"] *= 100
        합 *= 100
    if 합 > 100.5:
        log.warning("네이버 해외 ETF 구성 — 비중 합 %.1f%% 라 버린다(칸: %s)", 합, sorted(목록[0])[:20])
        return []
    rows.sort(key=lambda r: r["pct"], reverse=True)
    return rows[:25]


def 해외코드후보(symbol: str, 거래소: str = "") -> list[str]:
    """야후 꼴 티커 → 네이버 해외 코드 후보. 나스닥 상장은 '.O' 가 붙고(QQQ.O, NVDA.O), 뉴욕·아카 상장은
    안 붙는다(VOO). 거래소를 모르면 둘 다 — 붙지 않은 것부터"""
    s = (symbol or "").strip().upper().replace("-", ".")
    if not s:
        return []
    return [f"{s}.O", s] if (거래소 or "").upper() == "NASDAQ" else [s, f"{s}.O"]


def _거래소(symbol: str) -> str:
    try:
        from app.services.listings import ticker_service as ts
        s = symbol.strip().upper()
        return next((str(r.get("x") or "") for r in ts.get_us_db() if str(r.get("s") or "").upper() == s), "")
    except Exception:
        return ""


def 네이버_해외(symbol: str, client: httpx.Client | None = None) -> dict:
    """미국 ETF 구성 → {"holdings", "sector_weights", "source" | "reason"}"""
    try:
        with _클라이언트(client) as c:
            for 코드 in 해외코드후보(symbol, _거래소(symbol)):
                try:
                    r = c.get(해외주소.format(코드=코드), headers=_해외머리, timeout=시한)
                    if r.status_code != 200:
                        continue
                    rows = 해외_구성_읽기(r.json())
                except Exception as e:
                    log.warning("네이버 해외 ETF 구성 실패 %s: %s", 코드, type(e).__name__)
                    continue
                if rows:
                    log.info("네이버 해외 ETF 구성 %s: %d개", 코드, len(rows))
                    return {"holdings": rows, "sector_weights": [], "source": "네이버 증권"}
    except Exception as e:
        log.warning("네이버 해외 ETF 구성 실패 %s: %s", symbol, type(e).__name__)
    return _빈것("구성종목을 받지 못했습니다")


# ── 눌러서 갈 곳 ───────────────────────────────────────────────

def _아는종목() -> tuple[set[str], set[str]]:
    """이미 읽어 둔 종목 DB 의 (국내 6자리 코드, 미국 티커). 여기서 새로 받지 않는다 —
    get_kr_db() 는 비어 있으면 바깥에서 받아 오므로 쓰지 않는다"""
    try:
        from app.services.listings import ticker_service as ts
        국내 = {str(r.get("c") or "").upper() for r in (ts._kr_db or ts.KR_TICKERS_BUILTIN)}
        미국 = {str(r.get("s") or "").upper() for r in ts.get_us_db() if r.get("m") in ("US", "ETF")}
        return 국내 - {""}, 미국 - {""}
    except Exception:
        return set(), set()


#: 종목 DB 가 이만큼은 돼야 '다 읽었다' 고 본다(내장 목록은 국내 115곳·미국 128곳뿐이다)
국내DB최소 = 1000
미국DB최소 = 1000


def 잇기(rows: list[dict], 아는것: tuple[set[str], set[str]] | None = None) -> list[dict]:
    """구성종목마다 눌러서 갈 곳(market·symbol)을 단다.

    화면은 예전에 ETF 의 시장으로 구성종목 시장을 짐작했다(국내 ETF → 국내). 그런데 국내 ETF 도 미국 주식을
    담는다(TIGER 미국S&P500) — 그대로 두면 /stocks/KR/NVDA 같은 없는 화면이 열린다. 그래서
      · 국내 코드 꼴이고 우리 국내 종목 DB 에 있으면 국내 — 꼴만 보면 중국 본토 코드(600519)도 국내가 된다.
        국내 DB 를 아직 못 읽었으면(내장 목록뿐) 꼴만 믿는다 — 그때 DB 로 가리면 삼성전자 말고는 다 못 누른다
      · 우리 미국 DB 에 있으면 미국 — 거래소 꼬리가 붙은 코드(NVDA.O)는 떼어 보고, BRK.B 는 BRK-B 로도 본다.
        미국 DB 를 아직 못 읽었으면(내장 목록뿐) 꼬리 없는 티커 꼴만 믿는다
      · 그 밖(현금·외국 거래소·ISIN)은 누를 수 없게 비운다"""
    국내, 미국 = 아는것 if 아는것 is not None else _아는종목()
    국내를다앎, 미국을다앎 = len(국내) >= 국내DB최소, len(미국) >= 미국DB최소
    for r in rows:
        원래 = str(r.get("symbol") or "").strip().upper()
        sym, 시장 = "", None
        if (k := 국내코드(원래)) and (k in 국내 or not 국내를다앎):
            sym, 시장 = k, "KR"
        else:
            for 후보 in dict.fromkeys((원래, 원래.replace(".", "-"), 원래.split(".")[0])):
                if 후보 and (후보 in 미국 or (not 미국을다앎 and 후보 == 원래 and _미국꼴.match(후보))):
                    sym, 시장 = 후보, "US"
                    break
        r["symbol"], r["market"] = sym, 시장
    return rows
