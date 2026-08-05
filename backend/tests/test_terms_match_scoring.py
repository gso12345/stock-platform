"""
화면의 지표 설명이 서버의 채점 방식과 어긋나지 않는지.

서버는 PER·PBR·EV/EBITDA 를 '절대 숫자로 판단할 수 없는 지표'로 분류해
같은 업종 안에서 백분위로 점수를 매긴다(SECTOR_RELATIVE_METRICS). 그런데
화면 설명에는 "PER 10배 아래면 싼 편" 이라고 적어 놨었다. 같은 앱이 한
화면에서는 '업종 안에서 상대평가'라고 하고, 바로 옆에서는 '10배면 싸다'고
말한 셈이다.

업종마다 보통 수준이 다르기 때문에 그 잣대는 틀린다. 특히 경기민감 업종은
실적이 정점일 때 PER 이 가장 낮게 나와서, '10배 아래면 싸다'는 하필 제일
위험한 시점을 가리킨다.

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
def 설명들() -> dict[str, str]:
    """terms.ts 에서 '이름 → 기준 문구' 를 뽑는다.

    타입스크립트를 제대로 파싱하지는 않는다. 필요한 건 '어떤 이름 아래에
    어떤 기준 문구가 붙어 있나' 뿐이라, 이름이 나온 뒤 처음 만나는 기준을
    그 이름의 것으로 본다."""
    if not _TS.exists():
        pytest.skip(f"화면 상수 파일이 없다: {_TS}")
    src = _TS.read_text(encoding="utf-8")
    # 주석은 걷어낸다 — 파일 머리말에 예시로 옛 문구가 적혀 있다
    본문 = src[src.index("export const 용어사전"):]

    나온것: dict[str, str] = {}
    현재이름 = None
    for 줄 in 본문.splitlines():
        m = re.match(r'\s*"?([^":]+?)"?\s*:\s*\{', 줄)
        if m and "기준" not in m.group(1) and "뜻" not in m.group(1):
            현재이름 = m.group(1).strip()
        # 한 줄에 다 들어간 형태도 있다
        g = re.search(r'기준:\s*"([^"]*)"', 줄)
        if g and 현재이름:
            나온것.setdefault(현재이름, g.group(1))
    return 나온것


class Test업종을_타는_지표:
    def test_서버가_고른_지표가_화면에도_있다(self, 설명들):
        """서버에 지표가 추가되면 화면 설명도 따라와야 한다."""
        빠진것 = [k for k in SECTOR_RELATIVE_METRICS if k not in _화면이름]
        assert 빠진것 == [], (
            f"서버가 업종 상대평가로 분류한 {빠진것} 가 이 표에 없다. "
            f"화면 이름을 _화면이름 에 넣고 설명도 확인해야 한다")

        for 키 in SECTOR_RELATIVE_METRICS:
            for 이름 in _화면이름[키]:
                assert 이름 in 설명들, f"{키}({이름}) 설명을 terms.ts 에서 못 찾았다"

    def test_절대_숫자로_단정하지_않는다(self, 설명들):
        """서버는 업종 안에서 상대평가하는데 화면이 '10배면 싸다'고 하면,
        같은 앱이 서로 다른 말을 하는 것이다."""
        걸린것 = []
        for 키 in SECTOR_RELATIVE_METRICS:
            for 이름 in _화면이름[키]:
                문구 = 설명들.get(이름, "")
                if _단정.search(문구):
                    걸린것.append(f"{이름}: {문구}")
        assert 걸린것 == [], (
            "서버는 업종 안에서 백분위로 매기는데 화면은 절대 숫자로 단정한다:\n  "
            + "\n  ".join(걸린것))

    def test_무엇과_견주라고_알려준다(self, 설명들):
        """단정만 지우면 '그래서 어떻게 보라는 거지' 가 된다."""
        부실한것 = []
        for 키 in SECTOR_RELATIVE_METRICS:
            for 이름 in _화면이름[키]:
                문구 = 설명들.get(이름, "")
                if "업종" not in 문구:
                    부실한것.append(f"{이름}: {문구}")
        assert 부실한것 == [], (
            "업종을 타는 지표인데 무엇과 견주라는 말이 없다:\n  " + "\n  ".join(부실한것))


class Test뽑아내기가_실제로_동작하는가:
    """위 검사들은 설명을 하나도 못 뽑아도 조용히 통과할 수 있다.
    표를 잘못 만들었을 때 '문제 없음'으로 보이는 게 제일 나쁘다."""

    def test_설명을_충분히_뽑았다(self, 설명들):
        assert len(설명들) >= 20, f"terms.ts 에서 {len(설명들)}개만 뽑혔다 — 읽는 방식이 깨졌다"

    def test_단정_찾기가_실제로_잡는다(self, 설명들):
        assert _단정.search("10배 아래면 싼 편, 30배 위면 비싼 편.")
        assert _단정.search("100% 아래면 안정적, 200% 위면 빚이 많은 편.")
        assert not _단정.search("같은 업종 종목들과 견줘야 한다.")
