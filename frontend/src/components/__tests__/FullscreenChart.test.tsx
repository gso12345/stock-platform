/**
 * 차트 전체보기 — "전체화면 눌러도 전체가 아닌 부분적으로 떠"
 *
 * 전체화면 차트 높이를 '남은 공간의 55%' 로 고정해 뒀었다. 보조지표
 * (RSI·MACD)를 켰을 때 그것까지 한 화면에 담으려던 것인데, 지표를 안 켠
 * 보통의 경우에는 전체화면을 눌러도 차트가 화면 절반만 차지했다.
 *
 * 이제 남은 공간을 실제로 재서 그만큼 준다.
 */
import { describe, it, expect } from "vitest";
import StockDetail원문 from "../../pages/StockDetail.tsx?raw";
import StockChart원문 from "../chart/StockChart.tsx?raw";

describe("전체화면 차트", () => {
  it("높이를 비율로 깎지 않는다", () => {
    /* 이 곱셈이 되살아나면 다시 '부분적으로' 뜬다 */
    expect(StockDetail원문).not.toMatch(/window\.innerHeight - 100\) \* 0\.55/);
  });

  it("남은 공간을 실제로 재서 쓴다", () => {
    expect(StockDetail원문).toMatch(/set전체차트높이/);
    expect(StockDetail원문).toMatch(/height=\{Math\.max\(260, 전체차트높이\)\}/);
  });

  it("화면을 돌리면 다시 잰다", () => {
    /* 세로로 열었다가 가로로 돌리면 높이가 두 배 가까이 달라진다.
       한 번만 재면 돌린 뒤에도 세로 높이가 그대로 남는다 */
    /* 붙이는 쪽과 떼는 쪽 둘 다 봐야 한다 — 붙이기만 빼도 떼는 줄이
       남아 있어 'orientationchange' 라는 글자로는 통과한다 */
    expect(StockDetail원문).toMatch(/addEventListener\("orientationchange"/);
    expect(StockDetail원문).toMatch(/removeEventListener\("orientationchange"/);
    expect(StockDetail원문).toMatch(/addEventListener\("resize"/);
    expect(StockDetail원문).toMatch(/ResizeObserver/);
  });

  it("전체화면이 아닐 때는 재지 않는다", () => {
    /* 닫혀 있는 동안 관찰자를 붙여 두면 종목상세를 볼 때마다 헛일을 한다 */
    expect(StockDetail원문).toMatch(/if \(!fullscreen\) \{ set전체차트높이\(0\); return; \}/);
  });

  it("최소 높이는 남겨 둔다", () => {
    expect(StockDetail원문).toMatch(/Math\.max\(260, 전체차트높이\)/);
  });

  it("칠하기 전에 재서 두 번 그리지 않는다", () => {
    /* "전체화면하면 갑자기 화면이 흔들려"
       StockChart 는 height 가 바뀌면 차트를 부수고 다시 만든다. 그냥
       useEffect 로 재면 첫 그림이 최소값(260)으로 나온 뒤 곧바로 부수고
       제 높이로 다시 그려서, 여는 순간 화면이 크게 흔들린다. */
    expect(StockDetail원문).toMatch(/useLayoutEffect\(\(\) => \{\s*\n\s*if \(!fullscreen\)/);
  });

  it("재기 전에는 아예 안 그린다", () => {
    expect(StockDetail원문).toMatch(/\{전체차트높이 > 0 && \(/);
  });

  it("되먹임 고리를 구조적으로 끊는다", () => {
    /* 잰 높이가 차트 높이를 바꾸고, 그 차트가 다시 컨테이너 높이를
       흔드는 고리가 있었다. 가로 스크롤바가 아예 못 생기게 막고,
       소수점을 버려서 미세한 넘침을 없앤다 */
    expect(StockDetail원문).toMatch(/overflow-y-auto overflow-x-hidden/);
    expect(StockDetail원문).toMatch(/Math\.floor\(전체차트칸\.current\?\.getBoundingClientRect\(\)\.height/);
  });

  it("높이가 바뀌어도 차트를 부수지 않는다", () => {
    /* 이것이 흔들림의 증폭기였다. height 가 1px 만 바뀌어도
       chart.remove() → innerHTML="" → 재생성 이 돌아, 캔버스가 비었다
       다시 그려지고 보고 있던 확대·스크롤 위치까지 초기화됐다 */
    expect(StockChart원문).not.toMatch(/\}, \[data, chartType, height,/);
    expect(StockChart원문).toMatch(/chartRef\.current\?\.applyOptions\(\{ height \}\)/);
    // 재생성 때는 최신 높이를 ref 로 읽어야 낡은 값으로 만들어지지 않는다
    expect(StockChart원문).toMatch(/mkChart\(mainRef\.current, heightRef\.current\)/);
  });

  it("닫으면 잰 값을 지운다", () => {
    /* 남겨 두면 다음에 열 때 예전 높이로 한 번 그렸다가 다시 그린다 */
    expect(StockDetail원문).toMatch(/if \(!fullscreen\) \{ set전체차트높이\(0\); return; \}/);
  });
});
