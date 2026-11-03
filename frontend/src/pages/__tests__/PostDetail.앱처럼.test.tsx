/**
 * 글 상세·댓글 창도 피드와 같이 앱처럼 —
 *   · 위 띠의 '005930' 칩을 뺐다(작성자 밑 종목과 겹쳤다). 종목은 이름 칩으로
 *   · 수정·삭제·링크 복사·신고는 ⋯ 메뉴로(깃발 아이콘·댓글마다 붙은 '신고' 글자 없음)
 *   · 댓글 입력칸은 화면 아래에 붙는다(11번). 옆 아바타는 내 닉네임으로(예전에는 아이디 첫 글자 'P')
 *   · 사진은 누르면 크게(9번). 댓글 창은 목록에서 넘어온 글의 사진도 받아 보여 준다
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";

vi.mock("@/store/authStore", () => ({
  useAuthStore: (sel?: any) => {
    const s = { isLoggedIn: true, userId: 1, username: "pcview" };
    return sel ? sel(s) : s;
  },
}));
vi.mock("@/hooks/useMyProfile", () => ({
  useMyProfile: () => ({ displayName: "피씨뷰", avatarColor: 1, avatarUrl: null, userId: 1 }),
}));

const 지금 = new Date().toISOString();
let 글자료: any;
const 댓글 = (o: any) => ({ parent_id: null, avatar_color: 0, like_count: 0, liked: false, created_at: 지금, is_mine: false, replies: [], ...o });
let 댓글들: any[] = [];
const reportPost = vi.fn(() => Promise.resolve({}));
const createComment = vi.fn(() => Promise.resolve({}));
const deleteComment = vi.fn(() => Promise.resolve({}));
vi.mock("@/api/stocks", async (원본가져오기) => {
  const 원본 = await 원본가져오기<any>();
  return {
    ...원본,
    communityApi: {
      ...(원본.communityApi ?? {}),
      getPost: vi.fn(() => Promise.resolve(글자료)),
      getComments: vi.fn(() => Promise.resolve(댓글들)),
      reportPost: (...a: any[]) => (reportPost as any)(...a),
      createComment: (...a: any[]) => (createComment as any)(...a),
      deleteComment: (...a: any[]) => (deleteComment as any)(...a),
    },
    dashboardApi: { getExchangeRate: vi.fn(() => Promise.resolve({ value: 1000 })) },
  };
});

import PostDetail from "../PostDetail";
import PostDetailModal, { 댓글모두 } from "@/components/community/PostDetailModal";
import { API_BASE } from "@/api/client";

const 기본글 = (o: any = {}) => ({
  id: 6, symbol: "005930", market: "KR", name: "삼성전자", user_id: 2, username: "주식고수", avatar_color: 0,
  title: "삼성전자 3분기 실적 리뷰", body: "영업이익이 컨센서스를 웃돌았습니다.", image: "", poll: null, tags: [],
  portfolio: null, like_count: 3, comment_count: 2, view_count: 1, liked: false, created_at: 지금,
  is_mine: false, is_following: false, ...o,
});

function 상세그리기() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/post/6"]}>
        <Routes><Route path="/post/:postId" element={<PostDetail />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  글자료 = 기본글();
  댓글들 = [
    댓글({ id: 10, user_id: 3, username: "배당러버", content: "HBM 비중이 크네요" }),
    댓글({ id: 11, user_id: 1, username: "피씨뷰", content: "내 댓글", is_mine: true }),
  ];
  reportPost.mockClear();
  createComment.mockClear();
});

const 메뉴열기 = async (이름: string, 몇번째 = 0) => {
  const u = userEvent.setup();
  await u.click((await screen.findAllByRole("button", { name: 이름 }))[몇번째]);
  return { u, 항목: screen.getAllByRole("menuitem").map((m) => m.textContent) };
};

describe("글 상세 — 위 띠와 종목", () => {
  it("위 띠는 ← 와 ⋯ 만 — 코드 칩이 없고, 종목은 이름으로", async () => {
    상세그리기();
    expect(await screen.findByRole("link", { name: "삼성전자" })).toHaveAttribute("href", "/stocks/KR/005930");
    expect(screen.queryByText("005930")).toBeNull();
    expect(screen.getByRole("button", { name: "뒤로" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "글 메뉴" })).toBeInTheDocument();
  });

  it("포트폴리오 글은 '포트폴리오'", async () => {
    글자료 = 기본글({ portfolio: [{ symbol: "005930", market: "KR", name: "삼성전자", shares: 1, avg_price: 1 }] });
    상세그리기();
    expect(await screen.findByText("포트폴리오")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "삼성전자" })).toBeNull();
  });
});

describe("글 상세 — ⋯ 메뉴", () => {
  it("내 글 — 수정·링크 복사·삭제. 수정을 고르면 고치는 칸이 열린다", async () => {
    글자료 = 기본글({ is_mine: true, user_id: 1 });
    상세그리기();
    const { u, 항목 } = await 메뉴열기("글 메뉴");
    expect(항목).toEqual(["수정", "링크 복사", "삭제"]);
    await u.click(screen.getByRole("menuitem", { name: "수정" }));
    expect(screen.getByRole("textbox", { name: "내용 고치기" })).toHaveValue("영업이익이 컨센서스를 웃돌았습니다.");
  });

  it("남의 글 — 링크 복사·신고. 깃발 아이콘은 없다", async () => {
    상세그리기();
    await screen.findByRole("link", { name: "삼성전자" });
    expect(screen.queryByRole("button", { name: "이 글 신고하기" })).toBeNull();
    const { u, 항목 } = await 메뉴열기("글 메뉴");
    expect(항목).toEqual(["링크 복사", "신고"]);
    await u.click(screen.getByRole("menuitem", { name: "신고" }));
    await u.click(screen.getByRole("radio", { name: "허위 정보" }));
    await u.click(screen.getByRole("button", { name: "신고" }));
    await waitFor(() => expect(reportPost).toHaveBeenCalledWith(6, "허위 정보"));
  });

  it("댓글마다 '신고'·'수정 삭제' 글자 대신 ⋯ — 남의 댓글은 신고, 내 댓글은 수정·삭제", async () => {
    상세그리기();
    await screen.findByText("HBM 비중이 크네요");
    expect(screen.queryByRole("button", { name: /^신고$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "삭제" })).toBeNull();
    expect((await 메뉴열기("댓글 메뉴", 0)).항목).toEqual(["신고"]);
  });

  it("내 댓글의 ⋯ 는 수정·삭제", async () => {
    상세그리기();
    await screen.findByText("내 댓글");
    expect((await 메뉴열기("댓글 메뉴", 1)).항목).toEqual(["수정", "삭제"]);
  });
});

describe("글 상세 — 댓글 입력칸은 화면 아래에(11번)", () => {
  it("댓글 목록 뒤, 아래 탭 바로 위에 붙는다(휴대폰)", async () => {
    상세그리기();
    await screen.findByText("HBM 비중이 크네요");
    const 칸 = screen.getByRole("textbox", { name: "댓글 쓰기" });
    const 줄 = 칸.closest("[data-comment-bar]") as HTMLElement;
    expect(줄.className).toContain("fixed");
    expect(줄.style.bottom).toBe("calc(3.5rem + env(safe-area-inset-bottom))");
    // 댓글 목록보다 뒤에 있다 — 예전에는 목록 위에 있어 읽다가 쓰려면 다시 올라가야 했다
    const 마지막댓글 = screen.getByText("내 댓글");
    expect(마지막댓글.compareDocumentPosition(줄) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("옆 아바타는 내 닉네임 첫 글자 — 아이디 첫 글자('P')가 아니다", async () => {
    상세그리기();
    await screen.findByText("HBM 비중이 크네요");
    const 줄 = screen.getByRole("textbox", { name: "댓글 쓰기" }).closest("[data-comment-bar]") as HTMLElement;
    expect(within(줄).getByText("피")).toBeInTheDocument();
    expect(within(줄).queryByText("P")).toBeNull();
  });

  it("쓴 댓글은 서버 답을 기다리지 않고 내 닉네임으로 먼저 얹힌다", async () => {
    let 답하기: () => void = () => {};
    createComment.mockImplementationOnce(() => new Promise<any>((r) => { 답하기 = () => r({}); }));
    const u = userEvent.setup();
    상세그리기();
    await screen.findByText("HBM 비중이 크네요");
    await u.type(screen.getByRole("textbox", { name: "댓글 쓰기" }), "좋은 분석이네요");
    await u.click(screen.getByRole("button", { name: "댓글 올리기" }));
    // 서버가 아직 답하지 않았다
    const 새댓글 = await screen.findByText("좋은 분석이네요");
    expect(createComment).toHaveBeenCalledWith(6, "좋은 분석이네요");
    const 줄 = 새댓글.closest(".flex.gap-3") as HTMLElement;
    expect(within(줄).getByRole("link", { name: "피씨뷰" })).toBeInTheDocument();
    expect(within(줄).queryByText("pcview")).toBeNull();
    expect(screen.getByRole("textbox", { name: "댓글 쓰기" })).toHaveValue("");
    답하기();
  });
});

describe("글 상세 — 사진", () => {
  it("누르면 크게 본다", async () => {
    글자료 = 기본글({ image: "data:image/png;base64,AAAA" });
    const u = userEvent.setup();
    상세그리기();
    await u.click(await screen.findByRole("button", { name: "사진 크게 보기" }));
    expect(within(screen.getByRole("dialog", { name: "사진 크게 보기" })).getByRole("img"))
      .toHaveAttribute("src", "data:image/png;base64,AAAA");
  });
});

describe("댓글 창", () => {
  function 창그리기(글 = 기본글({ has_image: true }), onCommentCount = vi.fn()) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter><PostDetailModal post={글} onClose={() => {}} onCommentCount={onCommentCount} /></MemoryRouter>
      </QueryClientProvider>,
    );
    return onCommentCount;
  }

  it("목록에서 넘어온 글(사진은 '있다' 는 표시만)도 사진을 받아 보여 준다", async () => {
    창그리기();
    const 사진단추 = await screen.findByRole("button", { name: "사진 크게 보기" });
    expect(within(사진단추).getByRole("img")).toHaveAttribute("src", `${API_BASE}/community/posts/6/image`);
  });

  it("머리에는 종목 이름과 ⋯ — 남의 글은 링크 복사·신고", async () => {
    창그리기();
    expect(screen.getByRole("link", { name: "삼성전자" })).toBeInTheDocument();
    expect(screen.queryByText("005930")).toBeNull();
    expect((await 메뉴열기("글 메뉴")).항목).toEqual(["링크 복사", "신고"]);
  });

  it("내 글이면 링크 복사·삭제", async () => {
    창그리기(기본글({ is_mine: true, user_id: 1 }));
    expect((await 메뉴열기("글 메뉴")).항목).toEqual(["링크 복사", "삭제"]);
  });

  it("댓글 입력칸 옆에 내 아바타", async () => {
    창그리기();
    const 칸 = screen.getByRole("textbox", { name: "댓글 쓰기" });
    expect(within(칸.parentElement as HTMLElement).getByText("피")).toBeInTheDocument();
  });

  it("댓글 수(답글 포함)가 목록과 다르면 목록에 알린다", async () => {
    댓글들 = [댓글({ id: 1, username: "가", content: "하나", replies: [댓글({ id: 2, username: "나", content: "둘" })] }), 댓글({ id: 3, username: "다", content: "셋" })];
    const 알림 = 창그리기();
    await waitFor(() => expect(알림).toHaveBeenCalledWith(6, 3));
    expect(댓글모두(댓글들)).toBe(3);
    expect(댓글모두(undefined)).toBe(0);
  });

  it("쓴 댓글은 서버 답을 기다리지 않고 내 닉네임으로 먼저 얹힌다", async () => {
    let 답하기: () => void = () => {};
    createComment.mockImplementationOnce(() => new Promise<any>((r) => { 답하기 = () => r({}); }));
    const u = userEvent.setup();
    창그리기();
    await screen.findByText("HBM 비중이 크네요");
    await u.type(screen.getByRole("textbox", { name: "댓글 쓰기" }), "저도요");
    await u.click(screen.getByRole("button", { name: "댓글 올리기" }));
    const 새댓글 = await screen.findByText("저도요");
    const 줄 = 새댓글.closest(".flex.gap-2\\.5") as HTMLElement;
    expect(within(줄).getByRole("link", { name: "피씨뷰" })).toBeInTheDocument();
    expect(within(줄).queryByText("pcview")).toBeNull();
    답하기();
  });

  it("달았다 지우면 목록의 수도 되돌아간다(2 → 3 → 2)", async () => {
    const 알림 = vi.fn();
    const u = userEvent.setup();
    창그리기(기본글(), 알림);
    await screen.findByText("HBM 비중이 크네요");
    // 달기 — 서버가 답하면 새로 받은 목록에 내 댓글이 있다
    createComment.mockImplementationOnce(async () => { 댓글들 = [...댓글들, 댓글({ id: 12, user_id: 1, username: "피씨뷰", content: "새 댓글", is_mine: true })]; return {}; });
    await u.type(screen.getByRole("textbox", { name: "댓글 쓰기" }), "새 댓글");
    await u.click(screen.getByRole("button", { name: "댓글 올리기" }));
    await waitFor(() => expect(알림).toHaveBeenLastCalledWith(6, 3));
    // 지우기 — 내 댓글의 ⋯ → 삭제 → 확인
    deleteComment.mockImplementationOnce(async () => { 댓글들 = 댓글들.filter((c) => c.id !== 12); return {}; });
    const 내것 = (await screen.findAllByText("새 댓글")).map((el) => el.closest(".flex.gap-2\\.5") as HTMLElement).find(Boolean)!;
    await u.click(within(내것).getByRole("button", { name: "댓글 메뉴" }));
    await u.click(screen.getByRole("menuitem", { name: "삭제" }));
    await u.click(screen.getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(알림).toHaveBeenLastCalledWith(6, 2));
  });

  it("같으면 알리지 않는다", async () => {
    const 알림 = 창그리기();     // 댓글 둘, 글의 comment_count 도 2
    await screen.findByText("HBM 비중이 크네요");
    expect(알림).not.toHaveBeenCalled();
  });
});
