/**
 * 메시지 목록 — 최근 대화부터, 안 읽은 수, 내가 보낸 마지막 메시지는 '나:', 차단한 사람 관리.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";

vi.mock("@/api/dm", async (원본) => {
  const 실제 = await 원본<typeof import("@/api/dm")>();
  return { ...실제, dmApi: { listThreads: vi.fn(), listBlocks: vi.fn(), unblock: vi.fn(), openThread: vi.fn() } };
});
vi.mock("@/api/community", () => ({ communityApi: { getFollowing: vi.fn(), getFollowers: vi.fn() } }));

import Messages, { 안읽음글 } from "@/pages/Messages";
import { dmApi, type 대화방줄 } from "@/api/dm";
import { communityApi } from "@/api/community";
import { useAuthStore } from "@/store/authStore";
import { 초안쓰기 } from "@/utils/대화초안";
import { 사람합치기, 찾기맞나, type 팔로우사람 } from "@/components/dm/새대화창";

const api = vi.mocked(dmApi);
const 커뮤 = vi.mocked(communityApi);
const 사람 = (id: number, name: string) => ({ id, name, username: `u${id}`, avatar_url: null, avatar_color: id, active: true });
const 지금 = new Date();
const 방 = (id: number, 이름: string, preview: string, unread: number, mine = false): 대화방줄 => ({
  id, other: 사람(id + 100, 이름), unread,
  last_message: { id: id * 10, mine, preview, created_at: 지금.toISOString() },
});

/** 옮겨 간 화면 — 주소도 같이 보인다(새 메시지로 연 방 번호를 확인) */
function ShowPath({ 이름 }: { 이름: string }) {
  return <div>{이름}<span>{useLocation().pathname}</span></div>;
}

function 그리기() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/messages"]}>
        <Routes>
          <Route path="/messages" element={<Messages />} />
          <Route path="/messages/:id" element={<ShowPath 이름="대화방 화면" />} />
          <Route path="/login" element={<div>로그인 화면</div>} />
          <Route path="/feed" element={<div>피드 화면</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useAuthStore.setState({ token: "t", userId: 1, username: "me", isLoggedIn: true, isAdmin: false });
});

describe("메시지 목록", () => {
  it("방마다 상대·마지막 메시지·시각, 안 읽은 것은 굵게 + 빨간 수", async () => {
    api.listThreads.mockResolvedValue({ items: [방(1, "개미왕", "내일 봬요", 3), 방(2, "주린이", "고마워요", 0, true)] });
    그리기();
    const 목록 = await screen.findByRole("list", { name: "대화 목록" });
    const [첫, 둘] = within(목록).getAllByRole("link");
    expect(첫).toHaveAttribute("href", "/messages/1");
    expect(within(첫).getByText("개미왕")).toHaveClass("font-bold");
    expect(within(첫).getByLabelText("안 읽은 메시지 3개")).toHaveTextContent("3");
    expect(within(둘).getByText("주린이")).not.toHaveClass("font-bold");
    expect(within(둘).queryByLabelText(/안 읽은 메시지/)).toBeNull();
    // 내가 보낸 마지막 메시지는 '나:' 를 붙인다
    expect(둘).toHaveTextContent("나: 고마워요");
    expect(첫).not.toHaveTextContent("나:");
    // 오늘 온 것은 시각으로
    expect(첫).toHaveTextContent(/오[전후] \d{1,2}:\d{2}/);
  });

  it("방을 누르면 그 대화방으로", async () => {
    api.listThreads.mockResolvedValue({ items: [방(4, "개미왕", "안녕", 1)] });
    그리기();
    await userEvent.click(await screen.findByRole("link", { name: /개미왕/ }));
    expect(screen.getByText("대화방 화면")).toBeInTheDocument();
  });

  it("99 를 넘으면 99+", () => {
    expect(안읽음글(1)).toBe("1");
    expect(안읽음글(98)).toBe("98");
    expect(안읽음글(99)).toBe("99+");
    expect(안읽음글(150)).toBe("99+");
  });

  it("비었으면 어디서 시작하는지 알려 주고, 바로 새 메시지 창을 연다", async () => {
    api.listThreads.mockResolvedValue({ items: [] });
    커뮤.getFollowing.mockResolvedValue([]);
    커뮤.getFollowers.mockResolvedValue([]);
    그리기();
    expect(await screen.findByText("아직 나눈 메시지가 없어요")).toBeInTheDocument();
    // 목록 위 연필 단추와 같은 창 — 둘 다 '새 메시지'
    await userEvent.click(screen.getAllByRole("button", { name: "새 메시지" })[1]);
    expect(await screen.findByText("아직 팔로우로 이어진 사람이 없어요")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "피드 보기" }));
    expect(screen.getByText("피드 화면")).toBeInTheDocument();
  });

  it("못 받았으면 빈 목록이 아니라 다시 시도", async () => {
    api.listThreads.mockRejectedValue({ response: { status: 500 } });
    그리기();
    expect(await screen.findByRole("button", { name: "다시 시도" })).toBeInTheDocument();
    expect(screen.queryByText("아직 나눈 메시지가 없어요")).toBeNull();
  });

  it("로그인 전이면 묻지 않고 로그인하라고", async () => {
    useAuthStore.setState({ token: null, userId: null, username: null, isLoggedIn: false, isAdmin: false });
    그리기();
    expect(screen.getByText("로그인하면 메시지를 주고받을 수 있어요")).toBeInTheDocument();
    expect(api.listThreads).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "로그인" }));
    expect(screen.getByText("로그인 화면")).toBeInTheDocument();
  });
});

