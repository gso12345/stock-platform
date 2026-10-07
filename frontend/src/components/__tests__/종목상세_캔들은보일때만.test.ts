/**
 * 종목 상세는 기본으로 흐름 차트(PriceTrend)를 보여 주고, 캔들은 '자세히' 를
 * 눌러야 나온다. 그런데 캔들용 일봉 전체(period=max, 1MB 남짓)를 종목을 열
 * 때마다 받고 있었다. 보일 때만 받는지 본다.
 * 화면 전체를 그리기엔 무거워 다른 종목상세 검사처럼 소스를 본다 —
 * 실제 요청이 안 나가는 것은 브라우저에서 확인했다.
 */
import { describe, it, expect } from "vitest";
import 원문 from "../../pages/StockDetail.tsx?raw";

function 질의(키: string) {
  const i = 원문.indexOf(`queryKey: ${키}`);
  expect(i).toBeGreaterThan(-1);
  return 원문.slice(i, 원문.indexOf("});", i));
}

describe("종목 상세 캔들 차트", () => {
  it("캔들은 자세히를 켰고, 차트 탭이거나 전체보기일 때만 보인다", () => {
    expect(원문).toMatch(/const 캔들보임 = 자세한차트 && \(mainTab === "chart" \|\| fullscreen\);/);
  });

  it("캔들 일봉은 보일 때만 받는다", () => {
    const 구역 = 질의('["stock-ohlcv", m, sym, candleType, chartPeriod]');
    expect(구역).toMatch(/enabled: !!sym && 캔들보임,/);
  });

  it("캔들이 안 보이면 상세가 대신 시세를 물어본다 — 분봉이어도", () => {
    const 구역 = 질의('["stock-detail", m, sym]');
    expect(구역).toMatch(/refetchInterval: \(isIntraday && 캔들보임\) \? false : 시세주기/);
  });
});

describe("캔들 차트 코드도 보일 때만", () => {
  it("종목 상세가 차트 라이브러리를 곧바로 끌어오지 않는다", () => {
    /* 봉 종류·기간 값은 candles.ts 에서 읽고, 차트 자체는 lazy 로 받는다.
       StockChart 를 그냥 import 하면 lightweight-charts(50KB gz 남짓)가
       종목 상세와 함께 내려온다 — 기본 화면은 그 차트를 안 그리는데도 */
    expect(원문).not.toMatch(/^import\s+StockChart\b/m);
    expect(원문).not.toMatch(/from "@\/components\/chart\/StockChart";/);
    expect(원문).toMatch(/const StockChart = lazy\(\(\) => import\("@\/components\/chart\/StockChart"\)\);/);
  });

  it("그릴 때는 자리부터 잡는다 — 받는 동안 화면이 튀지 않게", () => {
    const 자리 = 원문.match(/<Suspense fallback=\{<div style=\{\{ height: [^}]+\}\} \/>\}>\s*<StockChart/g) ?? [];
    expect(자리.length).toBe(2);              // 자세히 차트 · 전체보기
  });
});
