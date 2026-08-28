"""보유 종목 뉴스 — 내 종목 얘기를 한 자리에.

종목 상세마다 뉴스 탭이 있지만, 열 종목을 가진 사람은 '내 종목에 무슨
일이 있었나' 를 보려고 화면을 열 번 드나들어야 했다.

── 이 파일이 지키는 것 ──

**요청을 붙잡지 않는다.** 종목마다 구글뉴스 RSS 나 yfinance 를 부르면
스무 종목이 외부 호출 스무 번이고, 0.15 CPU 서버에서 그건 화면이 30초를
기다린다는 뜻이다.

처음에는 아예 안 받았다. 그런데 그러면 종목 상세를 한 번도 안 열어 본
종목은 영영 안 나온다 — '내 종목 뉴스' 인데 절반이 비어 있으면 화면을
여는 뜻이 없다. 그래서 **배경에서** 받아 오고, 요청은 지금 있는 것만
돌려주면서 `pending` 으로 몇 개가 오는 중인지 알려 준다.

여기서 못 박는 것 —
  · 요청 안에서 외부를 부르지 않는다(배경 스레드에 맡긴다)
  · 한 요청에 배경으로 보내는 종목 수에 상한이 있다
  · 같은 종목을 두 번 밀어 넣지 않는다
  · 종목 상세와 **같은 열쇠**에 담는다(두 화면이 서로 덕을 본다)

그리고 종합 뉴스 쪽은 여전히 캐시만 읽는다. `get_kr_news()` 한 줄이면
캐시가 빈 상태에서 요청 안에서 RSS 를 훑는 갈래로 빠지는데, 개발
기계에서는 캐시가 늘 더워서 아무 일도 안 일어난 것처럼 보인다. 그래서
`test_외부를_안_부른다` 는 그 함수를 '부르면 터지는' 것으로 바꿔 놓고 돈다.

그리고 published_ts 의 타입이 출처마다 다르다 — 종합피드는 float,
구글뉴스는 ISO 문자열, yfinance 는 아예 없다. 섞인 채로 sorted() 를
부르면 TypeError 로 죽는다. 종목 하나만 볼 때는 잘 안 섞이지만 여러
종목을 합치면 거의 반드시 섞인다.
"""
import time

import pytest

from app.core.cache import cache
from app.services import portfolio_news as PN


@pytest.fixture(autouse=True)
def _캐시_치우기():
    """이 파일이 쓰는 열쇠를 앞뒤로 지운다.

    캐시는 한 프로세스에 하나뿐이라, 안 지우면 단독으로는 통과하고
    전체로 돌리면 깨지는 검사가 된다."""
    def 치우기():
        cache.delete("news:kr")
        cache.delete("news:us")
        cache.delete_pattern("stock_news:")
        cache.delete_pattern("portfolio_news:")
        PN._받는중.clear()          # '받는 중' 표시가 남으면 다음 검사가 안 보낸다
    치우기()
    yield
    치우기()


def 기사(제목, 주소=None, ts=None, 사진=None, 요약="", 출처="한국경제"):
    return {
        "title": 제목,
        "link": 주소 or f"https://example.com/{abs(hash(제목)) % 10**8}",
        "source": 출처,
        "published": "08/26 09:12",
        "published_ts": ts if ts is not None else time.time(),
        "summary": 요약,
        "image": 사진,
    }


보유_삼성 = {"symbol": "005930", "market": "KR", "name": "삼성전자"}
보유_엔비 = {"symbol": "NVDA", "market": "US", "name": "NVIDIA Corporation"}


@pytest.fixture(autouse=True)
def _배경_막기(monkeypatch):
    """배경 수집을 대역으로 바꾼다.

    안 막으면 검사가 진짜 구글뉴스·야후를 친다 — 네트워크가 없는 곳에서
    느려지고, 있는 곳에서는 결과가 그날그날 달라진다. 무엇을 몇 개
    보냈는지만 기록한다."""
    보낸것: list = []

    def 가짜(심볼, 시장, 이름):
        보낸것.append((심볼, 시장, 이름))
        PN._받는중.discard(f"stock_news:{시장}:{심볼}")

    class _가짜풀:
        @staticmethod
        def submit(fn, *a, **k):
            가짜(*a, **k)          # 곧바로 부른다(스레드를 안 띄운다)

    import app.core.executor as EX
    monkeypatch.setattr(EX, "background_executor", _가짜풀)
    return 보낸것


