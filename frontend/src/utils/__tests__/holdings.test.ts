/**
 * 오늘 하루 얼마나 움직였나 — 환율까지 세는가.
 *
 * 예전에는 종목 등락률만 봤다.
 *
 *     오늘변화 = 평가원화 - 평가원화 / (1 + 종목등락률/100)
 *
 * 그런데 해외 종목의 **원화** 평가금액은 주가와 환율 둘이 같이 정한다.
 * 미국장이 쉬는 날(추수감사절·독립기념일)에 원화가 1% 약해지면 내
 * 자산은 실제로 1% 늘어나는데, 화면은 '오늘 0원' 이라고 말했다.
 *
 * 더 나쁜 것은 같은 화면 안에서 두 숫자가 어긋난다는 점이다 —
 * 총 평가금액은 오늘 환율로 계산하므로 그 1%가 이미 들어 있다.
 * 즉 '평가금액은 늘었는데 오늘 손익은 0' 인 화면이 나온다.
 *
 * 여기서 못 박는 것 —
 *   1) 해외 종목에는 환율이 곱해진다
 *   2) 국내 종목에는 안 곱해진다(처음부터 원화다)
 *   3) 모르는 것은 0 이 아니라 null 이다 — 0 은 '안 움직였다' 는 뜻이다
 *   4) -100% 같은 값에 0 으로 나누지 않는다
 */
import { describe, it, expect } from "vitest";
import { 오늘변화원화, withNativeValues, 전일대비주당 } from "../holdings";

describe("오늘변화원화", () => {
  it("국내 종목은 주가 등락만 본다", () => {
    /* 1,010,000원이 오늘 +1% 로 온 것이면 어제는 1,000,000원이었다 */
    const v = 오늘변화원화(1_010_000, 1, 5, false);
    expect(v).not.toBeNull();
    expect(v!).toBeCloseTo(10_000, 4);
  });

  it("국내 종목에는 환율을 안 곱한다 — 곱하면 원화 자산이 환율 따라 움직인다", () => {
    const 환율큼 = 오늘변화원화(1_010_000, 1, 10, false);
    const 환율없음 = 오늘변화원화(1_010_000, 1, null, false);
    expect(환율큼).toBeCloseTo(환율없음!, 6);
  });

  it("해외 종목은 주가와 환율을 같이 곱한다", () => {
    /* 어제 1,000,000원 → 주가 +1%, 환율 +2% → 오늘 1,030,200원 */
    const 오늘 = 1_000_000 * 1.01 * 1.02;
    const v = 오늘변화원화(오늘, 1, 2, true);
    expect(v).not.toBeNull();
    expect(v!).toBeCloseTo(오늘 - 1_000_000, 4);
    // 주가만 봤을 때보다 반드시 크다 — 환율 몫이 통째로 빠져 있었다
    expect(v!).toBeGreaterThan(오늘변화원화(오늘, 1, null, true)!);
  });

  it("주가가 안 움직여도 환율이 움직이면 오늘 손익이 있다", () => {
    /* 미국장이 쉬는 날이 실제로 그렇다. 예전에는 여기서 0 이 나왔다 */
    const 오늘 = 1_000_000 * 1.02;
    const v = 오늘변화원화(오늘, 0, 2, true);
    expect(v).not.toBeNull();
    expect(v!).toBeCloseTo(오늘 - 1_000_000, 4);
    expect(v!).toBeGreaterThan(0);
  });

  it("주가를 몰라도 환율만으로 셀 수 있다", () => {
    /* 달러 현금처럼 시세가 없는 것도 원화 가치는 환율 따라 움직인다 */
    const v = 오늘변화원화(1_020_000, null, 2, true);
    expect(v).not.toBeNull();
    expect(v!).toBeCloseTo(20_000, 4);
  });

  it("둘 다 모르면 null 이다 — 0 은 '안 움직였다' 는 거짓말이 된다", () => {
    expect(오늘변화원화(1_000_000, null, null, true)).toBeNull();
    expect(오늘변화원화(1_000_000, null, null, false)).toBeNull();
    expect(오늘변화원화(1_000_000, undefined, 3, false)).toBeNull();
  });

  it("환율만 알고 국내 종목이면 null 이다 — 그 종목에는 환율이 안 먹는다", () => {
    expect(오늘변화원화(1_000_000, null, 2, false)).toBeNull();
  });

  it("-100% 에 0 으로 나누지 않는다", () => {
    /* 정상적인 시세는 아니지만 값이 깨진 채로 들어오면 화면에
       Infinity 가 찍힌다 — 돈이 걸린 화면이라 특히 나쁘다 */
    expect(오늘변화원화(1_000_000, -100, null, false)).toBeNull();
    expect(오늘변화원화(1_000_000, -150, null, false)).toBeNull();
  });

  it("한쪽만 깨졌으면 아는 쪽으로 센다", () => {
    /* 환율 응답 하나가 이상하게 왔다고 스무 종목의 오늘 손익이 통째로
       '모름' 이 되면, 정작 멀쩡한 주가 등락까지 화면에서 사라진다.
       깨진 쪽만 버리고 주가 몫은 그대로 남긴다. */
    const 오늘 = 1_000_000 * 1.03;
    const 환율깨짐 = 오늘변화원화(오늘, 3, -100, true);
    expect(환율깨짐).not.toBeNull();
    expect(환율깨짐!).toBeCloseTo(오늘 - 1_000_000, 4);
    // 주가가 깨졌으면 환율 몫만 남는다
    const 주가깨짐 = 오늘변화원화(1_020_000, -100, 2, true);
    expect(주가깨짐).not.toBeNull();
    expect(주가깨짐!).toBeCloseTo(20_000, 4);
  });

  it("NaN·Infinity 도 막는다", () => {
    expect(오늘변화원화(1_000_000, NaN, null, false)).toBeNull();
    expect(오늘변화원화(1_000_000, Infinity, null, false)).toBeNull();
  });

  it("평가금액이 0 이면 변화도 0 이다", () => {
    expect(오늘변화원화(0, 3, 2, true)).toBe(0);
  });

  it("내려간 날은 음수다", () => {
    const 오늘 = 1_000_000 * 0.97;
    const v = 오늘변화원화(오늘, -3, null, false);
    expect(v!).toBeCloseTo(오늘 - 1_000_000, 4);
    expect(v!).toBeLessThan(0);
  });
});

