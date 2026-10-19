/**
 * 퀀트 표 — 빠르게(받은 것부터), 그리고 스크리닝과 같은 모양으로.
 *
 * 사용자: "디자인 통일시키고 퀀트랑 스크리닝 모든 정보가 빠르고 정확하게 불러올수 있도록 해줘".
 *   · 예전엔 점수가 서른 종목 다 와야 줄이 생겼다 — 처음 보는 종목이 섞이면 표가 통째로 비었다
 *   · 서버가 '계산 중' 이라고 하면 칸 자리를 잡아 두고 곧 다시 묻는다
 *   · 이름 칸·등락·정렬 단추·기다리는 자리가 스크리닝과 같은 부품이다
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

vi.mock("react-router-dom", async () => {
  const 실제 = await vi.importActual<any>("react-router-dom");
  return { ...실제, useNavigate: () => vi.fn() };
});
vi.mock("@/store/authStore", () => ({
  useAuthStore: (sel?: any) => { const s = { isLoggedIn: true, user: { id: 1 } }; return sel ? sel(s) : s; },
}));

const 관심종목 = [
  { id: 1, symbol: "005930", market: "KR", name: "삼성전자", folder_id: null },
  { id: 2, symbol: "NVDA", market: "US", name: "NVIDIA", folder_id: null },
];
const 갈래 = (점: number) => ["value", "quality", "momentum", "growth", "risk"].map((key) => ({ key, score: 점 }));
const compare = vi.fn();
vi.mock("@/api/stocks", async (원본가져오기) => ({
  ...(await 원본가져오기<any>()),
  quantScoreApi: {
    getWeights: vi.fn(() => Promise.resolve({ weights: null, enabled_metrics: null })),
    compare: (...a: any[]) => compare(...a),
  },
  watchlistApi: {
    getItems: vi.fn(() => Promise.resolve(관심종목)),
    getItemsWithCachedPrices: vi.fn(() => Promise.resolve(관심종목)),
    getPrices: vi.fn(() => Promise.resolve([
      { symbol: "005930", market: "KR", price: 71000, change: 900, change_rate: 1.28 },
      { symbol: "NVDA", market: "US", price: 183.2, change: -2.1, change_rate: -1.13 },
    ])),
  },
  watchlistFolderApi: { getFolders: vi.fn(() => Promise.resolve([])) },
  portfolioApi: { getPortfolios: vi.fn(() => Promise.resolve([])), getItems: vi.fn(() => Promise.resolve([])) },
}));
vi.mock("@/utils/recentlyViewed", () => ({ getRecentlyViewed: () => [] }));

import Quant from "../Quant";

function 그리기() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><MemoryRouter><Quant /></MemoryRouter></QueryClientProvider>,
  );
}

const 다됨 = {
  items: [
    { symbol: "005930", market: "KR", total_score: 61.5, grade: "B", factors: 갈래(60), domain: "samsung.com" },
    { symbol: "NVDA", market: "US", total_score: 82.0, grade: "A", factors: 갈래(80) },
  ],
  pending: 0,
};

beforeEach(() => {
  compare.mockReset();
  compare.mockResolvedValue(다됨);
});

describe("받은 것부터", () => {
  it("점수가 오기 전에도 줄과 시세가 먼저 보이고, 점수 칸은 자리만 잡아 둔다", async () => {
    compare.mockImplementation(() => new Promise(() => {}));
    그리기();
    expect(await screen.findByText("삼성전자")).toBeTruthy();
    expect(screen.getByText("NVIDIA")).toBeTruthy();
    expect(await screen.findByText("₩71,000")).toBeTruthy();
    const 삼성줄 = screen.getByText("삼성전자").closest("tr")!;
    expect(삼성줄.querySelectorAll(".animate-pulse").length).toBeGreaterThanOrEqual(6);
    // 서버가 '계산 중' 이라고 하기 전에는 띠를 띄우지 않는다(받아 둔 점수면 곧 온다)
    expect(screen.queryByRole("status", { name: "퀀트 점수 계산 중" })).toBeNull();
  });

  it("서버가 계산 중이라고 하면 얼마나 됐는지 알리고, 다 될 때까지 다시 묻는다", async () => {
    compare.mockResolvedValueOnce({
      items: [다됨.items[0], { symbol: "NVDA", market: "US", total_score: null, grade: null, factors: [], pending: true }],
      pending: 1,
    });
    그리기();
    const 띠 = await screen.findByRole("status", { name: "퀀트 점수 계산 중" });
    expect(띠.textContent).toContain("1/2곳");
    expect(screen.getByText("61.5")).toBeTruthy();
    // 3초 뒤 다시 묻는다 — 이번엔 다 됐다
    expect(await screen.findByText("82.0", {}, { timeout: 5000 })).toBeTruthy();
    expect(compare).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("status", { name: "퀀트 점수 계산 중" })).toBeNull();
  }, 10000);

  it("탭을 옮긴 직후 앞 탭의 '계산 중' 띠를 그대로 두지 않는다", async () => {
    const 계산중 = (s: string, m: string) => ({ symbol: s, market: m, total_score: null, grade: null, factors: [], pending: true });
    compare.mockResolvedValueOnce({ items: [계산중("005930", "KR"), 계산중("NVDA", "US")], pending: 2 });
    그리기();
    await screen.findByRole("status", { name: "퀀트 점수 계산 중" });
    compare.mockImplementation(() => new Promise(() => {}));
    fireEvent.click(screen.getByRole("tab", { name: "해외" }));
    await waitFor(() => expect(screen.queryByText("삼성전자")).toBeNull());
    expect(screen.queryByRole("status", { name: "퀀트 점수 계산 중" })).toBeNull();
  });

  it("못 불러왔으면 실패로 알리고 다시 시도하게 한다", async () => {
    compare.mockRejectedValue(new Error("Network Error"));
    그리기();
    const 다시 = await screen.findByRole("button", { name: "다시 시도" });
    compare.mockResolvedValue(다됨);
    fireEvent.click(다시);
    expect(await screen.findByText("82.0")).toBeTruthy();
  });
});

describe("스크리닝과 같은 모양", () => {
  it("순위·로고·이름·코드 칸, 오늘 등락은 ▲▼ 와 금액", async () => {
    const { container } = 그리기();
    await screen.findByText("82.0");
    // 점수 높은 순 — NVIDIA 가 1등
    const 줄들 = screen.getAllByRole("row").slice(1);
    expect(within(줄들[0]).getByText("NVIDIA")).toBeTruthy();
    expect(줄들[0].textContent).toMatch(/^1/);
    expect(container.querySelector('img[src*="samsung.com"]')).toBeTruthy();
    expect(screen.getByText("NVIDIA").closest("a")!.getAttribute("href")).toBe("/stocks/US/NVDA");
    const 삼성등락 = within(screen.getByText("삼성전자").closest("tr")!).getByText(/1\.28%/);
    expect(삼성등락.textContent).toContain("▲");
    expect(삼성등락.textContent).toContain("900");
    expect(screen.getByText("종합점수 높은 순")).toBeTruthy();
  });

  it("여러 시장을 섞어 볼 때만 시장 표시를 붙인다", async () => {
    그리기();
    await screen.findByText("82.0");
    expect(within(screen.getByText("NVIDIA").closest("tr")!).getByText("US")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "해외" }));
    await waitFor(() => expect(screen.queryByText("삼성전자")).toBeNull());
    expect(within(screen.getByText("NVIDIA").closest("tr")!).queryByText("US")).toBeNull();
  });

  it("칸 제목으로 세운다 — 한 번 더 누르면 반대로", async () => {
    그리기();
    await screen.findByText("82.0");
    fireEvent.click(screen.getByRole("button", { name: "종합점수" }));
    const 첫줄 = () => screen.getAllByRole("row")[1];
    await waitFor(() => expect(within(첫줄()).queryByText("삼성전자")).toBeTruthy());
    expect(screen.getByText("종합점수 낮은 순")).toBeTruthy();
  });

  it("기준 수정은 도구 줄 단추로 판을 여닫는다", async () => {
    그리기();
    await screen.findByText("82.0");
    const 단추 = screen.getByRole("button", { name: "기준 수정" });
    expect(단추.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(단추);
    expect(screen.getByRole("button", { name: "기준 수정" }).getAttribute("aria-expanded")).toBe("true");
  });
});
