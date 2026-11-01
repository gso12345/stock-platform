/**
 * 설정 창의 '화면 방향' — 눌러서 실제로 고정되는지, 안 되는 기기에서는 왜 안 되는지 말하는지.
 *
 * 예전에는 어디서든 눌리기만 하고 아무 말이 없었다(사용자: "가로고정 세로고정이 안되고있어").
 * 고정 자체의 갈래(전체 화면·누른 손·풀림)는 utils/__tests__/화면방향 이 본다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SettingsModal from "../account/SettingsModal";
import { useSettingsStore } from "@/store/settingsStore";
import { _처음으로 } from "@/utils/화면방향";

const 안드로이드 = "Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const 아이폰 = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

let 전체화면: Element | null = null;
/** 안드로이드 크롬처럼 — 전체 화면이어야 고정을 받아 준다 */
const 크롬처럼 = async (_o: string) => {
  if (!전체화면) throw new DOMException("전체 화면이어야 해요", "SecurityError");
};
const lock = vi.fn(크롬처럼);
const requestFullscreen = vi.fn(async () => { 전체화면 = document.documentElement; });

function 그리기() {
  return render(
    <QueryClientProvider client={new QueryClient()}><MemoryRouter>
      <SettingsModal onClose={() => {}} />
    </MemoryRouter></QueryClientProvider>,
  );
}
const 단추 = (이름: string) => screen.getByRole("button", { name: 이름 });
const 안내 = () => screen.getAllByRole("status").find((el) => /화면 방향|고정|자동 회전/.test(el.textContent ?? ""))!;

beforeEach(() => {
  _처음으로();
  localStorage.clear();
  useSettingsStore.getState().setOrientation("system");
  전체화면 = null;
  lock.mockReset();
  lock.mockImplementation(크롬처럼);
  requestFullscreen.mockClear();
  // (여기의 screen 은 testing-library 것이라 기기 화면은 window.screen 으로 부른다)
  Object.defineProperty(window.screen, "orientation", { value: { lock, unlock: vi.fn(), type: "portrait-primary", angle: 0 }, configurable: true });
  Object.defineProperty(document, "fullscreenEnabled", { value: true, configurable: true });
  Object.defineProperty(document, "fullscreenElement", { get: () => 전체화면, configurable: true });
  document.documentElement.requestFullscreen = requestFullscreen as unknown as Element["requestFullscreen"];
  document.exitFullscreen = vi.fn(async () => { 전체화면 = null; }) as unknown as Document["exitFullscreen"];
  // 사람이 누른 그 순간이다 — 전체 화면에 들어갈 수 있다
  Object.defineProperty(navigator, "userActivation", { get: () => ({ isActive: true }), configurable: true });
});
afterEach(() => vi.restoreAllMocks());

describe("안드로이드", () => {
  beforeEach(() => { vi.spyOn(navigator, "userAgent", "get").mockReturnValue(안드로이드); });

  it("세로를 누르면 전체 화면에 들어가 고정하고, 그렇다고 말한다", async () => {
    그리기();
    expect(안내()).toHaveTextContent(/휴대폰의 자동 회전 설정을 따라요/);
    expect(단추("시스템설정")).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(단추("세로"));
    expect(useSettingsStore.getState().orientation).toBe("portrait");
    expect(단추("세로")).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(안내()).toHaveTextContent(/^세로로 고정했어요\. 뒤로 가기로 전체 화면이 풀리면/));
    expect(requestFullscreen).toHaveBeenCalledWith({ navigationUI: "hide" });
    expect(lock).toHaveBeenLastCalledWith("portrait");
    expect(JSON.parse(localStorage.getItem("portfolio_settings")!).orientation).toBe("portrait");
  });

  it("거절당해도 같은 것을 다시 누르면 다시 건다", async () => {
    lock.mockRejectedValue(new DOMException("안 돼요", "NotSupportedError"));
    그리기();
    await userEvent.click(단추("가로"));
    await waitFor(() => expect(안내()).toHaveTextContent(/받아 주지 않았어요/));
    const 앞 = lock.mock.calls.length;
    lock.mockReset();
    lock.mockResolvedValue(undefined);
    await userEvent.click(단추("가로"));
    // 이번에는 전체 화면 없이 걸렸다 — 전체 화면 이야기를 붙이지 않는다
    await waitFor(() => expect(안내()).toHaveTextContent(/^가로로 고정했어요\.$/));
    expect(앞).toBeGreaterThan(0);
    expect(lock).toHaveBeenCalledWith("landscape");
  });
});

describe("아이폰", () => {
  beforeEach(() => { vi.spyOn(navigator, "userAgent", "get").mockReturnValue(아이폰); });

  it("가로·세로는 누를 수 없고, 왜 안 되는지와 제어 센터를 말한다 — 골라 둔 값이 있어도 시스템설정으로 보인다", async () => {
    useSettingsStore.getState().setOrientation("portrait");
    그리기();
    expect(단추("가로")).toBeDisabled();
    expect(단추("세로")).toBeDisabled();
    expect(단추("시스템설정")).toBeEnabled();
    expect(단추("시스템설정")).toHaveAttribute("aria-pressed", "true");
    expect(단추("세로")).toHaveAttribute("aria-pressed", "false");
    expect(안내()).toHaveTextContent(/아이폰·아이패드는 앱이 화면 방향을 고정할 수 없어요/);
    expect(안내()).toHaveTextContent(/제어 센터의 '화면 방향 잠금'/);
    await userEvent.click(단추("세로"));
    expect(lock).not.toHaveBeenCalled();
    expect(requestFullscreen).not.toHaveBeenCalled();
  });
});
