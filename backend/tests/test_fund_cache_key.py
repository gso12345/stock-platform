"""
야후 단독 결과가 '보완까지 끝낸' 캐시를 덮던 것 —
"EPS 처음 들어갈 때 안뜸(재무제표 보면 뜸)"

캐시 키 `fund:{symbol}` 은 fundamentals_service 가 쓰는 자리다. 국내 종목은
야후에 trailingEps 가 없는 경우가 많아, 거기에 네이버의 per·eps·pbr·bps 를
병합해 넣는다(_fetch_fund). /fundamentals 엔드포인트가 돌려주는 것도 이 값이다.

그런데 yf_service.get_fundamentals 가 **같은 키에** 야후 단독 결과를 썼다.
그러면 fundamentals_service 는 `if fresh := cache.get(ck): return fresh` 로
그 오염된 값을 그대로 돌려준다 — 네이버 병합은 영영 안 돈다.

얄궂게도 _fetch_fund 자신이 yf_service.get_fundamentals 를 부른다. 즉 정식
경로조차 자기가 곧 병합해 덮을 키를 먼저 야후 단독값으로 쓰고 있었다.
게다가 stale 도 '있음' 으로 치므로 한 번 오염되면 스스로 유지된다.

그래서 야후 쪽은 자기 전용 키(fund_yf:)를 쓴다.

여기서 못 박는 것 —
  1) 두 캐시가 서로 다른 자리를 쓴다
  2) 야후를 먼저 불러도 /fundamentals 가 네이버 보완을 한다
  3) 국내 종목의 EPS 가 실제로 병합된 값으로 나온다
"""
import asyncio

import pytest

from app.core.cache import cache
from app.services import fundamentals_service as FS
from app.services.yf_service import yf_service


@pytest.fixture(autouse=True)
def _캐시비우기():
    for k in ("fund:005930", "fund:005930.KS", "fund_yf:005930", "fund_yf:005930.KS"):
        cache.delete(k)
    yield
    for k in ("fund:005930", "fund:005930.KS", "fund_yf:005930", "fund_yf:005930.KS"):
        cache.delete(k)


class Test두_캐시가_따로_산다:
    def test_야후는_자기_키에_쓴다(self):
        """공유 키에 쓰면 보완된 값을 덮는다."""
        import inspect
        본문 = inspect.getsource(yf_service.get_fundamentals)
        assert 'ck = f"fund_yf:' in 본문, "아직 공유 키(fund:)에 쓰고 있다"
        assert 'ck = f"fund:' not in 본문

    def test_정식_경로는_공유_키를_쓴다(self):
        """화면이 보는 값이다. 여기까지 바꾸면 아무도 못 읽는다."""
        import inspect
        본문 = inspect.getsource(FS.get_fundamentals)
        assert 'ck = f"fund:{symbol}"' in 본문


class Test오염이_사라졌다:
    def test_야후_단독값이_정식_응답을_가로채지_않는다(self, monkeypatch):
        """이게 이 파일의 알맹이다.

        예전에는 야후가 먼저 캐시를 채워 놓으면 /fundamentals 가 그걸
        그대로 돌려줬다 — eps 가 None 인 채로."""
        야후단독 = {"per": 12.3, "eps": None, "pbr": 1.1, "roe": 8.0}
        # 야후가 다녀간 상태를 만든다 (이제는 자기 키에 쓴다)
        cache.set("fund_yf:005930.KS", 야후단독, 600)

        네이버 = {"per": 13.1, "eps": 5521, "pbr": 1.2, "bps": 60000}

        async def _네이버(code6, *a, **kw):
            return 네이버

        monkeypatch.setattr("app.services.price_fetcher.fetch_naver_stock", _네이버)
        monkeypatch.setattr(yf_service, "get_fundamentals", lambda *a, **kw: 야후단독)
        # DB 캐시는 이 테스트의 관심사가 아니다
        monkeypatch.setattr(FS, "_db_get", lambda *a, **kw: None)
        monkeypatch.setattr(FS, "_db_set", lambda *a, **kw: None)

        r = asyncio.run(FS.get_fundamentals("005930", "KR"))
        assert r.get("eps") == 5521, f"네이버 보완이 안 돌았다: {r}"
        assert r.get("bps") == 60000

    def test_병합_결과가_공유_키에_남는다(self, monkeypatch):
        """다음 사람이 또 야후를 부르면 안 된다."""
        async def _네이버(code6, *a, **kw):
            return {"eps": 5521}

        monkeypatch.setattr("app.services.price_fetcher.fetch_naver_stock", _네이버)
        monkeypatch.setattr(yf_service, "get_fundamentals", lambda *a, **kw: {"roe": 8.0})
        monkeypatch.setattr(FS, "_db_get", lambda *a, **kw: None)
        monkeypatch.setattr(FS, "_db_set", lambda *a, **kw: None)

        asyncio.run(FS.get_fundamentals("005930", "KR"))
        남은것 = cache.get("fund:005930")
        assert 남은것 and 남은것.get("eps") == 5521

    def test_야후가_준_것도_같이_남는다(self, monkeypatch):
        """네이버는 재무지표만 준다. ROE·마진 같은 것은 야후 몫이라
        병합에서 빠지면 재무제표 탭이 빈다."""
        async def _네이버(code6, *a, **kw):
            return {"eps": 5521}

        monkeypatch.setattr("app.services.price_fetcher.fetch_naver_stock", _네이버)
        monkeypatch.setattr(yf_service, "get_fundamentals",
                            lambda *a, **kw: {"roe": 8.0, "op_margin": 15.2})
        monkeypatch.setattr(FS, "_db_get", lambda *a, **kw: None)
        monkeypatch.setattr(FS, "_db_set", lambda *a, **kw: None)

        r = asyncio.run(FS.get_fundamentals("005930", "KR"))
        assert r.get("eps") == 5521      # 네이버
        assert r.get("roe") == 8.0       # 야후
        assert r.get("op_margin") == 15.2

    def test_네이버가_이긴다(self, monkeypatch):
        """둘 다 per 을 주면 네이버 쪽이 국내 기준에 맞다."""
        async def _네이버(code6, *a, **kw):
            return {"per": 13.1}

        monkeypatch.setattr("app.services.price_fetcher.fetch_naver_stock", _네이버)
        monkeypatch.setattr(yf_service, "get_fundamentals", lambda *a, **kw: {"per": 99.9})
        monkeypatch.setattr(FS, "_db_get", lambda *a, **kw: None)
        monkeypatch.setattr(FS, "_db_set", lambda *a, **kw: None)

        r = asyncio.run(FS.get_fundamentals("005930", "KR"))
        assert r.get("per") == 13.1
