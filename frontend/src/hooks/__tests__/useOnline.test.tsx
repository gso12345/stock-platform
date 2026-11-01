/**
 * 인터넷이 이어져 있나 — "실제 앱같이 느껴졌으면" 6번. 끊기면 앱 틀이 '오프라인' 띠를 보인다(그 띠는
 * components/__tests__/앱틀_앱같이 가 본다).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { use인터넷 } from "../useOnline";

afterEach(() => vi.restoreAllMocks());

describe("use인터넷", () => {
  it("처음에는 브라우저가 아는 대로", () => {
    expect(renderHook(() => use인터넷()).result.current).toBe(true);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    expect(renderHook(() => use인터넷()).result.current).toBe(false);
  });

  it("끊기고 이어지는 대로 따라간다", () => {
    const { result } = renderHook(() => use인터넷());
    act(() => { window.dispatchEvent(new Event("offline")); });
    expect(result.current).toBe(false);
    act(() => { window.dispatchEvent(new Event("online")); });
    expect(result.current).toBe(true);
  });

  it("치우면 그만 듣는다 — 들을 때 단 것을 그대로 뗀다", () => {
    const 달기 = vi.spyOn(window, "addEventListener");
    const 떼기 = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => use인터넷());
    unmount();
    for (const 종류 of ["online", "offline"]) {
      const 단것 = 달기.mock.calls.find((c) => c[0] === 종류)?.[1];
      expect(단것, 종류).toBeTypeOf("function");
      expect(떼기.mock.calls.some((c) => c[0] === 종류 && c[1] === 단것), 종류).toBe(true);
    }
  });
});
