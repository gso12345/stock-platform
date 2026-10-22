"""시장마다 스크리닝 표를 들고 있다가, 묵으면 뒤에서 새로 만든다. 원천도 차례로 새로 받는다.

요청이 오면 들고 있는 표로 곧바로 답한다. 표가 묵었거나(표_수명) 종목별 야후 줄·원천이 새로 왔으면
뒤에서 새로 만든다 — 7천 줄을 합치는 데 0.15 CPU 로 몇 초라 사람을 붙잡지 않는다. 표가 아예 없을 때만
(서버가 막 뜬 뒤 첫 요청) 그 자리에서 만든다.

원천은 아무도 스크리닝을 안 열면 받지 않는다. 열면 묵은 것부터 하나씩 — 한 번에 하나, 낮은 우선순위로,
메모리가 빠듯하면 건너뛴다. 받은 것은 DB 에 남겨 서버가 깨도 곧바로 쓴다(store).

기초 줄 — 바깥에 새로 묻지 않는다. 이미 받아 둔 것을 읽는다:
  국내  종목 목록(KRX — 한글 이름·주식 수)과 시세로 순위 서비스가 만든 전 종목 줄(_build_all_kr_rows)
  미국  순위 서비스의 미국 전 종목 표(나스닥 목록 + 야후 시세) 중 주식만, 업종·산업·국가는 나스닥 분류,
        이름은 한글(네이버 해외 이름 → 코드에 적어 둔 주요 종목) → 영문
"""
from __future__ import annotations

import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from app.core.cache import cache
from app.core.cpu import 낮은_우선순위
from app.services.screening import sources, store
from app.services.screening.table import 만들기, 스크리닝표, 원천표

log = logging.getLogger(__name__)

#: 이보다 오래된 표는 뒤에서 새로 만든다(그동안은 있던 표로 답한다). 기초 줄 없이 만든 표는 더 일찍 —
#: 서버가 막 떠 종목 목록을 아직 못 읽었을 때 만든 표면, 읽는 대로 전 종목 표로 바꿔야 한다
표_수명 = int(os.getenv("SCREEN_TABLE_TTL_SEC", 300))
기초없는표_수명 = 30
#: 국내 지표(네이버)는 종목마다 묻는다 — 이만큼씩, 이 간격으로, 받은 지 이만큼 지난 것부터. KRX 가 로그인을
#: 요구해 막힌 뒤로 국내 PER·PBR·EPS·배당·52주는 주로 여기서 오니, 전 종목(2천7백여 곳)이 한 시간 남짓에 찬다
네이버_한번 = int(os.getenv("SCREEN_NAVER_PER_RUN", 120))
네이버_간격 = int(os.getenv("SCREEN_NAVER_EVERY_SEC", 180))
네이버_수명 = 20 * 3600
#: 1년 시세(야후 spark — 52주 고저·수익률·RSI)는 주요 종목(야후 줄) 밖의 종목만, 시장마다 한 번에 이만큼씩
시세_한번 = int(os.getenv("SCREEN_PX_PER_RUN", 300))
시세_간격 = int(os.getenv("SCREEN_PX_EVERY_SEC", 600))
시세_수명 = 20 * 3600
#: 돌아가며 받은 것을 DB 에 남기는 때 — 새로 받은 것이 이만큼 쌓였거나 이만큼 지났으면
_남길수, _남길때 = 400, 3600

#: 원천 → (DB 열쇠, 새로 받는 간격, 못 받았을 때 다시 묻기까지, 시장)
원천들 = {
    "kr_krx": ("KR_KRX", 12 * 3600, 3600, "KR"),
    "kr_git": ("KR_GIT", 12 * 3600, 3600, "KR"),
    "kr_naver": ("KR_NAVER", 0, 네이버_간격, "KR"),
    "kr_px": ("KR_PX", 0, 시세_간격, "KR"),
    "kr_dart": ("KR_DART", 7 * 86400, 6 * 3600, "KR"),
    "us_sec": ("US_SEC", 7 * 86400, 6 * 3600, "US"),
    "us_ko": ("US_KO", 7 * 86400, 12 * 3600, "US"),
    "us_px": ("US_PX", 0, 시세_간격, "US"),
}
#: 종목마다 조금씩 돌아가며 받는 원천 — 칸 → (시장, 한 번에 몇 곳, 받은 지 이만큼 지난 것부터 다시)
돌아가며 = {"kr_naver": ("KR", "네이버_한번", "네이버_수명"), "kr_px": ("KR", "시세_한번", "시세_수명"),
           "us_px": ("US", "시세_한번", "시세_수명")}
