/**
 * 옆으로 넘치는 줄마다 끝 흐림이 붙어 있는가(디자인 6번). 흐리는 동작 자체는 hooks/__tests__/useEdgeFade 와
 * 탭단계 가 본다 — 여기서는 사용자가 짚은 줄들(종목 상세 탭, 스크리닝 도구 단추, 관심종목 폴더)과 같은 종류의
 * 줄들이 실제로 그 훅을 잇고 있는지를 본다.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const 읽기 = (f: string) => readFileSync(resolve(__dirname, "..", "..", f), "utf-8");

const 쓰는곳: Array<[string, Array<[string, string]>]> = [
  ["pages/StockDetail.tsx", [["탭줄", "탭줄흐림"], ["재무탭줄", "재무탭줄흐림"], ["배지줄", "배지줄흐림"]]],
  ["pages/Screening.tsx", [["도구줄", "도구줄흐림"]]],
  ["pages/Watchlist.tsx", [["폴더줄", "폴더줄흐림"]]],
  ["pages/Portfolio.tsx", [["포트폴리오줄", "포트폴리오줄흐림"], ["유형줄", "유형줄흐림"], ["비중탭줄", "비중탭줄흐림"]]],
  ["components/ipo/IpoBrokerFilter.tsx", [["칩줄", "칩줄흐림"]]],
];

describe.each(쓰는곳)("%s", (f, 줄들) => {
  const 글 = 읽기(f);
  it.each(줄들)("%s — 훅을 부르고, 줄에 ref 와 흐림 클래스를 단다", (ref: string, 흐림: string) => {
    expect(글).toContain(`const [${ref}, ${흐림}] = use끝흐림<HTMLDivElement>();`);
    expect(글).toContain(`ref={${ref}}`);
    expect(글).toMatch(new RegExp(`className=\\{\`[^\`]*\\$\\{${흐림}\\}`));
  });
});

describe("종목 상세 — 메인 탭과 재무제표 항목 탭에 붙어 있다", () => {
  it("탭 목록 이름 바로 앞에 ref", () => {
    const 글 = 읽기("pages/StockDetail.tsx");
    expect(글).toContain('<div ref={탭줄} role="tablist" aria-label="종목 정보"');
    expect(글).toContain('<div ref={재무탭줄} role="tablist" aria-label="재무제표 항목"');
  });
});