class Test시각정규화:
    """무엇이 오든 float epoch 하나로 맞춘다."""

    def test_float_은_그대로(self):
        assert PN._시각(1756000000.0) == 1756000000.0
        assert PN._시각(1756000000) == 1756000000.0

    def test_ISO_문자열을_읽는다(self):
        # 종목 뉴스(구글뉴스)가 이 꼴로 온다
        assert PN._시각("2026-08-26T00:12:00+00:00") == pytest.approx(1787703120, abs=2)

    def test_KST_표시문자열을_읽는다(self):
        연도있음 = PN._시각("2026/08/26 09:12")
        assert 연도있음 > 0
        # 연도 없는 꼴(종합피드)도 같은 시각으로 읽혀야 한다
        연도없음 = PN._시각("08/26 09:12")
        assert 연도없음 > 0
        assert abs(연도있음 - 연도없음) < 86_400 * 370

    def test_못_읽으면_0_이라_맨_뒤로_간다(self):
        """지어낸 시각을 넣으면 그 기사가 맨 앞에 온다 — 0 이 맞다."""
        for 값 in (None, "", "어제쯤", [], {}):
            assert PN._시각(값) == 0.0

    def test_섞여_있어도_안_죽는다(self):
        """float 과 str 을 한 리스트에 넣고 sorted() 를 부르면 TypeError 다.

        종목 하나만 볼 때는 잘 안 섞이지만, 여러 종목을 합치는 이
        화면에서는 거의 반드시 섞인다."""
        cache.set("news:kr", [
            {**기사("삼성전자 신제품"), "published_ts": 1756000000.0},
            {**기사("삼성전자 실적"),   "published_ts": "2026-08-26T00:12:00+00:00"},
            {**기사("삼성전자 배당"),   "published_ts": None},
        ], 60)
        답 = PN.모으기([보유_삼성])          # 안 터지면 통과
        assert len(답["items"]) == 3
        # 최신순이고, 시각을 못 읽은 것이 맨 뒤다
        시각들 = [a["published_ts"] for a in 답["items"]]
        assert 시각들 == sorted(시각들, reverse=True)
        assert 시각들[-1] == 0.0


class Test제목열쇠:
    """같은 기사가 다른 주소로 두 번 오는 것을 잡는다."""

    def test_공백과_문장부호가_달라도_같은_열쇠(self):
        assert PN._제목열쇠("삼성전자, HBM4 양산") == PN._제목열쇠("삼성전자 HBM4 양산")
        assert PN._제목열쇠("  삼성전자·HBM4 양산!  ") == PN._제목열쇠("삼성전자HBM4양산")

    def test_다른_기사면_다른_열쇠(self):
        assert PN._제목열쇠("삼성전자 HBM4 양산") != PN._제목열쇠("삼성전자 HBM3 감산")

    def test_주소가_달라도_한_줄로_합친다(self):
        """종합피드는 언론사 원문 주소로, 구글뉴스는 리다이렉트 주소로
        온다. link 만 보면 같은 기사가 두 줄로 남는다."""
        cache.set("news:kr", [기사("삼성전자, HBM4 양산 앞당긴다",
                                   주소="https://hankyung.com/a1")], 60)
        cache.set("stock_news:KR:005930", [기사("삼성전자 HBM4 양산 앞당긴다",
                                                주소="https://news.google.com/rss/x1")], 60)
        답 = PN.모으기([보유_삼성])
        assert len(답["items"]) == 1


