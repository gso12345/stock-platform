/**
 * 매매 — 사고판 기록, 그해 실현 손익, 해외주식 양도소득세 어림.
 *
 * 양도세는 한 사람의 한 해(1~12월) 해외주식 손익을 모두 더해(손익통산) 기본공제 250만원을 빼고 22% 다.
 * 그래서 '앞으로 얼마까지 이익을 내도 세금이 없나'(남은 공제)가 연말에 팔지 말지를 가르는 숫자다 —
 * 그것을 크게 보여 준다.
 *
 * 정직하게 — 이건 이동평균으로 센 어림값이다. 실제 신고는 증권사가 주는 양도소득 자료(원칙상 먼저 산 것부터
 * 판 것으로 — 선입선출)로 한다. 화면에 그렇게 적는다.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, Trash2 } from "lucide-react";
import { Card, Badge, RowSkeleton, 못불러옴, 빈화면, cn } from "@/components/ui";
import { portfolioApi, type 매매기록 } from "@/api/stocks";
import { use확인 } from "@/hooks/useDialogs";
import { use돈 } from "@/hooks/useMoney";
import { 남은공제 } from "@/utils/매매";
import { usePnlColors } from "@/hooks/usePnlColors";
import { useSettingsStore } from "@/store/settingsStore";
import { fmtShares } from "./HoldingRow";

/** 손익 색 — 설정(빨강·파랑 / 초록·빨강)을 따른다 */
function use손익색() {
  const 색표 = useSettingsStore((s) => s.colorScheme);
  return usePnlColors(색표).pnlColor;
}

