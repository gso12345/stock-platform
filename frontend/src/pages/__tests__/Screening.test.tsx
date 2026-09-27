/**
 * 스크리닝 화면 — **켜져 있고, 적은 조건이 그대로 서버에 닿는가.**
 *
 * 이 화면은 한동안 '준비중' 으로 막혀 있었다. 막힌 뒤에 숨어 있던 문제:
 *   · 시가총액 칸 이름은 '(억)' 인데 숫자를 그대로 보냈다 → 1000 을 적으면
 *     '시총 1000원 이상' 이라 아무것도 안 걸렀다
 *   · 섹터는 받은 100개 안에서 화면이 걸렀다 → 전체 기술주가 아니라
 *     '시총 상위 100개 중 기술주' 가 나왔다. 야후에 없는 이름("Financials")
 *     도 있어서 금융은 늘 0개였다
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const run = vi.fn();
vi.mock("@/api/stocks", async (원본) => ({
  ...(await 원본<any>()),
  screeningApi: {
    run: (...a: any[]) => run(...a),
    getPresets: vi.fn(() => Promise.resolve([])),
    savePreset: vi.fn(),
    deletePreset: vi.fn(),
  },
}));
vi.mock("@/store/authStore", () => ({
  useAuthStore: (sel?: any) => { const s = { isLoggedIn: false }; return sel ? sel(s) : s; },
}));

import Screening, { SECTORS, 보낼조건 } from "../Screening";

function 그리기() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><MemoryRouter><Screening /></MemoryRouter></QueryClientProvider>,
  );
}

function 칸(이름: RegExp, 몇째: 0 | 1) {
  const 라벨 = screen.getByText(이름);
  return 라벨.parentElement!.querySelectorAll("input")[몇째] as HTMLInputElement;
}

beforeEach(() => {
  run.mockReset();
  run.mockResolvedValue({ results: [], total: 0 });
});

describe("스크리닝 화면", () => {
  it("준비중이 아니라 조건과 실행 버튼이 보인다", () => {
    그리기();
    expect(screen.queryByText(/준비중/)).toBeNull();
    expect(screen.getByRole("button", { name: "스크리닝 실행" })).toBeTruthy();
  });

  it("시가총액은 억 단위로 적은 것을 원래 단위로 바꿔 보낸다", async () => {
    그리기();
    fireEvent.change(칸(/시가총액 \(억달러\)/, 0), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: "스크리닝 실행" }));
    await waitFor(() => expect(run).toHaveBeenCalled());
    expect(run.mock.calls[0][0].filters.market_cap).toEqual({ min: 1000 * 1e8 });
  });

  it("섹터는 서버로 보낸다 — 야후의 이름 그대로", async () => {
    그리기();
    fireEvent.change(screen.getByDisplayValue("전체"), { target: { value: "Financial Services" } });
    fireEvent.click(screen.getByRole("button", { name: "스크리닝 실행" }));
    await waitFor(() => expect(run).toHaveBeenCalled());
    expect(run.mock.calls[0][0].filters.sector).toEqual({ eq: "Financial Services" });
  });

  it("섹터를 '전체' 로 되돌리면 조건에서 빠진다", async () => {
    그리기();
    const 고르개 = screen.getByDisplayValue("전체");
    fireEvent.change(고르개, { target: { value: "Energy" } });
    fireEvent.change(고르개, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "스크리닝 실행" }));
    await waitFor(() => expect(run).toHaveBeenCalled());
    expect(run.mock.calls[0][0].filters).not.toHaveProperty("sector");
  });

  it("서버가 준 결과를 화면이 다시 거르지 않는다 — 섹터값이 없는 줄도 그대로 보인다", async () => {
    run.mockResolvedValue({ total: 250, results: [
      { symbol: "AAA", name: "에이", market: "US", price: 10 },
      { symbol: "BBB", name: "비", market: "US", price: 20, sector: "Energy" },
    ] });
    그리기();
    fireEvent.change(screen.getByDisplayValue("전체"), { target: { value: "Technology" } });
    fireEvent.click(screen.getByRole("button", { name: "스크리닝 실행" }));
    expect(await screen.findByText("AAA")).toBeTruthy();
    expect(screen.getByText("BBB")).toBeTruthy();
    // 몇 개가 걸렸는지는 서버의 전체 수로 말한다
    expect(screen.getByText("250")).toBeTruthy();
    expect(screen.getByText(/위에서 2개만 보여요/)).toBeTruthy();
  });
});

describe("CSV 단추", () => {
  it("받은 결과를 쉼표 든 이름까지 감싸서 내려받는다", async () => {
    run.mockResolvedValue({ total: 1, results: [
      { symbol: "BRK-B", name: "Berkshire Hathaway, Inc.", market: "US", price: 400, per: 9.5 },
    ] });
    const 만든것: Blob[] = [];
    const 원래 = URL.createObjectURL;
    URL.createObjectURL = ((b: Blob) => { 만든것.push(b); return "blob:x"; }) as any;
    URL.revokeObjectURL = (() => {}) as any;
    try {
      그리기();
      fireEvent.click(screen.getByRole("button", { name: "스크리닝 실행" }));
      await screen.findByText("BRK-B");
      fireEvent.click(screen.getByTitle("CSV 다운로드"));
      expect(만든것).toHaveLength(1);
      expect(await 만든것[0].text()).toContain('"Berkshire Hathaway, Inc."');
    } finally {
      URL.createObjectURL = 원래;
    }
  });
});

describe("보낼조건", () => {
  it("시가총액만 바꾸고 나머지는 그대로 둔다", () => {
    expect(보낼조건({ per: { max: 10 }, market_cap: { min: 1, max: 2 } }))
      .toEqual({ per: { max: 10 }, market_cap: { min: 1e8, max: 2e8 } });
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
