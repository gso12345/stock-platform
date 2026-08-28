"""
시세 묶음 조회 — '내 자산' 화면 전체가 매달려 있는 자리.

이 경로가 답해야 평가금액도, 보유 목록의 합계도, 배당 배지도 그려진다.
그런데 시간 상한이 아예 없었다. 실제로 재 보니 캐시에 없는 종목이 섞이면
**9초**가 걸렸다 — 배치 조회가 실패한 뒤 종목마다 단건으로 한 번씩 더
물어보기 때문이다. 그동안 화면은 통째로 뼈대다.

그리고 실패를 기억하지 않았다. 야후가 모르는 심볼 하나(상장폐지된 종목을
목록에 남겨 둔 사람)가 있으면 화면을 열 때마다 그 비용을 다시 문다.

여기서 못 박는 것 —

  1) 오래 걸려도 상한 안에서 돌아온다
  2) 상한을 넘겨도 받아 오는 일은 배경에 남는다(다음 요청 때 캐시에서 나온다)
  3) 못 받는 종목은 쉬게 둔다. 다만 영영 버리지는 않는다
  4) 무엇이 오든 요청한 순서·모양 그대로 돌려준다

값을 재지 않고 **구조**를 본다 — 실제 시간은 기계와 바깥 사정에 따라
흔들린다. 다만 상한 자체는 사람이 기다릴 만한 값인지 확인한다.
"""
import asyncio
import inspect

import pytest

from app.api.routes import watchlist as W
from app.core.cache import cache


@pytest.fixture(autouse=True)
def _치우기():
    """검사끼리 캐시·쉼표가 새지 않게."""
    for k in list(x["key"] for x in cache.keys_with_ttl()):
        if str(k).startswith("price:"):
            cache.delete(k)
    W.시세쉼.잊기()
    yield
    W.시세쉼.잊기()


def _부르기(symbols: str, markets: str):
    return asyncio.run(W.get_watchlist_prices_batch(symbols=symbols, markets=markets))


class Test상한:
    def test_상한이_사람이_기다릴_만하다(self):
        """30초짜리 상한은 상한이 없는 것과 같다."""
        assert 0 < W._시세_상한 <= 5

    def test_늦으면_받은_것만_주고_돌아온다(self, monkeypatch):
        """상한이 없던 시절에는 여기서 9초를 기다렸다."""
        monkeypatch.setattr(W, "_시세_상한", 0.05)

        async def 안오는것(_syms):
            await asyncio.sleep(5)
            return {}

        monkeypatch.setattr(W, "_yf_only", 안오는것)
        cache.set("price:AAPL", {"symbol": "AAPL", "price": 195.0, "change_rate": 1.0}, 60)

        나온것 = _부르기("AAPL,MSFT", "US,US")
        assert len(나온것) == 2
        # 캐시에 있던 것은 그대로 나온다
        assert 나온것[0]["price"] == 195.0
        # 못 받은 것은 비워서 온다 — 화면이 이 모양을 다룰 줄 안다
        assert 나온것[1]["symbol"] == "MSFT" and 나온것[1]["price"] is None

    def test_상한을_넘겨도_받아_오는_일은_배경에_남는다(self, monkeypatch):
        """여기서 취소하면 다음 요청도, 그다음 요청도 처음부터 돌아
        영영 캐시가 안 찬다 — 화면은 늘 3초를 기다리고 늘 빈손이다."""
        monkeypatch.setattr(W, "_시세_상한", 0.05)
        끝났나 = {"응": False}

        async def 늦게오는것(_syms):
            await asyncio.sleep(0.3)
            끝났나["응"] = True
            return {"MSFT": {"symbol": "MSFT", "price": 400.0, "change_rate": 0.5}}

        monkeypatch.setattr(W, "_yf_only", 늦게오는것)

        async def 돌리기():
            r = await W.get_watchlist_prices_batch(symbols="MSFT", markets="US")
            await asyncio.sleep(0.6)      # 배경 작업이 마칠 틈을 준다
            return r

        나온것 = asyncio.run(돌리기())
        assert 나온것[0]["price"] is None          # 이번 요청은 못 받았지만
        assert 끝났나["응"] is True, "취소돼 버렸다 — 다음 요청도 처음부터다"
        assert (cache.get("price:MSFT") or {}).get("price") == 400.0

    def test_shield_로_감쌌는지_소스로도_고정한다(self):
        본문 = inspect.getsource(W.get_watchlist_prices_batch)
        assert "wait_for" in 본문 and "shield" in 본문

    def test_다_있으면_바깥을_안_두드린다(self, monkeypatch):
        """캐시가 다 차 있으면 상한이고 뭐고 물어볼 일이 없다."""
        불렀나 = {"응": False}

        async def 부르면안되는것(_syms):
            불렀나["응"] = True
            return {}

        monkeypatch.setattr(W, "_yf_only", 부르면안되는것)
        cache.set("price:AAPL", {"symbol": "AAPL", "price": 195.0}, 60)
        cache.set("price:MSFT", {"symbol": "MSFT", "price": 400.0}, 60)

        나온것 = _부르기("AAPL,MSFT", "US,US")
        assert 불렀나["응"] is False
        assert [x["price"] for x in 나온것] == [195.0, 400.0]


