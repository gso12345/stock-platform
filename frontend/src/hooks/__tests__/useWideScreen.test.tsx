/**
 * 화면이 넓은가 — 원그래프 크기처럼 CSS 로 못 바꾸는 값에만 쓴다.
 * 창 크기를 바꾸면 따라 바뀌고, 알 수 없으면 휴대폰 모양(좁음)이 기본이다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, act, screen } from "@testing-library/react";
import { use넓은화면, use좁은화면 } from "../useWideScreen";

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

describe("use좁은화면 — 휴대폰 폭(639px 이하)이면 창을 아래 시트로", () => {
  function 좁은지({ 최대폭 }: { 최대폭?: number }) {
    return <span>{use좁은화면(최대폭) ? "휴대폰" : "아님"}</span>;
  }
  let 맞음 = false;
  let 물은것: string[] = [];
  let 듣는것: ((e: { matches: boolean }) => void) | null = null;
  const 그만듣기 = vi.fn();
  let 터짐 = false;

  beforeEach(() => {
    맞음 = false;
    물은것 = [];
    듣는것 = null;
    터짐 = false;
    그만듣기.mockClear();
    vi.stubGlobal("matchMedia", (q: string) => {
      if (터짐) throw new Error("matchMedia 없음");
      물은것.push(q);
      return {
        matches: 맞음, media: q,
        addEventListener: (_: string, f: any) => { 듣는것 = f; },
        removeEventListener: 그만듣기,
      };
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("639px 이하를 묻는다", () => {
    맞음 = true;
    render(<좁은지 />);
    expect(screen.getByText("휴대폰")).toBeInTheDocument();
    expect(물은것).toContain("(max-width: 639px)");
  });

  it("창 크기가 바뀌면 따라 바뀌고, 치우면 그만 듣는다", () => {
    const { unmount } = render(<좁은지 />);
    expect(screen.getByText("아님")).toBeInTheDocument();
    act(() => 듣는것!({ matches: true }));
    expect(screen.getByText("휴대폰")).toBeInTheDocument();
    unmount();
    expect(그만듣기).toHaveBeenCalled();
  });

  it("기준 폭이 바뀌면 다시 묻는다", () => {
    const { rerender } = render(<좁은지 최대폭={300} />);
    expect(screen.getByText("아님")).toBeInTheDocument();
    맞음 = true;
    rerender(<좁은지 최대폭={639} />);
    expect(screen.getByText("휴대폰")).toBeInTheDocument();
  });

  it("물을 수 없으면(검사 환경 등) 휴대폰이 아니라고 본다 — 예전 가운데 창 그대로", () => {
    터짐 = true;
    render(<좁은지 />);
    expect(screen.getByText("아님")).toBeInTheDocument();
  });
});