class Test매칭:
    """한글은 포함, 영문은 단어 경계."""

    def test_한글은_문장_가운데서도_걸린다(self):
        assert PN._맞나("삼성전자", "오늘 삼성전자 주가가 올랐다")

    def test_영문은_단어_경계로_본다(self):
        # 'V'(비자)가 온 세상 기사에 걸리면 목록이 못 쓰게 된다
        assert not PN._맞나("V", "Vision Pro sales rise")
        assert PN._맞나("V", "V shares climb")
        # 'GD'(제너럴다이내믹스)가 'GDP' 에 걸리면 안 된다
        assert not PN._맞나("GD", "GDP growth slows")
        assert PN._맞나("GD", "GD wins navy contract")

    def test_대소문자는_안_가린다(self):
        assert PN._맞나("NVDA", "nvda rallies")

    def test_빈_값은_안_걸린다(self):
        assert not PN._맞나("", "아무 글")
        assert not PN._맞나("삼성전자", "")


class Test열쇠:
    """종목 묶음이 같으면 캐시를 나눠 쓴다."""

    def test_순서가_달라도_같은_열쇠(self):
        assert PN.열쇠([보유_삼성, 보유_엔비]) == PN.열쇠([보유_엔비, 보유_삼성])

    def test_종목이_하나_다르면_다른_열쇠(self):
        assert PN.열쇠([보유_삼성]) != PN.열쇠([보유_삼성, 보유_엔비])

    def test_같은_심볼이라도_시장이_다르면_다른_열쇠(self):
        가 = {"symbol": "AAA", "market": "KR", "name": "가"}
        나 = {"symbol": "AAA", "market": "US", "name": "가"}
        assert PN.열쇠([가]) != PN.열쇠([나])

    def test_사용자_id_가_안_섞인다(self):
        """id 로 열쇠를 잡으면 사람 수만큼 캐시가 늘어난다. 실제로
        갈리는 것은 '어떤 종목을 갖고 있나' 뿐이다."""
        assert PN.열쇠([보유_삼성]).startswith("portfolio_news:")
        assert PN.열쇠([{**보유_삼성, "user_id": 7}]) == PN.열쇠([{**보유_삼성, "user_id": 99}])


