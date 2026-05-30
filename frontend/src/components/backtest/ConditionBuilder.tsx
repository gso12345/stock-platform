import { Plus, Trash2 } from "lucide-react";
import type { Condition, ConditionGroup } from "@/types";

const INDICATOR_GROUPS = [
  {
    label: "추세",
    items: [
      { value: "MA", label: "단순이동평균 (MA)", hasPeriod: true, periodOptions: [5, 10, 20, 60, 120, 200] },
      { value: "EMA", label: "지수이동평균 (EMA)", hasPeriod: true, periodOptions: [5, 10, 20, 60, 120, 200] },
      { value: "MACD", label: "MACD 라인", hasPeriod: false },
      { value: "MACD_SIGNAL", label: "MACD 시그널", hasPeriod: false },
      { value: "MACD_HIST", label: "MACD 히스토그램", hasPeriod: false },
    ],
  },
  {
    label: "모멘텀",
    items: [
      { value: "RSI", label: "RSI (14)", hasPeriod: false },
      { value: "STOCH_K", label: "스토캐스틱 %K", hasPeriod: false },
      { value: "STOCH_D", label: "스토캐스틱 %D", hasPeriod: false },
      { value: "CCI", label: "CCI (20)", hasPeriod: false },
      { value: "WILLR", label: "Williams %R", hasPeriod: false },
      { value: "ROC_1", label: "가격변화율 1일", hasPeriod: false },
      { value: "ROC_5", label: "가격변화율 5일", hasPeriod: false },
      { value: "ROC_20", label: "가격변화율 20일", hasPeriod: false },
    ],
  },
  {
    label: "변동성",
    items: [
      { value: "BB_UPPER", label: "볼린저 상단", hasPeriod: false },
      { value: "BB_LOWER", label: "볼린저 하단", hasPeriod: false },
      { value: "BB_MID", label: "볼린저 중단", hasPeriod: false },
      { value: "BB_PCT", label: "볼린저 %B (0~1)", hasPeriod: false },
      { value: "ATR", label: "ATR (14)", hasPeriod: false },
      { value: "ATR_PCT", label: "ATR % (변동성%)", hasPeriod: false },
    ],
  },
  {
    label: "거래량",
    items: [
      { value: "VOLUME", label: "거래량", hasPeriod: false },
      { value: "VOL_MA", label: "거래량 MA (20)", hasPeriod: false },
      { value: "VOL_RATIO", label: "거래량 비율 (현재/MA)", hasPeriod: false },
      { value: "OBV", label: "OBV", hasPeriod: false },
      { value: "OBV_MA", label: "OBV MA (20)", hasPeriod: false },
    ],
  },
  {
    label: "가격",
    items: [
      { value: "PRICE", label: "종가", hasPeriod: false },
      { value: "OPEN", label: "시가", hasPeriod: false },
      { value: "HIGH", label: "고가", hasPeriod: false },
      { value: "LOW", label: "저가", hasPeriod: false },
      { value: "PCT_FROM_HIGH", label: "52주 고점 대비 (%)", hasPeriod: false },
      { value: "PCT_FROM_LOW", label: "52주 저점 대비 (%)", hasPeriod: false },
    ],
  },
];

const CROSS_OPERATORS = [
  { value: ">", label: ">" },
  { value: "<", label: "<" },
  { value: ">=", label: ">=" },
  { value: "<=", label: "<=" },
  { value: "==", label: "==" },
  { value: "crosses_above", label: "골든크로스 ↑" },
  { value: "crosses_below", label: "데드크로스 ↓" },
];

const INDICATOR_OPTIONS_FLAT = INDICATOR_GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label })));

function findIndicator(value: string) {
  return INDICATOR_OPTIONS_FLAT.find((i) => i.value === value);
}

interface Props {
  label: string;
  color?: "blue" | "red";
  group: ConditionGroup;
  onChange: (g: ConditionGroup) => void;
}

