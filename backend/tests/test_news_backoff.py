"""계속 실패하는 언론사는 뒤로 물린다.

실패 이유를 화면에 띄우고 나서야 규모가 보였다 — 국내 49곳 중 36곳이
38회 연속 실패 중이었다. 그런데 고르는 코드는 실패 이력을 전혀 안 봐서,
회차당 14칸 중 열 칸이 38번 연속 실패한 곳으로 갔다.

    살아 있는 곳 13 / 전체 49 → 한 회차 14칸 중 기대값 3.7칸

살아 있는 13곳이 3~4회차에 한 번(약 17분)씩만 갱신됐고, 회차 예산
40초를 죽은 곳이 먼저 써 버려 살아 있는 곳까지 버려졌다.
"""
import os
import sys
from concurrent.futures import Future

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services import news_service as ns


def _fastapi있나() -> bool:
    import importlib.util
    return importlib.util.find_spec("fastapi") is not None


def 초기화():
    ns._연속실패.clear()
    ns._feed_cursor.clear()


def 피드(n, 앞머리="매체"):
    return [(f"{앞머리}{i}", f"https://ex.test/{i}") for i in range(n)]


# ── 고르는 규칙 ────────────────────────────────────────────
def test_실패이력이_없으면_예전처럼_순서대로():
    초기화()
    목록 = 피드(10)
    첫판 = ns._next_batch(목록, 4)
    둘판 = ns._next_batch(목록, 4)
    assert [n for n, _ in 첫판] == ["매체0", "매체1", "매체2", "매체3"]
    assert [n for n, _ in 둘판] == ["매체4", "매체5", "매체6", "매체7"]


def test_한바퀴_돌면_모두_한_번씩():
    초기화()
    목록 = 피드(9)
    본것 = []
    for _ in range(3):
        본것 += [n for n, _ in ns._next_batch(목록, 3)]
    assert sorted(본것) == sorted(n for n, _ in 목록)


def test_묶음이_목록보다_크면_전부():
    초기화()
    목록 = 피드(5)
    assert len(ns._next_batch(목록, 14)) == 5


def test_쉬는곳은_거의_안_고른다():
    """실제 상황 — 49곳 중 36곳이 쉬는 중, 회차당 14칸."""
    초기화()
    목록 = 피드(49)
    for 이름, _ in 목록[13:]:                    # 36곳을 쉬게 만든다
        ns._연속실패[이름] = 38

    고른것 = [n for n, _ in ns._next_batch(목록, 14)]
    사는곳 = {n for n, _ in 목록[:13]}
    산것 = [n for n in 고른것 if n in 사는곳]

    assert len(고른것) == 14
    assert len(산것) == 12                       # 예전에는 기대값 3.7칸이었다
    assert len(고른것) - len(산것) == ns._되살림_칸


def test_쉬는곳도_돌아가며_다시_찔러본다():
    """지워 버리면 언론사가 주소를 되살려도 영영 안 온다."""
    초기화()
    목록 = 피드(20)
    for 이름, _ in 목록[5:]:
        ns._연속실패[이름] = 10

    본것 = set()
    for _ in range(30):                          # 15곳 ÷ 2칸 = 8회차면 한 바퀴
        본것 |= {n for n, _ in ns._next_batch(목록, 6)}
    assert 본것 == {n for n, _ in 목록}          # 쉬는 곳도 전부 한 번씩


def test_전부_쉬는_중이면_예전처럼_돈다():
    """빈 목록을 주면 뉴스가 통째로 멈추고 되살아날 길도 막힌다."""
    초기화()
    목록 = 피드(10)
    for 이름, _ in 목록:
        ns._연속실패[이름] = 99
    고른것 = ns._next_batch(목록, 4)
    assert len(고른것) == 4


def test_찔러보는_칸이_묶음을_다_먹지_않는다():
    """묶음이 1칸일 때도 살아 있는 곳이 한 칸은 있어야 한다."""
    초기화()
    목록 = 피드(10)
    for 이름, _ in 목록[1:]:
        ns._연속실패[이름] = 9
    고른것 = [n for n, _ in ns._next_batch(목록, 1)]
    assert 고른것 == ["매체0"]


def test_쉬는곳이_없으면_찔러보는_칸도_없다():
    초기화()
    목록 = 피드(10)
    assert len(ns._next_batch(목록, 5)) == 5


def test_사는곳이_묶음보다_적으면_남는_칸은_쉬는곳으로():
    """13곳뿐인데 14칸이면, 남는 칸이 헛돌지 않게 쉬는 곳을 더 본다."""
    초기화()
    목록 = 피드(20)
    for 이름, _ in 목록[3:]:
        ns._연속실패[이름] = 9
    고른것 = ns._next_batch(목록, 6)
    assert len(고른것) == 3 + ns._되살림_칸


