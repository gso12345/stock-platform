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
import { 첫설정 } from "../AllocationForm";

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

describe("저장한 설정이 빠짐없이 되살아난다", () => {
  it("0 과 false 도 그대로 되살아난다", async () => {
    /* `??` 가 아니라 `||` 를 쓰면 여기서 갈린다. 수수료 0% 와
       '동일 비중 끔' 은 **고른 값**인데 falsy 라, || 로 두면 지금
       화면 값으로 덮인다.

       화면에 먼저 0 이 아닌 값을 넣어 둬야 뜻이 있다 — 기본값도 0 이면
       `0 || 0` 이라 || 로 바꿔도 같은 값이 나온다. */
    상태.실험들 = [{ ...실험, cost_rate: 0, equal_weight: false, extended: false }];
    그리기();
    // 자산배분 탭에서 값을 바꿔 둔다
    await userEvent.click(screen.getByLabelText("거래비용 0.25%"));
    await userEvent.click(screen.getByLabelText("확장된 ETF 가격 사용"));
    expect(screen.getByLabelText("거래비용")).toHaveValue("0.25");

    await userEvent.click(screen.getByRole("tab", { name: "전략 저장소" }));
    await userEvent.click(await screen.findByText(실험.name));

    expect(await screen.findByLabelText("거래비용"),
      "0% 로 저장했는데 화면에 있던 값으로 덮였다").toHaveValue("");
    expect(screen.getByLabelText("배분 기준")).toHaveValue("custom");
    expect(screen.getByLabelText("확장된 ETF 가격 사용")).not.toBeChecked();
  }, 20000);

  it("옛날에 저장한 실험에는 새 설정이 없다 — 지금 값을 그대로 둔다", async () => {
    /* 기능이 늘기 전에 저장한 것에는 이 칸들이 아예 없다.
       undefined 를 그대로 넣으면 고르기 칸이 통제 불능이 된다. */
    const 옛것: any = { ...실험 };
    for (const k of ["rebalance_day", "cost_rate", "data_interval",
                     "benchmark", "equal_weight", "extended"]) delete 옛것[k];
    상태.실험들 = [옛것];
    await 저장소열기();
    await userEvent.click(await screen.findByText(실험.name));
    /* **기본값을 그대로 적지 않는다.** 'none' 이라고 박아 두면 나중에
       기본 벤치마크를 바꿨을 때, '옛 실험은 지금 값을 둔다' 는 뜻은
       그대로인데 검사만 깨진다(실제로 spy 로 바꾸며 깨졌다).
       무엇이 기본인지는 자산배분.test 가 따로 본다. */
    const 기본 = 첫설정();
    expect(await screen.findByLabelText("리밸런싱 날짜"))
      .toHaveValue(String(기본.rebalance_day));
    expect(screen.getByLabelText("벤치 마크")).toHaveValue(기본.benchmark);
  }, 20000);
});

describe("지우기는 전략 저장소에서 한다", () => {
  /* getByLabelText 가 아니라 **getByRole** 로 찾는다.
     getByLabelText 는 화면에서 안 보이는 요소도 찾아 준다 — 버튼에
     hidden 을 붙여도 통과했다(뮤테이션에서 그대로 살아남았다).
     getByRole 은 접근성 트리를 보므로 안 보이면 못 찾는다. */
  it("바로 안 지우고 확인 창을 띄운다", async () => {
    /* 누르는 즉시 사라지면 잘못 눌렀을 때 되살릴 방법이 없다 —
       설정만 저장하므로 자산·비중·기간을 전부 다시 맞춰야 한다. */
    상태.실험들 = [실험];
    await 저장소열기();
    await userEvent.click(await screen.findByRole("button", { name: `${실험.name} 지우기` }));

    expect(screen.getByText(/지울까요/), "확인 없이 바로 지웠다").toBeInTheDocument();
    expect(screen.getByText(/되돌릴 수 없어요/)).toBeInTheDocument();
  }, 20000);

  it("지우기를 눌러도 그 실험이 안 열린다", async () => {
    /* 카드 전체가 '열기' 버튼이라, 안쪽 버튼의 클릭이 위로 번지면
       지우려다 자산배분 탭이 열린다. */
    상태.실험들 = [실험];
    await 저장소열기();
    await userEvent.click(await screen.findByRole("button", { name: `${실험.name} 지우기` }));
    expect(screen.getByText(/지울까요/)).toBeInTheDocument();
    // 탭이 안 바뀌었으면 전략 저장소의 카드가 그대로 보인다
    expect(screen.getByRole("button", { name: `${실험.name} 자산배분 실험 열기` })).toBeInTheDocument();
  }, 20000);

  it("확인을 누르면 지운다", async () => {
    const { backtestApi } = await import("@/api/stocks");
    상태.실험들 = [실험];
    await 저장소열기();
    await userEvent.click(await screen.findByRole("button", { name: `${실험.name} 지우기` }));
    await userEvent.click(screen.getByRole("button", { name: "지우기" }));
    expect(backtestApi.deleteExperiment).toHaveBeenCalledWith(실험.id);
  }, 20000);

  it("취소하면 안 지운다", async () => {
    const { backtestApi } = await import("@/api/stocks");
    상태.실험들 = [실험];
    await 저장소열기();
    await userEvent.click(await screen.findByRole("button", { name: `${실험.name} 지우기` }));
    await userEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.queryByText(/지울까요/)).toBeNull();
    expect(backtestApi.deleteExperiment).not.toHaveBeenCalled();
  }, 20000);
});
