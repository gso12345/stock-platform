"""
메모리가 한도에 붙어 있던 것 — 485/512MB (95%).

프로덕션 화면을 보고 알아낸 것 세 가지 —

  1) 485MB 중 245.6MB 는 이미 해제한 메모리였다. 실제로 쓰는 건 158.7MB.
     glibc 가 돌려주지 않고 들고 있었을 뿐이다.
  2) 정리(malloc_trim)는 잘 듣는다. 마지막 기록이 74.7MB 를 돌려받은 것이었다
     (505 → 430MB). 그런데 5분에 한 번뿐이라 그 사이에 95% 까지 올라갔다.
  3) 추이 그래프가 전부 '정리 전' 값이었다. 표본을 먼저 담고 그다음에
     정리하고 있어서, 실제 바닥이 430MB 인데 화면에는 461MB 로 나왔다.

여기서 못 박는 것은 그 셋이다.
"""
import os

import pytest

from app.core import memory


@pytest.fixture
def 정리흔적(monkeypatch):
    """malloc_trim 을 부르는 대신 호출을 기록한다.

    실제 trim 을 부르면 이 테스트 프로세스의 RSS 에 따라 결과가 달라져
    검사가 흔들린다. 우리가 확인할 것은 '언제 부르는가' 다."""
    기록 = []

    def _가짜(label="주기 정리"):
        기록.append(label)
        return {"before_mb": 500.0, "after_mb": 430.0, "freed_mb": 70.0}

    monkeypatch.setattr(memory, "trim_native", _가짜)
    return 기록


class Test표본을_정리_뒤에_잰다:
    def test_정리하고_나서_기록한다(self, monkeypatch):
        """순서가 반대면 그래프가 계속 정리 전 값을 그린다 — 실제보다
        30MB 나쁘게 보였다."""
        순서 = []

        def _가짜정리(label="주기 정리"):
            순서.append("정리")
            return {"before_mb": 500.0, "after_mb": 430.0, "freed_mb": 70.0}

        def _가짜RSS():
            순서.append("기록")
            return 430.0

        monkeypatch.setattr(memory, "trim_native", _가짜정리)
        monkeypatch.setattr(memory, "rss_mb", _가짜RSS)
        monkeypatch.setattr(memory, "_samples", [])
        memory.record_sample()

        assert 순서[:2] == ["정리", "기록"], f"순서가 {순서} 다 — 정리가 먼저여야 한다"

    def test_그래프에_정리_뒤_값이_들어간다(self, monkeypatch, 정리흔적):
        """정리 전 500 이 아니라 정리 후 430 이 담겨야 한다."""
        monkeypatch.setattr(memory, "rss_mb", lambda: 430.0)
        monkeypatch.setattr(memory, "_samples", [])
        memory.record_sample()
        assert [m for _, m in memory._samples] == [430.0]


class Test한도에_다가가면_바로_정리한다:
    def test_여유가_있으면_아무_일도_안_한다(self, monkeypatch, 정리흔적):
        """평소에 몇 초마다 부르면 CPU 0.15개에서 그것대로 부담이다."""
        monkeypatch.setattr(memory, "usage_ratio", lambda: 0.50)
        monkeypatch.setattr(memory, "_last_trim_at", 0.0)
        assert memory.trim_if_tight() is None
        assert 정리흔적 == []

    def test_한도에_붙으면_정리한다(self, monkeypatch, 정리흔적):
        monkeypatch.setattr(memory, "usage_ratio", lambda: 0.95)
        monkeypatch.setattr(memory, "_last_trim_at", 0.0)
        assert memory.trim_if_tight() is not None
        assert len(정리흔적) == 1

    def test_연달아_불러도_한_번만_한다(self, monkeypatch, 정리흔적):
        """요청이 몰리면 이 함수도 같이 몰린다. 매번 정리하면 그게 부담이다."""
        monkeypatch.setattr(memory, "usage_ratio", lambda: 0.95)
        monkeypatch.setattr(memory, "_last_trim_at", 0.0)
        for _ in range(5):
            memory.trim_if_tight()
        assert len(정리흔적) == 1, f"{len(정리흔적)}번 정리했다"

    def test_정리하면_화면에_남는다(self, monkeypatch, 정리흔적):
        """즉시 정리한 결과가 안 남으면, 화면의 '마지막 정리'가 5분 전
        기록에 머물러 방금 무슨 일이 있었는지 알 수 없다."""
        monkeypatch.setattr(memory, "usage_ratio", lambda: 0.95)
        monkeypatch.setattr(memory, "_last_trim_at", 0.0)
        monkeypatch.setattr(memory, "_last_trim", None)
        memory.trim_if_tight()
        assert memory.last_trim() is not None

    def test_기준을_환경변수로_바꿀_수_있다(self):
        assert 0.5 < memory.TRIM_THRESHOLD < 1.0


