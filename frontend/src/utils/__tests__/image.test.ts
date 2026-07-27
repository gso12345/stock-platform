/**
 * 첨부 이미지 압축.
 *
 * 예전에는 피드와 종목 커뮤니티가 거의 같은 함수를 각자 들고 있었고, 그중 하나는
 * img.onerror를 달지 않아 이미지가 아닌 파일을 고르면 Promise가 영원히 끝나지
 * 않았다 — 버튼이 계속 '처리 중'인 채로 멈춘다. 조용히 멈추는 종류라 못 박아 둔다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { compressImage, IMAGE_MAX_CHARS } from "@/utils/image";

/** Image와 canvas를 갈아끼워 jsdom에서도 실제 흐름을 태운다 */
function mockImage(behavior: "load" | "error", size = { width: 1600, height: 1200 }) {
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    width = size.width;
    height = size.height;
    set src(_v: string) {
      setTimeout(() => (behavior === "load" ? this.onload?.() : this.onerror?.()), 0);
    }
  }
  vi.stubGlobal("Image", FakeImage);
}

function mockCanvas(dataUrl: string | null, ctx: unknown = {}) {
  const drawn: { w: number; h: number }[] = [];
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
    if (tag !== "canvas") return document.createElementNS("http://www.w3.org/1999/xhtml", tag);
    return {
      width: 0, height: 0,
      getContext: () => (ctx ? { drawImage: (_i: unknown, _x: number, _y: number, w: number, h: number) => drawn.push({ w, h }) } : null),
      toDataURL: () => dataUrl,
    };
  }) as typeof document.createElement);
  return drawn;
}

const file = (type = "image/png") => new File(["x"], "a.png", { type });

beforeEach(() => {
  vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:x", revokeObjectURL: vi.fn() });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("compressImage", () => {
  it("이미지를 data URL로 돌려준다", async () => {
    mockImage("load");
    mockCanvas("data:image/jpeg;base64,AAA");
    await expect(compressImage(file())).resolves.toBe("data:image/jpeg;base64,AAA");
  });

  it("긴 변을 800px로 줄인다", async () => {
    mockImage("load", { width: 1600, height: 1200 });
    const drawn = mockCanvas("data:image/jpeg;base64,AAA");
    await compressImage(file());
    expect(drawn[0]).toEqual({ w: 800, h: 600 });
  });

  it("작은 이미지는 늘리지 않는다", async () => {
    mockImage("load", { width: 320, height: 240 });
    const drawn = mockCanvas("data:image/jpeg;base64,AAA");
    await compressImage(file());
    expect(drawn[0]).toEqual({ w: 320, h: 240 });
  });

  it("이미지가 아닌 파일은 곧바로 거절한다", async () => {
    // 예전에는 여기서 멈춰 버렸다 (onerror 없음)
    await expect(compressImage(file("application/pdf"))).rejects.toThrow(/이미지 파일만/);
  });

  it("읽을 수 없는 이미지는 거절한다 — 멈추지 않는다", async () => {
    mockImage("error");
    mockCanvas("data:image/jpeg;base64,AAA");
    await expect(compressImage(file())).rejects.toThrow(/읽을 수 없습니다/);
  });

  it("캔버스를 못 얻어도 멈추지 않는다", async () => {
    mockImage("load");
    mockCanvas("data:image/jpeg;base64,AAA", null);
    await expect(compressImage(file())).rejects.toThrow(/처리할 수 없습니다/);
  });

  it("서버 상한을 넘으면 보내기 전에 막는다", async () => {
    // 넘겨봤자 422로 거절당하는데, 그때는 쓴 글까지 함께 실패한다
    mockImage("load");
    mockCanvas("data:image/jpeg;base64," + "A".repeat(IMAGE_MAX_CHARS));
    await expect(compressImage(file())).rejects.toThrow(/너무 큽니다/);
  });
});
