/**
 * 유니버스 백테스트 결과 — 사용자: "백테스팅 결과를 더 상세분석할 수 있도록 하고 앱느낌나도록".
 *
 * 예전엔 9칸 표 하나였다 — 종목은 코드뿐(AIG 가 무슨 회사인지 모른다), 폰에서는 오른쪽 칸이 잘렸고, 상위 N개만
 * 보여서 '이 전략이 대체로 통하나' 를 알 수 없었다(상위만 보면 어떤 전략이든 좋아 보인다).
 *
 *   · 요약 — 돌린 **모든** 종목 중 수익 낸 몫·가운데값·평균·최고·최저와 분포(서버가 all_returns 를 준다)
 *   · 순위 — 이름과 함께. 폰에서는 한 줄 카드, 넓으면 표. 칩으로 다시 세운다
 *   · 종목을 누르면 같은 조건으로 그 종목 하나를 자세히 돌린다(단일 종목 탭)
 */
import { useMemo, useState } from "react";
import { Award, Bookmark, ChevronRight, Share2 } from "lucide-react";
import { Card, ChangeBadge, ChipTabs, cn } from "@/components/ui";
import { useSettingsStore } from "@/store/settingsStore";
import { usePnlColors } from "@/hooks/usePnlColors";
import { use넓은화면 } from "@/hooks/useWideScreen";
import { 표머리, 표머리줄, 표머리칸, 표줄, 표칸, 표글자 } from "@/components/common/StockTable";
import type { 유니버스결과, 유니버스줄 } from "@/api/stocks";
import { 유니버스요약하기, 종목경계 } from "./분석";
import { 분포막대 } from "./분석부품";
import { 숫자, 머리단추 } from "./단일결과화면";

/** 다시 세울 기준 — 낙폭만 작은 것이 앞이다. 못 잰 값(null)은 어느 쪽이든 맨 뒤 */
export const 세울기준 = [
  { id: "total_return", label: "총수익률" }, { id: "annual_return", label: "연환산" },
  { id: "sharpe_ratio", label: "샤프" }, { id: "win_rate", label: "승률" },
  { id: "profit_factor", label: "PF" }, { id: "mdd", label: "낙폭 작은 순" },
] as const;
export type 세울것 = (typeof 세울기준)[number]["id"];

export function 세우기(줄들: 유니버스줄[], 기준: 세울것): 유니버스줄[] {
  const 작은게앞 = 기준 === "mdd";
  return [...줄들].sort((a, b) => {
    const x = a[기준], y = b[기준];
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return 작은게앞 ? x - y : y - x;
  });
}

const 부호 = (v: number, 자리 = 1) => `${v > 0 ? "+" : ""}${v.toFixed(자리)}`;

