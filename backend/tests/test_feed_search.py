"""
피드 검색 — "피드 검색기능 만들어줘"

글 본문은 content 컬럼에 JSON 으로 들어 있다. DB 는 그 안을 못 들여다보므로,
검색하려면 글을 전부 꺼내 파싱해서 걸러야 한다. 글이 늘수록 그대로 느려지고
인덱스도 못 태운다 — CPU 0.15개짜리 서버에서는 이게 곧 멈춤이다.

그래서 검색에 걸릴 만한 것(제목·본문·종목코드·태그)만 소문자로 이어 붙인
납작한 사본을 컬럼으로 따로 둔다.

여기서 못 박는 것 —
  1) 무엇이 사본에 들어가고 무엇이 안 들어가는가
  2) 대소문자가 갈리지 않는다 (종목코드는 대문자로 저장되고 사람은 소문자로 친다)
  3) LIKE 의 와일드카드가 검색어로 새어 들어가지 않는다
  4) 새 글과 고친 글이 사본을 채운다 (여기가 비면 그 글만 조용히 안 걸린다)
  5) 옛 글도 채워 넣는다 (안 하면 컬럼 만든 뒤 글만 검색된다)
"""
import inspect

import pytest

from app.api.routes import community as C


class Test사본에_담기는_것:
    def test_제목과_본문이_들어간다(self):
        문장 = C.검색문장("삼성전자 목표가", "반도체 업황이 돌아서는 중")
        assert "목표가" in 문장
        assert "업황" in 문장

    def test_종목코드가_들어간다(self):
        """종목코드로 찾는 것이 제일 흔한 검색이다."""
        assert "005930" in C.검색문장("제목", "본문", "005930")

    def test_태그의_코드와_이름이_모두_들어간다(self):
        """태그를 붙인 이유가 '이 종목 글로 찾히게' 인데, 사본에 안 담으면
        태그는 화면 장식일 뿐이다."""
        문장 = C.검색문장("제목", "본문", "AAPL",
                          [{"symbol": "005930", "market": "KR", "name": "삼성전자"}])
        assert "005930" in 문장
        assert "삼성전자" in 문장

    def test_대문자로_저장돼도_소문자로_찾힌다(self):
        """종목코드는 대문자로 저장되고 사람은 소문자로 친다. 한쪽으로
        맞춰 두지 않으면 aapl 로는 아무것도 안 나온다."""
        문장 = C.검색문장("Apple 실적", "EPS 서프라이즈", "AAPL")
        assert "aapl" in 문장
        assert "apple" in 문장

    def test_길이를_막는다(self):
        """본문은 길이 제한이 있지만 태그까지 붙으면 넘칠 수 있다.
        컬럼이 무거워지면 목록 SELECT 가 다시 느려진다."""
        문장 = C.검색문장("제", "가" * 100_000, "005930")
        assert len(문장) <= C._SEARCH_MAX

    def test_빈_값에_터지지_않는다(self):
        assert C.검색문장("", "", "", None) == ""
        assert C.검색문장("", "", "", []) == ""

    def test_태그가_이상해도_넘어간다(self):
        """옛 글의 태그는 형태가 제각각이다. 여기서 터지면 채워넣기가
        통째로 멈춘다."""
        문장 = C.검색문장("제목", "본문", "AAPL", [{}, {"symbol": None}, {"name": "이름만"}])
        assert "이름만" in 문장

    def test_이미지는_안_들어간다(self):
        """base64 이미지가 사본에 들어가면 컬럼이 수십 KB 가 되고, 검색은
        그 글자들 사이에서 헛걸린다."""
        본문 = C.encode_content("제목", "본문", "data:image/jpeg;base64,QUJDREVG")
        글 = type("G", (), {"content": 본문, "symbol": "005930"})()
        assert "base64" not in C.글에서_검색문장(글)
        assert "QUJDREVG".lower() not in C.글에서_검색문장(글)


class Test저장된_글에서_뽑기:
    def test_저장된_글에서_그대로_뽑아낸다(self):
        본문 = C.encode_content("삼성 목표가", "반도체 반등",
                                 tags=[{"symbol": "000660", "market": "KR", "name": "SK하이닉스"}])
        글 = type("G", (), {"content": 본문, "symbol": "005930"})()
        문장 = C.글에서_검색문장(글)
        for 조각 in ("목표가", "반등", "005930", "000660", "sk하이닉스"):
            assert 조각 in 문장, 조각

    def test_옛_형식_글도_본문을_건진다(self):
        """JSON 이 아니던 시절 글은 content 가 그냥 글자다."""
        글 = type("G", (), {"content": "그냥 옛날 글", "symbol": "005930"})()
        assert "옛날" in C.글에서_검색문장(글)


