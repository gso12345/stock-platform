/**
 * 주가예측 화면의 글귀·그래프 자료(utils/주가예측) — 확률을 '0%·100%' 로 적지 않는지, 검증 결과를 맞게 말하는지,
 * 그래프의 선과 범위가 오늘에서 이어지는지.
 */
import { describe, it, expect } from "vitest";
import {
  확률글, 변화글, 날짜글, 년월글, 눈금글, 검증평, 근거이름, 근거상태, 근거값, 근거비율글, 그래프자료, 막대자리,
  기간인가, 예측기간들, 지난날수, 년월일글, 지표값글, 기술판정, 기술막대자리,
} from "@/utils/주가예측";
import type { 예측근거, 예측검증, 주가예측, 기술검증, 기술예측기간 } from "@/api/predict";

const 검 = (덧: Partial<예측검증> = {}): 예측검증 => ({
  n: 150, in80: 0.79, in50: 0.5, above80: 0.1, below80: 0.11, periods: 36, from: "2023-08-24", to: "2026-11-10", ...덧,
});

describe("글귀", () => {
  it("확률 — 1% 미만·99% 넘게는 그렇게, 나머지는 반올림", () => {
    expect(확률글(0.534)).toBe("53%");
    expect(확률글(0.5)).toBe("50%");
    expect(확률글(0.004)).toBe("1% 미만");
    expect(확률글(0)).toBe("1% 미만");
    expect(확률글(0.996)).toBe("99% 넘게");
    expect(확률글(0.01)).toBe("1%");
    expect(확률글(0.99)).toBe("99%");
    expect(확률글(null)).toBe("—");
    expect(확률글(Number.NaN)).toBe("—");
  });

  it("변화 — 10% 아래는 소수 한 자리, 위는 정수, 내림은 긴 빼기표", () => {
    expect(변화글(101.234, 100)).toBe("+1.2%");
    expect(변화글(96.6, 100)).toBe("−3.4%");
    expect(변화글(112.4, 100)).toBe("+12%");
    expect(변화글(70, 100)).toBe("−30%");
    expect(변화글(100.01, 100)).toBe("0%");
    expect(변화글(1, 0)).toBe("—");
  });

  it("날짜 — 월·일, 해·월", () => {
    expect(날짜글("2026-12-01")).toBe("12월 1일");
    expect(년월글("2023-08-24")).toBe("2023년 8월");
    expect(날짜글("이상한")).toBe("이상한");
  });

  it("그래프 눈금 — 3개월까지는 월/일, 6개월·1년은 해.월(두 해에 걸친다)", () => {
    expect(눈금글("2026-12-10", 5)).toBe("12/10");
    expect(눈금글("2026-02-08", 63)).toBe("2/8");
    expect(눈금글("2026-02-08", 126)).toBe("2026.02");
    expect(눈금글("2027-10-29", 252)).toBe("2027.10");
    expect(눈금글("이상", 21)).toBe("이상");
  });

  it("기간 — 다섯 가지만", () => {
    expect(예측기간들.map((x) => x.days)).toEqual([5, 21, 63, 126, 252]);
    expect(기간인가(21)).toBe(true);
    expect(기간인가(30)).toBe(false);
    expect(기간인가(Number.NaN)).toBe(false);
  });
});

describe("검증평 — 80% 범위 안에 든 비율로", () => {
  it("80% ± 7%p 면 잘 맞았다", () => {
    expect(검증평(검({ in80: 0.79 }))).toEqual({ 말: "범위가 실제와 잘 맞았어요", 맞음: true, 참고만: false });
    expect(검증평(검({ in80: 0.87 })).맞음).toBe(true);
    expect(검증평(검({ in80: 0.73 })).맞음).toBe(true);
  });

  it("좁았으면 어느 쪽으로 더 움직였는지, 넉넉했으면 덜 움직였다고", () => {
    expect(검증평(검({ in80: 0.65, above80: 0.25, below80: 0.1 })).말).toBe("범위가 좁았어요 — 실제로는 위로 더 크게 움직였어요");
    expect(검증평(검({ in80: 0.65, above80: 0.1, below80: 0.25 })).말).toBe("범위가 좁았어요 — 실제로는 아래로 더 크게 움직였어요");
    expect(검증평(검({ in80: 0.92 })).말).toBe("범위가 넉넉했어요 — 실제로는 덜 움직였어요");
    expect(검증평(검({ in80: 0.92 })).맞음).toBe(false);
  });

  it("겹치지 않는 기간이 10번 아래면 참고만", () => {
    expect(검증평(검({ periods: 9 })).참고만).toBe(true);
    expect(검증평(검({ periods: 10 })).참고만).toBe(false);
  });
});

