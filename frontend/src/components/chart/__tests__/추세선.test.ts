/**
 * 추세선 그리기 — 증권사 차트에 있고 여기 없던 것.
 *
 * 지표는 열여섯 개나 붙어 있는데, 정작 차트 분석의 절반인 '선을 긋는
 * 일' 이 없었다. 고점 두 개를 이어 저항선을, 저점 두 개를 이어 지지선을
 * 보는 것 — MTS 를 켜는 사람이 제일 먼저 하는 일이다. 그게 없으면
 * 지표가 아무리 많아도 남이 계산해 준 값을 읽는 데서 끝난다.
 *
 * 좌표를 화면 픽셀로 담으면 확대하거나 옮기는 순간 선이 엉뚱한 데로
 * 간다. 시각과 가격으로 담고, 그릴 때마다 차트에게 좌표를 물어본다.
 */
import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import {
  선들읽기, 선들쓰기, 선까지거리, 고른선, 새id, type 추세선,
} from "@/components/chart/TrendLines";

const 선 = (id: string): 추세선 =>
  ({ id, t1: "2026-08-20", p1: 100, t2: "2026-08-24", p2: 120, 색: "#3b82f6" });

beforeEach(() => { try { localStorage.clear(); } catch { /* 무시 */ } });

describe("담고 꺼내기", () => {
  it("그은 선이 다시 열어도 남는다", () => {
    선들쓰기("KR", "005930", [선("a"), 선("b")]);
    expect(선들읽기("KR", "005930")).toHaveLength(2);
  });

  it("종목마다 따로 담는다", () => {
    /* 삼성전자에 그은 선이 애플에 뜨면 안 된다 */
    선들쓰기("KR", "005930", [선("a")]);
    expect(선들읽기("US", "AAPL")).toEqual([]);
  });

  it("시장이 다르면 따로다", () => {
    선들쓰기("KR", "AAPL", [선("a")]);
    expect(선들읽기("US", "AAPL")).toEqual([]);
  });

  it("다 지우면 담긴 것도 없앤다", () => {
    선들쓰기("KR", "005930", [선("a")]);
    선들쓰기("KR", "005930", []);
    expect(localStorage.getItem("차트선:KR:005930")).toBeNull();
  });

  it("손상된 칸은 버리고 나머지는 살린다", () => {
    /* 하나가 이상하다고 나머지까지 잃을 이유가 없다 */
    localStorage.setItem("차트선:KR:005930", JSON.stringify([
      선("a"), { id: "b" }, { p1: 1, p2: 2 }, null,
    ]));
    expect(선들읽기("KR", "005930")).toHaveLength(1);
  });

  it("담긴 게 망가졌으면 빈 것으로 본다", () => {
    localStorage.setItem("차트선:KR:005930", "{망가진");
    expect(선들읽기("KR", "005930")).toEqual([]);
  });

  it("저장이 막혀도 안 터진다", () => {
    /* 시크릿 창·용량 초과. 기억을 못 하는 것과 화면이 하얘지는 것은
       완전히 다른 문제다 */
    const 원래 = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error("막힘"); };
    try {
      expect(() => 선들쓰기("KR", "005930", [선("a")])).not.toThrow();
    } finally { Storage.prototype.setItem = 원래; }
  });
});

describe("선까지거리", () => {
  /* 그은 선을 지우려면 그 선을 눌러야 하는데, 손가락이 선 위에 정확히
     떨어질 리가 없다 */

  it("선 위면 0", () => {
    expect(선까지거리(5, 5, 0, 0, 10, 10)).toBeCloseTo(0);
  });

  it("수직으로 떨어진 만큼", () => {
    expect(선까지거리(5, 3, 0, 0, 10, 0)).toBeCloseTo(3);
  });

  it("선분 **밖**은 끝점까지로 잰다", () => {
    /* 무한 직선으로 재면, 선을 그은 구간에서 한참 떨어진 데를 눌러도
       잡힌다 — 화면 반대쪽을 눌렀는데 선이 지워진다 */
    expect(선까지거리(20, 0, 0, 0, 10, 0)).toBeCloseTo(10);
    expect(선까지거리(-5, 0, 0, 0, 10, 0)).toBeCloseTo(5);
  });

  it("점 하나로 뭉친 선도 잰다", () => {
    /* 0 으로 나누면 NaN 이 되고, NaN 비교는 늘 거짓이라 영영 안 잡힌다 */
    expect(선까지거리(3, 4, 0, 0, 0, 0)).toBeCloseTo(5);
  });
});

