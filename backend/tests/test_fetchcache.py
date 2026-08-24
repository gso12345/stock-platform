"""빈손도 기억한다 — 바깥에서 받아 오는 자리의 공통 규칙.

이 저장소에서 가장 자주 되풀이된 결함이다. 성공은 담아 두는데 실패는
안 담는다. 그래서 원천이 죽어 있는 동안은 캐시가 있어도 안 빨라진다.

서버를 띄워 재 본 값 (원천이 막힌 환경) —

    /stocks/KR/005930/financials    1회 5.4초 → 2회 2.6초   ← 고치기 전
                                    1회 4.0초 → 2회 0.006초 ← 고친 뒤

두 번째가 2.6초라는 것이 증거다. 캐시가 성공만 기억하고 있었다.
"""
import asyncio
import time

import pytest

from app.core import fetchcache as F
from app.core.cache import cache


@pytest.fixture(autouse=True)
def _비우기():
    for ck in ("시험:가", "시험:나"):
        cache.delete(ck)
        F.잊기(ck)
    F.잊기()
    yield
    F.잊기()


# ── 동기 판 ─────────────────────────────────────────────────
class Test동기:
    def test_담긴_것이_있으면_받으러_안_간다(self):
        cache.set("시험:가", ["담김"], 60)
        불린횟수 = {"n": 0}

        def _받기():
            불린횟수["n"] += 1
            return ["새것"]

        assert F.캐시_우선("시험:가", _받기, []) == ["담김"]
        assert 불린횟수["n"] == 0

    def test_빈손이면_그_사실을_담아_둔다(self):
        """여기가 핵심이다. 예전에는 빈손을 안 담아서 요청마다 다시 갔다."""
        불린횟수 = {"n": 0}

        def _받기():
            불린횟수["n"] += 1
            return []

        for _ in range(5):
            assert F.캐시_우선("시험:가", _받기, ["빈값"]) == ["빈값"]
        assert 불린횟수["n"] == 1, f"{불린횟수['n']}번 받으러 갔다 — 빈손을 안 담았다"

    def test_빈손_표시가_지나면_다시_받아_본다(self):
        """영영 안 물어보면 원천이 되살아나도 못 받는다."""
        불린횟수 = {"n": 0}

        def _받기():
            불린횟수["n"] += 1
            return []

        F.캐시_우선("시험:가", _받기, [], miss_ttl=1)
        F.캐시_우선("시험:가", _받기, [], miss_ttl=1)
        assert 불린횟수["n"] == 1
        time.sleep(1.1)
        F.캐시_우선("시험:가", _받기, [], miss_ttl=1)
        assert 불린횟수["n"] == 2

    def test_받아지면_빈손_표시를_안_남긴다(self):
        F.캐시_우선("시험:가", lambda: ["됨"], [])
        assert not F.빈손인가("시험:가")

    def test_지난_값이_있으면_그것을_즉시_주고_뒤에서_채운다(self):
        cache.set("시험:가", ["지난것"], 1)
        time.sleep(1.1)
        시작 = time.perf_counter()

        def _느리게():
            time.sleep(0.5)
            return ["새것"]

        결과 = F.캐시_우선("시험:가", _느리게, [])
        걸린시간 = time.perf_counter() - 시작
        assert 결과 == ["지난것"]
        assert 걸린시간 < 0.2, f"지난 값이 있는데 {걸린시간:.2f}초를 기다렸다"


# ── 비동기 판 ───────────────────────────────────────────────
def _돌리기(코루틴):
    return asyncio.run(코루틴)


