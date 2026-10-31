/**
 * 휴대폰 알림 켜고 끄기 — 브라우저마다·상황마다 못 받는 까닭이 다르다.
 *
 *   · 못 받는 브라우저 / 아이폰(홈 화면에 추가해야) / 알림을 막아 둠 — 각각 다르게 말해야 풀 수 있다
 *   · 켜면 서버 공개키로 구독해 서버에 알리고, 끄면 서버와 기기 둘 다에서 끈다
 *   · 서버 열쇠가 바뀌었으면 예전 구독을 버리고 다시 구독한다 — 그대로 두면 영영 안 온다
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { pushApi } from "@/api/stocks";
import { useSettingsStore } from "@/store/settingsStore";
import { useWebPush, 열쇠바이트, 푸시설정맞추기, use휴대폰알림켜짐 } from "../useWebPush";

vi.mock("@/api/stocks", () => ({
  pushApi: { key: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn(), test: vi.fn() },
}));

/** 서버 공개키(65바이트) */
const 서버키 = "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8";

function 구독(열쇠 = 열쇠바이트(서버키)) {
  return {
    endpoint: "https://fcm.googleapis.com/fcm/send/abc",
    options: { applicationServerKey: 열쇠.buffer },
    toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "p", auth: "a" } }),
    unsubscribe: vi.fn(() => Promise.resolve(true)),
  };
}

let 지금구독: ReturnType<typeof 구독> | null;
const 구독하기 = vi.fn();
let 허락: NotificationPermission;
const 허락받기 = vi.fn();

function 브라우저(덧: { push?: boolean; 아이폰?: boolean; 설치?: boolean } = {}) {
  const 원래UA = navigator.userAgent;
  Object.defineProperty(navigator, "userAgent", {
    value: 덧.아이폰 ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" : 원래UA, configurable: true,
  });
  (window as any).matchMedia = vi.fn(() => ({ matches: !!덧.설치 }));
  if (덧.push === false) {
    delete (window as any).PushManager;
    delete (navigator as any).serviceWorker;
    return;
  }
  (window as any).PushManager = function () {};
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      ready: Promise.resolve({
        pushManager: {
          getSubscription: vi.fn(() => Promise.resolve(지금구독)),
          subscribe: 구독하기,
        },
      }),
    },
  });
  (window as any).Notification = {
    get permission() { return 허락; },
    requestPermission: 허락받기,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  지금구독 = null;
  허락 = "default";
  허락받기.mockImplementation(async () => { 허락 = "granted"; return 허락; });
  구독하기.mockImplementation(async () => { 지금구독 = 구독(); return 지금구독; });
  vi.mocked(pushApi.key).mockResolvedValue(서버키);
  vi.mocked(pushApi.subscribe).mockResolvedValue({ ok: true, ipo: true, brokers: [] });
  vi.mocked(pushApi.unsubscribe).mockResolvedValue({ ok: true });
  useSettingsStore.getState().set내증권사(["키움증권"]);
  localStorage.removeItem("push_ipo");
});
afterEach(() => {
  delete (window as any).PushManager;
  delete (window as any).Notification;
  delete (navigator as any).serviceWorker;
});

describe("열쇠 바이트", () => {
  it("base64url 을 풀고 ArrayBuffer 위에 만든다", () => {
    const b = 열쇠바이트(서버키);
    expect(b.length).toBe(65);
    expect(b[0]).toBe(4);
    expect(b.buffer).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(열쇠바이트("_-8"))).toEqual([0xff, 0xef]);    // - _ 와 채움 없는 꼬리
  });
});

describe("처음 상태", () => {
  it("못 받는 브라우저", async () => {
    브라우저({ push: false });
    const { result } = renderHook(() => useWebPush());
    await waitFor(() => expect(result.current.상태).toBe("안됨"));
  });

  it("서비스워커는 있어도 PushManager 가 없으면 못 받는다(홈 화면에 안 넣은 아이폰 사파리 등)", async () => {
    브라우저();
    delete (window as any).PushManager;
    const { result } = renderHook(() => useWebPush());
    await waitFor(() => expect(result.current.상태).toBe("안됨"));
  });

  it("아이폰인데 홈 화면에 안 넣었으면 '설치필요'", async () => {
    브라우저({ push: false, 아이폰: true });
    const { result } = renderHook(() => useWebPush());
    await waitFor(() => expect(result.current.상태).toBe("설치필요"));
  });

  it("알림을 막아 뒀으면 '막힘'", async () => {
    브라우저();
    허락 = "denied";
    const { result } = renderHook(() => useWebPush());
    await waitFor(() => expect(result.current.상태).toBe("막힘"));
  });

  it("구독이 있고 허락돼 있으면 '켜짐', 아니면 '꺼짐'", async () => {
    브라우저();
    허락 = "granted";
    지금구독 = 구독();
    const 켜짐 = renderHook(() => useWebPush());
    await waitFor(() => expect(켜짐.result.current.상태).toBe("켜짐"));
    지금구독 = null;
    const 꺼짐 = renderHook(() => useWebPush());
    await waitFor(() => expect(꺼짐.result.current.상태).toBe("꺼짐"));
  });
});

