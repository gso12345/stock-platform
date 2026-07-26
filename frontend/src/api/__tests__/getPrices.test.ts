import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * 서버는 한 요청에 최대 50종목만 받는다. 초과하면 400이 나면서 일부가 아니라
 * 전부 실패해, 관심종목이 51개만 넘어도 가격이 하나도 표시되지 않았다.
 */

const get = vi.fn();
vi.mock("@/api/client", () => ({ default: { get: (...a: any[]) => get(...a) } }));

const { watchlistApi } = await import("../stocks");

/** 요청받은 심볼 목록을 그대로 되돌려주는 가짜 서버 (50개 초과면 거절) */
function fakeServer() {
  get.mockImplementation((_url: string, cfg: any) => {
    const syms = String(cfg.params.symbols).split(",");
    if (syms.length > 50) return Promise.reject(new Error("400: 최대 50개"));
    return Promise.resolve({
      data: syms.map((s) => ({ symbol: s, price: 1000, market: "KR" })),
    });
  });
}

const symbols = (n: number) => Array.from({ length: n }, (_, i) => `${100000 + i}`);
const markets = (n: number) => Array(n).fill("KR");

describe("watchlistApi.getPrices — 50종목 상한 처리", () => {
  beforeEach(() => { get.mockReset(); fakeServer(); });

  it("50개 이하면 한 번만 요청한다", async () => {
    const r = await watchlistApi.getPrices(symbols(50), markets(50));
    expect(get).toHaveBeenCalledTimes(1);
    expect(r).toHaveLength(50);
  });

  it("51개면 나눠 보내고 전부 돌려준다 (예전에는 통째로 실패했다)", async () => {
    const r = await watchlistApi.getPrices(symbols(51), markets(51));
    expect(get).toHaveBeenCalledTimes(2);
    expect(r).toHaveLength(51);
  });

  it("120개도 빠짐없이 조회된다", async () => {
    const syms = symbols(120);
    const r = await watchlistApi.getPrices(syms, markets(120));
    expect(get).toHaveBeenCalledTimes(3);
    expect(r.map((d: any) => d.symbol)).toEqual(syms);   // 순서도 유지
  });

  it("나눠 보낼 때 종목과 시장이 어긋나지 않는다", async () => {
    // 서버가 symbols[i]와 markets[i]를 짝지으므로 같은 구간으로 잘라야 한다
    const syms = symbols(60);
    const mkts = syms.map((_, i) => (i < 30 ? "KR" : "US"));
    await watchlistApi.getPrices(syms, mkts);

    const calls = get.mock.calls.map((c: any) => c[1].params);
    for (const p of calls) {
      const s = String(p.symbols).split(",");
      const m = String(p.markets).split(",");
      expect(s).toHaveLength(m.length);
      // 각 심볼이 원래 갖고 있던 시장과 같은지
      s.forEach((sym, i) => expect(m[i]).toBe(mkts[syms.indexOf(sym)]));
    }
  });

  it("빈 목록이면 요청하지 않는다", async () => {
    const r = await watchlistApi.getPrices([], []);
    expect(get).not.toHaveBeenCalled();
    expect(r).toEqual([]);
  });
});
