/**
 * 수익 기여 — 누가 내 수익을 만들었나.
 *
 * 합계는 "+512만원" 하나뿐이라, 그게 한 종목이 혼자 번 것인지 열 종목이
 * 조금씩 모은 것인지 알 수 없었다. 둘은 완전히 다른 상황인데 화면에서는
 * 같아 보인다 — 앞의 경우엔 그 한 종목이 흔들리면 자산 전체가 흔들린다.
 *
 * 계산에 새 데이터가 필요하지 않다. 종목마다 손익(pnlKRW)과 오늘 등락
 * 금액(dailyChangeKRW)을 이미 내 자산 화면이 구해 두고 있다. 여기서는
 * 줄을 세우기만 한다.
 *
 * ── '기여도 %' 를 왜 안 쓰나 ──
 *
 * 기여액 ÷ 합계로 퍼센트를 내면, 오른 종목과 내린 종목이 섞였을 때
 * 합계가 0 에 가까워지면서 한 종목이 "기여도 3,800%" 가 된다. 실제로
 * 그런 화면을 만드는 앱이 있는데 아무 뜻이 없다. 여기서는 금액과
 * 막대 길이로만 말한다 — 막대는 제일 큰 것을 기준으로 잰다.
 */
import { useMemo, useState } from "react";
import type { EnrichedItem } from "@/types/portfolio";
import { usePnlColors } from "@/hooks/usePnlColors";
import { useSettingsStore } from "@/store/settingsStore";
import { use돈 } from "@/hooks/useMoney";

type 기간 = "오늘" | "총";

export interface 기여줄 {
  key: string;
  name: string;
  symbol: string;
  market: string;
  기여액: number;
  비율: number | null;
}

/** 종목들을 기여액 큰 순서로 세운다.
 *
 *  같은 종목을 두 포트폴리오에 나눠 담은 사람이 있다. 심볼로 합치지
 *  않으면 같은 이름이 두 줄로 나와서, 그 종목의 진짜 몫이 실제보다
 *  작아 보인다. */
export function 기여줄세우기(항목: EnrichedItem[], 기간: 기간): 기여줄[] {
  const 묶음 = new Map<string, { name: string; symbol: string; market: string; 기여액: number; 원가: number; 평가: number; 어제: number }>();
  for (const e of 항목) {
    const 몫 = 기간 === "오늘" ? (e.dailyChangeKRW ?? 0) : e.pnlKRW;
    const 기존 = 묶음.get(e.symbol);
    const 어제 = e.currentValueKRW - (e.dailyChangeKRW ?? 0);
    if (기존) {
      기존.기여액 += 몫; 기존.원가 += e.costKRW; 기존.평가 += e.currentValueKRW; 기존.어제 += 어제;
    } else {
      묶음.set(e.symbol, {
        name: e.name || e.symbol, symbol: e.symbol, market: e.market,
        기여액: 몫, 원가: e.costKRW, 평가: e.currentValueKRW, 어제,
      });
    }
  }
  return [...묶음.values()]
    .map((v) => ({
      key: v.symbol,
      name: v.name,
      symbol: v.symbol,
      market: v.market,
      기여액: v.기여액,
      /* 오늘이면 '어제 평가액 대비', 총이면 '매입금액 대비'.
         나눌 것이 0 이면(현금·새로 담은 종목) 퍼센트가 없는 것이 맞다 —
         0 으로 적으면 '안 움직였다' 는 거짓말이 된다 */
      비율: 기간 === "오늘"
        ? (v.어제 !== 0 ? (v.기여액 / v.어제) * 100 : null)
        : (v.원가 !== 0 ? (v.기여액 / v.원가) * 100 : null),
    }))
    .filter((r) => r.기여액 !== 0)
    .sort((a, b) => b.기여액 - a.기여액);
}

