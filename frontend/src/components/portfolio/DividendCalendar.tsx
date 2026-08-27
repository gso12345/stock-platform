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
import { use돈 } from "@/hooks/useMoney";

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

/**
 * 배당에 붙는 원천징수 세율.
 *
 *   국내 15.4%  소득세 14% + 지방소득세 1.4%. 받을 때 이미 떼고 들어온다.
 *   해외 15%    미국에서 떼는 몫. 한·미 조세조약상 15% 이고, 국내 세율
 *               14% 보다 높아 국내에서 더 떼지 않는다.
 *
 * ── 이 숫자로 다 되는 건 아니다 ──
 *
 * 한 해 금융소득이 2,000만원을 넘으면 종합과세로 넘어가 사람마다 세율이
 * 달라진다. 그래서 화면에 '어림' 이라고 적고 계산 근거를 같이 쓴다.
 * 정확한 척하는 게 제일 나쁘다 — 그 숫자로 세금 계획을 세울 사람이 있다.
 */
export const 원천징수 = { 국내: 0.154, 해외: 0.15 } as const;

/** 통화로 국내/해외를 가른다.
 *
 *  market 이 아니라 통화로 보는 이유 — 배당을 어느 나라에서 주느냐가
 *  세금을 정하는데, 시장 구분(KR/US/ETF)에는 국내 상장 해외 ETF 처럼
 *  애매한 것이 섞인다. 원화로 주면 국내에서 떼고 들어온 돈이다. */
export function 세율(currency?: string): number {
  return currency === "KRW" ? 원천징수.국내 : 원천징수.해외;
}

/** 한 종목이 한 회차에 주는 돈 — 원화로 */
export function 회차금액(r: 배당줄, 환율: number, 세후로 = false): number {
  const 수량 = r.shares || 0;
  if (!수량) return 0;
  const 배수 = r.currency === "KRW" ? 1 : 환율;
  const 세전 = (r.last_amount || 0) * 수량 * 배수;
  return 세후로 ? 세전 * (1 - 세율(r.currency)) : 세전;
}

/** 한 달치 — 주배당은 한 달에 네 번쯤 들어온다 */
export function 한달금액(r: 배당줄, 환율: number, 세후로 = false): number {
  const 회차 = r.per_month && r.per_month > 1 ? r.per_month : 1;
  return 회차금액(r, 환율, 세후로) * 회차;
}

/**
 * 달마다 얼마 들어오나 — 열두 칸.
 *
 * 종목이 '몇 월에 주는지'(months)를 서버가 알려 준다. 분기배당이라도
 * 회사마다 달이 달라서(2·5·8·11 vs 3·6·9·12) 그걸 안 쓰면 한 해 그림이
 * 통째로 틀린다.
 */
export function 달마다(줄들: 배당줄[], 환율: number, 세후로 = false): number[] {
  const 칸 = Array(12).fill(0);
  for (const r of 줄들) {
    const 한달 = 한달금액(r, 환율, 세후로);
    if (!한달) continue;
    for (const m of r.months ?? []) {
      if (m >= 1 && m <= 12) 칸[m - 1] += 한달;
    }
  }
  return 칸;
}

/** 내 보유 몫 — 배당률의 분모가 되는 값들.
 *
 *  배당금(분자)은 서버가 주는데, '얼마를 넣어서 그만큼 받나'(분모)는
 *  내 자산 화면만 안다. 그래서 위에서 내려받는다 — 새 요청을 하나 더
 *  보내지 않으려는 것이기도 하다(무료 서버는 0.15 CPU 다). */
export interface 보유몫 { 수량: number; 원가: number; 평가: number }

/**
 * 서버가 센 수량을 화면이 보고 있는 몫으로 줄인다.
 *
 * 전체 보기에서 포트폴리오 하나를 빼 두면, 화면의 합계는 줄어드는데
 * 배당은 여전히 전량 기준으로 나온다. 그러면 '내 자산의 8% 가 배당' 같은
 * 말도 안 되는 배당률이 찍힌다. 화면이 보고 있는 수량으로 맞춘다.
 */
