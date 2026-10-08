/**
 * 카드 줄을 줄마다 고르게 나누는가.
 *
 * PC 대시보드에서 환율·금리 카드 10장이 9장 + 1장으로, 해외 탭 8장이
 * 6장 + 2장으로 감싸졌다. 끝줄에 한두 장만 덩그러니 남는다.
 * 줄 수는 그대로 두고 그 줄 수로 카드를 고르게 나눠야 한다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, act } from "@testing-library/react";
import { 고른열수, use고른열 } from "../useBalancedColumns";

describe("고른열수", () => {
  it.each([
    // [이 폭에 들어가는 장 수, 카드 수, 열]
    [9, 10, 5],    // 9 + 1 이 아니라 5 + 5
    [6, 8, 4],     // 6 + 2 가 아니라 4 + 4
    [9, 11, 6],    // 6 + 5
    [4, 9, 3],     // 세 줄 — 4 + 4 + 1 이 아니라 3 + 3 + 3
    [10, 10, 10],  // 다 들어가면 한 줄
    [6, 4, 4],     // 자리가 남으면 있는 만큼만
    [1, 3, 1],
  ])("%i장 들어가는 폭에 %i장 → %i열", (최대열, 개수, 열) => {
    expect(고른열수(최대열, 개수)).toBe(열);
  });

  it("폭이나 카드 수를 모르면 0 — CSS 에 적힌 기본값을 쓰라는 뜻", () => {
    expect(고른열수(0, 10)).toBe(0);
    expect(고른열수(5, 0)).toBe(0);
  });

  it("어떤 폭·장 수에서도: 넘치지 않고, 줄 수는 그대로, 끝줄은 줄 수보다 적게 모자란다", () => {
    for (let 최대 = 1; 최대 <= 12; 최대++) {
      for (let n = 1; n <= 40; n++) {
        const 열 = 고른열수(최대, n);
        const 줄 = Math.ceil(n / 최대);
        const 끝줄 = n - 열 * (줄 - 1);
        expect(열).toBeLessThanOrEqual(최대);     // 한 줄에 못 들어가는 수를 주지 않는다
        expect(Math.ceil(n / 열)).toBe(줄);       // 줄이 늘지 않는다 — 화면이 길어지지 않는다
        expect(끝줄).toBeGreaterThan(0);
        expect(열 - 끝줄).toBeLessThan(줄);       // 두 줄이면 끝줄은 많아야 한 장 모자란다
      }
    }
  });
});

/* ── 훅: 실제로 재고, 세고, 다시 재는가 ── */

let 안쪽폭 = 0;                    // 여백을 뺀 칸 폭
const 여백 = 8;                    // 시험 칸의 좌우 안쪽 여백
let 알림들: Array<() => void> = [];
let 그린횟수 = 0;

function 시험칸({ 개수, 최소폭 = 140 }: { 개수: number; 최소폭?: number }) {
  const 칸 = use고른열(최소폭);
  그린횟수++;
  return (
    <div data-testid="칸" ref={칸.ref} style={{ ...칸.style, padding: `${여백}px` }}>
      {Array.from({ length: 개수 }, (_, i) => <div key={i} />)}
    </div>
  );
}

const 열수 = (el: HTMLElement) => el.style.gridTemplateColumns;
const 창이바뀜 = (폭: number) => act(() => { 안쪽폭 = 폭; 알림들.forEach((f) => f()); });

describe("use고른열", () => {
  beforeEach(() => {
    안쪽폭 = 0;
    알림들 = [];
    그린횟수 = 0;
    // clientWidth 는 안쪽 여백을 포함한다 — 실제 브라우저와 같게
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true, get: () => 안쪽폭 + 여백 * 2,
    });
    vi.stubGlobal("ResizeObserver", class {
      constructor(cb: () => void) { 알림들.push(cb); }
      observe() {} unobserve() {} disconnect() {}
    });
  });
  afterEach(() => {
    delete (HTMLElement.prototype as any).clientWidth;
    vi.unstubAllGlobals();
  });

  it("1,440px 화면(칸 1,211px)에 카드 10장 → 다섯 장씩 두 줄", () => {
    안쪽폭 = 1211;                                   // 140px 카드가 8장 들어간다
    const { getByTestId } = render(<시험칸 개수={10} />);
    expect(열수(getByTestId("칸"))).toBe("repeat(5, minmax(0, 1fr))");
  });

  it("창을 넓히면 다시 잰다 — 다 들어가면 한 줄", () => {
    안쪽폭 = 1211;
    const { getByTestId } = render(<시험칸 개수={10} />);
    창이바뀜(1563);                                   // 1,920px 화면 — 10장이 다 들어간다
    expect(열수(getByTestId("칸"))).toBe("repeat(10, minmax(0, 1fr))");
  });

  it("카드 수가 바뀌면 다시 센다 (뼈대 4장 → 실제 11장)", () => {
    안쪽폭 = 1563;
    const { getByTestId, rerender } = render(<시험칸 개수={4} />);
    expect(열수(getByTestId("칸"))).toBe("repeat(4, minmax(0, 1fr))");
    rerender(<시험칸 개수={11} />);
    expect(열수(getByTestId("칸"))).toBe("repeat(6, minmax(0, 1fr))");   // 6 + 5
  });

  it("안쪽 여백은 빼고 잰다 — 안 빼면 한 장이 더 들어가는 줄 안다", () => {
    안쪽폭 = 747;            // 140×5 + 12×4 = 748 → 넉 장만 들어간다(여백 16px 를 더하면 다섯 장)
    const { getByTestId } = render(<시험칸 개수={5} />);
    expect(열수(getByTestId("칸"))).toBe("repeat(3, minmax(0, 1fr))");   // 3 + 2
  });

  it("폭을 모르면(0) 열을 정하지 않는다 — CSS 기본값이 그대로 산다", () => {
    const { getByTestId } = render(<시험칸 개수={10} />);
    expect(열수(getByTestId("칸"))).toBe("");
  });

  it("ResizeObserver 가 없는 곳에서도 처음 한 번은 잰다", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    안쪽폭 = 1211;
    const { getByTestId } = render(<시험칸 개수={10} />);
    expect(열수(getByTestId("칸"))).toBe("repeat(5, minmax(0, 1fr))");
  });

  it("창을 끄는 동안 들어가는 장 수가 그대로면 다시 그리지 않는다", () => {
    안쪽폭 = 1211;
    render(<시험칸 개수={10} />);
    const 전 = 그린횟수;
    창이바뀜(1215);
    창이바뀜(1220);
    expect(그린횟수).toBe(전);
    창이바뀜(1400);                                   // 9장 들어가는 폭 — 이제는 다시 그린다
    expect(그린횟수).toBeGreaterThan(전);
  });
});
