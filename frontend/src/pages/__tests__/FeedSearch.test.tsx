/**
 * 피드 검색 — "피드 검색기능 만들어줘"
 *
 * 피드에는 종목이 뒤섞여 있다. 삼성전자 얘기를 찾으려면 페이지를 넘겨 가며
 * 눈으로 훑는 수밖에 없었다.
 *
 * 여기서 못 박는 것 —
 *   1) 검색창이 화면에 있다
 *   2) 친 글자가 실제로 서버까지 간다 (안 가면 검색창은 장식이다)
 *   3) 글자마다 부르지 않는다 — 0.15 CPU 서버가 그대로 막힌다
 *   4) 검색하면 1페이지로 돌아간다 (3페이지를 보다 검색하면 결과의 3페이지가
 *      나와, 결과가 적으면 빈 화면이 뜬다)
 *   5) 결과가 없을 때 "첫 글을 남겨보세요" 가 아니라 검색에 맞는 말을 한다
 *
 * 피드를 앱처럼 다시 짜면서 검색칸은 돋보기를 누를 때만 펼친다(위쪽이 다섯 줄이라 첫 글이 화면 40% 아래에서
 * 시작했다). 그래서 칸을 찾기 전에 돋보기를 먼저 누른다 — 돋보기가 곧 '검색창이 화면에 있다' 다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

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

const getFeed = vi.fn((..._a: any[]) => Promise.resolve({ items: [], total: 0, page: 1 }));
vi.mock("@/api/stocks", async (원본가져오기) => ({
  ...(await 원본가져오기<any>()),
  communityApi: {
    ...((await 원본가져오기<any>()).communityApi ?? {}),
    getFeed: (...a: any[]) => getFeed(...(a as [])),
  },
  portfolioApi: { getPortfolios: vi.fn(() => Promise.resolve([])), getItems: vi.fn(() => Promise.resolve([])) },
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

/** 돋보기를 눌러 검색칸을 편다 */
async function 검색열기() {
  await userEvent.click(await screen.findByRole("button", { name: "검색" }));
  return screen.findByLabelText("피드 검색");
}

/** getFeed 에 넘어간 검색어들 */
const 넘어간검색어 = () => getFeed.mock.calls.map((c: any[]) => c[4]);

const 빈피드 = () => Promise.resolve({ items: [], total: 0, page: 1 });

beforeEach(() => {
  getFeed.mockReset();
  getFeed.mockImplementation(빈피드 as any);
});

describe("검색창", () => {
  it("화면에 있다 — 돋보기를 누르면 칸이 펴진다", async () => {
    그리기();
    expect(screen.queryByLabelText("피드 검색")).toBeNull();
    expect(await 검색열기()).toBeInTheDocument();
  });

  it("돋보기를 다시 누르면 접히고, 친 검색어도 지운다", async () => {
    /* 접혔는데 검색어가 남아 있으면 무엇으로 걸러진 목록인지 알 수 없다 */
    const u = userEvent.setup();
    그리기();
    await u.type(await 검색열기(), "삼성");
    await screen.findByText(/"삼성" 에 대한 글이 없어요/);
    await u.click(screen.getByRole("button", { name: "검색 닫기" }));
    expect(screen.queryByLabelText("피드 검색")).toBeNull();
    /* 검색 안 한 피드로 돌아온다(처음에 받아 둔 것이라 서버를 다시 부르지는 않는다) */
    expect(await screen.findByRole("button", { name: /첫 글 쓰기/ })).toBeInTheDocument();
    expect(screen.queryByText(/에 대한 글이 없어요/)).toBeNull();
    /* 다시 펴면 빈 칸이다 */
    expect(await 검색열기()).toHaveValue("");
  });

  it("무엇으로 찾을 수 있는지 알려준다", async () => {
    /* 빈 칸만 있으면 종목코드로도 되는지, 태그로도 되는지 알 수 없다 */
    그리기();
    const 칸 = await 검색열기();
    expect(칸).toHaveAttribute("placeholder", expect.stringMatching(/종목/));
  });

  it("서버가 받는 길이를 넘겨 치지 못한다", async () => {
    /* 서버는 50자를 넘기면 422 로 거절한다. 화면에서 안 막으면 길게 친
       순간부터 검색이 통째로 실패한다 */
    그리기();
    expect(await 검색열기()).toHaveAttribute("maxLength", "50");
  });
});