class Test모으기:
    def test_종목코드가_아닌_심볼은_거른다(self):
        """포트폴리오는 '현금'·'금'·'채권' 같은 한글 심볼을 허용한다.
        그건 종목이 아니라 분류다 — 안 거르면 '금' 이 들어간 기사가
        전부 딸려 온다."""
        cache.set("news:kr", [기사("금값이 사상 최고를 찍었다")], 60)
        답 = PN.모으기([{"symbol": "금", "market": "KR", "name": "금"},
                        {"symbol": "현금", "market": "KR", "name": "원화 현금"}])
        assert 답 == {"items": [], "covered": [], "missing": [], "pending": 0}

    def test_종합_캐시에서_내_종목을_골라낸다(self):
        cache.set("news:kr", [
            기사("삼성전자, HBM4 양산 앞당긴다"),
            기사("현대차 신차 공개"),                 # 내 종목이 아니다
        ], 60)
        답 = PN.모으기([보유_삼성])
        assert [a["title"] for a in 답["items"]] == ["삼성전자, HBM4 양산 앞당긴다"]
        assert 답["covered"] == ["005930"]
        assert 답["missing"] == []

    def test_종목_뉴스_캐시도_같이_쓴다(self):
        """누가 그 종목 상세를 열어 뒀으면 5분간 남아 있다. 그게 제일
        정확한 재료라 먼저 담는다."""
        cache.set("stock_news:KR:005930", [기사("상세에서 받아 둔 기사")], 60)
        답 = PN.모으기([보유_삼성])
        assert [a["title"] for a in 답["items"]] == ["상세에서 받아 둔 기사"]

    def test_한_기사가_두_종목에_걸리면_한_줄로_나온다(self):
        cache.set("news:kr", [기사("삼성전자·NVDA 동반 약세", 주소="https://x/1")], 60)
        답 = PN.모으기([보유_삼성, 보유_엔비])
        assert len(답["items"]) == 1
        assert sorted(답["items"][0]["symbols"]) == ["005930", "NVDA"]
        assert sorted(답["covered"]) == ["005930", "NVDA"]

    def test_못_찾은_종목을_시장까지_같이_알려_준다(self):
        """심볼만 주면 화면이 그 종목으로 갈 수가 없다 —
        종목 상세 주소가 /stocks/{market}/{symbol} 이라, 시장을 모르면
        국내 종목을 미국 종목으로 열게 된다."""
        cache.set("news:kr", [기사("삼성전자 소식")], 60)
        답 = PN.모으기([보유_삼성, 보유_엔비])
        assert 답["missing"] == [{"symbol": "NVDA", "market": "US", "name": "NVIDIA Corporation"}]

    def test_사진_있는_기사가_앞에_온다(self):
        """버리지는 않는다 — 걸러내면 '뉴스가 없습니다' 가 되는 종목이
        생긴다(뉴스 탭과 같은 규칙)."""
        지금 = time.time()
        cache.set("news:kr", [
            기사("삼성전자 소식 하나", ts=지금, 사진=None),
            기사("삼성전자 소식 둘",   ts=지금 - 3600, 사진="https://img/x.jpg"),
        ], 60)
        답 = PN.모으기([보유_삼성])
        # 사진 있는 쪽이 더 오래된 기사인데도 앞에 온다
        assert 답["items"][0]["title"] == "삼성전자 소식 둘"
        assert len(답["items"]) == 2

    def test_두_번째부터는_캐시에서_나온다(self):
        cache.set("news:kr", [기사("삼성전자 소식")], 60)
        첫번째 = PN.모으기([보유_삼성])
        # 원본을 치워도 답이 그대로여야 캐시에서 나온 것이다
        cache.delete("news:kr")
        두번째 = PN.모으기([보유_삼성])
        assert 두번째 == 첫번째

        # 캐시를 지우면 다시 센다 — 이번엔 원본이 없으니 빈손이다
        cache.delete_pattern("portfolio_news:")
        assert PN.모으기([보유_삼성])["items"] == []

    def test_캐시가_통째로_비어도_안_죽는다(self):
        """서버가 막 뜬 직후가 이 상태다. 여기서 터지면 화면이
        오류 상자로 뒤덮인다."""
        답 = PN.모으기([보유_삼성, 보유_엔비])
        assert 답["items"] == []
        assert 답["covered"] == []
        assert [m["symbol"] for m in 답["missing"]] == ["005930", "NVDA"]

    def test_보유가_비면_빈손이다(self):
        assert PN.모으기([]) == {"items": [], "covered": [], "missing": [], "pending": 0}

    def test_한_종목이_목록을_다_먹지_않는다(self):
        """한 종목이 기사를 백 건 갖고 있으면 나머지 종목이 화면에서
        사라진다."""
        cache.set("news:kr",
                  [기사(f"삼성전자 소식 {i}", 주소=f"https://x/{i}") for i in range(40)], 60)
        답 = PN.모으기([보유_삼성])
        assert len(답["items"]) <= PN.종목당_최대

    def test_외부를_안_부른다(self, monkeypatch):
        """이 파일의 핵심 제약이다.

        get_kr_news() 한 줄이면 캐시가 빈 상태에서 그 자리에서 RSS 를
        훑는 갈래로 빠진다. 개발 기계에서는 캐시가 늘 더워서 아무 일도
        안 일어난 것처럼 보이므로, 부르면 터지게 해 두고 돈다."""
        from app.services import news_service

        def 터짐(*a, **k):
            raise AssertionError("보유 뉴스가 외부에서 새로 받아 오고 있다")

        monkeypatch.setattr(news_service, "get_kr_news", 터짐)
        monkeypatch.setattr(news_service, "get_us_news", 터짐)
        monkeypatch.setattr(news_service, "_fetch_all_feeds", 터짐)

        cache.set("news:kr", [기사("삼성전자 소식")], 60)
        답 = PN.모으기([보유_삼성, 보유_엔비])
        assert len(답["items"]) == 1

    def test_요청_안에서는_외부를_안_친다(self, _배경_막기):
        """받아 오기는 배경 스레드 몫이다.

        모으기() 안에서 곧장 httpx·yfinance 를 부르면 스무 종목짜리
        포트폴리오가 요청 하나를 30초 붙잡는다. 실제로 받아 오는 두
        함수를 '부르면 터지는' 것으로 바꿔 놓고 돈다 — 배경 대역은
        그 함수들을 안 부르므로 통과해야 한다."""
        def 터짐(*a, **k):
            raise AssertionError("요청 안에서 뉴스를 직접 받고 있다")

        원래 = (PN._구글뉴스, PN._야후뉴스)
        PN._구글뉴스, PN._야후뉴스 = 터짐, 터짐
        try:
            cache.set("news:kr", [기사("삼성전자 소식")], 60)
            답 = PN.모으기([보유_삼성, 보유_엔비])
        finally:
            PN._구글뉴스, PN._야후뉴스 = 원래
        assert len(답["items"]) == 1

    def test_배경으로_보내는_종목_수에_상한이_있다(self, _배경_막기):
        """스무 종목을 한꺼번에 밀어 넣으면 풀이 막혀 다른 화면까지
        같이 느려진다. 나머지는 다음 요청에 간다 — 그래서 pending 은
        보낸 수가 아니라 '아직 안 채워진 수' 다."""
        많이 = [{"symbol": f"AAA{i}", "market": "US", "name": f"이름{i}"} for i in range(12)]
        답 = PN.모으기(많이)
        assert len(_배경_막기) == PN.한번에, f"{len(_배경_막기)}개를 한꺼번에 보냈다"
        assert 답["pending"] == 12

    def test_같은_종목을_두_번_안_보낸다(self, _배경_막기, monkeypatch):
        """배경이 아직 안 끝났는데 화면이 다시 물어보면(pending 이라
        곧 다시 물어본다) 같은 종목을 또 받게 된다."""
        # 이번에는 '받는 중' 표시가 남도록 대역을 바꾼다
        class _붙잡는풀:
            @staticmethod
            def submit(fn, *a, **k):
                pass                      # 표시만 남기고 아무것도 안 한다

        import app.core.executor as EX
        monkeypatch.setattr(EX, "background_executor", _붙잡는풀)

        PN.모으기([보유_엔비])
        cache.delete_pattern("portfolio_news:")
        답 = PN.모으기([보유_엔비])
        assert 답["pending"] == 1          # 여전히 오는 중이라고 말한다
        assert len(PN._받는중) == 1        # 두 번 안 밀어 넣었다

    def test_받아_온_것을_종목_상세와_같은_열쇠에_담는다(self):
        """이 화면을 연 뒤 종목 상세를 열면 곧바로 떠야 한다.
        열쇠가 다르면 같은 것을 두 번 받는다."""
        PN._구글뉴스 = lambda 이름: [기사("받아 온 기사")]
        try:
            PN._한종목_받기("005930", "KR", "삼성전자")
        finally:
            del PN._구글뉴스
            import importlib
            importlib.reload(PN)
        assert cache.get("stock_news:KR:005930") is not None

    def test_빈손이면_한동안_그만_물어본다(self, _배경_막기, monkeypatch):
        """뉴스가 아예 안 잡히는 종목(작은 ETF·우선주)이 생각보다 많다.
        표시를 안 남기면 그 종목을 매 요청마다 다시 받는다."""
        monkeypatch.setattr(PN, "_야후뉴스", lambda 심볼: [])
        PN._한종목_받기("ZZZZ", "US", "ZZZZ")
        assert cache.get("stock_news:US:ZZZZ:miss") is True

        보낸것 = _배경_막기
        PN.모으기([{"symbol": "ZZZZ", "market": "US", "name": "ZZZZ"}])
        assert 보낸것 == [], "빈손 표시를 무시하고 또 받으러 갔다"


