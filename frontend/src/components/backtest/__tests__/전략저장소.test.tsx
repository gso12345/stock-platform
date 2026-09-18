/**
 * 저장한 것은 **한 군데**에서 다 보여야 한다.
 *
 * 자산배분 실험은 '내 실험 목록' 에만, 매매 신호 전략은 '전략 저장소'
 * 에만 있었다. 사용자에게는 둘 다 '내가 저장한 것' 일 뿐인데, 어느
 * 쪽에 뒀는지 기억해야 찾을 수 있었다.
 *
 * ── 섞어 놓을 때 지켜야 할 것 ───────────────────────────────
 *
 * 두 가지는 **다른 종류**다. 하나는 매매 신호(RSI < 30 에 사고…)를
 * 시험하는 것이고, 하나는 여러 자산을 비중대로 굴려 보는 것이다.
 * 열리는 탭도 다르다. 이름만 나란히 두면 눌러 보고 나서야 알게 되므로,
 * 무엇인지 **먼저** 보여야 한다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const 상태 = vi.hoisted(() => ({
  로그인함: true,
  실험들: [] as any[],
  전략들: [] as any[],
}));

vi.mock("@/api/stocks", () => ({
  backtestApi: {
    getStrategies: vi.fn(() => Promise.resolve(상태.전략들)),
    getExperiments: vi.fn(() => Promise.resolve(상태.실험들)),
    run: vi.fn(), runUniverse: vi.fn(), saveStrategy: vi.fn(),
    deleteStrategy: vi.fn(), runPortfolio: vi.fn(),
    saveExperiment: vi.fn(), deleteExperiment: vi.fn(),
  },
}));
vi.mock("@/store/authStore", () => ({
  useAuthStore: () => ({ isLoggedIn: 상태.로그인함, userId: 1 }),
}));
vi.mock("@/hooks/useStockSearch", () => ({
  useStockSearch: () => ({ query: "", setQuery: vi.fn(), searching: false, results: [] }),
}));

import Backtest from "@/pages/Backtest";

const 실험 = {
  id: 11, name: "금 60 · 현금 40", created_at: "2026-09-01",
  currency: "KRW" as const, initial_amount: 5_000_000,
  start_date: "2015-01-02", end_date: "2025-01-02",
  assets: [{ symbol: "GLD", market: "US", name: "금", weight: 0.6 },
           { symbol: "현금", market: "KR", name: "현금", weight: 0.4 }],
  contribution_period: "monthly" as const, contribution_amount: 300_000,
  rebalance_period: "yearly" as const, total_return: true,
  rebalance_day: 20, cost_rate: 0.25,
  data_interval: "monthly" as const, benchmark: "6040" as const,
  equal_weight: false, extended: true,
};

const 전략 = {
  id: 5, name: "RSI 반등", version: 1, market: "US", created_at: "2026-08-01",
  entry_conditions: { logic: "AND", conditions: [{}] },
  exit_conditions: { logic: "OR", conditions: [{}] },
};

function 그리기() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}><Backtest /></QueryClientProvider>
    </MemoryRouter>,
  );
}

async function 저장소열기() {
  그리기();
  await userEvent.click(screen.getByRole("tab", { name: "전략 저장소" })
    ?? screen.getByText("전략 저장소"));
}

beforeEach(() => {
  vi.clearAllMocks();
  상태.로그인함 = true; 상태.실험들 = []; 상태.전략들 = [];
});

describe("전략 저장소에 둘 다 모인다", () => {
  it("자산배분 실험이 전략 저장소에 보인다", async () => {
    상태.실험들 = [실험];
    await 저장소열기();
    expect(await screen.findByText(실험.name),
      "저장한 자산배분이 전략 저장소에 안 보인다").toBeInTheDocument();
  });

  it("매매 전략과 섞여 있어도 무엇인지 먼저 보인다", async () => {
    /* 이름만 나란히 두면 눌러 보고 나서야 어느 탭으로 가는지 안다 */
    상태.실험들 = [실험];
    상태.전략들 = [전략];
    await 저장소열기();
    expect(await screen.findByText(실험.name)).toBeInTheDocument();
    expect(screen.getByText(전략.name)).toBeInTheDocument();

    /* '자산배분' 은 탭 이름으로도 있으니 **그 칸 안에서** 찾는다.
       화면 전체에서 찾으면 탭이 걸려서, 배지를 떼어도 통과한다.

       칸은 aria-label 로 집는다. DOM 을 거슬러 올라가는 방식은
       감싸는 <div> 하나만 늘어도 깨진다(실제로 깨졌다). */
    const 실험칸 = screen.getByRole("button", { name: `${실험.name} 자산배분 실험 열기` });
    expect(within(실험칸).getByText("자산배분"),
      "종류를 알려 주는 표시가 없다").toBeInTheDocument();
  });

  it("설정 요약을 같이 보여 준다", async () => {
    /* 이름만으로는 무엇을 저장했는지 모른다. 다시 돌려 보기 전에
       어떤 설정이었는지 알 수 있어야 고를 수 있다. */
    상태.실험들 = [실험];
    await 저장소열기();
    expect(await screen.findByText(/자산 2개/)).toBeInTheDocument();
    expect(screen.getByText(/리밸런싱 매년/)).toBeInTheDocument();
    expect(screen.getByText("적립식")).toBeInTheDocument();
    expect(screen.getByText(/수수료 0.25%/)).toBeInTheDocument();
    expect(screen.getByText(/2015-01-02 ~ 2025-01-02/)).toBeInTheDocument();
  });

  it("누르면 자산배분 탭이 열리고 그 설정이 들어와 있다", async () => {
    /* 목록에 보이기만 하고 안 열리면 반쪽이다. 실제로 그 설정이
       화면에 들어왔는지까지 본다 — 탭만 바뀌고 설정이 빈 채면
       사용자는 저장이 안 된 줄 안다. */
    상태.실험들 = [실험];
    await 저장소열기();
    await userEvent.click(await screen.findByText(실험.name));

    expect(await screen.findByLabelText("시작일")).toHaveValue("2015-01-02");
    expect(screen.getByLabelText("종료일")).toHaveValue("2025-01-02");
    expect(screen.getByLabelText("리밸런싱 날짜")).toHaveValue("20");
    expect(screen.getByLabelText("거래비용")).toHaveValue("0.25");
    expect(screen.getByLabelText("벤치 마크")).toHaveValue("6040");
    expect(screen.getByLabelText("확장된 ETF 가격 사용")).toBeChecked();
  });

  it("로그인 전에는 실험을 안 부른다", async () => {
    /* 서버가 빈 배열을 주긴 하지만 부를 이유가 없다 */
    const { backtestApi } = await import("@/api/stocks");
    상태.로그인함 = false;
    await 저장소열기();
    expect(backtestApi.getExperiments).not.toHaveBeenCalled();
  });

  it("둘 다 없으면 빈 화면이 둘 다 안내한다", async () => {
    await 저장소열기();
    expect(await screen.findByText(/저장된 전략이 없어요/)).toBeInTheDocument();
    expect(screen.getByText(/자산배분은 '저장'/)).toBeInTheDocument();
  });

  it("전략이 없어도 실험만 있으면 빈 화면을 안 띄운다", async () => {
    /* 예전 조건은 strategies 만 봤다. 자산배분만 저장한 사람은
       '저장된 전략이 없어요' 와 자기 실험을 **동시에** 보게 된다. */
    상태.실험들 = [실험];
    await 저장소열기();
    expect(await screen.findByText(실험.name)).toBeInTheDocument();
    expect(screen.queryByText(/저장된 전략이 없어요/),
      "실험이 있는데도 '없어요' 를 띄웠다").toBeNull();
  });
});
