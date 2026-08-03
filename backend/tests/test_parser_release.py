"""
파싱한 HTML 트리를 놓아주는가 — "10분만에 메모리가 다 차면서 재시작됐어"

순위 갱신은 장중 60초마다 네이버 시세 8페이지를 파싱한다. HTML 트리는
부모와 자식이 서로를 가리키는 구조라, 다 쓰고 변수를 놓아도 참조가 얽혀
있어 참조 세기만으로는 정리되지 않는다. 순환참조 수집기가 와야 치워지는데
객체가 많을수록 그게 뜸하게 오고, 그 사이 계속 쌓인다. 프로덕션 메모리를
들여다봤을 때 파싱 결과 문자열이 47,409개 남아 있었다.

여기서 못 박는 것 중 제일 중요한 건 '불렀는가' 가 아니라 **'줄었는가'** 다.
처음에는 루트에 soup.decompose() 를 걸어 놓고 고쳤다고 생각했는데, 재 보니
태그가 하나도 안 줄어 있었다 — bs4 는 루트의 next_element 가 None 이라
순회가 첫걸음에서 끝난다. 호출 여부만 봤다면 그대로 통과했을 것이다.
그래서 이 파일의 중심 검사는 실제 잔존 객체 수를 센다.

  1) 정말 줄어드는가 (성공했을 때도, 도중에 터졌을 때도)
  2) 끊고 나서도 뽑아낸 값이 멀쩡한가 — 트리에 매달린 문자열을 담아
     두었다면 끊는 순간 껍데기가 되고, 게다가 트리 전체를 붙잡는다
  3) 끊는 일 자체가 실패해도 결과는 돌려주는가
"""
import asyncio
import gc

import pytest

from app.services import ranking_service as rs


# ── 네이버 시세표 흉내 ────────────────────────────────────────
def _표(줄수: int = 3) -> str:
    """시가총액 페이지 모양: 체크박스 TD 가 앞에 하나 붙어 있고,
    종목명 TD 다음이 현재가|전일비|등락률|시총(억)|상장주식수|외인|거래량|PER|ROE"""
    줄 = []
    for i in range(줄수):
        코드 = f"{5930 + i:06d}"
        줄.append(
            f'<tr><td><input type="checkbox"></td>'
            f'<td><a href="/item/main.naver?code={코드}">종목{i}</a></td>'
            f'<td>{70000 + i}</td><td>500</td><td>+1.50</td>'
            f'<td>4,200,000</td><td>5,969,782</td><td>52.10</td>'
            f'<td>12,345,678</td><td>13.2</td><td>8.4</td></tr>'
        )
    return "<html><body><table>" + "".join(줄) + "</table></body></html>"


class _응답:
    status_code = 200

    def __init__(self, text):
        self.text = text


class _가짜클라이언트:
    """httpx.AsyncClient 자리 — 네트워크를 타지 않는다."""
    def __init__(self, html):
        self._html = html

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, url, params=None):
        return _응답(self._html)


@pytest.fixture
def 네트워크차단(monkeypatch):
    def _설치(html=None):
        html = _표() if html is None else html
        monkeypatch.setattr(rs.httpx, "AsyncClient",
                            lambda *a, **k: _가짜클라이언트(html))
    return _설치


@pytest.fixture
def 수집기끄기():
    """순환참조 수집기를 꺼 둔다.

    켜 두면 수집기가 뒤늦게 치워 준 것과 우리가 끊은 것을 구분할 수 없다.
    프로덕션에서도 객체가 많으면 수집기는 좀처럼 오지 않으므로, 꺼 놓고
    보는 쪽이 실제 상황에 가깝다."""
    gc.collect()
    gc.disable()
    yield
    gc.enable()
    gc.collect()


def _살아있는태그():
    from bs4.element import Tag
    return sum(1 for o in gc.get_objects() if isinstance(o, Tag))


# ── 1. 정말 줄어드는가 ───────────────────────────────────────
class Test트리를_놓아준다:
    def test_파싱에_성공하면_트리가_남지_않는다(self, 네트워크차단, 수집기끄기):
        """이 파일의 핵심. '끊는 함수를 불렀다' 가 아니라 '안 남았다' 를 본다."""
        네트워크차단(_표(30))
        기준 = _살아있는태그()

        for _ in range(10):
            rows = asyncio.run(rs._fetch_naver_sise_page("http://x", 0, has_market_cap=True))
        assert len(rows) == 30, "먼저 파싱 자체가 돼야 이 검사가 의미 있다"

        남은것 = _살아있는태그() - 기준
        # 30줄 × 12칸 ≈ 한 번에 370개. 안 끊으면 10번에 3,700개가 그대로 남는다.
        assert 남은것 < 100, f"수집기 없이 태그가 {남은것}개 남았다 — 트리가 안 끊긴다"

    def test_도중에_터져도_트리가_남지_않는다(self, 네트워크차단, 수집기끄기, monkeypatch):
        """예외로 빠져나가는 길이 오히려 위험하다 — 실패한 파싱일수록
        트리가 통째로 크게 남는다."""
        네트워크차단(_표(30))
        import bs4

        def 폭발(self, *a, **k):
            raise RuntimeError("파싱 도중 실패")

        monkeypatch.setattr(bs4.BeautifulSoup, "select", 폭발)
        기준 = _살아있는태그()

        for _ in range(10):
            assert asyncio.run(rs._fetch_naver_sise_page("http://x", 0)) == [], \
                "실패하면 빈 목록을 돌려줘야 한다"

        남은것 = _살아있는태그() - 기준
        assert 남은것 < 100, f"터졌을 때 태그가 {남은것}개 남았다"

    def test_응답이_200이_아니면_파싱하지도_않는다(self, monkeypatch, 수집기끄기):
        class _실패응답:
            status_code = 503
            text = _표(30)

        class _실패클라이언트(_가짜클라이언트):
            async def get(self, url, params=None):
                return _실패응답()

        monkeypatch.setattr(rs.httpx, "AsyncClient",
                            lambda *a, **k: _실패클라이언트(""))
        기준 = _살아있는태그()
        assert asyncio.run(rs._fetch_naver_sise_page("http://x", 0)) == []
        assert _살아있는태그() - 기준 == 0


