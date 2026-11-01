/**
 * 전략 저장소가 비었을 때 — 같은 단추가 두 번, 의미 없는 0 이 세 번 보이지 않게(디자인 7번).
 *
 * 비어 있으면 아래 빈 화면이 '첫 전략 만들기' 를 내민다. 머리의 '새 전략 만들기' 와 0 만 늘어선 통계 카드는
 * 감춘다. 하나라도 있으면 둘 다 돌아온다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const 상태 = vi.hoisted(() => ({ 전략들: [] as any[], 실험들: [] as any[], 로그인함: true }));

vi.mock("@/api/stocks", () => ({
  backtestApi: {
    getStrategies: vi.fn(() => Promise.resolve(상태.전략들)),
    getExperiments: vi.fn(() => Promise.resolve(상태.실험들)),
    deleteStrategy: vi.fn(), deleteExperiment: vi.fn(),
  },
}));
vi.mock("@/store/authStore", () => ({
  useAuthStore: () => ({ isLoggedIn: 상태.로그인함, userId: 1 }),
}));

import Strategies from "../Strategies";

function 그리기() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}><Strategies /></QueryClientProvider>
    </MemoryRouter>,
  );
}

const 전략 = {
  id: 5, name: "RSI 반등", version: 1, market: "US", created_at: "2026-08-01",
  entry_conditions: { logic: "AND", conditions: [{}] },
  exit_conditions: { logic: "OR", conditions: [{}] },
};

beforeEach(() => { 상태.전략들 = []; 상태.실험들 = []; 상태.로그인함 = true; });

describe("전략 저장소 — 비었을 때", () => {
  it("빈 화면의 '첫 전략 만들기' 하나만 — 머리 단추와 0 통계는 감춘다", async () => {
    그리기();
    expect(await screen.findByRole("button", { name: /첫 전략 만들기/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /새 전략 만들기/ })).toBeNull();
    expect(screen.queryByText("매매 신호")).toBeNull();
  });

  it("하나라도 있으면 머리 단추와 통계가 돌아온다", async () => {
    상태.전략들 = [전략];
    그리기();
    expect(await screen.findByText("RSI 반등")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /새 전략 만들기/ })).toBeInTheDocument();
    expect(screen.getAllByText("매매 신호").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /첫 전략 만들기/ })).toBeNull();
  });

  it("로그인 전에는 머리 단추가 남는다 — 아래에 만들기 단추가 없다", async () => {
    상태.로그인함 = false;
    그리기();
    expect(await screen.findByText("로그인이 필요합니다")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /새 전략 만들기/ })).toBeInTheDocument();
  });
});
