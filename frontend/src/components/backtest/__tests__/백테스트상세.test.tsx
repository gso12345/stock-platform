/**
 * 백테스트 — 사용자:
 *   1) "백테스팅 결과 나오면 1줄로 접히는데 펼칠수도 있도록 해줘(결과와 설정을 같이 볼 수도 있게)"
 *   2) "단일종목 유니버스도 %로 진행률 확인할 수 있게 해줘"
 *   3) "결과나오면 저장을 어떻게해"
 *   4) "백테스팅 결과를 더 상세분석할 수 있도록 하고 앱느낌나도록 사용자편의성과 디자인을 업데이트해줘"
 *
 * 여기서 못 박는 것 —
 *   1) 한 줄 요약을 누르면 **결과를 낸 설정**이 펼쳐진다(조건은 글로) — 다시 누르면 접힌다. 편집 칸을 열어도 '설정
 *      접기' 로 다시 한 줄로
 *   2) 단일 종목·유니버스도 진행 열쇠를 실어 보내고, 서버가 적어 주는 진행을 %로(종목 37/311)
 *   3) 결과 머리에 '결과 저장' — 결과를 낸 종목·기간·자본까지 담고, 불러오면 그 백테스트가 그대로(단일은 바로 돈다)
 *   4) 단일 결과는 칩(요약·낙폭·기간별·거래), 거래 분석·달마다 표·CSV. 유니버스는 이름·요약·분포·다시 세우기·
 *      눌러서 그 종목 하나를 자세히
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const 상태 = vi.hoisted(() => ({
  로그인함: true,
  단일결과: null as any,
  유니버스결과: null as any,
  배분결과: null as any,
  전략들: [] as any[],
  돌린것: [] as any[],
  유니버스돌린것: [] as any[],
  진행: null as any,
  내려받은것: [] as { 이름: string; 줄들: unknown[][] }[],
}));

vi.mock("@/api/stocks", () => ({
  backtestApi: {
    getStrategies: vi.fn(() => Promise.resolve(상태.전략들)),
    getExperiments: vi.fn(() => Promise.resolve([])),
    run: vi.fn((p: any) => { 상태.돌린것.push(p); return Promise.resolve(상태.단일결과); }),
    runUniverse: vi.fn((p: any) => { 상태.유니버스돌린것.push(p); return Promise.resolve(상태.유니버스결과); }),
    runPortfolio: vi.fn(() => Promise.resolve(상태.배분결과)),
    getProgress: vi.fn(() => Promise.resolve(상태.진행)),
    getPortfolioProgress: vi.fn(() => Promise.resolve(null)),
    saveStrategy: vi.fn(() => Promise.resolve({ id: 1 })),
    saveExperiment: vi.fn(() => Promise.resolve({ id: 2 })),
    deleteStrategy: vi.fn(), deleteExperiment: vi.fn(),
  },
}));
vi.mock("@/store/authStore", () => ({
  useAuthStore: () => ({ isLoggedIn: 상태.로그인함, userId: 1 }),
}));
vi.mock("@/hooks/useStockSearch", () => ({
  useStockSearch: () => ({ query: "", setQuery: vi.fn(), searching: false, results: [] }),
}));
vi.mock("@/utils/csv", async (원래) => ({
  ...(await (원래() as Promise<object>)),
  csv내려받기: vi.fn((이름: string, 줄들: unknown[][]) => { 상태.내려받은것.push({ 이름, 줄들 }); }),
}));

import Backtest from "@/pages/Backtest";
import { backtestApi } from "@/api/stocks";
import { 칸나누기, 거래분석, 유니버스요약하기, 돌린설정읽기, 거래경계 } from "../분석";
import { 조건글, 조건묶음글 } from "../ConditionBuilder";
import { 진행막대, 서버아래말 } from "../진행막대";
import { 세우기 } from "../유니버스결과화면";
import { 돌린말 } from "../불러오기창";
import { 달칸글, 달칸글짧게, 달마다표 } from "../분석부품";
import 자산배분탭 from "../AllocationTab";
import { 공유주소 } from "../결과공유";
import { 첫설정 } from "../AllocationForm";

/* ── 결과 견본 ── */
const 거래 = (진입: string, 청산: string, 손익: number, 순?: number) => ({
  type: "청산", entry_date: 진입, exit_date: 청산, entry_price: 100, exit_price: 100 + 손익,
  pnl_rate: 손익, net_pnl_rate: 순 ?? 손익, shares: 10,
});
const 단일 = {
  start_date: "2021-01-04", end_date: "2023-12-29", years: 3,
  total_return: 12.3, annual_return: 3.9, mdd: 8.1, sharpe_ratio: 0.9, win_rate: 66.7, total_trades: 3,
  avg_profit: 6, avg_loss: -3, profit_factor: 2, costs: null, cost_rate: null, risk_free_rate: 0,
  equity_curve: [{ date: "2021-01-04", value: 10_000_000 }, { date: "2022-06-01", value: 10_500_000 },
                 { date: "2023-12-29", value: 11_230_000 }],
  trades: [거래("2021-02-01", "2021-03-01", 8), 거래("2021-05-03", "2021-05-13", -3), 거래("2022-01-03", "2022-02-02", 4)],
  buy_and_hold: { total_return: 20, annual_return: 6, mdd: 30, sharpe_ratio: 0.5, curve: [10_000_000, 11_000_000, 12_000_000] },
  analysis: {
    drawdown: [{ date: "2021-01-04", dd: 0 }, { date: "2022-06-01", dd: -8.1 }, { date: "2023-12-29", dd: 0 }],
    drawdowns: [{ start: "2021-12-01", trough: "2022-06-01", end: "2023-03-02", depth: -8.1, underwater_days: 456 }],
    yearly: [{ year: 2021, return: 4.2 }, { year: 2022, return: -1.5 }, { year: 2023, return: 9.1 }],
    monthly: [{ month: "2021-02", return: 2.5 }, { month: "2021-03", return: -12.34 }, { month: "2022-07", return: 0.4 }],
    buy_and_hold: { drawdown: [{ date: "2021-01-04", dd: 0 }, { date: "2022-06-01", dd: -30 }],
                    yearly: [{ year: 2021, return: 10 }, { year: 2022, return: -20 }, { year: 2023, return: 30 }] },
  },
};
const 유니버스 = {
  universe: "KOSPI", total_symbols: 30, tested: 3,
  results: [
    { symbol: "005930.KS", name: "삼성전자", market: "KR", total_return: 40, annual_return: 12, mdd: 20,
      sharpe_ratio: 0.8, win_rate: 60, total_trades: 10, profit_factor: 1.5 },
    { symbol: "000660.KS", name: "SK하이닉스", market: "KR", total_return: 25, annual_return: 8, mdd: 35,
      sharpe_ratio: 1.4, win_rate: 70, total_trades: 8, profit_factor: 2.1 },
  ],
  all_returns: [40, 25, -10],
  생존편향: "종목 30개는 오늘 기준 목록이에요. 상장폐지된 회사는 빠져 있어요.",
};

