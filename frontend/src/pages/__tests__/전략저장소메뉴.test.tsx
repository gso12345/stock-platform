/**
 * 메뉴의 '전략 저장소' 에도 **저장한 것이 다 나와야 한다.**
 *
 * ── 왜 이 검사가 있나 ──────────────────────────────────────
 *
 * 자산배분 실험은 백테스트 화면의 '전략 저장소' 탭에만 있었고, 정작
 * 메뉴의 '전략 저장소' 에는 매매 신호만 있었다. 같은 이름의 자리가
 * 둘인데 담긴 것이 달랐던 셈이다 — 저장해 놓고 메뉴로 찾아온 사람은
 * 자기 것이 사라진 줄 안다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const 상태 = vi.hoisted(() => ({
  로그인함: true,
  전략들: [] as any[],
  실험들: [] as any[],
  간곳: [] as string[],
}));

vi.mock("@/api/stocks", () => ({
  backtestApi: {
    getStrategies: vi.fn(() => Promise.resolve(상태.전략들)),
    getExperiments: vi.fn(() => Promise.resolve(상태.실험들)),
    deleteStrategy: vi.fn(() => Promise.resolve({})),
    deleteExperiment: vi.fn(() => Promise.resolve({})),
  },
}));
vi.mock("@/store/authStore", () => ({
  useAuthStore: () => ({ isLoggedIn: 상태.로그인함, userId: 1 }),
}));
vi.mock("react-router-dom", async (원래) => {
  const m = await (원래() as Promise<any>);
  return { ...m, useNavigate: () => (곳: string) => 상태.간곳.push(곳) };
});

import Strategies from "@/pages/Strategies";

const 전략 = {
  id: 5, name: "RSI 반등", version: 1, market: "US", created_at: "2026-08-01",
  entry_conditions: { logic: "AND", conditions: [{}] },
  exit_conditions: { logic: "OR", conditions: [{}, {}] },
  stop_loss: 7, take_profit: 20,
};

const 실험 = {
  id: 11, name: "은퇴자금 안전형", created_at: "2026-09-01",
  currency: "KRW", initial_amount: 5_000_000,
  start_date: "2015-01-02", end_date: "2025-01-02",
  assets: [{ symbol: "GLD", market: "US", name: "금", weight: 60 },
           { symbol: "현금", market: "KR", name: "현금", weight: 40 }],
  contribution_period: "monthly", contribution_amount: 300_000,
  rebalance_period: "yearly", total_return: true,
  rebalance_day: 20, cost_rate: 0.25,
  data_interval: "monthly", benchmark: "6040",
  equal_weight: false, extended: true,
};

function 그리기() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}><Strategies /></QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  상태.로그인함 = true; 상태.전략들 = []; 상태.실험들 = []; 상태.간곳 = [];
});


describe("두 종류가 다 나온다", () => {
  it("자산배분 실험이 메뉴에도 보인다", async () => {
    상태.실험들 = [실험];
    그리기();
    expect(await screen.findByText("은퇴자금 안전형"),
      "저장한 자산배분이 메뉴의 전략 저장소에 없다").toBeInTheDocument();
  });

  it("매매 신호와 자산배분을 배지로 가른다", async () => {
    /* 섞어 놓고 이름만 보면 어느 화면에서 열리는지 알 수 없어,
       눌러 보고 나서야 알게 된다. */
    상태.전략들 = [전략]; 상태.실험들 = [실험];
    그리기();
    const 배분카드 = (await screen.findByText("은퇴자금 안전형")).closest("div.flex.flex-col")!;
    expect(within(배분카드 as HTMLElement).getByText("자산배분")).toBeInTheDocument();
  });

  it("무엇을 담았는지 이름으로 보여 준다", async () => {
    /* '자산 2개' 만으로는 어떤 조합인지 알 수 없어 열어 봐야 한다 */
    상태.실험들 = [실험];
    그리기();
    expect(await screen.findByText(/금 · 현금/)).toBeInTheDocument();
  });

  it("개수를 종류별로 센다", async () => {
    상태.전략들 = [전략, { ...전략, id: 6 }]; 상태.실험들 = [실험];
    그리기();
    await screen.findByText("은퇴자금 안전형");
    /* '전체' 는 통계 카드에도 있고 필터 탭에도 있다. 통계 카드 쪽만
       집는다 — 대문자 라벨 클래스로 가른다. */
    const 셈 = (이름: string) =>
      screen.getByText(이름, { selector: "div.uppercase" }).parentElement!.textContent;
    expect(셈("전체")).toMatch(/3/);
    expect(셈("매매 신호")).toMatch(/2/);
    expect(셈("자산배분")).toMatch(/1/);
  });
});


