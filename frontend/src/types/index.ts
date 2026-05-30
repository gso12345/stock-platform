export type Market = "KR" | "US" | "ETF";

export interface StockPrice {
  symbol: string;
  name?: string;
  price: number;
  change: number;
  change_rate: number;
  volume: number;
  market_cap: number;
  currency?: string;
  high?: number;
  low?: number;
  open?: number;
}

export interface StockFundamentals {
  per?: number | null;
  forward_per?: number | null;
  pbr?: number | null;
  roe?: number | null;
  eps?: number | null;
  debt_ratio?: number | null;
  week52_high?: number;
  week52_low?: number;
  dividend_yield?: number | null;
  sector?: string;
  industry?: string;
}

export interface StockDetail extends StockPrice, StockFundamentals {}

export interface OHLCV {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketIndex {
  index: string;
  name?: string;
  value: number;
  change: number;
  change_rate: number;
}

export interface WatchlistItem {
  id: number;
  symbol: string;
  market: Market;
  name: string;
  price?: number;
  change?: number;
  change_rate?: number;
}

export interface Watchlist {
  id: number;
  name: string;
  items: WatchlistItem[];
}

export interface ScreeningFilter {
  per?: { min?: number; max?: number };
  pbr?: { min?: number; max?: number };
  roe?: { min?: number; max?: number };
  eps?: { min?: number; max?: number };
  debt_ratio?: { min?: number; max?: number };
  market_cap?: { min?: number; max?: number };
  change_rate?: { min?: number; max?: number };
}

export interface ScreeningPreset {
  id: number;
  name: string;
  market: Market;
  filters: ScreeningFilter;
  sort_by: string;
  sort_order: string;
}

export type IndicatorType = "MA" | "RSI" | "MACD" | "BB" | "PRICE" | "VOLUME";
export type OperatorType = ">" | "<" | ">=" | "<=" | "cross_above" | "cross_below";

export interface Condition {
  indicator: IndicatorType;
  operator: OperatorType;
  value: number | string;
  period?: number;
}

export interface ConditionGroup {
  logic: "AND" | "OR";
  conditions: Condition[];
}

export interface Strategy {
  id: number;
  name: string;
  description?: string;
  version: number;
  market: Market;
  entry_conditions: ConditionGroup;
  exit_conditions: ConditionGroup;
  stop_loss?: number;
  take_profit?: number;
  created_at: string;
}

export interface BacktestResult {
  id: number;
  symbol: string;
  market: Market;
  start_date: string;
  end_date: string;
  initial_capital: number;
  total_return: number;
  annual_return: number;
  mdd: number;
  sharpe_ratio: number;
  win_rate: number;
  total_trades: number;
  equity_curve: { date: string; value: number }[];
  trades: Trade[];
  created_at: string;
}

export interface Trade {
  type: string;
  entry_date: string;
  exit_date: string;
  entry_price: number;
  exit_price: number;
  pnl_rate: number;
  shares: number;
}