class Test비동기:
    def test_빈손을_담아_둔다(self):
        불린횟수 = {"n": 0}

        async def _받기():
            불린횟수["n"] += 1
            return None

        async def _여러번():
            for _ in range(4):
                assert await F.캐시_우선_비동기("시험:가", _받기, {}) == {}

        _돌리기(_여러번())
        assert 불린횟수["n"] == 1, f"{불린횟수['n']}번 받으러 갔다"

    def test_기다림에_상한이_있다(self):
        """안쪽 timeout 이 30초라 원천이 죽어 있으면 그만큼 붙잡고 있었다."""
        async def _아주느리게():
            await asyncio.sleep(10)
            return {"늦음": 1}

        async def _한번():
            시작 = time.perf_counter()
            결과 = await F.캐시_우선_비동기("시험:가", _아주느리게, {"빈값": 1}, 대기=0.3)
            return time.perf_counter() - 시작, 결과

        걸린시간, 결과 = _돌리기(_한번())
        assert 걸린시간 < 1.5, f"{걸린시간:.2f}초를 기다렸다"
        assert 결과 == {"빈값": 1}

    def test_상한을_넘겨도_받던_것을_버리지_않는다(self):
        """shield 를 빼면 시간이 넘을 때 작업까지 취소된다. 그러면 애써
        받던 것을 버리고 다음 사람이 처음부터 다시 받는다."""
        끝났나 = {"v": False}

        async def _느리게():
            await asyncio.sleep(0.4)
            끝났나["v"] = True
            return {"값": 1}

        async def _한번():
            r = await F.캐시_우선_비동기("시험:가", _느리게, {}, 대기=0.1,
                                          담기=lambda x: _담기(x))
            await asyncio.sleep(0.6)          # 뒤에서 끝날 시간을 준다
            return r

        async def _담기(x):
            cache.set("시험:가", x, 60)

        첫결과 = _돌리기(_한번())
        assert 첫결과 == {}, "기다리지 않고 돌아와야 한다"
        assert 끝났나["v"], "받던 작업이 취소됐다 — shield 가 없다"
        assert cache.get("시험:가") == {"값": 1}, "뒤에서 끝난 것을 안 담았다"

    def test_겹쳐_들어와도_한_번만_받는다(self):
        """종목 상세는 탭 예닐곱 개가 한꺼번에 열리는 화면이다."""
        불린횟수 = {"n": 0}

        async def _받기():
            불린횟수["n"] += 1
            await asyncio.sleep(0.3)
            return {"값": 1}

        async def _여섯개():
            return await asyncio.gather(*[
                F.캐시_우선_비동기("시험:가", _받기, {}, 대기=1.0) for _ in range(6)])

        결과들 = _돌리기(_여섯개())
        assert 불린횟수["n"] == 1, f"같은 것을 {불린횟수['n']}번 받았다"
        assert 결과들[0] == {"값": 1}

    def test_받는_중에_들어온_요청은_지난_값을_받는다(self):
        cache.set("시험:가", {"지난것": 1}, 1)
        time.sleep(1.1)

        async def _받기():
            await asyncio.sleep(0.3)
            return {"새것": 1}

        async def _둘():
            첫째 = asyncio.ensure_future(
                F.캐시_우선_비동기("시험:가", _받기, {}, 대기=1.0))
            await asyncio.sleep(0.05)
            둘째 = await F.캐시_우선_비동기("시험:가", _받기, {}, 대기=1.0)
            return await 첫째, 둘째

        첫째, 둘째 = _돌리기(_둘())
        assert 첫째 == {"새것": 1}
        assert 둘째 == {"지난것": 1}, "줄 서서 기다렸다"

    def test_받아지면_담기를_부른다(self):
        담긴것 = {}

        async def _담기(r):
            담긴것.update(r)

        async def _한번():
            return await F.캐시_우선_비동기(
                "시험:가", lambda: _준다(), {}, 담기=_담기)

        async def _준다():
            return {"값": 7}

        assert _돌리기(_한번()) == {"값": 7}
        assert 담긴것 == {"값": 7}

    def test_담다가_터져도_받은_값은_내준다(self):
        """담는 쪽은 DB 에 쓰는 자리가 있다(재무제표). 거기서 터지면
        값은 멀쩡히 받아 놓고 화면에는 500 이 떴다."""
        async def _준다():
            return {"값": 3}

        async def _담다_터짐(r):
            raise RuntimeError("DB 고장")

        async def _한번():
            return await F.캐시_우선_비동기("시험:가", _준다, {}, 담기=_담다_터짐)

        assert _돌리기(_한번()) == {"값": 3}
        assert not F.빈손인가("시험:가"), "받아 놓고 빈손으로 쳤다"
        assert not F.받는중인가("시험:가"), "받는 중 표시가 안 지워졌다"

    def test_받기가_터져도_요청은_안_터진다(self):
        async def _터짐():
            raise RuntimeError("원천 고장")

        async def _한번():
            return await F.캐시_우선_비동기("시험:가", _터짐, {"빈값": 1})

        assert _돌리기(_한번()) == {"빈값": 1}
        assert F.빈손인가("시험:가"), "터진 것도 빈손으로 담아 둬야 한다"


class Test재무제표에_붙었는가:
    """규칙을 만들어 놓고 안 쓰면 아무 소용이 없다."""

    def test_같은_종목을_두_번_불러도_원천은_한_번만_본다(self, monkeypatch):
        import app.services.fundamentals_service as FS

        cache.delete("financials:005930")
        F.잊기("financials:005930")
        불린횟수 = {"n": 0}

        async def _가짜받기(symbol, market):
            불린횟수["n"] += 1
            await asyncio.sleep(0.05)
            return {"annual": [], "quarterly": []}      # 빈손

        monkeypatch.setattr(FS, "_fetch_fin", _가짜받기)
        monkeypatch.setattr(FS, "_run", lambda fn, *a: _없음())

        async def _두번():
            await FS.get_financials("005930", "KR")
            await FS.get_financials("005930", "KR")

        _돌리기(_두번())
        assert 불린횟수["n"] == 1, (
            f"빈손인데 {불린횟수['n']}번 받으러 갔다 — 실측 2회째가 2.6초였던 이유다")

    def test_펀더멘털도_마찬가지다(self, monkeypatch):
        import app.services.fundamentals_service as FS

        cache.delete("fund:005930")
        F.잊기("fund:005930")
        불린횟수 = {"n": 0}

        async def _가짜받기(symbol, market):
            불린횟수["n"] += 1
            return {}

        monkeypatch.setattr(FS, "_fetch_fund", _가짜받기)
        monkeypatch.setattr(FS, "_run", lambda fn, *a: _없음())

        async def _세번():
            for _ in range(3):
                await FS.get_fundamentals("005930", "KR")

        _돌리기(_세번())
        assert 불린횟수["n"] == 1


async def _없음():
    return None