describe("걸러 보기", () => {
  it("자산배분만 보면 매매 신호가 사라진다", async () => {
    상태.전략들 = [전략]; 상태.실험들 = [실험];
    그리기();
    await screen.findByText("은퇴자금 안전형");
    await userEvent.click(screen.getByRole("tab", { name: "자산배분" }));
    expect(screen.queryByText("RSI 반등")).toBeNull();
    expect(screen.getByText("은퇴자금 안전형")).toBeInTheDocument();
  });

  it("매매 신호만 보면 자산배분이 사라진다", async () => {
    상태.전략들 = [전략]; 상태.실험들 = [실험];
    그리기();
    await screen.findByText("은퇴자금 안전형");
    await userEvent.click(screen.getByRole("tab", { name: "매매 신호" }));
    expect(screen.queryByText("은퇴자금 안전형")).toBeNull();
    expect(screen.getByText("RSI 반등")).toBeInTheDocument();
  });

  it("자산배분만 볼 때는 시장 필터를 안 그린다", async () => {
    /* 자산배분은 한 실험 안에 여러 시장이 섞이므로 KR/US 로 가를 수가
       없다 — 아무 일도 안 하는 조작칸은 없느니만 못하다. */
    상태.전략들 = [전략]; 상태.실험들 = [실험];
    그리기();
    await screen.findByText("은퇴자금 안전형");
    expect(screen.getByRole("tab", { name: "한국 KR" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "자산배분" }));
    expect(screen.queryByRole("tab", { name: "한국 KR" })).toBeNull();
  });

  it("걸러서 아무것도 없으면 그렇다고 말한다", async () => {
    상태.전략들 = [전략];
    그리기();
    await screen.findByText("RSI 반등");
    await userEvent.click(screen.getByRole("tab", { name: "자산배분" }));
    expect(screen.getByText(/저장한 자산배분이 없어요/)).toBeInTheDocument();
  });
});


describe("누르면 그 자산배분이 열린다", () => {
  it("실험 번호를 주소에 실어 보낸다", async () => {
    /* 백테스트 첫 화면만 열리면 무엇을 누른 것인지 사라진다 */
    상태.실험들 = [실험];
    그리기();
    await screen.findByText("은퇴자금 안전형");
    await userEvent.click(screen.getByRole("button", { name: /자산배분에서 열기/ }));
    expect(상태.간곳).toEqual(["/backtest?experiment=11"]);
  });

  it("지우기 전에 무엇이 지워지는지 보여 준다", async () => {
    상태.실험들 = [실험];
    그리기();
    await screen.findByText("은퇴자금 안전형");
    await userEvent.click(screen.getByLabelText("은퇴자금 안전형 삭제"));
    expect(await screen.findByText(/자산배분을 지울까요/)).toBeInTheDocument();
    //: 대상 이름이 창에도 있어야 옆줄을 잘못 누른 것을 알아챈다
    expect(screen.getAllByText("은퇴자금 안전형").length).toBeGreaterThanOrEqual(2);
  });
});


describe("아무것도 없을 때", () => {
  it("두 종류를 다 말해 준다", async () => {
    그리기();
    expect(await screen.findByText(/매매 신호나 자산배분/)).toBeInTheDocument();
  });
});
