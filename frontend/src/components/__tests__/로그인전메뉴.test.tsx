/**
 * 로그인 전에도 메뉴를 모두 — 사용자: "로그인 안한상태에서도 메뉴를 모두 나오도록 해줘"
 *
 * 예전에는 로그인 전에 PC 옆 메뉴의 '내 프로필', 머리의 종(알림)이 아예 없었다. PC 는 종이 알림으로
 * 가는 유일한 입구라, 로그인 전에는 이 앱에 알림이 있는지조차 알 수 없었다. 누르면 그 화면이 로그인하라고
 * 말한다 — 곧바로 로그인 화면으로 튕기면 왜 갔는지 모른다.
 *
 * 앱 틀은 고른 증권사(공모주 메뉴·알림 설정)를 휴대폰 알림 구독에 맞추는 일도 한 곳에서 한다 — 그것도 본다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, act, waitFor } from "@testing-library/react";
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
vi.mock("@/api/stocks", async (원본) => {
  const 실제 = await 원본<any>();
  return { ...실제, pushApi: { ...실제.pushApi, subscribe: vi.fn(() => Promise.resolve({ ok: true })) } };
});

import Layout from "../layout/Layout";
import MyPage from "@/pages/MyPage";
import Notifications from "@/pages/Notifications";
import { useAuthStore } from "@/store/authStore";
import { useSettingsStore } from "@/store/settingsStore";
import { pushApi } from "@/api/stocks";

function 그리기(주소 = "/", 화면 = <div>내용</div>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[주소]}>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={화면} />
            <Route path="mypage" element={<MyPage />} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="login" element={<div>로그인 화면</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAuthStore.setState({ token: null, userId: null, username: null, isLoggedIn: false, isAdmin: false });
  useSettingsStore.getState().set내증권사([]);
});

describe("로그인 전 — 메뉴를 숨기지 않는다", () => {
  it("PC 옆 메뉴에 '내 프로필', 머리에 알림 종이 있다", () => {
    그리기();
    const 옆메뉴 = screen.getByRole("complementary");
    expect(within(옆메뉴).getByRole("link", { name: /내 프로필/ })).toHaveAttribute("href", "/mypage");
    expect(screen.getByRole("link", { name: "알림" })).toHaveAttribute("href", "/notifications");
    expect(screen.getByRole("link", { name: /로그인/ })).toHaveAttribute("href", "/login");
  });

  it("'내 프로필' 을 누르면 로그인 화면으로 튕기지 않고 그 자리에서 로그인하라고 말한다", () => {
    그리기("/mypage");
    expect(screen.getByText("내 프로필을 보려면 로그인이 필요합니다")).toBeInTheDocument();
    expect(screen.queryByText("로그인 화면")).toBeNull();
    const 단추들 = screen.getAllByRole("link", { name: /로그인/ });
    expect(단추들.every((a) => a.getAttribute("href") === "/login")).toBe(true);
  });

  it("알림 화면도 같은 모양으로 말한다", () => {
    그리기("/notifications");
    expect(screen.getByText("알림을 보려면 로그인이 필요합니다")).toBeInTheDocument();
  });

  it("로그인했으면 종은 펼치는 단추(목록) — 알림 화면으로 바로 가는 링크가 아니다", () => {
    useAuthStore.setState({ token: "t", userId: 7, username: "gso", isLoggedIn: true, isAdmin: false });
    그리기();
    expect(screen.queryByRole("link", { name: "알림" })).toBeNull();
    expect(screen.getByRole("button", { name: /^알림/ })).toHaveAttribute("aria-haspopup", "menu");
  });
});

describe("앱 틀 — 고른 증권사를 휴대폰 알림 구독에", () => {
  let 구독: unknown;
  beforeEach(() => {
    구독 = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/abc" }) };
    (window as any).PushManager = function () {};
    (window as any).Notification = { permission: "granted" };
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { ready: Promise.resolve({ pushManager: { getSubscription: () => Promise.resolve(구독) } }) },
    });
    vi.mocked(pushApi.subscribe).mockClear();
  });
  afterEach(() => {
    delete (window as any).PushManager;
    delete (window as any).Notification;
    delete (navigator as any).serviceWorker;
  });

  it("어느 화면에 있든 증권사를 바꾸면 켜 둔 기기의 구독에 알린다 — 처음 열 때는 안 부른다", async () => {
    그리기();
    await new Promise((r) => setTimeout(r, 50));
    expect(pushApi.subscribe).not.toHaveBeenCalled();
    act(() => useSettingsStore.getState().set내증권사(["KB증권"]));
    await waitFor(() => expect(pushApi.subscribe).toHaveBeenCalledWith(
      expect.anything(), expect.objectContaining({ brokers: ["KB증권"] })), { timeout: 3000 });
  });
});
