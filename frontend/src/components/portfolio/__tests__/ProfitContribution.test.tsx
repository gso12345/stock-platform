/**
 * 수익 기여 — 누가 내 수익을 만들었나.
 *
 * 이 화면이 하는 말은 딱 하나다. "이 +512만원은 누가 만들었나."
 * 그래서 여기서 틀릴 수 있는 것은 **줄 세운 순서**와 **분모** 두 가지뿐인데,
 * 둘 다 틀려도 화면은 멀쩡해 보인다. 숫자가 그럴듯하게 나오기 때문이다.
 *
 *   1) 순서 — '총' 과 '오늘' 은 서로 다른 값으로 줄을 세운다. 한쪽 값으로
 *      두 기간을 다 세우면, 3년 전에 번 돈이 오늘 번 돈 자리에 앉는다.
 *      화면에는 그냥 목록 하나가 보일 뿐이라 아무도 눈치채지 못한다.
 *
 *   2) 합치기 — 같은 종목을 연금저축과 일반계좌에 나눠 담은 사람이 있다.
 *      심볼로 안 합치면 같은 이름이 두 줄로 나오고, 그 종목의 몫이 실제보다
 *      작아 보인다. "삼성전자가 내 수익의 절반" 인데 두 줄로 쪼개져서
 *      3등·5등으로 내려앉는 식이다 — 집중도를 보려고 만든 화면인데
 *      집중도를 정확히 반대로 말한다.
 *
 *   3) 분모 — '총' 은 매입금액 대비, '오늘' 은 **어제 평가액** 대비다.
 *      두 분모는 다른 숫자이고, 바꿔 써도 퍼센트는 그럴듯하게 나온다.
 *      그리고 분모가 0 일 때(공짜로 받은 주식, 오늘 처음 값이 붙은 종목)
 *      비율은 **없는 것**이지 0 이 아니다. 0% 라고 적으면 '안 움직였다' 는
 *      거짓말이 된다.
 *
 *   4) 막대 기준 — 제일 큰 **절댓값**이다. 크게 잃은 종목이 기준일 수 있다.
 *      양수만 보고 기준을 잡으면 손실 막대가 100% 를 넘어 칸을 뚫는다.
 *
 * 그래서 아래 검사들은 '함수가 뭔가를 돌려주는가' 가 아니라
 * '손으로 계산한 그 값이 맞는가' 까지 본다.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import 수익기여, { 기여줄세우기, 막대기준, type 기여줄 }
  from "@/components/portfolio/ProfitContribution";
import type { EnrichedItem } from "@/types/portfolio";

let 다음id = 1;

/** 자산 화면이 이미 구해 둔 종목 한 줄. 이 화면은 새 데이터를 안 쓰고
 *  pnlKRW · dailyChangeKRW · costKRW · currentValueKRW 네 개만 본다.
 *  나머지는 타입을 채우기 위한 자리다. */
const 종목 = ({ symbol, ...덮 }: Partial<EnrichedItem> & { symbol: string }): EnrichedItem => ({
  id: 다음id++,
  symbol,
  market: "KR",
  name: symbol,
  shares: 10,
  avgPrice: 0,
  currency: "KRW",
  currentPriceNative: 0,
  currentValueKRW: 0,
  costKRW: 0,
  pnlKRW: 0,
  pnlRate: 0,
  weight: 0,
  isForexItem: false,
  nativeAvgPrice: 0,
  nativeValue: 0,
  nativePnl: 0,
  ...덮,
});

/** 막대기준() 검사용 — 기여액만 있으면 되는 가짜 줄 */
const 가짜줄 = (기여액: number, key = String(기여액)): 기여줄 => ({
  key, name: key, symbol: key, market: "KR", 기여액, 비율: null,
});

const 심볼들 = (줄들: 기여줄[]) => 줄들.map((r) => r.symbol);
const 기여액들 = (줄들: 기여줄[]) => 줄들.map((r) => r.기여액);

/** 이름으로 그 종목의 <li> 칸을 집는다. 화면 전체에서 금액 문자열을 찾으면
 *  합계나 다른 줄이 걸린다 — 반드시 줄 안으로 좁혀서 본다. */
const 줄칸 = (이름: string): HTMLElement => {
  const 칸 = screen.getByText(이름).closest("li");
  expect(칸, `${이름} 줄이 화면에 없다`).not.toBeNull();
  return 칸 as HTMLElement;
};

