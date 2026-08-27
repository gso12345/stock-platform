/**
 * 내 자산을 탭으로 가른 것.
 *
 * 예전에는 전부 세로로 쌓여 있었다 — 요약 → 자산 흐름 그래프 → 배당
 * 달력 → 구성 차트 → 자산유형 필터 → 그제서야 보유 종목. 휴대폰에서
 * 내 종목을 보려면 화면을 네댓 번 넘겨야 했다. 정작 이 화면을 여는
 * 가장 흔한 이유가 그 목록인데.
 *
 * ── 눈에 안 보이는 값이 더 컸다 ──
 *
 * 자산 흐름과 배당 달력이 화면이 뜨자마자 /portfolio/history 와
 * /portfolio/dividends 를 불렀다. 즉 **보유 종목이 보이기 전에 왕복
 * 두 개를 더 기다리는** 구조였다 — Render 무료 등급은 0.15 CPU 다.
 *
 * 여기서 못 박는 것은 그 이득이 조용히 사라지지 않는가다. 누군가
 * "어차피 다 쓰는 건데" 하고 탭 밖으로 한 줄만 꺼내 놓으면 첫 화면이
 * 도로 느려지는데, 화면만 봐서는 티가 안 난다.
 *
 * 배당 배지(투자배당률·배당월)도 같이 본다. 그건 목록이 뜨는 조건이
 * 아니라 '있으면 좋은 것' 이라, 시세가 다 온 뒤에 조용히 따라붙어야 한다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const PORTFOLIOS = [{ id: 1, name: "기본", position: 0, count: 3, is_public: false }];

/* 환율 1,400원 고정 — 손으로 검산할 수 있게 */
const ITEMS = [
  { id: 1, portfolioId: 1, portfolioName: "기본", symbol: "005930", market: "KR",
    name: "삼성전자", shares: 100, avgPrice: 50_000, currency: "KRW",
    inputExchangeRate: null, purchaseDate: null, note: null, assetClass: "국내주식" },
  { id: 2, portfolioId: 1, portfolioName: "기본", symbol: "SCHD", market: "ETF",
    name: "SCHD", shares: 100, avgPrice: 20, currency: "USD",
    inputExchangeRate: 1400, purchaseDate: null, note: null, assetClass: "해외주식" },
  { id: 3, portfolioId: 1, portfolioName: "기본", symbol: "QYLD", market: "ETF",
    name: "QYLD", shares: 50, avgPrice: 10, currency: "USD",
    inputExchangeRate: 1400, purchaseDate: null, note: null, assetClass: "커버드콜" },
];

const PRICES = [
  { symbol: "005930", price: 50_000, change_rate: 0, currency: "KRW" },
  { symbol: "SCHD",   price: 20,     change_rate: 0, currency: "USD" },
  { symbol: "QYLD",   price: 10,     change_rate: 0, currency: "USD" },
];

/* 배당 —
   삼성전자  주당 연 2,000원, 분기(2·5·8·11월)  → 원화라 환율을 안 곱한다
   SCHD      주당 연 $1,      분기(3·6·9·12월)  → 환율을 곱한다
   QYLD      주당 연 $1.2,    월배당(1~12월)    → months 가 열둘이라 안 적는다 */
const DIVIDENDS = {
  items: [
    { symbol: "005930", market: "KR", name: "삼성전자", date: "2026-11-30", confirmed: false,
      ex_date: null, pay_date: null, cycle: "분기", months: [2, 5, 8, 11], per_month: 1,
      currency: "KRW", last_date: "2026-08-31", last_amount: 500, per_year: 2000,
      shares: 100, expected: 50_000, expected_year: 200_000, recent: [] },
    { symbol: "SCHD", market: "ETF", name: "SCHD", date: "2026-09-25", confirmed: false,
      ex_date: null, pay_date: null, cycle: "분기", months: [3, 6, 9, 12], per_month: 1,
      currency: "USD", last_date: "2026-06-25", last_amount: 0.25, per_year: 1,
      shares: 100, expected: 25, expected_year: 100, recent: [] },
    { symbol: "QYLD", market: "ETF", name: "QYLD", date: "2026-09-23", confirmed: false,
      ex_date: null, pay_date: null, cycle: "월", months: [1,2,3,4,5,6,7,8,9,10,11,12],
      per_month: 1, currency: "USD", last_date: "2026-08-23", last_amount: 0.1, per_year: 1.2,
      shares: 50, expected: 5, expected_year: 60, recent: [] },
  ],
  pending: 0,
};

const getHistory      = vi.fn(() => Promise.resolve({ points: [], days: 90 }));
const getDividends    = vi.fn(() => Promise.resolve(DIVIDENDS));
const getHoldingNews  = vi.fn(() => Promise.resolve({ items: [], covered: [], missing: [] }));

