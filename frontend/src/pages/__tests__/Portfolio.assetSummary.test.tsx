/**
 * 자산유형 탭을 바꾸면 위 합계도 그 유형만 세야 한다.
 *
 * 예전에는 아래 표만 걸러지고 합계는 전체 그대로였다. '채권'을 눌렀는데
 * 표에는 채권 한 줄, 위에는 전 재산이 찍혀 있으면 둘 중 무엇을 믿어야
 * 할지 알 수 없다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const PORTFOLIOS = [{ id: 1, name: "기본", position: 0, count: 3, is_public: false }];

/* 원화로 계산이 딱 떨어지게 잡는다 (환율 1,400원 고정) */
const ITEMS = [
  { id: 1, portfolioId: 1, portfolioName: "기본", symbol: "005930", market: "KR",
    name: "삼성전자", shares: 10, avgPrice: 50_000, currency: "KRW",
    inputExchangeRate: null, purchaseDate: null, note: null, assetClass: "국내주식" },
  { id: 2, portfolioId: 1, portfolioName: "기본", symbol: "AAPL", market: "US",
    name: "애플", shares: 10, avgPrice: 100, currency: "USD",
    inputExchangeRate: 1400, purchaseDate: null, note: null, assetClass: "해외주식" },
  { id: 3, portfolioId: 1, portfolioName: "기본", symbol: "국고채", market: "KR",
    name: "국고채 3년", shares: 1, avgPrice: 1_000_000, currency: "KRW",
    inputExchangeRate: null, purchaseDate: null, note: null, assetClass: "채권" },
];

/* 현재가 = 매입가로 두면 평가금액이 매입금액과 같아 계산을 눈으로 검산할 수 있다 */
const PRICES = [
  { symbol: "005930", price: 50_000, change_rate: 0, currency: "KRW" },
  { symbol: "AAPL",   price: 100,    change_rate: 0, currency: "USD" },
  { symbol: "국고채",  price: 1_000_000, change_rate: 0, currency: "KRW" },
];

vi.mock("@/api/stocks", () => ({
  portfolioApi: {
    getPortfolios: vi.fn(() => Promise.resolve(PORTFOLIOS)),
    getItems: vi.fn(() => Promise.resolve(ITEMS)),
    addItem: vi.fn(), updateItem: vi.fn(), deleteItem: vi.fn(),
    createPortfolio: vi.fn(), renamePortfolio: vi.fn(),
    deletePortfolio: vi.fn(), reorderPortfolios: vi.fn(),
  },
  watchlistApi: { getPrices: vi.fn(() => Promise.resolve(PRICES)) },
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

/** 요약 카드에서 '…평가금액' 카드의 숫자를 읽는다 */
async function 평가금액() {
  const label = await screen.findByText(/평가금액$/);
  const card = label.closest("div.bg-bg-card") as HTMLElement;
  const 값 = within(card).getByText(/₩|원|[0-9]/, { selector: "span.font-mono" });
  return { 이름: label.textContent ?? "", 값: 값.textContent ?? "" };
}

const 숫자만 = (s: string) => Number(s.replace(/[^0-9-]/g, ""));

describe("내 자산 — 자산유형 탭과 합계", () => {
  beforeEach(() => vi.clearAllMocks());

  it("'전체'에서는 모든 자산을 더한다", async () => {
    renderPage();
    await waitFor(async () => {
      const { 이름, 값 } = await 평가금액();
      expect(이름).toContain("총");
      // 500,000 + 1,400,000 + 1,000,000 = 2,900,000
      expect(숫자만(값)).toBe(2_900_000);
    }, { timeout: 5000 });
  });

  it("'국내주식'을 고르면 국내주식만 더한다", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(async () => expect(숫자만((await 평가금액()).값)).toBe(2_900_000), { timeout: 5000 });

    await user.click(screen.getByRole("tab", { name: "국내주식" }));

    await waitFor(async () => {
      const { 이름, 값 } = await 평가금액();
      expect(이름).toContain("국내주식");   // 무엇의 합계인지 이름에도 적힌다
      expect(숫자만(값)).toBe(500_000);
    });
  });

  it("'해외주식'을 고르면 해외주식만 더한다 (환율 반영)", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(async () => expect(숫자만((await 평가금액()).값)).toBe(2_900_000), { timeout: 5000 });

    await user.click(screen.getByRole("tab", { name: "해외주식" }));

    await waitFor(async () => {
      const { 이름, 값 } = await 평가금액();
      expect(이름).toContain("해외주식");
      expect(숫자만(값)).toBe(1_400_000);   // $1,000 × 1,400
    });
  });

  it("'채권'을 고르면 채권만 더한다", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(async () => expect(숫자만((await 평가금액()).값)).toBe(2_900_000), { timeout: 5000 });

    await user.click(screen.getByRole("tab", { name: "채권" }));

    await waitFor(async () => {
      const { 이름, 값 } = await 평가금액();
      expect(이름).toContain("채권");
      expect(숫자만(값)).toBe(1_000_000);
    });
  });

  it("보유가 없는 유형을 고르면 0이 된다", async () => {
    /* 표는 비었는데 합계만 전 재산이 남아 있으면 안 된다 */
    const user = userEvent.setup();
    renderPage();
    await waitFor(async () => expect(숫자만((await 평가금액()).값)).toBe(2_900_000), { timeout: 5000 });

    await user.click(screen.getByRole("tab", { name: "금" }));

    await waitFor(async () => {
      const { 이름, 값 } = await 평가금액();
      expect(이름).toContain("금");
      expect(숫자만(값)).toBe(0);
    });
  });

  it("'전체'로 돌아오면 다시 전부 더한다", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(async () => expect(숫자만((await 평가금액()).값)).toBe(2_900_000), { timeout: 5000 });

    await user.click(screen.getByRole("tab", { name: "채권" }));
    await waitFor(async () => expect(숫자만((await 평가금액()).값)).toBe(1_000_000));

    await user.click(screen.getByRole("tab", { name: "전체" }));
    await waitFor(async () => {
      const { 이름, 값 } = await 평가금액();
      expect(이름).toContain("총");
      expect(숫자만(값)).toBe(2_900_000);
    });
  });
});
