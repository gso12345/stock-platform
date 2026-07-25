/** 내 자산 화면에서 공용으로 쓰는 타입 — 페이지와 모달·행 컴포넌트가 함께 참조한다 */
import type { AssetClass } from "@/utils/assetClass";

export type Market = "KR" | "US" | "ETF";
export type Currency = "KRW" | "USD";
export type ChartMode = "stock" | "market" | "portfolio";

export interface PortfolioItem {
  id: number;
  portfolioId?: number;
  portfolioName?: string;
  symbol: string;
  market: Market;
  name: string;
  shares: number;
  avgPrice: number;
  currency: Currency;
  inputExchangeRate?: number;
  purchaseDate?: string;
  note?: string;
  assetClass?: AssetClass | null;
}

export type SelectedPortfolio = number | "all";

export interface PortfolioMeta {
  id: number;
  name: string;
  position: number;
  count: number;
}

export interface EnrichedItem extends PortfolioItem {
  currentPriceNative: number;
  currentValueKRW: number;
  costKRW: number;
  pnlKRW: number;
  pnlRate: number;
  weight: number;
  dailyChangeKRW?: number;
  /* 외화 표시(달러 보기) 전용 값 — 행마다 매 렌더 재계산하지 않도록 미리 구해둔다 */
  isForexItem: boolean;
  nativeAvgPrice: number;
  nativeValue: number;
  nativePnl: number;
}
