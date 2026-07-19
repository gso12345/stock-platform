import PortfolioChart, { type PfPortfolioForChart } from "./PortfolioChart";

interface SnapshotItem {
  symbol: string;
  market: string;
  name: string;
  shares: number;
  avg_price: number;
  currency?: string;
  input_exchange_rate?: number | null;
}

export default function PortfolioSnapshot({ items }: { items: SnapshotItem[] }) {
  if (!items || items.length === 0) return null;

  const portfolios: PfPortfolioForChart[] = [{
    id: 0,
    name: "포트폴리오",
    items: items.map(item => ({
      symbol: item.symbol,
      market: item.market,
      name: item.name || item.symbol,
      avgPrice: item.avg_price,
      shares: item.shares,
      currency: item.currency,
      inputExchangeRate: item.input_exchange_rate,
    })),
  }];

  return <PortfolioChart portfolios={portfolios} exchangeRate={1350} />;
}
