/** 청약 일정 챙기기 — 청약 배지와 청약일 순서. '오늘' 은 2026-10-14(한국 날짜) */
import { describe, it, expect } from "vitest";
import type { 다가오는공모주 } from "@/api/stocks";
import { 청약표, 청약일순 } from "../ipoSchedule";

const 오늘 = new Date("2026-10-14T03:00:00Z");      // 한국 시각 10월 14일 낮 12시

function 공모주(name: string, 덮: Partial<다가오는공모주>): 다가오는공모주 {
  return {
    name, code: null, market: null, kind: "normal", forecast_date: null, band_low: null, band_high: null,
    offer_price: null, offer_amount: null, inst_ratio: null, lockup_pct: null, sub_start: null, sub_end: null,
    sub_ratio: null, list_date: null, underwriter: null, stage: "청약 예정",
    prediction: { ok: false, reason: "" }, ...덮,
  } as 다가오는공모주;
}

describe("청약표", () => {
  it("청약 중이면 오늘·내일 마감, 사흘 청약이면 며칠 뒤 마감", () => {
    expect(청약표(공모주("가", { sub_start: "2026-10-13", sub_end: "2026-10-14" }), 오늘))
      .toEqual({ 글: "청약 오늘 마감", 급함: true });
    expect(청약표(공모주("가", { sub_start: "2026-10-14", sub_end: "2026-10-15" }), 오늘))
      .toEqual({ 글: "청약 내일 마감", 급함: true });
    expect(청약표(공모주("가", { sub_start: "2026-10-14", sub_end: "2026-10-16" }), 오늘))
      .toEqual({ 글: "청약 중 · 2일 뒤 마감", 급함: true });
  });

  it("청약을 앞두고 있으면 며칠 남았는지", () => {
    expect(청약표(공모주("가", { sub_start: "2026-10-16", sub_end: "2026-10-17" }), 오늘))
      .toEqual({ 글: "청약 D-2", 급함: false });
  });

  it("청약이 끝났거나(경쟁률이 나왔거나 날이 지났거나) 날짜가 없으면 없다", () => {
    expect(청약표(공모주("가", { sub_start: "2026-10-13", sub_end: "2026-10-14", sub_ratio: 1500 }), 오늘)).toBeNull();
    expect(청약표(공모주("가", { sub_start: "2026-10-10", sub_end: "2026-10-11" }), 오늘)).toBeNull();
    expect(청약표(공모주("가", {}), 오늘)).toBeNull();
  });
});

describe("청약일순", () => {
  // 사용자: "청약일정 나오는 순서는 청약일이 빠른 순서로 배열해줘"
  it("청약일(시작)이 빠른 것부터 — 이미 끝난 청약도 그 날짜대로", () => {
    const 목록 = [
      공모주("상장대기", { sub_start: "2026-10-13", sub_end: "2026-10-14", sub_ratio: 1500, list_date: "2026-10-22" }),
      공모주("청약앞둠", { sub_start: "2026-10-16", sub_end: "2026-10-17" }),
      공모주("내일마감", { sub_start: "2026-10-14", sub_end: "2026-10-15" }),
      공모주("지난달", { sub_start: "2026-09-29", sub_end: "2026-09-30", sub_ratio: 800, list_date: "2026-10-08" }),
    ];
    expect(청약일순(목록).map((g) => g.name)).toEqual(["지난달", "상장대기", "내일마감", "청약앞둠"]);
  });

  it("청약일이 아직 없으면 뒤로, 그 안에서는 수요예측일 순, 같은 날이면 원래 차례", () => {
    const 목록 = [
      공모주("일정없음", {}),
      공모주("수요예측늦음", { forecast_date: "2026-10-28" }),
      공모주("청약", { sub_start: "2026-10-20", sub_end: "2026-10-21" }),
      공모주("수요예측이름", { forecast_date: "2026-10-20" }),
      공모주("청약2", { sub_start: "2026-10-20", sub_end: "2026-10-21" }),
    ];
    expect(청약일순(목록).map((g) => g.name)).toEqual(["청약", "청약2", "수요예측이름", "수요예측늦음", "일정없음"]);
  });
});
