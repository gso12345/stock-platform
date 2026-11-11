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
}

export const predictApi = {
  get: (market: Market, symbol: string) =>
    api.get<주가예측>(`/predict/${market}/${encodeURIComponent(symbol)}`).then((r) => r.data),
};
