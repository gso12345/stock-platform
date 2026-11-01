/**
 * 화면 방향 고정 — "앱에서 화면방향이 작동하지 않아(가로고정 세로고정이 안되고있어)"
 *
 * 브라우저 흉내로 못 박는 것 —
 *   1) 안드로이드: 전체 화면 없이 받아 주면 그대로, 거절하면 누른 손으로 전체 화면에 들어가 건다
 *   2) 누른 손이 없으면(앱을 막 열었을 때) 기다렸다가 다음에 누를 때 건다
 *   3) 전체 화면이 풀리면 고정도 풀린다 — 다음에 누를 때 다시
 *   4) 시스템설정으로 돌리면 풀고, 고정하려고 들어간 전체 화면에서 나온다
 *   5) 아이폰·PC 는 건드리지 않는다(전체 화면만 괜히 켜지지 않게)
 *   6) 거는 중에 다른 방향을 고르면 마지막 것으로 맞춘다
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { 지원, 원하는방향, 지켜보기, use고정상태, _처음으로, 방향안내 } from "../화면방향";

const 안드로이드 = "Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const 아이폰 = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const 맥 = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const 윈도 = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

/** 브라우저 흉내 — 안드로이드 크롬처럼 '전체 화면이어야 고정' 을 기본으로 */
function 브라우저({ 전체화면없이도 = false, 전체화면에서도안됨 = false, 전체화면거절 = false } = {}) {
  let 전체화면: Element | null = null;
  const 바뀜 = () => document.dispatchEvent(new Event("fullscreenchange"));
  const lock = vi.fn(async (_o: string) => {
    if (전체화면에서도안됨 || (!전체화면없이도 && !전체화면)) throw new DOMException("전체 화면이어야 해요", "SecurityError");
  });
  const unlock = vi.fn();
  Object.defineProperty(screen, "orientation", { value: { lock, unlock, type: "portrait-primary", angle: 0 }, configurable: true });
  Object.defineProperty(document, "fullscreenEnabled", { value: true, configurable: true });
  Object.defineProperty(document, "fullscreenElement", { get: () => 전체화면, configurable: true });
  const requestFullscreen = vi.fn(async () => {
    if (전체화면거절) throw new TypeError("전체 화면 거절");
    전체화면 = document.documentElement;
    바뀜();
  });
  const exitFullscreen = vi.fn(async () => { 전체화면 = null; 바뀜(); });
  document.documentElement.requestFullscreen = requestFullscreen as unknown as Element["requestFullscreen"];
  document.exitFullscreen = exitFullscreen as unknown as Document["exitFullscreen"];
  /** 사용자가 뒤로 가기로 전체 화면을 나간다 */
  const 뒤로가기 = () => { 전체화면 = null; 바뀜(); };
  return { lock, unlock, requestFullscreen, exitFullscreen, 뒤로가기, 전체화면인가: () => 전체화면 !== null };
}

let 손 = { isActive: false };
const 누른다 = () => {
  손 = { isActive: true };
  document.dispatchEvent(new Event("pointerup"));
};
const 상태 = () => use고정상태.getState().상태;
const 쉬기 = () => new Promise((r) => setTimeout(r, 0));

let 떼기: () => void = () => {};
beforeEach(() => {
  _처음으로();
  손 = { isActive: false };
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(안드로이드);
  Object.defineProperty(navigator, "userActivation", { get: () => 손, configurable: true });
  떼기 = 지켜보기();
});
afterEach(() => {
  떼기();
  vi.restoreAllMocks();
});

describe("어디서 되나", () => {
  it("안드로이드만 — 아이폰·아이패드(맥이라고 말하는)·PC 는 안 된다", () => {
    브라우저();
    expect(지원(안드로이드, 5)).toBe("된다");
    expect(지원(아이폰, 5)).toBe("아이폰");
    expect(지원(맥, 5)).toBe("아이폰");          // 터치되는 맥 = 아이패드
    expect(지원(맥, 0)).toBe("안된다");
    expect(지원(윈도, 0)).toBe("안된다");
  });

  it("lock() 이 없는 안드로이드 브라우저도 안 된다", () => {
    Object.defineProperty(screen, "orientation", { value: { type: "portrait-primary", angle: 0 }, configurable: true });
    expect(지원(안드로이드, 5)).toBe("안된다");
  });
});

