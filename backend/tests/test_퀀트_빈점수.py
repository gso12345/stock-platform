"""가치·모멘텀 점수가 비는 회사 — 사용자: "가치 모멘텀 성능이 안나오는 회사가 있어".

퀀트 점수는 펀더멘털(가치), 재무제표(품질·성장), 2년 시세(모멘텀·변동성)를 모아 매긴다.
하나라도 빈손이면 그 칸이 '—' 다. 빈손이 되던 길이 넷 있었다.

  1) 펀더멘털·재무제표는 화면 기본(4초)만 기다렸다 — 야후가 조금만 늦어도 빈 값으로 점수를 냈다.
     종목 상세의 다른 탭이 같은 펀더멘털을 받는 중이면 아예 안 기다리고 빈 값이었다.
  2) 그렇게 가치가 빈 지표도 30분 담아 뒀고, 시세만 있으면 DB 에 일주일 남겼다.
  3) 지난 값을 뒤에서 새로 받다 한쪽이 시한에 걸리면, 멀쩡하던 지표를 그 반쪽이 덮었다.
  4) 꼬리 없는 6자리 국내 코드에는 늘 '.KS' 를 붙였다 — 코스닥 종목은 야후가 빈손이라 모멘텀이 비었다.
"""
import asyncio
import threading
import time
import types

import pytest

from app.core import fetchcache as F
from app.core.cache import cache

비교 = "/api/v1/stocks/quant-score/compare"


def _돌리기(코루틴):
    return asyncio.run(코루틴)


async def _없음(*_a):
    return None


def _치우기(*심볼들):
    for s in 심볼들:
        for ck in (f"fund:{s}", f"financials:{s}", f"qmetrics:US:{s}", f"qmetrics:KR:{s}"):
            cache.delete(ck)
            F.잊기(ck)


def _점수(응답) -> dict:
    return {f["key"]: f["score"] for f in 응답.json()["items"][0]["factors"]}


#: 2년 시세 — 모멘텀 지표(1·3·6·12개월, 이평 이격도)가 다 나올 만큼 길게
_시세 = [{"date": f"d{i}", "open": 100.0 + i, "high": 101.0 + i, "low": 99.0 + i,
          "close": 100.0 + i, "volume": 1000} for i in range(300)]
_펀더 = {"per": 12.0, "pbr": 1.5, "market_cap": 1_000_000_000, "sector": "Technology"}
_재무 = [{"year": 2023, "revenue": 100, "net_income": 10, "op_income": 12, "eps": 1.0},
         {"year": 2024, "revenue": 120, "net_income": 13, "op_income": 15, "eps": 1.3, "roe": 14.0}]


@pytest.fixture
def 원천(monkeypatch):
    """펀더멘털·재무제표·2년 시세를 가짜로 준다(늦게 줄 수도 있다). DB 는 건너뛴다."""
    from app.services.fundamentals import fundamentals_service as FS
    from app.services.market.yf_service import yf_service
    상태 = {"펀더_늦음": 0.0, "재무_늦음": 0.0, "펀더_횟수": 0, "재무_횟수": 0,
            "펀더": dict(_펀더), "시세": list(_시세)}

    async def 펀더받기(symbol, market):
        상태["펀더_횟수"] += 1
        await asyncio.sleep(상태["펀더_늦음"])
        return dict(상태["펀더"])

    async def 재무받기(symbol, market):
        상태["재무_횟수"] += 1
        await asyncio.sleep(상태["재무_늦음"])
        return {"annual": [dict(r) for r in _재무], "quarterly": []}

    monkeypatch.setattr(FS, "_fetch_fund", 펀더받기)
    monkeypatch.setattr(FS, "_fetch_fin", 재무받기)
    monkeypatch.setattr(FS, "_run", lambda fn, *a: _없음())
    monkeypatch.setattr(yf_service, "get_ohlcv", lambda *a, **kw: 상태["시세"])
    return 상태


