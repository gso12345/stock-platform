/**
 * 벤치마크와 내 것을 **보기 좋게** 견주는가(사용자: "벤치마크랑 내 자산그래프랑 비교가 보기 좋게 해줘(점선보다 실선이 더
 * 나을 거 같아)").
 *
 *   ① 견줄 선은 실선 — 점선은 기준선(넣은 돈·초기자본)에만
 *   ② 색은 파랑(내 것)·주황(견줄 것) — 보라는 파랑과 색맹에게 같은 색이다(ΔE 1.3)
 *   ③ 범례에 선마다 끝 값, 툴팁에 차이
 *
 * 그래프 자체(recharts SVG)는 jsdom 에서 그려지지 않는다 — 부품(견줌툴팁·그래프범례)은 직접 그려 보고, 선의 모양은
 * 소스에서 본다(예전 '가로축·툴팁을 공통 값으로' 검사와 같은 방식).
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import { 견줌툴팁, 그래프범례 } from "../결과부품";
import { 견줌색, 툴팁상자 } from "@/utils/chartTheme";

const 뿌리 = path.resolve(__dirname, "../../..");
const 읽기 = (f: string) => fs.readFileSync(path.join(뿌리, f), "utf-8");
const 원 = (v: number) => `₩${Math.round(Math.abs(v)).toLocaleString("ko-KR")}`;

describe("견줌툴팁 — 날짜·두 선·차이", () => {
  const 줄들 = [
    { 키: "내것", 이름: "내 조합", 색: 견줌색.내것, 글: 원 },
    { 키: "벤치", 이름: "S&P500", 색: 견줌색.견줄것, 글: 원 },
    { 키: "넣은", 이름: "넣은 돈", 색: "var(--text-muted)", 점선: true, 글: 원 },
  ];
  const 차이 = { 가: "내것", 나: "벤치", 색: (v: number) => (v > 0 ? "오름" : v < 0 ? "내림" : "보합"),
                 글: (v: number) => `${v > 0 ? "+" : v < 0 ? "-" : ""}${원(v)}` };
  const 그리기 = (점: Record<string, unknown>, 더: Record<string, unknown> = {}) =>
    render(<견줌툴팁 active label="2024-03-15" payload={[{ payload: 점 }]} 줄들={줄들} 차이={차이}
                     날글={(d) => d.replace(/-/g, ".")} {...더} />);

  it("날짜와 선마다 값, 그리고 내 것 − 견줄 것", () => {
    const { container } = 그리기({ date: "2024-03-15", 내것: 12_000_000, 벤치: 10_500_000, 넣은: 9_000_000 });
    const 글 = container.textContent;
    expect(글).toContain("2024.03.15");
    expect(글).toContain("내 조합₩12,000,000");
    expect(글).toContain("S&P500₩10,500,000");
    expect(글).toContain("넣은 돈₩9,000,000");
    expect(screen.getByText("차이").nextSibling!.textContent).toBe("+₩1,500,000");
    expect((screen.getByText("차이").nextSibling as HTMLElement).className).toContain("오름");
  });

  it("뒤지면 빼기와 내림 색", () => {
    그리기({ 내것: 9_000_000, 벤치: 10_000_000 });
    const 값 = screen.getByText("차이").nextSibling as HTMLElement;
    expect(값.textContent).toBe("-₩1,000,000");
    expect(값.className).toContain("내림");
  });

  it("견줄 것이 없는 날은 그 줄도 차이도 없다(휴장일이 다르다)", () => {
    const { container } = 그리기({ 내것: 9_000_000, 넣은: 9_000_000 });
    expect(container.textContent).not.toContain("S&P500");
    expect(screen.queryByText("차이")).toBeNull();
  });

  it("숫자가 아닌 값(NaN·글자)은 없는 것으로", () => {
    const { container } = 그리기({ 내것: 9_000_000, 벤치: Number.NaN, 넣은: "9" });
    expect(container.textContent).not.toContain("S&P500");
    expect(container.textContent).not.toContain("넣은 돈");
    expect(screen.queryByText("차이")).toBeNull();
  });

  it("차이를 안 주면 차이 줄이 없다(견줄 것을 끈 때)", () => {
    render(<견줌툴팁 active label="2024-03-15" payload={[{ payload: { 내것: 1, 벤치: 2 } }]} 줄들={줄들} />);
    expect(screen.queryByText("차이")).toBeNull();
    expect(screen.getByText("2024-03-15")).toBeInTheDocument();     // 날글이 없으면 그대로
  });

  it("마우스가 그래프 밖이면 아무것도 안 그린다", () => {
    const { container } = render(<견줌툴팁 active={false} payload={[{ payload: { 내것: 1 } }]} 줄들={줄들} />);
    expect(container.innerHTML).toBe("");
    const 빈 = render(<견줌툴팁 active payload={[]} 줄들={줄들} />);
    expect(빈.container.innerHTML).toBe("");
  });

  it("색 줄은 선과 같은 모양 — 기준선만 점선", () => {
    const { container } = 그리기({ 내것: 1, 벤치: 2, 넣은: 3 });
    const 줄모양 = [...container.querySelectorAll<HTMLElement>("span[aria-hidden]")].map((x) => x.style.borderTopStyle);
    expect(줄모양).toEqual(["solid", "solid", "dashed"]);
  });

  it("상자는 공통 툴팁과 같은 값", () => {
    const { container } = 그리기({ 내것: 1 });
    const 상자 = container.firstElementChild as HTMLElement;
    expect(상자.style.borderRadius).toBe(`${툴팁상자.borderRadius}px`);
    expect(상자.style.fontSize).toBe(툴팁상자.fontSize);
  });
});

describe("그래프범례 — 선마다 끝 값", () => {
  it("값을 주면 이름 옆에, 안 주면 이름만", () => {
    const { container } = render(<그래프범례 끝="가장 깊었을 때 -20.00%"
      선들={[{ 이름: "내 조합", 색: 견줌색.내것, 값: "1.2억" }, { 이름: "S&P500", 색: 견줌색.견줄것, 값: null },
             { 이름: "넣은 돈", 색: "var(--text-muted)", 점선: true, 값: "7000만" }]} />);
    const 칸들 = [...container.firstElementChild!.children].map((x) => x.textContent);
    expect(칸들).toEqual(["가장 깊었을 때 -20.00%", "내 조합1.2억", "S&P500", "넣은 돈7000만"]);
  });
});

describe("선의 모양과 색 — 소스에서", () => {
  const 그래프들 = ["components/backtest/AllocationResult.tsx", "components/backtest/배분분석.tsx",
                   "components/backtest/단일결과화면.tsx"];

  it("견줄 선(벤치·들고)은 실선이다 — strokeDasharray 를 안 붙인다", () => {
    for (const f of 그래프들) {
      const 선들 = 읽기(f).match(/<R\.(?:Area|Line)[^>]*dataKey="(?:벤치|들고)"[\s\S]*?\/>/g) ?? [];
      expect(선들.length, `${f}: 견줄 선을 못 찾았다`).toBeGreaterThan(0);
      for (const 선 of 선들) {
        expect(선, `${f}: 견줄 선이 점선이다`).not.toMatch(/strokeDasharray/);
        expect(선, `${f}: 견줄 선이 공통 색(견줌색)을 안 쓴다`).toMatch(/견줌색\.견줄것/);
        expect(선, `${f}: 견줄 선이 내 것보다 가늘다`).toMatch(/strokeWidth=\{2\}/);
      }
    }
  });

  it("백테스트 그래프에 보라가 다시 들어오지 않는다(파랑과 색맹에게 같은 색)", () => {
    for (const f of 그래프들) expect(읽기(f), f).not.toMatch(/accent-purple/);
  });

  it("단일 종목 수익 곡선도 최고·최저가 누구의 것인지 적는다", () => {
    expect(읽기("components/backtest/단일결과화면.tsx")).toMatch(/내 전략 최고 \{눈금글\(곡선끝\.최고/);
  });

  it("넣은 돈은 기준선이라 점선으로 남는다", () => {
    const 선 = 읽기("components/backtest/AllocationResult.tsx").match(/<R\.Area[^>]*dataKey="넣은"[\s\S]*?\/>/)?.[0] ?? "";
    expect(선).toMatch(/strokeDasharray/);
  });

  it("견줄 것의 색은 차트 변수 — 다크·라이트 모두에 같은 주황", () => {
    expect(견줌색).toEqual({ 내것: "var(--accent-blue)", 견줄것: "var(--chart-bench)" });
    const css = 읽기("index.css");
    expect(css).toMatch(/--chart-bench:\s*#ea580c;/);
    //: 라이트에서 덮지 않는다(같은 값이 두 바탕 모두에서 색 검사를 통과했다)
    const 라이트 = css.slice(css.indexOf("html.light {"), css.indexOf("}", css.indexOf("html.light {")));
    expect(라이트).not.toMatch(/--chart-bench/);
  });

  it("낙폭 그래프의 내 것도 파랑 — 내림 색(초록-빨강이면 빨강)은 견줄 주황과 거의 같다", () => {
    const 글 = 읽기("components/backtest/AllocationResult.tsx");
    const 시작 = 글.indexOf("export function 낙폭칸");
    const 낙폭 = 글.slice(시작, 글.indexOf("깊었던 순서", 시작));
    expect(낙폭.length, "낙폭칸을 못 찾았다").toBeGreaterThan(100);
    expect(낙폭).toMatch(/<R\.Area[^>]*dataKey="내것"[^>]*stroke=\{견줌색\.내것\}/);
    //: 면의 그라데이션 두 끝 모두 — 한쪽만 내림 색이면 면이 빨강으로 번진다
    expect(낙폭.match(/stopColor=\{([^}]+)\}/g)).toEqual(["stopColor={견줌색.내것}", "stopColor={견줌색.내것}"]);
  });
});


/* ═══════════════ 그 밖의 디자인 — 낙폭 목록 · 폭락 표 · 아래 안내 · 접힌 요약 ═══════════════ */

import { vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { within } from "@testing-library/react";
import { 짧은날 } from "../결과부품";
import { 배분요약 } from "../AllocationTab";
import { 첫설정 } from "../AllocationForm";

vi.mock("@/store/settingsStore", async (원래) => {
  const m = await (원래() as Promise<any>);
  return { ...m, useSettingsStore: (고르기: any) => 고르기({ colorScheme: "red-blue" }) };
});

const 결과화면 = (await import("../AllocationResult")).default;

const 바탕 = {
  start_date: "2016-11-07", end_date: "2026-11-05", years: 10,
  contributed: 70_000_000, final_value: 117_000_000, profit: 47_000_000,
  total_return: 67.1, twr_annual: 9.19, irr_annual: 8.87, mdd: 14.35, mdd_date: "2020-03-23",
  volatility: 11, sharpe: 0.7, sortino: 1, dividends: null, costs: 0, costs_included: false, cost_rate: null,
  cash_rate: 0, cash_interest: 0, risk_free_rate: 0, positive_months: 80, total_months: 120,
  yearly: [], monthly: [],
  curve: [{ date: "2016-11-07", value: 10_000_000 }, { date: "2026-11-05", value: 117_000_000 }],
  drawdown: [{ date: "2016-11-07", dd: 0 }, { date: "2020-03-23", dd: -14.35 }, { date: "2026-11-05", dd: -2 }],
  drawdowns: [
    { start: "2020-02-19", trough: "2020-03-23", end: "2020-08-10", depth: -14.35, underwater_days: 173 },
    { start: "2026-07-29", trough: "2026-10-14", end: null, depth: -9.5, underwater_days: 99 },
  ],
  crises: [{ key: "covid", name: "코로나", start: "2020-02-19", end: "2020-03-23", mdd: -12.7,
             measured_start: "2020-02-19", measured_end: "2020-03-23", partial: false }],
  currency: "KRW" as const,
  assets: [{ symbol: "SPY", market: "US", name: "S&P 500", weight: 1 }],
  skipped: [], fx_skipped: [], mixed_currency: false, benchmark: null as any, extended_from: {},
  requested_start: "2016-11-05", requested_end: "2026-11-05",
  asset_range: { SPY: { first: "2016-11-07", last: "2026-11-05" } },
};
const 그리기2 = (더: Record<string, unknown> = {}) => render(<결과화면 r={{ ...바탕, ...더 } as never} />);

describe("짧은날", () => {
  it.each([["2024-07-29", "24.07.29"], ["1999-12-31", "99.12.31"], ["2024-07", "2024-07"], ["", ""]])("%s → %s", (가, 나) => {
    expect(짧은날(가)).toBe(나);
  });
});

describe("깊었던 순서 — 두 줄 목록(폰에서 다 보이게)", () => {
  it("위: 낙폭·잠긴 기간, 아래: 고점 → 바닥 → 회복(짧은 날짜)", async () => {
    그리기2();
    await userEvent.click(screen.getByRole("tab", { name: "낙폭" }));
    const 목록 = screen.getByRole("list", { name: "깊었던 순서" });
    const 줄들 = within(목록).getAllByRole("listitem");
    expect(줄들).toHaveLength(2);
    expect(줄들[0].textContent).toBe("-14.35%6개월 잠김고점 20.02.19→바닥 20.03.23→회복 20.08.10");
    expect(줄들[1].textContent).toBe("-9.50%3개월 + 잠김고점 26.07.29→바닥 26.10.14→회복 아직");
    //: 표가 아니다 — 옆으로 밀 칸이 없다
    expect(screen.queryByRole("columnheader", { name: "회복" })).toBeNull();
  });
});

describe("폭락 표 — 세 칸, 이름 아래 기간", () => {
  it("소수 둘째 자리 · 짧은 날짜", async () => {
    그리기2();
    await userEvent.click(screen.getByRole("tab", { name: "낙폭" }));
    const 줄 = screen.getByText("코로나").closest("tr")!;
    expect([...줄.querySelectorAll("td")].map((x) => x.textContent)).toEqual(["코로나20.02.19 ~ 20.03.23", "-12.70%", "—"]);
  });
});

describe("결과 아래 안내 — 경고는 노란 상자, 참고는 흐린 상자", () => {
  it("짧아진 것·지수로 이은 것이 없으면 경고 상자가 없다(주말 시작은 짧아진 것이 아니다)", () => {
    그리기2();
    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.getByText(/수수료·세금·슬리피지는 반영하지 않았어요/)).toBeInTheDocument();
  });

  it("뒤가 잘렸으면 경고 상자 안에 — 이름은 굵게", () => {
    그리기2({ end_date: "2026-10-22", asset_range: { SPY: { first: "2016-11-07", last: "2026-10-22" } } });
    const 상자 = screen.getByRole("note");
    expect(상자.textContent).toMatch(/S&P 500의 시세가 2026-10-22까지라 그 뒤는 못 쟀어요/);
    expect(within(상자).getByText("S&P 500").tagName).toBe("B");
    expect(상자.className).toMatch(/accent-yellow/);
  });

  it("지수로 이은 것도 같은 경고 상자에", () => {
    그리기2({ extended_from: { SPY: "1993-01-29" } });
    expect(screen.getByRole("note").textContent).toMatch(/SPY는 1993-01-29부터 지수로 이었어요/);
  });

  it("거래비용을 넣었으면 그 안내가 흐린 상자에 — 경고 상자가 아니다", () => {
    그리기2({ costs_included: true, costs: 123_456, cost_rate: 0.001 });
    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.getByText(/모두 ₩123,456를 수수료로 냈어요/)).toBeInTheDocument();
  });
});

