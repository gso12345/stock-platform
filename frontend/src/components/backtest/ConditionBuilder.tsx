import { Tabs, 지움단추 } from "@/components/ui";
import { Plus } from "lucide-react";
import type { Condition, ConditionGroup } from "@/types";

/* 이름은 **칸 안에 들어갈 만큼** 짧게 둔다.
 *
 *  고르기 칸(select)은 고른 항목의 글자 그대로 넓어진다. '단순이동평균
 *  (MA)' 처럼 길면 그 칸 하나가 150px 을 먹고, 390px 짜리 폰에서는
 *  뒤의 값과 삭제 단추가 통째로 화면 밖으로 밀린다(실측 149px 넘침).
 *  값을 못 보고 지울 수도 없으니, 조건을 만들다 만 채로 끝난다.
 *
 *  무리 이름(추세·모멘텀…)이 이미 갈래를 말해 주므로 항목은 통용되는
 *  줄임말이면 충분하다 — MA·EMA·RSI 는 그 자체로 읽힌다. */
const INDICATOR_GROUPS = [
  {
    label: "추세",
    items: [
      { value: "MA", label: "MA 이동평균", hasPeriod: true, periodOptions: [5, 10, 20, 60, 120, 200] },
      { value: "EMA", label: "EMA 지수이평", hasPeriod: true, periodOptions: [5, 10, 20, 60, 120, 200] },
      { value: "MACD", label: "MACD 라인", hasPeriod: false },
      { value: "MACD_SIGNAL", label: "MACD 시그널", hasPeriod: false },
      { value: "MACD_HIST", label: "MACD 히스토", hasPeriod: false },
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
      { value: "ROC_1", label: "변화율 1일", hasPeriod: false },
      { value: "ROC_5", label: "변화율 5일", hasPeriod: false },
      { value: "ROC_20", label: "변화율 20일", hasPeriod: false },
    ],
  },
  {
    label: "변동성",
    items: [
      { value: "BB_UPPER", label: "볼린저 상단", hasPeriod: false },
      { value: "BB_LOWER", label: "볼린저 하단", hasPeriod: false },
      { value: "BB_MID", label: "볼린저 중단", hasPeriod: false },
      { value: "BB_PCT", label: "볼린저 %B", hasPeriod: false },
      { value: "ATR", label: "ATR (14)", hasPeriod: false },
      { value: "ATR_PCT", label: "ATR %", hasPeriod: false },
    ],
  },
  {
    label: "거래량",
    items: [
      { value: "VOLUME", label: "거래량", hasPeriod: false },
      { value: "VOL_MA", label: "거래량 MA (20)", hasPeriod: false },
      { value: "VOL_RATIO", label: "거래량 비율", hasPeriod: false },
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
      { value: "PCT_FROM_HIGH", label: "52주 고점比", hasPeriod: false },
      { value: "PCT_FROM_LOW", label: "52주 저점比", hasPeriod: false },
    ],
  },
];