class Test못받는종목은_쉬게_둔다:
    async def _빈손(self, _syms):
        return {}

    def test_연속으로_실패하면_한_회차에_묻는_수가_묶인다(self, monkeypatch):
        """상장폐지된 종목을 목록에 남겨 둔 사람이 매번 그 비용을 물면 안 된다.

        '그 종목을 영영 안 묻는다' 가 아니라 **한 회차에 바깥을 두드리는
        수가 되살림 칸으로 묶인다** 가 지켜야 할 성질이다. 영영 안 물으면
        되살아나도 안 돌아오기 때문이다(backoff 모듈의 설계 그대로)."""
        물어본것: list = []

        async def 세면서_빈손(syms):
            물어본것.append(list(syms))
            return {}

        monkeypatch.setattr(W, "_yf_only", 세면서_빈손)
        종목 = ",".join(f"Z{i}" for i in range(8))
        시장 = ",".join("US" for _ in range(8))

        for _ in range(W.시세쉼.쉼_기준):
            _부르기(종목, 시장)
        assert all(W.시세쉼.쉬는가(f"price:Z{i}") for i in range(8)), "연속 실패를 안 세고 있다"

        물어본것.clear()
        for _ in range(3):
            _부르기(종목, 시장)
        for 한회차 in 물어본것:
            assert len(한회차) <= W.시세쉼.되살림_칸, \
                f"쉬는데도 한 회차에 {len(한회차)}개를 물어봤다"

    def test_다_쉬어도_되살아날_길은_남긴다(self, monkeypatch):
        """전부 쉬는 중이라고 아무것도 안 물어보면, 원천이 되살아나도
        영영 안 돌아온다."""
        물어본것: list = []

        async def 세면서_빈손(syms):
            물어본것.append(list(syms))
            return {}

        monkeypatch.setattr(W, "_yf_only", 세면서_빈손)
        for _ in range(W.시세쉼.쉼_기준 + 3):
            _부르기("ZZZZ", "US")
        assert 물어본것, "한 종목이 쉬자 아무것도 안 물어보게 됐다"

    def test_쉬어도_모양은_그대로_돌려준다(self, monkeypatch):
        """빠뜨리면 화면이 그 종목 줄을 통째로 못 그린다."""
        monkeypatch.setattr(W, "_yf_only", self._빈손)
        for _ in range(W.시세쉼.쉼_기준 + 2):
            나온것 = _부르기("ZZZZ,AAAA", "US,US")
        assert [x["symbol"] for x in 나온것] == ["ZZZZ", "AAAA"]
        assert all(x["price"] is None for x in 나온것)

    def test_되면_쉼이_풀린다(self, monkeypatch):
        """되살아난 종목이 영영 안 돌아오면 안 된다.

        찔러보기는 배경으로 돈다. 그래서 되살아난 것을 **그 요청**이
        받아 보지는 못하고, 다음 요청이 캐시에서 줍는다. 대신 사람은
        되살아날지 어떨지 모르는 종목을 기다리지 않는다."""
        monkeypatch.setattr(W, "_yf_only", self._빈손)
        for _ in range(W.시세쉼.쉼_기준):
            _부르기("AAPL", "US")
        assert W.시세쉼.쉬는가("price:AAPL")

        async def 이제됨(syms):
            return {s: {"symbol": s, "price": 195.0, "change_rate": 1.0} for s in syms}

        monkeypatch.setattr(W, "_yf_only", 이제됨)

        async def 한번_찔러보기():
            r = await W.get_watchlist_prices_batch(symbols="AAPL", markets="US")
            await asyncio.sleep(0.2)          # 배경 찔러보기가 마칠 틈
            return r

        먼저 = asyncio.run(한번_찔러보기())
        assert 먼저[0]["price"] is None, "찔러보기를 기다리고 있다"
        assert not W.시세쉼.쉬는가("price:AAPL"), "성공했는데도 쉬는 채로 남았다"

        # 다음 요청은 캐시에서 곧바로 나온다
        나중 = _부르기("AAPL", "US")
        assert 나중[0]["price"] == 195.0

    def test_되살아나기를_기다리지_않는다(self, monkeypatch):
        """상장폐지된 종목 하나 때문에 멀쩡한 사람이 매번 상한을 꽉 채워
        기다리게 되면 안 된다 — 되살아날 확률이 낮은 쪽에 사람의 시간을
        쓰는 셈이다."""
        monkeypatch.setattr(W, "_시세_상한", 5)

        async def 아주늦게(_syms):
            await asyncio.sleep(3)
            return {}

        monkeypatch.setattr(W, "_yf_only", self._빈손)
        for _ in range(W.시세쉼.쉼_기준):
            _부르기("ZZZZ", "US")
        assert W.시세쉼.쉬는가("price:ZZZZ")

        monkeypatch.setattr(W, "_yf_only", 아주늦게)

        async def 재보기():
            import time
            t0 = time.monotonic()
            await W.get_watchlist_prices_batch(symbols="ZZZZ", markets="US")
            return time.monotonic() - t0

        걸린시간 = asyncio.run(재보기())
        assert 걸린시간 < 1.0, f"쉬는 종목을 {걸린시간:.1f}초나 기다렸다"

    def test_캐시에서_나온_것은_실패로_안_센다(self, monkeypatch):
        """물어보지도 않은 종목을 실패로 세면, 멀쩡한 종목이 쉬게 된다."""
        monkeypatch.setattr(W, "_yf_only", self._빈손)
        cache.set("price:AAPL", {"symbol": "AAPL", "price": 195.0}, 60)
        for _ in range(W.시세쉼.쉼_기준 + 2):
            _부르기("AAPL", "US")
        assert not W.시세쉼.쉬는가("price:AAPL")


