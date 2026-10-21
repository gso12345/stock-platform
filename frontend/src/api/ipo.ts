/** 공모주 — 상장일 시초가 예측. 화면은 '@/api/stocks' 에서 가져간다(거기서 다시 내보낸다). */
import api from "./client";

/* ── 공모주 — 상장일 시초가 예측 ───────────────────────────── */
/** 비슷했던 과거 공모주 한 줄. ratio 는 시초가 ÷ 공모가 */
export interface 공모주이웃 {
  name: string;
  code: string | null;
  list_date: string;
  ratio: number;
  inst_ratio: number | null;
  lockup_pct: number | null;
  sub_ratio: number | null;
  offer_price: number | null;
  open_price: number | null;
}

export type 공모주예측 =
  | { ok: false; reason: string }
  | {
      ok: true;
      group: "normal" | "spac" | "reit";
      /** 예상 시초가 ÷ 공모가 */
      ratio: number;
      /** 예상 시초가(원) — 첫날 범위(60~400%) 안, 호가 단위에 맞춘 값 */
      price: number;
      return_pct: number;
      /** 비슷했던 공모주 가운데 절반이 시작한 범위 */
      range: { low_ratio: number; high_ratio: number; low_price: number; high_price: number };
      /** 비슷했던 공모주 중 2배 이상으로 시작한 몫 / 공모가 아래로 시작한 몫 */
      p_double: number;
      p_below: number;
      neighbors: 공모주이웃[];
      /** 견줄 때 쓴 항목 / 아직 없어서 못 쓴 항목 (화면 이름) */
      used: string[];
      missing: string[];
      n_train: number;
      /** correction_pct — 최근 오차 보정으로 올리거나(+) 내린(−) 몫(%). 보정 없는 방식이면 0 */
      parts: { neighbors_ratio: number; regression_ratio: number | null; correction_pct?: number };
      /** 맞힌 방식 — 일반 공모주만. 스팩·리츠와 예전 서버는 없다 */
      method?: { key: string; name: string };
    };

export interface 다가오는공모주 {
  name: string;
  code: string | null;
  market: string | null;
  kind: "normal" | "spac" | "reit" | null;
  forecast_date: string | null;
  band_low: number | null;
  band_high: number | null;
  offer_price: number | null;
  /** 공모금액(백만원) */
  offer_amount: number | null;
  inst_ratio: number | null;
  lockup_pct: number | null;
  sub_start: string | null;
  sub_end: string | null;
  sub_ratio: number | null;
  list_date: string | null;
  underwriter: string | null;
  /** 상세 페이지에서 읽은 값 — 못 읽었거나 아직 안 나왔으면 null(예전 서버는 없다) */
  float_pct?: number | null;      // 상장일 유통가능물량(%)
  equal_shares?: number | null;   // 균등 배정 수량(계좌당 주)
  sub_accounts?: number | null;   // 청약 건수
  prop_ratio?: number | null;     // 비례 경쟁률(:1)
  old_pct?: number | null;        // 구주매출 비중(%)
  stage: string;
  prediction: 공모주예측;
}

/** 최근 상장 — 그 전에 상장한 것만으로 맞혀 본 값과 실제 */
export interface 공모주결과 {
  name: string;
  code: string | null;
  list_date: string;
  offer_price: number;
  open_price: number;
  actual_ratio: number;
  pred_ratio: number;
  /** 예측 시초가(원) — 호가 단위에 맞춘 값 */
  pred_price: number;
  /** 실제 시초가 ÷ 예측 시초가 − 1 (%, 정수) */
  diff_pct: number;
  /** |diff_pct| 가 accuracy.hit_band_pct 안 */
  hit: boolean;
  /** 이 줄을 맞힌 방식(accuracy.methods 의 key) — 그 줄 상장일 전에 가장 잘 맞아 온 것 */
  method?: string;
}

/** 따블 확률 점검 — 구간(from~to %)마다 곳 수, 예측한 따블 확률의 평균, 실제로 따블이었던 비율 */
export interface 공모주따블점검 {
  n: number;
  bins: { from: number; to: number; n: number; predicted: number; actual: number }[];
  predicted: number | null;
  actual: number | null;
}

/** 청약 전에 본 예측의 성적 — 같은 공모주들을 청약 결과 없이 맞혔을 때 */
export interface 공모주청약전성적 {
  n: number;
  hit_rate: number | null;
  median_abs_diff_pct: number | null;
  direction_hit: number | null;
}

/** 방식 하나로만 같은 줄들을 맞혔을 때의 성적 */
export interface 공모주방식성적 {
  key: string;
  name: string;
  hit_rate: number | null;
  median_abs_diff_pct: number | null;
}

export interface 공모주한눈에 {
  as_of: string | null;
  upcoming: 다가오는공모주[];
  recent: 공모주결과[];
  accuracy: {
    n: number;
    /** 맞힘으로 보는 폭 — 실제 시초가가 예측 시초가의 ±이만큼(%) 안 */
    hit_band_pct: number;
    /** 예측 시초가와 실제 시초가 차이(%)의 중앙값 */
    median_abs_diff_pct: number | null;
    /** 공모가 위/아래를 맞힌 몫 */
    direction_hit: number | null;
    /** ±hit_band_pct 안에 든 몫 */
    hit_rate: number | null;
    /** 지금 다가오는 공모주를 맞히는 방식 — 직전 pick_window 곳에서 가장 잘 맞아 온 것. 예전 서버는 없다 */
    method?: { key: string; name: string; pick_window: number };
    methods?: 공모주방식성적[];
    /** 청약 전에 본 예측(청약경쟁률·균등 없이 맞힌 값)의 성적 — 청약할지 정할 때 믿을 만한 정도. 예전 서버는 없다 */
    pre_sub?: 공모주청약전성적;
    /** 따블 확률 점검 — 예측한 따블 확률을 구간으로 묶어 실제 따블 비율과 견준 것. 예전 서버는 없다 */
    double_check?: 공모주따블점검;
  };
  train_since: string;
  n_records: number;
  n_results: number;
  source: { name: string; lists: Record<string, { rows: number; reason: string }> };
  /** 서버가 뒤에서 자료를 새로 받는 중 */
  refreshing: boolean;
}

export interface 공모주직접입력 {
  offer_price: number;
  inst_ratio: number;
  lockup_pct: number;
  sub_ratio?: number | null;
  band_low?: number | null;
  band_high?: number | null;
  /** 공모금액(억원) */
  offer_amount_eok?: number | null;
  /** 상세 항목 — 상장일 유통가능물량(%) · 균등 배정(계좌당 주) · 구주매출 비중(%) */
  float_pct?: number | null;
  equal_shares?: number | null;
  old_pct?: number | null;
  kind?: "normal" | "spac" | "reit";
}

export const ipoApi = {
  overview: () => api.get<공모주한눈에>("/ipo").then((r) => r.data),
  predict: (body: 공모주직접입력) => api.post<공모주예측>("/ipo/predict", body).then((r) => r.data),
};
