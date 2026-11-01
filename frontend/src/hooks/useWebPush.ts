/**
 * 휴대폰 알림(웹 푸시) — 이 기기에서 켜고 끄기.
 *
 * 알림은 그동안 앱 안의 종 모양에만 쌓였다. 앱을 닫고 '8만원 되면 알려줘' 를 기다리는 사람에게는
 * 없는 기능이었다. 켜면 서버가 같은 알림을 이 기기로도 보낸다(app/services/push_service.py) —
 * 서비스워커(public/sw.js)가 받아서, 앱이 닫혀 있어도 알림을 띄운다.
 *
 * 상태
 *   확인중   처음 알아보는 중
 *   안됨     이 브라우저는 못 받는다
 *   설치필요 아이폰 — 홈 화면에 추가한 앱에서만 된다(iOS 16.4 이상)
 *   막힘     알림 허락을 거절했다 — 브라우저(휴대폰) 설정에서 풀어야 한다
 *   꺼짐 · 켜짐
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { pushApi } from "@/api/stocks";
import { useSettingsStore } from "@/store/settingsStore";

export type 푸시상태 = "확인중" | "안됨" | "설치필요" | "막힘" | "꺼짐" | "켜짐";

/** 공모주 아침 알림을 받을지 — 기기마다 다르게 둘 수 있게 이 기기에 남긴다 */
const 공모주_열쇠 = "push_ipo";

export function 지원하나(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window
    && "Notification" in window;
}

export function 아이폰인가(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);   // 아이패드는 맥처럼 말한다
}

function 설치됨(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true;
}

/** base64url → 바이트(applicationServerKey). ArrayBuffer 위에 만든다 — subscribe() 가 그것만 받는다 */
export function 열쇠바이트(b64u: string) {
  const b64 = b64u.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64u.length % 4)) % 4);
  const 글 = atob(b64);
  const 바이트 = new Uint8Array(new ArrayBuffer(글.length));
  for (let i = 0; i < 글.length; i++) 바이트[i] = 글.charCodeAt(i);
  return 바이트;
}

function 같은바이트(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return true;                 // 브라우저가 안 알려 주면 같다고 본다(되묻지 않는다)
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

/** 서비스워커 준비 — 등록이 안 됐으면 영영 안 끝나므로 시한을 둔다 */
async function 준비된워커(시한 = 5000): Promise<ServiceWorkerRegistration | null> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((r) => setTimeout(() => r(null), 시한)),
  ]);
}

export function 공모주알림켜짐(): boolean {
  try {
    return localStorage.getItem(공모주_열쇠) !== "0";
  } catch {
    return true;
  }
}

/** 이미 켜 둔 기기면 서버에 지금 설정(공모주·증권사)을 다시 알린다 — 증권사를 바꿨을 때 등.
 *  안 켰거나 못 받는 브라우저면 아무것도 안 한다. 어떤 실패도 밖으로 안 낸다 */
export async function 푸시설정맞추기(증권사: string[]): Promise<void> {
  try {
    if (!지원하나() || Notification.permission !== "granted") return;
    const 워커 = await 준비된워커(2000);
    const 구독 = await 워커?.pushManager.getSubscription();
    if (구독) await pushApi.subscribe(구독.toJSON(), { ipo: 공모주알림켜짐(), brokers: 증권사 });
  } catch {
    /* 다음에 켜고 끌 때 다시 맞춘다 */
  }
}

/** 알림 받을 증권사(알림 화면에서 고른다)가 바뀌면 이 기기의 휴대폰 알림 구독에도 알린다.
 *  앱 틀(Layout)이 한 번 건다 — 어디서 바꿨든 한 곳에서 맞춘다. 처음 열 때는 안 부른다. 칩을 잇달아 누르면
 *  마지막 것만 보낸다. 공모주 메뉴의 증권사 칩(목록 거르기)은 여기에 안 닿는다 — 따로인 설정이다 */
export function use증권사알림맞추기(기다림 = 600): void {
  const 알림증권사 = useSettingsStore((s) => s.알림증권사);
  // 연 그때의 목록 — 그대로면 보낼 것이 없다. 고르면 저장소가 늘 새 목록을 만들므로, 한 번이라도
  // 바꾼 뒤에는(처음과 같은 증권사로 되돌려도) 보낸다
  const 처음값 = useRef(알림증권사);
  useEffect(() => {
    if (처음값.current === 알림증권사) return;
    const 시계 = setTimeout(() => void 푸시설정맞추기(알림증권사), 기다림);
    return () => clearTimeout(시계);
  }, [알림증권사, 기다림]);
}

