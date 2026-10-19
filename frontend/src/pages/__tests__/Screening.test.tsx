/**
 * 스크리닝 화면 — 참고한 스크리너처럼 **열자마자 시가총액 순으로 보이고, 칸 제목으로 세우고,
 * 적은 조건이 그대로 서버에 닿는가.**
 *
 * 예전에 숨어 있던 문제들(지금도 지킨다):
 *   · 시가총액 칸 이름은 '(억)' 인데 숫자를 그대로 보냈다 → 1000 을 적으면 '시총 1000원 이상'
 *   · 섹터는 받은 100개 안에서 화면이 걸렀다 → '시총 위 100곳 중 기술주' 가 나왔다.
 *     야후에 없는 이름("Financials")도 있어서 금융은 늘 0개였다
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const 상태 = vi.hoisted(() => ({ 로그인: false }));
const run = vi.fn();
const getPresets = vi.fn();
const savePreset = vi.fn();
const deletePreset = vi.fn();
const 관심 = vi.hoisted(() => ({
  목록: [] as any[],
  폴더: [] as any[],
  addItem: null as any,
  removeItem: null as any,
}));
vi.mock("@/api/stocks", async (원본) => ({
  ...(await 원본<any>()),
  screeningApi: {
    run: (...a: any[]) => run(...a),
    getPresets: (...a: any[]) => getPresets(...a),
    savePreset: (...a: any[]) => savePreset(...a),
    deletePreset: (...a: any[]) => deletePreset(...a),
  },
  watchlistApi: {
    getItemsWithCachedPrices: () => Promise.resolve(관심.목록),
    addItem: (...a: any[]) => 관심.addItem(...a),
    removeItem: (...a: any[]) => 관심.removeItem(...a),
  },
  watchlistFolderApi: { getFolders: () => Promise.resolve(관심.폴더) },
}));
vi.mock("@/store/authStore", () => ({
  useAuthStore: (sel?: any) => { const s = { isLoggedIn: 상태.로그인 }; return sel ? sel(s) : s; },
}));

import Screening, { SECTORS, 보낼조건 } from "../Screening";
import { 조건글, 같은조건, 칸들, 처음칸 } from "@/components/screening/screeningDefs";

const 줄 = (o: Record<string, any>) => ({ market: "US", currency: "USD", price: 10, ...o });

const 기본줄들 = [
  줄({ symbol: "NVDA", name: "NVIDIA Corporation", market_cap: 4.46e12, price: 183.2, change_rate: 2.49, per: 52.1,
       domain: "nvidia.com", fin_years: [2022, 2023, 2024], rev_hist: [27e9, -5e9, 130.5e9], eps_hist: [1.19, 2.94, 2.99] }),
  줄({ symbol: "TSM", name: "Taiwan Semiconductor", market_cap: 1.55e12, change_rate: -1.5, revenue: 112.56e9,
       fin_currency: "TWD", fin_years: [2024, 2025], rev_hist: [2894e9, 3631e9], eps_hist: [45.25, 61.0] }),
  줄({ symbol: "XYZ", name: "Xyz Holdings", market_cap: 1e9 }),
];

function 응답(results = 기본줄들, o: Record<string, any> = {}) {
  return { results, total: results.length, facets: { country: ["Taiwan", "United States"], sector: ["Energy", "Technology"], industry: ["Semiconductors"] }, ...o };
}

function 그리기() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/screening"]}>
        <Routes>
          <Route path="/screening" element={<Screening />} />
          <Route path="/login" element={<p>로그인 화면</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const 마지막 = () => run.mock.calls[run.mock.calls.length - 1][0];

beforeEach(() => {
  상태.로그인 = false;
  관심.목록 = [];
  관심.폴더 = [];
  관심.addItem = vi.fn(() => Promise.resolve({ id: 99 }));
  관심.removeItem = vi.fn(() => Promise.resolve({}));
  localStorage.clear();
  run.mockReset();
  run.mockImplementation(() => Promise.resolve(응답()));
  getPresets.mockReset();
  getPresets.mockResolvedValue([]);
  savePreset.mockReset();
  savePreset.mockResolvedValue({ id: 9 });
  deletePreset.mockReset();
  deletePreset.mockResolvedValue({});
});

describe("열자마자", () => {
  it("단추를 누르지 않아도 시가총액 큰 순으로 묻고 보인다", async () => {
    그리기();
    expect(await screen.findByText("NVIDIA Corporation")).toBeTruthy();
    expect(run).toHaveBeenCalledTimes(1);
    expect(마지막()).toEqual({ market: "US", filters: {}, sort_by: "market_cap", sort_order: "desc", limit: 100, q: "" });
    expect(screen.queryByRole("button", { name: "스크리닝 실행" })).toBeNull();
    expect(screen.getByText("시가총액 높은 순")).toBeTruthy();
  });

  it("조건에 맞는 수는 서버의 전체 수로 말한다", async () => {
    run.mockResolvedValue(응답(기본줄들, { total: 250 }));
    그리기();
    await screen.findByText("NVIDIA Corporation");
    expect(screen.getByText("250")).toBeTruthy();
    expect(screen.getByText(/곳 중 위 3곳/)).toBeTruthy();
  });

  it("서버가 준 결과를 화면이 다시 거르거나 세우지 않는다", async () => {
    run.mockResolvedValue(응답([줄({ symbol: "BBB", name: "비비 회사" }), 줄({ symbol: "AAA", name: "에이 회사", sector: "Energy" })]));
    그리기();
    await screen.findByText("비비 회사");
    const 이름들 = screen.getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("link")[0].textContent);
    expect(이름들).toEqual(["비비 회사BBB", "에이 회사AAA"]);
  });
});

describe("칸 제목으로 세우기", () => {
  it("누르면 그 칸 높은 순, 한 번 더 누르면 낮은 순 — 서버가 세운다", async () => {
    그리기();
    await screen.findByText("NVIDIA Corporation");
    fireEvent.click(screen.getByRole("button", { name: "PER" }));
    await waitFor(() => expect(마지막()).toMatchObject({ sort_by: "per", sort_order: "desc" }));
    expect(screen.getByText("PER 높은 순")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "PER" }));
    await waitFor(() => expect(마지막()).toMatchObject({ sort_by: "per", sort_order: "asc" }));
    expect(screen.getByRole("columnheader", { name: "PER" }).getAttribute("aria-sort")).toBe("ascending");
    // 다른 칸으로 옮기면 그 칸은 높은 순부터 — 앞 칸의 '낮은 순' 을 물려받지 않는다
    fireEvent.click(screen.getByRole("button", { name: "현재가" }));
    await waitFor(() => expect(마지막()).toMatchObject({ sort_by: "price", sort_order: "desc" }));
  });

  it("흐름·글 칸은 세울 수 없다 — 서버가 숫자로만 세운다", async () => {
    그리기();
    await screen.findByText("NVIDIA Corporation");
    expect(screen.getByRole("columnheader", { name: "매출 흐름" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "매출 흐름" })).toBeNull();
  });

  it("세우는 동안 앞 결과를 그대로 둔다", async () => {
    그리기();
    await screen.findByText("NVIDIA Corporation");
    run.mockImplementation(() => new Promise(() => {}));
    fireEvent.click(screen.getByRole("button", { name: "PER" }));
    await waitFor(() => expect(마지막().sort_by).toBe("per"));
    expect(screen.getByText("NVIDIA Corporation")).toBeTruthy();
  });
});

describe("시장", () => {
  it("시장을 바꾸면 앞 시장의 종목을 보이지 않는다", async () => {
    그리기();
    await screen.findByText("NVIDIA Corporation");
    run.mockImplementation(() => new Promise(() => {}));
    fireEvent.click(screen.getByRole("tab", { name: "국내" }));
    await waitFor(() => expect(마지막().market).toBe("KR"));
    expect(screen.queryByText("NVIDIA Corporation")).toBeNull();
    expect(screen.getByRole("status", { name: "불러오는 중" })).toBeTruthy();
  });

  it("ETF 는 ETF 에 값이 있는 칸과 조건 묶음만 — 시가총액 자리는 순자산", async () => {
    그리기();
    await screen.findByText("NVIDIA Corporation");
    fireEvent.click(screen.getByRole("tab", { name: "ETF" }));
    await waitFor(() => expect(마지막().market).toBe("ETF"));
    expect(await screen.findByRole("button", { name: "순자산" })).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: "매출 흐름" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "조건 묶음" }));
    expect(screen.getByRole("button", { name: /^고배당/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^저PER 우량주/ })).toBeNull();
    // 조건 판도 — ETF 엔 매출이 없다
    fireEvent.click(screen.getByRole("button", { name: "조건" }));
    expect(screen.getByRole("spinbutton", { name: "배당수익률 (%) 최소" })).toBeTruthy();
    expect(screen.queryByRole("spinbutton", { name: "매출 (억달러) 최소" })).toBeNull();
  });
});

describe("찾기", () => {
  it("치는 동안은 묻지 않고 멈추면 마지막 말로 묻는다", async () => {
    그리기();
    await screen.findByText("NVIDIA Corporation");
    const 칸 = screen.getByRole("searchbox", { name: "티커나 이름으로 찾기" });
    fireEvent.change(칸, { target: { value: "n" } });
    fireEvent.change(칸, { target: { value: "nvda, apple " } });
    await waitFor(() => expect(마지막().q).toBe("nvda, apple"));
    expect(run.mock.calls.some((c) => c[0].q === "n")).toBe(false);
    expect(screen.getByText("찾기: nvda, apple")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "찾기 빼기" }));
    // 찾기 전 결과는 이미 받아 둔 것이라 다시 묻지 않고 그대로 보인다
    await waitFor(() => expect(screen.queryByText("찾기: nvda, apple")).toBeNull());
    expect((칸 as HTMLInputElement).value).toBe("");
  });

  it("'모두 지우기' 는 찾는 말도 지운다", async () => {
    그리기();
    await screen.findByText("NVIDIA Corporation");
    const 칸 = screen.getByRole("searchbox", { name: "티커나 이름으로 찾기" });
    fireEvent.change(칸, { target: { value: "tsm" } });
    await waitFor(() => expect(마지막().q).toBe("tsm"));
    fireEvent.click(screen.getByRole("button", { name: "모두 지우기" }));
    expect((칸 as HTMLInputElement).value).toBe("");
    await waitFor(() => expect(screen.queryByText("찾기: tsm")).toBeNull());
  });
});

describe("조건", () => {
  const 조건열기 = () => fireEvent.click(screen.getByRole("button", { name: "조건" }));

  it("적고 '적용' 을 눌러야 보낸다 — 돈 조건은 억 단위를 원래 단위로", async () => {
    그리기();
    await screen.findByText("NVIDIA Corporation");
    조건열기();
    fireEvent.change(screen.getByRole("spinbutton", { name: "매출 (억달러) 최소" }), { target: { value: "1000" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "PER 최대", exact: true } as any), { target: { value: "20" } });
    expect(run).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "적용" }));
    await waitFor(() => expect(마지막().filters).toEqual({ revenue: { min: 1000 * 1e8 }, per: { max: 20 } }));
    expect(screen.getByText("매출 ≥ 1,000억달러")).toBeTruthy();
    expect(screen.getByText("PER ≤ 20")).toBeTruthy();
    expect(screen.getByRole("button", { name: "조건 2" })).toBeTruthy();
  });

  it("한국은 억원으로 적는다", async () => {
    그리기();
    await screen.findByText("NVIDIA Corporation");
    fireEvent.click(screen.getByRole("tab", { name: "국내" }));
    조건열기();
    fireEvent.change(screen.getByRole("spinbutton", { name: "시가총액 (억원) 최소" }), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: "적용" }));
    await waitFor(() => expect(마지막()).toMatchObject({ market: "KR", filters: { market_cap: { min: 5000 * 1e8 } } }));
    expect(screen.getByText("시가총액 ≥ 5,000억원")).toBeTruthy();
  });

  it("최소가 최대보다 크면 보내지 않고 알린다", async () => {
    그리기();
    await screen.findByText("NVIDIA Corporation");
    조건열기();
    fireEvent.change(screen.getByRole("spinbutton", { name: "PBR 최소" }), { target: { value: "5" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "PBR 최대" }), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "적용" }));
    expect(screen.getByRole("alert").textContent).toMatch(/PBR.*최소가 최대보다 커요/);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("국가·섹터·산업은 서버가 그 시장에서 모아 준 값으로 고른다 — 야후의 이름 그대로 보낸다", async () => {
    그리기();
    await screen.findByText("NVIDIA Corporation");
    조건열기();
    const 섹터 = screen.getByRole("combobox", { name: /섹터/ }) as HTMLSelectElement;
    expect([...섹터.options].map((o) => o.textContent)).toEqual(["전체", "에너지", "기술"]);
    fireEvent.change(섹터, { target: { value: "Technology" } });
    fireEvent.change(screen.getByRole("combobox", { name: /국가/ }), { target: { value: "Taiwan" } });
    fireEvent.click(screen.getByRole("button", { name: "적용" }));
    await waitFor(() => expect(마지막().filters).toEqual({ sector: { eq: "Technology" }, country: { eq: "Taiwan" } }));
    expect(screen.getByText("섹터: 기술")).toBeTruthy();
    expect(screen.getByText("국가: 대만")).toBeTruthy();
  });

  it("칩의 × 로 그 조건만 빼고, '모두 지우기' 로 다 뺀다", async () => {
    그리기();
    await screen.findByText("NVIDIA Corporation");
    조건열기();
    fireEvent.change(screen.getByRole("spinbutton", { name: "ROE (%) 최소" }), { target: { value: "15" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "배당수익률 (%) 최소" }), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "적용" }));
    await waitFor(() => expect(Object.keys(마지막().filters)).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "ROE ≥ 15% 조건 빼기" }));
    await waitFor(() => expect(마지막().filters).toEqual({ dividend_yield: { min: 2 } }));
    expect(screen.queryByText("ROE ≥ 15%")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "모두 지우기" }));
    // 조건 없는 결과는 처음에 받아 둔 것 — 칩이 다 빠지고 '조건' 단추에 수가 없다
    await waitFor(() => expect(screen.queryByText("배당수익률 ≥ 2%")).toBeNull());
    expect(screen.getByRole("button", { name: "조건" })).toBeTruthy();
  });

  it("다시 열면 걸린 조건이 적혀 있다", async () => {
    그리기();
    await screen.findByText("NVIDIA Corporation");
    조건열기();
    fireEvent.change(screen.getByRole("spinbutton", { name: "RSI (14) 최대" }), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "적용" }));
    await waitFor(() => expect(마지막().filters).toEqual({ rsi: { max: 30 } }));
    fireEvent.click(screen.getByRole("button", { name: "조건 1" }));
    expect((screen.getByRole("spinbutton", { name: "RSI (14) 최대" }) as HTMLInputElement).value).toBe("30");
  });
});

describe("조건 묶음", () => {
  it("Esc 나 같은 단추로 판을 닫는다", async () => {
    그리기();
    await screen.findByText("NVIDIA Corporation");
    fireEvent.click(screen.getByRole("button", { name: "조건 묶음" }));
    expect(screen.getByText("자주 쓰는 조건")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("자주 쓰는 조건")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "조건 묶음" }));
    fireEvent.click(screen.getByRole("button", { name: "조건 묶음" }));
    expect(screen.queryByText("자주 쓰는 조건")).toBeNull();
  });

  it("누르면 조건과 정렬을 한 번에 건다", async () => {
    그리기();
    await screen.findByText("NVIDIA Corporation");
    fireEvent.click(screen.getByRole("button", { name: "조건 묶음" }));
    fireEvent.click(screen.getByRole("button", { name: /^고배당/ }));
    await waitFor(() => expect(마지막()).toMatchObject({
      filters: { dividend_yield: { min: 4 } }, sort_by: "dividend_yield", sort_order: "desc",
    }));
    fireEvent.click(screen.getByRole("button", { name: "조건 묶음" }));
    expect(screen.getByRole("button", { name: /^고배당/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /^과매도/ }).getAttribute("aria-pressed")).toBe("false");
  });

  it("저장한 보기를 열면 시장·조건·정렬·칸이 그대로 돌아온다", async () => {
    상태.로그인 = true;
    getPresets.mockResolvedValue([{ id: 1, name: "내 보기", market: "KR", filters: { per: { max: 10 } },
      sort_by: "per", sort_order: "asc", columns: ["price", "per"] }]);
    그리기();
    await screen.findByText("NVIDIA Corporation");
    fireEvent.click(screen.getByRole("button", { name: "조건 묶음" }));
    fireEvent.click(await screen.findByRole("button", { name: /^내 보기 ·/ }));
    await waitFor(() => expect(마지막()).toMatchObject({
      market: "KR", filters: { per: { max: 10 } }, sort_by: "per", sort_order: "asc",
    }));
    await screen.findByText("NVIDIA Corporation");
    const 제목들 = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(제목들).toEqual(["종목", "현재가", "PER", "관심종목"]);
  });

  it("저장한 보기를 지울 수 있다", async () => {
    상태.로그인 = true;
    getPresets.mockResolvedValue([{ id: 7, name: "지울 보기", market: "US", filters: {}, sort_by: "per", sort_order: "desc" }]);
    그리기();
    await screen.findByText("NVIDIA Corporation");
    fireEvent.click(screen.getByRole("button", { name: "조건 묶음" }));
    fireEvent.click(await screen.findByRole("button", { name: "지울 보기 보기 지우기" }));
    await waitFor(() => expect(deletePreset).toHaveBeenCalledWith(7));
  });
});

describe("칸 고르기", () => {
  it("끈 칸은 표에서 빠지고, 다시 열어도 그대로다", async () => {
    const { unmount } = 그리기();
    await screen.findByText("NVIDIA Corporation");
    fireEvent.click(screen.getByRole("button", { name: `칸 ${처음칸.length}` }));
    expect(screen.getByText(`${처음칸.length}/${칸들.length}`)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "PER" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "ROE" }));
    expect(screen.queryByRole("columnheader", { name: "PER" })).toBeNull();
    expect(screen.getByRole("columnheader", { name: "ROE" })).toBeTruthy();
    unmount();
    그리기();
    await screen.findByText("NVIDIA Corporation");
    expect(screen.queryByRole("columnheader", { name: "PER" })).toBeNull();
    expect(screen.getByRole("columnheader", { name: "ROE" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^칸 \d+$/ }));
    fireEvent.click(screen.getByRole("button", { name: "처음대로" }));
    expect(screen.getByRole("columnheader", { name: "PER" })).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: "ROE" })).toBeNull();
  });

  it.each([["{망가짐"], ["[]"], ['["없는칸"]']])("남겨 둔 값이 %s 이면 처음 칸으로 연다", async (값) => {
    localStorage.setItem("screening_cols_v2", 값);
    그리기();
    await screen.findByText("NVIDIA Corporation");
    expect(screen.getByRole("button", { name: `칸 ${처음칸.length}` })).toBeTruthy();
  });
});

describe("표의 칸", () => {
  it("매출 흐름은 해마다 막대로, 적자 해는 빨간 막대 — 값은 설명에 다 적는다", async () => {
    그리기();
    const 막대 = await screen.findByRole("img", { name: /NVIDIA Corporation 매출 흐름/ });
    expect(막대.getAttribute("aria-label")).toContain("2022 $27.00B · 2023 -$5.00B · 2024 $130.50B");
    expect(막대.querySelectorAll("rect")).toHaveLength(3);
    expect(막대.querySelectorAll("rect.fill-accent-red")).toHaveLength(1);
  });

  it("값이 없는 해는 막대 자리를 비운다", async () => {
    run.mockResolvedValue(응답([줄({ symbol: "GAP", name: "Gap Year", fin_years: [2022, 2023, 2024], rev_hist: [5e9, null, 7e9] })]));
    그리기();
    const 막대 = await screen.findByRole("img", { name: /Gap Year 매출 흐름/ });
    expect(막대.querySelectorAll("rect")).toHaveLength(2);
    expect(막대.getAttribute("aria-label")).toContain("2023 —");
  });

  it("해외 회사의 흐름은 그 회사 장부의 돈으로 적는다", async () => {
    그리기();
    const 막대 = await screen.findByRole("img", { name: /Taiwan Semiconductor 매출 흐름/ });
    expect(막대.getAttribute("aria-label")).toContain("2025 TWD 3.63T");
  });

  it("흐름을 아직 못 받은 종목은 막대 대신 —", async () => {
    그리기();
    await screen.findByText("Xyz Holdings");
    expect(screen.queryByRole("img", { name: /Xyz Holdings 매출 흐름/ })).toBeNull();
  });

  it("오늘 등락은 ▲▼ 와 설정의 오름·내림 색", async () => {
    그리기();
    await screen.findByText("NVIDIA Corporation");
    const 오름 = screen.getByText("2.49%", { exact: false });
    expect(오름.textContent).toContain("▲");
    expect(오름.className).toContain("text-accent-red");
    const 내림 = screen.getByText("1.50%", { exact: false });
    expect(내림.textContent).toContain("▼");
    expect(내림.className).toContain("text-accent-blue");
  });

  it("로고는 회사 누리집의 아이콘 — 못 받으면 첫 글자", async () => {
    const { container } = 그리기();
    await screen.findByText("NVIDIA Corporation");
    const 그림 = container.querySelector('img[src*="nvidia.com"]') as HTMLImageElement;
    expect(그림).toBeTruthy();
    fireEvent.error(그림);
    expect(container.querySelector('img[src*="nvidia.com"]')).toBeNull();
    const 이름칸 = screen.getByText("NVIDIA Corporation").closest("td")!;
    expect(이름칸.textContent).toContain("N");
    // 누리집을 모르는 회사도 자리를 비우지 않는다
    expect(screen.getByText("Xyz Holdings").closest("td")!.textContent).toMatch(/^3X/);
  });

  it("이름을 누르면 상세 화면으로 간다", async () => {
    그리기();
    const 이름 = await screen.findByText("NVIDIA Corporation");
    expect(이름.closest("a")!.getAttribute("href")).toBe("/stocks/US/NVDA");
  });

  it("30곳씩 보이고 '더 보기' 로 더", async () => {
    run.mockResolvedValue(응답(Array.from({ length: 40 }, (_, i) => 줄({ symbol: `S${i}`, name: `회사${i}` }))));
    그리기();
    await screen.findByText("회사0");
    expect(screen.getAllByRole("row")).toHaveLength(31);
    fireEvent.click(screen.getByRole("button", { name: "더 보기 (10곳 더)" }));
    expect(screen.getAllByRole("row")).toHaveLength(41);
    // 다른 정렬은 다른 목록 — 다시 위에서 30곳부터
    fireEvent.click(screen.getByRole("button", { name: "PER" }));
    await waitFor(() => expect(마지막().sort_by).toBe("per"));
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(31));
  });
});

describe("서버가 시장을 처음 받는 중", () => {
  /* 배포 직후·처음 여는 시장은 서버에 받아 둔 자료가 없다. 다 받는 데 1~3분 — 예전엔 그동안 표가
     빈 채였다(사용자: "처음에는 아무것도 안나오던데") */
  it("받은 것부터 보이고 얼마나 받았는지 알리며, 다 받을 때까지 다시 묻는다", async () => {
    run.mockResolvedValueOnce(응답(기본줄들.slice(0, 1), { building: { done: 120, total: 315 } }));
    그리기();
    expect(await screen.findByText("NVIDIA Corporation")).toBeTruthy();
    expect(screen.getByRole("status", { name: "시장 전체를 받는 중" }).textContent).toContain("120/315곳");
    expect(screen.getByText(/시장 전체를 받는 중$/)).toBeTruthy();
    // 3초 뒤 다시 묻는다 — 이번엔 다 받았다
    expect(await screen.findByText("Xyz Holdings", {}, { timeout: 5000 })).toBeTruthy();
    expect(run).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("status", { name: "시장 전체를 받는 중" })).toBeNull();
  }, 10000);

  it("아직 하나도 못 받았으면 '맞는 종목이 없어요' 가 아니라 받는 중", async () => {
    run.mockResolvedValue(응답([], { building: { done: 0, total: 0 } }));
    그리기();
    expect(await screen.findByRole("status", { name: "시장 전체를 받는 중" })).toBeTruthy();
    expect(screen.getByRole("status", { name: "불러오는 중" })).toBeTruthy();
    expect(screen.queryByText("조건에 맞는 종목이 없어요")).toBeNull();
  });

  it("야후에서 한 줄도 못 받았으면 그렇게 알리고 다시 시도하게 한다", async () => {
    run.mockResolvedValue(응답([], { failed: true }));
    그리기();
    expect(await screen.findByText("야후에서 시세를 받지 못했어요")).toBeTruthy();
    expect(screen.queryByText("조건에 맞는 종목이 없어요")).toBeNull();
    run.mockResolvedValue(응답());
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByText("NVIDIA Corporation")).toBeTruthy();
  });
});

