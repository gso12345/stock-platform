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
    expect(StockDetail원문).toMatch(/if \(!fullscreen\) return;/);
  });

  it("최소 높이는 남겨 둔다", () => {
    /* 재기 전 첫 그림에서 0 이 들어가면 차트가 아예 안 보인다 */
    expect(StockDetail원문).toMatch(/Math\.max\(260, 전체차트높이\)/);
  });
});
