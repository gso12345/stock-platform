/**
 * 종목상세 '앱처럼' 모양 — "앱느낌이 너무 안 나는 것 같아"
 *
 * 지금은 화면 모양을 셋 중에 고를 수 있다(기본/간단히/앱처럼). 이 파일은
 * 그중 '앱처럼' 가지가 무너지지 않게 지킨다. 셋이 서로 다른지는
 * ScreenLayout 테스트가 본다.
 *
 * 휴대폰 폭으로 띄워 보니 시세 지표 열 개가 굵은 칸선이 그어진 격자로
 * 펼쳐져 화면의 절반을 먹었다. 스프레드시트처럼 보였고, 정작 종목상세에
 * 들어온 이유인 차트는 스크롤해야 나왔다. 차트 위에도 컨트롤이 세 줄
 * (기간 / 캔들·라인·영역·LOG / 지표) 이었다.
 *
 * 화면 자체는 눈으로 확인했다(브라우저로 띄워 사진을 찍었다). 여기서
 * 못 박는 건 그 구조가 되돌아가지 않게 하는 것이다.
 */
import { describe, it, expect } from "vitest";
import StockDetail원문 from "../../pages/StockDetail.tsx?raw";
import StockChart원문 from "../chart/StockChart.tsx?raw";

describe("시세 지표", () => {
  it("차트 아래 '통계' 로 내려간다", () => {
    /* 다른 앱들은 종목명 → 큰 가격 → 곧바로 차트다. 지표를 가격 옆에
       붙여 두면 차트가 화면 한 장 뒤로 밀린다 */
    const 통계 = StockDetail원문.indexOf("{/* 통계 한눈에 보기");
    const 차트그리는곳 = StockDetail원문.indexOf("<StockChart");
    expect(통계).toBeGreaterThan(-1);
    expect(차트그리는곳).toBeGreaterThan(-1);
    expect(통계).toBeGreaterThan(차트그리는곳);

    // 자리만 옮기고 안 그리면 지표가 통째로 사라진 것이다
    const 구역 = StockDetail원문.slice(통계, 통계 + 700);
    expect(구역).toMatch(/화면모양 === "app" && mainTab === "chart" && d && \(/);
  });

  it("기본으로 여섯만 편다", () => {
    /* 열 개를 한 번에 펴면 휴대폰에서 화면 절반이다 */
    expect(StockDetail원문).toMatch(/시세더보기 \? priceItems : priceItems\.slice\(0, 6\)/);
  });

  it("'앱처럼' 에서는 가격을 카드에 가두지 않는다", () => {
    /* 제목 밑에 큰 숫자가 바로 오는 것이 앱의 모양이다. 테두리를 두르면
       한 덩어리로 안 읽힌다. 다른 모양에서는 테두리를 그대로 둔다 */
    expect(StockDetail원문).toMatch(
      /화면모양 === "app" \? "overflow-hidden"\s*\n?\s*: "rounded-xl border border-border bg-bg-card overflow-hidden"/);
  });

  it("나머지를 펼치는 버튼이 있다", () => {
    /* 접기만 하고 펼 방법이 없으면 정보를 지운 것이다 */
    expect(StockDetail원문).toMatch(/set시세더보기/);
    expect(StockDetail원문).toMatch(/시세더보기 \? "접기" : "더보기"/);
  });

  it("칸선을 긋지 않는다", () => {
    /* 굵은 격자선이 스프레드시트 느낌의 주범이었다 */
    const 시작 = StockDetail원문.indexOf("{/* 통계 한눈에 보기");
    expect(시작).toBeGreaterThan(-1);
    const 구역 = StockDetail원문.slice(시작, 시작 + 1400);
    expect(구역).not.toMatch(/border-r border-border/);
    expect(구역).not.toMatch(/border-t border-border/);
  });

  it("로딩 뼈대에 옛 격자가 남아 있지 않다", () => {
    /* 뼈대가 열 칸인데 본체는 차트 아래 3열이라, 값이 도착할 때 화면이
       크게 튀었다 */
    const 시작 = StockDetail원문.indexOf("뼈대는 실제로 그려질 모양과 같아야 한다");
    expect(시작).toBeGreaterThan(-1);
    const 구역 = StockDetail원문.slice(시작, 시작 + 400);
    expect(구역).not.toMatch(/배당수익률/);
    expect(구역).not.toMatch(/52주/);
  });
});

describe("차트 컨트롤", () => {
  it("캔들·라인·LOG 는 톱니를 눌렀을 때만 편다", () => {
    /* 늘 펼쳐 두면 차트가 보이기도 전에 컨트롤이 세 줄이 된다 */
    expect(StockDetail원문).toMatch(/set차트설정열림/);
    // classic 은 늘 펼친다 — 정보를 다 보려고 고른 모양이라 그게 맞다
    expect(StockDetail원문).toMatch(/\{\(화면모양 === "classic" \|\| 차트설정열림\) && \(/);
  });

  it("지표 이름표와 설정은 차트 위에 겹쳐 얹는다", () => {
    /* 줄을 따로 두면 그만큼 차트가 아래로 밀린다 */
    expect(StockChart원문).toMatch(/absolute top-1\.5 left-2 right-2/);
    // 겹쳐 놓아도 차트를 눌러 움직이는 것은 막지 않아야 한다
    expect(StockChart원문).toMatch(/pointer-events-none/);
    expect(StockChart원문).toMatch(/pointer-events-auto/);
  });

  it("지표 설정 버튼에 이름이 있다", () => {
    /* 아이콘만 있는 버튼은 화면을 읽어주는 프로그램에서 '버튼'으로만 읽힌다 */
    expect(StockChart원문).toMatch(/aria-label="지표 설정"/);
  });
});
