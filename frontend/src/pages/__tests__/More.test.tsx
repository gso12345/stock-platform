/**
 * 더보기 화면 — "더보기탭 누르면 더보기화면이 나오고 메뉴가 줄로 나오게 해줘.
 * 그리고 더보기화면 맨위에는 내 프로필수정할 수 있게 만들고 내프로필을
 * 간단하게 보여주게 해줘"
 *
 * 예전에는 바텀시트였고 메뉴는 5칸 격자였다. 시트라서 뒤로가기로 닫히지
 * 않았고, 격자라서 "전략저장소"는 줄바꿈돼 뭉개졌다.
 *
 * 여기서 못 박는 것 —
 *   1) 하단 탭의 더보기가 시트가 아니라 /more 로 간다
 *   2) 맨 위에 내 프로필이 있고, 거기서 수정으로 바로 갈 수 있다
 *   3) 메뉴가 줄로 나온다 (격자로 되돌아가면 다시 뭉개진다)
 *   4) 목록이 한 벌이다 — 탭바와 화면이 따로 들면 조용히 어긋난다
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import Layout원문 from "../../components/Layout.tsx?raw";
import { 더보기_메뉴, 더보기_경로 } from "@/constants/moreNav";

const navigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const 실제 = await vi.importActual<any>("react-router-dom");
  return { ...실제, useNavigate: () => navigate };
});

const 로그아웃 = vi.fn();
let 로그인함 = true;
vi.mock("@/store/authStore", () => ({
  useAuthStore: (sel?: any) => {
    const s = {
      isLoggedIn: 로그인함, username: "gso", userId: 7, isAdmin: false,
      logout: 로그아웃,
    };
    return sel ? sel(s) : s;
  },
}));

vi.mock("@/api/stocks", async (원본가져오기) => ({
  ...(await 원본가져오기<any>()),
  communityApi: {
    getUnreadNotificationCount: vi.fn(() => Promise.resolve({ count: 3, capped: false })),
    getMyProfile: vi.fn(() => Promise.resolve({
      user_id: 7, username: "gso", nickname: "고소", avatar_color: 1,
      bio: "가치투자 지향", avatar_url: null,
    })),
    getUserPublicProfile: vi.fn(() => Promise.resolve({
      follower_count: 12, following_count: 5, post_count: 34,
    })),
  },
}));

import More from "../More";

function 그리기() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><More /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => { navigate.mockReset(); 로그아웃.mockReset(); 로그인함 = true; });

describe("하단 탭의 더보기", () => {
  it("시트를 올리지 않고 /more 로 간다", () => {
    /* 시트는 뒤로가기로 안 닫혔다. 화면이면 브라우저 뒤로가기가 그냥 듣는다 */
    expect(Layout원문).toMatch(/<NavLink to="\/more"/);
    expect(Layout원문).not.toMatch(/setMoreOpen/);
  });

  it("더보기 안의 화면을 보고 있어도 탭이 켜져 있다", () => {
    /* 관심종목을 보는 중에 다섯 탭 중 아무것도 안 켜지면 지금 어디인지 모른다 */
    expect(더보기_경로).toContain("/more");
    expect(더보기_경로).toContain("/watchlist");
    expect(Layout원문).toMatch(/더보기_경로\.some/);
  });

  it("메뉴 목록을 두 벌로 들지 않는다", () => {
    /* 두 벌이면 메뉴를 추가할 때 화면에는 나오는데 탭은 안 켜진다 */
    expect(Layout원문).not.toMatch(/label: "관심종목"/);
    expect(Layout원문).toMatch(/from "@\/constants\/moreNav"/);
  });
});

describe("맨 위의 내 프로필", () => {
  it("닉네임·아이디·소개를 보여준다", async () => {
    그리기();
    expect(await screen.findByText("고소")).toBeInTheDocument();
    expect(screen.getByText("@gso")).toBeInTheDocument();
    expect(await screen.findByText("가치투자 지향")).toBeInTheDocument();
  });

  it("팔로워·팔로잉·게시글 수를 보여준다", async () => {
    그리기();
    for (const [라벨, 값] of [["팔로워", "12"], ["팔로잉", "5"], ["게시글", "34"]]) {
      const 칸 = (await screen.findByText(라벨)).parentElement!;
      expect(within(칸).getByText(값)).toBeInTheDocument();
    }
  });

  it("프로필 수정을 누르면 편집이 열린 채로 간다", async () => {
    /* 그냥 /mypage 로 보내면 편집 패널이 접힌 채라 한 번 더 눌러야 한다 */
    const u = userEvent.setup();
    그리기();
    await u.click(await screen.findByRole("button", { name: /프로필 수정/ }));
    expect(navigate).toHaveBeenCalledWith("/mypage?edit=1");
  });

  it("로그인 안 했으면 프로필 대신 로그인을 내민다", async () => {
    로그인함 = false;
    그리기();
    expect(await screen.findByRole("button", { name: /로그인/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /프로필 수정/ })).toBeNull();
  });
});

describe("메뉴", () => {
  it("공용 목록의 항목이 모두 줄로 나온다", async () => {
    그리기();
    for (const m of 더보기_메뉴) {
      const 줄 = await screen.findByRole("link", { name: new RegExp(m.label) });
      expect(줄).toHaveAttribute("href", m.to);
    }
  });

  it("메뉴마다 무엇을 하는 곳인지 한 줄 붙는다", async () => {
    /* 격자였을 때는 두세 글자 이름만 있었다. "스크리닝"이 뭔지 모르면
       그 칸은 없는 것과 같다 */
    그리기();
    for (const m of 더보기_메뉴) {
      expect(await screen.findByText(m.설명)).toBeInTheDocument();
    }
  });

  it("안 읽은 알림 개수를 알림 줄에 붙인다", async () => {
    그리기();
    const 배지 = await screen.findByText("3");
    expect(배지.closest("a")).toHaveAttribute("href", "/notifications");
  });

  it("설정을 누르면 설정 창이 열린다", async () => {
    /* 시트에 있던 것을 옮기면서 제일 흘리기 쉬운 부분이다 */
    const u = userEvent.setup();
    그리기();
    await u.click(await screen.findByRole("button", { name: /설정/ }));
    expect(await screen.findByText("화면 모양")).toBeInTheDocument();
  });

  it("로그아웃이 실제로 로그아웃시키고 로그인 화면으로 보낸다", async () => {
    const u = userEvent.setup();
    그리기();
    await u.click(await screen.findByRole("button", { name: /로그아웃/ }));
    expect(로그아웃).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/login");
  });

  it("로그인 안 했으면 알림·내 프로필·로그아웃은 안 보인다", async () => {
    로그인함 = false;
    그리기();
    await screen.findByRole("link", { name: /관심종목/ });
    expect(screen.queryByRole("link", { name: /알림/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /내 프로필/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /로그아웃/ })).toBeNull();
  });
});
