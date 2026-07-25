import { describe, it, expect } from "vitest";
import { classifyAsset, resolveAssetClass } from "../assetClass";

describe("classifyAsset", () => {
  it("시장으로 국내/해외 주식을 나눈다", () => {
    expect(classifyAsset({ market: "KR", symbol: "005930", name: "삼성전자" })).toBe("국내주식");
    expect(classifyAsset({ market: "US", symbol: "AAPL", name: "애플" })).toBe("해외주식");
  });

  it("키워드로 채권·금·커버드콜을 골라낸다", () => {
    expect(classifyAsset({ market: "ETF", symbol: "TLT", name: "iShares 미국채 20년" })).toBe("채권");
    expect(classifyAsset({ market: "ETF", symbol: "GLD", name: "SPDR Gold" })).toBe("금");
    expect(classifyAsset({ market: "ETF", symbol: "JEPI", name: "JPMorgan Equity Premium" })).toBe("커버드콜");
  });

  it("키워드가 시장 구분보다 우선한다", () => {
    // 국내 시장이라도 국고채면 채권으로 분류돼야 한다
    expect(classifyAsset({ market: "KR", symbol: "148070", name: "KOSEF 국고채10년" })).toBe("채권");
  });

  it("ETF는 종목코드로 국내 상장 여부를 판단한다", () => {
    expect(classifyAsset({ market: "ETF", symbol: "069500", name: "KODEX 200" })).toBe("국내주식");
    expect(classifyAsset({ market: "ETF", symbol: "SPY", name: "SPDR S&P 500" })).toBe("해외주식");
  });

  it("국내 상장 ETF라도 해외 자산을 담으면 해외주식", () => {
    expect(classifyAsset({ market: "ETF", symbol: "360750", name: "TIGER 미국S&P500" })).toBe("해외주식");
  });
});

describe("resolveAssetClass", () => {
  it("사용자가 직접 지정한 유형을 자동 분류보다 우선한다", () => {
    const item = { market: "KR", symbol: "005930", name: "삼성전자", assetClass: "금" as const };
    expect(resolveAssetClass(item)).toBe("금");
  });

  it("지정이 없으면 자동 분류로 넘어간다", () => {
    expect(resolveAssetClass({ market: "KR", symbol: "005930", name: "삼성전자", assetClass: null }))
      .toBe("국내주식");
  });
});
