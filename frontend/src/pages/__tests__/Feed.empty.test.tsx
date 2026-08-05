/**
 * 피드 빈 화면 — 두 경우가 서로 다른 길을 내야 한다.
 *
 *   · 팔로잉 피드가 비었다 → 팔로우할 사람을 찾아야 한다. 전체 피드로 보낸다.
 *   · 전체 피드가 비었다   → 아무도 안 썼다는 뜻이다. 첫 글을 쓰게 한다.
 *
 * 둘을 뒤집으면 헛걸음이다. 팔로잉이 비었는데 "첫 글 쓰기"를 내밀면, 글을
 * 써도 이 화면은 그대로 비어 있다.
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

vi.mock("@/store/authStore", () => ({
  useAuthStore: (sel?: any) => {
    const s = { isLoggedIn: true, user: { id: 1 }, username: "나" };
    return sel ? sel(s) : s;
  },
}));

vi.mock("@/api/stocks", async (원본가져오기) => ({
  ...(await 원본가져오기<any>()),
  communityApi: {
    ...((await 원본가져오기<any>()).communityApi ?? {}),
    getFeed: vi.fn(() => Promise.resolve({ items: [], total: 0, page: 1 })),
  },
  portfolioApi: {
    getPortfolios: vi.fn(() => Promise.resolve([])),
    getItems: vi.fn(() => Promise.resolve([])),
  },
}));

import Feed from "../Feed";

function 그리기() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><Feed /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => navigate.mockReset());

describe("피드 빈 화면", () => {
  it("전체 피드가 비면 첫 글을 쓰게 한다", async () => {
    그리기();
    expect(await screen.findByRole("button", { name: /첫 글 쓰기/ })).toBeInTheDocument();
    expect(document.body.textContent).toMatch(/아직 게시글이 없어요/);
  });

  it("첫 글 쓰기를 누르면 글쓰기 화면으로 간다", async () => {
    /* 예전에는 맨 위로 올리기만 했다. 거기에 접힌 한 줄이 있었기 때문인데,
       그 한 줄을 또 눌러야 실제로 쓸 수 있었다. 이제 바로 넘긴다 */
    const u = userEvent.setup();
    그리기();
    await u.click(await screen.findByRole("button", { name: /첫 글 쓰기/ }));
    expect(navigate).toHaveBeenCalledWith("/feed/write");
  });

  it("팔로잉 피드가 비면 전체 피드로 보낸다", async () => {
    /* 여기서 '첫 글 쓰기'를 내밀면 안 된다 — 내가 글을 써도 팔로잉 피드는
       그대로 비어 있다 */
    const u = userEvent.setup();
    그리기();
    await screen.findByRole("button", { name: /첫 글 쓰기/ });

    await u.click(screen.getByRole("tab", { name: /팔로잉/ }));
    expect(await screen.findByRole("button", { name: /전체 피드 보기/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /첫 글 쓰기/ })).toBeNull();
  });

  it("전체 피드 보기를 누르면 실제로 전체로 돌아온다", async () => {
    const u = userEvent.setup();
    그리기();
    await screen.findByRole("button", { name: /첫 글 쓰기/ });
    await u.click(screen.getByRole("tab", { name: /팔로잉/ }));
    await u.click(await screen.findByRole("button", { name: /전체 피드 보기/ }));
    // 다시 전체 피드의 빈 화면이 나와야 한다 — 눌러도 그대로면 막다른 길이다
    expect(await screen.findByRole("button", { name: /첫 글 쓰기/ })).toBeInTheDocument();
  });
});
