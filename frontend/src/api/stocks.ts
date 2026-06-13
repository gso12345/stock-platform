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
  getItems: () =>
    api.get("/portfolio/items").then((r) => r.data),

  addItem: (payload: {
    symbol: string; market: string; name: string;
    shares: number; avg_price: number; currency: string;
    input_exchange_rate?: number | null;
    purchase_date?: string | null;
    note?: string | null;
  }) =>
    api.post("/portfolio/items", payload).then((r) => r.data),

  updateItem: (id: number, payload: {
    symbol: string; market: string; name: string;
    shares: number; avg_price: number; currency: string;
    input_exchange_rate?: number | null;
    purchase_date?: string | null;
    note?: string | null;
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

  addItem: (payload: { symbol: string; market: string; name: string; watchlist_id: number; memo?: string; folder_id?: number | null }) =>
    api.post("/watchlist/items", payload).then((r) => r.data),

  updateItem: (id: number, payload: { name?: string; memo?: string; folder_id?: number | null }) =>
    api.put(`/watchlist/items/${id}`, payload).then((r) => r.data),

  removeItem: (itemId: number) =>
    api.delete(`/watchlist/items/${itemId}`).then((r) => r.data),

  reorderItems: (order: number[]) =>
    api.put("/watchlist/items/reorder", { order }).then((r) => r.data),
};
