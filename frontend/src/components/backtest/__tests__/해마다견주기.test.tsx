/**
 * 해마다의 수익률을 **벤치마크와 해별로** 견주는가.
 *
 * ── 왜 해마다 견줘야 하나 ─────────────────────────────────
 *
 * 전체 수익률 하나로는 '언제 이겼나' 를 알 수 없다. 8년 중 6년을 지고도
 * 한 해에 몰아쳐서 총합만 이긴 조합과, 해마다 조금씩 꾸준히 이긴 조합은
 * 전혀 다른 것인데 합계는 비슷하게 나온다. 앞엣것은 운이었을 수 있고
 * 뒤엣것은 실력일 수 있다.
 *
 * 2008년·2022년 같은 하락장에서 어땠는지도 여기서만 보인다 —
 * '내 것 -35%, S&P500 -37%' 는 총 수익률 어디에도 안 나온다.
 *
 * ── 여기서 특히 못 박는 것 ────────────────────────────────
 *
 *   ① **두 막대가 같은 자로 재진다.** 각자 최대에 맞춰 늘리면 -5% 와
 *      -37% 가 같은 길이로 그려져, 눈으로 보는 것과 숫자가 서로 다른
 *      말을 한다.
 *   ② **해로 짝짓는다.** 차례로 짝지으면 한 해가 비었을 때 그 뒤가
 *      통째로 밀려 엉뚱한 해와 견주게 된다.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("@/store/settingsStore", () => ({
  useSettingsStore: (sel: any) => sel({ colorScheme: "green-up" }),
}));

import 자산배분결과화면 from "../AllocationResult";

const 바탕 = {
  start_date: "2016-01-04", end_date: "2021-12-30", years: 6,
  contributed: 10_000_000, final_value: 13_815_722, profit: 3_815_722,
  total_return: 38.16, twr_annual: 5.55, irr_annual: 5.5,
  mdd: 17.69, volatility: 12.0, sharpe: 0.5, dividends: null,
  yearly: [
    { year: 2019, return: 22.1 },
    { year: 2020, return: -5.0 },
    { year: 2021, return: 8.4 },
  ],
  curve: [{ date: "2016-01-04", value: 10_000_000 },
          { date: "2021-12-30", value: 13_815_722 }],
  currency: "KRW" as const,
  assets: [{ symbol: "AAA", market: "US", name: "AAA", weight: 1 }],
  skipped: [], fx_skipped: [], mixed_currency: false,
  costs_included: false, costs: null, cost_rate: null,
  data_interval: "daily" as const, risk_free_rate: 0, cash_rate: 0,
  benchmark: null as any, extended_from: {},
};

const 벤치 = {
  key: "spy", name: "S&P500", index_only: false,
  contributed: 10_000_000, final_value: 12_000_000,
  total_return: 20, twr_annual: 3.1, irr_annual: 3.0,
  mdd: 20, volatility: 13, sharpe: 0.3,
  yearly: [
    { year: 2019, return: 16.8 },
    { year: 2020, return: -37.0 },
    { year: 2021, return: 10.1 },
  ],
  curve: [{ date: "2016-01-04", value: 10_000_000 }],
};

function 그리기(b: any = null) {
  return render(<자산배분결과화면 r={{ ...바탕, benchmark: b } as never} />);
}

/** '해마다' 칸 **안에서만** 찾는다.
 *
 *  범위를 안 좁히면 요약표의 '내 조합' 까지 같이 잡혀서, 해마다 칸에
 *  범례가 없어도 검사가 통과한다(실제로 그렇게 짰다가 'Found multiple
 *  elements' 로 걸렸다). 제목이 든 Card 까지만 올라간다 —
 *  한 칸 더 올라가면 탭 전체가 잡힌다. */
function 해마다칸(): HTMLElement {
  const 카드 = screen.getByText("해마다").closest("div.flex.flex-col");
  if (!카드) throw new Error("해마다 칸을 못 찾았다");
  //: 정말 그 칸인지 확인 — 잘못 잡으면 검사가 조용히 뜻을 잃는다
  if (!카드.textContent?.includes("그해에 넣은 돈은 빼고")) {
    throw new Error("해마다 칸이 아닌 것을 잡았다");
  }
  return 카드 as HTMLElement;
}

