/**
 * 내 자산 첫 화면 — "앱느낌이 너무 안 나는 것 같아"
 *
 * 휴대폰 폭으로 띄워 보니 종목이 첫 화면에 하나도 없었다. 상단바 → 탭 →
 * 미리보기 배너 → 제목 → 개수 → 버튼 세 개 → 요약카드 넷(2×2) → 도넛
 * 차트(180px) → 필터 두 줄. 그러고 나서야 종목 하나가 나왔다.
 *
 * 여기서 못 박는 것 —
 *   1) 요약은 카드 하나다. 넷을 같은 크기로 늘어놓으면 무엇이 중요한지
 *      알 수 없고 화면만 먹는다.
 *   2) 구성 차트는 기본으로 접힌다. 여기 들어와서 먼저 보고 싶은 건
 *      원그래프가 아니라 내가 뭘 들고 있나다.
 *   3) 로딩 뼈대가 실제 모양과 같다. 다르면 값이 도착할 때 화면이 튄다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

vi.mock("react-router-dom", async () => {
  const 실제 = await vi.importActual<any>("react-router-dom");
  return { ...실제, useNavigate: () => vi.fn() };
});

vi.mock("@/store/authStore", () => ({
  useAuthStore: (sel?: any) => {
    const s = { isLoggedIn: false, user: null };
    return sel ? sel(s) : s;
  },
}));

/* 비로그인 미리보기 — 예시 종목이 실제 시세로 채워진다 */
vi.mock("@/api/stocks", async (원본가져오기) => ({
  ...(await 원본가져오기<any>()),
  portfolioApi: {
    getPortfolios: vi.fn(() => Promise.resolve([])),
    getItems: vi.fn(() => Promise.resolve([])),
    addItem: vi.fn(), updateItem: vi.fn(), deleteItem: vi.fn(),
    createPortfolio: vi.fn(), renamePortfolio: vi.fn(),
    deletePortfolio: vi.fn(), reorderPortfolios: vi.fn(),
  },
  watchlistApi: {
    getPrices: vi.fn((symbols: string[]) =>
      Promise.resolve(symbols.map((s) => ({
        symbol: s, price: 100, change: 1, change_rate: 0.5,
        currency: /^\d/.test(s) ? "KRW" : "USD",
      })))),
  },
  stocksApi: { getDetail: vi.fn(), getPrice: vi.fn() },
  dashboardApi: { getExchangeRate: vi.fn(() => Promise.resolve({ value: 1400 })) },
}));

import Portfolio from "../Portfolio";

function 그리기() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><Portfolio /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => { try { localStorage.clear(); } catch { /* 무시 */ } });

describe("내 자산 첫 화면", () => {
  it("요약은 카드 하나로 모은다", async () => {
    /* 예전에는 총평가금액·총매입금액·평가손익·수익률이 같은 크기 카드
       넷으로 2×2 였다. 휴대폰에서 화면 3분의 1을 쓰면서도 무엇이 제일
       중요한지 알 수 없었다. */
    그리기();
    await screen.findByRole("button", { name: "구성 펼치기" }, { timeout: 4000 });
    // 평가금액이 크게 하나, 나머지는 작게 — '총 매입금액' 같은 옛 이름은 없다
    expect(screen.queryByText("총 매입금액")).toBeNull();
    expect(screen.getByText("매입금액")).toBeInTheDocument();
    expect(screen.getByText("적용 환율")).toBeInTheDocument();
  });

  it("구성 차트는 접힌 채로 시작한다", async () => {
    /* 늘 펼쳐져 있으면 원그래프 하나에 화면 한 장을 쓰고, 정작 보유
       종목은 스크롤해야 나온다 */
    그리기();
    expect(await screen.findByRole("button", { name: "구성 펼치기" }, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByText("종목별")).toBeNull();
  });

  it("눌러서 펼칠 수 있다", async () => {
    const u = userEvent.setup();
    그리기();
    /* 글자로 찾으면 로딩 자리의 같은 글자를 먼저 잡는다. 실제 버튼이
       나올 때까지 기다린다 */
    await u.click(await screen.findByRole("button", { name: "구성 펼치기" }, { timeout: 4000 }));
    expect(await screen.findByText("종목별")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "구성 펼치기" })).toBeNull();
  });

  it("펼친 선택을 기억한다", async () => {
    /* 매번 다시 접히면 그것대로 불편하다 */
    const u = userEvent.setup();
    const { unmount } = 그리기();
    /* 글자로 찾으면 로딩 자리의 같은 글자를 먼저 잡는다. 실제 버튼이
       나올 때까지 기다린다 */
    await u.click(await screen.findByRole("button", { name: "구성 펼치기" }, { timeout: 4000 }));
    await screen.findByText("종목별");
    unmount();

    그리기();
    expect(await screen.findByText("종목별", {}, { timeout: 4000 })).toBeInTheDocument();
  });

  it("제목과 버튼이 한 줄에 있다", async () => {
    /* 두 줄이면 상단바·탭·배너까지 더해 다섯 줄을 지나야 요약이 나온다 */
    그리기();
    const 제목 = await screen.findByRole("heading", { name: "내 자산" });
    const 줄 = 제목.closest("div")?.parentElement;
    // 같은 상자 안에 있는지만 보면 세로로 쌓아도 통과한다. 가로줄인지까지 본다
    expect(줄?.textContent).toMatch(/종목 추가/);
    expect(줄?.className).toMatch(/items-center/);
    expect(줄?.className).not.toMatch(/flex-col/);
  });
});