describe("없음과 실패", () => {
  it("맞는 종목이 없으면 그렇게 말하고, 조건을 걸었으면 지우는 단추를 준다", async () => {
    그리기();
    await screen.findByText("NVIDIA Corporation");
    run.mockResolvedValue(응답([]));
    fireEvent.click(screen.getByRole("button", { name: "조건 묶음" }));
    fireEvent.click(screen.getByRole("button", { name: /^과매도/ }));
    expect(await screen.findByText("조건에 맞는 종목이 없어요")).toBeTruthy();
    run.mockResolvedValue(응답());
    fireEvent.click(screen.getByRole("button", { name: "조건 모두 지우기" }));
    await waitFor(() => expect(마지막().filters).toEqual({}));
  });

  it("못 불러왔으면 '없음' 이 아니라 실패로 알리고 다시 시도하게 한다", async () => {
    run.mockRejectedValue(new Error("Network Error"));
    그리기();
    const 다시 = await screen.findByRole("button", { name: "다시 시도" });
    expect(screen.queryByText("조건에 맞는 종목이 없어요")).toBeNull();
    run.mockResolvedValue(응답());
    fireEvent.click(다시);
    expect(await screen.findByText("NVIDIA Corporation")).toBeTruthy();
  });
});

describe("보기 저장", () => {
  it("로그인하면 시장·조건(적은 단위 그대로)·정렬·칸을 함께 남긴다", async () => {
    상태.로그인 = true;
    그리기();
    await screen.findByText("NVIDIA Corporation");
    fireEvent.click(screen.getByRole("button", { name: "조건" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "시가총액 (억달러) 최소" }), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: "적용" }));
    fireEvent.click(screen.getByRole("button", { name: "PER" }));
    fireEvent.click(screen.getByRole("button", { name: "보기 저장" }));
    fireEvent.change(screen.getByRole("textbox", { name: /지금 보기 저장/ }), { target: { value: "  큰 회사  " } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(savePreset).toHaveBeenCalled());
    expect(savePreset.mock.calls[0][0]).toEqual({
      name: "큰 회사", market: "US", filters: { market_cap: { min: 1000 } },
      sort_by: "per", sort_order: "desc", columns: 처음칸,
    });
    expect(await screen.findByText(/지금 보기를 저장했어요/)).toBeTruthy();
  });

  it("로그인하지 않았으면 저장 대신 로그인하라고 한다", async () => {
    그리기();
    await screen.findByText("NVIDIA Corporation");
    fireEvent.click(screen.getByRole("button", { name: "보기 저장" }));
    expect(screen.getByText(/로그인하면 지금 보기/)).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: /지금 보기 저장/ })).toBeNull();
    expect(getPresets).not.toHaveBeenCalled();
  });
});