function 줄({ t, 지우기 }: { t: 매매기록; 지우기: (t: 매매기록) => void }) {
  const 돈 = use돈();
  const 손익색 = use손익색();
  const 값 = t.currency === "USD" ? `$${t.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
    : `${Math.round(t.price).toLocaleString("ko-KR")}원`;
  return (
    <li className="flex items-center gap-3 px-4 py-2.5 border-b border-border/50 last:border-b-0">
      <span className="text-2xs text-text-dim num w-[4.5rem] shrink-0">{t.tradeDate.slice(2).replace(/-/g, ".")}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-text-primary truncate">{t.name}</span>
          <Badge variant={t.side === "sell" ? "blue" : "red"}>{t.side === "sell" ? "팔기" : "사기"}</Badge>
          {t.overseas && <span className="text-2xs text-text-dim">해외</span>}
        </div>
        <p className="text-2xs text-text-muted num">{fmtShares(t.shares)}주 × {값}{t.fx ? ` · 환율 ${t.fx.toLocaleString("ko-KR")}` : ""}</p>
      </div>
      {t.realized != null && (
        <span className={cn("text-xs font-semibold num shrink-0", 손익색(t.realized))}>{돈.원부호(t.realized)}</span>
      )}
      <button type="button" onClick={() => 지우기(t)} aria-label={`${t.tradeDate} ${t.name} 기록 지우기`}
        className="p-1.5 rounded-lg text-text-dim hover:text-accent-red hover:bg-accent-red/10 shrink-0">
        <Trash2 size={13} />
      </button>
    </li>
  );
}

export default function TradeHistory({ portfolioId, 로그인 }: {
  /** 지금 보고 있는 포트폴리오(목록만 거른다 — 세금은 사람 전체로 센다) */
  portfolioId?: number;
  로그인: boolean;
}) {
  const qc = useQueryClient();
  const 돈 = use돈();
  const 손익색 = use손익색();
  const { 묻기, 화면 } = use확인();
  const [해, set해] = useState<number | undefined>(undefined);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["portfolio-trades", 해 ?? "올해", portfolioId ?? "전체"],
    queryFn: () => portfolioApi.getTrades(해, portfolioId),
    enabled: 로그인,
    staleTime: 60_000,
  });
  const 지우기 = useMutation({
    mutationFn: (id: number) => portfolioApi.deleteTrade(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portfolio-trades"] }),
  });

  if (!로그인) {
    return (
      <Card>
        <빈화면 compact icon={ArrowLeftRight} title="사고판 기록과 해외주식 양도세 어림"
          hint="로그인하고 보유 종목을 팔거나 더 사면, 그해 실현 손익과 해외주식 양도세가 얼마쯤인지 여기서 볼 수 있어요." />
      </Card>
    );
  }
  if (isLoading) return <Card><RowSkeleton rows={4} /></Card>;
  if (isError || !data) return <Card><못불러옴 사유={error} 다시={() => refetch()} compact /></Card>;

  const s = data.summary;
  const 남음 = 남은공제(s.overseas, s.deduction);
  return (
    <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:gap-4 lg:items-start">
      <Card className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-text-primary">{data.year}년 실현 손익</h2>
          {data.years.length > 1 && (
            <select aria-label="해 고르기" value={data.year} onChange={(e) => set해(Number(e.target.value))}
              className="text-xs bg-bg-elevated border border-border rounded-lg px-2 py-1 text-text-secondary">
              {data.years.map((y) => <option key={y} value={y}>{y}년</option>)}
            </select>
          )}
        </div>
        <p className={cn("text-2xl font-bold num", 손익색(s.realized))}>{돈.원부호(s.realized)}</p>
        <dl className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg bg-bg-elevated px-3 py-2">
            <dt className="text-2xs text-text-muted">국내</dt>
            <dd className={cn("font-semibold num", 손익색(s.domestic))}>{돈.원부호(s.domestic)}</dd>
          </div>
          <div className="rounded-lg bg-bg-elevated px-3 py-2">
            <dt className="text-2xs text-text-muted">해외(양도세 대상)</dt>
            <dd className={cn("font-semibold num", 손익색(s.overseas))}>{돈.원부호(s.overseas)}</dd>
          </div>
        </dl>

        <section aria-labelledby="양도세" className="rounded-xl border border-accent-orange/30 bg-accent-orange/5 p-3 flex flex-col gap-1.5">
          <h3 id="양도세" className="text-xs font-bold text-text-primary">해외주식 양도세 어림</h3>
          {s.tax > 0 ? (
            <p className="text-sm text-text-secondary">
              약 <b className="text-text-primary text-base num">{돈.원(s.tax)}</b>
            </p>
          ) : (
            <p className="text-sm text-text-secondary">낼 세금이 없어요</p>
          )}
          <p className="text-2xs text-text-muted num break-keep">
            해외 손익 {돈.원부호(s.overseas)} − 기본공제 {돈.원(s.deduction)} = 과세표준 {돈.원(s.taxable)} × {Math.round(s.rate * 100)}%
          </p>
          {남음 > 0 && (
            <p className="text-2xs text-accent-green font-semibold break-keep">
              올해 해외주식으로 {돈.원(남음)}까지 더 이익을 내도 세금이 없어요
            </p>
          )}
          <p className="text-2xs text-text-dim break-keep">
            이동평균 평단으로 센 어림값이에요. 실제 신고는 증권사가 주는 양도소득 자료(먼저 산 것부터 판 것으로 셈)로 하고,
            연말 마지막 이틀에 판 것은 결제일 기준으로 다음 해로 잡힐 수 있어요. 국내 주식과 국내에 상장한 해외 ETF 는 양도세 대상이 아니라 뺐어요.
          </p>
        </section>
      </Card>

      <Card className="p-0 overflow-hidden">
        <h2 className="px-4 pt-3 pb-2 text-sm font-bold text-text-primary">사고판 기록 <span className="text-text-muted font-semibold">{data.items.length}</span></h2>
        {data.items.length ? (
          <ul className="border-t border-border">
            {data.items.map((t) => (
              <줄 key={t.id} t={t} 지우기={(x) => 묻기({
                title: "이 기록을 지울까요?",
                message: "기록만 지워요. 보유 수량은 그대로라, 수량이 틀렸다면 종목 '수정' 으로 고쳐 주세요.",
                대상: `${x.tradeDate} · ${x.name} ${x.side === "sell" ? "팔기" : "사기"} ${fmtShares(x.shares)}주`,
                확인글: "지우기",
                onConfirm: () => 지우기.mutateAsync(x.id),
              })} />
            ))}
          </ul>
        ) : (
          <빈화면 compact icon={ArrowLeftRight} title={`${data.year}년에 사고판 기록이 없어요`}
            hint="보유 종목의 ⇄ 단추로 팔거나 더 사면 여기 남아요. 판 것은 실현 손익과 양도세 어림에 들어가요." />
        )}
      </Card>
      {화면}
    </div>
  );
}
