/**
 * 자산배분 — 더 깊이 보는 카드들(사용자: "백테스팅 자산배분 더 상세하게 분석해주고 디자인도 다른메뉴를 기준으로
 * 통일시켜줘 / 디자인 앱느낌 나도록 업그레이드 해줘").
 *
 *   성과        최종 평가액 바로 아래 넣은 돈 · 큰 숫자 셋 · 작은 숫자 줄(단일 종목 결과와 같은 모양)
 *   자산마다    누가 얼마를 벌었나 — 다 더하고 수수료를 빼면 성과의 수익과 **같아야** 한다
 *   상관        자산끼리 얼마나 같이 움직였나 — 낮은 짝(나눠 담은 효과가 큰 것)부터
 *   롤링        언제 샀느냐에 따라 — 아무 달에나 사서 N년 들고 있었으면
 *   넣은 돈 선  자산 흐름 그래프에 계단으로
 *   CSV         화면의 새 숫자를 그대로
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const 설정 = vi.hoisted(() => ({ colorScheme: "green-red" as "green-red" | "red-blue" }));
vi.mock("@/store/settingsStore", async (원래) => {
  const m = await (원래() as Promise<any>);
  return { ...m, useSettingsStore: (고르기: any) => 고르기(설정) };
});

import 자산배분결과화면, { 맞춰합치기 } from "../AllocationResult";
import { 짧은금액, 자산이름, 상관말, 상관짝들, 롤링합치기, 롤링칸 } from "../배분분석";
import { 결과CSV } from "../결과내보내기";
import { 대표조합, 조합을자산으로, 대표자산 } from "../AllocationForm";
import { PIE_COLORS } from "@/constants/pieColors";

const 롤링1 = { years: 1, series: [{ month: "2016-01", return: 5.5 }, { month: "2016-02", return: -2.1 }],
               best: 5.5, worst: -2.1, median: 1.7, positive_ratio: 50, count: 2 };
const 롤링3 = { years: 3, series: [{ month: "2018-01", return: 6.2 }, { month: "2018-02", return: 4.0 },
                                   { month: "2018-03", return: -0.4 }],
               best: 6.2, worst: -0.4, median: 4.0, positive_ratio: 66.7, count: 3 };

const 기본 = {
  start_date: "2015-01-02", end_date: "2024-12-31", years: 10,
  contributed: 70_000_000, final_value: 120_000_000, profit: 50_000_000,
  total_return: 71.43, twr_annual: 8.1, irr_annual: 7.9,
  mdd: 22.5, mdd_date: "2020-03-23", volatility: 11.2, sharpe: 0.6, sortino: 0.9,
  dividends: 6_000_000, costs: 500_000, costs_included: true, cost_rate: 0.001,
  cash_rate: 0, cash_interest: 0, risk_free_rate: 0,
  positive_months: 80, total_months: 120,
  yearly: [{ year: 2015, return: 1.2 }],
  monthly: [{ month: "2015-01", return: 1.2 }],
  curve: [
    { date: "2015-01-02", value: 10_000_000, invested: 10_000_000 },
    { date: "2020-01-02", value: 50_000_000, invested: 40_000_000 },
    { date: "2024-12-31", value: 120_000_000, invested: 70_000_000 },
  ],
  drawdown: [], drawdowns: [], crises: [],
  currency: "KRW" as const,
  assets: [{ symbol: "SPY", market: "US", name: "S&P 500", weight: 0.6 },
           { symbol: "TLT", market: "US", name: "미국 장기국채", weight: 0.3 },
           { symbol: "현금", market: "KR", name: "현금", weight: 0.1 }],
  /* 45.5M + 5M + 0 − 수수료 0.5M = 수익 50M — 서버의 셈과 같은 모양 */
  asset_stats: [
    { symbol: "SPY", weight: 0.6, contribution: 45_500_000, dividends: 4_000_000,
      total_return: 180.5, cagr: 10.9, volatility: 15.1, mdd: 33.7 },
    { symbol: "TLT", weight: 0.3, contribution: 5_000_000, dividends: 2_000_000,
      total_return: 5.3, cagr: 0.5, volatility: 14.0, mdd: 47.0 },
    { symbol: "현금", weight: 0.1, contribution: 0, dividends: null,
      total_return: 0, cagr: 0, volatility: 0, mdd: 0 },
  ],
  correlation: { symbols: ["SPY", "TLT"], matrix: [[1, -0.25], [-0.25, 1]], months: 119 },
  rolling: [롤링1, 롤링3],
  skipped: [], fx_skipped: [], mixed_currency: false,
  benchmark: null as any, extended_from: {},
};

