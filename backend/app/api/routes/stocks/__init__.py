"""종목 상세 — 이 파일이 무엇을 갖고 있었나.

한 파일에 2,306줄이었다. 한 화면(종목 상세)이 쓰는 것을 다 모아 둔
탓인데, 그 화면에 탭이 여덟 개라 사실상 여덟 화면의 코드가 한곳에
있었다. 값 하나를 고치려고 열면 어디를 봐야 하는지부터 찾아야 했다.

탭 단위로 갈랐다. 경로도 화면도 그 단위로 나뉘어 있어서, 무엇을
고치려는지 알면 어느 파일을 열지 바로 나온다.

  _공용    시세 폴백(국내·해외), 시한 처리, 심볼 형식
  price    시세·차트·상세·재무지표
  quant    퀀트 점수와 가중치
  metrics  재무지표 추이·컨센서스
  news     공시·뉴스
  analyst  실적·투자의견
  flows    수급·ETF 구성

경로 등록 순서는 쪼개기 전과 같다. FastAPI 는 먼저 등록한 것을 먼저
맞춰 보므로, 순서가 바뀌면 어제까지 되던 주소가 다른 함수로 간다.

예전 이름으로 쓰던 곳(검사 코드가 stocks.get_metrics_history 를 본다)이
있어서, 자주 쓰이던 것은 여기서 그대로 다시 내보낸다.
"""
from fastapi import APIRouter

from . import price, quant, metrics, news, analyst, flows
from ._공용 import (                       # noqa: F401  — 예전 이름 유지
    limiter, cache, yf_service, _SYMBOL_PATTERN, _run, _시한내결과,
    get_kr_price, get_us_price, QMETRICS_TTL, _퀀트지표_뒤로미루기,
)

router = APIRouter(prefix="/stocks", tags=["종목"])

# 쪼개기 전 파일에 적혀 있던 차례 그대로. 바꾸면 주소가 다른 함수로 간다.
for _조각 in (price, quant, metrics, news, analyst, flows):
    router.include_router(_조각.router)

# 예전 이름으로 부르던 것들 — 검사 코드와 다른 모듈이 쓴다
get_stock_price     = price.get_stock_price
get_stock_ohlcv     = price.get_stock_ohlcv
get_stock_detail    = price.get_stock_detail
get_fundamentals    = price.get_fundamentals
get_financials      = price.get_financials
get_quant_score     = quant.get_quant_score
get_metrics_history = metrics.get_metrics_history
get_forecasts       = metrics.get_forecasts
get_stock_news      = news.get_stock_news
get_earnings        = analyst.get_earnings
get_analyst         = analyst.get_analyst
