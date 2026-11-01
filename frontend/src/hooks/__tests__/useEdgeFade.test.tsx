/**
 * 옆으로 넘치는 줄의 끝 흐림(디자인 6번) — 종목 상세 탭·스크리닝 도구 단추·폴더 칩 줄이 화면 끝에서 뚝 잘려
 * 옆에 더 있는지 몰랐다. 더 있는 쪽 끝을 흐린다.
 */
import { describe, it, expect, vi } from "vitest";
import { render, act } from "@testing-library/react";
import { useState } from "react";
import { 넘친쪽재기, use끝흐림 } from "../useEdgeFade";

describe("넘친쪽재기", () => {
  it("가려진 쪽을 말한다 — 1px 은 반올림 오차로 본다", () => {
    expect(넘친쪽재기({ scrollLeft: 0, clientWidth: 100, scrollWidth: 100 })).toBe("");
    expect(넘친쪽재기({ scrollLeft: 0, clientWidth: 100, scrollWidth: 101 })).toBe("");
    expect(넘친쪽재기({ scrollLeft: 0, clientWidth: 100, scrollWidth: 102 })).toBe("right");
    expect(넘친쪽재기({ scrollLeft: 1, clientWidth: 100, scrollWidth: 300 })).toBe("right");
    expect(넘친쪽재기({ scrollLeft: 2, clientWidth: 100, scrollWidth: 300 })).toBe("both");
    expect(넘친쪽재기({ scrollLeft: 199, clientWidth: 100, scrollWidth: 300 })).toBe("left");
    expect(넘친쪽재기({ scrollLeft: 200, clientWidth: 100, scrollWidth: 300 })).toBe("left");
  });
});

function 줄({ 보임 = true }: { 보임?: boolean }) {
  const [ref, 흐림] = use끝흐림<HTMLDivElement>();
  return 보임 ? <div ref={ref} data-testid="줄" className={흐림} /> : <p>없음</p>;
}

function 폭흉내(el: HTMLElement, 값: { 보임: number; 전체: number; 왼쪽: number }) {
  Object.defineProperty(el, "clientWidth", { configurable: true, get: () => 값.보임 });
  Object.defineProperty(el, "scrollWidth", { configurable: true, get: () => 값.전체 });
  Object.defineProperty(el, "scrollLeft", { configurable: true, get: () => 값.왼쪽 });
}

describe("use끝흐림", () => {
  it("넘치지 않으면 아무 클래스도 없다", () => {
    const { getByTestId } = render(<줄 />);
    expect(getByTestId("줄").className).toBe("");
  });

  it("넘기면 따라 바뀌고, 클래스 이름은 통째로(Tailwind 가 알아보게)", () => {
    const { getByTestId, rerender } = render(<줄 />);
    const el = getByTestId("줄");
    const 값 = { 보임: 100, 전체: 300, 왼쪽: 0 };
    폭흉내(el, 값);
    rerender(<줄 />);
    expect(el.className).toBe("fade-edge-right");
    값.왼쪽 = 100;
    act(() => { el.dispatchEvent(new Event("scroll")); });
    expect(el.className).toBe("fade-edge-both");
    값.왼쪽 = 200;
    act(() => { el.dispatchEvent(new Event("scroll")); });
    expect(el.className).toBe("fade-edge-left");
  });

  it("창 크기가 바뀌어 다 들어오면 걷는다", () => {
    const { getByTestId, rerender } = render(<줄 />);
    const el = getByTestId("줄");
    const 값 = { 보임: 100, 전체: 300, 왼쪽: 0 };
    폭흉내(el, 값);
    rerender(<줄 />);
    값.보임 = 300;
    act(() => { window.dispatchEvent(new Event("resize")); });
    expect(el.className).toBe("");
  });

  it("줄 크기가 바뀌면(ResizeObserver) 다시 잰다", () => {
    let 알림: (() => void) | null = null;
    const 끊기 = vi.fn();
    const 지켜보기 = vi.fn();
    vi.stubGlobal("ResizeObserver", class { constructor(f: () => void) { 알림 = f; } observe = 지켜보기; disconnect = 끊기; });
    const { getByTestId, rerender, unmount } = render(<줄 />);
    const el = getByTestId("줄");
    rerender(<줄 />);
    expect(지켜보기).toHaveBeenCalledWith(el);
    const 값 = { 보임: 100, 전체: 300, 왼쪽: 0 };
    폭흉내(el, 값);
    act(() => { 알림!(); });
    expect(el.className).toBe("fade-edge-right");
    unmount();
    expect(끊기).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("나중에 나타나는 줄(로그인 뒤 등)에도 붙는다", () => {
    function 나중({ 보임 }: { 보임: boolean }) {
      return <줄 보임={보임} />;
    }
    const { rerender, getByTestId } = render(<나중 보임={false} />);
    rerender(<나중 보임 />);
    const el = getByTestId("줄");
    const 값 = { 보임: 100, 전체: 300, 왼쪽: 0 };
    폭흉내(el, 값);
    act(() => { el.dispatchEvent(new Event("scroll")); });
    expect(el.className).toBe("fade-edge-right");
  });

  it("치우면 더는 듣지 않는다", () => {
    function 감싼() {
      const [있음, set있음] = useState(true);
      return (
        <>
          <button onClick={() => set있음(false)}>치우기</button>
          {있음 && <줄 />}
        </>
      );
    }
    const 떼기 = vi.spyOn(window, "removeEventListener");
    const { getByText, getByTestId } = render(<감싼 />);
    const el = getByTestId("줄");
    const 줄떼기 = vi.spyOn(el, "removeEventListener");
    act(() => { getByText("치우기").click(); });
    expect(줄떼기.mock.calls.map((c) => c[0])).toContain("scroll");
    expect(떼기.mock.calls.map((c) => c[0])).toContain("resize");
    떼기.mockRestore();
  });
});