function 그리기(처음 = "/backtest") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[처음]}>
      <QueryClientProvider client={qc}><Backtest /></QueryClientProvider>
    </MemoryRouter>,
  );
}
const 단일탭 = () => userEvent.click(screen.getByRole("tab", { name: "단일 종목" }));
const 유니버스탭 = () => userEvent.click(screen.getByRole("tab", { name: "유니버스" }));
const 실행 = () => userEvent.click(screen.getByRole("button", { name: /백테스트 실행/ }));
async function 단일돌리기() {
  그리기();
  await 단일탭();
  fireEvent.change(screen.getByLabelText("시작일"), { target: { value: "2021-01-04" } });
  fireEvent.change(screen.getByLabelText("종료일"), { target: { value: "2023-12-29" } });
  await 실행();
  await screen.findByText("성과");
}
async function 유니버스돌리기() {
  그리기();
  await 유니버스탭();
  await userEvent.click(screen.getByRole("button", { name: /KOSPI 대형주/ }));
  await userEvent.click(screen.getByRole("button", { name: /유니버스 백테스트/ }));
  await screen.findByText("유니버스 백테스트 결과");
}

beforeEach(() => {
  vi.clearAllMocks();
  상태.로그인함 = true;
  상태.단일결과 = 단일; 상태.유니버스결과 = 유니버스; 상태.전략들 = [];
  상태.돌린것 = []; 상태.유니버스돌린것 = []; 상태.진행 = null; 상태.내려받은것 = [];
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });


/* ═════════════════════════ 계산 ═════════════════════════ */

