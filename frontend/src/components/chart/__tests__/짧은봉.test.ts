/**
 * 봉이 모자랄 때 지표가 터지지 않는가.
 *
 * ── 어떻게 드러났나 ──
 *
 * 두 함수가 봉 개수를 안 보고 배열을 읽고 있었다.
 *
 *   calcMACD  macdLine[signal-1] 을 가드 없이 읽는다. macdLine 길이는
 *             봉 수 − 25 라(EMA26 을 거치며 깎인다) 34봉 미만이면 undefined.
 *   calcATR   가드가 `data.length < 2` 인데 실제로 읽는 것은 data[period].
 *             그래서 0·1봉은 살고 **2~14봉이 죽는** 거꾸로 된 모양이었다.
 *
 * 이 예외는 차트를 그리는 useEffect 안에서 난다. 그래서 화면에는 오류가
 * 안 뜨고 **차트가 통째로 안 그려진다** — 사용자는 '이 종목은 차트가
 * 없나' 로 읽는다.
 *
 * 닿는 자리가 분명하다. 갓 상장한 종목(한 달이면 일봉 20개 남짓),
 * 거래정지가 길었던 종목, 그리고 짧은 기간을 고른 채 설정에서 그 지표를
 * 켜는 경우.
 *
 * ── 왜 함수마다가 아니라 한꺼번에 보나 ──
 *
 * 이건 한 함수의 실수가 아니라 **한 종류의 실수**다. 지표를 새로 넣는
 * 사람이 같은 자리를 또 밟는다. 그래서 내보낸 지표를 전부 자동으로 훑는다 —
 * 새 지표를 넣으면 이 검사가 저절로 그것도 본다.
 */
import { describe, it, expect } from "vitest";
import * as 지표 from "@/components/chart/indicators";
import type { OHLCV } from "@/components/chart/indicators";

const 봉 = (i: number): OHLCV =>
  ({ date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
     open: 100 + i, high: 105 + i, low: 95 + i, close: 100 + i, volume: 1000 + i } as never);

const 봉들 = (n: number) => Array.from({ length: n }, (_, i) => 봉(i));

/** 기간을 두 번째 인자로 받는 것들 — 기본값이 있어도 명시해 준다.
 *  안 넘기면 undefined 가 들어가 엉뚱한 데서 터지고, 그건 이 검사가
 *  보려는 것이 아니다 */
const 기간필요 = new Set(["calcMA", "calcEMA"]);

describe("봉이 모자라도 안 터진다", () => {
  const 함수들 = Object.entries(지표)
    .filter(([k, v]) => k.startsWith("calc") && typeof v === "function") as [string, (...a: unknown[]) => unknown][];

  it("내보낸 지표를 다 훑는다 — 새 지표도 저절로 포함된다", () => {
    expect(함수들.length).toBeGreaterThanOrEqual(15);
  });

  it.each([0, 1, 2, 3, 5, 10, 14, 20, 25, 26, 30, 33, 34, 40])(
    "%i봉에서 어느 지표도 예외를 안 던진다", (n) => {
      const 자료 = 봉들(n);
      const 터진것: string[] = [];
      for (const [이름, fn] of 함수들) {
        try {
          if (기간필요.has(이름)) fn(자료, 20);
          else fn(자료);
        } catch (e) {
          터진것.push(`${이름}: ${(e as Error).message}`);
        }
      }
      expect(터진것, `${n}봉에서 터진 지표`).toEqual([]);
    },
  );
});

describe("MACD", () => {
  it("34봉 미만이면 빈 것을 준다", () => {
    /* 0으로 채우거나 짧은 평균으로 어림하지 않는다. MACD 는 26봉 추세와
       12봉 추세의 차이라, 그만큼이 안 모였으면 낼 값이 없는 것이지
       '0에 가까운 값' 인 것이 아니다 */
    for (const n of [0, 1, 20, 26, 30, 33]) {
      const r = 지표.calcMACD(봉들(n));
      expect(r.macdLine, `${n}봉`).toEqual([]);
      expect(r.signalLine, `${n}봉`).toEqual([]);
      expect(r.histogram, `${n}봉`).toEqual([]);
    }
  });

  it("34봉부터는 값이 나온다", () => {
    const r = 지표.calcMACD(봉들(34));
    expect(r.signalLine.length).toBeGreaterThan(0);
    expect(r.macdLine.length).toBe(r.signalLine.length);
    expect(r.histogram.length).toBe(r.signalLine.length);
  });

  it("세 줄의 길이가 늘 같다", () => {
    /* 길이가 어긋나면 히스토그램이 엉뚱한 날짜에 붙는다 */
    for (const n of [34, 40, 60, 90]) {
      const r = 지표.calcMACD(봉들(n));
      expect(r.macdLine.length, `${n}봉`).toBe(r.signalLine.length);
      expect(r.histogram.length, `${n}봉`).toBe(r.signalLine.length);
    }
  });

  it("기간을 바꾸면 필요한 봉 수도 따라 바뀐다", () => {
    /* 설정에서 12/26/9 를 고칠 수 있다. 기본값에만 맞춘 가드면
       기간을 늘린 사람이 다시 터진다 */
    expect(지표.calcMACD(봉들(40), 5, 35, 9).signalLine).toEqual([]);
    expect(지표.calcMACD(봉들(50), 5, 35, 9).signalLine.length).toBeGreaterThan(0);
  });

  it("시그널 기간이 0 이하면 안 그린다", () => {
    /* 0으로 나누면 NaN 이 되고, NaN 은 그래프에서 조용히 사라진다 */
    expect(지표.calcMACD(봉들(60), 12, 26, 0).signalLine).toEqual([]);
  });
});

describe("ATR", () => {
  it("기간 이하면 빈 것을 준다", () => {
    /* 예전 가드는 `< 2` 라, 0·1봉은 살고 2~14봉이 죽었다 */
    for (const n of [0, 1, 2, 5, 10, 14]) {
      expect(지표.calcATR(봉들(n)), `${n}봉`).toEqual([]);
    }
  });

  it("기간보다 하나 많으면 첫 점이 나온다", () => {
    const r = 지표.calcATR(봉들(15));
    expect(r).toHaveLength(1);
    expect(r[0].time).toBe("2026-01-15");
  });

  it("기간을 바꾸면 경계도 따라 바뀐다", () => {
    expect(지표.calcATR(봉들(20), 20)).toEqual([]);
    expect(지표.calcATR(봉들(21), 20)).toHaveLength(1);
  });

  it("기간이 0 이하면 안 그린다", () => {
    /* 0으로 나누면 NaN 이다 */
    expect(지표.calcATR(봉들(60), 0)).toEqual([]);
  });

  it("값이 다 유한하다", () => {
    /* NaN·Infinity 가 섞이면 세로 범위가 통째로 망가진다 */
    for (const v of 지표.calcATR(봉들(60))) {
      expect(Number.isFinite(v.value)).toBe(true);
    }
  });
});