#: 1년 시세 원천 — 종목별 야후 줄이 이미 RSI 를 주는 주요 종목은 건너뛴다(그 줄이 52주 고저·수익률도 준다)
_시세원천 = ("kr_px", "us_px")
#: KRX 가 로그인을 요구하는데 회원 아이디(KRX_ID)가 없으면 다시 물어도 같다 — 이만큼 쉰다
KRX_로그인_쉼 = 12 * 3600
#: 검사에서는 바깥 원천을 받지 않는다(conftest 가 끈다)
원천_받기 = True
#: 표의 종목으로 묻는 원천 — 표가 생기기 전에 맡기면 빈손으로 끝나 쉼(3분·6시간)에 걸린다
_표가_필요 = frozenset({"kr_naver", "kr_px", "kr_dart", "us_px"})

_표: dict[str, 스크리닝표] = {}
_표판: dict[str, tuple] = {}
_짓기잠금: dict[str, threading.Lock] = {}
_새로만드는중: set[str] = set()
_상태잠금 = threading.Lock()

#: 원천 → 메모리에 든 값(표는 DataFrame, 한글 이름은 dict)
_원천: dict[str, object] = {}
_원천때: dict[str, float] = {}
_시도때: dict[str, float] = {}
_도는일: set[str] = set()
_원천판 = [0]
_원천_읽음 = [False]
#: 돌아가며 받는 원천마다 [남긴 뒤 새로 받은 수, 마지막으로 남긴 때]
_쌓임: dict[str, list] = {}

_원천일꾼 = ThreadPoolExecutor(max_workers=1, thread_name_prefix="screen-src", initializer=낮은_우선순위)
_표일꾼 = ThreadPoolExecutor(max_workers=1, thread_name_prefix="screen-table", initializer=낮은_우선순위)


def 비우기() -> None:
    """들고 있는 표와 원천을 버린다(검사용)"""
    with _상태잠금:
        _표.clear()
        _표판.clear()
        _원천.clear()
        _원천때.clear()
        _시도때.clear()
        _원천_읽음[0] = False
        _쌓임.clear()


# ── 기초 줄 ────────────────────────────────────────────────
def _국내기초() -> list[dict]:
    from app.services.market.ranking_service import _build_all_kr_rows
    out = []
    for r in _build_all_kr_rows():
        code = str(r.get("symbol") or "").split(".")[0]
        if not code or not r.get("price"):
            continue
        out.append({"symbol": code, "name": r.get("name") or code, "market": "KR",
                    "exchange": r.get("market") or None, "price": r.get("price"),
                    "change_rate": r.get("change_rate"), "volume": r.get("volume"),
                    "market_cap": r.get("market_cap") or None, "currency": "KRW", "country": "대한민국"})
    return out


def 한글이름(sym: str) -> str | None:
    """미국 종목의 한글 이름 — 네이버 해외 이름 → 코드에 적어 둔 주요 종목(KO_NAME_MAP)"""
    from app.services.listings.ticker_service import KO_NAME_MAP
    이름 = (_원천.get("us_ko") or {}).get(sym)
    if 이름:
        return 이름
    별칭 = KO_NAME_MAP.get(sym)
    return 별칭[0] if 별칭 else None


