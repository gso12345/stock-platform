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
import math
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from app.core.cache import cache
from app.core.cpu import 낮은_우선순위
from app.services.screening import sources, store
from app.services.screening.table import 국내_ADR, 만들기, 스크리닝표, 원천표

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
    "us_fx": ("US_FX", 12 * 3600, 3600, "US"),
    "us_px": ("US_PX", 0, 시세_간격, "US"),
}
#: 받는 법이 바뀌면 판을 올리는 원천 — 통째로 받는 것은 DB 에 남은 판, 돌아가며 받는 것은 줄마다의 판('v')을 본다
_원천판들 = {"us_sec": sources.SEC_판}
_줄판들 = {"kr_naver": sources.네이버_판}
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
_불러오기잠금 = threading.Lock()
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
    from app.services.market.ranking_service import US_ROWS_CK, 나스닥_분류, 나스닥_상장해
    표 = cache.get(US_ROWS_CK) or cache.get_stale(US_ROWS_CK) or []
    목록 = {t["s"]: t for t in get_us_db() if t.get("s")}
    분류 = 나스닥_분류()
    상장해 = 나스닥_상장해()
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
                    "sector": 업종 or None, "industry": 산업 or None, "country": 나라 or None,
                    "ipo_year": 상장해.get(sym)})
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
    """서버가 뜬 뒤 처음 한 번 — DB 에 남겨 둔 원천을 메모리로. 상태 잠금(_상태잠금)은 쥐지 않는다 — DB 를 읽는 동안
    한종목(관심종목 표가 이벤트 루프에서 부른다)이 그 잠금을 기다리며 서버를 붙잡지 않게. 같이 부른 쪽은 다 읽을
    때까지 기다린다(빈 원천으로 표를 짓지 않게)"""
    if _원천_읽음[0]:
        return
    with _불러오기잠금:
        if _원천_읽음[0]:
            return
        try:
            for 칸, (열쇠, *_나머지) in 원천들.items():
                값, 때 = store.읽기(열쇠)
                if 값:
                    _넣기(칸, 값, float(값.get("at") or 때))
                    # 옛 받는 법으로 받은 것 — 쓰기는 하되 곧바로 새로 받는다(안 그러면 간격(SEC 7일)만큼 기다린다)
                    if 칸 in _원천판들 and 값.get("v") != _원천판들[칸]:
                        _원천때[칸] = 0.0
        finally:
            _원천_읽음[0] = True          # 못 읽었어도 한 번만 — 요청마다 DB 를 다시 두드리지 않게


def _원천_모음() -> dict:
    return {k: _원천.get(k) for k in ("kr_krx", "kr_git", "kr_naver", "kr_px", "kr_dart", "us_sec", "us_px", "us_fx")}


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
    판 = _줄판들.get(칸)
    # 받은 지 오래된 것 — 또는 옛 받는 법으로 받은 줄(판이 다르다: 네이버 연간 실적이 없는 줄)
    고를 = [c for c in 표.df.index
            if c not in 야후있음 and (거래소 is None or 거래소.get(c) in sources.야후꼬리)
            and (지금 - float((있던.get(c) or {}).get("at") or 0) > 수명
                 or (판 is not None and (있던.get(c) or {}).get("v") != 판))][:한번]
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
            # 판도 남긴다 — 안 남기면 옛 판 줄로 남아 차례마다 맨 앞에 다시 뽑힌다(멈춤)
            있던[c] = {**(있던.get(c) or {}), "at": 지금, **({"v": 판} if 판 is not None else {})}
        elif 판 is not None:
            받음[c] = {**받음[c], "v": 판}
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
    if 칸 == "us_fx":
        return sources.환율들()
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


def 원천_돌리기() -> None:
    """스케줄러가 1분마다 — 사람이 스크리닝을 안 열어도 원천(국내 연간 실적·1년 시세·SEC …)이 돌아가며 찬다.
    예전엔 스크리닝·관심종목을 열 때만 돌아, 서버가 깨어 있어도 국내 연간 실적이 몇 시간째 그대로였다(사용자:
    "국내주식 스크리닝에 안나오는 지표가 있어"). 표가 없으면 뒤에서 짓는다 — DB 에 남긴 원천을 읽고 지은 뒤 원천을 맡긴다"""
    if not 원천_받기:
        return
    from app.core import memory
    for 시장 in ("KR", "US"):
        if 시장 in _표:
            _원천_챙기기(시장)
        elif memory.has_headroom(f"스크리닝 표({시장}) 미리 짓기"):
            _뒤에서_새로(시장)              # 기다리는 사람이 없다 — 메모리가 빠듯하면 사람이 열 때 짓는다


_DART_알림 = [False]


