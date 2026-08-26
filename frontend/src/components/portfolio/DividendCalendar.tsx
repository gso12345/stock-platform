/**
 * 배당 달력 — 내 종목이 언제 얼마를 주는가.
 *
 * 지금까지 배당은 '배당수익률 2.1%' 라는 숫자 하나로만 있었다. 배당을
 * 보고 사는 사람이 정작 알고 싶은 것은 **언제** 들어오느냐다.
 *
 * ── 정직하게 보여야 하는 것 둘 ──
 *
 *   1) 확정과 예상을 섞지 않는다. 회사가 공시한 날짜와 '지난 주기로
 *      미뤄 본 날짜' 는 다른 말이다. 예상에는 '예상' 이라고 쓰고
 *      날짜도 '8월 12일' 이 아니라 '8월 중순쯤' 으로 뭉갠다.
 *   2) 안 갖고 있는 종목(관심종목)에는 금액을 안 쓴다. 수량이 0인데
 *      '0원' 이라고 적으면 '배당을 안 준다' 로 읽힌다.
 *
 * 서버는 한 번에 몇 종목만 새로 받아 온다. 아직 못 받은 수(pending)를
 * 숨기지 않고 "몇 개는 아직 확인 중" 이라고 적는다 — 목록이 짧은 것과
 * 배당이 없는 것은 다른 일이다.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays } from "lucide-react";
import { portfolioApi, type 배당줄 } from "@/api/stocks";
import { Card, 못불러옴 } from "@/components/ui";

/** 원화 종목이면 원, 아니면 달러 */
function 돈(v: number, market: string): string {
  return market === "KR"
    ? `${Math.round(v).toLocaleString("ko-KR")}원`
    : `$${v.toFixed(2)}`;
}

/** "2026-09-30" → "9월 30일" */
export function 날짜글(day: string): string {
  const [, m, d] = day.split("-");
  return m && d ? `${Number(m)}월 ${Number(d)}일` : day;
}

/** 예상 날짜는 하루까지 맞다고 말하면 안 된다 — 순으로 뭉갠다 */
export function 어림날짜글(day: string): string {
  const [, m, d] = day.split("-");
  if (!m || !d) return day;
  const n = Number(d);
  const 순 = n <= 10 ? "초" : n <= 20 ? "중순" : "말";
  return `${Number(m)}월 ${순}`;
}

/** 오늘로부터 며칠 남았나 */
export function 남은날(day: string, 오늘 = new Date()): number {
  const 그날 = new Date(`${day}T00:00:00`);
  const 기준 = new Date(오늘.getFullYear(), 오늘.getMonth(), 오늘.getDate());
  return Math.round((그날.getTime() - 기준.getTime()) / 86_400_000);
}

export default function DividendCalendar() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["dividend-calendar"],
    queryFn: () => portfolioApi.getDividends(),
    staleTime: 600_000,
  });

  const 줄들 = useMemo<배당줄[]>(() => data?.items ?? [], [data]);
  const 아직 = data?.pending ?? 0;

  /* 한 해에 받을 것으로 보이는 돈 — 원화 종목만 더한다.
     달러와 원을 그냥 더하면 완전히 틀린 숫자가 된다. 환율을 여기서
     또 끌어오느니, 통화별로 나눠 적는 편이 정직하다. */
  const 연합계 = useMemo(() => {
    const 모음: Record<string, number> = {};
    줄들.forEach((r) => {
      if (!r.expected_year) return;
      const 통화 = r.market === "KR" ? "KR" : "US";
      모음[통화] = (모음[통화] ?? 0) + r.expected_year;
    });
    return 모음;
  }, [줄들]);

  const 틀 = (속: React.ReactNode) => (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center gap-1.5">
        <CalendarDays size={14} className="text-accent-green" />
        <span className="text-sm font-semibold text-text-primary">배당 달력</span>
        {아직 > 0 && (
          <span className="text-2xs text-text-dim">{아직}개 확인 중</span>
        )}
      </div>
      {속}
    </Card>
  );

  if (isError) return 틀(<못불러옴 사유={error} 다시={() => refetch()} compact />);
  if (isLoading) return 틀(<div className="h-20 rounded-lg bg-bg-elevated animate-pulse" />);

  if (줄들.length === 0) {
    return 틀(
      <p className="py-4 text-center text-xs text-text-dim break-keep">
        {아직 > 0
          ? "배당 일정을 확인하는 중이에요. 잠시 뒤 다시 열어 보세요."
          : "배당을 주는 종목이 아직 없어요."}
      </p>,
    );
  }

  return 틀(
    <>
      {Object.keys(연합계).length > 0 && (
        <div className="flex items-baseline justify-between gap-3 -mt-1">
          <span className="text-2xs text-text-muted shrink-0">한 해 예상</span>
          <span className="text-sm font-mono font-semibold text-accent-green num text-right">
            {Object.entries(연합계).map(([통화, v]) => 돈(v, 통화)).join(" · ")}
          </span>
        </div>
      )}

      <ul className="flex flex-col">
        {줄들.slice(0, 12).map((r) => {
          const 남음 = 남은날(r.date);
          return (
            <li key={`${r.market}:${r.symbol}`}
                className="flex items-center gap-2.5 py-2 border-b border-border/50 last:border-b-0">
              <div className="flex flex-col items-center shrink-0 w-12">
                <span className={`text-2xs font-semibold ${r.confirmed ? "text-accent-green" : "text-text-dim"}`}>
                  {남음 <= 0 ? "오늘" : `D-${남음}`}
                </span>
                <span className="text-2xs text-text-dim">
                  {r.confirmed ? 날짜글(r.date) : 어림날짜글(r.date)}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-text-primary truncate">{r.name}</p>
                <p className="text-2xs text-text-dim">
                  {/* 확정과 예상을 섞지 않는다 */}
                  {r.confirmed ? "공시" : "예상"}
                  {r.cycle ? ` · ${r.cycle}배당` : ""}
                  {` · 주당 ${돈(r.last_amount, r.market)}`}
                </p>
              </div>
              {/* 수량이 0이면 금액을 안 쓴다 — '0원' 은 '배당을 안 준다'
                  로 읽힌다 */}
              {r.expected != null && (
                <span className="text-xs font-mono font-semibold text-accent-green shrink-0 num">
                  {돈(r.expected, r.market)}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </>,
  );
}
