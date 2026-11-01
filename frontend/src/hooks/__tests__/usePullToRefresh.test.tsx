/**
 * 당겨서 새로고침 — "실제 앱같이 느껴졌으면" 4번.
 * 설치한 앱에는 새로고침 단추가 없다. 본문 맨 위에서 아래로 당겼다 놓으면 지금 화면의 자료를 다시 받는다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { useRef } from "react";
import {
  use당겨서새로고침, 당김거리, 당겨도되나, 당김_임계, 당김_최대, 당김_저항, 당김_시작, 최소_도는시간, 최대_기다림,
} from "../usePullToRefresh";

let 손가락 = true;
let 터지는질의 = false;

function 틀({ 일 }: { 일: () => Promise<unknown> }) {
  const 본문 = useRef<HTMLDivElement>(null);
  const 표시 = useRef<HTMLDivElement>(null);
  const 도는중 = use당겨서새로고침(본문, 표시, 일);
  return (
    <div ref={본문} data-testid="본문">
      <div ref={표시} data-testid="표시" />
      <p>{도는중 ? "도는 중" : "가만히"}</p>
      <div role="dialog"><button>창 안</button></div>
      <canvas data-testid="차트" />
    </div>
  );
}

function 터치(대상: Element, 종류: string, 점: Array<[number, number]> = []) {
  const e = new Event(종류, { bubbles: true, cancelable: true });
  Object.defineProperty(e, "touches", { value: 점.map(([x, y]) => ({ clientX: x, clientY: y })) });
  act(() => { 대상.dispatchEvent(e); });
}

/** (100,100) 에서 닿아 dy·dx 만큼 움직인 뒤 뗀다 */
function 당기기(대상: Element, dy: number, dx = 0, 끝 = "touchend") {
  터치(대상, "touchstart", [[100, 100]]);
  터치(대상, "touchmove", [[100 + dx, 100 + dy]]);
  터치(대상, 끝);
}

/** 미뤄 둔 일(Promise)까지 흘려보낸다 */
async function 흘리기(ms = 0) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

function 스크롤자리(el: Element, 값: () => number) {
  Object.defineProperty(el, "scrollTop", { configurable: true, get: 값 });
}

const 숨은 = "translate(-50%, -44px) rotate(0deg)";
const 도는자리 = `translate(-50%, ${당김_임계 - 44}px) rotate(${당김_임계 * 4}deg)`;

