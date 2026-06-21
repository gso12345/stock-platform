import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui";
import {
  VALUE_METRIC_DEFS, QUALITY_METRIC_DEFS, MOMENTUM_METRIC_DEFS, GROWTH_METRIC_DEFS, RISK_METRIC_DEFS,
  type QuantWeights, type QuantFactorKey, type QuantEnabledMetrics,
} from "@/api/stocks";
import { QUANT_DEFAULT_WEIGHTS } from "@/hooks/useQuantSettings";

const FACTOR_LABEL_KO: Record<QuantFactorKey, string> = {
  value: "가치", quality: "품질", momentum: "모멘텀", growth: "성장", risk: "안정성",
};

const FACTOR_METRIC_GROUPS: readonly [QuantFactorKey, string, { key: string; label: string }[]][] = [
  ["value", "가치", VALUE_METRIC_DEFS],
  ["quality", "품질", QUALITY_METRIC_DEFS],
  ["momentum", "모멘텀", MOMENTUM_METRIC_DEFS],
  ["growth", "성장", GROWTH_METRIC_DEFS],
  ["risk", "안정성", RISK_METRIC_DEFS],
];

interface QuantSettingsPanelProps {
  weightsDraft: QuantWeights | null;
  metricsDraft: QuantEnabledMetrics | null;
  onUpdateWeight: (key: keyof QuantWeights, value: number) => void;
  onToggleMetric: (factor: QuantFactorKey, key: string, allKeys: string[]) => void;
  onReset: () => void;
  onSave: () => void;
  isSaving: boolean;
  isLoggedIn: boolean;
  saveMsg: string;
}

export default function QuantSettingsPanel({
  weightsDraft, metricsDraft, onUpdateWeight, onToggleMetric, onReset, onSave, isSaving, isLoggedIn, saveMsg,
}: QuantSettingsPanelProps) {
  const draft = weightsDraft ?? QUANT_DEFAULT_WEIGHTS;
  const draftSum = (Object.values(draft) as number[]).reduce((a, b) => a + b, 0);

  return (
    <div className="rounded-xl border border-border bg-bg-elevated p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-base font-semibold text-text-secondary">팩터별 가중치 (합계 {draftSum.toFixed(0)})</span>
        <button onClick={onReset} className="flex items-center gap-1 text-sm text-text-muted hover:text-text-primary">
          <RotateCcw size={11}/>기본값
        </button>
      </div>
      {(Object.keys(FACTOR_LABEL_KO) as QuantFactorKey[]).map((k) => (
        <div key={k} className="flex items-center gap-3">
          <span className="w-12 text-sm text-text-muted flex-shrink-0">{FACTOR_LABEL_KO[k]}</span>
          <input
            type="range" min={0} max={100} step={1} value={draft[k]}
            onChange={(e) => onUpdateWeight(k, Number(e.target.value))}
            className="flex-1 accent-accent-blue"
          />
          <input
            type="number" min={0} max={100} step={1} value={draft[k]}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (!Number.isNaN(v)) onUpdateWeight(k, Math.max(0, Math.min(100, v)));
            }}
            className="w-14 text-right text-sm font-mono text-text-primary flex-shrink-0 rounded-md border border-border bg-bg-primary px-1.5 py-0.5 focus:outline-none focus:border-accent-blue"
          />
        </div>
      ))}
      <p className="text-sm text-text-muted">가중치 합이 100이 아니어도 자동으로 비율에 맞춰 정규화됩니다.</p>

      <div className="border-t border-border pt-3 flex flex-col gap-3">
        <span className="text-base font-semibold text-text-secondary">팩터별 사용 지표 선택</span>
        {FACTOR_METRIC_GROUPS.map(([fkey, flabel, defs]) => {
          const allKeys = defs.map((d) => d.key);
          const selected = metricsDraft?.[fkey] ?? allKeys;
          return (
            <div key={fkey} className="flex flex-col gap-1.5">
              <span className="text-sm text-text-muted">{flabel}</span>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {defs.map((d) => (
                  <label key={d.key} className="flex items-center gap-1.5 text-sm text-text-primary cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selected.includes(d.key)}
                      onChange={() => onToggleMetric(fkey, d.key, allKeys)}
                      className="accent-accent-blue"
                    />
                    {d.label}
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        {saveMsg && <span className="text-sm text-text-muted">{saveMsg}</span>}
        <Button size="sm" variant="primary" disabled={!isLoggedIn || isSaving} onClick={onSave}>
          {isLoggedIn ? "내 기준으로 저장" : "로그인 후 저장 가능"}
        </Button>
      </div>
    </div>
  );
}
