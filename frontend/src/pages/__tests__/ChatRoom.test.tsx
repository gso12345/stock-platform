/**
 * 대화방 — 사용자: "상대방이랑 채팅도 할 수 있도록 해줘".
 *
 * 서버(dmApi)만 흉내 내고 화면은 그대로 그린다. 조용히 틀리기 쉬운 곳을 하나씩 본다.
 *   · 보내면 곧바로 말풍선(보내는 중) → 서버가 받으면 시각. 못 보내면 '못 보냄' 과 다시 보내기
 *   · PC 는 Enter 로 보내고, 휴대폰 자판의 Enter 는 줄바꿈. 한글 조합 중의 Enter 는 보내지 않는다
 *   · 새 것은 '이 번호 다음' 으로 묻고, 조용하면 묻는 간격을 늘린다. 화면이 뒤에 있으면 안 묻는다
 *   · 읽음은 상대 것이 새로 보일 때만 보낸다. 상대가 읽은 내 마지막 메시지 아래 '읽음'
 *   · 막힌 방은 입력칸 대신 까닭을, 내가 막았으면 '차단 풀기' 를
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";

vi.mock("@/api/dm", async (원본) => {
  const 실제 = await 원본<typeof import("@/api/dm")>();
  return {
    ...실제,
    dmApi: {
      openThread: vi.fn(), listThreads: vi.fn(), getThread: vi.fn(), getMessages: vi.fn(), send: vi.fn(),
      markRead: vi.fn(), leave: vi.fn(), deleteMessage: vi.fn(), report: vi.fn(), unreadCount: vi.fn(),
      block: vi.fn(), unblock: vi.fn(), listBlocks: vi.fn(),
    },
  };
});

import ChatRoom, { 묻기간격 } from "@/pages/ChatRoom";
import { dmApi, type 메시지, type 대화방 } from "@/api/dm";
import { useAuthStore } from "@/store/authStore";

const 상대 = { id: 5, name: "개미왕", username: "ant", avatar_url: null, avatar_color: 2, active: true };
const 방기본: 대화방 = { id: 7, other: 상대, can_send: true, i_blocked: false, my_read_id: 0, other_read_id: 0 };
const 때 = (일: number, 시: number, 분: number) => new Date(2026, 10, 일, 시, 분).toISOString();
const 메 = (id: number, mine: boolean, body: string | null, 시각: string, 덧: Partial<메시지> = {}): 메시지 =>
  ({ id, mine, body, deleted: false, blinded: false, created_at: 시각, ...덧 });

const api = vi.mocked(dmApi);
let 처음목록: 메시지[] = [];
let 처음더있음 = false;
let 상대읽음 = 0;
let 보임상태: "visible" | "hidden" = "visible";

function 그리기(주소 = "/messages/7") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const 결과 = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[주소]}>
        <main>
          <Routes>
            <Route path="/messages/:threadId" element={<ChatRoom />} />
            <Route path="/messages" element={<div>메시지 목록 화면</div>} />
            <Route path="/profile/:id" element={<div>프로필 화면</div>} />
            <Route path="/login" element={<div>로그인 화면</div>} />
          </Routes>
        </main>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...결과, qc };
}

const 말풍선 = (글: string) => screen.getByRole("button", { name: 글 });
/** 마지막 것 — 같은 이름의 단추가 둘이면 나중에 뜬 창의 것 */
const 끝 = <T,>(목록: T[]): T => 목록[목록.length - 1];
const 입력칸 = () => screen.getByRole("textbox", { name: "메시지 쓰기" });

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ token: "t", userId: 1, username: "me", isLoggedIn: true, isAdmin: false });
  처음목록 = [
    메(10, false, "안녕하세요", 때(5, 21, 0)),
    메(11, true, "반가워요", 때(6, 9, 30)),
    메(12, true, "내일 봬요", 때(6, 9, 30)),
  ];
  처음더있음 = false;
  상대읽음 = 11;
  보임상태 = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => 보임상태 });
  api.getThread.mockResolvedValue(방기본);
  api.getMessages.mockImplementation(async (_방, 물음 = {}) => {
    if (물음.after_id != null) return { items: [], has_more: false, other_read_id: 상대읽음 };
    if (물음.before_id != null) return { items: [], has_more: false, other_read_id: 상대읽음 };
    return { items: 처음목록, has_more: 처음더있음, other_read_id: 상대읽음 };
  });
  api.markRead.mockImplementation(async (_방, 번호) => ({ read_id: 번호 }));
});

