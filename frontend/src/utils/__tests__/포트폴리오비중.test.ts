/**
 * 피드 목록의 포트폴리오 색 띠(사용자가 고른 8번)가 쓰는 비중.
 *
 * 글을 열면 나오는 원 그래프(PortfolioSnapshot → PortfolioChart)와 같은 셈이어야 한다 — 목록에서는 53% 인데
 * 글을 열면 48% 면 둘 중 하나는 틀린 것이 된다. 두 곳의 규칙을 하나씩 짚는다.
 */
import { describe, it, expect } from "vitest";
import { 종목별비중, type 공유종목 } from "../포트폴리오비중";

const 종목 = (o: Partial<공유종목> & { symbol: string }): 공유종목 => ({
  market: "KR", name: o.symbol, shares: 1, avg_price: 0, ...o,
});
const 비중표 = (r: ReturnType<typeof 종목별비중>) => Object.fromEntries(r.map((x) => [x.symbol, +x.비중.toFixed(4)]));

describe("지금값 — 현재가가 있으면 현재가로(PortfolioSnapshot)", () => {
  it("국내는 현재가 × 주식 수, 큰 것부터", () => {
    const r = 종목별비중([
      종목({ symbol: "A", shares: 10, current_price: 100, avg_price: 1 }),   // 1,000
      종목({ symbol: "B", shares: 30, current_price: 100, avg_price: 1 }),   // 3,000
    ], 1300);
    expect(r.map((x) => x.symbol)).toEqual(["B", "A"]);
    expect(비중표(r)).toEqual({ B: 0.75, A: 0.25 });
  });

  it("달러 종목은 매수 당시 환율로 — 없을 때만 지금 환율", () => {
    const r = 종목별비중([
      종목({ symbol: "KR1", shares: 1, current_price: 2_000_000 }),                                   // 2,000,000
      종목({ symbol: "NVDA", market: "US", shares: 10, current_price: 100, input_exchange_rate: 1200 }), // 매수 1,200 → 1,200,000
      종목({ symbol: "SCHD", market: "ETF", shares: 10, current_price: 100 }),                           // 지금 1,000 → 1,000,000
    ], 1000);
    expect(비중표(r)).toEqual({ KR1: 0.4762, NVDA: 0.2857, SCHD: 0.2381 });
  });

  it("현재가가 0 이면 지금값이 없는 것으로 본다 — 매입가로", () => {
    const r = 종목별비중([
      종목({ symbol: "A", shares: 1, current_price: 0, avg_price: 300 }),
      종목({ symbol: "B", shares: 1, current_price: 100 }),
    ], 1);
    expect(비중표(r)).toEqual({ A: 0.75, B: 0.25 });
  });
});

describe("지금값이 없으면 매입가로(PortfolioChart)", () => {
  it("통화가 달러면 매수 당시 환율, 아니면 시장이 달러 종목일 때만 지금 환율", () => {
    const r = 종목별비중([
      종목({ symbol: "USDKR", market: "KR", currency: "USD", shares: 1, avg_price: 10, input_exchange_rate: 1500 }), // 15,000
      종목({ symbol: "US", market: "US", shares: 1, avg_price: 10 }),                                               // 10 × 1000 = 10,000
      종목({ symbol: "KR", market: "KR", shares: 1, avg_price: 25_000 }),                                           // 25,000
    ], 1000);
    expect(비중표(r)).toEqual({ KR: 0.5, USDKR: 0.3, US: 0.2 });
  });

  it("환율을 아직 모르면(0) 1 로 본다 — 원 그래프와 같다", () => {
    const r = 종목별비중([
      종목({ symbol: "US", market: "US", shares: 1, avg_price: 10 }),
      종목({ symbol: "KR", market: "KR", shares: 1, avg_price: 30 }),
    ], 0);
    expect(비중표(r)).toEqual({ KR: 0.75, US: 0.25 });
  });
});

describe("모으기", () => {
  it("같은 종목이 여러 줄이면 합친다", () => {
    const r = 종목별비중([
      종목({ symbol: "A", shares: 1, current_price: 100 }),
      종목({ symbol: "A", shares: 2, current_price: 100 }),
      종목({ symbol: "B", shares: 1, current_price: 100 }),
    ], 1);
    expect(비중표(r)).toEqual({ A: 0.75, B: 0.25 });
  });

  it("값이 0 인 것은 빼고, 다 0 이면 빈 목록", () => {
    expect(종목별비중([종목({ symbol: "A", shares: 0, current_price: 100 }), 종목({ symbol: "B", shares: 1, current_price: 50 })], 1)
      .map((x) => x.symbol)).toEqual(["B"]);
    expect(종목별비중([종목({ symbol: "A", shares: 0 })], 1)).toEqual([]);
    expect(종목별비중([], 1)).toEqual([]);
  });

  it("이름이 없으면 심볼로, 심볼이 없는 줄은 건너뛴다", () => {
    const r = 종목별비중([
      { ...종목({ symbol: "X", shares: 1, current_price: 10 }), name: "" },
      { ...종목({ symbol: "", shares: 1, current_price: 10 }) },
    ], 1);
    expect(r).toEqual([{ symbol: "X", name: "X", 비중: 1 }]);
  });
});
