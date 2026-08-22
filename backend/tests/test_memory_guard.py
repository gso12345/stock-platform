"""서버가 3분마다 강제 재시작되던 것.

관리자 화면이 이렇게 찍혔다 — 메모리 96%(493.6 / 512MB), 가동 시간 3분,
'최근 재시작됨'. 느리게 새는 게 아니라 시작하자마자 한도에 닿는다.

두 가지가 겹쳤다.

  1) 시작 시 미국 순위표에 여유 검사가 없었다
     주기 갱신 쪽에는 처음부터 has_headroom 이 있었는데 시작 경로에만
     없었다. 라이브러리를 막 올려 메모리가 가장 높은 때에 야후에서
     1500종목을 훑었다. 바로 아래 주석이 같은 말을 하고 있었다 —
     '선제 캐싱은 이 서버에서 프로세스를 죽이는 가장 흔한 원인'.

  2) 힙 나눔 상한이 안 걸려 있었다
     render.yaml 에 MALLOC_ARENA_MAX=2 를 적어 뒀는데 화면에는
     '제한 없음' 이 떴다. render.yaml 은 Blueprint 로 만든 서비스에만
     적용된다. 493.6MB 중 197.4MB 가 '해제했는데 OS 에 안 돌려준' 몫이었다.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core import memory


# ── 힙 나눔 상한 ───────────────────────────────────────────
def test_환경변수가_있으면_그것을_쓴다(monkeypatch):
    monkeypatch.setenv("MALLOC_ARENA_MAX", "4")
    assert memory.힙나눔_제한() == "4 (환경변수)"


def test_환경변수가_없으면_코드에서_건다(monkeypatch):
    monkeypatch.delenv("MALLOC_ARENA_MAX", raising=False)
    결과 = memory.힙나눔_제한(2)
    # glibc 면 걸리고, musl 등이면 '못 함' 이라고 적힌다. 둘 중 하나여야지
    # 조용히 아무 말도 없으면 안 된다 — 화면에서 확인할 수 없게 된다.
    assert 결과, "무엇을 했는지 반드시 남겨야 한다"
    assert "2 (코드)" == 결과 or "못 함" in 결과 or "실패" in 결과


def test_먹지_않으면_걸었다고_적지_않는다(monkeypatch):
    """화면이 거짓말을 하면 '설정했는데 왜 안 줄지' 를 영영 못 찾는다."""
    monkeypatch.delenv("MALLOC_ARENA_MAX", raising=False)

    class 거부하는libc:
        def mallopt(self, *a):
            return 0

    import ctypes
    monkeypatch.setattr(ctypes, "CDLL", lambda 이름: 거부하는libc())
    결과 = memory.힙나눔_제한(2)
    assert "(코드)" not in 결과
    assert "거부" in 결과 or "실패" in 결과


def test_glibc_가_아니어도_안_터진다(monkeypatch):
    monkeypatch.delenv("MALLOC_ARENA_MAX", raising=False)
    import ctypes

    def 못_찾음(이름):
        raise OSError("libc.so.6 없음")

    monkeypatch.setattr(ctypes, "CDLL", 못_찾음)
    결과 = memory.힙나눔_제한(2)
    assert "OSError" in 결과


def test_화면에_실제_적용값이_나간다(monkeypatch):
    """예전에는 환경변수만 봤다. 코드에서 걸면 환경변수는 여전히 비어
    있으므로, 그것만 봐서는 걸렸는지 알 수 없다."""
    monkeypatch.delenv("MALLOC_ARENA_MAX", raising=False)
    memory.힙나눔_제한(2)
    b = memory.native_breakdown()
    if b is None:
        pytest.skip("이 환경에서는 mallinfo2 를 못 읽는다")
    assert b["arena_max"] is not None
    assert b["arena_max"] == memory._힙나눔_결과


def test_main_이_맨_앞에서_건다():
    """이미 만들어진 힙에는 소급되지 않는다. 스레드 풀·커넥션 풀을
    만드는 import 들보다 앞이어야 한다."""
    본문 = open(os.path.join(os.path.dirname(__file__), "..", "app", "main.py"),
                encoding="utf-8").read()
    줄들 = [l.strip() for l in 본문.split("\n")
            if l.strip() and not l.strip().startswith("#")]
    건자리 = next(i for i, l in enumerate(줄들) if "힙나눔_제한()" in l)
    무거운것 = next(i for i, l in enumerate(줄들) if "from fastapi" in l)
    assert 건자리 < 무거운것


# ── 시작 시 훑는 양 ────────────────────────────────────────
def test_시작할_때는_더_적게_훑는다():
    from app.services import ranking_service as rs
    assert rs.US_STARTUP_SWEEP < rs.US_SWEEP


def test_훑을_양을_인자로_받는다():
    """시작 경로와 주기 경로가 같은 양을 훑으면 나눈 의미가 없다."""
    import inspect
    from app.services import ranking_service as rs
    assert "sweep" in inspect.signature(rs.refresh_us_rows).parameters


def test_시작_프리페치가_여유를_먼저_본다():
    본문 = open(os.path.join(os.path.dirname(__file__), "..",
                             "app", "services", "scheduler.py"), encoding="utf-8").read()
    코드만 = "\n".join(l for l in 본문.split("\n") if not l.strip().startswith("#"))
    시작블록 = 코드만[코드만.index("async def run_startup_prefetch"):]
    시작블록 = 시작블록[:시작블록.index("HEAVY_PREFETCH")]
    assert "has_headroom" in 시작블록
    assert "US_STARTUP_SWEEP" in 시작블록


def test_묶음마다_여유를_본다():
    """한 번 시작하면 끝까지 가던 것 — 15묶음을 쉬지 않고 돌면 그 사이에
    한도를 넘는다."""
    본문 = open(os.path.join(os.path.dirname(__file__), "..",
                             "app", "services", "ranking_service.py"), encoding="utf-8").read()
    몸통 = 본문[본문.index("async def refresh_us_rows"):]
    몸통 = 몸통[:몸통.index("def ", 10)] if "def " in 몸통[10:] else 몸통
    루프 = 몸통[몸통.index("for i in range(0, len(훑을것), US_BATCH):"):]
    assert "has_headroom" in 루프
    assert "break" in 루프


def test_멈춘_자리를_커서에_남긴다():
    """멈춘 다음 회차가 처음부터 다시 훑으면 뒤쪽은 영영 안 받는다."""
    본문 = open(os.path.join(os.path.dirname(__file__), "..",
                             "app", "services", "ranking_service.py"), encoding="utf-8").read()
    루프 = 본문[본문.index("for i in range(0, len(훑을것), US_BATCH):"):]
    멈추는곳 = 루프[:루프.index("break") + 5]
    assert "_us_cursor" in 멈추는곳


# ── KOSDAQ150 ──────────────────────────────────────────────
def test_코스닥150은_아는_코드로_바로_받는다():
    """네이버는 다섯 후보를 다 걸어도 실패했다(HTTP 409). pykrx 는
    이름 대조를 하고 있었는데, 코드는 이미 저장소 안에 있었다."""
    from app.services import price_fetcher as pf
    assert pf.PYKRX_INDEX_TICKER["KOSDAQ150"] == "2203"
    assert pf.PYKRX_INDEX_TICKER["KOSPI"] == "1001"
    assert pf.PYKRX_INDEX_TICKER["KOSDAQ"] == "2001"


def test_코드가_안_통하면_이름으로_찾는다():
    """없던 실패가 생기면 안 된다 — 예전 길이 그대로 남아 있어야 한다."""
    본문 = open(os.path.join(os.path.dirname(__file__), "..",
                             "app", "services", "price_fetcher.py"), encoding="utf-8").read()
    몸통 = 본문[본문.index("def fetch_pykrx_index"):]
    몸통 = 몸통[:몸통.index("\ndef ", 10)]
    assert "PYKRX_INDEX_TICKER" in 몸통
    assert "get_index_ticker_name" in 몸통      # 이름으로 찾는 길이 남아 있다
    코드자리 = 몸통.index("PYKRX_INDEX_TICKER")
    이름자리 = 몸통.index("get_index_ticker_name")
    assert 코드자리 < 이름자리                  # 코드를 먼저 건다


def test_네이버_후보를_지우지_않았다():
    """지우면 네이버가 열어 줘도 영영 안 쓴다."""
    from app.services import price_fetcher as pf
    assert len(pf.NAVER_INDEX_CODES["KOSDAQ150"]) >= 5
