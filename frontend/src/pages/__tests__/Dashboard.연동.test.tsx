/**
 * 대시보드 순위 ↔ 다른 메뉴 — "메뉴마다 연동좀해줘 같은회사 같은지표 데이터여도 어떤 메뉴에는 나오는데 어떤
 * 메뉴에는 아예 안나와".
 *  · 국내 종목은 꼬리(.KS·.KQ) 없는 6자리로 연다 — 스크리닝·관심종목과 같은 주소라야 종목 상세가 같은 자료를
 *    본다(꼬리 붙은 주소로 열면 따로 받아 둔 지표를 써서 대시보드에서 연 상세에만 지표가 비었다)
 *  · 해외 종목은 스크리닝·관심종목과 같은 한글 이름(서버가 name_ko 로 준다). 영문 이름은 마우스를 올리면
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

const 줄 = (symbol: string, name: string, extra: object = {}) =>
  ({ symbol, name, price: 100, change: 1, change_rate: 1, volume: 0, market_cap: 1e12, ...extra });

vi.mock("@/api/stocks", () => ({
  dashboardApi: {
    getKR: vi.fn(() => Promise.resolve({ indices: [], rates: [], futures: [] })),
    getUS: vi.fn(() => Promise.resolve({ indices: [], rates: [] })),
    getUSRates: vi.fn(() => Promise.resolve([])),
    getNews: vi.fn(() => Promise.resolve([])),
    getRankings: vi.fn((m: string) => Promise.resolve(m === "kr"
      ? [줄("005930.KS", "삼성전자"), 줄("247540.KQ", "에코프로비엠")]
      : [줄("TSM", "Taiwan Semiconductor Manufacturing", { name_ko: "TSMC" }), 줄("ZZZZ", "Zzzz Holdings Inc")])),
    getIndexDetail: vi.fn(() => Promise.resolve({})),
  },
}));

vi.mock("@/hooks/useWebSocket", () => ({
  useIndicesStream: () => ({ status: "disconnected" }),
  usePricesStream: () => ({ status: "disconnected" }),
}));

import Dashboard, { 순위코드 } from "../Dashboard";

function 지금주소() {
  return <p>주소 {useLocation().pathname}</p>;
}

function 띄우기() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 60_000 } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/stocks/:market/:symbol" element={<지금주소 />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("순위코드 — 다른 메뉴와 같은 종목 코드", () => {
  it("국내는 꼬리를 뗀 6자리", () => {
    expect(순위코드("005930.KS", true)).toBe("005930");
    expect(순위코드("247540.KQ", true)).toBe("247540");
    expect(순위코드("005930", true)).toBe("005930");
  });

  it("해외는 그대로 — BRK.B 같은 점이 든 티커도", () => {
    expect(순위코드("TSM", false)).toBe("TSM");
    expect(순위코드("ABC.KS", false)).toBe("ABC.KS");
    expect(순위코드("BRK.B", true)).toBe("BRK.B");
  });
});

describe("순위 카드", () => {
  beforeEach(() => {
    vi.stubGlobal("requestIdleCallback", (f: () => void) => { f(); return 1; });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("국내 종목은 6자리로 보이고 그 주소로 연다", async () => {
    const user = userEvent.setup();
    띄우기();
    expect(await screen.findByText("247540")).toBeInTheDocument();
    expect(screen.queryByText(/005930\.KS/)).toBeNull();
    await user.click(screen.getByText("삼성전자"));
    expect(await screen.findByText("주소 /stocks/KR/005930")).toBeInTheDocument();
  });

  it("해외 종목은 한글 이름 — 영문 이름은 설명으로, 한글 이름을 모르면 영문 그대로", async () => {
    const user = userEvent.setup();
    띄우기();
    await user.click(await screen.findByRole("tab", { name: /해외/ }));
    const 이름 = await screen.findByText("TSMC");
    expect(이름).toHaveAttribute("title", "Taiwan Semiconductor Manufacturing");
    expect(screen.queryByText("Taiwan Semiconductor Manufacturing")).toBeNull();
    expect(screen.getByText("Zzzz Holdings Inc")).not.toHaveAttribute("title");
    await user.click(이름);
    expect(await screen.findByText("주소 /stocks/US/TSM")).toBeInTheDocument();
  });
});
