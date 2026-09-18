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
  sortino: 1.31, monthly: [{ month: "2020-02", return: -12.5 },
                           { month: "2020-03", return: 8.2 }],
  best_month: 8.2, worst_month: -12.5,
  positive_months: 1, total_months: 2,
  this_month: 8.2, ytd: 23.0,
  return_1y: 44.0, return_3y: 127.3, return_5y: null,
  std_1y: 23.1, std_3y: 14.9, std_5y: null,
  mdd_date: "2020-03-01",
  crises: [
    { key: "covid", name: "코로나", start: "2020-02-19", end: "2020-03-23",
      return: -28.4, measured_start: "2020-02-19", measured_end: "2020-03-23",
      partial: false },
    { key: "gfc", name: "미국 금융위기", start: "2007-10-09", end: "2009-03-09",
      return: -5.4, measured_start: "2008-06-02", measured_end: "2009-03-09",
      partial: true },
  ],
  currency: "KRW" as const,
  assets: [{ symbol: "SPY", market: "US", name: "S&P 500", weight: 0.6 },
           { symbol: "TLT", market: "US", name: "미국 장기국채", weight: 0.4 }],
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
  sortino: 0.95, best_month: 5.1, worst_month: -6.0,
  positive_months: 1, total_months: 2, this_month: 5.1, ytd: 15.0,
  return_1y: 8.9, return_3y: 50.4, return_5y: null,
  std_1y: 11.8, std_3y: 9.4, std_5y: null,
  mdd_date: "2020-02-01",
  crises: [{ key: "covid", name: "코로나", return: -15.2 }],
};

function 그리기(덮을것: Record<string, unknown> = {}) {
  return render(<자산배분결과화면 r={{ ...기본, ...덮을것 } as never} />);
}

/** 결과가 넷(수익률·낙폭·지표·세부)으로 갈렸다. 카드가 계속 늘어
 *  폰에서 한참 스크롤해야 무엇이 있는지 알 수 있었기 때문이다.
 *  검사도 그 탭을 열고 봐야 한다. */
async function 탭열기(이름: string) {
  await userEvent.click(screen.getByRole("tab", { name: 이름 }));
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

  it("낙폭 그래프를 그린다", async () => {
    그리기();
    await 탭열기("낙폭");
    //: '최대 낙폭' 칸에도 같은 글자가 있어 제목만 딱 집는다
    expect(screen.getByText("낙폭", { selector: "span.font-semibold" }))
      .toBeInTheDocument();
  });

  it("낙폭 자료가 없으면 그 칸을 통째로 안 그린다", async () => {
    /* 빈 그래프는 '고장' 으로 읽힌다 */
    그리기({ drawdown: [], drawdowns: [] });
    await 탭열기("낙폭");
    expect(screen.queryByText("낙폭", { selector: "span.font-semibold" })).toBeNull();
    expect(screen.queryByText("깊었던 순서")).toBeNull();
  });
});


