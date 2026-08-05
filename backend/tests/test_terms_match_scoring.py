"""
화면의 지표 설명이 '얼마면 좋다'고 말하지 않는지.

한때 화면 설명에 "PER 10배 아래면 싼 편", "부채비율 200% 위면 빚이 많은 편"
이라고 적어 놨었다. 업종마다 기업마다 보통 수준이 달라서 그대로 대면 틀린다 —
경기민감 업종은 실적이 정점일 때 PER 이 가장 낮게 나오고(제일 위험한 시점을
'싸다'고 가리킨다), 은행은 부채비율이 1,000%를 넘는 것이 정상이다.

서버도 같은 판단을 하고 있다. 퀀트 점수는 PER·PBR·EV/EBITDA 를 절대 숫자로
매기지 않고 같은 업종 안에서 백분위로 매긴다(SECTOR_RELATIVE_METRICS).
그런데 화면만 절대 숫자를 말하고 있었다.

지금은 뜻만 남겼다. 이 파일은 그게 되살아나지 않게 지킨다.

프런트엔드 소스를 읽는 두 번째 테스트다(첫 번째는 test_limits_match_frontend).
언어가 달라 타입으로 묶을 수 없고, 어긋나도 오류가 나지 않아 사람이
알아채기 어려운 종류라서 여기서 걸리게 한다.
"""
import re
from pathlib import Path

import pytest

from app.services.quant_score import SECTOR_RELATIVE_METRICS

_TS = Path(__file__).resolve().parents[2] / "frontend" / "src" / "constants" / "terms.ts"

# 서버 지표 키 → 화면에 그려지는 이름들
_화면이름 = {
    "per":         ["PER", "PER(현재)"],
    "forward_per": ["PER(선행)"],
    "pbr":         ["PBR"],
    "ev_ebitda":   ["EV/EBITDA"],
}

# "10배 아래면 싼 편", "200% 위면 빚이 많은 편" 같은 단정
_단정 = re.compile(r"[0-9]+\s*(?:배|%)\s*(?:아래|위|이상|이하)면\s*(?:싸|싼|비싸|비싼|좋|안정|넉넉|많)")


@pytest.fixture(scope="module")
def 사전본문() -> str:
    if not _TS.exists():
        pytest.skip(f"화면 상수 파일이 없다: {_TS}")
    src = _TS.read_text(encoding="utf-8")
    # 파일 머리말 주석에는 옛 문구가 '이러면 안 된다'는 예로 적혀 있다.
    # 사전 본문만 본다.
    return src[src.index("export const 용어사전"):]


@pytest.fixture(scope="module")
def 뜻들(사전본문) -> dict[str, str]:
    """'이름 → 뜻' 을 뽑는다.

    타입스크립트를 제대로 파싱하지는 않는다. 필요한 건 '어떤 이름 아래에
    어떤 뜻이 붙어 있나' 뿐이라, 이름이 나온 뒤 처음 만나는 뜻을 그 이름의
    것으로 본다."""
    나온것: dict[str, str] = {}
    현재이름 = None
    for 줄 in 사전본문.splitlines():
        m = re.match(r'\s*"?([^":]+?)"?\s*:\s*\{', 줄)
        if m and m.group(1).strip() not in ("뜻", "이름"):
            현재이름 = m.group(1).strip()
        g = re.search(r'뜻:\s*"([^"]*)"', 줄)
        if g and 현재이름:
            나온것.setdefault(현재이름, g.group(1))
    return 나온것


class Test얼마면_좋다고_말하지_않는다:
    def test_뜻에_절대_기준이_없다(self, 뜻들):
        걸린것 = [f"{이름}: {뜻}" for 이름, 뜻 in 뜻들.items() if _단정.search(뜻)]
        assert 걸린것 == [], (
            "업종마다 다른 값을 한 줄로 못 박았다:\n  " + "\n  ".join(걸린것))

    def test_기준_칸_자체가_없다(self, 사전본문):
        """칸을 남겨두면 언젠가 누가 다시 채운다."""
        assert "기준:" not in 사전본문, (
            "용어사전에 기준 칸이 다시 생겼다 — 뜻만 두기로 했다")


class Test서버가_고른_지표:
    def test_화면에도_설명이_있다(self, 뜻들):
        """서버가 업종 상대평가로 분류한 지표는 화면에서도 설명돼야 한다."""
        빠진분류 = [k for k in SECTOR_RELATIVE_METRICS if k not in _화면이름]
        assert 빠진분류 == [], (
            f"서버가 업종 상대평가로 분류한 {빠진분류} 가 이 표에 없다. "
            f"화면 이름을 _화면이름 에 넣어야 한다")

        for 키 in SECTOR_RELATIVE_METRICS:
            for 이름 in _화면이름[키]:
                assert 이름 in 뜻들, f"{키}({이름}) 설명을 terms.ts 에서 못 찾았다"


class Test뽑아내기가_실제로_동작하는가:
    """위 검사들은 뜻을 하나도 못 뽑아도 조용히 통과할 수 있다.
    표를 잘못 만들었을 때 '문제 없음'으로 보이는 게 제일 나쁘다."""

    def test_뜻을_충분히_뽑았다(self, 뜻들):
        assert len(뜻들) >= 30, f"terms.ts 에서 {len(뜻들)}개만 뽑혔다 — 읽는 방식이 깨졌다"

    def test_단정_찾기가_실제로_잡는다(self):
        assert _단정.search("10배 아래면 싼 편, 30배 위면 비싼 편.")
        assert _단정.search("100% 아래면 안정적, 200% 위면 빚이 많은 편.")
        assert not _단정.search("지금 주가가 회사가 1년에 버는 돈의 몇 배인지.")
