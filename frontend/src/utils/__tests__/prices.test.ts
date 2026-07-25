import { describe, it, expect } from "vitest";
import { mergeEffectivePrices, indexPricesBySymbol, lookupPrice, normalizeSymbol } from "../prices";

describe("normalizeSymbol", () => {
  it("국내 종목의 .KS/.KQ 접미사를 떼어낸다", () => {
    expect(normalizeSymbol("005930.KS")).toBe("005930");
    expect(normalizeSymbol("035720.KQ")).toBe("035720");
  });

  it("접미사가 없으면 그대로 둔다", () => {
    expect(normalizeSymbol("005930")).toBe("005930");
    expect(normalizeSymbol("AAPL")).toBe("AAPL");
  });

  it("종목명 중간의 .ks 같은 문자열은 건드리지 않는다", () => {
    expect(normalizeSymbol("BRK.B")).toBe("BRK.B");
  });
});

describe("indexPricesBySymbol + lookupPrice", () => {
  it("요청 심볼과 응답 심볼의 접미사가 달라도 찾아낸다", () => {
    // 서버가 005930.KS 로 요청받고 005930 으로 응답하는 실제 사례
    const index = indexPricesBySymbol([{ symbol: "005930", price: 70000 }]);
    expect(lookupPrice(index, "005930.KS")?.price).toBe(70000);
  });

  it("반대 방향(요청 bare, 응답 접미사)도 찾아낸다", () => {
    const index = indexPricesBySymbol([{ symbol: "005930.KS", price: 70000 }]);
    expect(lookupPrice(index, "005930")?.price).toBe(70000);
  });

  it("가격이 있는 항목이 값 없는 항목에 가려지지 않는다", () => {
    const index = indexPricesBySymbol([
      { symbol: "005930.KS", price: 70000 },
      { symbol: "005930", price: null },
    ]);
    expect(lookupPrice(index, "005930")?.price).toBe(70000);
  });

  it("없는 종목은 undefined", () => {
    const index = indexPricesBySymbol([{ symbol: "AAPL", price: 200 }]);
    expect(lookupPrice(index, "TSLA")).toBeUndefined();
  });

  it("빈 입력에도 안전하다", () => {
    expect(lookupPrice(indexPricesBySymbol(null), "AAPL")).toBeUndefined();
    expect(lookupPrice(indexPricesBySymbol([]), "")).toBeUndefined();
  });
});

describe("mergeEffectivePrices", () => {
  it("WebSocket 값이 HTTP 값보다 우선한다", () => {
    const merged = mergeEffectivePrices(
      [{ symbol: "AAPL", price: 210 }],
      [{ symbol: "AAPL", price: 200 }],
    );
    expect(merged).toHaveLength(1);
    expect(merged![0].price).toBe(210);
  });

  it("WebSocket이 다루지 못한 종목은 HTTP 값으로 채운다 (스트리밍 상한 초과분)", () => {
    const merged = mergeEffectivePrices(
      [{ symbol: "AAPL", price: 210 }],
      [{ symbol: "AAPL", price: 200 }, { symbol: "TSLA", price: 300 }],
    );
    const bySym = Object.fromEntries(merged!.map((d: any) => [d.symbol, d.price]));
    expect(bySym).toEqual({ AAPL: 210, TSLA: 300 });
  });

  it("가격 없는 WebSocket 항목이 정상 HTTP 값을 덮어쓰지 않는다", () => {
    const merged = mergeEffectivePrices(
      [{ symbol: "AAPL", price: null }],
      [{ symbol: "AAPL", price: 200 }],
    );
    expect(merged![0].price).toBe(200);
  });

  it("한쪽이 없으면 다른 쪽을 그대로 돌려준다", () => {
    const http = [{ symbol: "AAPL", price: 200 }];
    expect(mergeEffectivePrices(null, http)).toBe(http);
    const ws = [{ symbol: "AAPL", price: 210 }];
    expect(mergeEffectivePrices(ws, null)).toBe(ws);
  });
});