def _미국기초() -> list[dict]:
    from app.services.listings.ticker_service import get_us_db
    from app.services.market.ranking_service import US_ROWS_CK, 나스닥_분류
    표 = cache.get(US_ROWS_CK) or cache.get_stale(US_ROWS_CK) or []
    목록 = {t["s"]: t for t in get_us_db() if t.get("s")}
    분류 = 나스닥_분류()
    out = []
    for r in 표:
        sym = r.get("symbol")
        if not sym or not r.get("price") or r.get("_demo"):
            continue
        t = 목록.get(sym)
        if t is not None and t.get("m") == "ETF":
            continue                        # 주식만 — ETF 는 ETF 탭
        if t is None and sym not in 분류:
            continue                        # 목록에도 나스닥 주식 목록에도 없다(지수·환율 등)
        업종, 산업, 나라 = 분류.get(sym, ("", "", ""))
        영문 = r.get("name") if r.get("name") not in (None, "", sym) else (t or {}).get("n")
        out.append({"symbol": sym, "name": 한글이름(sym) or 영문 or sym, "name_en": 영문, "market": "US",
                    "exchange": (t or {}).get("x"), "price": r.get("price"),
                    "change_rate": r.get("change_rate"), "volume": r.get("volume"),
                    "market_cap": r.get("market_cap") or None, "currency": "USD",
                    "sector": 업종 or None, "industry": 산업 or None, "country": 나라 or None})
    return out


def 기초줄(시장: str) -> list[dict]:
    """그 시장의 전 종목 기초 줄(시세·시가총액·이름). 못 만들면 빈 것 — 그래도 종목별 야후 줄로는 나온다"""
    try:
        if 시장 == "KR":
            return _국내기초()
        if 시장 == "US":
            return _미국기초()
    except Exception as e:
        log.warning("스크리닝 %s 기초 줄 실패: %s", 시장, type(e).__name__)
    return []


# ── 원천 ────────────────────────────────────────────────────
def _넣기(칸: str, 값: dict, 때: float) -> None:
    줄들 = 값.get("rows") or {}
    if 칸 == "us_ko":
        _원천[칸] = dict(줄들)
    else:
        if 칸 in 돌아가며:
            _원천[f"{칸}_rows"] = dict(줄들)
        _원천[칸] = 원천표(칸, 줄들)
    _원천때[칸] = 때
    _원천판[0] += 1


def _원천_불러오기() -> None:
    """서버가 뜬 뒤 처음 한 번 — DB 에 남겨 둔 원천을 메모리로"""
    if _원천_읽음[0]:
        return
    with _상태잠금:
        if _원천_읽음[0]:
            return
        _원천_읽음[0] = True
        for 칸, (열쇠, *_나머지) in 원천들.items():
            값, 때 = store.읽기(열쇠)
            if 값:
                _넣기(칸, 값, float(값.get("at") or 때))


def _원천_모음() -> dict:
    return {k: _원천.get(k) for k in ("kr_krx", "kr_git", "kr_naver", "kr_px", "kr_dart", "us_sec", "us_px")}


def _돌아가며_받기(칸: str) -> dict | None:
    """표에서 시가총액 큰 것부터, 받은 지 오래된 것 몇 곳씩. 1년 시세는 주요 종목(_시세원천)을 건너뛰고, 국내는
    야후에 있는 코스피·코스닥만(코넥스는 없다)"""
    시장, 한번, 수명 = 돌아가며[칸]
    한번, 수명 = globals()[한번], globals()[수명]
    표 = _표.get(시장)
    if 표 is None or not len(표):
        return None
    있던 = dict(_원천.get(f"{칸}_rows") or {})
    지금 = time.time()
    야후있음 = set()
    if 칸 in _시세원천 and "rsi" in 표.df.columns:
        야후있음 = {s for s, v in zip(표.df.index, 표.df["rsi"]) if s not in 있던 and v == v}
    # 국내 1년 시세는 야후 종목(005930.KS·247540.KQ)으로 묻는다 — 거래소를 모르는 종목·코넥스는 야후에 없다
    거래소 = (표.df["exchange"].to_dict() if "exchange" in 표.df.columns else {}) if 칸 == "kr_px" else None
    고를 = [c for c in 표.df.index
            if c not in 야후있음 and (거래소 is None or 거래소.get(c) in sources.야후꼬리)
            and 지금 - float((있던.get(c) or {}).get("at") or 0) > 수명][:한번]
    if not 고를:
        return None
    받음 = (sources.국내_네이버(고를) if 칸 == "kr_naver" else
           sources.국내_시세흐름({c: 거래소[c] for c in 고를}) if 칸 == "kr_px" else sources.미국_시세흐름(고를))
    if not 받음:
        return None
    # 물었는데 안 온 종목도 받은 때를 남긴다(있던 값은 둔다) — 안 남기면 그 종목은 늘 '오래된 것' 이라 차례마다
    # 맨 앞에 다시 뽑힌다. 그런 종목(네이버·야후가 모르는 종목)이 한 번에 묻는 수만큼 쌓이면 돌아가며 받기가 멈춘다
    for c in 고를:
        if c not in 받음:
            있던[c] = {**(있던.get(c) or {}), "at": 지금}
    있던.update(받음)
    _쌓임.setdefault(칸, [0, 0.0])[0] += len(받음)
    return {"at": 지금, "rows": 있던}


