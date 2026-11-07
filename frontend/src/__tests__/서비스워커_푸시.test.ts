/**
 * 서비스워커의 웹 푸시 — 앱이 닫혀 있어도 알림을 띄우고, 누르면 그 화면으로 간다.
 *
 * sw.js 를 가짜 서비스워커 전역에서 실제로 돌려 본다(서비스워커.test.ts 와 같은 방식).
 *   · 서버가 보낸 {title, body, url, tag} 로 알림을 띄운다
 *   · 내용을 못 읽어도 무언가는 띄운다 — 안 띄우면 브라우저가 구독을 끊는다(userVisibleOnly)
 *   · 누르면 열려 있는 앱 창을 그 화면으로, 없으면 새 창으로
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const 원문 = readFileSync(resolve(__dirname, "../../public/sw.js"), "utf8");

function 띄우기(창들: any[] = []) {
  const 처리기들: Record<string, (e: any) => void> = {};
  const 띄움 = vi.fn((_제목: string, _옵션: any) => Promise.resolve());
  const 새창 = vi.fn((_주소: string) => Promise.resolve());
  const 가짜self = {
    location: { origin: "https://app.example" },
    registration: { navigationPreload: { enable: vi.fn() }, showNotification: 띄움 },
    clients: { claim: vi.fn(), matchAll: vi.fn(() => Promise.resolve(창들)), openWindow: 새창 },
    skipWaiting: vi.fn(),
    addEventListener: (이름: string, f: (e: any) => void) => { 처리기들[이름] = f; },
  };
  new Function("self", "caches", "fetch", 원문)(가짜self, {}, vi.fn());
  async function 보내기(이름: string, 사건: any) {
    let 기다릴것: Promise<unknown> = Promise.resolve();
    처리기들[이름]({ ...사건, waitUntil: (p: Promise<unknown>) => { 기다릴것 = p; } });
    await 기다릴것;
  }
  return { 처리기들, 띄움, 새창, 보내기 };
}

const 푸시 = (내용: unknown) => ({ data: { json: () => 내용, text: () => String(내용) } });

let sw: ReturnType<typeof 띄우기>;
beforeEach(() => { sw = 띄우기(); });

describe("푸시를 받으면", () => {
  it("서버가 보낸 제목·본문으로 띄우고, 누를 때 갈 곳을 담는다", async () => {
    await sw.보내기("push", 푸시({ title: "가격 알림", body: "삼성전자 8만원 넘음", url: "/stocks/KR/005930", tag: "price-005930" }));
    expect(sw.띄움).toHaveBeenCalledTimes(1);
    const [제목, 옵션] = sw.띄움.mock.calls[0];
    expect(제목).toBe("가격 알림");
    expect(옵션.body).toBe("삼성전자 8만원 넘음");
    expect(옵션.data).toEqual({ url: "/stocks/KR/005930" });
    expect(옵션.icon).toBe("/pwa-192.png");
    // 같은 종목 알림은 한 칸으로 — 그래도 새로 왔다는 것은 알린다
    expect(옵션.tag).toBe("price-005930");
    expect(옵션.renotify).toBe(true);
  });

  it("tag 가 없으면 따로따로, renotify 도 끈다", async () => {
    await sw.보내기("push", 푸시({ title: "x" }));
    const 옵션 = sw.띄움.mock.calls[0][1];
    expect(옵션.tag).toBeUndefined();
    expect(옵션.renotify).toBe(false);
    expect(옵션.data).toEqual({ url: "/notifications" });
  });

  it("내용을 못 읽어도 무언가는 띄운다", async () => {
    await sw.보내기("push", { data: { json: () => { throw new Error("JSON 아님"); }, text: () => "그냥 글" } });
    expect(sw.띄움).toHaveBeenCalledWith("새 알림", expect.objectContaining({ body: "그냥 글" }));
    await sw.보내기("push", { data: null });
    expect(sw.띄움).toHaveBeenLastCalledWith("새 알림", expect.objectContaining({ body: "" }));
  });
});

describe("알림을 누르면", () => {
  it("열려 있는 앱 창을 그 화면으로", async () => {
    const 창 = { url: "https://app.example/feed", focus: vi.fn(() => Promise.resolve()), navigate: vi.fn(() => Promise.resolve()) };
    const 남의창 = { url: "https://other.example/", focus: vi.fn(), navigate: vi.fn() };
    sw = 띄우기([남의창, 창]);
    const 닫기 = vi.fn();
    await sw.보내기("notificationclick", { notification: { close: 닫기, data: { url: "/stocks/KR/005930" } } });
    expect(닫기).toHaveBeenCalled();
    expect(창.focus).toHaveBeenCalled();
    expect(창.navigate).toHaveBeenCalledWith("https://app.example/stocks/KR/005930");
    expect(남의창.navigate).not.toHaveBeenCalled();
    expect(sw.새창).not.toHaveBeenCalled();
  });

  it("열린 창이 없으면 새로 연다 — 갈 곳이 없으면 알림 화면", async () => {
    await sw.보내기("notificationclick", { notification: { close: vi.fn(), data: { url: "/ipo" } } });
    expect(sw.새창).toHaveBeenCalledWith("https://app.example/ipo");
    await sw.보내기("notificationclick", { notification: { close: vi.fn(), data: null } });
    expect(sw.새창).toHaveBeenLastCalledWith("https://app.example/notifications");
  });
});

describe("1:1 메시지 푸시", () => {
  it("알림을 띄우고, 열린 앱 창들에도 알린다 — 화면이 바로 다시 묻게", async () => {
    const 창 = { url: "https://app.example/messages/12", postMessage: vi.fn() };
    const 다른창 = { url: "https://app.example/feed", postMessage: vi.fn() };
    sw = 띄우기([창, 다른창]);
    await sw.보내기("push", 푸시({ title: "개미왕님의 메시지", body: "안녕", url: "/messages/12", tag: "dm-12" }));
    expect(sw.띄움).toHaveBeenCalledTimes(1);
    expect(sw.띄움.mock.calls[0][1]).toMatchObject({ tag: "dm-12", renotify: true, data: { url: "/messages/12" } });
    expect(창.postMessage).toHaveBeenCalledWith({ type: "dm", tag: "dm-12" });
    expect(다른창.postMessage).toHaveBeenCalledWith({ type: "dm", tag: "dm-12" });
  });

  it("메시지가 아닌 푸시는 창에 알리지 않는다", async () => {
    const 창 = { url: "https://app.example/", postMessage: vi.fn() };
    sw = 띄우기([창]);
    await sw.보내기("push", 푸시({ title: "가격 알림", tag: "price-005930" }));
    await sw.보내기("push", 푸시({ title: "x", tag: "dm-abc" }));
    await sw.보내기("push", 푸시({ title: "x" }));
    expect(창.postMessage).not.toHaveBeenCalled();
    expect(sw.띄움).toHaveBeenCalledTimes(3);
  });

  it("창에 못 알려도 알림은 이미 떴다 — 터지지 않는다", async () => {
    const 창 = { url: "https://app.example/", postMessage: vi.fn(() => { throw new Error("닫힘"); }) };
    sw = 띄우기([창]);
    await sw.보내기("push", 푸시({ title: "x", tag: "dm-3" }));
    expect(sw.띄움).toHaveBeenCalledTimes(1);
  });
});