/** 기간 칩 — 줄 버튼에도 "오늘급등" 같은 이름이 있을 수 있어 칩 묶음 안에서 집는다 */
const 기간칩 = (k: "오늘" | "총") =>
  within(screen.getByRole("group", { name: "기여 기간" })).getByRole("button", { name: k });

/** 그 줄의 막대가 몇 %인지 */
const 막대폭 = (칸: HTMLElement): number => {
  const 막대 = 칸.querySelector<HTMLElement>("span[style*='width']");
  expect(막대, "막대를 못 찾았다").not.toBeNull();
  return parseFloat(막대!.style.width);
};


describe("줄 세우는 기준", () => {
  it("기여액이 큰 종목이 위로 온다 — 이 화면에서 순서는 장식이 아니라 내용이다", () => {
    const 줄들 = 기여줄세우기([
      종목({ symbol: "A", pnlKRW: 300_000, costKRW: 1_000_000, currentValueKRW: 1_300_000 }),
      종목({ symbol: "B", pnlKRW: -900_000, costKRW: 3_000_000, currentValueKRW: 2_100_000 }),
      종목({ symbol: "C", pnlKRW: 500_000, costKRW: 1_000_000, currentValueKRW: 1_500_000 }),
    ], "총");

    expect(심볼들(줄들)).toEqual(["C", "A", "B"]);
    expect(기여액들(줄들)).toEqual([500_000, 300_000, -900_000]);
  });

  it("'오늘' 은 오늘 움직인 금액으로 **다시** 세운다 — 총 손익 순서를 그대로 쓰면 3년 전에 번 돈이 오늘 자리에 앉는다", () => {
    /* 일부러 두 기간의 1등을 서로 다르게 잡았다. 한쪽 값으로 두 기간을
       다 세우는 뮤테이션(기간을 안 보고 pnlKRW 만 쓰기 등)은 순서가
       똑같아지므로 여기서 걸린다. */
    const 항목 = [
      종목({ symbol: "A", pnlKRW: 300_000, dailyChangeKRW: 700_000,
             costKRW: 1_000_000, currentValueKRW: 1_300_000 }),
      종목({ symbol: "B", pnlKRW: -900_000, dailyChangeKRW: 100_000,
             costKRW: 3_000_000, currentValueKRW: 2_100_000 }),
      종목({ symbol: "C", pnlKRW: 500_000, dailyChangeKRW: -200_000,
             costKRW: 1_000_000, currentValueKRW: 1_500_000 }),
    ];

    const 총 = 기여줄세우기(항목, "총");
    const 오늘 = 기여줄세우기(항목, "오늘");

    expect(심볼들(총)).toEqual(["C", "A", "B"]);
    expect(기여액들(총)).toEqual([500_000, 300_000, -900_000]);

    expect(심볼들(오늘)).toEqual(["A", "B", "C"]);
    expect(기여액들(오늘)).toEqual([700_000, 100_000, -200_000]);

    /* 순서만이 아니라 값도 다르다. 같은 배열을 두 번 돌려주면 여기서 끝난다 */
    expect(기여액들(오늘)).not.toEqual(기여액들(총));
  });
});