class Test라우트:
    def test_경로가_있다(self):
        from app.main import app
        길들 = set(app.openapi()["paths"].keys())
        assert "/api/v1/portfolio/news" in 길들

    def test_배당_경로를_안_가로챈다(self):
        """FastAPI 는 등록 순서대로 맞춰 본다. /news 가 /{portfolio_id}
        같은 자리 뒤로 밀리면 엉뚱한 라우트가 먼저 잡는다."""
        from fastapi.routing import APIRoute
        from app.api.routes.portfolio import router
        순서 = [r.path for r in router.routes if isinstance(r, APIRoute) and "GET" in r.methods]
        assert "/portfolio/news" in 순서
        # 경로 변수를 쓰는 GET 보다 앞이어야 한다
        변수자리 = [i for i, 길 in enumerate(순서) if "{" in 길 and 길.count("/") == 2]
        if 변수자리:
            assert 순서.index("/portfolio/news") < min(변수자리)

    def test_남의_것을_못_본다(self):
        """소유권은 두 겹이다 — 항목을 내 것으로 한정하고,
        portfolio_id 를 받았을 때 그게 내 포트폴리오인지 본다(IDOR)."""
        import inspect
        from app.api.routes import portfolio as P
        본문 = inspect.getsource(P.보유뉴스)
        assert "PortfolioItem.user_id == current_user.id" in 본문
        assert "_valid_portfolio_id" in 본문
        assert "require_user" in inspect.getsource(P)

    def test_현금은_안_넣는다(self):
        import inspect
        from app.api.routes import portfolio as P
        assert '현금' in inspect.getsource(P.보유뉴스)


