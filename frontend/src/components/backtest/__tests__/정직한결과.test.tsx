/**
 * 백테스트 결과는 **무엇을 쟀는지 스스로 말해야 한다.**
 *
 * 전체 점검에서 나온 것 중 화면이 맡은 몫을 여기서 못 박는다.
 * 계산이 맞는 것과 사람이 그 수를 제대로 읽는 것은 다른 문제다 —
 * 아래 셋은 전부 '수는 맞는데 화면이 말을 안 해서' 오해를 부르던
 * 자리들이다.
 *
 *   ① 유니버스가 **오늘 살아남은 종목만** 잰다는 사실
 *   ② 승률이 **수수료를 뺀** 손익으로 센 것이라는 사실
 *   ③ 샤프가 **무위험 몇 %를 뺀** 수라는 사실
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const 상태 = vi.hoisted(() => ({
  단일결과: null as any,
  유니버스결과: null as any,
}));

vi.mock("@/api/stocks", () => ({
  backtestApi: {
    getStrategies: vi.fn(() => Promise.resolve([])),
    getExperiments: vi.fn(() => Promise.resolve([])),
    run: vi.fn(() => Promise.resolve(상태.단일결과)),
    runUniverse: vi.fn(() => Promise.resolve(상태.유니버스결과)),
    saveStrategy: vi.fn(), deleteStrategy: vi.fn(), runPortfolio: vi.fn(),
    saveExperiment: vi.fn(), deleteExperiment: vi.fn(),
  },
}));
vi.mock("@/store/authStore", () => ({
  useAuthStore: () => ({ isLoggedIn: true, userId: 1 }),
}));
vi.mock("@/hooks/useStockSearch", () => ({
  useStockSearch: () => ({ query: "", setQuery: vi.fn(), searching: false, results: [] }),
}));

import Backtest from "@/pages/Backtest";

const 거래 = (덮을것 = {}) => ({
  type: "청산", entry_date: "2020-03-02", exit_date: "2020-03-09",
  entry_price: 100, exit_price: 100.1, pnl_rate: 0.1,
  net_pnl_rate: -0.4, shares: 95, ...덮을것,
});

const 단일 = {
  start_date: "2020-01-02", end_date: "2024-12-30", years: 4.99,
  total_return: 12.3, annual_return: 2.35, mdd: 8.1, sharpe_ratio: 0.71,
  win_rate: 33.3, total_trades: 3, avg_profit: 1.2, avg_loss: -0.8,
  profit_factor: 1.4, costs: 47_381, cost_rate: 0.0025,
  risk_free_rate: 0,
  equity_curve: [{ date: "2020-01-02", value: 10_000_000 },
                 { date: "2024-12-30", value: 11_230_000 }],
  trades: [거래()],
  buy_and_hold: null,
};

function 그리기() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}><Backtest /></QueryClientProvider>
    </MemoryRouter>,
  );
}

async function 단일돌리기(결과 = 단일) {
  상태.단일결과 = 결과;
  그리기();
  await userEvent.click(screen.getByRole("tab", { name: "단일 종목" }));
  await userEvent.click(screen.getByRole("button", { name: /백테스트 실행/ }));
  return await screen.findByText("총 수익률");
}

beforeEach(() => {
  vi.clearAllMocks();
  상태.단일결과 = null;
  상태.유니버스결과 = null;
});


describe("유니버스는 생존 편향을 말한다", () => {
  /* 종목 목록이 '오늘 살아남아 시총 상위에 있는 것들' 316개로 고정돼
     있다. 망했거나 밀려난 회사는 처음부터 없어서 어떤 전략을 넣어도
     실제보다 좋게 나온다. 과거 시점의 구성표가 없으면 **없다고 말하는
     것**이 맞다 — 조용히 두면 사용자는 이 표를 실제 성적으로 읽는다. */

  it("결과 위에 경고가 뜬다", async () => {
    상태.유니버스결과 = {
      universe: "SP500", total_symbols: 316, tested: 300, results: [],
      생존편향: "종목 316개는 **오늘** 기준 목록이에요. 그동안 상장폐지되거나 "
                + "밀려난 회사는 처음부터 빠져 있어서, 실제로 그때 돌렸을 때보다 "
                + "결과가 좋게 나옵니다.",
    };
    그리기();
    await userEvent.click(screen.getByRole("tab", { name: "유니버스 전체" }));
    await userEvent.click(screen.getByRole("button", { name: /유니버스 백테스트/ }));
    expect(await screen.findByText(/상장폐지/),
      "생존 편향을 한 글자도 안 알린다").toBeInTheDocument();
  });

  it("서버가 경고를 안 주면 아무것도 안 그린다", async () => {
    /* 없는 것을 지어내지 않는다 */
    상태.유니버스결과 = {
      universe: "SP500", total_symbols: 316, tested: 300, results: [],
    };
    그리기();
    await userEvent.click(screen.getByRole("tab", { name: "유니버스 전체" }));
    await userEvent.click(screen.getByRole("button", { name: /유니버스 백테스트/ }));
    await screen.findByText(/종목 분석 완료/);
    expect(screen.queryByText(/상장폐지/)).toBeNull();
  });

  it("목록 이름이 'S&P 500' 이라고 우기지 않는다", async () => {
    /* 실제로는 손으로 고른 316개다. 지수 이름을 쓰면 사람은 그 지수
       전부를 잰 줄 안다. */
    그리기();
    await userEvent.click(screen.getByRole("tab", { name: "유니버스 전체" }));
    expect(screen.queryByText(/S&P 500/),
      "손으로 고른 목록에 지수 이름을 붙였다").toBeNull();
    //: 목록이 셋(미국·KOSPI·KOSDAQ)이라 여러 개가 나온다
    expect(screen.getAllByText(/오늘 기준/).length).toBeGreaterThan(0);
  });
});