describe("안드로이드", () => {
  it("전체 화면 없이 받아 주는 곳이면 그대로 건다 — 전체 화면에 안 들어간다", async () => {
    const b = 브라우저({ 전체화면없이도: true });
    손 = { isActive: true };
    await 원하는방향("portrait");
    expect(b.lock).toHaveBeenCalledWith("portrait");
    expect(b.requestFullscreen).not.toHaveBeenCalled();
    expect(상태()).toBe("고정됨");
    expect(use고정상태.getState().전체화면).toBe(false);   // 안내에 '뒤로 가기로 풀린다' 를 붙이지 않는다
  });

  it("전체 화면이어야 하면 — 누른 손으로 전체 화면에 들어가 건다(화면 위아래 줄을 숨긴다)", async () => {
    const b = 브라우저();
    손 = { isActive: true };
    await 원하는방향("landscape");
    expect(b.requestFullscreen).toHaveBeenCalledWith({ navigationUI: "hide" });
    expect(b.lock.mock.calls).toEqual([["landscape"], ["landscape"]]);   // 한 번 거절, 전체 화면에서 성공
    expect(b.전체화면인가()).toBe(true);
    expect(상태()).toBe("고정됨");
    expect(use고정상태.getState().전체화면).toBe(true);
  });

  it("앱을 막 열어 누른 손이 없으면 기다렸다가 — 처음 누를 때 건다", async () => {
    const b = 브라우저();
    await 원하는방향("portrait");
    expect(b.requestFullscreen).not.toHaveBeenCalled();
    expect(상태()).toBe("누르면");
    누른다();
    await 쉬기();
    expect(b.requestFullscreen).toHaveBeenCalledTimes(1);
    expect(b.lock).toHaveBeenLastCalledWith("portrait");
    expect(상태()).toBe("고정됨");
    // 걸린 뒤로는 눌러도 다시 안 건다
    누른다();
    await 쉬기();
    expect(b.requestFullscreen).toHaveBeenCalledTimes(1);
  });

  it("뒤로 가기로 전체 화면이 풀리면 고정도 풀린 것 — 다음에 누를 때 다시 건다", async () => {
    const b = 브라우저();
    손 = { isActive: true };
    await 원하는방향("portrait");
    expect(상태()).toBe("고정됨");
    b.뒤로가기();
    expect(상태()).toBe("누르면");
    expect(use고정상태.getState().전체화면).toBe(false);
    누른다();
    await 쉬기();
    expect(b.requestFullscreen).toHaveBeenCalledTimes(2);
    expect(상태()).toBe("고정됨");
  });

  it("시스템설정으로 돌리면 풀고, 고정하려고 들어간 전체 화면에서 나온다", async () => {
    const b = 브라우저();
    손 = { isActive: true };
    await 원하는방향("landscape");
    await 원하는방향("system");
    expect(b.unlock).toHaveBeenCalled();
    expect(b.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(b.전체화면인가()).toBe(false);
    expect(상태()).toBe("따름");
    // 시스템설정에서는 눌러도 아무 일 없다
    누른다();
    await 쉬기();
    expect(b.requestFullscreen).toHaveBeenCalledTimes(1);
  });

  it("전체 화면 없이 걸었으면 시스템설정으로 돌려도 전체 화면은 건드리지 않는다 — 다른 데서 켠 전체 화면이어도", async () => {
    const b = 브라우저({ 전체화면없이도: true });
    await b.requestFullscreen();          // 동영상 등 다른 까닭으로 켠 전체 화면
    b.requestFullscreen.mockClear();
    await 원하는방향("portrait");
    await 원하는방향("system");
    expect(b.unlock).toHaveBeenCalled();
    expect(b.exitFullscreen).not.toHaveBeenCalled();
    expect(b.전체화면인가()).toBe(true);
  });

  it("전체 화면에서도 거절하면 전체 화면에서 나오고 '안 됨' — 누를 때마다 다시 시도하지 않는다", async () => {
    const b = 브라우저({ 전체화면에서도안됨: true });
    손 = { isActive: true };
    await 원하는방향("portrait");
    expect(b.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(b.전체화면인가()).toBe(false);
    expect(상태()).toBe("안됨");
    누른다();
    await 쉬기();
    expect(b.requestFullscreen).toHaveBeenCalledTimes(1);
  });

  it("누른 손이 있었는데 전체 화면을 거절하면 '안 됨', 손을 모르는 브라우저면 다음 누를 때", async () => {
    브라우저({ 전체화면거절: true });
    손 = { isActive: true };
    await 원하는방향("portrait");
    expect(상태()).toBe("안됨");

    _처음으로();
    const b = 브라우저({ 전체화면거절: true });
    Object.defineProperty(navigator, "userActivation", { get: () => undefined, configurable: true });
    await 원하는방향("portrait");
    expect(b.requestFullscreen).toHaveBeenCalledTimes(1);
    expect(상태()).toBe("누르면");
  });

  it("이미 다른 까닭으로 전체 화면인데도 거절하면 더 할 게 없다", async () => {
    const b = 브라우저({ 전체화면에서도안됨: true });
    await b.requestFullscreen();
    b.requestFullscreen.mockClear();
    손 = { isActive: true };
    await 원하는방향("landscape");
    expect(b.requestFullscreen).not.toHaveBeenCalled();
    expect(상태()).toBe("안됨");
  });

  it("거는 중에 다른 방향을 고르면 — 끝난 뒤 마지막에 고른 것으로 맞춘다", async () => {
    const b = 브라우저();
    손 = { isActive: true };
    const 처음 = 원하는방향("landscape");
    void 원하는방향("portrait");
    await 처음;
    await 쉬기();
    expect(b.lock).toHaveBeenLastCalledWith("portrait");
    expect(상태()).toBe("고정됨");
  });

  it("일반 탭에서 unlock() 이 곧바로 예외를 던져도 죽지 않는다", async () => {
    const b = 브라우저();
    b.unlock.mockImplementation(() => { throw new DOMException("안 돼요", "NotSupportedError"); });
    await expect(원하는방향("system")).resolves.toBeUndefined();
    expect(상태()).toBe("따름");
  });
});

describe("아이폰·PC", () => {
  it.each([["아이폰", 아이폰], ["PC", 윈도]])("%s — lock 도 전체 화면도 건드리지 않고 '안 됨'", async (_이름, ua) => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ua);
    const b = 브라우저({ 전체화면없이도: true });
    손 = { isActive: true };
    await 원하는방향("landscape");
    expect(b.lock).not.toHaveBeenCalled();
    expect(b.requestFullscreen).not.toHaveBeenCalled();
    expect(상태()).toBe("안됨");
    누른다();
    await 쉬기();
    expect(b.requestFullscreen).not.toHaveBeenCalled();
  });
});

