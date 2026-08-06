"""
종목상세가 처음 열릴 때 4초를 그냥 버리던 것 —
"종목상세탭 정보 불러오는 속도 너무 느림"

detail 은 가격을 받은 뒤 밸류에이션 지표(PER·EPS·PEG 등)를 fund 캐시에서
채운다. 캐시가 없으면 yfinance 를 부르는데, 그걸 **동기로 최대 4초** 기다린
뒤에야 응답을 보냈다.

첫 조회에서도 지표가 바로 보이게 하려던 것이지만, 그 4초는 종목을 처음
여는 사람이 전부 문다 — 가격도 이름도 차트도 이미 준비됐는데 화면이 통째로
4초 늦게 뜬다. 지표 몇 개 때문에 화면 전체를 붙잡은 셈이다.

지금은 백그라운드로 채우고 응답을 먼저 보낸다. 화면 쪽이 detail 에 지표가
비면 fundamentals 를 따로 부르므로(StockDetail.tsx 의 기본지표가_비었나),
기다리지 않아도 지표는 곧 채워진다. 그 요청은 detail 과 나란히 나간다.

여기서 못 박는 것 —
  1) detail 경로에 지표를 기다리는 동기 대기가 없다
  2) 그래도 채우기는 한다 (백그라운드로)
  3) 캐시가 이미 있으면 그 자리에서 채운다 — 기다림이 없으니 뺄 이유가 없다
"""
import ast
import asyncio
import re
import time
from pathlib import Path

import pytest

_SRC = Path(__file__).resolve().parents[1] / "app" / "api" / "routes" / "stocks.py"


@pytest.fixture(scope="module")
def 상세본문() -> str:
    """get_stock_detail 함수 본문만."""
    본문 = _SRC.read_text(encoding="utf-8")
    i = 본문.index("async def get_stock_detail(")
    j = 본문.index('@router.get("/{market}/{symbol}/fundamentals")', i)
    return 본문[i:j]


def _본문에서_기다리는_await(함수소스: str) -> list[str]:
    """함수 본문에서 '지표를 기다리는' await 를 찾는다.

    글자로만 훑으면 `await _bg_fund_kr()` 같은 형태를 놓친다. 실제로
    겪었다 — 동기 대기로 되돌리는 변이가 검사를 그대로 통과했다.
    그래서 구문 트리로 본다: 중첩 함수 정의(백그라운드로 돌릴 몸통) 안은
    빼고, 바깥에 남은 await 중 지표와 얽힌 것만 센다."""
    나무 = ast.parse(함수소스)
    안쪽 = set()
    for n in ast.walk(나무):
        if isinstance(n, (ast.AsyncFunctionDef, ast.FunctionDef)) and n.name.startswith("_bg_"):
            for m in ast.walk(n):
                안쪽.add(id(m))

    걸린것 = []
    for n in ast.walk(나무):
        if not isinstance(n, ast.Await) or id(n) in 안쪽:
            continue
        조각 = ast.unparse(n)
        if "get_fundamentals" in 조각 or "_bg_fund" in 조각:
            걸린것.append(조각[:80])
    return 걸린것


class Test지표_때문에_화면을_붙잡지_않는다:
    def test_지표를_동기로_기다리지_않는다(self, 상세본문):
        """여기가 알맹이다. 지표를 await 로 붙잡는 자리가 남아 있으면,
        첫 조회는 여전히 그만큼 늦다."""
        # 들여쓰기된 함수라 그대로는 파싱이 안 된다 — 왼쪽을 맞춘다
        import textwrap
        걸린것 = _본문에서_기다리는_await(textwrap.dedent(상세본문))
        assert 걸린것 == [], f"아직 기다리는 자리가 있다: {걸린것}"

    def test_그래도_채우기는_한다(self, 상세본문):
        """기다림만 없애고 채우지도 않으면, 지표가 영영 캐시에 안 들어가
        매번 화면 쪽이 따로 요청해야 한다."""
        assert 상세본문.count("asyncio.create_task(_bg_fund") >= 2, (
            "국내·해외 양쪽에서 백그라운드로 채워야 한다")

    def test_백그라운드는_넉넉히_기다린다(self, 상세본문):
        """응답을 막지 않으니 4초로 조일 이유가 없다. 짧게 두면 느린
        종목은 영영 못 채우고 매번 다시 시도한다."""
        시간 = [int(m) for m in re.findall(r"timeout=(\d+)", 상세본문)]
        assert 시간, "타임아웃이 하나도 없다"
        # 백그라운드 쪽은 15초 이상
        assert max(시간) >= 15, f"백그라운드 타임아웃이 너무 짧다: {시간}"

    def test_채운_것을_캐시에_남긴다(self, 상세본문):
        """안 남기면 다음 사람도 똑같이 빈 응답을 받는다."""
        assert 'cache.set(f"fund:' in 상세본문 or "cache.set(fund_ck" in 상세본문

    def test_캐시가_있으면_그_자리에서_채운다(self, 상세본문):
        """캐시 적중은 기다림이 0이다. 그때까지 백그라운드로 미루면
        지표가 늘 한 박자 늦게 나타난다."""
        assert "_KR_FUND_KEYS" in 상세본문
        assert "_VALUATION_FIELDS" in 상세본문
        # 캐시에서 꺼내 바로 넣는 코드가 있어야 한다
        assert "fund_data.get(key)" in 상세본문 or "fund_cached.get(f)" in 상세본문


