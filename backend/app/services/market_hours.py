"""
장 운영 시간 판단.

시세 갱신 주기를 정하는 기준이다. 지금까지는 이 개념이 코드에 아예 없어서
새벽 3시에도, 주말에도, 추석 연휴에도 정규장과 똑같은 주기로 외부 API를
때리고 있었다. 국내 정규장은 하루의 27%, 주말을 빼면 연중 19% 뿐이라
나머지 81%의 호출은 전날 종가를 다시 받아오는 데 쓰였다.

장중에만 빠르게 갱신하면 같은 예산으로 훨씬 촘촘한 실시간을 만들 수 있다.
"""
from __future__ import annotations

from datetime import datetime, time, timedelta, timezone
from typing import Literal

KST = timezone(timedelta(hours=9))
# 미국 동부는 서머타임에 따라 UTC-4/-5 로 바뀐다. 정확한 전환일을 직접 계산하는
# 대신, 3월 둘째 일요일~11월 첫째 일요일을 서머타임으로 본다(오차는 전환 당일 몇 시간).
_ET_STD = timezone(timedelta(hours=-5))
_ET_DST = timezone(timedelta(hours=-4))

Session = Literal["regular", "pre", "after", "closed"]

# 정규장
_KR_OPEN,  _KR_CLOSE  = time(9, 0),  time(15, 30)
_US_OPEN,  _US_CLOSE  = time(9, 30), time(16, 0)
# 시간외 — 이 구간에도 가격이 움직이므로 완전히 멈추지는 않는다
_KR_AFTER_CLOSE = time(18, 0)   # 시간외 단일가까지
_US_PRE_OPEN    = time(4, 0)
_US_AFTER_CLOSE = time(20, 0)


def _et_now(now_utc: datetime) -> datetime:
    """미국 동부 시각 — 서머타임을 근사 적용한다"""
    y = now_utc.year
    # 3월 둘째 일요일 02:00 ET ~ 11월 첫째 일요일 02:00 ET
    mar = datetime(y, 3, 1, tzinfo=timezone.utc)
    dst_start = mar + timedelta(days=(6 - mar.weekday()) % 7 + 7)
    nov = datetime(y, 11, 1, tzinfo=timezone.utc)
    dst_end = nov + timedelta(days=(6 - nov.weekday()) % 7)
    tz = _ET_DST if dst_start <= now_utc < dst_end else _ET_STD
    return now_utc.astimezone(tz)


def kr_session(now_utc: datetime | None = None) -> Session:
    now = (now_utc or datetime.now(timezone.utc)).astimezone(KST)
    if now.weekday() >= 5:                     # 토·일
        return "closed"
    t = now.time()
    if _KR_OPEN <= t < _KR_CLOSE:
        return "regular"
    if _KR_CLOSE <= t < _KR_AFTER_CLOSE:
        return "after"
    return "closed"


def us_session(now_utc: datetime | None = None) -> Session:
    now = _et_now(now_utc or datetime.now(timezone.utc))
    if now.weekday() >= 5:
        return "closed"
    t = now.time()
    if _US_OPEN <= t < _US_CLOSE:
        return "regular"
    if _US_PRE_OPEN <= t < _US_OPEN:
        return "pre"
    if _US_CLOSE <= t < _US_AFTER_CLOSE:
        return "after"
    return "closed"


def market_session(market: str, now_utc: datetime | None = None) -> Session:
    return kr_session(now_utc) if (market or "").upper() == "KR" else us_session(now_utc)


# 세션별 갱신 주기(초).
#
# 정규장 15초는 "사람이 화면을 보며 값이 움직인다고 느끼는" 하한이고,
# 그보다 짧게 가면 외부 API 차단 위험이 실익보다 커진다.
# 휴장 중에는 값이 바뀌지 않으므로 길게 잡아 예산을 정규장에 몰아준다.
_INTERVAL = {"regular": 15, "pre": 60, "after": 60, "closed": 600}


# 외부 API에 지속적으로 보낼 수 있다고 보는 초당 요청 수.
# 네이버·야후는 공식 계약이 아니라 한도가 공개돼 있지 않으므로, 사람이
# 브라우저로 여러 탭을 열어 보는 수준을 넘지 않게 보수적으로 잡는다.
MAX_REQ_PER_SEC = 8


def refresh_interval(sessions: list[Session], symbol_count: int = 0) -> int:
    """여러 시장 중 가장 활발한 쪽에 맞추되, 종목이 많으면 주기를 늘린다.

    국내 장중이면 미국이 닫혀 있어도 15초로 돈다 — 어차피 미국 종목은
    값이 안 변해 같은 응답이 오고, 시장별로 태스크를 쪼개면 복잡도만 는다.

    종목 수를 함께 보는 이유: 접속자가 늘어 보고 있는 종목이 많아지면
    같은 주기라도 초당 요청 수가 그만큼 올라간다. 주기를 고정해 두면
    어느 순간 외부 API가 막히고, 그러면 실시간이 아니라 아예 멈춘다."""
    base = _INTERVAL["closed"] if not sessions else min(
        _INTERVAL.get(s, _INTERVAL["closed"]) for s in sessions
    )
    if symbol_count <= 0:
        return base
    # 이 주기 안에 symbol_count 건을 보내려면 초당 몇 건이 되는지로 하한을 잡는다
    floor = symbol_count / MAX_REQ_PER_SEC
    return max(base, round(floor))


def is_any_open(now_utc: datetime | None = None) -> bool:
    return "closed" not in (kr_session(now_utc), us_session(now_utc))


def session_label(market: str, now_utc: datetime | None = None) -> str:
    """화면에 그대로 쓰는 한국어 라벨"""
    return {
        "regular": "장중",
        "pre":     "장전",
        "after":   "장마감",
        "closed":  "휴장",
    }[market_session(market, now_utc)]
