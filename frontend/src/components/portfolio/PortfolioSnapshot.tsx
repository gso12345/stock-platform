import PortfolioChart, { type PfPortfolioForChart } from "./PortfolioChart";

interface SnapshotItem {
  symbol: string;
  market: string;
  name: string;
  shares: number;
  avg_price: number;
  currency?: string;
  input_exchange_rate?: number | null;
  current_price?: number | null;
}

export default function PortfolioSnapshot({ items }: { items: SnapshotItem[] }) {
  if (!items || items.length === 0) return null;

  const portfolios: PfPortfolioForChart[] = [{
    id: 0,
    name: "포트폴리오",
    items: items.map(item => {
      const fx = item.currency === "USD" ? (item.input_exchange_rate ?? 1350) : 1;
      const currentValueKRW = item.current_price != null
        ? item.current_price * fx * item.shares
        : undefined;
      return {
        symbol: item.symbol,
        market: item.market,
        name: item.name || item.symbol,
        avgPrice: item.avg_price,
        shares: item.shares,
        currency: item.currency,
        inputExchangeRate: item.input_exchange_rate,
        currentValueKRW,
      };
    }),
  }];

  return <PortfolioChart portfolios={portfolios} exchangeRate={1350} />;
}
