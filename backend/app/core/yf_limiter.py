"""
yfinance 패키지 호출(Ticker 단건 조회/funds_data 등) 동시 실행 제한.
각 호출이 자체 requests 세션 + pandas 파싱을 수반해 메모리/스레드 비용이 크므로,
트래픽 급증 시 동시에 너무 많은 yfinance 호출이 쌓이지 않도록 전역으로 제한한다.
"""
import asyncio

YF_CONCURRENCY_LIMIT = 6
yf_semaphore = asyncio.Semaphore(YF_CONCURRENCY_LIMIT)
