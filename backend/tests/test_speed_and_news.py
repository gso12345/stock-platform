"""
느리다고 한 곳과, 이미지 없이 나오던 뉴스.

  1) 국내 뉴스에 그림 없는 기사가 섞여 나왔다.
     종합피드(썸네일 있음)와 구글 뉴스(RSS 에 썸네일이 거의 없음)를 그대로
     이어 붙여서, 목록 뒷쪽이 통째로 회색 신문 아이콘이 됐다.

  2) 퀀트 탭이 느렸다.
     지표 캐시가 5분이라, 지난 뒤 들어온 사람은 종목마다 OHLCV 를 새로
     받는 값을 다 치렀다. 관심종목 20개면 20번이다.

  3) 피드가 느렸다.
     목록 캐시가 3분이라 3분마다 한 명씩 전체 재조립 값을 냈다.
     글이 바뀔 때 캐시를 직접 비우고 있으므로 수명은 길게 잡아도 된다.
"""
import ast
import pathlib
import re

from 도구 import 종목라우트_원문

# 종목 라우트는 파일 일곱 개로 쪼개져 있다. 조각 하나만 보면 나머지에서
# 되살아난 것을 놓친다 — 전부 이어 붙여서 본다
_주식 = 종목라우트_원문()
_커뮤 = (pathlib.Path(__file__).resolve().parents[1]
         / "app" / "api" / "routes" / "community.py").read_text(encoding="utf-8")


def _코드만(본문: str) -> str:
    """주석·문서화 문자열을 걷어낸다.

    무엇을 왜 그만뒀는지 주석에 적어 두기 때문에, 그걸 현재 코드로
    착각하면 멀쩡한 구현이 걸린다(앞선 점검에서 여러 번 겪었다)."""
    본문 = re.sub(r'"""[\s\S]*?"""', "", 본문)
    return re.sub(r"^\s*#.*$", "", 본문, flags=re.M)


def _함수(소스: str, 이름: str) -> str:
    """그 함수의 **원본** 글자를 잘라 낸다.

    ast.unparse 를 쓰면 안 된다 — 따옴표를 홑따옴표로 바꾸고 기본값의
    공백을 없애서(최소: int=8), 글자로 맞춰 보는 검사가 전부 어긋난다.
    실제로 여기서 한 번 헛짚었다."""
    나무 = ast.parse(소스)
    for n in ast.walk(나무):
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == 이름:
            줄 = 소스.splitlines()
            끝 = n.end_lineno or (n.lineno + 40)
            return "\n".join(줄[n.lineno - 1:끝])
    raise AssertionError(f"{이름} 을 못 찾음")


class Test뉴스이미지:
    def test_그림_있는_기사를_먼저_채운다(self):
        본문 = _코드만(_함수(_주식, "_merge_news"))
        assert "그림있음" in 본문 and "그림없음" in 본문, "그림 유무로 가르지 않는다"
        assert 'item.get("image")' in 본문

    def test_그림이_없다고_아예_버리지는_않는다(self):
        """종합피드에 그 종목 기사가 적으면 걸러내는 순간
        '뉴스가 없습니다' 가 된다."""
        본문 = _코드만(_함수(_주식, "_merge_news"))
        assert "최소" in 본문, "최소 건수 보장이 없다 — 뉴스가 통째로 빌 수 있다"
        m = re.search(r"최소: int = (\d+)", 본문)
        assert m and int(m.group(1)) >= 5, "최소 건수가 너무 적다"

    def test_국내와_해외_모두_같은_규칙을_쓴다(self):
        # 한쪽만 고치면 화면마다 다르게 보인다
        assert _코드만(_주식).count("_merge_news(") >= 3


class Test퀀트속도:
    def test_지표_캐시가_충분히_길다(self):
        """5분이면 지난 뒤 들어온 사람이 전부 다시 받는다."""
        m = re.search(r"QMETRICS_TTL = (\d+)", _주식)
        assert m, "TTL 상수를 못 찾음"
        assert int(m.group(1)) >= 900, f"너무 짧다: {m.group(1)}초"

    def test_수명이_지나도_기다리게_하지_않는다(self):
        """지난 값이 있으면 그것으로 먼저 답하고 새로 받기는 뒤로 미룬다."""
        본문 = _코드만(_함수(_주식, "get_quant_score_compare"))
        assert "get_stale(metrics_ck)" in 본문, "지난 값을 안 쓴다"
        assert "_퀀트지표_뒤로미루기" in 본문, "배경 갱신을 안 건다"

    def test_같은_종목_갱신이_겹치지_않는다(self):
        """여러 사람이 같은 종목을 동시에 열면 갱신이 겹친다.
        0.15 CPU 에서는 겹치는 것 자체가 비용이다."""
        본문 = _코드만(_함수(_주식, "_퀀트지표_뒤로미루기"))
        # 이름만 보면 한 곳을 지워도 다른 곳에 남아 통과한다
        # (뮤테이션에서 실제로 그렇게 빠져나갔다). 세 조각을 각각 본다
        assert "if ck in _퀀트갱신중" in 본문, "이미 도는 갱신을 안 가려낸다"
        assert "_퀀트갱신중.add(ck)" in 본문, "표시를 안 남긴다"
        # 끝났을 때와 못 걸었을 때 둘 다 지워야 한다 — 하나라도 빠지면
        # 그 종목은 다시는 갱신되지 않는다
        assert 본문.count("_퀀트갱신중.discard(ck)") >= 2, "표시를 지우는 자리가 부족하다"

    def test_배경_갱신이_실패해도_조용히_넘어가지_않는다(self):
        assert "log.warning" in _코드만(_함수(_주식, "_퀀트지표_뒤로미루기"))


class Test피드속도:
    def test_목록_캐시가_충분히_길다(self):
        m = re.search(r"FEED_TTL = (\d+)", _커뮤)
        assert m, "FEED_TTL 을 못 찾음"
        assert int(m.group(1)) >= 600, f"너무 짧다: {m.group(1)}초"

    def test_길게_잡아도_새_글은_곧바로_보인다(self):
        """수명을 늘릴 수 있는 근거다 — 글이 바뀔 때 캐시를 직접 버린다.
        이게 사라지면 늘린 수명만큼 새 글이 안 보인다."""
        assert _커뮤.count("피드캐시_비우기()") >= 4, \
            "글 변경 시 캐시를 비우는 자리가 줄었다 — 수명을 되돌려야 한다"
