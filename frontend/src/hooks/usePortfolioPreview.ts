/**
 * 로그인 전 미리보기 — **예시 종목에 실제 값**을 붙인다.
 *
 * ── 무엇이 예시이고 무엇이 진짜인가 ──
 *
 * 예시인 것   어떤 종목을 몇 주 갖고 있나(PREVIEW_ENRICHED)
 * 진짜인 것   그 종목들의 시세·시세 이력·배당·뉴스
 *
 * 처음에는 셋 다 지어냈다. 그런데 그러면 '이 화면이 무엇을 할 수
 * 있는지' 를 보여 주려다가 **없는 값을 진짜처럼 보여 주는** 셈이 된다.
 * 배당 금액도, 기사 제목도 다 가짜였다.
 *
 * 보유 수량만 예시로 두고 나머지는 실제로 받아 온다. 화면 위에
 * '미리보기 모드 — 아래는 예시 데이터입니다' 배너가 떠 있고, 탭마다
 * '예시 포트폴리오' 라고 다시 적는다.
 *
 * ── 서버를 어떻게 아끼나 ──
 *
 * 로그인 안 한 방문자 때문에 0.15 CPU 서버가 느려지면 안 된다.
 *
 *   뉴스   이미 받아 둔 대시보드 뉴스에서 고른다 — 요청 0
 *   배당   종목당 하나. 하루를 담아 두고, 배당 달력과 같은 캐시다
 *   추이   종목당 시세 이력 하나. 탭을 열 때만 나간다
 *
 * 셋 다 그 탭을 눌렀을 때만 나간다.
 */
import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { stocksApi, dashboardApi, type 배당줄, type 종목배당, type 자산흐름점, type 보유뉴스응답 } from "@/api/stocks";
import type { 뉴스항목 } from "@/types";
import type { EnrichedItem } from "@/types/portfolio";

/** 미리보기에서 값을 받아 올 종목 — 현금처럼 시세가 없는 것은 뺀다 */
function 받을것(항목: EnrichedItem[]) {
  return 항목
    .filter((e) => e.assetClass !== "현금" && /^[A-Za-z0-9.\-]+$/.test(e.symbol))
    .map((e) => ({ symbol: e.symbol, market: e.market, name: e.name || e.symbol, shares: e.shares }));
}

/* ── 추이 ─────────────────────────────────────────────────
 *
 * 종목마다 실제 시세 이력을 받아, 그날그날의 원화 평가금액을 더한다.
 * 화면 위 '총 평가금액' 과 같은 규칙으로 센다 — 해외 종목은 환율을
 * 곱하고 국내 종목은 안 곱한다.
 *
 * 환율은 오늘 값 하나만 쓴다. 과거 환율까지 받아 오면 요청이 배로
 * 느는데, 예시 그래프가 그만큼 정확할 이유는 없다. 대신 그래프
 * 아래에 무엇을 예시로 두었는지 적는다.
 */
export function 이력합치기(
  묶음: { 봉들: { date: string; close: number }[]; 수량: number; 해외: boolean }[],
  환율: number,
  원금: number,
): 자산흐름점[] {
  const 날모음 = new Map<string, number>();
  for (const { 봉들, 수량, 해외 } of 묶음) {
    for (const b of 봉들) {
      if (!b?.date || !Number.isFinite(b.close)) continue;
      const 날 = b.date.slice(0, 10);
      날모음.set(날, (날모음.get(날) ?? 0) + b.close * 수량 * (해외 ? 환율 : 1));
    }
  }
  /* 종목마다 장이 열린 날이 다르다(미국 휴장·한국 휴장). 한 종목만 값이
     있는 날을 그대로 쓰면 그날 자산이 뚝 떨어진 것처럼 보인다 —
     모든 종목에 값이 있는 날만 쓴다 */
  const 완전한날 = [...날모음.keys()].filter((날) =>
    묶음.every(({ 봉들 }) => 봉들.some((b) => b.date.slice(0, 10) === 날)),
  );
  return 완전한날.sort().map((날) => ({
    day: 날,
    value: Math.round(날모음.get(날)!),
    cost: 원금,
    filled: 묶음.length,
    priced: 묶음.length,
  }));
}