describe("설정 창의 안내", () => {
  it("아이폰은 왜 안 되는지와 제어 센터를, PC 는 안드로이드에서 된다고", () => {
    expect(방향안내("아이폰", "portrait", "안됨")).toMatch(/아이폰·아이패드는 앱이 화면 방향을 고정할 수 없어요.*제어 센터의 '화면 방향 잠금'/);
    expect(방향안내("안된다", "system", "따름")).toBe("이 기기에서는 화면 방향을 고정할 수 없어요. 안드로이드 휴대폰에서 고를 수 있어요.");
  });

  it("안드로이드 — 지금 상태 그대로", () => {
    expect(방향안내("된다", "system", "따름")).toMatch(/^휴대폰의 자동 회전 설정을 따라요.*전체 화면/);
    expect(방향안내("된다", "portrait", "고정됨", true))
      .toBe("세로로 고정했어요. 뒤로 가기로 전체 화면이 풀리면, 화면을 한 번 누를 때 다시 고정해요.");
    // 전체 화면 없이 걸렸으면 전체 화면 이야기를 하지 않는다
    expect(방향안내("된다", "landscape", "고정됨")).toBe("가로로 고정했어요.");
    expect(방향안내("된다", "landscape", "고정됨", false)).toBe("가로로 고정했어요.");
    expect(방향안내("된다", "landscape", "누르면")).toBe("화면을 한 번 누르면 가로로 고정해요(전체 화면으로 바뀌어요).");
    expect(방향안내("된다", "portrait", "안됨")).toMatch(/받아 주지 않았어요.*자동 회전을 꺼/);
    expect(방향안내("된다", "portrait", "거는중")).toBe("세로로 고정하는 중이에요…");
  });
});
