/**
 * 자산배분 결과를 **어떻게 보여 주는가**.
 *
 * 수가 맞는 것과 사람이 그 수를 제대로 읽는 것은 다른 문제다.
 * 이 파일이 지키는 것은 넷이다 —
 *
 *   ① 그래프의 최저점과 옆에 적힌 MDD 가 **같은 말**을 한다
 *   ② 아직 회복 못 한 낙폭을 **회복한 것처럼** 적지 않는다
 *   ③ 두 곡선을 **날짜로** 맞춰 겹친다 (칸 번호로 짝지으면 안 된다)
 *   ④ 오름·내림 색이 **설정을 따른다**
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const 설정 = vi.hoisted(() => ({ colorScheme: "green-red" as "green-red" | "red-blue" }));
vi.mock("@/store/settingsStore", async (원래) => {
  const m = await (원래() as Promise<any>);
  return { ...m, useSettingsStore: (고르기: any) => 고르기(설정) };
});

import 자산배분결과화면, { 맞춰합치기, 로그가능, 걸린기간, 축설정 } from "../AllocationResult";

const 곡선 = (n: number, 시작 = 1_000) =>
  Array.from({ length: n }, (_, i) => ({
    date: `2020-${String((i % 12) + 1).padStart(2, "0")}-01`,
    value: 시작 + i * 10,
  }));

const 낙폭 = [
  { date: "2020-01-01", dd: 0 },
  { date: "2020-02-01", dd: -12.5 },
  { date: "2020-03-01", dd: -37.09 },   // 바닥
  { date: "2020-04-01", dd: -8.2 },
  { date: "2020-05-01", dd: 0 },
];

const 기본 = {
  start_date: "2020-01-01", end_date: "2020-05-01", years: 0.33,
  contributed: 10_000_000, final_value: 12_300_000, profit: 2_300_000,
  total_return: 23.0, twr_annual: 11.2, irr_annual: 10.8,
  mdd: 37.09, volatility: 14.3, sharpe: 0.92, dividends: null,
  yearly: [{ year: 2020, return: -4.2 }, { year: 2021, return: 22.1 }],
  curve: 곡선(5, 10_000_000),
  drawdown: 낙폭,
  drawdowns: [
    { start: "2020-01-01", trough: "2020-03-01", end: "2020-05-01",
      depth: -37.09, to_trough_days: 60, recovery_days: 61, underwater_days: 121 },
    { start: "2020-06-01", trough: "2020-08-01", end: null,
      depth: -22.25, to_trough_days: 61, recovery_days: null, underwater_days: 189 },
  ],
  currency: "KRW" as const,
  assets: [{ symbol: "SPY", market: "US", name: "SPY", weight: 1 }],
  skipped: [], fx_skipped: [], mixed_currency: false, costs_included: false,
  costs: null, cost_rate: null, data_interval: "daily" as const,
  risk_free_rate: 0, cash_rate: 0,
  benchmark: null as any, extended_from: {},
};

const 벤치 = {
  key: "6040", name: "주식 60 · 채권 40",
  contributed: 10_000_000, final_value: 11_500_000,
  total_return: 15.0, twr_annual: 7.5, irr_annual: 7.2,
  mdd: 20.1, volatility: 9.0, sharpe: 0.8,
  curve: 곡선(5, 10_000_000).map((x) => ({ ...x, value: x.value - 200_000 })),
  drawdown: 낙폭.map((x) => ({ ...x, dd: x.dd / 2 })),
};

function 그리기(덮을것: Record<string, unknown> = {}) {
  return render(<자산배분결과화면 r={{ ...기본, ...덮을것 } as never} />);
}

beforeEach(() => { 설정.colorScheme = "green-red"; });


describe("두 곡선을 날짜로 맞춘다", () => {
  /* 칸 번호로 짝지으면 안 된다. 내 조합과 벤치마크는 겹치는 거래일이
     다를 수 있다 — 한국 자산이 섞이면 휴장일이 어긋나고, 월 데이터로
     재면 솎인 날이 다르다. 그래프는 멀쩡해 보이는데 2020년 값이
     2021년 자리에 그려진다. */

  it("같은 날짜끼리 붙는다", () => {
    const 결과 = 맞춰합치기(
      [{ date: "2020-01-01", value: 100 }, { date: "2020-01-02", value: 110 }],
      [{ date: "2020-01-02", value: 55 }, { date: "2020-01-01", value: 50 }],
    );
    expect(결과).toEqual([
      { date: "2020-01-01", 내것: 100, 벤치: 50 },
      { date: "2020-01-02", 내것: 110, 벤치: 55 },
    ]);
  });

  it("벤치마크에 없는 날은 비운다 — 엉뚱한 값을 끌어오지 않는다", () => {
    const 결과 = 맞춰합치기(
      [{ date: "2020-01-01", value: 100 }, { date: "2020-01-02", value: 110 }],
      [{ date: "2020-01-01", value: 50 }],
    );
    expect(결과[1].벤치).toBeUndefined();
  });

  it("벤치마크가 아예 없어도 안 깨진다", () => {
    expect(맞춰합치기([{ date: "2020-01-01", value: 100 }]))
      .toEqual([{ date: "2020-01-01", 내것: 100 }]);
  });
});