def _DART_키없음_알리기() -> None:
    """DART 키가 없으면 국내 재무(DART)를 아예 안 묻는다 — 예전엔 말없이 건너뛰어 관리자 화면(바깥 원천)에도 안
    보였다(사용자: "국내주식 스크리닝은 안나오는 지표가 너무 많아"). 프로세스마다 한 번만 남긴다"""
    if _DART_알림[0]:
        return
    _DART_알림[0] = True
    from app.core import health
    health.record_fail(sources.이름_DART, "DART_API_KEY 가 없어 묻지 않음 — Render 환경변수에 OpenDART 인증키"
                                        "(opendart.fss.or.kr, 무료)를 넣으면 켜진다. 그동안 국내 매출·이익은 네이버 연간 실적으로 채운다")


def _원천_챙기기(시장: str) -> None:
    """그 시장의 원천 중 묵은 것을 뒤에서 새로 받게 맡긴다(한 번에 하나씩 차례로)"""
    if not 원천_받기:
        return
    from app.core.config import settings
    지금 = time.time()
    for 칸, (_열쇠, 간격, 쉼, 그시장) in 원천들.items():
        if 그시장 != 시장:
            continue
        if 칸 == "kr_dart" and not settings.DART_API_KEY:
            _DART_키없음_알리기()
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


def _원주_줄들() -> dict:
    """미국 표가 쓰는 국내 원주 줄 — SEC 연간 공시가 아직 없는 국내 회사 ADR(SK하이닉스 SKHY → 000660). 국내 표가
    아직 없으면 빈 것 — 국내 종목을 누가 보면(스크리닝·관심종목·상세) 국내 표가 생기고, 다음 미국 표부터 채워진다
    (미국 표를 지으려고 국내 표를 짓지는 않는다 — 0.15 CPU 서버에 일을 더 얹지 않게)"""
    국내 = _표.get("KR")
    if 국내 is None:
        return {}
    return {adr: 줄 for adr, (코드, _비율) in 국내_ADR.items() if (줄 := 국내.한줄(코드))}


def _짓기(시장: str, 풍부: list, 판: tuple) -> 스크리닝표:
    원천 = _원천_모음()
    if 시장 == "US":
        from app.services.market.ranking_service import 나스닥_주식수
        원천["kr_adr"] = _원주_줄들()
        원천["us_shares"] = 나스닥_주식수()          # 해외 회사 시가총액의 닻(table._시총_달러로)
    새것 = 만들기(시장, 기초줄(시장), 풍부, 원천)
    _표[시장], _표판[시장] = 새것, 판
    if 시장 == "US":
        _시총바꿈_남기기(새것)
    return 새것


이름_시총 = "스크리닝 · 해외 회사 시가총액(나라 돈 → 달러)"


def _시총바꿈_남기기(표: 스크리닝표) -> None:
    """관리자 화면(바깥 원천)에 어느 해외 회사의 시가총액을 고쳤는지 — 야후가 어느 회사를 그 나라 돈으로 주는지는
    운영에서만 보인다(검사 환경은 바깥에 못 나간다)"""
    from app.core import health
    바꿈 = 표.시총바꿈
    글 = " · ".join(f"{s}({까닭})" for s, 까닭 in list(바꿈.items())[:12])
    health.record_ok(이름_시총, None, f"{len(바꿈)}곳 고침 — {글}" + (" …" if len(바꿈) > 12 else "")
                     if 바꿈 else "고친 곳 없음(모두 달러로 옴)")


def 해외시총_주식수() -> dict[str, float]:
    """미국 표가 시가총액을 바로잡은 해외 회사 → 주식 수(바로잡은 시가총액 ÷ 시세 — 비운 곳은 0). 대시보드 해외
    순위가 지금 시세에 곱해 같은 값을 쓴다. 표가 없으면 빈 것"""
    표 = _표.get("US")
    if 표 is None or not 표.시총바꿈:
        return {}
    df, out = 표.df, {}
    for s in 표.시총바꿈:
        if s not in df.index or "market_cap" not in df.columns:
            continue
        시총, 가격 = df.at[s, "market_cap"], df.at[s, "price"]
        if not (가격 == 가격 and 가격 > 0):
            continue
        out[s] = float(시총) / float(가격) if 시총 == 시총 and 시총 > 0 else 0.0
    return out


def _뒤에서_새로(시장: str) -> None:
    with _상태잠금:
        if 시장 in _새로만드는중:
            return
        _새로만드는중.add(시장)

    def 일():
        try:
            # 표() 를 안 거치고 맡겨진 때(한종목 — 관심종목·종목 상세·퀀트)도 DB 에 남긴 원천으로 짓는다. 예전엔
            # 서버가 막 뜬 뒤 관심종목이 먼저 물으면 SEC·KRX 없이 지어, 스크리닝을 누가 열 때까지 PER·EPS 가 비었다
            _원천_불러오기()
            풍부, 판 = _풍부(시장)
            with _잠금(시장):
                _짓기(시장, 풍부, 판)
        except Exception as e:
            log.warning("스크리닝 %s 표 새로 만들기 실패: %s", 시장, type(e).__name__)
        finally:
            _새로만드는중.discard(시장)
        # 표가 생겼으니 표의 종목으로 묻는 원천(1년 시세·예상 PER)과 묵은 원천을 맡긴다 — 스크리닝 화면을 아무도
        # 안 열어도 돌아가며 받기가 멈추지 않게
        try:
            _원천_챙기기(시장)
        except Exception as e:
            log.warning("스크리닝 %s 원천 맡기기 실패: %s", 시장, type(e).__name__)

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


