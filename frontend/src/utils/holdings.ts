import type { Market, Currency } from "@/types/portfolio";

/**
 * 외화 종목의 현지통화(달러) 기준 값 계산.
 *
 * 목록을 만들 때 한 번만 계산해 두고, 행을 그릴 때는 결과만 읽는다.
 * (예전에는 행마다 매 렌더 다시 계산했다)
 *
 * 주의: 해외 종목을 원화로 입력한 경우 avgPrice가 이미 원화 금액이라
 * 그대로 달러로 취급하면 안 되고, 매입금액을 수량·환율로 되돌려야 한다.
 */
export function withNativeValues<T extends {
  market: Market; currency: Currency; avgPrice: number; shares: number;
  costKRW: number; currentPriceNative: number; currentValueKRW: number; pnlKRW: number;
}>(e: T, fx: number) {
  const isForexItem = e.market === "US" || e.market === "ETF";
  const nativeAvgPrice = !isForexItem
    ? e.avgPrice
    : e.currency === "USD"
      ? e.avgPrice
      : e.shares ? (e.costKRW / e.shares) / fx : 0;
  const nativeValue = isForexItem ? e.currentPriceNative * e.shares : e.currentValueKRW;
  const nativePnl   = isForexItem ? nativeValue - nativeAvgPrice * e.shares : e.pnlKRW;
  return { ...e, isForexItem, nativeAvgPrice, nativeValue, nativePnl };
}
