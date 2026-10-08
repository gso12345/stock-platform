/**
 * 대시보드 순위 — "순위가 정확하지도 않고 느려".
 *
 * 화면 쪽에서 한 일은 셋이다.
 *  · 무엇으로 줄 세운 순위인지 그 값을 줄마다 적는다(시총·거래대금·거래량).
 *    예전에는 어느 탭이든 가격·등락만 보여서, 거래대금 순위가 정말 거래대금
 *    순인지 눈으로 확인할 방법이 없었다 — 실제로 틀리게 매겨져 있었다.
 *  · 언제의 순위인지 적는다. 순위는 기기에 저장했다가 앱을 열자마자 먼저
 *    보여 주는데, 그게 어제 것이어도 화면만 봐서는 알 수 없었다.
 *  · 다른 탭도 한가할 때 미리 받아 둔다. 탭을 누를 때마다 그제야 물었다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const 받은때 = Math.floor(new Date("2026-10-08T05:32:00Z").getTime() / 1000);   // 한국 14:32

const 순위 = (category: string) => {
  const 줄 = (symbol: string, name: string, extra: object) =>
    ({ symbol, name, price: 70_000, change: 500, change_rate: 0.71, volume: 0,
       market_cap: 0, as_of: 받은때, ...extra });
  if (category === "거래대금") {
    return [줄("000660.KS", "SK하이닉스", { amount: 1_234_000_000_000 }),
            줄("005930.KS", "삼성전자", { amount: 630_000_000_000 })];
  }
  if (category === "거래량") return [줄("069500.KS", "KODEX 200", { volume: 15_230_000 })];
  return [줄("005930.KS", "삼성전자", { market_cap: 431_250_000_000_000 })];
};

vi.mock("@/api/stocks", () => ({
  dashboardApi: {
    getKR: vi.fn(() => Promise.resolve({ indices: [], rates: [], futures: [] })),
    getUS: vi.fn(() => Promise.resolve({ indices: [], rates: [] })),
    getUSRates: vi.fn(() => Promise.resolve([])),
    getNews: vi.fn(() => Promise.resolve([])),
    getRankings: vi.fn((_m: string, c: string) => Promise.resolve(순위(c))),
    getIndexDetail: vi.fn(() => Promise.resolve({})),
  },
}));

vi.mock("@/hooks/useWebSocket", () => ({
  useIndicesStream: () => ({ status: "disconnected" }),
  usePricesStream: () => ({ status: "disconnected" }),
}));

import Dashboard, { 순위기준값, 순위기준시각 } from "../Dashboard";
import { dashboardApi } from "@/api/stocks";

function 띄우기() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 60_000 } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><Dashboard /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("순위기준값 — 무엇으로 줄 세웠나", () => {
  const 줄 = { symbol: "X", price: 1, change: 0, change_rate: 0,
               volume: 15_230_000, market_cap: 431_250_000_000_000, amount: 1_234_000_000_000 };

  it("시가총액·거래대금·거래량은 그 값을 적는다", () => {
    expect(순위기준값("시가총액", 줄, true)).toBe("시총 431.25조");
    expect(순위기준값("거래대금", 줄, true)).toBe("거래대금 1.23조");
    expect(순위기준값("거래량", 줄, true)).toBe("거래량 1523.0만주");
  });

  it("해외는 달러 단위로", () => {
    expect(순위기준값("시가총액", { ...줄, market_cap: 3.21e12 }, false)).toBe("시총 $3.21T");
    expect(순위기준값("거래량", 줄, false)).toBe("거래량 15.2M");
  });

  it("상승률·하락률은 등락 배지가 곧 그 값이라 안 적는다", () => {
    expect(순위기준값("상승률", 줄, true)).toBe("");
    expect(순위기준값("하락률", 줄, true)).toBe("");
  });

  it("값을 모르면 안 적는다(0 은 '모른다' 는 뜻)", () => {
    expect(순위기준값("시가총액", { ...줄, market_cap: 0 }, true)).toBe("");
  });
});

describe("순위기준시각 — 언제의 순위인가", () => {
  const 지금 = new Date("2026-10-08T06:00:00Z");     // 한국 15:00

  it("오늘이면 시각만 (한국 시각)", () => {
    expect(순위기준시각([{ as_of: 받은때 } as any], 지금)).toBe("14:32");
  });

  it("다른 날이면 날짜도", () => {
    const 어제새벽 = Math.floor(new Date("2026-10-07T20:00:00Z").getTime() / 1000);   // 한국 10/8 05:00
    const 그제 = Math.floor(new Date("2026-10-06T06:30:00Z").getTime() / 1000);       // 한국 10/6 15:30
    expect(순위기준시각([{ as_of: 어제새벽 } as any], 지금)).toBe("05:00");
    expect(순위기준시각([{ as_of: 그제 } as any], 지금)).toBe("10/6 15:30");
  });

  it("가장 나중 값을 기준으로", () => {
    expect(순위기준시각([{ as_of: 받은때 - 600 }, { as_of: 받은때 }] as any, 지금)).toBe("14:32");
  });

  it("모르면 빈 문자열", () => {
    expect(순위기준시각([{} as any], 지금)).toBe("");
    expect(순위기준시각([], 지금)).toBe("");
  });
});

describe("순위 카드", () => {
  beforeEach(() => {
    vi.mocked(dashboardApi.getRankings).mockClear();
    vi.stubGlobal("requestIdleCallback", (f: () => void) => { f(); return 1; });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-08T06:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("몇 시 기준인지와, 줄 세운 값을 보여 준다", async () => {
    띄우기();
    expect(await screen.findByText("14:32 기준")).toBeInTheDocument();
    expect(screen.getByText(/시총 431\.25조/)).toBeInTheDocument();
  });

  it("탭을 바꾸면 그 탭의 값을 적는다", async () => {
    const user = userEvent.setup();
    띄우기();
    await screen.findByText(/시총 431\.25조/);
    await user.click(screen.getByRole("tab", { name: "거래대금" }));
    expect(await screen.findByText(/거래대금 1\.23조/)).toBeInTheDocument();
    expect(screen.queryByText(/시총 /)).toBeNull();
  });

  it("다른 탭은 한가할 때 미리 받아 둔다 — 누를 때 기다리지 않게", async () => {
    띄우기();
    await screen.findByText("14:32 기준");
    await waitFor(() => {
      const 받은탭 = vi.mocked(dashboardApi.getRankings).mock.calls.map(([, c]) => c);
      for (const c of ["시가총액", "상승률", "하락률", "거래대금", "거래량"]) {
        expect(받은탭).toContain(c);
      }
    });
  });

  it("앱을 열 때 국내 순위(첫 탭)도 미리 묻는다 — 순위 카드와 같은 이름표로", async () => {
    /* 순위 카드가 화면에 붙어야 그제야 물어서, 대시보드 화면 코드를 받고
       그리는 동안 순위만 혼자 늦게 떴다 */
    const fs = await import("fs");
    const path = await import("path");
    const 원문 = fs.readFileSync(path.resolve(__dirname, "../../main.tsx"), "utf-8");
    const 선제 = 원문.slice(원문.indexOf("function 대시보드_선제요청"),
                            원문.indexOf("if (window.location.pathname"));
    expect(선제).toContain('queryKey: ["rankings", "kr", "시가총액"]');
    expect(선제).toContain('dashboardApi.getRankings("kr", "시가총액")');
    const 카드 = fs.readFileSync(path.resolve(__dirname, "../Dashboard.tsx"), "utf-8");
    expect(카드).toContain('queryKey: ["rankings", market, category]');
    expect(카드).toContain('useState<string>("시가총액")');
  });

  it("데이터를 아끼는 중이면 미리 받지 않는다", async () => {
    vi.stubGlobal("navigator", { ...navigator, connection: { saveData: true } });
    띄우기();
    await screen.findByText("14:32 기준");
    await new Promise((r) => setTimeout(r, 50));
    const 받은탭 = vi.mocked(dashboardApi.getRankings).mock.calls.map(([, c]) => c);
    expect(받은탭).toEqual(["시가총액"]);
  });
});
