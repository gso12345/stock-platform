/**
 * 피드를 앱처럼 — "피드탭 디자인, 사용자편의성 개선하고 싶어 앱느낌 나도록" (열세 가지 모두)
 *
 * 여기서 못 박는 것(번호는 사용자가 고른 번호) —
 *   1  위쪽은 '전체 | 팔로잉' 밑줄 탭과 시장·정렬 칩 두 줄. 검색칸은 돋보기를 누를 때만, 새로고침 아이콘 없음
 *   2  글쓰기는 둥근 연필 단추 하나
 *   4  종목은 코드 대신 이름. '종목 보기 →' 없음. 포트폴리오 글은 '포트폴리오'
 *   5  아래 단추는 아이콘과 숫자만(이름은 '좋아요 3' 처럼 읽힌다), 조회수 0 은 숨김, 하트가 톡 튄다
 *   6  ⋯ 메뉴 — 내 글은 링크 복사·삭제, 남의 글은 링크 복사·신고
 *   7  공유 — PC 는 링크 복사 + 알림
 *   8  포트폴리오 글은 원 그래프 대신 색 띠
 *   9  사진을 누르면 크게(글로 넘어가지 않는다)
 *   10 쪽 번호 대신 이어서 불러오기
 *   그리고 댓글 창에서 바뀐 숫자가 목록에도 바로 맞춰진다
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const navigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const 실제 = await vi.importActual<any>("react-router-dom");
  return { ...실제, useNavigate: () => navigate };
});

const 로그인 = { 됨: true };
vi.mock("@/store/authStore", () => ({
  useAuthStore: (sel?: any) => {
    const s = { isLoggedIn: 로그인.됨, userId: 로그인.됨 ? 1 : null, username: "pcview" };
    return sel ? sel(s) : s;
  },
}));

const getFeed = vi.fn();
const togglePostLike = vi.fn();
const reportPost = vi.fn(() => Promise.resolve({}));
const getComments = vi.fn(() => Promise.resolve([]));
vi.mock("@/api/stocks", async (원본가져오기) => {
  const 원본 = await 원본가져오기<any>();
  return {
    ...원본,
    communityApi: {
      ...(원본.communityApi ?? {}),
      getFeed: (...a: any[]) => getFeed(...a),
      togglePostLike: (...a: any[]) => togglePostLike(...a),
      reportPost: (...a: any[]) => (reportPost as any)(...a),
      getComments: (...a: any[]) => (getComments as any)(...a),
      getMyProfile: vi.fn(() => Promise.resolve({ user_id: 1, username: "pcview", nickname: "피씨뷰", avatar_color: 1, avatar_url: null })),
    },
    dashboardApi: { getExchangeRate: vi.fn(() => Promise.resolve({ value: 1000 })) },
    portfolioApi: { getPortfolios: vi.fn(() => Promise.resolve([])), getItems: vi.fn(() => Promise.resolve([])) },
  };
});

import Feed, { 다음쪽, 한줄로, 글고치기, 글빼기, PAGE_SIZE, type FeedPost } from "../Feed";
import { API_BASE } from "@/api/client";

const 글 = (o: Partial<FeedPost> & { id: number }): FeedPost => ({
  symbol: "005930", market: "KR", name: "삼성전자", user_id: 2, username: "주식고수", avatar_color: 0,
  title: "삼성전자 3분기 실적 리뷰", body: "본문", image: "", has_image: false, poll: null, tags: [], portfolio: null,
  like_count: 3, comment_count: 2, view_count: 0, liked: false, created_at: new Date().toISOString(),
  is_mine: false, ...o,
});
const 피드 = (items: FeedPost[], total = items.length) => Promise.resolve({ items, total, page: 1 });
const 마지막호출 = () => getFeed.mock.calls[getFeed.mock.calls.length - 1];

function 그리기() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><Feed /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  navigate.mockReset();
  getFeed.mockReset();
  togglePostLike.mockReset();
  reportPost.mockClear();
  getComments.mockReset();
  getComments.mockImplementation(() => Promise.resolve([]));
  로그인.됨 = true;
  getFeed.mockImplementation(() => 피드([글({ id: 1 })]));
});

describe("1 — 위쪽 두 줄", () => {
  it("'전체 | 팔로잉' 밑줄 탭과 시장 칩 — 다른 메뉴처럼 '국내·해외'", async () => {
    그리기();
    await screen.findByText("삼성전자 3분기 실적 리뷰");
    const 종류 = screen.getByRole("tablist", { name: "피드 종류" });
    expect(within(종류).getAllByRole("tab").map((t) => t.textContent)).toEqual(["전체", "팔로잉"]);
    const 시장 = screen.getByRole("tablist", { name: "시장" });
    expect(within(시장).getAllByRole("tab").map((t) => t.textContent)).toEqual(["전체", "국내", "해외", "ETF"]);
    expect(screen.queryByRole("tab", { name: "KR" })).toBeNull();
  });

  it("검색칸은 접혀 있고, 새로고침 아이콘과 글쓰기 상자는 없다", async () => {
    그리기();
    await screen.findByText("삼성전자 3분기 실적 리뷰");
    expect(screen.queryByLabelText("피드 검색")).toBeNull();
    expect(screen.getByRole("button", { name: "검색" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTitle("새로고침")).toBeNull();
    expect(screen.queryByText(/공유해보세요/)).toBeNull();
  });

  it("정렬은 칩 하나로 바꾼다", async () => {
    const u = userEvent.setup();
    그리기();
    await screen.findByText("삼성전자 3분기 실적 리뷰");
    await u.click(screen.getByRole("button", { name: /정렬 바꾸기 — 지금 최신순/ }));
    await waitFor(() => expect(마지막호출()[1]).toBe("likes"));
    expect(screen.getByRole("button", { name: /지금 좋아요순/ })).toBeInTheDocument();
  });

  it("시장 칩을 누르면 그 시장만 받는다 — 손가락(마우스를 올리지 않고)으로 눌러도", async () => {
    getFeed.mockImplementation((_page: number, _sort: string, market?: string) =>
      피드([글({ id: market === "US" ? 9 : 1, title: market === "US" ? "해외 글" : "삼성전자 3분기 실적 리뷰" })]));
    그리기();
    await screen.findByText("삼성전자 3분기 실적 리뷰");
    fireEvent.click(screen.getByRole("tab", { name: "해외" }));      // 마우스 올림 없이 — 미리 받기가 없다
    expect(await screen.findByText("해외 글")).toBeInTheDocument();
    expect(getFeed.mock.calls.map((c) => c[2])).toEqual([undefined, "US"]);
  });

  it("PC 에서 마우스를 올리면 그 목록을 미리 받는다", async () => {
    그리기();
    await screen.findByText("삼성전자 3분기 실적 리뷰");
    fireEvent.mouseEnter(screen.getByRole("tab", { name: "ETF" }));
    await waitFor(() => expect(getFeed.mock.calls.map((c) => c[2])).toContain("ETF"));
    fireEvent.mouseEnter(screen.getByRole("tab", { name: "팔로잉" }));
    await waitFor(() => expect(getFeed.mock.calls.map((c) => c[3])).toContain(true));
  });
});

describe("2 — 글쓰기 단추", () => {
  it("둥근 연필 단추가 글쓰기 화면으로 보낸다", async () => {
    const u = userEvent.setup();
    그리기();
    await u.click(await screen.findByRole("button", { name: "글쓰기" }));
    expect(navigate).toHaveBeenCalledWith("/feed/write");
  });

  it("로그인 전이면 로그인으로", async () => {
    로그인.됨 = false;
    const u = userEvent.setup();
    그리기();
    await u.click(await screen.findByRole("button", { name: "글쓰기" }));
    expect(navigate).toHaveBeenCalledWith("/login");
  });
});

describe("4 — 종목 이름", () => {
  it("코드 대신 이름 칩, '종목 보기 →' 는 없다", async () => {
    그리기();
    const 칩 = await screen.findByRole("link", { name: "삼성전자" });
    expect(칩).toHaveAttribute("href", "/stocks/KR/005930");
    expect(screen.queryByText("005930")).toBeNull();
    expect(screen.queryByText(/종목 보기/)).toBeNull();
  });

  it("이름을 모르면 코드", async () => {
    getFeed.mockImplementation(() => 피드([글({ id: 1, symbol: "SCHD", market: "US", name: null })]));
    그리기();
    expect(await screen.findByRole("link", { name: "SCHD" })).toHaveAttribute("href", "/stocks/US/SCHD");
  });

  it("포트폴리오 글은 '포트폴리오' — 걸린 첫 종목을 내세우지 않는다. 원 그래프 대신 색 띠(8번)", async () => {
    getFeed.mockImplementation(() => 피드([글({
      id: 3, symbol: "000660", name: "SK하이닉스",
      portfolio: [
        { symbol: "000660", market: "KR", name: "SK하이닉스", shares: 10, avg_price: 180000, current_price: 200000 },
        { symbol: "005930", market: "KR", name: "삼성전자", shares: 50, avg_price: 68000, current_price: 70000 },
      ],
    })]));
    그리기();
    expect(await screen.findByText("포트폴리오")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "SK하이닉스" })).toBeNull();
    expect(await screen.findByRole("img", { name: /종목 비중 — 삼성전자 63.6%, SK하이닉스 36.4%/ })).toBeInTheDocument();
    expect(screen.queryByText("종목별")).toBeNull();     // 원 그래프의 탭
  });
});

describe("5 — 아래 단추", () => {
  it("아이콘과 숫자만 — 이름은 '좋아요 3', '댓글 2', '공유'", async () => {
    그리기();
    const 좋아요 = await screen.findByRole("button", { name: "좋아요 3" });
    expect(좋아요).toHaveAttribute("aria-pressed", "false");
    expect(좋아요.textContent).toBe("3");
    expect(screen.getByRole("button", { name: "댓글 2" }).textContent).toBe("2");
    expect(screen.getByRole("button", { name: "공유" }).textContent).toBe("");
  });

  it("숫자가 0 이면 숫자도 '좋아요' 글자도 없이 아이콘만", async () => {
    getFeed.mockImplementation(() => 피드([글({ id: 1, like_count: 0, comment_count: 0 })]));
    그리기();
    expect((await screen.findByRole("button", { name: "좋아요" })).textContent).toBe("");
    expect(screen.getByRole("button", { name: "댓글" }).textContent).toBe("");
  });

  it("조회수는 있을 때만", async () => {
    getFeed.mockImplementation(() => 피드([글({ id: 1, view_count: 0 }), 글({ id: 2, view_count: 5 })]));
    그리기();
    await screen.findAllByRole("button", { name: "좋아요 3" });
    expect(screen.queryByLabelText("조회 0")).toBeNull();
    expect(screen.getByLabelText("조회 5")).toBeInTheDocument();
  });

  it("누르면 하트가 톡 튀고, 서버 값으로 맞춘다", async () => {
    togglePostLike.mockResolvedValue({ liked: true, like_count: 4 });
    const u = userEvent.setup();
    그리기();
    await u.click(await screen.findByRole("button", { name: "좋아요 3" }));
    const 눌림 = await screen.findByRole("button", { name: "좋아요 4" });
    expect(눌림).toHaveAttribute("aria-pressed", "true");
    expect(눌림.querySelector("svg")!.getAttribute("class")).toContain("heart-pop");
  });
});

describe("6 — ⋯ 메뉴", () => {
  const 메뉴들 = async () => {
    const u = userEvent.setup();
    await u.click(await screen.findByRole("button", { name: "글 메뉴" }));
    return { u, 항목: screen.getAllByRole("menuitem").map((m) => m.textContent) };
  };

  it("내 글 — 링크 복사·삭제. 삭제는 무엇을 지우는지 보여 주고 묻는다", async () => {
    getFeed.mockImplementation(() => 피드([글({ id: 1, is_mine: true })]));
    그리기();
    const { u, 항목 } = await 메뉴들();
    expect(항목).toEqual(["링크 복사", "삭제"]);
    await u.click(screen.getByRole("menuitem", { name: "삭제" }));
    expect(screen.getByText("글을 삭제할까요?")).toBeInTheDocument();
    expect(screen.getByText("삼성전자 · 삼성전자 3분기 실적 리뷰")).toBeInTheDocument();
  });

  it("남의 글 — 링크 복사·신고. 신고는 사유를 골라 보낸다", async () => {
    그리기();
    const { u, 항목 } = await 메뉴들();
    expect(항목).toEqual(["링크 복사", "신고"]);
    await u.click(screen.getByRole("menuitem", { name: "신고" }));
    await u.click(screen.getByRole("radio", { name: "스팸·광고" }));
    await u.click(screen.getByRole("button", { name: "신고" }));
    await waitFor(() => expect(reportPost).toHaveBeenCalledWith(1, "스팸·광고"));
    expect(await screen.findByText("신고가 접수되었습니다")).toBeInTheDocument();
  });

  it("로그인 전에는 신고 없이 링크 복사만", async () => {
    로그인.됨 = false;
    그리기();
    expect((await 메뉴들()).항목).toEqual(["링크 복사"]);
  });

  it("메뉴를 눌러도 글로 넘어가지 않는다", async () => {
    그리기();
    await 메뉴들();
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("7 — 공유(PC)", () => {
  it("글 주소를 복사하고 알린다", async () => {
    const u = userEvent.setup();     // 사용자 이벤트가 클립보드를 흉내 낸다
    그리기();
    await u.click(await screen.findByRole("button", { name: "공유" }));
    expect(await screen.findByText("링크를 복사했어요")).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/post/1`);
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("9 — 사진", () => {
  it("누르면 크게 보고, 글로 넘어가지 않는다", async () => {
    getFeed.mockImplementation(() => 피드([글({ id: 4, has_image: true })]));
    const u = userEvent.setup();
    그리기();
    await u.click(await screen.findByRole("button", { name: "사진 크게 보기" }));
    const 크게 = screen.getByRole("dialog", { name: "사진 크게 보기" });
    expect(within(크게).getByRole("img")).toHaveAttribute("src", `${API_BASE}/community/posts/4/image`);
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("글 누르기", () => {
  it("글 줄을 누르면 글 상세로", async () => {
    const u = userEvent.setup();
    그리기();
    await u.click(await screen.findByText("본문"));
    expect(navigate).toHaveBeenCalledWith("/post/1");
  });
});

describe("10 — 이어서 불러오기", () => {
  it("쪽 번호가 없고, 끝에서 다음 쪽을 받아 붙인다 — 다 보면 그렇다고 말한다", async () => {
    getFeed.mockImplementation((page: number) =>
      page === 1 ? Promise.resolve({ items: [글({ id: 1 }), 글({ id: 2, title: "둘째" })], total: 3, page: 1 })
                 : Promise.resolve({ items: [글({ id: 2, title: "둘째" }), 글({ id: 3, title: "셋째" })], total: 3, page: 2 }));
    const u = userEvent.setup();
    그리기();
    await screen.findByText("둘째");
    expect(screen.queryByRole("button", { name: "1" })).toBeNull();
    await u.click(screen.getByRole("button", { name: "더 보기" }));
    expect(await screen.findByText("셋째")).toBeInTheDocument();
    expect(getFeed.mock.calls.map((c) => c[0])).toEqual([1, 2]);
    // 쪽 사이에 새 글이 끼어 같은 글이 두 쪽에 걸쳐도 한 번만
    expect(screen.getAllByText("둘째")).toHaveLength(1);
    expect(screen.getByText("글 3개를 모두 봤어요")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "더 보기" })).toBeNull();
  });

  it("끝에 닿기 조금 전(600px)이면 누르지 않아도 다음 쪽을 받는다", async () => {
    const 지켜봄: { 부름: (e: any[]) => void; 여백?: string }[] = [];
    const 원래 = globalThis.IntersectionObserver;
    (globalThis as any).IntersectionObserver = class {
      constructor(부름: (e: any[]) => void, o?: IntersectionObserverInit) { 지켜봄.push({ 부름, 여백: o?.rootMargin }); }
      observe() {} disconnect() {} unobserve() {} takeRecords() { return []; }
    };
    try {
      getFeed.mockImplementation((page: number) => Promise.resolve({ items: [글({ id: page, title: `${page}쪽 글` })], total: 5, page }));
      그리기();
      await screen.findByText("1쪽 글");
      await waitFor(() => expect(지켜봄.length).toBeGreaterThan(0));
      expect(지켜봄[지켜봄.length - 1].여백).toBe("600px 0px");
      // 아직 안 보이면 받지 않는다
      act(() => 지켜봄[지켜봄.length - 1].부름([{ isIntersecting: false }]));
      expect(getFeed.mock.calls.map((c) => c[0])).toEqual([1]);
      act(() => 지켜봄[지켜봄.length - 1].부름([{ isIntersecting: true }]));
      expect(await screen.findByText("2쪽 글")).toBeInTheDocument();
      expect(getFeed.mock.calls.map((c) => c[0])).toEqual([1, 2]);
    } finally {
      (globalThis as any).IntersectionObserver = 원래;
    }
  });

  it("다음 쪽 셈 — 받은 글이 전체보다 적을 때만, 빈 쪽이 오면 멈춘다", () => {
    const 쪽 = (n: number, total: number) => ({ total, page: 1, items: Array.from({ length: n }, (_, i) => 글({ id: i })) });
    expect(PAGE_SIZE).toBe(20);
    expect(다음쪽(쪽(20, 45), [쪽(20, 45)])).toBe(2);
    expect(다음쪽(쪽(20, 45), [쪽(20, 45), 쪽(20, 45)])).toBe(3);
    expect(다음쪽(쪽(5, 45), [쪽(20, 45), 쪽(20, 45), 쪽(5, 45)])).toBeUndefined();
    expect(다음쪽(쪽(0, 45), [쪽(20, 45), 쪽(0, 45)])).toBeUndefined();   // 지워진 글로 수가 어긋나도 끝없이 묻지 않는다
  });

  it("받은 쪽들 안의 글 하나만 고치거나 뺀다", () => {
    const 자료 = { pageParams: [1, 2], pages: [{ total: 3, page: 1, items: [글({ id: 1 }), 글({ id: 2 })] }, { total: 3, page: 2, items: [글({ id: 3 })] }] };
    const 고친 = 글고치기(자료, 3, (p) => ({ ...p, like_count: 9 }))!;
    expect(한줄로(고친).map((p) => [p.id, p.like_count])).toEqual([[1, 3], [2, 3], [3, 9]]);
    expect(한줄로(글빼기(자료, 2)).map((p) => p.id)).toEqual([1, 3]);
    expect(한줄로(자료).map((p) => p.id)).toEqual([1, 2, 3]);          // 원본은 그대로
    expect(글고치기(undefined, 1, (p) => p)).toBeUndefined();
  });
});

describe("댓글 창에서 바뀐 숫자가 목록에도", () => {
  it("댓글 수(답글 포함)와 좋아요가 그 글에 바로 맞춰진다", async () => {
    getComments.mockImplementation(() => Promise.resolve([
      { id: 10, parent_id: null, user_id: 3, username: "배당러버", avatar_color: 0, content: "첫 댓글", like_count: 0, liked: false,
        created_at: new Date().toISOString(), is_mine: false,
        replies: [
          { id: 11, parent_id: 10, user_id: 4, username: "테슬라맨", avatar_color: 0, content: "답1", like_count: 0, liked: false, created_at: new Date().toISOString(), is_mine: false, replies: [] },
          { id: 12, parent_id: 10, user_id: 1, username: "피씨뷰", avatar_color: 0, content: "답2", like_count: 0, liked: false, created_at: new Date().toISOString(), is_mine: true, replies: [] },
        ] },
      { id: 13, parent_id: null, user_id: 2, username: "주식고수", avatar_color: 0, content: "둘째 댓글", like_count: 0, liked: false, created_at: new Date().toISOString(), is_mine: false, replies: [] },
    ] as any));
    togglePostLike.mockResolvedValue({ liked: true, like_count: 4 });
    const u = userEvent.setup();
    그리기();
    await u.click(await screen.findByRole("button", { name: "댓글 2" }));
    const 창 = await screen.findByRole("dialog", { name: "댓글" });
    await within(창).findByText("둘째 댓글");
    // 창 뒤의 목록 — 2 → 4 (창 안의 댓글 단추도 4)
    await waitFor(() => {
      const 넷 = screen.getAllByRole("button", { name: "댓글 4" });
      expect(넷.filter((b) => !창.contains(b))).toHaveLength(1);
    });
    expect(screen.queryByRole("button", { name: "댓글 2" })).toBeNull();

    await u.click(within(창).getByRole("button", { name: "좋아요 3" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: "좋아요 4" })).toHaveLength(2));   // 창과 목록 둘 다
  });
});
