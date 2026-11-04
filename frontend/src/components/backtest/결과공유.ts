/**
 * 백테스트 결과 공유 — 설정을 주소에 실어 보내고, 받은 쪽은 같은 백테스트를 연다(사용자가 고른 13번).
 *
 * 결과(수십 KB 의 곡선)가 아니라 **설정**만 싣는다. 받은 쪽이 그 설정으로 다시 돌린다 — 주소가 짧고, 받은
 * 사람이 기간·금액을 바꿔 이어서 볼 수 있다. 서버에 저장하지 않으므로 로그인도 필요 없다.
 *
 * 받은 주소는 **남이 만든 글자**다. 그대로 화면 상태에 넣지 않는다 — 칸마다 모양·범위를 보고, 하나라도 어긋나면
 * 통째로 버린다(반쯤 맞는 설정으로 돌리면 보낸 사람과 다른 결과를 '같은 백테스트' 라고 보여 주게 된다).
 */
import type { 배분자산, 주기, 벤치마크키 } from "@/api/stocks";
import type { Condition, ConditionGroup, Market } from "@/types";
import type { 설정 } from "./AllocationForm";

/** 단일 종목 탭의 설정 */
export interface 단일설정 {
  symbol: string; market: Market; name: string;
  start_date: string; end_date: string;
  capital: number;
  stop_loss: number | ""; take_profit: number | "";
  position_size: number; cost_rate: number;
  entry: ConditionGroup; exit: ConditionGroup;
}

/** 유니버스 탭의 설정 */
export interface 유니버스설정 {
  universe: string; rank_by: string; top_n: number;
  start_date: string; end_date: string;
  capital: number;
  stop_loss: number | ""; take_profit: number | "";
  position_size: number; cost_rate: number;
  entry: ConditionGroup; exit: ConditionGroup;
}

export type 공유할것 =
  | { 탭: "alloc"; 설정: 설정 }
  | { 탭: "single"; 설정: 단일설정 }
  | { 탭: "universe"; 설정: 유니버스설정 };

/** 주소에 쓰는 이름 — /backtest?bt=… */
export const 공유열쇠 = "bt";

/* ── 글자 ↔ 주소 ── 한글 이름이 들어가므로 UTF-8 로 바꾼 뒤 base64url(주소에 그대로 들어가는 글자만) */
function 감싸기(글: string): string {
  const 바이트 = new TextEncoder().encode(글);
  let 이진 = "";
  for (const b of 바이트) 이진 += String.fromCharCode(b);
  return btoa(이진).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function 풀기(글: string): string {
  const b64 = 글.replace(/-/g, "+").replace(/_/g, "/");
  const 이진 = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(이진, (c) => c.charCodeAt(0)));
}

export function 공유주소(것: 공유할것, 바탕 = window.location.origin): string {
  return `${바탕}/backtest?${공유열쇠}=${감싸기(JSON.stringify(것))}`;
}

/* ── 받은 것 검사 ── */
const 날짜꼴 = /^\d{4}-\d{2}-\d{2}$/;
/** 서버의 심볼 모양과 같다(backtest.py 심볼모양) */
const 심볼꼴 = /^[A-Za-z0-9.^=\-가-힣]{1,20}$/;
const 주기들: 주기[] = ["none", "monthly", "quarterly", "yearly"];
const 벤치마크들: 벤치마크키[] = ["none", "spy", "qqq", "kospi_index", "kospi", "6040", "allweather"];
const 시장들: Market[] = ["KR", "US", "ETF"];
export const 유니버스들 = ["SP500", "KOSPI", "KOSDAQ", "ETF"];
export const 순위기준들 = ["total_return", "annual_return", "sharpe_ratio", "win_rate", "profit_factor", "mdd"];
/** 조건 만들기(ConditionBuilder)가 고를 수 있는 지표·비교 — 그 밖의 것은 받지 않는다 */
const 지표들 = new Set(["MA", "EMA", "MACD", "MACD_SIGNAL", "MACD_HIST", "RSI", "STOCH_K", "STOCH_D", "CCI", "WILLR",
  "ROC_1", "ROC_5", "ROC_20", "BB_UPPER", "BB_LOWER", "BB_MID", "BB_PCT", "ATR", "ATR_PCT", "VOLUME", "VOL_MA",
  "VOL_RATIO", "OBV", "OBV_MA", "PRICE", "OPEN", "HIGH", "LOW", "PCT_FROM_HIGH", "PCT_FROM_LOW"]);
const 비교들 = new Set([">", "<", ">=", "<=", "==", "crosses_above", "crosses_below"]);

class 틀림 extends Error {}
const 확인 = (맞나: unknown): void => { if (!맞나) throw new 틀림(); };
const 수 = (v: unknown, 아래: number, 위: number): number => {
  확인(typeof v === "number" && Number.isFinite(v) && v >= 아래 && v <= 위);
  return v as number;
};
const 참거짓 = (v: unknown): boolean => { 확인(typeof v === "boolean"); return v as boolean; };
const 글 = (v: unknown, 최대: number): string => { 확인(typeof v === "string" && v.length <= 최대); return v as string; };
const 하나 = <T,>(v: unknown, 것들: readonly T[]): T => { 확인(것들.includes(v as T)); return v as T; };
const 날짜 = (v: unknown): string => {
  확인(typeof v === "string" && 날짜꼴.test(v) && !Number.isNaN(new Date(v).getTime()));
  return v as string;
};
const 빈수 = (v: unknown, 아래: number, 위: number): number | "" => (v === "" || v == null ? "" : 수(v, 아래, 위));