def _받기(칸: str) -> dict | None:
    if 칸 == "kr_krx":
        return sources.국내_KRX()
    if 칸 == "kr_git":
        return sources.국내_GitHub()
    if 칸 in 돌아가며:
        return _돌아가며_받기(칸)
    if 칸 == "kr_dart":
        표 = _표.get("KR")
        return sources.국내_DART(list(표.df.index)) if 표 is not None else None
    if 칸 == "us_sec":
        return sources.미국_SEC()
    if 칸 == "us_ko":
        return sources.미국_한글이름()
    return None


def _남기기(칸: str, 값: dict) -> None:
    """돌아가며 받는 원천은 조금씩 쌓이니 가끔만 남긴다 — 받을 때마다 수천 곳을 통째로 DB 에 쓰지 않게"""
    열쇠 = 원천들[칸][0]
    if 칸 in 돌아가며:
        지금 = time.time()
        쌓임 = _쌓임.setdefault(칸, [0, 0.0])
        if 쌓임[0] < _남길수 and 지금 - 쌓임[1] < _남길때:
            return
        쌓임[:] = [0, 지금]
    store.남기기(열쇠, 값)


def _일_맡기기(칸: str) -> None:
    with _상태잠금:
        if 칸 in _도는일:
            return
        _도는일.add(칸)
        _시도때[칸] = time.time()

    def 일():
        try:
            from app.core import memory
            if not memory.has_headroom(f"스크리닝 원천({칸})"):
                return
            값 = _받기(칸)
            if 값:
                _넣기(칸, 값, float(값.get("at") or time.time()))
                _남기기(칸, 값)
        except Exception as e:
            log.warning("스크리닝 원천 %s 실패: %s", 칸, type(e).__name__)
        finally:
            _도는일.discard(칸)

    try:
        _원천일꾼.submit(일)
    except Exception:
        _도는일.discard(칸)


def _원천_챙기기(시장: str) -> None:
    """그 시장의 원천 중 묵은 것을 뒤에서 새로 받게 맡긴다(한 번에 하나씩 차례로)"""
    if not 원천_받기:
        return
    from app.core.config import settings
    지금 = time.time()
    for 칸, (_열쇠, 간격, 쉼, 그시장) in 원천들.items():
        if 그시장 != 시장 or (칸 == "kr_dart" and not settings.DART_API_KEY):
            continue
        if 칸 in _표가_필요 and _표.get(그시장) is None:
            continue
        if 칸 == "kr_krx" and sources.KRX_로그인막힘[0] and not settings.KRX_ID:
            쉼 = max(쉼, KRX_로그인_쉼)
        if 지금 - _원천때.get(칸, 0.0) < 간격 or 지금 - _시도때.get(칸, 0.0) < 쉼:
            continue
        _일_맡기기(칸)


# ── 표 ──────────────────────────────────────────────────────
def _잠금(시장: str) -> threading.Lock:
    with _상태잠금:
        return _짓기잠금.setdefault(시장, threading.Lock())


