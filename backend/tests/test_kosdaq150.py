"""
코스닥150 이 화면에 0 으로 떠 있었다.

조회 경로는 넷이나 된다 — 네이버 → 야후 → KRX(pykrx) → KIS. 그런데도
안 나왔고, 더 나쁜 것은 **왜 안 나오는지 알 방법이 없었다는 점**이다.
관리자 화면의 기록이 "국내 지수 3/4개" 한 줄뿐이라, 어느 지수가 어느
단계에서 멈췄는지가 안 남았다. 뉴스 수집 때와 똑같은 상황이다.

두 가지를 고쳤다.

  1) 네이버 코드를 후보 여러 개로.
     "KQ150" 하나만 걸어 두고 있었다. 그 코드가 틀리면 그냥 조용히
     실패한다. 이 작업 환경은 외부 인터넷이 막혀 있어 어느 코드가 맞는지
     확인할 방법이 없으므로, 그럴듯한 것을 차례로 걸어 보고 되는 것을
     기억해 둔다(금리·VKOSPI 조회가 이미 쓰는 방식).

  2) 지수마다 성공·실패를 따로 기록.
     어느 원천이 됐는지, 안 되면 네이버가 무슨 이유로 실패했는지를
     남긴다. 다음에는 추측하지 않고 화면을 보면 된다.

여기서는 실제 HTTP 응답을 만들어 태운다 — 글자만 맞춰 보면 로직을
되돌려도 통과해 버린다.
"""
import asyncio
import threading

import pytest

pytest.importorskip("httpx")

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer  # noqa: E402

from app.core import health  # noqa: E402
from app.core.cache import cache  # noqa: E402
from app.services import price_fetcher as P  # noqa: E402

#: 네이버가 주는 모양 그대로
_정상응답 = b'{"closePrice":"1,412.35","compareToPreviousClosePrice":"12.40",' \
            b'"fluctuationsRatio":"0.89"}'


class _손님(BaseHTTPRequestHandler):
    """코드마다 다르게 답하는 서버.

    코드별로 무엇을 돌려줄지 지정한다. 예전에는 '되는코드' 하나만 두고
    나머지를 전부 404 로 줬는데, 그러면 '200 인데 값이 빈' 갈래를 한 번도
    안 태우게 된다 — 뮤테이션에서 그 검사가 통째로 빠져나갔다."""

    답 = {"KOSDAQ150": "정상"}          # 코드 → 정상 / 빈값 / 영 / 404

    def log_message(self, *a):
        pass

    def do_GET(self):
        # /api/index/{code}/basic
        조각 = self.path.strip("/").split("/")
        코드 = 조각[2] if len(조각) > 2 else ""
        무엇 = type(self).답.get(코드, "404")
        if 무엇 == "정상":
            self._보내기(200, _정상응답)
        elif 무엇 == "빈값":
            self._보내기(200, b'{"closePrice":""}')
        elif 무엇 == "영":
            self._보내기(200, b'{"closePrice":"0"}')
        else:
            self._보내기(404, b"not found")

    def _보내기(self, 코드, 몸):
        self.send_response(코드)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(몸)))
        self.end_headers()
        self.wfile.write(몸)


@pytest.fixture(scope="module")
def 서버():
    s = ThreadingHTTPServer(("127.0.0.1", 0), _손님)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{s.server_port}"
    s.shutdown()


@pytest.fixture(autouse=True)
def _프록시_비우기(monkeypatch):
    for k in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy",
              "ALL_PROXY", "all_proxy"):
        monkeypatch.delenv(k, raising=False)
    cache.delete("naver_idx_code:KOSDAQ150")
    _손님.답 = {"KOSDAQ150": "정상"}


@pytest.fixture
def 네이버를_로컬로(서버, monkeypatch):
    """조회 주소만 로컬 서버로 돌린다. 나머지 흐름은 그대로 태운다."""
    원래 = P.httpx.AsyncClient

    class _돌리기(원래):
        async def get(self, url, *a, **k):
            return await super().get(url.replace("https://m.stock.naver.com", 서버), *a, **k)

    monkeypatch.setattr(P.httpx, "AsyncClient", _돌리기)


class Test코드_후보:
    def test_코스닥150_에_후보가_여럿이다(self):
        """하나만 걸어 두면 틀렸을 때 그냥 안 나온다 —
        지금 화면이 0 으로 떠 있는 이유로 가장 유력한 자리다."""
        assert len(P.NAVER_INDEX_CODES["KOSDAQ150"]) >= 3

    def test_예전_코드도_후보에_남아_있다(self):
        """KQ150 이 맞을 수도 있다. 빼 버리면 되던 것이 안 된다."""
        assert "KQ150" in P.NAVER_INDEX_CODES["KOSDAQ150"]

    def test_예전_이름이_아직_동작한다(self):
        assert P.NAVER_INDEX_CODE["KOSDAQ150"] == P.NAVER_INDEX_CODES["KOSDAQ150"][0]

    def test_모든_지수에_후보가_있다(self):
        for 이름 in ("KOSPI", "KOSDAQ", "KOSPI200", "KOSDAQ150"):
            assert P.NAVER_INDEX_CODES.get(이름), f"{이름} 후보가 없다"


