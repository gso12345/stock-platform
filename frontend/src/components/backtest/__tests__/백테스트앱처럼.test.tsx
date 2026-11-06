/**
 * 백테스트를 앱처럼 — 사용자: "백테스트탭 디자인, 사용자편의성 개선하고 싶어 앱느낌 나도록"(고른 13가지).
 *
 * 여기서 못 박는 것 —
 *   3) '결과 확인' 을 누르면 결과 자리로 내려가고, 결과가 나오면 설정을 한 줄로 접는다(나란히 놓이는 폭은 빼고)
 *   4) 저장·실행 단추는 화면 아래에 붙고, 못 누르는 이유는 단추 바로 위에
 *   5) 자주 안 바꾸는 칸은 '고급 설정' 에 접어 두되, 기본값에서 바꾼 수가 보인다
 *   6) 기간 칩이 먼저, 단일 종목도 오늘에서 거슬러 잰다
 *   7) 단일 종목은 이름으로 찾는다 — 고르면 시장이 따라온다
 *   8) 초기 자본을 '1000만원' 처럼 읽어 주고 빠른 금액 칩
 *  11) 단일 종목 결과는 큰 숫자 셋이 먼저
 *  12) 거래 내역은 폰에서 한 줄 카드
 *  13) 결과 공유 — 설정이 주소에 실리고, 받은 쪽에서 같은 백테스트가 바로 돈다
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import fs from "fs";
import path from "path";

const 상태 = vi.hoisted(() => ({
  단일결과: null as any,
  배분결과: null as any,
  돌린것: [] as any[],
  배분돌린것: [] as any[],
  공유한것: [] as { 주소: string; 제목?: string }[],
}));

vi.mock("@/api/stocks", () => ({
  backtestApi: {
    getStrategies: vi.fn(() => Promise.resolve([])),
    getExperiments: vi.fn(() => Promise.resolve([])),
    run: vi.fn((p: any) => { 상태.돌린것.push(p); return Promise.resolve(상태.단일결과); }),
    runUniverse: vi.fn(() => new Promise(() => {})),
    runPortfolio: vi.fn((p: any) => { 상태.배분돌린것.push(p); return Promise.resolve(상태.배분결과); }),
    getPortfolioProgress: vi.fn(() => Promise.resolve(null)),
    saveStrategy: vi.fn(), deleteStrategy: vi.fn(), saveExperiment: vi.fn(), deleteExperiment: vi.fn(),
  },
}));
vi.mock("@/store/authStore", () => ({
  useAuthStore: () => ({ isLoggedIn: true, userId: 1 }),
}));
vi.mock("@/hooks/useStockSearch", () => ({
  useStockSearch: () => ({
    query: "", setQuery: vi.fn(), searching: false,
    results: [{ symbol: "005930", market: "KR", name: "삼성전자" },
              { symbol: "QQQ", market: "ETF", name: "Invesco QQQ" }],
  }),
}));
vi.mock("@/utils/공유", async (원래) => ({
  ...(await (원래() as Promise<object>)),
  글공유: vi.fn((주소: string, 제목?: string) => { 상태.공유한것.push({ 주소, 제목 }); return Promise.resolve("복사"); }),
}));

import Backtest from "@/pages/Backtest";
import { backtestApi } from "@/api/stocks";
import { 기간에서날짜 } from "../설정값";
import { 기간말 } from "../설정부품";
import { 시장으로 } from "../종목고르기";
import { 공유읽기, 공유주소, 공유열쇠 } from "../결과공유";
import 자산배분결과화면 from "../AllocationResult";
import { 첫설정 } from "../AllocationForm";

const 단일 = {
  start_date: "2021-11-05", end_date: "2026-11-04", years: 5,
  total_return: 12.3, annual_return: 2.35, mdd: 8.1, sharpe_ratio: 1.7,
  win_rate: 62.5, total_trades: 1, avg_profit: 1.2, avg_loss: -0.8,
  profit_factor: 1.9, costs: 0, cost_rate: 0.001, risk_free_rate: 0,
  equity_curve: [{ date: "2021-11-05", value: 10_000_000 }, { date: "2026-11-04", value: 11_230_000 }],
  trades: [{ type: "청산", entry_date: "2022-03-02", exit_date: "2022-03-09",
             entry_price: 100, exit_price: 101, pnl_rate: 1, net_pnl_rate: 0.8, shares: 95 }],
  buy_and_hold: null,
};

const 배분결과 = {
  start_date: "2016-11-04", end_date: "2026-11-04", years: 10, contributed: 10_000_000,
  final_value: 25_000_000, profit: 15_000_000, total_return: 150, twr_annual: 9.6, irr_annual: 9.6,
  mdd: 20, volatility: 15, sharpe: 0.7, dividends: null, yearly: [], curve: [],
  drawdown: [], drawdowns: [], crises: [], currency: "KRW", assets: [], skipped: [], fx_skipped: [],
  costs_included: false, costs: null, cost_rate: null, risk_free_rate: 0, cash_rate: 0, benchmark: null,
  extended_from: {},
};

const 본주소: string[] = [];
function 주소보기() {
  const [p] = useSearchParams();
  본주소.push(p.toString());
  return null;
}

function 그리기(처음 = "/backtest") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[처음]}>
      <QueryClientProvider client={qc}><Backtest /><주소보기 /></QueryClientProvider>
    </MemoryRouter>,
  );
}

async function 단일탭() {
  await userEvent.click(screen.getByRole("tab", { name: "단일 종목" }));
}
const 실행단추 = () => screen.getByRole("button", { name: /백테스트 실행/ });

/** 폭 흉내 — 넘긴 최소폭 이상이면 넓다 */
function 폭(px: number) {
  vi.stubGlobal("matchMedia", (q: string) => {
    const m = q.match(/min-width:\s*(\d+)px/);
    return { matches: !!m && px >= Number(m[1]), media: q, addEventListener() {}, removeEventListener() {} };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  상태.단일결과 = 단일; 상태.배분결과 = 배분결과;
  상태.돌린것 = []; 상태.배분돌린것 = []; 상태.공유한것 = [];
  본주소.length = 0;
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });


describe("7) 단일 종목은 이름으로 찾는다", () => {
  it("코드를 칠 필요 없이 이름을 누르면 종목과 시장이 함께 정해진다", async () => {
    그리기();
    await 단일탭();
    expect(screen.queryByLabelText("종목코드"), "코드 입력칸이 아직 있다").toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /테스트 종목 Apple 바꾸기/ }));
    await userEvent.click(screen.getByRole("button", { name: "삼성전자 고르기" }));
    expect(screen.getByRole("button", { name: /테스트 종목 삼성전자 바꾸기/ })).toBeInTheDocument();
    await userEvent.click(실행단추());
    await waitFor(() => expect(상태.돌린것).toHaveLength(1));
    expect(상태.돌린것[0]).toMatchObject({ symbol: "005930", market: "KR" });
  });

  it("검색을 닫으면 고른 종목이 그대로다", async () => {
    그리기();
    await 단일탭();
    await userEvent.click(screen.getByRole("button", { name: /테스트 종목 Apple 바꾸기/ }));
    expect(screen.getByLabelText("종목 검색")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "검색 닫기" }));
    expect(screen.getByRole("button", { name: /테스트 종목 Apple 바꾸기/ })).toBeInTheDocument();
  });

  it("검색 결과의 시장 — 국내·ETF 는 그대로, 모르는 것은 미국", () => {
    expect(시장으로("KR")).toBe("KR");
    expect(시장으로("ETF")).toBe("ETF");
    expect(시장으로("US")).toBe("US");
    expect(시장으로(undefined)).toBe("US");
    expect(시장으로("NASDAQ")).toBe("US");
  });
});