describe("계산 — 분석.ts", () => {
  it("칸나누기 — 왼쪽 포함, 끝 칸은 미만·이상, 0 이하 칸은 아래", () => {
    const 칸 = 칸나누기([-30, -10, -0.1, 0, 4.9, 5, 50], [-10, 0, 5]);
    expect(칸.map((c) => [c.이름, c.수, c.아래])).toEqual([
      ["-10% 미만", 1, true], ["-10~0%", 2, true], ["0~+5%", 2, false], ["+5% 이상", 2, false]]);
  });

  it("거래분석 — 수수료 뺀 손익으로 이기고 진 것을 센다", () => {
    const 통 = 거래분석([거래("2021-01-04", "2021-01-14", 0.1, -0.4), 거래("2021-02-01", "2021-03-03", 10, 9.5),
                       거래("2021-04-01", "2021-04-02", -5, -5.5)], { 시작: "2021-01-04", 끝: "2021-12-31" });
    expect([통.건수, 통.이긴수, 통.진수]).toEqual([3, 1, 2]);
    expect(통.평균이익).toBeCloseTo(9.5);
    expect(통.평균손실).toBeCloseTo(-2.95);                       // (-0.4 + -5.5) / 2 — 가격으론 이긴 첫 거래도 진 거래
    expect(통.손익비).toBeCloseTo(9.5 / 2.95);
    expect(통.최고?.entry_date).toBe("2021-02-01");
    expect(통.최저?.entry_date).toBe("2021-04-01");
    expect(통.평균보유일).toBeCloseTo((10 + 30 + 1) / 3);
    expect(통.최장연승).toBe(1);
    expect(통.최장연패).toBe(1);
    expect(통.보유비율).toBeCloseTo((41 / 361) * 100);
    expect(통.분포.reduce((a, c) => a + c.수, 0)).toBe(3);
    expect(통.분포).toHaveLength(거래경계.length + 1);
  });

  it("거래분석 — 연승·연패는 이어진 것만", () => {
    const 통 = 거래분석([1, 2, -1, 3, 4, 5, -2, -3].map((v, i) => 거래(`2021-01-0${(i % 9) + 1}`, "2021-01-10", v)));
    expect([통.최장연승, 통.최장연패]).toEqual([3, 2]);
  });

  it("거래분석 — 거래가 없으면 못 잰 값(null)이지 0 이 아니다", () => {
    const 통 = 거래분석([], { 시작: "2021-01-01", 끝: "2021-12-31" });
    expect([통.평균이익, 통.평균손실, 통.손익비, 통.최고, 통.평균보유일, 통.보유비율]).toEqual([null, null, null, null, null, null]);
  });

  it("거래분석 — 진 거래가 없으면 손익비는 null(무한대)", () => {
    expect(거래분석([거래("2021-01-04", "2021-01-05", 3)]).손익비).toBeNull();
  });

  it("거래분석 — 수수료 빼고 0% 인 거래는 이긴 것이 아니다(서버 승률과 같은 기준)", () => {
    const 통 = 거래분석([거래("2021-01-04", "2021-01-05", 5), 거래("2021-01-06", "2021-01-07", 0.3, 0)]);
    expect([통.이긴수, 통.진수]).toEqual([1, 1]);
    /* 진 거래의 평균이 0 이면 나눌 수 없다 — 무한대를 숫자로 내지 않는다 */
    expect(통.손익비).toBeNull();
  });

  it("거래분석 — 기간을 모르면 '시장에 있던 기간' 은 못 잰다", () => {
    expect(거래분석([거래("2021-01-04", "2021-02-04", 5)]).보유비율).toBeNull();
  });

  it("유니버스요약 — 가운데값(홀·짝)·플러스 몫·평균·최고·최저", () => {
    expect(유니버스요약하기([40, 25, -10])).toMatchObject({ 수: 3, 플러스: 2, 가운데값: 25, 평균: 55 / 3, 최고: 40, 최저: -10 });
    expect(유니버스요약하기([1, 2, 3, 10]).가운데값).toBe(2.5);
    expect(유니버스요약하기([1, -1]).플러스비율).toBe(50);
    expect(유니버스요약하기([])).toMatchObject({ 수: 0, 가운데값: null, 평균: null, 플러스비율: null });
  });

  it("돌린설정읽기 — 믿을 수 있는 것만", () => {
    const 단일설정 = { kind: "single", symbol: "005930", market: "KR", name: "삼성전자", start_date: "2021-01-04",
                     end_date: "2023-12-29", capital: 5_000_000, position_size: 80, cost_rate: 0.1 };
    expect(돌린설정읽기(단일설정)).toEqual(단일설정);
    expect(돌린설정읽기({ ...단일설정, kind: "x" })).toBeNull();
    expect(돌린설정읽기({ ...단일설정, start_date: "2024-01-01" })).toBeNull();          // 시작 > 끝
    expect(돌린설정읽기({ ...단일설정, capital: 10 })).toBeNull();
    expect(돌린설정읽기({ ...단일설정, symbol: "<script>" })).toBeNull();
    expect(돌린설정읽기({ ...단일설정, market: "JP" })).toBeNull();
    expect(돌린설정읽기({ ...단일설정, name: "" })?.name).toBe("005930");
    expect(돌린설정읽기(null)).toBeNull();
    expect(돌린설정읽기({ kind: "universe", universe: "KOSPI", start_date: "2021-01-04", end_date: "2023-12-29",
      capital: 5_000_000, position_size: 80, cost_rate: 0 })).toMatchObject({ rank_by: "total_return", top_n: 20 });
    expect(돌린설정읽기({ kind: "universe", universe: "NASDAQ", start_date: "2021-01-04", end_date: "2023-12-29",
      capital: 5_000_000, position_size: 80, cost_rate: 0 })).toBeNull();
  });

  it("조건글 — 편집 칸과 같은 이름표로", () => {
    expect(조건글({ indicator: "MA", operator: "crosses_above", value: "EMA", period: 20 })).toBe("MA 이동평균(20) ↑ 돌파 EMA 지수이평");
    expect(조건글({ indicator: "RSI", operator: ">", value: 70, period: 14 })).toBe("RSI (14) > 70");
    expect(조건묶음글({ logic: "AND", conditions: [] })).toBe("없음");
    const 둘 = [{ indicator: "RSI" as const, operator: "<" as const, value: 30 }, { indicator: "PRICE" as const, operator: ">" as const, value: 1 }];
    expect(조건묶음글({ logic: "AND", conditions: 둘 })).toBe("RSI (14) < 30 그리고 종가 > 1");
    expect(조건묶음글({ logic: "OR", conditions: 둘 })).toBe("RSI (14) < 30 또는 종가 > 1");
  });

  it("세우기 — 낙폭만 작은 것이 앞, 못 잰 값은 늘 뒤", () => {
    const 줄 = (s: string, v: number | null, m: number | null) =>
      ({ symbol: s, market: "US", total_return: v, annual_return: null, mdd: m, sharpe_ratio: null,
         win_rate: null, total_trades: 1, profit_factor: null });
    const 줄들 = [줄("A", 10, 30), 줄("B", null, null), 줄("C", 50, 5)];
    expect(세우기(줄들, "total_return").map((x) => x.symbol)).toEqual(["C", "A", "B"]);
    expect(세우기(줄들, "mdd").map((x) => x.symbol)).toEqual(["C", "A", "B"]);
  });

  it("달칸글 — 10% 넘으면 소수점을 뗀다", () => {
    expect([달칸글(2.5), 달칸글(-12.34), 달칸글(9.94), 달칸글(9.96), 달칸글(0)]).toEqual(["+2.5", "-12", "+9.9", "+10", "0.0"]);
    /* 반올림해 0 이면 '-0.0'·'+0.0' 이 아니라 '0.0' — PC 화면에서 '-0.0' 이 찍혀 있었다 */
    expect([달칸글(-0.04), 달칸글(0.04), 달칸글(-0.05), 달칸글(0.06)]).toEqual(["0.0", "0.0", "-0.1", "+0.1"]);
  });

  it("달칸글짧게 — 폰은 열세 칸이 한 줄에: 정수, '+' 없이, 반올림해 0 이면 '-0' 이 아니라 '0'", () => {
    expect([달칸글짧게(2.5), 달칸글짧게(-12.34), 달칸글짧게(0.4), 달칸글짧게(-0.4), 달칸글짧게(-0.6), 달칸글짧게(123.4)])
      .toEqual(["3", "-12", "0", "0", "-1", "123"]);
  });
});

