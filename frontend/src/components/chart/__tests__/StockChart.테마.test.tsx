/**
 * 종목 차트도 테마를 따라간다 — 차트는 캔버스라 CSS 변수를 못 쓰고 색 글자를 받는다. 예전엔 만들 때 한 번만 클래스를
 * 읽어서, 차트가 떠 있는 동안 테마가 바뀌면(설정에서 바꾸거나 '시스템' 인데 기기가 바뀌면) 옛 색이 남았다 — 같은
 * 다크모드인데 차트만 하얀 판이었다(사용자: "같은 다크모드여도 색깔이 달라").
 *
 * 그리기 라이브러리는 무엇을 부르든 받아 주는 가짜로 바꾸고, 차트를 만들 때 넘긴 색만 적어 둔다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";

const 만든것 = vi.hoisted(() => [] as any[]);

vi.mock("lightweight-charts", () => {
  /* 무엇을 꺼내든·부르든 또 가짜를 준다. 수로 쓰이면 0, 글자로 쓰이면 빈 글자 */
  const 가짜 = (): any => new Proxy(function () { /* 가짜 */ }, {
    get: (_t, k) => {
      if (k === "then" || typeof k === "symbol") return undefined;
      if (k === "valueOf") return () => 0;
      if (k === "toString") return () => "";
      return 가짜();
    },
    apply: () => 가짜(),
  });
  return {
    createChart: (_칸: unknown, 설정: any) => { 만든것.push(설정); return 가짜(); },
    customSeriesDefaultOptions: {},
    ColorType: { Solid: "solid" },
    CrosshairMode: { Normal: 0, Magnet: 1 },
    LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3, SparseDotted: 4 },
    PriceScaleMode: { Normal: 0, Logarithmic: 1, Percentage: 2, IndexedTo100: 3 },
  };
});

import StockChart, { getThemeColors } from "@/components/chart/StockChart";
import { useSettingsStore } from "@/store/settingsStore";

const 봉들 = Array.from({ length: 40 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 0, 2 + i)).toISOString().slice(0, 10);
  return { date: d, open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i, volume: 1000 + i };
});

/** 마지막으로 만든 본 차트의 바탕색 */
const 바탕 = () => {
  const 판들 = 만든것.filter((x) => x?.layout?.background);
  return 판들[판들.length - 1]?.layout.background.color;
};

beforeEach(() => {
  만든것.length = 0;
  document.documentElement.className = "dark";
  useSettingsStore.getState().setColorScheme("red-blue");
});

describe("종목 차트 색", () => {
  it("테마마다 카드·글자·선 색이 다르다 — 등락 색은 설정을 따른다", () => {
    const 다크 = getThemeColors("red-blue", false);
    const 라이트 = getThemeColors("red-blue", true);
    expect(다크.card).toBe("#1a1f2e");
    expect(라이트.card).toBe("#ffffff");
    expect(라이트.text).not.toBe(다크.text);
    expect(라이트.border).not.toBe(다크.border);
    expect([다크.up, 다크.down]).toEqual([라이트.up, 라이트.down]);
    expect(getThemeColors("green-red", false).up).not.toBe(다크.up);
  });

  it("떠 있는 동안 테마가 바뀌면 새 색으로 다시 그린다 — 오가도", async () => {
    render(<StockChart data={봉들 as never} height={300} />);
    expect(바탕()).toBe("#1a1f2e");
    await act(async () => { document.documentElement.classList.replace("dark", "light"); });
    expect(바탕(), "라이트로 바꿨는데 차트가 다크 판 그대로다").toBe("#ffffff");
    await act(async () => { document.documentElement.classList.replace("light", "dark"); });
    expect(바탕()).toBe("#1a1f2e");
  });

  it("라이트로 열면 처음부터 라이트 판 — 다크로 한 번 그렸다 다시 그리지 않는다", () => {
    document.documentElement.className = "light";
    render(<StockChart data={봉들 as never} height={300} />);
    const 바탕들 = 만든것.filter((x) => x?.layout?.background).map((x) => x.layout.background.color);
    expect(바탕들.length).toBeGreaterThan(0);
    expect(바탕들, "다크 판을 먼저 만들었다 — 열 때 번쩍이고 차트를 두 번 만든다").toEqual(바탕들.map(() => "#ffffff"));
  });
});
