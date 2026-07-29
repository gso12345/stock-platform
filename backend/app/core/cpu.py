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


def worker_count(default: int, minimum: int = 2, per_cpu: int = 8) -> int:
    """CPU 할당량에 맞춘 스레드 수.

    per_cpu 를 8로 잡은 이유: 이 앱의 스레드는 대부분 HTTP 응답을 기다리는
    시간이 길어 CPU 1개당 여러 개를 돌려도 손해가 아니다. 다만 0.1 CPU 에서
    수십 개를 띄우면 전부 타임아웃에 걸리므로 상한이 필요하다."""
    q = cpu_quota()
    return max(minimum, min(default, round(q * per_cpu)))


def configure_thread_limits() -> None:
    """asyncio 기본 스레드풀과 수치 연산 라이브러리의 스레드 수를 CPU에 맞춘다.

    asyncio 의 기본값은 min(32, cpu_count()+4) 라 컨테이너에서 과하게 잡힌다.
    run_in_executor 로 도는 작업(뉴스 파싱, yfinance 등)이 전부 여기 얹힌다."""
    import asyncio
    from concurrent.futures import ThreadPoolExecutor

    q = cpu_quota()
    n = worker_count(default=8, minimum=2)
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

    log.info(f"CPU 할당량 {q:.2f}개 — 작업 스레드 {n}개로 제한 "
             f"(os.cpu_count()={os.cpu_count()})")
