"""
프로세스 내 인메모리 활동 트래커.
- online_users  : 최근 5분 이내 API를 호출한 고유 방문자 수
- today_visitors: UTC 당일 방문한 고유 방문자 수

Render 재시작(배포) 시 인메모리 데이터가 초기화되므로,
오늘 방문자 수도 DB에 주기적으로 flush하고 재시작 후에는 DB에서 복원한다.

── 비로그인 방문자를 세게 된 이유 ──────────────────────────

여기는 오래 로그인한 사람만 세고 있었다. mark_active 를 부르는 자리가
'Authorization 헤더가 있을 때' 뿐이었기 때문이다. 그런데 이 사이트는
로그인 없이도 대부분의 화면을 볼 수 있다 — 대시보드도, 종목 상세도,
뉴스도. 즉 **방문자의 대부분이 안 세어지고 있었다.**

평소에는 별일 아니었는데, 수익화를 생각하니 이게 곧 문제가 된다.
광고든 증권사 제휴든 심사에서 묻는 것은 '가입자 수' 가 아니라
'방문자 수' 다. 그리고 무엇을 먼저 만들지 정하는 데에도 로그인한
소수보다 전체 방문 흐름이 필요하다.

세는 방법 — 로그인한 사람은 예전처럼 user_id 로, 아닌 사람은 접속
주소와 브라우저 종류를 섞어 만든 지문으로 센다. 지문에는 **그날치
소금(날짜)** 을 섞는다. 그래서

  · 같은 날 같은 사람은 한 번으로 세어지고
  · 날이 바뀌면 지문이 달라져 사람을 이어 추적할 수 없다
  · 원래 주소를 되돌릴 수 없다 (되돌리려면 그날 안에 후보를 다 넣어
    봐야 하는데, 그럴 바엔 로그를 보는 게 빠르다)

개인을 알아보려는 게 아니라 '몇 명이 왔나' 만 알면 되므로 이 정도면
충분하다. 쿠키를 심지 않아서 동의 배너도 필요 없다.
"""
import hashlib
import os
import time
from datetime import datetime, timezone, timedelta
from threading import Lock

ONLINE_WINDOW = 5 * 60  # 5분

#: 한 날에 담아 둘 지문의 최대 개수. 넘으면 그날은 더 안 담고 숫자만 센다.
#: 512MB 짜리 서버라 무한정 쌓게 두면 안 된다 — 지문 하나가 약 16바이트라
#: 20만 개면 3MB 남짓이다. 그 위로는 세는 정확도보다 안 죽는 게 우선이다.
MAX_FINGERPRINTS = int(os.getenv("VISITOR_MAX_FINGERPRINTS", 200_000))

_lock = Lock()
_last_seen: dict[str, float] = {}   # 방문자 열쇠 → monotonic timestamp
_daily: dict[str, set[str]] = {}    # "YYYY-MM-DD" → set(방문자 열쇠)
_flushed: set[str] = set()          # 이미 DB에 영속화된 과거 날짜 (오늘은 제외)
_db_base: dict[str, int] = {}       # 서버 시작 시 DB에서 로드한 날짜별 기준값

#: 날짜별 요청 수. 방문자 수와 따로 센다 — 화면 하나를 열면 API 를 여러 번
#: 부르므로 이 값은 '조회수' 가 아니다. 서버가 얼마나 일했는지를 보는 값이다.
_daily_요청: dict[str, int] = {}

#: 로그인/비로그인을 갈라 보기 위한 그날치 집계
_daily_로그인: dict[str, set[str]] = {}


def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _load_db_base() -> None:
    """모듈 로드 시 DB에서 최근 방문자 기준값 로드 — 재시작 후 오늘 수치 보존"""
    try:
        from app.db.database import engine
        from sqlalchemy import text
        with engine.connect() as conn:
            rows = conn.execute(
                text("SELECT key, value FROM system_settings WHERE key LIKE 'visitors_%'")
            ).fetchall()
        for row in rows:
            date_str = str(row[0]).replace("visitors_", "")
            try:
                _db_base[date_str] = int(row[1])
            except (ValueError, TypeError):
                pass
    except Exception:
        pass


# 모듈 로드 시 즉시 DB 기준값 로드 (재시작 시 오늘 수치 복원)
_load_db_base()