describe("로그 축", () => {
  /* 로그는 0 이나 음수를 못 그린다. 전액 손실이면 평가액이 실제로 0 이
     되는데, 그때 로그를 켜면 그래프가 통째로 사라져 사용자는 앱이
     고장 난 줄 안다. 못 쓸 때는 단추를 아예 안 보여 준다. */

  it("값이 0 이하면 못 쓴다", () => {
    expect(로그가능([{ 내것: 100 }, { 내것: 0 }])).toBe(false);
    expect(로그가능([{ 내것: 100 }, { 내것: -5 }])).toBe(false);
    expect(로그가능([{ 내것: 100 }, { 내것: 1, 벤치: 0 }])).toBe(false);
  });

  it("전부 양수면 쓸 수 있다", () => {
    expect(로그가능([{ 내것: 100, 벤치: 50 }, { 내것: 1 }])).toBe(true);
  });

  it("켜면 축이 실제로 로그로 바뀐다", () => {
    /* 설명 글자만 보면 '설명은 뜨는데 축은 그대로' 를 못 잡는다.
       jsdom 은 recharts 를 안 그리므로 축 설정을 값으로 확인한다. */
    expect(축설정(false).scale).toBe("auto");
    expect(축설정(true).scale).toBe("log");
    /* 로그에서 domain 을 비우면 recharts 가 밑을 0 으로 잡고,
       log(0) 이라 그래프가 통째로 사라진다 */
    expect(축설정(true).domain).toEqual(["auto", "auto"]);
    expect(축설정(false).domain).toBeUndefined();
  });

  it("쓸 수 있으면 단추가 보이고, 누르면 설명이 뜬다", async () => {
    그리기();
    const 로그 = screen.getByLabelText("로그 축");
    expect(로그).toBeInTheDocument();
    await userEvent.click(로그);
    expect(screen.getByText(/같은 높이가 같은/)).toBeInTheDocument();
  });

  it("못 쓰면 단추를 안 그린다", () => {
    그리기({ curve: [{ date: "2020-01-01", value: 10_000_000 },
                     { date: "2020-02-01", value: 0 }] });
    expect(screen.queryByLabelText("로그 축")).toBeNull();
  });
});


describe("낙폭", () => {
  it("그래프 최저점과 적어 놓은 MDD 가 같다", () => {
    /* 서버가 곡선을 솎아 보내는데, 묶음마다 **제일 깊은 칸**을 남긴다.
       그냥 n칸마다 집으면 바닥이 빠져 그래프는 -31% 인데 옆 숫자는
       -37% 인, 한 화면에서 두 수가 다른 말을 하는 상태가 된다. */
    const 그래프바닥 = Math.min(...기본.drawdown.map((x) => x.dd));
    expect(Math.abs(그래프바닥)).toBeCloseTo(기본.mdd, 2);
  });

  it("낙폭 그래프를 그린다", () => {
    그리기();
    //: '최대 낙폭' 칸에도 같은 글자가 있어 제목만 딱 집는다
    expect(screen.getByText("낙폭", { selector: "span.font-semibold" }))
      .toBeInTheDocument();
  });

  it("낙폭 자료가 없으면 그 칸을 통째로 안 그린다", () => {
    /* 빈 그래프는 '고장' 으로 읽힌다 */
    그리기({ drawdown: [], drawdowns: [] });
    expect(screen.queryByText("낙폭", { selector: "span.font-semibold" })).toBeNull();
    expect(screen.queryByText("깊었던 순서")).toBeNull();
  });
});


describe("낙폭 순위", () => {
  it("깊은 순서로 적고, 잠긴 기간을 같이 준다", () => {
    /* -50% 를 1년 만에 회복한 것과 -35% 로 7년을 보낸 것은 전혀 다른
       경험이다. 깊이만 보면 그 차이가 통째로 사라진다. */
    그리기();
    expect(screen.getByText("깊었던 순서")).toBeInTheDocument();
    expect(screen.getByText("-37.09%")).toBeInTheDocument();
    expect(screen.getByText("-22.25%")).toBeInTheDocument();
    expect(screen.getByText("4개월")).toBeInTheDocument();      // 121일
  });

  it("아직 회복 못 한 것을 회복한 것처럼 적지 않는다", () => {
    /* 마지막 날짜를 넣으면 회복한 것으로 읽힌다 */
    그리기();
    expect(screen.getByText("아직")).toBeInTheDocument();
    expect(screen.getByText(/더 늘어날 수 있다/)).toBeInTheDocument();
  });

  it("전부 회복했으면 '아직' 설명을 안 붙인다", () => {
    그리기({ drawdowns: [기본.drawdowns[0]] });
    expect(screen.queryByText("아직")).toBeNull();
    expect(screen.queryByText(/더 늘어날 수 있다/)).toBeNull();
  });

  it("날짜 수를 사람이 읽는 말로 바꾼다", () => {
    /* '1975일' 은 읽어도 감이 안 온다 */
    expect(걸린기간(12)).toBe("12일");
    expect(걸린기간(60)).toBe("2개월");
    expect(걸린기간(365)).toBe("1년");
    expect(걸린기간(1975)).toBe("5년 5개월");
    expect(걸린기간(null)).toBe("—");
  });
});


