/** 대시보드 — 지수·환율·순위·급등락. 화면은 '@/api/stocks' 에서 가져간다(거기서 다시 내보낸다). */
import api from "./client";
import type { OHLCV, 뉴스항목, 지표카드, 순위행, 대시보드응답, MarketIndex } from "@/types";

export const dashboardApi = {
  getIndices: () =>
    api.get<{ kr: MarketIndex[]; us: MarketIndex[] }>("/dashboard/indices").then((r) => r.data),

  /* 순위 기준(category)을 안 보낸다.
     이 응답에 순위표가 들어 있었는데, 화면은 그걸 한 군데서도 안 읽고
     getRankings 로 따로 받는다 — 기준을 바꿔 가며 봐야 하기 때문이다.
     그래서 서버가 같은 순위표를 두 번 만들고, 그중 한 번은 만들자마자
     버려지는 20KB 였다. 서버에서 뺐고, 여기서도 안 보낸다. */
  getKR: () =>
    api.get<대시보드응답>("/dashboard/kr", { params: { include_news: false } }).then((r) => r.data),

  getUS: () =>
    api.get<대시보드응답>("/dashboard/us", { params: { include_news: false } }).then((r) => r.data),

  getRankings: (market: "kr" | "us", category = "시가총액") =>
    api.get<순위행[]>(`/dashboard/rankings/${market}`, { params: { category } }).then((r) => r.data),

  /** 정렬은 서버가 처리한다 — 인기도 점수는 내부 계산값이라 응답에 싣지 않는다 */
  getNews: (market: "kr" | "us", sort: "latest" | "popular" = "latest") =>
    api.get<뉴스항목[]>(`/dashboard/news/${market}`, { params: { sort } }).then((r) => r.data),

  getIndexDetail: (name: string) =>
    api.get(`/dashboard/index/${name}`).then((r) => r.data),

  getIndexOHLCV: (name: string, period = "1y", interval = "1d") =>
    api.get<OHLCV[]>(`/dashboard/index/${name}/ohlcv`, { params: { period, interval } }).then((r) => r.data),

  getKRExtras: () =>
    api.get("/dashboard/kr/extras").then((r) => r.data),

  getUSRates: () =>
    api.get<지표카드[]>("/dashboard/us/rates").then((r) => r.data),

  getExchangeRate: () =>
    api.get<지표카드>("/dashboard/exchange").then((r) => r.data),

  getTopMovers: () =>
    api.get<{ risers: 순위행[]; fallers: 순위행[] }>("/dashboard/top-movers").then((r) => r.data),
};