class Test모양을_안_깨뜨린다:
    async def _빈손(self, _syms):
        return {}

    def test_요청한_순서_그대로(self, monkeypatch):
        monkeypatch.setattr(W, "_yf_only", self._빈손)
        cache.set("price:MSFT", {"symbol": "MSFT", "price": 400.0}, 60)
        나온것 = _부르기("AAPL,MSFT,NVDA", "US,US,US")
        assert [x["symbol"] for x in 나온것] == ["AAPL", "MSFT", "NVDA"]

    def test_시세_대상이_아닌_심볼도_자리를_지킨다(self, monkeypatch):
        """포트폴리오에는 '현금'·'금' 같은 한글 심볼이 들어 있다.
        빠뜨리면 화면이 그 줄을 못 그린다."""
        monkeypatch.setattr(W, "_yf_only", self._빈손)
        나온것 = _부르기("현금,AAPL", "KR,US")
        assert [x["symbol"] for x in 나온것] == ["현금", "AAPL"]

    def test_빈_요청은_빈_목록(self):
        assert _부르기(",", "US") == []

    def test_너무_많이_물어보면_거절한다(self):
        from fastapi import HTTPException
        많이 = ",".join(f"S{i}" for i in range(51))
        with pytest.raises(HTTPException) as e:
            _부르기(많이, "US")
        assert e.value.status_code == 400