class Test가격은_그대로_받는다:
    def test_가격_조회까지_없애지_않았다(self, 상세본문):
        """지표를 미루는 것과 가격을 미루는 것은 다르다. 가격이 없으면
        보여줄 것이 없다."""
        assert "get_stock_price" in 상세본문 or "fetch_naver_stock" in 상세본문

    def test_가격과_지표를_같이_받는_길은_남겨_둔다(self, 상세본문):
        """캐시가 아무것도 없는 완전 첫 조회에서는 어차피 가격을 기다린다.
        그 김에 지표도 같이 받는 편이 낫다 — 병렬이라 더 안 걸린다."""
        assert "asyncio.gather" in 상세본문


def _응답까지(코루틴):
    """응답이 나올 때까지만 잰다.

    asyncio.run 은 코루틴이 끝난 뒤 남은 백그라운드 태스크를 취소하고
    기다린다. 그 시간까지 재면 '기다리지 않는다' 를 증명할 수 없다 —
    실제 서버는 루프가 계속 살아 있어 응답을 먼저 내보낸다."""
    루프 = asyncio.new_event_loop()
    try:
        결과 = 루프.run_until_complete(코루틴)
    finally:
        for t in asyncio.all_tasks(루프):
            t.cancel()
        루프.close()
    return 결과


def _가짜요청():
    """레이트리미터(slowapi)가 진짜 Request 를 요구한다. 최소한만 만든다."""
    from starlette.requests import Request
    return Request({
        "type": "http", "method": "GET", "path": "/", "headers": [],
        "query_string": b"", "client": ("127.0.0.1", 1),
        "app": None, "server": ("test", 80), "scheme": "http",
    })


class Test실제로_불러본다:
    """소스를 읽는 검사는 '조건을 False 로 바꾸는' 변이를 못 잡는다.
    캐시를 채워 놓고 진짜로 불러 본다."""

    @pytest.fixture
    def 국내가짜(self, monkeypatch):
        from app.api.routes import stocks as S

        async def _네이버(code6, *a, **kw):
            # 시세만 주고 재무지표는 안 준다 — 네이버 응답의 실제 모습이다
            return {"symbol": code6, "price": 72400, "prev_close": 71500,
                    "change_rate": 1.26, "name": "삼성전자", "currency": "KRW"}

        monkeypatch.setattr("app.services.price_fetcher.fetch_naver_stock", _네이버)
        S.cache.delete(f"price:005930")
        S.cache.delete(f"fund:005930")
        return S

    def test_fund_캐시가_있으면_EPS_가_응답에_담긴다(self, 국내가짜):
        """이게 비면 화면의 기본정보 EPS 가 끝까지 빈다."""
        S = 국내가짜
        S.cache.set("fund:005930", {"eps": 5521, "per": 13.1, "pbr": 1.2, "bps": 60000}, 600)

        r = _응답까지(S.get_stock_detail(request=_가짜요청(), market="KR", symbol="005930"))
        assert r.get("eps") == 5521, f"eps 가 안 담겼다: {r.get('eps')}"
        assert r.get("per") == 13.1
        assert r.get("pbr") == 1.2

    def test_fund_캐시가_없어도_빨리_돌아온다(self, 국내가짜, monkeypatch):
        """예전에는 여기서 4초를 기다렸다. 그 4초는 종목을 처음 여는
        사람이 전부 문다."""
        S = 국내가짜
        불린횟수 = []

        def _느린지표(*a, **kw):
            불린횟수.append(1)
            time.sleep(3)          # yfinance 가 느린 상황
            return {"eps": 1, "per": 2}

        monkeypatch.setattr(S.yf_service, "get_fundamentals", _느린지표)

        t = time.perf_counter()
        r = _응답까지(S.get_stock_detail(request=_가짜요청(), market="KR", symbol="005930"))
        걸린시간 = time.perf_counter() - t

        assert r.get("price") == 72400, "가격은 그대로 와야 한다"
        assert 걸린시간 < 1.5, f"지표를 기다리느라 {걸린시간:.1f}초 걸렸다"

    def test_네이버가_준_값을_덮어쓰지_않는다(self, monkeypatch):
        """캐시는 하루 묵을 수 있다. 실시간으로 받은 값이 있으면 그게 우선이다."""
        from app.api.routes import stocks as S

        async def _네이버(code6, *a, **kw):
            return {"symbol": code6, "price": 72400, "eps": 9999,
                    "name": "삼성전자", "currency": "KRW"}

        monkeypatch.setattr("app.services.price_fetcher.fetch_naver_stock", _네이버)
        S.cache.delete("price:005930")
        S.cache.set("fund:005930", {"eps": 1111}, 600)

        r = _응답까지(S.get_stock_detail(request=_가짜요청(), market="KR", symbol="005930"))
        assert r.get("eps") == 9999, "묵은 캐시가 실시간 값을 덮었다"
