"""라이브러리별 메모리 사용량 측정.

관리자 화면의 메모리 항목이 오랫동안 '캐시 8MB / 나머지 411MB' 두 줄이었다.
나머지가 라이브러리라는 건 알아도 어떤 라이브러리가 얼마나 쓰는지는 알 수
없으니, 512MB 한도에 걸렸을 때 무엇을 줄여야 하는지 판단할 방법이 없었다.

여기서는 표에 값을 적어두지 않는다. 각 라이브러리가 이 서버에서 처음
import 되는 순간의 앞뒤 RSS 를 직접 재서 기록한다.

측정 방식
  - `builtins.__import__` 를 감싸 최상위 패키지의 첫 import 만 계측한다.
  - 안에서 다른 라이브러리를 끌어오면(pandas → numpy) 중첩으로 기록해,
    자식이 쓴 만큼은 부모에서 뺀다. 그래야 항목을 다 더한 값이 실제
    합계와 맞는다. numpy 는 numpy 줄에서만 세어진다.
  - RSS 는 프로세스가 OS 에서 실제로 받아간 양이라 정확하지만 되돌려주지
    않는 특성이 있다. 즉 여기 숫자는 '그때 늘어난 양'이고, 근사값이다.

측정할 수 없는 환경(/proc 이 없는 맥·윈도우)에서는 아무것도 하지 않고
평소대로 import 한다. 개발 환경에서 이 파일 때문에 문제가 생기면 안 된다.
"""
from __future__ import annotations

import builtins
import os
import sys
import threading

MB = 1024 * 1024

try:
    _PAGESIZE = os.sysconf("SC_PAGE_SIZE")
except Exception:  # pragma: no cover - 리눅스가 아니면 여기로 온다
    _PAGESIZE = 4096


