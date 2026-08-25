"""터진 오류를 실제로 남긴다.

health.py 는 '무엇이 몇 번 실패했나' 를 센다. 그런데 정작 **무엇이
어떻게 터졌는지** 는 아무 데도 안 남았다. 서버 로그에는 찍히지만
Render 무료 플랜은 재시작이 잦아 로그가 곧 흘러간다.

그래서 오늘까지 문제를 전부 사용자 제보로 알았다 — 엔비디아가 순위에서
사라진 것도, 콜금리가 안 뜨는 것도, 글자가 너무 커진 것도. 사용자가
말해 주지 않았으면 몰랐을 것이다. 그건 제대로 된 방식이 아니다.

Sentry 같은 바깥 서비스를 붙이는 게 정석이지만 가입과 키 발급이 필요하다.
여기 있는 것은 **가입 없이 오늘부터 도는** 최소한의 대체물이다.
나중에 Sentry 를 붙이더라도 이건 그대로 둘 만하다 — 바깥 서비스가
막히거나 한도를 넘겨도 여기는 남는다.

담는 방식
  · 최근 것만 링버퍼로 들고 있는다(기본 200건). 512MB 서버라 무한정
    쌓을 수 없다.
  · 같은 오류가 쏟아지면 한 줄로 묶고 횟수만 센다. 한 번 터지는 자리는
    보통 계속 터지는데, 그걸 200줄로 채우면 다른 오류가 밀려난다.
  · DB 에는 안 쓴다. 재시작하면 날아가지만, 쓰기가 늘면 그것 자체가
    0.15 CPU 에 부담이고 Supabase 무료 용량도 갉아먹는다.
    '지금 뭐가 터지고 있나' 를 보는 것이 목적이라 그 정도면 된다.
"""
from __future__ import annotations

import hashlib
import os
import time
import traceback
from collections import OrderedDict
from datetime import datetime, timezone
from threading import Lock

#: 들고 있을 오류 종류 수 (같은 오류는 한 칸)
MAX_KINDS = int(os.getenv("ERROR_MAX_KINDS", 200))

#: 한 줄에 남길 본문 길이. 스택은 이보다 길지만 앞부분이면 대개 충분하다.
MAX_DETAIL = 1200

_lock = Lock()
#: 지문 → {어디, 무엇, 자세히, 횟수, 처음, 마지막, 어디서}
_모음: "OrderedDict[str, dict]" = OrderedDict()


def _지문(어디: str, 무엇: str, 자세히: str) -> str:
    """같은 오류인지 가리는 열쇠.

    본문 전체가 아니라 앞 세 줄만 쓴다 — 스택 아래쪽은 같은 오류라도
    호출 경로에 따라 달라지는데, 그걸 다르다고 세면 같은 오류가
    수십 줄로 늘어난다."""
    앞부분 = "\n".join(자세히.splitlines()[:3])
    return hashlib.blake2b(
        f"{어디}|{무엇}|{앞부분}".encode("utf-8", "ignore"), digest_size=8
    ).hexdigest()


def 남기기(어디: str, 예외: BaseException, 어디서: str = "") -> None:
    """오류 하나를 담는다. 이 함수는 절대 예외를 밖으로 내보내지 않는다 —
    오류를 기록하다가 요청이 죽으면 고치려던 것보다 나쁘다."""
    try:
        무엇 = type(예외).__name__
        자세히 = "".join(traceback.format_exception_only(type(예외), 예외)).strip()
        스택 = "".join(traceback.format_tb(예외.__traceback__))[-MAX_DETAIL:]
        _담기(어디, 무엇, f"{자세히}\n{스택}".strip(), 어디서)
    except Exception:
        pass


def 화면오류_남기기(무엇: str, 자세히: str, 어디서: str = "") -> None:
    """브라우저에서 보내온 것. 서버 오류와 한자리에 모은다 —
    사용자가 겪는 고장은 어느 쪽에서 났든 하나의 사건이다.

    위 남기기 와 마찬가지로 예외를 밖으로 안 내보낸다. 이걸 부르는
    자리(clienterr.py)는 누구나 열 수 있는 공개 라우트라, 여기서
    500 이 나면 그 자체가 또 하나의 오류로 기록되며 맞물려 돈다."""
    try:
        _담기("화면", str(무엇)[:200], str(자세히)[:MAX_DETAIL], str(어디서)[:300])
    except Exception:
        pass


def _담기(어디: str, 무엇: str, 자세히: str, 어디서: str) -> None:
    열쇠 = _지문(어디, 무엇, 자세히)
    이제 = time.time()
    with _lock:
        칸 = _모음.get(열쇠)
        if 칸:
            칸["횟수"] += 1
            칸["마지막"] = 이제
            _모음.move_to_end(열쇠)          # 최근 것을 뒤로
        else:
            _모음[열쇠] = {
                "어디": 어디, "무엇": 무엇, "자세히": 자세히,
                "어디서": 어디서, "횟수": 1, "처음": 이제, "마지막": 이제,
            }
            while len(_모음) > MAX_KINDS:
                _모음.popitem(last=False)     # 오래된 것부터 버린다


def _시각(t: float) -> str:
    return datetime.fromtimestamp(t, timezone.utc).strftime("%m/%d %H:%M:%S")


def 목록(개수: int = 50) -> list:
    """최근에 터진 것부터. 관리자 화면이 쓴다."""
    with _lock:
        칸들 = list(_모음.values())
    칸들.sort(key=lambda x: x["마지막"], reverse=True)
    return [{
        "어디": c["어디"], "무엇": c["무엇"],
        "자세히": c["자세히"], "어디서": c["어디서"],
        "횟수": c["횟수"],
        "처음": _시각(c["처음"]), "마지막": _시각(c["마지막"]),
        "지난초": int(time.time() - c["마지막"]),
    } for c in 칸들[:개수]]


def 요약() -> dict:
    with _lock:
        칸들 = list(_모음.values())
    이제 = time.time()
    한시간 = [c for c in 칸들 if 이제 - c["마지막"] < 3600]
    return {
        "종류": len(칸들),
        "전체횟수": sum(c["횟수"] for c in 칸들),
        "한시간_종류": len(한시간),
        "한시간_횟수": sum(c["횟수"] for c in 한시간),
        "가장_잦은": max((c["무엇"] for c in 칸들),
                        key=lambda n: sum(c["횟수"] for c in 칸들 if c["무엇"] == n),
                        default=None),
    }


def 비우기() -> None:
    with _lock:
        _모음.clear()
