/**
 * 주가예측 화면 — 사용자: "주가예측 메뉴도 만들어줘".
 *
 * 서버(predictApi·애널리스트)만 흉내 내고 화면은 그대로 그린다(그래프는 recharts 대신 자리만).
 *   · 종목·기간은 주소에 — 종목 상세에서 바로 오고, 기간을 바꿔도 다시 묻지 않는다
 *   · 범위를 크게, 가운데 값은 작게. 확률·지난 검증·근거·목표가
 *   · 없는 종목·자료가 모자란 종목은 까닭을 말하고 '다시 시도' 를 내밀지 않는다
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
import { predictApi, type 주가예측, type 예측기간 } from "@/api/predict";
import { stocksApi } from "@/api/stocks";
import { 더보기_메뉴, 더보기_경로 } from "@/constants/moreNav";
import { 화면들 } from "@/routes/pages";
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
    const 카드 = () => screen.getByRole("heading", { name: "이 방식은 얼마나 맞았나" }).parentElement!;
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

  it("어떻게 셈했나 — 휴대폰은 맨 아래(확률·검증 뒤), PC 는 그래프 아래", async () => {
    그리기();
    await screen.findByTestId("예측범위");
    const 설명들 = screen.getAllByText("어떻게 셈했나요");
    expect(설명들).toHaveLength(2);
    const [pc, 폰] = 설명들.map((x) => x.closest("details")!.parentElement!);
    expect(pc).toHaveClass("hidden", "lg:block");
    expect(폰).toHaveClass("lg:hidden");
    const 확률 = screen.getByRole("heading", { name: "1개월 뒤 확률" });
    // 휴대폰용은 확률 카드보다 뒤에 온다
    expect(확률.compareDocumentPosition(폰) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(폰).getByText(/반감기 46영업일/)).toBeInTheDocument();
  });

  it("종목 이름을 누르면 종목 상세로", async () => {
    그리기();
    await screen.findByTestId("예측범위");
    await userEvent.click(screen.getByRole("link", { name: "삼성전자" }));
    expect(screen.getByText("종목 상세 화면")).toBeInTheDocument();
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
