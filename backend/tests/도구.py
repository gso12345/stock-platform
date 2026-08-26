"""검사끼리 같이 쓰는 작은 도구.

지금은 하나뿐이다 — '종목 라우트 전체 원문'.

종목 라우트는 원래 stocks.py 한 파일(2,306줄)이었고, 여러 검사가
그 파일을 통째로 읽어 "여기서 ThreadPoolExecutor 를 만들지 않는다"
같은 것을 봤다. 탭 단위로 쪼개면서 파일이 일곱 개가 됐는데,
inspect.getsource(패키지) 는 __init__.py 만 준다. 그대로 두면 검사는
계속 통과하면서 정작 아무것도 안 지키게 된다 — 있는 것보다 나쁘다.

그래서 조각을 전부 이어 붙여 준다. 새 조각을 추가해도 자동으로 딸려
들어오므로, 나중에 또 쪼개도 검사가 조용히 눈멀지 않는다.
"""
import pathlib

_뿌리 = pathlib.Path(__file__).resolve().parents[1]
종목라우트_폴더 = _뿌리 / "app" / "api" / "routes" / "stocks"


def 종목라우트_원문() -> str:
    """stocks 패키지의 모든 .py 를 이어 붙인 원문."""
    조각들 = sorted(종목라우트_폴더.glob("*.py"))
    assert 조각들, f"종목 라우트 조각을 못 찾았다: {종목라우트_폴더}"
    return "\n".join(p.read_text(encoding="utf-8") for p in 조각들)
