"""백그라운드 캐시 갱신용 공유 스레드 풀.

동시에 여러 캐시 미스가 발생해도 무한정 스레드를 생성하지 않도록
크기가 제한된 풀을 공유한다.
"""
from concurrent.futures import ThreadPoolExecutor
from app.core.cpu import cpu_worker_count, io_worker_count

background_executor = ThreadPoolExecutor(max_workers=io_worker_count(default=8), thread_name_prefix="bg-refresh")

# ── 종목상세의 '요청 안에서 부채살처럼 퍼지는' 조회 ──────────
#
# 재무·추정치·투자의견 세 화면은 야후에 4~6가지를 한꺼번에 물어보고,
# 12초 안에 온 것만 쓰고 응답한다. 예전에는 요청마다 새 풀을 만들고
# shutdown(wait=False) 로 끝냈다. 그런데 그 호출은 '지금 하던 일은 끝까지
# 하고 그 다음에 정리하라'는 뜻이지 '멈춰라'가 아니다. yfinance 는 요청
# 시한이 없어서 야후가 응답을 미루면 그 스레드는 영영 살아 있는다.
#
# 실제로 이 패턴은 요청 10번에 스레드 61개를 남겼다. 스레드마다 스택과
# 붙들고 있던 pandas 표가 함께 남으므로, 종목상세를 10분쯤 돌아다니면
# 512MB 한도를 넘겨 프로세스가 강제 재시작됐다.
#
# 풀을 하나로 공유하면 시한을 넘긴 작업이 있어도 스레드 수는 이 상한을
# 넘지 않는다. 늦게 끝난 작업의 스레드는 사라지는 대신 풀로 돌아와
# 다음 요청이 재사용한다.
#
# 일반 요청용 공용 풀(app.core.cpu 가 잡는 asyncio 기본 풀)과 일부러
# 나눠 둔다. 야후가 통째로 느려졌을 때 대시보드까지 같이 멈추면 안 된다.
detail_executor = ThreadPoolExecutor(
    max_workers=io_worker_count(default=12), thread_name_prefix="detail",
)
