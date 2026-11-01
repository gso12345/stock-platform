/**
 * 설치형 앱의 시작 화면 — 앱이 준비되면 곧바로 걷는다.
 *
 * 예전에는 무조건 0.7초(보이기 0.5 + 걷기 0.2)를 덮고 있었다. 그 아래 앱은
 * 이미 다 그려져 있었는데도.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { readFileSync } from "fs";
import { resolve } from "path";

async function 불러오기() {
  vi.resetModules();
  return await import("../layout/SplashScreen");
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

describe("아이폰 — 운영체제가 띄운 시작 그림을 이어받는다", () => {
  /* 아이폰은 앱을 누르면 시작 그림(public/splash — 이 화면이 다 움직인 뒤의 모습)을 먼저 띄운다. 이어받는
     이 화면이 처음부터 다시 움직이면 로고·글자가 사라졌다 나타난다 */
  afterEach(() => { delete (navigator as any).standalone; });

  it("아이폰 홈 화면 앱이면 움직임 없이 끝 모습으로 뜬다", async () => {
    Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
    const { default: SplashScreen } = await 불러오기();
    render(<SplashScreen />);
    expect(덮개()!.classList.contains("splash-still")).toBe(true);
  });

  it("안드로이드·PC 설치 앱은 예전처럼 움직이며 뜬다", async () => {
    const { default: SplashScreen } = await 불러오기();
    render(<SplashScreen />);
    expect(덮개()!.classList.contains("splash-still")).toBe(false);
    Object.defineProperty(navigator, "standalone", { value: false, configurable: true });
    const 다시 = await 불러오기();
    render(<다시.default />);
    expect(document.querySelectorAll(".splash-still").length).toBe(0);
  });

  it("끝 모습 — 빛은 쉬는 밝기, 로고·글자·막대·점은 멈추고 빛 위에. 불러오는 점은 계속 돈다", () => {
    const css = readFileSync(resolve(__dirname, "../../index.css"), "utf-8");
    expect(css).toMatch(/\.splash-still \.splash-glow \{ animation: none; opacity: 0\.45; \}/);
    expect(css).toMatch(/\.splash-still :is\(\.splash-logo, \.splash-bar, \.splash-dot, \.splash-text\) \{ animation: none; \}/);
    expect(css).toMatch(/\.splash-still :is\(\.splash-logo, \.splash-text\) \{ position: relative; \}/);
    expect(css).not.toMatch(/\.splash-still[^{]*splash-loading-dot/);
  });

  it("빛은 움직이는 동안에도 가운데에 있다 — 움직임이 자리 잡기(translate)를 덮어쓰지 않는다", () => {
    const css = readFileSync(resolve(__dirname, "../../index.css"), "utf-8");
    const 움직임 = css.slice(css.indexOf("@keyframes splashGlowPulse"), css.indexOf(".splash-logo {"));
    const 모양들 = [...움직임.matchAll(/transform: ([^;]+);/g)].map((m) => m[1]);
    expect(모양들.length).toBe(2);
    for (const 모양 of 모양들) expect(모양.startsWith("translate(-50%, -50%) ")).toBe(true);
  });
});

describe("Layout 이 신호를 보낸다", () => {
  it("앱 틀이 그려질 때 앱준비됨 을 부른다", async () => {
    const 원문 = (await import("../layout/Layout.tsx?raw")).default as string;
    expect(원문).toMatch(/useEffect\(\(\) => \{ 앱준비됨\(\); \}, \[\]\);/);
  });
});
