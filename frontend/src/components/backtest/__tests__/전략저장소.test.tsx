/**
 * 저장한 것은 백테스트 위쪽 '불러오기' 한 곳에서 다 연다(사용자가 고른 2번).
 *
 * 예전엔 백테스트 안의 넷째 탭 '전략 저장소' 였다 — 메뉴의 전략 저장소와 같은 것이 두 군데였고, 탭 줄이 넷이라
 * 폰에서 꽉 찼다. 탭은 셋으로 줄이고, 저장한 것은 탭 줄 오른쪽 '불러오기' 창으로 연다.
 *
 * ── 지켜야 할 것 ───────────────────────────────
 *
 * 두 가지는 **다른 종류**다. 하나는 매매 신호(RSI < 30 에 사고…)를 시험하는 것이고, 하나는 여러 자산을 비중대로
 * 굴려 보는 것이다. 열리는 탭도 다르다 — 칩으로 갈라 보여 주고, 처음 칸은 지금 탭에 맞춘다.
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
  benchmark: "6040" as const,
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

async function 불러오기열기(이미그림 = false) {
  if (!이미그림) 그리기();
  await userEvent.click(screen.getByRole("button", { name: "불러오기" }));
}

/** 창 안의 칩(자산배분·매매 전략) — 페이지 위의 '자산배분' 탭과 이름이 같아 창의 칩 줄 안에서 찾는다 */
const 칩 = (이름: RegExp) => within(screen.getByRole("tablist", { name: "불러올 것" })).getByRole("tab", { name: 이름 });

/** 자주 안 바꾸는 칸은 '고급 설정' 안에 접혀 있다 */
async function 고급열기() {
  await userEvent.click(screen.getByRole("button", { name: /고급 설정/ }));
}

beforeEach(() => {
  vi.clearAllMocks();
  상태.로그인함 = true; 상태.실험들 = []; 상태.전략들 = [];
});

