import { lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { dashboardApi } from "@/api/stocks";
import type { PfPortfolioForChart } from "./PortfolioChart";

/* 차트는 따로 받는다.
   이 파일은 피드 카드가 쓴다(Feed.tsx). 그런데 PortfolioChart 는 recharts
   를 정적으로 끌고 오고, 그게 gzip 110KB 다. ESM 은 의존 그래프를 다 받아야
   모듈 본문이 실행되므로, 피드의 첫 API 요청이 그 110KB 를 다 받은 뒤에야
   시작됐다 — 피드 청크 136KB 중 81% 가 recharts 였다.

   정작 이 차트는 '포트폴리오를 공유한 글' 에만 나온다. 그런 글이 하나도
   없는 피드에서도 값을 치르고 있었다. */
const PortfolioChart = lazy(() => import("./PortfolioChart"));

interface SnapshotItem {
  symbol: string;
  market: string;
  name: string;
  shares: number;
  avg_price: number;
  currency?: string;
  input_exchange_rate?: number | null;
  current_price?: number | null;
  asset_class?: string | null;
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
        assetClass: item.asset_class,
      };
    }),
  }];

  return (
    /* 자리를 미리 잡아 둔다. 안 그러면 차트가 늦게 끼어들며 아래 글이 밀린다 */
    <Suspense fallback={<div className="h-[180px] rounded-xl bg-bg-elevated/40 animate-pulse" />}>
      <PortfolioChart portfolios={portfolios} exchangeRate={exchangeRate > 0 ? exchangeRate : 1} />
    </Suspense>
  );
}