describe("withNativeValues", () => {
  const 기본 = {
    market: "US" as const, currency: "USD" as const, avgPrice: 100, shares: 10,
    costKRW: 1_300_000, currentPriceNative: 120, currentValueKRW: 1_680_000, pnlKRW: 380_000,
  };

  it("달러로 넣은 해외 종목은 평단가를 그대로 쓴다", () => {
    const r = withNativeValues(기본, 1400);
    expect(r.isForexItem).toBe(true);
    expect(r.nativeAvgPrice).toBe(100);
    expect(r.nativeValue).toBe(1200);          // 120 × 10
    expect(r.nativePnl).toBe(200);             // 1200 - 100×10
  });

  it("원화로 넣은 해외 종목은 매입금액을 환율로 되돌린다", () => {
    /* 그대로 달러로 취급하면 평단가가 1,300배가 된다 */
    const r = withNativeValues({ ...기본, currency: "KRW" as const, avgPrice: 130_000 }, 1300);
    expect(r.nativeAvgPrice).toBeCloseTo(100, 6);   // (1,300,000/10)/1300
    expect(r.nativeValue).toBe(1200);
  });

  it("국내 종목은 원화 값을 그대로 쓴다", () => {
    const r = withNativeValues(
      { ...기본, market: "KR" as const, currency: "KRW" as const, avgPrice: 50_000 }, 1400);
    expect(r.isForexItem).toBe(false);
    expect(r.nativeAvgPrice).toBe(50_000);
    expect(r.nativeValue).toBe(1_680_000);
    expect(r.nativePnl).toBe(380_000);
  });

  it("수량이 0 이면 0 으로 나누지 않는다", () => {
    const r = withNativeValues({ ...기본, currency: "KRW" as const, shares: 0 }, 1300);
    expect(Number.isFinite(r.nativeAvgPrice)).toBe(true);
    expect(r.nativeAvgPrice).toBe(0);
  });
});

describe("전일대비주당", () => {
  it("어제 종가를 역산한다", () => {
    /* 오늘 103원이 +3% 로 온 것이면 어제는 100원이었다 */
    const v = 전일대비주당(103, 3);
    expect(v).not.toBeNull();
    expect(v!).toBeCloseTo(3, 6);
  });

  it("내린 날은 음수다", () => {
    expect(전일대비주당(97, -3)!).toBeCloseTo(-3, 6);
  });

  it("등락률을 모르면 null 이다", () => {
    expect(전일대비주당(100, null)).toBeNull();
    expect(전일대비주당(100, undefined)).toBeNull();
  });

  it("-100% 에 0 으로 나누지 않는다", () => {
    /* 값이 깨진 채로 들어오면 화면에 Infinity 가 찍힌다.
       돈이 걸린 화면이라 특히 나쁘다 */
    expect(전일대비주당(100, -100)).toBeNull();
    expect(전일대비주당(100, -120)).toBeNull();
    expect(전일대비주당(100, NaN)).toBeNull();
    expect(전일대비주당(NaN, 3)).toBeNull();
  });
});
