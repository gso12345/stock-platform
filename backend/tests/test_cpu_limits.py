"""
CPU 할당량에 맞춘 스레드 수 — 응답이 느려지던 진짜 이유.

Render 무료 플랜은 CPU가 0.1개(10%)인데, 컨테이너 안에서 os.cpu_count()는
호스트의 코어 수를 돌려준다. 그 값을 믿고 스레드풀을 잡으면 실제 할당량의
수십 배가 만들어진다.

스레드가 많다고 CPU 총량이 늘지 않는다. 오히려 서로 나눠 쓰며 각자 느려지고,
타임아웃에 걸린 작업은 결과를 통째로 버린다. 실제로 뉴스 피드 63개를 스레드
64개로 동시에 긁다가 대부분 5초 타임아웃에 걸려, 화면에 한두 언론사만 떴다.
"""
import inspect
import os

import pytest

from app.core import cpu
from app.services import news_service as news


class Test할당량_감지:
    def test_숫자를_돌려준다(self):
        q = cpu.cpu_quota()
        assert isinstance(q, float) and q > 0

    def test_읽을_수_없으면_cpu_count로_떨어진다(self, monkeypatch):
        monkeypatch.setattr("builtins.open", lambda *a, **k: (_ for _ in ()).throw(OSError()))
        assert cpu.cpu_quota() == float(os.cpu_count() or 1)


class Test스레드_수:
    @pytest.mark.parametrize("할당량, 최대", [(0.1, 2), (0.25, 2), (0.5, 4), (1.0, 8)])
    def test_할당량이_작으면_스레드도_적다(self, monkeypatch, 할당량, 최대):
        monkeypatch.setattr(cpu, "cpu_quota", lambda: 할당량)
        assert cpu.worker_count(default=20) <= 최대, \
            f"CPU {할당량}개에 스레드 {cpu.worker_count(default=20)}개는 과하다"

    def test_기본값을_넘지_않는다(self, monkeypatch):
        # CPU가 아무리 많아도 원래 의도한 상한은 지킨다
        monkeypatch.setattr(cpu, "cpu_quota", lambda: 64.0)
        assert cpu.worker_count(default=6) == 6

    def test_최소한은_보장한다(self, monkeypatch):
        # 0개가 되면 아무 작업도 못 한다
        monkeypatch.setattr(cpu, "cpu_quota", lambda: 0.01)
        assert cpu.worker_count(default=20) >= 2

    def test_수치_라이브러리_스레드도_제한한다(self):
        # 0.1 CPU 에서 BLAS 가 코어 수만큼 스레드를 열면 그 자체로 경합이다
        src = inspect.getsource(cpu.configure_thread_limits)
        for var in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
            assert var in src

    def test_asyncio_기본_스레드풀을_바꾼다(self):
        # run_in_executor 로 도는 작업이 전부 여기 얹힌다.
        # 기본값 min(32, cpu_count()+4) 는 컨테이너에서 과하게 잡힌다
        assert "set_default_executor" in inspect.getsource(cpu.configure_thread_limits)

    def test_시작할_때_적용한다(self):
        from app.main import lifespan
        assert "configure_thread_limits" in inspect.getsource(lifespan)


class Test뉴스_수집:
    def test_스레드가_CPU에_맞춰_잡힌다(self):
        # 예전에는 64개 고정이었다
        assert news._FEED_WORKERS <= 8, f"뉴스 피드 스레드 {news._FEED_WORKERS}개는 과하다"

    def test_한_번에_전부_긁지_않는다(self):
        # 국내 49개를 매번 전부 긁으면 CPU만 8초를 쓴다
        assert news._FEED_BATCH < len(news.KR_FEEDS)

    def test_언론사를_돌아가며_가져온다(self):
        # 무작위로 섞으면 운 나쁜 언론사는 몇 회차 연속 빠질 수 있다
        모인곳 = []
        회차 = -(-len(news.KR_FEEDS) // news._FEED_BATCH)
        for _ in range(회차):
            모인곳 += [s for s, _ in news._next_batch(news.KR_FEEDS, news._FEED_BATCH)]
        assert set(모인곳) == {s for s, _ in news.KR_FEEDS}, \
            f"{회차}회차를 돌아도 {len(news.KR_FEEDS) - len(set(모인곳))}개 언론사가 빠진다"

    def test_한_회차에_같은_언론사를_두_번_넣지_않는다(self):
        batch = news._next_batch(news.KR_FEEDS, news._FEED_BATCH)
        assert len(batch) == len({s for s, _ in batch})

    def test_피드보다_배치가_크면_전부_가져온다(self):
        assert len(news._next_batch(news.US_FEEDS, 999)) == len(news.US_FEEDS)

    def test_실패한_언론사_기사는_이전_것을_남긴다(self):
        # 회차마다 일부만 가져오므로, 병합이 없으면 목록이 계속 비어 보인다
        src = inspect.getsource(news._do_refresh_news)
        assert "stale" in src and "all_news.append(a)" in src

    def test_캐시가_비면_한_번은_넓게_가져온다(self):
        # 배포 직후 캐시가 비면 한두 언론사만 뜨는 문제가 있었다
        src = inspect.getsource(news._do_refresh_news)
        assert "cold" in src and "_FEED_BATCH * 3" in src
