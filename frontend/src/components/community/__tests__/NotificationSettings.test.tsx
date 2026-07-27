/**
 * 알림 설정 스위치.
 *
 * 누른 즉시 화면을 바꾸고(낙관적 갱신) 서버에 저장한다. 응답을 기다리며 멈춰
 * 있으면 사용자가 두 번 누르게 되기 때문이다. 대신 저장이 실패했는데 켜진 채로
 * 두면, 오지도 않을 알림을 계속 기다리게 되므로 반드시 되돌려야 한다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NotificationToggles } from "@/components/community/NotificationSettings";
import { NOTIFICATION_KINDS, KIND_META } from "@/constants/notifications";
import { communityApi } from "@/api/stocks";

vi.mock("@/api/stocks", () => ({
  communityApi: {
    getNotificationSettings: vi.fn(),
    updateNotificationSettings: vi.fn(),
  },
}));

const 전부켜짐 = Object.fromEntries(NOTIFICATION_KINDS.map((k) => [k, true]));

function 그리기() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NotificationToggles />
    </QueryClientProvider>
  );
}

const 스위치 = (kind: keyof typeof KIND_META) =>
  screen.getByRole("switch", { name: `${KIND_META[kind].label} 알림` });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(communityApi.getNotificationSettings).mockResolvedValue({ ...전부켜짐 });
  vi.mocked(communityApi.updateNotificationSettings).mockImplementation(async (p) => p);
});

describe("알림 설정", () => {
  it("서버에 있는 다섯 가지를 모두 보여준다", async () => {
    그리기();
    await waitFor(() => expect(screen.getAllByRole("switch")).toHaveLength(NOTIFICATION_KINDS.length));
    for (const k of NOTIFICATION_KINDS) {
      expect(스위치(k)).toHaveAttribute("aria-checked", "true");
    }
  });

  it("서버가 꺼둔 항목은 꺼진 채로 보인다", async () => {
    vi.mocked(communityApi.getNotificationSettings)
      .mockResolvedValue({ ...전부켜짐, post_like: false });
    그리기();
    await waitFor(() => expect(스위치("post_like")).toHaveAttribute("aria-checked", "false"));
    expect(스위치("comment")).toHaveAttribute("aria-checked", "true");
  });

  it("끄면 그 항목만 false로 저장한다", async () => {
    그리기();
    await waitFor(() => expect(스위치("post_like")).toBeInTheDocument());
    await userEvent.click(스위치("post_like"));
    await waitFor(() =>
      expect(communityApi.updateNotificationSettings)
        .toHaveBeenCalledWith({ ...전부켜짐, post_like: false })
    );
  });

  it("누르는 즉시 화면이 바뀐다 — 응답을 기다리지 않는다", async () => {
    let 응답풀기: (v: unknown) => void = () => {};
    vi.mocked(communityApi.updateNotificationSettings)
      .mockImplementation(() => new Promise((res) => { 응답풀기 = res; }));
    그리기();
    await waitFor(() => expect(스위치("follow")).toBeInTheDocument());
    await userEvent.click(스위치("follow"));
    // 서버가 아직 대답하지 않았는데도 꺼져 있어야 한다
    await waitFor(() => expect(스위치("follow")).toHaveAttribute("aria-checked", "false"));
    응답풀기({ ...전부켜짐, follow: false });
  });

  it("저장에 실패하면 원래대로 되돌린다", async () => {
    vi.mocked(communityApi.updateNotificationSettings).mockRejectedValue(new Error("서버 오류"));
    그리기();
    await waitFor(() => expect(스위치("comment")).toBeInTheDocument());
    await userEvent.click(스위치("comment"));
    // 껐다가 실패했으면 다시 켜져 있어야 한다.
    // 안 그러면 끈 줄 알고 기다리는데 알림은 계속 온다(또는 그 반대)
    await waitFor(() => expect(스위치("comment")).toHaveAttribute("aria-checked", "true"));
    expect(await screen.findByText(/저장하지 못했습니다/)).toBeInTheDocument();
  });

  it("설정을 못 불러오면 스위치를 아예 내주지 않는다", async () => {
    // 지금 설정을 모르는 채로 스위치를 누르면, 화면에 보이던 기본값(전부 켜짐)이
    // 그대로 저장돼 사용자가 꺼둔 항목이 되살아난다
    vi.mocked(communityApi.getNotificationSettings).mockRejectedValue(new Error("끊김"));
    그리기();
    expect(await screen.findByText(/불러오지 못했습니다/)).toBeInTheDocument();
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
    expect(communityApi.updateNotificationSettings).not.toHaveBeenCalled();
  });

  it("불러오는 중에는 스위치를 누를 수 없다", async () => {
    vi.mocked(communityApi.getNotificationSettings)
      .mockImplementation(() => new Promise(() => {}));   // 영원히 응답 없음
    그리기();
    const sw = await screen.findAllByRole("switch");
    expect(sw[0]).toBeDisabled();
    await userEvent.click(sw[0]).catch(() => {});
    expect(communityApi.updateNotificationSettings).not.toHaveBeenCalled();
  });

  it("각 항목에 무엇에 대한 알림인지 설명이 붙어 있다", async () => {
    그리기();
    await waitFor(() => expect(스위치("reply")).toBeInTheDocument());
    for (const k of NOTIFICATION_KINDS) {
      expect(screen.getByText(KIND_META[k].label)).toBeInTheDocument();
      expect(screen.getByText(KIND_META[k].desc)).toBeInTheDocument();
    }
  });
});
