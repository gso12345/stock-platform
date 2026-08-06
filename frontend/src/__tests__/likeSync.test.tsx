/**
 * 좋아요가 화면과 서버에서 서로 반대가 되던 것 —
 * "로그아웃하고 다시 로그인하면 중복으로 좋아요 누를 수 있어"
 *
 * 서버의 좋아요는 토글이다 — 눌린 상태면 지우고, 아니면 넣는다. 그래서
 * 화면이 들고 있는 "지금 눌려 있나" 가 틀리면 결과가 정반대가 된다.
 *
 * 어긋나는 경로가 있었다.
 *   1) A 가 어떤 글에 좋아요를 누른다 (화면·서버 모두 눌린 상태)
 *   2) 로그아웃 → 다시 로그인. 그런데 받아 둔 서버 데이터는 안 버렸다
 *   3) 피드를 열면 캐시된 옛 목록이 먼저 보인다 (staleTime 5분)
 *   4) 거기서 누르면 화면은 "눌림" 이 되는데 서버는 취소로 처리한다
 * 그때부터 눌러도 안 눌러도 어긋난다.
 *
 * 두 겹으로 막는다 —
 *   1) 사람이 바뀌면 받아 둔 것을 통째로 버린다 (원인)
 *   2) 누른 뒤에는 서버가 알려준 실제 값으로 맞춘다 (그래도 어긋났을 때)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const 읽기 = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const 코드만 = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

vi.mock("react-router-dom", async () => {
  const 실제 = await vi.importActual<any>("react-router-dom");
  return { ...실제, useNavigate: () => vi.fn() };
});

vi.mock("@/store/authStore", () => ({
  useAuthStore: (sel?: any) => {
    const s = { isLoggedIn: true, user: { id: 1 }, username: "나" };
    return sel ? sel(s) : s;
  },
}));

const togglePostLike = vi.fn();
vi.mock("@/api/stocks", async (원본가져오기) => {
  const 원본 = await 원본가져오기<any>();
  const 글 = {
    id: 1, symbol: "005930", market: "KR", user_id: 2, username: "누구",
    avatar_color: 0, title: "제목", body: "본문", image: "", poll: null, tags: [],
    like_count: 5, comment_count: 0, view_count: 0,
    /* 화면은 "안 눌림" 으로 알고 있다 — 그런데 서버에는 이미 눌려 있다.
       재로그인 뒤 옛 캐시를 보는 상황이 정확히 이 모습이다 */
    liked: false,
    created_at: "2026-01-01T00:00:00Z", is_mine: false,
  };
  return {
    ...원본,
    communityApi: {
      ...(원본.communityApi ?? {}),
      getFeed: vi.fn(() => Promise.resolve({ items: [글], total: 1, page: 1 })),
      togglePostLike: (...a: any[]) => togglePostLike(...a),
    },
    portfolioApi: { getPortfolios: vi.fn(() => Promise.resolve([])), getItems: vi.fn(() => Promise.resolve([])) },
  };
});

import { queryClient } from "../api/queryClient";
import Feed from "../pages/Feed";

beforeEach(() => {
  togglePostLike.mockReset();
  queryClient.clear();
});