# 이름만 봐서는 무엇에 쓰는 라이브러리인지 알 수 없다.
# 화면에 크기만 띄우면 '줄여도 되는 것'과 '없으면 서비스가 안 뜨는 것'을
# 구분할 수 없으므로 용도를 같이 적는다.
PURPOSE: dict[str, str] = {
    "pandas":            "표 형태 데이터 처리 — 시세·재무·백테스트 계산의 기반",
    "numpy":             "수치 계산 — pandas·지표 계산이 내부에서 사용",
    "yfinance":          "야후 파이낸스 시세·재무제표 조회",
    "FinanceDataReader": "KRX 전체 상장 종목 목록과 국내 시세",
    "pykrx":             "KRX 공식 지표 — FinanceDataReader 실패 시 폴백",
    "sqlalchemy":        "DB 접근 — 27개 테이블 매핑과 쿼리",
    "psycopg2":          "PostgreSQL 드라이버",
    "fastapi":           "웹 프레임워크 — 148개 API 경로",
    "starlette":         "HTTP·웹소켓 처리 (FastAPI 내부)",
    "pydantic":          "요청·응답 검증",
    "pydantic_settings": "환경변수 설정 로딩",
    "uvicorn":           "ASGI 서버 — 실제로 요청을 받는 프로세스",
    "httpx":             "외부 API 호출 (야후·DART·Finnhub)",
    "aiohttp":           "비동기 HTTP 호출",
    "requests":          "외부 API 호출 (일부 라이브러리가 내부에서 사용)",
    "feedparser":        "뉴스 RSS 파싱",
    "bs4":               "HTML 파싱 — 공시·뉴스 본문 추출",
    "lxml":              "HTML/XML 파서 백엔드 (bs4 가 사용)",
    "websockets":        "실시간 시세 웹소켓",
    "jwt":               "로그인 토큰 검증",
    "anthropic":         "AI 분석 요청",
    "slowapi":           "요청 속도 제한",
    "curl_cffi":         "브라우저 흉내 HTTP — yfinance 차단 우회",
    "multitasking":      "yfinance 내부 스레드 처리",
    "scipy":             "통계 계산",
    # 우리 코드는 matplotlib 을 부르지 않는다. pykrx 가 폴백으로 돌 때
    # 딸려 들어온다 — 그때 PIL·fontTools·pyparsing 까지 약 48MB가 붙는다
    "matplotlib":        "pykrx 폴백이 끌어오는 그래프 라이브러리 (우리 코드는 쓰지 않음)",
    "fontTools":         "글꼴 처리 (matplotlib 이 끌어옴)",
    "mpl_toolkits":      "그래프 보조 도구 (matplotlib 이 끌어옴)",
    "pyparsing":         "문법 파싱 (matplotlib 이 끌어옴)",
    "httpcore":          "HTTP 연결 처리 (httpx 내부)",
    "anyio":             "비동기 실행 추상화 (starlette·httpx 내부)",
    "sniffio":           "비동기 런타임 판별",
    "pkg_resources":     "패키지 메타데이터 조회 (구형 setuptools API)",
    "setuptools":        "패키지 메타데이터",
    "six":               "파이썬 2/3 호환 보조",
    "attr":              "자료구조 정의 보조",
    "yaml":              "설정 파일 파싱",
    "email":             "파이썬 표준 라이브러리",
    "asyncio":           "파이썬 표준 라이브러리 — 비동기 실행",
    "logging":           "파이썬 표준 라이브러리",
    "sqlite3":           "파이썬 표준 라이브러리 — 로컬 개발용 DB",
    "ssl":               "파이썬 표준 라이브러리 — HTTPS 암호화",
    "_ssl":              "HTTPS 암호화 엔진 (OpenSSL)",
    "pydantic_core":     "pydantic 검증 엔진 (Rust 확장)",
    "peewee":            "yfinance 내부 캐시 DB",
    "greenlet":          "SQLAlchemy 가 비동기 실행에 사용",
    "cryptography":      "토큰·HTTPS 암호화",
    "charset_normalizer": "응답 문자 인코딩 판별 (requests 내부)",
    "urllib3":           "HTTP 연결 풀 (requests 내부)",
    "certifi":           "HTTPS 인증서 목록",
    "idna":              "국제화 도메인 처리",
    "rich":              "콘솔 출력 서식",
    "click":             "명령줄 인자 처리 (uvicorn 내부)",
    "h11":               "HTTP/1.1 프로토콜 처리 (uvicorn 내부)",
    "httptools":         "HTTP 파서 (uvicorn 내부)",
    "watchfiles":        "파일 변경 감지 (개발용 자동 재시작)",
    "dotenv":            "환경변수 파일 로딩",
    "frozendict":        "yfinance 내부 자료구조",
    "platformdirs":      "캐시 경로 결정 (yfinance 내부)",
    "protobuf":          "야후 실시간 스트림 메시지 해석",
    "google":            "야후 실시간 스트림 메시지 해석 (protobuf)",
    "dateutil":          "날짜 문자열 해석 (pandas 내부)",
    "pytz":              "시간대 데이터",
    "zoneinfo":          "파이썬 표준 라이브러리 — 시간대",
    "typing_extensions": "타입 힌트 보조",
    "soupsieve":         "CSS 선택자 (bs4 내부)",
    "PIL":               "이미지 처리 — 프로필 사진 리사이즈",
}


_lock = threading.Lock()
_measured: dict[str, dict] = {}      # 최상위 패키지 이름 → {"total": bytes, "self": bytes}
_local = threading.local()           # 중첩 import 추적 (스레드별)
_installed = False
_baseline: int | None = None         # 계측을 시작한 시점의 RSS
_real_import = None


def rss_bytes() -> int | None:
    """지금 프로세스가 실제로 점유한 물리 메모리(바이트). 못 읽으면 None.

    /proc/self/status 대신 statm 을 쓴다 — 한 줄짜리라 파싱이 훨씬 싸다.
    import 마다 두 번씩 읽으므로 이 차이가 그대로 시작 시간에 들어간다."""
    try:
        with open("/proc/self/statm", "rb") as f:
            return int(f.read().split()[1]) * _PAGESIZE
    except Exception:
        return None


def _stack() -> list:
    s = getattr(_local, "stack", None)
    if s is None:
        s = _local.stack = []
    return s