/* 시세 응답을 검사가 붙잡고 있다가 원할 때 놓아 준다.
   '배당은 시세가 온 뒤에 부른다' 는 순서를 보려면, 시세가 아직 안 온
   순간이 실제로 존재해야 한다 — 곧장 resolve 하는 mock 으로는 그
   순간이 없어서 순서를 바꿔도 검사가 안 깨진다(뮤테이션으로 확인했다). */
let 시세놓기: (() => void) | null = null;
const getPrices = vi.fn(() => {
  if (!시세놓기) return Promise.resolve(PRICES);
  return new Promise<typeof PRICES>((resolve) => {
    시세놓기 = () => resolve(PRICES);
  });
});

vi.mock("@/api/stocks", () => ({
  portfolioApi: {
    getPortfolios: vi.fn(() => Promise.resolve(PORTFOLIOS)),
    getItems: vi.fn(() => Promise.resolve(ITEMS)),
    getHistory:     (...a: unknown[]) => getHistory(...(a as [])),
    getDividends:   (...a: unknown[]) => getDividends(...(a as [])),
    getHoldingNews: (...a: unknown[]) => getHoldingNews(...(a as [])),
    addItem: vi.fn(), updateItem: vi.fn(), deleteItem: vi.fn(),
    createPortfolio: vi.fn(), renamePortfolio: vi.fn(),
    deletePortfolio: vi.fn(), reorderPortfolios: vi.fn(),
  },
  watchlistApi: { getPrices: (...a: unknown[]) => getPrices(...(a as [])) },
  stocksApi: { getDetail: vi.fn(), getPrice: vi.fn() },
  dashboardApi: {
    getExchangeRate: vi.fn(() => Promise.resolve({ value: 1400 })),
    getUSRates: vi.fn(() => Promise.resolve([])),
    getIndexOHLCV: vi.fn(() => Promise.resolve([])),
  },
}));

let 로그인했나 = true;
vi.mock("@/store/authStore", () => ({
  useAuthStore: () => ({ isLoggedIn: 로그인했나, userId: 1, username: "tester" }),
}));

vi.mock("@/hooks/useWebSocket", () => ({
  usePricesStream: () => ({ status: "disconnected" }),
  useIndicesStream: () => ({ status: "disconnected" }),
}));

import Portfolio from "../Portfolio";
import { 투자배당률, type 배당몫 } from "@/components/portfolio/HoldingRow";
import type { EnrichedItem } from "@/types/portfolio";

function 그리기() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><Portfolio /></MemoryRouter>
    </QueryClientProvider>,
  );
}

const 탭 = (이름: string) => screen.getByRole("tab", { name: 이름 });
/** 값이 다 도착했다는 신호 — 요약이 그려지면 시세까지 온 것이다 */
const 준비 = () => screen.findByText("평가손익", {}, { timeout: 8000 });

beforeEach(() => {
  로그인했나 = true;
  시세놓기 = null;          // 기본은 곧장 응답 — 붙잡을 검사에서만 켠다
  vi.clearAllMocks();
  try { localStorage.clear(); } catch { /* 무시 */ }
});

describe("탭 구성", () => {
  it("로그인하면 다섯 탭이 서고 '자산' 이 기본이다", async () => {
    그리기();
    await 준비();
    for (const 이름 of ["자산", "추이", "배당", "비중", "뉴스"]) {
      expect(탭(이름), `${이름} 탭이 없다`).toBeInTheDocument();
    }
    expect(탭("자산")).toHaveAttribute("aria-selected", "true");
    // 기본 탭에 보유 종목이 있다 — 이 화면을 여는 가장 흔한 이유다
    expect(screen.getByText("보유 종목")).toBeInTheDocument();
    expect(screen.getAllByText("삼성전자").length).toBeGreaterThan(0);
  });

  it("비로그인 미리보기에는 추이·배당·뉴스 탭이 아예 없다", async () => {
    /* 기록도 배당도 '내 것' 이 있어야 나온다. 열어 봐야 늘 "아직
       없어요" 만 보이는 탭을 세 개 세워 두면, 이 화면이 무엇을 할 수
       있는지가 오히려 흐려진다. */
    로그인했나 = false;
    그리기();
    await screen.findByRole("tab", { name: "자산" }, { timeout: 8000 });

    expect(screen.queryByRole("tab", { name: "추이" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "배당" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "뉴스" })).toBeNull();
    // 미리보기로도 뜻이 있는 둘은 남는다
    expect(screen.getByRole("tab", { name: "비중" })).toBeInTheDocument();
  });
});

