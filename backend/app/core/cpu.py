"""
실제로 쓸 수 있는 CPU 양을 확인하고, 스레드 수를 거기에 맞춘다.

컨테이너에서 os.cpu_count()는 호스트의 코어 수를 돌려준다. Render 무료 플랜은
CPU 할당량이 0.1개(10%)인데 cpu_count()는 8이나 16을 보고하므로, 그 값을 믿고
스레드풀을 잡으면 실제 할당량의 수십 배가 만들어진다.

스레드가 많다고 CPU 총량이 늘지 않는다. 오히려 서로 나눠 쓰면서 각자 느려지고,
타임아웃이 걸린 작업은 결과를 통째로 버리게 된다 — 실제로 뉴스 피드 63개를
스레드 64개로 동시에 긁다가 대부분 5초 타임아웃에 걸려, 화면에 한두 언론사만
뜨는 문제가 있었다.
"""
from __future__ import annotations

import logging
import os

log = logging.getLogger(__name__)


def cpu_quota() -> float:
    """이 프로세스가 실제로 쓸 수 있는 CPU 개수. 알 수 없으면 cpu_count()."""
    # cgroup v2
    try:
        with open("/sys/fs/cgroup/cpu.max", encoding="utf-8") as f:
            quota, period = f.read().split()
            if quota != "max":
                return int(quota) / int(period)
    except Exception:
        pass
    # cgroup v1
    try:
        with open("/sys/fs/cgroup/cpu/cpu.cfs_quota_us", encoding="utf-8") as f:
            q = int(f.read().strip())
        with open("/sys/fs/cgroup/cpu/cpu.cfs_period_us", encoding="utf-8") as f:
            p = int(f.read().strip())
        if q > 0 and p > 0:
            return q / p
    except Exception:
        pass
    return float(os.cpu_count() or 1)


def cpu_worker_count(default: int, minimum: int = 2) -> int:
    """CPU를 실제로 쓰는 작업(파싱·계산)의 스레드 수.

    RSS/XML 파싱처럼 CPU를 태우는 일은 스레드를 늘려도 총 시간이 줄지 않는다.
    오히려 서로 나눠 쓰며 각자 느려지고, 타임아웃에 걸린 작업은 결과를 통째로
    버린다 — 실제로 뉴스 피드 63개를 64개 스레드로 긁다가 대부분 버려져
    화면에 한두 언론사만 뜬 적이 있다."""
    return max(minimum, min(default, round(cpu_quota() * 6)))


def io_worker_count(default: int, minimum: int = 8) -> int:
    """네트워크 응답을 기다리는 작업의 스레드 수.

    이 스레드들은 대부분 CPU를 쓰지 않고 소켓을 기다린다. CPU 할당량에 맞춰
    줄이면 동시에 기다릴 수 있는 요청 수만 줄어들어, 서로 관계없는 작업이
    줄줄이 밀린다. 실제로 이걸 2개로 줄였더니 5분마다 도는 뉴스 수집 두 개가
    공용 스레드를 전부 차지해, 그 동안 대시보드·종목상세 요청이 통째로
    대기하는 문제가 생겼다.

    상한을 두는 이유는 CPU 때문이 아니라 메모리(스레드당 스택)와
    외부 API에 한꺼번에 몰리는 것을 막기 위해서다."""
    return max(minimum, min(default, round(cpu_quota() * 24) or minimum))


# 이전 이름 — CPU 기준으로 쓰던 곳들이 있어 남겨 둔다
worker_count = cpu_worker_count


def configure_thread_limits() -> None:
    """asyncio 기본 스레드풀과 수치 연산 라이브러리의 스레드 수를 CPU에 맞춘다.

    asyncio 의 기본값은 min(32, cpu_count()+4) 라 컨테이너에서 과하게 잡힌다.
    run_in_executor 로 도는 작업(뉴스 파싱, yfinance 등)이 전부 여기 얹힌다."""
    import asyncio
    from concurrent.futures import ThreadPoolExecutor

    q = cpu_quota()
    # 공용 스레드풀에는 요청 처리 중의 블로킹 작업이 전부 얹힌다
    # (dashboard 14곳, stocks 19곳 등). 여기가 좁으면 서로 관계없는 요청까지
    # 줄줄이 밀리므로, CPU가 아니라 '동시에 기다릴 수 있는 수'로 잡는다.
    n = io_worker_count(default=24)
    try:
        asyncio.get_running_loop().set_default_executor(
            ThreadPoolExecutor(max_workers=n, thread_name_prefix="app")
        )
    except RuntimeError:
        pass

    # numpy/pandas 가 내부적으로 여는 스레드도 함께 줄인다.
    # 0.1 CPU 에서 BLAS 가 코어 수만큼 스레드를 열면 그 자체로 경합이 된다.
    for var in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS",
                "NUMEXPR_NUM_THREADS", "VECLIB_MAXIMUM_THREADS"):
        os.environ.setdefault(var, "1")

    log.info(f"CPU 할당량 {q:.2f}개 — 공용 스레드 {n}개, 파싱 스레드 {cpu_worker_count(6)}개 "
             f"(os.cpu_count()={os.cpu_count()})")