class Test와일드카드가_새지_않는다:
    """LIKE 는 % 와 _ 를 와일드카드로 읽는다. 검색어에 그대로 두면 '%' 한
    글자로 전체가 걸리고, '_' 는 아무 한 글자와 맞는다."""

    def test_이스케이프한다(self):
        본문 = inspect.getsource(C.get_feed)
        assert 'replace("%"' in 본문, "% 를 그대로 넘기고 있다"
        assert 'replace("_"' in 본문, "_ 를 그대로 넘기고 있다"

    def test_escape_문자를_명시한다(self):
        """이스케이프 문자의 기본값은 DB 마다 다르다. 안 적으면 어떤 DB 에서는
        역슬래시가 그냥 글자로 읽혀 이스케이프가 통째로 무의미해진다."""
        assert 'escape=' in inspect.getsource(C.get_feed)

    def test_역슬래시를_먼저_처리한다(self):
        """% 를 \\% 로 바꾼 뒤 역슬래시를 이스케이프하면, 방금 넣은 역슬래시가
        또 이스케이프돼 패턴이 깨진다. 순서가 있다."""
        본문 = inspect.getsource(C.get_feed)
        i역슬래시 = 본문.index('replace("\\\\"')
        i퍼센트 = 본문.index('replace("%"')
        assert i역슬래시 < i퍼센트, "역슬래시를 나중에 처리하고 있다"


class Test쓸_때_채운다:
    def test_새_글이_사본을_채운다(self):
        """여기가 비면 방금 쓴 글만 검색에 안 걸린다 — 제일 알아채기
        어려운 종류의 구멍이다."""
        본문 = inspect.getsource(C.create_post)
        assert "search_text" in 본문
        assert "검색문장(" in 본문

    def test_고친_글도_사본을_다시_쓴다(self):
        """제목을 고쳐 놓고 옛 제목으로 검색되면 더 이상하다."""
        본문 = inspect.getsource(C.update_post)
        assert "search_text = :search_text" in 본문
        assert "검색문장(" in 본문


class Test옛_글_채워넣기:
    def test_한_번에_다_하지_않는다(self):
        """0.15 CPU / 512MB 서버에서 수천 건을 한꺼번에 올리면 그동안
        앱이 안 뜬다."""
        서명 = inspect.signature(C.검색문장_채우기)
        assert "한번에" in 서명.parameters
        assert 서명.parameters["한번에"].default <= 500

    def test_아직_안_채운_것만_고른다(self):
        """다 채운 뒤에도 매번 전체를 훑으면 시작할 때마다 값을 낸다."""
        본문 = inspect.getsource(C.검색문장_채우기)
        assert "search_text.is_(None)" in 본문

    def test_실패해도_앱이_뜬다(self):
        """옛 글 검색 하나 때문에 서버가 안 뜨면 안 된다."""
        본문 = inspect.getsource(C.검색문장_채우기)
        assert "except Exception" in 본문
        assert "rollback" in 본문

    def test_옛_글이_실제로_채워진다(self, 임시DB):
        """여기가 이 클래스의 알맹이다. 나머지 검사는 소스를 읽을 뿐이라,
        import 하나만 어긋나도 통과한다 — 그 상태로는 채워넣기가 조용히
        안 돌고 옛 글은 영원히 검색에 안 걸린다."""
        db, 만들기, 다시읽기 = 임시DB
        글 = 만들기(제목="삼성 목표가", 본문="반도체 반등", 심볼="005930")
        assert 글.search_text is None

        assert C.검색문장_채우기(db) == 1
        db.refresh(글)
        assert "목표가" in 글.search_text
        assert "005930" in 글.search_text

    def test_다_채운_뒤에는_할_일이_없다(self, 임시DB):
        db, 만들기, 다시읽기 = 임시DB
        만들기(제목="제목", 본문="본문", 심볼="005930")
        assert C.검색문장_채우기(db) == 1
        assert C.검색문장_채우기(db) == 0

    def test_시작할_때_부르는_그_함수가_실제로_채운다(self, 임시DB, monkeypatch):
        """부품만 있고 아무도 안 부르면 컬럼은 영원히 빈 채로 남는다.

        main 이 부르는 것과 똑같은 함수를 여기서 부른다. 세션만 임시 DB 로
        바꿔 끼운다 — main 쪽 코드는 커다란 try 안에 있어서, 이름이 어긋나도
        경고 한 줄 남기고 조용히 넘어간다."""
        db, 만들기, 다시읽기 = 임시DB
        글_id = 만들기(제목="옛날 글", 본문="본문", 심볼="005930").id
        monkeypatch.setattr("app.db.database.SessionLocal", lambda: db)

        assert C.시작할때_검색문장_채우기() == 1
        # 그 함수는 세션을 닫는다. 실제로 남았는지는 새 세션으로 본다
        assert "옛날" in (다시읽기(글_id).search_text or "")

    def test_main_이_그_이름을_그대로_부른다(self):
        """이름이 어긋나면 NameError 가 나고, main 의 try 가 그걸 삼킨다.
        서버는 멀쩡히 뜨는데 채워넣기만 영영 안 도는 상태가 된다."""
        from pathlib import Path
        본문 = (Path(__file__).resolve().parents[1] / "app" / "main.py").read_text(encoding="utf-8")
        assert "시작할때_검색문장_채우기()" in 본문, "부르는 곳이 없다"
        assert "import 시작할때_검색문장_채우기" in 본문, "가져오는 곳이 없다"


