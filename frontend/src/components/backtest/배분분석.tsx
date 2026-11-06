/**
 * 자산배분 — 더 깊이 보는 카드들. 사용자: "백테스팅 자산배분 더 상세하게 분석해주고".
 *
 *   자산마다칸   자산마다 비중·따로 들고 있었으면의 성적·**조합 안에서 번 돈**(기여). 기여를 다 더하고 수수료를
 *                빼면 성과 카드의 수익과 같다 — 그 셈을 카드 끝에 그대로 적는다
 *   상관칸       자산끼리 얼마나 같이 움직였나 — 나눠 담은 효과는 이걸 봐야 읽힌다
 *   롤링칸       아무 달에나 사서 1·3·5년 들고 있었으면 연 몇 %였나 — 언제 샀느냐에 따라 얼마나 달랐나
 *
 * 숫자는 모두 서버가 같은 엔진에서 잰 것(asset_stats·correlation·rolling)이다. 예전 응답(공유 주소로 연 옛 결과)
 * 에는 없을 수 있어서, 없으면 카드를 안 그린다(부르는 쪽이 예전 카드로 대신한다).
 */
import { lazy, Suspense, useMemo, useState } from "react";
import { Card, ChipTabs, 고른칩 } from "@/components/ui";
import { useSettingsStore } from "@/store/settingsStore";
import { usePnlColors, 오름색, 내림색 } from "@/hooks/usePnlColors";
import { use넓은화면 } from "@/hooks/useWideScreen";
import { 짧은돈 } from "@/utils/formatters";
import { PIE_COLORS } from "@/constants/pieColors";
import { 가로축, 그래프높이, 달눈금, 영점, 견줌색 } from "@/utils/chartTheme";
import type { 자산배분결과, 롤링수익 } from "@/api/stocks";
import { 숫자, 작은지표, 그래프범례, 견줌툴팁 } from "./결과부품";
import { 과와, 받침있나 } from "@/utils/조사";

const 차트틀 = lazy(() => import("@/components/chart/ChartFrame"));

/** 짧은 돈 — '+4,390만원' · '-$43.9K'. 목록 한 줄에 들어가게 줄인다(정확한 합은 카드 끝 줄에 원 단위로) */
export function 짧은금액(v: number | null | undefined, 통화: "KRW" | "USD"): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const 부호 = v > 0 ? "+" : v < 0 ? "-" : "";
  const a = Math.abs(v);
  if (통화 === "USD") {
    const 몸 = a >= 1e9 ? `${(a / 1e9).toFixed(1)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(1)}M`
      : a >= 1e3 ? `${(a / 1e3).toFixed(1)}K` : String(Math.round(a));
    return `${부호}$${몸}`;
  }
  return `${부호}${a < 10_000 ? Math.round(a).toLocaleString("ko-KR") : 짧은돈(a)}원`;
}

/** 원 단위 그대로 — '+₩42,063,287' */
function 온금액(v: number | null | undefined, 통화: "KRW" | "USD"): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const 부호 = v > 0 ? "+" : v < 0 ? "-" : "";
  return `${부호}${통화 === "KRW" ? "₩" : "$"}${Math.round(Math.abs(v)).toLocaleString("ko-KR")}`;
}

/** 심볼 → 담을 때 적힌 이름(없으면 심볼) */
export function 자산이름(r: Pick<자산배분결과, "assets">, 심볼: string): string {
  return (r.assets ?? []).find((a) => a.symbol === 심볼)?.name || 심볼;
}

/* ═════════════════════════ 자산마다 ═════════════════════════ */