# ── 자리(커서) ─────────────────────────────────────────────
def test_사는곳과_쉬는곳의_자리가_섞이지_않는다():
    초기화()
    목록 = 피드(12)
    for 이름, _ in 목록[4:]:
        ns._연속실패[이름] = 9
    ns._next_batch(목록, 5)
    assert "kr:live" not in ns._feed_cursor      # 임시 목록은 자기 자리를 쓴다
    자리들 = set(ns._feed_cursor)
    assert any(k.endswith(":live") for k in 자리들)
    assert any(k.endswith(":rest") for k in 자리들)


def test_국내와_해외는_다른_자리를_쓴다():
    초기화()
    ns._next_batch(ns.KR_FEEDS, 5)
    ns._next_batch(ns.US_FEEDS, 3)
    assert "kr:live" in ns._feed_cursor or "kr" in ns._feed_cursor
    assert "us:live" in ns._feed_cursor or "us" in ns._feed_cursor


def test_임시목록의_번지를_열쇠로_쓰지_않는다():
    """예전에는 id(목록) 이 열쇠였다. 그때그때 걸러 만든 목록은
    회차마다 번지가 달라지고, 버려진 목록의 번지를 물려받으면
    엉뚱한 자리에서 이어 간다."""
    초기화()
    목록 = 피드(12)
    for 이름, _ in 목록[4:]:
        ns._연속실패[이름] = 9
    ns._next_batch(목록, 5)
    assert all(isinstance(k, str) for k in ns._feed_cursor)


# ── 실패 셈 ────────────────────────────────────────────────
def test_성공하면_셈이_0으로():
    초기화()
    ns._실패기록("가", True)
    ns._실패기록("가", True)
    assert ns._연속실패["가"] == 2
    ns._실패기록("가", False)
    assert ns._연속실패["가"] == 0
    assert not ns._쉬는가("가")


def test_기준에_닿아야_쉰다():
    초기화()
    for _ in range(ns._쉼_기준 - 1):
        ns._실패기록("가", True)
    assert not ns._쉬는가("가")
    ns._실패기록("가", True)
    assert ns._쉬는가("가")


def test_한두번_흔들린_것으로는_안_쉰다():
    초기화()
    ns._실패기록("가", True)
    ns._실패기록("가", True)
    assert not ns._쉬는가("가")


# ── 실제 수집 흐름 ─────────────────────────────────────────
class _가짜퓨처(Future):
    pass


def _끝난것(값=None, 예외=None):
    f = _가짜퓨처()
    if 예외 is not None:
        f.set_exception(예외)
    else:
        f.set_result(값)
    return f


def _수집돌리기(monkeypatch, 결과: dict, 묶음=None):
    """_parse_feed 를 갈아 끼우고 _fetch_all_feeds 를 돌린다."""
    def 가짜파싱(url, source, limit):
        r = 결과[source]
        if isinstance(r, Exception):
            raise r
        return r

    class 즉시실행기:
        def submit(self, fn, *a, **kw):
            try:
                return _끝난것(fn(*a, **kw))
            except Exception as e:                # noqa: BLE001
                return _끝난것(예외=e)

    monkeypatch.setattr(ns, "_parse_feed", 가짜파싱)
    monkeypatch.setattr(ns, "_feed_executor", 즉시실행기())
    목록 = [(이름, f"https://ex.test/{이름}") for 이름 in 결과]
    return ns._fetch_all_feeds(목록, 5, batch=묶음 or len(결과))


def test_실패하면_셈이_쌓이고_성공하면_지워진다(monkeypatch):
    초기화()
    _수집돌리기(monkeypatch, {"가": ns.피드실패("HTTP 404 — 없는 주소(경로 변경)"),
                             "나": [{"title": "t"}]})
    assert ns._연속실패["가"] == 1
    assert ns._연속실패["나"] == 0

    _수집돌리기(monkeypatch, {"가": [{"title": "t"}],
                             "나": ns.피드실패("HTTP 500")})
    assert ns._연속실패["가"] == 0
    assert ns._연속실패["나"] == 1


def test_기사는_받았는데_키워드에_안_걸린_것은_실패가_아니다(monkeypatch):
    """피드는 멀쩡하다. 여기서 실패로 세면 경제 기사가 뜸한 언론사가
    통째로 목록에서 빠진다."""
    초기화()
    ns._연속실패["가"] = 3
    _수집돌리기(monkeypatch, {"가": ns.피드실패("기사 40건 중 통과 0건")})
    assert ns._연속실패["가"] == 0
    assert not ns._쉬는가("가")


