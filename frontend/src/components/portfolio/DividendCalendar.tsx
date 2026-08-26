/**
 * 배당 달력 — 내 종목이 언제 얼마를 주는가.
 *
 * 지금까지 배당은 '배당수익률 2.1%' 라는 숫자 하나로만 있었다. 배당을
 * 보고 사는 사람이 정작 알고 싶은 것은 **언제** 들어오느냐다.
 *
 * ── 왜 월별 막대인가 ──
 *
 * 처음에는 '다음 배당일' 을 날짜순으로 늘어놓기만 했다. 그런데 배당을
 * 보고 사는 사람이 실제로 하는 일은 '한 해 얼마 받고, 어느 달이 비는가'
 * 를 보는 것이다. 목록만으로는 그게 안 보인다 — 2·5·8·11월에만 주는
 * 종목을 잔뜩 갖고 있어도 모른다.
 *
 * 그래서 열두 달을 막대로 세우고, 막대를 누르면 그 달 내역이 아래에
 * 펼쳐지게 했다. 배당 앱들이 다 이 모양인 데는 이유가 있다.
 *
 * ── 정직하게 보여야 하는 것 ──
 *
 *   1) 확정과 예상을 섞지 않는다. 회사가 공시한 날짜와 '지난 주기로
 *      미뤄 본 날짜' 는 다른 말이다. 예상 날짜는 '10월 초' 로 뭉갠다.
 *   2) 안 갖고 있는 종목에는 금액을 안 쓴다. 수량이 0인데 '0원' 이라고
 *      적으면 '배당을 안 준다' 로 읽힌다.
 *   3) 달러 종목은 원화로 환산해 합치되 **원래 금액도 같이 적는다** —
 *      환산값만 있으면 맞는지 확인할 길이 없다.
 *   4) 이번 회차 날짜를 아는 달에만 D-day 를 적는다. 다른 달은 아직
 *      날짜를 모른다 — 지어내지 않는다.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays } from "lucide-react";
import { portfolioApi, type 배당줄 } from "@/api/stocks";
import { Card, 못불러옴 } from "@/components/ui";
import { useExchangeRate } from "@/hooks/useExchangeRate";
import { fmtKRWFull } from "@/utils/formatters";

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

/** 한 종목이 한 회차에 주는 돈 — 원화로 */
export function 회차금액(r: 배당줄, 환율: number): number {
  const 수량 = r.shares || 0;
  if (!수량) return 0;
  const 배수 = r.currency === "KRW" ? 1 : 환율;
  return (r.last_amount || 0) * 수량 * 배수;
}

/** 한 달치 — 주배당은 한 달에 네 번쯤 들어온다 */
export function 한달금액(r: 배당줄, 환율: number): number {
  const 회차 = r.per_month && r.per_month > 1 ? r.per_month : 1;
  return 회차금액(r, 환율) * 회차;
}

/**
 * 달마다 얼마 들어오나 — 열두 칸.
 *
 * 종목이 '몇 월에 주는지'(months)를 서버가 알려 준다. 분기배당이라도
 * 회사마다 달이 달라서(2·5·8·11 vs 3·6·9·12) 그걸 안 쓰면 한 해 그림이
 * 통째로 틀린다.
 */
export function 달마다(줄들: 배당줄[], 환율: number): number[] {
  const 칸 = Array(12).fill(0);
  for (const r of 줄들) {
    const 한달 = 한달금액(r, 환율);
    if (!한달) continue;
    for (const m of r.months ?? []) {
      if (m >= 1 && m <= 12) 칸[m - 1] += 한달;
    }
  }
  return 칸;
}

/** 만 단위로 짧게 — 막대 위 라벨은 자리가 없다 */
export function 짧은돈(v: number): string {
  if (!v) return "";
  if (v >= 100_000_000) return `${(v / 100_000_000).toFixed(1)}억`;
  if (v >= 10_000) return `${Math.round(v / 10_000).toLocaleString("ko-KR")}만`;
  return `${Math.round(v).toLocaleString("ko-KR")}`;
}

/**
 * 원화 종목이면 원, 아니면 달러.
 *
 * 자릿수를 값에 맞춰 늘린다. 주배당 ETF 는 한 주에 $0.063 처럼 아주
 * 작은 금액을 주는데, 두 자리로 자르면 $0.06 이 되어 5% 를 깎아
 * 보여 준다. '주당 얼마' 는 사람이 눈으로 검산하는 값이라 틀리면 안 된다.
 */
