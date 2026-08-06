/**
 * 화면마다 처음 받는 JS 가 얼마나 되는가 —
 * "피드속도 처음 들어갈 때 느림"
 *
 * 두 번째부터는 괜찮은데 처음만 느리다면, 서버 캐시로는 설명이 안 된다.
 * 빌드 산출물을 뜯어 보니 피드 라우트가 recharts 를 통째로 끌고 있었다.
 *
 *   Feed 진입에 받는 것: 707KB (그중 recharts 400KB = 57%)
 *
 * 경로는 Feed → PortfolioSnapshot → PortfolioChart → recharts 였다. ESM 은
 * 의존 그래프를 다 받아야 모듈 본문이 실행되므로, **피드의 첫 API 요청이
 * 그 400KB 를 기다린 뒤에 시작**됐다. 정작 그 그림은 '포트폴리오를 공유한
 * 글' 에만 나온다 — 그런 글이 하나도 없는 피드에서도 값을 치른 셈이다.
 *
 * 이 파일은 빌드 산출물을 직접 읽는다. 소스만 봐서는 번들러가 실제로
 * 무엇을 묶었는지 알 수 없다 — lazy 로 바꿔도 modulePreload 가 도로
 * 끌어오는 일이 실제로 있었다.
 *
 * dist 가 없으면 건너뛴다(테스트가 빌드를 강요하지는 않는다).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIST = join(process.cwd(), "dist");
const ASSETS = join(DIST, "assets");
const 빌드있음 = existsSync(ASSETS);

/** 라우트 청크가 처음 받는 파일들 (vite 의 modulepreload 목록) */
function 미리받는것(라우트: string): string[] {
  const 진입 = readdirSync(ASSETS)
    .filter((f) => f.startsWith("index-") && f.endsWith(".js"))
    .map((f) => readFileSync(join(ASSETS, f), "utf8"))
    .find((s) => s.includes("__vite__mapDeps"));
  if (!진입) return [];

  const 표 = 진입.match(/m\.f=(\[[\s\S]*?\])\)\)/);
  if (!표) return [];
  const 파일들: string[] = JSON.parse(표[1].replace(/'/g, '"'));

  const 쓰임 = new RegExp(
    `import\\("\\./(${라우트}[^"]+)"\\)\\s*,\\s*__vite__mapDeps\\(\\[([\\d,\\s]+)\\]\\)`,
  ).exec(진입);
  if (!쓰임) return [];
  return 쓰임[2].split(",").filter((x) => x.trim()).map((i) => 파일들[Number(i)]);
}

const 합계KB = (파일들: string[]) =>
  파일들.reduce((s, f) => {
    const p = join(DIST, f);
    return s + (existsSync(p) ? statSync(p).size : 0);
  }, 0) / 1024;

describe.skipIf(!빌드있음)("첫 진입에 받는 JS", () => {
  it("피드가 recharts 를 끌고 오지 않는다", () => {
    /* 여기가 알맹이다. 이게 무너지면 피드 첫 진입이 다시 400KB 를 기다린다 */
    const 받는것 = 미리받는것("Feed-");
    expect(받는것.length, "Feed 청크를 못 찾았다 — 빌드가 오래됐을 수 있다").toBeGreaterThan(0);
    expect(받는것.filter((f) => f.includes("recharts"))).toEqual([]);
  });

  it("피드가 받는 양이 400KB 를 넘지 않는다", () => {
    /* 예전에는 707KB 였다. 넉넉히 잡아도 이 선을 넘으면 뭔가 또 딸려온 것이다 */
    const kb = 합계KB(미리받는것("Feed-"));
    expect(kb, `피드가 ${kb.toFixed(0)}KB 를 받는다`).toBeLessThan(400);
  });

  it("내 자산·대시보드도 recharts 를 미리 받지 않는다", () => {
    /* 이 화면들은 recharts 를 정말 쓴다. 그래도 '미리' 받을 필요는 없다 —
       정적 import 가 필요할 때 받는다. 미리 받으면 첫 그림보다 먼저 그것을
       기다린다 */
    for (const 라우트 of ["Portfolio-", "Dashboard-"]) {
      const 받는것 = 미리받는것(라우트);
      if (받는것.length === 0) continue;
      expect(받는것.filter((f) => f.includes("recharts")), 라우트).toEqual([]);
    }
  });

  it("종목상세는 차트 묶음을 미리 받는다", () => {
    /* 여기는 차트가 주인공이다. recharts 와 달리 lightweight-charts 는
       빼지 않는다 — 빼면 차트가 한 박자 늦게 그려진다 */
    const 받는것 = 미리받는것("StockDetail-");
    if (받는것.length === 0) return;
    expect(받는것.some((f) => f.includes("chart-lw"))).toBe(true);
  });
});

describe("소스 쪽 약속", () => {
  it("피드가 포트폴리오 그림을 정적으로 걸지 않는다", () => {
    /* 빌드 없이도 이건 지킬 수 있다. 정적 import 로 되돌리면 recharts 가
       그대로 따라온다 */
    const s = readFileSync(join(process.cwd(), "src/pages/Feed.tsx"), "utf8");
    expect(s).not.toMatch(/^import PortfolioSnapshot from/m);
    expect(s).toMatch(/lazy\(\(\) => import\(.*PortfolioSnapshot/);
  });

  it("preload 에서 recharts 를 실제로 걸러낸다", () => {
    /* lazy 만으로는 부족했다 — vite 가 도로 preload 목록에 넣는다.
       "chart-recharts 라는 글자가 있다" 로는 부족하다. 거르는 조건을
       `true` 로 바꿔 놓아도 통과해 버린다(실제로 겪었다). 그래서 걸러내는
       식 자체를 본다 — 부정형으로 제외하고 있는가. */
    const s = readFileSync(join(process.cwd(), "vite.config.ts"), "utf8");
    const i = s.indexOf("modulePreload");
    expect(i, "modulePreload 설정이 없다").toBeGreaterThan(-1);
    const 구역 = s.slice(i, i + 400);
    expect(구역).toMatch(/resolveDependencies/);
    // deps.filter(...) 안에서 recharts 를 !includes 로 빼고 있어야 한다
    expect(구역).toMatch(/!\s*\w+\.includes\(["'][^"']*chart-recharts/);
  });
});