describe("달마다표 — 화면 폭에 따라 칸 글", () => {
  const 달들 = [{ month: "2021-02", return: 2.5 }, { month: "2021-03", return: -0.4 }];
  const 폭 = (넓음: boolean) => vi.stubGlobal("matchMedia", (q: string) => ({
    matches: 넓음 && q.includes("min-width"), media: q, addEventListener: () => {}, removeEventListener: () => {},
  }));

  it("폰 — 짧게(정수), 읽어 주기·title 에는 정확한 값", () => {
    폭(false);
    render(<달마다표 monthly={달들} yearly={[{ year: 2021, return: 2.09 }]} />);
    const 칸 = screen.getByLabelText("2021-02 +2.50%");
    expect(칸).toHaveTextContent(/^3$/);
    expect(칸).toHaveAttribute("title", "2021-02 +2.50%");
    expect(screen.getByLabelText("2021-03 -0.40%")).toHaveTextContent(/^0$/);
    expect(screen.getByLabelText("2021년 +2.09%")).toHaveTextContent(/^2$/);
  });

  it("넓은 화면 — 소수 한 자리와 부호", () => {
    폭(true);
    render(<달마다표 monthly={달들} yearly={[{ year: 2021, return: 2.09 }]} />);
    expect(screen.getByLabelText("2021-02 +2.50%")).toHaveTextContent(/^\+2\.5$/);
    expect(screen.getByLabelText("2021-03 -0.40%")).toHaveTextContent(/^-0\.4$/);
    expect(screen.getByLabelText("2021년 +2.09%")).toHaveTextContent(/^\+2\.1$/);
  });
});


/* ═════════════════════════ 2) 진행률 ═════════════════════════ */

describe("2) 진행률 %", () => {
  it("단일 종목 — 진행 열쇠를 실어 보내고 서버가 적은 진행을 %로", async () => {
    상태.진행 = { 단계: "시세", done: 0, total: 1, 글: "AAPL 시세를 받는 중", percent: 42 };
    vi.mocked(backtestApi.run).mockImplementationOnce((p: any) => { 상태.돌린것.push(p); return new Promise(() => {}); });
    그리기();
    await 단일탭();
    await 실행();
    expect(await screen.findByText("42%")).toBeInTheDocument();
    expect(screen.getByText("AAPL 시세를 받는 중…")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "계산 진행률" }).getAttribute("aria-valuenow")).toBe("42");
    expect(상태.돌린것[0].progress_key).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(backtestApi.getProgress).toHaveBeenCalledWith(상태.돌린것[0].progress_key);
  });

  it("유니버스 — 종목 몇 개 중 몇 개", async () => {
    상태.진행 = { 단계: "종목", done: 37, total: 311, 글: "AAPL 돌리는 중", percent: 12 };
    vi.mocked(backtestApi.runUniverse).mockImplementationOnce((p: any) => { 상태.유니버스돌린것.push(p); return new Promise(() => {}); });
    그리기();
    await 유니버스탭();
    await userEvent.click(screen.getByRole("button", { name: /유니버스 백테스트/ }));
    expect(await screen.findByText("종목 37/311")).toBeInTheDocument();
    expect(screen.getByText("12%")).toBeInTheDocument();
    expect(상태.유니버스돌린것[0].progress_key).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });

  it("돌릴 때마다 새 열쇠 — 같은 열쇠면 앞 요청의 진행이 남아 막대가 중간에서 시작한다", async () => {
    await 단일돌리기();
    await userEvent.click(screen.getByRole("button", { name: "설정 바꾸기" }));
    await 실행();
    await waitFor(() => expect(상태.돌린것).toHaveLength(2));
    expect(상태.돌린것[0].progress_key).not.toBe(상태.돌린것[1].progress_key);
  });

  it("진행막대 — 서버 값이 어림보다 낮아도 뒤로 안 간다, 묻다가 터져도 막대는 산다", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const 물어보기 = vi.fn().mockRejectedValueOnce(new Error("끊김")).mockResolvedValue(
      { 단계: "시세", done: 0, total: 1, 글: "받는 중", percent: 1 });
    render(<진행막대 열쇠="key0000001" 예상={2} 물어보기={물어보기} 어림글={() => "어림"} 아래글={() => "아래"} />);
    await vi.advanceTimersByTimeAsync(1900);
    const 값 = Number(screen.getByRole("progressbar").getAttribute("aria-valuenow"));
    // 어림 0.95초/2초 * 0.7 의 절반쯤보다 낮게 가지 않는다(서버 1%)
    expect(값).toBeGreaterThan(1);
    expect(값).toBeLessThanOrEqual(99);
    expect(물어보기.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("서버아래말 — 여럿을 세면 n/N, 한 번이면 '하는 중'", () => {
    expect(서버아래말({ 단계: "종목", done: 3, total: 10, 글: "", percent: 30 })).toBe("종목 3/10");
    expect(서버아래말({ 단계: "시세", done: 0, total: 1, 글: "", percent: 0 })).toBe("시세 하는 중");
  });
});


