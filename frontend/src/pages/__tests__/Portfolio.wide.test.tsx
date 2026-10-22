/**
 * 내 자산을 PC 에서 보기 좋게.
 *
 * 휴대폰에 맞춘 화면이 PC 에서는 이랬다.
 *  · 요약 카드가 한 줄로 쌓여, '평가손익' 이름과 그 금액이 1,200px 떨어져
 *    양 끝에 놓였다 — 무엇의 숫자인지 눈으로 이어 읽기 어려웠다.
 *  · 탭 다섯 개가 1,200px 를 나눠 가져 한 칸이 240px 짜리 막대가 됐다.
 *  · 비중 원그래프는 180px 그대로인데 목록은 1,000px 로 늘어나, 종목
 *    이름과 그 비중이 양 끝에 떨어졌다.
 *  · '카드로 보기' 는 카드 한 장이 화면 폭을 통째로 써서 열두 장이
 *    세로로 길게(1440px 화면에서 2,900px) 늘어섰다.
 *
 * 휴대폰 모양은 그대로여야 한다 — 바꾼 것은 전부 lg·2xl 에서만 산다.
 * jsdom 은 레이아웃을 계산하지 않으므로 class·style 을 보고, 실제 모양은
 * 1024~1920·390px 화면으로 찍어 확인했다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const PORTFOLIOS = [
  { id: 1, name: "국내 연금", position: 0, count: 3, is_public: false },
  { id: 2, name: "해외 주식", position: 1, count: 2, is_public: false },
];

/* 서버는 '전체' 보기(view_all)에서 줄마다 portfolioName 을 붙여 준다 */
const 줄 = (id: number, portfolioId: number, symbol: string, market: "KR" | "US",
            name: string, shares: number, avgPrice: number) => ({
  id, portfolioId, portfolioName: PORTFOLIOS[portfolioId - 1].name, symbol, market, name,
  shares, avgPrice, currency: market === "KR" ? "KRW" : "USD",
  inputExchangeRate: market === "US" ? 1400 : null, purchaseDate: null, note: null,
  assetClass: market === "KR" ? "국내주식" : "해외주식",
});
const ITEMS = [
  줄(1, 1, "005930", "KR", "삼성전자", 10, 70_000),
  줄(2, 1, "000660", "KR", "SK하이닉스", 2, 200_000),
  줄(3, 1, "035420", "KR", "NAVER", 1, 190_000),
  줄(4, 2, "AAPL", "US", "애플", 3, 230),
  줄(5, 2, "MSFT", "US", "마이크로소프트", 1, 420),
];
/* 시험마다 보유를 바꿔 끼운다(아래 mock 이 그릴 때 읽는다) */
let 보유 = ITEMS;
const PRICES = [
  { symbol: "005930", price: 70_000, change_rate: 0, currency: "KRW" },
  { symbol: "000660", price: 200_000, change_rate: 0, currency: "KRW" },
  { symbol: "035420", price: 190_000, change_rate: 0, currency: "KRW" },
  { symbol: "AAPL", price: 230, change_rate: 0, currency: "USD" },
  { symbol: "MSFT", price: 420, change_rate: 0, currency: "USD" },
];

