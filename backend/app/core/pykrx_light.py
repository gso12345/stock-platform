"""pykrx 를 matplotlib 없이 불러온다.

pykrx/__init__.py 는 한글 폰트를 지정하려고 이 두 줄을 실행한다.

    import matplotlib.pyplot as plt
    import matplotlib.font_manager as fm

그 두 줄 때문에 matplotlib 과 거기 딸린 PIL·pyparsing·fontTools·plistlib
까지 전부 메모리에 올라온다. 프로덕션 관리자 화면에서 matplotlib 하나가
94MB로 찍혔고, 딸린 것까지 합쳐 약 120MB였다. 로컬에서 재보면 pykrx import
비용이 30.9MB → 3.7MB 로 줄어든다.

우리는 pykrx 로 그래프를 그리지 않는다. 쓰는 것은 `stock`·`bond` 의 데이터
조회 함수뿐이고 그 두 모듈은 matplotlib 을 건드리지 않는다 — 그래서 import
전에 필요한 최소한만 흉내낸 가짜를 sys.modules 에 꽂아 둔다. pykrx 의 폰트
설정은 그 가짜 위에서 아무 일 없이 끝난다.

진짜 matplotlib 이 이미 올라와 있으면 아무것도 하지 않는다. 누군가 실제로
쓰고 있다는 뜻이고, 그걸 가짜로 덮으면 그쪽이 깨진다.
"""
from __future__ import annotations

import logging
import sys
import types

log = logging.getLogger(__name__)

_stub_installed = False


class _FontEntry:
    """matplotlib.font_manager.FontEntry 자리 — pykrx 는 이름만 다시 읽는다"""

    def __init__(self, fname=None, name=None, **kw):
        self.fname = fname
        self.name = name


class _FontManager:
    def __init__(self):
        self.ttflist: list = []


def _install_stub() -> bool:
    """가짜 matplotlib 을 꽂는다. 이미 진짜가 있으면 False."""
    global _stub_installed
    if _stub_installed:
        return True
    if "matplotlib" in sys.modules:
        # 다른 무언가가 이미 진짜를 올렸다 — 손대지 않는다
        return False

    mpl = types.ModuleType("matplotlib")
    mpl.__path__ = []            # 패키지처럼 보여야 하위 import 가 통한다

    plt = types.ModuleType("matplotlib.pyplot")
    plt.rc = lambda *a, **k: None
    plt.rcParams = {}

    fm = types.ModuleType("matplotlib.font_manager")
    fm.FontEntry = _FontEntry
    fm.fontManager = _FontManager()

    mpl.pyplot = plt
    mpl.font_manager = fm
    sys.modules.update({
        "matplotlib": mpl,
        "matplotlib.pyplot": plt,
        "matplotlib.font_manager": fm,
    })
    _stub_installed = True
    log.info("pykrx 용 matplotlib 대체 모듈 설치 — 그래프 라이브러리 약 120MB 미적재")
    return True


def stock():
    """pykrx.stock (종목·시세·수급 조회)"""
    _install_stub()
    from pykrx import stock as _stock
    return _stock


def bond():
    """pykrx.bond (장외 채권수익률)"""
    _install_stub()
    from pykrx import bond as _bond
    return _bond


def stubbed() -> bool:
    return _stub_installed
