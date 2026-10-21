/** 가격 알림. 화면은 '@/api/stocks' 에서 가져간다(거기서 다시 내보낸다). */
import api from "./client";

/** 걸어 둔 가격 알림 한 건 */
export interface 가격알림 {
  id: number;
  symbol: string;
  market: string;
  name: string;
  direction: "above" | "below";
  target: number;
  /** 걸던 순간의 시세 — "그때보다 얼마나 왔나"를 보여 주는 데 쓴다 */
  made_at_price: number | null;
  is_active: boolean;
  fired_at: string | null;
  fired_price: number | null;
}

export const alertsApi = {
  /** symbol 을 주면 그 종목 것만 */
  getAlerts: (symbol?: string) =>
    api.get<{ items: 가격알림[]; limit: number }>("/alerts",
      { params: symbol ? { symbol } : {} }).then((r) => r.data),
  createAlert: (payload: {
    symbol: string; market: string; name?: string;
    direction: "above" | "below"; target: number;
  }) => api.post<가격알림>("/alerts", payload).then((r) => r.data),
  /** 켜져 있으면 끄고, 꺼져 있으면 켠다 */
  toggleAlert: (id: number) =>
    api.patch<가격알림>(`/alerts/${id}`).then((r) => r.data),
  /** 목표가·방향을 바꾼다. 지우고 다시 거는 대신 한 번에 */
  editAlert: (id: number, payload: { direction: "above" | "below"; target: number }) =>
    api.put<가격알림>(`/alerts/${id}`, payload).then((r) => r.data),
  deleteAlert: (id: number) =>
    api.delete(`/alerts/${id}`).then((r) => r.data),
};
