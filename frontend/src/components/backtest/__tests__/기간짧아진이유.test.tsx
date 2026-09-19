/**
 * **누구 때문에 기간이 짧아졌는지** 말하는가.
 *
 * ── 무엇이 문제였나 ────────────────────────────────────────
 *
 * 모든 자산에 값이 있는 날만 잰다 — 그 처리 자체는 맞다. 없는 쪽을
 * 0 으로 치면 포트폴리오가 반토막 난 것처럼 보이고, 마지막 값을 끌어다
 * 쓰면 상장 전에 이미 갖고 있던 셈이 된다.
 *
 * 문제는 **말을 안 했다는 것**이다. 화면에는 '2019-01-02 ~ 2021-12-30'
 * 만 떴다. 2016년부터 재려던 사람은 왜 사라졌는지 알 수 없고, 기간을
 * 늘려도 또 같은 결과가 나오고, 무엇을 빼야 길어지는지도 모른다.
 * '6년을 쟀다' 고 믿은 채 3년짜리 성적을 읽는 일도 생긴다.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/store/settingsStore", () => ({
  useSettingsStore: (sel: any) => sel({ colorScheme: "green-up" }),
}));

import 자산배분결과화면 from "../AllocationResult";

const 바탕 = {
  start_date: "2019-01-02", end_date: "2021-12-30", years: 3,
  requested_start: "2016-01-04", requested_end: "2021-12-30",
  contributed: 10_000_000, final_value: 12_000_000, profit: 2_000_000,
  total_return: 20, twr_annual: 6.3, irr_annual: 6.2,
  mdd: 12, volatility: 11, sharpe: 0.5, dividends: null,
  yearly: [{ year: 2019, return: 8 }],
  curve: [{ date: "2019-01-02", value: 10_000_000 },
          { date: "2021-12-30", value: 12_000_000 }],
  currency: "KRW" as const,
  assets: [
    { symbol: "AAA", market: "US", name: "오래된 ETF", weight: 0.5 },
    { symbol: "SPY", market: "US", name: "늦둥이 ETF", weight: 0.5 },
  ],
  asset_range: {
    AAA: { first: "2016-01-04", last: "2021-12-30" },
    SPY: { first: "2019-01-02", last: "2021-12-30" },
  },
  skipped: [], fx_skipped: [], mixed_currency: false,
  costs_included: false, costs: null, cost_rate: null,
  data_interval: "daily" as const, risk_free_rate: 0, cash_rate: 0,
  benchmark: null as any, extended_from: {},
};

const 그리기 = (더: any = {}) =>
  render(<자산배분결과화면 r={{ ...바탕, ...더 } as never} />);


describe("앞이 잘렸으면 범인을 지목한다", () => {
  it("늦게 상장한 자산의 **이름**을 말한다", () => {
    /* 종목 코드만 적으면 무엇인지 찾아봐야 한다. 화면의 다른 곳은
       이미 이름으로 부르고 있다. */
    그리기();
    expect(screen.getByText(/늦둥이 ETF/), "범인을 안 밝힌다").toBeInTheDocument();
  });

  it("언제부터 자료가 있는지와, 언제부터 요청했는지를 같이 적는다", () => {
    그리기();
    const 글 = screen.getByText(/늦둥이 ETF/).closest("p")!.textContent ?? "";
    expect(글, "실제 시작일이 없다").toMatch(/2019-01-02/);
    expect(글, "요청한 시작일이 없다 — 얼마나 잘렸는지 알 수 없다")
      .toMatch(/2016-01-04/);
  });

  it("무엇을 하면 되는지 알려 준다", () => {
    /* '못 쟀어요' 만으로는 할 일이 없다. 빼거나 확장을 켜면 된다는
       것이 실제로 쓸모 있는 정보다. */
    const 글 = (그리기(), screen.getByText(/늦둥이 ETF/).closest("p")!.textContent ?? "");
    expect(글).toMatch(/빼거나|확장/);
  });

  it("발목 잡지 않은 자산은 지목하지 않는다", () => {
    const 글 = (그리기(), screen.getByText(/늦둥이 ETF/).closest("p")!.textContent ?? "");
    expect(글, "멀쩡한 자산까지 범인으로 몬다").not.toMatch(/오래된 ETF/);
  });

  it("같은 날 시작하는 자산이 둘이면 **둘 다** 적는다", () => {
    /* 하나만 빼서는 기간이 안 늘어난다. 한쪽만 말하면 그걸 뺐는데도
       그대로인 이유를 알 수 없다. */
    그리기({
      assets: [
        { symbol: "AAA", market: "US", name: "오래된 ETF", weight: 0.4 },
        { symbol: "SPY", market: "US", name: "늦둥이 ETF", weight: 0.3 },
        { symbol: "QQQ", market: "US", name: "또다른 늦둥이", weight: 0.3 },
      ],
      asset_range: {
        AAA: { first: "2016-01-04", last: "2021-12-30" },
        SPY: { first: "2019-01-02", last: "2021-12-30" },
        QQQ: { first: "2019-01-02", last: "2021-12-30" },
      },
    });
    const 글 = screen.getByText(/늦둥이 ETF/).closest("p")!.textContent ?? "";
    expect(글).toMatch(/또다른 늦둥이/);
  });
});


describe("뒤가 잘린 것도 말한다", () => {
  it("일찍 끝난 자산을 지목한다", () => {
    /* 상장폐지·거래정지면 뒤가 잘린다. 앞이 잘린 것만 보면 '왜
       작년까지만 나오지' 를 영영 모른다. */
    그리기({
      start_date: "2016-01-04", requested_start: "2016-01-04",
      end_date: "2020-06-30", requested_end: "2021-12-30",
      asset_range: {
        AAA: { first: "2016-01-04", last: "2021-12-30" },
        SPY: { first: "2016-01-04", last: "2020-06-30" },
      },
    });
    const 글 = screen.getByText(/늦둥이 ETF/).textContent ?? "";
    expect(글).toMatch(/늦둥이 ETF/);
    expect(screen.getByText(/2020-06-30까지라/)).toBeInTheDocument();
  });
});


describe("멀쩡하면 아무 말도 안 한다", () => {
  it("요청한 대로 쟀으면 안 적는다", () => {
    /* 괜히 적으면 경고가 흔해져서, 정작 진짜 경고를 안 읽게 된다. */
    그리기({ start_date: "2016-01-04", requested_start: "2016-01-04" });
    expect(screen.queryByText(/못 쟀어요/)).toBeNull();
  });

  it("옛 응답처럼 asset_range 가 없으면 조용히 넘어간다", () => {
    /* 저장해 둔 실험을 다시 열면 이 칸이 없을 수 있다. 없다고
       화면이 죽으면 안 된다. */
    const { asset_range, ...옛것 } = 바탕 as any;
    expect(() => render(<자산배분결과화면 r={옛것 as never} />)).not.toThrow();
  });

  it("requested_start 가 없으면 짧아졌는지 단정하지 않는다", () => {
    const { requested_start, ...옛것 } = 바탕 as any;
    render(<자산배분결과화면 r={옛것 as never} />);
    expect(screen.queryByText(/그 앞은 못 쟀어요/)).toBeNull();
  });
});
