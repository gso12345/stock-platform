/**
 * 화면을 옮길 때 스크롤 — "실제 앱같이 느껴졌으면" 2번.
 * 새 화면은 맨 위에서, 뒤로 가면 보던 자리로, 같은 화면 안에서 주소만 바뀌면 그대로.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { useRef } from "react";
import { MemoryRouter, Routes, Route, Outlet, useNavigate, type NavigateFunction } from "react-router-dom";
import {
  use스크롤기억, 자리적기, 자리읽기, 되돌리기, 맨위로, _기억비우기, 최대기억, 되돌리기_프레임,
} from "../useScrollMemory";

let 이동: NavigateFunction;
let 본문: HTMLDivElement;
let 자리 = 0;
let 끝자리 = Infinity;           // 내용이 짧으면 여기까지만 내려간다(브라우저처럼)

function 틀() {
  const ref = useRef<HTMLDivElement>(null);
  use스크롤기억(ref);
  이동 = useNavigate();
  return <div ref={ref} data-testid="본문"><Outlet /></div>;
}

function 그리기(처음 = "/목록") {
  const r = render(
    <MemoryRouter initialEntries={[처음]}>
      <Routes>
        <Route element={<틀 />}>
          <Route path="/목록" element={<p>목록</p>} />
          <Route path="/상세" element={<p>상세</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
  return r;
}

/** 본문의 scrollTop 을 흉내 — jsdom 은 배치가 없어 늘 0 이다 */
function 스크롤흉내() {
  본문 = document.querySelector("[data-testid=본문]") as HTMLDivElement;
  Object.defineProperty(본문, "scrollTop", {
    configurable: true,
    get: () => 자리,
    set: (v: number) => { 자리 = Math.max(0, Math.min(v, 끝자리)); },
  });
}
function 내린다(y: number) {
  act(() => {
    본문.scrollTop = y;
    본문.dispatchEvent(new Event("scroll"));
  });
}

beforeEach(() => {
  _기억비우기();
  자리 = 0;
  끝자리 = Infinity;
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => setTimeout(() => f(0), 0) as unknown as number);
});
afterEach(() => vi.unstubAllGlobals());

describe("화면을 옮길 때", () => {
  it("새 화면은 맨 위에서, 뒤로 가면 보던 자리로", () => {
    그리기();
    스크롤흉내();
    내린다(640);
    act(() => 이동("/상세"));
    expect(자리).toBe(0);
    내린다(120);
    act(() => 이동(-1));
    expect(자리).toBe(640);
    act(() => 이동(1));                     // 앞으로 — 상세에서 보던 자리
    expect(자리).toBe(120);
  });

  it("같은 화면 안에서 주소만 바뀌면(탭·거르기) 그대로", () => {
    그리기();
    스크롤흉내();
    내린다(300);
    act(() => 이동("/목록?탭=배당", { replace: true }));
    expect(자리).toBe(300);
    act(() => 이동("/목록?탭=뉴스"));        // 같은 경로로 새 기록 — 그래도 그대로
    expect(자리).toBe(300);
    act(() => 이동("/상세"));
    expect(자리).toBe(0);
    내린다(200);
    act(() => 이동("/상세?탭=차트"));        // 옮겨 온 화면 안에서도 — 지금 경로를 따라 적는다
    expect(자리).toBe(200);
  });

  it("기억이 없는 기록으로 돌아가면 손대지 않는다", () => {
    그리기();
    스크롤흉내();
    act(() => 이동("/상세"));
    _기억비우기();
    내린다(77);
    _기억비우기();
    act(() => 이동(-1));
    expect(자리).toBe(77);
  });
});

