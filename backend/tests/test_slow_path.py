"""요청 경로가 오래 잡히던 자리들.

서버를 띄워 조각별로 재보고 알았다.

    지수 209ms · 순위 5ms · 금리 3ms · 선물 3ms · 환율 12,018ms
    → /dashboard/kr 전체 12,563ms

12.5초 중 12초가 환율 하나였다. 동시 5명으로 재보니 각자 28~30초가 나왔다 —
혼자면 12초인 일이다. 세 가지가 겹쳤다.

  1) 타임아웃이 없었다 (같은 gather 의 나머지 넷은 전부 걸려 있었다)
  2) 환율 하나 때문에 미국 금리 전체 배치를 요청 경로에서 돌렸다
  3) 중복 실행을 안 막아, 동시 접속자 수만큼 같은 배치가 동시에 돌았다

뉴스도 같은 병이었다 — 매 요청 2.8초인데 응답은 2바이트(빈 배열).
결과가 비면 담지 않으니 다음 요청이 또 49곳을 훑는다.

순위 쪽은 진작 제대로 하고 있었다(_bg_refresh_in_flight). 그 방식을 옮겼다.
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.cache import cache
from app.services import price_fetcher as pf
from app.services import news_service as ns


def 비우기():
    for k in ("extra:usdkrw", "extra:usdkrw:miss", "extra:us_rates",
              "news:kr", "news:kr:miss", "news:us", "news:us:miss"):
        cache.delete(k)
    pf._fx_배치 = None
    ns._refreshing.clear()


# ── 환율: 시간 상한 ────────────────────────────────────────
def _안_끝나는_배치(monkeypatch):
    """놓아 주기 전까지 안 끝나는 배치.

    time.sleep 을 쓰면 안 된다 — asyncio.run 이 닫힐 때 스레드가 끝나기를
    기다리므로, 함수는 0.2초에 돌아왔는데 검사는 30초를 잰다(실제로 겪었다).
    끝에서 풀어 줄 수 있게 만든다."""
    import threading
    문 = threading.Event()
    부른횟수 = []

    def 배치():
        부른횟수.append(1)
        문.wait(30)

    monkeypatch.setattr("app.services.market_extras._do_fetch_us_rates", 배치)
    return 문, 부른횟수


def test_늦으면_기다리지_않고_지난_값으로_답한다(monkeypatch):
    비우기()
    import time
    cache.set("extra:usdkrw", {"symbol": "USDKRW", "value": 1380.0}, 1)
    time.sleep(1.1)                                   # 신선하진 않지만 지난 값은 남는다

    문, _ = _안_끝나는_배치(monkeypatch)
    monkeypatch.setattr(pf, "FX_WAIT_SEC", 0.2)

    async def 재기():
        시작 = time.monotonic()
        결과 = await pf.get_usdkrw()
        return time.monotonic() - 시작, 결과

    try:
        걸린시간, 결과 = asyncio.run(재기())
    finally:
        문.set()

    assert 걸린시간 < 2, f"상한을 넘겨 {걸린시간:.1f}초를 잡았다"
    assert 결과["value"] == 1380.0, "지난 값이라도 줘야 한다"


def test_지난_값도_없으면_빈_값이라도_바로_준다(monkeypatch):
    비우기()
    import time
    문, _ = _안_끝나는_배치(monkeypatch)
    monkeypatch.setattr(pf, "FX_WAIT_SEC", 0.2)

    async def 재기():
        시작 = time.monotonic()
        결과 = await pf.get_usdkrw()
        return time.monotonic() - 시작, 결과

    try:
        걸린시간, 결과 = asyncio.run(재기())
    finally:
        문.set()

    assert 걸린시간 < 2, f"{걸린시간:.1f}초를 잡았다"
    assert 결과["value"] == 0                          # 지어내지는 않는다
    assert 결과["name"]                                 # 이름은 있어야 카드가 그려진다


def test_신선한_값이_있으면_아예_안_받는다(monkeypatch):
    비우기()
    cache.set("extra:usdkrw", {"symbol": "USDKRW", "value": 1380.0}, 300)
    부른횟수 = []
    monkeypatch.setattr("app.services.market_extras._do_fetch_us_rates",
                        lambda: 부른횟수.append(1))
    assert asyncio.run(pf.get_usdkrw())["value"] == 1380.0
    assert 부른횟수 == []


# ── 환율: 실패도 캐시한다 ──────────────────────────────────
def test_빈손이었으면_한동안_다시_안_묻는다(monkeypatch):
    """이게 없으면 요청이 올 때마다 12초짜리 배치를 새로 돌린다."""
    비우기()
    부른횟수 = []
    monkeypatch.setattr("app.services.market_extras._do_fetch_us_rates",
                        lambda: 부른횟수.append(1))

    asyncio.run(pf.get_usdkrw())
    asyncio.run(pf.get_usdkrw())
    asyncio.run(pf.get_usdkrw())

    assert len(부른횟수) == 1, f"세 번 다 받으러 갔다 ({len(부른횟수)}회)"
    assert cache.get("extra:usdkrw:miss")


def test_성공하면_실패표시를_남기지_않는다(monkeypatch):
    비우기()

    def 성공배치():
        cache.set("extra:usdkrw", {"symbol": "USDKRW", "value": 1385.0}, 300)

    monkeypatch.setattr("app.services.market_extras._do_fetch_us_rates", 성공배치)
    assert asyncio.run(pf.get_usdkrw())["value"] == 1385.0
    assert not cache.get("extra:usdkrw:miss")


def test_시간을_넘긴_것도_실패로_담아_둔다(monkeypatch):
    """안 담으면 늦는 동안 들어오는 요청이 전부 상한만큼 잡힌다.
    서버를 띄워 재보니 실제로 모든 요청이 정확히 3.0초였다."""
    비우기()
    문, 부른횟수 = _안_끝나는_배치(monkeypatch)
    monkeypatch.setattr(pf, "FX_WAIT_SEC", 0.2)

    import time
    async def 세번():
        걸린것 = []
        for _ in range(3):
            시작 = time.monotonic()
            await pf.get_usdkrw()
            걸린것.append(time.monotonic() - 시작)
        return 걸린것

    try:
        걸린것 = asyncio.run(세번())
    finally:
        문.set()

    assert len(부른횟수) == 1, f"{len(부른횟수)}번 받으러 갔다"
    assert 걸린것[1] < 0.05 and 걸린것[2] < 0.05, \
        f"두 번째부터는 즉시 답해야 한다: {[round(x,3) for x in 걸린것]}"
    assert cache.get("extra:usdkrw:miss")


def test_늦게라도_값이_오면_실패표시가_가리지_않는다(monkeypatch):
    """실패표시는 '새로 받으러 갈지' 만 정한다. 값이 생기면 그게 먼저다."""
    비우기()
    cache.set("extra:usdkrw:miss", True, 60)
    cache.set("extra:usdkrw", {"symbol": "USDKRW", "value": 1400.0}, 300)
    부른횟수 = []
    monkeypatch.setattr("app.services.market_extras._do_fetch_us_rates",
                        lambda: 부른횟수.append(1))
    assert asyncio.run(pf.get_usdkrw())["value"] == 1400.0
    assert 부른횟수 == []


def test_실패표시가_영원하지_않다():
    """언젠가는 다시 시도해야 한다 — 아니면 환율이 영영 안 뜬다."""
    assert 0 < pf.FX_MISS_TTL <= 300


# ── 환율: 동시에 들어와도 한 번만 ──────────────────────────
def test_동시에_다섯이_들어와도_배치는_한_번만(monkeypatch):
    """실측으로 혼자 12초인 일이 다섯이면 각자 30초가 됐다.
    다섯이 같은 배치를 동시에 돌려 서로를 느리게 만들었다."""
    비우기()
    부른횟수 = []
    import time

    def 조금느린배치():
        부른횟수.append(1)
        time.sleep(0.3)
        cache.set("extra:usdkrw", {"symbol": "USDKRW", "value": 1390.0}, 300)

    monkeypatch.setattr("app.services.market_extras._do_fetch_us_rates", 조금느린배치)
    monkeypatch.setattr(pf, "FX_WAIT_SEC", 5)

    async def 다섯이_동시에():
        return await asyncio.gather(*[pf.get_usdkrw() for _ in range(5)])

    결과 = asyncio.run(다섯이_동시에())
    assert len(부른횟수) == 1, f"{len(부른횟수)}번 돌았다 — 겹침을 안 막았다"
    assert all(r["value"] == 1390.0 for r in 결과)


def test_한_명이_시간을_넘겨도_남의_배치를_죽이지_않는다(monkeypatch):
    """shield 가 없으면 wait_for 가 시간을 넘길 때 감싼 것을 취소한다.
    먼저 들어온 사람이 시작해 둔 배치가 죽고, 아무도 못 받는다.

    스레드가 이미 돌기 시작했으면 취소가 안 먹으므로 차이가 안 난다.
    문제가 되는 것은 '아직 대기열에 있을 때' 다 — 0.15 CPU 에 스레드
    풀이 꽉 차 있으면 흔한 상황이고, 그때 취소되면 영영 안 돈다.
    그 상태를 그대로 만들어 본다."""
    비우기()
    아직안돈다 = asyncio.get_event_loop_policy().new_event_loop().create_future()

    async def 검사():
        대기중 = asyncio.get_running_loop().create_future()   # 아직 시작 안 한 일

        def 가짜실행기(executor, fn, *a):
            return 대기중

        monkeypatch.setattr(
            asyncio.get_running_loop(), "run_in_executor", 가짜실행기)
        monkeypatch.setattr(pf, "FX_WAIT_SEC", 0.05)

        await pf.get_usdkrw()                       # 시간을 넘겨 돌아온다

        # 배치가 살아 있어야 한다. 죽었으면 다음 사람이 또 처음부터 시작한다
        살았나 = not 대기중.cancelled()
        대기중.cancel()
        return 살았나

    assert asyncio.run(검사()), "성급한 사람의 타임아웃이 남의 배치를 죽였다"
    아직안돈다.cancel()


def test_이미_돌고_있는_배치는_그대로_이어_쓴다(monkeypatch):
    비우기()
    import time
    끝났나 = []

    def 배치():
        time.sleep(0.4)
        cache.set("extra:usdkrw", {"symbol": "USDKRW", "value": 1395.0}, 300)
        끝났나.append(1)

    monkeypatch.setattr("app.services.market_extras._do_fetch_us_rates", 배치)

    async def 성급한사람_뒤에_기다리는사람():
        monkeypatch.setattr(pf, "FX_WAIT_SEC", 0.05)
        await pf.get_usdkrw()                      # 시간을 넘겨 돌아온다
        await asyncio.sleep(0.6)                   # 배치는 계속 돈다
        return cache.get("extra:usdkrw")

    값 = asyncio.run(성급한사람_뒤에_기다리는사람())
    assert 끝났나
    assert 값 and 값["value"] == 1395.0


# ── 뉴스: 빈손이면 담아 둔다 ───────────────────────────────
def test_뉴스가_빈손이면_한동안_다시_안_훑는다(monkeypatch):
    """실측 2.8초/요청, 응답은 2바이트였다."""
    비우기()
    훑은횟수 = []

    def 빈손수집(feeds, limit, batch=None):
        훑은횟수.append(1)
        return []

    monkeypatch.setattr(ns, "_fetch_all_feeds", 빈손수집)
    assert ns.get_kr_news() == []
    assert ns.get_kr_news() == []
    assert ns.get_kr_news() == []
    assert len(훑은횟수) == 1, f"{len(훑은횟수)}번 훑었다"
    assert cache.get("news:kr:miss")


def test_뉴스를_받으면_실패표시를_안_남긴다(monkeypatch):
    비우기()
    monkeypatch.setattr(ns, "_fetch_all_feeds",
                        lambda f, l, batch=None: [{"title": "코스피 상승", "link": "u", "_ts": 1}])
    결과 = ns.get_kr_news()
    assert len(결과) == 1
    assert not cache.get("news:kr:miss")


def test_이미_훑는_중이면_줄_서지_않는다(monkeypatch):
    """재시작 직후 들어오는 요청마다 각자 49곳을 훑던 자리다."""
    비우기()
    훑은횟수 = []
    monkeypatch.setattr(ns, "_fetch_all_feeds",
                        lambda f, l, batch=None: 훑은횟수.append(1) or [])
    ns._refreshing["news:kr"] = True         # 누가 이미 훑는 중
    try:
        assert ns.get_kr_news() == []
        assert 훑은횟수 == []
    finally:
        ns._refreshing.clear()


def test_지난_값이_있으면_그걸_주고_갱신은_배경으로(monkeypatch):
    비우기()
    cache.set("news:kr", [{"title": "어제 기사", "link": "u", "_ts": 1}], 1)
    import time
    time.sleep(1.1)
    보낸것 = []
    monkeypatch.setattr(ns.background_executor, "submit",
                        lambda *a, **kw: 보낸것.append(a))
    시작 = time.monotonic()
    결과 = ns.get_kr_news()
    assert time.monotonic() - 시작 < 0.5
    assert 결과[0]["title"] == "어제 기사"
    assert 보낸것, "배경 갱신을 안 걸면 지난 값이 영영 안 바뀐다"
    ns._refreshing.clear()


def test_국내와_해외의_실패표시가_따로다(monkeypatch):
    비우기()
    monkeypatch.setattr(ns, "_fetch_all_feeds", lambda f, l, batch=None: [])
    ns.get_kr_news()
    assert cache.get("news:kr:miss")
    assert not cache.get("news:us:miss"), "국내가 실패했다고 해외까지 막으면 안 된다"


def test_뉴스_실패표시가_영원하지_않다():
    assert 0 < ns.NEWS_MISS_TTL <= 600


# ── 대시보드 경로에 상한이 걸려 있는가 ─────────────────────
def _대시보드본문() -> str:
    경로 = os.path.join(os.path.dirname(__file__), "..", "app", "api", "routes", "dashboard.py")
    본문 = open(경로, encoding="utf-8").read()
    return "\n".join(l for l in 본문.split("\n") if not l.strip().startswith("#"))


def test_한국_대시보드의_다섯_조각에_모두_상한이_있다():
    본문 = _대시보드본문()
    몸통 = 본문[본문.index("async def get_kr_dashboard"):]
    몸통 = 몸통[:몸통.index("results = await asyncio.gather")]
    assert 몸통.count("wait_for") >= 3
    assert "wait_for(_get_exchange_rate_async()" in 몸통, \
        "환율에만 상한이 없어서 화면 전체가 12초를 기다렸다"


def test_해외_대시보드의_환율에도_상한이_있다():
    본문 = _대시보드본문()
    몸통 = 본문[본문.index("async def get_us_dashboard"):]
    몸통 = 몸통[:몸통.index("gathered = await asyncio.gather")]
    assert "wait_for(_get_exchange_rate_async()" in 몸통


def test_따로_부르는_길에도_상한이_있다():
    """/kr/rates · /us/rates · /kr/extras 도 같은 함수를 부른다."""
    본문 = _대시보드본문()
    for 이름 in ("async def kr_rates", "async def us_rates", "async def kr_extras"):
        몸통 = 본문[본문.index(이름):]
        몸통 = 몸통[:몸통.index("\n@router")] if "\n@router" in 몸통 else 몸통[:600]
        assert "wait_for" in 몸통, f"{이름} 에 상한이 없다"


def test_묶음_하나가_늦어도_나머지는_준다():
    """셋을 한 번에 주려고 묶은 화면이라, 통째로 실패하면 카드 셋이
    동시에 사라진다."""
    본문 = _대시보드본문()
    몸통 = 본문[본문.index("async def kr_extras"):]
    몸통 = 몸통[:몸통.index("return {")+400]
    assert "return_exceptions=True" in 몸통
    assert "get_stale" in 몸통