const CROSS_OPERATORS = [
  { value: ">", label: ">" },
  { value: "<", label: "<" },
  { value: ">=", label: ">=" },
  { value: "<=", label: "<=" },
  { value: "==", label: "==" },
  { value: "crosses_above", label: "↑ 돌파" },
  { value: "crosses_below", label: "↓ 이탈" },
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

  const dotColor = color === "blue" ? "bg-accent-blue" : "bg-accent-red";

  return (
    <div className="flex flex-col gap-3">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${dotColor}`} />
          <span className="text-sm font-semibold text-text-primary">{label}</span>
        </div>
        {/* 조건이 하나뿐이면 AND/OR 는 **아무 뜻이 없다.**
            무엇과 무엇을 잇는지가 없는데 조작칸만 있으면, 눌러 보고
            아무 일도 안 일어나는 것을 확인하게 된다. 둘 이상일 때만
            보여 주면 줄 하나가 통째로 줄고 뜻도 분명해진다. */}
        <div className={`flex items-center gap-2 ${group.conditions.length > 1 ? "" : "hidden"}`}>
          <span className="text-xs text-text-muted">논리:</span>
          {/* 손으로 만든 분절 토글 대신 공용 Tabs 를 쓴다.
              이 부품의 subtle 모양이 바로 이 용도다 — 테두리 안에서
              고른 것만 떠오르는, 한 화면에 여러 개가 있어도 서로
              다투지 않는 모양. 손으로 만들면 크기와 색이 또 갈린다. */}
          <Tabs
            tabs={[{ id: "AND", label: "AND" }, { id: "OR", label: "OR" }]}
            active={group.logic}
            onChange={(id) => onChange({ ...group, logic: id as "AND" | "OR" })}
            tone="subtle" size="xs" fill={false} ariaLabel="조건 논리"
          />
        </div>
      </div>

      {/* 조건 목록 */}
      {group.conditions.map((cond, i) => {
        const meta = findIndicator(cond.indicator);
        return (
          /* 칸이 다섯인 **고정 그리드**였다. 폰(390px)에서는 다섯이
             절대 안 들어가는데 그리드는 줄이지도 접지도 않아서, 값과
             삭제 단추가 화면 밖으로 149px 밀려 나갔다(실측). 가로
             스크롤 막대도 없으니 거기 뭔가 더 있는 줄도 모른다.

             게다가 기간이 없는 지표(RSI 등)에도 빈 칸(<div/>)을 두고
             있어서, 줄의 1/3 이 아무것도 아닌 것으로 채워졌다.

             flex-wrap 으로 바꾼다 — 들어가면 한 줄, 안 들어가면 접힌다.
             잘려서 못 보는 것보다 접혀서 다 보이는 쪽이 낫다. 기간
             칸은 필요할 때만 그린다. */
          <div key={i} className="flex flex-wrap items-center gap-1.5 p-2 bg-bg-primary rounded-xl border border-border">
            {/* 지표 선택 — 남는 자리를 갖되 **줄어들 수도** 있어야 한다.
                min-w-0 이 없으면 글자 길이만큼 버텨서 옆을 밀어낸다. */}
            <select
              className="flex-1 min-w-0 basis-[6rem] bg-bg-secondary border border-border rounded-lg px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent-blue"
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

            {/* 기간 (MA/EMA) — **필요할 때만** 그린다.
                빈 칸을 두면 RSI 처럼 기간이 없는 지표에서도 자리를
                차지해, 정작 값 칸이 좁아진다. */}
            {meta?.hasPeriod && (
              <select
                className="w-[3.9rem] flex-shrink-0 bg-bg-secondary border border-border rounded-lg px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent-blue"
                value={cond.period ?? 20}
                onChange={(e) => update(i, { period: Number(e.target.value) })}
              >
                {(meta.periodOptions ?? [5, 10, 20, 60, 120, 200]).map((p) => (
                  <option key={p} value={p}>{p}일</option>
                ))}
              </select>
            )}

            {/* 연산자 — 글자가 제일 긴 '↑ 상향돌파' 에 맞춘 고정 너비.
                늘었다 줄었다 하면 줄마다 칸 자리가 달라 읽기 어렵다. */}
            <select
              className="w-[4.6rem] flex-shrink-0 bg-bg-secondary border border-border rounded-lg px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent-blue"
              value={cond.operator}
              onChange={(e) => update(i, { operator: e.target.value as any })}
            >
              {CROSS_OPERATORS.map((op) => (
                <option key={op.value} value={op.value}>{op.label}</option>
              ))}
            </select>

            {/* 값 또는 다른 지표 */}
            <div className="flex gap-1 flex-1 min-w-0 basis-[3.5rem]">
              <input
                type="text"
                className="flex-1 min-w-0 bg-bg-secondary border border-border rounded-lg px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent-blue"
                placeholder="값/지표"
                value={cond.value as string}
                onChange={(e) => update(i, { value: isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value) })}
              />
            </div>

            {/* 삭제 */}
            {/* 이름을 '삭제' 만 두면 조건이 여럿일 때 소리로 듣는 사람은
                어느 것을 지우는지 알 수 없다 — 몇 번째인지 붙인다 */}
            <지움단추 ariaLabel={`${i + 1}번째 조건 삭제`} onClick={() => remove(i)} />
          </div>
        );
      })}

      <button
        onClick={addCondition}
        className="flex items-center gap-1.5 text-xs text-accent-blue hover:text-accent-blue transition-colors py-1"
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