class Test실제로_가져오는가:
    def test_첫_후보가_틀려도_다음_것으로_찾아낸다(self, 네이버를_로컬로):
        """이게 이번 고침의 핵심이다. 첫 후보(KQ150)에 404 가 와도
        다음 후보로 넘어가야 한다 — 예전에는 여기서 끝났다."""
        # 첫 후보(KQ150)는 404, 두 번째(KOSDAQ150)만 답한다
        _손님.답 = {"KOSDAQ150": "정상"}
        결과 = asyncio.run(P.fetch_naver_index("KOSDAQ150"))
        assert 결과 is not None, "후보를 더 안 걸어 본다"
        assert 결과["value"] == pytest.approx(1412.35)
        assert 결과["index"] == "KOSDAQ150"

    def test_쉼표가_있어도_숫자로_읽는다(self, 네이버를_로컬로):
        결과 = asyncio.run(P.fetch_naver_index("KOSDAQ150"))
        assert 결과["value"] > 1000

    def test_등락도_같이_읽는다(self, 네이버를_로컬로):
        결과 = asyncio.run(P.fetch_naver_index("KOSDAQ150"))
        assert 결과["change"] == pytest.approx(12.40)
        assert 결과["change_rate"] == pytest.approx(0.89)

    def test_통한_코드를_기억한다(self, 네이버를_로컬로):
        """매번 네 번씩 두드릴 이유가 없다. 0.15 CPU 서버다."""
        asyncio.run(P.fetch_naver_index("KOSDAQ150"))
        assert cache.get("naver_idx_code:KOSDAQ150") == "KOSDAQ150"

    def test_기억한_코드를_먼저_쓴다(self, 네이버를_로컬로):
        cache.set("naver_idx_code:KOSDAQ150", "KOSDAQ150", 600)
        _손님.답 = {"KOSDAQ150": "정상"}
        결과 = asyncio.run(P.fetch_naver_index("KOSDAQ150"))
        assert 결과 is not None

    def test_값이_비어_있으면_다음_후보로_넘어간다(self, 네이버를_로컬로):
        """200 인데 값이 빈 경우가 있다. 그걸 성공으로 치면
        화면에 0 이 뜬다 — 지금 증상이 정확히 그 모양이다.

        첫 후보가 빈 값을 주고 다음 후보가 제대로 준다. 빈 값을
        성공으로 치면 여기서 멈춰 버린다."""
        _손님.답 = {"KQ150": "빈값", "KOSDAQ150": "정상"}
        결과 = asyncio.run(P.fetch_naver_index("KOSDAQ150"))
        assert 결과 is not None, "빈 값에서 멈췄다"
        assert 결과["value"] == pytest.approx(1412.35)

    def test_빈_값뿐이면_실패로_끝난다(self, 네이버를_로컬로):
        _손님.답 = {c: "빈값" for c in P.NAVER_INDEX_CODES["KOSDAQ150"]}
        assert asyncio.run(P.fetch_naver_index("KOSDAQ150")) is None

    def test_전부_실패하면_이유를_남긴다(self, 네이버를_로컬로):
        """예전에는 아무것도 안 남아서 추측만 했다."""
        _손님.답 = {}
        P._네이버_지수_실패이유.pop("KOSDAQ150", None)
        결과 = asyncio.run(P.fetch_naver_index("KOSDAQ150"))
        assert 결과 is None
        이유 = P._네이버_지수_실패이유.get("KOSDAQ150")
        assert 이유 and "404" in 이유, f"이유가 안 남았다: {이유}"

    def test_0_이하는_성공으로_치지_않는다(self, 네이버를_로컬로):
        """0 을 받아 들고 '성공' 이라 하면 화면에 0 이 그대로 뜬다 —
        지금 코스닥150 카드가 정확히 그 모양이다."""
        _손님.답 = {c: "영" for c in P.NAVER_INDEX_CODES["KOSDAQ150"]}
        assert asyncio.run(P.fetch_naver_index("KOSDAQ150")) is None

    def test_0_을_주면_다음_후보로_넘어간다(self, 네이버를_로컬로):
        _손님.답 = {"KQ150": "영", "KOSDAQ150": "정상"}
        결과 = asyncio.run(P.fetch_naver_index("KOSDAQ150"))
        assert 결과 is not None and 결과["value"] == pytest.approx(1412.35)