describe("6) 기간 — 칩이 먼저, 오늘에서 거슬러", () => {
  it("단일 종목도 오늘까지 5년이 골라져 있다(예전엔 2020-01-01~2024-12-31 에 못 박혀 있었다)", async () => {
    그리기();
    await 단일탭();
    const { start_date, end_date } = 기간에서날짜(5);
    expect(screen.getByLabelText("시작일")).toHaveValue(start_date);
    expect(screen.getByLabelText("종료일")).toHaveValue(end_date);
    expect(screen.getByLabelText("5년").getAttribute("aria-pressed")).toBe("true");
    // 칩이 날짜보다 위에
    expect(screen.getByLabelText("5년").compareDocumentPosition(screen.getByLabelText("시작일"))
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("칩을 누르면 그 칩이 눌린 것으로 바뀐다", async () => {
    그리기();
    await 단일탭();
    await userEvent.click(screen.getByLabelText("3년"));
    expect(screen.getByLabelText("3년").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText("5년").getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByLabelText("시작일")).toHaveValue(기간에서날짜(3).start_date);
  });

  it("날짜를 손으로 고치면 칩이 풀린다", async () => {
    그리기();
    await 단일탭();
    fireEvent.change(screen.getByLabelText("시작일"), { target: { value: "2019-03-01" } });
    for (const 년 of [1, 3, 5, 10, 20, 30]) {
      expect(screen.getByLabelText(`${년}년`).getAttribute("aria-pressed")).toBe("false");
    }
  });

  it("요약의 기간 — 오늘까지 꼭 N년이면 'N년', 아니면 날짜", () => {
    const 오늘 = new Date(2026, 10, 4);
    expect(기간말("2016-11-04", "2026-11-04", 오늘)).toBe("10년");
    expect(기간말("2025-11-04", "2026-11-04", 오늘)).toBe("1년");
    //: 날짜는 짧게 — 한 줄 요약에서 긴 날짜가 금액을 밀어내 잘랐다
    expect(기간말("2016-11-05", "2026-11-04", 오늘)).toBe("16.11.05 ~ 26.11.04");
    expect(기간말("2016-11-04", "2026-11-03", 오늘), "끝이 오늘이 아니면 N년이 아니다").toBe("16.11.04 ~ 26.11.03");
  });
});


describe("8) 초기 자본 — 읽어 주고 칩으로", () => {
  it("'10000000' 대신 '1000만원' 이 보이고, 칩을 누르면 그 금액으로 돈다", async () => {
    그리기();
    await 단일탭();
    const 칸 = screen.getByLabelText("초기 자본");
    expect(칸).toHaveValue(10_000_000);
    expect(within(칸.parentElement!).getByText("1000만원")).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("1억원"));
    expect(칸).toHaveValue(100_000_000);
    await userEvent.click(실행단추());
    await waitFor(() => expect(상태.돌린것).toHaveLength(1));
    expect(상태.돌린것[0].initial_capital).toBe(100_000_000);
  });

  it("4) 비우면 못 돌리는 이유를 단추 바로 위에 적고 단추를 잠근다", async () => {
    그리기();
    await 단일탭();
    expect(screen.queryByText(/초기 자본을 10만원 이상/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "금액 지우기" }));
    const 이유 = screen.getByText(/초기 자본을 10만원 이상 넣어 주세요/);
    expect(실행단추()).toBeDisabled();
    // 이유가 단추 줄과 같은 '아래 붙는 줄' 안에 있다
    expect(이유.closest("div.sticky")).toBe(실행단추().closest("div.sticky"));
  });

  it("서버 하한(10만원)보다 작아도 막는다", async () => {
    그리기();
    await 단일탭();
    fireEvent.change(screen.getByLabelText("초기 자본"), { target: { value: "50000" } });
    expect(실행단추()).toBeDisabled();
    fireEvent.change(screen.getByLabelText("초기 자본"), { target: { value: "100000" } });
    expect(실행단추()).toBeEnabled();
  });
});


describe("4) 저장·실행은 화면 아래에 붙는다", () => {
  it.each([["자산배분", /결과 확인/], ["단일 종목", /백테스트 실행/]])("%s — 아래 메뉴 바로 위", async (탭, 단추) => {
    그리기();
    await userEvent.click(screen.getByRole("tab", { name: 탭 }));
    const 줄 = screen.getByRole("button", { name: 단추 }).closest("div.sticky") as HTMLElement;
    expect(줄, "단추 줄이 화면에 안 붙는다").not.toBeNull();
    /* 본문이 아래 메뉴 높이만큼 아래 여백을 두고, 붙는 자리는 그 여백 안쪽에서 잰다 — bottom-0 이 곧 메뉴 바로 위.
       메뉴 높이를 또 빼면 단추 줄이 붕 뜬다(폰에서 49px 떠 있던 것을 찍어 보고 고쳤다) */
    expect(줄.className).toMatch(/(^|\s)bottom-0(\s|$)/);
    expect(줄.className, "메뉴 높이를 두 번 뺐다").not.toMatch(/3\.5rem/);
    // 그 여백이 본문에 있어야 bottom-0 이 메뉴 위다 — 없으면 단추 줄이 아래 메뉴에 가린다
    const 틀 = fs.readFileSync(path.resolve(__dirname, "../../layout/Layout.tsx"), "utf-8");
    expect(틀).toMatch(/<main[^>]*pb-\[calc\(3\.5rem_\+_env\(safe-area-inset-bottom\)\)\]/);
    expect(within(줄).getByRole("button", { name: /^저장/ })).toBeInTheDocument();
  });
});


describe("5) 고급 설정은 접어 두되 바꾼 수가 보인다", () => {
  it("단일 종목 — 손절·익절·투자비중·거래비용", async () => {
    그리기();
    await 단일탭();
    const 단추 = screen.getByRole("button", { name: /고급 설정/ });
    expect(단추.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByLabelText("손절 (%)")).toBeNull();
    expect(단추.textContent).not.toMatch(/바꿈/);

    await userEvent.click(단추);
    expect(단추.getAttribute("aria-expanded")).toBe("true");
    await userEvent.type(screen.getByLabelText("손절 (%)"), "5");
    fireEvent.change(screen.getByLabelText("투자비중 (%)"), { target: { value: "50" } });
    expect(단추.textContent).toMatch(/2개 바꿈/);
    await userEvent.click(단추);
    expect(screen.queryByLabelText("손절 (%)")).toBeNull();
    expect(단추.textContent, "접으면 바꾼 것이 안 보인다").toMatch(/2개 바꿈/);

    await userEvent.click(실행단추());
    await waitFor(() => expect(상태.돌린것).toHaveLength(1));
    expect(상태.돌린것[0]).toMatchObject({ stop_loss: 5, position_size: 0.5 });
  });

  it("자산배분 — 벤치마크를 바꾸면 '1개 바꿈'", async () => {
    그리기();
    const 단추 = screen.getByRole("button", { name: /고급 설정/ });
    await userEvent.click(단추);
    await userEvent.selectOptions(screen.getByLabelText("벤치 마크"), "qqq");
    expect(단추.textContent).toMatch(/1개 바꿈/);
    await userEvent.selectOptions(screen.getByLabelText("벤치 마크"), "spy");
    expect(단추.textContent, "기본값으로 되돌렸는데 바꿈이 남았다").not.toMatch(/바꿈/);
  });
});


describe("3) 결과 자리로 데려가고, 결과가 나오면 설정을 접는다", () => {
  it("결과가 나오면 설정이 한 줄 요약이 되고, '설정 바꾸기' 로 다시 펼친다", async () => {
    그리기();
    await 단일탭();
    await userEvent.click(실행단추());
    expect(await screen.findByText("성과")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /백테스트 실행/ }), "결과가 나왔는데 설정이 그대로 펼쳐져 있다").toBeNull();
    expect(screen.getByText("Apple · AAPL")).toBeInTheDocument();
    expect(screen.getByText("5년 · 1000만원 · 진입 1조건 · 청산 1조건")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "설정 바꾸기" }));
    expect(실행단추()).toBeInTheDocument();
    expect(screen.getByText("성과"), "펼쳤더니 결과가 사라졌다").toBeInTheDocument();
  });

  it("설정과 결과가 나란히 놓이는 넓은 화면에서는 안 접는다", async () => {
    폭(1280);
    그리기();
    await 단일탭();
    await userEvent.click(실행단추());
    expect(await screen.findByText("성과")).toBeInTheDocument();
    expect(실행단추()).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "설정 바꾸기" })).toBeNull();
  });

  /** scrollIntoView 를 받아 적는다(jsdom 에는 없다). 결과 자리의 위치는 위 값으로 흉내 낸다 */
  function 내려가기적기(위: number) {
    const 간곳: { el: Element; opt: unknown }[] = [];
    Element.prototype.scrollIntoView = function (this: Element, opt?: unknown) { 간곳.push({ el: this, opt }); } as never;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(() => ({ top: 위 } as DOMRect));
    // 결과가 안 오는 동안만 본다 — 오면 설정을 접으며 또 움직인다(아래 시험)
    vi.mocked(backtestApi.run).mockImplementationOnce(() => new Promise(() => {}));
    return 간곳;
  }

  it("'결과 확인' 을 누르면 진행 자리로 부드럽게 내려간다", async () => {
    const 간곳 = 내려가기적기(2000);
    그리기();
    await 단일탭();
    await userEvent.click(실행단추());
    await waitFor(() => expect(간곳.length).toBe(1));
    expect(간곳[0].opt).toMatchObject({ behavior: "smooth", block: "start" });
    expect((간곳[0].el as HTMLElement).contains(screen.getByText(/과거 데이터로 돌려보는 중/)),
      "진행 자리가 아닌 곳으로 갔다").toBe(true);
  });

  it("'움직임 줄이기' 를 켠 사람에게는 부드럽게가 아니라 바로 간다", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: q === "(prefers-reduced-motion: reduce)", media: q, addEventListener() {}, removeEventListener() {},
    }));
    const 간곳 = 내려가기적기(2000);
    그리기();
    await 단일탭();
    await userEvent.click(실행단추());
    await waitFor(() => expect(간곳.length).toBe(1));
    expect(간곳[0].opt).toMatchObject({ behavior: "auto", block: "start" });
  });

  it("결과 자리가 이미 화면 위쪽에 보이면 안 움직인다", async () => {
    const 간곳 = 내려가기적기(100);
    그리기();
    await 단일탭();
    await userEvent.click(실행단추());
    await screen.findByText(/과거 데이터로 돌려보는 중/);
    await new Promise((r) => setTimeout(r, 50));
    expect(간곳, "이미 보이는데 움직였다").toEqual([]);
  });

  it("결과가 나와 설정을 접으면 요약부터 보이게 그 자리로 간다", async () => {
    const 간곳: { el: Element; opt: unknown }[] = [];
    Element.prototype.scrollIntoView = function (this: Element, opt?: unknown) { 간곳.push({ el: this, opt }); } as never;
    그리기();
    await 단일탭();
    await userEvent.click(실행단추());
    await screen.findByRole("button", { name: "설정 바꾸기" });
    const 접은뒤 = 간곳.filter((x) => (x.el as HTMLElement).contains(screen.getByRole("button", { name: "설정 바꾸기" })));
    expect(접은뒤.length, "접은 뒤에 요약 자리로 안 갔다 — 위에서 화면 두세 장이 빠져 보던 자리가 어긋난다").toBe(1);
    /* 부드럽게 간다 — 바로 가기로 두면 응답이 빨리 왔을 때 '결과로' 의 부드러운 움직임과 겹쳐 요약이 위로
       잘렸다(실제 화면에서 13px). 부드러운 움직임끼리는 나중 것이 앞의 것을 대신한다 */
    expect(접은뒤[0].opt).toMatchObject({ behavior: "smooth", block: "start" });
  });
});


