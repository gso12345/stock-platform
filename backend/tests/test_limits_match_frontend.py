"""
화면과 서버의 입력 길이 제한이 같은 값인지.

화면은 본문을 5000자까지 받아들이는데 서버는 2000자에서 거부했다. 2500자를 쓰고
등록을 누르면 "게시글 작성에 실패했습니다"만 뜨고, 쓴 내용이 왜 막혔는지 알 수
없었다. 두 숫자가 각자 파일에 흩어져 있어서 생긴 일이라, 어긋나면 여기서 걸린다.

프런트엔드 소스를 읽는 유일한 테스트다. 언어가 달라 타입으로는 묶을 수 없고,
어긋나도 오류가 나지 않아 사람이 알아채기 어려운 종류이기 때문이다.
"""
import re
from pathlib import Path

import pytest

from app.api.routes import community as C

_TS = Path(__file__).resolve().parents[2] / "frontend" / "src" / "constants" / "community.ts"


def _frontend_limits() -> dict:
    if not _TS.exists():
        pytest.skip(f"프런트엔드 상수 파일이 없다: {_TS}")
    src = _TS.read_text(encoding="utf-8")
    return {m.group(1): int(m.group(2))
            for m in re.finditer(r"export const (\w+)\s*=\s*(\d+);", src)}


@pytest.fixture(scope="module")
def 화면():
    return _frontend_limits()


@pytest.mark.parametrize("이름, 서버값", [
    ("BODY_MAX",            lambda: C._BODY_MAX),
    ("TITLE_MAX",           lambda: C._TITLE_MAX),
    ("COMMENT_MAX",         lambda: C._COMMENT_MAX),
])
def test_길이_제한이_서버와_같다(화면, 이름, 서버값):
    assert 이름 in 화면, f"{이름}이 프런트엔드 상수에서 사라졌다"
    assert 화면[이름] == 서버값(), (
        f"{이름}: 화면 {화면[이름]}자 / 서버 {서버값()}자 — "
        "화면에서 통과한 글이 서버에서 거부된다"
    )


def test_투표_보기_개수가_서버와_같다(화면):
    from app.api.routes.community import PollIn
    한도 = PollIn.model_fields["options"].metadata
    최소 = next(getattr(m, "min_length") for m in 한도 if hasattr(m, "min_length"))
    최대 = next(getattr(m, "max_length") for m in 한도 if hasattr(m, "max_length"))
    assert 화면["POLL_OPTION_MIN_COUNT"] == 최소
    assert 화면["POLL_OPTION_MAX_COUNT"] == 최대


def test_알림_종류가_화면과_같다():
    """서버에만 종류를 추가하면 설정에서 끌 수 없는 알림이 생기고,
    화면에만 추가하면 켜도 오지 않는 스위치가 생긴다. 둘 다 오류가 나지 않는다."""
    ts = (Path(__file__).resolve().parents[2] / "frontend" / "src" / "constants" / "notifications.ts")
    if not ts.exists():
        pytest.skip("프런트엔드 notifications.ts가 없다")
    src = ts.read_text(encoding="utf-8")
    m = re.search(r"NOTIFICATION_KINDS:\s*NotificationKind\[\]\s*=\s*\[(.*?)\]", src, re.S)
    assert m, "NOTIFICATION_KINDS를 찾지 못했다"
    화면 = [x.strip().strip('"') for x in m.group(1).split(",") if x.strip()]
    assert 화면 == list(C._NOTI_KINDS), f"화면 {화면} / 서버 {list(C._NOTI_KINDS)}"

    # 각 종류의 문구도 빠짐없이 있어야 한다 — 없으면 알림이 엉뚱한 문구로 표시된다
    for kind in C._NOTI_KINDS:
        assert re.search(rf"\b{kind}:\s*\{{", src), f"{kind}의 문구가 화면에 없다"


def test_첨부_이미지_상한이_화면과_같다():
    ts = (Path(__file__).resolve().parents[2] / "frontend" / "src" / "utils" / "image.ts")
    if not ts.exists():
        pytest.skip("프런트엔드 image.ts가 없다")
    m = re.search(r"IMAGE_MAX_CHARS\s*=\s*([\d_]+)", ts.read_text(encoding="utf-8"))
    assert m, "IMAGE_MAX_CHARS를 찾지 못했다"
    assert int(m.group(1).replace("_", "")) == C._IMAGE_MAX_CHARS, (
        "화면이 서버보다 큰 사진을 만들어 보내면, 글을 다 쓰고 등록할 때 실패한다"
    )