export function 내몫으로(줄들: 배당줄[], 보유?: Record<string, 보유몫>): 배당줄[] {
  if (!보유) return 줄들;
  const 결과: 배당줄[] = [];
  for (const r of 줄들) {
    const 몫 = 보유[r.symbol];
    if (!몫 || 몫.수량 <= 0) continue;      // 화면에서 빠진 종목
    결과.push(몫.수량 === r.shares ? r : { ...r, shares: 몫.수량 });
  }
  return 결과;
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

export default function DividendCalendar({ portfolioId, 이름, 보유 }: {
  /** 지금 보고 있는 포트폴리오. 없으면(전체 보기) 가진 것 전부 */
  portfolioId?: number;
  /** 포트폴리오 이름 — 무엇의 배당인지 제목에 밝힌다 */
  이름?: string;
  /** 심볼 → 내 몫. 배당률의 분모이자, 화면이 보고 있는 수량의 기준 */
  보유?: Record<string, 보유몫>;
}) {
  const 환율 = useExchangeRate();
  const 돈 = use돈();
  const 이번달 = new Date().getMonth() + 1;
  const [고른달, set고른달] = useState<number>(이번달);
  /* 세전으로 시작한다. 세후가 기본이면 '내가 아는 배당금과 다른데?' 가
     먼저 오고, 왜 다른지는 한참 뒤에야 눈에 띈다 */
  const [세후로, set세후로] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["dividend-calendar", portfolioId ?? "all"],
    queryFn: () => portfolioApi.getDividends(portfolioId),
    staleTime: 600_000,
  });

  const 줄들 = useMemo<배당줄[]>(() => 내몫으로(data?.items ?? [], 보유), [data, 보유]);
  const 아직 = data?.pending ?? 0;

  const 월별 = useMemo(() => 달마다(줄들, 환율, 세후로), [줄들, 환율, 세후로]);
  const 한해 = useMemo(() => 월별.reduce((s, v) => s + v, 0), [월별]);
  const 최대 = useMemo(() => Math.max(...월별, 1), [월별]);

  /* ── 배당률 두 가지 ──
     투자배당률  한 해 배당 ÷ 내가 넣은 돈. 내가 산 가격이 기준이라
                 오래 가진 사람일수록 높아진다 — '내 배당률' 이다.
     시가배당률  한 해 배당 ÷ 지금 평가금액. 지금 사는 사람이 받게 될
                 배당률에 가깝다.
     둘은 다른 이야기이고, 배당 앱들이 나란히 놓는 이유가 그것이다. */
  const 분모 = useMemo(() => {
    if (!보유) return null;
    let 원가 = 0, 평가 = 0;
    for (const v of Object.values(보유)) { 원가 += v.원가; 평가 += v.평가; }
    return { 원가, 평가 };
  }, [보유]);
  const 투자배당률 = 분모 && 분모.원가 > 0 ? (한해 / 분모.원가) * 100 : null;
  const 시가배당률 = 분모 && 분모.평가 > 0 ? (한해 / 분모.평가) * 100 : null;

  /** 고른 달에 주는 종목들 — 금액 큰 순 */
  const 그달것 = useMemo(() => 줄들
    .filter((r) => r.months?.includes(고른달))
    .map((r) => ({ r, 금액: 한달금액(r, 환율, 세후로) }))
    .sort((a, b) => b.금액 - a.금액), [줄들, 고른달, 환율, 세후로]);

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
      {/* ── 세전 / 세후 ──
          배당 앱들이 '세금 0% 적용' 같은 칩으로 켜고 끈다. 실제로 통장에
          꽂히는 돈은 세후인데, 어느 쪽을 보고 있는지 안 적으면 두 화면이
          말이 안 맞는다 */}
      <div className="flex items-center justify-between gap-2 -mt-0.5">
        <span className="text-2xs text-text-muted">한 해 {세후로 ? "실수령" : "예상"}</span>
        <div className="flex rounded-lg border border-border overflow-hidden shrink-0" role="group" aria-label="세금 적용">
          {([false, true] as const).map((v) => (
            <button
              key={String(v)}
              onClick={() => set세후로(v)}
              aria-pressed={세후로 === v}
              className={`px-2.5 py-1 text-2xs font-semibold transition-colors ${
                세후로 === v ? "bg-accent-green text-white" : "text-text-muted hover:text-text-primary hover:bg-bg-elevated"
              }`}
            >{v ? "세후" : "세전"}</button>
          ))}
        </div>
      </div>

      {/* 한 해에 얼마 — 이 화면에서 제일 먼저 보고 싶은 숫자.
          그 옆에 배당률 둘. 금액만 있으면 '많이 받는 건가' 를 알 수 없다 */}
      <div className="grid grid-cols-3 gap-2 -mt-1">
        <div className="flex flex-col gap-0.5 col-span-1 min-w-0">
          <span className="text-2xs text-text-dim whitespace-nowrap">연간 배당금</span>
          <span className="text-lg leading-tight font-mono font-bold text-text-primary num truncate">
            {돈.원(한해)}
          </span>
        </div>
        {([
          { 이름: "투자 배당률", 값: 투자배당률, 설명: "내가 넣은 돈 대비" },
          { 이름: "시가 배당률", 값: 시가배당률, 설명: "지금 평가금액 대비" },
        ] as const).map((c) => (
          <div key={c.이름} className="flex flex-col gap-0.5 min-w-0">
            <span className="text-2xs text-text-dim whitespace-nowrap" title={c.설명}>{c.이름}</span>
            <span className="text-lg leading-tight font-mono font-bold text-accent-green num">
              {/* 분모를 모르면 안 쓴다. 0% 로 적으면 '배당이 없다' 가 된다 */}
              {c.값 == null ? "—" : `${c.값.toFixed(2)}%`}
            </span>
          </div>
        ))}
      </div>

      {세후로 && (
        <p className="text-2xs text-text-dim break-keep -mt-1.5">
          국내 {(원천징수.국내 * 100).toFixed(1)}%(소득세+지방소득세), 해외 {(원천징수.해외 * 100).toFixed(0)}%(미국 원천징수)를
          뗀 어림값이에요. 한 해 금융소득이 2,000만원을 넘으면 종합과세로 달라져요.
        </p>
      )}

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
              aria-label={`${m}월 ${v > 0 ? 돈.원(v) : "배당 없음"}`}
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
          {월별[고른달 - 1] > 0 ? 돈.원(월별[고른달 - 1]) : "—"}
        </span>
      </div>

      {그달것.length === 0 ? (
        <p className="py-3 text-center text-2xs text-text-dim">이 달에는 들어오는 배당이 없어요</p>
      ) : (
        <ul className="flex flex-col">
          {그달것.map(({ r, 금액 }) => {
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
                {금액 > 0 && (
                  <div className="flex flex-col items-end shrink-0">
                    <span className="text-xs font-mono font-semibold text-accent-green num">
                      {돈.원(금액)}
                    </span>
                    {/* 환산값만 있으면 맞는지 확인할 길이 없다 */}
                    {r.currency !== "KRW" && (
                      <span className="text-2xs text-text-dim">
                        {돈.글(원본돈(금액 / (환율 || 1), r.currency))}
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
