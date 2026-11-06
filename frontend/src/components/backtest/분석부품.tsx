/**
 * 백테스트 결과를 더 쪼개 보는 부품 — 사용자: "백테스팅 결과를 더 상세분석할 수 있도록 하고 앱느낌나도록".
 *
 *   달마다표    해마다 × 1~12월 수익률(색 농도로 크기) — 연 수익률만 보면 한 해 안의 출렁임이 사라진다
 *   거래분석칸  이긴·진 거래, 손익비, 보유일, 연승·연패, 시장에 있던 기간, 거래 손익 분포
 *   분포막대    값을 칸으로 나눈 막대(거래 손익·유니버스 종목 수익률이 같이 쓴다)
 *
 * 색은 설정의 오름·내림 색만 쓴다 — 손으로 박은 초록·빨강은 '빨강-파랑' 으로 둔 사람에게 거꾸로 보인다.
 */
import { useMemo } from "react";
import { Card } from "@/components/ui";
import { useSettingsStore } from "@/store/settingsStore";
import { usePnlColors, 오름색, 내림색 } from "@/hooks/usePnlColors";
import { use넓은화면 } from "@/hooks/useWideScreen";
import type { 거래 } from "@/api/stocks";
import { 거래분석, 순손익, type 분포칸 } from "./분석";
import { 짧은날 } from "./결과부품";

const 부호 = (v: number, 자리 = 1) => `${v > 0 ? "+" : ""}${v.toFixed(자리)}`;


/* ═════════════════════════ 분포 막대 ═════════════════════════ */

