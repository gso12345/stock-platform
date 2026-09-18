"""배포가 **코드를 안 바꿔도** 깨지지 않게 한다.

── 실제로 났던 일 ──────────────────────────────────────────

'Deploy failed for stock-platform' 메일이 왔는데, 그 배포에 들어간
백엔드 변경은 컬럼 몇 개와 저장 항목뿐이었다. 빌드가 깨질 만한
것이 하나도 없었다.

원인은 requirements.txt 였다.

  · feedparser==6.0.11 은 **sgmllib3k** 를 끌고 온다. 그건 휠이 없어서
    배포할 때마다 소스로 빌드해야 하는데, 요즘 setuptools 에서는 그
    빌드가 깨진다(install_layout AttributeError). 빌드 이미지가 한 번
    올라가면 그날부터 배포가 통째로 실패한다 — 내 코드와 무관하게.

  · yfinance 와 anthropic 은 `>=` 로 열려 있었다. 그래서 배포할 때마다
    **검사한 것과 다른 버전**이 깔렸다. anthropic 은 0.40 으로 열어 둔
    사이에 1.6 까지 갔는데, 메이저가 두 번 바뀌는 동안 아무도 몰랐다.

둘 다 '어제는 됐는데 오늘은 안 되는' 모양이라, 원인을 찾는 데 드는
시간이 고치는 데 드는 시간보다 훨씬 길다. 파일만 보고 막을 수 있는
것이라 여기서 막는다.
"""
import re
from pathlib import Path

import pytest

받을것 = Path(__file__).resolve().parents[1] / "requirements.txt"


def 줄들() -> list[str]:
    """주석과 빈 줄을 뺀 실제 요구 사항"""
    return [l.strip() for l in 받을것.read_text(encoding="utf-8").splitlines()
            if l.strip() and not l.strip().startswith("#")]


def test_전부_정확한_버전으로_고정돼_있다():
    """`>=` 로 열어 두면 배포할 때마다 다른 것이 깔린다.

    검사를 아무리 돌려도 **실제로 배포되는 것과 다른 것**을 검사하는
    셈이라, 새 버전이 나온 날 코드를 하나도 안 바꿨는데 배포가 깨진다.
    올릴 때는 이 파일에서 올리고, 그때 검사를 다시 돌린다.
    """
    열린것 = [l for l in 줄들() if "==" not in l]
    assert not 열린것, \
        (f"이 줄들이 버전을 안 고정했다: {열린것}. 배포마다 다른 버전이 깔려서, "
         "검사가 통과해도 배포가 깨질 수 있다")


def test_feedparser_가_소스_빌드를_안_끌고_온다():
    """6.0.11 이하는 sgmllib3k(휠 없음)를 끌고 온다.

    6.0.12 부터 feedparser-sgmllib 로 갈아탔고, 그건 순수 휠이다.
    이 한 줄이 배포 경로에서 소스 빌드를 통째로 없앤다.
    """
    줄 = [l for l in 줄들() if l.lower().startswith("feedparser")]
    assert 줄, "feedparser 줄을 못 찾았다"
    m = re.match(r"feedparser==(\d+)\.(\d+)\.(\d+)", 줄[0], re.I)
    assert m, f"버전을 못 읽었다 — {줄[0]!r}"
    버전 = tuple(int(x) for x in m.groups())
    assert 버전 >= (6, 0, 12), \
        (f"feedparser {'.'.join(map(str, 버전))} 는 sgmllib3k 를 끌고 온다. "
         "그건 휠이 없어서 배포할 때마다 소스로 빌드해야 하고, 요즘 "
         "setuptools 에서는 그 빌드가 깨진다 — 코드를 안 바꿔도 배포가 실패한다")


def test_sgmllib3k_를_직접_적지도_않는다():
    """돌아가는 길로 다시 들어오는 것도 막는다"""
    본문 = 받을것.read_text(encoding="utf-8")
    적힌줄 = [l for l in 줄들() if "sgmllib3k" in l.lower()]
    assert not 적힌줄, f"sgmllib3k 가 다시 들어왔다: {적힌줄}"
    assert "sgmllib3k" in 본문, \
        ("왜 안 쓰는지 적어 둔 설명이 사라졌다. 다음 사람이 모르고 "
         "feedparser 를 되돌리면 같은 일이 또 난다")


@pytest.mark.parametrize("이름", ["yfinance", "anthropic", "pandas", "numpy"])
def test_바깥_자료를_다루는_것들은_특히_고정한다(이름):
    """이것들은 값의 모양이 바뀌면 화면의 수가 조용히 달라진다.
    터지면 차라리 낫고, 안 터지고 달라지는 것이 더 나쁘다."""
    줄 = [l for l in 줄들() if l.lower().startswith(이름)]
    assert 줄, f"{이름} 줄이 없다"
    assert "==" in 줄[0], f"{이름} 이 고정돼 있지 않다 — {줄[0]!r}"