describe("수수료를 뺀 손익을 같이 보여 준다", () => {
  /* 거래별 손익을 가격만으로 재면, 수수료를 내고 나면 손해인 거래가
     '이긴 거래' 로 잡힌다. 실측으로 승률 100% 에 실제 수익률 -6.74%
     가 같이 찍혔다. */

  it("수수료를 넣었으면 거래마다 순손익 칸이 있다", async () => {
    await 단일돌리기();
    expect(screen.getByText("수수료 뺀 것"),
      "가격 손익만 보여 준다 — 수수료를 내면 손해인 거래가 '이긴 거래' 로 보인다")
      .toBeInTheDocument();
    //: +0.1% 로 이겼는데 수수료를 빼면 -0.4% 다
    expect(screen.getByText("-0.40%")).toBeInTheDocument();
  });

  it("두 칸이 왜 다른지 적어 준다", async () => {
    /* 안 적으면 '숫자가 안 맞는다' 로 읽힌다 */
    await 단일돌리기();
    expect(screen.getByText(/값이 움직인 폭/)).toBeInTheDocument();
  });

  it("수수료가 0 이면 그 칸을 안 그린다", async () => {
    /* 늘 그리면 똑같은 수가 두 번 적힌다 */
    await 단일돌리기({ ...단일, cost_rate: 0, costs: 0,
                       trades: [거래({ net_pnl_rate: 0.1 })] });
    expect(screen.queryByText("수수료 뺀 것")).toBeNull();
  });

  it("승률 옆에 수수료를 반영했다고 적는다", async () => {
    await 단일돌리기();
    expect(screen.getByText("수수료 반영")).toBeInTheDocument();
  });
});


describe("무엇을 가정하고 잰 수인지 적는다", () => {
  it("샤프 옆에 무위험수익률을 적는다", async () => {
    /* 금리 5% 인 해에 연 5% 를 번 전략의 샤프 0.5 는 실제로는
       초과수익 0 이라는 뜻이다. 무엇을 뺐는지 안 적으면 사람이
       자기 기준으로 읽는다. */
    await 단일돌리기();
    expect(screen.getByText("무위험 0% 기준"),
      "샤프가 무엇을 뺀 수인지 안 적는다").toBeInTheDocument();
  });

  it("무위험수익률을 넣었으면 그 값을 적는다", async () => {
    await 단일돌리기({ ...단일, risk_free_rate: 3.5 });
    expect(screen.getByText("무위험 3.5% 기준")).toBeInTheDocument();
  });

  it("시세가 없어 기간이 짧아졌으면 말한다", async () => {
    /* 요청한 기간을 쟀다고 화면이 믿게 두면 안 된다 — 늦게 상장한
       종목이면 앞이 잘린다. */
    await 단일돌리기({ ...단일, start_date: "2022-06-01" });
    expect(screen.getByText(/2022-06-01부터/),
      "요청보다 늦게 시작했는데 아무 말이 없다").toBeInTheDocument();
  });

  it("요청한 대로 쟀으면 괜히 안 적는다", async () => {
    await 단일돌리기();          // 기본 시작일이 2020-01-01 이고 결과는 01-02
    expect(screen.queryByText(/시세가 그 전에는 없음/)).toBeNull();
  });
});
