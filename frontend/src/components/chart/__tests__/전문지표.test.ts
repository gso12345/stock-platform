/**
 * 전문 분석 도구 — 일목균형표와 피보나치 되돌림.
 *
 * 일목균형표는 국내에서 제일 많이 쓰이는 추세 도구인데 없었다. 다섯
 * 선이 한꺼번에 지지·저항·추세·시점을 말해 준다 — 이동평균 여러 개를
 * 겹쳐 놓는 것과 보는 방식이 다르다.
 *
 * 핵심은 **앞뒤로 미는 것**이다. 선행스팬을 26봉 앞으로, 후행스팬을
 * 26봉 뒤로 옮겨야 구름이 미래를 가리키고 후행이 과거와 견줘진다.
 * 그냥 그날 자리에 두면 선은 그려지는데 뜻이 없어진다.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { calcIchimoku, calcFibonacci, 피보_비율, type OHLCV } from "@/components/chart/indicators";

const 봉 = (i: number, hi: number, lo: number, close = (hi + lo) / 2): OHLCV =>
  ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, open: close,
     high: hi, low: lo, close, volume: 100 } as never);

/** 값이 계단처럼 오르는 100봉.
 *
 *  선행스팬B 는 52봉을 봐서 26봉 앞으로 미니 78봉이 있어야 한 점이라도
 *  나온다. 60봉으로 재면 '선이 안 나온다' 가 아니라 '아직 못 낼 뿐' 인데
 *  그 둘을 검사가 구분 못 한다 */
const 봉들 = Array.from({ length: 100 }, (_, i) => 봉(i, 100 + i * 2, 90 + i * 2));

describe("일목균형표", () => {
  it("전환선은 9봉의 (고+저)/2 다", () => {
    const { 전환선 } = calcIchimoku(봉들);
    /* 9번째 봉(i=8)에서 처음 나온다. 그 구간의 최고 116, 최저 90 */
    expect(전환선[0].value).toBeCloseTo((116 + 90) / 2);
  });

  it("기간이 모자라면 안 그린다", () => {
    /* 0 으로 채우면 그래프가 바닥에서 튀어 오른다 */
    const { 전환선, 기준선 } = calcIchimoku(봉들.slice(0, 5));
    expect(전환선).toHaveLength(0);
    expect(기준선).toHaveLength(0);
  });

  it("선행스팬을 26봉 **앞으로** 민다", () => {
    /* 이게 이 지표의 핵심이다. 안 밀면 구름이 미래를 안 가리킨다 */
    const { 선행A } = calcIchimoku(봉들);
    /* 26봉째(i=25)에서 계산된 값이 i=51 자리에 놓인다 */
    const 첫자리 = 선행A[0].time;
    expect(첫자리).toBe(봉들[25 + 26].date);
  });

  it("후행스팬을 26봉 **뒤로** 민다", () => {
    const { 후행 } = calcIchimoku(봉들);
    /* i=26 의 종가가 i=0 자리에 놓인다 */
    expect(후행[0].time).toBe(봉들[0].date);
    expect(후행[0].value).toBe(봉들[26].close);
  });

  it("없는 날짜를 지어내지 않는다", () => {
    /* 앞으로 민 선은 데이터 끝을 넘어간다. 날짜를 만들면 시간축이
       어긋나고, 그건 지지선 위치를 통째로 틀리게 만든다 */
    const { 선행A, 선행B } = calcIchimoku(봉들);
    const 있는날 = new Set(봉들.map((d) => (d as never as { date: string }).date));
    for (const d of [...선행A, ...선행B]) expect(있는날.has(d.time as string)).toBe(true);
  });

  it("다섯 선을 다 준다", () => {
    const r = calcIchimoku(봉들);
    for (const k of ["전환선", "기준선", "선행A", "선행B", "후행"] as const) {
      expect(r[k].length).toBeGreaterThan(0);
    }
  });

  it("빈 자료에도 안 터진다", () => {
    const r = calcIchimoku([]);
    expect(r.전환선).toEqual([]);
  });

  it("선행스팬B 는 78봉이 있어야 나온다", () => {
    /* 52봉을 보고 26봉 앞으로 민다. 그보다 짧으면 낼 수가 없다 —
       0 으로 채우면 구름이 바닥에 붙어 그려진다 */
    expect(calcIchimoku(봉들.slice(0, 77)).선행B).toHaveLength(0);
    expect(calcIchimoku(봉들.slice(0, 78)).선행B.length).toBeGreaterThan(0);
  });
});

