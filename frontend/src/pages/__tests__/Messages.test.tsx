/**
 * 메시지 목록 — 최근 대화부터, 안 읽은 수, 내가 보낸 마지막 메시지는 '나:', 차단한 사람 관리.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";

vi.mock("@/api/dm", async (원본) => {
  const 실제 = await 원본<typeof import("@/api/dm")>();
  return { ...실제, dmApi: { listThreads: vi.fn(), listBlocks: vi.fn(), unblock: vi.fn() } };
});

import Messages, { 안읽음글 } from "@/pages/Messages";
import { dmApi, type 대화방줄 } from "@/api/dm";
import { useAuthStore } from "@/store/authStore";

const api = vi.mocked(dmApi);
const 사람 = (id: number, name: string) => ({ id, name, username: `u${id}`, avatar_url: null, avatar_color: id, active: true });
const 지금 = new Date();
const 방 = (id: number, 이름: string, preview: string, unread: number, mine = false): 대화방줄 => ({
  id, other: 사람(id + 100, 이름), unread,
  last_message: { id: id * 10, mine, preview, created_at: 지금.toISOString() },
});

function 그리기() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/messages"]}>
        <Routes>
          <Route path="/messages" element={<Messages />} />
          <Route path="/messages/:id" element={<div>대화방 화면</div>} />
          <Route path="/login" element={<div>로그인 화면</div>} />
          <Route path="/feed" element={<div>피드 화면</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
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

  it("비었으면 어디서 시작하는지 알려 준다", async () => {
    api.listThreads.mockResolvedValue({ items: [] });
    그리기();
    expect(await screen.findByText("아직 나눈 메시지가 없어요")).toBeInTheDocument();
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