def _풍부(시장: str) -> tuple[list, tuple]:
    from app.services.market.yf_service import yf_service
    풍부 = yf_service.스크리닝_전체(시장)
    return 풍부, (yf_service.스크리닝_찍은때(시장), len(풍부), _원천판[0])


def _짓기(시장: str, 풍부: list, 판: tuple) -> 스크리닝표:
    새것 = 만들기(시장, 기초줄(시장), 풍부, _원천_모음())
    _표[시장], _표판[시장] = 새것, 판
    return 새것


def _뒤에서_새로(시장: str) -> None:
    with _상태잠금:
        if 시장 in _새로만드는중:
            return
        _새로만드는중.add(시장)

    def 일():
        try:
            풍부, 판 = _풍부(시장)
            with _잠금(시장):
                _짓기(시장, 풍부, 판)
        except Exception as e:
            log.warning("스크리닝 %s 표 새로 만들기 실패: %s", 시장, type(e).__name__)
        finally:
            _새로만드는중.discard(시장)

    try:
        _표일꾼.submit(일)
    except Exception:
        _새로만드는중.discard(시장)


def 표(시장: str) -> 스크리닝표:
    """그 시장의 표.

    · 있으면 그 표로 곧바로 답한다. 종목별 야후 줄이나 원천이 새로 왔거나(판이 바뀌었다) 오래됐으면
      (표_수명 — 기초 줄의 시세가 바뀐다) 뒤에서 새로 만든다 — 7천 줄을 합치는 데 0.15 CPU 로 몇 초다
    · 기초 줄 없이 야후 줄만으로 만든 표(ETF, 또는 종목 목록을 아직 못 읽었을 때)는 몇백 줄이라 판이
      바뀌면 그 자리에서 — 시장을 처음 받는 동안 받은 줄부터 곧바로 보여야 한다(화면이 3초마다 묻는다)
    · 없으면(서버가 막 뜬 뒤 첫 요청) 그 자리에서 만든다
    · 묵은 원천은 표를 꺼낸 뒤에 맡긴다 — 서버가 막 떠 표가 없을 때 먼저 맡기면 표의 종목으로 묻는
      원천(국내 예상 PER·재무)이 빈손으로 끝난다"""
    _원천_불러오기()
    try:
        return _표_꺼내기(시장)
    finally:
        _원천_챙기기(시장)


def 지금_표인가(시장: str, 표: 스크리닝표) -> bool:
    """이 표가 지금의 표이고 뒤에서 새로 만드는 중도 아닌가 — 아니면 이 표로 낸 답은 곧 낡는다(라우트가 안 남긴다)"""
    return _표.get(시장) is 표 and 시장 not in _새로만드는중


def 한종목(시장: str, 종목: str) -> dict | None:
    """그 종목의 표 한 줄(원천을 합친 값 + 전년 대비 성장률) — 퀀트가 비는 품질·성장 지표를 여기서 채운다.
    표가 아직 없으면 그 자리에서 만들지 않는다(퀀트 요청을 붙잡지 않게) — 뒤에서 만들게 맡기고 None"""
    if 시장 not in ("KR", "US", "ETF"):
        return None
    있음 = _표.get(시장)
    if 있음 is None:
        if 원천_받기:
            _뒤에서_새로(시장)
        return None
    return 있음.한줄(종목.split(".")[0] if 시장 == "KR" else 종목)


def _표_꺼내기(시장: str) -> 스크리닝표:
    풍부, 판 = _풍부(시장)
    있음 = _표.get(시장)
    if 있음 is not None and (있음.기초수 or _표판.get(시장) == 판):
        수명 = 표_수명 if 있음.기초수 else min(표_수명, 기초없는표_수명)
        if _표판.get(시장) != 판 or time.time() - 있음.만든때 > 수명:
            _뒤에서_새로(시장)
        return 있음
    with _잠금(시장):
        if (있음 := _표.get(시장)) is not None and (있음.기초수 or _표판.get(시장) == 판):
            return 있음
        return _짓기(시장, 풍부, 판)
