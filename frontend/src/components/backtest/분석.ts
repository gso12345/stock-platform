/**
 * 백테스트 결과를 더 쪼개 보는 계산 — 사용자: "백테스팅 결과를 더 상세분석할 수 있도록".
 *
 * 낙폭 흐름·깊었던 낙폭·해마다·달마다는 **서버가** 자산배분과 같은 함수로 잰다(routes/backtest._신호분석) — 정의를
 * 한 곳에만 둔다. 여기는 서버가 이미 보낸 거래 목록·수익률 목록으로 셀 수 있는 것만 센다.
 */
import type { 거래, 돌린설정저장 } from "@/api/stocks";

/** 수수료까지 뺀 손익 — 승률·평균은 이 수로 센다(서버 승률과 같은 기준) */
export const 순손익 = (t: 거래) => t.net_pnl_rate ?? t.pnl_rate;

/** 두 날짜 사이 달력 날 수 */
export function 날수(시작: string, 끝: string): number {
  const d = (new Date(끝).getTime() - new Date(시작).getTime()) / 86_400_000;
  return Number.isFinite(d) ? Math.max(0, Math.round(d)) : 0;
}

export interface 분포칸 {
  /** '-10~-5%' 처럼 사람이 읽는 이름 */
  이름: string;
  수: number;
  /** 이 칸이 0 보다 아래인가 — 색을 정한다 */
  아래: boolean;
}

/** 값들을 경계로 나눠 센다. 경계가 [-10, 0, 10] 이면 칸은 넷 — ~-10 · -10~0 · 0~10 · 10~ (왼쪽 포함) */
export function 칸나누기(값들: number[], 경계들: number[], 뒤 = "%"): 분포칸[] {
  const 칸들: 분포칸[] = [];
  const 글 = (v: number) => `${v > 0 ? "+" : ""}${v}`;
  for (let i = 0; i <= 경계들.length; i++) {
    const 아래끝 = i === 0 ? -Infinity : 경계들[i - 1];
    const 위끝 = i === 경계들.length ? Infinity : 경계들[i];
    const 이름 = i === 0 ? `${글(위끝)}${뒤} 미만`
      : i === 경계들.length ? `${글(아래끝)}${뒤} 이상`
      : `${글(아래끝)}~${글(위끝)}${뒤}`;
    칸들.push({ 이름, 수: 값들.filter((v) => v >= 아래끝 && v < 위끝).length, 아래: 위끝 <= 0 });
  }
  return 칸들;
}

/** 거래 한 건의 손익(%)을 나누는 경계 — 대개 ±20% 안이다 */
export const 거래경계 = [-20, -10, -5, 0, 5, 10, 20];
/** 종목 하나의 총수익률(%)을 나누는 경계 — 몇 년이면 몇 배가 되기도 한다 */
export const 종목경계 = [-50, -25, 0, 25, 50, 100, 200];

export interface 거래통계 {
  건수: number;
  이긴수: number;
  진수: number;
  /** 못 재면(거래가 없으면) null — '0%' 는 '다 졌다' 로 읽힌다 */
  평균이익: number | null;
  평균손실: number | null;
  /** 평균 이익 ÷ 평균 손실 크기 — 손실이 없으면 null(무한대) */
  손익비: number | null;
  최고: 거래 | null;
  최저: 거래 | null;
  평균보유일: number | null;
  최장연승: number;
  최장연패: number;
  /** 시장에 들어가 있던 날의 몫(%) — 기간을 알 때만 */
  보유비율: number | null;
  분포: 분포칸[];
}

/** 거래 목록 → 이긴·진 수, 평균, 최고·최저, 보유일, 연승·연패, 손익 분포.
 *  기간(첫날·끝날)을 주면 '시장에 있던 기간' 도 센다 — 들고 있지 않은 날은 그냥 현금이다. */
export function 거래분석(거래들: 거래[], 기간?: { 시작?: string | null; 끝?: string | null }): 거래통계 {
  const 손익 = 거래들.map(순손익);
  const 이긴 = 손익.filter((v) => v > 0);
  const 진 = 손익.filter((v) => v <= 0);
  const 평균 = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const 평균이익 = 평균(이긴);
  const 평균손실 = 평균(진);
  let 최장연승 = 0, 최장연패 = 0, 연승 = 0, 연패 = 0;
  for (const v of 손익) {
    if (v > 0) { 연승 += 1; 연패 = 0; } else { 연패 += 1; 연승 = 0; }
    최장연승 = Math.max(최장연승, 연승);
    최장연패 = Math.max(최장연패, 연패);
  }
  const 보유일들 = 거래들.map((t) => 날수(t.entry_date, t.exit_date));
  const 전체날 = 기간?.시작 && 기간?.끝 ? 날수(기간.시작, 기간.끝) : 0;
  const 고른 = (더나음: (a: number, b: number) => boolean) =>
    거래들.reduce<거래 | null>((앞, t) => (앞 == null || 더나음(순손익(t), 순손익(앞)) ? t : 앞), null);
  return {
    건수: 거래들.length,
    이긴수: 이긴.length,
    진수: 진.length,
    평균이익,
    평균손실,
    손익비: 평균이익 != null && 평균손실 != null && 평균손실 < 0 ? 평균이익 / Math.abs(평균손실) : null,
    최고: 고른((a, b) => a > b),
    최저: 고른((a, b) => a < b),
    평균보유일: 평균(보유일들),
    최장연승,
    최장연패,
    보유비율: 전체날 > 0 && 거래들.length ? Math.min(100, (보유일들.reduce((a, b) => a + b, 0) / 전체날) * 100) : null,
    분포: 칸나누기(손익, 거래경계),
  };
}

