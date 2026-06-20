"""백그라운드 캐시 갱신용 공유 스레드 풀.

동시에 여러 캐시 미스가 발생해도 무한정 스레드를 생성하지 않도록
크기가 제한된 풀을 공유한다.
"""
from concurrent.futures import ThreadPoolExecutor

background_executor = ThreadPoolExecutor(max_workers=8, thread_name_prefix="bg-refresh")