export function 자산마다칸({ r }: { r: 자산배분결과 }) {
  const 배색 = useSettingsStore((s) => s.colorScheme);
  const { pnlColor, loss } = usePnlColors(배색);
  const 넓음 = use넓은화면();
  const 자산들 = r.asset_stats ?? [];

  const 줄들 = useMemo(() => 자산들.map((x, i) => ({
    ...x, 이름: 자산이름(r, x.symbol), 색: PIE_COLORS[i % PIE_COLORS.length], 몫: x.weight * 100,
  })), [자산들, r]);
  /** 기여 막대를 재는 자 — 제일 크게 번(또는 잃은) 자산의 금액 */
  const 자 = Math.max(1, ...줄들.map((x) => Math.abs(x.contribution ?? 0)));
  const 기여합 = 줄들.reduce((a, x) => a + (x.contribution ?? 0), 0);
  const 차례 = [...줄들].sort((a, b) => (b.contribution ?? 0) - (a.contribution ?? 0));
  /** 가장 많이 번 자산 — 자산들이 번 돈이 플러스일 때만(마이너스면 '번 돈의 몇 %' 가 뒤집혀 읽힌다) */
  const 일등 = 기여합 > 0 ? 차례[0] : null;
  /** 잃은 자산 — 하나라도 있으면 '번 돈의 103%' 같은 몫 대신 **잃었다는 사실**을 말한다(실제로 그렇게 찍혔다) */
  const 잃은것 = 줄들.filter((x) => (x.contribution ?? 0) < 0);
  const 잃은합 = 잃은것.reduce((a, x) => a + (x.contribution ?? 0), 0);
  const 잃은이름 = 잃은것.map((x) => x.이름).join(" · ");
  /** 다 합쳐 잃었으면 가장 많이 잃은 자산을 말한다 */
  const 꼴등 = !일등 && 잃은것.length ? 차례[차례.length - 1] : null;
  const 그릴것 = 줄들.filter((x) => x.몫 > 0);
  const 원높이 = 넓음 ? 168 : 148;

  if (!줄들.length) return null;
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <span className="text-base font-semibold text-text-primary">자산마다</span>
        <span className="text-2xs text-text-dim">비중 · 따로 들고 있었으면 · 번 돈</span>
      </div>

      {/* 원 + 가운데 수익 — 내 자산 화면의 비중 원과 같은 모양 */}
      <div className="relative mx-auto w-full max-w-[13rem]" data-testid="자산마다-원">
        <Suspense fallback={<div style={{ height: 원높이 }} />}>
          <차트틀 height={원높이}>
            {(R: any) => (
              <R.PieChart>
                <R.Pie data={그릴것} dataKey="몫" nameKey="이름" cx="50%" cy="50%"
                       outerRadius={넓음 ? 80 : 70} innerRadius={넓음 ? 56 : 48} paddingAngle={1}
                       stroke="none" isAnimationActive={false}>
                  {그릴것.map((x) => <R.Cell key={x.symbol} fill={x.색} />)}
                </R.Pie>
              </R.PieChart>
            )}
          </차트틀>
        </Suspense>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-2xs text-text-muted">수익</span>
          <span className={`text-sm font-bold font-mono tabular-nums ${pnlColor(r.profit ?? 0)}`}>
            {짧은금액(r.profit, r.currency)}
          </span>
        </div>
      </div>

      {일등 && (
        <p className="text-xs text-text-secondary break-keep -mt-1">
          가장 많이 번 자산은 <b className="text-text-primary">{일등.이름}</b>{받침있나(일등.이름) ? "이에요" : "예요"}
          {잃은것.length === 0 ? (
            <> — 자산들이 번 돈의 <b className="font-mono">{Math.round(((일등.contribution ?? 0) / 기여합) * 100)}%</b>.</>
          ) : (
            <>
              <span className="font-mono">({짧은금액(일등.contribution, r.currency)})</span>.{" "}
              <b className="text-text-primary">{잃은이름}</b>{받침있나(잃은이름) ? "은" : "는"} 오히려 잃었어요
              <span className="font-mono">({짧은금액(잃은합, r.currency)})</span>.
            </>
          )}
        </p>
      )}
      {꼴등 && (
        <p className="text-xs text-text-secondary break-keep -mt-1">
          가장 많이 잃은 자산은 <b className="text-text-primary">{꼴등.이름}</b>{받침있나(꼴등.이름) ? "이에요" : "예요"}
          <span className="font-mono">({짧은금액(꼴등.contribution, r.currency)})</span>.
        </p>
      )}

      <ul className="flex flex-col divide-y divide-border/60">
        {줄들.map((x) => {
          const 기여 = x.contribution ?? 0;
          return (
            <li key={x.symbol} className="py-3 first:pt-0 flex flex-col gap-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: x.색 }} />
                <span className="text-sm font-medium text-text-primary truncate flex-1 min-w-0">{x.이름}</span>
                <span className="text-xs font-mono tabular-nums text-text-muted flex-shrink-0">{x.몫.toFixed(1)}%</span>
              </div>
              <div className="flex items-baseline justify-between gap-2 pl-[1.125rem]">
                <span className="text-2xs text-text-dim break-keep">
                  연 <span className={x.cagr == null ? "" : pnlColor(x.cagr)}>{숫자(x.cagr, 1, (x.cagr ?? 0) > 0 ? "+" : "", "%")}</span>
                  {" · "}낙폭 <span className={x.mdd ? loss : ""}>{숫자(x.mdd, 1, x.mdd ? "-" : "", "%")}</span>
                  {x.volatility != null && x.volatility > 0 && <>{" · "}변동성 {x.volatility.toFixed(1)}%</>}
                </span>
                <span className={`text-sm font-semibold font-mono tabular-nums flex-shrink-0 ${pnlColor(기여)}`}
                      aria-label={`${x.이름} 번 돈 ${온금액(기여, r.currency)}`}>
                  {짧은금액(기여, r.currency)}
                </span>
              </div>
              {/* 번 돈 막대 — 제일 크게 번(잃은) 자산을 끝으로. 잃은 자산은 내림 색 */}
              <div className="ml-[1.125rem] h-1.5 rounded-full bg-bg-elevated overflow-hidden">
                <div className="h-full rounded-full"
                     style={{ width: `${(Math.abs(기여) / 자) * 100}%`,
                              background: 기여 >= 0 ? 오름색(배색) : 내림색(배색), opacity: 0.7 }} />
              </div>
            </li>
          );
        })}
      </ul>

      {/* 셈을 그대로 적는다 — 자산들이 번 돈 − 수수료 = 성과 카드의 수익. 하나라도 어긋나면 어느 쪽 수를 믿을지 모른다 */}
      <div className="flex flex-col gap-1 pt-3 border-t border-border text-xs">
        <div className="flex justify-between gap-2">
          <span className="text-text-muted">자산들이 번 돈</span>
          <span className="font-mono tabular-nums text-text-secondary">{온금액(기여합, r.currency)}</span>
        </div>
        {(r.costs ?? 0) > 0 && (
          <div className="flex justify-between gap-2">
            <span className="text-text-muted">수수료</span>
            <span className="font-mono tabular-nums text-text-secondary">{온금액(-(r.costs ?? 0), r.currency)}</span>
          </div>
        )}
        <div className="flex justify-between gap-2 font-semibold">
          <span className="text-text-primary">수익</span>
          <span className={`font-mono tabular-nums ${pnlColor(r.profit ?? 0)}`}>{온금액(r.profit, r.currency)}</span>
        </div>
      </div>
      <p className="text-2xs text-text-dim break-keep -mt-2">
        '연'·'낙폭' 은 그 자산 하나만 같은 기간 들고 있었으면의 성적이에요{r.dividends != null ? "(배당 재투자)" : ""}.
        번 돈은 이 조합 안에서 그 자산이 오르내려 번 돈{r.dividends != null ? "과 받은 배당" : ""}이에요
        {줄들.some((x) => x.symbol === "현금") ? " — 현금은 이자" : ""}.
      </p>
    </Card>
  );
}