afterEach(() => {
  vi.useRealTimers();
  delete (navigator as any).serviceWorker;
  window.matchMedia = ((q: string) => ({
    matches: false, media: q, onchange: null, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  })) as any;
});

describe("그리기", () => {
  it("날짜 줄 · 내 것과 상대 것 · 묶음 끝의 시각 · 상대가 읽은 내 마지막 메시지에 '읽음'", async () => {
    그리기();
    expect(await screen.findByText("안녕하세요")).toBeInTheDocument();
    const 로그 = screen.getByRole("log", { name: "개미왕님과의 대화" });
    expect(within(로그).getByText("2026년 11월 5일 목요일")).toBeInTheDocument();
    expect(within(로그).getByText("2026년 11월 6일 금요일")).toBeInTheDocument();
    expect(말풍선("안녕하세요").closest("[data-dm-message]")).toHaveAttribute("data-dm-message", "theirs");
    expect(말풍선("반가워요").closest("[data-dm-message]")).toHaveAttribute("data-dm-message", "mine");
    // 같은 분에 보낸 두 줄 — 시각은 끝 줄에만
    expect(within(로그).getAllByText("오전 9:30")).toHaveLength(1);
    expect(말풍선("내일 봬요").closest("[data-dm-message]")).toHaveTextContent("오전 9:30");
    // 상대는 11번까지 읽었다 — '읽음' 은 11번 아래에만
    expect(within(로그).getAllByText("읽음")).toHaveLength(1);
    expect(말풍선("반가워요").closest("[data-dm-message]")).toHaveTextContent("읽음");
    // 위 띠 — 상대 이름은 프로필로
    expect(screen.getByRole("link", { name: /개미왕/ })).toHaveAttribute("href", "/profile/5");
  });

  it("지운 것·가려진 것은 글 대신 자리만", async () => {
    처음목록 = [메(1, false, null, 때(6, 9, 0), { deleted: true }), 메(2, false, null, 때(6, 9, 1), { blinded: true })];
    그리기();
    expect(await screen.findByText("삭제된 메시지예요")).toBeInTheDocument();
    expect(screen.getByText("운영 정책으로 가려진 메시지예요")).toBeInTheDocument();
    // 가려진 것은 신고·복사할 것이 없다
    await userEvent.click(말풍선("운영 정책으로 가려진 메시지예요"));
    expect(screen.queryByRole("button", { name: "신고" })).toBeNull();
    expect(screen.queryByRole("button", { name: "복사" })).toBeNull();
  });

  it("아직 나눈 것이 없으면 인사를 건네 보라고", async () => {
    처음목록 = [];
    그리기();
    expect(await screen.findByText("아직 나눈 메시지가 없어요. 먼저 인사를 건네 보세요")).toBeInTheDocument();
    expect(api.markRead).not.toHaveBeenCalled();
  });

  it("없는 방·남의 방이면 '대화를 찾을 수 없어요'", async () => {
    api.getThread.mockRejectedValue({ response: { status: 404 } });
    api.getMessages.mockRejectedValue({ response: { status: 404 } });
    그리기();
    expect(await screen.findByText("대화를 찾을 수 없어요")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "메시지 목록으로" }));
    expect(screen.getByText("메시지 목록 화면")).toBeInTheDocument();
  });

  it("주소가 번호가 아니면 묻지도 않는다", () => {
    그리기("/messages/abc");
    expect(screen.getByText("대화를 찾을 수 없어요")).toBeInTheDocument();
    expect(api.getMessages).not.toHaveBeenCalled();
  });

  it("로그인 전이면 로그인하라고", async () => {
    useAuthStore.setState({ token: null, userId: null, username: null, isLoggedIn: false, isAdmin: false });
    그리기();
    expect(screen.getByText("로그인하면 메시지를 볼 수 있어요")).toBeInTheDocument();
    expect(api.getMessages).not.toHaveBeenCalled();
  });

  it("탈퇴한 상대는 프로필로 잇지 않는다", async () => {
    api.getThread.mockResolvedValue({ ...방기본, can_send: false, other: { ...상대, name: "탈퇴한 사용자", active: false } });
    그리기();
    expect(await screen.findByText("탈퇴했거나 이용이 멈춘 사용자라 메시지를 보낼 수 없어요.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /탈퇴한 사용자/ })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "메시지 쓰기" })).toBeNull();
    expect(screen.queryByRole("button", { name: "차단 풀기" })).toBeNull();
  });
});

