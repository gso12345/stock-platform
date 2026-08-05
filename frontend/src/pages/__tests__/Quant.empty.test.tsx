/**
 * 퀀트 화면의 빈 상태 — 상황마다 맞는 곳으로 보내는가.
 *
 * 부품이 버튼을 그리는지는 EmptyState 테스트가 본다. 여기서 보는 건 다른
 * 것이다 — 퀀트에는 비는 경우가 셋 있는데(관심종목 없음 / 포트폴리오 비었음 /
 * 최근 조회 없음), 셋 다 채우러 가는 곳이 다르다. 하나로 뭉뚱그려 보내면
 * 버튼을 눌러도 헛걸음이라, 안내가 없느니만 못하다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const navigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const 실제 = await vi.importActual<any>("react-router-dom");
  return { ...실제, useNavigate: () => navigate };
});

/* 로그인한 상태로 두되 담긴 것은 하나도 없게 만든다 — 그게 처음 온 사람의 상태다 */
vi.mock("@/store/authStore", () => ({
  useAuthStore: (sel?: any) => {
    const s = { isLoggedIn: true, user: { id: 1 } };
    return sel ? sel(s) : s;
  },
}));

/* 부분만 바꾼다 — 이 화면은 지표 정의(VALUE_METRIC_DEFS 등)도 같이 쓰는데,
   통째로 갈아끼우면 그게 사라져 설정 패널이 뜨기도 전에 터진다 */
vi.mock("@/api/stocks", async (원본가져오기) => ({
  ...(await 원본가져오기<any>()),
  quantScoreApi: {
    getWeights: vi.fn(() => Promise.resolve({ weights: null, enabled_metrics: null })),
    compare: vi.fn(() => Promise.resolve({ results: [] })),
  },
  watchlistApi: {
    getItems: vi.fn(() => Promise.resolve([])),
    getPrices: vi.fn(() => Promise.resolve([])),
  },
  watchlistFolderApi: { getFolders: vi.fn(() => Promise.resolve([])) },
  portfolioApi: {
    getPortfolios: vi.fn(() => Promise.resolve([{ id: 7, name: "내 계좌" }])),
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

beforeEach(() => navigate.mockReset());

describe("퀀트 빈 화면", () => {
  it("관심종목이 없으면 관심종목으로 보낸다", async () => {
    const u = userEvent.setup();
    그리기();
    const 버튼 = await screen.findByRole("button", { name: /관심종목 담으러 가기/ });
    await u.click(버튼);
    expect(navigate).toHaveBeenCalledWith("/watchlist");
  });

  it("무엇을 하면 채워지는지 같이 알려준다", async () => {
    그리기();
    await screen.findByRole("button", { name: /관심종목 담으러 가기/ });
    // 버튼만 있고 이유가 없으면 왜 눌러야 하는지 모른다
    expect(document.body.textContent).toMatch(/담아두면/);
  });

  it("최근 조회 탭이 비면 종목을 보러 보낸다", async () => {
    /* 여기서 관심종목으로 보내면 헛걸음이다 — 최근 조회는 종목을 들여다봐야
       쌓이지, 관심종목에 담는다고 쌓이지 않는다 */
    const u = userEvent.setup();
    그리기();
    await screen.findByRole("button", { name: /관심종목 담으러 가기/ });
    await u.click(screen.getByRole("tab", { name: /최근조회/ }));
    const 버튼 = await screen.findByRole("button", { name: /종목 둘러보기/ });
    await u.click(버튼);
    expect(navigate).toHaveBeenCalledWith("/");
  });

  it("포트폴리오 탭이 비면 내 자산으로 보낸다", async () => {
    /* 세 경우를 하나로 뭉뚱그리면 여기가 관심종목으로 가 버린다.
       보유종목은 내 자산에서 넣지, 관심종목에 담는다고 생기지 않는다 */
    const u = userEvent.setup();
    그리기();
    await screen.findByRole("button", { name: /관심종목 담으러 가기/ });
    await u.click(screen.getByRole("tab", { name: /내 계좌/ }));
    await u.click(await screen.findByRole("button", { name: /내 자산에 종목 넣기/ }));
    expect(navigate).toHaveBeenCalledWith("/portfolio");
  });
});
