"""안 되는 금리 후보는 그만 물어본다 — 공용 쉼표와 국내 금리 조회.

배경: 국내 금리는 '되는 주소를 모르니 후보를 차례로 걸어 본다' 는 방식인데,
실패한 후보를 기억하지 않아서 갱신마다 54개를 전부 다시 걸었다. 하나에 5초씩
잡으면 한 번 갱신이 4분이 넘는다. 0.15 CPU 서버에서는 그것만으로 다른 요청이
밀린다. 그래서 콜금리·회사채 후보를 더 넣고 싶어도 넣을 수가 없었다.
"""
import pytest

from app.core.backoff import 쉼표
import app.services.market_extras as M


# ── 공용 쉼표 그 자체 ───────────────────────────────────────
class Test쉼표:
    def test_기준만큼_연속_실패해야_쉰다(self):
        s = 쉼표(쉼_기준=3)
        for _ in range(2):
            s.기록("가", True)
        assert not s.쉬는가("가"), "두 번 실패로는 아직 쉬면 안 된다"
        s.기록("가", True)
        assert s.쉬는가("가")

    def test_한_번_성공하면_처음부터_다시_센다(self):
        s = 쉼표(쉼_기준=3)
        s.기록("가", True)
        s.기록("가", True)
        s.기록("가", False)
        s.기록("가", True)
        assert not s.쉬는가("가")
        assert s.실패수("가") == 1

    def test_쉬는것은_빠지고_깨울_칸만큼만_돌아온다(self):
        s = 쉼표(쉼_기준=1, 되살림_칸=2)
        for n in ["죽1", "죽2", "죽3", "죽4", "죽5"]:
            s.기록(n, True)
        고른것 = s.돌아가며_깨우기(["산1", "산2", "죽1", "죽2", "죽3", "죽4", "죽5"])
        assert [x for x in 고른것 if x.startswith("산")] == ["산1", "산2"]
        assert len([x for x in 고른것 if x.startswith("죽")]) == 2

    def test_깨우는_자리가_회차마다_옮겨_가서_모두_한_번씩_시도된다(self):
        """이게 핵심이다. 자리를 안 옮기면 목록 앞머리만 계속 깨우고
        뒤쪽 후보는 영영 시도되지 않는다 — 되살아날 길이 막힌다."""
        s = 쉼표(쉼_기준=1, 되살림_칸=2)
        전체 = [f"죽{i}" for i in range(6)]
        for n in 전체:
            s.기록(n, True)
        본것 = set()
        for _ in range(3):                    # 6개를 2칸씩 → 3회차면 한 바퀴
            본것 |= set(s.돌아가며_깨우기(전체))
        assert 본것 == set(전체), f"한 바퀴에 다 못 돌았다: {sorted(set(전체) - 본것)}"

    def test_전부_쉬고_깨울_칸도_없으면_그래도_하나는_남긴다(self):
        """빈 목록을 돌려주면 아무 요청도 안 나가고, 그러면 스스로
        되살아날 길까지 함께 막힌다."""
        s = 쉼표(쉼_기준=1, 되살림_칸=0)
        for n in ["죽1", "죽2"]:
            s.기록(n, True)
        assert s.돌아가며_깨우기(["죽1", "죽2"]) == ["죽1"]

    def test_주기형은_주기가_왔을_때만_전부_깨운다(self):
        s = 쉼표(쉼_기준=1, 되살림_주기=3)
        s.기록("죽", True)
        assert s.골라내기(["산", "죽"]) == ["산"]      # 1회차
        assert s.골라내기(["산", "죽"]) == ["산"]      # 2회차
        assert s.골라내기(["산", "죽"]) == ["산", "죽"]  # 3회차 — 깨운다

    def test_쉬는것들은_관리자에게_보여줄_이름만_준다(self):
        s = 쉼표(쉼_기준=2)
        s.기록("죽", True); s.기록("죽", True)
        s.기록("산", True)
        assert s.쉬는것들() == ["죽"]


# ── 실제 금리 조회에 붙었는지 ───────────────────────────────
class _응답:
    def __init__(self, code=404):
        self.status_code = code

    def json(self):
        return {}