describe("되돌리기", () => {
  it("자료가 늦게 와 내용이 짧으면 닿을 때까지 프레임마다 다시 맞춘다", async () => {
    const el = document.createElement("div");
    let y = 0;
    let 끝 = 100;
    Object.defineProperty(el, "scrollTop", { configurable: true, get: () => y, set: (v: number) => { y = Math.min(v, 끝); } });
    되돌리기(el, 500);
    expect(y).toBe(100);
    끝 = 1000;                                 // 자료가 와서 길어졌다
    await new Promise((r) => setTimeout(r, 20));
    expect(y).toBe(500);
  });

  it("사람이 손대면(만지거나 휠) 멈춘다", async () => {
    for (const 손 of ["touchstart", "wheel"]) {
      const el = document.createElement("div");
      let y = 0;
      let 끝 = 100;
      Object.defineProperty(el, "scrollTop", { configurable: true, get: () => y, set: (v: number) => { y = Math.min(v, 끝); } });
      되돌리기(el, 500);
      el.dispatchEvent(new Event(손));
      끝 = 1000;
      await new Promise((r) => setTimeout(r, 20));
      expect(y, 손).toBe(100);
    }
  });

  it("다 맞추면(또는 손대면) 손 지켜보기를 거둔다 — 화면을 옮길 때마다 쌓이지 않게", async () => {
    const el = document.createElement("div");
    let y = 0;
    Object.defineProperty(el, "scrollTop", { configurable: true, get: () => y, set: (v: number) => { y = v; } });
    const 빼기 = vi.spyOn(el, "removeEventListener");
    되돌리기(el, 300);                        // 바로 닿는다
    expect(빼기.mock.calls.map((c) => c[0]).sort()).toEqual(["touchstart", "wheel"]);
    const 다른 = document.createElement("div");
    let 끝 = 100;
    Object.defineProperty(다른, "scrollTop", { configurable: true, get: () => Math.min(500, 끝), set: () => {} });
    const 다른빼기 = vi.spyOn(다른, "removeEventListener");
    되돌리기(다른, 500);
    expect(다른빼기).not.toHaveBeenCalled();  // 아직 맞추는 중
    다른.dispatchEvent(new Event("wheel"));
    await new Promise((r) => setTimeout(r, 20));
    expect(다른빼기.mock.calls.map((c) => c[0]).sort()).toEqual(["touchstart", "wheel"]);
    끝 = 1000;
  });

  it("끝내 못 닿으면 정한 프레임만큼만 하고 그만둔다", async () => {
    const el = document.createElement("div");
    let 쓴횟수 = 0;
    Object.defineProperty(el, "scrollTop", { configurable: true, get: () => 0, set: () => { 쓴횟수 += 1; } });
    되돌리기(el, 500);
    await new Promise((r) => setTimeout(r, 300));
    expect(쓴횟수).toBe(되돌리기_프레임);
  });
});

describe("기억과 맨 위로", () => {
  it("오래된 기억부터 버린다", () => {
    for (let i = 0; i <= 최대기억; i++) 자리적기(`k${i}`, i);
    expect(자리읽기("k0")).toBeUndefined();
    expect(자리읽기("k1")).toBe(1);                // 넘친 하나만 버린다
    expect(자리읽기(`k${최대기억}`)).toBe(최대기억);
    expect(최대기억).toBe(60);
  });

  it("다시 적은 기억은 새것으로 친다(바로 버려지지 않는다)", () => {
    for (let i = 0; i < 최대기억; i++) 자리적기(`k${i}`, i);
    자리적기("k0", 5);
    자리적기("새것", 1);
    expect(자리읽기("k0")).toBe(5);
    expect(자리읽기("k1")).toBeUndefined();
  });

  it("맨 위로 — 부드럽게, 못 하는 곳은 바로", () => {
    const el = document.createElement("div");
    const scrollTo = vi.fn();
    (el as any).scrollTo = scrollTo;
    맨위로(el);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    const 옛것 = document.createElement("div");
    (옛것 as any).scrollTo = undefined;
    let y = 300;
    Object.defineProperty(옛것, "scrollTop", { configurable: true, get: () => y, set: (v: number) => { y = v; } });
    맨위로(옛것);
    expect(y).toBe(0);
    expect(() => 맨위로(null)).not.toThrow();
  });
});
