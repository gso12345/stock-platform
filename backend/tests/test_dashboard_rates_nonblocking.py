"""대시보드가 금리를 기다리지 않는다.

── 무엇이 문제였나 ─────────────────────────────────────────

금리(`get_kr_rates`·`get_us_rates`)는 캐시가 비어 있으면 그 자리에서
한국은행·네이버를 차례로 돈다. 찬 캐시에서 **20.8초**가 걸린다(실측).

라우트는 5초 상한을 걸어 뒀고, 상한은 제대로 듣는다. 그런데 상한에
걸리면 stale 폴백으로 빠지므로 **결국 빈 목록**이다. 첫 사람은 5초를
기다려서 아무것도 못 받는 셈이었다 — 기다림에 값이 하나도 없었다.

게다가 상한이 지나도 그 스레드는 20초를 마저 돈다. 0.15 CPU 서버에서
그 20초는 같은 때 들어온 다른 사람의 응답까지 늦춘다.

지수는 이미 '있는 것을 곧바로 주고 없으면 배경에서 채운다' 를 쓰고
있었다. 금리도 같게 맞췄다.

── 이 검사가 지키는 것 ─────────────────────────────────────

이 고침은 **망가져도 화면에 아무 표시가 안 난다.** 금리 칸은 어차피
비어 보이고 오류도 안 난다. 그냥 5초를 다시 기다릴 뿐이다. 그래서
'기다리지 않는다' 를 시간이 아니라 **행동**으로 못 박는다 —
받아오는 함수가 요청 안에서 불렸는가, 안 불렸는가.
"""
import asyncio
import time

import pytest

from app.api.routes import dashboard as D
from app.core.cache import cache


@pytest.fixture(autouse=True)
def _빈칸():
    """검사마다 깨끗한 데서 시작한다"""
    """신선한 칸과 **지난 값 칸** 을 둘 다 비운다.
    get_stale 은 따로 보관되므로 _store 만 비우면 앞 검사의 값이 남는다 —
    실제로 그 때문에 '빈손을 준다' 검사가 거짓으로 실패했다."""
    for k in ("extra:kr_rates", "extra:us_rates"):
        cache._store.pop(k, None)
        cache._stale.pop(k, None)
        cache._stale_bytes.pop(k, None)
    D._bg_refresh_in_flight.clear()
    yield
    D._bg_refresh_in_flight.clear()


class Test받아둔것만:
    def test_이미_받아_둔_것이_있으면_그걸_준다(self):
        cache.set("extra:kr_rates", [{"name": "기준금리", "value": 3.5}], 300)
        불림 = {"n": 0}

        def _채우기():
            불림["n"] += 1

        async def go():
            return D.받아둔것만("extra:kr_rates", _채우기, "kr_rates")

        나온것 = asyncio.run(go())
        assert 나온것 == [{"name": "기준금리", "value": 3.5}]
        assert 불림["n"] == 0, "캐시에 있는데도 새로 받아오려 했다"

    def test_없으면_기다리지_않고_빈손으로_준다(self):
        """여기가 이 고침의 전부다.

        받아오는 일이 20초짜리여도 요청은 곧바로 끝나야 한다."""
        느린가 = {"끝났나": False}

        def _느린채우기():
            time.sleep(3)
            느린가["끝났나"] = True

        async def go():
            t = time.perf_counter()
            나온것 = D.받아둔것만("extra:kr_rates", _느린채우기, "kr_rates")
            걸림 = time.perf_counter() - t
            """**돌아온 그 순간** 채우기가 아직 안 끝났어야 한다.

            이걸 asyncio.run 이 끝난 뒤에 보면 안 된다 — asyncio.run 은
            닫으면서 기본 실행기의 스레드가 끝나기를 기다리므로, 요청이
            기다리지 않았는데도 '끝났다' 로 보인다. 실제로 그렇게
            거짓 실패를 한 번 봤다."""
            아직인가 = not 느린가["끝났나"]
            await asyncio.sleep(0.05)
            return 나온것, 걸림, 아직인가

        나온것, 걸림, 아직인가 = asyncio.run(go())
        assert 나온것 == []
        assert 걸림 < 0.5, f"기다리고 있다 — {걸림:.2f}초"
        assert 아직인가, "요청이 채우기가 끝나기를 기다렸다"

    def test_없으면_배경에서_채운다(self):
        """기다리지 않는 대신 **다음 사람을 위해** 채워 둬야 한다.
        안 채우면 캐시가 영영 비어 금리가 한 번도 안 나온다."""
        채워짐 = {"n": 0}

        def _채우기():
            채워짐["n"] += 1

        async def go():
            D.받아둔것만("extra:kr_rates", _채우기, "kr_rates")
            for _ in range(50):          # 배경 작업이 끝날 때까지
                if 채워짐["n"]:
                    break
                await asyncio.sleep(0.02)

        asyncio.run(go())
        assert 채워짐["n"] == 1, "배경에서 채우지 않았다"

    def test_여러_명이_동시에_들어와도_한_번만_받아온다(self):
        """0.15 CPU 서버다. 열 명이 동시에 들어왔다고 바깥에 열 번
        물어보면 그것만으로 서버가 눕는다."""
        채워짐 = {"n": 0}

        def _채우기():
            time.sleep(0.2)
            채워짐["n"] += 1

        async def go():
            for _ in range(10):
                D.받아둔것만("extra:kr_rates", _채우기, "kr_rates")
            for _ in range(50):
                if 채워짐["n"]:
                    break
                await asyncio.sleep(0.02)
            await asyncio.sleep(0.1)

        asyncio.run(go())
        assert 채워짐["n"] == 1, f"{채워짐['n']}번 받아왔다 — 한 번이어야 한다"

    def test_지난_값이_있으면_빈손_대신_그걸_준다(self):
        """만료됐어도 어제 금리는 빈칸보다 낫다 —
        금리는 하루에 몇 번씩 바뀌는 값이 아니다."""
        지난것 = [{"name": "기준금리", "value": 3.5}]
        cache._stale["extra:kr_rates"] = 지난것

        async def go():
            return D.받아둔것만("extra:kr_rates", lambda: None, "kr_rates")

        assert asyncio.run(go()) == 지난것


class Test라우트가_금리를_안_기다린다:
    """함수만 보면 라우트가 그걸 실제로 쓰는지는 모른다.

    예전 코드는 `wait_for(run_in_executor(get_kr_rates), 5)` 로
    **기다리고 있었다.** 그 줄이 되살아나면 여기서 걸려야 한다."""

    def test_국내_해외_모두_요청_안에서_금리를_받아오지_않는다(self):
        import inspect
        for 이름, fn in (("국내", D.get_kr_dashboard), ("해외", D.get_us_dashboard)):
            소스 = inspect.getsource(fn)
            assert "받아둔것만(" in 소스, f"{이름} 대시보드가 받아둔것만() 을 안 쓴다"
            assert "run_in_executor(None, get_kr_rates" not in 소스, \
                f"{이름} 대시보드가 다시 금리를 기다린다"
            assert "run_in_executor(None, get_us_rates" not in 소스, \
                f"{이름} 대시보드가 다시 금리를 기다린다"
