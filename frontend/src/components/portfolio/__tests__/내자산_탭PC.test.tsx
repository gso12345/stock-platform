/**
 * 내 자산 탭마다 PC 화면(사용자: "내자산, 관심종목 PC버전에서도 최적화된 화면를 보여주세해줘(추이, 배당, 비중, 뉴스 …)").
 *
 * 휴대폰 모양을 PC 폭으로 그대로 늘리면 —
 *   · 추이: 자산 흐름 그래프가 160px 높이에 1,000px 넘게 눌려 오르내림이 안 보였다
 *   · 배당: 월별 막대가 폭을 다 쓰고 고른 달 내역은 그 아래로 밀려, 막대를 누를 때마다 눈이 위아래로 오갔다
 *   · 뉴스: 기사 제목 한 줄이 1,000px 를 가로질러 눈이 줄을 놓쳤다
 *   · 수익 기여: 종목 이름과 금액이 양 끝에 떨어졌다
 *   · 비중: 고른 기준 하나만 그리고 옆이 비었다 — 다른 기준은 칩을 갈아 끼워야 봤다
 *
 * 휴대폰 모양은 그대로여야 한다 — 바뀐 것은 lg·xl 에서만 산다. jsdom 은 레이아웃을 계산하지 않으므로
 * class 를 보고, 실제 모양은 1440·1920·390px 로 찍어 확인했다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import DividendCalendar from "@/components/portfolio/DividendCalendar";
import 보유뉴스 from "@/components/portfolio/HoldingNews";
import AssetHistory from "@/components/portfolio/AssetHistory";
import 수익기여 from "@/components/portfolio/ProfitContribution";
import 다른기준비중 from "@/components/portfolio/OtherWeights";
import { portfolioApi, dashboardApi, type 배당줄, type 보유뉴스항목 } from "@/api/stocks";
import type { EnrichedItem } from "@/types/portfolio";

vi.mock("@/api/stocks", () => ({
  portfolioApi: { getDividends: vi.fn(), getHistory: vi.fn(), getHoldingNews: vi.fn() },
  dashboardApi: { getIndexOHLCV: vi.fn() },
}));
vi.mock("@/hooks/useExchangeRate", () => ({ useExchangeRate: () => 1400 }));
/* 그래프는 그리지 않고 받은 높이만 적는다 — 보고 싶은 것은 '몇 px 로 그리라고 했나' 다 */
vi.mock("@/components/chart/ChartFrame", () => ({
  default: ({ height }: { height: number }) => <div data-testid="그래프틀" data-height={height} />,
}));

const class들 = (el: Element | null) => new Set(String(el?.className ?? "").split(/\s+/));

function 감싸기(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
}