describe("읽음", () => {
  it("상대 것이 보이면 마지막 번호까지 읽었다고 알린다 — 한 번만", async () => {
    그리기();
    await waitFor(() => expect(api.markRead).toHaveBeenCalledWith(7, 12));
    await screen.findByText("안녕하세요");
    expect(api.markRead).toHaveBeenCalledTimes(1);
  });

  it("내 것만 있으면 알리지 않는다(보낼 때 서버가 이미 적었다)", async () => {
    처음목록 = [메(11, true, "반가워요", 때(6, 9, 30))];
    그리기();
    await screen.findByText("반가워요");
    await new Promise((r) => setTimeout(r, 20));
    expect(api.markRead).not.toHaveBeenCalled();
  });

  it("화면이 뒤에 있으면 읽음을 보내지 않는다", async () => {
    보임상태 = "hidden";
    그리기();
    await screen.findByText("안녕하세요");
    await new Promise((r) => setTimeout(r, 20));
    expect(api.markRead).not.toHaveBeenCalled();
  });

  it("읽으면 그 방의 휴대폰 알림을 걷는다", async () => {
    const 닫기 = vi.fn();
    const 알림들 = vi.fn(async () => [{ close: 닫기 }]);
    (navigator as any).serviceWorker = Object.assign(new EventTarget(), {
      getRegistration: async () => ({ getNotifications: 알림들 }),
    });
    그리기();
    await waitFor(() => expect(닫기).toHaveBeenCalled());
    expect(알림들).toHaveBeenCalledWith({ tag: "dm-7" });
  });
});

describe("보내기", () => {
  it("곧바로 말풍선(보내는 중) → 서버가 받으면 시각, 입력칸은 비운다", async () => {
    let 받기!: (m: 메시지) => void;
    api.send.mockImplementation(() => new Promise((r) => { 받기 = r; }));
    그리기();
    await screen.findByText("안녕하세요");
    await userEvent.type(입력칸(), "  잘 지내요?  ");
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));
    expect(api.send).toHaveBeenCalledWith(7, "잘 지내요?");
    expect(입력칸()).toHaveValue("");
    const 줄 = 말풍선("잘 지내요?").closest("[data-dm-message]")!;
    expect(줄).toHaveTextContent("보내는 중");
    await act(async () => { 받기(메(13, true, "잘 지내요?", 때(6, 10, 5))); });
    expect(말풍선("잘 지내요?").closest("[data-dm-message]")).toHaveTextContent("오전 10:05");
    expect(screen.queryByText("보내는 중")).toBeNull();
  });

  it("빈칸만 있으면 보내기 단추가 잠기고 보내지 않는다", async () => {
    그리기();
    await screen.findByText("안녕하세요");
    await userEvent.type(입력칸(), "   ");
    expect(screen.getByRole("button", { name: "보내기" })).toBeDisabled();
    fireEvent.keyDown(입력칸(), { key: "Enter", ctrlKey: true });
    expect(api.send).not.toHaveBeenCalled();
  });

  it("휴대폰 — Enter 는 줄바꿈, Ctrl+Enter 는 보내기", async () => {
    api.send.mockResolvedValue(메(13, true, "둘째 줄", 때(6, 10, 5)));
    그리기();
    await screen.findByText("안녕하세요");
    await userEvent.type(입력칸(), "첫 줄{Enter}둘째 줄");
    expect(api.send).not.toHaveBeenCalled();
    expect(입력칸()).toHaveValue("첫 줄\n둘째 줄");
    fireEvent.keyDown(입력칸(), { key: "Enter", ctrlKey: true });
    expect(api.send).toHaveBeenCalledWith(7, "첫 줄\n둘째 줄");
  });

  it("PC — Enter 로 보내고 Shift+Enter 는 줄바꿈. 한글 조합 중의 Enter 는 보내지 않는다", async () => {
    window.matchMedia = ((q: string) => ({
      matches: q.includes("min-width"), media: q, onchange: null, addListener() {}, removeListener() {},
      addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
    })) as any;
    api.send.mockResolvedValue(메(13, true, "안녕", 때(6, 10, 5)));
    그리기();
    await screen.findByText("안녕하세요");
    await userEvent.type(입력칸(), "안녕");
    fireEvent.keyDown(입력칸(), { key: "Enter", isComposing: true });
    fireEvent.keyDown(입력칸(), { key: "Enter", keyCode: 229 });
    fireEvent.keyDown(입력칸(), { key: "Enter", shiftKey: true });
    expect(api.send).not.toHaveBeenCalled();
    fireEvent.keyDown(입력칸(), { key: "Enter" });
    expect(api.send).toHaveBeenCalledTimes(1);
    expect(api.send).toHaveBeenCalledWith(7, "안녕");
  });

  it("못 보내면 '못 보냄' — 눌러서 다시 보내기, 지우기", async () => {
    api.send.mockRejectedValueOnce({ response: { status: 500 } }).mockResolvedValueOnce(메(13, true, "다시", 때(6, 10, 5)));
    그리기();
    await screen.findByText("안녕하세요");
    await userEvent.type(입력칸(), "다시");
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));
    expect(await screen.findByText("못 보냄")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("보내지 못했어요");
    await userEvent.click(말풍선("다시"));
    await userEvent.click(screen.getByRole("button", { name: "다시 보내기" }));
    await waitFor(() => expect(screen.queryByText("못 보냄")).toBeNull());
    expect(api.send).toHaveBeenCalledTimes(2);
    expect(screen.getAllByRole("button", { name: "다시" })).toHaveLength(1);
  });

  it("막혀서 못 보내면(403) 방을 다시 받아 까닭을 보인다", async () => {
    api.send.mockRejectedValue({ response: { status: 403 } });
    그리기();
    await screen.findByText("안녕하세요");
    api.getThread.mockResolvedValue({ ...방기본, can_send: false });
    await userEvent.type(입력칸(), "여보세요");
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));
    expect(await screen.findByText("지금은 이 상대에게 메시지를 보낼 수 없어요.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "메시지 쓰기" })).toBeNull();
    // 못 보낸 말풍선은 지울 수 있다
    await userEvent.click(말풍선("여보세요"));
    await userEvent.click(screen.getByRole("button", { name: "지우기" }));
    expect(screen.queryByRole("button", { name: "여보세요" })).toBeNull();
  });

  it("너무 빨리 보내면(429) 잠시 뒤에 보내라고", async () => {
    api.send.mockRejectedValue({ response: { status: 429 } });
    그리기();
    await screen.findByText("안녕하세요");
    await userEvent.type(입력칸(), "도배");
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("너무 빨리 보내고 있어요");
  });

  it("1,000자 가까이 쓰면 글자 수를 보인다", async () => {
    그리기();
    await screen.findByText("안녕하세요");
    fireEvent.change(입력칸(), { target: { value: "가".repeat(950) } });
    expect(screen.getByText("950/1,000")).toBeInTheDocument();
    expect(입력칸()).toHaveAttribute("maxLength", "1000");
  });
});

