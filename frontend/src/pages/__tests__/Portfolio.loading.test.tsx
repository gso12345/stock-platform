/**
 * 불러오는 동안에도 계좌 이름 자리가 있다 — "정보 불러올 때 계좌별 폴더별 이름은 나오게 해줘".
 *
 * 포트폴리오 목록을 받기 전에 '+ 포트폴리오' 가 떠서 계좌가 없는 줄 알았다. 받는 동안에는 회색 칩 자리를 두고,
 * 받아 보니 정말 없을 때만 '+ 포트폴리오' 를 띄운다. 한 번 받은 이름은 오래 남겨 두어(api/queryPersist) 다음부터는
 * 곧바로 이름이 보인다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

let 풀기: (v: unknown) => void = () => {};
const 목록받기 = () => new Promise((r) => { 풀기 = r; });

const PORTFOLIOS = [
  { id: 1, name: "기본 포트폴리오", position: 0, count: 1, is_public: false },
  { id: 2, name: "KB", position: 1, count: 0, is_public: false },
];

const ITEMS = [
  {
    id: 10, portfolioId: 1, portfolioName: "기본 포트폴리오",
    symbol: "005930.KS", market: "KR", name: "삼성전자",
    shares: 7, avgPrice: 70000, currency: "KRW",
    inputExchangeRate: null, purchaseDate: null, note: null, assetClass: null,
  },
];

vi.mock("@/api/stocks", () => ({
  portfolioApi: {
    getPortfolios: vi.fn(() => 목록받기()),
    getItems: vi.fn(() => Promise.resolve(ITEMS)),
    getItemsWithPrices: vi.fn(() => Promise.resolve({ items: ITEMS, prices: [] })),
    addItem: vi.fn(), updateItem: vi.fn(), deleteItem: vi.fn(),
    createPortfolio: vi.fn(), renamePortfolio: vi.fn(),
    deletePortfolio: vi.fn(), reorderPortfolios: vi.fn(),
  },
  watchlistApi: { getPrices: vi.fn(() => Promise.resolve([])) },
  stocksApi: { getDetail: vi.fn(), getPrice: vi.fn() },
  dashboardApi: {
    getExchangeRate: vi.fn(() => Promise.resolve({ value: 1400 })),
    getUSRates: vi.fn(() => Promise.resolve([])),
  },
}));

vi.mock("@/store/authStore", () => ({
  useAuthStore: () => ({ isLoggedIn: true, userId: 1, username: "tester" }),
}));

vi.mock("@/hooks/useWebSocket", () => ({
  usePricesStream: () => ({ status: "disconnected" }),
  useIndicesStream: () => ({ status: "disconnected" }),
}));

import Portfolio from "../Portfolio";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><Portfolio /></MemoryRouter>
    </QueryClientProvider>,
  );
}
const 자리표시 = () => document.querySelectorAll("[data-chip-skeleton]").length;

beforeEach(() => { try { localStorage.clear(); } catch { /* 무시 */ } });

describe("내 자산 — 계좌 이름을 받는 동안", () => {
  it("회색 칩 자리를 두고, '+ 포트폴리오' 는 띄우지 않는다", async () => {
    renderPage();
    expect(자리표시()).toBe(3);
    expect(screen.queryByRole("button", { name: /포트폴리오$/ })).toBeNull();
    expect(screen.getByText("불러오는 중", { selector: ".sr-only" })).toBeInTheDocument();
    await act(async () => { 풀기(PORTFOLIOS); });
    expect(await screen.findByRole("button", { name: /기본 포트폴리오/ })).toBeInTheDocument();
    expect(자리표시()).toBe(0);
  });

  it("받아 보니 정말 없으면 그때 '+ 포트폴리오'", async () => {
    renderPage();
    await act(async () => { 풀기([]); });
    expect(await screen.findByRole("button", { name: /포트폴리오$/ })).toBeInTheDocument();
    expect(자리표시()).toBe(0);
  });
});
