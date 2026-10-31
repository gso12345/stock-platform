/** 웹 푸시 — 휴대폰(브라우저)마다 켜고 끄기. 화면은 '@/api/stocks' 에서 가져간다(거기서 다시 내보낸다). */
import api from "./client";

export interface 푸시설정 {
  /** 공모주 청약 첫날·마지막 날 아침 알림 */
  ipo: boolean;
  /** 고른 증권사 — 그 증권사가 주관하는 공모주만. 비면 모두 */
  brokers: string[];
}

export const pushApi = {
  key: () => api.get<{ public_key: string }>("/push/key").then((r) => r.data.public_key),
  subscribe: (구독: PushSubscriptionJSON, 설정: 푸시설정) =>
    api.post<{ ok: boolean } & 푸시설정>("/push/subscribe", {
      endpoint: 구독.endpoint, keys: 구독.keys, ipo: 설정.ipo, brokers: 설정.brokers,
    }).then((r) => r.data),
  unsubscribe: (endpoint: string) =>
    api.post<{ ok: boolean }>("/push/unsubscribe", { endpoint }).then((r) => r.data),
  test: () => api.post<{ devices: number; sent: number }>("/push/test").then((r) => r.data),
};
