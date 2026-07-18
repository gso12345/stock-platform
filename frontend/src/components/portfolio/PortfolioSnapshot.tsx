import { useQuery } from "@tanstack/react-query";
import { watchlistApi } from "@/api/stocks";
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
  const symbols = (items ?? []).map(i => i.symbol);
  const markets = (items ?? []).map(i => i.market);

  const { data: livePrices } = useQuery({
    queryKey: ["snapshotPrices", [...symbols].sort().join(",")],
    queryFn: () => watchlistApi.getPrices(symbols, markets),
    staleTime: 60_000,
    enabled: symbols.length > 0,
  });

  if (!items || items.length === 0) return null;

  const priceMap: Record<string, number> = {};
  if (livePrices) {
    (livePrices as any[]).forEach((p: any) => {
      if (p.price > 0) priceMap[p.symbol] = p.price;
    });
  }

  const portfolios: PfPortfolioForChart[] = [{
    id: 0,
    name: "포트폴리오",
    items: items.map(item => {
      const livePrice = priceMap[item.symbol];
      const fx = item.currency === "USD" ? (item.input_exchange_rate ?? 1350) : 1;
      const currentValueKRW = livePrice != null ? livePrice * fx * item.shares : undefined;
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
