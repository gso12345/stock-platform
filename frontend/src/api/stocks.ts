import api from "./client";
import type {
  Market, StockPrice, StockDetail, OHLCV, StockFundamentals,
  뉴스항목, 지표카드, 순위행, 대시보드응답, 실적응답, 전망응답, 지표흐름, MarketIndex,
  WatchlistItem, 관심폴더, 시세행, ScreeningFilter, ConditionGroup,
} from "@/types";

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
  schedule?: { month: number; day: number; amount: number; year: number | null }[];
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

export type QuantFactorKey = "value" | "quality" | "momentum" | "growth" | "risk";
export type QuantWeights = Record<QuantFactorKey, number>;
export type QuantEnabledMetrics = Partial<Record<QuantFactorKey, string[]>>;

// METRIC_DEFS(backend quant_score.py)와 동일 — 사용자가 팩터별로 사용할 지표를 고를 때 표시
export const VALUE_METRIC_DEFS: { key: string; label: string }[] = [
  { key: "per", label: "PER" },
  { key: "forward_per", label: "선행PER" },
  { key: "pbr", label: "PBR" },
  { key: "ev_ebitda", label: "EV/EBITDA" },
  { key: "peg", label: "PEG" },
];
export const QUALITY_METRIC_DEFS: { key: string; label: string }[] = [
  { key: "roe", label: "ROE" },
  { key: "roa", label: "ROA" },
  { key: "op_margin", label: "영업이익률" },
  { key: "net_margin", label: "순이익률" },
];
export const MOMENTUM_METRIC_DEFS: { key: string; label: string }[] = [
  { key: "mom_1m", label: "1개월 수익률" },
  { key: "mom_3m", label: "3개월 수익률" },
  { key: "mom_6m", label: "6개월 수익률" },
  { key: "mom_12m", label: "12개월 수익률" },
  { key: "ma60_dev", label: "60일 이평 이격도" },
  { key: "ma200_dev", label: "200일 이평 이격도" },
];
export const GROWTH_METRIC_DEFS: { key: string; label: string }[] = [
  { key: "revenue_growth", label: "매출성장률(YoY)" },
  { key: "net_income_growth", label: "순이익성장률(YoY)" },
  { key: "op_income_growth", label: "영업이익성장률(YoY)" },
];
export const RISK_METRIC_DEFS: { key: string; label: string }[] = [
  { key: "debt_ratio", label: "부채비율" },
  { key: "volatility", label: "연환산 변동성" },
];

export interface QuantMetric {
  key: string;
  label: string;
  value: number | null;
  score: number | null;
  unit: string;
  direction: "low" | "high";
}

export interface QuantFactor {
  key: QuantFactorKey;
  label: string;
  weight: number;
  score: number | null;
  metrics: QuantMetric[];
}

export interface QuantScoreResult {
  total_score: number | null;
  grade: string | null;
  factors: QuantFactor[];
  weights: QuantWeights;
  enabled_metrics: QuantEnabledMetrics;
}

export interface QuantCompareItem {
  symbol: string;
  market: string;
  total_score: number | null;
  grade: string | null;
  factors: QuantFactor[];
}

export interface QuantCompareResult {
  weights: QuantWeights;
  enabled_metrics: QuantEnabledMetrics;
  items: QuantCompareItem[];
}