describe("불러오기 창에 둘 다 모인다", () => {
  it("탭은 셋 — '전략 저장소' 탭이 없다", () => {
    그리기();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["자산배분", "단일 종목", "유니버스"]);
    expect(screen.queryByRole("tab", { name: "전략 저장소" })).toBeNull();
  });

  it("저장한 자산배분 실험이 보인다", async () => {
    상태.실험들 = [실험];
    await 불러오기열기();
    expect(await screen.findByText(실험.name),
      "저장한 자산배분이 불러오기 창에 안 보인다").toBeInTheDocument();
  });

  it("자산배분과 매매 전략을 칩으로 가른다 — 처음 칸은 지금 탭에 맞춘다", async () => {
    /* 이름만 나란히 두면 눌러 보고 나서야 어느 탭으로 가는지 안다 */
    상태.실험들 = [실험];
    상태.전략들 = [전략];
    await 불러오기열기();
    expect(await screen.findByText(실험.name)).toBeInTheDocument();
    expect(screen.queryByText(전략.name), "자산배분 탭에서 열었는데 매매 전략이 섞여 있다").toBeNull();
    expect(칩(/자산배분/).getAttribute("aria-selected")).toBe("true");

    await userEvent.click(칩(/매매 전략/));
    expect(await screen.findByText(전략.name)).toBeInTheDocument();
    expect(screen.queryByText(실험.name)).toBeNull();
  });

  it("단일 종목 탭에서 열면 매매 전략부터 보인다", async () => {
    상태.실험들 = [실험];
    상태.전략들 = [전략];
    그리기();
    await userEvent.click(screen.getByRole("tab", { name: "단일 종목" }));
    await 불러오기열기(true);
    expect(await screen.findByText(전략.name)).toBeInTheDocument();
    expect(screen.queryByText(실험.name)).toBeNull();
  });

  it("설정 요약을 같이 보여 준다", async () => {
    /* 이름만으로는 무엇을 저장했는지 모른다. 다시 돌려 보기 전에
       어떤 설정이었는지 알 수 있어야 고를 수 있다. */
    상태.실험들 = [실험];
    await 불러오기열기();
    expect(await screen.findByText(/자산 2개/)).toBeInTheDocument();
    expect(screen.getByText(/리밸런싱 매년/)).toBeInTheDocument();
    expect(screen.getByText("적립식")).toBeInTheDocument();
    expect(screen.getByText(/수수료 0.25%/)).toBeInTheDocument();
    expect(screen.getByText(/2015-01-02 ~ 2025-01-02/)).toBeInTheDocument();
  });

  it("누르면 창이 닫히고 그 설정이 들어와 있다 — 접힌 고급 설정에도 '바꿈' 이 보인다", async () => {
    /* 목록에 보이기만 하고 안 열리면 반쪽이다. 실제로 그 설정이
       화면에 들어왔는지까지 본다 — 탭만 바뀌고 설정이 빈 채면
       사용자는 저장이 안 된 줄 안다. */
    상태.실험들 = [실험];
    await 불러오기열기();
    await userEvent.click(await screen.findByRole("button", { name: `${실험.name} 자산배분 실험 열기` }));

    expect(screen.queryByRole("button", { name: `${실험.name} 자산배분 실험 열기` }), "고른 뒤에도 창이 떠 있다").toBeNull();
    expect(await screen.findByLabelText("시작일")).toHaveValue("2015-01-02");
    expect(screen.getByLabelText("종료일")).toHaveValue("2025-01-02");
    // 리밸런싱 날짜 20 · 거래비용 0.25 · 벤치마크 6040 · 확장 ETF — 넷을 기본값에서 바꿨다
    expect(screen.getByRole("button", { name: /고급 설정/ }).textContent).toMatch(/4개 바꿈/);
    await 고급열기();
    expect(screen.getByLabelText("리밸런싱 날짜")).toHaveValue("20");
    expect(screen.getByLabelText("거래비용")).toHaveValue("0.25");
    expect(screen.getByLabelText("벤치 마크")).toHaveValue("6040");
    expect(screen.getByLabelText("확장된 ETF 가격 사용")).toBeChecked();
  });

  it("다른 탭에서 실험을 고르면 자산배분 탭으로 간다", async () => {
    상태.실험들 = [실험];
    그리기();
    await userEvent.click(screen.getByRole("tab", { name: "유니버스" }));
    await 불러오기열기(true);
    await userEvent.click(칩(/자산배분/));
    await userEvent.click(await screen.findByRole("button", { name: `${실험.name} 자산배분 실험 열기` }));
    expect(screen.getByRole("tab", { name: "자산배분" }).getAttribute("aria-selected")).toBe("true");
    expect(await screen.findByLabelText("시작일")).toHaveValue("2015-01-02");
  });

  it("로그인 전에는 실험을 안 부르고, 로그인하라고 말한다", async () => {
    /* 서버가 빈 배열을 주긴 하지만 부를 이유가 없다 */
    const { backtestApi } = await import("@/api/stocks");
    상태.로그인함 = false;
    await 불러오기열기();
    expect(screen.getByText(/로그인이 필요해요/)).toBeInTheDocument();
    expect(backtestApi.getExperiments).not.toHaveBeenCalled();
  });

  it("비었으면 칸마다 어떻게 쌓이는지 안내한다", async () => {
    await 불러오기열기();
    expect(await screen.findByText(/저장한 자산배분이 없어요/)).toBeInTheDocument();
    expect(screen.getByText(/자산배분 탭에서/)).toBeInTheDocument();
    await userEvent.click(칩(/매매 전략/));
    expect(await screen.findByText(/저장한 매매 전략이 없어요/)).toBeInTheDocument();
  });

  it("전략이 없어도 실험만 있으면 빈 화면을 안 띄운다", async () => {
    /* 예전 조건은 strategies 만 봤다. 자산배분만 저장한 사람은
       '저장된 전략이 없어요' 와 자기 실험을 **동시에** 보게 된다. */
    상태.실험들 = [실험];
    await 불러오기열기();
    expect(await screen.findByText(실험.name)).toBeInTheDocument();
    expect(screen.queryByText(/없어요/), "실험이 있는데도 '없어요' 를 띄웠다").toBeNull();
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
    await 고급열기();
    await userEvent.click(screen.getByLabelText("거래비용 0.25%"));
    await userEvent.click(screen.getByLabelText("확장된 ETF 가격 사용"));
    expect(screen.getByLabelText("거래비용")).toHaveValue("0.25");

    await 불러오기열기(true);
    await userEvent.click(await screen.findByRole("button", { name: `${실험.name} 자산배분 실험 열기` }));

    expect(await screen.findByLabelText("거래비용"),
      "0% 로 저장했는데 화면에 있던 값으로 덮였다").toHaveValue("");
    expect(screen.getByLabelText("배분 기준")).toHaveValue("custom");
    expect(screen.getByLabelText("확장된 ETF 가격 사용")).not.toBeChecked();
  }, 20000);

  it("옛날에 저장한 실험에는 새 설정이 없다 — 지금 값을 그대로 둔다", async () => {
    /* 기능이 늘기 전에 저장한 것에는 이 칸들이 아예 없다.
       undefined 를 그대로 넣으면 고르기 칸이 통제 불능이 된다. */
    const 옛것: any = { ...실험 };
    for (const k of ["rebalance_day", "cost_rate",
                     "benchmark", "equal_weight", "extended"]) delete 옛것[k];
    상태.실험들 = [옛것];
    await 불러오기열기();
    await userEvent.click(await screen.findByRole("button", { name: `${실험.name} 자산배분 실험 열기` }));
    /* **기본값을 그대로 적지 않는다.** 'none' 이라고 박아 두면 나중에
       기본 벤치마크를 바꿨을 때, '옛 실험은 지금 값을 둔다' 는 뜻은
       그대로인데 검사만 깨진다(실제로 spy 로 바꾸며 깨졌다).
       무엇이 기본인지는 자산배분.test 가 따로 본다. */
    const 기본 = 첫설정();
    await 고급열기();
    expect(await screen.findByLabelText("리밸런싱 날짜"))
      .toHaveValue(String(기본.rebalance_day));
    expect(screen.getByLabelText("벤치 마크")).toHaveValue(기본.benchmark);
  }, 20000);
});