/** 막대 길이의 기준 — 제일 크게 벌었거나 잃은 값 */
export function 막대기준(줄들: 기여줄[]): number {
  return 줄들.reduce((m, r) => Math.max(m, Math.abs(r.기여액)), 0);
}

const 처음보일줄 = 6;

export default function 수익기여({
  항목, onSelect,
}: {
  항목: EnrichedItem[];
  onSelect?: (r: 기여줄) => void;
}) {
  const [기간, set기간] = useState<기간>("총");
  const [다보기, set다보기] = useState(false);
  const colorScheme = useSettingsStore((s) => s.colorScheme);
  const { pnlColor } = usePnlColors(colorScheme);
  const 돈 = use돈();

  const 줄들 = useMemo(() => 기여줄세우기(항목, 기간), [항목, 기간]);
  const 기준 = useMemo(() => 막대기준(줄들), [줄들]);
  const 합계 = useMemo(() => 줄들.reduce((s, r) => s + r.기여액, 0), [줄들]);
  const 보일줄 = 다보기 ? 줄들 : 줄들.slice(0, 처음보일줄);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-2xs text-text-muted">{기간 === "오늘" ? "오늘 손익" : "평가손익"} 합계</span>
          <span className={`text-lg font-mono font-bold num ${pnlColor(합계)}`}>
            {돈.원부호(합계)}
          </span>
        </div>
        <div className="flex rounded-lg border border-border overflow-hidden shrink-0" role="group" aria-label="기여 기간">
          {(["오늘", "총"] as 기간[]).map((k) => (
            <button
              key={k}
              onClick={() => set기간(k)}
              aria-pressed={기간 === k}
              className={`px-3 py-1.5 text-2xs font-semibold transition-colors ${
                기간 === k ? "bg-accent-blue text-white" : "text-text-muted hover:text-text-primary hover:bg-bg-elevated"
              }`}
            >{k}</button>
          ))}
        </div>
      </div>

      {줄들.length === 0 ? (
        <p className="text-xs text-text-muted py-6 text-center break-keep">
          {기간 === "오늘" ? "오늘 움직인 종목이 아직 없어요" : "아직 손익이 잡힌 종목이 없어요"}
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {보일줄.map((r) => {
              const 길이 = 기준 > 0 ? (Math.abs(r.기여액) / 기준) * 100 : 0;
              return (
                <li key={r.key}>
                  <button
                    type="button"
                    onClick={onSelect ? () => onSelect(r) : undefined}
                    className={`w-full flex flex-col gap-1 text-left rounded-lg px-1.5 py-1 -mx-1.5 transition-colors ${
                      onSelect ? "hover:bg-bg-hover" : "cursor-default"
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs font-semibold text-text-primary truncate">{r.name}</span>
                      <span className={`text-xs font-mono font-semibold whitespace-nowrap num ${pnlColor(r.기여액)}`}>
                        {돈.원부호(r.기여액)}
                        {r.비율 != null && (
                          <span className="text-2xs opacity-70">
                            {" "}({r.비율 >= 0 ? "+" : ""}{r.비율.toFixed(2)}%)
                          </span>
                        )}
                      </span>
                    </div>
                    {/* 막대 색은 글자 색을 그대로 쓴다(bg-current). 손익 색은
                        설정에 따라 갈리는데, 두 곳에 따로 적으면 한쪽만
                        고쳐져서 같은 줄에서 글자와 막대 색이 어긋난다 */}
                    <span className="block w-full h-1.5 rounded-full bg-bg-elevated overflow-hidden">
                      <span
                        className={`block h-full rounded-full bg-current ${pnlColor(r.기여액)}`}
                        style={{ width: `${Math.max(2, 길이)}%` }}
                      />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {줄들.length > 처음보일줄 && (
            <button
              onClick={() => set다보기((v) => !v)}
              className="text-2xs text-text-muted hover:text-accent-blue transition-colors self-center"
            >
              {다보기 ? "접기" : `나머지 ${줄들.length - 처음보일줄}개 더 보기`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