describe("낙폭 순위", () => {
  it("깊은 순서로 적고, 잠긴 기간을 같이 준다", async () => {
    /* -50% 를 1년 만에 회복한 것과 -35% 로 7년을 보낸 것은 전혀 다른
       경험이다. 깊이만 보면 그 차이가 통째로 사라진다. */
    그리기();
    await 탭열기("낙폭");
    expect(screen.getByText("깊었던 순서")).toBeInTheDocument();
    expect(screen.getByText("-37.09%")).toBeInTheDocument();
    expect(screen.getByText("-22.25%")).toBeInTheDocument();
    expect(screen.getByText("4개월")).toBeInTheDocument();      // 121일
  });

  it("아직 회복 못 한 것을 회복한 것처럼 적지 않는다", async () => {
    /* 마지막 날짜를 넣으면 회복한 것으로 읽힌다 */
    그리기();
    await 탭열기("낙폭");
    expect(screen.getByText("아직")).toBeInTheDocument();
    expect(screen.getByText(/더 늘어날 수 있다/)).toBeInTheDocument();
  });

  it("전부 회복했으면 '아직' 설명을 안 붙인다", async () => {
    그리기({ drawdowns: [기본.drawdowns[0]] });
    await 탭열기("낙폭");
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
    /* 자산 흐름과 낙폭이 다른 탭이라 각각 확인한다 */
    그리기({ benchmark: 벤치 });
    expect(screen.getByLabelText("주식 60 · 채권 40 같이 보기")).toBeInTheDocument();
    await 탭열기("낙폭");
    expect(screen.getByLabelText("주식 60 · 채권 40 같이 보기")).toBeInTheDocument();
  });

  it("무엇이 점선인지 말해 준다", () => {
    /* 두 선을 그려 놓고 어느 쪽이 무엇인지 안 적으면 못 읽는다 */
    그리기({ benchmark: 벤치 });
    expect(screen.getByText(/점선이 주식 60 · 채권 40이에요/)).toBeInTheDocument();
  });

  it("색 이름으로 좋고 나쁨을 말하지 않는다", async () => {
    /* 설정에서 초록-빨강과 빨강-파랑을 고를 수 있다. '초록이면 좋다'
       는 설명은 절반의 사람에게 거짓이 된다 — 색은 칠하되 글로는
       말하지 않는다. */
    그리기({ benchmark: 벤치 });
    const 글 = document.body.textContent ?? "";
    expect(글, "색 이름으로 좋고 나쁨을 말한다").not.toMatch(/초록이면|빨강이면|파랑이면/);
    //: 색만으로는 알 수 없는 것은 그대로 남긴다
    expect(글).toMatch(/낙폭은 작은 쪽이 나은 거예요/);
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

  it("벤치마크 낙폭이 안 오면 낙폭 쪽 단추는 안 그린다", async () => {
    /* 서버가 벤치마크 낙폭을 빼먹으면 단추만 있고 선은 안 그려진다 —
       누르면 아무 일도 안 일어나는 단추는 '고장' 으로 읽힌다. */
    const 낙폭없는벤치 = { ...벤치, drawdown: undefined };
    그리기({ benchmark: 낙폭없는벤치 });
    //: 자산 흐름 쪽에는 있고(곡선은 왔다), 낙폭 쪽에는 없다
    expect(screen.getByLabelText("주식 60 · 채권 40 같이 보기")).toBeInTheDocument();
    await 탭열기("낙폭");
    expect(screen.queryByLabelText("주식 60 · 채권 40 같이 보기")).toBeNull();
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

  it("낙폭 순위 숫자도 내림 색을 쓴다", async () => {
    설정.colorScheme = "red-blue";
    그리기();
    await 탭열기("낙폭");
    const 칸 = screen.getByText("-37.09%");
    expect(칸.style.color).toBe("rgb(59, 130, 246)");
  });
});


describe("결과를 넷으로 나눠 본다", () => {
  /* 카드가 계속 늘어 폰에서 한참 스크롤해야 무엇이 있는지 알 수 있었다.
     수익률로 시작하는 것은 사람이 제일 먼저 묻는 것이 '얼마나 벌었나'
     이기 때문이다. */

  it("네 탭이 있고 수익률로 시작한다", () => {
    그리기();
    for (const 이름 of ["수익률", "낙폭", "지표", "세부"]) {
      expect(screen.getByRole("tab", { name: 이름 }), `${이름} 탭이 없다`).toBeInTheDocument();
    }
    expect(screen.getByRole("tab", { name: "수익률" }).getAttribute("aria-selected")).toBe("true");
  });

  it("탭을 옮기면 내용이 바뀐다", async () => {
    그리기();
    expect(screen.getByText("자산 흐름")).toBeInTheDocument();
    await 탭열기("지표");
    expect(screen.queryByText("자산 흐름")).toBeNull();
    expect(screen.getByText("주요 지표")).toBeInTheDocument();
  });

  it("빼고 계산한 것은 **탭 밖**에서 늘 보인다", async () => {
    /* 자산 하나를 빼고 계산한 사실이 탭 안에 숨으면, 그 탭을 안 연
       사람은 덜 담긴 결과를 온전한 것으로 읽는다. */
    그리기({ skipped: ["TLT"] });
    for (const 탭 of ["수익률", "낙폭", "지표", "세부"]) {
      await 탭열기(탭);
      expect(screen.getByText(/일부 자산을 빼고 계산했어요/),
        `${탭} 탭에서 경고가 사라진다`).toBeInTheDocument();
    }
  });

  it("수수료를 안 넣었다는 것도 탭 밖에서 늘 보인다", async () => {
    /* 이건 각주가 아니라 **보고 있는 숫자의 조건**이다 */
    그리기();
    for (const 탭 of ["수익률", "낙폭", "지표", "세부"]) {
      await 탭열기(탭);
      expect(screen.getByText(/수수료·세금·슬리피지는 반영하지 않았어요/),
        `${탭} 탭에서 수수료 안내가 사라진다`).toBeInTheDocument();
    }
  });
});


describe("주요 지표", () => {
  it("사진에 있던 것들을 다 적는다", async () => {
    그리기({ benchmark: 벤치 });
    await 탭열기("지표");
    for (const 이름 of ["기간 수익률", "연환산 (TWR)", "이번 달", "올해",
                        "월 최고", "월 최저", "오른 달", "연 변동성",
                        "최대 낙폭", "낙폭 바닥", "샤프", "소티노",
                        "최근 1년", "최근 3년", "1년 표준편차"]) {
      expect(screen.getByText(이름), `${이름} 이 없다`).toBeInTheDocument();
    }
  });

  it("내 것과 벤치마크를 나란히 적는다", async () => {
    그리기({ benchmark: 벤치 });
    await 탭열기("지표");
    expect(screen.getByText("1.31")).toBeInTheDocument();   // 내 소티노
    expect(screen.getByText("0.95")).toBeInTheDocument();   // 벤치 소티노
  });

  it("오른 달을 '몇 달 중 몇 달' 로 적는다", async () => {
    /* 연 수익률만 보면 한 해 안의 출렁임이 통째로 사라진다 */
    그리기();
    await 탭열기("지표");
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
  });

  it("잴 자료가 없으면 '—' 를 적고, 그 뜻을 말해 준다", async () => {
    /* 3개월치를 '1년 수익률' 이라 적으면 안 된다 */
    그리기();
    await 탭열기("지표");
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.getByText(/없는 수를 지어내지 않아요/)).toBeInTheDocument();
  });

  it("벤치마크가 없으면 그 칸을 '—' 로 둔다", async () => {
    그리기();
    await 탭열기("지표");
    //: 벤치마크 이름 자리에도 '—' 가 들어간다
    expect(screen.getAllByText("—").length).toBeGreaterThan(3);
  });
});


describe("폭락 때 어땠나", () => {
  /* '최대 낙폭 -30%' 만으로는 언제 어떤 일로 그랬는지 모른다.
     사람은 '코로나 때' 로 기억하므로, 기억에 걸리는 이름이 붙어야
     수가 읽힌다. */

  it("이름과 함께 얼마나 빠졌나를 적는다", async () => {
    그리기();
    await 탭열기("낙폭");
    expect(screen.getByText("코로나")).toBeInTheDocument();
    expect(screen.getByText("-28.4%")).toBeInTheDocument();
  });

  it("벤치마크와 나란히 놓는다", async () => {
    그리기({ benchmark: 벤치 });
    await 탭열기("낙폭");
    expect(screen.getByText("-15.2%")).toBeInTheDocument();
  });

  it("일부만 겹친 구간은 그렇다고 적고 **실제로 잰 기간**을 보여 준다", async () => {
    /* 2007-10-09 부터라고 적어 놓고 2008-06 부터 쟀으면 그 차이가 곧
       결과의 차이다. */
    그리기();
    await 탭열기("낙폭");
    expect(screen.getByText("일부")).toBeInTheDocument();
    expect(screen.getByText(/2008-06-02 ~ 2009-03-09/)).toBeInTheDocument();
    expect(screen.getByText(/자료가 일부만 걸쳤다는 뜻/)).toBeInTheDocument();
  });

  it("겹치는 구간이 하나도 없으면 칸을 안 그린다", async () => {
    /* 0% 로 적으면 '안 빠졌다' 로 읽히는데, 사실은 그때 이 조합이
       없었던 것이다. */
    그리기({ crises: [] });
    await 탭열기("낙폭");
    expect(screen.queryByText("폭락 때 어땠나")).toBeNull();
  });
});


describe("담은 자산", () => {
  it("무엇을 어떤 비중으로 담았는지 보여 준다", async () => {
    /* 결과만 보고 있으면 무슨 조합이었는지 잊는다 — 특히 저장해 둔
       실험을 나중에 열었을 때 그렇다. */
    그리기();
    await 탭열기("세부");
    expect(screen.getByText("S&P 500")).toBeInTheDocument();
    expect(screen.getByText("60.0%")).toBeInTheDocument();
    expect(screen.getByText("40.0%")).toBeInTheDocument();
  });

  it("실제로 계산에 쓴 비중이라고 말해 준다", async () => {
    /* '동일 비중' 을 골랐으면 내가 적은 수와 다를 수 있다 */
    그리기();
    await 탭열기("세부");
    expect(screen.getByText(/계산에 실제로 쓴 비중/)).toBeInTheDocument();
  });
});