beforeEach(() => {
  손가락 = true;
  터지는질의 = false;
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", (q: string) => {
    if (터지는질의) throw new Error("matchMedia 없음");
    return { matches: q === "(pointer: coarse)" ? 손가락 : false, media: q, addEventListener() {}, removeEventListener() {} };
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("당김거리 — 손가락을 따라오되 묵직하게", () => {
  it("살짝 닿은 만큼은 0, 그 뒤로 손가락의 절반, 끝은 막힌다", () => {
    expect([당김_임계, 당김_최대, 당김_저항, 당김_시작]).toEqual([64, 96, 0.5, 8]);
    expect(당김거리(0)).toBe(0);
    expect(당김거리(당김_시작)).toBe(0);
    expect(당김거리(당김_시작 + 10)).toBe(5);
    expect(당김거리(-50)).toBe(0);
    expect(당김거리(당김_시작 + 당김_임계 * 2)).toBe(당김_임계);
    expect(당김거리(10_000)).toBe(당김_최대);
  });
});

describe("당겨도되나 — 다른 손짓을 빼앗지 않는다", () => {
  function 판() {
    const 바깥 = document.createElement("div");
    const 본문 = document.createElement("div");
    const 칸 = document.createElement("div");
    const 글 = document.createElement("span");
    칸.appendChild(글);
    본문.appendChild(칸);
    바깥.appendChild(본문);
    return { 바깥, 본문, 칸, 글 };
  }

  it("본문이 맨 위면 된다(글자가 아닌 데서 시작해도)", () => {
    const { 본문, 글 } = 판();
    expect(당겨도되나(글, 본문)).toBe(true);
    expect(당겨도되나(null, 본문)).toBe(true);
  });

  it("본문을 내려 읽던 중이면 안 된다 — 올리려는 것이다", () => {
    const { 본문, 글 } = 판();
    스크롤자리(본문, () => 5);
    expect(당겨도되나(글, 본문)).toBe(false);
    expect(당겨도되나(null, 본문)).toBe(false);
  });

  it("창·차트·당기기 끈 칸 안에서 시작하면 안 된다", () => {
    for (const 안 of ['<div role="dialog"><b></b></div>', '<div class="modal-backdrop"><b></b></div>',
      '<div data-no-pull><b></b></div>', "<canvas></canvas>"]) {
      const { 본문 } = 판();
      본문.innerHTML = 안;
      const 대상 = 본문.querySelector("b") ?? 본문.querySelector("canvas")!;
      expect(당겨도되나(대상, 본문), 안).toBe(false);
    }
  });

  it("스스로 스크롤하는 칸이 내려가 있으면 안 되고, 맨 위면 된다", () => {
    const { 본문, 칸, 글 } = 판();
    let 칸자리 = 30;
    스크롤자리(칸, () => 칸자리);
    expect(당겨도되나(글, 본문)).toBe(false);
    칸자리 = 0;
    expect(당겨도되나(글, 본문)).toBe(true);
  });

  it("본문 바깥 조상은 보지 않는다", () => {
    const { 바깥, 본문, 글 } = 판();
    스크롤자리(바깥, () => 200);
    expect(당겨도되나(글, 본문)).toBe(true);
  });
});

describe("당겨서 새로고침", () => {
  it("맨 위에서 당겨 놓으면 새로 받고, 빨리 끝나도 잠깐은 돈다", async () => {
    const 일 = vi.fn(() => Promise.resolve());
    render(<틀 일={일} />);
    const 본문 = screen.getByTestId("본문");
    const 표시 = screen.getByTestId("표시");

    터치(본문, "touchstart", [[100, 100]]);
    터치(본문, "touchmove", [[100, 300]]);
    // 손가락을 따라 내려오고 돈다(끝까지 당기면 최대에서 멈춘다)
    expect(표시.style.transform).toBe(`translate(-50%, ${당김_최대 - 44}px) rotate(${당김_최대 * 4}deg)`);
    expect(표시.style.opacity).toBe("1");
    expect(표시.style.transition).toBe("none");
    expect(일).not.toHaveBeenCalled();

    터치(본문, "touchend");
    await 흘리기();
    expect(일).toHaveBeenCalledTimes(1);
    expect(screen.getByText("도는 중")).toBeInTheDocument();
    expect(표시.style.transform).toBe(도는자리);
    expect(표시.style.transition).toBe("transform 0.2s ease, opacity 0.2s ease");

    await 흘리기(최소_도는시간 - 1);
    expect(screen.getByText("도는 중")).toBeInTheDocument();
    await 흘리기(1);
    expect(screen.getByText("가만히")).toBeInTheDocument();
    expect(표시.style.transform).toBe(숨은);
    expect(표시.style.opacity).toBe("0");
  });

  it("반쯤 당기는 동안은 흐릿하다", () => {
    render(<틀 일={vi.fn(() => Promise.resolve())} />);
    const 본문 = screen.getByTestId("본문");
    터치(본문, "touchstart", [[100, 100]]);
    터치(본문, "touchmove", [[100, 100 + 당김_시작 + 당김_임계]]);   // 표시는 임계의 절반
    expect(screen.getByTestId("표시").style.opacity).toBe("0.5");
  });

  it("오래 걸리면 끝나는 대로 바로 거둔다", async () => {
    const 일 = vi.fn(() => new Promise((r) => setTimeout(r, 800)));
    render(<틀 일={일} />);
    당기기(screen.getByTestId("본문"), 300);
    await 흘리기(799);
    expect(screen.getByText("도는 중")).toBeInTheDocument();
    await 흘리기(1);
    expect(screen.getByText("가만히")).toBeInTheDocument();
  });

  it("서버가 답이 없어도 정한 시간 뒤에는 거둔다", async () => {
    render(<틀 일={vi.fn(() => new Promise(() => {}))} />);
    당기기(screen.getByTestId("본문"), 300);
    await 흘리기(최대_기다림 - 1);
    expect(screen.getByText("도는 중")).toBeInTheDocument();
    await 흘리기(1);
    expect(screen.getByText("가만히")).toBeInTheDocument();
    expect(최대_기다림).toBe(10_000);
  });

  it("받다가 실패해도 거둔다", async () => {
    render(<틀 일={vi.fn(() => Promise.reject(new Error("끊김")))} />);
    당기기(screen.getByTestId("본문"), 300);
    await 흘리기(최소_도는시간);
    expect(screen.getByText("가만히")).toBeInTheDocument();
  });

  it("문턱에 못 미치면 받지 않고 제자리로 — 문턱에 닿으면 받는다", async () => {
    const 일 = vi.fn(() => Promise.resolve());
    render(<틀 일={일} />);
    const 본문 = screen.getByTestId("본문");
    당기기(본문, 당김_시작 + (당김_임계 - 1) * 2);
    await 흘리기();
    expect(일).not.toHaveBeenCalled();
    expect(screen.getByTestId("표시").style.transform).toBe(숨은);
    expect(screen.getByTestId("표시").style.transition).toBe("transform 0.2s ease, opacity 0.2s ease");
    당기기(본문, 당김_시작 + 당김_임계 * 2);
    await 흘리기();
    expect(일).toHaveBeenCalledTimes(1);
  });

  it("손가락을 놓치면(touchcancel) 놓은 것과 같다", async () => {
    const 일 = vi.fn(() => Promise.resolve());
    render(<틀 일={일} />);
    당기기(screen.getByTestId("본문"), 300, 0, "touchcancel");
    await 흘리기();
    expect(일).toHaveBeenCalledTimes(1);
  });

  it("옆으로 넘기면(차트·표) 아니다 — 그 뒤에 내려도", async () => {
    const 일 = vi.fn(() => Promise.resolve());
    render(<틀 일={일} />);
    const 본문 = screen.getByTestId("본문");
    터치(본문, "touchstart", [[100, 100]]);
    터치(본문, "touchmove", [[130, 105]]);
    터치(본문, "touchmove", [[130, 300]]);
    터치(본문, "touchend");
    await 흘리기();
    expect(일).not.toHaveBeenCalled();
    expect(screen.getByTestId("표시").style.transform).toBe("");
  });

  it("옆으로 조금(시작 거리 안쪽) 흔들린 건 괜찮다", async () => {
    const 일 = vi.fn(() => Promise.resolve());
    render(<틀 일={일} />);
    const 본문 = screen.getByTestId("본문");
    터치(본문, "touchstart", [[100, 100]]);
    터치(본문, "touchmove", [[100 + 당김_시작, 100 + 당김_시작 - 2]]);
    터치(본문, "touchmove", [[108, 300]]);
    터치(본문, "touchend");
    await 흘리기();
    expect(일).toHaveBeenCalledTimes(1);
  });

  it("위로 밀면(내려 읽기) 아니다 — 그 뒤에 내려도", async () => {
    const 일 = vi.fn(() => Promise.resolve());
    render(<틀 일={일} />);
    const 본문 = screen.getByTestId("본문");
    터치(본문, "touchstart", [[100, 100]]);
    터치(본문, "touchmove", [[100, 95]]);
    터치(본문, "touchmove", [[100, 300]]);
    터치(본문, "touchend");
    await 흘리기();
    expect(일).not.toHaveBeenCalled();
  });

  it("위로 아주 조금(4px 까지)은 떨림으로 본다", async () => {
    const 일 = vi.fn(() => Promise.resolve());
    render(<틀 일={일} />);
    const 본문 = screen.getByTestId("본문");
    터치(본문, "touchstart", [[100, 100]]);
    터치(본문, "touchmove", [[100, 96]]);
    터치(본문, "touchmove", [[100, 300]]);
    터치(본문, "touchend");
    await 흘리기();
    expect(일).toHaveBeenCalledTimes(1);
  });

  it("시작 거리 안쪽의 떨림은 기다렸다가, 넘으면 당기기로 본다", async () => {
    const 일 = vi.fn(() => Promise.resolve());
    render(<틀 일={일} />);
    const 본문 = screen.getByTestId("본문");
    터치(본문, "touchstart", [[100, 100]]);
    터치(본문, "touchmove", [[100, 100 + 당김_시작]]);
    expect(screen.getByTestId("표시").style.transform).toBe("");   // 아직 아니다
    터치(본문, "touchmove", [[100, 300]]);
    터치(본문, "touchend");
    await 흘리기();
    expect(일).toHaveBeenCalledTimes(1);
  });

  it("살짝 닿았다 떼기만 하면 아무 일 없다", async () => {
    const 일 = vi.fn(() => Promise.resolve());
    render(<틀 일={일} />);
    const 본문 = screen.getByTestId("본문");
    터치(본문, "touchstart", [[100, 100]]);
    터치(본문, "touchend");
    await 흘리기();
    expect(일).not.toHaveBeenCalled();
    expect(screen.getByTestId("표시").style.transform).toBe("");
  });

  it("본문을 내려 읽던 중이면 아니다", async () => {
    const 일 = vi.fn(() => Promise.resolve());
    render(<틀 일={일} />);
    const 본문 = screen.getByTestId("본문");
    스크롤자리(본문, () => 40);
    당기기(본문, 300);
    await 흘리기();
    expect(일).not.toHaveBeenCalled();
  });

  it("닿은 뒤 본문이 (관성으로) 내려가 있으면 당기기를 시작하지 않는다", async () => {
    const 일 = vi.fn(() => Promise.resolve());
    render(<틀 일={일} />);
    const 본문 = screen.getByTestId("본문");
    let 자리 = 0;
    스크롤자리(본문, () => 자리);
    터치(본문, "touchstart", [[100, 100]]);
    자리 = 10;
    터치(본문, "touchmove", [[100, 300]]);
    터치(본문, "touchend");
    await 흘리기();
    expect(일).not.toHaveBeenCalled();
  });

  it("두 손가락(확대)은 아니다", async () => {
    const 일 = vi.fn(() => Promise.resolve());
    render(<틀 일={일} />);
    const 본문 = screen.getByTestId("본문");
    터치(본문, "touchstart", [[100, 100], [200, 100]]);
    터치(본문, "touchmove", [[100, 300], [200, 300]]);
    터치(본문, "touchend");
    await 흘리기();
    expect(일).not.toHaveBeenCalled();
  });

  it("창이나 차트 위에서 시작하면 아니다", async () => {
    const 일 = vi.fn(() => Promise.resolve());
    render(<틀 일={일} />);
    당기기(screen.getByText("창 안"), 300);
    당기기(screen.getByTestId("차트"), 300);
    await 흘리기();
    expect(일).not.toHaveBeenCalled();
  });

  it("도는 동안 또 당겨도 한 번만 받는다", async () => {
    const 일 = vi.fn(() => new Promise((r) => setTimeout(r, 2000)));
    render(<틀 일={일} />);
    const 본문 = screen.getByTestId("본문");
    당기기(본문, 300);
    await 흘리기();
    터치(본문, "touchstart", [[100, 100]]);
    터치(본문, "touchmove", [[100, 200]]);
    expect(screen.getByTestId("표시").style.transform).toBe(도는자리);   // 손가락을 따라오지 않는다
    터치(본문, "touchend");
    await 흘리기();
    expect(일).toHaveBeenCalledTimes(1);
    await 흘리기(2000);
    expect(screen.getByText("가만히")).toBeInTheDocument();
    당기기(본문, 300);                                                     // 다 돈 뒤에는 다시 된다
    await 흘리기();
    expect(일).toHaveBeenCalledTimes(2);
  });

  it("다시 그려져 바뀐 할 일을 부른다(처음 것에 묶이지 않는다)", async () => {
    const 처음 = vi.fn(() => Promise.resolve());
    const 나중 = vi.fn(() => Promise.resolve());
    const { rerender } = render(<틀 일={처음} />);
    rerender(<틀 일={나중} />);
    당기기(screen.getByTestId("본문"), 300);
    await 흘리기();
    expect(처음).not.toHaveBeenCalled();
    expect(나중).toHaveBeenCalledTimes(1);
  });

  it("마우스(PC)에서는 하지 않는다", async () => {
    손가락 = false;
    const 일 = vi.fn(() => Promise.resolve());
    render(<틀 일={일} />);
    당기기(screen.getByTestId("본문"), 300);
    await 흘리기();
    expect(일).not.toHaveBeenCalled();
  });

  it("기기를 물을 수 없으면 하지 않는다", async () => {
    터지는질의 = true;
    const 일 = vi.fn(() => Promise.resolve());
    render(<틀 일={일} />);
    당기기(screen.getByTestId("본문"), 300);
    await 흘리기();
    expect(일).not.toHaveBeenCalled();
  });

  it("치우면 더는 듣지 않는다 — 네 손짓 모두", async () => {
    const 일 = vi.fn(() => Promise.resolve());
    const { unmount } = render(<틀 일={일} />);
    const 본문 = screen.getByTestId("본문");
    const 빼기 = vi.spyOn(본문, "removeEventListener");
    unmount();
    expect(빼기.mock.calls.map((c) => c[0]).sort()).toEqual(["touchcancel", "touchend", "touchmove", "touchstart"]);
    당기기(본문, 300);
    await 흘리기();
    expect(일).not.toHaveBeenCalled();
  });

  it("닿기·움직이기는 스크롤을 붙잡지 않게(passive) 듣는다", () => {
    const 듣기 = vi.spyOn(HTMLElement.prototype, "addEventListener");
    render(<틀 일={vi.fn(() => Promise.resolve())} />);
    const 본문 = screen.getByTestId("본문");
    const 설정 = (종류: string) => 듣기.mock.calls.find((c) => c[0] === 종류 && 듣기.mock.contexts[듣기.mock.calls.indexOf(c)] === 본문)?.[2];
    expect(설정("touchstart")).toEqual({ passive: true });
    expect(설정("touchmove")).toEqual({ passive: true });
    듣기.mockRestore();
  });

  it("짧게 당겼다 놓은 뒤의 손짓은 처음부터 다시 본다 — 옆으로 크게 넘겨도 새로고침하지 않는다", async () => {
    const 일 = vi.fn(() => Promise.resolve());
    render(<틀 일={일} />);
    const 본문 = screen.getByTestId("본문");
    당기기(본문, 40);                         // 문턱 아래 — 받지 않는다
    터치(본문, "touchstart", [[100, 100]]);
    터치(본문, "touchmove", [[300, 240]]);    // 옆으로 크게(세로도 140)
    터치(본문, "touchend");
    await 흘리기();
    expect(일).not.toHaveBeenCalled();
  });

  it("도는 중에 치워져도 탈이 없다", async () => {
    const { unmount } = render(<틀 일={vi.fn(() => Promise.resolve())} />);
    당기기(screen.getByTestId("본문"), 300);
    await 흘리기();
    unmount();
    await expect(흘리기(최소_도는시간)).resolves.toBeUndefined();
  });
});