describe("근거", () => {
  const 추세: 예측근거 = { key: "trend", state: "above", price: 71200, ma200: 65300, rates: { "21": { cond: 0.58, n: 612, base: 0.54, total: 1000 } } };
  const 흐름: 예측근거 = { key: "momentum", state: "down", ret: -0.123, rates: {} };
  const 지표: 예측근거 = { key: "rsi", state: "hot", value: 74.36, rates: {} };

  it("이름·상태·숫자", () => {
    const 돈 = (v: number) => `₩${v.toLocaleString("ko-KR")}`;
    expect([근거이름(추세), 근거이름(흐름), 근거이름(지표)]).toEqual(["추세 · 200일 평균", "1년 흐름", "RSI(14일)"]);
    expect(근거상태(추세)).toBe("200일 평균보다 위");
    expect(근거상태({ ...추세, state: "below" })).toBe("200일 평균보다 아래");
    expect(근거상태(흐름)).toBe("1년 동안 내렸어요");
    expect(근거상태({ ...흐름, state: "up" })).toBe("1년 동안 올랐어요");
    expect(근거상태(지표)).toBe("과열(70 넘음)");
    expect(근거상태({ ...지표, state: "cold" })).toBe("침체(30 아래)");
    expect(근거상태({ ...지표, state: "normal" })).toBe("보통(30~70)");
    expect(근거값(추세, 돈)).toBe("지금 ₩71,200 · 200일 평균 ₩65,300");
    expect(근거값(흐름, 돈)).toBe("최근 1개월을 뺀 1년 −12%");
    expect(근거값(지표, 돈)).toBe("RSI 74");
  });

  it("같은 상태였던 날들의 오른 비율 — 모든 날과 나란히, 없으면 없다고", () => {
    expect(근거비율글(추세.rates["21"], "1개월")).toBe("지금 같은 상태였던 612일 가운데 1개월 뒤 오른 비율 58% · 모든 날은 54%");
    expect(근거비율글({ cond: null, n: 0, base: 0.5, total: 10 }, "1개월")).toBe("지금 같은 상태였던 날이 없었어요");
    expect(근거비율글(null, "1년")).toBe("1년 뒤를 셀 만큼 지난 자료가 없어요");
    expect(근거비율글(undefined, "1년")).toBe("1년 뒤를 셀 만큼 지난 자료가 없어요");
  });
});

function 예측(): 주가예측 {
  const history = Array.from({ length: 260 }, (_, i) => ({ date: `h${String(i).padStart(3, "0")}`, close: 100 + i }));
  const path = Array.from({ length: 252 }, (_, i) => ({
    day: i + 1, date: `f${String(i + 1).padStart(3, "0")}`,
    q10: 300 - i, q25: 330 - i / 2, q50: 360, q75: 390 + i / 2, q90: 420 + i,
  }));
  return {
    symbol: "X", market: "US", name: "X", currency: "USD", as_of: "h259", price: 359, days_used: 1260,
    volatility: { now: 0.3, long: 0.28 }, expected_return: 0.07, horizons: [], path, history, signals: [],
    method: { lambda: 0.94, half_life_days: 46, window_days: 756, prior_return: 0.07, check_step_days: 5 },
  };
}