function 그리기(덮을것: Record<string, unknown> = {}) {
  return render(<자산배분결과화면 r={{ ...기본, ...덮을것 } as never} />);
}
async function 탭열기(이름: string) {
  await userEvent.click(screen.getByRole("tab", { name: 이름 }));
}
/** 제목으로 카드를 집는다 — 제목 → 머리 줄 → 카드 */
function 카드(제목: string): HTMLElement {
  return screen.getByText(제목).parentElement!.parentElement as HTMLElement;
}
const 색값 = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`;
};

beforeEach(() => { 설정.colorScheme = "green-red"; });


describe("성과 — 넣은 돈은 최종 평가액 바로 아래", () => {
  it("매달 넣었으면 '초기 금액 + 추가 납입 전부' 라고 밝힌다", () => {
    그리기();
    const 성과 = within(카드("성과"));
    expect(성과.getByText("₩120,000,000")).toBeInTheDocument();
    expect(성과.getByText("₩70,000,000")).toBeInTheDocument();
    expect(성과.getByText(/초기 금액 \+ 추가 납입 전부/)).toBeInTheDocument();
  });

  it("한 번에 넣었으면 그 말을 안 붙인다", () => {
    그리기({ contributed: 10_000_000, curve: [{ date: "2015-01-02", value: 10_000_000, invested: 10_000_000 },
                                             { date: "2024-12-31", value: 20_000_000, invested: 10_000_000 }] });
    expect(screen.queryByText(/추가 납입 전부/)).toBeNull();
  });

  it("수익은 부호를 앞에 — 잃었으면 '-₩', 벌었으면 '+₩'", () => {
    그리기();
    expect(within(카드("성과")).getByText(/^\+₩50,000,000/)).toBeInTheDocument();
  });

  it("잃었을 때 '₩-1,000,000' 처럼 기호 뒤에 빼기를 붙이지 않는다", () => {
    그리기({ profit: -1_000_000, total_return: -1.4 });
    //: 수익 줄 — '수익' 이름표 다음에 금액이 온다
    const 글 = within(카드("성과")).getByText(/1,000,000/);
    expect(글.textContent).toBe("수익-₩1,000,000(-1.40%)");
    expect(글.className).toMatch(/text-accent-red/);
  });

  it("큰 숫자 셋 — 연환산(TWR)·내 수익률(IRR)·최대 낙폭(바닥 날짜)", () => {
    그리기();
    const 성과 = within(카드("성과"));
    expect(성과.getByText("+8.10%")).toBeInTheDocument();
    expect(성과.getByText("+7.90%")).toBeInTheDocument();
    expect(성과.getByText("-22.5%")).toBeInTheDocument();
    expect(성과.getByText("바닥 2020-03-23")).toBeInTheDocument();
  });

  it("소수 자리를 늘 같게 — 끝의 0 을 떼지 않는다('+7.94% · +8.1% · -20%' 로 어긋나던 것)", () => {
    그리기({ twr_annual: 7.94, irr_annual: 8.1, mdd: 20, volatility: 16, sharpe: 0.5, sortino: 1 });
    const 성과 = within(카드("성과"));
    expect(성과.getByText("+7.94%")).toBeInTheDocument();
    expect(성과.getByText("+8.10%")).toBeInTheDocument();
    expect(성과.getByText("-20.0%")).toBeInTheDocument();
    expect(성과.getByText("16.0%")).toBeInTheDocument();
    expect(성과.getByText("0.50")).toBeInTheDocument();
    expect(성과.getByText("1.00")).toBeInTheDocument();
  });

  it("0 은 부호 없이", () => {
    그리기({ twr_annual: 0, irr_annual: 0, mdd: 0 });
    expect(within(카드("성과")).getAllByText("0.00%")).toHaveLength(2);
    expect(within(카드("성과")).getByText("0.0%")).toBeInTheDocument();
    //: 아래 '모든 지표' 표에서도 '-0.0%' 가 아니라 '0.0%'
    expect(within(screen.getByTestId("모든지표")).getByText("최대 낙폭").nextSibling!.textContent).toBe("0.0%");
    expect(document.body.textContent).not.toMatch(/-0\.0%/);
  });

  it("작은 숫자 — 오른 달은 '몇 / 몇', 배당은 받았을 때만", () => {
    그리기();
    const 성과 = within(카드("성과"));
    expect(성과.getByText("80 / 120")).toBeInTheDocument();
    expect(성과.getByText("₩6,000,000")).toBeInTheDocument();
    expect(성과.getByText("무위험 0% 기준")).toBeInTheDocument();
  });

  it("배당을 안 쟀으면 배당 칸이 없다", () => {
    그리기({ dividends: null });
    expect(within(카드("성과")).queryByText("배당 재투자")).toBeNull();
  });

  it("예전 응답(달 수가 없음)은 오른 달을 '—' 로", () => {
    그리기({ positive_months: undefined, total_months: undefined });
    expect(within(카드("성과")).getByText("오른 달").parentElement!.textContent).toBe("오른 달—");
    expect(document.body.textContent).not.toMatch(/undefined/);
  });

  it("1년이 안 되면 연으로 늘리지 않는다고 말한다", () => {
    그리기({ twr_annual: null, irr_annual: null });
    expect(screen.getByText(/1년이 안 되는 기간은 연으로 늘리지 않아요/)).toBeInTheDocument();
  });

  it("1년이 넘으면 그 말을 안 한다", () => {
    그리기();
    expect(screen.queryByText(/1년이 안 되는 기간은/)).toBeNull();
  });
});


describe("견주기 — 지수 벤치마크 경고의 조사", () => {
  const 지수 = (name: string) => ({
    key: "x", name, index_only: true, contributed: 70_000_000, final_value: 1e8,
    total_return: 40, twr_annual: 6, irr_annual: 6, mdd: 30, volatility: 15, sharpe: 0.4, curve: [],
  });
  it.each([["코스피", "코스피는"], ["S&P500", "S&P500은"]])("%s → '%s'", (이름, 기대) => {
    그리기({ benchmark: 지수(이름) });
    expect(screen.getByText(new RegExp(`^${기대.replace("&", "\\&")} ETF 가 아니라`))).toBeInTheDocument();
  });
  it("배당을 안 쟀으면(지수끼리) 그 경고를 안 붙인다", () => {
    그리기({ benchmark: 지수("코스피"), dividends: null });
    expect(screen.queryByText(/ETF 가 아니라/)).toBeNull();
  });
});


describe("자산마다 — 누가 얼마를 벌었나", () => {
  it("자산 탭에 있다 — 비중·따로 들고 있었으면·번 돈", async () => {
    그리기();
    expect(screen.queryByText("자산마다")).toBeNull();
    await 탭열기("자산");
    const 칸 = within(카드("자산마다"));
    const 줄들 = 카드("자산마다").querySelectorAll("li");
    expect([...줄들].map((li) => li.querySelector(".truncate")!.textContent)).toEqual(["S&P 500", "미국 장기국채", "현금"]);
    expect(칸.getByText("60.0%")).toBeInTheDocument();
    expect(칸.getByText("30.0%")).toBeInTheDocument();
    expect(칸.getByText("10.0%")).toBeInTheDocument();
    //: 줄여 적되, 읽어 주는 이름에는 원 단위 그대로
    expect(칸.getByLabelText("S&P 500 번 돈 +₩45,500,000").textContent).toBe("+4550만원");
    expect(칸.getByLabelText("미국 장기국채 번 돈 +₩5,000,000").textContent).toBe("+500만원");
    expect(칸.getByLabelText("현금 번 돈 ₩0").textContent).toBe("0원");
  });

  it("따로 들고 있었으면의 연·낙폭·변동성을 줄마다", async () => {
    그리기();
    await 탭열기("자산");
    const 줄 = screen.getByLabelText("S&P 500 번 돈 +₩45,500,000").parentElement!;
    expect(줄.textContent).toContain("연 +10.9%");
    expect(줄.textContent).toContain("낙폭 -33.7%");
    expect(줄.textContent).toContain("변동성 15.1%");
    //: 현금은 흔들림이 없다 — '변동성 0.0%' 는 군더더기다
    const 현금줄 = screen.getByLabelText("현금 번 돈 ₩0").parentElement!;
    expect(현금줄.textContent).not.toContain("변동성");
    //: 0 에는 부호를 안 붙인다 — '+0.0%' · '-0.0%' 는 오른 것·내린 것처럼 읽힌다
    expect(현금줄.textContent).toContain("연 0.0%");
    expect(현금줄.textContent).toContain("낙폭 0.0%");
  });

  it("셈을 그대로 적는다 — 자산들이 번 돈 − 수수료 = 수익", async () => {
    그리기();
    await 탭열기("자산");
    //: 원 가운데에도 '수익' 이 있어 셈 줄 칸 안에서만 본다
    const 셈 = within(screen.getByText("자산들이 번 돈").parentElement!.parentElement!);
    expect(셈.getByText("자산들이 번 돈").nextSibling!.textContent).toBe("+₩50,500,000");
    expect(셈.getByText("수수료").nextSibling!.textContent).toBe("-₩500,000");
    expect(셈.getByText("수익").nextSibling!.textContent).toBe("+₩50,000,000");
  });

  it("수수료를 안 냈으면 수수료 줄이 없다", async () => {
    그리기({ costs: 0, profit: 50_500_000 });
    await 탭열기("자산");
    expect(within(카드("자산마다")).queryByText("수수료")).toBeNull();
  });

  it("가장 많이 번 자산과 그 몫(자산들이 번 돈 중)", async () => {
    그리기();
    await 탭열기("자산");
    const 말 = screen.getByText(/가장 많이 번 자산은/);
    //: 45.5 / 50.5 = 90.1%
    expect(말.textContent).toBe("가장 많이 번 자산은 S&P 500이에요 — 자산들이 번 돈의 90%.");
  });

  it("조사는 이름 끝소리에 맞춘다 — 받침이 없으면 '예요'", async () => {
    그리기({ assets: [{ symbol: "SPY", market: "US", name: "SPY", weight: 0.6 }, ...기본.assets.slice(1)] });
    await 탭열기("자산");
    expect(screen.getByText(/가장 많이 번 자산은/).textContent).toMatch(/^가장 많이 번 자산은 SPY예요 —/);
  });

  it("잃은 자산이 섞이면 '번 돈의 103%' 대신 잃었다고 말한다", async () => {
    /* 45.5M 을 벌고 1.4M 을 잃으면 '자산들이 번 돈의 103%' 가 된다 — 맞는 셈인데 읽히지 않는다(실제로 그렇게 찍혔다) */
    그리기({ asset_stats: [기본.asset_stats[0], { ...기본.asset_stats[1], contribution: -1_400_000 }, 기본.asset_stats[2]] });
    await 탭열기("자산");
    expect(screen.getByText(/가장 많이 번 자산은/).textContent)
      .toBe("가장 많이 번 자산은 S&P 500이에요(+4550만원). 미국 장기국채는 오히려 잃었어요(-140만원).");
  });

  it("이름만 굵게 — 조사는 굵게 안 한다", async () => {
    그리기({ asset_stats: [기본.asset_stats[0], { ...기본.asset_stats[1], contribution: -1_400_000 }, 기본.asset_stats[2]] });
    await 탭열기("자산");
    const 굵은것 = [...screen.getByText(/가장 많이 번 자산은/).querySelectorAll("b")].map((b) => b.textContent);
    expect(굵은것).toEqual(["S&P 500", "미국 장기국채"]);
  });

  it("잃은 자산이 둘이면 둘 다, 잃은 돈은 합쳐서", async () => {
    그리기({ asset_stats: [기본.asset_stats[0], { ...기본.asset_stats[1], contribution: -1_400_000 },
                           { ...기본.asset_stats[2], contribution: -600_000 }] });
    await 탭열기("자산");
    expect(screen.getByText(/가장 많이 번 자산은/).textContent)
      .toBe("가장 많이 번 자산은 S&P 500이에요(+4550만원). 미국 장기국채 · 현금은 오히려 잃었어요(-200만원).");
  });

  it("다 합쳐 잃었으면 가장 많이 잃은 자산을 말한다", async () => {
    그리기({ asset_stats: [{ ...기본.asset_stats[0], contribution: 1_000_000 },
                           { ...기본.asset_stats[1], contribution: -9_000_000 }, 기본.asset_stats[2]],
             profit: -8_500_000 });
    await 탭열기("자산");
    expect(screen.queryByText(/가장 많이 번 자산은/)).toBeNull();
    expect(screen.getByText(/가장 많이 잃은 자산은/).textContent)
      .toBe("가장 많이 잃은 자산은 미국 장기국채예요(-900만원).");
  });

  it("다 잃었으면 '가장 많이 번' 이라고 말하지 않는다(몫이 거꾸로 읽힌다)", async () => {
    그리기({ asset_stats: 기본.asset_stats.map((x) => ({ ...x, contribution: -(x.contribution ?? 0) - 1 })),
             profit: -51_000_000 });
    await 탭열기("자산");
    expect(screen.queryByText(/가장 많이 번 자산은/)).toBeNull();
  });

  it("번 돈 막대 — 제일 크게 번 자산이 끝까지, 나머지는 그 비율로. 잃은 자산은 내림 색", async () => {
    그리기({ asset_stats: [기본.asset_stats[0], { ...기본.asset_stats[1], contribution: -9_100_000 }, 기본.asset_stats[2]] });
    await 탭열기("자산");
    const 막대 = (이름: string) => {
      const 줄 = screen.getByLabelText(new RegExp(`^${이름} 번 돈`)).closest("li")!;
      return 줄.querySelector<HTMLElement>('[style*="width"]')!;
    };
    expect(parseFloat(막대("S&P 500").style.width)).toBeCloseTo(100, 5);
    expect(parseFloat(막대("미국 장기국채").style.width)).toBeCloseTo(20, 5);   // 9.1 / 45.5
    expect(막대("S&P 500").style.background).toBe(색값("#10b981"));
    expect(막대("미국 장기국채").style.background, "잃은 자산이 오름 색이다").toBe(색값("#ef4444"));
  });

  it("가장 크게 잃은 자산이 번 자산보다 크면 그 막대가 끝까지", async () => {
    그리기({ asset_stats: [기본.asset_stats[0], { ...기본.asset_stats[1], contribution: -91_000_000 }, 기본.asset_stats[2]],
             profit: -46_000_000 });
    await 탭열기("자산");
    const 너비 = (이름: string) => parseFloat(screen.getByLabelText(new RegExp(`^${이름} 번 돈`)).closest("li")!
      .querySelector<HTMLElement>('[style*="width"]')!.style.width);
    expect(너비("미국 장기국채")).toBeCloseTo(100, 5);
    expect(너비("S&P 500")).toBeCloseTo(50, 5);
  });

  it("번 돈과 잃은 돈이 같아 합이 0 이면 '가장 많이 번' 이 아니라 '가장 많이 잃은'", async () => {
    그리기({ asset_stats: [{ ...기본.asset_stats[0], contribution: 5_000_000 },
                           { ...기본.asset_stats[1], contribution: -5_000_000 }, 기본.asset_stats[2]], profit: -500_000 });
    await 탭열기("자산");
    expect(screen.queryByText(/가장 많이 번 자산은/)).toBeNull();
    expect(screen.getByText(/가장 많이 잃은 자산은/).textContent).toBe("가장 많이 잃은 자산은 미국 장기국채예요(-500만원).");
  });

  it("몫은 반올림 — 2/3 은 67%", async () => {
    그리기({ asset_stats: [{ ...기본.asset_stats[0], contribution: 2_000_000 },
                           { ...기본.asset_stats[1], contribution: 1_000_000 }, 기본.asset_stats[2]], profit: 2_500_000 });
    await 탭열기("자산");
    expect(screen.getByText(/가장 많이 번 자산은/).textContent).toBe("가장 많이 번 자산은 S&P 500이에요 — 자산들이 번 돈의 67%.");
  });

  it("빨강-파랑 설정이면 막대 색도 따라간다", async () => {
    설정.colorScheme = "red-blue";
    그리기();
    await 탭열기("자산");
    const 줄 = screen.getByLabelText(/^S&P 500 번 돈/).closest("li")!;
    expect(줄.querySelector<HTMLElement>('[style*="width"]')!.style.background).toBe(색값("#ef4444"));
  });

  it("줄마다 색 점이 원그래프 조각과 같은 차례", async () => {
    그리기();
    await 탭열기("자산");
    //: '가장 많이 번 자산은 S&P 500' 에도 이름이 있어 줄(li) 안에서만 찾는다
    const 점 = (이름: string) => {
      const li = [...카드("자산마다").querySelectorAll("li")].find((x) => x.textContent?.startsWith(이름))!;
      return li.querySelector<HTMLElement>("span.rounded-full")!;
    };
    expect(점("S&P 500").style.background).toBe(색값(PIE_COLORS[0]));
    expect(점("미국 장기국채").style.background).toBe(색값(PIE_COLORS[1]));
    expect(screen.getByTestId("자산마다-원")).toBeInTheDocument();
  });

  it("원 가운데 수익", async () => {
    그리기();
    await 탭열기("자산");
    const 원 = screen.getByTestId("자산마다-원");
    expect(원.textContent).toContain("수익");
    expect(원.textContent).toContain("+5000만원");
  });

  it("무엇을 잰 것인지 적는다 — 배당·현금 이자", async () => {
    그리기();
    await 탭열기("자산");
    const 글 = 카드("자산마다").textContent ?? "";
    expect(글).toMatch(/그 자산 하나만 같은 기간 들고 있었으면의 성적이에요\(배당 재투자\)/);
    expect(글).toMatch(/번 돈과 받은 배당이에요 — 현금은 이자\./);
  });

  it("배당을 안 쟀고 현금도 없으면 그 말을 빼고 적는다", async () => {
    그리기({ dividends: null, assets: 기본.assets.slice(0, 2), asset_stats: 기본.asset_stats.slice(0, 2) });
    await 탭열기("자산");
    const 글 = 카드("자산마다").textContent ?? "";
    expect(글).not.toMatch(/배당 재투자/);
    expect(글).not.toMatch(/받은 배당/);
    expect(글).not.toMatch(/현금은 이자/);
  });

  it("예전 응답(자산마다 없음)이면 비중 원만", async () => {
    그리기({ asset_stats: undefined });
    await 탭열기("자산");
    expect(screen.queryByText("자산마다")).toBeNull();
    expect(screen.getByText("담은 자산")).toBeInTheDocument();
  });
});


describe("짧은금액", () => {
  it.each([
    [45_500_000, "KRW", "+4550만원"], [-500_000, "KRW", "-50만원"], [0, "KRW", "0원"],
    [9_999, "KRW", "+9,999원"], [10_000, "KRW", "+1만원"], [-1_234, "KRW", "-1,234원"], [250_000_000, "KRW", "+2.5억원"],
    [43_900, "USD", "+$43.9K"], [-2_500_000, "USD", "-$2.5M"], [3_100_000_000, "USD", "+$3.1B"],
    [999, "USD", "+$999"], [0, "USD", "$0"],
  ] as const)("%s %s → %s", (v, 통화, 기대) => {
    expect(짧은금액(v, 통화)).toBe(기대);
  });
  it("못 잰 값은 '—'", () => {
    expect(짧은금액(null, "KRW")).toBe("—");
    expect(짧은금액(undefined, "USD")).toBe("—");
    expect(짧은금액(NaN, "KRW")).toBe("—");
  });
});


describe("자산이름", () => {
  it("담을 때의 이름, 없으면 심볼", () => {
    const r = { assets: [{ symbol: "SPY", market: "US", name: "S&P 500", weight: 1 },
                         { symbol: "QQQ", market: "US", name: "", weight: 1 }] } as never;
    expect(자산이름(r, "SPY")).toBe("S&P 500");
    expect(자산이름(r, "QQQ")).toBe("QQQ");
    expect(자산이름(r, "GLD")).toBe("GLD");
  });
});


describe("상관 — 얼마나 같이 움직였나", () => {
  it.each([[1, "거의 같이"], [0.7, "거의 같이"], [0.69, "꽤 같이"], [0.3, "꽤 같이"], [0.29, "따로"],
           [0, "따로"], [-0.29, "따로"], [-0.3, "거꾸로"], [-1, "거꾸로"]])("%s → %s", (v, 기대) => {
    expect(상관말(v)).toBe(기대);
  });

  const 다섯 = {
    assets: ["A", "B", "C", "D", "E"].map((s) => ({ symbol: s, market: "US", name: `${s}자산`, weight: 1 })),
    correlation: {
      symbols: ["A", "B", "C", "D", "E"], months: 60,
      matrix: [
        [1, 0.9, 0.1, -0.5, 0.2],
        [0.9, 1, null, 0.4, 0.3],
        [0.1, null, 1, 0.05, -0.1],
        [-0.5, 0.4, 0.05, 1, 0.6],
        [0.2, 0.3, -0.1, 0.6, 1],
      ],
    },
  };

  it("짝은 낮은 것부터 — 못 잰 짝(null)은 뺀다", () => {
    const 짝들 = 상관짝들(다섯 as never);
    expect(짝들.map((x) => x.값)).toEqual([-0.5, -0.1, 0.05, 0.1, 0.2, 0.3, 0.4, 0.6, 0.9]);
    expect(짝들[0]).toEqual({ 가: "A자산", 나: "D자산", 값: -0.5 });
    //: 위 삼각형만 — 같은 짝을 두 번 세지 않는다
    expect(짝들).toHaveLength(9);
  });

  it("상관표가 없으면 짝도 없다", () => {
    expect(상관짝들({ assets: [], correlation: null } as never)).toEqual([]);
  });

  it("자산 탭에 있고, 짝 하나면 '평균' 없이", async () => {
    그리기();
    await 탭열기("자산");
    const 칸 = 카드("얼마나 같이 움직였나");
    expect(칸.textContent).toContain("달마다 · 119개월");
    expect(칸.textContent).toContain("상관 -0.25 — 따로 움직여서 나눠 담은 효과가 컸어요.");
    expect(칸.textContent).not.toContain("평균");
    const 값 = within(칸).getByLabelText("S&P 500과 미국 장기국채 상관 -0.25");
    expect(값.textContent).toBe("-0.25 따로");
  });

  it("점은 -1~1 자 위에 — 0 이 가운데", async () => {
    그리기();
    await 탭열기("자산");
    const 줄 = within(카드("얼마나 같이 움직였나")).getByText("S&P 500 · 미국 장기국채").closest("li")!;
    expect(parseFloat(줄.querySelector<HTMLElement>('[style*="left"]')!.style.left)).toBeCloseTo(37.5, 5);
  });

  it("짝이 많으면 여섯만 먼저, '모두 보기' 로 편다", async () => {
    그리기(다섯);
    await 탭열기("자산");
    const 칸 = () => 카드("얼마나 같이 움직였나");
    expect(칸().querySelectorAll("li")).toHaveLength(6);
    //: (-0.5 - 0.1 + 0.05 + 0.1 + 0.2 + 0.3 + 0.4 + 0.6 + 0.9) / 9 = 0.2167
    expect(칸().textContent).toContain("평균 상관 0.22 — 따로 움직여서 나눠 담은 효과가 컸어요.");
    await userEvent.click(screen.getByRole("button", { name: "9쌍 모두 보기" }));
    expect(칸().querySelectorAll("li")).toHaveLength(9);
    await userEvent.click(screen.getByRole("button", { name: "접기" }));
    expect(칸().querySelectorAll("li")).toHaveLength(6);
  });

  it("어느 정도 같이 움직였으면 그렇게 말한다(0.3 이상 0.7 미만)", async () => {
    그리기({ correlation: { symbols: ["SPY", "TLT"], matrix: [[1, 0.3], [0.3, 1]], months: 24 } });
    await 탭열기("자산");
    expect(카드("얼마나 같이 움직였나").textContent).toContain("상관 0.30 — 어느 정도 같이 움직였어요.");
  });

  it("0.7 이면 거의 같이", async () => {
    그리기({ correlation: { symbols: ["SPY", "TLT"], matrix: [[1, 0.7], [0.7, 1]], months: 24 } });
    await 탭열기("자산");
    expect(카드("얼마나 같이 움직였나").textContent).toContain("상관 0.70 — 거의 같이 움직여서");
  });

  it("거의 같이 움직였으면 그렇게 말한다", async () => {
    그리기({ correlation: { symbols: ["SPY", "TLT"], matrix: [[1, 0.85], [0.85, 1]], months: 24 } });
    await 탭열기("자산");
    expect(카드("얼마나 같이 움직였나").textContent).toContain("거의 같이 움직여서 나눠 담은 효과가 작았어요.");
    expect(screen.getByLabelText(/상관 0.85/).textContent).toBe("+0.85 거의 같이");
  });

  it("0 에는 부호를 안 붙인다", async () => {
    그리기({ correlation: { symbols: ["SPY", "TLT"], matrix: [[1, 0], [0, 1]], months: 24 } });
    await 탭열기("자산");
    expect(screen.getByLabelText(/상관 0.00/).textContent).toBe("0.00 따로");
  });

  it("상관표가 없거나 짝이 다 못 잰 것이면 카드를 안 그린다", async () => {
    그리기({ correlation: null });
    await 탭열기("자산");
    expect(screen.queryByText("얼마나 같이 움직였나")).toBeNull();
  });

  it("짝이 다 못 잰 것(null)이어도 안 그린다", async () => {
    그리기({ correlation: { symbols: ["SPY", "TLT"], matrix: [[1, null], [null, 1]], months: 24 } });
    await 탭열기("자산");
    expect(screen.queryByText("얼마나 같이 움직였나")).toBeNull();
  });
});


describe("롤링 — 언제 샀느냐에 따라", () => {
  it("벤치마크는 달로 짝짓는다 — 없는 달은 비운다", () => {
    expect(롤링합치기(롤링3 as never, { ...롤링3, series: [{ month: "2018-02", return: 3.0 }] } as never)).toEqual([
      { month: "2018-01", 내것: 6.2 },
      { month: "2018-02", 내것: 4.0, 벤치: 3.0 },
      { month: "2018-03", 내것: -0.4 },
    ]);
    expect(롤링합치기(undefined, undefined)).toEqual([]);
    expect(롤링합치기(롤링1 as never)).toEqual([{ month: "2016-01", 내것: 5.5 }, { month: "2016-02", 내것: -2.1 }]);
  });

  it("기간별 탭에 있고, 기본은 3년", async () => {
    그리기();
    expect(screen.queryByText("언제 샀느냐에 따라")).toBeNull();
    await 탭열기("기간별");
    const 칸 = 카드("언제 샀느냐에 따라");
    expect(칸.textContent).toContain("아무 달에나 사서 3년 들고 있었으면");
    expect(within(칸).getByRole("tab", { name: "3년" }).getAttribute("aria-selected")).toBe("true");
    const 값 = (이름: string) => within(칸).getByText(이름).nextSibling!.textContent;
    expect(값("플러스였던 경우")).toBe("67%");
    expect(within(칸).getByText("3번 중 2번")).toBeInTheDocument();
    expect(값("중간값")).toBe("+4.0%");
    expect(값("가장 좋았을 때")).toBe("+6.2%");
    expect(값("가장 나빴을 때")).toBe("-0.4%");
  });

  it("기간을 바꾸면 숫자가 바뀐다", async () => {
    그리기();
    await 탭열기("기간별");
    await userEvent.click(screen.getByRole("tab", { name: "1년" }));
    const 칸 = 카드("언제 샀느냐에 따라");
    expect(칸.textContent).toContain("아무 달에나 사서 1년 들고 있었으면");
    expect(within(칸).getByText("가장 나빴을 때").nextSibling!.textContent).toBe("-2.1%");
    expect(within(칸).getByText("2번 중 1번")).toBeInTheDocument();
  });

  it("플러스였던 횟수는 비율에서 반올림 — 83.3% × 6번 = 5번", async () => {
    그리기({ rolling: [{ ...롤링3, positive_ratio: 83.3, count: 6 }] });
    await 탭열기("기간별");
    expect(within(카드("언제 샀느냐에 따라")).getByText("6번 중 5번")).toBeInTheDocument();
  });

  it("기간이 하나뿐이어도 벤치마크 칩은 있다", async () => {
    그리기({ rolling: [롤링3], benchmark: { key: "spy", name: "S&P500", contributed: 1, final_value: 1, curve: [],
                                             rolling: [{ ...롤링3, series: [{ month: "2018-02", return: 3.0 }] }] } });
    await 탭열기("기간별");
    const 칸 = 카드("언제 샀느냐에 따라");
    expect(within(칸).queryByRole("tablist")).toBeNull();
    expect(within(칸).getByLabelText("S&P500 같이 보기")).toBeInTheDocument();
  });

  it("값의 색은 부호로", async () => {
    그리기();
    await 탭열기("기간별");
    const 칸 = 카드("언제 샀느냐에 따라");
    expect(within(칸).getByText("가장 좋았을 때").nextSibling).toHaveClass("text-accent-green");
    expect(within(칸).getByText("가장 나빴을 때").nextSibling).toHaveClass("text-accent-red");
  });

  it("3년이 없으면 있는 것 중 첫째", async () => {
    그리기({ rolling: [롤링1] });
    await 탭열기("기간별");
    const 칸 = 카드("언제 샀느냐에 따라");
    expect(칸.textContent).toContain("1년 들고 있었으면");
    //: 고를 것이 하나면 칩 줄을 안 그린다
    expect(within(칸).queryByRole("tablist")).toBeNull();
  });

  it("고른 기간이 없는 결과를 새로 받아도 카드가 사라지지 않는다", async () => {
    const { rerender } = render(<롤링칸 r={{ ...기본, rolling: [롤링1, 롤링3, { ...롤링3, years: 5 }] } as never} />);
    await userEvent.click(screen.getByRole("tab", { name: "5년" }));
    rerender(<롤링칸 r={{ ...기본, rolling: [롤링1, 롤링3] } as never} />);
    expect(screen.getByText("언제 샀느냐에 따라")).toBeInTheDocument();
    expect(screen.getByText("아무 달에나 사서 3년 들고 있었으면")).toBeInTheDocument();
  });

  it("롤링이 없으면(기간이 1년도 안 됨·예전 응답) 카드를 안 그린다", async () => {
    그리기({ rolling: [] });
    await 탭열기("기간별");
    expect(screen.queryByText("언제 샀느냐에 따라")).toBeNull();
    그리기({ rolling: undefined });
  });

  it("벤치마크 롤링이 겹치면 같이 보기 칩", async () => {
    그리기({ benchmark: { key: "spy", name: "S&P500", contributed: 1, final_value: 1, curve: [],
                          rolling: [{ ...롤링3, series: [{ month: "2018-02", return: 3.0 }] }] } });
    await 탭열기("기간별");
    const 칸 = 카드("언제 샀느냐에 따라");
    expect(within(칸).getByLabelText("S&P500 같이 보기")).toBeInTheDocument();
  });

  it("벤치마크 칩은 기간 칩과 한 줄 — 끄면 범례에서도 빠진다", async () => {
    그리기({ benchmark: { key: "spy", name: "S&P500", contributed: 1, final_value: 1, curve: [],
                          rolling: [{ ...롤링3, series: [{ month: "2018-02", return: 3.0 }] }] } });
    await 탭열기("기간별");
    const 칸 = 카드("언제 샀느냐에 따라");
    const 칩 = within(칸).getByLabelText("S&P500 같이 보기");
    expect(칩.parentElement, "기간 칩과 다른 줄이다").toBe(within(칸).getByRole("tablist").parentElement);
    const 범례 = () => [...칸.querySelectorAll("span.flex.items-center.gap-1")].map((x) => x.textContent);
    expect(범례()).toEqual(["내 조합", "S&P500"]);
    await userEvent.click(칩);
    expect(범례()).toEqual(["내 조합"]);
  });

  it("벤치마크 롤링이 그 기간에 없으면 칩도 없다", async () => {
    그리기({ benchmark: { key: "spy", name: "S&P500", contributed: 1, final_value: 1, curve: [], rolling: [롤링1] } });
    await 탭열기("기간별");
    expect(within(카드("언제 샀느냐에 따라")).queryByLabelText("S&P500 같이 보기")).toBeNull();
  });
});


describe("해마다 % — 늘 소수 둘째 자리", () => {
  it.each([[23, "+23.00%"], [3.62, "+3.62%"], [-5.2, "-5.20%"], [0, "0.00%"], [-0.004, "0.00%"], [0.004, "0.00%"],
            [0.005, "+0.01%"], [-0.006, "-0.01%"]])("%s → %s", async (v, 기대) => {
    const { 해글 } = await import("../AllocationResult");
    expect(해글(v)).toBe(기대);
  });
});


describe("자산 흐름 — 넣은 돈 선", () => {
  it("넣은 돈을 날짜로 같이 싣는다", () => {
    expect(맞춰합치기(기본.curve)).toEqual([
      { date: "2015-01-02", 내것: 10_000_000, 넣은: 10_000_000 },
      { date: "2020-01-02", 내것: 50_000_000, 넣은: 40_000_000 },
      { date: "2024-12-31", 내것: 120_000_000, 넣은: 70_000_000 },
    ]);
  });

  it("예전 응답(넣은 돈 없음)은 그 칸을 안 만든다", () => {
    expect(맞춰합치기([{ date: "2020-01-02", value: 1 }])).toEqual([{ date: "2020-01-02", 내것: 1 }]);
  });

  it("범례에 '넣은 돈' — 있을 때만", () => {
    const 첫 = 그리기();
    expect(within(카드("자산 흐름")).getByText("넣은 돈")).toBeInTheDocument();
    첫.unmount();
    그리기({ curve: 기본.curve.map(({ invested: _, ...x }) => x) });
    expect(within(카드("자산 흐름")).queryByText("넣은 돈")).toBeNull();
  });
});


describe("CSV — 새 숫자도 그대로", () => {
  const 줄들 = 결과CSV({ ...기본, benchmark: { name: "S&P500", contributed: 1, final_value: 2, curve: [],
                                               yearly: [], rolling: [{ ...롤링3, series: [{ month: "2018-02", return: 3.0 }],
                                                                     median: 2.5 }] } } as never);
  const 찾기 = (첫칸: string) => 줄들.find((x) => x[0] === 첫칸);
  const 다음줄 = (머리: string, n = 1) => 줄들[줄들.findIndex((x) => x[0] === 머리) + n];

  it("요약에 현금 이자 합", () => {
    expect(찾기("현금 이자 합")).toEqual(["현금 이자 합", 0, undefined]);
  });

  it("자산마다 — 비중(%)·번 돈·배당·따로 들고 있었으면, 낙폭은 음수", () => {
    expect(찾기("[자산마다]")).toEqual(["[자산마다]", "비중(%)", "번 돈(배당 포함)", "받은 배당",
      "따로 들고 있었으면 수익률(%)", "연환산(%)", "변동성(%)", "최대 낙폭(%)"]);
    expect(다음줄("[자산마다]")).toEqual(["S&P 500", 60, 45_500_000, 4_000_000, 180.5, 10.9, 15.1, -33.7]);
    expect(다음줄("[자산마다]", 3)).toEqual(["현금", 10, 0, null, 0, 0, 0, -0]);
  });

  it("비중은 소수 둘째 자리까지 — 서버의 0.333333 이 '33.3333' 으로 나가지 않게", () => {
    const 셋 = 결과CSV({ ...기본, asset_stats: [{ ...기본.asset_stats[0], weight: 0.333333 },
                                                { ...기본.asset_stats[1], weight: 0.666667 }] } as never);
    const i = 셋.findIndex((x) => x[0] === "[자산마다]");
    expect(셋[i + 1][1]).toBe(33.33);
    expect(셋[i + 2][1]).toBe(66.67);
  });

  it("상관 — 이름으로 된 표", () => {
    expect(찾기("[상관 — 달마다 119개월]")).toEqual(["[상관 — 달마다 119개월]", "S&P 500", "미국 장기국채"]);
    expect(다음줄("[상관 — 달마다 119개월]")).toEqual(["S&P 500", 1, -0.25]);
    expect(다음줄("[상관 — 달마다 119개월]", 2)).toEqual(["미국 장기국채", -0.25, 1]);
  });

  it("롤링 — 기간마다 요약, 벤치마크는 그 기간이 있을 때만 옆에", () => {
    expect(찾기("[1년 들고 있었으면 — 연 수익률(%)]")).toEqual(["[1년 들고 있었으면 — 연 수익률(%)]", "내 조합"]);
    expect(다음줄("[1년 들고 있었으면 — 연 수익률(%)]", 5)).toEqual(["2016-01", 5.5]);
    expect(찾기("[3년 들고 있었으면 — 연 수익률(%)]")).toEqual(["[3년 들고 있었으면 — 연 수익률(%)]", "내 조합", "S&P500"]);
    expect(다음줄("[3년 들고 있었으면 — 연 수익률(%)]", 1)).toEqual(["플러스였던 경우(%)", 66.7, 66.7]);
    expect(다음줄("[3년 들고 있었으면 — 연 수익률(%)]", 2)).toEqual(["중간값", 4.0, 2.5]);
    expect(다음줄("[3년 들고 있었으면 — 연 수익률(%)]", 3)).toEqual(["가장 좋았을 때", 6.2, 6.2]);
    expect(다음줄("[3년 들고 있었으면 — 연 수익률(%)]", 4)).toEqual(["가장 나빴을 때", -0.4, -0.4]);
    expect(다음줄("[3년 들고 있었으면 — 연 수익률(%)]", 5)).toEqual(["2018-01", 6.2, undefined]);
    expect(다음줄("[3년 들고 있었으면 — 연 수익률(%)]", 6)).toEqual(["2018-02", 4.0, 3.0]);
  });

  it("예전 응답이면 새 구간을 안 만든다", () => {
    const 옛 = 결과CSV({ ...기본, asset_stats: undefined, correlation: undefined, rolling: undefined } as never);
    expect(옛.some((x) => String(x[0]).startsWith("[자산마다"))).toBe(false);
    expect(옛.some((x) => String(x[0]).startsWith("[상관"))).toBe(false);
    expect(옛.some((x) => String(x[0]).includes("들고 있었으면"))).toBe(false);
  });
});


describe("대표 조합 — 빈 화면에서 한 번에", () => {
  it("모든 자산이 대표자산에 있다(이름·시장을 거기서 가져온다) — 현금 빼고", () => {
    for (const p of 대표조합) {
      for (const [s] of p.자산들) {
        if (s === "현금") continue;
        expect(대표자산.some((a) => a.symbol === s), `${p.이름}의 ${s} 가 대표자산에 없다`).toBe(true);
      }
    }
  });

  it("비중 합이 100", () => {
    for (const p of 대표조합) {
      expect(p.자산들.reduce((a, [, w]) => a + w, 0), p.이름).toBe(100);
    }
  });

  it("주식 60·채권 40 과 올웨더는 벤치마크와 같은 구성(서버 벤치마크표)", () => {
    expect(대표조합.find((p) => p.이름 === "주식 60 · 채권 40")!.자산들).toEqual([["SPY", 60], ["AGG", 40]]);
    expect(대표조합.find((p) => p.이름 === "올웨더")!.자산들)
      .toEqual([["SPY", 30], ["TLT", 40], ["IEF", 15], ["GLD", 7.5], ["DBC", 7.5]]);
  });

  it("배분자산으로 — 이름·시장은 대표자산에서, 현금은 '+ 현금' 과 같은 모양", () => {
    expect(조합을자산으로([["069500.KS", 50], ["현금", 50]])).toEqual([
      { symbol: "069500.KS", market: "KR", name: "KODEX 200", weight: 50 },
      { symbol: "현금", market: "KR", name: "현금", weight: 50 },
    ]);
    expect(조합을자산으로([["AGG", 40]])).toEqual([{ symbol: "AGG", market: "US", name: "미국 종합채권", weight: 40 }]);
    //: 대표자산에 없는 것이 들어와도 안 깨진다(심볼을 이름으로)
    expect(조합을자산으로([["ZZZ", 1]])).toEqual([{ symbol: "ZZZ", market: "US", name: "ZZZ", weight: 1 }]);
  });
});