describe("11·12) 단일 종목 결과", () => {
  it("큰 숫자 셋(총 수익률·최대 낙폭·승률)이 먼저, 나머지는 작게 그 아래", async () => {
    그리기();
    await 단일탭();
    await userEvent.click(실행단추());
    const 성과 = (await screen.findByText("성과")).closest(".bg-bg-card") as HTMLElement;
    const [큰, 작은] = [...성과.querySelectorAll(":scope > div.grid")] as HTMLElement[];
    const 이름들 = (칸: HTMLElement) => [...칸.children].map((c) => c.firstElementChild?.textContent);
    expect(이름들(큰)).toEqual(["총 수익률", "최대 낙폭", "승률"]);
    expect(이름들(작은)).toEqual(["연환산", "샤프 비율", "총 거래수", "평균 수익", "수익비율 (PF)"]);
    expect(within(큰).getByText("+12.3%").className).toMatch(/text-xl/);
    expect(within(작은).getByText("1.70").className).toMatch(/text-sm/);
  });

  it("폰에서는 거래가 한 줄 카드 — 표가 아니다", async () => {
    그리기();
    await 단일탭();
    await userEvent.click(실행단추());
    await userEvent.click(await screen.findByRole("tab", { name: "거래" }));   // 거래 내역은 '거래' 칩 안
    /* 거래 분석 칸(가장 큰 이익·손실)에도 같은 날짜·손익이 나오므로 거래 내역 카드 안에서 본다 */
    const 내역 = within((await screen.findByText("거래 내역")).closest(".bg-bg-card") as HTMLElement);
    expect(document.querySelector("table"), "폰에서 일곱 칸 표가 그대로다").toBeNull();
    expect(내역.getByText("22.03.02 → 22.03.09")).toBeInTheDocument();
    expect(내역.getByText("100 → 101 · 95주")).toBeInTheDocument();
    // 수수료를 넣었으면 뺀 것도 같은 줄에
    expect(내역.getByText("수수료 뺀 것")).toBeInTheDocument();
    expect(내역.getByText("+0.80%")).toBeInTheDocument();
  });

  it("넓은 화면에서는 표", async () => {
    폭(768);
    그리기();
    await 단일탭();
    await userEvent.click(실행단추());
    await userEvent.click(await screen.findByRole("tab", { name: "거래" }));
    expect((await screen.findByText("진입일")).closest("table")).not.toBeNull();
  });
});


