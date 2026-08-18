"""
서버를 깨워 두는 워크플로.

"처음 볼 때 너무 느려" 의 실체는 Render 무료 플랜의 슬립이다. 15분 동안
아무도 안 들어오면 서버를 내리고, 다음 사람이 20~45초를 기다린다. 그 시간은
코드로 줄일 수 없다 — 잠들지 않게 하는 것만이 답이고, 그 일을 이 워크플로가
한다.

그런데 그 워크플로가 스스로를 막고 있었다. 한 실행이 340분을 도는데 동시성
그룹이 cancel-in-progress: false 라, 5분마다 오는 다음 트리거는 전부 '대기'에
걸렸다가 취소됐다. 그러다 2026-08-17 01:36 을 마지막으로 예약 트리거가 아예
멈췄다. 36시간 넘게 한 번도 안 돌았고 서버는 계속 자고 있었다.

눈에 안 보이는 고장이었다. 실패 알림도 없었다 — 핑이 실패해도 `|| echo` 로
넘겨서 서버가 죽어 있어도 초록불이었기 때문이다.

그래서 여기서 못 박는다. 다시 이 모양으로 돌아가면 걸린다.
"""
import re
import pathlib
import shutil
import subprocess

import pytest

yaml = pytest.importorskip("yaml")

_경로 = pathlib.Path(__file__).resolve().parents[2] / ".github" / "workflows" / "keep-alive.yml"
_문서 = yaml.safe_load(_경로.read_text(encoding="utf-8"))
# YAML 에서 on: 은 불리언 True 로 읽힌다
_트리거 = _문서.get("on") or _문서.get(True)
_잡 = _문서["jobs"]["ping"]
_스크립트 = _잡["steps"][0]["run"]

#: Render 무료 플랜이 서버를 내리는 기준
슬립_기준_분 = 15

#: 앱 안쪽 스케줄러가 갱신을 멈추는 기준 (scheduler.IDLE_PAUSE_SEC)
쉬는_기준_분 = 10

#: ActivityMiddleware 가 '사람의 사용'에서 일부러 빼는 경로
활동으로_안_치는_경로 = ("/health", "/")


def _주석없는_스크립트() -> str:
    """왜 그만뒀는지를 주석에 적어 두기 때문에, 주석을 현재 코드로 착각하면
    멀쩡한 구현이 걸린다(앞선 점검에서 여러 번 겪었다)."""
    return re.sub(r"^\s*#.*$", "", _스크립트, flags=re.M)


class Test동시성:
    def test_겹치면_새_실행을_살린다(self):
        """이전 설계가 죽은 자리다.

        false 면 뒤따라온 트리거가 대기 줄에 쌓였다가 취소된다. 그 상태가
        이어지면서 예약 트리거 자체가 멈췄다."""
        assert _문서["concurrency"]["cancel-in-progress"] is True, \
            "대기 줄이 쌓인다 — 이 값 때문에 36시간 공백이 났었다"

    def test_같은_그룹으로_묶여_있다(self):
        # 그룹이 없으면 트리거마다 러너가 하나씩 뜬다
        assert _문서["concurrency"]["group"]


class Test간격:
    def _cron_분(self) -> int:
        표현 = _트리거["schedule"][0]["cron"].split()[0]
        m = re.fullmatch(r"\*/(\d+)", 표현)
        assert m, f"분 단위 반복이 아니다: {표현}"
        return int(m.group(1))

    def test_예약_간격이_슬립_기준보다_짧다(self):
        assert self._cron_분() <= 슬립_기준_분, "트리거 사이에 서버가 잠든다"

    def test_핑_간격이_슬립_기준보다_짧다(self):
        m = re.search(r"sleep (\d+)", _주석없는_스크립트())
        assert m, "루프 안에 대기가 없다"
        assert int(m.group(1)) <= 슬립_기준_분 * 60, "핑 사이에 서버가 잠든다"

    def test_핑_간격이_스케줄러가_쉬는_기준보다_짧다(self):
        """서버가 깨어 있는 것만으로는 모자란다.

        요청이 10분간 없으면 앱 안쪽 스케줄러가 지수·환율·순위·뉴스 갱신을
        통째로 멈춘다. 그러면 처음 들어온 사람이 빈 캐시를 채우는 값을
        치른다 — 고치려던 것을 오히려 만든다."""
        m = re.search(r"sleep (\d+)", _주석없는_스크립트())
        assert int(m.group(1)) < 쉬는_기준_분 * 60, "그 사이 스케줄러가 갱신을 멈춘다"

    def test_트리거가_건너뛰어도_혼자_버틴다(self):
        """GitHub 의 예약 트리거는 약속이 아니다. 몇 번 걸러도 그동안
        루프가 자리를 지켜야 한다."""
        m = re.search(r"SECONDS \+ (\d+) \* 60", _주석없는_스크립트())
        assert m, "루프 길이를 못 찾음"
        assert int(m.group(1)) >= self._cron_분() * 3, \
            "트리거 한두 번 걸러지면 바로 구멍이 난다"

    def test_루프가_제한시간에_잘리지_않는다(self):
        m = re.search(r"SECONDS \+ (\d+) \* 60", _주석없는_스크립트())
        assert int(m.group(1)) < _잡["timeout-minutes"], \
            "루프가 끝나기 전에 잡이 강제 종료된다"

    def test_수동으로도_돌릴_수_있다(self):
        # 지금처럼 자고 있을 때 바로 깨울 방법이 있어야 한다
        assert "workflow_dispatch" in _트리거