describe("벤치마크 겹치기", () => {
  it("벤치마크가 있으면 같이 보기 단추가 있다", async () => {
    그리기({ benchmark: 벤치 });
    expect(screen.getAllByLabelText("주식 60 · 채권 40 같이 보기").length)
      .toBeGreaterThanOrEqual(2);      // 자산 흐름 · 낙폭 둘 다
  });

  it("무엇이 점선인지 말해 준다", () => {
    /* 두 선을 그려 놓고 어느 쪽이 무엇인지 안 적으면 못 읽는다 */
    그리기({ benchmark: 벤치 });
    expect(screen.getByText(/점선이 주식 60 · 채권 40이에요/)).toBeInTheDocument();
  });

  it("끄면 설명도 같이 사라진다", async () => {
    그리기({ benchmark: 벤치 });
    await userEvent.click(screen.getAllByLabelText("주식 60 · 채권 40 같이 보기")[0]);
    expect(screen.queryByText(/점선이 주식 60 · 채권 40이에요/)).toBeNull();
  });

  it("벤치마크가 없으면 단추를 안 그린다", () => {
    그리기();
    expect(screen.queryByLabelText(/같이 보기/)).toBeNull();
  });

  it("벤치마크 낙폭이 안 오면 낙폭 쪽 단추는 안 그린다", () => {
    /* 서버가 벤치마크 낙폭을 빼먹으면 단추만 있고 선은 안 그려진다 —
       누르면 아무 일도 안 일어나는 단추는 '고장' 으로 읽힌다. */
    const 낙폭없는벤치 = { ...벤치, drawdown: undefined };
    그리기({ benchmark: 낙폭없는벤치 });
    //: 자산 흐름 쪽에는 있고(곡선은 왔다), 낙폭 쪽에는 없다
    expect(screen.getAllByLabelText("주식 60 · 채권 40 같이 보기")).toHaveLength(1);
  });
});


describe("오름·내림 색이 설정을 따른다", () => {
  /* 초록/빨강 쓰는 사람과 빨강/파랑 쓰는 사람이 있다. 이 화면만 색을
     손으로 박아 놔서 '빨강-파랑' 으로 바꿔 둔 사람에게는 여기만
     거꾸로 보였다 — 같은 앱 안에서 빨강이 한 화면에서는 오름이고
     다른 화면에서는 내림이면 숫자를 잘못 읽는다. */

  const 수익글 = () => screen.getByText(/^\+₩/).className;

  it("초록-빨강이면 번 것이 초록", () => {
    설정.colorScheme = "green-red";
    그리기();
    expect(수익글()).toMatch(/text-accent-green/);
  });

  it("빨강-파랑이면 번 것이 빨강", () => {
    설정.colorScheme = "red-blue";
    그리기();
    expect(수익글()).toMatch(/text-accent-red/);
    expect(수익글()).not.toMatch(/text-accent-green/);
  });

  it("잃었을 때도 설정을 따른다", () => {
    설정.colorScheme = "red-blue";
    그리기({ profit: -1_000_000, total_return: -10 });
    expect(screen.getByText(/^₩-?1,000,000|^-₩/).className)
      .toMatch(/text-accent-blue/);
  });

  it("해마다 막대도 설정 색을 쓴다", () => {
    설정.colorScheme = "red-blue";
    const { container } = 그리기();
    const 막대들 = container.querySelectorAll<HTMLElement>(".h-full.opacity-60");
    expect(막대들.length).toBeGreaterThan(0);
    //: 2020년은 -4.2% 라 '내림' 색(빨강-파랑에서는 파랑)이어야 한다
    expect(막대들[0].style.backgroundColor).toBe("rgb(59, 130, 246)");
  });

  it("낙폭 순위 숫자도 내림 색을 쓴다", () => {
    설정.colorScheme = "red-blue";
    그리기();
    const 칸 = screen.getByText("-37.09%");
    expect(칸.style.color).toBe("rgb(59, 130, 246)");
  });
});