/* ═════════════════════════ 1) 펼치고 접기 ═════════════════════════ */

describe("1) 한 줄로 접힌 설정을 펼치고 접는다", () => {
  it("요약을 누르면 이 결과를 낸 설정이 펼쳐지고(조건은 글로), 결과는 그대로 — 다시 누르면 접힌다", async () => {
    await 단일돌리기();
    const 펼치기 = screen.getByRole("button", { name: /설정 펼치기/ });
    expect(펼치기.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(펼치기);
    expect(펼치기.getAttribute("aria-expanded")).toBe("true");
    const 목록 = document.getElementById(펼치기.getAttribute("aria-controls")!)!;
    expect(within(목록).getByText("Apple · AAPL")).toBeInTheDocument();
    expect(within(목록).getByText("2021.01.04 ~ 2023.12.29")).toBeInTheDocument();
    expect(within(목록).getByText("MA 이동평균(20) ↑ 돌파 EMA 지수이평")).toBeInTheDocument();
    expect(within(목록).getByText("RSI (14) > 70")).toBeInTheDocument();
    expect(within(목록).getByText("1000만원")).toBeInTheDocument();
    expect(screen.getByText("성과"), "펼쳤더니 결과가 사라졌다").toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /설정 접기/ }));
    expect(document.getElementById(펼치기.getAttribute("aria-controls")!)).toBeNull();
  });

  it("펼친 목록은 '지금 칸' 이 아니라 결과를 낸 설정이다", async () => {
    await 단일돌리기();
    await userEvent.click(screen.getByRole("button", { name: "설정 바꾸기" }));
    await userEvent.click(screen.getByLabelText("100만원"));            // 결과가 나온 뒤 칸을 고친다
    await userEvent.click(screen.getByRole("button", { name: /^설정 접기/ }));
    await userEvent.click(screen.getByRole("button", { name: /설정 펼치기/ }));
    expect(screen.getByText("1000만원"), "고치다 만 값이 결과의 설정처럼 보인다").toBeInTheDocument();
  });

  it("편집 칸을 연 뒤에도 '설정 접기' 로 다시 한 줄 — 결과가 없거나 도는 중이면 없다", async () => {
    그리기();
    await 단일탭();
    expect(screen.queryByRole("button", { name: /^설정 접기/ }), "결과가 없는데 접기가 있다").toBeNull();
    fireEvent.change(screen.getByLabelText("시작일"), { target: { value: "2021-01-04" } });
    await 실행();
    await screen.findByText("성과");
    await userEvent.click(screen.getByRole("button", { name: "설정 바꾸기" }));
    expect(screen.getByRole("button", { name: /백테스트 실행/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^설정 접기/ }));
    expect(screen.queryByRole("button", { name: /백테스트 실행/ })).toBeNull();
    expect(screen.getByRole("button", { name: "설정 바꾸기" })).toBeInTheDocument();
  });

  it("유니버스도 펼치면 목록·순위 기준이 보인다", async () => {
    await 유니버스돌리기();
    await userEvent.click(screen.getByRole("button", { name: /설정 펼치기/ }));
    expect(screen.getByText("KOSPI 대형주 (오늘 기준)")).toBeInTheDocument();
    expect(screen.getByText("총수익률 상위 20개")).toBeInTheDocument();
  });
});


/* ═════════════════════════ 3) 결과에서 저장 ═════════════════════════ */

