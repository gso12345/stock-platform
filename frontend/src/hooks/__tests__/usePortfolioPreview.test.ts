/**
 * 로그인 전 미리보기가 쓰는 계산들.
 *
 * 여기서 나오는 숫자는 '예시' 라는 딱지가 붙어 있지만 **값 자체는
 * 진짜다** — 예시인 것은 '어떤 종목을 몇 주 갖고 있나' 뿐이고, 시세와
 * 배당은 실제로 받아 온다. 그래서 계산이 틀리면 그냥 틀린 숫자다.
 */
import { describe, it, expect } from "vitest";
import { 회차주당, 걸리나, 내종목기사 } from "@/hooks/usePortfolioPreview";
import type { 종목배당 } from "@/api/stocks";

const 배당 = (덮: Partial<종목배당> = {}): 종목배당 => ({
  symbol: "XYZ", market: "US", cycle: "분기",
  months: [3, 6, 9, 12], per_month: 1, currency: "USD",
  last_date: "2025-12-20", last_amount: 0.35,
  per_year: 1.1, plan_year: 1.1,
  schedule: [
    { month: 3, day: 20, amount: 0.20, year: 2025 },
    { month: 6, day: 20, amount: 0.25, year: 2025 },
    { month: 9, day: 20, amount: 0.30, year: 2025 },
    { month: 12, day: 20, amount: 0.35, year: 2025 },
  ],
  ex_date: null, pay_date: null, estimated_date: null, recent: [],
  ...덮,
});

describe("회차주당 — 다음에 받을 주당 금액", () => {
  it("그 달에 실제로 준 금액을 쓴다", () => {
    /* 마지막 회차(0.35)를 쓰면 3월에 받을 돈이 75% 부풀어 보인다.
       분기배당은 결산배당이 붙는 분기가 특히 커서 회차마다 다르다 */
    expect(회차주당(배당(), "2026-03-20")).toBe(0.20);
    expect(회차주당(배당(), "2026-12-20")).toBe(0.35);
  });

  it("그 달이 일정에 없으면 마지막 회차로 떨어진다", () => {
    /* 공시된 기준일이 지난해 일정에 없는 달일 수 있다. 아무 값도 안
       주는 것보다 마지막 회차라도 주는 편이 낫다 */
    expect(회차주당(배당(), "2026-07-15")).toBe(0.35);
  });

  it("일정이 아예 없어도 안 터진다", () => {
    expect(회차주당(배당({ schedule: undefined }), "2026-03-20")).toBe(0.35);
  });

  it("마지막 회차도 없으면 0", () => {
    expect(회차주당(배당({ schedule: undefined, last_amount: 0 }), "2026-03-20")).toBe(0);
  });

  it("달을 두 자리로 읽는다 — '2026-03-20' 의 03 이 3월이다", () => {
    /* Number("03") 이 아니라 문자열로 비교하면 영영 안 맞는다 */
    expect(회차주당(배당(), "2026-09-20")).toBe(0.30);
  });
});

describe("걸리나 — 이 기사가 내 종목 얘기인가", () => {
  it("한글 이름은 그냥 들어 있으면 걸린다", () => {
    expect(걸리나("삼성전자", "삼성전자, 3분기 실적 발표")).toBe(true);
    expect(걸리나("삼성전자", "SK하이닉스 신고가")).toBe(false);
  });

  it("영문은 단어 경계로 본다", () => {
    /* 'V'(비자)를 포함으로 보면 거의 모든 기사에 걸리고,
       'GD' 는 'GDP' 에 걸린다 */
    expect(걸리나("GD", "GD wins defense contract")).toBe(true);
    expect(걸리나("GD", "US GDP grows 3%")).toBe(false);
  });
});

describe("내종목기사", () => {
  const 기사 = (title: string) => ({ title, link: `x${title}`, source: "", published: "", summary: "" });

  it("걸린 종목을 기사에 적어 준다", () => {
    /* 한 자리에 모아 놓으면 이게 없을 때 '왜 이 기사가 여기 있지' 가 된다 */
    const 결과 = 내종목기사(
      [기사("삼성전자 실적 발표"), 기사("무관한 소식")],
      [{ symbol: "005930", name: "삼성전자" }],
    );
    expect(결과).toHaveLength(1);
    expect(결과[0].symbols).toContain("005930");
  });

  it("한 기사가 두 종목에 걸리면 둘 다 적는다", () => {
    const 결과 = 내종목기사(
      [기사("삼성전자와 SK하이닉스, 나란히 상승")],
      [{ symbol: "005930", name: "삼성전자" },
       { symbol: "000660", name: "SK하이닉스" }],
    );
    expect(결과).toHaveLength(1);
    expect(결과[0].symbols.sort()).toEqual(["000660", "005930"]);
  });
});
