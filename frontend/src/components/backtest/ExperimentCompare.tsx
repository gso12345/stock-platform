/**
 * 저장한 자산배분 실험끼리 **나란히** 견준다.
 *
 * 실험을 하나씩 열어 결과를 보고 머릿속으로 견주면, 앞에 본 수는 금방
 * 흐려진다. '60/40 이 나았나 올웨더가 나았나' 를 묻는 사람에게 필요한
 * 것은 한 표에 같이 놓인 숫자다.
 *
 * ── 결과를 저장해 두지 않는 이유 ─────────────────────────
 *
 * 실험은 **설정만** 저장한다(models/stock.py 의 PortfolioExperiment 참고).
 * 그래서 견줄 때마다 다시 돌린다. 느리지만 틀리지 않는다 — 저장해 둔
 * 결과는 시세가 정정되면 지금 돌린 것과 달라진다.
 *
 * 벤치마크는 끄고 돌린다. 견주는 상대가 이미 옆 칸에 있고, 벤치마크까지
 * 돌리면 실험 수만큼 계산이 두 배가 된다.
 *
 * 하나가 실패해도 나머지는 보여 준다 — 셋 중 하나의 종목 시세가 안
 * 받아진다고 두 개의 답까지 버릴 이유가 없다. 실패한 칸에는 이유를 적는다.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { backtestApi, type 자산배분결과, type 저장된실험 } from "@/api/stocks";
import { Card, Button } from "@/components/ui";
import { 요청실패말 } from "@/utils/errors";
import { 보낼것, 실험을설정으로 } from "./AllocationTab";
import { 첫설정 } from "./AllocationForm";

export const 최대비교 = 4;

type 한칸 = { 실험: 저장된실험; 결과?: 자산배분결과; 오류?: string };

/** 비교 요청 — 저장한 설정 그대로, 벤치마크만 끈다 */
export function 비교요청(x: 저장된실험) {
  return { ...보낼것(실험을설정으로(x, 첫설정())), benchmark: "none" };
}

function 수(v: number | null | undefined, 자리 = 2, 앞 = "", 뒤 = "") {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${앞}${v.toLocaleString("ko-KR", { maximumFractionDigits: 자리 })}${뒤}`;
}

function 돈(v: number | null | undefined, 통화: "KRW" | "USD") {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${통화 === "KRW" ? "₩" : "$"}${Math.round(v).toLocaleString("ko-KR")}`;
}

/** 줄마다 무엇이 '나은' 쪽인가. 낙폭·변동성은 작을수록 낫다.
 *  최종 평가액은 넣은 돈과 통화가 실험마다 다를 수 있어 **고르지 않는다** —
 *  1억 넣은 실험이 1천만원 넣은 실험보다 크게 나오는 것은 당연하다. */
type 줄 = {
  이름: string;
  값: (r: 자산배분결과) => number | null | undefined;
  보기: (r: 자산배분결과) => string;
  나은쪽?: "큰" | "작은";
};

const 줄들: 줄[] = [
  { 이름: "기간", 값: () => null, 보기: (r) => `${r.start_date} ~ ${r.end_date}` },
  { 이름: "최종 평가액", 값: (r) => r.final_value, 보기: (r) => 돈(r.final_value, r.currency) },
  { 이름: "총 수익률", 값: (r) => r.total_return, 보기: (r) => 수(r.total_return, 1, "", "%"), 나은쪽: "큰" },
  { 이름: "연 수익률", 값: (r) => r.twr_annual, 보기: (r) => 수(r.twr_annual, 2, "", "%"), 나은쪽: "큰" },
  { 이름: "최대 낙폭", 값: (r) => r.mdd, 보기: (r) => 수(r.mdd, 1, "-", "%"), 나은쪽: "작은" },
  { 이름: "변동성", 값: (r) => r.volatility, 보기: (r) => 수(r.volatility, 1, "", "%"), 나은쪽: "작은" },
  { 이름: "샤프", 값: (r) => r.sharpe, 보기: (r) => 수(r.sharpe, 2), 나은쪽: "큰" },
  { 이름: "소티노", 값: (r) => r.sortino, 보기: (r) => 수(r.sortino, 2), 나은쪽: "큰" },
  { 이름: "최악의 달", 값: (r) => r.worst_month, 보기: (r) => 수(r.worst_month, 1, "", "%"), 나은쪽: "큰" },
];

/** 이 줄에서 제일 나은 칸 번호들. 값이 다 같으면(혼자뿐인 경우 포함)
 *  아무도 안 고른다 — 혼자 있는 칸에 '최고' 표시를 달면 견준 것처럼 보인다. */
export function 제일나은(값들: (number | null | undefined)[], 나은쪽?: "큰" | "작은"): Set<number> {
  if (!나은쪽) return new Set();
  const 있는것 = 값들
    .map((v, i) => [v, i] as const)
    .filter((x): x is readonly [number, number] => x[0] != null && Number.isFinite(x[0]));
  const 끝 = 나은쪽 === "큰" ? Math.max(...있는것.map((x) => x[0])) : Math.min(...있는것.map((x) => x[0]));
  if (있는것.every((x) => x[0] === 끝)) return new Set();
  return new Set(있는것.filter((x) => x[0] === 끝).map((x) => x[1]));
}