export interface 유니버스요약 {
  수: number;
  플러스: number;
  /** 수익 낸 종목의 몫(%) */
  플러스비율: number | null;
  가운데값: number | null;
  평균: number | null;
  최고: number | null;
  최저: number | null;
  분포: 분포칸[];
}

/** 돌린 모든 종목의 총수익률 → 이 전략이 '대체로 통하나'. 상위 N개만 보면 늘 좋아 보인다 */
export function 유니버스요약하기(수익들: number[]): 유니버스요약 {
  const 값들 = 수익들.filter((v) => Number.isFinite(v));
  const 정렬 = [...값들].sort((a, b) => a - b);
  const n = 정렬.length;
  const 가운데값 = n === 0 ? null : n % 2 ? 정렬[(n - 1) / 2] : (정렬[n / 2 - 1] + 정렬[n / 2]) / 2;
  const 플러스 = 값들.filter((v) => v > 0).length;
  return {
    수: n,
    플러스,
    플러스비율: n ? (플러스 / n) * 100 : null,
    가운데값,
    평균: n ? 값들.reduce((a, b) => a + b, 0) / n : null,
    최고: n ? 정렬[n - 1] : null,
    최저: n ? 정렬[0] : null,
    분포: 칸나누기(값들, 종목경계),
  };
}

/* ── 저장한 전략의 '돌린 설정' ── 서버는 크기만 막으므로 화면이 가려 읽는다(결과공유 의 공유읽기 와 같은 생각) */

const 날짜꼴 = /^\d{4}-\d{2}-\d{2}$/;
const 심볼꼴 = /^[A-Za-z0-9.\^=\-가-힣]{1,20}$/;
const 수 = (v: unknown, 아래: number, 위: number) =>
  typeof v === "number" && Number.isFinite(v) && v >= 아래 && v <= 위 ? v : null;

/** 저장한 전략의 run_settings 를 믿을 수 있는 모양으로. 이상하면 null — 그때는 조건만 되살린다 */
export function 돌린설정읽기(x: unknown): 돌린설정저장 | null {
  if (!x || typeof x !== "object") return null;
  const v = x as Record<string, unknown>;
  const kind: 돌린설정저장["kind"] | null = v.kind === "single" || v.kind === "universe" ? v.kind : null;
  const start_date = typeof v.start_date === "string" && 날짜꼴.test(v.start_date) ? v.start_date : null;
  const end_date = typeof v.end_date === "string" && 날짜꼴.test(v.end_date) ? v.end_date : null;
  const capital = 수(v.capital, 100_000, 100_000_000_000);
  const position_size = 수(v.position_size, 1, 100);
  const cost_rate = 수(v.cost_rate, 0, 5);
  if (!kind || !start_date || !end_date || start_date >= end_date || capital == null
      || position_size == null || cost_rate == null) return null;
  const 공통 = { kind, start_date, end_date, capital, position_size, cost_rate };
  if (kind === "single") {
    const symbol = typeof v.symbol === "string" && 심볼꼴.test(v.symbol) ? v.symbol : null;
    const market = v.market === "KR" || v.market === "US" || v.market === "ETF" ? v.market : null;
    if (!symbol || !market) return null;
    const name = typeof v.name === "string" && v.name.trim() ? v.name.slice(0, 60) : symbol;
    return { ...공통, symbol, market, name };
  }
  const universe = typeof v.universe === "string" && ["SP500", "KOSPI", "KOSDAQ", "ETF"].includes(v.universe)
    ? v.universe : null;
  const rank_by = typeof v.rank_by === "string"
    && ["total_return", "annual_return", "sharpe_ratio", "win_rate", "profit_factor", "mdd"].includes(v.rank_by)
    ? v.rank_by : "total_return";
  const top_n = 수(v.top_n, 1, 50) ?? 20;
  if (!universe) return null;
  return { ...공통, universe, rank_by, top_n };
}
