/**
 * 자산배분 백테스트 — 결과 화면.
 *
 * ── 이 화면이 지켜야 할 한 가지 ────────────────────────────
 *
 * **넣은 돈과 번 돈을 섞지 않는다.**
 *
 * 매달 넣는 사람에게 '초기 대비 몇 %' 는 새빨간 거짓말이다. 1,000만원으로
 * 시작해 8년간 매달 50만원씩 넣으면 원금만 5,800만원인데, 최종 7,000만원을
 * '초기 대비 600%' 로 적으면 수익이 열 배로 부풀려진다.
 *
 * 그래서 맨 위에 **총납입 → 최종평가액** 을 먼저 놓고, 수익률은 그
 * 아래에 둔다. 사람이 제일 먼저 보는 자리에 '내가 넣은 돈' 이 있어야
 * 뒤의 수를 제대로 읽는다.
 *
 * 연환산도 **두 개를 나란히** 적는다. 하나만 보여 주면 적립식의 핵심인
 * 그 차이가 통째로 사라진다.
 */
import { Fragment, lazy, Suspense, useMemo, useState } from "react";
import { Card, Tabs, 고른칩 } from "@/components/ui";
import { useSettingsStore } from "@/store/settingsStore";
import { usePnlColors, 오름색, 내림색 } from "@/hooks/usePnlColors";
import { 짧은돈 } from "@/utils/formatters";
import type { 자산배분결과 } from "@/api/stocks";

const 차트틀 = lazy(() => import("@/components/chart/ChartFrame"));

/** 세로축 눈금 — 통화에 맞는 단위로 줄인다.
 *
 *  처음에는 `${Math.round(v / 10000)}만` 하나로 끝냈는데 두 가지가 틀렸다.
 *
 *  ① **통화를 안 봤다.** 달러로 보고 있어도 '만' 이 붙는다. $10,000 이
 *     '1만' 으로 나오는데, 달러를 만 단위로 세는 사람은 없다.
 *  ② **큰 수에서 무너진다.** 축 너비가 54px 인데 '1000000000만' 같은
 *     라벨이 나와 그래프를 덮는다(실제로 찍어 보고 알았다).
 *
 *  원화는 이 저장소가 이미 쓰는 만/억/조 규칙(짧은돈)을 그대로 따른다 —
 *  화면마다 다른 규칙을 쓰면 같은 금액이 자리마다 다르게 보인다. */