describe("그래프 자료", () => {
  it("지난 종가 + 고른 기간만큼의 앞날, 오늘에서 범위가 시작한다", () => {
    const 줄 = 그래프자료(예측(), 21);
    expect(줄).toHaveLength(지난날수[21] + 21);
    const 오늘 = 줄[지난날수[21] - 1];
    expect(오늘).toEqual({ date: "h259", 종가: 359, 가운데: 359, 범위80: [359, 359], 범위50: [359, 359] });
    expect(줄[0]).toEqual({ date: `h${260 - 지난날수[21]}`, 종가: 100 + 260 - 지난날수[21] });
    expect(줄[지난날수[21]]).toEqual({ date: "f001", 가운데: 360, 범위80: [300, 420], 범위50: [330, 390] });
    expect(줄[줄.length - 1].date).toBe("f021");
    // 앞날 줄에는 종가가 없다(선이 오늘에서 끝난다)
    expect(줄.slice(지난날수[21]).every((x) => x.종가 === undefined)).toBe(true);
  });

  it("앞날이 길면 지난 흐름도 길게", () => {
    expect(그래프자료(예측(), 5)).toHaveLength(40 + 5);
    expect(그래프자료(예측(), 252)).toHaveLength(260 + 252);
  });

  it("기술적 분석의 예상 주가는 고른 기간의 마지막 날에 점 하나 — 그 기간이 없으면(6개월·1년) 없다", () => {
    const 기술기간 = (days: number, predicted: number): 기술예측기간 => ({
      days, label: "", date: "", method: "knn", method_label: "", predicted, knn: predicted, ridge: predicted,
      range: [predicted, predicted], up: 0.5, up10: 0, down10: 0, neighbor_count: 15, neighbors: [], check: null,
    });
    const p: 주가예측 = {
      ...예측(),
      technical: { horizons: [기술기간(5, 361), 기술기간(21, 371)], indicators: [], market: null, neighbors_k: 15, min_gap_days: 5 },
    };
    const 줄 = 그래프자료(p, 21);
    expect(줄[줄.length - 1]).toMatchObject({ date: "f021", 기술: 371 });
    expect(줄.filter((x) => x.기술 !== undefined)).toHaveLength(1);
    const 주 = 그래프자료(p, 5);
    expect(주[주.length - 1].기술).toBe(361);
    expect(그래프자료(p, 126).some((x) => x.기술 !== undefined)).toBe(false);
    expect(그래프자료(예측(), 21).some((x) => x.기술 !== undefined)).toBe(false);
    expect(그래프자료({ ...예측(), technical: null }, 21).some((x) => x.기술 !== undefined)).toBe(false);
  });
});