describe("친 글자가 서버까지 간다", () => {
  it("검색어가 실제로 넘어간다", async () => {
    const u = userEvent.setup();
    그리기();
    await u.type(await 검색열기(), "삼성");
    await waitFor(() => expect(넘어간검색어()).toContain("삼성"));
  });

  it("검색 전에는 검색어를 안 붙인다", async () => {
    /* undefined 로 보내야 서버가 검색 안 한 피드의 캐시를 쓴다 */
    그리기();
    await waitFor(() => expect(getFeed).toHaveBeenCalled());
    expect(getFeed.mock.calls[0][4]).toBeUndefined();
  });

  it("앞뒤 공백은 떼고 보낸다", async () => {
    const u = userEvent.setup();
    그리기();
    await u.type(await 검색열기(), "  삼성  ");
    await waitFor(() => expect(넘어간검색어()).toContain("삼성"));
  });

  it("지우면 검색 안 한 피드로 돌아온다", async () => {
    const u = userEvent.setup();
    그리기();
    const 칸 = await 검색열기();
    await u.type(칸, "삼성");
    await screen.findByText(/"삼성" 에 대한 글이 없어요/);

    await u.click(screen.getByRole("button", { name: "검색어 지우기" }));
    /* 검색 안 한 피드는 방금 전에 이미 받아 뒀으니 서버를 다시 안 부른다 —
       그래도 화면은 검색 결과가 아니라 원래 피드로 돌아와야 한다 */
    expect(await screen.findByRole("button", { name: /첫 글 쓰기/ })).toBeInTheDocument();
    expect(칸).toHaveValue("");
  });
});

describe("글자마다 부르지 않는다", () => {
  it("빠르게 치는 동안에는 한 번만 나간다", async () => {
    /* 0.15 CPU 짜리 서버다. 네 글자에 네 번 부르면 그대로 막힌다 */
    const u = userEvent.setup({ delay: null });   // 지연 없이 = 빠르게 치는 사람
    그리기();
    const 칸 = await 검색열기();
    await waitFor(() => expect(getFeed).toHaveBeenCalled());

    getFeed.mockClear();
    await u.type(칸, "삼성전자");
    // 아직 멈추지 않았다 — 나가면 안 된다
    expect(넘어간검색어().filter(Boolean)).toEqual([]);

    // 손을 뗀 뒤에야, 그것도 마지막 글자로 한 번만
    await waitFor(() => expect(넘어간검색어().filter(Boolean)).toEqual(["삼성전자"]));
  });
});

describe("검색하면 첫 페이지로", () => {
  it("더 불러온 뒤에 검색해도 결과의 1페이지부터 받는다", async () => {
    /* 쪽 번호 대신 끝에 닿으면 다음 쪽이 붙는다. 검색어가 바뀌면 이름표가 바뀌어
       1쪽부터 새로 받아야 한다 — 3쪽부터 받으면 결과가 적을 때 빈 화면이 뜬다 */
    const u = userEvent.setup();
    const 글 = (id: number) => ({
      id, symbol: "005930", market: "KR", title: "제목", body: "본문",
      username: "누구", user_id: 2, like_count: 0, comment_count: 0,
      view_count: 0, liked: false, created_at: "2026-01-01T00:00:00Z", tags: [],
    });
    getFeed.mockImplementation(((page: number) => Promise.resolve({
      items: [글(page)], total: 200, page,   // 끝이 먼 피드
    })) as any);
    그리기();

    await u.click(await screen.findByRole("button", { name: "더 보기" }));
    await waitFor(() => expect(getFeed.mock.calls.map((c: any[]) => c[0])).toContain(2));
    await u.click(await screen.findByRole("button", { name: "더 보기" }));
    await waitFor(() => expect(getFeed.mock.calls.map((c: any[]) => c[0])).toContain(3));

    await u.type(await 검색열기(), "삼성");
    await waitFor(() => expect(넘어간검색어()).toContain("삼성"));
    const 검색호출 = getFeed.mock.calls.filter((c: any[]) => c[4] === "삼성");
    expect(검색호출.map((c: any[]) => c[0])).toEqual([1]);
  });
});

describe("빈 결과", () => {
  it("검색 결과가 없으면 검색에 맞는 말을 한다", async () => {
    /* "아직 게시글이 없어요 / 첫 글을 남겨보세요" 는 여기서 엉뚱하다.
       찾던 것이 없는 것이지, 피드가 빈 것이 아니다 */
    const u = userEvent.setup();
    그리기();
    await u.type(await 검색열기(), "없는말");
    expect(await screen.findByText(/"없는말" 에 대한 글이 없어요/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /첫 글 쓰기/ })).toBeNull();
  });

  it("거기서 검색을 지우고 나올 수 있다", async () => {
    /* 막다른 길로 두면 검색창을 다시 찾아 올라가야 한다 */
    const u = userEvent.setup();
    그리기();
    await u.type(await 검색열기(), "없는말");
    await u.click(await screen.findByRole("button", { name: "검색 지우기" }));
    expect(await screen.findByRole("button", { name: /첫 글 쓰기/ })).toBeInTheDocument();
  });
});
