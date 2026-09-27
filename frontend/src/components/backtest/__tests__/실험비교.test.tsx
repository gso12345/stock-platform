/**
 * 저장한 실험 견주기 — 고른 것을 **저장한 설정 그대로** 돌리고,
 * 한 표에 놓고, 줄마다 나은 쪽을 옳게 고르는가.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

let 응답들: Record<string, () => Promise<any>> = {};
const 받은요청: any[] = [];
vi.mock("@/api/stocks", async (원본) => ({
  ...(await 원본<any>()),
  backtestApi: {
    runPortfolio: (p: any) => { 받은요청.push(p); return 응답들[p.start_date](); },
  },
}));

import 실험비교, { 제일나은, 비교요청, 최대비교 } from "../ExperimentCompare";

const 실험 = (id: number, name: string, start: string, 더: any = {}) => ({
  id, name, currency: "KRW", initial_amount: 1000, start_date: start, end_date: "2024-12-31",
  assets: [{ symbol: "SPY", market: "US", name: "SPY", weight: 100 }],
  contribution_period: "monthly", contribution_amount: 10, rebalance_period: "yearly",
  total_return: true, rebalance_day: 3, cost_rate: 0.1, benchmark: "qqq",
  equal_weight: false, extended: false, cash_rate: 0, risk_free_rate: 2, ...더,
}) as any;

const 결과 = (더: any) => ({
  start_date: "2015-01-02", end_date: "2024-12-31", currency: "KRW",
  final_value: 100, total_return: 10, twr_annual: 5, mdd: 20, volatility: 15,
  sharpe: 0.5, sortino: 0.7, worst_month: -5, yearly: [], ...더,
});

function 그리기(실험들: any[]) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><실험비교 실험들={실험들} /></QueryClientProvider>);
}

beforeEach(() => { 받은요청.length = 0; 응답들 = {}; });

describe("실험 견주기", () => {
  it("실험이 하나뿐이면 아예 안 뜬다", () => {
    const { container } = 그리기([실험(1, "가", "2015-01-01")]);
    expect(container.textContent).toBe("");
  });

  it("저장한 설정 그대로 보내되 벤치마크만 끈다", () => {
    const 요청 = 비교요청(실험(1, "가", "2015-01-01"));
    expect(요청).toMatchObject({
      start_date: "2015-01-01", initial_amount: 1000, contribution_period: "monthly",
      contribution_amount: 10, rebalance_period: "yearly", rebalance_day: 3, cost_rate: 0.1,
      risk_free_rate: 2, total_return: true, benchmark: "none",
    });
  });

  it("고른 것을 돌려 한 표에 놓고, 나은 쪽을 표시한다 — 낙폭은 작은 쪽", async () => {
    응답들 = {
      "2015-01-01": () => Promise.resolve(결과({ final_value: 500, twr_annual: 7, mdd: 30, yearly: [{ year: 2020, return: 3 }] })),
      "2016-01-01": () => Promise.resolve(결과({ twr_annual: 5, mdd: 12, yearly: [{ year: 2020, return: 9 }] })),
    };
    그리기([실험(1, "공격", "2015-01-01"), 실험(2, "방어", "2016-01-01"), 실험(3, "안고름", "2017-01-01")]);
    fireEvent.click(screen.getByRole("button", { name: "공격" }));
    fireEvent.click(screen.getByRole("button", { name: "방어" }));
    fireEvent.click(screen.getByRole("button", { name: "견주기" }));

    await screen.findByText("연 수익률");
    expect(받은요청.map((r) => r.start_date)).toEqual(["2015-01-01", "2016-01-01"]);
    const 줄 = (이름: string) => screen.getByText(이름).closest("tr")!;
    const 칸 = (이름: string) => [...줄(이름).querySelectorAll("td")].slice(1);
    expect(칸("연 수익률").map((x) => x.hasAttribute("data-best"))).toEqual([true, false]);
    expect(칸("최대 낙폭").map((x) => x.hasAttribute("data-best"))).toEqual([false, true]);
    expect(칸("2020년").map((x) => x.hasAttribute("data-best"))).toEqual([false, true]);
    // 최종 평가액은 넣은 돈이 달라 고르지 않는다
    expect(칸("최종 평가액").some((x) => x.hasAttribute("data-best"))).toBe(false);
  });

  it("하나가 실패해도 나머지는 보여 주고, 실패한 칸에 이유를 적는다", async () => {
    응답들 = {
      "2015-01-01": () => Promise.resolve(결과({ twr_annual: 7 })),
      "2016-01-01": () => Promise.reject({ response: { status: 400, data: { detail: "SPY 시세를 못 받았어요" } } }),
    };
    그리기([실험(1, "가", "2015-01-01"), 실험(2, "나", "2016-01-01")]);
    fireEvent.click(screen.getByRole("button", { name: "가" }));
    fireEvent.click(screen.getByRole("button", { name: "나" }));
    fireEvent.click(screen.getByRole("button", { name: "견주기" }));
    expect(await screen.findByText("SPY 시세를 못 받았어요")).toBeTruthy();
    expect(screen.getByText("7%")).toBeTruthy();
  });

  it(`${최대비교}개보다 많이는 못 고른다`, () => {
    const 여럿 = Array.from({ length: 최대비교 + 1 }, (_, i) => 실험(i + 1, `실험${i + 1}`, `201${i}-01-01`));
    그리기(여럿);
    for (const x of 여럿) fireEvent.click(screen.getByRole("button", { name: x.name }));
    const 켜진것 = 여럿.filter((x) => screen.getByRole("button", { name: x.name }).getAttribute("aria-pressed") === "true");
    expect(켜진것).toHaveLength(최대비교);
  });

  it("하나만 고르면 견주기를 못 누른다", () => {
    그리기([실험(1, "가", "2015-01-01"), 실험(2, "나", "2016-01-01")]);
    fireEvent.click(screen.getByRole("button", { name: "가" }));
    expect((screen.getByRole("button", { name: "견주기" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("제일나은", () => {
  it("값이 하나뿐이거나 다 같으면 아무도 안 고른다", () => {
    expect(제일나은([5, null], "큰").size).toBe(0);
    expect(제일나은([5, 5], "큰").size).toBe(0);
    expect([...제일나은([1, 3, 3], "큰")]).toEqual([1, 2]);
    expect([...제일나은([4, 2, null], "작은")]).toEqual([1]);
  });
});
