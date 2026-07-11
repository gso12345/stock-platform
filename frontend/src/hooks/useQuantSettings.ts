import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { quantScoreApi, type QuantWeights, type QuantFactorKey, type QuantEnabledMetrics } from "@/api/stocks";

export const QUANT_DEFAULT_WEIGHTS: QuantWeights = { value: 25, quality: 25, momentum: 25, growth: 15, risk: 10 };

/** 퀀트점수 가중치/사용지표 설정 — 종목상세 퀀트탭과 퀀트랭킹 페이지가 동일한
 * 미리보기(디바운스) → 저장 흐름을 공유하도록 상태/로직을 한곳에 모음. */
export function useQuantSettings(serverWeights?: QuantWeights | null, serverEnabledMetrics?: QuantEnabledMetrics | null) {
  const qc = useQueryClient();
  const [weights, setWeights] = useState<QuantWeights | null>(null);
  const [weightsDraft, setWeightsDraft] = useState<QuantWeights | null>(null);
  const [metrics, setMetrics] = useState<QuantEnabledMetrics | null>(null);
  const [metricsDraft, setMetricsDraft] = useState<QuantEnabledMetrics | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const weightDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const metricsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (serverWeights && weightsDraft === null) setWeightsDraft(serverWeights);
    if (serverEnabledMetrics && metricsDraft === null) setMetricsDraft(serverEnabledMetrics);
  }, [serverWeights, serverEnabledMetrics, weightsDraft, metricsDraft]);

  const saveMutation = useMutation({
    mutationFn: ({ weights: w, metrics: m }: { weights: QuantWeights; metrics: QuantEnabledMetrics }) =>
      quantScoreApi.saveWeights(w, m),
    onSuccess: () => {
      setSaveMsg("저장됨");
      setTimeout(() => setSaveMsg(""), 2000);
      qc.invalidateQueries({ queryKey: ["quant-score"] });
      qc.invalidateQueries({ queryKey: ["quant-rankings"] });
    },
    onError: () => setSaveMsg("저장 실패"),
  });

  const updateWeight = (key: keyof QuantWeights, value: number) => {
    setWeightsDraft((prev) => {
      const next = { ...(prev ?? QUANT_DEFAULT_WEIGHTS), [key]: value };
      if (weightDebounceRef.current) clearTimeout(weightDebounceRef.current);
      weightDebounceRef.current = setTimeout(() => setWeights(next), 400);
      return next;
    });
  };

  const toggleMetric = (factor: QuantFactorKey, key: string, allKeys: string[]) => {
    setMetricsDraft((prev) => {
      const base = prev ?? {};
      const current = base[factor] ?? allKeys;
      const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
      const nextDraft: QuantEnabledMetrics = { ...base, [factor]: next.length === allKeys.length ? undefined : next };
      const cleaned: QuantEnabledMetrics = {};
      (Object.keys(nextDraft) as QuantFactorKey[]).forEach((fkey) => {
        const v = nextDraft[fkey];
        if (v) cleaned[fkey] = v;
      });
      if (metricsDebounceRef.current) clearTimeout(metricsDebounceRef.current);
      metricsDebounceRef.current = setTimeout(() => setMetrics(cleaned), 400);
      return cleaned;
    });
  };

  const resetToDefault = () => {
    setWeightsDraft(QUANT_DEFAULT_WEIGHTS);
    setWeights(QUANT_DEFAULT_WEIGHTS);
    setMetricsDraft({});
    setMetrics({});
  };

  return {
    weights, weightsDraft, metrics, metricsDraft,
    showSettings, setShowSettings, saveMsg,
    updateWeight, toggleMetric, resetToDefault,
    save: saveMutation,
  };
}
