/**
 * 가운데 창 → 휴대폰에서는 아래 시트 — "실제 앱같이 느껴졌으면" 8번.
 *
 * 휴대폰(639px 이하)에서는 창이 아래에서 올라오고, 손잡이를 끌어내리면 닫히고, 화면 자판이 올라오면 그 위로
 * 올라간다. PC 는 예전 가운데 창 그대로.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { Modal } from "../ui";
import { 닫을까, 닫는거리, 닫는속도, 쓸기최소, 내려가는시간 } from "@/hooks/useSheet";

let 폭 = 390;
let 지금 = 0;

/** 자판 흉내 — 보이는 판(visualViewport)이 줄어든다 */
class 보이는판 extends EventTarget {
  height = 844;
  offsetTop = 0;
}
let 판: 보이는판 | null = null;

function matchMedia흉내() {
  vi.stubGlobal("matchMedia", (q: string) => {
    const 최대 = /max-width:\s*(\d+)px/.exec(q);
    const 최소 = /min-width:\s*(\d+)px/.exec(q);
    const matches = 최대 ? 폭 <= Number(최대[1]) : 최소 ? 폭 >= Number(최소[1]) : false;
    return { matches, media: q, addEventListener() {}, removeEventListener() {} };
  });
}

const 시트 = () => document.querySelector("[data-sheet]") as HTMLElement;
const 손잡이 = () => 시트().firstElementChild as HTMLElement;
const 뒤판 = () => document.querySelector(".modal-backdrop") as HTMLElement;

/** 시간 미루기만 흉내 — performance.now 는 위의 '지금' 을 그대로 쓴다(끈 시간을 정해 준다) */
function 시계() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
}

function 끌기(아래로: number, 걸린ms: number) {
  지금 = 1000;
  fireEvent.pointerDown(손잡이(), { clientY: 100, pointerId: 1 });
  지금 += 걸린ms;
  fireEvent.pointerMove(손잡이(), { clientY: 100 + 아래로, pointerId: 1 });
  fireEvent.pointerUp(손잡이(), { clientY: 100 + 아래로, pointerId: 1 });
}