describe("피보나치 되돌림", () => {
  const 구간 = [봉(0, 200, 100), 봉(1, 200, 100), 봉(2, 150, 120)];

  it("0% 가 고점, 100% 가 저점이다", () => {
    /* 오름 구간에서 '얼마나 되돌렸나' 로 읽는 것이 본디 쓰임이다 */
    const 선들 = calcFibonacci(구간);
    expect(선들[0]).toEqual({ 비율: 0, value: 200 });
    expect(선들[선들.length - 1]).toEqual({ 비율: 1, value: 100 });
  });

  it("절반은 가운데다", () => {
    const 반 = calcFibonacci(구간).find((x) => x.비율 === 0.5)!;
    expect(반.value).toBeCloseTo(150);
  });

  it("흔히 쓰는 비율을 다 긋는다", () => {
    expect(calcFibonacci(구간).map((x) => x.비율)).toEqual([...피보_비율]);
    expect(피보_비율).toContain(0.618);      // 황금비 — 제일 많이 본다
    expect(피보_비율).toContain(0.382);
  });

  it("한 줄로 붙어 있으면 안 긋는다", () => {
    /* 고점과 저점이 같으면 나눌 자가 없다 */
    expect(calcFibonacci([봉(0, 100, 100), 봉(1, 100, 100)])).toEqual([]);
  });

  it("봉이 하나뿐이면 안 긋는다", () => {
    expect(calcFibonacci([봉(0, 200, 100)])).toEqual([]);
  });
});

describe("차트에 실제로 붙어 있는가", () => {
  const 소스 = () => fs.readFileSync(
    path.resolve(__dirname, "../StockChart.tsx"), "utf-8");

  it("설정에서 켜고 끌 수 있다", () => {
    const s = 소스();
    expect(s).toContain('label="일목균형표"');
    expect(s).toContain('label="피보나치 되돌림"');
    expect(s).toContain("ichimoku: false, fib: false");
  });

  it("켜면 이름표에 뜬다", () => {
    /* 켰는지 아닌지 화면에서 알 수 없으면 설정을 다시 열어 봐야 한다 */
    const s = 소스();
    expect(s).toContain('s.ichimoku && "일목균형표"');
    expect(s).toContain('s.fib && "피보나치"');
  });

  it("켜고 끄면 다시 그린다", () => {
    /* 재생성 트리거에 없으면 켜도 아무 일이 안 일어난다 */
    const s = 소스();
    expect(s).toContain("ichimoku: settings.ichimoku, fib: settings.fib");
  });

  it("피보나치는 보고 있는 구간에서 다시 긋는다", () => {
    /* 전체 기간으로 잡으면 3년 전 고점이 이번 달 그래프를 지배해서,
       그은 선이 지금 움직임과 아무 상관이 없어진다 */
    const s = 소스();
    expect(s).toContain("getVisibleLogicalRange()");
    expect(s).toContain("subscribeVisibleLogicalRangeChange(() => 피보긋기())");
  });

  it("피보나치를 시리즈로 안 긋는다", () => {
    /* 시리즈로 그으면 세로 범위 계산에 끼어들어 캔들이 눌린다 —
       자산 흐름에서 손익 선이 그래프를 찌그러뜨렸던 것과 같은 일 */
    const s = 소스();
    expect(s).toContain("createPriceLine");
    const 시작 = s.indexOf("if (s.fib) {");
    const 끝 = s.indexOf("main.timeScale().fitContent()", 시작);
    expect(s.slice(시작, 끝)).not.toMatch(/addLineSeries\([^)]*color: "#f59e0b"/);
  });

  it("다시 그을 때 앞의 선을 지운다", () => {
    /* 안 지우면 화면을 옮길 때마다 선이 쌓인다 */
    const s = 소스();
    expect(s).toContain("removePriceLine");
  });
});

describe("거래량은 돈이 아니다", () => {
  const 소스 = () => fs.readFileSync(
    path.resolve(__dirname, "../StockChart.tsx"), "utf-8");

  it("거래량에 제 형식을 준다", () => {
    /* 차트의 값 형식은 그 차트의 모든 시리즈에 걸린다. 본 차트에 얹은
       거래량도 그래서 '₩402,164' 로 나왔다 — 402,164주를 40만원으로
       읽게 만든다 */
    const s = 소스();
    const 시작 = s.indexOf('priceScaleId: "volume"');
    expect(시작).toBeGreaterThan(-1);
    const 토막 = s.slice(시작 - 400, 시작 + 400);
    expect(토막).toContain("priceFormat");
    expect(토막).toContain("주`");
  });

  it("주식은 쪼개서 안 센다", () => {
    const s = 소스();
    const 시작 = s.indexOf('priceScaleId: "volume"');
    expect(s.slice(시작, 시작 + 400)).toContain("minMove: 1");
  });
});
