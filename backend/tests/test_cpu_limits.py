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
    """CPU를 태우는 작업과 네트워크를 기다리는 작업을 구분해야 한다.

    한때 둘을 같은 기준(CPU)으로 줄였다가, 0.1 CPU에서 공용 스레드풀이 2개가
    됐다. 5분마다 도는 뉴스 수집 두 개가 그 2개를 전부 차지하는 동안
    대시보드·종목상세 요청(run_in_executor 33곳)이 통째로 대기했다."""

    @pytest.mark.parametrize("할당량, 최대", [(0.1, 2), (0.25, 2), (0.5, 3), (1.0, 6)])
    def test_파싱_스레드는_CPU에_맞춘다(self, monkeypatch, 할당량, 최대):
        monkeypatch.setattr(cpu, "cpu_quota", lambda: 할당량)
        assert cpu.cpu_worker_count(default=20) <= 최대

    @pytest.mark.parametrize("할당량", [0.1, 0.25, 0.5])
    def test_대기_스레드는_CPU가_적어도_넉넉히_둔다(self, monkeypatch, 할당량):
        # 이 스레드들은 CPU를 쓰지 않고 소켓을 기다린다. 줄이면 동시에
        # 기다릴 수 있는 요청 수만 줄어 서로 관계없는 작업이 줄줄이 밀린다
        monkeypatch.setattr(cpu, "cpu_quota", lambda: 할당량)
        assert cpu.io_worker_count(default=24) >= 8, \
            f"CPU {할당량}개에서 공용 스레드 {cpu.io_worker_count(default=24)}개는 너무 적다"

    def test_대기_스레드가_파싱_스레드보다_많다(self, monkeypatch):
        monkeypatch.setattr(cpu, "cpu_quota", lambda: 0.1)
        assert cpu.io_worker_count(24) > cpu.cpu_worker_count(6)

    def test_기본값을_넘지_않는다(self, monkeypatch):
        # CPU가 아무리 많아도 원래 의도한 상한은 지킨다
        monkeypatch.setattr(cpu, "cpu_quota", lambda: 64.0)
        assert cpu.cpu_worker_count(default=6) == 6
        assert cpu.io_worker_count(default=24) == 24

    def test_최소한은_보장한다(self, monkeypatch):
        # 0개가 되면 아무 작업도 못 한다
        monkeypatch.setattr(cpu, "cpu_quota", lambda: 0.01)
        assert cpu.cpu_worker_count(default=20) >= 2
        assert cpu.io_worker_count(default=20) >= 8

    def test_공용_스레드풀은_대기_기준으로_잡는다(self):
        # 요청 처리 중의 블로킹 작업이 전부 여기 얹힌다
        assert "io_worker_count" in inspect.getsource(cpu.configure_thread_limits)

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
    def test_파싱_스레드가_CPU에_맞춰_잡힌다(self):
        # 예전에는 64개 고정이었다. RSS 파싱은 CPU를 태우므로 여기는 적게 잡는다
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


class Test기사_보존:
    """수집은 성공했는데 화면에 언론사가 2곳만 뜬 적이 있다.
    원인은 RSS가 발행 시각을 안 주면 기사를 통째로 버린 것이었다.
    그런데 계측은 그것도 '성공'으로 세서, 지표가 문제를 가리고 있었다."""

    def _entry(self, title, dated=True):
        import time as _t
        e = {"title": title, "link": "https://news.example.com/1", "summary": "요약"}
        if dated:
            e["published_parsed"] = _t.gmtime()
        return e

    def _feed(self, entries):
        class F: pass
        f = F(); f.entries = entries
        return f

    def test_발행시각이_없어도_기사를_버리지_않는다(self, monkeypatch):
        import feedparser, httpx
        entries = [self._entry("삼성전자 주가 상승", dated=False)]
        monkeypatch.setattr(feedparser, "parse", lambda *a, **k: self._feed(entries))
        monkeypatch.setattr(httpx, "get", lambda *a, **k: type("R", (), {"status_code": 200, "content": b""})())
        items = news._parse_feed("https://x/rss", "테스트언론사", 10)
        assert len(items) == 1, "날짜가 없다고 기사를 버리면 언론사 하나가 통째로 사라진다"

    def test_날짜_있는_기사가_없는_기사보다_앞선다(self, monkeypatch):
        import feedparser, httpx
        entries = [self._entry("코스피 하락", dated=False), self._entry("환율 급등", dated=True)]
        monkeypatch.setattr(feedparser, "parse", lambda *a, **k: self._feed(entries))
        monkeypatch.setattr(httpx, "get", lambda *a, **k: type("R", (), {"status_code": 200, "content": b""})())
        items = news._parse_feed("https://x/rss", "테스트언론사", 10)
        ts = {i["title"]: i["_ts"] for i in items}
        assert ts["환율 급등"] > ts["코스피 하락"], "날짜 모르는 기사가 최신 기사를 밀어내면 안 된다"

    def test_기사가_0건이면_성공으로_세지_않는다(self):
        # '14/14곳 성공'인데 화면에는 2곳만 뜨던 원인이 이 계측 오류였다
        import inspect as _i
        src = _i.getsource(news._fetch_all_feeds)
        assert "if items:" in src and "빈곳" in src
        assert "기사 0건" in src

    def test_수집_결과에_0건인_곳을_함께_보고한다(self):
        import inspect as _i
        src = _i.getsource(news._fetch_all_feeds)
        assert "곳은 0건" in src
