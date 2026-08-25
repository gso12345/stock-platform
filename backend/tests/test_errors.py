"""터진 오류를 실제로 남기는가.

이 자리가 없어서 오늘까지 문제를 전부 사용자 제보로 알았다 — 엔비디아가
순위에서 사라진 것도, 콜금리가 안 뜨는 것도, 글자가 너무 커진 것도.
사용자가 말해 주지 않았으면 몰랐을 것이다.

health.py 는 '무엇이 몇 번 실패했나' 를 센다. 여기는 '무엇이 어떻게
터졌나' 를 남긴다. 서버 로그에도 찍히지만 Render 무료 플랜은 재시작이
잦아 곧 흘러간다.
"""
import pytest
from fastapi.testclient import TestClient

from app.core import errors as E


@pytest.fixture(autouse=True)
def _비우기():
    E.비우기()
    yield
    E.비우기()


@pytest.fixture
def 서버():
    from app.main import app
    # 전역 예외 처리기가 실제로 도는지 봐야 하므로 예외를 밖으로 안 던진다
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c


class Test같은_오류를_묶는가:
    def test_같은_오류는_한_줄에_횟수만_센다(self):
        """한 번 터지는 자리는 보통 계속 터진다. 그걸 200줄로 채우면
        다른 오류가 밀려난다."""
        for _ in range(5):
            E.화면오류_남기기("TypeError", "Cannot read 'map' of undefined\n at A.tsx:10")
        목록 = E.목록()
        assert len(목록) == 1
        assert 목록[0]["횟수"] == 5

    def test_다른_오류는_따로_센다(self):
        E.화면오류_남기기("TypeError", "가")
        E.화면오류_남기기("NetworkError", "나")
        assert len(E.목록()) == 2

    def test_스택_아래쪽이_달라도_같은_오류로_본다(self):
        """스택 아래쪽은 같은 오류라도 호출 경로에 따라 달라진다.
        그걸 다르다고 세면 같은 오류가 수십 줄로 늘어난다."""
        E.화면오류_남기기("TypeError", "같은 줄\n둘째 줄\n셋째 줄\n넷째 줄 A")
        E.화면오류_남기기("TypeError", "같은 줄\n둘째 줄\n셋째 줄\n넷째 줄 B")
        assert len(E.목록()) == 1


class Test서버가_안_죽게:
    def test_종류가_넘치면_오래된_것부터_버린다(self, monkeypatch):
        """512MB 서버라 무한정 쌓을 수 없다."""
        monkeypatch.setattr(E, "MAX_KINDS", 5)
        for i in range(20):
            E.화면오류_남기기(f"오류{i}", f"내용{i}")
        목록 = E.목록(999)
        assert len(목록) == 5
        assert any("오류19" in x["무엇"] for x in 목록), "최근 것이 남아야 한다"
        assert not any("오류0" == x["무엇"] for x in 목록), "오래된 것이 버려져야 한다"

    def test_기록하다_터져도_밖으로_안_던진다(self, monkeypatch):
        """오류를 기록하다가 요청이 죽으면 고치려던 것보다 나쁘다.

        담는 자리를 일부러 터뜨린다. 처음에는 __str__ 이 터지는 예외를
        넘겨 봤는데 traceback 이 알아서 처리해 버려서, 정작 이 방어가
        있는지 없는지를 못 가렸다 — 돌연변이 검사에서 그렇게 빠져나갔다."""
        def _터짐(*a, **k):
            raise RuntimeError("담다가 터짐")
        monkeypatch.setattr(E, "_담기", _터짐)

        try:
            raise ValueError("본래 오류")
        except ValueError as e:
            E.남기기("어딘가", e)          # 예외가 새어 나오면 여기서 실패한다

    def test_화면오류도_기록하다_터지면_삼킨다(self, monkeypatch):
        """이걸 부르는 자리는 누구나 열 수 있는 공개 라우트다. 여기서
        500 이 나면 그 자체가 또 하나의 오류로 기록되며 맞물려 돈다."""
        def _터짐(*a, **k):
            raise RuntimeError("담다가 터짐")
        monkeypatch.setattr(E, "_담기", _터짐)
        E.화면오류_남기기("X", "Y")      # 새어 나오면 여기서 실패한다

    def test_본문이_아주_길어도_잘라_담는다(self):
        E.화면오류_남기기("Big", "가" * 100_000)
        assert len(E.목록()[0]["자세히"]) <= E.MAX_DETAIL


class Test서버_오류:
    def test_예외에서_이름과_스택을_뽑는다(self):
        try:
            raise ValueError("일부러 낸 오류")
        except ValueError as e:
            E.남기기("GET /api/v1/test", e, 어디서="/dashboard")
        칸 = E.목록()[0]
        assert 칸["무엇"] == "ValueError"
        assert "일부러 낸 오류" in 칸["자세히"]
        assert 칸["어디"] == "GET /api/v1/test"
        assert 칸["어디서"] == "/dashboard"

    def test_화면_오류와_한자리에_모인다(self):
        """사용자가 겪는 고장은 어느 쪽에서 났든 하나의 사건이다."""
        E.화면오류_남기기("TypeError", "화면에서")
        try:
            raise KeyError("서버에서")
        except KeyError as e:
            E.남기기("GET /x", e)
        어디들 = {x["어디"] for x in E.목록()}
        assert "화면" in 어디들
        assert "GET /x" in 어디들


class Test브라우저가_보내는_길:
    def test_받아서_담는다(self, 서버):
        r = 서버.post("/api/v1/client-errors", json={
            "무엇": "TypeError", "자세히": "터짐", "어디서": "/"})
        assert r.status_code == 200
        assert any(x["무엇"] == "TypeError" for x in E.목록())

    def test_아무것도_안_보내도_안_터진다(self, 서버):
        """받는 쪽은 누구나 부를 수 있다. 이상한 본문에 500 을 내면
        그것 자체가 공격 수단이 된다."""
        r = 서버.post("/api/v1/client-errors", json={})
        assert r.status_code == 200

    def test_아주_긴_본문은_거절한다(self, 서버):
        """스택 전체를 그대로 받으면 한 건에 수십 KB 다."""
        r = 서버.post("/api/v1/client-errors", json={
            "무엇": "X", "자세히": "가" * 50_000})
        assert r.status_code == 422


class Test요약:
    def test_한시간_안의_것을_따로_센다(self):
        """'지금 뭐가 터지고 있나' 와 '예전에 터진 적 있나' 는 다르다."""
        E.화면오류_남기기("A", "가")
        E.화면오류_남기기("A", "가")
        E.화면오류_남기기("B", "나")
        요약 = E.요약()
        assert 요약["종류"] == 2
        assert 요약["전체횟수"] == 3
        assert 요약["한시간_종류"] == 2
        assert 요약["가장_잦은"] == "A"

    def test_아무것도_없으면_0(self):
        요약 = E.요약()
        assert 요약["종류"] == 0 and 요약["가장_잦은"] is None