beforeEach(() => {
  폭 = 390;
  지금 = 0;
  판 = null;
  matchMedia흉내();
  vi.spyOn(performance, "now").mockImplementation(() => 지금);
  Object.defineProperty(window, "visualViewport", { configurable: true, get: () => 판 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("닫을까 — 끌어내린 거리와 빠르기", () => {
  it("멀리(90px) 끌면 천천히라도 닫는다", () => {
    expect([닫는거리, 닫는속도, 쓸기최소, 내려가는시간]).toEqual([90, 0.6, 20, 200]);
    expect(닫을까(90, 5000)).toBe(true);
    expect(닫을까(89, 5000)).toBe(false);
  });

  it("짧아도 빠르게 쓸면 닫는다 — 톡 건드린 건 아니다", () => {
    expect(닫을까(30, 50)).toBe(true);        // 0.6px/ms
    expect(닫을까(20, 33)).toBe(true);
    expect(닫을까(20, 34)).toBe(false);
    expect(닫을까(19, 1)).toBe(false);        // 너무 짧다 — 건드린 것
    expect(닫을까(20, 0)).toBe(true);         // 0ms 로 나누지 않는다
  });
});

describe("휴대폰 — 아래 시트", () => {
  it("아래에서 올라오는 시트와 손잡이 — 가운데 창 모양이 아니다", () => {
    render(<Modal onClose={() => {}} maxWidth="max-w-sm"><p>내용</p></Modal>);
    expect(시트()).toBeInTheDocument();
    expect(시트().className).toContain("sheet-up");
    expect(시트().className).toContain("rounded-t-2xl");
    expect(시트().className).not.toContain("max-w-sm");
    expect(document.querySelector(".modal-pop")).toBeNull();
    expect(뒤판().className).toContain("justify-end");
    expect(손잡이().getAttribute("aria-hidden")).toBe("true");
    expect(손잡이().className).toContain("touch-none");
    expect(screen.getByText("내용")).toBeInTheDocument();
    // 내용이 길면 시트 안에서 스크롤한다(손잡이는 남는다)
    expect(screen.getByText("내용").parentElement!.className).toContain("overflow-y-auto");
  });

  it("뒤를 누르면 닫고, 시트 안을 누르면 닫지 않는다", () => {
    const 닫기 = vi.fn();
    render(<Modal onClose={닫기}><p>내용</p></Modal>);
    fireEvent.click(screen.getByText("내용"));
    expect(닫기).not.toHaveBeenCalled();
    fireEvent.click(뒤판());
    expect(닫기).toHaveBeenCalledTimes(1);
  });

  it("뒤판의 짙기를 고를 수 있다", () => {
    const { unmount } = render(<Modal onClose={() => {}} backdropOpacity={70}><p>내용</p></Modal>);
    expect(뒤판().className).toContain("bg-black/70");
    unmount();
    render(<Modal onClose={() => {}}><p>내용</p></Modal>);
    expect(뒤판().className).toContain("bg-black/60");
  });

  it("끄는 동안 손가락을 따라 내려온다 — 올라오던 효과는 멈춘다", () => {
    render(<Modal onClose={() => {}}><p>내용</p></Modal>);
    fireEvent.pointerDown(손잡이(), { clientY: 100, pointerId: 1 });
    expect(시트().style.animation).toBe("none");
    fireEvent.pointerMove(손잡이(), { clientY: 160, pointerId: 1 });
    expect(시트().style.transform).toBe("translateY(60px)");
    expect(시트().style.transition).toBe("none");
    fireEvent.pointerMove(손잡이(), { clientY: 40, pointerId: 1 });    // 위로는 안 끌린다
    expect(시트().style.transform).toBe("");
  });

  it("멀리 끌어 놓으면 내려가고, 다 내려간 뒤에 닫는다", () => {
    시계();
    const 닫기 = vi.fn();
    render(<Modal onClose={닫기}><p>내용</p></Modal>);
    끌기(닫는거리 + 10, 2000);
    expect(시트().style.transform).toBe("translateY(100%)");
    expect(시트().style.transition).toBe(`transform ${내려가는시간}ms ease`);
    act(() => { vi.advanceTimersByTime(내려가는시간 - 1); });
    expect(닫기).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(닫기).toHaveBeenCalledTimes(1);
  });

  it("짧게 빠르게 쓸어도 닫는다", () => {
    시계();
    const 닫기 = vi.fn();
    render(<Modal onClose={닫기}><p>내용</p></Modal>);
    끌기(40, 50);
    act(() => { vi.advanceTimersByTime(내려가는시간); });
    expect(닫기).toHaveBeenCalledTimes(1);
  });

  it("짧게 천천히 끌다 놓으면 제자리로 돌아간다", () => {
    시계();
    const 닫기 = vi.fn();
    render(<Modal onClose={닫기}><p>내용</p></Modal>);
    끌기(40, 1000);
    expect(시트().style.transform).toBe("");
    expect(시트().style.transition).toBe(`transform ${내려가는시간}ms ease`);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(닫기).not.toHaveBeenCalled();
    fireEvent.pointerMove(손잡이(), { clientY: 400, pointerId: 1 });   // 손을 뗀 뒤에는 따라오지 않는다
    expect(시트().style.transform).toBe("");
  });

  it("손을 놓치면(pointercancel) 제자리로 — 그 뒤 움직임·뗌은 무시한다", () => {
    시계();
    const 닫기 = vi.fn();
    render(<Modal onClose={닫기}><p>내용</p></Modal>);
    fireEvent.pointerDown(손잡이(), { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(손잡이(), { clientY: 300, pointerId: 1 });
    fireEvent.pointerCancel(손잡이(), { pointerId: 1 });
    expect(시트().style.transform).toBe("");
    fireEvent.pointerMove(손잡이(), { clientY: 400, pointerId: 1 });
    expect(시트().style.transform).toBe("");
    fireEvent.pointerUp(손잡이(), { clientY: 400, pointerId: 1 });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(닫기).not.toHaveBeenCalled();
  });

  it("누르지 않고 움직이거나 떼기만 하면 아무 일 없다", () => {
    시계();
    const 닫기 = vi.fn();
    render(<Modal onClose={닫기}><p>내용</p></Modal>);
    fireEvent.pointerMove(손잡이(), { clientY: 400, pointerId: 1 });
    expect(시트().style.transform).toBe("");
    fireEvent.pointerUp(손잡이(), { clientY: 400, pointerId: 1 });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(닫기).not.toHaveBeenCalled();
  });

  it("손가락을 붙잡아 손잡이 밖으로 나가도 계속 끌린다", () => {
    render(<Modal onClose={() => {}}><p>내용</p></Modal>);
    const 붙잡기 = vi.fn();
    (손잡이() as any).setPointerCapture = 붙잡기;
    fireEvent.pointerDown(손잡이(), { clientY: 100, pointerId: 7 });
    expect(붙잡기).toHaveBeenCalledWith(7);
  });

  it("닫을 수 없는 창은 손잡이가 끌리지 않고 뒤를 눌러도 그대로", () => {
    render(<Modal><p>내용</p></Modal>);
    expect(손잡이().className).not.toContain("touch-none");
    fireEvent.pointerDown(손잡이(), { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(손잡이(), { clientY: 400, pointerId: 1 });
    expect(시트().style.transform).toBe("");
    expect(() => fireEvent.click(뒤판())).not.toThrow();
    expect(시트()).toBeInTheDocument();
  });

  it("자판이 올라오면 그만큼 올라가고, 내려가면 돌아온다", () => {
    판 = new 보이는판();
    render(<Modal onClose={() => {}}><input aria-label="이름" /></Modal>);
    expect(시트().style.marginBottom).toBe("");
    expect(시트().style.maxHeight).toContain("100dvh");
    act(() => {
      판!.height = 544.4;                    // 소수점 높이도 온다 — 반올림
      판!.dispatchEvent(new Event("resize"));
    });
    expect(시트().style.marginBottom).toBe("300px");
    expect(시트().style.maxHeight).toContain("300px");
    act(() => {
      판!.offsetTop = 20;                    // iOS 는 판을 밀어 올리기도 한다 — 그만큼은 빼고
      판!.dispatchEvent(new Event("scroll"));
    });
    expect(시트().style.marginBottom).toBe("280px");
    act(() => {
      판!.height = 844;
      판!.offsetTop = 0;
      판!.dispatchEvent(new Event("resize"));
    });
    expect(시트().style.marginBottom).toBe("");
    act(() => {
      판!.height = 900;                      // 보이는 판이 더 커져도(확대 등) 아래로 내려가지 않는다
      판!.dispatchEvent(new Event("resize"));
    });
    expect(시트().style.marginBottom).toBe("");
  });

  it("자판이 이미 올라와 있을 때 열어도 그 위에 뜬다", () => {
    판 = new 보이는판();
    판.height = 544;
    render(<Modal onClose={() => {}}><input aria-label="이름" /></Modal>);
    expect(시트().style.marginBottom).toBe("300px");
  });

  it("창이 닫히면 자판을 더 지켜보지 않는다", () => {
    판 = new 보이는판();
    const 빼기 = vi.spyOn(판, "removeEventListener");
    const { unmount } = render(<Modal onClose={() => {}}><p>내용</p></Modal>);
    unmount();
    expect(빼기.mock.calls.map((c) => c[0]).sort()).toEqual(["resize", "scroll"]);
  });

  it("자판 높이를 잴 수 없는 브라우저에서도 그대로 뜬다", () => {
    render(<Modal onClose={() => {}}><p>내용</p></Modal>);
    expect(시트()).toBeInTheDocument();
    expect(시트().style.marginBottom).toBe("");
  });
});

describe("PC·태블릿 — 예전 가운데 창 그대로", () => {
  it("가운데 창이고 손잡이·시트가 없다", () => {
    폭 = 1280;
    판 = new 보이는판();
    const 듣기 = vi.spyOn(판, "addEventListener");
    render(<Modal onClose={() => {}} maxWidth="max-w-sm"><p>내용</p></Modal>);
    expect(시트()).toBeNull();
    const 창 = document.querySelector(".modal-pop") as HTMLElement;
    expect(창.className).toContain("max-w-sm");
    expect(창.className).toContain("rounded-2xl");
    expect(뒤판().className).toContain("items-center");
    expect(듣기).not.toHaveBeenCalled();     // 자판은 휴대폰에서만 잰다
  });

  it("위에 붙이는 창도 그대로", () => {
    폭 = 1280;
    render(<Modal onClose={() => {}} align="start" padTop="pt-24"><p>내용</p></Modal>);
    expect(뒤판().className).toContain("items-start");
    expect(뒤판().className).toContain("pt-24");
  });

  it("태블릿(640px)도 가운데 창 — 시트는 639px 까지", () => {
    폭 = 640;
    render(<Modal onClose={() => {}}><p>내용</p></Modal>);
    expect(시트()).toBeNull();
  });

  it("639px 은 시트", () => {
    폭 = 639;
    render(<Modal onClose={() => {}}><p>내용</p></Modal>);
    expect(시트()).toBeInTheDocument();
  });
});
