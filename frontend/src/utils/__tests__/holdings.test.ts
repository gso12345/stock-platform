import { describe, it, expect } from "vitest";
import { withNativeValues } from "../holdings";

const FX = 1400;

/** 국내 종목: 원화만 쓰므로 현지통화 값이 원화 값과 같아야 한다 */
const krItem = {
  market: "KR" as const, currency: "KRW" as const,
  avgPrice: 60000, shares: 10,
  costKRW: 600_000, currentPriceNative: 70000,
  currentValueKRW: 700_000, pnlKRW: 100_000,
};

/** 해외 종목을 달러로 입력한 경우 */
const usdItem = {
  market: "US" as const, currency: "USD" as const,
  avgPrice: 100, shares: 5,
  costKRW: 100 * 5 * 1300, currentPriceNative: 120,
  currentValueKRW: 120 * 5 * FX, pnlKRW: 120 * 5 * FX - 100 * 5 * 1300,
};

/** 해외 종목을 원화로 입력한 경우 — avgPrice가 이미 원화 금액이다 */
const usdKrwInput = {
  market: "US" as const, currency: "KRW" as const,
  avgPrice: 130_000, shares: 5,
  costKRW: 650_000, currentPriceNative: 120,
  currentValueKRW: 120 * 5 * FX, pnlKRW: 120 * 5 * FX - 650_000,
};

describe("withNativeValues", () => {
  it("국내 종목은 원화 값을 그대로 쓴다", () => {
    const r = withNativeValues(krItem, FX);
    expect(r.isForexItem).toBe(false);
    expect(r.nativeAvgPrice).toBe(60000);
    expect(r.nativeValue).toBe(700_000);
    expect(r.nativePnl).toBe(100_000);
  });

  it("달러로 입력한 해외 종목은 평단가를 그대로 달러로 본다", () => {
    const r = withNativeValues(usdItem, FX);
    expect(r.isForexItem).toBe(true);
    expect(r.nativeAvgPrice).toBe(100);
    expect(r.nativeValue).toBe(600);          // 120 × 5주
    expect(r.nativePnl).toBe(100);            // 600 - 100×5
  });

  it("원화로 입력한 해외 종목은 매입금액을 되돌려 달러 평단가를 구한다", () => {
    const r = withNativeValues(usdKrwInput, FX);
    // 650,000원 ÷ 5주 ÷ 1400원 = $92.857...
    expect(r.nativeAvgPrice).toBeCloseTo(92.857, 3);
    expect(r.nativeValue).toBe(600);
    expect(r.nativePnl).toBeCloseTo(600 - 92.857 * 5, 2);
  });

  it("수량이 0이어도 NaN을 만들지 않는다", () => {
    const r = withNativeValues({ ...usdKrwInput, shares: 0 }, FX);
    expect(Number.isNaN(r.nativeAvgPrice)).toBe(false);
    expect(r.nativeAvgPrice).toBe(0);
  });

  it("ETF도 해외 종목으로 취급한다", () => {
    const r = withNativeValues({ ...usdItem, market: "ETF" as const }, FX);
    expect(r.isForexItem).toBe(true);
  });

  it("원본 필드를 그대로 보존한다", () => {
    const r = withNativeValues(krItem, FX);
    expect(r.currentValueKRW).toBe(krItem.currentValueKRW);
    expect(r.costKRW).toBe(krItem.costKRW);
  });
});
