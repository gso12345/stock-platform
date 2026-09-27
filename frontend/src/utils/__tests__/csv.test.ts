/**
 * CSV — 쉼표·따옴표·줄바꿈이 든 칸이 **칸을 밀지 않는가**, 그리고
 * 자산배분·스크리닝 결과가 화면의 숫자를 그대로 옮기는가.
 */
import { describe, it, expect } from "vitest";
import { csv칸, csv글 } from "../csv";
import { 결과CSV } from "@/components/backtest/결과내보내기";
import { 스크리닝CSV } from "@/pages/Screening";

/** 아주 작은 CSV 읽개 — 감싼 칸을 제대로 푸는지 보려고 */
function 읽기(글: string): string[][] {
  const 줄들: string[][] = [];
  let 줄: string[] = [], 칸 = "", 안 = false;
  for (let i = 0; i < 글.length; i++) {
    const c = 글[i];
    if (안) {
      if (c === '"' && 글[i + 1] === '"') { 칸 += '"'; i++; }
      else if (c === '"') 안 = false;
      else 칸 += c;
    } else if (c === '"') 안 = true;
    else if (c === ",") { 줄.push(칸); 칸 = ""; }
    else if (c === "\r" && 글[i + 1] === "\n") { 줄.push(칸); 줄들.push(줄); 줄 = []; 칸 = ""; i++; }
    else 칸 += c;
  }
  줄.push(칸); 줄들.push(줄);
  return 줄들;
}

describe("csv칸", () => {
  it("쉼표·따옴표·줄바꿈이 있으면 감싸고, 읽으면 원래대로 돌아온다", () => {
    const 이상한것 = ['Apple Inc., Class A', 'say "hi"', "두\n줄", "평범"];
    expect(읽기(csv글([이상한것, [1, 2, 3, 4]]))).toEqual([이상한것, ["1", "2", "3", "4"]]);
  });
  it("값 없음과 NaN 은 빈칸이다 — 'null' 이나 'NaN' 글자를 넣지 않는다", () => {
    expect([null, undefined, NaN, Infinity].map(csv칸)).toEqual(["", "", "", ""]);
    expect(csv칸(0)).toBe("0");
  });
});

const 결과 = {
  start_date: "2020-01-02", end_date: "2021-12-31", currency: "KRW", contributed: 1000,
  final_value: 1500, total_return: 50, twr_annual: 22.5, irr_annual: 21, mdd: 12.3,
  volatility: 15, sharpe: 1.1, sortino: 1.5, dividends: null, costs: 3,
  assets: [{ symbol: "SPY", market: "US", name: "S&P, 500", weight: 0.6 },
           { symbol: "GLD", market: "US", name: "금", weight: 0.4 }],
  yearly: [{ year: 2020, return: 10 }, { year: 2021, return: 36.4 }],
  monthly: [{ month: "2020-01", return: 1.2 }],
  curve: [{ date: "2020-01-02", value: 1000 }, { date: "2021-12-31", value: 1500 }],
  benchmark: {
    name: "S&P 500", contributed: 1000, final_value: 1400, total_return: 40, mdd: 20,
    yearly: [{ year: 2021, return: 25 }],
    curve: [{ date: "2021-12-31", value: 1400 }],
  },
} as any;

describe("자산배분 결과 CSV", () => {
  const 줄들 = 읽기(csv글(결과CSV(결과)));
  const 찾기 = (첫칸: string) => 줄들.find((x) => x[0] === 첫칸);

  it("요약은 내 것과 벤치마크를 나란히, 낙폭은 음수로", () => {
    expect(찾기("최종 평가액")).toEqual(["최종 평가액", "1500", "1400"]);
    expect(찾기("최대 낙폭(%)")).toEqual(["최대 낙폭(%)", "-12.3", "-20"]);
  });
  it("비중은 퍼센트로, 쉼표 든 이름도 칸이 안 밀린다", () => {
    expect(찾기("S&P, 500")).toEqual(["S&P, 500", "US", "60"]);
    expect(찾기("금")).toEqual(["금", "US", "40"]);
  });
  it("해마다는 해로 짝짓는다 — 벤치마크가 없는 해는 빈칸", () => {
    expect(찾기("2020")).toEqual(["2020", "10", ""]);
    expect(찾기("2021")).toEqual(["2021", "36.4", "25"]);
  });
  it("곡선은 솎은 점이라고 제목에 적고, 끝 점은 최종 평가액이다", () => {
    expect(줄들.some((x) => x[0].includes("솎은 점"))).toBe(true);
    expect(찾기("2021-12-31")).toEqual(["2021-12-31", "1500", "1400"]);
  });
  it("벤치마크가 없으면 그 열을 안 만든다", () => {
    const 혼자 = 읽기(csv글(결과CSV({ ...결과, benchmark: null })));
    expect(혼자.find((x) => x[0] === "최종 평가액")).toEqual(["최종 평가액", "1500"]);
  });
});

describe("스크리닝 CSV", () => {
  it("쉼표 든 종목명이 뒤 칸을 밀지 않는다", () => {
    const 줄들 = 읽기(csv글(스크리닝CSV(
      [{ symbol: "BRK-B", name: "Berkshire Hathaway, Inc.", market: "US", per: 9.5 }],
      new Set(["per"] as any))));
    expect(줄들[0]).toEqual(["순위", "종목코드", "종목명", "시장", "PER"]);
    expect(줄들[1]).toEqual(["1", "BRK-B", "Berkshire Hathaway, Inc.", "US", "9.5"]);
  });
});
