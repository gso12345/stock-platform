"""
국내 종목 상세가 EPS 를 안 주던 것 —
"종목상세탭 재무제표에 EPS가 나오는데도 기본정보에 EPS가 안나옴"

국내 종목의 /detail 은 네이버에서 시세를 받는다. 네이버 응답에는 재무지표가
없어서 fundamentals 캐시로 채우는데, 그 목록(_KR_FUND_KEYS)에 per·eps·pbr·bps
가 빠져 있었다. forward_eps(선행 EPS)는 있는데 정작 eps(현재 EPS)가 없었다.

그래서 국내 종목은 detail 응답의 eps 가 끝까지 비어 있었다. 재무제표 탭은
detail 이 비면 fundamentals 를 다시 보므로 값이 나왔고, 기본정보는 detail 만
보고 있어서 안 나왔다 — 같은 화면에서 한쪽만 비는 증상의 뿌리가 여기다.

화면 쪽에서도 같은 값을 보도록 고쳤지만(그건 프런트 테스트가 지킨다),
그건 증상을 가린 것이고 뿌리는 이 목록이다.
"""
import re
from pathlib import Path

import pytest

_SRC = Path(__file__).resolve().parents[1] / "app" / "api" / "routes" / "stocks.py"


@pytest.fixture(scope="module")
def 채워오는것() -> list[str]:
    """_KR_FUND_KEYS 에 들어 있는 이름들"""
    본문 = _SRC.read_text(encoding="utf-8")
    i = 본문.index("_KR_FUND_KEYS = (")
    j = 본문.index(")", 본문.index('"description"', i))
    return re.findall(r'"(\w+)"', 본문[i:j])


class Test국내_상세가_재무지표를_채운다:
    def test_현재_EPS_를_채운다(self, 채워오는것):
        """이게 빠져서 기본정보 EPS 가 비어 있었다."""
        assert "eps" in 채워오는것

    def test_PER_PBR_BPS_도_채운다(self, 채워오는것):
        """EPS 와 같은 자리에서 같은 이유로 빠져 있었다. 하나만 넣으면
        다음에 PER 로 똑같은 문의가 온다."""
        빠진것 = [k for k in ("per", "pbr", "bps") if k not in 채워오는것]
        assert 빠진것 == [], f"{빠진것} 가 아직 빠져 있다"

    def test_선행값도_그대로_있다(self, 채워오는것):
        """예전부터 있던 것을 실수로 빼지 않았는지."""
        for k in ("forward_per", "forward_eps", "peg", "roe", "debt_ratio"):
            assert k in 채워오는것, f"{k} 가 사라졌다"

    def test_목록을_실제로_뽑았다(self, 채워오는것):
        """정규식이 아무것도 못 잡아도 위 검사들은 조용히 통과할 수 있다 —
        아니, 통과 못 한다. 그래도 개수는 확인해 둔다."""
        assert len(채워오는것) >= 20, f"{len(채워오는것)}개만 뽑혔다 — 읽는 방식이 깨졌다"

    def test_비어_있을_때만_채운다(self, 채워오는것):
        """네이버가 준 값이 있으면 그걸 쓴다. 덮어쓰면 실시간 값이
        하루 묵은 캐시로 바뀐다."""
        본문 = _SRC.read_text(encoding="utf-8")
        i = 본문.index("_KR_FUND_KEYS = (")
        구역 = 본문[i:i + 1200]
        assert "if not price.get(key)" in 구역, "무조건 덮어쓰고 있다"