/** 막대의 너비(%)를 style 에서 꺼낸다.
 *
 *  **못 읽은 값을 버리면 안 된다.** width:NaN% 를 걸러 내면 막대가
 *  하나도 안 그려졌을 때 빈 배열이 나오고, 그 위의 for 문이 한 번도
 *  안 돌아 검사가 통과해 버린다(실제로 0 으로 나누는 뮤테이션이
 *  그렇게 살아남았다). NaN 도 그대로 들고 온다. */
function 막대너비들(): number[] {
  return [...해마다칸().querySelectorAll<HTMLElement>('[style*="width"]')]
    .map((el) => parseFloat(el.style.width));
}

/** 그 해의 **막대** — 0 을 가운데 둔 자 위의 left/width(%). */
function 막대(해: number): { 왼쪽: number; 너비: number; 끝: number } {
  const el = 해줄(해).querySelector<HTMLElement>('[style*="width"]');
  if (!el) throw new Error(`${해} 막대를 못 찾았다`);
  const 왼쪽 = parseFloat(el.style.left);
  const 너비 = parseFloat(el.style.width);
  //: 막대 끝 — 0(50%)에서 먼 쪽
  return { 왼쪽, 너비, 끝: 왼쪽 <= 50 && 너비 > 0 && 왼쪽 + 너비 <= 50.01
                          ? 왼쪽 : 왼쪽 + 너비 };
}

/** 그 해의 **벤치마크 점** — 같은 자 위의 left(%). */
function 점(해: number): number | null {
  const el = 해줄(해).querySelector<HTMLElement>('[style*="left"]:not([style*="width"])');
  return el ? parseFloat(el.style.left) : null;
}

/** 그 해의 줄을 집어 온다 — 줄 안에서만 값을 본다.
 *
 *  칸 전체에서 '+10.1%' 를 찾으면 **몇 년도 줄에 있는지**를 안 본다.
 *  그러면 해가 한 칸씩 밀려 엉뚱한 해와 견줘져도 검사가 통과한다
 *  (실제로 그 뮤테이션이 살아남았다). */
function 해줄(해: number): HTMLElement {
  const 라벨 = within(해마다칸()).getByText(String(해));
  const 줄 = 라벨.parentElement;
  if (!줄) throw new Error(`${해} 줄을 못 찾았다`);
  return 줄 as HTMLElement;
}


describe("벤치마크가 있으면 해별로 나란히 보여 준다", () => {
  it("내 수익률과 벤치마크 수익률이 둘 다 보인다", () => {
    그리기(벤치);
    //: 해마다 **그 줄 안에** 내 값과 벤치마크 값이 나란히 있어야 한다
    expect(해줄(2019).textContent).toBe("2019+22.1%+16.8%");
    expect(해줄(2020).textContent).toBe("2020-5%-37%");
    expect(해줄(2021).textContent).toBe("2021+8.4%+10.1%");
  });

  it("어느 줄이 무엇인지 적는다", () => {
    /* 막대 두 개를 그려 놓고 뭐가 뭔지 안 적으면 색만 보고 추측하게
       된다. 추측이 반대면 결론이 통째로 뒤집힌다. */
    그리기(벤치);
    const 칸 = 해마다칸();
    expect(within(칸).getByText("내 조합")).toBeInTheDocument();
    expect(within(칸).getByText("S&P500")).toBeInTheDocument();
  });

  it("몇 해 중 몇 해를 앞섰는지 센다", () => {
    /* 2019 22.1>16.8 이김 · 2020 -5.0>-37.0 이김 · 2021 8.4<10.1 짐 */
    그리기(벤치);
    expect(screen.getByText(/3년 중 2년은 내 조합이 더 높았어요/))
      .toBeInTheDocument();
  });

  it("비긴 해는 '더 높았다' 에 안 넣는다", () => {
    /* 같은 수인데 '내 조합이 더 높았다' 고 세면, 비기기만 해도
       앞선 것처럼 읽힌다. 셈이 한 해만 틀려도 '8년 중 5년' 과
       '8년 중 4년' 은 전혀 다른 결론이 된다. */
    그리기({ ...벤치, yearly: [
      { year: 2019, return: 22.1 },   // 내 것과 **똑같다**
      { year: 2020, return: -37.0 },  // 내가 높다
      { year: 2021, return: 10.1 },   // 내가 낮다
    ] });
    expect(screen.getByText(/3년 중 1년은 내 조합이 더 높았어요/),
      "비긴 해를 이긴 해로 셌다").toBeInTheDocument();
  });

  it("'이겼다' 고 말하지 않는다", () => {
    /* 지난 성적이 앞으로를 뜻하지 않는데 '이겼어요' 는 그렇게 읽힌다.
       센 것만 적는다. */
    그리기(벤치);
    const 글 = 해마다칸().textContent ?? "";
    expect(글, "이겼다고 단정한다").not.toMatch(/이겼|승리|우위/);
  });
});