describe("새 것 묻기", () => {
  it("3초 뒤 '이 번호 다음' 을 묻고, 조용하면 간격을 1.5배로 늘린다 — 뒤에 있으면 안 묻는다", async () => {
    vi.useFakeTimers();
    그리기();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText("안녕하세요")).toBeInTheDocument();
    const 다음묻기 = () => api.getMessages.mock.calls.filter(([, 물음]) => 물음?.after_id != null);

    await act(async () => { await vi.advanceTimersByTimeAsync(묻기간격.처음 - 10); });
    expect(다음묻기()).toHaveLength(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(다음묻기()).toHaveLength(1);
    expect(다음묻기()[0][1]).toEqual({ after_id: 12 });

    // 아무것도 안 왔다 — 다음은 4.5초 뒤
    await act(async () => { await vi.advanceTimersByTimeAsync(4_400); });
    expect(다음묻기()).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(다음묻기()).toHaveLength(2);

    // 계속 조용해도 10초를 넘지 않는다
    for (let i = 0; i < 6; i++) await act(async () => { await vi.advanceTimersByTimeAsync(묻기간격.최대); });
    const 지금까지 = 다음묻기().length;
    await act(async () => { await vi.advanceTimersByTimeAsync(묻기간격.최대); });
    expect(다음묻기().length).toBe(지금까지 + 1);

    // 화면이 뒤로 가면 안 묻는다
    보임상태 = "hidden";
    const 뒤전 = 다음묻기().length;
    await act(async () => { await vi.advanceTimersByTimeAsync(묻기간격.최대 * 3); });
    expect(다음묻기().length).toBe(뒤전);
  });

  it("새 것이 오면 붙이고 읽음을 보내며, 간격을 다시 3초로", async () => {
    vi.useFakeTimers();
    그리기();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    // 한 번 조용히 → 4.5초 간격이 된다
    await act(async () => { await vi.advanceTimersByTimeAsync(묻기간격.처음); });
    api.getMessages.mockImplementation(async (_방, 물음 = {}) => (물음.after_id === 12
      ? { items: [메(13, false, "새 소식", 때(6, 10, 0))], has_more: false, other_read_id: 12 }
      : { items: [], has_more: false, other_read_id: 12 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(4_500); });
    expect(screen.getByText("새 소식")).toBeInTheDocument();
    expect(api.markRead).toHaveBeenLastCalledWith(7, 13);
    // 상대가 12번까지 읽었다 — '읽음' 이 12번으로 옮겨 간다
    expect(말풍선("내일 봬요").closest("[data-dm-message]")).toHaveTextContent("읽음");
    // 오가는 중이라 다음은 다시 3초 뒤 — 이번에는 13번 다음을 묻는다
    const 전 = api.getMessages.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(묻기간격.처음); });
    expect(api.getMessages.mock.calls.length).toBe(전 + 1);
    expect(끝(api.getMessages.mock.calls)[1]).toEqual({ after_id: 13 });
  });

  it("30초마다 최근 것을 통째로 다시 받아 상대가 지운 것을 반영한다", async () => {
    vi.useFakeTimers();
    그리기();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    처음목록 = [처음목록[0], 처음목록[1], 메(12, true, null, 때(6, 9, 30), { deleted: true })];
    const 통째로 = () => api.getMessages.mock.calls.filter(([, 물음]) => 물음 == null).length;
    // 묻는 때 — 3 · 7.5 · 14.25 · 24.25 · 34.25초. 30초가 지난 첫 묻기(34.25초)에 통째로 받는다
    await act(async () => { await vi.advanceTimersByTimeAsync(34_000); });
    expect(통째로()).toBe(1);
    expect(screen.getByText("내일 봬요")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(통째로()).toBe(2);
    expect(screen.getByText("삭제된 메시지예요")).toBeInTheDocument();
    expect(screen.queryByText("내일 봬요")).toBeNull();
  });

  it("메시지 푸시가 오면 기다리지 않고 바로 묻는다 — 다른 방 것이면 안 묻는다", async () => {
    const sw = Object.assign(new EventTarget(), { getRegistration: async () => undefined });
    (navigator as any).serviceWorker = sw;
    그리기();
    await screen.findByText("안녕하세요");
    const 다음묻기 = () => api.getMessages.mock.calls.filter(([, 물음]) => 물음?.after_id != null).length;
    api.getMessages.mockImplementation(async (_방, 물음 = {}) => (물음.after_id === 12
      ? { items: [메(13, false, "푸시로 온 것", 때(6, 10, 0))], has_more: false, other_read_id: 12 }
      : { items: [], has_more: false, other_read_id: 12 }));
    await act(async () => { sw.dispatchEvent(new MessageEvent("message", { data: { type: "dm", tag: "dm-99" } })); });
    expect(다음묻기()).toBe(0);
    await act(async () => { sw.dispatchEvent(new MessageEvent("message", { data: { type: "dm", tag: "dm-7" } })); });
    expect(await screen.findByText("푸시로 온 것")).toBeInTheDocument();
    expect(다음묻기()).toBe(1);
  });

  it("위로 올려 보던 중에 새 것이 오면 따라 내려가지 않고 '새 메시지' 를 띄운다", async () => {
    const sw = Object.assign(new EventTarget(), { getRegistration: async () => undefined });
    (navigator as any).serviceWorker = sw;
    const { container } = 그리기();
    await screen.findByText("안녕하세요");
    const 본문 = container.querySelector("main")!;
    Object.defineProperty(본문, "scrollHeight", { configurable: true, value: 3000 });
    Object.defineProperty(본문, "clientHeight", { configurable: true, value: 600 });
    본문.scrollTop = 100;
    fireEvent.scroll(본문);
    api.getMessages.mockImplementation(async (_방, 물음 = {}) => (물음.after_id === 12
      ? { items: [메(13, false, "아래에 온 것", 때(6, 10, 0))], has_more: false, other_read_id: 12 }
      : { items: [], has_more: false, other_read_id: 12 }));
    await act(async () => { sw.dispatchEvent(new MessageEvent("message", { data: { type: "dm", tag: "dm-7" } })); });
    await screen.findByText("아래에 온 것");
    const 알림단추 = screen.getByRole("button", { name: "새 메시지" });
    expect(본문.scrollTop).toBe(100);
    await userEvent.click(알림단추);
    expect(screen.queryByRole("button", { name: "새 메시지" })).toBeNull();
  });
});