export function use미리보기흐름(항목: EnrichedItem[], 환율: number, 켜짐: boolean) {
  const 대상 = useMemo(() => 받을것(항목), [항목]);
  const 결과 = useQueries({
    queries: 대상.map((it) => ({
      queryKey: ["stock-ohlcv", it.market, it.symbol, "3mo"],
      queryFn: () => stocksApi.getOHLCV(it.market, it.symbol, "3mo", "1d"),
      enabled: 켜짐,
      staleTime: 3_600_000,          // 일봉이라 한 시간에 한 번이면 넉넉하다
    })),
  });

  return useMemo(() => {
    if (!켜짐 || 결과.some((r) => r.isLoading)) return { 점들: null, 받는중: 켜짐 };
    const 묶음 = 결과
      .map((r, i) => ({
        봉들: (r.data ?? []) as { date: string; close: number }[],
        수량: 대상[i].shares,
        해외: 대상[i].market !== "KR",
      }))
      .filter((x) => x.봉들.length > 0);
    if (묶음.length === 0) return { 점들: [], 받는중: false };
    const 원금 = 항목.reduce((s, e) => s + e.costKRW, 0);
    const 현금 = 항목.filter((e) => e.assetClass === "현금")
                     .reduce((s, e) => s + e.currentValueKRW, 0);
    const 점들 = 이력합치기(묶음, 환율, 원금);
    // 현금은 시세가 없다 — 날마다 같은 금액으로 얹는다
    return { 점들: 점들.map((p) => ({ ...p, value: p.value + Math.round(현금) })), 받는중: false };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [켜짐, 결과.map((r) => r.dataUpdatedAt).join(","), 대상, 환율, 항목]);
}

/* ── 배당 ───────────────────────────────────────────────── */

/**
 * 이번 회차의 주당 금액.
 *
 * 마지막 회차 금액을 쓰면 안 된다 — 분기배당은 회차마다 금액이 다르고
 * (결산배당이 붙는 분기가 크다), 마지막이 큰 회차였으면 다음에 받을
 * 돈이 통째로 부풀어 보인다. 그 달에 실제로 준 금액을 쓴다.
 *
 * 서버의 달력 경로가 next_amount 로 같은 값을 보내 주는데, 미리보기는
 * 공개 경로(/stocks/{market}/{symbol}/dividends)로 받아서 그 필드가
 * 없다. 같은 규칙을 여기서 한 번 더 적용한다.
 */
export function 회차주당(정보: 종목배당, 날: string): number {
  const 달 = Number(날.split("-")[1]);
  const 칸 = (정보.schedule ?? []).find((x) => x.month === 달);
  return 칸?.amount ?? 정보.last_amount ?? 0;
}

export function use미리보기배당(항목: EnrichedItem[], 켜짐: boolean) {
  const 대상 = useMemo(() => 받을것(항목), [항목]);
  const 결과 = useQueries({
    queries: 대상.map((it) => ({
      queryKey: ["stock-dividends", it.market, it.symbol],
      queryFn: () => stocksApi.getDividends(it.market, it.symbol),
      enabled: 켜짐,
      staleTime: 3_600_000,
    })),
  });

  return useMemo(() => {
    if (!켜짐) return undefined;
    const 받는중 = 결과.filter((r) => r.isLoading).length;
    const items: 배당줄[] = [];
    결과.forEach((r, i) => {
      const 정보 = r.data as 종목배당 | undefined;
      if (!정보 || !정보.per_year) return;
      const 날 = 정보.ex_date || 정보.estimated_date;
      if (!날) return;
      const 수량 = 대상[i].shares;
      items.push({
        ...(정보 as 배당줄),
        name: 대상[i].name,
        shares: 수량,
        date: 날,
        confirmed: !!정보.ex_date,
        /* 이번 회차 주당 금액 — 그 달에 **실제로 준** 금액을 쓴다.
           마지막 회차(last_amount)는 분기마다 금액이 다른 종목에서
           다음 회차와 아무 상관이 없다. 서버가 보내 주는 달별 일정에서
           이번 회차의 달을 찾아 쓴다(달력 경로와 같은 규칙). */
        next_amount: 회차주당(정보, 날),
        expected: Math.round(수량 * 회차주당(정보, 날) * 100) / 100,
        expected_year: Math.round(수량 * (정보.plan_year ?? 정보.per_year ?? 0) * 100) / 100,
      });
    });
    items.sort((a, b) => a.date.localeCompare(b.date));
    return { items, pending: 받는중 };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [켜짐, 결과.map((r) => r.dataUpdatedAt).join(","), 대상]);
}

/* ── 뉴스 ─────────────────────────────────────────────────
 *
 * 대시보드가 이미 받아 둔 종합 뉴스에서 고른다. 서버에 요청이 하나도
 * 안 늘어나고, 기사도 진짜다.
 *
 * 고르는 규칙은 서버(portfolio_news)와 같다 — 한글 이름은 그냥 포함,
 * 영문 심볼은 단어 경계. 'V'(비자)를 포함으로 보면 거의 모든 기사에
 * 걸리고, 'GD' 는 'GDP' 에 걸린다.
 */
const 한글 = /[가-힣]/;

export function 걸리나(말: string, 글: string): boolean {
  if (!말 || !글) return false;
  if (한글.test(말)) return 글.includes(말);
  return new RegExp(`\\b${말.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(글);
}

export function 내종목기사(기사들: 뉴스항목[], 대상: { symbol: string; name: string }[]): 보유뉴스응답["items"] {
  const 모은것 = new Map<string, 보유뉴스응답["items"][number]>();
  for (const it of 대상) {
    const 말들 = [it.name, it.symbol].filter((w) => w && w.length >= 2);
    for (const a of 기사들) {
      if (!a?.link) continue;
      if (!말들.some((w) => 걸리나(w, a.title ?? "") || 걸리나(w, a.summary ?? ""))) continue;
      const 이미 = 모은것.get(a.link);
      if (이미) {
        if (!이미.symbols.includes(it.symbol)) 이미.symbols.push(it.symbol);
        continue;
      }
      모은것.set(a.link, {
        title: a.title ?? "", link: a.link, source: a.source ?? "",
        published: a.published ?? "", published_ts: a.published_ts ?? 0,
        summary: a.summary ?? "", image: a.image ?? null, symbols: [it.symbol],
      });
    }
  }
  const 목록 = [...모은것.values()];
  // 사진 있는 것을 앞으로 — 버리지는 않는다(뉴스 탭과 같은 규칙)
  return [...목록.filter((a) => a.image), ...목록.filter((a) => !a.image)].slice(0, 30);
}

export function use미리보기뉴스(항목: EnrichedItem[], 켜짐: boolean): 보유뉴스응답 | undefined {
  const 대상 = useMemo(() => 받을것(항목), [항목]);
  /* 대시보드가 쓰는 것과 **같은 열쇠**다. 앱을 열 때 이미 받아 뒀으면
     여기서는 왕복이 0 이다 */
  const kr = useQuery({
    queryKey: ["dashboard-news", "kr", "latest"],
    queryFn: () => dashboardApi.getNews("kr", "latest"),
    enabled: 켜짐, staleTime: 300_000,
  });
  const us = useQuery({
    queryKey: ["dashboard-news", "us", "latest"],
    queryFn: () => dashboardApi.getNews("us", "latest"),
    enabled: 켜짐, staleTime: 300_000,
  });

  return useMemo(() => {
    if (!켜짐) return undefined;
    const 기사들 = [...(kr.data ?? []), ...(us.data ?? [])] as 뉴스항목[];
    const items = 내종목기사(기사들, 대상);
    const 찾음 = new Set(items.flatMap((a) => a.symbols));
    return {
      items,
      covered: [...찾음].sort(),
      missing: 대상.filter((t) => !찾음.has(t.symbol))
                   .map((t) => ({ symbol: t.symbol, market: t.market, name: t.name })),
      // 종합 뉴스를 아직 못 받았으면 '오는 중' 이다
      pending: kr.isLoading || us.isLoading ? 대상.length : 0,
    };
  }, [켜짐, kr.data, us.data, kr.isLoading, us.isLoading, 대상]);
}
