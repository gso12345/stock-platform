import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

/**
 * "전체" 탭에서는 종목 추가 버튼이 보이면 안 된다는 규칙을 고정한다.
 *
 * 이 규칙은 한 번 뒤집힌 적이 있다. 처음에는 전체 탭에도 버튼이 없어서 새로 가입한
 * 사람이 첫 종목을 넣을 방법이 아예 없었고, 그래서 항상 보이게 바꿨다가,
 * 담을 포트폴리오가 정해지지 않는다는 이유로 다시 숨기게 됐다.
 * 그 과정에서 세 군데(헤더·빈 화면·목록 카드)의 기준이 서로 어긋난 적이 있어
 * 테스트로 못 박아 둔다.
 */

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
    getPortfolios: vi.fn(() => Promise.resolve(PORTFOLIOS)),
    getItems: vi.fn(() => Promise.resolve(ITEMS)),
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

describe("내 자산 — 종목 추가 버튼 노출 규칙", () => {
  beforeEach(() => vi.clearAllMocks());

  it("기본으로 열리는 '전체' 탭에서는 종목 추가 버튼이 없다", async () => {
    renderPage();
    await screen.findByText("기본 포트폴리오");

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /종목 추가/ })).not.toBeInTheDocument();
    });
  });

  it("'전체' 탭에서도 포트폴리오 관리 버튼은 남는다", async () => {
    renderPage();
    expect(await screen.findByRole("button", { name: /포트폴리오 관리/ })).toBeInTheDocument();
  });

  it("개별 포트폴리오를 고르면 종목 추가 버튼이 나타난다", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByText("기본 포트폴리오"));

    expect(await screen.findByRole("button", { name: /종목 추가/ })).toBeInTheDocument();
  });
});
