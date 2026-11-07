/**
 * 메시지로 가는 입구 — 머리의 아이콘(안 읽은 수), 더보기의 줄, 대화방에서는 아래 탭을 숨긴다.
 *
 * 앱 틀(Layout)을 실제로 그린다(로그인전메뉴.test.tsx 와 같은 방식).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";

vi.mock("@/components/layout/SearchBar", () => ({ default: () => null }));
vi.mock("@/components/layout/LoadingProgressOverlay", () => ({ default: () => null }));
vi.mock("@/components/layout/InstallAppButton", () => ({ default: () => null }));
vi.mock("@/components/account/SettingsModal", () => ({ default: () => null }));
vi.mock("@/api/client", async (원본) => ({
  ...(await 원본<any>()),
  default: { get: vi.fn((주소: string) => Promise.resolve({ data: 주소.includes("popups") ? [] : null })) },
}));
vi.mock("@/routes/pages", () => ({ 화면미리받기: () => {} }));
vi.mock("@/utils/한가할때", () => ({ 한가할때: () => () => {}, 아껴쓰는중: () => true }));
vi.mock("@/api/dm", async (원본) => {
  const 실제 = await 원본<typeof import("@/api/dm")>();
  return { ...실제, dmApi: { ...실제.dmApi, unreadCount: vi.fn() } };
});

import Layout from "../layout/Layout";
import More from "@/pages/More";
import 메시지아이콘, { 배지글 } from "@/components/dm/메시지아이콘";
import { 대화방인가, 더보기_경로 } from "@/constants/moreNav";
import { dmApi } from "@/api/dm";
import { useAuthStore } from "@/store/authStore";

const api = vi.mocked(dmApi);

function 틀그리기(주소: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[주소]}>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<div>대시보드</div>} />
            <Route path="messages" element={<div>메시지 목록</div>} />
            <Route path="messages/:threadId" element={<div>대화방</div>} />
            <Route path="more" element={<More />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const 아래탭 = () => screen.queryByRole("link", { name: "더보기" });

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ token: "t", userId: 7, username: "gso", isLoggedIn: true, isAdmin: false });
  api.unreadCount.mockResolvedValue({ count: 0, capped: false });
});

describe("머리의 메시지 아이콘", () => {
  it("안 읽은 수를 배지로 — 99 를 넘으면 99+", async () => {
    api.unreadCount.mockResolvedValue({ count: 4, capped: false });
    틀그리기("/");
    const 아이콘 = await screen.findByRole("link", { name: "메시지, 안 읽은 메시지 4개" });
    expect(아이콘).toHaveAttribute("href", "/messages");
    expect(아이콘).toHaveTextContent("4");
    expect(배지글({ count: 99, capped: true })).toBe("99+");
    expect(배지글({ count: 0, capped: false })).toBeNull();
    expect(배지글(undefined)).toBeNull();
  });

  it("안 읽은 것이 없으면 배지 없이", async () => {
    틀그리기("/");
    await waitFor(() => expect(api.unreadCount).toHaveBeenCalled());
    expect(screen.getByRole("link", { name: "메시지" })).toHaveTextContent("");
  });

  it("로그인 전에도 보인다 — 묻지는 않는다", () => {
    useAuthStore.setState({ token: null, userId: null, username: null, isLoggedIn: false, isAdmin: false });
    틀그리기("/");
    expect(screen.getByRole("link", { name: "메시지" })).toHaveAttribute("href", "/messages");
    expect(api.unreadCount).not.toHaveBeenCalled();
  });

  it("메시지 푸시가 오면 바로 다시 묻는다", async () => {
    const sw = Object.assign(new EventTarget(), {});
    (navigator as any).serviceWorker = sw;
    try {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={qc}>
          <MemoryRouter><메시지아이콘 /></MemoryRouter>
        </QueryClientProvider>,
      );
      await waitFor(() => expect(api.unreadCount).toHaveBeenCalledTimes(1));
      api.unreadCount.mockResolvedValue({ count: 1, capped: false });
      await act(async () => { sw.dispatchEvent(new MessageEvent("message", { data: { type: "dm", tag: "dm-3" } })); });
      expect(await screen.findByRole("link", { name: "메시지, 안 읽은 메시지 1개" })).toBeInTheDocument();
      // 메시지가 아닌 것은 듣지 않는다
      const 전 = api.unreadCount.mock.calls.length;
      await act(async () => { sw.dispatchEvent(new MessageEvent("message", { data: { type: "other" } })); });
      expect(api.unreadCount.mock.calls.length).toBe(전);
    } finally {
      delete (navigator as any).serviceWorker;
    }
  });
});

describe("대화방에서는 아래 탭을 숨긴다 — 그 자리에 입력칸", () => {
  it.each([
    ["/messages/12", true], ["/messages/12/", true], ["/messages", false], ["/messages/", false],
    ["/messagesx/1", false], ["/messages/1/x", false], ["/feed/write", false],
  ])("%s → %s", (주소, 기대) => {
    expect(대화방인가(주소)).toBe(기대);
  });

  it("목록에서는 아래 탭이 있고 '더보기' 에 불이 켜진다", async () => {
    틀그리기("/messages");
    expect(아래탭()).toBeInTheDocument();
    expect(더보기_경로).toContain("/messages");
  });

  it("대화방에서는 아래 탭이 없다", () => {
    틀그리기("/messages/12");
    expect(screen.getByText("대화방")).toBeInTheDocument();
    expect(아래탭()).toBeNull();
  });
});

describe("더보기의 '메시지' 줄", () => {
  it("안 읽은 수와 함께 목록으로 잇는다", async () => {
    api.unreadCount.mockResolvedValue({ count: 2, capped: false });
    틀그리기("/more");
    const 줄 = (await screen.findAllByRole("link", { name: /메시지/ })).find((a) => a.textContent?.includes("1:1 대화"))!;
    expect(줄).toHaveAttribute("href", "/messages");
    await waitFor(() => expect(줄).toHaveTextContent("2"));
  });
});
