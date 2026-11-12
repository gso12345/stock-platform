/**
 * 주가예측 화면 — 사용자: "주가예측 메뉴도 만들어줘".
 *
 * 서버(predictApi·애널리스트)만 흉내 내고 화면은 그대로 그린다(그래프는 recharts 대신 자리만).
 *   · 종목·기간은 주소에 — 종목 상세에서 바로 오고, 기간을 바꿔도 다시 묻지 않는다
 *   · 범위를 크게, 가운데 값은 작게. 확률·지난 검증·근거·목표가
 *   · 없는 종목·자료가 모자란 종목은 까닭을 말하고 '다시 시도' 를 내밀지 않는다
 *   · 맨 위는 기술적 분석 예측(사용자: "기술적분석을 바탕으로 주가를 공모가처럼 예측해줘") — 신호를 지난 성적만큼
 *     반영한 예상 주가, 50% 범위, 비슷했던 때, 지난 3년 성적. 3개월 뒤까지만 — 6개월·1년이면 짧은 기간으로 옮길 단추
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";

vi.mock("@/api/predict", () => ({ predictApi: { get: vi.fn() } }));
vi.mock("@/api/stocks", async (원본) => ({
  ...(await 원본<typeof import("@/api/stocks")>()),
  stocksApi: { getAnalyst: vi.fn() },
}));
vi.mock("@/components/chart/ChartFrame", () => ({
  default: ({ height }: { height: number }) => <div data-testid="그래프" style={{ height }} />,
  그래프미리받기: vi.fn(),
}));
const 검색 = vi.hoisted(() => ({ 결과: [] as { symbol: string; name: string; market: string; type: string; exchange: string }[] }));
vi.mock("@/hooks/useStockSearch", async () => {
  const { useState } = await import("react");
  return {
    useStockSearch: () => {
      const [query, setQuery] = useState("");
      return { query, setQuery, results: query ? 검색.결과 : [], searching: false };
    },
  };
});

import Predict from "@/pages/Predict";
import { predictApi, type 주가예측, type 예측기간, type 기술예측, type 기술예측기간, type 기술검증 } from "@/api/predict";
import { stocksApi } from "@/api/stocks";
import { 더보기_메뉴, 더보기_경로 } from "@/constants/moreNav";
import { 화면들 } from "@/routes/pages";
import { 기술막대자리 } from "@/utils/주가예측";
import StockDetail원문 from "@/pages/StockDetail.tsx?raw";
import main원문 from "@/main.tsx?raw";
import pages원문 from "@/routes/pages.ts?raw";

const api = vi.mocked(predictApi);
const 증권 = vi.mocked(stocksApi);

const 기간 = (days: number, label: string, date: string, 덧: Partial<예측기간> = {}): 예측기간 => ({
  days, label, date, q10: 61500, q25: 66000, q50: 71800, q75: 77100, q90: 82900,
  up: 0.531, up10: 0.142, down10: 0.118,
  check: { n: 152, in80: 0.78, in50: 0.49, above80: 0.12, below80: 0.1, periods: 36, from: "2023-08-24", to: "2026-11-10" },
  ...덧,
});

const 기술검증값 = (덧: Partial<기술검증> = {}): 기술검증 => ({
  n: 150, from: "2023-08-24", to: "2026-10-12", periods: 36, in50: 0.51, best: "knn",
  weight: 1, gain: 0.081, mae_used: 0.0562, direction_used: 0.58,
  methods: [
    { key: "flat", label: "지금 가격 그대로", mae: 0.0612, direction: null },
    { key: "knn", label: "비슷했던 때", mae: 0.0562, direction: 0.58 },
    { key: "ridge", label: "회귀", mae: 0.0598, direction: 0.55 },
    { key: "mid", label: "둘의 가운데", mae: 0.0571, direction: 0.574 },
  ],
  ...덧,
});

const 기술기간 = (days: number, label: string, date: string, 덧: Partial<기술예측기간> = {}): 기술예측기간 => ({
  days, label, date, method: "knn", method_label: "비슷했던 때",
  signal: 73500, weight: 1, predicted: 73500, knn: 73500, ridge: 72100,
  range: [69800, 76900], range_kind: "errors",
  up: 0.6, up10: 0.133, down10: 0.067, neighbor_count: 15,
  neighbors: [
    { date: "2024-03-14", change: 0.052, rsi: 61.4, gap200: 0.083 },
    { date: "2023-09-01", change: -0.031, rsi: null, gap200: -0.02 },
  ],
  check: 기술검증값(),
  ...덧,
});

const 기술가짜 = (덧: Partial<기술예측> = {}): 기술예측 => ({
  horizons: [
    // 1주 — 신호(₩72,600)를 50% 반영
    기술기간(5, "1주", "2026-11-17", {
      signal: 72600, weight: 0.5, predicted: 71900, range: [70100, 72800],
      check: 기술검증값({ weight: 0.5, gain: 0.024, mae_used: 0.0597, in50: 0.49 }),
    }),
    // 1개월 — 신호를 그대로(100%)
    기술기간(21, "1개월", "2026-12-09"),
    // 3개월 — 반영 0: 지금 가격이 예상(신호는 회귀 ₩69,000)
    기술기간(63, "3개월", "2027-02-08", {
      method: "ridge", method_label: "회귀", signal: 69000, weight: 0, predicted: 71200, knn: 70500, ridge: 69000,
      range: [61000, 80500],
      check: 기술검증값({ best: "ridge", weight: 0, gain: 0, mae_used: 0.0612, direction_used: null, in50: 0.47 }),
    }),
  ],
  indicators: [
    { key: "gap200", label: "200일선 이격도", value: Math.log(1.09), used: true },
    { key: "rsi", label: "RSI(14일)", value: 55.2, used: true },
    { key: "volume", label: "거래량(1주 ÷ 3개월)", value: null, used: false },
  ],
  market: "코스피", neighbors_k: 15, min_gap_days: 5,
  ...덧,
});

function 가짜(덧: Partial<주가예측> = {}): 주가예측 {
  return {
    symbol: "005930", market: "KR", name: "삼성전자", currency: "KRW", as_of: "2026-11-10", price: 71200, days_used: 1234,
    volatility: { now: 0.31, long: 0.28 }, expected_return: 0.065,
    horizons: [
      기간(5, "1주", "2026-11-17", { q10: 68000, q90: 74500 }),
      기간(21, "1개월", "2026-12-09"),
      기간(63, "3개월", "2027-02-08", { q10: 55000, q90: 90100 }),
      기간(126, "6개월", "2027-05-10"),
      기간(252, "1년", "2027-11-02", { check: { n: 148, in80: 0.62, in50: 0.45, above80: 0.3, below80: 0.08, periods: 3, from: "2022-11-02", to: "2026-11-10" } }),
    ],
    path: Array.from({ length: 252 }, (_, i) => ({ day: i + 1, date: `2026-12-${String((i % 28) + 1).padStart(2, "0")}`, q10: 1, q25: 2, q50: 3, q75: 4, q90: 5 })),
    history: Array.from({ length: 260 }, (_, i) => ({ date: `2025-${String((i % 12) + 1).padStart(2, "0")}-01`, close: 70000 + i })),
    signals: [
      { key: "trend", state: "above", price: 71200, ma200: 65300, rates: { "21": { cond: 0.58, n: 612, base: 0.54, total: 1000 }, "252": { cond: 0.7, n: 300, base: 0.6, total: 500 } } },
      { key: "momentum", state: "down", ret: -0.12, rates: { "21": { cond: 0.49, n: 410, base: 0.54, total: 1000 } } },
      { key: "rsi", state: "normal", value: 55.2, rates: { "21": { cond: null, n: 0, base: 0.54, total: 1000 } } },
    ],
    method: { lambda: 0.94, half_life_days: 46, window_days: 756, prior_return: 0.07, check_step_days: 5 },
    technical: 기술가짜(),
    ...덧,
  };
}

function 주소보기() {
  const l = useLocation();
  return <p data-testid="주소">{l.pathname}{l.search}</p>;
}

function 그리기(주소 = "/predict") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[주소]}>
        <Routes>
          <Route path="/predict" element={<><Predict /><주소보기 /></>} />
          <Route path="/stocks/:market/:symbol" element={<div>종목 상세 화면</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const 주소 = () => new URLSearchParams(screen.getByTestId("주소").textContent!.split("?")[1] ?? "");

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  검색.결과 = [];
  api.get.mockImplementation(async (market, symbol) => (symbol === "AAPL"
    ? 가짜({ symbol: "AAPL", market: "US", name: "Apple", currency: "USD", price: 201.5,
        horizons: 가짜().horizons.map((h) => ({ ...h, q10: 180.12, q25: 190, q50: 203.4, q75: 215, q90: 230.45 })) })
    : 가짜({ symbol, market })));
  증권.getAnalyst.mockResolvedValue({ price_targets: { mean: 85000, high: 110000, low: 62000 } });
});

describe("종목과 기간", () => {
  it("처음이면 삼성전자의 1개월 뒤 — 80% 범위를 크게, 가운데 값·오를 확률은 그 아래", async () => {
    그리기();
    expect(await screen.findByTestId("예측범위")).toHaveTextContent("₩61,500 ~ ₩82,900");
    expect(api.get).toHaveBeenCalledWith("KR", "005930");
    expect(screen.getByRole("button", { name: "예측할 종목 삼성전자 바꾸기" })).toBeInTheDocument();
    expect(screen.getByText("1개월 뒤 · 12월 9일 무렵 · 80% 확률로")).toBeInTheDocument();
    const 요약 = screen.getByTestId("예측범위").closest("div")!.parentElement!;
    expect(요약).toHaveTextContent("가운데 값 ₩71,800(+0.8%)");
    expect(요약).toHaveTextContent("오를 확률 53%");
    expect(screen.getByRole("tab", { name: "1개월 뒤" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("그래프")).toBeInTheDocument();
  });

  it("주소의 종목·기간으로 연다(종목 상세에서 바로 온다) — 달러는 소수 둘째 자리까지", async () => {
    그리기("/predict?m=US&s=AAPL&n=Apple&h=63");
    expect(await screen.findByTestId("예측범위")).toHaveTextContent("$180.12 ~ $230.45");
    expect(api.get).toHaveBeenCalledWith("US", "AAPL");
    expect(screen.getByText("3개월 뒤 · 2월 8일 무렵 · 80% 확률로")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "3개월 뒤" })).toHaveAttribute("aria-selected", "true");
  });

  it("주소의 기간이 이상하면 1개월", async () => {
    그리기("/predict?m=KR&s=005930&n=삼성전자&h=30");
    expect(await screen.findByText("1개월 뒤 · 12월 9일 무렵 · 80% 확률로")).toBeInTheDocument();
  });

  it("기간을 바꾸면 주소만 바뀌고 서버에 다시 묻지 않는다", async () => {
    그리기();
    await screen.findByTestId("예측범위");
    await userEvent.click(screen.getByRole("tab", { name: "1년 뒤" }));
    expect(screen.getByText("1년 뒤 · 11월 2일 무렵 · 80% 확률로")).toBeInTheDocument();
    expect(주소().get("h")).toBe("252");
    expect(주소().get("s")).toBe("005930");
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("빠른 칩으로 고르면 그 종목을 묻고, 다음에 메뉴로 들어오면 그 종목부터", async () => {
    그리기();
    await screen.findByTestId("예측범위");
    await userEvent.click(screen.getByRole("button", { name: "애플" }));
    expect(await screen.findByText("$180.12 ~ $230.45")).toBeInTheDocument();
    expect(api.get).toHaveBeenLastCalledWith("US", "AAPL");
    expect(주소().get("m")).toBe("US");
    expect(screen.getByRole("button", { name: "애플" })).toHaveAttribute("aria-pressed", "true");
    cleanup();
    그리기();
    expect(await screen.findByText("$180.12 ~ $230.45")).toBeInTheDocument();
    expect(api.get).toHaveBeenLastCalledWith("US", "AAPL");
  });

  it("최근 본 종목이 있으면 그것을 빠른 칩으로", async () => {
    localStorage.setItem("recently_viewed_stocks:guest", JSON.stringify([{ symbol: "035420", market: "KR", name: "NAVER", viewedAt: 1 }]));
    그리기();
    await screen.findByTestId("예측범위");
    const 칩 = screen.getByLabelText("빠르게 고르기");
    expect(within(칩).getAllByRole("button").map((b) => b.textContent)).toEqual(["NAVER"]);
  });

  it("이름으로 찾아 고른다", async () => {
    검색.결과 = [{ symbol: "AAPL", name: "Apple", market: "US", type: "stock", exchange: "NASDAQ" }];
    그리기();
    await screen.findByTestId("예측범위");
    await userEvent.click(screen.getByRole("button", { name: "예측할 종목 삼성전자 바꾸기" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "종목 검색" }), "애플");
    await userEvent.click(screen.getByRole("button", { name: "Apple 고르기" }));
    expect(await screen.findByText("$180.12 ~ $230.45")).toBeInTheDocument();
    expect(주소().get("n")).toBe("Apple");
  });
});

describe("확률 · 지난 검증 · 근거 · 목표가", () => {
  it("확률 셋", async () => {
    그리기();
    await screen.findByTestId("예측범위");
    const 카드 = screen.getByRole("heading", { name: "1개월 뒤 확률" }).parentElement!;
    expect(카드).toHaveTextContent("오를 확률53%");
    expect(카드).toHaveTextContent("+10% 넘게 오를 확률14%");
    expect(카드).toHaveTextContent("−10% 넘게 내릴 확률12%");
    expect(카드).toHaveTextContent("연 6.5% 흐름을 가정");
  });

  it("지난 검증 — 범위 안에 든 비율과 몇 번 중 몇 번, 1년은 참고만", async () => {
    그리기();
    await screen.findByTestId("예측범위");
    const 카드 = () => screen.getByRole("heading", { name: "출렁임 범위는 얼마나 맞았나" }).parentElement!;
    expect(카드()).toHaveTextContent("2023년 8월부터 매주, 그날까지의 시세만으로 1개월 뒤를 예측해 봤어요");
    expect(카드()).toHaveTextContent("80% 범위 안에 든 비율78%152번 중 119번");
    expect(카드()).toHaveTextContent("범위가 실제와 잘 맞았어요");
    expect(카드()).not.toHaveTextContent("참고만");
    await userEvent.click(screen.getByRole("tab", { name: "1년 뒤" }));
    expect(카드()).toHaveTextContent("범위가 좁았어요 — 실제로는 위로 더 크게 움직였어요");
    expect(카드()).toHaveTextContent("겹치지 않는 기간으로는 3번뿐이에요 — 참고만 하세요");
  });

  it("검증할 만큼 지난 시세가 없으면 그렇다고", async () => {
    api.get.mockResolvedValue(가짜({ horizons: 가짜().horizons.map((h) => ({ ...h, check: null })) }));
    그리기();
    expect(await screen.findByText("1개월 뒤를 검증할 만큼 지난 시세가 없어요")).toBeInTheDocument();
  });

  it("근거 — 고른 기간의 비율, 같은 상태였던 날이 없으면 없다고", async () => {
    그리기();
    await screen.findByTestId("예측범위");
    const 카드 = screen.getByRole("heading", { name: "근거" }).closest("div")!.parentElement!;
    expect(카드).toHaveTextContent("200일 평균보다 위");
    expect(카드).toHaveTextContent("지금 ₩71,200 · 200일 평균 ₩65,300");
    expect(카드).toHaveTextContent("지금 같은 상태였던 612일 가운데 1개월 뒤 오른 비율 58% · 모든 날은 54%");
    expect(카드).toHaveTextContent("최근 1개월을 뺀 1년 −12%");
    expect(카드).toHaveTextContent("지금 같은 상태였던 날이 없었어요");
    await userEvent.click(screen.getByRole("tab", { name: "1년 뒤" }));
    expect(카드).toHaveTextContent("지금 같은 상태였던 300일 가운데 1년 뒤 오른 비율 70% · 모든 날은 60%");
    expect(카드).toHaveTextContent("1년 뒤를 셀 만큼 지난 자료가 없어요");
  });

  it("증권사 목표가 — 있으면 평균과 지금 대비, 없으면 카드를 그리지 않는다", async () => {
    그리기();
    expect(await screen.findByText("증권사 목표가")).toBeInTheDocument();
    expect(screen.getByText("증권사 목표가").parentElement).toHaveTextContent("평균 ₩85,000 (+19%) · ₩62,000 ~ ₩110,000");
    cleanup();
    증권.getAnalyst.mockResolvedValue({ price_targets: null });
    그리기();
    await screen.findByTestId("예측범위");
    await waitFor(() => expect(증권.getAnalyst).toHaveBeenCalled());
    expect(screen.queryByText("증권사 목표가")).toBeNull();
  });

  it("어떻게 셈했나 — 하나만, 오른쪽 칸 끝(휴대폰은 맨 아래) · 두 셈을 나눠 설명", async () => {
    그리기();
    await screen.findByTestId("예측범위");
    const 설명들 = screen.getAllByText("어떻게 셈했나요");
    expect(설명들).toHaveLength(1);
    const 설명 = 설명들[0].closest("details")!;
    // 목표가 카드보다 뒤 — 오른쪽 칸의 끝
    expect(screen.getByText("증권사 목표가").compareDocumentPosition(설명) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(설명.parentElement!.lastElementChild).toBe(설명);
    expect(within(설명).getByText("기술적 분석 예측")).toBeInTheDocument();
    expect(within(설명).getByText("출렁임으로 본 범위")).toBeInTheDocument();
    expect(설명).toHaveTextContent("52주 고점·변동성, 그리고 코스피의 흐름으로 지금을 그려요");
    expect(설명).toHaveTextContent("가장 비슷했던 15번(서로 5영업일 이상 떨어진 날)이");
    expect(설명).toHaveTextContent("3개월 뒤까지만");
    expect(within(설명).getByText(/반감기 46영업일/)).toBeInTheDocument();
    expect(설명).toHaveTextContent("회사 소식·실적·처음 겪는 큰 사건은 두 셈 모두에 들어가지 않아요");
  });

  it("어떻게 셈했나 — 시장 지수가 없으면 지표만, 기술적 분석이 없으면 그 묶음을 뺀다", async () => {
    api.get.mockResolvedValue(가짜({ technical: 기술가짜({ market: null }) }));
    그리기();
    await screen.findByTestId("예측범위");
    const 설명 = () => screen.getByText("어떻게 셈했나요").closest("details")!;
    expect(설명()).toHaveTextContent("52주 고점·변동성으로 지금을 그려요");
    cleanup();
    api.get.mockResolvedValue(가짜({ technical: null }));
    그리기();
    await screen.findByTestId("예측범위");
    expect(within(설명()).queryByText("기술적 분석 예측")).toBeNull();
    expect(within(설명()).getByText("출렁임으로 본 범위")).toBeInTheDocument();
  });

  it("종목 이름 줄 — 마지막 종가, 이름을 누르면 종목 상세로", async () => {
    그리기();
    await screen.findByTestId("예측범위");
    expect(screen.getByText("11월 10일 종가 ₩71,200")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: "삼성전자" }));
    expect(screen.getByText("종목 상세 화면")).toBeInTheDocument();
  });
});

describe("기술적 분석 예측 — 공모주처럼 예상 주가 하나, 지난 성적만큼만 반영", () => {
  const 카드 = () => screen.getByRole("region", { name: "기술적 분석 예측" });
  const 머리 = () => screen.getByRole("heading", { name: "기술적 분석 예측" }).parentElement!;

  it("맨 위에 예상 주가 — 반영 비율과 지난 성적, 여러 종목 시험 결과, 50% 범위, 비슷했던 때 몇 번 올랐나", async () => {
    그리기();
    expect(await screen.findByTestId("기술예상")).toHaveTextContent("₩73,500+3.2%");
    // 늘 '참고만' 크기 — 여러 종목 10년 시험에서 기술적 예상은 '그대로' 를 이기지 못했다
    expect(screen.getByTestId("기술예상")).toHaveClass("text-xl", "font-semibold", "text-text-primary");
    expect(screen.getByTestId("기술예상")).not.toHaveClass("text-2xl");
    expect(카드()).toHaveTextContent("1개월 뒤 · 12월 9일 무렵 · 예상 주가 · 참고만");
    expect(머리()).toHaveTextContent("기술적 분석 예측비슷했던 때");
    expect(screen.getByTestId("기술반영")).toHaveTextContent("기술적 신호를 100% 반영했어요 — 지난 3년 '그대로'보다 8% 덜 틀렸어요");
    expect(within(카드()).queryByText(/기술적 신호만 보면/)).toBeNull();                 // 다 반영했으면 신호와 예상이 같다
    expect(within(카드()).getByText("여러 종목을 10년 동안 시험해 보면 기술적 예상은 '그대로'를 이기지 못했어요 — 참고만 하세요"))
      .toHaveClass("text-accent-yellow");
    expect(카드()).not.toHaveTextContent("덜 틀렸어요 — 참고만");                      // '확실히 낫다'(초록) 판정은 없다
    expect(카드()).toHaveTextContent("지난 3년 예상 오차로 본 50% 범위 ₩69,800 ~ ₩76,900 · 지금 ₩71,200");
    expect(카드()).toHaveTextContent("지표가 비슷했던 때 15번 가운데 9번 올랐어요(60%) · 10% 넘게 오른 때 2번 · 10% 넘게 내린 때 1번");
    const 막대 = within(카드()).getByRole("img", { name: "50% 범위 ₩69,800부터 ₩76,900, 예상 ₩73,500, 지금 ₩71,200" });
    // 띠 · 예상(세로 줄) · 지금(삼각)이 제자리에
    const 자리 = 기술막대자리([69800, 76900], 73500, 71200);
    const [띠, 예상줄, 지금] = Array.from(막대.children) as HTMLElement[];
    expect(parseFloat(띠.style.left)).toBeCloseTo(자리.절반[0], 3);
    expect(parseFloat(띠.style.width)).toBeCloseTo(자리.절반[1] - 자리.절반[0], 3);
    expect(parseFloat(예상줄.style.left)).toBeCloseTo(자리.예상, 3);
    expect(parseFloat(지금.style.left)).toBeCloseTo(자리.지금, 3);
    expect(자리.지금).toBeLessThan(자리.예상);
    // 출렁임으로 본 범위보다 앞(휴대폰에서도 맨 먼저 보인다)
    expect(카드().compareDocumentPosition(screen.getByTestId("예측범위")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("heading", { name: "출렁임으로 본 범위" })).toBeInTheDocument();
  });

  it("지난 3년 맞혀 본 성적 — 방식마다 평균 오차·방향 맞힘, 예상에 쓴 것, 50% 범위에 든 비율", async () => {
    그리기();
    await screen.findByTestId("기술예상");
    expect(카드()).toHaveTextContent("지난 3년 매주, 그날까지의 시세만으로 1개월 뒤를 맞혀 봤어요(150번)");
    const 줄들 = within(카드()).getAllByRole("row");
    expect(줄들.slice(1).map((r) => r.textContent)).toEqual([
      "지금 가격 그대로6.1%—",
      "비슷했던 때← 예상에 씀5.6%58%",
      "회귀6.0%55%",
      "둘의 가운데5.7%57%",
    ]);
    expect(줄들[2]).toHaveClass("font-semibold");
    expect(줄들[3]).not.toHaveClass("font-semibold");
    expect(카드()).toHaveTextContent("실제 주가가 50% 범위에 든 비율 51% — 날마다 그날까지 알던 오차로 그은 범위로(맞다면 50% 언저리)");
  });

  it("신호를 반만 반영하면 — 신호만 본 값, '← 신호', 따로 한 줄 '50% 반영 ← 예상에 씀'", async () => {
    그리기();
    await screen.findByTestId("기술예상");
    await userEvent.click(screen.getByRole("tab", { name: "1주 뒤" }));
    expect(screen.getByTestId("기술예상")).toHaveTextContent("₩71,900+1.0%");
    expect(카드()).toHaveTextContent("1주 뒤 · 11월 17일 무렵 · 예상 주가 · 참고만");
    expect(screen.getByTestId("기술반영")).toHaveTextContent("기술적 신호를 50% 반영했어요 — 지난 3년 '그대로'보다 2% 덜 틀렸어요");
    expect(카드()).toHaveTextContent("기술적 신호만 보면 ₩72,600(+2.0%) · 비슷했던 때");
    const 줄들 = within(카드()).getAllByRole("row");
    expect(줄들.slice(1).map((r) => r.textContent)).toEqual([
      "지금 가격 그대로6.1%—",
      "비슷했던 때← 신호5.6%58%",
      "회귀6.0%55%",
      "둘의 가운데5.7%57%",
      "비슷했던 때 50% 반영← 예상에 씀6.0%58%",
    ]);
    expect(줄들[5]).toHaveClass("font-semibold");
    expect(줄들[2]).not.toHaveClass("font-semibold");
    expect(카드()).toHaveTextContent("50% 범위에 든 비율 49%");
  });

  it("반영 0 이면 지금 가격이 예상 — '그대로 ← 예상에 씀', 신호는 따로", async () => {
    그리기();
    await screen.findByTestId("기술예상");
    await userEvent.click(screen.getByRole("tab", { name: "3개월 뒤" }));
    expect(screen.getByTestId("기술예상")).toHaveTextContent("₩71,2000%");
    expect(머리()).toHaveTextContent("기술적 분석 예측회귀");
    expect(screen.getByTestId("기술반영"))
      .toHaveTextContent("지난 3년 이 종목에서 기술적 신호가 '그대로'보다 못 맞혀, 지금 가격을 예상으로 써요");
    expect(카드()).toHaveTextContent("기술적 신호만 보면 ₩69,000(−3.1%) · 회귀");
    const 줄들 = within(카드()).getAllByRole("row");
    expect(줄들.slice(1).map((r) => r.textContent)).toEqual([
      "지금 가격 그대로← 예상에 씀6.1%—",
      "비슷했던 때5.6%58%",
      "회귀← 신호6.0%55%",
      "둘의 가운데5.7%57%",
    ]);
    expect(줄들[1]).toHaveClass("font-semibold");
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("6개월·1년은 3개월 뒤까지만 — 짧은 기간으로 옮기는 단추", async () => {
    그리기("/predict?m=KR&s=005930&n=삼성전자&h=126");
    await screen.findByTestId("예측범위");
    expect(screen.queryByTestId("기술예상")).toBeNull();
    expect(카드()).toHaveTextContent("기술적 분석은 짧은 앞날을 보는 도구라 3개월 뒤까지만 셈해요");
    expect(within(카드()).getAllByRole("button").map((b) => b.textContent)).toEqual(["1주 뒤 보기", "1개월 뒤 보기", "3개월 뒤 보기"]);
    await userEvent.click(within(카드()).getByRole("button", { name: "3개월 뒤 보기" }));
    expect(주소().get("h")).toBe("63");
    expect(screen.getByRole("tab", { name: "3개월 뒤" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("기술예상")).toHaveTextContent("₩71,200");
    await userEvent.click(screen.getByRole("tab", { name: "1년 뒤" }));
    await userEvent.click(within(카드()).getByRole("button", { name: "1주 뒤 보기" }));
    expect(주소().get("h")).toBe("5");
    expect(screen.getByTestId("기술예상")).toHaveTextContent("₩71,900");
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("시세가 짧아 3개월이 없으면 — 견줄 시세가 모자라다고, 있는 기간만 단추로", async () => {
    api.get.mockResolvedValue(가짜({ technical: 기술가짜({ horizons: 기술가짜().horizons.slice(0, 2) }) }));
    그리기("/predict?m=KR&s=005930&n=삼성전자&h=63");
    await screen.findByTestId("예측범위");
    expect(카드()).toHaveTextContent("이 기간은 견줄 지난 시세가 모자라요");
    expect(within(카드()).getAllByRole("button").map((b) => b.textContent)).toEqual(["1주 뒤 보기", "1개월 뒤 보기"]);
  });

  it("비슷했던 때 — 날짜·그때 지표·그 뒤 움직임 / 지금 지표 — 빼고 셈한 것은 흐리게", async () => {
    그리기();
    await screen.findByTestId("기술예상");
    expect(within(카드()).getByText("비슷했던 때 2번 보기")).toBeInTheDocument();
    expect(within(카드()).getByText("지표가 오늘과 가까운 차례예요")).toBeInTheDocument();
    const 때 = within(카드()).getByRole("list", { name: "비슷했던 때" });
    expect(within(때).getAllByRole("listitem").map((x) => x.textContent)).toEqual([
      "2024년 3월 14일RSI 61 · 200일선 +8.3%1개월 뒤 +5.2%",
      "2023년 9월 1일200일선 −2.0%1개월 뒤 −3.1%",
    ]);
    const 지표목록 = within(카드()).getByRole("list", { name: "지금 기술적 지표" });
    // 휴대폰은 한 줄에 하나(이름이 잘리지 않게), 넓으면 두 칸
    expect(지표목록).toHaveClass("grid-cols-1", "sm:grid-cols-2");
    const 칸들 = within(지표목록).getAllByRole("listitem");
    expect(칸들[0].firstElementChild).not.toHaveClass("truncate");
    expect(칸들.map((x) => x.textContent)).toEqual(["200일선 이격도+9.0%", "RSI(14일)55", "거래량(1주 ÷ 3개월)—"]);
    expect(칸들[2]).toHaveClass("opacity-50");
    expect(칸들[0]).not.toHaveClass("opacity-50");
    expect(카드()).toHaveTextContent("시장 흐름은 코스피 지수로 셈해요");
  });

  it("시장 지수를 못 받았으면 그렇다고", async () => {
    api.get.mockResolvedValue(가짜({ technical: 기술가짜({ market: null }) }));
    그리기();
    await screen.findByTestId("기술예상");
    expect(카드()).toHaveTextContent("시장 지수를 받지 못해 시장 흐름은 빼고 셈했어요");
  });

  it("지난 성적이 없으면 표 없이 — 지금 가격을 예상으로 쓴다고", async () => {
    api.get.mockResolvedValue(가짜({ technical: 기술가짜({ horizons: 기술가짜().horizons.map((h) => ({ ...h, check: null })) }) }));
    그리기();
    await screen.findByTestId("기술예상");
    expect(screen.getByTestId("기술반영")).toHaveTextContent("지난 성적을 셀 만큼 시세가 없어 지금 가격을 예상으로 써요");
    expect(within(카드()).queryByRole("table")).toBeNull();
    expect(카드()).toHaveTextContent("여러 종목을 10년 동안 시험해 보면");
  });

  it("지난 오차가 모자라면 범위는 비슷했던 때의 가운데 절반 — 적중률 줄은 없다", async () => {
    api.get.mockResolvedValue(가짜({
      technical: 기술가짜({
        horizons: 기술가짜().horizons.map((h) => ({ ...h, range_kind: "neighbors" as const, check: h.check && { ...h.check, in50: null } })),
      }),
    }));
    그리기();
    await screen.findByTestId("기술예상");
    expect(카드()).toHaveTextContent("지금과 지표가 비슷했던 때 15번 가운데 절반이 ₩69,800 ~ ₩76,900 사이였어요");
    expect(within(카드()).getByRole("img", { name: "비슷했던 때의 가운데 절반 ₩69,800부터 ₩76,900, 예상 ₩73,500, 지금 ₩71,200" }))
      .toBeInTheDocument();
    expect(카드()).not.toHaveTextContent("50% 범위에 든 비율");
    expect(카드()).not.toHaveTextContent("예상 오차로 본 50% 범위");
  });

  it("기술적 분석을 셈하지 못했으면(시세가 2년이 안 되면) 그렇다고 — 출렁임 범위는 그대로", async () => {
    api.get.mockResolvedValue(가짜({ technical: null }));
    그리기();
    expect(await screen.findByTestId("예측범위")).toHaveTextContent("₩61,500 ~ ₩82,900");
    expect(카드()).toHaveTextContent("기술적 분석은 시세가 2년 가까이 있어야 지난날과 견줄 수 있어요");
    expect(within(카드()).queryByRole("button")).toBeNull();
    expect(screen.queryByTestId("기술예상")).toBeNull();
    expect(screen.getByText(/진한 띠는 50%/)).not.toHaveTextContent("주황 점");
  });

  it("그래프 설명 — 기술적 예상이 있는 기간이면 주황 점", async () => {
    그리기();
    await screen.findByTestId("기술예상");
    expect(screen.getByText(/진한 띠는 50%/))
      .toHaveTextContent("점선은 가운데 값, 주황 점은 기술적 분석의 예상 주가. 날짜는 주말만 뺀 어림이에요");
    await userEvent.click(screen.getByRole("tab", { name: "1년 뒤" }));
    expect(screen.getByText(/진한 띠는 50%/)).toHaveTextContent("점선은 가운데 값. 날짜는 주말만 뺀 어림이에요");
  });
});

describe("못 셈했을 때", () => {
  it.each([
    [422, "상장한 지 얼마 안 됐거나 거래가 적어 예측할 시세가 모자라요(1년 남짓 필요 — 지금 120일)"],
    [404, "이 종목의 시세를 찾지 못했어요. 종목을 다시 골라 주세요"],
  ])("예측할 수 없는 종목(%i) — 서버의 까닭을 그대로, 다시 시도는 없다", async (코드, 까닭) => {
    api.get.mockRejectedValue({ response: { status: 코드, data: { detail: 까닭 } } });
    그리기();
    expect(await screen.findByText("이 종목은 예측할 수 없어요")).toBeInTheDocument();
    expect(screen.getByText(까닭)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /다시 시도/ })).toBeNull();
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("까닭이 비어 오면 기본 문구", async () => {
    api.get.mockRejectedValue({ response: { status: 422, data: {} } });
    그리기();
    expect(await screen.findByText("이 종목은 예측할 시세가 없어요")).toBeInTheDocument();
  });

  it("서버가 잠깐 못 받았으면(503) 다시 시도", async () => {
    api.get.mockRejectedValueOnce({ response: { status: 503, data: { detail: "시세를 받지 못했어요. 잠시 뒤 다시 해 주세요" } } });
    그리기();
    await userEvent.click(await screen.findByRole("button", { name: /다시 시도/ }));
    expect(await screen.findByTestId("예측범위")).toBeInTheDocument();
  });

  it("셈하는 동안은 자리만", () => {
    api.get.mockImplementation(() => new Promise(() => {}));
    그리기();
    expect(screen.getByLabelText("예측을 셈하는 중")).toHaveAttribute("aria-busy", "true");
  });
});

describe("메뉴", () => {
  it("더보기에 주가예측 — 휴대폰 아래 탭의 더보기도 켜진다", () => {
    expect(더보기_메뉴.find((m) => m.to === "/predict")).toMatchObject({ label: "주가예측" });
    expect(더보기_경로).toContain("/predict");
  });

  it("주소 /predict 로 열고, 메뉴에 손을 대면 화면 코드를 미리 받는다", () => {
    expect(main원문).toMatch(/<Route path="predict" element=\{<Predict \/>\} \/>/);
    expect(main원문).toMatch(/const Predict = lazy\(화면들\.Predict\);/);
    expect(pages원문).toMatch(/"\/predict": "Predict"/);
    expect(typeof 화면들.Predict).toBe("function");
  });

  it("종목 상세의 차트 아래에서 이 종목의 주가예측으로(종목·이름을 주소로)", () => {
    const i = StockDetail원문.indexOf("주가예측 — 앞으로 있을 만한 범위와 오를 확률");
    expect(i).toBeGreaterThan(-1);
    const 앞 = StockDetail원문.slice(i - 700, i);
    expect(앞).toMatch(/\{mainTab==="chart" && \(/);
    expect(앞).toContain("to={`/predict?${new URLSearchParams({ m, s: sym, n: d?.name || sym })}`}");
  });
});