#: 시장 → 연간 재무 원천(전 종목 일괄) — 종목 상세 재무제표도 같은 숫자를 쓴다
_재무원천 = {"US": (("us_sec", "SEC"),), "KR": (("kr_dart", "DART"), ("kr_naver", "네이버"))}


def 재무_원천줄(시장: str, 종목: str) -> dict | None:
    """그 종목의 연간 재무 원천 한 줄(미국 SEC · 국내 DART → 네이버 연간 실적) → {칸: 숫자, '_출처': 원천 이름}. 해마다의
    값은 'rev@2025' 꼴이고, '_끝해' 는 그해(순이익·현금흐름 따위 해 없는 칸이 그해 것이다 — 그 종목에 그해 매출이
    없어도. 네이버는 종목마다 제 마지막 해). 종목 상세 재무제표가 종목별 원천(야후·FMP·DART 단일)을 못 받았을 때
    스크리닝과 같은 숫자로 채운다. 없으면 None"""
    원들 = _재무원천.get(시장)
    if not 원들:
        return None
    _원천_불러오기()                         # 서버가 막 떠 스크리닝을 아무도 안 열었어도 DB 에 남긴 원천으로
    코드 = 종목.split(".")[0] if 시장 == "KR" else 종목
    for 칸, 출처 in 원들:
        df = _원천.get(칸)
        if df is None or 코드 not in df.index:
            continue
        줄 = {k: float(v) for k, v in df.loc[코드].items() if isinstance(v, (int, float)) and math.isfinite(v)}
        if 칸 == "kr_naver":
            # 네이버 줄은 지표(PER·52주)만 있고 연간 실적은 아직 없을 수 있다 — 그러면 재무가 아니다
            if "fin_year" not in 줄:
                continue
            줄["_끝해"] = int(줄.pop("fin_year"))
        else:
            해들 = [int(c.split("@", 1)[1]) for c in df.columns if isinstance(c, str) and c.split("@", 1)[-1].isdigit()]
            if 해들:
                줄["_끝해"] = max(해들)
        줄["_출처"] = 출처
        return 줄
    return None


def 표가_있나(시장: str) -> bool:
    """그 시장의 표를 들고 있나 — 없으면 뒤에서 짓는 중이다(한종목·표 가 맡긴다)"""
    return 시장 in _표


def 표가_반쪽(시장: str) -> bool:
    """그 시장의 표가 기초 줄(전 종목 목록) 없이 지은 것인가 — 서버가 막 떠 목록을 아직 못 읽었을 때. 곧 다시 짓는다.
    ETF 표는 늘 기초 줄이 없다(야후 줄만) — 반쪽이 아니다"""
    표 = _표.get(시장)
    return 표 is not None and 시장 != "ETF" and not 표.기초수


def 지금_표인가(시장: str, 표: 스크리닝표) -> bool:
    """이 표가 지금의 표이고 뒤에서 새로 만드는 중도 아닌가 — 아니면 이 표로 낸 답은 곧 낡는다(라우트가 안 남긴다)"""
    return _표.get(시장) is 표 and 시장 not in _새로만드는중


def _묵었나(시장: str, 표: 스크리닝표) -> bool:
    """한종목 이 보는 표가 낡았나 — 원천이 새로 왔거나(원천판) 오래됐다(표_수명)"""
    판 = _표판.get(시장)
    return (판 is not None and 판[2] != _원천판[0]) or time.time() - 표.만든때 > 표_수명


def 한종목(시장: str, 종목: str) -> dict | None:
    """그 종목의 표 한 줄(원천을 합친 값 + 전년 대비 성장률) — 퀀트가 비는 품질·성장 지표를 여기서 채운다.
    표가 아직 없으면 그 자리에서 만들지 않는다(퀀트 요청을 붙잡지 않게) — 뒤에서 만들게 맡기고 None.
    표가 낡았으면 있던 줄로 곧바로 답하고 뒤에서 새로 — 스크리닝 화면을 아무도 안 열어도 관심종목·종목 상세가
    새로 온 원천(SEC·KRX…)을 보게"""
    if 시장 not in ("KR", "US", "ETF"):
        return None
    있음 = _표.get(시장)
    if 있음 is None or _묵었나(시장, 있음):
        if 원천_받기:
            _뒤에서_새로(시장)
        if 있음 is None:
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