/** 칸마다 개수를 막대로. 칸 사이 경계 숫자를 아래 눈금으로 단다(이름표를 막대마다 달면 폰에서 겹친다) */
export function 분포막대({ 칸들, 경계들, 이름 }: { 칸들: 분포칸[]; 경계들: number[]; 이름: string }) {
  const 배색 = useSettingsStore((s) => s.colorScheme);
  const 최대 = Math.max(1, ...칸들.map((c) => c.수));
  return (
    <div className="flex flex-col gap-1">
      <div role="img" aria-label={`${이름}: ${칸들.map((c) => `${c.이름} ${c.수}개`).join(", ")}`}
        className="flex items-end gap-1 h-24 border-b border-border">
        {칸들.map((c) => (
          <div key={c.이름} className="flex-1 min-w-0 h-full flex flex-col justify-end items-center gap-0.5">
            <span className="text-2xs leading-none text-text-muted tabular-nums">{c.수 || ""}</span>
            <div className="w-full rounded-t-sm"
              style={{ height: `${(c.수 / 최대) * 80}%`, minHeight: c.수 ? 2 : 0,
                       backgroundColor: c.아래 ? 내림색(배색) : 오름색(배색), opacity: 0.7 }} />
          </div>
        ))}
      </div>
      {/* 경계 눈금 — 막대 사이에 숫자 하나씩 */}
      <div className="relative h-3.5" aria-hidden>
        {경계들.map((e, i) => (
          <span key={e} className="absolute -translate-x-1/2 text-2xs leading-none text-text-dim tabular-nums"
            style={{ left: `${((i + 1) / 칸들.length) * 100}%` }}>
            {e > 0 ? `+${e}` : e}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ═════════════════════════ 달마다 수익률 표 ═════════════════════════ */

/** 칸 글 — 넓은 화면: 10% 넘으면 소수점을 뗀다. 정확한 값은 칸의 title·읽어 주기로 */
export function 달칸글(v: number): string {
  const 자리 = Math.abs(v) >= 9.95 ? 0 : 1;
  /* -0.04 를 그대로 적으면 '-0.0', 0.04 는 '+0.0' — 반올림해 0 이면 부호 없이 */
  return Number(v.toFixed(자리)) === 0 ? "0.0" : 부호(v, 자리);
}

/** 폰의 칸 글 — 열세 칸이 390px 한 줄에 들어가야 한다. 글자는 가장 작은 크기(2xs) 밑으로 못 줄이므로(설정의 글씨
 *  크기를 따라야 한다) 정수로, '+' 는 빼고(색이 오르내림을 말한다) 음수만 '-' 를 붙인다. 크기는 칸 색 농도가 말한다 */
export function 달칸글짧게(v: number): string {
  return String(Math.round(v));          // -0.4 → -0 이지만 String(-0) 은 "0"
}

export function 달마다표({ monthly, yearly, 제목 = "달마다 수익률" }: {
  monthly: { month: string; return: number }[];
  yearly?: { year: number; return: number }[];
  제목?: string;
}) {
  const 배색 = useSettingsStore((s) => s.colorScheme);
  const { pnlColor } = usePnlColors(배색);
  const 넓음 = use넓은화면(768);
  const 칸글 = 넓음 ? 달칸글 : 달칸글짧게;
  const { 해들, 표, 척도, 최고, 최저, 오른달 } = useMemo(() => {
    const 표 = new Map<string, number>(monthly.map((m) => [m.month, m.return]));
    const 해들 = [...new Set([...monthly.map((m) => Number(m.month.slice(0, 4))), ...(yearly ?? []).map((y) => y.year)])]
      .sort((a, b) => a - b);
    const 크기 = monthly.map((m) => Math.abs(m.return)).sort((a, b) => a - b);
    /* 색 농도의 자 — 제일 큰 달 하나에 맞추면 나머지가 다 옅어진다. 위에서 10% 자리 값에 맞추고 넘는 것은 진하게 */
    const 척도 = Math.max(3, 크기[Math.floor(크기.length * 0.9)] ?? 3);
    const 고른 = (더나음: (a: number, b: number) => boolean) =>
      monthly.reduce<{ month: string; return: number } | null>((앞, m) => (앞 == null || 더나음(m.return, 앞.return) ? m : 앞), null);
    return { 해들, 표, 척도, 최고: 고른((a, b) => a > b), 최저: 고른((a, b) => a < b),
             오른달: monthly.filter((m) => m.return > 0).length };
  }, [monthly, yearly]);
  const 해수익 = new Map((yearly ?? []).map((y) => [y.year, y.return]));
  const 칸색 = (v: number) => ({
    backgroundColor: v >= 0 ? 오름색(배색) : 내림색(배색),
    opacity: 0.12 + 0.6 * Math.min(1, Math.abs(v) / 척도),
  });

  if (!monthly.length) return null;
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <span className="text-base font-semibold text-text-primary">{제목}</span>
        <span className="text-2xs text-text-dim">오른 달 {오른달}/{monthly.length}</span>
      </div>
      {(최고 || 최저) && (
        <p className="text-2xs text-text-muted break-keep">
          {최고 && <>가장 좋았던 달 <span className="num">{최고.month}</span>{" "}
            <b className={`font-mono ${pnlColor(최고.return)}`}>{부호(최고.return)}%</b></>}
          {최고 && 최저 && " · "}
          {최저 && <>가장 나빴던 달 <span className="num">{최저.month}</span>{" "}
            <b className={`font-mono ${pnlColor(최저.return)}`}>{부호(최저.return)}%</b></>}
        </p>
      )}
      <table className="w-full table-fixed border-separate border-spacing-px">
        <caption className="sr-only">{제목} — 행은 해, 열은 달, 끝 열은 그해 전체</caption>
        <thead>
          <tr>
            <th scope="col" className="w-7 text-left text-2xs font-normal text-text-dim"><span className="sr-only">해</span></th>
            {Array.from({ length: 12 }, (_, i) => (
              <th key={i} scope="col" className="text-2xs font-normal text-text-dim">{i + 1}</th>
            ))}
            {yearly && <th scope="col" className="w-9 text-2xs font-normal text-text-muted">연간</th>}
          </tr>
        </thead>
        <tbody>
          {해들.map((해) => (
            <tr key={해}>
              <th scope="row" className="text-left text-2xs font-normal text-text-muted tabular-nums">{String(해).slice(2)}</th>
              {Array.from({ length: 12 }, (_, i) => {
                const 달 = `${해}-${String(i + 1).padStart(2, "0")}`;
                const v = 표.get(달);
                return (
                  <td key={달} className="relative h-6 p-0 text-center">
                    {v == null ? (
                      <span className="text-2xs text-text-dim/50" aria-label={`${달} 자료 없음`}>·</span>
                    ) : (
                      <>
                        <span className="absolute inset-0 rounded-sm" style={칸색(v)} aria-hidden />
                        <span className="relative text-2xs leading-6 tabular-nums tracking-tighter text-text-primary"
                          title={`${달} ${부호(v, 2)}%`} aria-label={`${달} ${부호(v, 2)}%`}>{칸글(v)}</span>
                      </>
                    )}
                  </td>
                );
              })}
              {yearly && (
                <td className="text-center p-0">
                  {해수익.has(해) ? (
                    <span className={`text-2xs font-semibold tabular-nums tracking-tighter ${pnlColor(해수익.get(해)!)}`}
                      aria-label={`${해}년 ${부호(해수익.get(해)!, 2)}%`}>{칸글(해수익.get(해)!)}</span>
                  ) : <span className="text-2xs text-text-dim/50">·</span>}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-2xs text-text-dim break-keep">
        칸이 진할수록 크게 움직인 달이에요. 첫 달은 시작값이 없어 비워 둬요.
      </p>
    </Card>
  );
}

/* ═════════════════════════ 거래 분석 ═════════════════════════ */

function 칸({ 이름, 값, 밑, 색 }: { 이름: string; 값: React.ReactNode; 밑?: React.ReactNode; 색?: string }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-2xs text-text-muted">{이름}</span>
      <span className={`text-sm font-semibold font-mono tabular-nums ${색 ?? "text-text-primary"}`}>{값}</span>
      {밑 && <span className="text-2xs text-text-dim break-keep">{밑}</span>}
    </div>
  );
}

export function 거래분석칸({ 거래들, 시작, 끝 }: { 거래들: 거래[]; 시작?: string | null; 끝?: string | null }) {
  const 배색 = useSettingsStore((s) => s.colorScheme);
  const { pnlColor } = usePnlColors(배색);
  const 통 = useMemo(() => 거래분석(거래들, { 시작, 끝 }), [거래들, 시작, 끝]);
  const 없음 = <span className="text-text-dim">—</span>;
  if (!통.건수) {
    return (
      <Card className="flex flex-col gap-2">
        <span className="text-base font-semibold text-text-primary">거래 분석</span>
        <p className="text-xs text-text-muted break-keep">이 기간에는 조건에 맞는 거래가 한 번도 없었어요. 조건을 조금 느슨하게 바꿔 보세요.</p>
      </Card>
    );
  }
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <span className="text-base font-semibold text-text-primary">거래 분석</span>
        <span className="text-2xs text-text-dim">{통.건수}건 · 수수료 뺀 손익 기준</span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <칸 이름="이긴 거래" 값={`${통.이긴수}건`}
          밑={통.평균이익 == null ? "평균 —" : <>평균 <b className={pnlColor(통.평균이익)}>{부호(통.평균이익)}%</b></>} />
        <칸 이름="진 거래" 값={`${통.진수}건`}
          밑={통.평균손실 == null ? "평균 —" : <>평균 <b className={pnlColor(통.평균손실)}>{부호(통.평균손실)}%</b></>} />
        {/* 손익비 — 한 번 이길 때 버는 것이 한 번 질 때 잃는 것의 몇 배인가. 승률이 낮아도 이게 크면 남는다 */}
        <칸 이름="손익비" 값={통.손익비 == null ? 없음 : 통.손익비.toFixed(2)}
          밑={통.손익비 == null ? (통.진수 ? "이긴 거래 없음" : "진 거래 없음") : "평균 이익 ÷ 평균 손실"} />
      </div>
      <div className="grid grid-cols-3 gap-3 pt-3 border-t border-border">
        <칸 이름="평균 보유" 값={통.평균보유일 == null ? 없음 : `${Math.round(통.평균보유일)}일`} />
        <칸 이름="최장 연승" 값={`${통.최장연승}번`} />
        <칸 이름="최장 연패" 값={`${통.최장연패}번`} />
      </div>
      <div className="grid grid-cols-2 gap-3 pt-3 border-t border-border">
        {([["가장 큰 이익", 통.최고], ["가장 큰 손실", 통.최저]] as const).map(([이름, t]) => (
          <칸 key={이름} 이름={이름}
            값={t ? <span className={pnlColor(순손익(t))}>{부호(순손익(t), 2)}%</span> : 없음}
            밑={t ? <span className="num">{짧은날(t.entry_date)} → {짧은날(t.exit_date)}</span> : undefined} />
        ))}
      </div>
      {통.보유비율 != null && (
        <div className="flex flex-col gap-1.5 pt-3 border-t border-border">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-2xs text-text-muted">시장에 들어가 있던 기간</span>
            <span className="text-sm font-semibold font-mono tabular-nums">{Math.round(통.보유비율)}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-bg-elevated overflow-hidden">
            <div className="h-full rounded-full bg-accent-blue" style={{ width: `${통.보유비율}%` }} />
          </div>
          <span className="text-2xs text-text-dim break-keep">나머지 기간은 사지 않고 현금으로 쉬었어요.</span>
        </div>
      )}
      <div className="flex flex-col gap-2 pt-3 border-t border-border">
        <span className="text-2xs text-text-muted">거래 한 건의 손익 분포(%)</span>
        <분포막대 칸들={통.분포} 경계들={[-20, -10, -5, 0, 5, 10, 20]} 이름="거래 손익 분포" />
      </div>
    </Card>
  );
}
