/**
 * 화면 넘김 — "실제 앱같이 느껴졌으면" 7번.
 * 들어갈 때는 오른쪽에서, 뒤로 갈 때는 왼쪽에서 밀려 들어오고, 하단 탭은 살짝 나타난다. 휴대폰·태블릿만.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { useRef } from "react";
import { MemoryRouter, Routes, Route, Outlet, useNavigate, NavigationType, type NavigateFunction } from "react-router-dom";
import { use화면넘김, 넘김종류, 넘김모양, 탭화면 } from "../usePageTransition";

let 이동: NavigateFunction;
let 넓음 = false;
let 줄이기 = false;
const animate = vi.fn();
const 원래animate = (HTMLElement.prototype as any).animate;

function 틀() {
  const ref = useRef<HTMLDivElement>(null);
  use화면넘김(ref);
  이동 = useNavigate();
  return <div ref={ref} data-testid="틀"><Outlet /></div>;
}

function 그리기(처음 = "/") {
  return render(
    <MemoryRouter initialEntries={[처음]}>
      <Routes>
        <Route element={<틀 />}>
          <Route path="/" element={<p>대시보드</p>} />
          <Route path="/portfolio" element={<p>내 자산</p>} />
          <Route path="/stock/:code" element={<p>종목</p>} />
          <Route path="/quant" element={<p>퀀트</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

const 부드럽게 = "cubic-bezier(0.22, 1, 0.36, 1)";
function 마지막넘김() {
  const [키프레임, 설정] = animate.mock.calls[animate.mock.calls.length - 1];
  return { 키프레임, 설정 };
}

beforeEach(() => {
  넓음 = false;
  줄이기 = false;
  animate.mockClear();
  (HTMLElement.prototype as any).animate = animate;
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q === "(min-width: 1024px)" ? 넓음 : q === "(prefers-reduced-motion: reduce)" ? 줄이기 : false,
    media: q, addEventListener() {}, removeEventListener() {},
  }));
});
afterEach(() => {
  (HTMLElement.prototype as any).animate = 원래animate;
  vi.unstubAllGlobals();
});

const { Push: PUSH_, Pop: POP_, Replace: REPLACE_ } = NavigationType;

describe("넘김종류", () => {
  it("같은 화면이거나 주소만 바꾼 것(REPLACE)은 넘기지 않는다", () => {
    expect(넘김종류(PUSH_, "/stock/A", "/stock/A")).toBe("없음");
    expect(넘김종류(POP_, "/", "/")).toBe("없음");
    expect(넘김종류(REPLACE_, "/", "/stock/A")).toBe("없음");
    expect(넘김종류(REPLACE_, "/", "/portfolio")).toBe("없음");
  });

  it("하단 탭끼리는 살짝 — 누르든 뒤로 가든", () => {
    expect(탭화면).toEqual(["/", "/portfolio", "/watchlist", "/feed", "/news", "/more"]);
    expect(넘김종류(PUSH_, "/", "/portfolio")).toBe("탭");
    expect(넘김종류(POP_, "/feed", "/news")).toBe("탭");
  });

  it("상세에서 하단 탭을 눌러도 살짝 — 깊이 들어가는 게 아니다", () => {
    expect(넘김종류(PUSH_, "/stock/A", "/portfolio")).toBe("탭");
  });

  it("상세로 들어가면 앞으로, 뒤로 가면 뒤로", () => {
    expect(넘김종류(PUSH_, "/", "/stock/A")).toBe("앞");
    expect(넘김종류(PUSH_, "/stock/A", "/quant")).toBe("앞");
    expect(넘김종류(POP_, "/stock/A", "/")).toBe("뒤");
    expect(넘김종류(POP_, "/", "/stock/A")).toBe("뒤");
  });

  it("앞은 오른쪽에서, 뒤는 왼쪽에서, 탭은 자리에서 — 탭이 더 짧다", () => {
    expect(넘김모양.앞.키프레임[0]).toEqual({ transform: "translateX(28px)", opacity: 0.6 });
    expect(넘김모양.뒤.키프레임[0]).toEqual({ transform: "translateX(-28px)", opacity: 0.6 });
    expect(넘김모양.탭.키프레임[0]).toEqual({ opacity: 0.5 });
    for (const 모양 of Object.values(넘김모양)) expect(모양.키프레임[1]).toMatchObject({ opacity: 1 });
    expect(넘김모양.앞.키프레임[1]).toEqual({ transform: "none", opacity: 1 });
    expect(넘김모양.뒤.키프레임[1]).toEqual({ transform: "none", opacity: 1 });
    expect([넘김모양.앞.시간, 넘김모양.뒤.시간, 넘김모양.탭.시간]).toEqual([260, 260, 180]);
  });
});

describe("use화면넘김", () => {
  it("처음 열 때는 넘기지 않는다", () => {
    그리기();
    expect(animate).not.toHaveBeenCalled();
  });

  it("들어가면 오른쪽에서, 뒤로 가면 왼쪽에서 — 화면을 감싼 틀이 움직인다", () => {
    그리기();
    act(() => 이동("/stock/A"));
    expect(animate).toHaveBeenCalledTimes(1);
    expect(마지막넘김()).toEqual({ 키프레임: 넘김모양.앞.키프레임, 설정: { duration: 260, easing: 부드럽게 } });
    expect(animate.mock.contexts[0]).toBe(screen.getByTestId("틀"));
    act(() => 이동(-1));
    expect(animate).toHaveBeenCalledTimes(2);
    expect(마지막넘김()).toEqual({ 키프레임: 넘김모양.뒤.키프레임, 설정: { duration: 260, easing: 부드럽게 } });
  });

  it("하단 탭끼리는 살짝 나타난다", () => {
    그리기();
    act(() => 이동("/portfolio"));
    expect(마지막넘김()).toEqual({ 키프레임: 넘김모양.탭.키프레임, 설정: { duration: 180, easing: 부드럽게 } });
  });

  it("주소만 바꾸면(REPLACE·같은 화면) 그대로", () => {
    그리기("/stock/A");
    act(() => 이동("/stock/A?tab=chart"));
    act(() => 이동("/quant", { replace: true }));
    expect(animate).not.toHaveBeenCalled();
  });

  it("PC(1024px 이상)에서는 하지 않는다", () => {
    넓음 = true;
    그리기();
    act(() => 이동("/stock/A"));
    expect(animate).not.toHaveBeenCalled();
  });

  it("'동작 줄이기' 를 켠 사람에게는 하지 않는다", () => {
    줄이기 = true;
    그리기();
    act(() => 이동("/stock/A"));
    expect(animate).not.toHaveBeenCalled();
  });

  it("넘기지 않은 동안에도 지금 화면은 따라 적는다", () => {
    넓음 = true;
    그리기();
    act(() => 이동("/stock/A"));                 // PC 라 안 넘겼지만 지금은 /stock/A 다
    넓음 = false;
    act(() => 이동("/"));
    expect(animate).toHaveBeenCalledTimes(1);   // '/ → /' 로 잘못 알면 넘기지 않는다
    expect(마지막넘김().키프레임).toBe(넘김모양.탭.키프레임);
  });

  it("움직일 수 없는 브라우저·물을 수 없는 곳에서도 탈이 없다", () => {
    (HTMLElement.prototype as any).animate = undefined;
    그리기();
    expect(() => act(() => 이동("/stock/A"))).not.toThrow();
    (HTMLElement.prototype as any).animate = animate;
    vi.stubGlobal("matchMedia", () => { throw new Error("없음"); });
    act(() => 이동("/quant"));
    expect(animate).toHaveBeenCalledTimes(1);    // 물을 수 없으면 휴대폰으로 보고 넘긴다
  });
});