describe("쓰던 글 — 목록에서도 보인다", () => {
  it("쓰다 만 글이 있는 방은 마지막 메시지 대신 '쓰던 글: …'(줄바꿈은 한 칸으로)", async () => {
    api.listThreads.mockResolvedValue({ items: [방(1, "개미왕", "내일 봬요", 0), 방(2, "주린이", "고마워요", 0, true)] });
    초안쓰기(2, "주말에\n  시간 돼요?");
    그리기();
    const 목록 = await screen.findByRole("list", { name: "대화 목록" });
    const [첫, 둘] = within(목록).getAllByRole("link");
    expect(둘).toHaveTextContent("쓰던 글: 주말에 시간 돼요?");
    expect(둘).not.toHaveTextContent("고마워요");
    expect(첫).not.toHaveTextContent("쓰던 글");
    expect(첫).toHaveTextContent("내일 봬요");
  });

  it("안 읽은 것이 있으면 새로 온 것이 먼저 — 빈칸뿐인 글은 쓰던 글이 아니다", async () => {
    api.listThreads.mockResolvedValue({ items: [방(1, "개미왕", "새로 온 말", 2), 방(2, "주린이", "고마워요", 0)] });
    초안쓰기(1, "쓰던 것");
    localStorage.setItem("qcache_v1:u1:dm-draft:2", "   ");   // 옛날에 남은 빈 글
    그리기();
    const [첫, 둘] = within(await screen.findByRole("list", { name: "대화 목록" })).getAllByRole("link");
    expect(첫).toHaveTextContent("새로 온 말");
    expect(첫).not.toHaveTextContent("쓰던 글");
    expect(둘).not.toHaveTextContent("쓰던 글");
  });
});

const 팔 = (user_id: number, nickname: string | null, username = `u${user_id}`): 팔로우사람 =>
  ({ user_id, username, nickname, avatar_color: user_id, avatar_url: null });