@pytest.fixture
def 표():
    from app.db.database import SessionLocal, Base, engine
    from app.models.stock import QuantMetricsCache

    def 비우기():
        db = SessionLocal()
        db.query(QuantMetricsCache).filter(QuantMetricsCache.symbol.like("QZ%")).delete(synchronize_session=False)
        db.commit(); db.close()

    Base.metadata.create_all(engine)
    비우기()
    yield
    비우기()


@pytest.fixture
def 손님(표):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.db.database import SessionLocal
    from app.models.user import User
    from app.core.security import create_access_token
    from app.api.routes.stocks import _공용 as C
    db = SessionLocal()
    me = db.query(User).filter(User.email == "퀀트빈점수@test").first()
    if not me:
        me = User(email="퀀트빈점수@test", username="퀀트빈점수", hashed_password="x")
        db.add(me); db.commit(); db.refresh(me)
    토큰 = create_access_token({"sub": str(me.id)})
    db.close()
    C.limiter._storage.reset()          # 비교는 분당 10번 — 다른 검사가 쓴 몫을 비운다
    yield TestClient(app), {"Authorization": f"Bearer {토큰}"}
    C.limiter._storage.reset()


def _남았나(종목: str, 시장: str = "US", 기다림: float = 2.0) -> dict:
    """비교는 응답과 따로(뒤에서) DB 에 남긴다 — 잠깐 기다려 본다"""
    from app.services.quant import quant_store as Q
    끝 = time.time() + 기다림
    while time.time() < 끝:
        if (읽음 := Q.여럿읽기([(종목, 시장)])):
            return 읽음
        time.sleep(0.05)
    return {}


# ── 1) 펀더멘털·재무제표를 기다린다 ──────────────────────────────
class Test펀더멘털을_기다린다:
    """화면 기본 대기(4초)를 0.2초로 줄이고 원천을 0.5초 뒤에 준다 — 야후가 4초보다 늦은 것과 같다."""

    @pytest.mark.parametrize("원천이름, 지표", [("펀더", "per"), ("재무", "revenue_growth")])
    def test_원천이_화면_대기보다_늦어도_빠지지_않는다(self, 원천, monkeypatch, 원천이름, 지표):
        from app.services.quant.quant_score import collect_quant_metrics
        monkeypatch.setattr(F, "WAIT_SEC", 0.2)
        원천[f"{원천이름}_늦음"] = 0.5
        _치우기("QZA")
        m = _돌리기(collect_quant_metrics("QZA", "US"))
        assert m.get(지표) is not None, f"{원천이름} 받기가 0.5초 늦었다고 {지표} 를 비웠다: {m}"
        assert m.get("per") == 12.0 and m.get("mom_3m") is not None

    def test_화면은_그대로_짧게_기다린다(self, 원천, monkeypatch):
        """퀀트만 오래 기다린다 — 종목 상세의 펀더멘털 탭은 예전처럼 곧 돌아오고 받기는 뒤에서 이어 간다."""
        from app.services.fundamentals import fundamentals_service as FS
        monkeypatch.setattr(F, "WAIT_SEC", 0.2)
        원천["펀더_늦음"] = 0.6
        _치우기("QZB")

        async def 재기():
            시작 = time.perf_counter()
            r = await FS.get_fundamentals("QZB", "US")
            걸림 = time.perf_counter() - 시작
            await asyncio.sleep(0.8)                 # 뒤에서 마저 받을 시간
            return r, 걸림

        r, 걸림 = _돌리기(재기())
        assert r == {} and 걸림 < 0.5, f"화면이 {걸림:.2f}초를 기다렸다"
        assert cache.get("fund:QZB") == _펀더, "뒤에서 받던 것을 안 담았다"

    @pytest.mark.parametrize("원천이름, 받기, 지표", [
        ("펀더", "get_fundamentals", "per"),
        ("재무", "get_financials", "revenue_growth"),
    ])
    def test_다른_탭이_받는_중이면_그것을_기다린다(self, 원천, 원천이름, 받기, 지표):
        """종목 상세는 탭 예닐곱 개가 한꺼번에 열린다. 펀더멘털 탭이 받는 사이에 퀀트 점수가 오면
        예전엔 기다리지 않고 빈 펀더멘털로 가치를 비웠다."""
        from app.services.fundamentals import fundamentals_service as FS
        from app.services.quant.quant_score import collect_quant_metrics
        원천[f"{원천이름}_늦음"] = 0.5
        _치우기("QZC")

        async def 둘():
            탭 = asyncio.ensure_future(getattr(FS, 받기)("QZC", "US"))
            await asyncio.sleep(0.05)
            m = await collect_quant_metrics("QZC", "US")
            await 탭
            return m

        m = _돌리기(둘())
        assert m.get(지표) is not None, f"다른 탭의 {원천이름} 받기를 안 기다렸다: {m}"
        assert 원천[f"{원천이름}_횟수"] == 1, "같은 것을 두 번 받으러 갔다"

    def test_종목_상세의_퀀트_점수에_가치가_나온다(self, 원천, 손님):
        """화면이 실제로 부르는 길 — 펀더멘털 탭이 받는 중(0.4초 뒤 끝남)에 퀀트 점수를 묻는다."""
        c, H = 손님
        _치우기("QZD")
        F._받는중["fund:QZD"] = time.time()

        def 탭이_다_받음():
            cache.set("fund:QZD", dict(_펀더), 60)
            F._받는중.pop("fund:QZD", None)

        threading.Timer(0.4, 탭이_다_받음).start()
        r = c.get("/api/v1/stocks/US/QZD/quant-score", headers=H)
        assert r.status_code == 200, r.text
        가치 = next(f for f in r.json()["factors"] if f["key"] == "value")
        assert 가치["score"] is not None, "다른 탭이 받는 사이에 들어온 퀀트 점수가 가치를 비웠다"
        assert 원천["펀더_횟수"] == 0, "받는 중인데 또 받으러 갔다"


