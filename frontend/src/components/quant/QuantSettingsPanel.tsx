import { RotateCcw, X } from "lucide-react";
import { Button, Modal } from "@/components/ui";
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
  onClose: () => void;
  isSaving: boolean;
  isLoggedIn: boolean;
  saveMsg: string;
}

export default function QuantSettingsPanel({
  weightsDraft, metricsDraft, onUpdateWeight, onToggleMetric, onReset, onSave, onClose, isSaving, isLoggedIn, saveMsg,
}: QuantSettingsPanelProps) {
  const draft = weightsDraft ?? QUANT_DEFAULT_WEIGHTS;
  const draftSum = (Object.values(draft) as number[]).reduce((a, b) => a + b, 0);

  /* 관심종목 탭 관리·내 자산 계좌 관리·재무제표 지표 관리와 같은 창이다.
     예전에는 여기만 화면 안에서 펼쳐지는 패널이었고, 지표도 기본 체크박스라
     앱 안에서 혼자 다른 모양이었다. */
  return (
    <Modal maxWidth="max-w-md" onClose={onClose}>
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-border">
        <div>
          <h3 className="text-sm font-bold text-text-primary">퀀트 기준</h3>
          <p className="text-2xs text-text-dim mt-0.5">무엇을 얼마나 볼지 정합니다</p>
        </div>
        <button aria-label="닫기" onClick={onClose}>
          <X size={15} className="text-text-muted hover:text-text-primary" />
        </button>
      </div>

      <div className="px-4 py-4 flex flex-col gap-4 max-h-[65vh] overflow-y-auto">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-text-secondary">팩터별 가중치 <span className="font-normal text-text-dim">(합계 {draftSum.toFixed(0)})</span></span>
        <button onClick={onReset} className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary">
          <RotateCcw size={11}/>기본값
        </button>
      </div>
      {/* 줄마다 하나씩. 예전에는 다섯 개가 flex-wrap 으로 흩어져,
          좁은 화면에서 어느 슬라이더가 어느 팩터인지 눈이 헤맸다 */}
      <div className="flex flex-col gap-2">
        {(Object.keys(FACTOR_LABEL_KO) as QuantFactorKey[]).map((k) => (
          <div key={k} className="flex items-center gap-3">
            <span className="text-xs text-text-muted w-12 shrink-0">{FACTOR_LABEL_KO[k]}</span>
            <input
              type="range" min={0} max={100} step={1} value={draft[k]}
              aria-label={`${FACTOR_LABEL_KO[k]} 가중치`}
              onChange={(e) => onUpdateWeight(k, Number(e.target.value))}
              className="flex-1 accent-accent-blue"
            />
            <input
              type="number" min={0} max={100} step={1} value={draft[k]}
              aria-label={`${FACTOR_LABEL_KO[k]} 가중치 값`}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (!Number.isNaN(v)) onUpdateWeight(k, Math.max(0, Math.min(100, v)));
              }}
              className="w-12 text-right text-sm font-mono text-text-primary flex-shrink-0 rounded-md border border-border bg-bg-primary px-1.5 py-0.5 focus:outline-none focus:border-accent-blue"
            />
          </div>
        ))}
      </div>
      <p className="text-2xs text-text-dim">합이 100이 아니어도 비율에 맞춰 자동으로 맞춥니다</p>

      <div className="border-t border-border pt-4 flex flex-col gap-3">
        <span className="text-sm font-semibold text-text-secondary">팩터별 사용 지표</span>
        {FACTOR_METRIC_GROUPS.map(([fkey, flabel, defs]) => {
          const allKeys = defs.map((d) => d.key);
          const selected = metricsDraft?.[fkey] ?? allKeys;
          return (
            <div key={fkey} className="flex flex-col gap-1.5">
              <span className="text-2xs font-semibold text-text-muted">{flabel}</span>
              {/* 재무제표·차트 지표와 같은 칩이다. 예전에는 여기만 기본
                  체크박스라, 같은 '고르기' 인데 모양이 달랐다 */}
              <div className="flex flex-wrap gap-1.5">
                {defs.map((d) => {
                  const 골랐나 = selected.includes(d.key);
                  return (
                    <button
                      key={d.key}
                      aria-pressed={골랐나}
                      onClick={() => onToggleMetric(fkey, d.key, allKeys)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                        골랐나
                          ? "bg-accent-blue/85 border-accent-blue text-white"
                          : "border-border text-text-muted hover:text-text-primary"
                      }`}
                    >{d.label}</button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      </div>

      <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
        {saveMsg && <span className="text-xs text-text-muted">{saveMsg}</span>}
        <Button size="sm" variant="primary" disabled={!isLoggedIn || isSaving} onClick={onSave}>
          {isLoggedIn ? "내 기준으로 저장" : "로그인 후 저장 가능"}
        </Button>
      </div>
    </Modal>
  );
}
