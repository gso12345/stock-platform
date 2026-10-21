"""시세·지수·환율·장 시간·순위 — 바깥(야후·네이버·KIS·Finnhub)에서 값을 받아 오는 곳.

  yf_service       야후(시세·차트·펀더멘털·스크리닝 사진)
  price_fetcher    국내·해외 실시간 시세(네이버·야후 묶음)
  cached_prices    이미 받아 둔 시세(내 자산·관심종목 목록용)
  market_extras    국내 시장 부가 데이터(선물·금리·환율·수급)
  market_hours     장 운영 시간
  ranking_service  순위(국내·해외)
  watched          지금 화면에서 보고 있는 종목
  kis_service      한국투자증권 OpenAPI
  finnhub_service  Finnhub(미국 실시간)
"""