describe("켜기·끄기", () => {
  it("허락 → 서버 공개키로 구독 → 서버에 공모주·증권사 설정과 함께 알린다", async () => {
    브라우저();
    const { result } = renderHook(() => useWebPush());
    await waitFor(() => expect(result.current.상태).toBe("꺼짐"));
    await act(async () => { expect(await result.current.켜기()).toBe(true); });
    expect(허락받기).toHaveBeenCalled();
    const [옵션] = 구독하기.mock.calls[0];
    expect(옵션.userVisibleOnly).toBe(true);
    expect(Array.from(옵션.applicationServerKey as Uint8Array)).toEqual(Array.from(열쇠바이트(서버키)));
    expect(pushApi.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: "https://fcm.googleapis.com/fcm/send/abc" }),
      { ipo: true, brokers: ["키움증권"] });
    expect(result.current.상태).toBe("켜짐");
  });

  it("허락하지 않으면 구독하지 않는다 — 거절이면 '막힘'", async () => {
    브라우저();
    허락받기.mockImplementation(async () => { 허락 = "denied"; return 허락; });
    const { result } = renderHook(() => useWebPush());
    await waitFor(() => expect(result.current.상태).toBe("꺼짐"));
    await act(async () => { expect(await result.current.켜기()).toBe(false); });
    expect(구독하기).not.toHaveBeenCalled();
    expect(pushApi.subscribe).not.toHaveBeenCalled();
    expect(result.current.상태).toBe("막힘");
  });

  it("예전 열쇠로 한 구독은 버리고 다시 구독한다", async () => {
    브라우저();
    허락 = "granted";
    const 옛것 = 구독(new Uint8Array(65).fill(7));
    지금구독 = 옛것;
    const { result } = renderHook(() => useWebPush());
    await waitFor(() => expect(result.current.상태).toBe("켜짐"));
    await act(async () => { await result.current.켜기(); });
    expect(옛것.unsubscribe).toHaveBeenCalled();
    expect(구독하기).toHaveBeenCalledTimes(1);
  });

  it("같은 열쇠의 구독이 있으면 그것을 다시 알리기만 한다", async () => {
    브라우저();
    허락 = "granted";
    지금구독 = 구독();
    const { result } = renderHook(() => useWebPush());
    await waitFor(() => expect(result.current.상태).toBe("켜짐"));
    await act(async () => { await result.current.켜기(); });
    expect(구독하기).not.toHaveBeenCalled();
    expect(pushApi.subscribe).toHaveBeenCalledTimes(1);
  });

  it("서버가 실패하면 켜졌다고 하지 않고 이유를 말한다", async () => {
    브라우저();
    vi.mocked(pushApi.subscribe).mockRejectedValue(new Error("500"));
    const { result } = renderHook(() => useWebPush());
    await waitFor(() => expect(result.current.상태).toBe("꺼짐"));
    await act(async () => { expect(await result.current.켜기()).toBe(false); });
    expect(result.current.상태).toBe("꺼짐");
    expect(result.current.오류).toMatch(/켜지 못했어요/);
  });

  it("끄면 서버와 기기 둘 다 — 서버가 못 들어도 기기에서는 끈다", async () => {
    브라우저();
    허락 = "granted";
    const 지금것 = 구독();
    지금구독 = 지금것;
    vi.mocked(pushApi.unsubscribe).mockRejectedValue(new Error("끊김"));
    const { result } = renderHook(() => useWebPush());
    await waitFor(() => expect(result.current.상태).toBe("켜짐"));
    await act(async () => { await result.current.끄기(); });
    expect(pushApi.unsubscribe).toHaveBeenCalledWith("https://fcm.googleapis.com/fcm/send/abc");
    expect(지금것.unsubscribe).toHaveBeenCalled();
    expect(result.current.상태).toBe("꺼짐");
  });
});

describe("공모주 알림 설정", () => {
  it("끄면 이 기기에 남기고 서버에도 알린다", async () => {
    브라우저();
    허락 = "granted";
    지금구독 = 구독();
    const { result } = renderHook(() => useWebPush());
    await waitFor(() => expect(result.current.상태).toBe("켜짐"));
    await act(async () => { await result.current.공모주바꾸기(false); });
    expect(localStorage.getItem("push_ipo")).toBe("0");
    expect(result.current.공모주).toBe(false);
    expect(pushApi.subscribe).toHaveBeenLastCalledWith(expect.anything(), { ipo: false, brokers: ["키움증권"] });
    // 다시 열어도 그대로
    const 다시 = renderHook(() => useWebPush());
    expect(다시.result.current.공모주).toBe(false);
  });

  it("꺼져 있으면 서버에 안 알린다", async () => {
    브라우저();
    const { result } = renderHook(() => useWebPush());
    await waitFor(() => expect(result.current.상태).toBe("꺼짐"));
    await act(async () => { await result.current.공모주바꾸기(false); });
    expect(pushApi.subscribe).not.toHaveBeenCalled();
  });

  it("증권사를 바꾸면 켜 둔 기기만 서버에 다시 알린다", async () => {
    브라우저();
    허락 = "granted";
    지금구독 = 구독();
    await 푸시설정맞추기(["KB증권"]);
    expect(pushApi.subscribe).toHaveBeenCalledWith(expect.anything(), { ipo: true, brokers: ["KB증권"] });
    vi.mocked(pushApi.subscribe).mockClear();
    지금구독 = null;
    await 푸시설정맞추기(["KB증권"]);
    허락 = "default";
    지금구독 = 구독();
    await 푸시설정맞추기(["KB증권"]);
    expect(pushApi.subscribe).not.toHaveBeenCalled();
  });
});

describe("켜져 있나만 묻기", () => {
  it("살필 때만 알아보고, 못 받는 브라우저는 꺼짐", async () => {
    브라우저({ push: false });
    const 안살핌 = renderHook(() => use휴대폰알림켜짐(false));
    expect(안살핌.result.current).toBeNull();
    const 살핌 = renderHook(() => use휴대폰알림켜짐(true));
    await waitFor(() => expect(살핌.result.current).toBe(false));
  });

  it("구독이 있으면 켜짐", async () => {
    브라우저();
    허락 = "granted";
    지금구독 = 구독();
    const { result } = renderHook(() => use휴대폰알림켜짐(true));
    await waitFor(() => expect(result.current).toBe(true));
  });
});