/* ═════════════════════════ 상관 ═════════════════════════ */

/** 상관 한 단어 — 숫자만 보면 0.35 가 큰지 작은지 모른다 */
export function 상관말(v: number): string {
  if (v >= 0.7) return "거의 같이";
  if (v >= 0.3) return "꽤 같이";
  if (v > -0.3) return "따로";
  return "거꾸로";
}

/** 짝 목록 — 낮은 것(나눠 담은 효과가 큰 것)부터 */
export function 상관짝들(r: Pick<자산배분결과, "assets" | "correlation">): { 가: string; 나: string; 값: number }[] {
  const c = r.correlation;
  if (!c) return [];
  const 짝들: { 가: string; 나: string; 값: number }[] = [];
  for (let i = 0; i < c.symbols.length; i++) {
    for (let j = i + 1; j < c.symbols.length; j++) {
      const v = c.matrix[i]?.[j];
      if (v == null) continue;
      짝들.push({ 가: 자산이름(r, c.symbols[i]), 나: 자산이름(r, c.symbols[j]), 값: v });
    }
  }
  return 짝들.sort((a, b) => a.값 - b.값);
}

/** 표의 칸 머리 — 심볼(국내 코드의 .KS·.KQ 는 뗀다). 이름은 줄 머리에 온전히 적는다 — 칸 머리에 '미국 장기국채' 를
 *  넣으면 넷만 담아도 폰 폭을 넘는다 */