export default function 유니버스결과화면({ r, 처음기준, 공유하기, 저장하기, 자세히 }: {
  r: 유니버스결과;
  /** 서버가 세운 기준(돌릴 때 고른 '순위 기준') */
  처음기준: string;
  공유하기: () => void;
  저장하기: () => void;
  /** 종목을 누르면 — 같은 조건으로 그 종목 하나를 돌린다 */
  자세히: (줄: 유니버스줄) => void;
}) {
  const 배색 = useSettingsStore((s) => s.colorScheme);
  const { pnlColor, loss } = usePnlColors(배색);
  const 표로 = use넓은화면(768);
  const [기준, set기준] = useState<세울것>(
    (세울기준.some((x) => x.id === 처음기준) ? 처음기준 : "total_return") as 세울것);
  const 줄들 = useMemo(() => 세우기(r.results ?? [], 기준), [r.results, 기준]);
  const 요약 = useMemo(() => (r.all_returns?.length ? 유니버스요약하기(r.all_returns) : null), [r.all_returns]);

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Award size={14} className="text-accent-yellow" />
            <span className="text-base font-semibold text-text-primary">유니버스 백테스트 결과</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-text-muted text-xs mr-1">{r.tested}/{r.total_symbols}종목 분석 완료</span>
            <머리단추 이름="결과 저장" 누르기={저장하기}><Bookmark size={16} /></머리단추>
            <머리단추 이름="결과 공유" 누르기={공유하기}><Share2 size={16} /></머리단추>
          </div>
        </div>
        {/* 생존 편향을 **결과 바로 위에** 적는다 — 목록이 '오늘 살아남은 것들' 이라 실제보다 좋게 나온다 */}
        {r.생존편향 && (
          <p className="px-4 py-2.5 text-2xs text-accent-yellow bg-accent-yellow/10 border-b border-border break-keep">
            ⚠ {r.생존편향}
          </p>
        )}

        {/* ── 요약 ── 상위 N개가 아니라 돌린 모든 종목 */}
        {요약 && (
          <div className="px-4 py-4 flex flex-col gap-4 border-b border-border">
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-xs text-text-muted">수익 낸 종목</span>
                <span className="text-xl font-bold font-mono tabular-nums">{요약.플러스}/{요약.수}</span>
                <span className="text-2xs text-text-dim">{Math.round(요약.플러스비율 ?? 0)}%</span>
              </div>
              {/* 가운데값 — 평균은 몇 종목이 크게 오르면 끌려 올라간다. '보통 종목' 은 가운데값이 더 정직하다 */}
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-xs text-text-muted">가운데값</span>
                <span className={cn("text-xl font-bold font-mono tabular-nums", pnlColor(요약.가운데값 ?? 0))}>
                  {요약.가운데값 == null ? "—" : `${부호(요약.가운데값)}%`}
                </span>
                <span className="text-2xs text-text-dim">보통 종목의 성적</span>
              </div>
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-xs text-text-muted">평균</span>
                <span className={cn("text-xl font-bold font-mono tabular-nums", pnlColor(요약.평균 ?? 0))}>
                  {요약.평균 == null ? "—" : `${부호(요약.평균)}%`}
                </span>
                <span className="text-2xs text-text-dim num">
                  {요약.최고 != null && 요약.최저 != null ? `${부호(요약.최저, 0)} ~ ${부호(요약.최고, 0)}%` : ""}
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-2xs text-text-muted">종목별 총수익률 분포(%)</span>
              <분포막대 칸들={요약.분포} 경계들={종목경계} 이름="종목별 총수익률 분포" />
            </div>
            <p className="text-2xs text-text-dim break-keep">
              돌린 종목 {요약.수}개 모두로 잰 값이에요(거래가 한 번도 없던 종목은 빼요). 아래 순위는 그중 상위 {r.results.length}개예요.
            </p>
          </div>
        )}

        {/* ── 순위 ── 칩으로 다시 세운다 */}
        <div className="px-4 pt-3 pb-2 flex flex-col gap-2">
          <span className="text-sm font-semibold text-text-primary">순위</span>
          <ChipTabs ariaLabel="순위 기준" idPrefix="유니버스순위" tabs={세울기준.map((x) => ({ id: x.id, label: x.label }))}
            active={기준} onChange={(id) => set기준(id as 세울것)} />
        </div>
        <div role="tabpanel" id="유니버스순위-panel" aria-labelledby={`유니버스순위-tab-${기준}`}>
          {표로 ? (
            <div className="overflow-x-auto">
              <table className={cn("w-full", 표글자)}>
                <thead className={표머리}>
                  <tr className={표머리줄}>
                    <th className={cn(표머리칸, "text-left")}>순위</th>
                    <th className={cn(표머리칸, "text-left")}>종목</th>
                    <th className={표머리칸}>총수익률</th>
                    <th className={표머리칸}>연환산</th>
                    <th className={표머리칸}>MDD</th>
                    <th className={표머리칸}>샤프</th>
                    <th className={표머리칸}>승률</th>
                    <th className={표머리칸}>거래수</th>
                    <th className={표머리칸}>PF</th>
                  </tr>
                </thead>
                <tbody>
                  {줄들.map((x, i) => (
                    <tr key={x.symbol} className={cn(표줄, "cursor-pointer")} onClick={() => 자세히(x)}>
                      <td className={cn(표칸, "text-left")}>
                        <span className={`font-bold ${i === 0 ? "text-accent-yellow" : i < 3 ? "text-accent-blue" : "text-text-muted"}`}>#{i + 1}</span>
                      </td>
                      <td className={cn(표칸, "text-left")}>
                        <button type="button" onClick={(e) => { e.stopPropagation(); 자세히(x); }}
                          aria-label={`${x.name ?? x.symbol} 자세히 백테스트`}
                          className="flex flex-col items-start text-left hover:underline">
                          <span className="font-semibold text-text-primary">{x.name ?? x.symbol}</span>
                          {x.name && x.name !== x.symbol && <span className="text-2xs text-text-dim font-mono">{x.symbol}</span>}
                        </button>
                      </td>
                      <td className={표칸}><ChangeBadge value={x.total_return ?? 0} /></td>
                      <td className={표칸}>{x.annual_return == null ? <span className="text-text-dim">—</span> : <ChangeBadge value={x.annual_return} />}</td>
                      <td className={cn(표칸, "font-mono", loss)}>{숫자(x.mdd, 1, "-", "%")}</td>
                      <td className={cn(표칸, "font-mono text-text-secondary")}>{숫자(x.sharpe_ratio, 2)}</td>
                      <td className={cn(표칸, "font-mono text-text-secondary")}>{숫자(x.win_rate, 1, "", "%")}</td>
                      <td className={cn(표칸, "font-mono text-text-muted")}>{x.total_trades}</td>
                      <td className={cn(표칸, "font-mono text-text-secondary")}>{숫자(x.profit_factor, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            /* 폰 — 종목 하나가 한 줄 카드. 9칸 표는 옆으로 밀어야 PF 가 보였다 */
            <ul className="divide-y divide-border/60 border-t border-border">
              {줄들.map((x, i) => (
                <li key={x.symbol}>
                  <button type="button" onClick={() => 자세히(x)} aria-label={`${x.name ?? x.symbol} 자세히 백테스트`}
                    className="w-full px-4 py-2.5 flex items-center gap-3 text-left hover:bg-bg-elevated transition-colors">
                    <span className={`w-7 flex-shrink-0 text-xs font-bold tabular-nums ${i === 0 ? "text-accent-yellow" : i < 3 ? "text-accent-blue" : "text-text-muted"}`}>
                      #{i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-text-primary truncate">
                        {x.name ?? x.symbol}
                        {x.name && x.name !== x.symbol && <span className="ml-1.5 text-2xs font-normal text-text-dim font-mono">{x.symbol}</span>}
                      </p>
                      <p className="text-2xs text-text-dim num truncate">
                        연 {x.annual_return == null ? "—" : `${부호(x.annual_return)}%`} · 낙폭 {x.mdd == null ? "—" : `-${x.mdd.toFixed(1)}%`}
                        {" · "}샤프 {x.sharpe_ratio == null ? "—" : x.sharpe_ratio.toFixed(2)} · 승률 {x.win_rate == null ? "—" : `${x.win_rate.toFixed(0)}%`} · {x.total_trades}회
                      </p>
                    </div>
                    <ChangeBadge value={x.total_return ?? 0} />
                    <ChevronRight size={14} className="text-text-dim flex-shrink-0" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="px-4 py-2.5 border-t border-border text-2xs text-text-dim break-keep">
          종목을 누르면 같은 조건으로 그 종목 하나를 자세히 돌려요 — 낙폭·달마다·거래까지 볼 수 있어요.
        </p>
      </Card>
    </div>
  );
}