describe("고른선", () => {
  const 선들 = [
    { id: "가로", x1: 0, y1: 0, x2: 100, y2: 0 },
    { id: "세로", x1: 0, y1: 0, x2: 0, y2: 100 },
  ];

  it("제일 가까운 것을 고른다", () => {
    expect(고른선(선들, 50, 2)?.id).toBe("가로");
    expect(고른선(선들, 2, 50)?.id).toBe("세로");
  });

  it("멀면 아무것도 안 고른다", () => {
    /* 빈 데를 눌렀는데 선이 지워지면 그게 더 나쁘다 */
    expect(고른선(선들, 50, 40)).toBeNull();
  });

  it("한계를 넘기면 안 고른다", () => {
    expect(고른선(선들, 50, 9)).toBeNull();
    expect(고른선(선들, 50, 7)?.id).toBe("가로");
  });

  it("선이 없으면 없다", () => {
    expect(고른선([], 0, 0)).toBeNull();
  });
});

describe("새id", () => {
  it("겹치지 않는다", () => {
    const 것들 = new Set(Array.from({ length: 200 }, () => 새id()));
    expect(것들.size).toBe(200);
  });
});

describe("차트에 붙어 있는가", () => {
  const 소스 = () => fs.readFileSync(
    path.resolve(__dirname, "../StockChart.tsx"), "utf-8");

  it("좌표를 시각·가격으로 잡는다", () => {
    /* 화면 픽셀로 담으면 확대하거나 옮기는 순간 선이 엉뚱한 데로 간다 */
    const s = 소스();
    expect(s).toContain("timeToCoordinate");
    expect(s).toContain("priceToCoordinate");
    expect(s).toContain("coordinateToPrice");
  });

  it("화면을 옮기면 다시 그린다", () => {
    const s = 소스();
    expect(s).toContain("subscribeVisibleLogicalRangeChange(() => 덧그리기())");
  });

  it("창 크기가 바뀌어도 다시 그린다", () => {
    const s = 소스();
    const 시작 = s.indexOf("const resize = () => {");
    const 끝 = s.indexOf('window.addEventListener("resize", resize);', 시작);
    expect(s.slice(시작, 끝)).toContain("다시그리기Ref.current?.()");
  });

  it("화면 밖 좌표는 지어내지 않는다", () => {
    /* null 을 0 으로 치면 선이 왼쪽 위 구석에 붙어 그려진다 */
    const s = 소스();
    expect(s).toContain("return x == null || y == null ? null");
  });

  it("덧판이 누름을 막지 않는다", () => {
    /* 누르는 것은 차트가 받아야 한다. 판이 가로채면 확대도 못 한다 */
    const s = 소스();
    expect(s).toContain('<canvas ref={덧판Ref} className="absolute inset-0 pointer-events-none" />');
  });

  it("종목이 바뀌면 그 종목 선을 읽는다", () => {
    const s = 소스();
    expect(s).toContain("선들읽기(market, symbol)");
    expect(s).toContain("indicatorToggles, market, symbol]");
  });

  it("도구 버튼이 있다", () => {
    const s = 소스();
    expect(s).toContain("aria-pressed={그리기중}");
    expect(s).toContain("지우기 {선수}");
  });

  it("무엇을 눌러야 하는지 말해 준다", () => {
    /* 두 번 눌러야 한 선인데, 안 적어 두면 한 번 누르고 고장인 줄 안다 */
    const s = 소스();
    expect(s).toContain("시작점을 누르세요");
    expect(s).toContain("끝점을 누르세요");
  });
});

describe("PC 에서 차트가 납작하지 않게", () => {
  it("창 높이를 따라간다", async () => {
    const { 차트높이계산 } = await import("@/pages/StockDetail");
    /* 420px 로 못 박혀 있었다. 레이아웃 최대 폭은 1,600px 인데 높이가
       420 이면 큰 화면에서 가로로 길쭉하고 납작한 띠가 된다 —
       세로로 눌린 캔들은 등락 폭이 실제보다 작아 보인다 */
    expect(차트높이계산(1600, 1200)).toBeGreaterThan(차트높이계산(1600, 800));
  });

  it("너무 낮거나 높지 않게 가둔다", async () => {
    const { 차트높이계산 } = await import("@/pages/StockDetail");
    expect(차트높이계산(1920, 3000)).toBeLessThanOrEqual(640);
    expect(차트높이계산(1920, 400)).toBeGreaterThanOrEqual(360);
  });

  it("휴대폰은 낮게 잡는다", async () => {
    const { 차트높이계산 } = await import("@/pages/StockDetail");
    /* 손에 쥐고 보는 화면에서 차트가 다 먹으면 아무것도 못 본다 */
    expect(차트높이계산(390, 844)).toBeLessThan(차트높이계산(1280, 844));
    expect(차트높이계산(390, 844)).toBeLessThanOrEqual(340);
  });
});
