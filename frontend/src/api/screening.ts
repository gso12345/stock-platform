/** 스크리닝 — 조건 검색과 저장한 보기. 화면은 '@/api/stocks' 에서 가져간다(거기서 다시 내보낸다). */
import api, { 무거운상한 } from "./client";
import type { ScreeningFilter } from "@/types";

export const screeningApi = {
  run: (payload: 스크리닝요청): Promise<스크리닝응답> =>
    /* 처음 한 번은 종목 수백 개의 1년 시세를 새로 받아 수십 초가 걸린다
       (그 뒤 30분은 종목별로 기억해 빠르다). 기본 시한이면 서버가 아직
       받는 중인데 화면이 '실패' 를 띄운다 — 백테스트와 같은 무거운상한을 쓴다 */
    api.post("/screening/run", payload, { timeout: 무거운상한 }).then((r) => r.data),

  getPresets: () =>
    api.get("/screening/presets").then((r) => r.data),

  savePreset: (payload: 스크리닝저장) =>
    api.post("/screening/presets", payload).then((r) => r.data),

  deletePreset: (id: number) =>
    api.delete(`/screening/presets/${id}`).then((r) => r.data),

  /** 종목 몇 개의 스크리닝 표 줄 — 관심종목 PC 표가 시가총액·PER·배당·52주 위치·수익률을 붙인다.
   *  열쇠는 '시장:종목'. 서버 표가 아직 없는 시장의 종목은 빠진다 */
  rows: (items: { symbol: string; market: string }[]): Promise<{ rows: Record<string, 관심지표> }> =>
    api.post("/screening/rows", { items }).then((r) => r.data),
};

/** 관심종목 PC 표의 칸 — 서버 관심칸 */
export interface 관심지표 {
  market_cap?: number;
  per?: number;
  forward_per?: number;
  pbr?: number;
  dividend_yield?: number;
  pct_from_52w_high?: number;
  return_1m?: number;
  return_1y?: number;
  sector?: string;
  industry?: string;
  currency?: string;
}

/** 스크리닝 한 번 — 서버 ScreeningRequest 와 같은 모양 */
export interface 스크리닝요청 {
  market: string;
  filters: ScreeningFilter;
  sort_by: string;
  sort_order: string;
  limit: number;
  /** 몇 번째 줄부터 — 결과가 수천 곳이라 쪽마다 limit 줄씩 */
  offset?: number;
  /** 티커·이름으로 찾기 — 'AAPL, MSFT' 처럼 쉼표로 여럿 */
  q?: string;
}

/** 스크리닝 표 한 줄 — 서버 스크리닝줄. 숫자 칸은 서버의 스크리닝_숫자키, 글자 칸은 스크리닝_글자키 */
export interface 스크리닝줄 {
  symbol: string;
  name?: string;
  market: string;
  /** 시세 돈(주가·시가총액·최근 1년 실적) */
  currency?: string;
  /** 회사 장부의 돈 — 4년 흐름(rev_hist·eps_hist)이 이 돈이다 */
  fin_currency?: string;
  /** 회사 누리집 주소 — 화면이 로고를 그 아이콘으로 */
  domain?: string | null;
  fin_years?: number[];
  [칸: string]: unknown;
}

export interface 스크리닝응답 {
  results: 스크리닝줄[];
  /** 조건에 맞는 종목 수(results 는 그중 offset 번째부터 limit 개) */
  total: number;
  /** results 가 몇 번째 줄부터인가 — 상장된 모든 종목이라 한 쪽씩 넘긴다 */
  offset?: number;
  /** 국가·섹터·산업·거래소 조건에 고를 값 — 그 시장 전체에 실제로 있는 것만 */
  facets?: { country?: string[]; sector?: string[]; industry?: string[]; exchange?: string[] };
  /** 서버가 그 시장을 처음 받는 중이면 {물어본 종목 수, 전체 종목 수} — results 는 받은 것까지만 */
  building?: { done: number; total: number } | null;
  /** 시장 자료가 없는데 야후에서 한 줄도 못 받았다 — '맞는 종목 없음' 이 아니다 */
  failed?: boolean;
  /** 시세가 언제 것인가(유닉스 초) — 서버가 5분마다 묶음 시세로 새로 받는다 */
  as_of?: number | null;
}

/** 저장해 두는 스크리닝 보기 한 벌 — 서버 PresetSaveRequest 와 같은 모양 */
export interface 스크리닝저장 {
  name: string;
  market: string;
  filters: ScreeningFilter;
  sort_by: string;
  sort_order: "asc" | "desc";
  /** 보이는 칸들 — 없으면 화면의 처음 칸 */
  columns?: string[];
}
