/**
 * any 가 되돌아오지 않게 막는다.
 *
 * any 는 "타입을 모르겠다" 가 아니라 "검사를 끄겠다" 는 뜻이다. 서버가
 * 필드 이름을 바꿔도, 오타를 내도, 빌드가 아무 말을 안 한다 — 화면이
 * 조용히 빈칸을 그리고 아무도 모른다.
 *
 * 한 번에 다 없앨 수는 없다(500곳이었다). 대신 **줄여 놓은 파일이
 * 다시 늘어나는 것**만 막는다. 새로 만드는 파일은 0에서 시작한다.
 *
 * 아래 수를 올리려면 이유가 있어야 한다. 대개는 타입을 적는 편이 빠르다.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const 뿌리 = path.resolve(__dirname, "../..");

/** 파일별 허용치 — 지금 값이다. 늘리지 말 것 */
const 상한: Record<string, number> = {
  // 여러 화면이 함께 쓰는 자리. 여기 any 하나가 화면 열 곳으로 번진다
  "utils/prices.ts": 0,
  "api/stocks.ts": 2,          // nxt·analyst 는 서버 응답 모양이 아직 안 정해졌다
  // 이번에 훑은 화면들
  "pages/Watchlist.tsx": 1,
  "components/watchlist/WatchlistModals.tsx": 0,
  // 새로 만든 것들 — 처음부터 0
  "components/ui/Pagination.tsx": 0,
  "components/ui/ModalFooter.tsx": 0,
  "components/portfolio/AssetHistory.tsx": 0,
  "components/portfolio/DividendCalendar.tsx": 0,
  "components/stock/AlertButton.tsx": 0,
  "components/stock/DailyTab.tsx": 0,
};

/** 주석 안의 any 는 세지 않는다 — 왜 없앴는지 적어 두는 것까지 막을 이유가 없다 */
function any수(글: string): number {
  const 코드 = 글
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\/.*$/gm, "");
  return (코드.match(/\bany\b/g) ?? []).length;
}

describe("any 되돌아오지 않기", () => {
  it.each(Object.entries(상한))("%s 는 any 가 %d개 이하", (rel, 최대) => {
    const 글 = fs.readFileSync(path.join(뿌리, rel), "utf-8");
    const n = any수(글);
    expect(n, `${rel} 의 any 가 ${n}개로 늘었다 (허용 ${최대})`).toBeLessThanOrEqual(최대);
  });

  it("주석 안의 any 는 안 센다", () => {
    /* 이 검사가 없으면, 위 검사를 통과하려고 '왜 없앴는지' 적어 둔
       설명까지 지우게 된다 */
    expect(any수("/* any 를 없앴다 */\nconst a = 1;")).toBe(0);
    expect(any수("// any 로 두면 안 된다\nconst a = 1;")).toBe(0);
    expect(any수("const a: any = 1;")).toBe(1);
  });

  it("공용 시세 유틸에는 any 가 없다", () => {
    /* 여기가 뚫리면 이걸 쓰는 화면 전부가 함께 뚫린다 —
       내 자산·관심종목·종목상세가 다 이 파일을 지나간다 */
    expect(any수(fs.readFileSync(path.join(뿌리, "utils/prices.ts"), "utf-8"))).toBe(0);
  });
});