# 마지막으로 어떤 요청이든 들어온 시각(monotonic).
# 로그인 여부와 무관하게 갱신한다 — 백그라운드 갱신을 계속 돌릴지 판단하는 데
# 쓰는 값이라, '사람이 이 서비스를 쓰고 있는가'만 알면 된다.
_last_request_at: float = time.monotonic()


def touch_request() -> None:
    global _last_request_at
    _last_request_at = time.monotonic()


def seconds_since_last_request() -> float:
    return time.monotonic() - _last_request_at


def _지문(ip: str, ua: str, 날짜: str) -> str:
    """접속 주소와 브라우저를 섞어 그날치 방문자 지문을 만든다.

    날짜를 같이 섞는 것이 요점이다 — 소금이 매일 바뀌므로 어제 지문과
    오늘 지문이 이어지지 않는다. '몇 명이 왔나' 는 알 수 있고 '누가
    계속 오나' 는 알 수 없다. 우리에게 필요한 건 앞의 것뿐이다.

    blake2b 를 8바이트로 자른다. 하루 20만 명이라도 겹칠 확률이
    사실상 없고(생일 문제로 따져도 백만분의 일 아래), 짧아서 메모리를
    아낀다."""
    return hashlib.blake2b(
        f"{날짜}|{ip}|{ua}".encode("utf-8", "ignore"), digest_size=8
    ).hexdigest()


def 방문자_열쇠(user_id: "int | None", ip: str, ua: str, 날짜: str) -> str:
    """로그인한 사람은 계정으로, 아닌 사람은 지문으로.

    로그인한 사람을 계정으로 세는 이유 — 휴대폰에서 보다가 노트북으로
    옮기면 지문이 달라진다. 같은 사람이 두 명으로 세어지면 안 된다."""
    return f"u{user_id}" if user_id else f"a{_지문(ip, ua, 날짜)}"


def mark_visit(user_id: "int | None", ip: str = "", ua: str = "") -> None:
    """방문 하나를 센다. 로그인 여부와 상관없이 부른다."""
    now_mono = time.monotonic()
    today = _today()
    열쇠 = 방문자_열쇠(user_id, ip, ua, today)
    처음보는날 = today not in _daily
    with _lock:
        _daily_요청[today] = _daily_요청.get(today, 0) + 1
        오늘것 = _daily.setdefault(today, set())
        # 담을 자리가 꽉 찼는데 처음 보는 방문자면, 세지 못하고 넘어간다.
        # 숫자가 조금 모자라게 나오는 편이 프로세스가 죽는 것보다 낫다.
        if 열쇠 in 오늘것 or len(오늘것) < MAX_FINGERPRINTS:
            오늘것.add(열쇠)
            _last_seen[열쇠] = now_mono
            if user_id:
                _daily_로그인.setdefault(today, set()).add(열쇠)

    # 날이 바뀐 첫 요청에서 지난 날 것을 비운다. 하루 한 번뿐이라
    # 값이 거의 안 든다 — 다른 데서 주기적으로 불러 줄 필요가 없다.
    if 처음보는날:
        _오래된날_버리기()


def mark_active(user_id: int) -> None:
    """예전 이름 — 로그인한 사용자용. 부르는 자리가 남아 있어 그대로 둔다."""
    mark_visit(user_id)


def online_count() -> int:
    cutoff = time.monotonic() - ONLINE_WINDOW
    with _lock:
        stale = [uid for uid, t in _last_seen.items() if t < cutoff]
        for uid in stale:
            del _last_seen[uid]
        return len(_last_seen)


def today_visitor_count() -> int:
    today = _today()
    with _lock:
        memory_count = len(_daily.get(today, set()))
    # 재시작으로 메모리가 초기화됐을 때 DB 기준값이 더 클 수 있음
    return max(memory_count, _db_base.get(today, 0))