# ── 2) 반쪽 지표를 붙잡지 않는다 ───────────────────────────────
class Test반쪽_가리기:
    def test_가치와_시세가_다_있어야_다_모은_것(self):
        from app.services.quant.quant_score import 지표가_반쪽인가 as 반쪽
        assert 반쪽({}, "US") and 반쪽(None, "US")
        assert 반쪽({"mom_3m": 4.0, "volatility": 20.0, "_sector": "Tech"}, "US"), "시세만 있는 것을 다 모았다고 봤다"
        assert 반쪽({"per": 12.0, "roe": 15.0}, "KR"), "시세가 빈 것을 다 모았다고 봤다"
        # 펀더멘털이 빈손이어도 재무제표가 품질 지표는 채운다 — 그것으로 다 모았다고 보면 가치가 '—' 로 굳는다
        assert 반쪽({"roe": 15.0, "debt_ratio": 80.0, "mom_3m": 4.0}, "US"), "가치 지표 없이 다 모았다고 봤다"
        assert 반쪽({"per": None, "mom_3m": 4.0}, "US"), "빈 칸(None)을 값으로 셌다"
        assert 반쪽({"per": float("nan"), "mom_3m": 4.0}, "US"), "NaN 을 값으로 셌다 — DB 에 남기면 빈 칸이 된다"
        assert not 반쪽({"per": 12.0, "mom_3m": 4.0, "roe": 15.0}, "US")
        assert not 반쪽({"pbr": 0.9, "mom_1m": -2.0, "revenue_growth": 8.0}, "KR")
        # 품질·성장이 다 빈 것 — 재무제표 조회가 빈손이었다. 남기면 일주일 동안 품질·성장 점수가 '—'
        # (사용자: "품질, 성장점수가 안나오는 종목이 있어")
        assert 반쪽({"per": 12.0, "mom_3m": 4.0}, "US"), "품질·성장이 빈 것을 다 모았다고 봤다"
        assert 반쪽({"per": 12.0, "mom_3m": 4.0, "roe": float("nan")}, "KR")

    def test_ETF_는_시세만_본다(self):
        from app.services.quant.quant_score import 지표가_반쪽인가 as 반쪽
        assert not 반쪽({"mom_3m": 4.0, "volatility": 20.0}, "ETF")
        assert 반쪽({"per": 20.0}, "ETF")


