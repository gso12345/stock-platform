/**
 * 공유된 포트폴리오의 종목별 비중 — 피드 목록의 색 띠(포트폴리오띠)가 쓴다.
 *
 * 글을 열면 나오는 원 그래프(PortfolioSnapshot → PortfolioChart)와 **같은 셈**이어야 한다. 목록에서는
 * 삼성전자 53% 였는데 글을 열면 48% 로 보이면 둘 중 하나는 틀린 것이 된다. 그래서 두 곳의 규칙을 그대로 옮긴다.
 *
 *   지금값 = 현재가 × 환율 × 주식 수            (현재가가 있을 때 — PortfolioSnapshot)
 *            환율: 달러 종목(US·ETF)이면 매수 당시 환율, 없으면 지금 환율
 *   없으면 = 매입가 × 환율 × 주식 수            (PortfolioChart)
 *            환율: 통화가 달러면 매수 당시 환율(없으면 지금), 아니면 시장이 달러 종목일 때 지금 환율
 *
 * 같은 종목이 여러 줄이면 합치고, 0 이하는 뺀다. 큰 것부터.
 */
export interface 공유종목 {
  symbol: string;
  market: string;
  name: string;
  shares: number;
  avg_price: number;
  currency?: string;
  input_exchange_rate?: number | null;
  current_price?: number | null;
}

export interface 종목비중 {
  symbol: string;
  name: string;
  /** 0~1 */
  비중: number;
}

export function 종목별비중(items: 공유종목[], 환율: number): 종목비중[] {
  const 지금환율 = 환율 > 0 ? 환율 : 1;
  const 모음 = new Map<string, { name: string; 값: number }>();
  for (const i of items ?? []) {
    if (!i?.symbol) continue;
    const 달러종목 = i.market === "US" || i.market === "ETF";
    const 매수환율 = 달러종목 ? (i.input_exchange_rate ?? 지금환율) : 1;
    let 값: number;
    if (i.current_price != null && i.current_price > 0 && 매수환율 > 0) {
      값 = i.current_price * 매수환율 * i.shares;
    } else {
      const fx = i.currency === "USD" ? (i.input_exchange_rate ?? 지금환율) : 달러종목 ? 지금환율 : 1;
      값 = (i.avg_price ?? 0) * fx * (i.shares ?? 0);
    }
    const 앞 = 모음.get(i.symbol);
    if (앞) 앞.값 += 값;
    else 모음.set(i.symbol, { name: i.name || i.symbol, 값 });
  }
  const 줄 = [...모음.entries()].filter(([, v]) => v.값 > 0).sort((a, b) => b[1].값 - a[1].값);
  const 합 = 줄.reduce((s, [, v]) => s + v.값, 0);
  if (합 <= 0) return [];
  return 줄.map(([symbol, v]) => ({ symbol, name: v.name, 비중: v.값 / 합 }));
}