describe("휴대폰 자판(키보드)", () => {
  /** 아래 여백의 높이 — 'calc(4rem + Npx)'. jsdom 은 calc 안의 차례를 바꿔 적어서 차례 없이 견준다 */
  const 여백높이 = (el: HTMLElement) => {
    const m = /^calc\((.+)\)$/.exec(el.style.height);
    return m ? m[1].split(" + ").sort().join(" + ") : el.style.height;
  };

  /** visualViewport 흉내 — 자판이 올라오면 보이는 높이가 그만큼 준다(아이폰·안드로이드 크롬 모두 이렇게 알린다) */
  function 자판흉내() {
    let 보이는높이 = 664;
    let 위로밀림 = 0;
    const vv = new EventTarget();
    Object.defineProperty(vv, "height", { configurable: true, get: () => 보이는높이 });
    Object.defineProperty(vv, "offsetTop", { configurable: true, get: () => 위로밀림 });
    const 원래vv = (window as any).visualViewport;
    const 원래높이 = window.innerHeight;
    (window as any).visualViewport = vv;
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 664 });
    return {
      올리기: async (높이: number, 밀림 = 0) => {
        await act(async () => { 보이는높이 = 664 - 높이; 위로밀림 = 밀림; vv.dispatchEvent(new Event("resize")); });
      },
      되돌리기: () => {
        (window as any).visualViewport = 원래vv;
        Object.defineProperty(window, "innerHeight", { configurable: true, value: 원래높이 });
      },
    };
  }

  it("자판이 올라오면 아래 여백을 늘리고 그만큼 내려, 보던 아래쪽(마지막 메시지)이 입력칸 위에 그대로 보인다", async () => {
    const 자판 = 자판흉내();
    try {
      const { container } = 그리기();
      await screen.findByText("안녕하세요");
      const 본문 = container.querySelector("main")!;
      const 여백 = container.querySelector("[data-dm-bottom-space]") as HTMLElement;
      const 입력칸자리 = container.querySelector("[data-dm-composer]") as HTMLElement;
      본문.scrollTop = 500;
      expect(여백.style.height).toBe("");

      await 자판.올리기(300);
      expect(입력칸자리.style.bottom).toBe("300px");                  // 입력칸은 자판 위로
      expect(여백높이(여백)).toBe("300px + 4rem");                    // 대화 아래에 자판 자리
      expect(본문.scrollTop).toBe(800);                               // 그만큼 내려 보던 아래쪽이 그대로

      // 자판 위에 추천 단어 줄이 붙어 높아지면 그 차이만큼만 더
      await 자판.올리기(340);
      expect(본문.scrollTop).toBe(840);

      // 내려가면 거꾸로
      await 자판.올리기(0);
      expect(여백.style.height).toBe("");
      expect(입력칸자리.style.bottom).toBe("0px");
      expect(본문.scrollTop).toBe(500);
    } finally {
      자판.되돌리기();
    }
  });

  it("아이폰이 화면을 밀어 올려 일부만 가리면 가린 만큼만", async () => {
    const 자판 = 자판흉내();
    try {
      const { container } = 그리기();
      await screen.findByText("안녕하세요");
      const 본문 = container.querySelector("main")!;
      본문.scrollTop = 500;
      await 자판.올리기(300, 120);                                    // 300 중 120 은 화면을 밀어 올려 피했다
      expect(여백높이(container.querySelector("[data-dm-bottom-space]") as HTMLElement)).toBe("180px + 4rem");
      expect(본문.scrollTop).toBe(680);
    } finally {
      자판.되돌리기();
    }
  });

  it("PC(넓은 화면)는 자판을 안 잰다 — 여백 칸도 없다", async () => {
    window.matchMedia = ((q: string) => ({
      matches: q.includes("min-width"), media: q, onchange: null, addListener() {}, removeListener() {},
      addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
    })) as any;
    const 자판 = 자판흉내();
    try {
      const { container } = 그리기();
      await screen.findByText("안녕하세요");
      const 본문 = container.querySelector("main")!;
      본문.scrollTop = 500;
      await 자판.올리기(300);
      expect(container.querySelector("[data-dm-bottom-space]")).toBeNull();
      expect(본문.scrollTop).toBe(500);
    } finally {
      자판.되돌리기();
    }
  });
});