@pytest.fixture
def 다_실패(monkeypatch):
    """모든 요청이 실패하는 상황. 나간 요청 수를 센다."""
    M.금리쉼표.잊기()
    본것: list = []

    def _가짜(url, **kw):
        본것.append(url)
        return _응답()

    monkeypatch.setattr(M.httpx, "get", _가짜)
    yield 본것
    M.금리쉼표.잊기()


class Test금리_후보_백오프:
    def test_계속_실패하면_갱신마다_나가는_요청이_확_준다(self, 다_실패):
        전체후보 = (len(M._네이버_금리목록주소)
                    + sum(len(c) for _, _, c in M._네이버_금리후보))

        다_실패.clear()
        M._fetch_kr_rates_naver()
        첫회차 = len(다_실패)
        assert 첫회차 == 전체후보, "처음에는 후보를 전부 걸어 봐야 한다"

        for _ in range(M.금리쉼표.쉼_기준):      # 쉬는 상태로 들어갈 때까지
            M._fetch_kr_rates_naver()

        다_실패.clear()
        M._fetch_kr_rates_naver()
        assert len(다_실패) == M.금리쉼표.되살림_칸, (
            f"안정 뒤에는 깨울 칸({M.금리쉼표.되살림_칸})만큼만 나가야 한다"
        )
        assert len(다_실패) < 첫회차 / 10

    def test_모든_후보가_언젠가는_다시_시도된다(self, 다_실패):
        """되살림이 목록 앞머리만 반복하면, 뒤쪽 후보는 되살아나도
        영영 못 찾는다."""
        전체후보 = (len(M._네이버_금리목록주소)
                    + sum(len(c) for _, _, c in M._네이버_금리후보))
        for _ in range(M.금리쉼표.쉼_기준 + 1):
            M._fetch_kr_rates_naver()

        다_실패.clear()
        한바퀴 = -(-전체후보 // M.금리쉼표.되살림_칸) + 2
        for _ in range(한바퀴):
            M._fetch_kr_rates_naver()

        본코드 = {u.rsplit("/", 2)[-2] for u in 다_실패 if u.endswith("/basic")}
        모든코드 = {c for _, _, 코드들 in M._네이버_금리후보 for c in 코드들}
        assert 모든코드 <= 본코드, f"한 바퀴에 못 돈 후보: {sorted(모든코드 - 본코드)}"

    def test_한_번_되면_그_이름의_남은_후보는_안_묻는다(self, monkeypatch):
        """'국고채 3년' 후보가 9개인데 첫 후보에서 성공하면 나머지
        8개를 걸어 볼 이유가 없다."""
        M.금리쉼표.잊기()
        본것: list = []

        class _됨:
            status_code = 200

            def json(self):
                return {"closePrice": "3.21", "compareToPreviousClosePrice": "0.01"}

        def _가짜(url, **kw):
            본것.append(url)
            return _됨() if "/basic" in url else _응답()

        monkeypatch.setattr(M.httpx, "get", _가짜)
        M._fetch_kr_rates_naver()
        M.금리쉼표.잊기()

        코드들 = [u.rsplit("/", 2)[-2] for u in 본것 if u.endswith("/basic")]
        assert len(코드들) == len(M._네이버_금리후보), (
            "이름마다 첫 후보 하나씩만 물어야 한다"
        )


class Test콜금리_회사채_후보가_들어있다:
    def test_후보_목록에_콜금리와_회사채가_있다(self):
        이름들 = [이름 for 이름, _, _ in M._네이버_금리후보]
        for 있어야할것 in ("콜금리(1일)", "회사채 AA- 3년", "회사채 BBB- 3년"):
            assert 있어야할것 in 이름들, f"{있어야할것} 후보가 빠졌다"

    def test_후보를_늘려도_안정_뒤_비용은_그대로다(self, 다_실패):
        """백오프가 없으면 후보를 늘린 만큼 갱신 비용이 그대로 늘어난다.
        그래서 예전에는 후보를 넣기가 부담스러웠다."""
        for _ in range(M.금리쉼표.쉼_기준 + 1):
            M._fetch_kr_rates_naver()
        다_실패.clear()
        M._fetch_kr_rates_naver()
        assert len(다_실패) == M.금리쉼표.되살림_칸
