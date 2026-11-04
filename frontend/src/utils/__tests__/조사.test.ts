/**
 * 이름 뒤 '과/와' — 'S&P500 와 견주기' 처럼 박아 둔 조사가 절반은 틀렸다(사용자가 고른 9번).
 */
import { describe, it, expect } from "vitest";
import { 받침있나, 과와 } from "@/utils/조사";
import { 벤치마크표 } from "@/components/backtest/AllocationForm";

describe("과와", () => {
  it.each([
    ["S&P500", "S&P500과"],        // 오백
    ["나스닥100", "나스닥100과"],  // 백
    ["코스피", "코스피와"],
    ["코스피200", "코스피200과"],
    ["주식 60 · 채권 40", "주식 60 · 채권 40과"],
    ["올웨더", "올웨더와"],
    ["금", "금과"],
    ["QQQ", "QQQ와"],              // 큐
    ["SPY", "SPY와"],              // 와이
    ["KOSDAQ150", "KOSDAQ150과"],  // 오십
    ["S&P 500 (미국)", "S&P 500 (미국)과"],
  ])("%s → %s", (이름, 기대) => {
    expect(과와(이름)).toBe(기대);
  });

  it("숫자는 읽는 소리로 — 영·일·삼·육·칠·팔은 받침이 있다", () => {
    expect([..."0123456789"].map((d) => 받침있나(`지수${d}`)))
      .toEqual([true, true, false, true, false, false, true, true, true, false]);
  });

  it("영문 약자는 L·M·N·R 만 받침이 있다", () => {
    expect(["IBM", "ARM", "XLN", "BTR", "ETF", "SPY"].map(받침있나)).toEqual([true, true, true, true, false, false]);
  });

  it("빈 말·기호만 있는 말도 안전하다", () => {
    expect(과와("")).toBe("와");
    expect(받침있나("()·")).toBe(false);
  });

  it("벤치마크 이름 모두에 맞는 조사가 붙는다 — 띄어 쓰지 않고", () => {
    for (const { label } of 벤치마크표.filter((b) => b.value !== "none")) {
      expect(과와(label)).toMatch(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\&]/g, "\\$&")}(과|와)$`));
    }
  });
});
