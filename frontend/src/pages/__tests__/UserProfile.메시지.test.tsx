/**
 * 프로필의 '메시지' — 대화는 상대 프로필에서 시작한다. ⋯ 에서 차단·차단 풀기.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";

vi.mock("@/api/stocks", async (원본) => {
  const 실제 = await 원본<any>();
  return {
    ...실제,
    communityApi: {
      ...실제.communityApi,
      getUserPublicProfile: vi.fn(),
      getUserActivity: vi.fn(async () => ({ items: [] })),
      getFollowers: vi.fn(async () => []),
      getFollowing: vi.fn(async () => []),
      toggleFollow: vi.fn(),
    },
    portfolioApi: { ...실제.portfolioApi, getPublicPortfoliosWithPrices: vi.fn(async () => []) },
    dashboardApi: { ...실제.dashboardApi, getExchangeRate: vi.fn(async () => ({ value: 1400 })) },
    watchlistApi: { ...실제.watchlistApi, getPrices: vi.fn(async () => []) },
  };
});
vi.mock("@/hooks/useWebSocket", () => ({ usePricesStream: () => {} }));
vi.mock("@/components/portfolio/PortfolioChart", () => ({ default: () => null }));
vi.mock("@/api/dm", async (원본) => {
  const 실제 = await 원본<typeof import("@/api/dm")>();
  return { ...실제, dmApi: { openThread: vi.fn(), block: vi.fn(), unblock: vi.fn() } };
});

import UserProfile from "@/pages/UserProfile";
import { communityApi } from "@/api/stocks";
import { dmApi } from "@/api/dm";
import { useAuthStore } from "@/store/authStore";

const dm = vi.mocked(dmApi);
const 프로필 = (덧: Record<string, unknown> = {}) => ({
  user_id: 5, username: "ant", nickname: "개미왕", avatar_color: 1, avatar_url: null, bio: null,
  follower_count: 1, following_count: 2, post_count: 3, is_following: false, i_blocked: false, is_me: false, ...덧,
});

function 그리기() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/profile/5"]}>
        <Routes>
          <Route path="/profile/:userId" element={<UserProfile />} />
          <Route path="/messages/:id" element={<div>대화방 화면</div>} />
          <Route path="/login" element={<div>로그인 화면</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ token: "t", userId: 1, username: "me", isLoggedIn: true, isAdmin: false });
  vi.mocked(communityApi.getUserPublicProfile).mockResolvedValue(프로필());
});

describe("프로필의 메시지", () => {
  it("누르면 그 사람과의 방을 열고(없으면 서버가 만든다) 대화방으로", async () => {
    dm.openThread.mockResolvedValue({ id: 12 });
    그리기();
    await userEvent.click(await screen.findByRole("button", { name: "메시지" }));
    await waitFor(() => expect(dm.openThread).toHaveBeenCalledWith(5));
    expect(await screen.findByText("대화방 화면")).toBeInTheDocument();
  });

  it("로그인 전이면 로그인 화면으로 — 방을 열지 않는다", async () => {
    useAuthStore.setState({ token: null, userId: null, username: null, isLoggedIn: false, isAdmin: false });
    그리기();
    await userEvent.click(await screen.findByRole("button", { name: "메시지" }));
    expect(screen.getByText("로그인 화면")).toBeInTheDocument();
    expect(dm.openThread).not.toHaveBeenCalled();
    // 로그인 전에는 차단 메뉴도 없다
    expect(screen.queryByRole("button", { name: "사용자 메뉴" })).toBeNull();
  });

  it("커뮤니티 이용이 막힌 계정이면 그렇다고 말한다", async () => {
    dm.openThread.mockRejectedValue({ response: { status: 403 } });
    그리기();
    await userEvent.click(await screen.findByRole("button", { name: "메시지" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("커뮤니티 이용이 제한된 계정은 메시지를 보낼 수 없어요");
  });

  it("내 프로필에는 메시지 단추가 없다", async () => {
    vi.mocked(communityApi.getUserPublicProfile).mockResolvedValue(프로필({ is_me: true }));
    그리기();
    expect(await screen.findByText("프로필 편집")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "메시지" })).toBeNull();
  });
});

describe("프로필의 차단", () => {
  it("⋯ → 차단하기 — 확인하면 막는다", async () => {
    dm.block.mockResolvedValue({ blocked: true });
    그리기();
    await userEvent.click(await screen.findByRole("button", { name: "사용자 메뉴" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "차단하기" }));
    expect(screen.getByText("개미왕님을 차단할까요?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "차단" }));
    await waitFor(() => expect(dm.block).toHaveBeenCalledWith(5));
    expect(await screen.findByText("차단했어요")).toBeInTheDocument();
  });

  it("이미 막았으면 ⋯ 에 '차단 풀기' — 확인 없이 푼다", async () => {
    vi.mocked(communityApi.getUserPublicProfile).mockResolvedValue(프로필({ i_blocked: true }));
    dm.unblock.mockResolvedValue({ blocked: false });
    그리기();
    await userEvent.click(await screen.findByRole("button", { name: "사용자 메뉴" }));
    expect(screen.queryByRole("menuitem", { name: "차단하기" })).toBeNull();
    await userEvent.click(screen.getByRole("menuitem", { name: "차단 풀기" }));
    await waitFor(() => expect(dm.unblock).toHaveBeenCalledWith(5));
  });
});