vi.mock("@/api/stocks", () => ({
  portfolioApi: {
    getPortfolios: vi.fn(() => Promise.resolve(PORTFOLIOS)),
    getItems: vi.fn(() => Promise.resolve(보유)),
    getItemsWithPrices: vi.fn(() => Promise.resolve({ items: 보유, prices: [] })),
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

function 띄우기() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><Portfolio /></MemoryRouter>
    </QueryClientProvider>,
  );
}

const class들 = (el: Element | null) => new Set((el?.className as string ?? "").split(/\s+/));

describe("내 자산 — PC 배치 (휴대폰 모양은 그대로)", () => {
  beforeEach(() => { vi.clearAllMocks(); 보유 = ITEMS; });

  /* 국내 70만+40만+19만 = 129만, 해외 96.6만+58.8만 = 155.4만(1,400원) — 합 284.4만 */
  const 구성읽기 = async () => {
    const 구성 = await screen.findByRole("group", { name: "구성" });
    return {
      구성,
      막대: within(구성).getByRole("img").getAttribute("aria-label"),
      위: within(within(구성).getByRole("list", { name: "비중 위 세 종목" }))
        .getAllByRole("listitem").map((li) => li.textContent),
    };
  };

  it("요약: 아주 넓은 화면(xl)에서는 네 번째 칸 — 자산유형 막대와 비중 위 세 종목", async () => {
    띄우기();
    await waitFor(async () => {
      const { 막대, 위 } = await 구성읽기();
      expect(막대).toBe("자산유형별 해외주식 55%, 국내주식 45%");
      expect(위).toEqual(["애플34.0%", "삼성전자24.6%", "마이크로소프트20.7%"]);
    });
    const { 구성 } = await 구성읽기();
    // 휴대폰·좁은 PC 에서는 숨기고 xl 에서만 — 카드도 그때만 네 칸
    expect(class들(구성).has("hidden")).toBe(true);
    expect(class들(구성).has("xl:flex")).toBe(true);
    expect(class들(구성.parentElement)
      .has("xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1.25fr)]")).toBe(true);
    expect(within(구성).getByText("구성")).toBeTruthy();
  });

  it("구성: 같은 종목을 두 포트폴리오에 담았으면 한 줄로 합친다(비중 탭처럼)", async () => {
    보유 = [...ITEMS, 줄(6, 2, "005930", "KR", "삼성전자", 5, 70_000)];
    띄우기();
    // 삼성전자 70만+35만 = 105만 / 합 319.4만 — 애플(96.6만)보다 위
    await waitFor(async () => expect((await 구성읽기()).위).toEqual(["삼성전자32.9%", "애플30.2%", "마이크로소프트18.4%"]));
  });

  it("구성: 자산유형 탭을 골라도 전체로 세고, 그렇다고 적는다", async () => {
    const user = userEvent.setup();
    띄우기();
    const { 구성 } = await 구성읽기();
    const 거르기 = await screen.findByRole("tablist", { name: "자산유형 필터" });
    await user.click(within(거르기).getByRole("tab", { name: "국내주식" }));
    await waitFor(() => expect(within(구성).getByText("전체 구성")).toBeTruthy());
    expect((await 구성읽기()).막대).toBe("자산유형별 해외주식 55%, 국내주식 45%");
    // 표를 다시 세워도(보유 목록이 새로 만들어져도) 전체로 센다
    await user.click(screen.getByRole("button", { name: "수익률 기준 정렬" }));
    await waitFor(async () => expect((await 구성읽기()).막대).toBe("자산유형별 해외주식 55%, 국내주식 45%"));
  });

  it("구성: 값이 0 인 보유는 빼고, 모두 0 이면 칸도 없다 — 카드는 세 칸 그대로", async () => {
    보유 = [...ITEMS, { ...줄(6, 1, "CASH", "KR", "예수금", 0, 0), assetClass: "현금" }];
    const { unmount } = 띄우기();
    await waitFor(async () => expect((await 구성읽기()).막대).toBe("자산유형별 해외주식 55%, 국내주식 45%"));
    unmount();
    보유 = [줄(1, 1, "005930", "KR", "삼성전자", 0, 70_000)];
    띄우기();
    await screen.findByText("평가손익");
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByRole("group", { name: "구성" })).toBeNull();
  });

  it("요약: 휴대폰에서는 위아래로 쌓고, PC 에서는 평가금액 | 손익 | 참고값 세 칸", async () => {
    띄우기();
    const 손익 = await screen.findByText("평가손익");
    const 카드 = 손익.closest("[class*='lg:grid-cols-']");
    const c = class들(카드);
    expect(c.has("flex")).toBe(true);
    expect(c.has("flex-col")).toBe(true);            // 휴대폰 — 예전 그대로
    expect(c.has("lg:grid")).toBe(true);
    expect(c.has("lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.9fr)]")).toBe(true);
    // 가운데 칸은 휴대폰에서 위아래 선, PC 에서는 좌우 선으로 나뉜다
    const 가운데 = class들(손익.closest("[class*='border-y']"));
    expect(가운데.has("border-y")).toBe(true);
    expect(가운데.has("lg:border-y-0")).toBe(true);
    expect(가운데.has("lg:border-x")).toBe(true);
  });

  it("탭: PC 에서는 버튼을 늘리지 않는다 (휴대폰에서는 예전처럼 꽉 채운다)", async () => {
    띄우기();
    const 탭줄 = await screen.findByRole("tablist", { name: "내 자산 화면" });
    const c = class들(탭줄);
    expect(c.has("lg:w-fit")).toBe(true);
    expect(c.has("lg:[&>button]:flex-none")).toBe(true);
    // 버튼 자체의 class 는 그대로 — 휴대폰에서는 늘어난다
    expect(탭줄.querySelector("button")!.className).toContain("flex-1");
  });

  it("비중: PC 에서는 목록을 두 줄로 — 왼쪽 줄을 위에서 아래로 먼저 채운다", async () => {
    const user = userEvent.setup();
    띄우기();
    await user.click(await screen.findByRole("tab", { name: "비중" }));
    const 이름 = await screen.findByText("MSFT");   // 해외 종목은 코드로 적힌다
    const 목록 = 이름.closest("[class*='lg:grid-flow-col']") as HTMLElement;
    expect(목록).not.toBeNull();
    // 5개 → 세 줄(3 + 2). 줄 수를 정해 줘야 grid-flow-col 이 왼쪽 줄부터 채운다
    expect(목록.style.gridTemplateRows).toBe("repeat(3, auto)");
    const c = class들(목록);
    expect(c.has("flex")).toBe(true);
    expect(c.has("flex-col")).toBe(true);            // 휴대폰 — 예전처럼 한 줄
    expect(c.has("lg:grid-cols-2")).toBe(true);
    expect(목록.children.length).toBe(5);
  });

  it("비중: 원그래프는 넓은 화면에서만 크게 (휴대폰 180px 그대로)", async () => {
    const user = userEvent.setup();
    const 그래프높이 = async () => {
      띄우기();
      await user.click(await screen.findByRole("tab", { name: "비중" }));
      await screen.findByText("MSFT");
      let 높이 = "";
      await waitFor(() => {
        const 틀 = document.querySelector(
          "[aria-label='그래프 불러오는 중'], .recharts-responsive-container") as HTMLElement | null;
        expect(틀).not.toBeNull();
        높이 = 틀!.style.height;
      });
      return 높이;
    };

    expect(await 그래프높이()).toBe("180px");
  });

  describe("넓은 화면", () => {
    beforeEach(() => {
      vi.stubGlobal("matchMedia", (q: string) => ({
        matches: q === "(min-width: 1024px)", media: q,
        addEventListener() {}, removeEventListener() {},
      }));
    });
    afterEach(() => vi.unstubAllGlobals());

    it("원그래프가 250px 로 커진다", async () => {
      const user = userEvent.setup();
      띄우기();
      await user.click(await screen.findByRole("tab", { name: "비중" }));
      await screen.findByText("MSFT");
      await waitFor(() => {
        const 틀 = document.querySelector(
          "[aria-label='그래프 불러오는 중'], .recharts-responsive-container") as HTMLElement | null;
        expect(틀?.style.height).toBe("250px");
      });
    });
  });

  it("카드로 보기: PC 에서는 두 줄(아주 넓으면 세 줄)로 나란히", async () => {
    const user = userEvent.setup();
    띄우기();
    /* 요약 카드의 구성 칸(비중 위 세 종목)에도 이름이 있다 — 보유 목록 쪽 것을 본다 */
    const 목록쪽 = async () => (await screen.findAllByText("마이크로소프트")).find((el) => !el.closest("[aria-label='구성']"))!;
    await 목록쪽();
    await user.click(screen.getByTitle("카드로 보기"));
    const 카드 = await 목록쪽();
    const 목록 = 카드.closest("[class*='lg:grid-cols-2']");
    const c = class들(목록);
    expect(c.has("flex")).toBe(true);
    expect(c.has("flex-col")).toBe(true);            // 휴대폰 — 예전처럼 한 줄
    expect(c.has("lg:grid")).toBe(true);
    expect(c.has("2xl:grid-cols-3")).toBe(true);
  });
});