describe("같은 종목을 두 계좌에 나눠 담았을 때", () => {
  /* 연금저축 1,000,000 어치 + 일반계좌 3,000,000 어치.
     매입금액 대비 수익률이 계좌마다 30% / 10% 로 다르게 잡혀 있어서,
     "첫 줄만 쓴다" 같은 뮤테이션이 우연히 같은 값을 내지 못한다. */
    const 나눠담음 = () => [
      종목({ symbol: "005930", name: "삼성전자", portfolioId: 1,
             costKRW: 1_000_000, currentValueKRW: 1_300_000,
             pnlKRW: 300_000, dailyChangeKRW: 30_000 }),
      종목({ symbol: "005930", name: "삼성전자", portfolioId: 2,
             costKRW: 3_000_000, currentValueKRW: 3_300_000,
             pnlKRW: 300_000, dailyChangeKRW: -10_000 }),
      종목({ symbol: "000660", name: "SK하이닉스", portfolioId: 1,
             costKRW: 2_000_000, currentValueKRW: 2_100_000,
             pnlKRW: 100_000, dailyChangeKRW: 5_000 }),
    ];

  it("한 줄로 합친다 — 두 줄로 쪼개지면 그 종목의 몫이 실제보다 작아 보인다", () => {
    const 줄들 = 기여줄세우기(나눠담음(), "총");

    /* 삼성전자는 딱 한 줄 */
    expect(줄들.filter((r) => r.symbol === "005930")).toHaveLength(1);
    /* 다른 종목까지 뭉개지 않는다 */
    expect(심볼들(줄들)).toEqual(["005930", "000660"]);

    const 삼전 = 줄들[0];
    /* 기여액이 더해진다 — 안 더하면 300,000 이 되어 SK하이닉스보다
       겨우 앞서는 정도로 보인다 */
    expect(삼전.기여액).toBe(600_000);
    /* 원가도 더해진다: 600,000 / 4,000,000 = 15%.
       한쪽 원가만 쓰면 30%(1,000,000) 또는 20%(3,000,000) 가 나온다 */
    expect(삼전.비율).not.toBeNull();
    expect(삼전.비율!).toBeCloseTo(15, 10);
  });

  it("'오늘' 도 합쳐서 센다 — 어제 평가액까지 더해야 비율이 맞는다", () => {
    const 줄들 = 기여줄세우기(나눠담음(), "오늘");
    const 삼전 = 줄들.find((r) => r.symbol === "005930")!;

    expect(줄들.filter((r) => r.symbol === "005930")).toHaveLength(1);
    /* 30,000 + (-10,000) = 20,000. 한쪽만 쓰면 30,000 이나 -10,000 이 된다 */
    expect(삼전.기여액).toBe(20_000);

    /* 어제 평가액 = (1,300,000 - 30,000) + (3,300,000 + 10,000) = 4,580,000
       20,000 / 4,580,000 = 0.4366812...%
       · 한쪽 계좌만 쓰면 2.3622% 또는 -0.3021%
       · 어제가 아니라 오늘 평가액(4,600,000)을 쓰면 0.4348% */
    expect(삼전.비율).not.toBeNull();
    expect(삼전.비율!).toBeCloseTo(0.4366812227, 8);
  });

  it("두 계좌 손익이 서로 지워져 0 이 되면 그 종목만 빠진다 — 합친 다음에 거른다는 뜻", () => {
    const 줄들 = 기여줄세우기([
      종목({ symbol: "A", costKRW: 500_000, currentValueKRW: 600_000, pnlKRW: 100_000 }),
      종목({ symbol: "A", costKRW: 500_000, currentValueKRW: 400_000, pnlKRW: -100_000 }),
      종목({ symbol: "B", costKRW: 500_000, currentValueKRW: 700_000, pnlKRW: 200_000 }),
    ], "총");

    /* 합치기 전에 걸렀다면 A 가 +100,000 / -100,000 두 줄로 남는다 */
    expect(심볼들(줄들)).toEqual(["B"]);
  });
});


describe("비율 — 무엇 대비인가", () => {
  it("'총' 은 매입금액 대비, '오늘' 은 어제 평가액 대비 — 분모를 바꿔 쓰면 그럴듯하게 틀린다", () => {
    /* 매입 2,000,000 → 지금 3,000,000, 그중 오늘 오른 것이 600,000.
       어제 평가액 = 3,000,000 - 600,000 = 2,400,000.

       기대값        총 50%          오늘 25%
       분모를 바꾸면 총 41.67%(어제)  오늘 30%(원가)
                     총 33.33%(평가)  오늘 20%(오늘 평가액)
       네 경우가 다 다른 값이라 어느 쪽으로 틀려도 걸린다. */
    const 항목 = [종목({
      symbol: "A", costKRW: 2_000_000, currentValueKRW: 3_000_000,
      pnlKRW: 1_000_000, dailyChangeKRW: 600_000,
    })];

    const 총 = 기여줄세우기(항목, "총")[0];
    expect(총.비율).not.toBeNull();
    expect(총.비율!).toBeCloseTo(50, 10);

    const 오늘 = 기여줄세우기(항목, "오늘")[0];
    expect(오늘.비율).not.toBeNull();
    expect(오늘.비율!).toBeCloseTo(25, 10);
  });

  it("공짜로 받아 매입금액이 0 이면 '총' 비율은 null 이다 — 0% 라고 적으면 '안 움직였다' 가 된다", () => {
    const 항목 = [종목({
      symbol: "무상주", costKRW: 0, currentValueKRW: 500_000,
      pnlKRW: 500_000, dailyChangeKRW: 10_000,
    })];

    const 총 = 기여줄세우기(항목, "총")[0];
    /* toBeCloseTo(0) 은 null 도 통과한다. null 인지를 직접 못 박는다 */
    expect(총.비율).toBeNull();
    expect(총.비율).not.toBe(0);
    /* 줄 자체는 남아 있어야 한다 — 500,000원을 벌긴 벌었다 */
    expect(총.기여액).toBe(500_000);

    /* 같은 종목이라도 '오늘' 은 분모가 살아 있으므로 비율이 나온다.
       10,000 / (500,000 - 10,000) = 2.0408...% */
    const 오늘 = 기여줄세우기(항목, "오늘")[0];
    expect(오늘.비율).not.toBeNull();
    expect(오늘.비율!).toBeCloseTo(2.0408163265, 8);
  });

  it("어제 평가액이 0 이면 '오늘' 비율은 null 이다 — 어제 없던 종목에 0% 를 적으면 안 된다", () => {
    /* 오늘 처음 값이 붙어 평가액 전부가 오늘 변동인 경우 */
    const 항목 = [종목({
      symbol: "신규", costKRW: 50_000, currentValueKRW: 80_000,
      pnlKRW: 30_000, dailyChangeKRW: 80_000,
    })];

    const 오늘 = 기여줄세우기(항목, "오늘")[0];
    expect(오늘.비율).toBeNull();
    expect(오늘.비율).not.toBe(0);
    expect(오늘.기여액).toBe(80_000);

    /* '총' 쪽 분모(매입금액 50,000)는 멀쩡하다: 30,000 / 50,000 = 60% */
    const 총 = 기여줄세우기(항목, "총")[0];
    expect(총.비율).not.toBeNull();
    expect(총.비율!).toBeCloseTo(60, 10);
  });
});