class Test끊기_자체가_실패해도:
    def test_결과는_돌려준다(self, 네트워크차단, monkeypatch):
        """정리하다 터져서 순위표가 통째로 사라지면 본말전도다."""
        네트워크차단()
        import bs4
        monkeypatch.setattr(bs4.element.Tag, "decompose",
                            lambda self: (_ for _ in ()).throw(RuntimeError("정리 실패")))
        rows = asyncio.run(rs._fetch_naver_sise_page("http://x", 0, has_market_cap=True))
        assert len(rows) == 3

    def test_트리가_없으면_정상_경로로_지나간다(self, caplog):
        """응답이 200 이 아니면 soup 는 None 인 채로 finally 에 온다.
        예외를 던졌다가 삼키는 것으로 때우면, 진짜 고장과 구분이 안 된다."""
        import logging
        with caplog.at_level(logging.DEBUG, logger=rs.log.name):
            rs._트리끊기(None)
        assert not [r for r in caplog.records if "정리 실패" in r.getMessage()], \
            "정상 경로인데 실패로 처리됐다"

    def test_정리가_실패하면_흔적을_남긴다(self, 네트워크차단, monkeypatch, caplog):
        """조용히 삼키면 '끊고 있다고 믿는데 매번 실패' 를 알아챌 수 없다.
        실제로 그 상태로 한참을 보냈다 — 루트 decompose 는 아무 일도
        안 하면서 아무 소리도 내지 않았다."""
        import logging
        import bs4
        네트워크차단()
        monkeypatch.setattr(bs4.element.Tag, "decompose",
                            lambda self: (_ for _ in ()).throw(RuntimeError("정리 실패")))
        with caplog.at_level(logging.DEBUG, logger=rs.log.name):
            asyncio.run(rs._fetch_naver_sise_page("http://x", 0, has_market_cap=True))
        assert [r for r in caplog.records if "정리 실패" in r.getMessage()], \
            "정리가 통째로 실패했는데 아무 흔적이 없다"


# ── 2. 끊고 나서도 값이 멀쩡한가 ──────────────────────────────
class Test뽑아낸_값이_살아남는다:
    def test_값이_트리와_무관한_평범한_것이다(self, 네트워크차단):
        """종목명을 트리에 매달린 문자열(NavigableString)로 담아 두면,
        끊는 순간 껍데기가 되는 데다 그 하나가 트리 전체를 붙잡는다.
        메모리를 아끼려던 수정이 정반대로 뒤집히는 자리다."""
        네트워크차단()
        rows = asyncio.run(rs._fetch_naver_sise_page("http://x", 0, has_market_cap=True))
        for r in rows:
            assert type(r["name"]) is str, f"{type(r['name'])} 가 담겼다 — 트리를 붙잡는다"
            assert type(r["symbol"]) is str

    def test_끊은_뒤에도_내용이_그대로다(self, 네트워크차단):
        네트워크차단()
        rows = asyncio.run(rs._fetch_naver_sise_page("http://x", 0, has_market_cap=True))
        assert [r["name"] for r in rows] == ["종목0", "종목1", "종목2"]
        assert rows[0]["symbol"] == "005930.KS"
        assert rows[0]["price"] == 70000
        assert rows[0]["volume"] == 12345678
        assert rows[0]["market_cap"] == int(4_200_000 * 1e8)


# ── 3. 루트에 거는 실수를 다시 하지 않도록 ────────────────────
class Test루트에_거는_것으로는_안_된다:
    def test_루트_decompose_는_자식을_건드리지_않는다(self, 수집기끄기):
        """처음 고쳤다고 생각했던 방법이 실제로는 아무 일도 안 한다는 것을
        여기에 박아 둔다. bs4 가 나중에 이 동작을 고치면 이 테스트가 깨지고,
        그때 _트리끊기 를 단순하게 되돌릴 수 있다."""
        from bs4 import BeautifulSoup
        기준 = _살아있는태그()
        soup = BeautifulSoup(_표(30), "lxml")
        soup.decompose()
        del soup
        assert _살아있는태그() - 기준 > 100, (
            "bs4 루트 decompose 가 자식까지 치우게 바뀌었다 — _트리끊기 를 단순화해도 된다")

    def test_트리끊기는_자식까지_치운다(self, 수집기끄기):
        from bs4 import BeautifulSoup
        기준 = _살아있는태그()
        soup = BeautifulSoup(_표(30), "lxml")
        rs._트리끊기(soup)
        del soup
        assert _살아있는태그() - 기준 < 100