export function useWebPush() {
  const [상태, set상태] = useState<푸시상태>("확인중");
  const [처리중, set처리중] = useState(false);
  const [오류, set오류] = useState<string | null>(null);
  const [공모주, set공모주] = useState(공모주알림켜짐);
  const 알림증권사 = useSettingsStore((s) => s.알림증권사);

  useEffect(() => {
    let 살아있음 = true;
    (async () => {
      if (!지원하나()) {
        set상태(아이폰인가() && !설치됨() ? "설치필요" : "안됨");
        return;
      }
      if (Notification.permission === "denied") {
        set상태("막힘");
        return;
      }
      const 워커 = await 준비된워커();
      const 구독 = 워커 ? await 워커.pushManager.getSubscription().catch(() => null) : null;
      if (살아있음) set상태(!워커 ? "안됨" : 구독 && Notification.permission === "granted" ? "켜짐" : "꺼짐");
    })();
    return () => { 살아있음 = false; };
  }, []);

  const 켜기 = useCallback(async () => {
    set처리중(true);
    set오류(null);
    try {
      const 허락 = await Notification.requestPermission();
      if (허락 !== "granted") {
        set상태(허락 === "denied" ? "막힘" : "꺼짐");
        return false;
      }
      const 워커 = await 준비된워커();
      if (!워커) throw new Error("서비스워커가 준비되지 않았어요");
      const 열쇠 = 열쇠바이트(await pushApi.key());
      let 구독 = await 워커.pushManager.getSubscription();
      // 서버 열쇠가 바뀌었으면(예전 열쇠로 구독한 기기) 다시 구독해야 받는다
      if (구독 && !같은바이트(구독.options?.applicationServerKey, 열쇠)) {
        await 구독.unsubscribe();
        구독 = null;
      }
      구독 = 구독 ?? await 워커.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: 열쇠 });
      await pushApi.subscribe(구독.toJSON(), { ipo: 공모주, brokers: 알림증권사 });
      set상태("켜짐");
      return true;
    } catch {
      set오류("알림을 켜지 못했어요. 잠시 뒤 다시 눌러 주세요.");
      return false;
    } finally {
      set처리중(false);
    }
  }, [공모주, 알림증권사]);

  const 끄기 = useCallback(async () => {
    set처리중(true);
    set오류(null);
    try {
      const 워커 = await 준비된워커();
      const 구독 = await 워커?.pushManager.getSubscription();
      if (구독) {
        await pushApi.unsubscribe(구독.endpoint).catch(() => undefined);   // 서버가 못 들어도 기기에서는 끈다
        await 구독.unsubscribe();
      }
      set상태("꺼짐");
    } catch {
      set오류("알림을 끄지 못했어요. 잠시 뒤 다시 눌러 주세요.");
    } finally {
      set처리중(false);
    }
  }, []);

  const 공모주바꾸기 = useCallback(async (켬: boolean) => {
    set공모주(켬);
    try {
      localStorage.setItem(공모주_열쇠, 켬 ? "1" : "0");
    } catch {
      /* 저장을 막은 브라우저 — 이번만 */
    }
    // 구독이 있을 때만 서버에 — 꺼진 기기는 구독이 없으니 묻기만 하고 끝난다
    try {
      const 구독 = 지원하나() ? await (await 준비된워커(2000))?.pushManager.getSubscription() : null;
      if (구독) await pushApi.subscribe(구독.toJSON(), { ipo: 켬, brokers: 알림증권사 });
    } catch {
      set오류("설정을 저장하지 못했어요.");
    }
  }, [알림증권사]);

  const 시험 = useCallback(async () => {
    set오류(null);
    try {
      const r = await pushApi.test();
      return r.sent > 0;
    } catch {
      set오류("시험 알림을 보내지 못했어요.");
      return false;
    }
  }, []);

  return { 상태, 처리중, 오류, 공모주, 켜기, 끄기, 공모주바꾸기, 시험 };
}

/** 이 기기에 휴대폰 알림이 켜져 있나 — 모르면 null. 살필때가 참일 때만 알아본다(가격 알림 창을 열었을 때 등) */
export function use휴대폰알림켜짐(살필때: boolean): boolean | null {
  const [켜짐, set켜짐] = useState<boolean | null>(null);
  useEffect(() => {
    if (!살필때) return;
    let 살아있음 = true;
    (async () => {
      if (!지원하나() || Notification.permission !== "granted") {
        if (살아있음) set켜짐(false);
        return;
      }
      const 워커 = await 준비된워커(2000);
      const 구독 = await 워커?.pushManager.getSubscription().catch(() => null);
      if (살아있음) set켜짐(Boolean(구독));
    })();
    return () => { 살아있음 = false; };
  }, [살필때]);
  return 켜짐;
}