def 오늘_방문_요약() -> dict:
    """오늘 방문자를 로그인/비로그인으로 갈라 준다.

    수익화를 정하는 데 이 구분이 필요하다. 광고와 제휴는 비로그인
    방문자에게도 걸리지만, 구독은 로그인한 사람에게만 판다."""
    today = _today()
    with _lock:
        전체 = len(_daily.get(today, set()))
        로그인 = len(_daily_로그인.get(today, set()))
        요청 = _daily_요청.get(today, 0)
    전체 = max(전체, _db_base.get(today, 0))
    return {
        "방문자": 전체,
        "로그인": 로그인,
        "비로그인": max(0, 전체 - 로그인),
        "요청수": 요청,
        "지문한도_도달": 전체 >= MAX_FINGERPRINTS,
    }


def _오래된날_버리기(남길일수: int = 3) -> None:
    """지난 날짜의 지문 집합을 메모리에서 비운다.

    날마다 지문 집합이 하나씩 쌓이는데, 지난 날 숫자는 DB 에 이미 넘어가
    있으므로 메모리에 들고 있을 이유가 없다. 안 비우면 며칠 만에
    512MB 중 상당 부분을 여기가 먹는다."""
    자를날 = (datetime.now(timezone.utc) - timedelta(days=남길일수)).strftime("%Y-%m-%d")
    cutoff = time.monotonic() - ONLINE_WINDOW
    with _lock:
        for 그릇 in (_daily, _daily_로그인):
            for 날 in [d for d in 그릇 if d < 자를날]:
                del 그릇[날]
        for 날 in [d for d in _daily_요청 if d < 자를날]:
            del _daily_요청[날]
        # _last_seen 도 같이 비운다. 여기는 방문자마다 한 칸씩 쌓이는데
        # 지우는 자리가 online_count() 안에만 있었다 — 관리자 화면을
        # 안 열면 영영 안 지워진다.
        for 열쇠 in [k for k, t in _last_seen.items() if t < cutoff]:
            del _last_seen[열쇠]


def get_visitor_trend(days: int = 30) -> list[dict]:
    """최근 N일 방문자 추이를 반환.
    오늘을 포함한 모든 날짜를 DB에 flush해 서버 재시작 시 데이터 손실을 방지한다."""
    today = _today()

    with _lock:
        snapshot = {k: len(v) for k, v in _daily.items()}

    # 과거 날짜: 아직 flush 안 된 것만 / 오늘: 항상 flush (재시작 대비)
    to_flush: dict[str, int] = {}
    for date_str, count in snapshot.items():
        if date_str == today:
            # 오늘은 DB 기준값과 비교해 큰 쪽으로 저장
            to_flush[date_str] = max(count, _db_base.get(date_str, 0))
        elif date_str not in _flushed:
            to_flush[date_str] = count

    if to_flush:
        try:
            from app.db.database import engine
            from sqlalchemy import text
            with engine.connect() as conn:
                for date_str, count in to_flush.items():
                    conn.execute(
                        text(
                            "INSERT INTO system_settings (key, value) "
                            "VALUES (:k, :v) ON CONFLICT (key) DO UPDATE SET value = :v"
                        ),
                        {"k": f"visitors_{date_str}", "v": str(count)},
                    )
                conn.commit()
            with _lock:
                # 오늘은 _flushed에 추가하지 않아 다음 호출에서도 갱신 가능
                _flushed.update(d for d in to_flush if d != today)
            # 오늘 DB 기준값 갱신
            if today in to_flush:
                _db_base[today] = to_flush[today]
        except Exception:
            pass

    # DB에서 전체 날짜 데이터 읽기
    db_data: dict[str, int] = {}
    try:
        from app.db.database import engine
        from sqlalchemy import text
        with engine.connect() as conn:
            rows = conn.execute(
                text("SELECT key, value FROM system_settings WHERE key LIKE 'visitors_%'")
            ).fetchall()
        for row in rows:
            date_str = str(row[0]).replace("visitors_", "")
            try:
                db_data[date_str] = int(row[1])
            except (ValueError, TypeError):
                pass
    except Exception:
        pass

    with _lock:
        today_memory = len(_daily.get(today, set()))
    # 재시작 전후 최댓값 사용
    today_count = max(today_memory, db_data.get(today, 0))

    # 최근 N일 조립 (오래된 날 → 오늘 순)
    result = []
    for i in range(days - 1, -1, -1):
        day = (datetime.now(timezone.utc) - timedelta(days=i)).strftime("%Y-%m-%d")
        count = today_count if day == today else db_data.get(day, 0)
        result.append({"date": day, "count": count})

    return result