describe("이전 메시지", () => {
  it("맨 위의 '이전 메시지 보기' — 첫 번호 앞의 것을 받아 위에 붙인다", async () => {
    처음더있음 = true;
    api.getMessages.mockImplementation(async (_방, 물음 = {}) => {
      if (물음.before_id === 10) return { items: [메(8, true, "옛날 얘기", 때(4, 8, 0)), 메(9, false, "그랬지", 때(4, 8, 1))], has_more: false, other_read_id: 11 };
      if (물음.after_id != null) return { items: [], has_more: false, other_read_id: 11 };
      return { items: 처음목록, has_more: 처음더있음, other_read_id: 11 };
    });
    그리기();
    await screen.findByText("안녕하세요");
    await userEvent.click(screen.getByRole("button", { name: "이전 메시지 보기" }));
    expect(await screen.findByText("옛날 얘기")).toBeInTheDocument();
    expect(api.getMessages).toHaveBeenCalledWith(7, { before_id: 10 });
    const 차례 = screen.getAllByRole("button").map((b) => b.textContent).filter((t) => ["옛날 얘기", "그랬지", "안녕하세요"].includes(t ?? ""));
    expect(차례).toEqual(["옛날 얘기", "그랬지", "안녕하세요"]);
    expect(screen.queryByRole("button", { name: "이전 메시지 보기" })).toBeNull();
  });
});

