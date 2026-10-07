/**
 * 설치형 앱의 시작 화면 — 앱이 준비되면 곧바로 걷는다.
 *
 * 예전에는 무조건 0.7초(보이기 0.5 + 걷기 0.2)를 덮고 있었다. 그 아래 앱은
 * 이미 다 그려져 있었는데도.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";

async function 불러오기() {
  vi.resetModules();
  return await import("../SplashScreen");
}

function 덮개() {
  return document.querySelector(".fixed.inset-0") as HTMLElement | null;
}

beforeEach(() => {
  vi.useFakeTimers();
  window.matchMedia = ((q: string) => ({ matches: q.includes("standalone") })) as any;
});
afterEach(() => vi.useRealTimers());

describe("설치형 앱 시작 화면", () => {
  it("앱 틀이 그려지면 곧바로 걷기 시작한다", async () => {
    const { default: SplashScreen, 앱준비됨 } = await 불러오기();
    render(<SplashScreen />);
    expect(덮개()!.style.opacity).toBe("1");
    act(() => 앱준비됨());
    expect(덮개()!.style.opacity).toBe("0");
    expect(덮개()!.style.pointerEvents).toBe("none");        // 걷는 동안 손을 막지 않는다
    act(() => { vi.advanceTimersByTime(200); });
    expect(덮개()).toBeNull();
  });

  it("이미 준비된 뒤에 떴으면 기다리지 않는다", async () => {
    const { default: SplashScreen, 앱준비됨 } = await 불러오기();
    앱준비됨();
    render(<SplashScreen />);
    act(() => { vi.advanceTimersByTime(0); });
    expect(덮개()?.style.opacity ?? "0").toBe("0");
  });

  it("아무 신호가 없어도 오래 붙잡지 않는다", async () => {
    const { default: SplashScreen } = await 불러오기();
    render(<SplashScreen />);
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(덮개()!.style.opacity).toBe("1");
    act(() => { vi.advanceTimersByTime(700); });
    expect(덮개()).toBeNull();
  });

  it("브라우저(설치 안 함)에서는 아예 안 뜬다", async () => {
    window.matchMedia = (() => ({ matches: false })) as any;
    const { default: SplashScreen } = await 불러오기();
    render(<SplashScreen />);
    expect(덮개()).toBeNull();
  });
});

describe("Layout 이 신호를 보낸다", () => {
  it("앱 틀이 그려질 때 앱준비됨 을 부른다", async () => {
    const 원문 = (await import("../Layout.tsx?raw")).default as string;
    expect(원문).toMatch(/useEffect\(\(\) => \{ 앱준비됨\(\); \}, \[\]\);/);
  });
});