class Test무거운_작업_전에_한_번_턴다:
    def test_턴_뒤_여유가_생기면_건너뛰지_않는다(self, monkeypatch):
        """붙들고만 있던 몫이 크면 정리만으로 여유가 생긴다. 그때까지
        갱신을 거르면, 고칠 수 있는 상황인데 기능을 껐던 셈이다."""
        상태 = {"비율": 0.90}
        monkeypatch.setattr(memory, "usage_ratio", lambda: 상태["비율"])

        def _가짜정리(label="주기 정리"):
            상태["비율"] = 0.55        # 정리로 여유가 생겼다
            return {"before_mb": 460.0, "after_mb": 285.0, "freed_mb": 175.0}

        monkeypatch.setattr(memory, "trim_native", _가짜정리)
        monkeypatch.setattr(memory, "_last_trim_at", 0.0)
        assert memory.has_headroom("테스트") is True

    def test_털어도_모자라면_건너뛴다(self, monkeypatch):
        monkeypatch.setattr(memory, "usage_ratio", lambda: 0.95)
        monkeypatch.setattr(memory, "trim_native",
                            lambda label="주기 정리": {"before_mb": 490.0, "after_mb": 488.0, "freed_mb": 2.0})
        monkeypatch.setattr(memory, "_last_trim_at", 0.0)
        assert memory.has_headroom("테스트") is False

    def test_잴_수_없으면_막지_않는다(self, monkeypatch):
        """로컬처럼 못 재는 환경에서 기능을 끄면 개발이 불편해진다."""
        monkeypatch.setattr(memory, "usage_ratio", lambda: None)
        assert memory.has_headroom("테스트") is True


class Test힙_나눔_상한:
    def test_설정값을_화면에_내보낸다(self, monkeypatch):
        """배포한 뒤 '설정이 걸리긴 한 건가'를 확인할 방법이 있어야,
        효과가 있었는지 없었는지도 판단할 수 있다."""
        monkeypatch.setenv("MALLOC_ARENA_MAX", "2")
        n = memory.native_breakdown()
        if n is None:
            pytest.skip("이 환경에서는 mallinfo2 를 못 읽는다")
        assert n["arena_max"] == "2"

    def test_설정이_없으면_없다고_알려준다(self, monkeypatch):
        monkeypatch.delenv("MALLOC_ARENA_MAX", raising=False)
        n = memory.native_breakdown()
        if n is None:
            pytest.skip("이 환경에서는 mallinfo2 를 못 읽는다")
        assert n["arena_max"] is None

    def test_배포_설정에_들어_있다(self):
        """render.yaml 에서 빠지면 프로덕션에는 안 걸린다."""
        from pathlib import Path
        y = Path(__file__).resolve().parents[2] / "render.yaml"
        if not y.exists():
            pytest.skip("render.yaml 이 없다")
        본문 = y.read_text(encoding="utf-8")
        assert "MALLOC_ARENA_MAX" in 본문, "배포 설정에 힙 나눔 상한이 없다"