export const quantScoreApi = {
  getWeights: () =>
    api.get<{ weights: QuantWeights; enabled_metrics: QuantEnabledMetrics; is_default: boolean }>("/stocks/quant-score/weights").then((r) => r.data),

  saveWeights: (weights: QuantWeights, enabledMetrics?: QuantEnabledMetrics) =>
    api.put<{ weights: QuantWeights; enabled_metrics: QuantEnabledMetrics }>("/stocks/quant-score/weights", { weights, enabled_metrics: enabledMetrics ?? {} }).then((r) => r.data),

  compare: (
    items: { symbol: string; market: string }[],
    weightOverride?: Partial<QuantWeights>,
    enabledMetricsOverride?: QuantEnabledMetrics,
  ) =>
    api.get<QuantCompareResult>("/stocks/quant-score/compare", {
      params: {
        symbols: items.map((i) => i.symbol).join(","),
        markets: items.map((i) => i.market).join(","),
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

export const dashboardApi = {
  getIndices: () =>
    api.get<{ kr: MarketIndex[]; us: MarketIndex[] }>("/dashboard/indices").then((r) => r.data),

  getKR: (category = "시가총액") =>
    api.get<대시보드응답>("/dashboard/kr", { params: { category, include_news: false } }).then((r) => r.data),

  getUS: (category = "시가총액") =>
    api.get<대시보드응답>("/dashboard/us", { params: { category, include_news: false } }).then((r) => r.data),

  getRankings: (market: "kr" | "us", category = "시가총액") =>
    api.get<순위행[]>(`/dashboard/rankings/${market}`, { params: { category } }).then((r) => r.data),

  /** 정렬은 서버가 처리한다 — 인기도 점수는 내부 계산값이라 응답에 싣지 않는다 */
  getNews: (market: "kr" | "us", sort: "latest" | "popular" = "latest") =>
    api.get<뉴스항목[]>(`/dashboard/news/${market}`, { params: { sort } }).then((r) => r.data),

  getIndexDetail: (name: string) =>
    api.get(`/dashboard/index/${name}`).then((r) => r.data),

  getIndexOHLCV: (name: string, period = "1y", interval = "1d") =>
    api.get<OHLCV[]>(`/dashboard/index/${name}/ohlcv`, { params: { period, interval } }).then((r) => r.data),

  getKRExtras: () =>
    api.get("/dashboard/kr/extras").then((r) => r.data),

  getUSRates: () =>
    api.get<지표카드[]>("/dashboard/us/rates").then((r) => r.data),

  getExchangeRate: () =>
    api.get<지표카드>("/dashboard/exchange").then((r) => r.data),

  getTopMovers: () =>
    api.get<{ risers: 순위행[]; fallers: 순위행[] }>("/dashboard/top-movers").then((r) => r.data),
};

export const watchlistFolderApi = {
  getFolders: (): Promise<관심폴더[]> =>
    api.get("/watchlist/folders").then((r) => r.data),
  createFolder: (name: string) =>
    api.post("/watchlist/folders", { name }).then((r) => r.data),
  updateFolder: (id: number, name: string) =>
    api.put(`/watchlist/folders/${id}`, { name }).then((r) => r.data),
  deleteFolder: (id: number) =>
    api.delete(`/watchlist/folders/${id}`).then((r) => r.data),
  reorderFolders: (order: number[]) =>
    api.put("/watchlist/folders/reorder", { order }).then((r) => r.data),
};

export const financialsApi = {
  get: (market: string, symbol: string) =>
    api.get(`/stocks/${market}/${encodeURIComponent(symbol)}/financials`).then((r) => r.data),
};

export const screeningApi = {
  run: (payload: { market: string; filters: ScreeningFilter; sort_by: string; sort_order: string; limit: number }) =>
    api.post("/screening/run", payload).then((r) => r.data),

  getPresets: () =>
    api.get("/screening/presets").then((r) => r.data),

  savePreset: (payload: 스크리닝저장) =>
    api.post("/screening/presets", payload).then((r) => r.data),

  deletePreset: (id: number) =>
    api.delete(`/screening/presets/${id}`).then((r) => r.data),
};

/** 저장해 두는 스크리닝 조건 한 벌 — 서버 PresetSaveRequest 와 같은 모양 */
export interface 스크리닝저장 {
  name: string;
  market: string;
  filters: ScreeningFilter;
  sort_by: string;
  sort_order: "asc" | "desc";
}

/** 백테스트 한 번의 조건 — 서버 BacktestRequest 와 같은 모양 */
export interface 백테스트요청 {
  symbol: string;
  market: string;
  start_date: string;
  end_date: string;
  initial_capital: number;
  /** 사기·팔기 조건 — 화면(Backtest.tsx)이 만드는 것과 같은 모양 */
  entry_conditions: ConditionGroup;
  exit_conditions: ConditionGroup;
  stop_loss?: number | null;
  take_profit?: number | null;
  strategy_id?: number | null;
}

/** 여러 종목을 한꺼번에 돌릴 때 — 서버 UniverseBacktestRequest */
export interface 전종목백테스트요청 extends Omit<백테스트요청, "symbol" | "strategy_id"> {
  universe: string;
  custom_symbols?: string[];
  rank_by?: string;
  top_n?: number;
}

/** 저장해 두는 전략 — 서버 StrategySaveRequest */
export interface 전략저장 {
  name: string;
  description?: string | null;
  market: string;
  entry_conditions: ConditionGroup;
  exit_conditions: ConditionGroup;
  stop_loss?: number | null;
  take_profit?: number | null;
}

export const backtestApi = {
  run: (payload: 백테스트요청) =>
    api.post("/backtest/run", payload).then((r) => r.data),

  runUniverse: (payload: 전종목백테스트요청) =>
    api.post("/backtest/universe", payload).then((r) => r.data),

  getResults: (limit = 20) =>
    api.get("/backtest/results", { params: { limit } }).then((r) => r.data),

  getResult: (id: number) =>
    api.get(`/backtest/results/${id}`).then((r) => r.data),

  getStrategies: () =>
    api.get("/backtest/strategies").then((r) => r.data),

  saveStrategy: (payload: 전략저장) =>
    api.post("/backtest/strategies", payload).then((r) => r.data),

  updateStrategy: (id: number, payload: 전략저장) =>
    api.put(`/backtest/strategies/${id}`, payload).then((r) => r.data),

  deleteStrategy: (id: number) =>
    api.delete(`/backtest/strategies/${id}`).then((r) => r.data),
};

/** 자산 흐름 그래프의 한 점. 서버가 하루 한 줄씩 남긴 것 */
export interface 자산흐름점 {
  /** "2026-08-26" — 한국 날짜 */
  day: string;
  /** 원화 환산 평가금액·매입금액 */
  value: number;
  cost: number;
  /** 그날 시세를 실제로 구한 종목 수 / 시세가 있어야 하는 종목 수 */
  filled: number;
  priced: number;
}

/** 배당 달력 한 줄 — 종목 하나의 다음 배당 */
export interface 배당줄 {
  symbol: string;
  market: string;
  name: string;
  /** 다음 배당기준일. confirmed 가 false 면 지난 주기로 미뤄 본 추정치다 */
  date: string;
  confirmed: boolean;
  /** 회사가 공시한 날짜(있을 때만) */
  ex_date: string | null;
  pay_date: string | null;
  /** "주" | "월" | "분기" | "반기" | "연" */
  cycle: string | null;
  /** 몇 월에 주나 — [2, 5, 8, 11]. 주·월배당은 1~12 전부.
   *  분기배당이라도 회사마다 달이 달라서(2·5·8·11 vs 3·6·9·12)
   *  이게 없으면 한 해 그림이 통째로 틀린다 */
  months: number[];
  /** 한 달에 몇 번 받나. 주배당만 1보다 크다(≈4.35) */
  per_month: number;
  /** "KRW" | "USD" — 원화로 환산할 때 쓴다 */
  currency: string;
  last_date: string;
  last_amount: number;
  /** 지난 1년에 **실제로** 준 주당 합계 */
  per_year: number;
  /** 앞으로 한 해 줄 것으로 보이는 주당 합계.
   *
   *  per_year 와 다를 수 있다 — 반년 전에 배당을 시작한 종목은 지난 1년
   *  합이 반년치뿐이다. 화면이 '한 해 예상' 으로 쓰는 것은 이쪽이다. */
  plan_year?: number;
  /** 달마다 며칠에 주당 얼마.
   *
   *  이게 없던 때는 마지막 회차 금액을 열두 달에 다 썼다. 분기배당은
   *  회차마다 금액이 다르므로(결산배당이 붙는 분기가 특히 크다) 그
   *  방식은 한 해 예상을 통째로 틀리게 만든다. */
  schedule?: { month: number; day: number; amount: number; year: number | null }[];
  shares: number;
  /** 이번 회차·한 해에 받을 것으로 보이는 돈. 안 갖고 있으면 null */
  expected: number | null;
  expected_year: number | null;
  recent: { date: string; amount: number }[];
}

/** 보유 종목 뉴스 한 건 — 어느 종목으로 걸렸는지가 같이 온다 */
export interface 보유뉴스항목 {
  title: string;
  link: string;
  source: string;
  /** "2026/08/26 14:30" 처럼 이미 사람이 읽는 모양으로 온다 */
  published: string;
  published_ts: number;
  summary: string;
  image?: string | null;
  /** 이 기사가 걸린 내 종목들. 한 기사가 두 종목에 걸리기도 한다 */
  symbols: string[];
}

export interface 보유뉴스응답 {
  items: 보유뉴스항목[];
  /** 기사를 찾은 종목 */
  covered: string[];
  /** 지금 서버가 배경에서 받아 오는 중인 종목 수.
   *  0 보다 크면 몇 초 뒤에 한 번 더 물어보면 더 채워져 있다 */
  pending: number;
  /** 아직 못 찾은 종목 — 서버가 새로 받아 오지 않으므로 숨기지 않고 알려 준다.
   *  종목 상세 주소가 /stocks/{market}/{symbol} 이라 시장이 같이 와야 한다 */
  missing: { symbol: string; market: string; name: string }[];
}

export const portfolioApi = {
  getPortfolios: () =>
    api.get("/portfolio/portfolios").then((r) => r.data),

  createPortfolio: (name: string) =>
    api.post("/portfolio/portfolios", { name }).then((r) => r.data),

  renamePortfolio: (id: number, name: string) =>
    api.put(`/portfolio/portfolios/${id}`, { name }).then((r) => r.data),

  deletePortfolio: (id: number) =>
    api.delete(`/portfolio/portfolios/${id}`).then((r) => r.data),

  reorderPortfolios: (order: number[]) =>
    api.put("/portfolio/portfolios/reorder", { order }).then((r) => r.data),

  /** 내 자산이 하루하루 얼마였는지 — 자산 흐름 그래프의 재료 */
  getHistory: (days = 90) =>
    api.get<{ points: 자산흐름점[]; days: number }>("/portfolio/history",
      { params: { days } }).then((r) => r.data),

  /** 내가 가진 종목이 언제 얼마를 주는가.
   *  portfolioId 를 주면 그 포트폴리오 것만, 안 주면 전체. */
  getDividends: (portfolioId?: number) =>
    api.get<{ items: 배당줄[]; pending: number }>("/portfolio/dividends",
      { params: portfolioId ? { portfolio_id: portfolioId } : {} }).then((r) => r.data),

  /** 내 종목 얘기를 한 자리에.
   *
   *  서버는 요청을 붙잡지 않는다 — 캐시에 없는 종목은 배경에서 받아
   *  오고 pending 으로 몇 개가 오는 중인지 알려 준다. */
  getHoldingNews: (portfolioId?: number) =>
    api.get<보유뉴스응답>("/portfolio/news",
      { params: portfolioId ? { portfolio_id: portfolioId } : {} }).then((r) => r.data),

  getItems: (portfolioId?: number, viewAll?: boolean) =>
    api.get("/portfolio/items", {
      params: viewAll ? { view_all: true } : (portfolioId ? { portfolio_id: portfolioId } : {}),
    }).then((r) => r.data),

  addItem: (payload: {
    portfolio_id?: number | null;
    symbol: string; market: string; name: string;
    shares: number; avg_price: number; currency: string;
    input_exchange_rate?: number | null;
    purchase_date?: string | null;
    note?: string | null;
    asset_class?: string | null;
  }) =>
    api.post("/portfolio/items", payload).then((r) => r.data),

  updateItem: (id: number, payload: {
    portfolio_id?: number | null;
    symbol: string; market: string; name: string;
    shares: number; avg_price: number; currency: string;
    input_exchange_rate?: number | null;
    purchase_date?: string | null;
    note?: string | null;
    asset_class?: string | null;
  }) =>
    api.put(`/portfolio/items/${id}`, payload).then((r) => r.data),

  deleteItem: (id: number) =>
    api.delete(`/portfolio/items/${id}`).then((r) => r.data),

  getPublicPortfolios: (userId: number) =>
    api.get(`/portfolio/public/${userId}`).then((r) => r.data),
};

/** 서버 /watchlist/prices 가 한 요청에 허용하는 최대 심볼 수 (backend watchlist.py) */
const PRICE_CHUNK_SIZE = 50;

export const watchlistApi = {
  getAll: () =>
    api.get("/watchlist/").then((r) => r.data),

  getItems: (market?: string, folderId?: number): Promise<WatchlistItem[]> =>
    api.get("/watchlist/items", { params: { market, folder_id: folderId } }).then((r) => r.data),

  /**
   * 여러 종목의 현재가를 한 번에 조회한다.
   *
   * 서버는 한 요청당 최대 50종목만 받는다(초과하면 400). 예전에는 보유·관심종목을
   * 통째로 보내서, 51개만 넘어도 일부가 아니라 **전부** 실패해 가격이 하나도
   * 표시되지 않았다. 그래서 50개씩 나눠 보내고 결과를 이어 붙인다.
   * (순서는 요청 순서 그대로 유지되므로 인덱스로 읽는 쪽도 그대로 동작한다)
   */
  getPrices: async (symbols: string[], markets: string[], signal?: AbortSignal): Promise<시세행[]> => {
    if (symbols.length === 0) return [];

    const fetchChunk = (syms: string[], mkts: string[]) =>
      api.get<시세행[]>("/watchlist/prices", {
        params: { symbols: syms.join(","), markets: mkts.join(",") },
        signal,
      }).then((r) => r.data);

    if (symbols.length <= PRICE_CHUNK_SIZE) return fetchChunk(symbols, markets);

    const requests: Promise<시세행[]>[] = [];
    for (let i = 0; i < symbols.length; i += PRICE_CHUNK_SIZE) {
      // 서버가 symbols[i]와 markets[i]를 짝지으므로 같은 구간으로 잘라야 한다
      requests.push(fetchChunk(
        symbols.slice(i, i + PRICE_CHUNK_SIZE),
        markets.slice(i, i + PRICE_CHUNK_SIZE),
      ));
    }
    return (await Promise.all(requests)).flat();
  },

  getItemsWithPrices: (market?: string) =>
    api.get("/watchlist/items/prices", { params: { market } }).then((r) => r.data),

  getWithPrices: (id: number) =>
    api.get(`/watchlist/${id}/prices`).then((r) => r.data),

  // folder_id를 null로 보내면 서버가 "기본 관심목록" 폴더로 자동 편입한다 (watchlist.py add_item)
  addItem: (payload: { symbol: string; market: string; name: string; watchlist_id: number; memo?: string; folder_id?: number | null }) =>
    api.post("/watchlist/items", payload).then((r) => r.data),

  updateItem: (id: number, payload: { name?: string; memo?: string; folder_id?: number }) =>
    api.put(`/watchlist/items/${id}`, payload).then((r) => r.data),

  removeItem: (itemId: number) =>
    api.delete(`/watchlist/items/${itemId}`).then((r) => r.data),

  reorderItems: (order: number[]) =>
    api.put("/watchlist/items/reorder", { order }).then((r) => r.data),
};

/** 글에 붙이는 투표 — 서버 PollIn 과 같은 모양 (질문 1개 + 보기 2~4개) */
export interface 글투표 { question: string; options: string[] }

/** 글에 붙이는 종목 태그 — 서버 TagIn */
export interface 글태그 { symbol: string; market: string; name?: string | null }

/** 글에 붙이는 보유 종목 — 서버 PortfolioItemIn.
 *  현금 항목은 symbol 이 "현금" 이라 종목코드 형식을 강제하지 않는다. */
export interface 글보유종목 {
  symbol: string; market: string; name?: string;
  shares?: number; avg_price?: number; currency?: string | null;
  input_exchange_rate?: number | null;
  current_price?: number | null;
  asset_class?: string | null;
}

export const communityApi = {
  getPosts: (market: string, symbol: string, page = 1, sort: "latest" | "likes" = "latest") =>
    api.get(`/community/${market}/${symbol}/posts`, { params: { page, sort } }).then((r) => r.data),
  createPost: (market: string, symbol: string, title: string, body: string,
               image = "", poll: 글투표 | null = null, tags: 글태그[] = [],
               portfolio: 글보유종목[] | null = null) =>
    api.post(`/community/${market}/${symbol}/posts`, { title, body, content: body, image, poll, tags, portfolio }).then((r) => r.data),
  getPost: (postId: number) =>
    api.get(`/community/posts/${postId}`).then((r) => r.data),
  updatePost: (market: string, symbol: string, postId: number, title: string,
               body: string, tags?: 글태그[], poll?: 글투표 | null, image?: string) =>
    api.put(`/community/${market}/${symbol}/posts/${postId}`, { title, body, tags, poll, image }).then((r) => r.data),
  updateComment: (commentId: number, content: string) =>
    api.put(`/community/comments/${commentId}`, { content }).then((r) => r.data),
  deletePost: (market: string, symbol: string, postId: number) =>
    api.delete(`/community/${market}/${symbol}/posts/${postId}`).then((r) => r.data),
  togglePostLike: (postId: number) =>
    api.post(`/community/posts/${postId}/like`).then((r) => r.data),
  getComments: (postId: number, sort: "latest" | "popular" = "latest") =>
    api.get(`/community/posts/${postId}/comments`, { params: { sort } }).then((r) => r.data),
  createComment: (postId: number, content: string, parentId?: number) =>
    api.post(`/community/posts/${postId}/comments`, { content, parent_id: parentId ?? null }).then((r) => r.data),
  deleteComment: (commentId: number) =>
    api.delete(`/community/comments/${commentId}`).then((r) => r.data),
  toggleCommentLike: (commentId: number) =>
    api.post(`/community/comments/${commentId}/like`).then((r) => r.data),
  getMyProfile: () =>
    api.get("/community/profile/me").then((r) => r.data),
  updateMyProfile: (payload: { nickname?: string; avatar_color?: number; bio?: string; avatar_url?: string }) =>
    api.put("/community/profile/me", payload).then((r) => r.data),
  getUserProfile: (userId: number) =>
    api.get(`/community/profile/${userId}`).then((r) => r.data),
  getFeed: (page = 1, sort: "latest" | "likes" = "latest", market?: string, following = false, q?: string) =>
    api.get("/community/feed", { params: { page, sort, ...(market ? { market } : {}), ...(following ? { following: true } : {}), ...(q ? { q } : {}) } }).then((r) => r.data),
  getUserPublicProfile: (userId: number) =>
    api.get(`/community/users/${userId}/profile`).then((r) => r.data),
  getUserActivity: (userId: number) =>
    api.get(`/community/users/${userId}/activity`).then((r) => r.data),
  getFollowers: (userId: number) =>
    api.get(`/community/users/${userId}/followers`).then((r) => r.data),
  getFollowing: (userId: number) =>
    api.get(`/community/users/${userId}/following`).then((r) => r.data),
  toggleFollow: (userId: number) =>
    api.post(`/community/users/${userId}/follow`).then((r) => r.data),
  votePoll: (postId: number, optionIndex: number) =>
    api.post(`/community/posts/${postId}/poll/vote`, { option_index: optionIndex }).then((r) => r.data),
  setPortfolioVisibility: (portfolioId: number, isPublic: boolean) =>
    api.put(`/portfolio/${portfolioId}/visibility`, { is_public: isPublic }).then((r) => r.data),
  reportPost: (postId: number, reason: string) =>
    api.post(`/community/posts/${postId}/report`, { reason }).then((r) => r.data),
  reportComment: (commentId: number, reason: string) =>
    api.post(`/community/comments/${commentId}/report`, { reason }).then((r) => r.data),
  getNotifications: (page = 1) =>
    api.get("/community/notifications", { params: { page } }).then((r) => r.data),
  getUnreadNotificationCount: () =>
    api.get("/community/notifications/unread-count").then((r) => r.data),
  markNotificationRead: (notiId: number) =>
    api.post(`/community/notifications/${notiId}/read`).then((r) => r.data),
  markAllNotificationsRead: () =>
    api.post("/community/notifications/read-all").then((r) => r.data),
  getNotificationSettings: () =>
    api.get("/community/notifications/settings").then((r) => r.data),
  updateNotificationSettings: (payload: Record<string, boolean>) =>
    api.put("/community/notifications/settings", payload).then((r) => r.data),
};

/** 걸어 둔 가격 알림 한 건 */
export interface 가격알림 {
  id: number;
  symbol: string;
  market: string;
  name: string;
  direction: "above" | "below";
  target: number;
  /** 걸던 순간의 시세 — "그때보다 얼마나 왔나"를 보여 주는 데 쓴다 */
  made_at_price: number | null;
  is_active: boolean;
  fired_at: string | null;
  fired_price: number | null;
}

export const alertsApi = {
  /** symbol 을 주면 그 종목 것만 */
  getAlerts: (symbol?: string) =>
    api.get<{ items: 가격알림[]; limit: number }>("/alerts",
      { params: symbol ? { symbol } : {} }).then((r) => r.data),
  createAlert: (payload: {
    symbol: string; market: string; name?: string;
    direction: "above" | "below"; target: number;
  }) => api.post<가격알림>("/alerts", payload).then((r) => r.data),
  /** 켜져 있으면 끄고, 꺼져 있으면 켠다 */
  toggleAlert: (id: number) =>
    api.patch<가격알림>(`/alerts/${id}`).then((r) => r.data),
  deleteAlert: (id: number) =>
    api.delete(`/alerts/${id}`).then((r) => r.data),
};