class Test기록이_남는가:
    """다음에는 추측하지 않고 관리자 화면을 보면 된다.

    소스에 그런 낱말이 있는지 보는 것으로는 모자란다 — 뮤테이션에서
    record_ok 한 줄을 지웠는데도 record_fail 쪽에 같은 글자가 남아
    검사가 통과해 버렸다. 그래서 실제로 갱신을 돌려 보고 남은 기록을 읽는다.
    """

    @pytest.fixture
    def 코스닥150만_실패(self, monkeypatch):
        """네이버가 셋만 주고, 나머지 경로는 전부 막힌 상황을 만든다."""
        from app.services import scheduler as S

        async def _네이버():
            return {n: {"index": n, "name": n, "value": 100.0,
                        "change": 0, "change_rate": 0}
                    for n in ("KOSPI", "KOSDAQ", "KOSPI200")}

        async def _야후못함(*a, **k):
            return {}

        # yf_service 는 함수 안에서 import 하므로 원본 모듈 쪽을 바꾼다
        from app.services import yf_service as YS

        monkeypatch.setattr(S, "fetch_naver_indices", _네이버)
        monkeypatch.setattr(S, "fetch_yf_quotes", _야후못함)
        monkeypatch.setattr(S, "fetch_pykrx_index", lambda name: None)
        monkeypatch.setattr(YS.yf_service, "get_market_index", lambda name: None)
        monkeypatch.setattr(S.settings, "KIS_APP_KEY", "", raising=False)
        P._네이버_지수_실패이유["KOSDAQ150"] = "HTTP 404 (코드 KQ150)"
        health.reset()
        return S

    def _기록(self):
        return {x["name"]: x for x in health.snapshot()}

    def test_안_되는_지수가_이름으로_남는다(self, 코스닥150만_실패):
        S = 코스닥150만_실패
        asyncio.run(S.refresh_kr_indices())
        기록 = self._기록()
        assert "지수:KOSDAQ150" in 기록, "어느 지수가 안 되는지 안 남는다"
        assert 기록["지수:KOSDAQ150"]["streak"] >= 1

    def test_실패_기록에_이유가_들어간다(self, 코스닥150만_실패):
        S = 코스닥150만_실패
        asyncio.run(S.refresh_kr_indices())
        이유 = self._기록()["지수:KOSDAQ150"]["last_error"] or ""
        assert "404" in 이유, f"네이버가 왜 실패했는지 안 남는다: {이유}"

    def test_되는_지수는_성공으로_남는다(self, 코스닥150만_실패):
        """실패만 남기면 '기록이 없는 것'과 '되고 있는 것'을 구분 못 한다."""
        S = 코스닥150만_실패
        asyncio.run(S.refresh_kr_indices())
        기록 = self._기록()
        assert 기록["지수:KOSPI"]["streak"] == 0
        assert 기록["지수:KOSPI"]["ok"] >= 1

    def test_어느_원천이_됐는지_남는다(self, 코스닥150만_실패):
        S = 코스닥150만_실패
        asyncio.run(S.refresh_kr_indices())
        assert self._기록()["지수:KOSPI"]["detail"] == "네이버"

    def test_요약에_안_된_지수_이름이_들어간다(self, 코스닥150만_실패):
        """'3/4개' 만으로는 어느 것이 빠졌는지 모른다."""
        S = 코스닥150만_실패
        asyncio.run(S.refresh_kr_indices())
        상세 = self._기록()["국내 지수"]["detail"] or ""
        assert "KOSDAQ150" in 상세, f"어느 것이 빠졌는지 안 적힌다: {상세}"

    def test_모두_되면_요약에_실패가_안_붙는다(self, monkeypatch):
        from app.services import scheduler as S

        async def _네이버():
            return {n: {"index": n, "name": n, "value": 100.0,
                        "change": 0, "change_rate": 0}
                    for n in ("KOSPI", "KOSDAQ", "KOSPI200", "KOSDAQ150")}
        monkeypatch.setattr(S, "fetch_naver_indices", _네이버)
        monkeypatch.setattr(S.settings, "KIS_APP_KEY", "", raising=False)
        health.reset()
        asyncio.run(S.refresh_kr_indices())
        상세 = self._기록()["국내 지수"]["detail"] or ""
        assert "실패" not in 상세, f"다 됐는데 실패가 적혔다: {상세}"

    def test_기록_이름이_화면_규칙과_맞는다(self):
        """관리자 화면은 '뉴스:' 처럼 앞머리로 갈라 본다."""
        health.reset()
        health.record_ok("지수:KOSDAQ150", None, "네이버")
        이름들 = [x["name"] for x in health.snapshot()]
        assert any(n.startswith("지수:") for n in 이름들)
