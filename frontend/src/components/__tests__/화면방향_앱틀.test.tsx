/**
 * 앱 틀(Layout)이 화면 방향 고정을 잇는가 — 설정을 따르고, 앱을 막 열었으면 처음 누를 때 건다.
 *
 * 고정의 갈래 자체는 utils/__tests__/화면방향 이 본다. 여기서는 앱 틀이 그것을 실제로
 * 부르는지(설정이 바뀔 때, 화면을 누를 때)와, 틀이 치워지면 더는 지켜보지 않는지를 본다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";

vi.mock("@/components/layout/SearchBar", () => ({ default: () => null }));
vi.mock("@/components/layout/LoadingProgressOverlay", () => ({ default: () => null }));
vi.mock("@/components/community/NotificationBell", () => ({ default: () => null }));
vi.mock("@/components/layout/InstallAppButton", () => ({ default: () => null }));
vi.mock("@/components/account/SettingsModal", () => ({ default: () => null }));
vi.mock("@/api/client", async (원본) => ({
  ...(await 원본<any>()),
  default: { get: vi.fn((주소: string) => Promise.resolve({ data: 주소.includes("popups") ? [] : null })) },
}));
vi.mock("@/routes/pages", () => ({ 화면미리받기: () => {} }));
vi.mock("@/utils/한가할때", () => ({ 한가할때: () => () => {}, 아껴쓰는중: () => true }));

import Layout from "../layout/Layout";
import { useSettingsStore } from "@/store/settingsStore";
import { use고정상태, _처음으로 } from "@/utils/화면방향";

const 안드로이드 = "Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";

let 전체화면: Element | null = null;
let 손 = { isActive: false };
const lock = vi.fn(async (_o: string) => {
  if (!전체화면) throw new DOMException("전체 화면이어야 해요", "SecurityError");
});
const unlock = vi.fn();
const requestFullscreen = vi.fn(async () => { 전체화면 = document.documentElement; });
const exitFullscreen = vi.fn(async () => {
  전체화면 = null;
  document.dispatchEvent(new Event("fullscreenchange"));
});
const 상태 = () => use고정상태.getState().상태;

function 그리기() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<div>내용</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  _처음으로();
  localStorage.clear();
  전체화면 = null;
  손 = { isActive: false };
  for (const f of [lock, unlock, requestFullscreen, exitFullscreen]) f.mockClear();
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(안드로이드);
  Object.defineProperty(navigator, "userActivation", { get: () => 손, configurable: true });
  Object.defineProperty(window.screen, "orientation", { value: { lock, unlock, type: "portrait-primary", angle: 0 }, configurable: true });
  Object.defineProperty(document, "fullscreenEnabled", { value: true, configurable: true });
  Object.defineProperty(document, "fullscreenElement", { get: () => 전체화면, configurable: true });
  document.documentElement.requestFullscreen = requestFullscreen as unknown as Element["requestFullscreen"];
  document.exitFullscreen = exitFullscreen as unknown as Document["exitFullscreen"];
});
afterEach(() => {
  useSettingsStore.getState().setOrientation("system");
  vi.restoreAllMocks();
});

describe("앱 틀 — 화면 방향", () => {
  it("세로로 골라 둔 채 앱을 열면 기다렸다가, 처음 누를 때 전체 화면으로 들어가 세로로 고정한다", async () => {
    useSettingsStore.getState().setOrientation("portrait");
    그리기();
    await waitFor(() => expect(상태()).toBe("누르면"));
    expect(requestFullscreen).not.toHaveBeenCalled();
    손 = { isActive: true };
    fireEvent.pointerUp(document.body);
    await waitFor(() => expect(상태()).toBe("고정됨"));
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(lock).toHaveBeenLastCalledWith("portrait");
  });

  it("설정이 바뀌면 따라간다 — 시스템설정으로 돌리면 풀고 전체 화면에서 나온다", async () => {
    useSettingsStore.getState().setOrientation("landscape");
    손 = { isActive: true };
    그리기();
    await waitFor(() => expect(상태()).toBe("고정됨"));
    expect(lock).toHaveBeenLastCalledWith("landscape");
    act(() => useSettingsStore.getState().setOrientation("system"));
    await waitFor(() => expect(상태()).toBe("따름"));
    expect(unlock).toHaveBeenCalled();
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
  });

  it("앱 틀이 치워지면 누르기를 더는 지켜보지 않는다", async () => {
    useSettingsStore.getState().setOrientation("portrait");
    const { unmount } = 그리기();
    await waitFor(() => expect(상태()).toBe("누르면"));
    unmount();
    손 = { isActive: true };
    fireEvent.pointerUp(document.body);
    await new Promise((r) => setTimeout(r, 0));
    expect(requestFullscreen).not.toHaveBeenCalled();
  });
});
