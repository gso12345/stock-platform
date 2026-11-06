/**
 * 단일 종목 백테스트 결과 — 사용자: "백테스팅 결과를 더 상세분석할 수 있도록 하고 앱느낌나도록 사용자편의성과 디자인을
 * 업데이트해줘", "결과나오면 저장을 어떻게해".
 *
 * 예전엔 카드 넷(성과·들고 있기·수익 곡선·거래 내역)을 위아래로 늘어놓았고, 결과 위에는 공유 단추 하나뿐이었다.
 * 자산배분 결과처럼 **칩으로 나눈다** — 요약(얼마나 벌었나) · 낙폭(얼마나 아팠나) · 기간별(언제 벌고 잃었나) ·
 * 거래(어떻게 사고팔았나). 칩 줄 오른쪽 끝에 저장·공유·CSV.
 *
 * 낙폭·해마다는 자산배분과 **같은 부품**(AllocationResult 의 낙폭칸·해마다칸)을, 숫자는 서버가 같은 함수로 잰 것
 * (analysis)을 쓴다 — 같은 화면의 두 탭이 다른 규칙으로 그리면 나란히 놓고 볼 수 없다. 견줄 상대는 '그냥 사서
 * 들고 있기'(같은 종목·같은 기간·같은 수수료)다.
 */
import { Fragment, useMemo, useState } from "react";
import { Bookmark, Download, Share2 } from "lucide-react";
import { Card, ChangeBadge, ChipTabs, formatNumber, 고른칩, cn } from "@/components/ui";
import 차트틀 from "@/components/chart/ChartFrame";
import { 가로축, 그래프높이, 기준점선, 끝값, 달눈금, 툴팁 } from "@/utils/chartTheme";
import { useSettingsStore } from "@/store/settingsStore";
import { usePnlColors } from "@/hooks/usePnlColors";
import { use넓은화면 } from "@/hooks/useWideScreen";
import { 표머리, 표머리줄, 표머리칸, 표줄, 표칸, 표글자 } from "@/components/common/StockTable";
import type { 단일결과 } from "@/api/stocks";
import { 낙폭칸, 해마다칸, 눈금글, 그래프범례 } from "./AllocationResult";
import { 달마다표, 거래분석칸 } from "./분석부품";

/** 못 잰 값(null)은 '—' — 0 으로 그리면 '승률 0%' 가 '다 졌다' 로 읽힌다 */
export function 숫자(v: number | null | undefined, 자리 = 1, 앞 = "", 뒤 = ""): React.ReactNode {
  if (v == null || !Number.isFinite(v)) return <span className="text-text-dim">—</span>;
  return `${앞}${v.toFixed(자리)}${뒤}`;
}

/** 요청한 날보다 **의미 있게 늦게** 시작했나 — 주말·연휴로 하루이틀 밀린 것은 말하지 않는다(일주일 넘을 때만) */
export function 많이늦게시작(요청: string, 실제?: string | null): boolean {
  if (!실제) return false;
  const 밀린날 = (new Date(실제).getTime() - new Date(요청).getTime()) / 86_400_000;
  return Number.isFinite(밀린날) && 밀린날 > 7;
}

/** 결과의 큰 숫자 — 사람이 제일 먼저 묻는 셋(얼마 벌었나·얼마나 아팠나·몇 번 이겼나) */
function 큰지표({ 이름, 값, 색, 밑 }: { 이름: string; 값: React.ReactNode; 색?: string; 밑?: string }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-xs text-text-muted">{이름}</span>
      <span className={cn("text-xl font-bold font-mono tabular-nums truncate", 색 ?? "text-text-primary")}>{값}</span>
      {밑 && <span className="text-2xs text-text-dim break-keep">{밑}</span>}
    </div>
  );
}

/** 나머지 숫자 — 작게, 한 줄에 둘·셋 */
function 작은지표({ 이름, 값, 색, 밑 }: { 이름: string; 값: React.ReactNode; 색?: string; 밑?: string }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-2xs text-text-muted">{이름}</span>
      <span className={cn("text-sm font-semibold font-mono tabular-nums", 색 ?? "text-text-primary")}>{값}</span>
      {밑 && <span className="text-2xs text-text-dim break-keep">{밑}</span>}
    </div>
  );
}

