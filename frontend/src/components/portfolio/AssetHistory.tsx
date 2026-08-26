/**
 * 자산 흐름 — 내 자산이 지난 한 달·석 달 동안 어떻게 움직였나.
 *
 * 화면은 지금까지 '오늘 얼마인가' 만 말했다. 자산 앱에서 정작 보고
 * 싶은 것은 '지난달보다 늘었나' 인데, 그걸 받쳐 줄 기록이 아무 데도
 * 없었다 — 매일 화면을 열어 숫자를 적어 두지 않는 한 알 수 없었다.
 *
 * 서버가 하루 한 줄씩 남긴다(portfolio_snapshots). 그래서
 *
 *   · 처음 쓰는 사람에게는 점이 하나뿐이다. 그때는 그래프 대신
 *     "내일부터 쌓입니다" 라고 말한다. 점 하나짜리 선은 고장으로 보인다.
 *   · 앱을 안 연 날은 비어 있다. 서버가 지어내지 않고 비워서 보내므로,
 *     여기서도 없는 날을 만들어 채우지 않는다 — 그냥 앞뒤 점을 잇는다.
 *
 * recharts 는 gzip 110KB 라 여기서 직접 import 하지 않는다. 차트틀이
 * 필요할 때만 받아 온다(그 파일 주석에 왜 그런지 적혀 있다).
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { portfolioApi, type 자산흐름점 } from "@/api/stocks";
import 차트틀 from "@/components/chart/ChartFrame";
import { Card, ChangeBadge, 못불러옴 } from "@/components/ui";
import { fmtKRWFull } from "@/utils/formatters";

const 기간들 = [
  { id: 30,  label: "1개월" },
  { id: 90,  label: "3개월" },
  { id: 365, label: "1년" },
] as const;

/** "2026-08-26" → "8/26" — 축에는 연도를 안 쓴다. 좁은 화면에서 자리를 다 먹는다 */
function 짧은날(day: string): string {
  const [, m, d] = day.split("-");
  return m && d ? `${Number(m)}/${Number(d)}` : day;
}

export default function AssetHistory({ 켜짐 = true }: { 켜짐?: boolean }) {
  const [일수, set일수] = useState<number>(90);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["portfolio-history", 일수],
    queryFn: () => portfolioApi.getHistory(일수),
    enabled: 켜짐,
    staleTime: 300_000,
  });

  const 점들 = useMemo<자산흐름점[]>(() => data?.points ?? [], [data]);

  /* 기간 수익 — 첫 점 대비 마지막 점.
     '평가손익'(매입가 대비)과는 다른 숫자다. 3년 전에 산 사람에게
     이번 달의 움직임과 전체 수익률은 전혀 다른 이야기다. */
  const 변화 = useMemo(() => {
    if (점들.length < 2) return null;
    const 처음 = 점들[0].value;
    const 끝 = 점들[점들.length - 1].value;
    if (!처음) return null;
    return { 금액: 끝 - 처음, 비율: ((끝 - 처음) / 처음) * 100 };
  }, [점들]);

  const 틀 = (속: React.ReactNode) => (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-text-primary">자산 흐름</span>
        <div className="flex rounded-lg border border-border overflow-hidden shrink-0">
          {기간들.map((g) => (
            <button
              key={g.id}
              onClick={() => set일수(g.id)}
              aria-pressed={일수 === g.id}
              className={`px-2.5 py-1 text-2xs font-medium transition-colors ${
                일수 === g.id ? "bg-accent-blue/15 text-accent-blue" : "text-text-muted hover:bg-bg-elevated"
              }`}
            >{g.label}</button>
          ))}
        </div>
      </div>
      {속}
    </Card>
  );

  if (isError) return 틀(<못불러옴 사유={error} 다시={() => refetch()} compact />);
  if (isLoading) return 틀(<div className="h-[160px] rounded-lg bg-bg-elevated animate-pulse" />);

  if (점들.length < 2) {
    /* 점 하나짜리 선은 그리면 고장으로 보인다. 무엇을 기다리는지 말한다 */
    return 틀(
      <div className="h-[160px] flex flex-col items-center justify-center gap-1 text-center">
        <p className="text-sm text-text-secondary">아직 그릴 기록이 없어요</p>
        <p className="text-2xs text-text-dim break-keep">
          하루에 한 번씩 자동으로 쌓입니다. 내일 다시 오면 선이 보여요.
        </p>
      </div>,
    );
  }

  return 틀(
    <>
      {변화 && (
        <div className="flex items-baseline justify-between gap-3 -mt-1">
          <span className="text-2xs text-text-muted shrink-0">
            {기간들.find((g) => g.id === 일수)?.label} 변화
          </span>
          <ChangeBadge value={변화.비율} 금액={변화.금액} 통화="KRW" className="text-sm" />
        </div>
      )}
      <차트틀 height={160}>
        {(R) => (
          <R.AreaChart data={점들} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
            <defs>
              <linearGradient id="자산흐름칠" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="var(--accent-focus)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="var(--accent-focus)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <R.XAxis
              dataKey="day" tickFormatter={짧은날}
              tick={{ fill: "var(--text-dim)", fontSize: 10 }}
              axisLine={false} tickLine={false} minTickGap={24}
            />
            {/* 세로축은 안 그린다. 좁은 화면에서 '1,234,567원' 눈금이
                가로폭의 3분의 1을 먹는다. 금액은 위 카드가 이미 말한다 */}
            <R.YAxis hide domain={["dataMin", "dataMax"]} />
            <R.Tooltip
              contentStyle={{
                background: "var(--bg-card)", border: "1px solid var(--border-default)",
                borderRadius: 10, fontSize: 12, color: "var(--text-primary)",
              }}
              labelStyle={{ color: "var(--text-muted)" }}
              formatter={(v: number, name: string) => [fmtKRWFull(Number(v)), name]}
            />
            {/* 원금을 같이 그린다. 선 하나만 있으면 '올랐다' 는 보여도
                '벌었다' 는 안 보인다 — 그 둘은 다른 이야기다 */}
            <R.Area type="monotone" dataKey="cost" name="원금"
                    stroke="var(--text-dim)" strokeWidth={1} strokeDasharray="4 3"
                    fill="none" dot={false} isAnimationActive={false} />
            <R.Area type="monotone" dataKey="value" name="평가금액"
                    stroke="var(--accent-focus)" strokeWidth={2}
                    fill="url(#자산흐름칠)" dot={false} isAnimationActive={false} />
          </R.AreaChart>
        )}
      </차트틀>
    </>,
  );
}
