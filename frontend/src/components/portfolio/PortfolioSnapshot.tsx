import { useQuery } from "@tanstack/react-query";
import { dashboardApi } from "@/api/stocks";
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
  const { data: fxData } = useQuery({
    queryKey: ["exchange-rate"],
    queryFn: () => dashboardApi.getExchangeRate(),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
  const exchangeRate: number = (fxData as any)?.value ?? 0;

  if (!items || items.length === 0) return null;

  const portfolios: PfPortfolioForChart[] = [{
    id: 0,
    name: "포트폴리오",
    items: items.map(item => {
      const isUSDStock = item.market === "US" || item.market === "ETF";
      // input_exchange_rate: 매수 당시 환율 (항상 우선), 없으면 실시간 환율
      const fx = isUSDStock
        ? (item.input_exchange_rate ?? (exchangeRate > 0 ? exchangeRate : 1))
        : 1;
      const currentValueKRW = item.current_price != null && item.current_price > 0 && fx > 0
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

  return <PortfolioChart portfolios={portfolios} exchangeRate={exchangeRate > 0 ? exchangeRate : 1} />;
}
