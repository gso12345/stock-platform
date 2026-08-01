/**
 * 로그인 전 '미리보기'에서도 화면이 무엇을 하는 곳인지 알 수 있어야 한다.
 *
 * 예전에는 예시 보유종목이 주식뿐이라 자산유형 탭 일곱 개 중 넷(채권·금·
 * 커버드콜·현금)이 눌러도 빈 화면이었고, 표 머리글을 눌러도 정렬이 되지
 * 않아 정렬되는 화면인지조차 알 수 없었다. 관리 버튼도 통째로 숨겨져 있어
 * 로그인하면 무엇이 생기는지 보이지 않았다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const navigate = vi.fn();

vi.mock("@/api/stocks", () => ({
  portfolioApi: {
    getPortfolios: vi.fn(() => Promise.resolve([])),
    getItems: vi.fn(() => Promise.resolve([])),
    addItem: vi.fn(), updateItem: vi.fn(), deleteItem: vi.fn(),
    createPortfolio: vi.fn(), renamePortfolio: vi.fn(),
    deletePortfolio: vi.fn(), reorderPortfolios: vi.fn(),
  },
  /* 예시 종목도 실제 시세로 보여주는 규칙이라, 시세가 와야 숫자가 뜬다 */
  watchlistApi: {
    getPrices: vi.fn((symbols: string[]) =>
      Promise.resolve(symbols.map((s) => ({
        symbol: s, price: 100, change_rate: 0.5,
        currency: /^\d/.test(s) ? "KRW" : "USD",
      })))),
  },
  stocksApi: { getDetail: vi.fn(), getPrice: vi.fn() },
  dashboardApi: {
    getExchangeRate: vi.fn(() => Promise.resolve({ value: 1400 })),
    getUSRates: vi.fn(() => Promise.resolve([])),
  },
}));

vi.mock("@/store/authStore", () => ({
  useAuthStore: () => ({ isLoggedIn: false, userId: null, username: null }),
}));

vi.mock("@/hooks/useWebSocket", () => ({
  usePricesStream: () => ({ status: "disconnected" }),
  useIndicesStream: () => ({ status: "disconnected" }),
}));

vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
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

/** 요약 카드에서 '…평가금액' 카드의 이름과 값 */
async function 평가금액() {
  const label = await screen.findByText(/평가금액$/);
  const card = label.closest("div.bg-bg-card") as HTMLElement;
  return {
    이름: label.textContent ?? "",
    값: Number((within(card).getByText(/[0-9]/, { selector: "span.font-mono" }).textContent ?? "")
      .replace(/[^0-9-]/g, "")),
  };
}

describe("내 자산 미리보기 (비로그인)", () => {
  beforeEach(() => { vi.clearAllMocks(); navigate.mockClear(); });

  it("자산유형 탭이 전부 내용을 갖는다", async () => {
    /* 예시에 주식만 있으면 '금'을 눌러도 빈 화면이라, 이 기능이 뭘 하는지
       알 수 없다. 일곱 유형 모두 최소 한 종목씩 있어야 한다. */
    const user = userEvent.setup();
    renderPage();
    await waitFor(async () => expect((await 평가금액()).값).toBeGreaterThan(0), { timeout: 5000 });

    for (const 유형 of ["국내주식", "해외주식", "채권", "금", "커버드콜", "현금"]) {
      await user.click(screen.getByRole("tab", { name: 유형 }));
      await waitFor(async () => {
        const { 이름, 값 } = await 평가금액();
        expect(이름).toContain(유형);
        expect(값).toBeGreaterThan(0);   // 빈 탭이 아니다
      });
    }
  });

  it("GLD 를 금으로 분류해 보여준다", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(async () => expect((await 평가금액()).값).toBeGreaterThan(0), { timeout: 5000 });

    await user.click(screen.getByRole("tab", { name: "금" }));
    await waitFor(() => {
      const 본문 = document.body.textContent ?? "";
      expect(본문).toContain("GLD");
      expect(본문).toContain("골드");
      // 금 탭이므로 다른 유형은 표에서 빠져야 한다
      expect(document.querySelectorAll("tbody tr").length).toBe(1);
    });
  });

  it("표 머리글을 눌러 정렬할 수 있다", async () => {
    /* 예전에는 비로그인이면 onClick 이 빈 함수라 눌러도 아무 일이 없었다 */
    const user = userEvent.setup();
    renderPage();
    await waitFor(async () => expect((await 평가금액()).값).toBeGreaterThan(0), { timeout: 5000 });

    const 첫종목 = () => document.querySelector("tbody tr")?.textContent ?? "";
    const 처음 = 첫종목();
    await user.click(screen.getByRole("button", { name: /평가금액.*정렬/ }));
    await waitFor(() => expect(첫종목()).not.toBe(처음));
  });

  it("정렬 상태를 스크린리더가 읽을 수 있다", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(async () => expect((await 평가금액()).값).toBeGreaterThan(0), { timeout: 5000 });

    const th = () => screen.getByRole("button", { name: /수익률.*정렬/ }).closest("th")!;
    expect(th().getAttribute("aria-sort")).toBe("none");
    await user.click(screen.getByRole("button", { name: /수익률.*정렬/ }));
    await waitFor(() => expect(th().getAttribute("aria-sort")).not.toBe("none"));
  });

  it("관리 버튼을 숨기지 않고, 누르면 로그인으로 안내한다", async () => {
    /* 버튼이 아예 없으면 로그인하면 무엇이 생기는지 알 수 없다 */
    const user = userEvent.setup();
    renderPage();
    await waitFor(async () => expect((await 평가금액()).값).toBeGreaterThan(0), { timeout: 5000 });

    await user.click(screen.getByRole("button", { name: /종목 추가/ }));
    expect(navigate).toHaveBeenCalledWith("/login");

    navigate.mockClear();
    await user.click(screen.getByRole("button", { name: /포트폴리오 관리/ }));
    expect(navigate).toHaveBeenCalledWith("/login");
  });
});