describe("기술적 분석 글귀", () => {
  const 성적 = (덧: Partial<기술검증> = {}): 기술검증 => ({
    n: 150, from: "2023-08-24", to: "2026-10-12", periods: 36, in50: 0.5, best: "knn", gain: 0.081, t: 1.9, beats_flat: true,
    methods: [], ...덧,
  });

  it("날짜 — 해·월·일", () => {
    expect(년월일글("2024-03-14")).toBe("2024년 3월 14일");
    expect(년월일글("2024-03")).toBe("2024-03");
  });

  it("지표 값 — RSI 는 정수, %B 는 소수 둘, 변동성·거래량은 배, MACD 는 가격 대비 %, 나머지(로그 비율)는 %", () => {
    expect(지표값글("rsi", 61.6)).toBe("62");
    expect(지표값글("bb", 0.8234)).toBe("0.82");
    expect(지표값글("vol", Math.log(1.25))).toBe("1.25배");
    expect(지표값글("volume", Math.log(0.8))).toBe("0.80배");
    expect(지표값글("macd", 0.00234)).toBe("+0.23%");
    expect(지표값글("macd", -0.0123)).toBe("−1.23%");
    expect(지표값글("macd", 0.00001)).toBe("0%");
    expect(지표값글("gap200", Math.log(1.09))).toBe("+9.0%");
    expect(지표값글("high52", Math.log(0.85))).toBe("−15%");
    expect(지표값글("mkt_ret21", 0)).toBe("0%");
    expect(지표값글("rsi", null)).toBe("—");
    expect(지표값글("gap20", undefined)).toBe("—");
    expect(지표값글("gap20", Number.NaN)).toBe("—");
    expect(지표값글("rsi", Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("판정 — '그대로' 보다 확실히 나았을 때만 믿음(초록), 몇 % 덜 틀렸는지", () => {
    expect(기술판정(성적())).toEqual({ 말: "지난 3년 '지금 가격 그대로'라고 찍기보다 8% 덜 틀렸어요", 믿음: true });
    expect(기술판정(성적({ gain: 0.004 }))).toEqual({ 말: "지난 3년 '지금 가격 그대로'라고 찍기보다 조금 덜 틀렸어요", 믿음: true });
    expect(기술판정(성적({ gain: 0.01 })).말).toBe("지난 3년 '지금 가격 그대로'라고 찍기보다 1% 덜 틀렸어요");
  });

  it("판정 — 확실하지 않으면 참고만: 덜 틀렸어도 우연일 수 있다고, 더 틀렸으면 더 틀렸다고, 비슷하면 비슷했다고", () => {
    const 아님 = { beats_flat: false, t: 0.6 };
    expect(기술판정(성적({ ...아님, gain: 0.024 }))).toEqual({
      말: "지난 3년 '지금 가격 그대로'라고 찍기보다 2% 덜 틀렸지만 우연일 수 있어요 — 참고만 하세요", 믿음: false,
    });
    expect(기술판정(성적({ ...아님, gain: 0.01 })).말).toBe("지난 3년 '지금 가격 그대로'라고 찍기보다 1% 덜 틀렸지만 우연일 수 있어요 — 참고만 하세요");
    expect(기술판정(성적({ ...아님, gain: -0.034 }))).toEqual({
      말: "지난 3년 '지금 가격 그대로'라고 찍기보다 3% 더 틀렸어요 — 참고만 하세요", 믿음: false,
    });
    expect(기술판정(성적({ ...아님, gain: -0.01 })).말).toBe("지난 3년 '지금 가격 그대로'라고 찍기보다 1% 더 틀렸어요 — 참고만 하세요");
    for (const gain of [0.004, 0, -0.004]) {
      expect(기술판정(성적({ ...아님, gain }))).toEqual({
        말: "지난 3년 '지금 가격 그대로'라고 찍은 것과 거의 같았어요 — 참고만 하세요", 믿음: false,
      });
    }
    expect(기술판정(null)).toEqual({ 말: "지난 성적을 셀 만큼 시세가 없어요 — 참고만 하세요", 믿음: false });
    expect(기술판정(undefined).믿음).toBe(false);
  });

  it("막대 — 절반 범위·예상·지금이 모두 안에, 양 끝에 폭의 12% 여백", () => {
    const 자리 = 기술막대자리([95, 110], 103, 100);
    // 낮 95 · 높 110 · 여백 1.8 → 93.2 ~ 111.8
    expect(자리.절반[0]).toBeCloseTo(((95 - 93.2) / 18.6) * 100, 6);
    expect(자리.절반[1]).toBeCloseTo(((110 - 93.2) / 18.6) * 100, 6);
    expect(자리.예상).toBeCloseTo(((103 - 93.2) / 18.6) * 100, 6);
    expect(자리.지금).toBeCloseTo(((100 - 93.2) / 18.6) * 100, 6);
    // 예상·지금이 절반 범위 밖이어도 막대 안에
    const 밖 = 기술막대자리([95, 110], 120, 80);
    expect(밖.지금).toBeCloseTo((4.8 / 49.6) * 100, 6);
    expect(밖.예상).toBeCloseTo((44.8 / 49.6) * 100, 6);
    expect(밖.절반[0]).toBeGreaterThan(밖.지금);
    expect(밖.절반[1]).toBeLessThan(밖.예상);
    // 모두 한 점이어도 0 으로 나누지 않는다
    const 점 = 기술막대자리([100, 100], 100, 100);
    expect(점.예상).toBeCloseTo(50, 6);
    expect(점.절반).toEqual([점.예상, 점.예상]);
  });
});

describe("범위 막대의 자리", () => {
  it("80% ⊃ 50%, 가운데가 그 안, 양 끝에 여백", () => {
    const 자리 = 막대자리({ q10: 90, q25: 95, q50: 100, q75: 105, q90: 110 }, 100);
    expect(자리.넓은[0]).toBeGreaterThan(0);
    expect(자리.넓은[1]).toBeLessThan(100);
    expect(자리.넓은[0]).toBeLessThan(자리.좁은[0]);
    expect(자리.좁은[1]).toBeLessThan(자리.넓은[1]);
    expect(자리.가운데).toBeCloseTo(50, 5);
    expect(자리.지금).toBeCloseTo(50, 5);
  });

  it("지금 가격이 80% 범위 밖이어도 막대 안에 든다", () => {
    const 자리 = 막대자리({ q10: 110, q25: 115, q50: 120, q75: 125, q90: 130 }, 100);
    expect(자리.지금).toBeGreaterThan(0);
    expect(자리.지금).toBeLessThan(자리.넓은[0]);
    expect(자리.넓은[1]).toBeLessThan(100);
  });

  it("범위가 한 점이어도 0 으로 나누지 않는다", () => {
    const 자리 = 막대자리({ q10: 100, q25: 100, q50: 100, q75: 100, q90: 100 }, 100);
    expect(Number.isFinite(자리.가운데)).toBe(true);
    expect(자리.가운데).toBeCloseTo(50, 5);
  });
});
