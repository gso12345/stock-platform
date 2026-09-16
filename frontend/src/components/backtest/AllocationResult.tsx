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
import { lazy, Suspense } from "react";
import { Card } from "@/components/ui";
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

export default function 자산배분결과화면({ r }: { r: 자산배분결과 }) {
  const 벌었나 = (r.profit ?? 0) >= 0;
  const 적립했나 = r.contributed > 0 && r.curve.length > 0;

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
          <span className={`${(돈(r.profit, r.currency).length > 15 ? "text-base" : "text-2xl")} font-mono font-bold tabular-nums ${벌었나 ? "text-accent-green" : "text-accent-red"}`}>
            {벌었나 ? "+" : ""}{돈(r.profit, r.currency)}
          </span>
          <span className={`text-sm font-mono ${벌었나 ? "text-accent-green" : "text-accent-red"}`}>
            ({수(r.total_return, 2, 벌었나 ? "+" : "", "%")})
          </span>
        </div>
        <p className="text-2xs text-text-dim break-keep px-1">
          수익률은 <b>넣은 돈 전부</b>를 기준으로 잰 값이에요. 초기 금액만으로 재면
          매달 넣은 돈이 수익으로 둔갑해요.
        </p>
      </Card>

      {/* ── 연환산 두 가지 ── */}
      <Card className="flex flex-col gap-3">
        <span className="text-base font-semibold text-text-primary">연환산 수익률</span>
        <div className="grid grid-cols-2 gap-3">
          <칸 이름="전략 성적 (TWR)" 값={수(r.twr_annual, 2, "", "%")}
             색={(r.twr_annual ?? 0) >= 0 ? "text-accent-green" : "text-accent-red"}
             밑="넣은 시점의 영향을 지운 값. 다른 전략과 비교할 때 써요" />
          <칸 이름="내 수익률 (IRR)" 값={수(r.irr_annual, 2, "", "%")}
             색={(r.irr_annual ?? 0) >= 0 ? "text-accent-green" : "text-accent-red"}
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
          <칸 이름="최대 낙폭" 값={수(r.mdd, 1, "-", "%")} 색="text-accent-red" />
          <칸 이름="연 변동성" 값={수(r.volatility, 1, "", "%")} />
          <칸 이름="샤프 비율" 값={수(r.sharpe, 2)} />
        </div>
        {r.dividends != null && (
          <p className="text-2xs text-text-dim">
            배당 재투자 {돈(r.dividends, r.currency)} 포함
          </p>
        )}
      </Card>

      {/* ── 자산 곡선 ── */}
      {r.curve.length > 1 && (
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <span className="text-sm font-semibold text-text-primary">자산 흐름</span>
          </div>
          <div className="p-2">
            <Suspense fallback={<div className="h-[220px] flex items-center justify-center text-xs text-text-dim">그리는 중…</div>}>
              <차트틀 height={220}>
                {(R: any) => (
                  <R.AreaChart data={r.curve} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                    <defs>
                      <linearGradient id="bt-alloc" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--accent-blue)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="var(--accent-blue)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <R.XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={48} />
                    <R.YAxis tick={{ fontSize: 10 }} width={54}
                             tickFormatter={(v: number) => 눈금글(v, r.currency)} />
                    <R.Tooltip formatter={(v: number) => 돈(v, r.currency)} />
                    <R.Area type="monotone" dataKey="value" stroke="var(--accent-blue)"
                            fill="url(#bt-alloc)" strokeWidth={2} dot={false} />
                  </R.AreaChart>
                )}
              </차트틀>
            </Suspense>
          </div>
        </Card>
      )}

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
                    className={`h-full ${y.return >= 0 ? "bg-accent-green/60" : "bg-accent-red/60"}`}
                    style={{ width: `${Math.min(Math.abs(y.return), 100)}%` }}
                  />
                </div>
                <span className={`text-xs font-mono w-16 text-right flex-shrink-0 ${y.return >= 0 ? "text-accent-green" : "text-accent-red"}`}>
                  {y.return >= 0 ? "+" : ""}{y.return}%
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 거래비용을 안 넣었다는 사실을 감추지 않는다.
          자산배분은 사고파는 횟수가 적어 영향이 작지만 0 은 아니다 */}
      {!r.costs_included && (
        <p className="text-2xs text-text-dim break-keep px-1">
          수수료·세금·슬리피지는 아직 반영하지 않았어요. 실제 성과는 이보다 조금 낮아요.
        </p>
      )}
    </div>
  );
}
