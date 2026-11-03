/**
 * 글 공유(사용자가 고른 7번) — 휴대폰은 기기 공유 창, PC 는 링크 복사.
 *
 * 예전에는 어디서나 링크 복사만 됐다. 여기서 못 박는 것 —
 *   1) 손가락으로 쓰는 기기에 공유 창이 있으면 공유 창을 연다(복사하지 않는다)
 *   2) 사람이 공유 창을 닫으면 그걸로 끝 — 몰래 복사하지 않는다
 *   3) 공유 창이 실패하거나 없거나 PC 면 복사한다
 *   4) 복사도 못 하면 '실패' 라고 알린다(조용히 넘어가지 않는다)
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { 글공유, 공유창쓰나, 링크복사, 공유알림, 글주소 } from "../공유";

const 원래matchMedia = window.matchMedia;

function 기기(손가락: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: 손가락 && q === "(pointer: coarse)", media: q,
    addEventListener() {}, removeEventListener() {},
  })) as any;
}
function 공유창(fn?: (d: ShareData) => Promise<void>) {
  Object.defineProperty(navigator, "share", { value: fn, configurable: true, writable: true });
}
function 클립보드(fn: (t: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { value: { writeText: fn }, configurable: true });
}

afterEach(() => {
  window.matchMedia = 원래matchMedia;
  공유창(undefined);
});

describe("글 주소", () => {
  it("종목 게시판이 아니라 그 글로 바로 간다", () => {
    expect(글주소(12)).toBe(`${window.location.origin}/post/12`);
  });
});

describe("휴대폰 — 기기 공유 창", () => {
  it("공유 창을 열고, 복사는 하지 않는다", async () => {
    기기(true);
    const 공유 = vi.fn(() => Promise.resolve());
    const 복사 = vi.fn(() => Promise.resolve());
    공유창(공유); 클립보드(복사);
    expect(await 글공유("https://x/post/1", "제목")).toBe("공유");
    expect(공유).toHaveBeenCalledWith({ title: "제목", url: "https://x/post/1" });
    expect(복사).not.toHaveBeenCalled();
  });

  it("공유 창을 닫으면 그걸로 끝 — 몰래 복사하지 않는다", async () => {
    기기(true);
    const 복사 = vi.fn(() => Promise.resolve());
    공유창(() => Promise.reject(Object.assign(new Error("닫음"), { name: "AbortError" })));
    클립보드(복사);
    expect(await 글공유("https://x/post/1")).toBe("취소");
    expect(복사).not.toHaveBeenCalled();
  });

  it("공유 창이 다른 이유로 실패하면 복사로 대신한다", async () => {
    기기(true);
    const 복사 = vi.fn(() => Promise.resolve());
    공유창(() => Promise.reject(Object.assign(new Error("안 됨"), { name: "NotAllowedError" })));
    클립보드(복사);
    expect(await 글공유("https://x/post/1")).toBe("복사");
    expect(복사).toHaveBeenCalledWith("https://x/post/1");
  });

  it("공유 창이 없는 휴대폰은 복사한다", async () => {
    기기(true);
    공유창(undefined);
    const 복사 = vi.fn(() => Promise.resolve());
    클립보드(복사);
    expect(공유창쓰나()).toBe(false);
    expect(await 글공유("https://x/post/2")).toBe("복사");
  });
});

describe("PC — 링크 복사", () => {
  it("공유 창이 있어도(윈도 크롬) 복사한다 — PC 에서는 복사가 익숙하다", async () => {
    기기(false);
    const 공유 = vi.fn(() => Promise.resolve());
    const 복사 = vi.fn(() => Promise.resolve());
    공유창(공유); 클립보드(복사);
    expect(공유창쓰나()).toBe(false);
    expect(await 글공유("https://x/post/3")).toBe("복사");
    expect(공유).not.toHaveBeenCalled();
  });

  it("복사도 못 하면 실패라고 말한다", async () => {
    기기(false);
    클립보드(() => Promise.reject(new Error("권한 없음")));
    expect(await 글공유("https://x/post/4")).toBe("실패");
    expect(await 링크복사("https://x/post/4")).toBe("실패");
  });

  it("기기 정보를 못 읽어도 터지지 않는다", () => {
    window.matchMedia = (() => { throw new Error("없음"); }) as any;
    공유창(() => Promise.resolve());
    expect(공유창쓰나()).toBe(false);
  });
});

describe("알림 한 줄", () => {
  it("복사·실패만 말한다 — 공유 창은 기기가 이미 보여 줬다", () => {
    expect(공유알림("복사")).toEqual({ 글: "링크를 복사했어요", 종류: "success" });
    expect(공유알림("실패")).toEqual({ 글: "링크를 복사하지 못했어요", 종류: "error" });
    expect(공유알림("공유")).toBeNull();
    expect(공유알림("취소")).toBeNull();
  });
});