describe("말풍선 할 일", () => {
  it("내 것 — 복사·삭제(확인 뒤 '삭제된 메시지예요'), 신고는 없다", async () => {
    api.deleteMessage.mockResolvedValue(undefined);
    const 적기 = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: 적기 } });
    그리기();
    await screen.findByText("안녕하세요");
    await userEvent.click(말풍선("반가워요"));
    expect(screen.queryByRole("button", { name: "신고" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "복사" }));
    expect(적기).toHaveBeenCalledWith("반가워요");
    await userEvent.click(말풍선("반가워요"));
    await userEvent.click(screen.getByRole("button", { name: "삭제" }));
    expect(api.deleteMessage).not.toHaveBeenCalled();
    await userEvent.click(끝(screen.getAllByRole("button", { name: "삭제" })));
    await waitFor(() => expect(api.deleteMessage).toHaveBeenCalledWith(11));
    expect(await screen.findByText("삭제된 메시지예요")).toBeInTheDocument();
  });

  it("펼친 할 일 줄이 입력칸 뒤에 숨으면 그만큼 내려 보인다", async () => {
    const 원래 = HTMLElement.prototype.getBoundingClientRect;
    const 자리 = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON() {} });
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      if (this.getAttribute("aria-label") === "메시지 할 일") return 자리(680, 700) as DOMRect;
      if (this.hasAttribute("data-dm-composer")) return 자리(600, 664) as DOMRect;
      return 원래.call(this);
    };
    try {
      const { container } = 그리기();
      await screen.findByText("안녕하세요");
      const 본문 = container.querySelector("main")!;
      const 내림 = vi.fn();
      (본문 as any).scrollBy = 내림;
      await userEvent.click(말풍선("내일 봬요"));
      // 줄 아래끝 700 — 입력칸 위끝 600 에서 8 띄운 592 까지 → 108 내린다
      expect(내림).toHaveBeenCalledWith({ top: 108, behavior: "smooth" });
      // 크롬의 스크롤 고정이 펼친 줄을 다시 입력칸 뒤로 밀지 않게 꺼 둔다
      expect(screen.getByRole("log").closest(".min-h-screen")).toHaveClass("[overflow-anchor:none]");
    } finally {
      HTMLElement.prototype.getBoundingClientRect = 원래;
    }
  });

  it("이미 보이는 줄이면 움직이지 않는다 — 닫을 때도", async () => {
    const 원래 = HTMLElement.prototype.getBoundingClientRect;
    const 자리 = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON() {} });
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      if (this.getAttribute("aria-label") === "메시지 할 일") return 자리(560, 592) as DOMRect;   // 입력칸 위 8 에 딱 닿는다
      if (this.hasAttribute("data-dm-composer")) return 자리(600, 664) as DOMRect;
      return 원래.call(this);
    };
    try {
      const { container } = 그리기();
      await screen.findByText("안녕하세요");
      const 내림 = vi.fn();
      (container.querySelector("main") as any).scrollBy = 내림;
      await userEvent.click(말풍선("안녕하세요"));
      expect(screen.getByRole("group", { name: "메시지 할 일" })).toBeInTheDocument();
      await userEvent.click(말풍선("안녕하세요"));
      expect(screen.queryByRole("group", { name: "메시지 할 일" })).toBeNull();
      expect(내림).not.toHaveBeenCalled();
    } finally {
      HTMLElement.prototype.getBoundingClientRect = 원래;
    }
  });

  it("받은 것 — 신고 창(이 메시지를 신고할까요?)에서 사유를 골라 보낸다. 삭제는 없다", async () => {
    api.report.mockResolvedValue({});
    그리기();
    await screen.findByText("안녕하세요");
    await userEvent.click(말풍선("안녕하세요"));
    expect(screen.queryByRole("button", { name: "삭제" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "신고" }));
    expect(screen.getByText("이 메시지를 신고할까요?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "욕설·혐오 표현" }));
    await userEvent.click(끝(screen.getAllByRole("button", { name: "신고" })));
    await waitFor(() => expect(api.report).toHaveBeenCalledWith(10, "욕설·혐오 표현"));
  });

  it("이미 신고한 것이면 그렇다고 말한다", async () => {
    api.report.mockRejectedValue({ response: { status: 409 } });
    그리기();
    await screen.findByText("안녕하세요");
    await userEvent.click(말풍선("안녕하세요"));
    await userEvent.click(screen.getByRole("button", { name: "신고" }));
    await userEvent.click(screen.getByRole("radio", { name: "스팸·광고" }));
    await userEvent.click(끝(screen.getAllByRole("button", { name: "신고" })));
    expect(await screen.findByText("이미 신고한 메시지예요")).toBeInTheDocument();
  });
});

