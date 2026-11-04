/**
 * 백테스트 결과 공유 — 설정을 주소에 실어 보내고, 받은 쪽은 **검사한 뒤에만** 쓴다(사용자가 고른 13번).
 */
import { describe, it, expect } from "vitest";
import { 공유주소, 공유읽기, 공유열쇠, type 공유할것 } from "../결과공유";
import { 첫설정, type 설정 } from "../AllocationForm";

const 배분설정: 설정 = {
  ...첫설정(new Date(2026, 10, 4)),
  initial_amount: 10_000_000,
  assets: [{ symbol: "SPY", market: "US", name: "S&P 500", weight: 60 },
           { symbol: "148070.KS", market: "KR", name: "KOSEF 국고채10년", weight: 40 }],
  rebalance_period: "yearly", cost_rate: 0.1, benchmark: "6040",
};
const 배분: 공유할것 = { 탭: "alloc", 설정: 배분설정 };
const 조건 = { logic: "AND" as const, conditions: [{ indicator: "RSI" as const, operator: "<" as const, value: 30, period: 14 }] };
const 단일: 공유할것 = {
  탭: "single",
  설정: { symbol: "005930", market: "KR", name: "삼성전자", start_date: "2021-11-04", end_date: "2026-11-04",
          capital: 10_000_000, stop_loss: 5, take_profit: "", position_size: 95, cost_rate: 0.015,
          entry: 조건, exit: { logic: "OR", conditions: [{ indicator: "MA", operator: "crosses_below", value: "EMA", period: 20 }] } },
};
const 유니버스: 공유할것 = {
  탭: "universe",
  설정: { universe: "KOSPI", rank_by: "sharpe_ratio", top_n: 20, start_date: "2021-11-04", end_date: "2026-11-04",
          capital: 10_000_000, stop_loss: "", take_profit: "", position_size: 95, cost_rate: 0,
          entry: 조건, exit: 조건 },
};

/** 주소에서 bt 값만 */
const 값 = (주소: string) => new URL(주소).searchParams.get(공유열쇠)!;
/** 아무 것이나 감싸 bt 값으로 — 남이 손으로 만든 주소 흉내 */
const 감싼값 = (x: unknown) => 값(공유주소(x as 공유할것, "https://x.test"));

describe("공유 주소", () => {
  it.each([["자산배분", 배분], ["단일 종목", 단일], ["유니버스", 유니버스]])("%s — 보낸 설정이 그대로 돌아온다", (_n, 것) => {
    const 주소 = 공유주소(것, "https://stock.example");
    expect(주소.startsWith("https://stock.example/backtest?bt=")).toBe(true);
    const 받은것 = 공유읽기(값(주소));
    // 자산배분의 years 는 칩 표시용이라 0 으로 온다(날짜를 그대로 쓴다)
    expect(받은것).toEqual(것.탭 === "alloc" ? { 탭: "alloc", 설정: { ...배분설정, years: 0 } } : 것);
  });

  it("주소에 그대로 들어가는 글자만 쓴다 — 한글 이름이 있어도", () => {
    expect(값(공유주소(배분, "https://x.test"))).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("받은 주소는 검사하고 쓴다", () => {
  const 바꾼 = (것: 공유할것, 바꿀: Record<string, unknown>) => ({ 탭: 것.탭, 설정: { ...것.설정, ...바꿀 } });

  it.each([
    ["빈 값", ""],
    ["깨진 글자", "%%%"],
    ["JSON 이 아님", 감싼값("그냥 글")],
  ])("%s → 버린다", (_n, v) => {
    expect(공유읽기(v as string)).toBeNull();
  });

  it.each([
    ["모르는 탭", { 탭: "strategies", 설정: 단일.설정 }],
    ["시작이 끝보다 늦음", 바꾼(단일, { start_date: "2026-11-05" })],
    ["날짜 모양이 아님", 바꾼(단일, { start_date: "2021/11/04" })],
    ["없는 날짜", 바꾼(단일, { end_date: "2026-13-45" })],
    ["모르는 지표", 바꾼(단일, { entry: { logic: "AND", conditions: [{ indicator: "EVAL", operator: ">", value: 1 }] } })],
    ["값에 모르는 지표 이름", 바꾼(단일, { entry: { logic: "AND", conditions: [{ indicator: "MA", operator: ">", value: "alert(1)" }] } })],
    ["모르는 비교", 바꾼(단일, { exit: { logic: "OR", conditions: [{ indicator: "RSI", operator: "!=", value: 1 }] } })],
    ["모르는 논리", 바꾼(단일, { exit: { logic: "XOR", conditions: [] } })],
    ["조건이 너무 많음", 바꾼(단일, { entry: { logic: "AND", conditions: Array(11).fill(조건.conditions[0]) } })],
    ["심볼에 이상한 글자", 바꾼(단일, { symbol: "../etc" })],
    ["모르는 시장", 바꾼(단일, { market: "JP" })],
    ["자본이 서버 하한보다 작음", 바꾼(단일, { capital: 1000 })],
    ["손절이 범위 밖", 바꾼(단일, { stop_loss: 150 })],
    ["투자비중이 범위 밖", 바꾼(단일, { position_size: 0 })],
    ["거래비용이 범위 밖", 바꾼(단일, { cost_rate: 9 })],
    ["모르는 유니버스", 바꾼(유니버스, { universe: "NIKKEI" })],
    ["모르는 순위 기준", 바꾼(유니버스, { rank_by: "random" })],
    ["상위 N 이 너무 큼", 바꾼(유니버스, { top_n: 500 })],
    ["자산이 없음", 바꾼(배분, { assets: [] })],
    ["자산이 스물 넘음", 바꾼(배분, { assets: Array(21).fill(배분설정.assets[0]) })],
    ["비중이 범위 밖", 바꾼(배분, { assets: [{ symbol: "SPY", market: "US", name: "S&P", weight: 300 }] })],
    ["자산 심볼에 이상한 글자", 바꾼(배분, { assets: [{ symbol: "../etc", market: "US", name: "S&P", weight: 100 }] })],
    ["모르는 벤치마크", 바꾼(배분, { benchmark: "nikkei" })],
    ["모르는 주기", 바꾼(배분, { rebalance_period: "daily" })],
    ["리밸런싱 날짜가 범위 밖", 바꾼(배분, { rebalance_day: 31 })],
    ["통화가 이상함", 바꾼(배분, { currency: "JPY" })],
    ["참거짓 칸에 글자", 바꾼(배분, { total_return: "yes" })],
  ])("%s → 통째로 버린다", (_n, 것) => {
    expect(공유읽기(감싼값(것))).toBeNull();
  });

  it("너무 긴 값은 풀어 보지도 않는다 — 모양이 맞아도", () => {
    /* JSON 은 빈칸을 얼마든지 붙여도 뜻이 같다. 길이를 안 보면 맞는 설정 뒤에 빈칸 수만 개를 붙인 주소가 그대로
       풀린다 — 풀기 전에 막는다 */
    const 긴글 = JSON.stringify(단일) + " ".repeat(20_000);
    const 감싼 = btoa(String.fromCharCode(...new TextEncoder().encode(긴글)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(감싼.length).toBeGreaterThan(20_000);
    expect(공유읽기(감싼)).toBeNull();
    // 같은 설정을 짧게 실으면 읽힌다 — 길이 말고 다른 이유로 막힌 것이 아니다
    expect(공유읽기(감싼값(단일))?.탭).toBe("single");
  });

  it("값 자리의 지표 이름(MA ↑ EMA)은 받는다", () => {
    expect(공유읽기(감싼값(단일))?.탭).toBe("single");
  });
});