describe("3) 결과 화면에서 저장", () => {
  it("결과 머리의 '결과 저장' — 결과를 낸 종목·기간·자본·조건까지 담는다", async () => {
    await 단일돌리기();
    await userEvent.click(screen.getByRole("button", { name: "결과 저장" }));
    const 이름 = screen.getByLabelText("이름");
    expect(이름).toHaveValue("Apple 전략");
    await userEvent.clear(이름);
    await userEvent.type(이름, "애플 이평{Enter}");
    await waitFor(() => expect(backtestApi.saveStrategy).toHaveBeenCalledTimes(1));
    expect(vi.mocked(backtestApi.saveStrategy).mock.calls[0][0]).toMatchObject({
      name: "애플 이평", market: "US",
      entry_conditions: { logic: "AND" }, exit_conditions: { logic: "OR" },
      run_settings: { kind: "single", symbol: "AAPL", market: "US", name: "Apple", start_date: "2021-01-04",
                      end_date: "2023-12-29", capital: 10_000_000, position_size: 95, cost_rate: 0 },
    });
    expect(await screen.findByText(/저장했어요/)).toBeInTheDocument();
  });

  it("로그인 전이면 창 대신 왜 안 되는지 말한다", async () => {
    상태.로그인함 = false;
    await 단일돌리기();
    await userEvent.click(screen.getByRole("button", { name: "결과 저장" }));
    expect(await screen.findByText(/결과를 저장하려면 로그인이 필요해요/)).toBeInTheDocument();
    expect(screen.queryByLabelText("이름")).toBeNull();
  });

  it("유니버스 결과도 저장 — 목록·순위 기준·상위 N 까지", async () => {
    await 유니버스돌리기();
    await userEvent.click(screen.getByRole("button", { name: "결과 저장" }));
    await userEvent.type(screen.getByLabelText("이름"), "{Enter}");
    await waitFor(() => expect(backtestApi.saveStrategy).toHaveBeenCalledTimes(1));
    expect(vi.mocked(backtestApi.saveStrategy).mock.calls[0][0]).toMatchObject({
      market: "KR", run_settings: { kind: "universe", universe: "KOSPI", rank_by: "total_return", top_n: 20 } });
  });

  it("설정 칸의 '저장' 도 종목·기간·자본까지 담는다", async () => {
    그리기();
    await 단일탭();
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await userEvent.type(screen.getByLabelText("이름"), "{Enter}");
    await waitFor(() => expect(backtestApi.saveStrategy).toHaveBeenCalledTimes(1));
    expect(vi.mocked(backtestApi.saveStrategy).mock.calls[0][0].run_settings).toMatchObject({ kind: "single", symbol: "AAPL" });
  });

  it("불러오면 그 백테스트가 그대로 — 단일 종목은 바로 돈다", async () => {
    상태.전략들 = [{ id: 5, name: "삼성 이평", version: 1, market: "KR", created_at: "2026-11-01",
      entry_conditions: { logic: "AND", conditions: [{ indicator: "RSI", operator: "<", value: 30, period: 14 }] },
      exit_conditions: { logic: "OR", conditions: [] }, stop_loss: null, take_profit: null,
      run_settings: { kind: "single", symbol: "005930", market: "KR", name: "삼성전자", start_date: "2021-01-04",
                      end_date: "2023-12-29", capital: 5_000_000, position_size: 80, cost_rate: 0.1 } }];
    그리기();
    await userEvent.click(screen.getByRole("button", { name: "불러오기" }));
    await userEvent.click(within(screen.getByRole("tablist", { name: "불러올 것" })).getByRole("tab", { name: /매매 전략/ }));
    //: 날짜는 짧게(21.01.04) — 한 줄 요약에서 긴 날짜가 금액을 밀어냈다
    expect(await screen.findByText("삼성전자 · 21.01.04 ~ 23.12.29 · 500만원")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "삼성 이평 전략 열기" }));
    await waitFor(() => expect(상태.돌린것).toHaveLength(1));
    expect(상태.돌린것[0]).toMatchObject({ symbol: "005930", market: "KR", start_date: "2021-01-04", end_date: "2023-12-29",
      initial_capital: 5_000_000, position_size: 0.8, cost_rate: 0.1 });
    expect(screen.getByRole("tab", { name: "단일 종목" }).getAttribute("aria-selected")).toBe("true");
  });

  it("유니버스로 저장한 것은 설정만 넣고 안 돌린다(몇 분 걸린다)", async () => {
    상태.전략들 = [{ id: 6, name: "코스피 RSI", version: 1, market: "KR", created_at: "2026-11-01",
      entry_conditions: { logic: "AND", conditions: [] }, exit_conditions: { logic: "OR", conditions: [] },
      run_settings: { kind: "universe", universe: "KOSPI", rank_by: "sharpe_ratio", top_n: 10, start_date: "2021-01-04",
                      end_date: "2023-12-29", capital: 5_000_000, position_size: 80, cost_rate: 0 } }];
    그리기();
    await userEvent.click(screen.getByRole("button", { name: "불러오기" }));
    await userEvent.click(within(screen.getByRole("tablist", { name: "불러올 것" })).getByRole("tab", { name: /매매 전략/ }));
    await userEvent.click(await screen.findByRole("button", { name: "코스피 RSI 전략 열기" }));
    expect(screen.getByRole("tab", { name: "유니버스" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByLabelText("순위 기준")).toHaveValue("sharpe_ratio");
    expect(backtestApi.runUniverse).not.toHaveBeenCalled();
  });

  it("돌린말 — 예전 전략(조건만)은 빈 글", () => {
    expect(돌린말(undefined)).toBe("");
    expect(돌린말({ kind: "universe", universe: "SP500", top_n: 10, start_date: "2021-01-04", end_date: "2023-12-29",
      capital: 10_000_000, position_size: 95, cost_rate: 0 })).toBe("미국 대형주 상위 10개 · 21.01.04 ~ 23.12.29 · 1000만원");
  });
});


/* ═════════════════════════ 4) 상세 분석 ═════════════════════════ */