class Test반쪽은_붙잡지_않는다:
    def test_반쪽은_DB_에_안_남긴다(self, 표):
        from app.services.quant import quant_store as Q
        Q.저장("QZE", "US", {"mom_3m": 3.0, "volatility": 20.0, "roe": 9.0})    # 가치가 빈 것
        Q.저장("QZE", "KR", {"per": 9.0, "pbr": 1.1})                           # 시세가 빈 것
        Q.저장("QZE", "ETF", {"mom_3m": 3.0, "volatility": 20.0})               # ETF 는 시세면 됐다
        assert set(Q.여럿읽기([("QZE", "US"), ("QZE", "KR"), ("QZE", "ETF")])) == {("QZE", "ETF")}

    def test_가치_지표가_NaN_뿐이면_안_남긴다(self, 표):
        """남길 때 NaN 은 비워진다 — 남겨 두면 읽을 때 가치가 빈 반쪽이 돼 버려진다(남길 때와 판정이 갈린다)."""
        from app.services.quant import quant_store as Q
        Q.저장("QZL", "US", {"per": float("nan"), "mom_3m": 3.0, "roe": 9.0})
        assert Q.여럿읽기([("QZL", "US")]) == {}

    def test_예전에_남은_반쪽은_안_쓰고_새로_모은다(self, 원천, 손님):
        """고치기 전에는 시세만 있으면 DB 에 일주일 남겼다 — 가치가 빈 그 지표가 계속 점수가 됐다."""
        from datetime import datetime
        from app.db.database import SessionLocal
        from app.models.stock import QuantMetricsCache
        db = SessionLocal()
        db.add(QuantMetricsCache(symbol="QZG", market="US", fetched_at=datetime.utcnow(),
                                 data={"_sector": "Technology", "mom_3m": 3.0, "roe": 9.0}))
        db.commit(); db.close()
        _치우기("QZG")
        c, H = 손님
        r = c.get(비교, params={"symbols": "QZG", "markets": "US"}, headers=H)
        assert r.status_code == 200, r.text
        assert _점수(r)["value"] is not None, "예전에 남은 반쪽(가치가 빈 것)으로 답했다"
        assert 원천["펀더_횟수"] == 1
        assert _남았나("QZG")[("QZG", "US")][0]["per"] == 12.0, "새로 다 모은 것으로 고쳐 쓰지 않았다"

    def test_시세가_빈_지표는_잠깐만_두고_곧_다시_받는다(self, 원천, 손님, monkeypatch):
        from app.api.routes.stocks import _공용 as C
        c, H = 손님
        monkeypatch.setattr(C, "QMETRICS_PARTIAL_TTL", 1)
        _치우기("QZH")
        원천["시세"] = []                                  # 2년 시세가 시한에 걸렸다
        r = c.get(비교, params={"symbols": "QZH", "markets": "US"}, headers=H)
        점수 = _점수(r)
        assert 점수["momentum"] is None and 점수["value"] is not None
        assert _남았나("QZH", 기다림=0.5) == {}, "시세가 빈 반쪽을 DB 에 남겼다"
        time.sleep(1.1)
        assert cache.get("qmetrics:US:QZH") is None, "반쪽을 30분 담아 뒀다"

        원천["시세"] = list(_시세)                         # 야후가 돌아왔다
        c.get(비교, params={"symbols": "QZH", "markets": "US"}, headers=H)   # 지난 값으로 답하고 뒤에서 새로
        끝 = time.time() + 5
        while time.time() < 끝 and "mom_3m" not in (cache.get("qmetrics:US:QZH") or {}):
            time.sleep(0.05)
        r = c.get(비교, params={"symbols": "QZH", "markets": "US"}, headers=H)
        assert _점수(r)["momentum"] is not None, "시세가 돌아왔는데 모멘텀이 여전히 비었다"
        assert ("QZH", "US") in _남았나("QZH"), "다 모은 것은 남겨야 한다"

    def test_다_모은_것은_30분_둔다(self, 원천, 손님, monkeypatch):
        from app.api.routes.stocks import _공용 as C
        c, H = 손님
        monkeypatch.setattr(C, "QMETRICS_PARTIAL_TTL", 1)
        _치우기("QZI")
        c.get(비교, params={"symbols": "QZI", "markets": "US"}, headers=H)
        time.sleep(1.1)
        assert cache.get("qmetrics:US:QZI") is not None, "다 모은 것까지 반쪽처럼 곧 버렸다"

    def test_뒤에서_새로_받다_시세가_비어도_멀쩡하던_점수를_안_덮는다(self, 원천, 표, monkeypatch):
        from app.api.routes.stocks import _공용 as C
        from app.core import executor as E
        monkeypatch.setattr(E.background_executor, "submit", lambda fn, *a, **kw: fn(*a, **kw))
        _치우기("QZJ")
        ck = "qmetrics:US:QZJ"
        cache.set(ck, {"_sector": "Technology", "per": 11.0, "pbr": 1.2, "mom_3m": 5.0, "mom_12m": 20.0}, -1)
        원천["시세"] = []                                  # 이번엔 2년 시세가 시한에 걸렸다
        원천["펀더"] = {"per": 12.0, "pbr": 1.5}            # 업종도 이번엔 못 받았다
        C._퀀트지표_뒤로미루기("QZJ", "US", ck)
        담긴것 = cache.get(ck)
        assert 담긴것 is not None
        assert 담긴것["mom_3m"] == 5.0 and 담긴것["mom_12m"] == 20.0, "멀쩡하던 모멘텀을 반쪽이 덮었다"
        assert 담긴것["per"] == 12.0, "새로 받은 가치 지표를 안 썼다"
        assert 담긴것["_sector"] == "Technology", "새로 못 받은 칸(None)이 지난 값을 지웠다"
        assert _남았나("QZJ", 기다림=0.3) == {}, "지난 값으로 채운 것을 새로 다 받은 것처럼 남겼다"

    def test_처음_모은_지표에서_업종이_안_빠진다(self, 원천, 손님):
        """업종이 빠지면 다음 번엔 PER·PBR 을 업종 안에서가 아니라 시장 전체와 비교한다 — 가치 점수가 바뀐다."""
        c, H = 손님
        _치우기("QZK")
        c.get(비교, params={"symbols": "QZK", "markets": "US"}, headers=H)
        assert cache.get("qmetrics:US:QZK")["_sector"] == "Technology", "점수를 매기다 담긴 지표에서 업종을 지웠다"


