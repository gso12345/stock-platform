"""서버가 하는 일 — 분야별 폴더.

  market/        시세·지수·환율·장 시간·순위(야후·네이버·KIS·Finnhub)
  listings/      상장 종목 목록(국내·미국), 코스피/코스닥 구분
  fundamentals/  펀더멘털·재무제표(OpenDART·FMP)
  quant/         퀀트 점수
  portfolio/     내 자산 — 날마다 평가액, 보유 종목 뉴스, 배당 달력
  backtest/      전략·자산배분 백테스트

한 파일로 된 것:
  scheduler       뒤에서 도는 갱신(서버가 깰 때·주기마다)
  news_service    뉴스
  ipo_service     공모주 상장일 시초가 예측
  alert_checker   가격 알림
  account_delete  회원 탈퇴 — 그 사람의 데이터 지우기
  demo_data       API 키가 없을 때 보여 줄 예시 값
"""