def test_모르는_예외도_실패로_센다(monkeypatch):
    초기화()
    _수집돌리기(monkeypatch, {"가": ValueError("엉뚱한 것")})
    assert ns._연속실패["가"] == 1


def test_다섯번_실패하면_다음_회차부터_거의_안_고른다(monkeypatch):
    """끝에서 끝까지 — 실패가 쌓이면 실제로 칸을 안 먹는지."""
    초기화()
    죽은곳 = {f"죽은{i}": ns.피드실패("HTTP 404 — 없는 주소(경로 변경)") for i in range(8)}
    산곳 = {f"산{i}": [{"title": "t"}] for i in range(4)}
    결과 = {**산곳, **죽은곳}

    for _ in range(ns._쉼_기준):
        _수집돌리기(monkeypatch, 결과)

    목록 = [(이름, f"https://ex.test/{이름}") for 이름 in 결과]
    고른것 = [n for n, _ in ns._next_batch(목록, 6)]
    assert sum(1 for n in 고른것 if n.startswith("산")) == 4
    assert sum(1 for n in 고른것 if n.startswith("죽은")) == ns._되살림_칸


# ── 회차 예산을 넘긴 곳 ────────────────────────────────────
def test_예산_안에_못_끝낸_곳도_실패로_남긴다(monkeypatch):
    """예전에는 아무 기록이 없어 '되고 있는 줄' 알았고, 연속 실패도
    안 쌓여 매 회차 칸만 먹었다."""
    초기화()
    안끝난것 = Future()                            # 영원히 안 끝난다

    class 매달린실행기:
        def submit(self, fn, *a, **kw):
            source = a[1]
            if source == "느린곳":
                return 안끝난것
            return _끝난것([{"title": "t"}])

    def 즉시타임아웃(futures, timeout=None):
        for f in list(futures):
            if f.done():
                yield f
        raise TimeoutError

    monkeypatch.setattr(ns, "_parse_feed", lambda u, s, l: [{"title": "t"}])
    monkeypatch.setattr(ns, "_feed_executor", 매달린실행기())
    monkeypatch.setattr(ns, "as_completed", 즉시타임아웃)

    목록 = [("느린곳", "https://ex.test/a"), ("빠른곳", "https://ex.test/b")]
    ns._fetch_all_feeds(목록, 5, batch=2)

    assert ns._연속실패["느린곳"] == 1
    assert ns._연속실패["빠른곳"] == 0


def test_예산초과_기록이_health_에도_남는다(monkeypatch):
    초기화()
    남긴것 = []
    monkeypatch.setattr(ns.health, "record_fail",
                        lambda 이름, 사유=None, *a, **kw: 남긴것.append((이름, 사유)))
    monkeypatch.setattr(ns.health, "record_ok", lambda *a, **kw: None)

    class 매달린실행기:
        def submit(self, fn, *a, **kw):
            return Future()

    def 즉시타임아웃(futures, timeout=None):
        raise TimeoutError
        yield

    monkeypatch.setattr(ns, "_feed_executor", 매달린실행기())
    monkeypatch.setattr(ns, "as_completed", 즉시타임아웃)
    ns._fetch_all_feeds([("느린곳", "https://ex.test/a")], 5, batch=1)

    assert ("뉴스:느린곳", "회차 시간(40초) 안에 못 끝냄") in 남긴것


# ── 관리자 화면에 내보내는 값 ──────────────────────────────
@pytest.mark.skipif(not _fastapi있나(), reason="이 환경에는 fastapi 가 없다")
def test_관리자_응답에_쉬는곳이_들어간다(monkeypatch):
    초기화()
    from app.api.routes import admin
    이름 = ns.KR_FEEDS[0][0]
    ns._연속실패[이름] = 99

    monkeypatch.setattr("app.core.cache.cache.get_stale", lambda k: [])
    상태 = admin._news_status()
    assert 이름 in 상태["resting"]
    assert 상태["rest_after"] == ns._쉼_기준
    assert 상태["probe"] == ns._되살림_칸
    초기화()


@pytest.mark.skipif(not _fastapi있나(), reason="이 환경에는 fastapi 가 없다")
def test_쉬는곳이_없으면_빈_목록(monkeypatch):
    초기화()
    from app.api.routes import admin
    monkeypatch.setattr("app.core.cache.cache.get_stale", lambda k: [])
    assert admin._news_status()["resting"] == []