describe("안 연 탭은 서버에 안 물어본다", () => {
  it("첫 화면에서 자산 흐름·뉴스를 부르지 않는다", async () => {
    /* 이 개편의 핵심 이득이다. 예전에는 이 둘이 마운트되자마자 나가서,
       보유 종목이 보이기 전에 왕복 두 개를 더 기다려야 했다. */
    그리기();
    await 준비();
    // 목록이 다 그려지고 시세까지 온 뒤에도 여전히 안 불렸어야 한다
    await waitFor(() => expect(screen.getAllByText("SCHD").length).toBeGreaterThan(0));

    expect(getHistory).not.toHaveBeenCalled();
    expect(getHoldingNews).not.toHaveBeenCalled();
  });

  it("'추이' 를 눌러야 그때 자산 흐름을 부른다", async () => {
    그리기();
    await 준비();
    expect(getHistory).not.toHaveBeenCalled();

    await userEvent.click(탭("추이"));
    await waitFor(() => expect(getHistory).toHaveBeenCalled());
  });

  it("'뉴스' 를 눌러야 그때 보유 뉴스를 부른다", async () => {
    그리기();
    await 준비();
    expect(getHoldingNews).not.toHaveBeenCalled();

    await userEvent.click(탭("뉴스"));
    await waitFor(() => expect(getHoldingNews).toHaveBeenCalled());
  });

  it("배당은 예외다 — 보유 줄 배지 때문에 시세가 온 뒤 따로 부른다", async () => {
    /* 배당만 다르게 다루는 데는 이유가 있다. 배지(투자배당률·배당월)가
       '자산' 탭 목록에 붙으므로 배당 탭을 안 열어도 값이 필요하다.
       대신 시세와 같이 나가지 않게 미뤄서, 목록이 뜨는 길을 막지 않는다.
       배당 탭과 같은 열쇠를 써서 두 번 받지도 않는다. */
    그리기();
    await 준비();
    await waitFor(() => expect(getDividends).toHaveBeenCalled());
    const 부른횟수 = getDividends.mock.calls.length;

    await userEvent.click(탭("배당"));
    await screen.findByText("배당 달력", {}, { timeout: 8000 });
    // 탭을 열어도 다시 안 받는다 — 같은 열쇠를 쓴다
    expect(getDividends.mock.calls.length).toBe(부른횟수);
  });

  it("배당은 시세가 다 온 뒤에 나간다 — 목록이 뜨는 길을 막지 않는다", async () => {
    /* 배지는 '있으면 좋은 것' 이지 목록이 뜨는 조건이 아니다.
       시세와 같이 나가면 0.15 CPU 서버에서 둘이 서로 밀어낸다. */
    시세놓기 = () => {};                     // 붙잡기 켬(실제 함수는 mock 이 다시 넣는다)
    그리기();

    // 시세가 아직 안 왔다 — 이 동안에는 배당을 부르면 안 된다
    await screen.findByText("보유 종목", {}, { timeout: 8000 });
    await new Promise((r) => setTimeout(r, 50));
    expect(getDividends).not.toHaveBeenCalled();

    시세놓기!();                              // 이제 시세를 놓아 준다
    await waitFor(() => expect(getDividends).toHaveBeenCalled(), { timeout: 8000 });
  }, 20_000);

  it("'비중' 을 눌러야 구성 차트가 나온다", async () => {
    /* 여기에 recharts(gzip 132KB)가 딸려 온다. 기본 탭을 여는 사람은
       그림을 아예 안 보므로 미리 받게 할 이유가 없다. */
    그리기();
    await 준비();
    expect(screen.queryByText("종목별")).toBeNull();

    await userEvent.click(탭("비중"));
    expect(await screen.findByText("종목별", {}, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.getByText("자산유형별")).toBeInTheDocument();
  });
});

describe("투자배당률", () => {
  /** 계산에 쓰는 네 값만 채운 보유 한 줄 */
  const 보유 = (덮: Partial<EnrichedItem>): EnrichedItem => ({
    id: 1, symbol: "X", market: "KR", name: "X", shares: 100, avgPrice: 0,
    currency: "KRW", currentPriceNative: 0, currentValueKRW: 0, costKRW: 0,
    pnlKRW: 0, pnlRate: 0, weight: 0,
    isForexItem: false, nativeAvgPrice: 0, nativeValue: 0, nativePnl: 0,
    ...덮,
  });
  const 몫 = (덮: Partial<배당몫>): 배당몫 => ({ months: [], perYear: 0, currency: "KRW", ...덮 });

  it("원화 종목에는 환율을 안 곱한다", () => {
    /* per_year 가 이미 원화다. 여기에 환율을 곱하면 1,400배가 된다 */
    const 값 = 투자배당률(몫({ perYear: 2000, currency: "KRW" }),
                          보유({ shares: 100, costKRW: 5_000_000 }), 1400);
    // 2,000 × 100 = 200,000 / 5,000,000 = 4%
    expect(값).not.toBeNull();
    expect(값!).toBeCloseTo(4, 6);
  });

  it("달러 종목에는 환율을 곱한다", () => {
    const 값 = 투자배당률(몫({ perYear: 1, currency: "USD" }),
                          보유({ shares: 100, costKRW: 2_800_000 }), 1400);
    // $1 × 100 × 1,400 = 140,000 / 2,800,000 = 5%
    expect(값).not.toBeNull();
    expect(값!).toBeCloseTo(5, 6);
  });

  it("배당을 모르면 null 이다 — 0% 라고 적으면 '배당을 안 준다' 가 된다", () => {
    expect(투자배당률(undefined, 보유({ costKRW: 1_000_000 }), 1400)).toBeNull();
    expect(투자배당률(몫({ perYear: 0 }), 보유({ costKRW: 1_000_000 }), 1400)).toBeNull();
  });

  it("매입금액이나 수량이 0 이면 null 이다 — 0 으로 나누면 Infinity 가 찍힌다", () => {
    expect(투자배당률(몫({ perYear: 2000 }), 보유({ costKRW: 0 }), 1400)).toBeNull();
    expect(투자배당률(몫({ perYear: 2000 }), 보유({ shares: 0, costKRW: 1_000_000 }), 1400)).toBeNull();
  });
});

describe("보유 줄에 붙는 배당 배지", () => {
  /** 그 종목 줄 하나로 좁힌다 — 화면 전체를 뒤지면 다른 줄 숫자가 걸린다.
   *
   *  카드 보기와 표 보기 둘 다 받는다. jsdom 은 window.innerWidth 가
   *  1024 라 표 보기로 열리는데, 실제 휴대폰에서는 카드 보기다 —
   *  배지는 두 곳 모두에 붙어야 한다. */
  async function 종목줄(이름: string) {
    const 제목 = (await screen.findAllByText(이름, {}, { timeout: 12_000 }))[0];
    const 줄 = 제목.closest("tr, .holding-card-lite");
    expect(줄, `${이름} 줄을 못 찾았다`).not.toBeNull();
    return 줄 as HTMLElement;
  }

  it("투자배당률이 그 줄에 붙는다", async () => {
    그리기();
    await 준비();
    const 줄 = await 종목줄("삼성전자");
    // 2,000 × 100 = 200,000 / (50,000 × 100 = 5,000,000) = 4.00%
    await waitFor(() => expect(within(줄!).getByText(/배당 4\.00%/)).toBeInTheDocument(),
                  { timeout: 12_000 });
  }, 20_000);

  it("달러 종목은 환율을 반영한 배당률이 나온다", async () => {
    그리기();
    await 준비();
    const 줄 = await 종목줄("SCHD");
    // $1 × 100 × 1,400 = 140,000 / ($20 × 100 × 1,400 = 2,800,000) = 5.00%
    await waitFor(() => expect(within(줄!).getByText(/배당 5\.00%/)).toBeInTheDocument(),
                  { timeout: 12_000 });
  }, 20_000);

  it("분기배당은 배당월을 적는다", async () => {
    그리기();
    await 준비();
    const 줄 = await 종목줄("삼성전자");
    await waitFor(() => expect(within(줄!).getByText("2·5·8·11월")).toBeInTheDocument(),
                  { timeout: 12_000 });
  }, 20_000);

  it("카드 보기에도 같은 배지가 붙는다", async () => {
    /* jsdom 은 innerWidth 가 1024 라 표 보기로 열린다. 그런데 실제
       휴대폰에서는 카드 보기다 — 표에만 붙여 두면 정작 이 배지를 보라고
       만든 화면에서는 안 보인다(뮤테이션을 돌려 보고서야 알았다:
       카드 쪽만 망가뜨렸더니 아무 검사도 안 깨졌다). */
    그리기();
    await 준비();
    await userEvent.click(screen.getByTitle("카드로 보기"));

    const 줄 = await 종목줄("삼성전자");
    expect(줄.className).toMatch(/holding-card-lite/);
    await waitFor(() => expect(within(줄).getByText(/배당 4\.00%/)).toBeInTheDocument(),
                  { timeout: 12_000 });
    expect(within(줄).getByText("2·5·8·11월")).toBeInTheDocument();

    const 월배당줄 = await 종목줄("QYLD");
    expect(within(월배당줄).queryByText(/1·2·3/)).toBeNull();
  }, 20_000);

  it("월배당은 배당월을 안 적는다 — 열두 달을 다 적어 봐야 자리만 먹는다", async () => {
    그리기();
    await 준비();
    const 줄 = await 종목줄("QYLD");
    // 배당률은 붙지만
    await waitFor(() => expect(within(줄!).getByText(/배당 /)).toBeInTheDocument(),
                  { timeout: 8000 });
    // 배당월 목록은 없다
    expect(within(줄!).queryByText(/1·2·3/)).toBeNull();
    expect(within(줄!).queryByText(/12월$/)).toBeNull();
  }, 20_000);
});