class Test기사언어:
    """한국 기사만 / 해외 기사만 — 화면이 이 칸을 보고 가른다.

    가르는 기준이 요점이다. **종목의 시장이 아니라 기사가 나온 통**이다.
    엔비디아 얘기를 한국 매체가 쓰면 그건 한국 기사다. 시장으로 가르면
    그 기사가 '해외' 로 빠져서, 한국 기사만 보려는 사람 눈에서 사라진다.
    """

    def test_국내_매체_기사는_ko(self):
        cache.set("news:kr", [기사("삼성전자, HBM4 양산 앞당긴다")], 60)
        답 = PN.모으기([보유_삼성])
        assert [a["lang"] for a in 답["items"]] == ["ko"]

    def test_해외_매체_기사는_en(self):
        cache.set("news:us", [기사("NVDA tops estimates")], 60)
        답 = PN.모으기([보유_엔비])
        assert [a["lang"] for a in 답["items"]] == ["en"]

    def test_해외_종목이라도_한국_매체_기사면_ko(self):
        """여기가 '시장으로 가르기' 와 갈리는 자리다."""
        cache.set("news:kr", [기사("엔비디아 주가, NVDA 사상 최고")], 60)
        답 = PN.모으기([보유_엔비])
        assert [a["lang"] for a in 답["items"]] == ["ko"]

    def test_종목_뉴스_캐시도_시장에_따라_갈린다(self):
        """국내 종목은 구글뉴스(한국어), 해외 종목은 야후(영어)로 받는다."""
        cache.set("stock_news:KR:005930", [기사("상세에서 받아 둔 기사")], 60)
        cache.set("stock_news:US:NVDA", [기사("From the detail page")], 60)
        답 = PN.모으기([보유_삼성, 보유_엔비])
        말 = {a["title"]: a["lang"] for a in 답["items"]}
        assert 말["상세에서 받아 둔 기사"] == "ko"
        assert 말["From the detail page"] == "en"

    def test_모든_기사에_칸이_있다(self):
        """하나라도 비면 화면에서 그 기사가 어느 칩에도 안 잡힌다 —
        '전체 5건인데 국내 3 + 해외 1' 처럼 수가 안 맞는다."""
        cache.set("news:kr", [기사("삼성전자 실적"), 기사("삼성전자 배당")], 60)
        cache.set("news:us", [기사("NVDA beats")], 60)
        답 = PN.모으기([보유_삼성, 보유_엔비])
        assert 답["items"]
        assert all(a.get("lang") in ("ko", "en") for a in 답["items"])
        국내 = sum(1 for a in 답["items"] if a["lang"] == "ko")
        해외 = sum(1 for a in 답["items"] if a["lang"] == "en")
        assert 국내 + 해외 == len(답["items"])