describe("위 ⋯ — 차단·나가기", () => {
  it("차단하기 — 확인하면 막고, 방을 다시 받아 입력칸 대신 '차단 풀기'", async () => {
    api.block.mockResolvedValue({ blocked: true });
    api.unblock.mockResolvedValue({ blocked: false });
    그리기();
    await screen.findByText("안녕하세요");
    await userEvent.click(screen.getByRole("button", { name: "대화방 메뉴" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "차단하기" }));
    expect(screen.getByText("개미왕님을 차단할까요?")).toBeInTheDocument();
    api.getThread.mockResolvedValue({ ...방기본, can_send: false, i_blocked: true });
    await userEvent.click(screen.getByRole("button", { name: "차단" }));
    await waitFor(() => expect(api.block).toHaveBeenCalledWith(5));
    expect(await screen.findByText("차단한 상대예요. 차단을 풀면 다시 메시지를 주고받을 수 있어요.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "메시지 쓰기" })).toBeNull();

    api.getThread.mockResolvedValue(방기본);
    await userEvent.click(screen.getByRole("button", { name: "차단 풀기" }));
    await waitFor(() => expect(api.unblock).toHaveBeenCalledWith(5));
    expect(await screen.findByRole("textbox", { name: "메시지 쓰기" })).toBeInTheDocument();
  });

  it("내가 막은 방은 메뉴에 '차단 풀기'", async () => {
    api.getThread.mockResolvedValue({ ...방기본, can_send: false, i_blocked: true });
    그리기();
    await screen.findByText("안녕하세요");
    await userEvent.click(screen.getByRole("button", { name: "대화방 메뉴" }));
    expect(screen.getByRole("menuitem", { name: "차단 풀기" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "차단하기" })).toBeNull();
  });

  it("나가기 — 확인하면 나가고 목록으로", async () => {
    api.leave.mockResolvedValue(undefined);
    그리기();
    await screen.findByText("안녕하세요");
    await userEvent.click(screen.getByRole("button", { name: "대화방 메뉴" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "대화방 나가기" }));
    expect(screen.getByText("대화방을 나갈까요?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "나가기" }));
    await waitFor(() => expect(api.leave).toHaveBeenCalledWith(7));
    expect(await screen.findByText("메시지 목록 화면")).toBeInTheDocument();
  });

  it("프로필 보기", async () => {
    그리기();
    await screen.findByText("안녕하세요");
    await userEvent.click(screen.getByRole("button", { name: "대화방 메뉴" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "프로필 보기" }));
    expect(screen.getByText("프로필 화면")).toBeInTheDocument();
  });

  it("알림으로 바로 들어왔으면 ← 는 목록으로(앱 밖으로 나가지 않는다)", async () => {
    그리기();
    await screen.findByText("안녕하세요");
    await userEvent.click(screen.getByRole("button", { name: "뒤로" }));
    expect(screen.getByText("메시지 목록 화면")).toBeInTheDocument();
  });
});
