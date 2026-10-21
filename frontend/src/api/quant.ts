/** 퀀트 점수 — 가중치·사용 지표 정의와 비교. 화면은 '@/api/stocks' 에서 가져간다(거기서 다시 내보낸다). */
import api from "./client";

export type QuantFactorKey = "value" | "quality" | "momentum" | "growth" | "risk";
export type QuantWeights = Record<QuantFactorKey, number>;
export type QuantEnabledMetrics = Partial<Record<QuantFactorKey, string[]>>;

// METRIC_DEFS(backend quant_score.py)와 동일 — 사용자가 팩터별로 사용할 지표를 고를 때 표시
export const VALUE_METRIC_DEFS: { key: string; label: string }[] = [
  { key: "per", label: "PER" },
  { key: "forward_per", label: "선행PER" },
  { key: "pbr", label: "PBR" },
  { key: "ev_ebitda", label: "EV/EBITDA" },
  { key: "peg", label: "PEG" },
];
export const QUALITY_METRIC_DEFS: { key: string; label: string }[] = [
  { key: "roe", label: "ROE" },
  { key: "roa", label: "ROA" },
  { key: "op_margin", label: "영업이익률" },
  { key: "net_margin", label: "순이익률" },
];
export const MOMENTUM_METRIC_DEFS: { key: string; label: string }[] = [
  { key: "mom_1m", label: "1개월 수익률" },
  { key: "mom_3m", label: "3개월 수익률" },
  { key: "mom_6m", label: "6개월 수익률" },
  { key: "mom_12m", label: "12개월 수익률" },
  { key: "ma60_dev", label: "60일 이평 이격도" },
  { key: "ma200_dev", label: "200일 이평 이격도" },
];
export const GROWTH_METRIC_DEFS: { key: string; label: string }[] = [
  { key: "revenue_growth", label: "매출성장률(YoY)" },
  { key: "net_income_growth", label: "순이익성장률(YoY)" },
  { key: "op_income_growth", label: "영업이익성장률(YoY)" },
];
export const RISK_METRIC_DEFS: { key: string; label: string }[] = [
  { key: "debt_ratio", label: "부채비율" },
  { key: "volatility", label: "연환산 변동성" },
];

export interface QuantMetric {
  key: string;
  label: string;
  value: number | null;
  score: number | null;
  unit: string;
  direction: "low" | "high";
}

export interface QuantFactor {
  key: QuantFactorKey;
  label: string;
  weight: number;
  score: number | null;
  metrics: QuantMetric[];
}

export interface QuantScoreResult {
  total_score: number | null;
  grade: string | null;
  factors: QuantFactor[];
  weights: QuantWeights;
  enabled_metrics: QuantEnabledMetrics;
}

export interface QuantCompareItem {
  symbol: string;
  market: string;
  total_score: number | null;
  grade: string | null;
  factors: QuantFactor[];
}

export interface QuantCompareResult {
  weights: QuantWeights;
  enabled_metrics: QuantEnabledMetrics;
  items: QuantCompareItem[];
}

export const quantScoreApi = {
  getWeights: () =>
    api.get<{ weights: QuantWeights; enabled_metrics: QuantEnabledMetrics; is_default: boolean }>("/stocks/quant-score/weights").then((r) => r.data),

  saveWeights: (weights: QuantWeights, enabledMetrics?: QuantEnabledMetrics) =>
    api.put<{ weights: QuantWeights; enabled_metrics: QuantEnabledMetrics }>("/stocks/quant-score/weights", { weights, enabled_metrics: enabledMetrics ?? {} }).then((r) => r.data),

  compare: (
    items: { symbol: string; market: string }[],
    weightOverride?: Partial<QuantWeights>,
    enabledMetricsOverride?: QuantEnabledMetrics,
  ) =>
    api.get<QuantCompareResult>("/stocks/quant-score/compare", {
      params: {
        symbols: items.map((i) => i.symbol).join(","),
        markets: items.map((i) => i.market).join(","),
        ...(weightOverride
          ? {
              w_value: weightOverride.value,
              w_quality: weightOverride.quality,
              w_momentum: weightOverride.momentum,
              w_growth: weightOverride.growth,
              w_risk: weightOverride.risk,
            }
          : {}),
        ...(enabledMetricsOverride
          ? {
              metrics_value: enabledMetricsOverride.value?.join(","),
              metrics_quality: enabledMetricsOverride.quality?.join(","),
              metrics_momentum: enabledMetricsOverride.momentum?.join(","),
              metrics_growth: enabledMetricsOverride.growth?.join(","),
              metrics_risk: enabledMetricsOverride.risk?.join(","),
            }
          : {}),
      },
    }).then((r) => r.data),
};
