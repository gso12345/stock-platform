/**
 * 차트에서 **값을 읽을 수 있는가**, 그리고 칸끼리 **줄이 맞는가**.
 *
 * ── 줄이 안 맞던 이유 ──
 *
 * 칸마다 따로 만든 차트라 값 축 너비가 그 칸의 글자 길이대로 정해진다.
 *
 *   본 차트  "₩2,400,000"  →  넓다
 *   RSI      "70"          →  좁다
 *   MACD     "250,000"     →  중간
 *
 * 축이 넓으면 그림 그리는 자리가 좁아진다. 그래서 세 칸의 시간축이 서로
 * 어긋나고 같은 날짜가 세로로 안 맞는다. 지표를 보는 이유가 '이 봉일 때
 * RSI 가 얼마였나' 인데, 그 세로줄이 안 맞으면 볼 수가 없다.
 *
 * ── 단위가 틀리던 것 ──
 *
 * 통화 표기가 모든 칸에 걸려서 RSI 가 '₩42.734', MACD 가 '₩250,000' 으로
 * 나왔다. RSI 는 0~100 짜리 지수지 돈이 아니다 — 단위가 틀리면 그 숫자는
 * 읽는 사람을 속인다.
 */
import { describe, it, expect } from "vitest";
import { 봉읽기 } from "@/components/chart/StockChart";

const 봉 = (date: string, o: number, h: number, l: number, c: number, v = 1000) =>
  ({ date, time: date, open: o, high: h, low: l, close: c, volume: v });

describe("봉읽기", () => {
  const 봉들 = [
    봉("2026-08-20", 1000, 1100, 950, 1000),
    봉("2026-08-21", 1000, 1200, 990, 1100, 2000),
    봉("2026-08-24", 1100, 1150, 1000, 1045),
  ];

  it("그 봉의 네 값을 그대로 준다", () => {
    const r = 봉읽기(봉들, 1)!;
    expect(r.시가).toBe(1000);
    expect(r.고가).toBe(1200);
    expect(r.저가).toBe(990);
    expect(r.종가).toBe(1100);
    expect(r.거래량).toBe(2000);
  });

  it("전날 대비 등락률을 낸다", () => {
    /* 1000 → 1100 = +10% */
    expect(봉읽기(봉들, 1)!.등락률).toBeCloseTo(10);
    /* 1100 → 1045 = -5% */
    expect(봉읽기(봉들, 2)!.등락률).toBeCloseTo(-5);
  });

  it("첫 봉은 등락률이 없다", () => {
    /* 비교할 전날이 없다. 0 으로 두면 '안 움직였다' 는 거짓말이 된다 */
    expect(봉읽기(봉들, 0)!.등락률).toBeNull();
  });

  it("전날 종가가 0이면 나누지 않는다", () => {
    const 이상한것 = [봉("2026-08-20", 0, 0, 0, 0), 봉("2026-08-21", 10, 12, 9, 11)];
    expect(봉읽기(이상한것, 1)!.등락률).toBeNull();
  });

  it("날짜를 열 글자로 자른다", () => {
    /* 분봉은 '2026-08-21T09:30:00' 처럼 온다. 그대로 적으면 줄이 넘친다 */
    const 분봉 = [{ ...봉("x", 1, 1, 1, 1), time: "2026-08-21T09:30:00" }];
    expect(봉읽기(분봉, 0)!.날짜).toBe("2026-08-21");
  });

  it("켜 둔 지표 값을 같이 준다", () => {
    /* 지표를 켜는 이유가 이 숫자다. 선만 보이고 값을 못 읽으면
       '30을 깼나' 를 눈으로 어림해야 한다 */
    const r = 봉읽기(봉들, 1, { "RSI(14)": 42.73, MA5: 1050 })!;
    expect(r.지표["RSI(14)"]).toBeCloseTo(42.73);
    expect(r.지표.MA5).toBe(1050);
  });

  it("지표를 안 켰으면 빈 칸", () => {
    expect(봉읽기(봉들, 1)!.지표).toEqual({});
  });

  it("없는 칸이면 없다", () => {
    expect(봉읽기(봉들, 99)).toBeNull();
    expect(봉읽기([], 0)).toBeNull();
  });

  it("거래량이 없는 자료도 안 터진다", () => {
    const 량없음 = [{ date: "2026-08-20", time: "2026-08-20", open: 1, high: 2, low: 1, close: 2 }];
    expect(봉읽기(량없음, 0)!.거래량).toBe(0);
  });
});