describe("접힌 설정 요약 — 적립까지, 날짜는 짧게", () => {
  it("매월 적립을 적는다", () => {
    const s = { ...첫설정(), start_date: "2016-11-05", end_date: "2026-11-05", initial_amount: "10000000",
                contribution_period: "monthly" as const, contribution_amount: "500000", rebalance_period: "yearly" as const,
                assets: [{ symbol: "SPY", market: "US", name: "S&P 500", weight: 60 }, { symbol: "TLT", market: "US", name: "미국 장기국채", weight: 40 }] };
    const [첫, 둘] = 배분요약(s as never);
    expect(첫).toBe("S&P 500 60% · 미국 장기국채 40%");
    expect(둘).toBe("16.11.05 ~ 26.11.05 · 1000만원 · 매월 50만원 · 리밸런싱 매년");
  });

  it("적립이 없거나 0원이면 안 적는다", () => {
    const s = { ...첫설정(), start_date: "2016-11-05", end_date: "2026-11-05", initial_amount: "10000000",
                contribution_period: "monthly" as const, contribution_amount: "0", rebalance_period: "none" as const,
                assets: [{ symbol: "SPY", market: "US", name: "S&P 500", weight: 100 }] };
    expect(배분요약(s as never)[1]).toBe("16.11.05 ~ 26.11.05 · 1000만원");
    expect(배분요약({ ...s, contribution_period: "none", contribution_amount: "500000" } as never)[1]).toBe("16.11.05 ~ 26.11.05 · 1000만원");
  });
});