def _tracking_import(name, globals=None, locals=None, fromlist=(), level=0):
    top = name.partition(".")[0]
    # 상대 import, 이미 로드된 것, 이미 잰 것은 그냥 통과시킨다.
    # 여기를 매 import 마다 지나가므로 판정은 최대한 싸야 한다.
    if level or not top or top in sys.modules or top in _measured:
        return _real_import(name, globals, locals, fromlist, level)

    before = rss_bytes()
    if before is None:
        return _real_import(name, globals, locals, fromlist, level)

    stack = _stack()
    frame = [top, 0]                     # [이름, 자식이 쓴 바이트]
    stack.append(frame)
    try:
        return _real_import(name, globals, locals, fromlist, level)
    finally:
        if stack and stack[-1] is frame:
            stack.pop()
        try:
            after = rss_bytes()
            total = max(0, (after - before) if after is not None else 0)
            if stack:
                stack[-1][1] += total    # 부모에서 빼기 위해 올려 보낸다
            with _lock:
                _measured[top] = {"total": total, "self": max(0, total - frame[1])}
        except Exception:
            pass                         # 계측 실패가 import 를 깨뜨리면 안 된다


def install() -> bool:
    """계측을 켠다. 앱 패키지가 로드되는 가장 첫 순간에 한 번 호출한다."""
    global _real_import, _installed, _baseline
    if _installed:
        return True
    base = rss_bytes()
    if base is None:
        return False                     # 리눅스가 아니면 계측 자체를 하지 않는다
    _baseline = base
    _real_import = builtins.__import__
    builtins.__import__ = _tracking_import
    _installed = True
    return True


def uninstall():
    """계측을 끈다 (테스트용)."""
    global _installed
    if _installed and _real_import is not None:
        builtins.__import__ = _real_import
    _installed = False


def reset():
    with _lock:
        _measured.clear()


def _row(name: str, v: dict) -> dict:
    return {
        "name":     name,
        "mb":       round(v["self"] / MB, 1),
        "total_mb": round(v["total"] / MB, 1),
        "purpose":  PURPOSE.get(name, ""),
    }


def report(limit: int = 20, min_bytes: int = 512 * 1024) -> dict:
    """라이브러리별 메모리 — 관리자 화면용.

    `mb` 는 그 라이브러리 자신이 늘린 양이고, 안에서 끌어온 라이브러리는
    각자의 줄에서 세어진다. 그래서 모든 줄을 더하면 `measured_mb` 가 된다.
    `total_mb` 는 끌어온 것까지 포함한 값이라 줄끼리 겹친다 — 참고용이다."""
    with _lock:
        rows = [(n, dict(v)) for n, v in _measured.items()]

    shown = sorted((r for r in rows if r[1]["self"] >= min_bytes),
                   key=lambda r: -r[1]["self"])
    hidden = [r for r in rows if r[1]["self"] < min_bytes]

    # 계측을 켜기 전에 이미 로드된 것들(uvicorn 이 앱을 import 하기 전에
    # 올린 것). 크기는 알 수 없지만 '무엇이 올라와 있는지'는 보여준다.
    #
    # __file__ 이 없는 것은 제외한다. pykrx_light 가 꽂아 둔 빈 matplotlib
    # 대체 모듈이 여기 섞여 들어와, 정작 안 올라온 라이브러리를 '올라와 있음'
    # 으로 보고했다 — 지금 고치려는 문제를 그 표시가 가리고 있었다.
    preloaded = sorted(
        n for n in PURPOSE
        if n in sys.modules and n not in _measured
        and getattr(sys.modules[n], "__file__", None)
    )

    # 대체 모듈로 막아 둔 것 — 안 올라왔다는 사실 자체가 정보다
    stubbed = []
    try:
        from app.core import pykrx_light
        if pykrx_light.stubbed():
            stubbed.append({
                "name": "matplotlib",
                "note": "pykrx 가 폰트 설정용으로만 부르므로 대체 모듈로 막음 "
                        "(PIL·pyparsing·fontTools 까지 약 120MB 미적재)",
            })
    except Exception:
        pass

    return {
        "tracked":      _installed,
        "stubbed":      stubbed,
        "items":        [_row(n, v) for n, v in shown[:limit]],
        "measured_mb":  round(sum(v["self"] for _, v in rows) / MB, 1),
        "other_count":  len(hidden),
        "other_mb":     round(sum(v["self"] for _, v in hidden) / MB, 1),
        # 파이썬 인터프리터 자체 + 계측 전에 로드된 것들
        "baseline_mb":  round(_baseline / MB, 1) if _baseline else None,
        "preloaded":    [{"name": n, "purpose": PURPOSE.get(n, "")} for n in preloaded],
        "modules":      len(sys.modules),
    }