describe("막대와 점이 **같은 자** 위에 있다", () => {
  /* 자 = 두 줄을 통틀어 제일 큰 |값| = 37(벤치마크 2020).
     0 이 가운데(50%)이고 양 끝이 ±37% 다.
       +22.1 → 50 + 22.1/37*50 = 79.9
       -5.0  → 50 - 5.0/37*50  = 43.2
       +16.8 → 50 + 16.8/37*50 = 72.7
       -37.0 → 50 - 50         = 0     (왼쪽 끝) */
  const 자리 = (v: number) => 50 + (v / 37) * 50;

  it("0 이 가운데이고, 막대가 거기서 자란다", () => {
    그리기(벤치);
    const 위 = 막대(2019);
    expect(위.왼쪽, "오른 해인데 막대가 0 에서 안 자란다").toBeCloseTo(50, 0);
    expect(위.끝).toBeCloseTo(자리(22.1), 0);

    const 아래 = 막대(2020);
    expect(아래.왼쪽, "내린 해인데 막대가 왼쪽으로 안 자란다")
      .toBeCloseTo(자리(-5), 0);
    expect(아래.왼쪽 + 아래.너비).toBeCloseTo(50, 0);
  });

  it("0 선을 그린다 — 가운데가 어디인지 보여야 한다", () => {
    /* 0 을 가운데 두는 자인데 그 자리를 안 그리면, 막대가 어디서
       자라는지 눈으로 알 수 없다. 짧은 마이너스 막대와 짧은 플러스
       막대가 그냥 '가운데쯤의 작은 조각' 둘로 보인다. */
    그리기(벤치);
    const 선 = 해줄(2019).querySelector(".left-1\\/2.w-px");
    expect(선, "0 선이 없다 — 가운데가 어디인지 알 수 없다").not.toBeNull();
  });

  it("점이 같은 자 위에 찍힌다", () => {
    그리기(벤치);
    expect(점(2019), "벤치마크 점이 자를 안 따른다").toBeCloseTo(자리(16.8), 0);
    expect(점(2020)).toBeCloseTo(자리(-37), 0);
    expect(점(2021)).toBeCloseTo(자리(10.1), 0);
  });

  it("점이 막대 끝보다 안쪽이면 내가 앞선 해다", () => {
    /* 이 그림이 읽히려면 **자리로 대소가 드러나야** 한다. 왼쪽 끝에서
       길이만 늘리던 옛 방식이면 -37% 점이 +22% 막대보다 오른쪽에
       찍혀, 숫자와 그림이 정반대를 말한다. */
    그리기(벤치);
    //: 2019 — 내가 높다(22.1 > 16.8) → 점이 막대 끝보다 왼쪽(안쪽)
    expect(점(2019)!).toBeLessThan(막대(2019).끝);
    //: 2021 — 내가 낮다(8.4 < 10.1) → 점이 막대 끝보다 오른쪽(바깥)
    expect(점(2021)!).toBeGreaterThan(막대(2021).끝);
    //: 2020 — 둘 다 마이너스, 내가 덜 빠졌다(-5 > -37) → 점이 더 왼쪽
    expect(점(2020)!).toBeLessThan(막대(2020).끝);
  });

  it("두 줄이 같은 자로 재진다 — 벤치마크 최대가 끝에 닿는다", () => {
    /* 내 값만 보고 자를 정하면 자 = 22.1 이 되어, -37% 점이 왼쪽
       끝 밖으로 나가 잘린다(0% 에 눌려 붙는다). */
    그리기(벤치);
    expect(점(2020), "벤치마크 최댓값이 자 안에 안 들어온다").toBeCloseTo(0, 0);
    expect(막대(2019).끝, "내 값이 자를 꽉 채운다 — 벤치마크를 안 본 자다")
      .toBeLessThan(99);
  });

  it("벤치마크가 없으면 내 값들끼리 같은 자로 잰다", () => {
    //: 자 = 22.1 → +22.1 은 오른쪽 끝(100%), -5.0 은 50 - 5/22.1*50 = 38.7
    그리기(null);
    expect(막대(2019).끝).toBeCloseTo(100, 0);
    expect(막대(2020).왼쪽).toBeCloseTo(50 - (5 / 22.1) * 50, 0);
    expect(점(2019), "벤치마크가 없는데 점이 있다").toBeNull();
  });

  it("값이 다 0 이어도 0 으로 안 나눈다", () => {
    /* 0 으로 나누면 NaN 이 되고, width:NaN% 는 브라우저가 무시해서
       막대가 통째로 사라진다 — 자료가 없는 것처럼 보인다. */
    render(<자산배분결과화면 r={{
      ...바탕, benchmark: null,
      yearly: [{ year: 2019, return: 0 }, { year: 2020, return: 0 }],
    } as never} />);
    const 너비 = 막대너비들();
    //: **막대가 그려지기는 했는지** 먼저 본다 — 없으면 아래 for 가
    //  한 번도 안 돌아 검사가 그냥 통과한다
    expect(너비.length, "막대가 아예 안 그려졌다").toBe(2);
    for (const w of 너비) expect(Number.isNaN(w), `너비가 NaN 이다`).toBe(false);
  });
});


