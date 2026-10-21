/** 종목 — 시세·차트·상세·재무·뉴스·실적. 다른 분야(퀀트·내 자산·관심종목 …)도 맨 아래에서 다시 내보낸다. */
import api from "./client";
import type { Market, StockPrice, StockDetail, OHLCV, StockFundamentals, 뉴스항목, 실적응답, 전망응답, 지표흐름 } from "@/types";
import type { QuantEnabledMetrics, QuantScoreResult, QuantWeights } from "./quant";
import type { 배당월칸 } from "./portfolio";

/** 투자자별 수급 하루치. 값은 순매수 '거래대금'(원)이고 음수면 순매도다. */
export interface 수급행 {
  date: string;          // "2026-08-07"
  foreign: number;       // 외국인
  institution: number;   // 기관
  individual: number;    // 개인
  total: number;         // 전체
}

/** 한 종목의 배당. 배당 달력의 한 줄에서 '내 몫'(수량·받을 돈)만 뺀 것 */
export interface 종목배당 {
  symbol: string;
  market: string;
  cycle: string | null;
  months: number[];
  per_month: number;
  currency: string;
  last_date: string;
  last_amount: number;
  per_year: number;
  plan_year?: number;
  /** 달마다 며칠에 주당 얼마. actual 이 거짓이면 평균으로 메운 칸이다 */
  schedule?: 배당월칸[];
  upcoming?: { date: string; amount: number }[];
  ex_date: string | null;
  pay_date: string | null;
  /** 공시된 날짜가 없을 때 쓰는 추정치 */
  estimated_date?: string | null;
  recent: { date: string; amount: number }[];
}

export const stocksApi = {
  getPrice: (market: Market, symbol: string) =>
    api.get<StockPrice>(`/stocks/${market}/${symbol}/price`).then((r) => r.data),

  getOHLCV: (market: Market | string, symbol: string, period = "1y", interval = "1d") =>
    api.get<OHLCV[]>(`/stocks/${market}/${encodeURIComponent(symbol)}/ohlcv`, { params: { period, interval } }).then((r) => r.data),

  getFundamentals: (market: Market, symbol: string) =>
    api.get<StockFundamentals>(`/stocks/${market}/${symbol}/fundamentals`).then((r) => r.data),

  getDetail: (market: Market, symbol: string) =>
    api.get<StockDetail>(`/stocks/${market}/${symbol}/detail`).then((r) => r.data),

  getNXT: (market: Market, symbol: string) =>
    api.get<any>(`/stocks/${market}/${symbol}/nxt`).then((r) => r.data),

  /** 정렬은 서버가 처리한다 — 인기도 점수는 내부 계산값이라 응답에 싣지 않는다 */
  getNews: (market: string, symbol: string, sort: "latest" | "popular" = "latest") =>
    api.get<뉴스항목[]>(`/stocks/${market}/${encodeURIComponent(symbol)}/news`, { params: { sort } }).then((r) => r.data),

  /** 한 종목의 배당 — 지난 내역, 달마다 얼마·언제, 다음 배당일.
   *
   *  배당 달력(/portfolio/dividends)과 **같은 서비스·같은 캐시**를 본다.
   *  다른 점은 로그인이 필요 없다는 것뿐이라, 로그인 전 미리보기가
   *  지어낸 값 대신 실제 배당을 보여 줄 수 있다. */
  getDividends: (market: string, symbol: string) =>
    api.get<종목배당>(`/stocks/${market}/${encodeURIComponent(symbol)}/dividends`).then((r) => r.data),

  getMetricsHistory: (market: string, symbol: string) =>
    api.get<지표흐름>(`/stocks/${market}/${encodeURIComponent(symbol)}/metrics-history`).then((r) => r.data),

  getEarnings: (market: string, symbol: string) =>
    api.get<실적응답>(`/stocks/${market}/${encodeURIComponent(symbol)}/earnings`).then((r) => r.data),

  getForecasts: (market: string, symbol: string) =>
    api.get<전망응답>(`/stocks/${market}/${encodeURIComponent(symbol)}/forecasts`).then((r) => r.data),

  /** 투자자별 수급 (외국인·기관·개인 일별 순매수 거래대금) — 국내 종목만.
   *
   *  경로가 /stocks/KR/... 로 고정이다. 백엔드가 이 엔드포인트만 시장을
   *  path 로 안 받고 KR 로 박아 뒀다(stocks.py 의 supply-demand). */
  getSupplyDemand: (symbol: string, days = 30) =>
    api.get<수급행[]>(`/stocks/KR/${encodeURIComponent(symbol)}/supply-demand`, { params: { days } })
       .then((r) => r.data),

  getAnalyst: (market: string, symbol: string) =>
    api.get<any>(`/stocks/${market}/${encodeURIComponent(symbol)}/analyst`).then((r) => r.data),

  getEtfHoldings: (symbol: string) =>
    api.get<{ holdings: { symbol: string; name: string; pct: number; value: number }[]; sector_weights: { sector: string; pct: number }[] }>(`/stocks/ETF/${encodeURIComponent(symbol)}/holdings`).then((r) => r.data),

  getQuantScore: (
    market: string, symbol: string,
    weightOverride?: Partial<QuantWeights>,
    enabledMetricsOverride?: QuantEnabledMetrics,
  ) =>
    api.get<QuantScoreResult>(`/stocks/${market}/${encodeURIComponent(symbol)}/quant-score`, {
      params: {
        ...(weightOverride
          ? {
              w_value: weightOverride.value,
              w_quality: weightOverride.quality,
              w_momentum: weightOverride.momentum,
              w_growth: weightOverride.growth,
              w_risk: weightOverride.risk,
            }
          : {}),
        ...(enabledMetricsOverride
          ? {
              metrics_value: enabledMetricsOverride.value?.join(","),
              metrics_quality: enabledMetricsOverride.quality?.join(","),
              metrics_momentum: enabledMetricsOverride.momentum?.join(","),
              metrics_growth: enabledMetricsOverride.growth?.join(","),
              metrics_risk: enabledMetricsOverride.risk?.join(","),
            }
          : {}),
      },
    }).then((r) => r.data),
};

export const financialsApi = {
  get: (market: string, symbol: string) =>
    api.get(`/stocks/${market}/${encodeURIComponent(symbol)}/financials`).then((r) => r.data),
};

/* 나머지 분야는 같은 폴더의 파일들에 있다. 화면과 시험은 모두 이 파일('@/api/stocks')에서
   가져간다 — 시험이 vi.mock("@/api/stocks") 로 이 길을 가짜로 바꾸기 때문이다. */
export * from "./quant";
export * from "./dashboard";
export * from "./screening";
export * from "./backtest";
export * from "./portfolio";
export * from "./watchlist";
export * from "./community";
export * from "./alerts";
export * from "./ipo";
