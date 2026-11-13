/**
 * 주가예측 화면의 글귀·그래프 자료(utils/주가예측) — 확률을 '0%·100%' 로 적지 않는지, 검증 결과를 맞게 말하는지,
 * 그래프의 선과 범위가 오늘에서 이어지는지.
 */
import { describe, it, expect } from "vitest";
import {
  확률글, 변화글, 날짜글, 년월글, 눈금글, 검증평, 근거이름, 근거상태, 근거값, 근거비율글, 그래프자료, 막대자리,
  기간인가, 예측기간들, 지난날수, 년월일글, 지표값글, 기술반영글, 기술시험글, 기술막대자리,
  기간길이글, 배수글, 쌌던날글, 가운데견줌글, 끝날견줌글, 가치기준글, 가치까닭글, 뺀동안글,
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
      days, label: "", date: "", method: "knn", method_label: "", signal: predicted + 5, weight: 0.5, predicted,
      knn: predicted, ridge: predicted, range: [predicted, predicted], range_kind: "errors",
      up: 0.5, up10: 0, down10: 0, neighbor_count: 15, neighbors: [], check: null,
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
    n: 150, from: "2023-08-24", to: "2026-10-12", periods: 36, in50: 0.5, best: "knn",
    weight: 0.5, gain: 0.081, mae_used: 0.05, direction_used: 0.55, methods: [], ...덧,
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

  it("반영 — 신호를 몇 % 반영했나, 지난 3년 '그대로' 보다 몇 % 덜 틀렸나(1% 아래면 거의 같았다고)", () => {
    expect(기술반영글(성적())).toBe("기술적 신호를 50% 반영했어요 — 지난 3년 '그대로'보다 8% 덜 틀렸어요");
    expect(기술반영글(성적({ weight: 1, gain: 0.01 }))).toBe("기술적 신호를 100% 반영했어요 — 지난 3년 '그대로'보다 1% 덜 틀렸어요");
    expect(기술반영글(성적({ weight: 0.25, gain: 0.004 }))).toBe("기술적 신호를 25% 반영했어요 — 지난 3년 '그대로'와 거의 같았어요");
    expect(기술반영글(성적({ weight: 0.75, gain: 0 }))).toBe("기술적 신호를 75% 반영했어요 — 지난 3년 '그대로'와 거의 같았어요");
  });

  it("반영 0 이면 지금 가격을 예상으로 — 지난 성적이 없어도 그렇다고, '확실히 낫다' 는 말은 없다", () => {
    expect(기술반영글(성적({ weight: 0, gain: 0 }))).toBe("지난 3년 이 종목에서 기술적 신호가 '그대로'보다 못 맞혀, 지금 가격을 예상으로 써요");
    expect(기술반영글(성적({ weight: 0, gain: 0.3 }))).toBe("지난 3년 이 종목에서 기술적 신호가 '그대로'보다 못 맞혀, 지금 가격을 예상으로 써요");
    expect(기술반영글(null)).toBe("지난 성적을 셀 만큼 시세가 없어 지금 가격을 예상으로 써요");
    expect(기술반영글(undefined)).toBe("지난 성적을 셀 만큼 시세가 없어 지금 가격을 예상으로 써요");
    expect(기술시험글).toBe("여러 종목을 10년 동안 시험해 보면 기술적 예상은 '그대로'를 이기지 못했어요 — 참고만 하세요");
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

describe("가치 위치 글귀", () => {
  it("본 기간 — 해·달(끝 날이 시작 날보다 이르면 한 달 덜), 1년이 안 되면 달만, 읽을 수 없으면 비운다", () => {
    expect(기간길이글("2023-03-31", "2026-11-11")).toBe("3년 7개월");
    expect(기간길이글("2023-03-31", "2026-03-31")).toBe("3년");
    expect(기간길이글("2023-03-31", "2026-03-30")).toBe("2년 11개월");
    expect(기간길이글("2025-12-15", "2026-11-11")).toBe("10개월");
    expect(기간길이글("2026-11-01", "2026-11-11")).toBe("1개월");          // 0개월이라고 하지 않는다
    expect(기간길이글("2026-11-20", "2026-11-11")).toBe("1개월");          // 거꾸로여도 음수로 말하지 않는다
    expect(기간길이글("엉망", "2026-11-11")).toBe("");
  });

  it("공식 값 — PER 은 소수 한 자리, PBR 은 두 자리(종목 상세 재무 탭과 같게), 없으면 —", () => {
    expect(배수글("per", 9.33)).toBe("9.3배");
    expect(배수글("per", 205.59)).toBe("205.6배");
    expect(배수글("pbr", 2.4)).toBe("2.40배");
    expect(배수글("pbr", null)).toBe("—");
    expect(배수글("per", undefined)).toBe("—");
    expect(배수글("per", Number.NaN)).toBe("—");
  });

  it("지금보다 쌌던 날 — 끝이면 가장 싸다·비싸다고, 1% 미만·99% 넘게는 그렇게", () => {
    expect(쌌던날글(0)).toBe("지금이 가장 싸요");
    expect(쌌던날글(1)).toBe("지금이 가장 비싸요");
    expect(쌌던날글(0.2312)).toBe("지금보다 쌌던 날 23%");
    expect(쌌던날글(0.004)).toBe("지금보다 쌌던 날 1% 미만");
    expect(쌌던날글(0.996)).toBe("지금보다 쌌던 날 99% 넘게");
  });

  it("가운데 값과 견줌 — 높다·낮다·거의 같다, 두 배가 넘으면 배로", () => {
    expect(가운데견줌글(0.85)).toBe("지난날의 가운데 값보다 15% 낮아요");
    expect(가운데견줌글(1.3)).toBe("지난날의 가운데 값보다 30% 높아요");
    expect(가운데견줌글(1.004)).toBe("지난날의 가운데 값과 거의 같아요");
    expect(가운데견줌글(0.996)).toBe("지난날의 가운데 값과 거의 같아요");
    expect(가운데견줌글(1.995)).toBe("지난날의 가운데 값보다 100% 높아요");
    expect(가운데견줌글(2)).toBe("지난날의 가운데 값의 2.0배예요");
    expect(가운데견줌글(12.3476)).toBe("지난날의 가운데 값의 12.3배예요");
    expect(가운데견줌글(Number.NaN)).toBe("");
  });

  it("가장 쌌던·비쌌던 날 — 날짜와 그때가 지금보다 얼마나 낮았나·높았나", () => {
    expect(끝날견줌글({ date: "2024-11-14", vs_now: 0.7 })).toBe("2024년 11월 14일 · 지금보다 30% 낮았어요");
    expect(끝날견줌글({ date: "2023-07-03", vs_now: 1.6 })).toBe("2023년 7월 3일 · 지금보다 60% 높았어요");
    expect(끝날견줌글({ date: "2026-03-31", vs_now: 1 })).toBe("2026년 3월 31일 · 지금과 거의 같았어요");
    expect(끝날견줌글({ date: "2024-08-28", vs_now: 12.3476 })).toBe("2024년 8월 28일 · 지금의 12.3배였어요");
    expect(끝날견줌글({ date: "2024-08-28", vs_now: 2 })).toBe("2024년 8월 28일 · 지금의 2.0배였어요");
  });

  it("지금 쓴 실적 — PER 은 4분기 합·연간, PBR 은 그때 말의 순자산", () => {
    expect(가치기준글("per", { kind: "ttm", end: "2026-06-30" })).toBe("2026년 6월까지 4분기 순이익");
    expect(가치기준글("per", { kind: "annual", end: "2025-12-31" })).toBe("2025년 12월 결산 연간 순이익");
    expect(가치기준글("pbr", { kind: "quarter", end: "2026-06-30" })).toBe("2026년 6월 말 순자산");
    expect(가치기준글("pbr", { kind: "annual", end: "2025-09-30" })).toBe("2025년 9월 말 순자산");
  });

  it("셀 수 없는 까닭", () => {
    expect(가치까닭글("loss")).toBe("최근 1년 순이익이 적자라 위치를 셀 수 없어요");
    expect(가치까닭글("deficit")).toBe("순자산이 0 이하(자본잠식)라 위치를 셀 수 없어요");
    expect(가치까닭글("short")).toBe("실적을 안 날이 1년이 안 돼 위치를 셀 수 없어요");
    expect(가치까닭글("nodata")).toBe("실적 자료를 받지 못해 위치를 셀 수 없어요");
  });

  it("뺀 동안 — 해·월로, 한 달 안이면 하나만, 여럿이면 쉼표로, 없으면 null", () => {
    expect(뺀동안글("per", [])).toBeNull();
    expect(뺀동안글("per", [{ from: "2024-04-01", to: "2025-03-28" }])).toBe("적자였던 2024년 4월 ~ 2025년 3월은 뺐어요");
    expect(뺀동안글("pbr", [{ from: "2024-04-01", to: "2024-04-30" }, { from: "2025-05-15", to: "2025-08-13" }]))
      .toBe("자본잠식이었던 2024년 4월, 2025년 5월 ~ 2025년 8월은 뺐어요");
  });
});
