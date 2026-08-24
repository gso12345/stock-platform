"""빈손도 기억한다 — 바깥에서 받아 오는 모든 자리의 공통 규칙.

이 저장소에서 가장 자주 되풀이된 결함이다. 여기저기서 이렇게 쓴다:

    if c := cache.get(ck):
        return c
    결과 = 받아오기()          # 여기가 2~5초
    if 결과:
        cache.set(ck, 결과, ...)
    return 결과 or 빈값

성공하면 담아 두니 두 번째부터 빠르다. 그런데 **실패하면 아무것도 안
담는다**. 원천이 죽어 있는 동안은 요청이 올 때마다 처음부터 다시 받으러
간다. 서버를 띄워 재 보니 재무제표가 첫 요청 5.4초, 두 번째 2.6초였다 —
캐시가 있는데도 안 빨라진다. 캐시가 성공만 기억하기 때문이다.

세 가지가 같이 빠져 있었고, 셋 다 같은 뿌리다.

  · 빈손을 안 담아 둔다 → 요청마다 죽은 원천을 다시 두드린다
  · 겹침을 안 막는다 → 동시 접속자 수만큼 같은 조회가 동시에 돈다
  · 지난 값이 있을 때도 겹침을 안 막는다 → 요청마다 배경 작업을 하나씩
    새로 밀어 넣는다. 0.15 CPU 에서는 이것만으로 밀린다

규칙은 한 줄이다. **요청을 오래 잡지 않는다.** 담긴 것이 있으면 그것을,
지난 것이 있으면 그것을 즉시 주고 뒤에서 채운다. 아무것도 없을 때만
직접 받되, 그때도 한 사람만 받는다.

여기 있는 것은 market_extras 에 있던 `_캐시_우선` 을 그대로 옮긴 것이다.
같은 것을 async 로도 쓸 데가 있어(재무제표·컨센서스) 짝을 맞춰 뒀다.
"""
import asyncio
import logging
import os

from app.core.cache import cache
from app.core.executor import background_executor

log = logging.getLogger(__name__)

#: 못 받았을 때 이만큼은 다시 안 물어본다
MISS_TTL = int(os.getenv("FETCH_MISS_TTL", 60))

#: 지금 받고 있는 것 (열쇠 → True)
_받는중: dict = {}


def 받는중인가(ck: str) -> bool:
    return bool(_받는중.get(ck))


def 빈손_표시(ck: str, ttl: "int | None" = None) -> None:
    cache.set(f"{ck}:miss", True, ttl or MISS_TTL)


def 빈손인가(ck: str) -> bool:
    return bool(cache.get(f"{ck}:miss"))


def 잊기(ck: "str | None" = None) -> None:
    """시험에서 상태를 되돌릴 때 쓴다."""
    if ck is None:
        _받는중.clear()
    else:
        _받는중.pop(ck, None)
        cache.delete(f"{ck}:miss")


def _한번만(ck: str, 받기):
    try:
        받기()
    except Exception as e:
        log.debug("배경 갱신 실패 %s: %s", ck, type(e).__name__)
    finally:
        _받는중.pop(ck, None)


def 캐시_우선(ck: str, 받기, 빈값, miss_ttl: "int | None" = None):
    """캐시 → 지난 값 → (한 번만) 직접. 동기 판."""
    if (c := cache.get(ck)) is not None:
        return c

    stale = cache.get_stale(ck)
    if stale is not None:
        if not _받는중.get(ck):
            _받는중[ck] = True
            background_executor.submit(_한번만, ck, 받기)
        return stale

    if 빈손인가(ck):
        return 빈값                      # 방금 받아 봤는데 빈손이었다
    if _받는중.get(ck):
        return 빈값                      # 이미 누가 받는 중 — 줄 서지 않는다

    _받는중[ck] = True
    try:
        결과 = 받기()
    finally:
        _받는중.pop(ck, None)
    if not 결과:
        빈손_표시(ck, miss_ttl)
    return 결과 or 빈값


