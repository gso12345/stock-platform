/**
 * 주가예측 — 서버는 backend/app/api/routes/predict.py · services/predict/forecast.py.
 *
 * 숫자 하나가 아니라 범위(80%·50%)와 확률을 준다. 같은 방식으로 지난 3년을 매주 예측해 실제 주가가 범위 안에 든
 * 비율(check)도 같이 온다 — 화면은 그걸 '이 방식이 이 종목에서 얼마나 맞았나' 로 보여 준다.
 */
import api from "./client";
import type { Market } from "@/types";

export interface 예측분위 { q10: number; q25: number; q50: number; q75: number; q90: number }

/** 지난 3년 매주, 그날까지의 자료만으로 같은 셈을 해 본 결과 */
export interface 예측검증 {
  n: number;
  /** 실제 주가가 80% 범위 안에 든 비율 */
  in80: number;
  in50: number;
  /** 80% 범위 위·아래로 벗어난 비율 */
  above80: number;
  below80: number;
  /** 겹치지 않는 기간 수 — 1년 뒤 예측은 매주 셈해도 서로 크게 겹친다 */
  periods: number;
  from: string;
  to: string;
}

export interface 예측기간 extends 예측분위 {
  days: number;
  label: string;
  /** 그 날(어림 — 주말만 건너뛰었다) */
  date: string;
  up: number;
  up10: number;
  down10: number;
  check: 예측검증 | null;
}

/** 지금과 같은 상태였던 날들 가운데 그 기간 뒤 주가가 올라 있던 비율(cond)과 모든 날의 비율(base) */
export interface 근거비율 { cond: number | null; n: number; base: number; total: number }
type 비율표 = Record<string, 근거비율 | null>;

export type 예측근거 =
  | { key: "trend"; state: "above" | "below"; price: number; ma200: number; rates: 비율표 }
  | { key: "momentum"; state: "up" | "down"; ret: number; rates: 비율표 }
  | { key: "rsi"; state: "hot" | "cold" | "normal"; value: number; rates: 비율표 };

/** 기술적 분석 예측 — 공모주 예측처럼(backend/app/services/predict/technical.py) */
export type 기술방식 = "knn" | "ridge" | "mid" | "flat";

export interface 기술방식성적 {
  key: 기술방식;
  label: string;
  /** 평균 오차(가격 대비 비율) */
  mae: number;
  /** 방향을 맞힌 비율 — '그대로' 는 없다 */
  direction: number | null;
}

export interface 기술검증 {
  n: number;
  from: string;
  to: string;
  periods: number;
  /** 비슷했던 때의 가운데 절반 범위에 실제로 든 비율 */
  in50: number;
  /** 지난 3년 가장 잘 맞아 온 기술적 방식 */
  best: 기술방식;
  /** 그대로보다 덜 틀린 비율(음수면 더 틀렸다) */
  gain: number;
  t: number;
  /** 그대로보다 확실히 나았나 */
  beats_flat: boolean;
  methods: 기술방식성적[];
}

export interface 비슷했던때 {
  date: string;
  /** 그 뒤 그 기간 동안의 변화(비율) */
  change: number;
  rsi: number | null;
  /** 그때 200일선 이격도(비율) */
  gap200: number | null;
}

export interface 기술예측기간 {
  days: number;
  label: string;
  date: string;
  method: 기술방식;
  method_label: string;
  /** 예상 주가 — 가장 잘 맞아 온 방식 */
  predicted: number;
  knn: number;
  ridge: number;
  /** 비슷했던 때의 가운데 절반 */
  range: [number, number];
  up: number;
  up10: number;
  down10: number;
  neighbor_count: number;
  neighbors: 비슷했던때[];
  check: 기술검증 | null;
}

export interface 기술지표 { key: string; label: string; value: number | null; used: boolean }

export interface 기술예측 {
  horizons: 기술예측기간[];
  indicators: 기술지표[];
  /** 견준 시장 — 지수를 못 받았으면 없다 */
  market: string | null;
  neighbors_k: number;
  min_gap_days: number;
}

export interface 주가예측 {
  symbol: string;
  market: Market;
  name: string;
  currency: "KRW" | "USD";
  as_of: string;
  price: number;
  days_used: number;
  /** 연 변동성 — 지금(최근에 무게)·평소(3년) */
  volatility: { now: number; long: number };
  /** 가운데로 가정한 연 기대 수익 */
  expected_return: number;
  horizons: 예측기간[];
  path: ({ day: number; date: string } & 예측분위)[];
  history: { date: string; close: number }[];
  signals: 예측근거[];
  method: { lambda: number; half_life_days: number; window_days: number; prior_return: number; check_step_days: number };
  /** 기술적 분석 예측(1주·1개월·3개월) — 시세가 모자라거나 셈하지 못했으면 null */
  technical?: 기술예측 | null;
}

export const predictApi = {
  get: (market: Market, symbol: string) =>
    api.get<주가예측>(`/predict/${market}/${encodeURIComponent(symbol)}`).then((r) => r.data),
};
