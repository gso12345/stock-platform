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
import { Card, 고른칩 } from "@/components/ui";
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
              색은 **내 값**에 칠한다 — '내 숫자가 초록이면 내가 나음' 이
              설명 없이도 읽힌다. */}
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
          <p className="text-2xs text-text-dim break-keep">
            내 숫자가 초록이면 그 항목은 내 쪽이 나아요. 낙폭은 작은 쪽이 나은 거예요.
          </p>
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

      {/* ── 낙폭 ── */}
      {(r.drawdown?.length ?? 0) > 1 && <낙폭칸 r={r} />}

      {/* ── 해마다 ── */}
      {r.yearly.length > 0 && (
        <Card className="flex flex-col gap-3">
          <span className="text-base font-semibold text-text-primary">해마다</span>
          <p className="text-2xs text-text-dim break-keep -mt-2">
            그해에 넣은 돈은 빼고 잰 값이에요 — 안 빼면 매달 넣는 사람은 어떤 해든
            플러스가 나와요.
          </p>
          <div className="flex flex-col gap-1">
            {r.yearly.map((y) => (
              <div key={y.year} className="flex items-center gap-2">
                <span className="text-xs text-text-muted w-12 flex-shrink-0">{y.year}</span>
                <div className="flex-1 h-4 bg-bg-elevated rounded overflow-hidden flex items-center">
                  <div
                    className="h-full opacity-60"
                    style={{
                      backgroundColor: y.return >= 0 ? 오름색(배색) : 내림색(배색),
                      width: `${Math.min(Math.abs(y.return), 100)}%`,
                    }}
                  />
                </div>
                <span className={`text-xs font-mono w-16 text-right flex-shrink-0 ${pnlColor(y.return)}`}>
                  {y.return >= 0 ? "+" : ""}{y.return}%
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── 무엇을 넣고 무엇을 뺐는지 ──
          계산에 들어간 조건을 마지막에 모아 적는다. 이걸 안 적으면
          사용자는 자기가 고른 설정이 실제로 먹었는지 알 길이 없다 */}
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