export function 원본돈(v: number, currency?: string): string {
  if (currency === "KRW") {
    // 원화도 소수가 나올 수 있다(환산이 아닌 원본이라 드물지만)
    return v >= 1 || v === 0
      ? `${Math.round(v).toLocaleString("ko-KR")}원`
      : `${v.toFixed(2)}원`;
  }
  const 자리 = Math.abs(v) > 0 && Math.abs(v) < 0.1 ? 4 : 2;
  return `$${v.toFixed(자리)}`;
}

export default function DividendCalendar({ portfolioId, 이름 }: {
  /** 지금 보고 있는 포트폴리오. 없으면(전체 보기) 가진 것 전부 */
  portfolioId?: number;
  /** 포트폴리오 이름 — 무엇의 배당인지 제목에 밝힌다 */
  이름?: string;
}) {
  const 환율 = useExchangeRate();
  const 이번달 = new Date().getMonth() + 1;
  const [고른달, set고른달] = useState<number>(이번달);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["dividend-calendar", portfolioId ?? "all"],
    queryFn: () => portfolioApi.getDividends(portfolioId),
    staleTime: 600_000,
  });

  const 줄들 = useMemo<배당줄[]>(() => data?.items ?? [], [data]);
  const 아직 = data?.pending ?? 0;

  const 월별 = useMemo(() => 달마다(줄들, 환율), [줄들, 환율]);
  const 한해 = useMemo(() => 월별.reduce((s, v) => s + v, 0), [월별]);
  const 최대 = useMemo(() => Math.max(...월별, 1), [월별]);

  /** 고른 달에 주는 종목들 — 금액 큰 순 */
  const 그달것 = useMemo(() => 줄들
    .filter((r) => r.months?.includes(고른달))
    .map((r) => ({ r, 돈: 한달금액(r, 환율) }))
    .sort((a, b) => b.돈 - a.돈), [줄들, 고른달, 환율]);

  const 틀 = (속: React.ReactNode) => (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center gap-1.5">
        <CalendarDays size={14} className="text-accent-green" />
        <span className="text-sm font-semibold text-text-primary">배당 달력</span>
        {/* 탭을 바꾸면 목록도 바뀐다. 무엇의 배당인지 안 적으면
            '왜 아까랑 다르지' 가 된다 */}
        {이름 && <span className="text-2xs text-text-dim truncate">{이름}</span>}
        {아직 > 0 && (
          <span className="text-2xs text-text-dim ml-auto shrink-0">{아직}개 확인 중</span>
        )}
      </div>
      {속}
    </Card>
  );

  if (isError) return 틀(<못불러옴 사유={error} 다시={() => refetch()} compact />);
  if (isLoading) return 틀(<div className="h-24 rounded-lg bg-bg-elevated animate-pulse" />);

  if (줄들.length === 0) {
    return 틀(
      <p className="py-4 text-center text-xs text-text-dim break-keep">
        {아직 > 0
          ? "배당 일정을 확인하는 중이에요. 잠시 뒤 다시 열어 보세요."
          : portfolioId
            ? "이 포트폴리오에는 배당을 주는 종목이 없어요."
            : "배당을 주는 종목이 아직 없어요."}
      </p>,
    );
  }

  return 틀(
    <>
      {/* 한 해에 얼마 — 이 화면에서 제일 먼저 보고 싶은 숫자 */}
      <div className="flex items-baseline gap-2 -mt-0.5">
        <span className="text-2xl font-mono font-bold text-text-primary num">
          {fmtKRWFull(한해)}
        </span>
        <span className="text-2xs text-text-dim">한 해 예상</span>
      </div>

      {/* ── 월별 막대 ──
          목록만으로는 '어느 달이 비는가' 가 안 보인다 */}
      <div className="flex items-end gap-1 -mx-0.5">
        {월별.map((v, i) => {
          const m = i + 1;
          const 고름 = m === 고른달;
          const 높이 = v > 0 ? Math.max(6, Math.round((v / 최대) * 44)) : 3;
          return (
            <button
              key={m}
              onClick={() => set고른달(m)}
              aria-pressed={고름}
              aria-label={`${m}월 ${v > 0 ? fmtKRWFull(v) : "배당 없음"}`}
              className="flex-1 flex flex-col items-center justify-end gap-0.5 group min-w-0"
            >
              <span className={`text-2xs leading-none tabular-nums truncate w-full text-center transition-colors ${
                고름 ? "text-accent-green font-bold" : "text-text-dim"
              }`}>{짧은돈(v)}</span>
              <span
                style={{ height: `${높이}px` }}
                className={`w-full rounded-t-[3px] transition-colors ${
                  고름 ? "bg-accent-green"
                       : v > 0 ? "bg-accent-green/25 group-hover:bg-accent-green/40"
                               : "bg-bg-elevated"
                }`}
              />
              <span className={`text-2xs leading-none transition-colors ${
                고름 ? "text-accent-green font-bold" : "text-text-dim"
              }`}>{m}</span>
            </button>
          );
        })}
      </div>

      {/* ── 고른 달 내역 ── */}
      <div className="flex items-baseline justify-between gap-2 pt-1 border-t border-border/50">
        <span className="text-sm font-semibold text-text-primary">
          {고른달}월
          {고른달 === 이번달 && (
            <span className="ml-1 text-2xs text-accent-green font-medium">이번 달</span>
          )}
        </span>
        <span className="text-sm font-mono font-semibold text-accent-green num">
          {월별[고른달 - 1] > 0 ? fmtKRWFull(월별[고른달 - 1]) : "—"}
        </span>
      </div>

      {그달것.length === 0 ? (
        <p className="py-3 text-center text-2xs text-text-dim">이 달에는 들어오는 배당이 없어요</p>
      ) : (
        <ul className="flex flex-col">
          {그달것.map(({ r, 돈 }) => {
            /* 이번 회차 날짜(r.date)가 이 달일 때만 D-day 를 적는다.
               다른 달은 아직 날짜를 모른다 */
            const 예정 = 고른달 === Number(r.date.split("-")[1]);
            const 남음 = 예정 ? 남은날(r.date) : null;
            return (
              <li key={`${r.market}:${r.symbol}`}
                  className="flex items-center gap-2.5 py-2 border-b border-border/50 last:border-b-0">
                <div className="flex flex-col items-center shrink-0 w-12">
                  {예정 ? (
                    <>
                      <span className={`text-2xs font-semibold ${r.confirmed ? "text-accent-green" : "text-text-dim"}`}>
                        {남음 != null && 남음 <= 0 ? "오늘" : `D-${남음}`}
                      </span>
                      <span className="text-2xs text-text-dim">
                        {r.confirmed ? 날짜글(r.date) : 어림날짜글(r.date)}
                      </span>
                    </>
                  ) : (
                    <span className="text-2xs text-text-dim">{고른달}월</span>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-medium text-text-primary truncate">{r.name}</p>
                    {/* 확정과 예상을 섞지 않는다 */}
                    {예정 && (
                      <span className={`text-2xs px-1 py-px rounded shrink-0 ${
                        r.confirmed
                          ? "bg-accent-green/15 text-accent-green"
                          : "bg-bg-elevated text-text-dim"
                      }`}>{r.confirmed ? "확정" : "예상"}</span>
                    )}
                  </div>
                  <p className="text-2xs text-text-dim truncate">
                    {r.shares ? `${r.shares.toLocaleString("ko-KR")}주 · ` : ""}
                    주당 {원본돈(r.last_amount, r.currency)}
                    {r.cycle ? ` · ${r.cycle}배당` : ""}
                  </p>
                  {/* 몇 월에 주는지. 분기배당이라도 회사마다 달이 다르다 */}
                  {r.months && r.months.length > 0 && r.months.length < 12 && (
                    <p className="text-2xs text-text-dim">배당월 {r.months.join("·")}</p>
                  )}
                </div>

                {/* 수량이 0이면 금액을 안 쓴다 — '0원' 은 '배당을 안 준다'
                    로 읽힌다 */}
                {돈 > 0 && (
                  <div className="flex flex-col items-end shrink-0">
                    <span className="text-xs font-mono font-semibold text-accent-green num">
                      {fmtKRWFull(돈)}
                    </span>
                    {/* 환산값만 있으면 맞는지 확인할 길이 없다 */}
                    {r.currency !== "KRW" && (
                      <span className="text-2xs text-text-dim">
                        {원본돈(돈 / (환율 || 1), r.currency)}
                      </span>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>,
  );
}