describe("목록에서 빼는 줄", () => {
  it("기여액이 정확히 0 이면 뺀다 — 현금은 내 수익을 만든 적이 없다", () => {
    const 항목 = [
      종목({ symbol: "KRW", name: "원화예수금", costKRW: 5_000_000,
             currentValueKRW: 5_000_000, pnlKRW: 0, dailyChangeKRW: 0 }),
      종목({ symbol: "A", costKRW: 1_000_000, currentValueKRW: 1_400_000,
             pnlKRW: 400_000, dailyChangeKRW: 40_000 }),
    ];

    expect(심볼들(기여줄세우기(항목, "총"))).toEqual(["A"]);
    expect(심볼들(기여줄세우기(항목, "오늘"))).toEqual(["A"]);
  });

  it("오늘 등락을 아직 못 받은 종목은 '오늘' 에서만 빠진다 — 없는 값을 0원 기여로 세우지 않는다", () => {
    const 항목 = [
      /* 시세를 아직 못 받아 dailyChangeKRW 가 없는 종목 */
      종목({ symbol: "시세없음", costKRW: 1_000_000, currentValueKRW: 1_200_000,
             pnlKRW: 200_000 }),
      /* 반대로 본전인데 오늘만 움직인 종목 */
      종목({ symbol: "오늘만", costKRW: 1_000_000, currentValueKRW: 1_000_000,
             pnlKRW: 0, dailyChangeKRW: 40_000 }),
    ];

    expect(심볼들(기여줄세우기(항목, "총"))).toEqual(["시세없음"]);
    expect(심볼들(기여줄세우기(항목, "오늘"))).toEqual(["오늘만"]);
  });
});


describe("막대기준 — 무엇을 100% 로 잡나", () => {
  it("크게 잃은 종목이 기준이 될 수 있다 — 양수만 보면 손실 막대가 칸을 뚫는다", () => {
    /* Math.max(...양수만) 이면 300,000 이 나오고,
       -900,000 짜리 막대는 300% 가 되어 화면 밖으로 나간다 */
    expect(막대기준([가짜줄(300_000), 가짜줄(-900_000)])).toBe(900_000);
  });

  it("전부 손실이어도 기준을 찾는다 — 손실만 있는 날이 있다", () => {
    /* 양수만 보는 구현이면 여기서 0 이 나와 막대가 전부 사라진다 */
    expect(막대기준([가짜줄(-500_000), 가짜줄(-200_000)])).toBe(500_000);
  });

  it("이익이 더 크면 이익이 기준이다", () => {
    expect(막대기준([가짜줄(700_000), 가짜줄(-100_000)])).toBe(700_000);
  });

  it("줄이 하나도 없으면 0 — 여기서 0으로 나누지 않게 막는다", () => {
    expect(막대기준([])).toBe(0);
  });
});