describe("4) 단일 종목 — 칩으로 나눈 상세 분석", () => {
  it("요약·낙폭·기간별·거래 칩, 칩마다 내용 칸이 그 칩을 가리킨다", async () => {
    await 단일돌리기();
    const 칩들 = within(screen.getByRole("tablist", { name: "결과 보기" })).getAllByRole("tab").map((t) => t.textContent);
    expect(칩들).toEqual(["요약", "낙폭", "기간별", "거래"]);
    await userEvent.click(screen.getByRole("tab", { name: "낙폭" }));
    expect(screen.getAllByRole("tabpanel").some((p) => p.getAttribute("aria-labelledby") === screen.getByRole("tab", { name: "낙폭" }).id)).toBe(true);
  });

  it("낙폭 — 들고 있기와 나란히, 깊었던 순서(잠긴 기간)", async () => {
    await 단일돌리기();
    await userEvent.click(screen.getByRole("tab", { name: "낙폭" }));
    expect(screen.getByRole("button", { name: "그냥 들고 있기 같이 보기" })).toBeInTheDocument();
    expect(screen.getByText("깊었던 순서")).toBeInTheDocument();
    /* 자릿수를 늘 둘로 — -34.0 이 '-34%' 로, 바로 아래 줄이 '-5.23%' 로 어긋나 보이던 것 */
    expect(screen.getByText("-8.10%")).toBeInTheDocument();
    expect(screen.getByText("가장 깊었을 때 -8.10%")).toBeInTheDocument();
    expect(screen.getByText("1년 3개월")).toBeInTheDocument();
  });

  it("기간별 — 해마다(들고 있기와 견주기)와 달마다 표", async () => {
    await 단일돌리기();
    await userEvent.click(screen.getByRole("tab", { name: "기간별" }));
    expect(screen.getByText("3년 중 1년은 내 전략이 더 높았어요")).toBeInTheDocument();   // 2022 -1.5 > -20
    const 표 = screen.getByRole("table", { name: /달마다 수익률/ });
    expect(within(표).getByLabelText("2021-03 -12.34%")).toHaveTextContent("-12");
    expect(within(표).getByLabelText("2021-01 자료 없음")).toBeInTheDocument();
    expect(within(표).getByLabelText("2023년 +9.10%")).toBeInTheDocument();
    expect(screen.getByText(/가장 나빴던 달/)).toHaveTextContent("2021-03");
  });

  it("거래 — 이긴·진 거래·손익비·연승연패·시장에 있던 기간·분포", async () => {
    await 단일돌리기();
    await userEvent.click(screen.getByRole("tab", { name: "거래" }));
    const 분석 = within(screen.getByText("거래 분석").closest(".bg-bg-card") as HTMLElement);
    expect(분석.getByText("2건")).toBeInTheDocument();                 // 이긴 거래
    expect(분석.getByText("1건")).toBeInTheDocument();                 // 진 거래
    expect(분석.getByText("2.00")).toBeInTheDocument();                // 손익비 6 / 3
    expect(분석.getByText("시장에 들어가 있던 기간")).toBeInTheDocument();
    expect(분석.getByRole("img", { name: /거래 손익 분포/ })).toBeInTheDocument();
  });

  it("거래가 없으면 그렇다고 말한다", async () => {
    상태.단일결과 = { ...단일, trades: [], total_trades: 0, win_rate: null };
    await 단일돌리기();
    await userEvent.click(screen.getByRole("tab", { name: "거래" }));
    expect(screen.getByText(/거래가 한 번도 없었어요/)).toBeInTheDocument();
  });

  it("CSV — 요약·해마다·달마다·거래·평가액을 같은 숫자로", async () => {
    await 단일돌리기();
    await userEvent.click(screen.getByRole("button", { name: "CSV로 내보내기" }));
    expect(상태.내려받은것).toHaveLength(1);
    const { 이름, 줄들 } = 상태.내려받은것[0];
    expect(이름).toBe("백테스트_AAPL_2021-01-04_2023-12-29.csv");
    const 머리들 = 줄들.map((r) => r[0]);
    expect(머리들).toEqual(expect.arrayContaining(["[요약]", "[해마다 수익률(%)]", "[달마다 수익률(%)]", "[거래]", "[평가액]"]));
    expect(줄들).toContainEqual(["총 수익률(%)", 12.3, 20]);
    expect(줄들).toContainEqual(["최대 낙폭(%)", -8.1, -30]);
    expect(줄들).toContainEqual(["2023-12-29", 11_230_000, 12_000_000]);
  });

  it("수익 곡선 — '들고 있기' 칩으로 끄고 켠다", async () => {
    await 단일돌리기();
    const 칩 = screen.getByRole("button", { name: "그냥 들고 있기 같이 보기" });
    expect(칩.getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(칩);
    expect(칩.getAttribute("aria-pressed")).toBe("false");
  });
});

describe("4) 유니버스 — 이름·요약·분포·다시 세우기·눌러서 자세히", () => {
  it("돌린 모든 종목으로 요약 — 수익 낸 몫·가운데값", async () => {
    await 유니버스돌리기();
    expect(screen.getByText("2/3")).toBeInTheDocument();
    expect(screen.getByText("+25.0%")).toBeInTheDocument();          // 가운데값
    expect(screen.getByRole("img", { name: /종목별 총수익률 분포/ })).toBeInTheDocument();
    expect(screen.getByText(/상장폐지/)).toBeInTheDocument();
  });

  it("이름으로 보이고, 칩으로 다시 세운다", async () => {
    await 유니버스돌리기();
    const 이름들 = () => screen.getAllByRole("button", { name: /자세히 백테스트/ }).map((b) => b.getAttribute("aria-label"));
    expect(이름들()).toEqual(["삼성전자 자세히 백테스트", "SK하이닉스 자세히 백테스트"]);
    await userEvent.click(within(screen.getByRole("tablist", { name: "순위 기준" })).getByRole("tab", { name: "샤프" }));
    expect(이름들()).toEqual(["SK하이닉스 자세히 백테스트", "삼성전자 자세히 백테스트"]);
    await userEvent.click(within(screen.getByRole("tablist", { name: "순위 기준" })).getByRole("tab", { name: "낙폭 작은 순" }));
    expect(이름들()).toEqual(["삼성전자 자세히 백테스트", "SK하이닉스 자세히 백테스트"]);
  });

  it("종목을 누르면 같은 조건으로 그 종목 하나를 단일 종목 탭에서 — 국내 코드는 접미사를 뗀다", async () => {
    await 유니버스돌리기();
    /* 결과가 나온 뒤 칸을 고쳐도 그 결과를 낸 조건으로 돌린다 */
    await userEvent.click(screen.getByRole("button", { name: "설정 바꾸기" }));
    await userEvent.click(screen.getByLabelText("100만원"));
    await userEvent.click(screen.getByRole("button", { name: "SK하이닉스 자세히 백테스트" }));
    await waitFor(() => expect(상태.돌린것).toHaveLength(1));
    expect(상태.돌린것[0]).toMatchObject({ symbol: "000660", market: "KR",
      entry_conditions: 상태.유니버스돌린것[0].entry_conditions, initial_capital: 10_000_000 });
    expect(상태.유니버스돌린것[0].initial_capital).toBe(10_000_000);
    expect(screen.getByRole("tab", { name: "단일 종목" }).getAttribute("aria-selected")).toBe("true");
  });
});

describe("자산배분 — 결과에서 저장, 펼치고 접기", () => {
  const 배분 = {
    start_date: "2016-11-04", end_date: "2026-11-04", years: 10, contributed: 10_000_000, final_value: 25_000_000,
    profit: 15_000_000, total_return: 150, twr_annual: 9.6, irr_annual: 9.6, mdd: 20, volatility: 15, sharpe: 0.7,
    dividends: null, yearly: [{ year: 2017, return: 10 }], monthly: [{ month: "2017-02", return: 1.5 }],
    curve: [], drawdown: [], drawdowns: [], crises: [], currency: "KRW", assets: [], skipped: [], fx_skipped: [],
    costs_included: false, costs: null, cost_rate: null, risk_free_rate: 0, cash_rate: 0, benchmark: null, extended_from: {},
  };
  const 설정 = { ...첫설정(new Date(2026, 10, 4)), initial_amount: 20_000_000 as const,
    assets: [{ symbol: "SPY", market: "US" as const, name: "S&P 500", weight: 60 },
             { symbol: "TLT", market: "US" as const, name: "미국 장기국채", weight: 40 }] };

  async function 배분돌리기() {
    상태.배분결과 = 배분;
    그리기(`/backtest?${new URL(공유주소({ 탭: "alloc", 설정 }, "https://x.test")).search.slice(1)}`);
    await screen.findByRole("tablist", { name: "결과 보기" });
  }

  it("결과 머리의 저장 — 결과를 낸 설정으로(그 뒤에 칸을 고쳐도)", async () => {
    await 배분돌리기();
    await userEvent.click(screen.getByRole("button", { name: "설정 바꾸기" }));
    await userEvent.click(screen.getByLabelText("500만원"));
    await userEvent.click(screen.getByRole("button", { name: "결과 저장" }));
    await userEvent.type(screen.getByLabelText("이름"), "{Enter}");
    await waitFor(() => expect(backtestApi.saveExperiment).toHaveBeenCalledTimes(1));
    expect(vi.mocked(backtestApi.saveExperiment).mock.calls[0][0]).toMatchObject({
      initial_amount: 20_000_000, assets: [{ symbol: "SPY" }, { symbol: "TLT" }] });
    expect(await screen.findByText(/저장했어요/)).toBeInTheDocument();
  });

  it("펼치면 자산·비중·적립·리밸런싱", async () => {
    await 배분돌리기();
    const 펼치기 = screen.getByRole("button", { name: /설정 펼치기/ });
    await userEvent.click(펼치기);
    const 목록 = within(document.getElementById(펼치기.getAttribute("aria-controls")!)!);
    expect(목록.getByText("S&P 500 60% · 미국 장기국채 40%")).toBeInTheDocument();
    expect(목록.getByText("2000만원")).toBeInTheDocument();
    expect(목록.getByText("재투자(토탈 리턴)")).toBeInTheDocument();
  });

  it("달마다 표가 기간별 칩에 있다(단일 종목 결과와 같은 자리)", async () => {
    await 배분돌리기();
    expect(screen.queryByRole("table", { name: /달마다 수익률/ }), "요약에 달마다 표가 있다").toBeNull();
    await userEvent.click(screen.getByRole("tab", { name: "기간별" }));
    expect(screen.getByRole("table", { name: /달마다 수익률/ })).toBeInTheDocument();
  });

  it("자산배분 탭만 그려도 결과 저장이 로그인 전엔 안내", async () => {
    상태.로그인함 = false;
    상태.배분결과 = 배분;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<MemoryRouter><QueryClientProvider client={qc}>
      <자산배분탭 공유받은설정={설정 as never} /></QueryClientProvider></MemoryRouter>);
    await screen.findByRole("tablist", { name: "결과 보기" });
    await userEvent.click(screen.getByRole("button", { name: "결과 저장" }));
    expect(await screen.findByText(/결과를 저장하려면 로그인이 필요해요/)).toBeInTheDocument();
  });
});
