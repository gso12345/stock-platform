/**
 * 일목균형표 구름 — 두 선 사이를 실제로 칠한다.
 *
 * ── 왜 따로 만들어야 했나 ──
 *
 * lightweight-charts 에는 두 선 사이를 칠하는 기능이 없다. 흔히 쓰는
 * 편법이 둘 있는데 둘 다 이 화면에서는 못 쓴다.
 *
 *   ① 영역 시리즈 두 개를 겹쳐 아래쪽을 배경색으로 '지우는' 방식 —
 *      배경색이 캔들까지 지운다. 구름 아래 봉이 통째로 사라진다.
 *   ② 캔버스를 하나 더 얹고 좌표를 손으로 맞추는 방식 — 확대·이동·창
 *      크기가 바뀔 때마다 어긋난다. 지지선 위치가 틀리면 안 그리느니만
 *      못하다.
 *
 * v4.1 의 addCustomSeries 를 쓴다. 차트가 자기 좌표계로 불러 주므로
 * 어긋날 자리가 없다.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { 교차비율, 구름시리즈, 구름_기본설정 } from "@/components/chart/CloudSeries";

describe("교차비율", () => {
  /* 봉 단위로 색을 끊으면 뒤집히는 지점에 계단이 생긴다. 구름을 보는
     이유의 절반이 그 뒤집힘이라, 거기가 뭉개지면 안 그리느니만 못하다 */

  it("한가운데서 만나면 0.5", () => {
    /* A는 10→0 으로 내리고 B는 0→10 으로 오른다 */
    expect(교차비율(10, 0, 0, 10)).toBeCloseTo(0.5);
  });

  it("어디서 만나는지 비율로 준다", () => {
    /* 차이가 3 → -1 이면 3/4 지점에서 0을 지난다 */
    expect(교차비율(3, 0, 0, 1)).toBeCloseTo(0.75);
  });

  it("안 뒤집히면 없다", () => {
    /* 둘 다 A가 위 — 차이가 같으면 0으로 나눠 Infinity 가 되고,
       그것도 0~1 밖이라 걸러진다 */
    expect(교차비율(10, 5, 20, 15)).toBeNull();
    /* 둘 다 B가 위 */
    expect(교차비율(5, 10, 15, 20)).toBeNull();
    /* 차이가 줄지만 안 뒤집히는 경우 — 비율이 1을 넘는다 */
    expect(교차비율(3, 0, 1, 0)).toBeNull();
    /* 차이가 늘지만 안 뒤집히는 경우 — 비율이 음수가 된다 */
    expect(교차비율(1, 0, 3, 0)).toBeNull();
  });

  it("이미 붙어 있으면 없다", () => {
    /* 앞에서 이미 만나 있으면 그 사이에 교차점이 없다 */
    expect(교차비율(5, 5, 10, 3)).toBeNull();
  });

  it("끝에서 딱 만나는 것은 안 센다", () => {
    /* 비율 1 은 다음 칸의 시작점이다. 여기서도 세면 같은 자리를
       두 번 찍어 빈 다각형이 생긴다 */
    expect(교차비율(3, 0, 0, 0)).toBeNull();
  });
});

describe("구름시리즈", () => {
  const 뷰 = new 구름시리즈();

  it("세로 범위에 위·아래를 다 알린다", () => {
    /* 하나만 알리면 구름의 절반이 화면 밖으로 밀려난다 */
    const 값들 = 뷰.priceValueBuilder({ time: 1 as never, a: 120, b: 100 });
    expect([...값들].sort((x, y) => x - y)).toEqual([100, 120]);
  });

  it("값이 없는 날은 빈칸으로 본다", () => {
    /* 0 으로 채우면 구름이 바닥까지 늘어진다 */
    expect(뷰.isWhitespace({ time: 1 as never } as never)).toBe(true);
    expect(뷰.isWhitespace({ time: 1 as never, a: NaN, b: 3 } as never)).toBe(true);
    expect(뷰.isWhitespace({ time: 1 as never, a: 1, b: 3 } as never)).toBe(false);
  });

  it("양운과 음운 색이 다르다", () => {
    /* 선행A가 위면 상승, 아래면 하락이다. 한 색으로 칠하면 구름을
       보는 뜻이 없어진다 */
    expect(구름_기본설정.위색).not.toBe(구름_기본설정.아래색);
  });
});

describe("차트에 붙어 있는가", () => {
  const 소스 = () => fs.readFileSync(
    path.resolve(__dirname, "../StockChart.tsx"), "utf-8");

  it("구름을 커스텀 시리즈로 그린다", () => {
    const s = 소스();
    expect(s).toContain("addCustomSeries(new 구름시리즈()");
  });

  it("구름을 선보다 **먼저** 얹는다", () => {
    /* 시리즈는 얹은 순서대로 그려진다. 구름을 나중에 얹으면 반투명
       이라도 캔들 위에 덮여 색이 탁해진다 */
    const s = 소스();
    const 구름 = s.indexOf("addCustomSeries(new 구름시리즈()");
    const 선 = s.indexOf('긋기("#3b82f6", 전환선)');
    expect(구름).toBeGreaterThan(-1);
    expect(선).toBeGreaterThan(구름);
  });

  it("값이 없는 날은 빈칸으로 넘긴다", () => {
    const s = 소스();
    const 시작 = s.indexOf("const 구름자료 =");
    expect(시작).toBeGreaterThan(-1);
    expect(s.slice(시작, 시작 + 500)).toContain("{ time: ct(d) }");
  });

  it("등락 색 설정을 따른다", () => {
    /* 빨강/파랑 쓰는 사람에게 초록 구름은 아무 뜻이 없다 */
    const s = 소스();
    const 시작 = s.indexOf("addCustomSeries(new 구름시리즈()");
    const 토막 = s.slice(시작, 시작 + 300);
    expect(토막).toContain("hexToRgba(C.up");
    expect(토막).toContain("hexToRgba(C.down");
  });
});

describe("거래량 뱃지를 값 축에 안 띄운다", () => {
  const 소스 = () => fs.readFileSync(
    path.resolve(__dirname, "../StockChart.tsx"), "utf-8");

  it("마지막 값 뱃지를 끈다", () => {
    /* priceFormat 을 줬는데도 '₩402,164' 가 남았다. 거래량은 제
       축(overlay)을 쓰는데 그 축이 안 보이는 상태라, 뱃지가 본 차트의
       값 축에 그 축의 형식(통화)으로 그려진다 — 시리즈에 형식을 줘도
       그 자리는 안 바뀐다. 애초에 가격 축에 거래량 뱃지를 띄울 이유가
       없다 */
    const s = 소스();
    const 시작 = s.indexOf('priceScaleId: "volume"');
    const 토막 = s.slice(시작, 시작 + 900);
    expect(토막).toContain("lastValueVisible: false");
    expect(토막).toContain("priceLineVisible: false");
  });
});