describe("새 메시지 — 팔로우로 이어진 사람을 골라 대화를 연다", () => {
  it("합치기 — 서로 팔로우가 먼저, 겹치면 한 번, 이름이 없으면 아이디", () => {
    const 합 = 사람합치기([팔(1, "가"), 팔(2, "나"), 팔(3, null, "dahee")], [팔(4, "라"), 팔(2, "나"), 팔(5, "마")]);
    expect(합.map((p) => [p.user_id, p.이름, p.사이])).toEqual([
      [2, "나", "서로 팔로우"], [1, "가", "팔로잉"], [3, "dahee", "팔로잉"], [4, "라", "팔로워"], [5, "마", "팔로워"],
    ]);
    expect(사람합치기([], [])).toEqual([]);
  });

  it("찾기 — 이름이나 아이디에 들어 있으면(대소문자 무시), 빈칸은 모두", () => {
    const [p] = 사람합치기([팔(1, "개미왕", "AntKing")], []);
    expect(찾기맞나(p, "")).toBe(true);
    expect(찾기맞나(p, "  ")).toBe(true);
    expect(찾기맞나(p, "개미")).toBe(true);
    expect(찾기맞나(p, "antk")).toBe(true);
    expect(찾기맞나(p, " 왕 ")).toBe(true);
    expect(찾기맞나(p, "주린이")).toBe(false);
  });

  it("연필 단추 → 사람을 고르면 그 사람과의 방으로", async () => {
    api.listThreads.mockResolvedValue({ items: [방(1, "개미왕", "안녕", 0)] });
    커뮤.getFollowing.mockResolvedValue([팔(11, "개미왕"), 팔(12, "주린이")]);
    커뮤.getFollowers.mockResolvedValue([팔(12, "주린이"), 팔(13, "단타왕")]);
    api.openThread.mockResolvedValue({ id: 42 });
    그리기();
    await screen.findByRole("list", { name: "대화 목록" });
    await userEvent.click(screen.getByRole("button", { name: "새 메시지" }));
    expect(커뮤.getFollowing).toHaveBeenCalledWith(1);
    expect(커뮤.getFollowers).toHaveBeenCalledWith(1);
    const 목록 = await screen.findByRole("list", { name: "메시지를 보낼 사람" });
    // 서로 팔로우(주린이) → 내가 팔로우(개미왕) → 나를 팔로우(단타왕), 겹친 주린이는 한 번
    const 줄들 = within(목록).getAllByRole("button");
    expect(줄들.map((b) => within(b).getByText(/^@/).textContent)).toEqual(["@u12", "@u11", "@u13"]);
    expect(줄들[0]).toHaveTextContent(/주린이@u12서로 팔로우$/);
    expect(줄들[1]).toHaveTextContent(/개미왕@u11팔로잉$/);
    expect(줄들[2]).toHaveTextContent(/단타왕@u13팔로워$/);
    // 찾기
    await userEvent.type(screen.getByRole("searchbox", { name: "이름으로 찾기" }), "단타");
    expect(within(목록).getAllByRole("button")).toHaveLength(1);
    await userEvent.type(screen.getByRole("searchbox", { name: "이름으로 찾기" }), "없는사람");
    expect(screen.getByText("'단타없는사람' 에 맞는 사람이 없어요")).toBeInTheDocument();
    await userEvent.clear(screen.getByRole("searchbox", { name: "이름으로 찾기" }));

    await userEvent.click(screen.getByRole("button", { name: /주린이/ }));
    await waitFor(() => expect(api.openThread).toHaveBeenCalledWith(12));
    expect(await screen.findByText("/messages/42")).toBeInTheDocument();
    expect(screen.queryByText("새 메시지", { selector: "h2" })).toBeNull();
  });

  it("이용이 막힌 계정(403)은 까닭을 말하고 창에 남는다 — 다른 오류도 말한다", async () => {
    api.listThreads.mockResolvedValue({ items: [] });
    커뮤.getFollowing.mockResolvedValue([팔(11, "개미왕")]);
    커뮤.getFollowers.mockResolvedValue([]);
    api.openThread.mockRejectedValueOnce({ response: { status: 403 } })
      .mockRejectedValueOnce({ response: { status: 429 } })
      .mockRejectedValueOnce({ response: { status: 404 } })
      .mockRejectedValueOnce(new Error("network"));
    그리기();
    await screen.findByText("아직 나눈 메시지가 없어요");
    await userEvent.click(screen.getAllByRole("button", { name: "새 메시지" })[0]);   // 위의 연필 단추
    const 고르기 = async () => userEvent.click(await screen.findByRole("button", { name: /개미왕/ }));
    await 고르기();
    expect(await screen.findByRole("alert")).toHaveTextContent("커뮤니티 이용이 제한된 계정은 메시지를 보낼 수 없어요");
    await 고르기();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("대화를 너무 자주 열고 있어요"));
    await 고르기();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("탈퇴했거나 찾을 수 없는 사용자예요"));
    await 고르기();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("대화를 열지 못했어요"));
    expect(screen.getByRole("list", { name: "메시지를 보낼 사람" })).toBeInTheDocument();
  });

  it("목록을 못 받았으면 다시 시도", async () => {
    api.listThreads.mockResolvedValue({ items: [방(1, "개미왕", "안녕", 0)] });
    커뮤.getFollowing.mockRejectedValueOnce({ response: { status: 500 } }).mockResolvedValue([팔(11, "개미왕")]);
    커뮤.getFollowers.mockResolvedValue([]);
    그리기();
    await screen.findByRole("list", { name: "대화 목록" });
    await userEvent.click(screen.getByRole("button", { name: "새 메시지" }));
    await userEvent.click(await screen.findByRole("button", { name: "다시 시도" }));
    expect(await screen.findByRole("list", { name: "메시지를 보낼 사람" })).toBeInTheDocument();
  });
});

describe("차단한 사람", () => {
  it("목록을 열고 차단을 풀면 다시 받는다", async () => {
    api.listThreads.mockResolvedValue({ items: [] });
    api.listBlocks.mockResolvedValueOnce({ items: [{ ...사람(9, "스팸러"), blocked_at: "2026-11-01T00:00:00Z" }] })
      .mockResolvedValueOnce({ items: [] });
    api.unblock.mockResolvedValue({ blocked: false });
    그리기();
    await userEvent.click(await screen.findByRole("button", { name: /차단한 사람/ }));
    const 목록 = await screen.findByRole("list", { name: "차단한 사람 목록" });
    expect(within(목록).getByText("스팸러")).toBeInTheDocument();
    await userEvent.click(within(목록).getByRole("button", { name: "차단 풀기" }));
    await waitFor(() => expect(api.unblock).toHaveBeenCalledWith(9));
    expect(await screen.findByText("차단한 사람이 없어요")).toBeInTheDocument();
  });
});
