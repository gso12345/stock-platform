/**
 * 퀀트 표의 용어 설명.
 *
 * 표 머리글은 '가치 / 품질 / 모멘텀 / 성장 / 안정성' 다섯 낱말뿐이다.
 * 낱말만 봐서는 점수가 높은 게 좋은 건지도 알 수 없다.
 *
 * 여기서 특히 조심할 것은, 머리글이 **이미 정렬 버튼** 이라는 점이다.
 * 설명 버튼을 그 안에 넣으면 설명을 보려다 정렬이 바뀐다.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

vi.mock("react-router-dom", async () => {
  const 실제 = await vi.importActual<any>("react-router-dom");
  return { ...실제, useNavigate: () => vi.fn() };
});

vi.mock("@/store/authStore", () => ({
  useAuthStore: (sel?: any) => {
    const s = { isLoggedIn: true, user: { id: 1 } };
    return sel ? sel(s) : s;
  },
}));

const 관심종목 = [{ id: 1, symbol: "005930.KS", market: "KR", name: "삼성전자", folder_id: null }];
/* 실제 응답 모양 그대로 — items 배열이고 factors 는 {key, score} 목록이다.
   손으로 지어내면 화면이 안 그려지는데 그 이유를 한참 못 찾는다 */
const 점수 = {
  items: [{
    symbol: "005930.KS", market: "KR", total_score: 78.5, grade: "A",
    factors: [
      { key: "value", score: 70 }, { key: "quality", score: 80 },
      { key: "momentum", score: 60 }, { key: "growth", score: 75 },
      { key: "risk", score: 85 },
    ],
  }],
};

vi.mock("@/api/stocks", async (원본가져오기) => ({
  ...(await 원본가져오기<any>()),
  quantScoreApi: {
    getWeights: vi.fn(() => Promise.resolve({ weights: null, enabled_metrics: null })),
    compare: vi.fn(() => Promise.resolve(점수)),
  },
  watchlistApi: {
    getItems: vi.fn(() => Promise.resolve(관심종목)),
    getPrices: vi.fn(() => Promise.resolve([])),
  },
  watchlistFolderApi: { getFolders: vi.fn(() => Promise.resolve([])) },
  portfolioApi: {
    getPortfolios: vi.fn(() => Promise.resolve([])),
    getItems: vi.fn(() => Promise.resolve([])),
  },
}));

vi.mock("@/utils/recentlyViewed", () => ({ getRecentlyViewed: () => [] }));

import Quant from "../Quant";

function 그리기() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><Quant /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("퀀트 표 용어 설명", () => {
  it("다섯 갈래마다 설명 버튼이 있다", async () => {
    그리기();
    await screen.findByText("삼성전자");
    for (const 이름 of ["가치", "품질", "모멘텀", "성장", "안정성"]) {
      expect(
        screen.getByRole("button", { name: `${이름} 설명` }),
        `${이름} 에 설명이 없다`,
      ).toBeInTheDocument();
    }
  });

  it("설명을 눌러도 정렬이 바뀌지 않는다", async () => {
    /* 설명 버튼을 정렬 버튼 안에 넣으면 여기가 깨진다. 설명 한 번 보려다
       표가 통째로 다시 줄 서는 건 사고다 */
    const u = userEvent.setup();
    그리기();
    await screen.findByText("삼성전자");

    const 정렬버튼 = screen.getByRole("button", { name: "가치" });
    const 전 = 정렬버튼.className;

    await u.click(screen.getByRole("button", { name: "가치 설명" }));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "가치" }).className).toBe(전);
  });

  it("설명에 점수가 높으면 어떤 뜻인지까지 적혀 있다", async () => {
    const u = userEvent.setup();
    그리기();
    await screen.findByText("삼성전자");
    await u.click(screen.getByRole("button", { name: "안정성 설명" }));
    expect(screen.getByRole("tooltip").textContent).toMatch(/점수가 높을수록/);
  });
});