const 넓게 = () => vi.stubGlobal("matchMedia", (q: string) => ({
  matches: q === "(min-width: 1024px)", media: q, addEventListener() {}, removeEventListener() {},
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(dashboardApi.getIndexOHLCV).mockResolvedValue([]);
});
afterEach(() => vi.unstubAllGlobals());

const 이번달 = new Date().getMonth() + 1;
const 다른달 = 이번달 === 3 ? 6 : 3;
const 배당 = (덮: Partial<배당줄>): 배당줄 => ({
  symbol: "005930", market: "KR", name: "삼성전자", date: "2099-12-31", confirmed: false, ex_date: null,
  pay_date: null, cycle: "분기", months: [이번달], per_month: 1, currency: "KRW", last_date: "2026-06-30",
  last_amount: 361, per_year: 1444, shares: 100, expected: 36_100, expected_year: 144_400, recent: [], ...덮,
});

describe("배당 — 넓은 화면(lg)에서는 왼쪽 한 해 | 오른쪽 고른 달", () => {
  it("월별 막대는 왼쪽, 고른 달 내역은 오른쪽 — 막대를 누르면 오른쪽만 바뀐다", async () => {
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({
      items: [배당({ symbol: "A", name: "이번달종목" }), 배당({ symbol: "B", name: "다른달종목", months: [다른달] })],
      pending: 0,
    });
    감싸기(<DividendCalendar />);
    await screen.findByText("이번달종목");
    const 오른쪽 = screen.getByTestId("고른달내역");
    const 두칸 = 오른쪽.parentElement as HTMLElement;
    const c = class들(두칸);
    expect(c.has("flex")).toBe(true);
    expect(c.has("flex-col")).toBe(true);                       // 휴대폰 — 예전처럼 위아래
    expect(c.has("lg:grid")).toBe(true);
    expect(c.has("lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]")).toBe(true);
    expect(두칸.children.length).toBe(2);
    const 왼쪽 = 두칸.children[0] as HTMLElement;
    expect(왼쪽).not.toBe(오른쪽);
    // 한 해 합계·세금 칩·열두 달 막대는 왼쪽
    expect(within(왼쪽).getByText("올해 예상 배당")).toBeTruthy();
    expect(within(왼쪽).getByRole("group", { name: "세금 적용" })).toBeTruthy();
    expect(within(왼쪽).getAllByRole("button", { name: /^\d+월 / })).toHaveLength(12);
    // 고른 달(처음엔 이번 달) 머리와 종목은 오른쪽
    expect(within(오른쪽).getByText("이번 달")).toBeTruthy();
    expect(within(오른쪽).getByText("이번달종목")).toBeTruthy();
    expect(within(왼쪽).queryByText("이번달종목")).toBeNull();

    await userEvent.click(within(왼쪽).getByRole("button", { name: new RegExp(`^${다른달}월 `) }));
    expect(await within(오른쪽).findByText("다른달종목")).toBeTruthy();
    expect(within(오른쪽).queryByText("이번달종목")).toBeNull();
  });

  it("작년 기준 예상뿐인 달의 막대는 점선 테두리 — 옅은 칠만으로는 밝은 화면에서 막대가 안 보였다", async () => {
    const 올해 = new Date().getFullYear();
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({
      items: [배당({
        months: [3, 12],
        schedule: [
          { month: 3, day: 20, amount: 361, year: 올해, 올해확정: true, actual: true },
          { month: 12, day: 20, amount: 361, year: 올해 - 1, 올해확정: false, actual: true },
        ],
      })],
      pending: 0,
    });
    감싸기(<DividendCalendar />);
    const 예상달 = await screen.findByRole("button", { name: /^12월 ₩.*작년 기준 예상/ });
    const 확정달 = screen.getByRole("button", { name: /^3월 ₩/ });
    const 막대 = (단추: HTMLElement) => class들(단추.querySelector("[style*='--막대']"));
    expect(막대(예상달).has("border-dashed")).toBe(true);
    expect(막대(예상달).has("border-accent-green/60")).toBe(true);
    expect(막대(확정달).has("border-dashed")).toBe(false);
    expect(막대(screen.getByRole("button", { name: /^1월 배당 없음/ })).has("border-dashed")).toBe(false);
  });

  it("오른쪽 칸은 lg 에서만 왼쪽 선으로 갈린다 — 휴대폰은 위 선 그대로", async () => {
    vi.mocked(portfolioApi.getDividends).mockResolvedValue({ items: [배당({})], pending: 0 });
    감싸기(<DividendCalendar />);
    await screen.findByText("삼성전자");
    const 오른쪽 = screen.getByTestId("고른달내역");
    expect(class들(오른쪽).has("lg:border-l")).toBe(true);
    expect(class들(오른쪽).has("border-l")).toBe(false);
    const 머리 = within(오른쪽).getByText("이번 달").closest("div") as HTMLElement;
    const m = class들(머리);
    expect(m.has("border-t")).toBe(true);
    expect(m.has("lg:border-t-0")).toBe(true);
  });
});

const 기사 = (i: number): 보유뉴스항목 => ({
  title: `삼성전자 기사 ${i}`, link: `https://n.example/${i}`, source: "연합뉴스",
  published: "2026/08/26 14:30", published_ts: 100 - i, summary: "", image: null, symbols: ["005930"], lang: "ko",
});

describe("뉴스 — 넓은 화면(lg)에서는 기사 두 줄", () => {
  it("목록은 lg 에서만 두 칸 그리드 — 왼쪽 칸 기사에만 가운데 선", async () => {
    감싸기(<보유뉴스 미리보기={{ items: [1, 2, 3].map(기사), covered: [], pending: 0, missing: [] }} />);
    const 첫기사 = await screen.findByText("삼성전자 기사 1");
    const 칸 = 첫기사.closest("li") as HTMLElement;
    const 목록 = 칸.parentElement as HTMLElement;
    expect(목록.tagName).toBe("UL");
    const c = class들(목록);
    expect(c.has("lg:grid")).toBe(true);
    expect(c.has("lg:grid-cols-2")).toBe(true);
    expect(c.has("grid")).toBe(false);                           // 휴대폰 — 예전처럼 한 줄
    expect(목록.children).toHaveLength(3);
    expect(class들(칸).has("lg:odd:border-r")).toBe(true);
    expect(class들(칸).has("border-r")).toBe(false);
  });
});

describe("추이 — 넓은 화면에서는 그래프를 높게", () => {
  const 점 = (day: string, value: number) => ({ day, value, cost: 900_000, filled: 1, priced: 1 });
  beforeEach(() => {
    vi.mocked(portfolioApi.getHistory).mockResolvedValue({
      points: [점("2026-08-20", 1_000_000), 점("2026-08-24", 1_200_000)], days: 90,
    });
  });

  it("휴대폰은 160px 그대로", async () => {
    감싸기(<AssetHistory />);
    expect((await screen.findByTestId("그래프틀")).dataset.height).toBe("160");
  });

  it("넓은 화면(lg)은 260px — 1,000px 넘게 늘어난 선이 눌리지 않게", async () => {
    넓게();
    감싸기(<AssetHistory />);
    expect((await screen.findByTestId("그래프틀")).dataset.height).toBe("260");
  });

  it("기다리는 동안의 자리도 같은 높이 — 다 받으면 화면이 출렁이지 않게", async () => {
    vi.mocked(portfolioApi.getHistory).mockReturnValue(new Promise(() => {}));
    const { container } = 감싸기(<AssetHistory />);
    await waitFor(() => expect(container.querySelector(".animate-pulse")).not.toBeNull());
    const 자리 = class들(container.querySelector(".animate-pulse"));
    expect(자리.has("h-[160px]")).toBe(true);
    expect(자리.has("lg:h-[260px]")).toBe(true);
  });
});

let 다음id = 1;
const 종목 = (symbol: string, pnlKRW: number): EnrichedItem => ({
  id: 다음id++, symbol, market: "KR", name: symbol, shares: 10, avgPrice: 0, currency: "KRW",
  currentPriceNative: 0, currentValueKRW: 1_000_000 + pnlKRW, costKRW: 1_000_000, pnlKRW, pnlRate: 0, weight: 0,
  isForexItem: false, nativeAvgPrice: 0, nativeValue: 0, nativePnl: 0,
} as EnrichedItem);

describe("수익 기여 — 넓은 화면(lg)에서는 두 줄, 그래프 옆 좁은 칸(xl)에서는 다시 한 줄", () => {
  it("목록 class — 휴대폰 한 줄 · lg 두 줄 · xl 한 줄", () => {
    render(<수익기여 항목={[종목("가", 300_000), 종목("나", 200_000), 종목("다", -100_000)]} />);
    const 목록 = screen.getByText("가").closest("ul") as HTMLElement;
    const c = class들(목록);
    expect(c.has("flex")).toBe(true);
    expect(c.has("flex-col")).toBe(true);
    expect(c.has("lg:grid")).toBe(true);
    expect(c.has("lg:grid-cols-2")).toBe(true);
    expect(c.has("xl:flex")).toBe(true);
    expect(목록.children).toHaveLength(3);
  });
});

describe("다른기준비중 — 고른 기준 옆에 나머지 기준을 한눈에", () => {
  const 색들 = ["#111", "#222", "#333", "#444", "#555", "#666", "#777"];

  it("큰 것부터 막대와 비율 — 다섯까지 이름을 적고 나머지는 한 줄로", () => {
    render(<다른기준비중 제목="종목별" 색들={색들} onSelect={() => {}} 덩이들={[
      { name: "작은", value: 50 }, { name: "애플", value: 400 }, { name: "삼성전자", value: 300 },
      { name: "엔비디아", value: 100 }, { name: "MSFT", value: 80 }, { name: "SCHD", value: 40 },
      { name: "빈것", value: 0 }, { name: "QYLD", value: 30 },
    ]} />);
    const 판 = screen.getByRole("region", { name: "종목별" });
    // 합 1,000 — 0 은 빼고 센다
    expect(within(판).getByRole("img").getAttribute("aria-label"))
      .toBe("종목별 애플 40%, 삼성전자 30%, 엔비디아 10%, MSFT 8%, 작은 5%, SCHD 4%, QYLD 3%");
    const 줄들 = within(판).getAllByRole("listitem").map((li) => li.textContent);
    expect(줄들).toEqual(["애플40.0%", "삼성전자30.0%", "엔비디아10.0%", "MSFT8.0%", "작은5.0%", "그 밖 2개 7.0%"]);
    expect(within(판).queryByText("빈것")).toBeNull();
    // 막대 조각 — 큰 것부터 같은 색 차례, 폭은 비율
    const 조각들 = [...within(판).getByRole("img").children] as HTMLElement[];
    expect(조각들.map((s) => s.style.width)).toEqual(["40%", "30%", "10%", "8%", "5%", "4%", "3%"]);
    expect(조각들[0].style.background).toBe(within(판).getAllByRole("listitem")[0]
      .querySelector("span")!.style.background);
  });

  it("다섯 이하면 '그 밖' 줄이 없다", () => {
    render(<다른기준비중 제목="자산유형별" 색들={색들} onSelect={() => {}} 덩이들={[
      { name: "국내주식", value: 45 }, { name: "해외주식", value: 55 },
    ]} />);
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["해외주식55.0%", "국내주식45.0%"]);
  });

  it("'크게 보기' 를 누르면 그 기준으로 바꾼다", async () => {
    const 바꾸기 = vi.fn();
    render(<다른기준비중 제목="자산유형별" 색들={색들} onSelect={바꾸기} 덩이들={[{ name: "국내주식", value: 1 }]} />);
    await userEvent.click(screen.getByRole("button", { name: "크게 보기 ›" }));
    expect(바꾸기).toHaveBeenCalledTimes(1);
  });

  it("값이 없으면(합이 0) 아무것도 안 그린다 — 빈 막대는 고장으로 보인다", () => {
    const { container } = render(<다른기준비중 제목="포트폴리오별" 색들={색들} onSelect={() => {}}
      덩이들={[{ name: "연금", value: 0 }]} />);
    expect(container.innerHTML).toBe("");
  });
});