export default function 실험비교({ 실험들 }: { 실험들: 저장된실험[] }) {
  const [고른것, set고른것] = useState<number[]>([]);
  const [칸들, set칸들] = useState<한칸[]>([]);
  const [몇째, set몇째] = useState(0);

  const 돌리기 = useMutation({
    mutationFn: async (고른실험: 저장된실험[]) => {
      /* **차례로** 돌린다. 한꺼번에 보내면 0.15 CPU 서버가 넷을 동시에
         붙잡고 넷 다 늦어진다 — 하나씩이면 첫 결과부터 빨리 끝난다 */
      const 나온것: 한칸[] = [];
      for (let i = 0; i < 고른실험.length; i++) {
        set몇째(i + 1);
        try {
          나온것.push({ 실험: 고른실험[i], 결과: await backtestApi.runPortfolio(비교요청(고른실험[i]) as any) });
        } catch (e) {
          나온것.push({ 실험: 고른실험[i], 오류: 요청실패말(e, "계산에 실패했어요") });
        }
      }
      return 나온것;
    },
    onSuccess: set칸들,
  });

  if (실험들.length < 2) return null;

  /* 넷이 차면 나머지 단추는 disabled 로 막힌다 — 여기서 또 셀 필요가 없다 */
  const 고르기 = (id: number) => set고른것((앞) =>
    앞.includes(id) ? 앞.filter((x) => x !== id) : [...앞, id]);

  const 된것 = 칸들.filter((c) => c.결과);
  const 해들 = [...new Set(된것.flatMap((c) => c.결과!.yearly.map((y) => y.year)))].sort();

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <p className="text-sm font-semibold text-text-primary">저장한 실험 견주기</p>
        <span className="text-2xs text-text-dim">2~{최대비교}개를 고르세요</span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {실험들.map((x) => {
          const 켬 = 고른것.includes(x.id);
          const 막힘 = !켬 && 고른것.length >= 최대비교;
          return (
            <button
              key={x.id}
              type="button"
              aria-pressed={켬}
              disabled={막힘}
              onClick={() => 고르기(x.id)}
              className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                켬 ? "bg-accent-blue text-white border-accent-blue"
                  : "bg-bg-primary text-text-secondary border-border hover:border-accent-blue/50 disabled:opacity-40"}`}
            >
              {x.name}
            </button>
          );
        })}
      </div>

      <Button
        size="sm"
        disabled={고른것.length < 2 || 돌리기.isPending}
        onClick={() => 돌리기.mutate(고른것.map((id) => 실험들.find((x) => x.id === id)!).filter(Boolean))}
      >
        {돌리기.isPending ? `계산 중… ${몇째}/${고른것.length}` : "견주기"}
      </Button>
      {돌리기.isPending && (
        <p className="text-2xs text-text-dim break-keep">
          실험마다 다시 계산해요. 저장해 둔 것은 설정뿐이라 — 결과를 저장해 두면
          시세가 정정됐을 때 지금 돌린 값과 달라져요.
        </p>
      )}

      {!돌리기.isPending && 칸들.length > 0 && (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-text-muted">
                <th className="text-left font-medium px-1 py-1.5"></th>
                {칸들.map((c) => (
                  <th key={c.실험.id} className="text-right font-semibold text-text-primary px-1 py-1.5">{c.실험.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {줄들.map((줄) => {
                const 나은 = 제일나은(칸들.map((c) => (c.결과 ? 줄.값(c.결과) : null)), 줄.나은쪽);
                return (
                  <tr key={줄.이름} className="border-t border-border/40">
                    <td className="text-text-muted px-1 py-1.5 whitespace-nowrap">{줄.이름}</td>
                    {칸들.map((c, i) => (
                      <td key={c.실험.id}
                          data-best={나은.has(i) || undefined}
                          className={`text-right font-mono tabular-nums px-1 py-1.5 ${
                            나은.has(i) ? "text-accent-blue font-bold" : "text-text-secondary"}`}>
                        {c.결과 ? 줄.보기(c.결과) : 줄.이름 === "기간" ? <span className="text-accent-red">{c.오류}</span> : "—"}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {해들.map((해) => {
                const 값들 = 칸들.map((c) => c.결과?.yearly.find((y) => y.year === 해)?.return);
                const 나은 = 제일나은(값들, "큰");
                return (
                  <tr key={해} className="border-t border-border/40">
                    <td className="text-text-muted px-1 py-1.5">{해}년</td>
                    {값들.map((v, i) => (
                      <td key={칸들[i].실험.id}
                          data-best={나은.has(i) || undefined}
                          className={`text-right font-mono tabular-nums px-1 py-1.5 ${
                            나은.has(i) ? "text-accent-blue font-bold" : "text-text-secondary"}`}>
                        {수(v, 1, "", "%")}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-2xs text-text-dim mt-2 break-keep">
            파란 굵은 글씨가 그 줄에서 제일 나은 쪽이에요. 최종 평가액은 넣은 돈이
            실험마다 달라 고르지 않아요. 기간이 서로 다르면 수익률도 다른 시기를 잰 것이에요.
          </p>
        </div>
      )}
    </Card>
  );
}
