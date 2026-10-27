/**
 * 백테스트를 다른 메뉴와 같은 모양으로 — 사용자: "백테스트 결과 그래프를 다른메뉴 그래프를 기준으로
 * 통일해줘(그래프도 너무 작은 거 같아)", "백테스트 디자인을 다른 메뉴를 기준으로 통일해주고 개선해줘".
 *
 * 여기서 못 박는 것 —
 *   1) 선 그래프는 공통 모양(가로축·툴팁·높이)을 쓴다 — 화면마다 손으로 적으면 다시 어긋난다
 *   2) 단일 종목 설정은 자산배분의 '신규 테스트' 와 같은 틀 — 저장은 이름을 묻는다
 *   3) 기간 단추는 오늘에서 거슬러 잰다(예전엔 2026-06-06 에 못 박혀 몇 달 뒤엔 '1Y' 가 6월에서 끝났다)
 *   4) 전략 저장소에는 설정 칸이 없다 — 전략을 누르면 단일 종목 탭에서 열리고, 지울 수 있다
 *   5) 색은 설정의 오름·내림 색만 쓴다(승률·샤프에 초록·빨강을 박아 두지 않는다)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import fs from "fs";
import path from "path";

const 상태 = vi.hoisted(() => ({
  로그인함: true,
  전략들: [] as any[],
  단일결과: null as any,
}));

vi.mock("@/api/stocks", () => ({
  backtestApi: {
    getStrategies: vi.fn(() => Promise.resolve(상태.전략들)),
    getExperiments: vi.fn(() => Promise.resolve([])),
    run: vi.fn(() => Promise.resolve(상태.단일결과)),
    runUniverse: vi.fn(), saveStrategy: vi.fn(() => Promise.resolve({ id: 9 })),
    deleteStrategy: vi.fn(() => Promise.resolve({})), runPortfolio: vi.fn(),
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
import { backtestApi } from "@/api/stocks";
import { useSettingsStore } from "@/store/settingsStore";
import { 기간에서날짜 } from "../AllocationForm";
import { 설정판배치 } from "../AllocationTab";
import 자산배분결과화면 from "../AllocationResult";
import { 표글자, 표머리 } from "@/components/common/StockTable";
import { 그래프높이, 달눈금, 끝값 } from "@/utils/chartTheme";

const 전략 = {
  id: 5, name: "RSI 반등", version: 1, market: "KR", created_at: "2026-08-01",
  entry_conditions: { logic: "AND", conditions: [{ indicator: "RSI", operator: "<", value: 30, period: 14 }] },
  exit_conditions: { logic: "OR", conditions: [{ indicator: "RSI", operator: ">", value: 70, period: 14 }] },
};

const 단일 = {
  start_date: "2020-01-02", end_date: "2024-12-30", years: 4.99,
  total_return: 12.3, annual_return: 2.35, mdd: 8.1, sharpe_ratio: 1.7,
  win_rate: 62.5, total_trades: 8, avg_profit: 1.2, avg_loss: -0.8,
  profit_factor: 1.9, costs: 0, cost_rate: 0, risk_free_rate: 0,
  equity_curve: [{ date: "2020-01-02", value: 10_000_000 }, { date: "2024-12-30", value: 11_230_000 }],
  trades: [], buy_and_hold: { total_return: 20.0, annual_return: 3.7, mdd: 30.0 },
};

function 그리기() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}><Backtest /></QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  상태.로그인함 = true; 상태.전략들 = []; 상태.단일결과 = null;
  useSettingsStore.getState().setColorScheme("red-blue");
});

describe("선 그래프는 공통 모양을 쓴다", () => {
  const 뿌리 = path.resolve(__dirname, "../../..");
  const 읽기 = (f: string) => fs.readFileSync(path.join(뿌리, f), "utf-8");

  it.each([
    "pages/Backtest.tsx", "components/backtest/AllocationResult.tsx",
    "components/portfolio/AssetHistory.tsx", "components/stock/PriceTrend.tsx",
  ])("%s — 가로축·툴팁을 공통 값으로(chartTheme)", (f) => {
    const 글 = 읽기(f);
    const 가로축들 = 글.match(/<R\.XAxis[^>]*>/g) ?? [];
    expect(가로축들.length).toBeGreaterThan(0);
    for (const x of 가로축들) expect(x, `${f}: 가로축을 손으로 적었다`).toContain("{...가로축}");
    const 툴팁들 = 글.match(/<R\.Tooltip[\s\S]*?\/>/g) ?? [];
    for (const t of 툴팁들) expect(t, `${f}: 툴팁 상자를 손으로 적었다`).toContain("{...툴팁}");
  });

  it("백테스트 그래프 높이를 숫자로 못 박지 않는다 — 넓은 화면에서 커진다", () => {
    for (const f of ["pages/Backtest.tsx", "components/backtest/AllocationResult.tsx"]) {
      expect(읽기(f), `${f}: 높이를 숫자로 못 박았다(넓은 화면에서도 그 크기)`).not.toMatch(/<차트틀 height=\{\d+\}/);
    }
    const [폰, 넓은] = 그래프높이.큰;
    expect(넓은).toBeGreaterThan(폰);
    expect(넓은, "결과의 본론인 그래프가 내 자산 추이(260)보다 작다").toBeGreaterThan(그래프높이.보통[1]);
  });

  it("몇 해를 잇는 눈금은 해·달로 — '2018-02-15' 처럼 길지 않게, 해는 빼지 않게", () => {
    expect(달눈금("2018-02-15")).toBe("2018.02");
    expect(달눈금("이상한값")).toBe("이상한값");
  });

  it("최고·최저는 값이 있는 것만으로", () => {
    expect(끝값([3, null, -1, undefined, Number.NaN, 7])).toEqual({ 최고: 7, 최저: -1 });
    expect(끝값([])).toBeNull();
  });
});

describe("단일 종목 설정 — 자산배분과 같은 틀", () => {
  it("'신규 테스트' 한 장에 칸 제목이 있다", async () => {
    그리기();
    await userEvent.click(screen.getByRole("tab", { name: "단일 종목" }));
    expect(screen.getByRole("heading", { name: "신규 테스트" })).toBeInTheDocument();
    for (const 제목 of ["테스트 종목", "테스트 기간", "자금 · 매매", "진입 · 청산 조건"]) {
      expect(screen.getByText(제목)).toBeInTheDocument();
    }
  });

  it("기간 단추는 오늘에서 거슬러 잰다", async () => {
    그리기();
    await userEvent.click(screen.getByRole("tab", { name: "단일 종목" }));
    await userEvent.click(screen.getByRole("button", { name: "5년" }));
    const { start_date, end_date } = 기간에서날짜(5);
    expect(screen.getByLabelText("시작일")).toHaveValue(start_date);
    expect(screen.getByLabelText("종료일"), "끝이 오늘이 아니다").toHaveValue(end_date);
  });

  it("탭 설명이 탭마다 다르다 — 처음 열리는 자산배분에는 진입·청산 조건이 없다", async () => {
    그리기();
    expect(screen.queryByText(/진입·청산 조건을/)).toBeNull();
    expect(screen.getByText(/비중대로 담아/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "단일 종목" }));
    expect(screen.getByText(/한 종목의 과거 시세로 검증해요/)).toBeInTheDocument();
    expect(screen.queryByText(/비중대로 담아/)).toBeNull();
  });

  it("저장은 이름을 묻고, 적은 이름으로 저장한다", async () => {
    그리기();
    await userEvent.click(screen.getByRole("tab", { name: "단일 종목" }));
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    const 이름 = screen.getByLabelText("이름");
    expect(이름).toHaveValue("AAPL 전략");
    await userEvent.clear(이름);
    await userEvent.type(이름, "이평 돌파{Enter}");
    expect(backtestApi.saveStrategy).toHaveBeenCalledWith(expect.objectContaining({ name: "이평 돌파", market: "US" }));
  });

  it("로그인 전에 저장을 누르면 왜 안 되는지 말한다 — 창은 안 뜬다", async () => {
    상태.로그인함 = false;
    그리기();
    await userEvent.click(screen.getByRole("tab", { name: "단일 종목" }));
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(screen.getByText(/전략을 저장하려면 로그인이 필요해요/)).toBeInTheDocument();
    expect(screen.queryByLabelText("이름")).toBeNull();
  });
});

describe("성과 칸의 색은 설정의 오름·내림 색만", () => {
  async function 돌리기() {
    상태.단일결과 = 단일;
    그리기();
    await userEvent.click(screen.getByRole("tab", { name: "단일 종목" }));
    await userEvent.click(screen.getByRole("button", { name: /백테스트 실행/ }));
    return await screen.findByText("성과");
  }
  const 값칸 = (이름: string) => screen.getByText(이름).parentElement!.querySelector("span.font-mono") as HTMLElement;

  it("낙폭은 내림 색, 승률·샤프·PF 는 색을 안 칠한다", async () => {
    await 돌리기();
    expect(값칸("MDD").className).toContain("text-accent-blue");          // 빨강-파랑: 내림은 파랑
    for (const 이름 of ["승률", "샤프 비율", "수익비율 (PF)"]) {
      expect(값칸(이름).className, `${이름} 에 좋고 나쁨 색을 박았다`).not.toMatch(/accent-(green|red)/);
    }
  });

  it("'그냥 들고 있었으면' 은 내 값이 나으면 오름 색 — 초록·빨강을 박아 두지 않는다", async () => {
    await 돌리기();
    const 칸 = screen.getByText("그냥 사서 들고 있었으면").closest("div.flex-col")!;
    // 총 수익률 12.3 < 들고 있기 20 → 내림 색(파랑), 낙폭 8.1 < 30 → 오름 색(빨강)
    expect(within(칸 as HTMLElement).getByText("12.3%").className).toContain("text-accent-blue");
    expect(within(칸 as HTMLElement).getByText("-8.1%").className).toContain("text-accent-red");
    expect(칸.innerHTML).not.toContain("accent-green");
  });
});

describe("전략 저장소 — 설정 칸 없이, 누르면 단일 종목에서", () => {
  it("저장소 탭에는 설정 칸과 실행 단추가 없다", async () => {
    상태.전략들 = [전략];
    그리기();
    await userEvent.click(screen.getByRole("tab", { name: "전략 저장소" }));
    expect(await screen.findByText(전략.name)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "신규 테스트" })).toBeNull();
    expect(screen.queryByRole("button", { name: /유니버스 백테스트/ }), "저장한 것을 보러 왔는데 실행 단추가 떠 있다").toBeNull();
  });

  it("전략을 누르면 단일 종목 탭이 열리고 그 시장과 조건이 들어와 있다", async () => {
    상태.전략들 = [전략];
    그리기();
    await userEvent.click(screen.getByRole("tab", { name: "전략 저장소" }));
    await userEvent.click(await screen.findByRole("button", { name: "RSI 반등 전략 열기" }));
    expect(screen.getByRole("tab", { name: "단일 종목" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("button", { name: "KR" }).getAttribute("aria-pressed"), "전략의 시장(국내)이 안 되살아났다").toBe("true");
    expect(screen.getByDisplayValue("30")).toBeInTheDocument();   // 진입 RSI < 30
  });

  it("전략을 지울 수 있다 — 묻고 나서", async () => {
    상태.전략들 = [전략];
    그리기();
    await userEvent.click(screen.getByRole("tab", { name: "전략 저장소" }));
    await userEvent.click(await screen.findByRole("button", { name: "RSI 반등 지우기" }));
    expect(screen.getByRole("tab", { name: "전략 저장소" }).getAttribute("aria-selected"),
      "지우기를 누르니 전략이 열렸다(누름이 카드로 번졌다)").toBe("true");
    expect(backtestApi.deleteStrategy).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "지우기" }));
    expect(backtestApi.deleteStrategy).toHaveBeenCalledWith(5);
  });
});

describe("넓은 화면에서 백테스트 그래프가 커진다 — 사용자: \"그래프도 너무 작은 거 같아\"", () => {
  const 곡선 = [{ date: "2020-01-01", value: 10_000_000 }, { date: "2020-06-01", value: 11_000_000 },
                { date: "2020-12-01", value: 12_300_000 }];
  const 결과 = {
    start_date: "2020-01-01", end_date: "2020-12-01", years: 0.92, contributed: 10_000_000,
    final_value: 12_300_000, profit: 2_300_000, total_return: 23.0, twr_annual: null, irr_annual: null,
    mdd: 5.0, volatility: 10.0, sharpe: 1.0, dividends: null, yearly: [], curve: 곡선,
    drawdown: [{ date: "2020-01-01", dd: 0 }, { date: "2020-06-01", dd: -5 }], drawdowns: [], crises: [],
    currency: "KRW", assets: [], skipped: [], fx_skipped: [], costs_included: false, costs: null, cost_rate: null,
    risk_free_rate: 0, cash_rate: 0, benchmark: null, extended_from: {},
  };
  const 넓게 = (넓음: boolean) => vi.stubGlobal("matchMedia", (q: string) => ({
    matches: 넓음 && q === "(min-width: 1024px)", media: q, addEventListener() {}, removeEventListener() {},
  }));
  afterEach(() => vi.unstubAllGlobals());

  it.each([[true, `${그래프높이.큰[1]}px`], [false, `${그래프높이.큰[0]}px`]])(
    "넓은 화면 %s → 자산 흐름 높이 %s", async (넓음, 높이) => {
      넓게(넓음 as boolean);
      render(<자산배분결과화면 r={결과 as never} />);
      const 틀 = await waitFor(() => {
        const el = document.querySelector(".recharts-responsive-container") as HTMLElement | null;
        if (!el) throw new Error("아직 그래프 코드를 받는 중");
        return el;
      }, { timeout: 5000 });
      expect(틀.style.height).toBe(높이);
    });
});

describe("배치와 표도 같은 틀", () => {
  it("자산배분·단일 종목 탭이 같은 배치(왼쪽 설정 폭 고정 · 오른쪽 결과)를 쓴다", async () => {
    그리기();
    const 판 = (h: HTMLElement) => h.closest("div.grid") as HTMLElement;
    expect(판(screen.getByRole("heading", { name: "신규 테스트" })).className).toBe(설정판배치);
    await userEvent.click(screen.getByRole("tab", { name: "단일 종목" }));
    expect(판(screen.getByRole("heading", { name: "신규 테스트" })).className,
      "단일 종목만 다른 배치다 — 탭마다 그래프 폭이 달라진다").toBe(설정판배치);
    /* 설정은 폭을 정해 두고 나머지를 결과에 — 반반이면 자산배분 결과 그래프가 600px 에 눌렸다 */
    expect(설정판배치).toContain("xl:grid-cols-[28rem_minmax(0,1fr)]");
  });

  it("거래 내역 표는 스크리닝 표와 같은 머리·글자", async () => {
    상태.단일결과 = { ...단일, trades: [{ type: "청산", entry_date: "2020-03-02", exit_date: "2020-03-09",
      entry_price: 100, exit_price: 101, pnl_rate: 1, net_pnl_rate: 1, shares: 95 }] };
    그리기();
    await userEvent.click(screen.getByRole("tab", { name: "단일 종목" }));
    await userEvent.click(screen.getByRole("button", { name: /백테스트 실행/ }));
    const 표 = (await screen.findByText("진입일")).closest("table")!;
    expect(표.className).toContain(표글자);
    expect(표.querySelector("thead")!.className).toBe(표머리);
  });
});
