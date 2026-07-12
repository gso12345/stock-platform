import api from "./client";
import type { Market, StockPrice, StockDetail, OHLCV, StockFundamentals } from "@/types";

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

  getNews: (market: string, symbol: string) =>
    api.get<any[]>(`/stocks/${market}/${encodeURIComponent(symbol)}/news`).then((r) => r.data),

  getMetricsHistory: (market: string, symbol: string) =>
    api.get<{annual: any[], quarterly: any[]}>(`/stocks/${market}/${encodeURIComponent(symbol)}/metrics-history`).then((r) => r.data),

  getEarnings: (market: string, symbol: string) =>
    api.get<any>(`/stocks/${market}/${encodeURIComponent(symbol)}/earnings`).then((r) => r.data),

  getForecasts: (market: string, symbol: string) =>
    api.get<any[]>(`/stocks/${market}/${encodeURIComponent(symbol)}/forecasts`).then((r) => r.data),

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
    api.get<{ kr: any[]; us: any[] }>("/dashboard/indices").then((r) => r.data),

  getKR: (category = "시가총액") =>
    api.get("/dashboard/kr", { params: { category, include_news: false } }).then((r) => r.data),

  getUS: (category = "시가총액") =>
    api.get("/dashboard/us", { params: { category, include_news: false } }).then((r) => r.data),

  getRankings: (market: "kr" | "us", category = "시가총액") =>
    api.get(`/dashboard/rankings/${market}`, { params: { category } }).then((r) => r.data),

  getNews: (market: "kr" | "us") =>
    api.get(`/dashboard/news/${market}`).then((r) => r.data),

  getIndexDetail: (name: string) =>
    api.get(`/dashboard/index/${name}`).then((r) => r.data),

  getIndexOHLCV: (name: string, period = "1y", interval = "1d") =>
    api.get(`/dashboard/index/${name}/ohlcv`, { params: { period, interval } }).then((r) => r.data),

  getKRExtras: () =>
    api.get("/dashboard/kr/extras").then((r) => r.data),

  getUSRates: () =>
    api.get("/dashboard/us/rates").then((r) => r.data),

  getTopMovers: () =>
    api.get<{ risers: any[]; fallers: any[] }>("/dashboard/top-movers").then((r) => r.data),
};

export const watchlistFolderApi = {
  getFolders: () =>
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
  run: (payload: { market: string; filters: any; sort_by: string; sort_order: string; limit: number }) =>
    api.post("/screening/run", payload).then((r) => r.data),

  getPresets: () =>
    api.get("/screening/presets").then((r) => r.data),

  savePreset: (payload: any) =>
    api.post("/screening/presets", payload).then((r) => r.data),

  deletePreset: (id: number) =>
    api.delete(`/screening/presets/${id}`).then((r) => r.data),
};

export const backtestApi = {
  run: (payload: any) =>
    api.post("/backtest/run", payload).then((r) => r.data),

  runUniverse: (payload: any) =>
    api.post("/backtest/universe", payload).then((r) => r.data),

  getResults: (limit = 20) =>
    api.get("/backtest/results", { params: { limit } }).then((r) => r.data),

  getResult: (id: number) =>
    api.get(`/backtest/results/${id}`).then((r) => r.data),

  getStrategies: () =>
    api.get("/backtest/strategies").then((r) => r.data),

  saveStrategy: (payload: any) =>
    api.post("/backtest/strategies", payload).then((r) => r.data),

  updateStrategy: (id: number, payload: any) =>
    api.put(`/backtest/strategies/${id}`, payload).then((r) => r.data),

  deleteStrategy: (id: number) =>
    api.delete(`/backtest/strategies/${id}`).then((r) => r.data),
};

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
};

export const watchlistApi = {
  getAll: () =>
    api.get("/watchlist/").then((r) => r.data),

  getItems: (market?: string, folderId?: number) =>
    api.get("/watchlist/items", { params: { market, folder_id: folderId } }).then((r) => r.data),

  getPrices: (symbols: string[], markets: string[], signal?: AbortSignal) =>
    api.get<any[]>("/watchlist/prices", {
      params: { symbols: symbols.join(","), markets: markets.join(",") },
      signal,
    }).then((r) => r.data),

  getItemsWithPrices: (market?: string) =>
    api.get("/watchlist/items/prices", { params: { market } }).then((r) => r.data),

  getWithPrices: (id: number) =>
    api.get(`/watchlist/${id}/prices`).then((r) => r.data),

  addItem: (payload: { symbol: string; market: string; name: string; watchlist_id: number; memo?: string; folder_id?: number }) =>
    api.post("/watchlist/items", payload).then((r) => r.data),

  updateItem: (id: number, payload: { name?: string; memo?: string; folder_id?: number }) =>
    api.put(`/watchlist/items/${id}`, payload).then((r) => r.data),

  removeItem: (itemId: number) =>
    api.delete(`/watchlist/items/${itemId}`).then((r) => r.data),

  reorderItems: (order: number[]) =>
    api.put("/watchlist/items/reorder", { order }).then((r) => r.data),
};