describe("관심종목 별 — 종목 상세처럼 폴더를 골라 담는다", () => {
  /* 사용자: "관심종목 어떤 폴더에 담을지 종목상세탭처럼 해줘". 예전엔 누르면 곧바로 기본 목록에
     담았고, 이미 담긴 종목도 빈 별이라 누르면 '이미 추가된 종목' 오류가 떴다 */
  const 별 = (이름: RegExp) => screen.getByRole("button", { name: 이름 });

  it("빈 별을 누르면 기본과 내 폴더가 펼쳐지고, 고른 폴더에 담는다", async () => {
    상태.로그인 = true;
    관심.폴더 = [{ id: 7, name: "반도체" }, { id: 8, name: "배당" }];
    그리기();
    await screen.findByText("Taiwan Semiconductor");
    fireEvent.click(별(/Taiwan Semiconductor 관심종목에 담기/));
    const 메뉴 = await screen.findByRole("menu", { name: "담을 폴더" });
    expect(within(메뉴).getAllByRole("menuitem").map((b) => b.textContent)).toEqual(["기본 관심목록", "반도체", "배당"]);
    fireEvent.click(within(메뉴).getByRole("menuitem", { name: "반도체" }));
    await waitFor(() => expect(관심.addItem).toHaveBeenCalled());
    expect(관심.addItem.mock.calls[0][0]).toMatchObject({ symbol: "TSM", market: "US", name: "Taiwan Semiconductor", folder_id: 7 });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(await screen.findByText(/Taiwan Semiconductor 관심종목에 담았어요/)).toBeTruthy();
    // 누르자마자 채운다 — 안 눌린 줄 알고 또 누르면 두 줄이 된다
    expect(별(/Taiwan Semiconductor 관심종목에서 빼기/).getAttribute("aria-pressed")).toBe("true");
  });

  it("기본을 고르면 폴더 없이 담는다 — 서버가 '기본 관심목록' 폴더를 만들어 넣는다", async () => {
    상태.로그인 = true;
    그리기();
    await screen.findByText("Xyz Holdings");
    fireEvent.click(별(/Xyz Holdings 관심종목에 담기/));
    fireEvent.click(await screen.findByRole("menuitem", { name: "기본 관심목록" }));
    await waitFor(() => expect(관심.addItem).toHaveBeenCalled());
    expect(관심.addItem.mock.calls[0][0].folder_id).toBeNull();
  });

  it("'기본 관심목록' 폴더가 이미 있으면 맨 위에 한 번만 — 같은 곳이 두 번 보이지 않는다", async () => {
    상태.로그인 = true;
    관심.폴더 = [{ id: 7, name: "반도체" }, { id: 3, name: "기본 관심목록" }];
    그리기();
    await screen.findByText("Xyz Holdings");
    fireEvent.click(별(/Xyz Holdings 관심종목에 담기/));
    const 메뉴 = await screen.findByRole("menu", { name: "담을 폴더" });
    expect(within(메뉴).getAllByRole("menuitem").map((b) => b.textContent)).toEqual(["기본 관심목록", "반도체"]);
    fireEvent.click(within(메뉴).getByRole("menuitem", { name: "기본 관심목록" }));
    await waitFor(() => expect(관심.addItem).toHaveBeenCalled());
    expect(관심.addItem.mock.calls[0][0].folder_id).toBe(3);
  });

  it("이미 담긴 종목은 채운 별이고, 누르면 뺀다", async () => {
    상태.로그인 = true;
    관심.목록 = [{ id: 41, symbol: "NVDA", market: "US", name: "NVIDIA", folder_id: null }];
    그리기();
    await screen.findByText("NVIDIA Corporation");
    const 채운별 = await screen.findByRole("button", { name: /NVIDIA Corporation 관심종목에서 빼기/ });
    expect(채운별.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(채운별);
    await waitFor(() => expect(관심.removeItem).toHaveBeenCalledWith(41));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("Esc 나 바깥을 누르면 폴더 목록을 닫는다", async () => {
    상태.로그인 = true;
    그리기();
    await screen.findByText("Xyz Holdings");
    fireEvent.click(별(/Xyz Holdings 관심종목에 담기/));
    await screen.findByRole("menu");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(별(/Xyz Holdings 관심종목에 담기/));
    await screen.findByRole("menu");
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("이미 담겨 있었으면 오류가 아니라 담겼다고 한다", async () => {
    상태.로그인 = true;
    관심.addItem = vi.fn(() => Promise.reject({ response: { status: 400, data: { detail: "이미 추가된 종목입니다" } } }));
    그리기();
    await screen.findByText("Xyz Holdings");
    fireEvent.click(별(/Xyz Holdings 관심종목에 담기/));
    fireEvent.click(await screen.findByRole("menuitem", { name: "기본 관심목록" }));
    expect(await screen.findByText("이미 담긴 종목이에요")).toBeTruthy();
  });

  it("로그인하지 않았으면 로그인으로 보낸다", async () => {
    그리기();
    await screen.findByText("Xyz Holdings");
    fireEvent.click(별(/Xyz Holdings 관심종목에 담기/));
    expect(await screen.findByText("로그인 화면")).toBeTruthy();
  });
});

describe("앱의 다른 화면과 같게", () => {
  it("시장 탭은 국내·해외·ETF — 처음엔 해외", async () => {
    그리기();
    await screen.findByText("NVIDIA Corporation");
    const 탭들 = screen.getAllByRole("tab");
    expect(탭들.map((t) => t.textContent)).toEqual(["국내", "해외", "ETF"]);
    expect(screen.getByRole("tab", { name: "해외" }).getAttribute("aria-selected")).toBe("true");
  });

  it("시세가 언제 것인지 밝힌다 — 서버가 5분마다 묶음 시세로 받는다", async () => {
    run.mockResolvedValue(응답(기본줄들, { as_of: Date.now() / 1000 - 120 }));
    그리기();
    await screen.findByText("NVIDIA Corporation");
    expect(screen.getByText(/시세 2분 전/)).toBeTruthy();
  });
});

describe("CSV 단추", () => {
  it("받은 결과를 보이는 칸대로, 쉼표 든 이름까지 감싸서 내려받는다", async () => {
    run.mockResolvedValue(응답([줄({ symbol: "BRK-B", name: "Berkshire Hathaway, Inc.", price: 400, per: 9.5, rev_hist: [1, null, 3] })]));
    const 만든것: Blob[] = [];
    const 원래 = URL.createObjectURL;
    URL.createObjectURL = ((b: Blob) => { 만든것.push(b); return "blob:x"; }) as any;
    URL.revokeObjectURL = (() => {}) as any;
    try {
      그리기();
      await screen.findByText("BRK-B");
      fireEvent.click(screen.getByTitle("CSV 다운로드"));
      expect(만든것).toHaveLength(1);
      const 글 = await 만든것[0].text();
      expect(글).toContain('"Berkshire Hathaway, Inc."');
      expect(글).toContain("1//3");
      expect(글).toContain("9.5");
    } finally {
      URL.createObjectURL = 원래;
    }
  });
});

describe("보낼조건", () => {
  it("돈 조건(시가총액·매출·순이익·FCF·순부채)만 억을 원래 단위로, 나머지는 그대로", () => {
    expect(보낼조건({
      per: { max: 10 }, market_cap: { min: 1, max: 2 }, revenue: { min: 3 }, earnings: { max: 4 },
      fcf: { min: 5 }, net_debt: { max: 0 }, sector: { eq: "Energy" },
    })).toEqual({
      per: { max: 10 }, market_cap: { min: 1e8, max: 2e8 }, revenue: { min: 3e8 }, earnings: { max: 4e8 },
      fcf: { min: 5e8 }, net_debt: { max: 0 }, sector: { eq: "Energy" },
    });
  });
});

describe("조건 글", () => {
  it.each([
    ["dividend_yield", { min: 4 }, "US", "배당수익률 ≥ 4%"],
    ["market_cap", { min: 1000 }, "KR", "시가총액 ≥ 1,000억원"],
    ["revenue", { min: 1000 }, "US", "매출 ≥ 1,000억달러"],
    ["per", { min: 10, max: 20 }, "US", "PER 10 ~ 20"],
    ["ps_ratio", { max: 2 }, "US", "PSR ≤ 2"],
    ["pct_from_52w_high", { min: -5 }, "US", "52주 고점 대비 ≥ -5%"],
    ["sector", { eq: "Technology" }, "US", "섹터: 기술"],
    ["country", { eq: "Taiwan" }, "US", "국가: 대만"],
    ["industry", { eq: "Semiconductors" }, "US", "산업: Semiconductors"],
  ])("%s %j (%s) → %s", (k, v, 시장, 글) => {
    expect(조건글(k, v, 시장)).toBe(글);
  });

  it("같은 조건인지는 열쇠 순서를 가리지 않는다", () => {
    expect(같은조건({ per: { max: 15 }, roe: { min: 15 } }, { roe: { min: 15 }, per: { max: 15 } })).toBe(true);
    expect(같은조건({ per: { max: 15 } }, { per: { max: 16 } })).toBe(false);
    expect(같은조건({ per: { max: 15 } }, { per: { max: 15 }, roe: { min: 1 } })).toBe(false);
  });
});

describe("섹터 목록", () => {
  it("야후가 쓰지 않는 이름을 싣지 않는다", () => {
    const 야후 = new Set([
      "Technology", "Healthcare", "Financial Services", "Consumer Cyclical", "Industrials",
      "Communication Services", "Consumer Defensive", "Energy", "Basic Materials",
      "Real Estate", "Utilities",
    ]);
    for (const s of SECTORS) if (s.value) expect(야후.has(s.value), s.value).toBe(true);
  });
});