describe("10) 자산배분 결과 머리", () => {
  it("결과 보기는 칩, CSV·공유는 작은 아이콘", () => {
    const 공유 = vi.fn();
    render(<자산배분결과화면 r={배분결과 as never} 공유하기={공유} />);
    const 칩 = screen.getByRole("tab", { name: "요약" });
    expect(칩.className, "상자 탭(파랗게 채운) 그대로다").not.toMatch(/bg-accent-blue text-white/);
    expect(칩.className).toMatch(/rounded-lg border/);
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(칩.id);
    // 칩을 바꾸면 내용 칸도 그 칩을 가리킨다
    fireEvent.click(screen.getByRole("tab", { name: "낙폭" }));
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(screen.getByRole("tab", { name: "낙폭" }).id);
    const csv = screen.getByRole("button", { name: "CSV로 내보내기" });
    expect(csv.textContent, "큰 글자 단추가 남아 있다").toBe("");
    fireEvent.click(screen.getByRole("button", { name: "결과 공유" }));
    expect(공유).toHaveBeenCalledTimes(1);
  });

  it("공유 단추는 공유할 수 있을 때만", () => {
    render(<자산배분결과화면 r={배분결과 as never} />);
    expect(screen.queryByRole("button", { name: "결과 공유" })).toBeNull();
  });
});