describe("해로 짝짓는다 — 차례로 짝짓지 않는다", () => {
  it("벤치마크에 없는 해는 내 값만 그린다", () => {
    /* 차례로 짝지으면 2020 이 빈 순간 그 뒤가 한 칸씩 밀려, 내
       2021 년이 벤치마크 2020 년과 견줘진다 — 둘 다 맞는 수인데
       비교만 틀리는, 제일 알아채기 어려운 모양이다. */
    그리기({ ...벤치, yearly: [{ year: 2019, return: 16.8 },
                               { year: 2021, return: 10.1 }] });
    //: **그 해 줄 안에** 그 해의 값이 있어야 한다
    expect(within(해줄(2019)).getByText("+16.8%")).toBeInTheDocument();
    expect(within(해줄(2021)).getByText("+10.1%")).toBeInTheDocument();
    /* 2020 은 벤치마크에 없다. 차례로 짝지으면 여기에 2021 의 10.1 이
       밀려 들어온다 — 둘 다 맞는 수인데 비교만 틀리는, 제일 알아채기
       어려운 모양이다. */
    expect(within(해줄(2020)).queryByText("+10.1%"),
      "2020 줄에 2021 의 값이 밀려 들어왔다").toBeNull();
    expect(해줄(2020).textContent, "2020 에 없는 벤치마크 값이 생겼다")
      .toBe("2020-5%");
  });

  it("겹치는 해만 세어 '몇 해 중' 을 말한다", () => {
    그리기({ ...벤치, yearly: [{ year: 2019, return: 16.8 }] });
    expect(screen.getByText(/1년 중 1년은/)).toBeInTheDocument();
  });
});


describe("벤치마크가 없거나 해마다를 안 줬을 때", () => {
  it("벤치마크가 없으면 견주는 줄을 안 그린다", () => {
    그리기(null);
    const 칸 = 해마다칸();
    expect(칸.textContent ?? "").not.toMatch(/년 중 .*년은/);
    //: 요약표에도 '내 조합' 이 있으므로 **이 칸 안에서만** 본다
    expect(within(칸).queryByText("내 조합")).toBeNull();
  });

  it("해마다가 안 온 벤치마크면 내 것만 그린다", () => {
    /* 예전에 저장된 응답에는 yearly 가 없다. 없다고 화면이 죽거나
       빈 막대를 그리면 안 된다. */
    const { yearly, ...해마다없는벤치 } = 벤치 as any;
    그리기(해마다없는벤치);
    expect(막대너비들().length).toBe(3);
    expect(within(해마다칸()).queryByText("내 조합")).toBeNull();
  });
});


describe("지수는 배당이 없다고 알린다", () => {
  it("index_only 면 해마다 칸에도 적는다", () => {
    /* 해마다 몇 %p 씩 불리하게 나온다. 이 표를 읽기 **전에** 알아야
       한다 — 다 읽고 나서 알면 이미 결론을 내린 뒤다. */
    그리기({ ...벤치, key: "kospi_index", name: "코스피", index_only: true });
    expect(within(해마다칸()).getByText(/지수라 배당이 빠져 있어요/))
      .toBeInTheDocument();
  });

  it("ETF 벤치마크에는 그 말을 안 붙인다", () => {
    그리기(벤치);
    expect(within(해마다칸()).queryByText(/지수라 배당이 빠져/)).toBeNull();
  });
});