describe("화면", () => {
  it("기간 칩을 누르면 목록도 합계도 같이 바뀐다", async () => {
    render(<수익기여 항목={[
      /* 오래 들고 벌었지만 오늘은 안 움직인 종목 */
      종목({ symbol: "L", name: "장기수익", costKRW: 1_000_000,
             currentValueKRW: 1_500_000, pnlKRW: 500_000, dailyChangeKRW: 0 }),
      /* 본전인데 오늘만 오른 종목 */
      종목({ symbol: "T", name: "오늘급등", costKRW: 1_000_000,
             currentValueKRW: 1_000_000, pnlKRW: 0, dailyChangeKRW: 300_000 }),
    ]} />);

    /* 처음에는 '총' */
    expect(기간칩("총")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("장기수익")).toBeInTheDocument();
    expect(screen.queryByText("오늘급등")).not.toBeInTheDocument();
    /* 합계는 머리글 안에서만 본다 — 줄에도 같은 금액이 있다 */
    const 총머리 = screen.getByText("평가손익 합계").parentElement!;
    expect(within(총머리).getByText("+₩500,000")).toBeInTheDocument();
    /* 500,000 / 1,000,000 = 50% */
    expect(줄칸("장기수익").textContent).toContain("(+50.00%)");

    await userEvent.click(기간칩("오늘"));

    expect(기간칩("오늘")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("오늘급등")).toBeInTheDocument();
    expect(screen.queryByText("장기수익")).not.toBeInTheDocument();
    const 오늘머리 = screen.getByText("오늘 손익 합계").parentElement!;
    expect(within(오늘머리).getByText("+₩300,000")).toBeInTheDocument();
    /* 어제 평가액 = 1,000,000 - 300,000 = 700,000 → 42.86%.
       원가(1,000,000) 로 나누면 30.00% 가 되어 여기서 걸린다 */
    expect(줄칸("오늘급등").textContent).toContain("(+42.86%)");
  });

  it("일곱 줄이면 여섯 줄만 보이고 '나머지 1개 더 보기' 가 나온다", () => {
    render(<수익기여 항목={Array.from({ length: 7 }, (_, i) =>
      종목({ symbol: `S${i}`, name: `종목${i + 1}`, costKRW: 1_000_000,
             currentValueKRW: 1_000_000 + (700_000 - i * 100_000),
             pnlKRW: 700_000 - i * 100_000 }))} />);

    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    expect(screen.getByText("종목6")).toBeInTheDocument();
    expect(screen.queryByText("종목7")).not.toBeInTheDocument();
    /* '나머지 N개' 의 N 까지 본다 — 처음보일줄 을 5 나 7 로 바꾸면 값이 달라진다 */
    expect(screen.getByRole("button", { name: "나머지 1개 더 보기" })).toBeInTheDocument();
  });

  it("여섯 줄이면 다 보이고 더 보기가 아예 없다 — 경계에서 '나머지 0개 더 보기' 가 뜨면 안 된다", () => {
    render(<수익기여 항목={Array.from({ length: 6 }, (_, i) =>
      종목({ symbol: `S${i}`, name: `종목${i + 1}`, costKRW: 1_000_000,
             currentValueKRW: 1_000_000 + (700_000 - i * 100_000),
             pnlKRW: 700_000 - i * 100_000 }))} />);

    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    expect(screen.getByText("종목6")).toBeInTheDocument();
    expect(screen.queryByText(/더 보기/)).not.toBeInTheDocument();
  });

  it("더 보기를 누르면 나머지가 펼쳐지고 다시 접을 수 있다", async () => {
    render(<수익기여 항목={Array.from({ length: 7 }, (_, i) =>
      종목({ symbol: `S${i}`, name: `종목${i + 1}`, costKRW: 1_000_000,
             currentValueKRW: 1_000_000 + (700_000 - i * 100_000),
             pnlKRW: 700_000 - i * 100_000 }))} />);

    await userEvent.click(screen.getByRole("button", { name: "나머지 1개 더 보기" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(7);
    expect(screen.getByText("종목7")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "접기" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    expect(screen.queryByText("종목7")).not.toBeInTheDocument();
  });

  it("줄이 하나도 없으면 기간에 맞는 안내를 한다 — 빈 칸만 남으면 고장으로 읽힌다", async () => {
    const { unmount } = render(<수익기여 항목={[]} />);
    expect(screen.getByText("아직 손익이 잡힌 종목이 없어요")).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
    unmount();

    /* 손익은 있는데 오늘은 아무도 안 움직인 경우 — 안내 문구가 서로 바뀌면 걸린다 */
    render(<수익기여 항목={[
      종목({ symbol: "A", costKRW: 1_000_000, currentValueKRW: 1_500_000,
             pnlKRW: 500_000, dailyChangeKRW: 0 }),
    ]} />);
    await userEvent.click(기간칩("오늘"));
    expect(screen.getByText("오늘 움직인 종목이 아직 없어요")).toBeInTheDocument();
    expect(screen.queryByText("아직 손익이 잡힌 종목이 없어요")).not.toBeInTheDocument();
  });

  it("막대는 절댓값이 제일 큰 줄을 100% 로 잡는다 — 손실이 제일 커도 마찬가지다", () => {
    render(<수익기여 항목={[
      종목({ symbol: "W", name: "작은이익", costKRW: 1_000_000,
             currentValueKRW: 1_300_000, pnlKRW: 300_000 }),
      종목({ symbol: "L", name: "큰손실", costKRW: 3_000_000,
             currentValueKRW: 2_100_000, pnlKRW: -900_000 }),
    ]} />);

    /* 기준이 900,000 이면 손실 막대가 100%, 이익 막대가 33.33%.
       양수만 보고 300,000 을 기준으로 잡으면 손실 막대가 300% 가 된다 */
    expect(막대폭(줄칸("큰손실"))).toBeCloseTo(100, 6);
    expect(막대폭(줄칸("작은이익"))).toBeCloseTo(33.3333, 3);
  });

  it("아주 조금 기여한 줄도 막대가 남는다 — 길이가 0 이 되면 '기여가 없다' 로 보인다", () => {
    render(<수익기여 항목={[
      종목({ symbol: "B", name: "큰놈", costKRW: 1_000_000,
             currentValueKRW: 2_000_000, pnlKRW: 1_000_000 }),
      종목({ symbol: "S", name: "작은놈", costKRW: 1_000_000,
             currentValueKRW: 1_001_000, pnlKRW: 1_000 }),
    ]} />);

    /* 1,000 / 1,000,000 = 0.1% — 그대로 그리면 눈에 안 보인다.
       바닥을 2% 로 받쳐 준다. 그래도 큰놈(100%)과는 확실히 다르다 */
    expect(막대폭(줄칸("큰놈"))).toBeCloseTo(100, 6);
    expect(막대폭(줄칸("작은놈"))).toBeCloseTo(2, 6);
  });

  it("비율이 없는 줄에는 괄호를 안 붙인다 — '(+0.00%)' 는 '안 움직였다' 는 거짓말이다", () => {
    render(<수익기여 항목={[
      종목({ symbol: "무상주", name: "무상주", costKRW: 0,
             currentValueKRW: 400_000, pnlKRW: 400_000 }),
      종목({ symbol: "보통주", name: "보통주", costKRW: 1_000_000,
             currentValueKRW: 1_500_000, pnlKRW: 500_000 }),
    ]} />);

    /* 줄 안에서만 본다 — 화면 전체로 보면 옆 줄의 괄호가 걸린다 */
    expect(줄칸("무상주").textContent).toContain("+₩400,000");
    expect(줄칸("무상주").textContent).not.toContain("(");
    expect(줄칸("보통주").textContent).toContain("(+50.00%)");
  });

  it("줄을 누르면 **누른 그 줄** 정보로 onSelect 가 불린다 — 첫 줄을 넘기면 엉뚱한 종목이 열린다", async () => {
    const 고름 = vi.fn();
    render(<수익기여 onSelect={고름} 항목={[
      종목({ symbol: "A", name: "첫째", costKRW: 1_000_000,
             currentValueKRW: 1_500_000, pnlKRW: 500_000 }),
      종목({ symbol: "B", name: "둘째", costKRW: 1_000_000,
             currentValueKRW: 1_200_000, pnlKRW: 200_000 }),
    ]} />);

    await userEvent.click(screen.getByRole("button", { name: /둘째/ }));

    expect(고름).toHaveBeenCalledTimes(1);
    const 넘긴것: 기여줄 = 고름.mock.calls[0][0];
    expect(넘긴것.symbol).toBe("B");
    expect(넘긴것.name).toBe("둘째");
    expect(넘긴것.기여액).toBe(200_000);
    expect(넘긴것.비율).not.toBeNull();
    expect(넘긴것.비율!).toBeCloseTo(20, 10);
  });
});