describe("칸끼리 줄이 맞는가", () => {
  const 소스 = () => {
    const fs = require("fs") as typeof import("fs");
    const path = require("path") as typeof import("path");
    return fs.readFileSync(path.resolve(__dirname, "../StockChart.tsx"), "utf-8");
  };

  it("제일 넓은 축에 나머지를 맞춘다", () => {
    const s = 소스();
    expect(s).toContain("축너비_맞추기");
    // 재서 제일 큰 것을 고르고, 그것을 바닥값으로 준다
    expect(s).toContain('priceScale("right").width()');
    expect(s).toContain("minimumWidth: 제일넓은");
  });

  it("칸을 다 만든 뒤에 잰다", () => {
    /* 만드는 도중에 재면 글자가 아직 안 그려져 있어 0 이거나 기본값이다 */
    const s = 소스();
    expect(s).toMatch(/requestAnimationFrame\(\(\) => 축너비맞추기Ref\.current\?\.\(\)\)/);
  });

  it("크기가 바뀌면 다시 맞춘다", () => {
    /* 전체보기로 열었다 닫으면 자릿수가 달라져 축 너비도 달라진다.
       안 맞추면 그때부터 줄이 어긋난 채로 남는다 */
    const s = 소스();
    const 시작 = s.indexOf("const resize = () => {");
    expect(시작).toBeGreaterThan(-1);
    expect(s.slice(시작, 시작 + 700)).toContain("축너비맞추기Ref.current?.()");
  });

  it("크기가 바뀌면 아래 칸도 같이 넓힌다", () => {
    /* 본 차트만 넓히면 아래 칸은 옛 폭 그대로라 통째로 어긋난다.

       창을 넉넉히 잡으면 뒤따르는 정리 코드의 같은 글자를 집는다 —
       resize 함수가 끝나는 자리까지만 본다 */
    const s = 소스();
    const 시작 = s.indexOf("const resize = () => {");
    expect(시작).toBeGreaterThan(-1);
    const 끝 = s.indexOf('window.addEventListener("resize", resize);', 시작);
    expect(끝).toBeGreaterThan(시작);
    expect(s.slice(시작, 끝)).toContain("subRefs.current.forEach");
  });
});

describe("지표 칸에 돈 표시를 안 붙인다", () => {
  const 소스 = () => {
    const fs = require("fs") as typeof import("fs");
    const path = require("path") as typeof import("path");
    return fs.readFileSync(path.resolve(__dirname, "../StockChart.tsx"), "utf-8");
  };

  it("본 차트만 통화로 적는다", () => {
    const s = 소스();
    expect(s).toContain("mkChart(mainRef.current, heightRef.current, true)");
    // 나머지 칸은 기본값(false)으로 만든다 — 인자를 안 넘긴다
    expect(s).toContain("const mkChart = (el: HTMLDivElement, h: number, 돈인가 = false)");
  });

  it("돈이 아닐 때는 숫자만 적는다", () => {
    const s = 소스();
    expect(s).toMatch(/돈인가 \? \(isKR \? `₩\$\{p\.toLocaleString\("ko-KR"\)\}` : `\$\$\{p\.toFixed\(2\)\}`\)\s*:\s*지표숫자\(p\)/);
  });

  it("지표 칸을 통화로 만드는 자리가 없다", () => {
    /* 새 지표를 넣는 사람이 실수로 true 를 넘기면 그 칸만 다시
       '₩42.734' 가 된다 */
    const s = 소스();
    expect((s.match(/mkChart\([^)]*, true\)/g) ?? []).length).toBe(1);
  });
});

describe("읽는 줄이 화면에 붙어 있는가", () => {
  /* 함수만 맞고 화면이 안 쓰면 아무 소용이 없다 */
  const 소스 = () => {
    const fs = require("fs") as typeof import("fs");
    const path = require("path") as typeof import("path");
    return fs.readFileSync(path.resolve(__dirname, "../StockChart.tsx"), "utf-8");
  };

  it("십자선을 따라 읽는다", () => {
    const s = 소스();
    expect(s).toContain("main.subscribeCrosshairMove");
    expect(s).toContain('data-testid="읽는줄"');
  });

  it("같은 봉 위에서는 다시 안 그린다", () => {
    /* 마우스가 1px 움직일 때마다 React 를 다시 돌리면 손이 미끄러진다 */
    const s = 소스();
    expect(s).toContain("if (읽은때Ref.current === param.time) return;");
  });

  it("마우스를 올리기 전에도 마지막 봉을 보여 준다", () => {
    /* 휴대폰에는 아예 마우스가 없다. 빈 줄만 있으면 이 줄이 무엇인지
       알 방법이 없다 */
    const s = 소스();
    expect(s).toContain('읽은때Ref.current = "끝";');
  });

  it("지표 값을 미리 담아 둔다 — 움직일 때 계산하지 않는다", () => {
    /* 봉 수천 개짜리 차트에서 마우스가 움직일 때마다 RSI 를 다시
       계산하면 손이 미끄러진다 */
    const s = 소스();
    expect(s).toContain("지표값Ref.current = new Map()");
    const 시작 = s.indexOf("main.subscribeCrosshairMove");
    expect(시작).toBeGreaterThan(-1);
    /* 콜백 안쪽만 본다. 뒤에 오는 지표 칸 만들기에는 calc 가 당연히 있다 */
    const 끝 = s.indexOf('읽은때Ref.current = "끝";\n    set읽은값', 시작);
    expect(끝).toBeGreaterThan(시작);
    expect(s.slice(시작, 끝)).not.toMatch(/calc[A-Z]/);
  });

  it("오름·내림 색은 설정을 따른다", () => {
    /* 이 줄만 못 박아 두면 같은 화면 안에서 빨강이 두 뜻을 갖는다 */
    const s = 소스();
    expect(s).toContain('colorScheme === "red-blue" ? "text-accent-red" : "text-accent-green"');
  });

  it("읽는 줄과 축이 같은 표기를 쓴다", () => {
    /* 축은 ₩1,234,000 인데 읽는 줄만 1234000 이면 같은 값이 두 모양이 된다 */
    const s = 소스();
    expect(s).toContain('isKR ? `₩${Math.round(v).toLocaleString("ko-KR")}` : `$${v.toFixed(2)}`');
  });
});