describe("13) 결과 공유", () => {
  it("단일 종목 — 이 결과를 낸 설정이 주소에 실린다(그 뒤에 칸을 고쳐도)", async () => {
    그리기();
    await 단일탭();
    await userEvent.click(실행단추());
    await screen.findByText("성과");
    // 결과가 나온 뒤 칸을 고쳐도 공유는 결과를 낸 설정이다
    await userEvent.click(screen.getByRole("button", { name: "설정 바꾸기" }));
    await userEvent.click(screen.getByLabelText("100만원"));
    await userEvent.click(screen.getByRole("button", { name: "결과 공유" }));
    await waitFor(() => expect(상태.공유한것).toHaveLength(1));
    const { 주소, 제목 } = 상태.공유한것[0];
    expect(제목).toBe("Apple 백테스트");
    const 받은것 = 공유읽기(new URL(주소).searchParams.get(공유열쇠));
    expect(받은것?.탭).toBe("single");
    expect(받은것?.설정).toMatchObject({ symbol: "AAPL", market: "US", capital: 10_000_000 });
    expect(await screen.findByText("링크를 복사했어요")).toBeInTheDocument();
  });

  it("공유받은 주소로 열면 같은 백테스트가 바로 돌고, 주소에서 지운다", async () => {
    const 주소 = 공유주소({ 탭: "single", 설정: {
      symbol: "005930", market: "KR", name: "삼성전자", start_date: "2021-01-04", end_date: "2024-01-04",
      capital: 5_000_000, stop_loss: 7, take_profit: "", position_size: 80, cost_rate: 0.015,
      entry: { logic: "AND", conditions: [{ indicator: "RSI", operator: "<", value: 30, period: 14 }] },
      exit: { logic: "OR", conditions: [{ indicator: "RSI", operator: ">", value: 70, period: 14 }] } } },
      "https://x.test");
    그리기(`/backtest?${new URL(주소).search.slice(1)}`);
    await waitFor(() => expect(상태.돌린것).toHaveLength(1));
    expect(상태.돌린것[0]).toMatchObject({
      symbol: "005930", market: "KR", start_date: "2021-01-04", end_date: "2024-01-04",
      initial_capital: 5_000_000, stop_loss: 7, position_size: 0.8, cost_rate: 0.015,
    });
    expect(screen.getByRole("tab", { name: "단일 종목" }).getAttribute("aria-selected")).toBe("true");
    expect(본주소[본주소.length - 1], "주소에 공유 값이 남아 있다").not.toMatch(/bt=/);
  });

  it("깨진 공유 주소는 그렇다고 말하고 아무것도 안 돌린다", async () => {
    그리기("/backtest?bt=zzzz");
    expect(await screen.findByText(/공유 주소를 읽지 못했어요/)).toBeInTheDocument();
    expect(backtestApi.run).not.toHaveBeenCalled();
    expect(backtestApi.runPortfolio).not.toHaveBeenCalled();
  });

  it("자산배분 공유 주소 — 자산배분 탭에서 같은 설정으로 바로 돈다", async () => {
    const 설정 = { ...첫설정(new Date(2026, 10, 4)), initial_amount: 20_000_000 as const,
      assets: [{ symbol: "SPY", market: "US" as const, name: "S&P 500", weight: 100 }], benchmark: "qqq" as const };
    const 주소 = 공유주소({ 탭: "alloc", 설정 }, "https://x.test");
    그리기(`/backtest?${new URL(주소).search.slice(1)}`);
    await waitFor(() => expect(상태.배분돌린것).toHaveLength(1));
    expect(상태.배분돌린것[0]).toMatchObject({ initial_amount: 20_000_000, benchmark: "qqq",
      assets: [{ symbol: "SPY", weight: 100 }] });
    expect(await screen.findByText("S&P 500 100%")).toBeInTheDocument();   // 결과가 나와 접힌 요약
  });

  it("유니버스 공유 주소 — 몇 분 걸리는 일이라 설정만 넣고 안 돌린다", async () => {
    const 주소 = 공유주소({ 탭: "universe", 설정: {
      universe: "KOSPI", rank_by: "sharpe_ratio", top_n: 10, start_date: "2021-01-04", end_date: "2024-01-04",
      capital: 10_000_000, stop_loss: "", take_profit: "", position_size: 95, cost_rate: 0,
      entry: { logic: "AND", conditions: [] }, exit: { logic: "OR", conditions: [] } } }, "https://x.test");
    그리기(`/backtest?${new URL(주소).search.slice(1)}`);
    expect(await screen.findByText(/공유받은 설정을 넣었어요/)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "유니버스" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("button", { name: /KOSPI 대형주/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText("순위 기준")).toHaveValue("sharpe_ratio");
    expect(backtestApi.runUniverse).not.toHaveBeenCalled();
  });

  it("자산배분 결과의 공유 — 돌린 설정이 실린다(그 뒤에 칸을 고쳐도)", async () => {
    const 설정 = { ...첫설정(new Date(2026, 10, 4)), initial_amount: 20_000_000 as const,
      assets: [{ symbol: "SPY", market: "US" as const, name: "S&P 500", weight: 100 }] };
    그리기(`/backtest?${new URL(공유주소({ 탭: "alloc", 설정 }, "https://x.test")).search.slice(1)}`);
    await screen.findByText("S&P 500 100%");
    // 결과가 나온 뒤 금액을 고쳐도 공유는 결과를 낸 설정이다
    await userEvent.click(screen.getByRole("button", { name: "설정 바꾸기" }));
    await userEvent.click(screen.getByLabelText("500만원"));
    await userEvent.click(screen.getByRole("button", { name: "결과 공유" }));
    await waitFor(() => expect(상태.공유한것).toHaveLength(1));
    expect(상태.공유한것[0].제목).toBe("S&P 500 100% 백테스트");
    const 받은것 = 공유읽기(new URL(상태.공유한것[0].주소).searchParams.get(공유열쇠));
    expect(받은것?.탭).toBe("alloc");
    expect(받은것?.설정).toMatchObject({ initial_amount: 20_000_000, assets: [{ symbol: "SPY", weight: 100 }] });
  });
});