# ── 4) 코스닥 꼬리 ────────────────────────────────────────────
class Test국내_꼬리:
    """꼬리 없는 6자리 코드(스크리닝 표의 관심종목 담기 등이 이렇게 보낸다) — 종목 목록에서 시장을 찾는다."""

    def test_코스닥_종목에는_KQ_를_붙인다(self):
        from app.services.market.yf_service import _resolve_kr_symbol
        assert _resolve_kr_symbol("247540", "KS") == "247540.KQ", "에코프로비엠(코스닥)에 .KS 를 붙였다"
        assert _resolve_kr_symbol("005930", "KS") == "005930.KS"

    def test_모르는_코드는_예전처럼_KS(self):
        from app.services.market.yf_service import _resolve_kr_symbol
        assert _resolve_kr_symbol("999998", "KS") == "999998.KS"

    def test_꼬리가_있으면_그대로_둔다(self):
        from app.services.market.yf_service import _resolve_kr_symbol
        assert _resolve_kr_symbol("247540.KS", "KS") == "247540.KS"
        assert _resolve_kr_symbol("005930.KQ", "KS") == "005930.KQ"

    def test_새로_읽은_종목_목록을_따른다(self, monkeypatch):
        """내장 목록에 없는 코스닥 종목 — DB·pykrx 로 읽은 목록이 바뀌면 표도 다시 만든다."""
        from app.services.listings import ticker_service as T
        from app.services.market.yf_service import _resolve_kr_symbol
        assert _resolve_kr_symbol("990001", "KS") == "990001.KS"
        monkeypatch.setattr(T, "_kr_db", [
            {"s": "990001.KQ", "n": "가짜코스닥", "x": "KOSDAQ", "m": "KR", "c": "990001"},
            {"s": "990002", "n": "꼬리없는코스닥", "x": "KOSDAQ", "m": "KR"},
            {"s": "990003.KS", "n": "가짜코스피", "x": "KOSPI", "m": "KR", "c": "990003"},
        ])
        assert _resolve_kr_symbol("990001", "KS") == "990001.KQ", "새로 읽은 목록을 안 봤다"
        assert _resolve_kr_symbol("990002", "KS") == "990002.KQ", "거래소가 코스닥인데 꼬리가 없다고 .KS"
        assert _resolve_kr_symbol("990003", "KS") == "990003.KS"

    def test_목록을_못_읽어도_스크리닝_국내_목록은_맞힌다(self, monkeypatch):
        from app.services.listings import ticker_service as T
        from app.services.market.yf_service import _resolve_kr_symbol
        monkeypatch.setattr(T, "_kr_db", [])
        monkeypatch.setattr(T, "KR_TICKERS_BUILTIN", [])
        assert _resolve_kr_symbol("247540", "KS") == "247540.KQ"
        assert _resolve_kr_symbol("005930", "KS") == "005930.KS"

    def test_2년_시세를_코스닥_이름으로_받는다(self, monkeypatch):
        """모멘텀은 2년 시세에서 나온다 — 코스닥에 .KS 를 붙이면 야후가 빈손이다."""
        import pandas as pd
        from app.services.market import yf_service as Y
        받은이름 = []

        class 가짜종목:
            def __init__(self, 이름):
                받은이름.append(이름)

            def history(self, **_kw):
                return pd.DataFrame({"Open": [1.0], "High": [1.0], "Low": [1.0], "Close": [1.0], "Volume": [1]},
                                    index=pd.DatetimeIndex(["2026-10-16"]))

        monkeypatch.setattr(Y, "yf", types.SimpleNamespace(Ticker=가짜종목))
        for 꼬리 in (".KQ", ".KS"):
            cache.delete(f"ohlcv:247540{꼬리}:2y:1d")
        Y.yf_service.get_ohlcv("247540", "2y", "1d", "KR")
        assert 받은이름 == ["247540.KQ"]
        cache.delete("ohlcv:247540.KQ:2y:1d")

    def test_펀더멘털도_코스닥_이름으로_받는다(self, monkeypatch):
        from app.services.fundamentals import fundamentals_service as FS
        from app.services.market import price_fetcher as PF
        from app.services.market.yf_service import yf_service
        받은이름 = []

        async def 네이버(_code):
            return {}

        monkeypatch.setattr(PF, "fetch_naver_stock", 네이버)
        monkeypatch.setattr(yf_service, "get_fundamentals",
                            lambda s, m="US": 받은이름.append(s) or {"per": 30.0})
        r = _돌리기(FS._fetch_fund("247540", "KR"))
        assert 받은이름 == ["247540.KQ"] and r["per"] == 30.0