describe("지우기는 불러오기 창에서 한다", () => {
  /* getByLabelText 가 아니라 **getByRole** 로 찾는다.
     getByLabelText 는 화면에서 안 보이는 요소도 찾아 준다 — 버튼에
     hidden 을 붙여도 통과했다(뮤테이션에서 그대로 살아남았다).
     getByRole 은 접근성 트리를 보므로 안 보이면 못 찾는다. */
  it("바로 안 지우고 확인 창을 띄운다", async () => {
    /* 누르는 즉시 사라지면 잘못 눌렀을 때 되살릴 방법이 없다 —
       설정만 저장하므로 자산·비중·기간을 전부 다시 맞춰야 한다. */
    상태.실험들 = [실험];
    await 불러오기열기();
    await userEvent.click(await screen.findByRole("button", { name: `${실험.name} 지우기` }));

    expect(screen.getByText(/지울까요/), "확인 없이 바로 지웠다").toBeInTheDocument();
    expect(screen.getByText(/되돌릴 수 없어요/)).toBeInTheDocument();
  }, 20000);

  it("지우기를 눌러도 그 실험이 안 열린다", async () => {
    상태.실험들 = [실험];
    await 불러오기열기();
    await userEvent.click(await screen.findByRole("button", { name: `${실험.name} 지우기` }));
    expect(screen.getByText(/지울까요/)).toBeInTheDocument();
    // 안 열렸으면 창과 그 줄이 그대로 있다
    expect(screen.getByRole("button", { name: `${실험.name} 자산배분 실험 열기` })).toBeInTheDocument();
  }, 20000);

  it("확인을 누르면 지운다", async () => {
    const { backtestApi } = await import("@/api/stocks");
    상태.실험들 = [실험];
    await 불러오기열기();
    await userEvent.click(await screen.findByRole("button", { name: `${실험.name} 지우기` }));
    await userEvent.click(screen.getByRole("button", { name: "지우기" }));
    expect(backtestApi.deleteExperiment).toHaveBeenCalledWith(실험.id);
  }, 20000);

  it("취소하면 안 지운다", async () => {
    const { backtestApi } = await import("@/api/stocks");
    상태.실험들 = [실험];
    await 불러오기열기();
    await userEvent.click(await screen.findByRole("button", { name: `${실험.name} 지우기` }));
    await userEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.queryByText(/지울까요/)).toBeNull();
    expect(backtestApi.deleteExperiment).not.toHaveBeenCalled();
  }, 20000);

  it("매매 전략도 지운다 — 묻고 나서", async () => {
    const { backtestApi } = await import("@/api/stocks");
    상태.전략들 = [전략];
    await 불러오기열기();
    await userEvent.click(칩(/매매 전략/));
    await userEvent.click(await screen.findByRole("button", { name: `${전략.name} 지우기` }));
    expect(backtestApi.deleteStrategy).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "지우기" }));
    expect(backtestApi.deleteStrategy).toHaveBeenCalledWith(전략.id);
  }, 20000);
});
