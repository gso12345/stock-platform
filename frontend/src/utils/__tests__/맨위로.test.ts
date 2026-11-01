/** 하단 탭을 다시 누르면 맨 위로 — "실제 앱같이 느껴졌으면" 5번 */
import { describe, it, expect, vi } from "vitest";
import { 맨위로 } from "../맨위로";

describe("맨위로", () => {
  it("부드럽게 맨 위로 굴린다", () => {
    const el = document.createElement("div");
    const scrollTo = vi.fn();
    (el as any).scrollTo = scrollTo;
    맨위로(el);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });

  it("굴릴 수 없는 옛 브라우저는 바로 맨 위로", () => {
    const el = document.createElement("div");
    (el as any).scrollTo = undefined;
    let y = 300;
    Object.defineProperty(el, "scrollTop", { configurable: true, get: () => y, set: (v: number) => { y = v; } });
    맨위로(el);
    expect(y).toBe(0);
  });

  it("본문이 아직 없으면 아무 일 없다", () => {
    expect(() => 맨위로(null)).not.toThrow();
    expect(() => 맨위로(undefined)).not.toThrow();
  });
});
