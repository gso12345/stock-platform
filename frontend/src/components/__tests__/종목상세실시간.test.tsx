/**
 * 종목 상세의 가격·등락이 WebSocket 으로 곧바로 바뀐다.
 * 상세 전체 재조회(15초)는 무거워 그대로 두고 가격만 실시간으로 덮는다.
 * 화면 전체를 그리기엔 무거워 다른 종목상세 검사처럼 소스를 본다.
 * 실제 동작은 브라우저에서 가짜 WebSocket 으로 확인했다.
 */
import { describe, it, expect } from "vitest";
import 원문 from "../../pages/StockDetail.tsx?raw";

describe("종목 상세 실시간 시세", () => {
  it("이 종목 하나를 실시간 구독한다", () => {
    expect(원문).toMatch(/usePricesStream\(sym \? \[sym\] : \[\], \[m\]/);
  });
  it("멈춘 값(stale)이나 0 은 쓰지 않는다", () => {
    const i = 원문.indexOf("usePricesStream(sym");
    expect(원문.slice(i, i + 400)).toMatch(/p\.price > 0 && !p\.stale/);
  });
  it("가격·등락만 덮고, 다른 종목으로 옮기면 쓰지 않는다", () => {
    const i = 원문.indexOf("const d = useMemo");
    const 구역 = 원문.slice(i, i + 500);
    expect(구역).toMatch(/실시간\.sym !== sym/);
    expect(구역).toMatch(/price: 실시간\.price/);
  });
});