function 조건묶음(v: unknown): ConditionGroup {
  확인(v && typeof v === "object");
  const g = v as Record<string, unknown>;
  const logic = 하나(g.logic, ["AND", "OR"] as const);
  확인(Array.isArray(g.conditions) && (g.conditions as unknown[]).length <= 10);
  const conditions = (g.conditions as unknown[]).map((c): Condition => {
    확인(c && typeof c === "object");
    const x = c as Record<string, unknown>;
    확인(지표들.has(x.indicator as string) && 비교들.has(x.operator as string));
    // 값은 숫자이거나(RSI > 70) 다른 지표 이름이다(MA ↑ EMA)
    let value: number | string;
    if (typeof x.value === "string") { 확인(지표들.has(x.value)); value = x.value; }
    else value = 수(x.value, -1e9, 1e9);
    const 결과: Condition = { indicator: x.indicator as Condition["indicator"],
                              operator: x.operator as Condition["operator"], value };
    if (x.period != null) 결과.period = 수(x.period, 1, 400);
    return 결과;
  });
  return { logic, conditions };
}

function 매매칸(x: Record<string, unknown>) {
  const start_date = 날짜(x.start_date), end_date = 날짜(x.end_date);
  확인(start_date < end_date);
  return {
    start_date, end_date,
    capital: 수(x.capital, 100_000, 100_000_000_000),
    stop_loss: 빈수(x.stop_loss, 0.1, 99),
    take_profit: 빈수(x.take_profit, 0.1, 999),
    position_size: 수(x.position_size, 1, 100),
    cost_rate: 수(x.cost_rate, 0, 5),
    entry: 조건묶음(x.entry), exit: 조건묶음(x.exit),
  };
}

function 배분설정(x: Record<string, unknown>): 설정 {
  확인(Array.isArray(x.assets) && (x.assets as unknown[]).length >= 1 && (x.assets as unknown[]).length <= 20);
  const assets = (x.assets as unknown[]).map((a): 배분자산 => {
    확인(a && typeof a === "object");
    const y = a as Record<string, unknown>;
    const symbol = 글(y.symbol, 20);
    확인(심볼꼴.test(symbol));
    return { symbol, market: 하나(y.market, 시장들), name: 글(y.name ?? symbol, 60), weight: 수(y.weight, 0, 100) };
  });
  const start_date = 날짜(x.start_date), end_date = 날짜(x.end_date);
  확인(start_date < end_date);
  const 금액 = (v: unknown) => (v === "" || v == null ? "" : 수(v, 0, 1e13)) as number | "";
  return {
    years: 0, start_date, end_date,
    currency: 하나(x.currency, ["KRW", "USD"] as const),
    initial_amount: 금액(x.initial_amount),
    assets,
    contribution_period: 하나(x.contribution_period, 주기들),
    contribution_amount: 금액(x.contribution_amount),
    rebalance_period: 하나(x.rebalance_period, 주기들),
    total_return: 참거짓(x.total_return),
    rebalance_day: 수(x.rebalance_day, 1, 28),
    cost_rate: 수(x.cost_rate, 0, 5),
    benchmark: 하나(x.benchmark, 벤치마크들),
    equal_weight: 참거짓(x.equal_weight),
    extended: 참거짓(x.extended),
    cash_rate: 수(x.cash_rate, 0, 20),
    risk_free_rate: 수(x.risk_free_rate, 0, 20),
  };
}

/** 주소의 bt 값을 읽는다. 모양이 하나라도 어긋나면 null — 반쯤 맞는 설정은 쓰지 않는다. */
export function 공유읽기(값: string | null | undefined): 공유할것 | null {
  if (!값 || 값.length > 20_000) return null;
  try {
    const 것 = JSON.parse(풀기(값)) as Record<string, unknown>;
    확인(것 && typeof 것 === "object" && 것.설정 && typeof 것.설정 === "object");
    const x = 것.설정 as Record<string, unknown>;
    if (것.탭 === "alloc") return { 탭: "alloc", 설정: 배분설정(x) };
    if (것.탭 === "single") {
      const symbol = 글(x.symbol, 20);
      확인(심볼꼴.test(symbol));
      return { 탭: "single", 설정: { symbol, market: 하나(x.market, 시장들), name: 글(x.name ?? symbol, 60), ...매매칸(x) } };
    }
    if (것.탭 === "universe") {
      return { 탭: "universe", 설정: {
        universe: 하나(x.universe, 유니버스들), rank_by: 하나(x.rank_by, 순위기준들), top_n: 수(x.top_n, 1, 50),
        ...매매칸(x) } };
    }
    return null;
  } catch {
    return null;
  }
}
