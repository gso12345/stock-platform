/**
 * 기본정보의 PER·EPS 가 처음 들어갔을 때부터 나온다 —
 * "종목상세탭 EPS가 재무제표 EPS 들어간 다음에만 나와"
 *
 * 기본정보와 재무제표 탭은 같은 값(finTabData.dEnhanced)을 본다. 그런데 그
 * 값을 채우는 fundamentals 질의가 `mainTab === "financial"` 일 때만 돌았다.
 * 그래서 기본정보의 EPS 는 재무제표 탭을 한 번 들렀다 돌아와야 나타났다.
 *
 * 처음 들어온 사람에게는 그냥 "EPS 가 없는 종목" 으로 보인다. 재무제표 탭에
 * 들어갔다 나오면 나온다는 것을 알아챌 방법이 없다.
 *
 * 여기서 못 박는 것 —
 *   1) 기본정보가 재무탭 전용 질의에 매여 있지 않다
 *   2) 그렇다고 늘 부르지도 않는다 — detail 이 값을 주면 요청이 안 나간다
 *   3) 기본정보에 PER·EPS 칸이 실제로 있다
 */
import { describe, it, expect } from "vitest";
import StockDetail원문 from "../../pages/StockDetail.tsx?raw";

/** 어떤 useQuery 블록의 본문.
 *
 *  같은 키가 prefetchQuery 에도 쓰인다. 그쪽을 잡으면 enabled 가 아예 없어
 *  검사가 통째로 헛돈다 — useQuery 쪽만 고른다. */
function 질의(키: string): string {
  const 시작 = StockDetail원문.indexOf(`useQuery({\n    queryKey: ["${키}"`);
  expect(시작, `${키} 의 useQuery 를 못 찾았다`).toBeGreaterThan(-1);
  const 끝 = StockDetail원문.indexOf("});", 시작);
  const 본문 = StockDetail원문.slice(시작, 끝);
  expect(본문, `${키} 질의에 enabled 가 없다`).toMatch(/enabled:/);
  return 본문;
}

describe("기본정보 지표가 언제 채워지는가", () => {
  it("fundamentals 가 재무탭에만 매여 있지 않다", () => {
    /* 여기가 이 파일의 알맹이다. `enabled` 가 재무탭 조건 하나뿐이면
       기본정보 EPS 는 재무제표 탭을 들렀다 와야 나온다 */
    const 본문 = 질의("stock-fundamentals");
    expect(본문).toMatch(/enabled:/);
    expect(본문).not.toMatch(/enabled: !!sym && mainTab === "financial",/);
  });

  it("detail 이 값을 주면 아예 안 부른다", () => {
    /* 늘 부르면 종목을 열 때마다 요청이 하나 더 는다. 0.15 CPU 서버에서
       종목 목록을 훑는 사람에게는 그게 그대로 지연이 된다 */
    const 본문 = 질의("stock-fundamentals");
    expect(본문).toMatch(/기본지표가_비었나/);

    const i = StockDetail원문.indexOf("const 기본지표가_비었나");
    const 판정 = StockDetail원문.slice(i, StockDetail원문.indexOf("\n", i));
    /* eps 와 per 을 둘 다 보고, '없음' 으로 판정한다는 것이 요점이다.
       0 도 없음으로 치도록 유효() 를 거치게 바뀌었으므로(백엔드가 eps=0.0 을
       주는 경로가 있다) 철자를 그대로 박아 두지 않는다 */
    expect(판정).toMatch(/eps\)? == null/);
    expect(판정).toMatch(/per\)? == null/);
  });

  it("0 을 '값 있음' 으로 착각하지 않는다", () => {
    /* == null 은 0 을 값으로 본다. 그래서 백엔드가 eps=0.0 을 준 종목에서는
       이 폴백이 열리지도 않았다 — 화면에는 'EPS 0원' 이 확정으로 떴다 */
    const i = StockDetail원문.indexOf("const 기본지표가_비었나");
    const 판정 = StockDetail원문.slice(i, StockDetail원문.indexOf("\n", i));
    expect(판정).toMatch(/유효\(/);
  });

  it("detail 이 아직 안 왔을 때는 안 부른다", () => {
    /* detail 이 undefined 인 첫 순간에 '비었다'고 판단하면, 값을 줄 종목에도
       요청이 한 번 나가 버린다 */
    const i = StockDetail원문.indexOf("const 기본지표가_비었나");
    const 판정 = StockDetail원문.slice(i, StockDetail원문.indexOf("\n", i));
    expect(판정).toMatch(/!!detail/);
  });

  it("재무제표 탭에서는 예전처럼 계속 부른다", () => {
    /* 재무탭은 PER·EPS 말고도 많은 것을 쓴다. detail 이 그 둘을 줬다고
       재무탭까지 안 부르면 그 탭이 빈다 */
    expect(질의("stock-fundamentals")).toMatch(/mainTab === "financial"/);
  });
});

describe("기본정보에 그 칸이 있다", () => {
  it("PER·EPS 가 기본정보 목록에 들어 있다", () => {
    /* 값을 불러와도 그릴 자리가 없으면 아무 일도 안 한 것이다.
       재무제표 탭에도 같은 글자가 있어서, 기본정보 목록 안에서만 본다 */
    const i = StockDetail원문.indexOf("const priceItems");
    expect(i).toBeGreaterThan(-1);
    const 목록 = StockDetail원문.slice(i, StockDetail원문.indexOf("}, [d?.open", i));
    expect(목록).toMatch(/label:"PER"/);
    expect(목록).toMatch(/label:"EPS"/);
  });

  it("EPS 는 재무제표 탭과 같은 값을 본다", () => {
    /* 두 곳이 서로 다른 출처를 보면, 같은 화면에서 한쪽만 비는 일이
       또 생긴다 — 이번 문의의 뿌리가 그거였다 */
    const i = StockDetail원문.indexOf("const 기본EPS");
    const 줄 = StockDetail원문.slice(i, StockDetail원문.indexOf("\n", i));
    expect(줄).toMatch(/finTabData\.dEnhanced/);
  });
});