class Test고장이_보이는가:
    def test_한_번도_못_닿으면_실패로_끝낸다(self):
        """예전에는 서버가 죽어 있어도 초록불이었다. 그래서 36시간이
        지나도록 아무도 몰랐다."""
        본문 = _주석없는_스크립트()
        assert "exit 1" in 본문, "실패로 끝내는 자리가 없다"
        # 성공 횟수를 세지 않으면 무엇을 보고 실패시킬지가 없다
        assert re.search(r"ok=\$\(\(ok \+ 1\)\)", 본문), "성공을 안 센다"
        assert re.search(r'if \[ "\$ok" -eq 0 \]', 본문), "성공 횟수로 판정하지 않는다"

    def test_핑이_상태코드까지_본다(self):
        """-f 가 없으면 500 이 와도 성공으로 친다 — 서버가 올라만 오고
        망가진 상태를 못 걸러낸다."""
        본문 = _주석없는_스크립트()
        루프안 = 본문.split("while", 1)[1]
        assert re.search(r"curl -sSf\b", 루프안), "실패를 못 알아채는 핑이다"


class Test스크립트가_실제로_도는가:
    def test_bash_문법이_맞다(self):
        """한 번은 변수 이름을 한글로 썼다. bash 는 ASCII 식별자만 받는다 —
        `성공=0` 은 'command not found' 로 조용히 넘어간다."""
        bash = shutil.which("bash")
        if not bash:
            pytest.skip("bash 없음")
        r = subprocess.run([bash, "-n"], input=_스크립트, text=True,
                           capture_output=True)
        assert r.returncode == 0, r.stderr

    def test_변수_이름에_한글이_없다(self):
        남은것 = re.findall(r"^\s*([^\x00-\x7F][^\s=]*)=", _주석없는_스크립트(), flags=re.M)
        assert not 남은것, f"bash 가 못 읽는 변수 이름: {남은것}"


class Test스케줄러를_깨워_두는가:
    """가장 빠지기 쉬운 함정이다.

    /health 만 두드리면 서버는 깨어 있는데 앱 안쪽 스케줄러는 '아무도 안
    쓴다'고 판단해 갱신을 멈춘다. 밖에서 보면 서버가 살아 있으니 아무
    문제가 없어 보이는데, 정작 처음 들어온 사람은 빈 캐시를 만난다."""

    def _루프_경로(self) -> list[str]:
        루프안 = _주석없는_스크립트().split("while", 1)[1]
        # 변수로 뺀 경로도 따라간다
        경로 = re.findall(r'"\$BASE(/[^"$]*)"', 루프안)
        for 변수 in re.findall(r'"\$BASE\$([A-Za-z_][A-Za-z0-9_]*)"', 루프안):
            m = re.search(rf"^\s*{변수}=(\S+)", _주석없는_스크립트(), flags=re.M)
            if m:
                경로.append(m.group(1))
        return 경로

    def test_루프가_두드리는_경로가_있다(self):
        assert self._루프_경로(), "루프에서 무엇을 부르는지 못 찾음"

    def test_활동으로_집계되는_경로를_두드린다(self):
        경로 = self._루프_경로()
        살아있는것 = [p for p in 경로 if p not in 활동으로_안_치는_경로]
        assert 살아있는것, (
            f"{경로} 는 ActivityMiddleware 가 활동에서 빼는 경로다 — "
            "서버는 깨어 있어도 캐시 갱신이 멈춘다"
        )

    def test_앱이_실제로_그_경로를_열어_두고_있다(self):
        """경로를 잘못 적으면 404 가 오는데, 404 도 활동으로는 집계되므로
        겉보기 증상이 없다. 라우트가 실재하는지 소스에서 확인한다."""
        대시보드 = (pathlib.Path(__file__).resolve().parents[1]
                    / "app" / "api" / "routes" / "dashboard.py").read_text(encoding="utf-8")
        for p in self._루프_경로():
            if p in 활동으로_안_치는_경로:
                continue
            꼬리 = p.replace("/api/v1/dashboard", "")
            assert f'@router.get("{꼬리}")' in 대시보드, f"그런 라우트가 없다: {p}"


class Test무엇을_두드리는가:
    def test_깨우는_요청은_넉넉히_기다린다(self):
        """자고 있던 서버의 첫 응답은 20~45초 걸린다. 짧게 끊으면
        깨우다 만 셈이 된다."""
        m = re.search(r"--max-time (\d+) -o /dev/null[^\n]*/health", _주석없는_스크립트())
        assert m, "깨우기 요청을 못 찾음"
        assert int(m.group(1)) >= 60, f"너무 짧다: {m.group(1)}초"

    def test_캐시를_데우되_매분_하지는_않는다(self):
        """캐시는 프로세스 안에 있어 깰 때마다 비지만, 0.15 CPU 에
        무거운 요청을 매분 던지면 그게 더 느리다."""
        본문 = _주석없는_스크립트()
        루프앞 = 본문.split("while", 1)[0]
        assert "/api/v1/dashboard/kr" in 루프앞, "캐시를 안 데운다"
        루프안 = 본문.split("while", 1)[1]
        assert "/api/v1/dashboard" not in 루프안, "매분 무거운 요청을 던진다"