/** '2020-03-02' → '20.03.02' — 거래 카드 한 줄에 날짜 둘이 들어가게 */
function 짧은날(d: string | null | undefined): string {
  return d && d.length >= 10 ? `${d.slice(2, 4)}.${d.slice(5, 7)}.${d.slice(8, 10)}` : (d ?? "");
}

/** 결과 머리의 작은 아이콘 단추 — 저장·공유·CSV */
export function 머리단추({ 이름, 누르기, children }: { 이름: string; 누르기: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={이름} title={이름} onClick={누르기}
      className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors flex-shrink-0">
      {children}
    </button>
  );
}

const 결과칩 = [
  { id: "요약", label: "요약" }, { id: "낙폭", label: "낙폭" },
  { id: "기간별", label: "기간별" }, { id: "거래", label: "거래" },
];

export default function 단일결과화면({ r, 돌린자본, 요청시작, 공유하기, 저장하기, 내보내기 }: {
  r: 단일결과;
  /** 이 결과를 낸 초기 자본 */
  돌린자본: number;
  /** 요청한 시작일 — 시세가 늦게 시작했으면 말한다 */
  요청시작: string;
  공유하기: () => void;
  /** 결과 저장 — 이름을 묻는 창을 연다(로그인 안 했으면 왜 안 되는지 말하는 것도 부르는 쪽이 한다) */
  저장하기: () => void;
  내보내기: () => void;
}) {
  const 배색 = useSettingsStore((s) => s.colorScheme);
  const { pnlColor, gain, loss } = usePnlColors(배색);
  const 넓음 = use넓은화면();
  /* 거래 내역 — 이 폭부터 표, 그보다 좁으면 한 줄 카드. 일곱 칸 표는 폰에서 옆으로 밀렸다 */
  const 표로 = use넓은화면(768);
  const [보기, set보기] = useState("요약");
  const [들고보기, set들고보기] = useState(true);
  const 거래들 = r.trades ?? [];
  const 분석 = r.analysis;
  const bh = r.buy_and_hold;

  /* 수익 곡선 — 내 전략과 '그냥 들고 있기' 를 같은 축에(서버가 내 곡선 날짜마다 값 하나를 준다) */
  const 곡선 = useMemo(() => (r.equity_curve ?? []).map((x, i) => {
    const 들고 = bh?.curve?.[i];
    return 들고 == null ? { date: x.date, value: x.value } : { date: x.date, value: x.value, 들고 };
  }), [r.equity_curve, bh]);
  const 들고있음 = 곡선.some((x) => "들고" in x);
  const 곡선끝 = 끝값(곡선.map((x) => x.value));

  /* 낙폭·해마다 부품은 자산배분의 것 — 견줄 상대를 '그냥 들고 있기' 로 넣는다 */
  const 분석표 = useMemo(() => 분석 ? {
    drawdown: 분석.drawdown, drawdowns: 분석.drawdowns, yearly: 분석.yearly,
    benchmark: 분석.buy_and_hold ? { name: "그냥 들고 있기", drawdown: 분석.buy_and_hold.drawdown,
                                     yearly: 분석.buy_and_hold.yearly } : null,
  } : null, [분석]);

  return (
    <div className="flex flex-col gap-4">
      {/* ── 머리 ── 결과 보기 칩 + 저장·공유·CSV. 예전엔 결과가 나오면 저장 단추가 설정 칸과 함께 접혀 사라졌다 */}
      <div className="flex items-center gap-1">
        <ChipTabs ariaLabel="결과 보기" idPrefix="단일결과" className="flex-1 min-w-0"
          tabs={결과칩} active={보기} onChange={set보기} />
        <머리단추 이름="결과 저장" 누르기={저장하기}><Bookmark size={16} /></머리단추>
        <머리단추 이름="결과 공유" 누르기={공유하기}><Share2 size={16} /></머리단추>
        <머리단추 이름="CSV로 내보내기" 누르기={내보내기}><Download size={16} /></머리단추>
      </div>

      <div role="tabpanel" id="단일결과-panel" aria-labelledby={`단일결과-tab-${보기}`} className="flex flex-col gap-4">
        {보기 === "요약" && (<>
          {/* ── 성과 ── 큰 숫자 셋 + 나머지 작게. 서버가 **못 잰 값은 null** 로 준다. 0 이 아니다.
              색은 설정의 오름·내림 색만 쓴다 */}
          <Card className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-base font-semibold text-text-primary">성과</span>
              <span className="text-2xs text-text-dim truncate num">
                {r.start_date && r.end_date ? `${r.start_date} ~ ${r.end_date}` : null}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <큰지표 이름="총 수익률"
                값={숫자(r.total_return, 1, (r.total_return ?? 0) > 0 ? "+" : "", "%")}
                색={r.total_return == null ? undefined : pnlColor(r.total_return)}
                밑={많이늦게시작(요청시작, r.start_date) ? `${r.start_date}부터 (시세가 그 전에는 없음)` : undefined} />
              <큰지표 이름="최대 낙폭" 값={숫자(r.mdd, 1, "-", "%")} 색={loss} />
              {/* 승률은 **수수료까지 뺀** 손익으로 센다 */}
              <큰지표 이름="승률" 값={숫자(r.win_rate, 1, "", "%")} 밑={r.cost_rate ? "수수료 반영" : undefined} />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 pt-3 border-t border-border">
              <작은지표 이름="연환산"
                값={r.annual_return == null ? <span className="text-text-dim">—</span> : <ChangeBadge value={r.annual_return} />}
                밑={r.annual_return == null && r.years != null ? `${r.years}년치라 연환산 안 함` : undefined} />
              {/* 샤프는 '무위험으로 그냥 둬도 얻었을 것' 을 뺀 수다. 무엇을 뺐는지 안 적으면 자기 기준으로 읽는다 */}
              <작은지표 이름="샤프 비율" 값={숫자(r.sharpe_ratio, 2)} 밑={`무위험 ${r.risk_free_rate ?? 0}% 기준`} />
              <작은지표 이름="총 거래수" 값={String(r.total_trades ?? 0)} />
              <작은지표 이름="평균 수익" 값={숫자(r.avg_profit, 1, "+", "%")}
                색={r.avg_profit == null ? "text-text-dim" : pnlColor(r.avg_profit)} />
              <작은지표 이름="수익비율 (PF)" 값={숫자(r.profit_factor, 2)}
                밑={r.profit_factor == null && (r.total_trades ?? 0) > 0 ? "손실 거래 없음" : "PF > 1.5 우수"} />
            </div>
          </Card>

          {/* ── 그냥 들고 있었으면 ── '연 12%' 만 보면 잘한 것인지 알 수 없다. 색은 **내 값**에 칠한다 */}
          {bh && (
            <Card className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between gap-2 flex-wrap">
                <span className="text-base font-semibold text-text-primary">그냥 사서 들고 있었으면</span>
                <span className="text-2xs text-text-dim">같은 기간 · 같은 수수료</span>
              </div>
              <div className="grid grid-cols-[1fr_1fr_1fr] gap-x-2 gap-y-1.5 items-baseline">
                <span className="text-2xs text-text-dim" />
                <span className="text-2xs text-text-muted font-medium text-right">내 전략</span>
                <span className="text-2xs text-text-dim text-right">들고 있기</span>
                {([
                  ["총 수익률", 숫자(r.total_return, 1, "", "%"), 숫자(bh.total_return, 1, "", "%"),
                   (r.total_return ?? 0) - (bh.total_return ?? 0)],
                  ["연환산", 숫자(r.annual_return, 1, "", "%"), 숫자(bh.annual_return, 1, "", "%"),
                   (r.annual_return ?? 0) - (bh.annual_return ?? 0)],
                  /* 낙폭만 작을수록 좋다 — 부호를 뒤집어야 '내가 나음' 이 맞는다 */
                  ["최대 낙폭", 숫자(r.mdd, 1, "-", "%"), 숫자(bh.mdd, 1, "-", "%"), (bh.mdd ?? 0) - (r.mdd ?? 0)],
                ] as [string, React.ReactNode, React.ReactNode, number][]).map(([이름, 내것, 저것, 차]) => (
                  <Fragment key={이름}>
                    <span className="text-xs text-text-muted">{이름}</span>
                    <span className={`text-xs font-mono tabular-nums text-right font-semibold ${pnlColor(차)}`}>{내것}</span>
                    <span className="text-xs font-mono tabular-nums text-right text-text-dim">{저것}</span>
                  </Fragment>
                ))}
              </div>
              <p className="text-2xs text-text-dim break-keep">
                내 숫자가 오름 색이면 그 항목은 사고파는 쪽이 나아요.
                내림 색이면 그냥 들고 있는 편이 나았다는 뜻이에요. 낙폭은 작은 쪽이 나은 거예요.
              </p>
            </Card>
          )}

          {/* ── 수익 곡선 ── 다른 메뉴 그래프와 같은 모양. '들고 있기' 를 점선으로 같이(칩으로 끈다) */}
          <Card className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-base font-semibold text-text-primary">수익 곡선</span>
              <div className="flex items-center gap-2">
                {들고있음 && (
                  <고른칩 작게 고름={들고보기} onClick={() => set들고보기((v) => !v)} ariaLabel="그냥 들고 있기 같이 보기">
                    들고 있기
                  </고른칩>
                )}
                <span className="text-2xs text-text-dim">초기자본 {formatNumber(돌린자본)}원</span>
              </div>
            </div>
            <차트틀 height={그래프높이.큰[넓음 ? 1 : 0]}>
              {(R) => (
                <R.ComposedChart data={곡선} margin={{ top: 10, right: 4, bottom: 0, left: 4 }}>
                  <defs>
                    <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--accent-blue)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--accent-blue)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <R.XAxis dataKey="date" tickFormatter={달눈금} {...가로축} />
                  <R.YAxis hide domain={["dataMin", "dataMax"]} />
                  <R.Tooltip {...툴팁} formatter={(v: number, 이름: string) =>
                    [formatNumber(v) + "원", 이름 === "들고" ? "들고 있기" : "내 전략"]} />
                  {곡선끝 && (
                    <>
                      <R.ReferenceLine y={곡선끝.최고} {...기준점선} />
                      <R.ReferenceLine y={곡선끝.최저} {...기준점선} />
                    </>
                  )}
                  {/* 시작 금액 — 이 선보다 위면 번 것이다. 범위 밖이어도 보이게 축을 늘린다 */}
                  <R.ReferenceLine y={돌린자본} stroke="var(--text-muted)" strokeDasharray="4 4" ifOverflow="extendDomain" />
                  <R.Area type="monotone" dataKey="value" name="value" stroke="var(--accent-blue)" fill="url(#grad)"
                          strokeWidth={2} dot={false} isAnimationActive={false} />
                  {들고있음 && 들고보기 && (
                    <R.Line type="monotone" dataKey="들고" name="들고" stroke="var(--accent-purple)" strokeWidth={1.5}
                            strokeDasharray="4 3" dot={false} connectNulls isAnimationActive={false} />
                  )}
                </R.ComposedChart>
              )}
            </차트틀>
            <그래프범례 끝={곡선끝 && `최고 ${눈금글(곡선끝.최고, "KRW")} · 최저 ${눈금글(곡선끝.최저, "KRW")}`}
              선들={[{ 이름: "내 전략", 색: "var(--accent-blue)" },
                    ...(들고있음 && 들고보기 ? [{ 이름: "들고 있기", 색: "var(--accent-purple)", 점선: true }] : []),
                    { 이름: "초기자본", 색: "var(--text-muted)", 점선: true }]} />
          </Card>
        </>)}

        {보기 === "낙폭" && (분석표 && (분석표.drawdown?.length ?? 0) > 1
          ? <낙폭칸 r={분석표} 내이름="내 전략" />
          : <Card><p className="text-xs text-text-muted">낙폭을 그릴 만큼 기간이 길지 않아요.</p></Card>)}

        {보기 === "기간별" && (<>
          {분석표 && 분석표.yearly.length > 0 && (
            <해마다칸 r={분석표} 내이름="내 전략"
              설명="그해 첫날의 평가액에서 마지막 날까지 잰 값이에요(첫해는 초기 자본에서)." />
          )}
          {분석 && 분석.monthly.length > 0
            ? <달마다표 monthly={분석.monthly} yearly={분석.yearly} />
            : <Card><p className="text-xs text-text-muted">달마다 나눌 만큼 기간이 길지 않아요.</p></Card>}
        </>)}

        {보기 === "거래" && (<>
          <거래분석칸 거래들={거래들} 시작={r.start_date} 끝={r.end_date} />
          {/* 거래 내역 — 넓으면 스크리닝 표와 같은 머리·줄·칸, 좁으면 한 줄 카드 */}
          <Card className="p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2 flex-wrap">
              <span className="text-base font-semibold text-text-primary">거래 내역</span>
              <div className="flex items-center gap-2">
                {/* 두 칸이 왜 다른지 안 적으면 '숫자가 안 맞는다' 로 읽힌다 */}
                {!!r.cost_rate && (
                  <span className="text-2xs text-text-dim break-keep">
                    수익률은 값이 움직인 폭 · {표로 ? "오른쪽은" : "아래 줄은"} 수수료 {r.cost_rate * 100}%를 뺀 것
                  </span>
                )}
                <span className="text-text-muted text-xs">{거래들.length}건</span>
              </div>
            </div>
            {표로 ? (
              <div className="overflow-x-auto max-h-80 overflow-y-auto">
                <table className={cn("w-full", 표글자)}>
                  <thead className={표머리}>
                    <tr className={표머리줄}>
                      <th className={cn(표머리칸, "text-left")}>유형</th>
                      <th className={표머리칸}>진입일</th>
                      <th className={표머리칸}>청산일</th>
                      <th className={표머리칸}>진입가</th>
                      <th className={표머리칸}>청산가</th>
                      <th className={표머리칸}>수익률</th>
                      {!!r.cost_rate && <th className={표머리칸}>수수료 뺀 것</th>}
                      <th className={표머리칸}>수량</th>
                    </tr>
                  </thead>
                  <tbody>
                    {거래들.map((t, i) => (
                      <tr key={i} className={표줄}>
                        <td className={cn(표칸, "text-left")}>
                          <span className={cn("px-1.5 py-0.5 rounded text-2xs font-semibold whitespace-nowrap bg-bg-elevated",
                            t.type === "손절" ? loss : t.type === "익절" ? gain : "text-text-secondary")}>{t.type}</span>
                        </td>
                        <td className={cn(표칸, "font-mono text-text-secondary")}>{t.entry_date}</td>
                        <td className={cn(표칸, "font-mono text-text-secondary")}>{t.exit_date}</td>
                        <td className={cn(표칸, "font-mono")}>{t.entry_price.toLocaleString()}</td>
                        <td className={cn(표칸, "font-mono")}>{t.exit_price.toLocaleString()}</td>
                        <td className={표칸}><ChangeBadge value={t.pnl_rate} /></td>
                        {!!r.cost_rate && <td className={표칸}><ChangeBadge value={t.net_pnl_rate ?? t.pnl_rate} /></td>}
                        <td className={cn(표칸, "font-mono text-text-secondary")}>{t.shares.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              /* 폰 — 거래 하나가 한 줄 */
              <ul className="max-h-96 overflow-y-auto divide-y divide-border/60">
                {거래들.map((t, i) => (
                  <li key={i} className="px-4 py-2.5 flex items-center gap-3">
                    <span className={cn("px-1.5 py-0.5 rounded text-2xs font-semibold whitespace-nowrap bg-bg-elevated flex-shrink-0",
                      t.type === "손절" ? loss : t.type === "익절" ? gain : "text-text-secondary")}>{t.type}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-text-secondary num truncate">{짧은날(t.entry_date)} → {짧은날(t.exit_date)}</p>
                      <p className="text-2xs text-text-dim num truncate">
                        {t.entry_price.toLocaleString()} → {t.exit_price.toLocaleString()} · {t.shares.toLocaleString()}주
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                      <ChangeBadge value={t.pnl_rate} />
                      {!!r.cost_rate && (
                        <span className="flex items-center gap-1 text-2xs text-text-dim">
                          <span>수수료 뺀 것</span>
                          <ChangeBadge value={t.net_pnl_rate ?? t.pnl_rate} />
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>)}
      </div>
    </div>
  );
}
