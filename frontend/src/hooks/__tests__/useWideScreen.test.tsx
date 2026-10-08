/**
 * 화면이 넓은가 — 원그래프 크기처럼 CSS 로 못 바꾸는 값에만 쓴다.
 * 창 크기를 바꾸면 따라 바뀌고, 알 수 없으면 휴대폰 모양(좁음)이 기본이다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, act, screen } from "@testing-library/react";
import { use넓은화면 } from "../useWideScreen";

function 보기({ 최소폭 }: { 최소폭?: number }) {
  return <span>{use넓은화면(최소폭) ? "넓음" : "좁음"}</span>;
}

let 맞음 = false;
let 물은것: string[] = [];
let 듣는것: ((e: { matches: boolean }) => void) | null = null;
const 그만듣기 = vi.fn();

describe("use넓은화면", () => {
  beforeEach(() => {
    맞음 = false;
    물은것 = [];
    듣는것 = null;
    그만듣기.mockClear();
    vi.stubGlobal("matchMedia", (q: string) => {
      물은것.push(q);
      return {
        matches: 맞음, media: q,
        addEventListener: (_: string, f: any) => { 듣는것 = f; },
        removeEventListener: 그만듣기,
      };
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("1,024px 이상이면 넓다 (Tailwind 의 lg 와 같은 기준)", () => {
    맞음 = true;
    render(<보기 />);
    expect(screen.getByText("넓음")).toBeInTheDocument();
    expect(물은것).toContain("(min-width: 1024px)");
  });

  it("좁으면 좁다", () => {
    render(<보기 />);
    expect(screen.getByText("좁음")).toBeInTheDocument();
  });

  it("기준 폭을 바꿀 수 있다", () => {
    render(<보기 최소폭={1280} />);
    expect(물은것).toContain("(min-width: 1280px)");
  });

  it("창 크기가 바뀌면 따라 바뀐다", () => {
    맞음 = true;
    render(<보기 />);
    act(() => 듣는것!({ matches: false }));
    expect(screen.getByText("좁음")).toBeInTheDocument();
    act(() => 듣는것!({ matches: true }));
    expect(screen.getByText("넓음")).toBeInTheDocument();
  });

  it("화면에서 사라지면 듣기를 멈춘다", () => {
    const { unmount } = render(<보기 />);
    const 들은것 = 듣는것;
    unmount();
    expect(그만듣기).toHaveBeenCalledWith("change", 들은것);
  });

  it("matchMedia 가 없는 곳에서는 좁다고 본다 — 휴대폰 모양이 기본", () => {
    vi.stubGlobal("matchMedia", undefined);
    render(<보기 />);
    expect(screen.getByText("좁음")).toBeInTheDocument();
  });
});