export function 짧은심볼(심볼: string): string {
  return 심볼.replace(/\.(KS|KQ)$/i, "");
}

/** 상관 칸의 바탕 — **같이(+)는 파랑, 거꾸로(−)는 주황, 0 근처는 회색**. 진하기는 크기(|r|).
 *
 *  갈래가 둘인 값이라 서로 반대로 읽히는 찬색·더운색 한 쌍에 가운데는 회색이다(색이 없는 칸 = '아무것도 아님').
 *  오름·내림 색(빨강·파랑·초록)을 쓰면 '벌었다·잃었다' 로 읽혀서 피한다. 색은 거들 뿐 — 칸마다 숫자가 있다 */
export function 상관바탕(v: number | null | undefined): string | undefined {
  if (v == null || !Number.isFinite(v)) return undefined;
  const 크기 = Math.min(1, Math.abs(v));
  if (크기 < 0.05) return undefined;
  return `rgba(${v > 0 ? "59,130,246" : "234,88,12"},${(0.12 + 0.5 * 크기).toFixed(2)})`;
}

/** 칸 숫자 — 소수 둘째 자리(0 은 부호 없이) */
const 상관글 = (v: number) => (Math.abs(v) < 0.005 ? "0.00" : v.toFixed(2));

export function 상관칸({ r }: { r: 자산배분결과 }) {
  const 짝들 = useMemo(() => 상관짝들(r), [r]);
  const c = r.correlation;
  if (!c || !짝들.length) return null;
  const 평균 = 짝들.reduce((a, x) => a + x.값, 0) / 짝들.length;
  const 이름 = (s: string) => 자산이름(r, s);
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <span className="text-base font-semibold text-text-primary">얼마나 같이 움직였나</span>
        <span className="text-2xs text-text-dim">달마다 수익률 · {c.months}개월</span>
      </div>
      <p className="text-xs text-text-secondary break-keep -mt-1">
        {짝들.length > 1 ? "평균 " : ""}상관 <b className="font-mono">{상관글(평균)}</b> —{" "}
        {평균 < 0.3 ? "따로 움직여서 나눠 담은 효과가 컸어요." : 평균 < 0.7 ? "어느 정도 같이 움직였어요." : "거의 같이 움직여서 나눠 담은 효과가 작았어요."}
      </p>

      {/* ── 자산 × 자산 표 ── 대각선은 자기 자신(늘 1). 폰에서 넘치면 옆으로 밀고, 줄 머리(이름)는 붙어 있는다 */}
      <div className="overflow-x-auto -mx-1 px-1">
        <table className="w-full text-xs border-separate" style={{ borderSpacing: 3 }} aria-label="자산끼리 상관 표">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-bg-card" aria-hidden />
              {c.symbols.map((s) => (
                <th key={s} scope="col" title={이름(s)}
                    className="px-1 pb-1 text-2xs font-medium text-text-muted text-center min-w-[3rem] whitespace-nowrap">
                  {짧은심볼(s)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {c.symbols.map((s, i) => (
              <tr key={s}>
                <th scope="row" className="sticky left-0 z-10 bg-bg-card pr-2 text-left font-normal">
                  <span className="block text-xs text-text-primary truncate max-w-[7rem]">{이름(s)}</span>
                  {이름(s) !== 짧은심볼(s) && <span className="block text-2xs text-text-dim">{짧은심볼(s)}</span>}
                </th>
                {c.symbols.map((t, j) => {
                  const v = c.matrix[i]?.[j];
                  if (i === j) {
                    return <td key={t} className="h-10 min-w-[3rem] rounded-lg bg-bg-elevated text-center font-mono tabular-nums text-text-dim">1.00</td>;
                  }
                  const 말 = v == null ? "못 잼" : `${상관글(v)} ${상관말(v)}`;
                  return (
                    <td key={t} title={`${이름(s)} · ${이름(t)} ${말}`}
                        aria-label={`${과와(이름(s))} ${이름(t)} 상관 ${말}`}
                        className="h-10 min-w-[3rem] rounded-lg bg-bg-elevated text-center font-mono tabular-nums text-text-primary"
                        style={{ background: 상관바탕(v) }}>
                      {v == null ? <span className="text-text-dim">—</span> : 상관글(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 색 척도 — 무엇이 진한지 말해 둔다(색만으로 읽게 하지 않는다) */}
      <div className="flex flex-col gap-1">
        <div className="h-1.5 rounded-full" aria-hidden
             style={{ background: "linear-gradient(to right, rgba(234,88,12,0.62), rgba(148,163,184,0.15) 50%, rgba(59,130,246,0.62))" }} />
        <div className="flex justify-between text-2xs text-text-dim">
          <span>-1 거꾸로</span><span>0 따로</span><span>+1 같이</span>
        </div>
      </div>

      {/* 짝이 여럿이면 끝의 둘을 한 줄로 — 표를 다 읽지 않아도 '가장 따로·가장 같이' 가 보이게 */}
      {짝들.length > 2 && (
        <p className="text-2xs text-text-muted break-keep -mt-1">
          가장 따로 움직인 짝 <b className="text-text-secondary">{짝들[0].가} · {짝들[0].나}</b>
          <span className="font-mono"> ({상관글(짝들[0].값)})</span>
          {" · "}가장 같이 <b className="text-text-secondary">{짝들[짝들.length - 1].가} · {짝들[짝들.length - 1].나}</b>
          <span className="font-mono"> ({상관글(짝들[짝들.length - 1].값)})</span>
        </p>
      )}
    </Card>
  );
}

/* ═════════════════════════ 롤링 ═════════════════════════ */

/** 롤링 값 — '연 +6.20%' */
const 연글 = (v: number) => `연 ${v > 0 ? "+" : ""}${v.toFixed(2)}%`;

/** 내 것과 벤치마크의 N년 줄을 달로 맞춰 한 배열로 — 칸 번호로 짝지으면 시작 달이 다를 때 어긋난다 */
export function 롤링합치기(내것: 롤링수익 | undefined, 벤치?: 롤링수익): { month: string; 내것: number; 벤치?: number }[] {
  const 표 = new Map((벤치?.series ?? []).map((x) => [x.month, x.return]));
  return (내것?.series ?? []).map((x) => {
    const b = 표.get(x.month);
    return b == null ? { month: x.month, 내것: x.return } : { month: x.month, 내것: x.return, 벤치: b };
  });
}

export function 롤링칸({ r }: { r: 자산배분결과 }) {
  const 배색 = useSettingsStore((s) => s.colorScheme);
  const { pnlColor } = usePnlColors(배색);
  const 넓음 = use넓은화면();
  const 해들 = (r.rolling ?? []).map((x) => x.years);
  /* 기본은 3년 — 1년은 운이 크고, 5년은 기간이 짧으면 없다 */
  const 기본해 = 해들.includes(3) ? 3 : 해들[0] ?? 1;
  const [고른해, set해] = useState(기본해);
  /* 다른 결과를 불러오면 고른 기간이 그 결과에 없을 수 있다(5년을 보다가 4년짜리 결과) — 그때 카드가 통째로
     사라지지 않게 기본으로 돌아간다 */
  const 해 = 해들.includes(고른해) ? 고른해 : 기본해;
  const [벤치보기, set벤치보기] = useState(true);
  const 내것 = (r.rolling ?? []).find((x) => x.years === 해);
  const 벤치 = r.benchmark?.rolling?.find((x) => x.years === 해);
  const 합친것 = useMemo(() => 롤링합치기(내것, 벤치), [내것, 벤치]);
  const 벤치있음 = 합친것.some((x) => x.벤치 != null);
  if (!내것) return null;
  const 높이 = 그래프높이.낮은[넓음 ? 1 : 0];

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <span className="text-base font-semibold text-text-primary">언제 샀느냐에 따라</span>
        <span className="text-2xs text-text-dim">아무 달에나 사서 {해}년 들고 있었으면</span>
      </div>
      {(해들.length > 1 || 벤치있음) && (
        <div className="flex items-center justify-between gap-2">
          {해들.length > 1 ? (
            <ChipTabs ariaLabel="들고 있은 기간" idPrefix="롤링" tabs={해들.map((n) => ({ id: String(n), label: `${n}년` }))}
              active={String(해)} onChange={(v) => set해(Number(v))} />
          ) : <span />}
          {벤치있음 && (
            <고른칩 작게 고름={벤치보기} onClick={() => set벤치보기((v) => !v)} ariaLabel={`${r.benchmark!.name} 같이 보기`}>
              {r.benchmark!.name}
            </고른칩>
          )}
        </div>
      )}
      <div role="tabpanel" id="롤링-panel" aria-labelledby={`롤링-tab-${해}`} className="flex flex-col gap-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
          <작은지표 이름="플러스였던 경우" 값={`${내것.positive_ratio.toFixed(0)}%`}
            밑={`${내것.count}번 중 ${Math.round((내것.positive_ratio / 100) * 내것.count)}번`} />
          {/* '가운데' 는 무엇의 가운데인지 헷갈렸다 — 흔히 쓰는 말로. 모두 연 수익률이라는 것은 아래 설명에 적는다 */}
          <작은지표 이름="중간값" 값={`${내것.median > 0 ? "+" : ""}${내것.median.toFixed(1)}%`} 색={pnlColor(내것.median)} />
          <작은지표 이름="가장 좋았을 때" 값={`${내것.best > 0 ? "+" : ""}${내것.best.toFixed(1)}%`} 색={pnlColor(내것.best)} />
          <작은지표 이름="가장 나빴을 때" 값={`${내것.worst > 0 ? "+" : ""}${내것.worst.toFixed(1)}%`} 색={pnlColor(내것.worst)} />
        </div>
        {합친것.length > 1 && (
          <Suspense fallback={<div style={{ height: 높이 }} className="rounded-lg bg-bg-elevated animate-pulse" />}>
            <차트틀 height={높이}>
              {(R: any) => (
                <R.ComposedChart data={합친것.map((x) => ({ ...x, date: `${x.month}-01` }))}
                                 margin={{ top: 10, right: 4, bottom: 0, left: 4 }}>
                  <R.XAxis dataKey="date" tickFormatter={달눈금} {...가로축} />
                  <R.YAxis hide domain={["dataMin", "dataMax"]} />
                  <R.Tooltip content={<견줌툴팁 날글={(d) => `${달눈금(d)}까지 ${해}년`}
                    줄들={[{ 키: "내것", 이름: "내 조합", 색: 견줌색.내것, 글: 연글 },
                           ...(벤치있음 && 벤치보기 ? [{ 키: "벤치", 이름: r.benchmark?.name ?? "벤치마크", 색: 견줌색.견줄것, 글: 연글 }] : [])]}
                    차이={벤치있음 && 벤치보기 ? { 가: "내것", 나: "벤치", 색: pnlColor,
                                                   글: (v) => `${v > 0 ? "+" : ""}${v.toFixed(2)}%p` } : undefined} />} />
                  {/* 0 은 **실선** — 벤치마크가 점선이라 0 까지 점선이면 어느 것이 0 인지 헷갈린다 */}
                  <R.ReferenceLine y={0} {...영점} strokeWidth={1} ifOverflow="extendDomain" />
                  <R.Line type="monotone" dataKey="내것" name="내것" stroke={견줌색.내것} strokeWidth={2}
                          dot={false} isAnimationActive={false} />
                  {벤치있음 && 벤치보기 && (
                    <R.Line type="monotone" dataKey="벤치" name="벤치" stroke={견줌색.견줄것} strokeWidth={2}
                            dot={false} connectNulls isAnimationActive={false} />
                  )}
                </R.ComposedChart>
              )}
            </차트틀>
          </Suspense>
        )}
        {합친것.length > 1 && (
          <그래프범례 선들={[{ 이름: "내 조합", 색: 견줌색.내것 },
                            ...(벤치있음 && 벤치보기 ? [{ 이름: r.benchmark!.name, 색: 견줌색.견줄것 }] : [])]} />
        )}
        <p className="text-2xs text-text-dim break-keep">
          가로축은 판 달 — 그 달까지 {해}년 들고 있었으면 연 몇 %였는지예요. 가로 실선이 0%예요. 넣은 돈은 빼고 쟀어요.
        </p>
      </div>
    </Card>
  );
}