export function 눈금글(v: number, 통화: "KRW" | "USD"): string {
  if (!v) return "0";
  const a = Math.abs(v);
  if (통화 === "KRW") {
    /* 짧은돈 은 조 단위에 소수 한 자리를 붙인다 — 배당 달력에서는
       그 위가 안 나오니 맞는 선택이다. 여기서는 30년 적립을 돌릴 수
       있어 더 위가 나올 수 있고, '100.0조' 는 여섯 글자라 축을 넘는다.
       그 구간만 소수를 뗀다. */
    if (a >= 99_950_000_000_000) return `${Math.round(v / 1e12)}조`;
    return 짧은돈(v);
  }
  if (a >= 1e12) return `${(v / 1e12).toFixed(1)}T`;
  if (a >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${Math.round(v / 1e3)}K`;
  return String(Math.round(v));
}

/** 못 잰 값은 '—' 로 적는다.
 *
 *  서버는 잴 수 없는 것을 null 로 준다(1년 미만의 연환산 등).
 *  물음표 접근자만 쓰면 'undefined%' 가 찍힌다 — 이 저장소에서
 *  이미 같은 것을 한 번 고쳤다. */
function 수(v: number | null | undefined, 자리 = 2, 앞 = "", 뒤 = "") {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${앞}${v.toLocaleString("ko-KR", { maximumFractionDigits: 자리 })}${뒤}`;
}

function 돈(v: number | null | undefined, 통화: "KRW" | "USD") {
  if (v == null || !Number.isFinite(v)) return "—";
  const 기호 = 통화 === "KRW" ? "₩" : "$";
  return `${기호}${Math.round(v).toLocaleString("ko-KR")}`;
}

/** 긴 수는 글자를 줄여서 넣는다 — 자르지 않는다.
 *
 *  돈은 자릿수가 곧 뜻이다. `truncate` 로 '₩181,740,043,5…' 처럼
 *  끝을 잘라 버리면 읽는 사람이 억인지 조인지 알 수 없다. 폰에서는
 *  마우스를 올릴 수도 없어 잘린 뒤를 볼 방법이 아예 없다.
 *
 *  '1,817억' 식으로 줄이는 방법도 있지만, 그러면 이 저장소에 이미
 *  다섯 군데 흩어져 있는 억/조 규칙이 여섯 번째로 늘어난다. 여기서는
 *  수를 그대로 두고 글자만 줄인다.
 *
 *  (폰 390px 에서 '₩181,740,043,506,109,900' 이 칸 밖으로 잘려 나가는
 *   것을 실제로 찍어 보고 고쳤다.) */
function 칸({ 이름, 값, 색, 밑 }: {
  이름: string; 값: React.ReactNode; 색?: string; 밑?: string;
}) {
  const 길이 = typeof 값 === "string" ? 값.length : 0;
  const 크기 = 길이 > 17 ? "text-xs" : 길이 > 13 ? "text-sm" : "text-lg";
  return (
    <div className="flex flex-col gap-0.5 p-3 rounded-xl border border-border bg-bg-elevated min-w-0">
      <span className="text-2xs text-text-muted font-medium">{이름}</span>
      <span className={`${크기} font-mono font-bold tabular-nums ${색 ?? "text-text-primary"}`}>{값}</span>
      {밑 && <span className="text-2xs text-text-dim break-keep">{밑}</span>}
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════
   자산 흐름 — 로그 축과 벤치마크 겹치기
   ═══════════════════════════════════════════════════════════ */

/** 두 곡선을 **날짜로 맞춰** 한 배열로 합친다.
 *
 *  그냥 두 배열을 나란히 그리면 안 된다. 내 조합과 벤치마크는 겹치는
 *  거래일이 다를 수 있다 — 한국 자산이 섞이면 휴장일이 어긋나고, 월
 *  데이터로 재면 솎인 날이 다르다. 칸 번호로 짝지으면 2020년 값이
 *  2021년 자리에 그려지는데, 그래프는 멀쩡해 보인다.
 *
 *  내 곡선의 날짜를 기준으로 삼고, 벤치마크는 그 날에 있는 값만 얹는다.
 *  없는 날은 비워 둔다(recharts 가 알아서 잇는다). */
export function 맞춰합치기(
  내것: { date: string; value: number }[],
  벤치?: { date: string; value: number }[],
): { date: string; 내것: number; 벤치?: number }[] {
  const 표 = new Map((벤치 ?? []).map((x) => [x.date, x.value]));
  return 내것.map((x) => {
    const b = 표.get(x.date);
    return b == null ? { date: x.date, 내것: x.value } : { date: x.date, 내것: x.value, 벤치: b };
  });
}

/** 세로축 설정 — 로그인가 아닌가.
 *
 *  차트 안에 직접 적으면 jsdom 에서는 검사할 수가 없다(recharts 가
 *  레이아웃을 안 그린다). 값을 돌려주는 함수로 빼 두면 로그를 켜고
 *  껐을 때 축이 실제로 바뀌는지 확인할 수 있다.
 *
 *  로그 축에서는 domain 을 auto 로 둬야 한다 — recharts 가 밑을 0 으로
 *  잡으면 log(0) 이라 아무것도 안 그린다. */
export function 축설정(로그켬: boolean) {
  return 로그켬
    ? { scale: "log" as const, domain: ["auto", "auto"] as const }
    : { scale: "auto" as const, domain: undefined };
}

/** 로그 축을 쓸 수 있나.
 *
 *  로그는 0 이나 음수를 못 그린다. 평가액이 0 이 되는 일은 드물지만
 *  전액 손실이면 실제로 0 이 나온다 — 그때 로그를 켜면 그래프가 통째로
 *  사라지고, 사용자는 앱이 고장 난 줄 안다. 못 쓸 때는 단추를 아예
 *  안 보여 준다. */
export function 로그가능(칸들: { 내것: number; 벤치?: number }[]): boolean {
  return 칸들.every((x) => x.내것 > 0 && (x.벤치 == null || x.벤치 > 0));
}

function 자산흐름({ r }: { r: 자산배분결과 }) {
  const [로그, set로그] = useState(false);
  const [벤치보기, set벤치보기] = useState(true);

  const 합친것 = useMemo(
    () => 맞춰합치기(r.curve, r.benchmark?.curve),
    [r.curve, r.benchmark],
  );
  const 벤치있음 = !!r.benchmark && 합친것.some((x) => x.벤치 != null);
  const 쓸수있나 = 로그가능(합친것);
  /* 못 쓰는데 켜져 있으면 끈다 — 다른 실험을 불러와 값이 0 이 될 수 있다 */
  const 로그켬 = 로그 && 쓸수있나;

  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2 flex-wrap">
        <span className="text-sm font-semibold text-text-primary">자산 흐름</span>
        <div className="flex items-center gap-1.5">
          {벤치있음 && (
            <고른칩 작게 고름={벤치보기} onClick={() => set벤치보기((v) => !v)}
                    ariaLabel={`${r.benchmark!.name} 같이 보기`}>
              {r.benchmark!.name}
            </고른칩>
          )}
          {/* 로그 축은 **비율로 읽는 축**이다. 30년을 선형으로 그리면
              초반 10년이 바닥에 눌려 아무것도 안 보인다 — 같은 2배가
              1,000만→2,000만이든 1억→2억이든 똑같은 높이로 보이게 한다.
              쓸 수 없을 때(값이 0 이하) 아예 안 보여 준다. */}
          {쓸수있나 && (
            <고른칩 작게 고름={로그켬} onClick={() => set로그((v) => !v)}
                    ariaLabel="로그 축">로그</고른칩>
          )}
        </div>
      </div>
      <div className="p-2">
        <Suspense fallback={<div className="h-[220px] flex items-center justify-center text-xs text-text-dim">그리는 중…</div>}>
          <차트틀 height={220}>
            {(R: any) => (
              <R.AreaChart data={합친것} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                <defs>
                  <linearGradient id="bt-alloc" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent-blue)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--accent-blue)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <R.XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={48} />
                <R.YAxis tick={{ fontSize: 10 }} width={54}
                         {...축설정(로그켬)}
                         allowDataOverflow={false}
                         tickFormatter={(v: number) => 눈금글(v, r.currency)} />
                <R.Tooltip formatter={(v: number, 이름: string) =>
                  [돈(v, r.currency), 이름 === "내것" ? "내 조합" : r.benchmark?.name ?? "벤치마크"]} />
                <R.Area type="monotone" dataKey="내것" name="내것" stroke="var(--accent-blue)"
                        fill="url(#bt-alloc)" strokeWidth={2} dot={false} isAnimationActive={false} />
                {벤치있음 && 벤치보기 && (
                  /* 벤치마크는 **선만** 그린다. 면을 두 개 겹치면 색이
                     섞여 어느 쪽이 위인지 알 수 없다. 점선이라 흑백으로
                     인쇄해도, 색을 못 가리는 사람에게도 구분된다. */
                  <R.Area type="monotone" dataKey="벤치" name="벤치" stroke="var(--accent-purple)"
                          fill="none" strokeWidth={1.5} strokeDasharray="4 3"
                          dot={false} connectNulls isAnimationActive={false} />
                )}
              </R.AreaChart>
            )}
          </차트틀>
        </Suspense>
      </div>
      {로그켬 && (
        <p className="px-4 pb-3 text-2xs text-text-dim break-keep">
          로그 축이에요 — 같은 높이가 같은 <b>비율</b>이에요. 1,000만원이 2,000만원이
          되는 것과 1억이 2억이 되는 것이 같은 크기로 보여요.
        </p>
      )}
      {벤치있음 && 벤치보기 && (
        <p className="px-4 pb-3 text-2xs text-text-dim break-keep">
          점선이 {r.benchmark!.name}이에요. 같은 기간·같은 납입·같은 비용으로 돌렸어요.
        </p>
      )}
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════
   낙폭 — 그래프와 순위
   ═══════════════════════════════════════════════════════════ */

/** '1975일' 은 읽어도 감이 안 온다. '5년 5개월' 로 적는다. */
export function 걸린기간(날: number | null | undefined): string {
  if (날 == null) return "—";
  if (날 < 31) return `${날}일`;
  const 달 = Math.round(날 / 30.44);
  if (달 < 12) return `${달}개월`;
  const 해 = Math.floor(달 / 12);
  const 남은달 = 달 % 12;
  return 남은달 ? `${해}년 ${남은달}개월` : `${해}년`;
}

function 낙폭칸({ r }: { r: 자산배분결과 }) {
  const 배색 = useSettingsStore((s) => s.colorScheme);
  const 내림 = 내림색(배색);
  const [벤치보기, set벤치보기] = useState(true);

  const 합친것 = useMemo(() => {
    const 표 = new Map((r.benchmark?.drawdown ?? []).map((x) => [x.date, x.dd]));
    return (r.drawdown ?? []).map((x) => {
      const b = 표.get(x.date);
      return b == null ? { date: x.date, 내것: x.dd } : { date: x.date, 내것: x.dd, 벤치: b };
    });
  }, [r.drawdown, r.benchmark]);
  const 벤치있음 = 합친것.some((x) => x.벤치 != null);
  const 순위 = r.drawdowns ?? [];

  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2 flex-wrap">
        <span className="text-sm font-semibold text-text-primary">낙폭</span>
        {벤치있음 && (
          <고른칩 작게 고름={벤치보기} onClick={() => set벤치보기((v) => !v)}
                  ariaLabel={`${r.benchmark!.name} 같이 보기`}>
            {r.benchmark!.name}
          </고른칩>
        )}
      </div>
      {/* 낙폭은 '고점에서 얼마나 내려와 있나' 다. 0 이 맨 위고 아래로
          떨어진다 — 물에 잠긴 깊이처럼 읽힌다. 수익 곡선만 보면 오르는
          그림만 남아서, 중간에 얼마나 오래 잠겨 있었는지가 안 보인다. */}
      <div className="p-2">
        <Suspense fallback={<div className="h-[160px] flex items-center justify-center text-xs text-text-dim">그리는 중…</div>}>
          <차트틀 height={160}>
            {(R: any) => (
              <R.AreaChart data={합친것} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                <defs>
                  <linearGradient id="bt-dd" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={내림} stopOpacity={0.05} />
                    <stop offset="100%" stopColor={내림} stopOpacity={0.4} />
                  </linearGradient>
                </defs>
                <R.XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={48} />
                <R.YAxis tick={{ fontSize: 10 }} width={42}
                         tickFormatter={(v: number) => `${Math.round(v)}%`} />
                <R.Tooltip formatter={(v: number, 이름: string) =>
                  [`${v}%`, 이름 === "내것" ? "내 조합" : r.benchmark?.name ?? "벤치마크"]} />
                <R.Area type="monotone" dataKey="내것" name="내것" stroke={내림}
                        fill="url(#bt-dd)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                {벤치있음 && 벤치보기 && (
                  <R.Area type="monotone" dataKey="벤치" name="벤치" stroke="var(--accent-purple)"
                          fill="none" strokeWidth={1.5} strokeDasharray="4 3"
                          dot={false} connectNulls isAnimationActive={false} />
                )}
              </R.AreaChart>
            )}
          </차트틀>
        </Suspense>
      </div>

      {/* ── 깊은 낙폭 순위 ──
          최대 낙폭 하나만 보면 '한 번 크게 맞았다' 는 것밖에 모른다.
          실제로 견딜 수 있는지는 **얼마나 오래 잠겨 있었나**가 더 크게
          좌우한다 — -50% 를 1년 만에 회복한 것과 -35% 로 7년을 보낸
          것은 전혀 다른 경험이다. */}
      {순위.length > 0 && (
        <div className="border-t border-border">
          <div className="px-4 py-2.5 flex items-baseline justify-between gap-2">
            <span className="text-sm font-semibold text-text-primary">깊었던 순서</span>
            <span className="text-2xs text-text-dim">얼마나 오래 잠겼나까지</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-bg-secondary border-y border-border">
                {/* 폰에서는 표가 옆으로 밀린다. 제일 중요한 두 수 —
                    **얼마나 깊었나**와 **얼마나 오래 잠겼나** — 를 앞에
                    둬서 밀지 않고도 보이게 한다. 날짜 셋은 뒤로 보낸다.
                    (처음에는 날짜를 앞에 뒀는데, 폰으로 찍어 보니 정작
                     잠긴 기간이 화면 밖이었다.) */}
                <tr className="text-text-muted">
                  <th className="text-right px-3 py-2 whitespace-nowrap">낙폭</th>
                  <th className="text-right px-3 py-2 whitespace-nowrap">잠긴 기간</th>
                  <th className="text-left px-3 py-2 whitespace-nowrap">고점</th>
                  <th className="text-left px-3 py-2 whitespace-nowrap">바닥</th>
                  <th className="text-left px-3 py-2 whitespace-nowrap">회복</th>
                </tr>
              </thead>
              <tbody>
                {순위.map((d) => (
                  <tr key={d.start} className="border-b border-border/30">
                    <td className="px-3 py-2 text-right font-mono font-semibold whitespace-nowrap"
                        style={{ color: 내림 }}>{d.depth}%</td>
                    <td className="px-3 py-2 text-right text-text-secondary whitespace-nowrap">
                      {걸린기간(d.underwater_days)}
                      {!d.end && <span className="text-accent-yellow"> +</span>}
                    </td>
                    <td className="px-3 py-2 font-mono text-text-secondary whitespace-nowrap">{d.start}</td>
                    <td className="px-3 py-2 font-mono text-text-secondary whitespace-nowrap">{d.trough}</td>
                    {/* 아직 못 되찾았으면 **그렇다고 적는다.** 마지막
                        날짜를 넣으면 회복한 것처럼 읽힌다. */}
                    <td className="px-3 py-2 font-mono whitespace-nowrap">
                      {d.end
                        ? <span className="text-text-secondary">{d.end}</span>
                        : <span className="text-accent-yellow">아직</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {순위.some((d) => !d.end) && (
            <p className="px-4 py-2.5 text-2xs text-text-dim break-keep">
              '아직' 은 마지막 날까지 고점을 못 되찾았다는 뜻이에요. 잠긴 기간 뒤의
              <b> +</b>는 더 늘어날 수 있다는 표시예요.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}


/* ═══════════════════════════════════════════════════════════
   주요 지표 비교 · 폭락 때
   ═══════════════════════════════════════════════════════════ */

/** 한 줄 — 이름 · 내 값 · 벤치마크 값. */
function 비교줄({ 이름, 내것, 벤것, 색 }: {
  이름: string; 내것: React.ReactNode; 벤것?: React.ReactNode; 색?: string;
}) {
  return (
    <>
      <span className="text-xs text-text-muted whitespace-nowrap">{이름}</span>
      <span className={`text-xs font-mono tabular-nums text-right font-semibold ${색 ?? "text-text-primary"}`}>
        {내것}
      </span>
      <span className="text-xs font-mono tabular-nums text-right text-text-dim">
        {벤것 ?? "—"}
      </span>
    </>
  );
}

/** 해마다의 수익률 — 벤치마크가 있으면 **해별로 나란히** 견준다.
 *
 *  ── 왜 해마다 견줘야 하나 ─────────────────────────────────
 *
 *  전체 수익률 하나로는 '언제 이겼나' 를 알 수 없다. 8년 중 6년을
 *  지고도 한 해에 몰아쳐서 총합만 이긴 조합과, 해마다 조금씩 꾸준히
 *  이긴 조합은 전혀 다른 것인데 합계는 비슷하게 나온다. 앞엣것은
 *  운이었을 수 있고 뒤엣것은 실력일 수 있다.
 *
 *  2008년·2022년 같은 하락장에서 어땠는지도 여기서만 보인다. '내 것이
 *  -35%, S&P500 이 -37%' 는 총 수익률 어디에도 안 나온다.
 *
 *  ── 어떻게 그리나 ─────────────────────────────────────────
 *
 *  내 것은 **막대**, 벤치마크는 그 위의 **점**이다. 점이 막대 끝보다
 *  안쪽이면 내가 앞선 해, 바깥이면 뒤진 해 — 한눈에 읽힌다. 막대 둘을
 *  위아래로 쌓으면 길이 차이를 눈으로 재야 하는데, 같은 자 위의 점은
 *  잴 것도 없이 보인다.
 *
 *  ── 0 이 가운데 있어야 한다 ───────────────────────────────
 *
 *  점을 같은 자에 놓으려면 **0 의 자리가 있어야 한다.** 예전처럼 왼쪽
 *  끝에서 길이만 늘리면 부호가 색으로만 남는데, 그러면 -37% 점이
 *  +22% 막대보다 오른쪽에 찍혀 '더 좋아 보이는' 그림이 된다. 숫자와
 *  그림이 정반대를 말하는 셈이다.
 *
 *  0 을 가운데 두면 부호가 **자리**로 드러난다. 색 설정(초록 상승/
 *  빨강 상승)을 바꿔도, 색을 구분 못 하는 사람에게도 그대로 읽힌다.
 *
 *  ── 자 ────────────────────────────────────────────────────
 *
 *  **두 줄이 같은 자로 재야 한다.** 각자 최대에 맞춰 늘리면 -5% 와
 *  -37% 가 같은 길이로 그려져, 눈으로 보는 것과 숫자가 서로 다른 말을
 *  한다. 그래서 둘을 통틀어 제일 큰 값에 맞춘다.
 */
function 해마다칸({ r }: { r: 자산배분결과 }) {
  const 배색 = useSettingsStore((s) => s.colorScheme);
  const { pnlColor } = usePnlColors(배색);
  const b = r.benchmark;

  /** {해: 벤치마크 수익률}. 해로 짝짓는다 — 차례로 짝지으면 한 해가
   *  비었을 때 그 뒤가 통째로 한 칸씩 밀려 엉뚱한 해와 견주게 된다. */
  const 벤해 = useMemo(() => {
    const m = new Map<number, number>();
    for (const y of b?.yearly ?? []) m.set(y.year, y.return);
    return m;
  }, [b]);

  const 견줄수있나 = 벤해.size > 0;

  /** 막대를 재는 자 — 두 줄을 통틀어 제일 큰 값. */
  const 자 = useMemo(() => {
    const 값들 = [...r.yearly.map((y) => Math.abs(y.return)),
                  ...[...벤해.values()].map((v) => Math.abs(v))];
    //: 다 0 이면 0 으로 나눈다. 최소 1%는 두어 막대가 사라지지 않게.
    return Math.max(1, ...값들);
  }, [r.yearly, 벤해]);

  /** 몇 해 중 몇 해를 앞섰나 — 표를 다 읽지 않아도 알 수 있게. */
  const 이긴해 = useMemo(() => {
    if (!견줄수있나) return null;
    let 이김 = 0, 잰해 = 0;
    for (const y of r.yearly) {
      const v = 벤해.get(y.year);
      if (v == null) continue;
      잰해 += 1;
      if (y.return > v) 이김 += 1;
    }
    return 잰해 > 0 ? { 이김, 잰해 } : null;
  }, [r.yearly, 벤해, 견줄수있나]);

  /** 값이 자 위에서 어디쯤인가 — 0 은 가운데(50%), 양 끝이 ±자. */
  const 자리 = (값: number) =>
    50 + Math.max(-1, Math.min(1, 값 / 자)) * 50;

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <span className="text-base font-semibold text-text-primary">해마다</span>
        {견줄수있나 && 이긴해 && (
          /* 표를 다 읽지 않아도 되는 한 줄. **이겼다/졌다 로 말하지
             않는다** — 지난 성적이 앞으로를 뜻하지 않는데, 'X 를
             이겼어요' 는 그렇게 읽힌다. 센 것만 적는다. */
          <span className="text-2xs text-text-muted">
            {이긴해.잰해}년 중 {이긴해.이김}년은 내 조합이 더 높았어요
          </span>
        )}
      </div>

      <p className="text-2xs text-text-dim break-keep -mt-2">
        그해에 넣은 돈은 빼고 잰 값이에요 — 안 빼면 매달 넣는 사람은 어떤 해든
        플러스가 나와요. 가운데 선이 0%예요.
        {견줄수있나 && " 점이 막대 끝보다 안쪽이면 그해는 내 조합이 더 높았어요."}
      </p>

      {/* 막대와 점이 뭘 뜻하는지 — 안 적으면 보고 추측하게 되고,
          추측이 반대면 결론이 통째로 뒤집힌다 */}
      {견줄수있나 && (
        <div className="flex items-center gap-3 text-2xs text-text-dim -mt-1 flex-wrap">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-2 rounded-sm bg-text-muted opacity-60" />
            내 조합
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-text-primary ring-2 ring-bg-card" />
            {b?.name}
          </span>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {r.yearly.map((y) => {
          const 벤 = 벤해.get(y.year);
          const 내자리 = 자리(y.return);
          const 색 = y.return >= 0 ? 오름색(배색) : 내림색(배색);
          return (
            <div key={y.year} className="flex items-center gap-2">
              <span className="text-xs text-text-muted w-10 flex-shrink-0 tabular-nums">
                {y.year}
              </span>

              {/* 0 을 가운데 둔 자. 막대는 가운데에서 자라고,
                  벤치마크는 같은 자 위의 점으로 찍힌다. */}
              <div className="relative flex-1 min-w-0 h-4 bg-bg-elevated rounded">
                {/* 0 선 — 이게 없으면 가운데가 어디인지 알 수 없다 */}
                <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
                <div
                  className="absolute inset-y-1 rounded-sm opacity-60"
                  style={{
                    left: `${Math.min(내자리, 50)}%`,
                    width: `${Math.abs(내자리 - 50)}%`,
                    backgroundColor: 색,
                  }}
                />
                {벤 != null && (
                  /* 점은 **색을 안 쓴다.** 막대와 색으로 다투면 어느
                     것이 무엇인지 헷갈리고, 부호는 이미 자리로 드러나
                     있어 색이 할 일이 없다. 테두리를 둘러 막대 위에
                     겹쳐도 보이게 한다. */
                  <div
                    className="absolute top-1/2 w-2 h-2 -translate-y-1/2 -translate-x-1/2
                               rounded-full bg-text-primary ring-2 ring-bg-card"
                    style={{ left: `${자리(벤)}%` }}
                    title={`${b?.name} ${벤 >= 0 ? "+" : ""}${벤}%`}
                  />
                )}
              </div>

              <div className="w-14 flex-shrink-0 flex flex-col gap-0.5 text-right">
                <span className={`text-xs font-mono tabular-nums ${pnlColor(y.return)}`}>
                  {y.return >= 0 ? "+" : ""}{y.return}%
                </span>
                {벤 != null && (
                  <span className="text-2xs font-mono tabular-nums text-text-dim">
                    {벤 >= 0 ? "+" : ""}{벤}%
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 지수는 배당이 없다. 해마다 몇 %p 씩 불리하게 나오므로,
          이 표를 읽기 전에 알아야 한다. */}
      {견줄수있나 && b?.index_only && (
        <p className="text-2xs text-text-dim break-keep">
          {b.name}는 지수라 배당이 빠져 있어요. 배당까지 받은 내 조합과는
          그만큼 기준이 달라요.
        </p>
      )}
    </Card>
  );
}

function 요약표({ r }: { r: 자산배분결과 }) {
  const 배색 = useSettingsStore((s) => s.colorScheme);
  const { pnlColor, loss } = usePnlColors(배색);
  const b = r.benchmark;
  const 퍼 = (v: number | null | undefined) => 수(v, 2, "", "%");

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <span className="text-base font-semibold text-text-primary">주요 지표</span>
        <span className="text-2xs text-text-dim">{r.start_date} ~ {r.end_date}</span>
      </div>

      <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-2 items-baseline">
        <span className="text-2xs text-text-dim" />
        <span className="text-2xs text-text-muted font-medium text-right">내 조합</span>
        <span className="text-2xs text-text-dim text-right truncate max-w-[6rem]">
          {b?.name ?? "—"}
        </span>

        <비교줄 이름="기간 수익률" 내것={퍼(r.total_return)} 벤것={퍼(b?.total_return)}
                색={pnlColor(r.total_return ?? 0)} />
        <비교줄 이름="연환산 (TWR)" 내것={퍼(r.twr_annual)} 벤것={퍼(b?.twr_annual)}
                색={pnlColor(r.twr_annual ?? 0)} />
        <비교줄 이름="이번 달" 내것={퍼(r.this_month)} 벤것={퍼(b?.this_month)}
                색={pnlColor(r.this_month ?? 0)} />
        <비교줄 이름="올해" 내것={퍼(r.ytd)} 벤것={퍼(b?.ytd)} 색={pnlColor(r.ytd ?? 0)} />

        <div className="col-span-3 h-px bg-border my-0.5" />

        <비교줄 이름="월 최고" 내것={퍼(r.best_month)} 벤것={퍼(b?.best_month)}
                색={pnlColor(r.best_month ?? 0)} />
        <비교줄 이름="월 최저" 내것={퍼(r.worst_month)} 벤것={퍼(b?.worst_month)}
                색={pnlColor(r.worst_month ?? 0)} />
        {/* 오른 달이 몇 달 중 몇 달인가 — 연 수익률만 보면 한 해 안의
            출렁임이 통째로 사라진다. */}
        <비교줄 이름="오른 달"
                내것={`${r.positive_months} / ${r.total_months}`}
                벤것={b?.total_months ? `${b.positive_months} / ${b.total_months}` : undefined} />

        <div className="col-span-3 h-px bg-border my-0.5" />

        <비교줄 이름="연 변동성" 내것={퍼(r.volatility)} 벤것={퍼(b?.volatility)} />
        <비교줄 이름="최대 낙폭" 내것={수(r.mdd, 1, "-", "%")} 벤것={수(b?.mdd, 1, "-", "%")}
                색={loss} />
        {/* 같은 -30% 라도 2008년이었는지 작년이었는지에 따라 읽는 뜻이
            전혀 다르다. */}
        <비교줄 이름="낙폭 바닥" 내것={r.mdd_date ?? "—"} 벤것={b?.mdd_date ?? undefined} />
        <비교줄 이름="샤프" 내것={수(r.sharpe, 2)} 벤것={수(b?.sharpe, 2)} />
        {/* 샤프는 오르내림을 가리지 않는다 — 크게 오르기만 해도 '위험' 으로
            잡힌다. 소티노는 내려간 흔들림만 센다. */}
        <비교줄 이름="소티노" 내것={수(r.sortino, 2)} 벤것={수(b?.sortino, 2)} />

        <div className="col-span-3 h-px bg-border my-0.5" />

        {([["1년", r.return_1y, b?.return_1y], ["3년", r.return_3y, b?.return_3y],
           ["5년", r.return_5y, b?.return_5y]] as const).map(([이름, a, c]) => (
          <비교줄 key={이름} 이름={`최근 ${이름}`} 내것={퍼(a)} 벤것={퍼(c)}
                  색={pnlColor(a ?? 0)} />
        ))}
        {([["1년", r.std_1y, b?.std_1y], ["3년", r.std_3y, b?.std_3y],
           ["5년", r.std_5y, b?.std_5y]] as const).map(([이름, a, c]) => (
          <비교줄 key={`s${이름}`} 이름={`${이름} 표준편차`} 내것={퍼(a)} 벤것={퍼(c)} />
        ))}
      </div>

      {/* 자료가 거기까지 없으면 '—' 다. 3개월치를 '1년 수익률' 이라
          적으면 안 되므로 억지로 채우지 않는다. */}
      <p className="text-2xs text-text-dim break-keep">
        '—' 는 잴 자료가 없다는 뜻이에요 — 없는 수를 지어내지 않아요.
      </p>
    </Card>
  );
}

function 폭락표({ r }: { r: 자산배분결과 }) {
  const 배색 = useSettingsStore((s) => s.colorScheme);
  const { pnlColor } = usePnlColors(배색);
  const 것들 = r.crises ?? [];
  if (!것들.length) return null;
  const 벤치 = new Map((r.benchmark?.crises ?? []).map((x) => [x.key, x.return]));

  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <span className="text-sm font-semibold text-text-primary">폭락 때 어땠나</span>
        {/* '최대 낙폭 -30%' 만으로는 언제 어떤 일로 그랬는지 모른다.
            사람은 '코로나 때' 로 기억하므로, 기억에 걸리는 이름이
            붙어야 수가 읽힌다. */}
        <p className="text-2xs text-text-dim mt-0.5 break-keep">
          시장이 고점에서 바닥까지 간 구간이에요. 회복까지 넣으면 대부분 플러스로
          끝나서 얼마나 아팠는지가 사라져요.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-bg-secondary border-b border-border">
            <tr className="text-text-muted">
              <th className="text-left px-3 py-2 whitespace-nowrap">언제</th>
              <th className="text-right px-3 py-2 whitespace-nowrap">내 조합</th>
              <th className="text-right px-3 py-2 whitespace-nowrap truncate">
                {r.benchmark?.name ?? "—"}
              </th>
              <th className="text-left px-3 py-2 whitespace-nowrap">기간</th>
            </tr>
          </thead>
          <tbody>
            {것들.map((x) => {
              const 벤 = 벤치.get(x.key);
              return (
                <tr key={x.key} className="border-b border-border/30">
                  <td className="px-3 py-2 text-text-primary whitespace-nowrap">
                    {x.name}
                    {/* 일부만 겹쳤으면 그렇다고 적는다 — 2020-02-19 부터라고
                        적어 놓고 3월 2일부터 쟀으면 그 차이가 곧 결과의
                        차이다. */}
                    {x.partial && (
                      <span className="text-accent-yellow text-2xs ml-1">일부</span>
                    )}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono font-semibold whitespace-nowrap ${pnlColor(x.return)}`}>
                    {x.return}%
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-text-dim whitespace-nowrap">
                    {벤== null ? "—" : `${벤}%`}
                  </td>
                  <td className="px-3 py-2 text-text-dim whitespace-nowrap">
                    {x.partial ? `${x.measured_start} ~ ${x.measured_end}` : `${x.start} ~ ${x.end}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {것들.some((x) => x.partial) && (
        <p className="px-4 py-2.5 text-2xs text-text-dim break-keep">
          '일부' 는 그 구간에 자료가 일부만 걸쳤다는 뜻이에요 — 옆에 적힌 기간이
          실제로 잰 구간이에요.
        </p>
      )}
    </Card>
  );
}

/** 무엇을 어떤 비중으로 담았나.
 *
 *  결과만 보고 있으면 **무슨 조합이었는지 잊는다** — 특히 저장해 둔
 *  실험을 나중에 열었을 때 그렇다. 설정 화면으로 돌아가 확인해야 하는데,
 *  그러면 결과가 화면에서 사라진다.
 *
 *  서버가 준 비중을 그대로 쓴다. 화면에서 다시 계산하면 '동일 비중' 이나
 *  '합이 100이 아닌 입력' 을 서버와 다르게 풀 수 있고, 그러면 결과를
 *  낸 비중과 화면에 적힌 비중이 달라진다. */
function 담은자산({ r }: { r: 자산배분결과 }) {
  const 것들 = r.assets ?? [];
  if (!것들.length) return null;
  /* 서버는 비율(0.6)로 준다 — 합으로 나눈 값이다. 퍼센트로 보여 준다. */
  const 합 = 것들.reduce((a, x) => a + (Number(x.weight) || 0), 0);
  return (
    <Card className="flex flex-col gap-3">
      <span className="text-base font-semibold text-text-primary">담은 자산</span>
      <div className="flex flex-col gap-1.5">
        {것들.map((a) => {
          const 몫 = 합 > 0 ? (Number(a.weight) || 0) / 합 * 100 : 0;
          return (
            <div key={`${a.market}:${a.symbol}`} className="flex items-center gap-2">
              <span className="text-xs text-text-primary truncate flex-1 min-w-0">
                {a.name || a.symbol}
              </span>
              <div className="w-20 h-2 bg-bg-elevated rounded-full overflow-hidden flex-shrink-0">
                <div className="h-full bg-accent-blue/70 rounded-full"
                     style={{ width: `${Math.min(몫, 100)}%` }} />
              </div>
              <span className="text-xs font-mono tabular-nums text-text-secondary w-12 text-right flex-shrink-0">
                {몫.toFixed(1)}%
              </span>
            </div>
          );
        })}
      </div>
      {/* 실제로 계산에 쓴 비중이라고 말해 준다 — '동일 비중' 을 골랐으면
          내가 적은 수와 다를 수 있다. */}
      <p className="text-2xs text-text-dim break-keep">
        계산에 실제로 쓴 비중이에요.
      </p>
    </Card>
  );
}

export default function 자산배분결과화면({ r }: { r: 자산배분결과 }) {
  const 벌었나 = (r.profit ?? 0) >= 0;
  const 적립했나 = r.contributed > 0 && r.curve.length > 0;
  /* 오름·내림 색은 **설정으로 갈린다.** 초록/빨강 쓰는 사람과 빨강/파랑
     쓰는 사람이 있고, 한국·중국 쪽은 오름이 빨강인 것이 익숙하다.
     이 화면은 그 설정을 안 보고 text-accent-green/red 를 손으로 박아
     놔서, '빨강-파랑' 으로 바꿔 둔 사람에게는 이 화면만 거꾸로 보였다 —
     같은 앱 안에서 빨강이 한 화면에서는 오름이고 다른 화면에서는
     내림이면 숫자를 잘못 읽는다. */
  const 배색 = useSettingsStore((s) => s.colorScheme);
  const { pnlColor, gain, loss } = usePnlColors(배색);
  const 번색 = 벌었나 ? gain : loss;
  /* 결과를 넷으로 나눠 본다. 수익률로 시작하는 것은 사람이 제일 먼저
     묻는 것이 '얼마나 벌었나' 이기 때문이다. */
  const [보기, set보기] = useState("수익");

  return (
    <div className="flex flex-col gap-4">
      {/* 서버가 무엇을 못 했는지 **먼저** 알린다.
          자산 하나를 조용히 빼고 계산하면 사용자는 다 담은 줄 알고
          덜 담긴 결과를 본다 — 백테스트에서 가장 나쁜 실패다 */}
      {(r.skipped.length > 0 || r.fx_skipped.length > 0) && (
        <Card className="flex flex-col gap-1 border-accent-yellow/40">
          <span className="text-sm font-semibold text-accent-yellow">일부 자산을 빼고 계산했어요</span>
          {r.skipped.length > 0 && (
            <span className="text-xs text-text-muted break-keep">
              시세를 못 받음: {r.skipped.join(", ")}
            </span>
          )}
          {r.fx_skipped.length > 0 && (
            <span className="text-xs text-text-muted break-keep">
              환율을 못 맞춤: {r.fx_skipped.join(", ")}
            </span>
          )}
        </Card>
      )}

      {/* ── 탭 ──
          카드가 계속 늘어 폰에서 한참 스크롤해야 무엇이 있는지 안다.
          넷으로 나눈다 — 수익률(얼마나 벌었나) · 낙폭(얼마나 아팠나) ·
          지표(견주기) · 세부(무엇을 담고 무엇을 가정했나).

          **경고는 탭 밖에 둔다.** 자산 하나를 빼고 계산한 사실이 탭
          안에 숨으면, 그 탭을 안 연 사람은 덜 담긴 결과를 온전한 것으로
          읽는다 — 백테스트에서 가장 나쁜 실패다. */}
      <Tabs
        ariaLabel="결과 보기"
        idPrefix="결과"
        tabs={[{ id: "수익", label: "수익률" }, { id: "낙폭", label: "낙폭" },
               { id: "지표", label: "지표" }, { id: "세부", label: "세부" }]}
        active={보기}
        onChange={set보기}
      />

      <div role="tabpanel" id="결과-panel-수익" aria-labelledby="결과-tab-수익"
           hidden={보기 !== "수익"} className="flex flex-col gap-4">
        {보기 === "수익" && (<>
      {/* ── 넣은 돈 → 최종 ── 맨 위에 둔다 ── */}
      <Card className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <span className="text-sm text-text-muted">
            {r.start_date} ~ {r.end_date} · {r.years}년
          </span>
          <span className="text-2xs text-text-dim">{r.currency} 기준</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <칸 이름="총 납입금" 값={돈(r.contributed, r.currency)}
             밑={적립했나 ? "초기 금액 + 추가 납입 전부" : undefined} />
          <칸 이름="최종 평가액" 값={돈(r.final_value, r.currency)} />
        </div>
        {/* flex-wrap 이 없으면 금액이 길 때 옆의 퍼센트가 화면 밖으로
            밀려 나간다 — 수익률은 금액만큼 중요한 수라 사라지면 안 된다 */}
        <div className="flex items-baseline gap-2 px-1 flex-wrap">
          <span className="text-sm text-text-muted">수익</span>
          <span className={`${(돈(r.profit, r.currency).length > 15 ? "text-base" : "text-2xl")} font-mono font-bold tabular-nums ${번색}`}>
            {벌었나 ? "+" : ""}{돈(r.profit, r.currency)}
          </span>
          <span className={`text-sm font-mono ${번색}`}>
            ({수(r.total_return, 2, 벌었나 ? "+" : "", "%")})
          </span>
        </div>
        <p className="text-2xs text-text-dim break-keep px-1">
          수익률은 <b>넣은 돈 전부</b>를 기준으로 잰 값이에요. 초기 금액만으로 재면
          매달 넣은 돈이 수익으로 둔갑해요.
        </p>
      </Card>

      {/* ── 벤치마크 ── 수익률만으로는 잘한 것인지 알 수 없다 ── */}
      {r.benchmark && (
        <Card className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <span className="text-base font-semibold text-text-primary">
              {r.benchmark.name} 와 견주기
            </span>
            {/* 같은 기간·같은 납입·같은 비용으로 돌린 것이라고 말해 준다.
                조건이 다르면 견줄 수 없는 수인데, 그걸 모르면 그냥 믿는다 */}
            <span className="text-2xs text-text-dim">같은 기간 · 같은 납입</span>
          </div>
          {/* 칸에 이름을 붙인다. 숫자 둘만 나란히 두면 어느 쪽이 내
              것인지 알 수 없고, 색이 어느 쪽 이야기인지도 모호해진다.
              색은 **내 값**에 칠한다 — 오름 색이면 내 쪽이 나은 것이다.
              (색 이름은 글로 적지 않는다. 설정에서 초록-빨강과 빨강-파랑을
               고를 수 있어서, '초록이면 좋다' 는 설명이 절반의 사람에게는
               거짓이 된다.) */}
          <div className="grid grid-cols-[1fr_1fr_1fr] gap-x-2 gap-y-1.5 items-baseline">
            <span className="text-2xs text-text-dim" />
            <span className="text-2xs text-text-muted font-medium text-right">내 조합</span>
            <span className="text-2xs text-text-dim text-right truncate">{r.benchmark.name}</span>

            {([
              /* 견주는 칸에서는 금액을 **줄여서** 적는다.
                 세 칸을 390px 에 나누면 20자리 수가 잘리는데, 돈이
                 잘리면 억인지 조인지 알 수 없다. 여기서 필요한 것은
                 '어느 쪽이 큰가' 이고, 정확한 금액은 바로 위 칸에
                 온전히 적혀 있다. */
              ["최종 평가액", 눈금글(r.final_value, r.currency),
               눈금글(r.benchmark.final_value, r.currency),
               (r.final_value ?? 0) - (r.benchmark.final_value ?? 0)],
              ["연환산 (TWR)", 수(r.twr_annual, 2, "", "%"), 수(r.benchmark.twr_annual, 2, "", "%"),
               (r.twr_annual ?? 0) - (r.benchmark.twr_annual ?? 0)],
              ["최대 낙폭", 수(r.mdd, 1, "-", "%"), 수(r.benchmark.mdd, 1, "-", "%"),
               /* 낙폭만 작을수록 좋다 — 부호를 뒤집어야 '내가 나음' 이 맞는다.
                  안 뒤집으면 **더 크게 물린 쪽**이 초록으로 칠해져서,
                  위험한 조합을 좋은 것으로 읽게 된다. */
               (r.benchmark.mdd ?? 0) - (r.mdd ?? 0)],
            ] as [string, string, string, number][]).map(([이름, 내것, 벤것, 차]) => (
              <Fragment key={이름}>
                <span className="text-xs text-text-muted">{이름}</span>
                <span className={`text-xs font-mono tabular-nums text-right font-semibold truncate ${pnlColor(차)}`}>
                  {내것}
                </span>
                <span className="text-xs font-mono tabular-nums text-right text-text-dim truncate">
                  {벤것}
                </span>
              </Fragment>
            ))}
          </div>
          {/* 색으로 좋고 나쁨을 말하는 문구는 없앴다 — 설정에 따라
              오름 색이 초록일 수도 빨강일 수도 있다. 대신 색만으로는
              알 수 없는 것(낙폭은 작을수록 좋다)만 남긴다. */}
          <p className="text-2xs text-text-dim break-keep">
            낙폭은 작은 쪽이 나은 거예요.
          </p>
          {/* 지수는 **배당이 없다.** 내 조합은 토탈 리턴으로 쟀는데
              견주는 쪽만 배당을 못 받으면, 지수가 실제보다 나빠 보인다 —
              방향만 반대일 뿐 '벤치마크만 배당을 못 받던' 그 문제와
              같은 종류다. 감추지 않고 적는다. */}
          {/* dividends 가 있다는 것이 곧 '토탈 리턴으로 쟀다' 는 뜻이다 —
              서버가 배당표를 넘겼을 때만 이 값이 채워진다. 굳이 칸을
              하나 더 만들면 둘이 어긋날 자리가 생긴다. */}
          {r.benchmark.index_only && r.dividends != null && (
            <p className="text-2xs text-accent-yellow/90 break-keep">
              코스피는 ETF 가 아니라 <b>지수</b>예요 — 배당이 안 들어 있어서
              실제로 그 지수를 담았을 때보다 낮게 나와요.
            </p>
          )}
        </Card>
      )}

      {/* ── 연환산 두 가지 ── */}
      <Card className="flex flex-col gap-3">
        <span className="text-base font-semibold text-text-primary">연환산 수익률</span>
        <div className="grid grid-cols-2 gap-3">
          <칸 이름="전략 성적 (TWR)" 값={수(r.twr_annual, 2, "", "%")}
             색={pnlColor(r.twr_annual ?? 0)}
             밑="넣은 시점의 영향을 지운 값. 다른 전략과 비교할 때 써요" />
          <칸 이름="내 수익률 (IRR)" 값={수(r.irr_annual, 2, "", "%")}
             색={pnlColor(r.irr_annual ?? 0)}
             밑="늦게 넣은 돈은 덜 굴렀다는 게 반영된 값" />
        </div>
        {r.twr_annual == null && (
          <p className="text-2xs text-text-dim break-keep">
            1년이 안 되는 기간은 연으로 늘리지 않아요. 짧은 성적을 연으로 부풀리면
            터무니없는 수가 나와요.
          </p>
        )}
      </Card>

      {/* ── 위험 ── */}
      <Card className="flex flex-col gap-3">
        <span className="text-base font-semibold text-text-primary">위험</span>
        <div className="grid grid-cols-3 gap-3">
          <칸 이름="최대 낙폭" 값={수(r.mdd, 1, "-", "%")} 색={loss} />
          <칸 이름="연 변동성" 값={수(r.volatility, 1, "", "%")} />
          <칸 이름="샤프 비율" 값={수(r.sharpe, 2)} />
        </div>
        {r.dividends != null && (
          <p className="text-2xs text-text-dim">
            배당 재투자 {돈(r.dividends, r.currency)} 포함
          </p>
        )}
        {/* **무엇을 가정하고 잰 수인가**를 적는다.
            · 낙폭은 넣은 돈을 지운 곡선에서 잰다 — 안 그러면 적립할수록
              낙폭이 작아 보인다(실측 37.7% → 32.8%)
            · 샤프는 무위험수익률을 뺀 초과수익이다. 무엇을 뺐는지 안
              적으면 사람이 자기 기준으로 읽는다
            가정을 감추는 것이 가정 자체보다 나쁘다. */}
        <p className="text-2xs text-text-dim break-keep">
          낙폭은 넣은 돈을 뺀 기준 · 샤프는 무위험 {r.risk_free_rate ?? 0}% 기준
          {(r.cash_rate ?? 0) > 0
            ? ` · 현금 이자 연 ${r.cash_rate}%`
            : " · 현금은 이자 없음"}
        </p>
      </Card>
      {/* ── 자산 흐름 ── */}
      {r.curve.length > 1 && <자산흐름 r={r} />}
      {/* ── 해마다 (벤치마크가 있으면 해별로 나란히) ── */}
      {r.yearly.length > 0 && <해마다칸 r={r} />}
        </>)}
      </div>

      <div role="tabpanel" id="결과-panel-낙폭" aria-labelledby="결과-tab-낙폭"
           hidden={보기 !== "낙폭"} className="flex flex-col gap-4">
        {보기 === "낙폭" && (<>
          {(r.drawdown?.length ?? 0) > 1 && <낙폭칸 r={r} />}
          <폭락표 r={r} />
        </>)}
      </div>

      <div role="tabpanel" id="결과-panel-지표" aria-labelledby="결과-tab-지표"
           hidden={보기 !== "지표"} className="flex flex-col gap-4">
        {보기 === "지표" && <요약표 r={r} />}
      </div>

      <div role="tabpanel" id="결과-panel-세부" aria-labelledby="결과-tab-세부"
           hidden={보기 !== "세부"} className="flex flex-col gap-4">
        {보기 === "세부" && (<>
          <담은자산 r={r} />
        </>)}
      </div>

      {/* ── 무엇을 넣고 무엇을 뺐는지 ── **탭 밖에 둔다** ──

          이건 결과의 각주가 아니라 **보고 있는 숫자의 조건**이다.
          수수료를 안 넣고 잰 수익률을 '세부' 탭에 숨기면, 그 탭을 안 연
          사람은 수수료가 반영된 수로 읽는다. 월 데이터로 재서 낙폭이
          작게 나온 것도 마찬가지다.

          탭으로 나눈 것은 카드가 많아서지, 감추려는 것이 아니다. */}
      <div className="flex flex-col gap-1 px-1">
        {r.costs_included ? (
          <p className="text-2xs text-text-dim break-keep">
            거래비용 {r.cost_rate != null ? `${+(r.cost_rate * 100).toFixed(3)}%` : ""} 반영 —
            모두 {돈(r.costs, r.currency)}를 수수료로 냈어요. 살 때도 팔 때도 매겼어요.
          </p>
        ) : (
          <p className="text-2xs text-text-dim break-keep">
            수수료·세금·슬리피지는 반영하지 않았어요. 실제 성과는 이보다 조금 낮아요 —
            설정에서 거래비용을 고르면 넣어 드려요.
          </p>
        )}

        {r.data_interval === "monthly" && (
          <p className="text-2xs text-text-dim break-keep">
            월 데이터로 쟀어요. 최대 낙폭은 실제보다 작게 나와요 —
            달 안에서 떨어졌다 돌아온 것은 안 보여요.
          </p>
        )}

        {/* 지수로 이은 구간이 있으면 **반드시** 말한다.
            조용히 이으면 사용자는 1980년치 SPY 자료가 있는 줄 안다 */}
        {Object.keys(r.extended_from ?? {}).length > 0 && (
          <p className="text-2xs text-accent-yellow/90 break-keep">
            {Object.entries(r.extended_from).map(([s, d]) => `${s}는 ${d}`).join(", ")}부터
            지수로 이었어요. 그 구간은 <b>배당과 운용보수가 빠진 지수</b>라
            실제 ETF와 조금 달라요.
          </p>
        )}
      </div>
    </div>
  );
}