class Test화면도_같이_고쳤다:
    """서버가 못 채운 것을 화면이 다시 안 물어보면, 그 종목은 영영 빈다."""

    @staticmethod
    def _포트폴리오():
        from pathlib import Path
        p = Path(__file__).resolve().parents[2] / "frontend" / "src" / "pages" / "Portfolio.tsx"
        return p.read_text(encoding="utf-8")

    def test_못_받은_종목이_남으면_다시_물어본다(self):
        본문 = self._포트폴리오()
        assert "재촉주기" in 본문 and "p?.price == null" in 본문

    def test_재촉에_끝이_있다(self):
        """영영 못 받는 종목이 섞여 있으면 3초마다 영원히 두드리게 된다 —
        서버를 제일 세게 때리는 짓이고, 그런다고 값이 생기지도 않는다."""
        본문 = self._포트폴리오()
        assert "재촉_횟수" in 본문 and "dataUpdateCount" in 본문

    def test_배당이_시세를_안_기다린다(self):
        """예전에는 보유 목록 → 시세 → 배당 으로 요청이 줄지어 나갔다.
        한 칸이 한국↔싱가포르 왕복이라 배지가 뜨기까지 왕복 셋이 쌓였다.

        그 뒤 이 조회는 공용 훅(use배당달력)으로 옮겼다 — 배당 탭과
        배지가 옵션까지 같은 것을 쓰게 하려는 것이었다. 그래서 여기서는
        '부르는 자리에 시세 조건이 안 붙었는가' 를 본다."""
        본문 = self._포트폴리오()
        시작 = 본문.index("use배당달력(")
        토막 = 본문[시작:시작 + 300]
        assert "pricesLoading" not in 토막, "배당이 아직 시세를 기다린다"


class Test같은_것을_두_번_안_받는다:
    """상한을 걸면서 새로 생긴 문제다.

    3초에 끊고 돌려보내는데 화면은 몇 초 뒤 다시 물어본다. 그 사이 앞의
    조회가 아직 안 끝났으면, 같은 종목을 받아 오는 일이 둘·셋 겹쳐 돈다 —
    야후 입장에서는 같은 질문을 여러 번 받는 셈이고, 이 서버 입장에서는
    스레드가 그만큼 묶인다. 상한을 건 뜻이 반대로 뒤집힌다.
    """

    def test_겹쳐_들어와도_바깥은_한_번만_두드린다(self, monkeypatch):
        monkeypatch.setattr(W, "_시세_상한", 0.05)
        횟수 = {"n": 0}

        async def 늦게(syms):
            횟수["n"] += 1
            await asyncio.sleep(0.4)
            return {s: {"symbol": s, "price": 1.0} for s in syms}

        monkeypatch.setattr(W, "_yf_only", 늦게)

        async def 세번_겹쳐():
            await asyncio.gather(
                W.get_watchlist_prices_batch(symbols="AAPL,MSFT", markets="US,US"),
                W.get_watchlist_prices_batch(symbols="AAPL,MSFT", markets="US,US"),
                W.get_watchlist_prices_batch(symbols="AAPL,MSFT", markets="US,US"),
            )
            await asyncio.sleep(0.6)

        asyncio.run(세번_겹쳐())
        assert 횟수["n"] == 1, f"같은 묶음을 {횟수['n']}번 받아 왔다"

    def test_끝난_뒤에는_다시_받는다(self, monkeypatch):
        """한 번 받고 끝이면 값이 영영 안 새로워진다."""
        횟수 = {"n": 0}

        async def 빨리(syms):
            횟수["n"] += 1
            return {}

        monkeypatch.setattr(W, "_yf_only", 빨리)
        _부르기("AAPL", "US")
        _부르기("AAPL", "US")
        assert 횟수["n"] == 2

    def test_끝나면_자리를_치운다(self, monkeypatch):
        """안 치우면 종목 조합마다 한 칸씩 쌓인다 — 사람마다 보유 종목이
        다르므로 조합은 사실상 무한하다."""
        async def 빨리(syms):
            return {}

        monkeypatch.setattr(W, "_yf_only", 빨리)
        _부르기("AAPL", "US")
        assert not [t for t in W._받는중.values() if not t.done()], \
            f"끝난 일이 {len(W._받는중)}칸 남아 있다"

    def test_다른_묶음은_따로_돈다(self, monkeypatch):
        """관심종목과 내 자산이 서로 다른 종목을 보는데 하나로 묶이면 안 된다."""
        본것: list = []

        async def 기록(syms):
            본것.append(tuple(sorted(syms)))
            return {}

        monkeypatch.setattr(W, "_yf_only", 기록)
        _부르기("AAPL", "US")
        _부르기("MSFT", "US")
        assert 본것 == [("AAPL",), ("MSFT",)]