describe("사람이 바뀌면 받아 둔 것을 버린다", () => {
  it("로그인·로그아웃 모두에서 버린다", () => {
    /* 로그아웃에서만 버리면, 만료된 토큰으로 자동 로그아웃된 뒤
       다른 계정으로 들어오는 길이 남는다 */
    /* 타입 선언에도 login:/logout: 이 있다. 구현부만 본다 */
    const s = 코드만(읽기("src/store/authStore.ts"));
    const i로그인 = s.lastIndexOf("login:");
    const i로그아웃 = s.lastIndexOf("logout:");
    expect(i로그인, "login 구현을 못 찾음").toBeGreaterThan(-1);
    expect(i로그아웃).toBeGreaterThan(i로그인);
    expect(s.slice(i로그인, i로그아웃), "login 에서 안 버린다").toMatch(/사용자바뀜\(\)/);
    expect(s.slice(i로그아웃), "logout 에서 안 버린다").toMatch(/사용자바뀜\(\)/);
  });

  it("일부만 골라 지우지 않는다", () => {
    /* 좋아요만의 문제가 아니다 — 내 자산·관심종목·알림도 앞사람 것이
       남는다. 골라 지우면 빠뜨린 것이 반드시 생긴다 */
    const s = 코드만(읽기("src/api/queryClient.ts"));
    expect(s).toMatch(/queryClient\.clear\(\)/);
    expect(s).not.toMatch(/removeQueries|invalidateQueries/);
  });

  it("화면 밖에서도 부를 수 있는 자리에 둔다", () => {
    /* main.tsx 안에 두면 authStore 가 손댈 수 없다 */
    const s = 코드만(읽기("src/main.tsx"));
    expect(s).toMatch(/from "\.\/api\/queryClient"/);
    expect(s).not.toMatch(/new QueryClient\(/);
  });
});

describe("누른 뒤에는 서버 값으로 맞춘다", () => {
  const 좋아요쓰는곳 = [
    ["피드", "src/pages/Feed.tsx"],
    ["글 상세", "src/pages/PostDetail.tsx"],
    ["댓글 시트", "src/components/community/PostDetailModal.tsx"],
  ] as const;

  it("세 곳 모두 응답의 liked 를 반영한다", () => {
    /* 응답을 버리면 추측이 틀렸을 때 영영 못 돌아온다 — 서버는 토글이라
       다음 클릭이 또 반대로 간다 */
    for (const [이름, 경로] of 좋아요쓰는곳) {
      const s = 코드만(읽기(경로));
      const i = s.indexOf("togglePostLike");
      expect(i, `${이름}: togglePostLike 를 못 찾음`).toBeGreaterThan(-1);
      const 구역 = s.slice(Math.max(0, i - 500), i + 800);
      expect(구역, `${이름}: 응답의 liked 를 안 쓴다`).toMatch(/\.liked/);
    }
  });

  it("응답이 이상해도 화면이 안 깨진다", () => {
    /* 서버가 형태를 바꾸거나 프록시가 빈 응답을 주면 undefined 가 온다.
       그걸 그대로 넣으면 좋아요 표시가 사라진다 */
    for (const [이름, 경로] of 좋아요쓰는곳) {
      const s = 코드만(읽기(경로));
      const i = s.indexOf("togglePostLike");
      const 구역 = s.slice(Math.max(0, i - 500), i + 800);
      expect(구역, `${이름}: 응답을 검사 없이 쓴다`).toMatch(/typeof [^;]*\.liked [!=]== "boolean"/);
    }
  });
});

describe("어긋났을 때 스스로 돌아온다", () => {
  it("서버가 '취소됐다' 고 하면 화면도 취소로 맞춘다", async () => {
    /* 화면은 안 눌린 줄 알고 눌렀지만, 서버에는 이미 눌려 있어서
       토글이 '취소' 로 동작한 경우다. 응답을 버리면 화면만 '눌림' 으로
       남아, 다음에 누르면 또 반대로 간다 */
    togglePostLike.mockResolvedValue({ liked: false, like_count: 4 });
    const u = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter><Feed /></MemoryRouter>
      </QueryClientProvider>,
    );

    const 하트 = await screen.findByRole("button", { name: /^5$/ }, { timeout: 4000 });
    await u.click(하트);

    // 서버가 알려준 4로 맞춰져야 한다 (낙관적으로 올린 6이 아니라)
    await waitFor(() => expect(screen.getByRole("button", { name: /^4$/ })).toBeInTheDocument());
  });

  it("서버가 '눌렸다' 고 하면 그대로 둔다", async () => {
    togglePostLike.mockResolvedValue({ liked: true, like_count: 6 });
    const u = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter><Feed /></MemoryRouter>
      </QueryClientProvider>,
    );
    await u.click(await screen.findByRole("button", { name: /^5$/ }, { timeout: 4000 }));
    await waitFor(() => expect(screen.getByRole("button", { name: /^6$/ })).toBeInTheDocument());
  });
});