export function ConditionBuilder({ label, color = "blue", group, onChange }: Props) {
  const addCondition = () => {
    onChange({
      ...group,
      conditions: [...group.conditions, { indicator: "MA", operator: ">", value: 0, period: 20 }],
    });
  };

  const update = (i: number, patch: Partial<Condition>) => {
    onChange({ ...group, conditions: group.conditions.map((c, idx) => idx === i ? { ...c, ...patch } : c) });
  };

  const remove = (i: number) => {
    onChange({ ...group, conditions: group.conditions.filter((_, idx) => idx !== i) });
  };

  const accentColor = color === "blue" ? "text-accent-blue border-accent-blue/30 bg-accent-blue/10" : "text-accent-red border-accent-red/30 bg-accent-red/10";
  const dotColor = color === "blue" ? "bg-accent-blue" : "bg-accent-red";

  return (
    <div className="flex flex-col gap-3">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${dotColor}`} />
          <span className="text-sm font-semibold text-text-primary">{label}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-text-muted">논리:</span>
          <div className="flex gap-0.5 bg-bg-primary border border-border rounded-lg p-0.5">
            {(["AND", "OR"] as const).map((l) => (
              <button
                key={l}
                onClick={() => onChange({ ...group, logic: l })}
                className={`px-2 py-0.5 text-[11px] font-bold rounded-md transition-all ${
                  group.logic === l ? "bg-accent-blue text-white" : "text-text-muted"
                }`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 조건 목록 */}
      {group.conditions.map((cond, i) => {
        const meta = findIndicator(cond.indicator);
        return (
          <div key={i} className="grid grid-cols-[auto_1fr_auto_1fr_auto] gap-1.5 items-center p-2 bg-bg-primary rounded-xl border border-border">
            {/* 지표 선택 */}
            <select
              className="bg-bg-secondary border border-border rounded-lg px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent-blue"
              value={cond.indicator}
              onChange={(e) => update(i, { indicator: e.target.value as any })}
            >
              {INDICATOR_GROUPS.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.items.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>

            {/* 기간 (MA/EMA) */}
            {meta?.hasPeriod ? (
              <select
                className="bg-bg-secondary border border-border rounded-lg px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent-blue"
                value={cond.period ?? 20}
                onChange={(e) => update(i, { period: Number(e.target.value) })}
              >
                {(meta.periodOptions ?? [5, 10, 20, 60, 120, 200]).map((p) => (
                  <option key={p} value={p}>{p}일</option>
                ))}
              </select>
            ) : <div />}

            {/* 연산자 */}
            <select
              className="bg-bg-secondary border border-border rounded-lg px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent-blue min-w-[100px]"
              value={cond.operator}
              onChange={(e) => update(i, { operator: e.target.value as any })}
            >
              {CROSS_OPERATORS.map((op) => (
                <option key={op.value} value={op.value}>{op.label}</option>
              ))}
            </select>

            {/* 값 또는 다른 지표 */}
            <div className="flex gap-1">
              <input
                type="text"
                className="flex-1 bg-bg-secondary border border-border rounded-lg px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent-blue"
                placeholder="숫자 또는 지표"
                value={cond.value as string}
                onChange={(e) => update(i, { value: isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value) })}
              />
            </div>

            {/* 삭제 */}
            <button onClick={() => remove(i)} className="text-text-muted hover:text-accent-red transition-colors p-1">
              <Trash2 size={13} />
            </button>
          </div>
        );
      })}

      <button
        onClick={addCondition}
        className="flex items-center gap-1.5 text-xs text-accent-blue hover:text-blue-400 transition-colors py-1"
      >
        <Plus size={13} />
        조건 추가
      </button>

      {/* 예시 힌트 */}
      {group.conditions.length === 0 && (
        <div className="text-xs text-text-muted bg-bg-primary rounded-xl p-3 border border-border/50">
          <p className="font-medium text-text-secondary mb-1">예시 조건</p>
          <div className="flex flex-wrap gap-1.5">
            {[
              "RSI < 30 (과매도)",
              "MA_20 crosses_above MA_60 (골든크로스)",
              "MACD_HIST > 0",
              "BB_PCT < 0.2 (하단 근접)",
              "VOL_RATIO > 2 (거래량 급증)",
            ].map((ex) => (
              <span key={ex} className="px-2 py-0.5 bg-bg-secondary rounded border border-border text-text-muted">
                {ex}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