class Test질의:
    def test_검색어를_받는다(self):
        assert "q" in inspect.signature(C.get_feed).parameters

    def test_검색어_길이를_막는다(self):
        """길수록 캐시 칸만 늘고 LIKE 도 느려진다."""
        본문 = inspect.getsource(C.get_feed)
        assert "_SEARCH_Q_MAX" in 본문
        assert C._SEARCH_Q_MAX <= 100

    def test_캐시가_검색어별로_갈린다(self):
        """검색어를 캐시 키에 안 넣으면, 한 번 검색한 결과가 그 다음
        검색·심지어 검색 안 한 피드에까지 그대로 나온다."""
        본문 = inspect.getsource(C.get_feed)
        i = 본문.index("캐시키 = ")
        assert "검색어" in 본문[i:i + 300], "캐시 키에 검색어가 없다"

    def test_공백만_친_것은_검색이_아니다(self):
        """스페이스 하나로 전체 글이 '검색 결과'가 되면 빈 화면 안내도
        엉뚱해진다."""
        본문 = inspect.getsource(C.get_feed)
        assert ".strip()" in 본문

    def test_대소문자를_맞춘다(self):
        """사본은 소문자로 저장된다. 검색어를 안 내리면 AAPL 로는
        아무것도 안 나온다."""
        본문 = inspect.getsource(C.get_feed)
        i = 본문.index("검색어 = ")
        assert ".lower()" in 본문[i:i + 120]


@pytest.fixture
def 임시DB(tmp_path):
    """글 몇 개만 든 진짜 DB. 채워넣기는 소스를 읽는 것으로는 못 지킨다."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from app.db.database import Base
    from app.models.community import StockPost

    엔진 = create_engine(f"sqlite:///{tmp_path}/t.db")
    Base.metadata.create_all(엔진, tables=[StockPost.__table__])
    세션열기 = sessionmaker(bind=엔진)
    db = 세션열기()

    def 만들기(제목, 본문, 심볼, 태그=None):
        글 = StockPost(symbol=심볼, market="KR", user_id=1,
                       content=C.encode_content(제목, 본문, tags=태그 or []))
        db.add(글)
        db.commit()
        db.refresh(글)
        return 글

    def 다시읽기(글_id):
        """세션을 닫는 코드를 검사할 때 쓴다 — 실제로 DB 에 남았는지는
        새 세션으로 봐야 안다"""
        새 = 세션열기()
        try:
            return 새.get(StockPost, 글_id)
        finally:
            새.close()

    try:
        yield db, 만들기, 다시읽기
    finally:
        db.close()


@pytest.fixture
def 앱():
    from fastapi.testclient import TestClient
    from app.main import app
    return TestClient(app)


class Test실제로_불러본다:
    def test_검색어를_붙여도_200_이다(self, 앱):
        with 앱 as c:
            assert c.get("/api/v1/community/feed", params={"q": "삼성"}).status_code == 200

    def test_와일드카드를_넣어도_안_터진다(self, 앱):
        with 앱 as c:
            for 값 in ("%", "_", "\\", "%%%", "a_b%c"):
                r = c.get("/api/v1/community/feed", params={"q": 값})
                assert r.status_code == 200, (값, r.text[:200])

    def test_너무_긴_검색어는_거절한다(self, 앱):
        with 앱 as c:
            r = c.get("/api/v1/community/feed", params={"q": "가" * 500})
            assert r.status_code == 422