#: 기다려 주는 상한. 이보다 오래 걸리면 화면에 지난 값을 먼저 주고,
#: 받는 일은 뒤에서 계속한다.
WAIT_SEC = float(os.getenv("FETCH_WAIT_SEC", 4))


async def 캐시_우선_비동기(ck: str, 받기, 빈값, miss_ttl: "int | None" = None,
                           지난값=None, 담기=None, 대기: "float | None" = None):
    """같은 규칙의 async 판.

    `지난값` 은 캐시 밖에 따로 둔 지난 값이다 — 재무제표는 DB 에도 한 벌
    담아 두므로, 그것을 이미 꺼내 본 쪽에서 넘겨준다.

    `담기` 는 성공했을 때 어디에 담을지다. 담는 곳이 메모리 캐시 하나가
    아니라 DB 도 함께인 자리가 있어서 밖에서 받는다.

    `대기` 는 기다려 주는 상한이다. 넘기면 지난 값(또는 빈값)을 먼저
    돌려주고, 받는 일은 뒤에서 그대로 이어 간다. 재 보니 재무제표
    첫 요청이 18초였다 — 안쪽 timeout 이 30초라 원천이 죽어 있으면
    그만큼 사람을 붙잡고 있었다.

    shield 로 감싸는 것이 요점이다. 그냥 wait_for 하면 시간이 넘을 때
    작업까지 취소돼서, 애써 받던 것을 버리고 다음 사람이 처음부터
    다시 받는다. 감싸 두면 뒤에서 끝나 캐시에 담기고, 다음 사람은
    그것을 즉시 받는다.

    받기는 코루틴 함수여야 한다(호출하면 await 할 수 있는 것).
    """
    if (c := cache.get(ck)) is not None:
        return c

    stale = 지난값 if 지난값 is not None else cache.get_stale(ck)
    있는대로 = stale if stale is not None else 빈값

    if 빈손인가(ck):
        return 있는대로
    if _받는중.get(ck):
        # 이미 누가 받고 있다. 줄 서서 같은 것을 두 번 받지 않는다 —
        # 종목 상세는 탭 예닐곱 개가 한꺼번에 열리는 화면이다.
        return 있는대로

    _받는중[ck] = True

    async def _받아서_담기():
        """받고 담는 일 전체를 감싼다.

        `담기` 까지 감싸는 것이 요점이다. 예전에는 받기만 감쌌는데,
        담는 쪽은 DB 에 쓰는 자리가 있어서(재무제표) 거기서 터지면
        예외가 이 함수를 뚫고 나가 요청이 500 이 됐다. 이미 값은
        멀쩡히 받아 놓고서 화면에는 오류가 뜨는 셈이다.
        """
        try:
            결과 = await 받기()
            if 결과:
                if 담기:
                    try:
                        await 담기(결과)
                    except Exception as e:
                        # 담는 데 실패해도 받은 값은 내준다 —
                        # 다음번에 다시 받을 뿐이다
                        log.debug("담기 실패 %s: %s", ck, type(e).__name__)
                return 결과
        except Exception as e:
            log.debug("조회 실패 %s: %s", ck, type(e).__name__)
        finally:
            _받는중.pop(ck, None)
        빈손_표시(ck, miss_ttl)
        return None

    작업 = asyncio.ensure_future(_받아서_담기())
    상한 = WAIT_SEC if 대기 is None else 대기
    try:
        결과 = await asyncio.wait_for(asyncio.shield(작업), 상한)
    except asyncio.TimeoutError:
        # 기다리다 지쳤다. 빈손 표시는 여기서 안 남긴다 — 작업이 아직
        # 돌고 있고, _받는중 이 그대로라 뒤이어 들어오는 요청은 이미
        # 즉시 돌아간다. 작업이 실패로 끝나면 그때 위에서 남긴다.
        return 있는대로
    return 결과 if 결과 else 있는대로
