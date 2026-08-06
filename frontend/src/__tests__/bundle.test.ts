/**
 * 화면마다 처음 받는 JS 가 얼마나 되는가 —
 * "피드속도 처음 들어갈 때 느림"
 *
 * 두 번째부터는 괜찮은데 처음만 느리다면 서버 캐시로는 설명이 안 된다.
 * 빌드 산출물을 뜯어 보니 피드가 recharts 409KB 를 받고 있었다. 피드는
 * 차트를 한 장도 안 그리는데.
 *
 * 왜 딸려왔나 — recharts 가 clsx 를 의존한다. vite 설정이 묶음을 이름표로
 * 가르고 있어서(`{ "chart-recharts": ["recharts"] }`), rollup 이 recharts 에서
 * 도달 가능한 clsx 까지 그 청크로 끌어갔다. 그러자 clsx 를 쓰는 공용 ui
 * 청크가 차트 묶음을 import 하게 됐고, 결국 **모든 화면**이 recharts 를
 * 받았다.
 *
 * ── 이 파일이 preload 가 아니라 import 체인을 보는 이유 ──
 *
 * 처음에는 vite 의 modulepreload 목록을 세고 "707KB → 308KB" 라고 적었다.
 * 틀렸다. preload 목록에서 빼는 것은 `<link rel=modulepreload>` 를 지울
 * 뿐, import 문은 그대로라 같은 바이트를 **더 늦게** 받는다. 병렬이 직렬이
 * 되니 오히려 나빠진다.
 *
 * 그래서 여기서는 실제 import 문을 따라간다. 그것만이 "모듈 본문이 실행되기
 * 전에 반드시 받아야 하는 것" 이다.
 *
 * dist 가 없으면 건너뛴다(테스트가 빌드를 강요하지는 않는다).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ASSETS = join(process.cwd(), "dist", "assets");
const 빌드있음 = existsSync(ASSETS);

/** 한 청크가 정적으로 import 하는 파일들 */
function 바로가져오는것(파일: string): string[] {
  const s = readFileSync(join(ASSETS, 파일), "utf8").slice(0, 8000);
  return [...s.matchAll(/from"\.\/([^"]+)"|import"\.\/([^"]+)"/g)]
    .map((m) => m[1] ?? m[2])
    .filter((f) => f.endsWith(".js"));
}

/** 라우트를 열 때 실제로 받아야 하는 청크 전부 (import 를 끝까지 따라간다) */
function 받는것(라우트: string): string[] {
  const 시작 = readdirSync(ASSETS).find((f) => f.startsWith(라우트) && f.endsWith(".js"));
  if (!시작) return [];
  const 본것 = new Set<string>();
  const 남은 = [시작];
  while (남은.length) {
    const f = 남은.pop()!;
    if (본것.has(f) || !existsSync(join(ASSETS, f))) continue;
    본것.add(f);
    남은.push(...바로가져오는것(f));
  }
  return [...본것];
}

const KB = (파일들: string[]) =>
  파일들.reduce((s, f) => s + statSync(join(ASSETS, f)).size, 0) / 1024;

describe.skipIf(!빌드있음)("첫 진입에 받는 JS", () => {
  it("피드가 recharts 를 안 받는다", () => {
    /* 여기가 알맹이다. 피드에는 차트가 없다 */
    const c = 받는것("Feed-");
    expect(c.length, "Feed 청크를 못 찾았다 — 빌드가 오래됐을 수 있다").toBeGreaterThan(0);
    expect(c.filter((f) => f.includes("recharts"))).toEqual([]);
  });

  it("차트 없는 화면들도 안 받는다", () => {
    /* clsx 가 차트 묶음에 섞이면 이 화면들이 한꺼번에 무거워진다 —
       실제로 대시보드·퀀트·관심종목이 다 recharts 를 받고 있었다 */
    for (const 라우트 of ["Dashboard-", "Quant-", "Watchlist-"]) {
      const c = 받는것(라우트);
      if (!c.length) continue;
      expect(c.filter((f) => f.includes("recharts")), 라우트).toEqual([]);
    }
  });

  it("피드가 받는 양이 500KB 를 넘지 않는다", () => {
    /* 고치기 전 817KB. 넉넉히 잡아도 이 선을 넘으면 뭔가 또 딸려온 것이다 */
    const kb = KB(받는것("Feed-"));
    expect(kb, `피드가 ${kb.toFixed(0)}KB 를 받는다`).toBeLessThan(500);
  });

  it("차트를 정말 쓰는 화면은 그대로 받는다", () => {
    /* 내 자산과 종목상세는 차트가 화면의 알맹이다. 여기서까지 빼면
       그림이 늦게 뜬다 — 미루는 것이 늘 이득은 아니다 */
    const 자산 = 받는것("Portfolio-");
    if (자산.length) expect(자산.some((f) => f.includes("recharts"))).toBe(true);
  });
});

describe("소스 쪽 약속", () => {
  it("묶음을 이름표가 아니라 경로로 가른다", () => {
    /* 배열 방식은 recharts 에서 도달 가능한 것을 전부 끌어간다.
       clsx 가 그렇게 끌려 들어갔다 */
    const s = readFileSync(join(process.cwd(), "vite.config.ts"), "utf8");
    expect(s).toMatch(/manualChunks\(id/);
    // 주석에 옛 방식을 예시로 적어 두므로, 실제 설정 값만 본다
    const 코드 = s.split("\n").filter((l) => !l.trim().startsWith("*") && !l.includes("//")).join("\n");
    expect(코드).not.toMatch(/manualChunks:\s*\{/);
  });

  it("공용 유틸을 차트 묶음에서 떼어 둔다", () => {
    const s = readFileSync(join(process.cwd(), "vite.config.ts"), "utf8");
    const i = s.indexOf("manualChunks(id");
    const 구역 = s.slice(i, i + 1400);
    // clsx 판정이 recharts 판정보다 앞에 있어야 한다
    const clsx = 구역.indexOf("clsx");
    const recharts = 구역.indexOf("chart-recharts");
    expect(clsx, "clsx 를 따로 빼는 규칙이 없다").toBeGreaterThan(-1);
    expect(clsx).toBeLessThan(recharts);
  });

  it("피드가 포트폴리오 그림을 정적으로 걸지 않는다", () => {
    const s = readFileSync(join(process.cwd(), "src/pages/Feed.tsx"), "utf8");
    expect(s).not.toMatch(/^import PortfolioSnapshot from/m);
    expect(s).toMatch(/lazy\(\(\) => import\(.*PortfolioSnapshot/);
  });

  it("preload 를 손대서 해결한 척하지 않는다", () => {
    /* modulePreload 필터는 링크만 지운다 — 같은 바이트를 더 늦게 받게
       될 뿐이라 오히려 나빠진다. 한 번 그렇게 고쳤다가 되돌렸다 */
    const s = readFileSync(join(process.cwd(), "vite.config.ts"), "utf8");
    expect(s).not.toMatch(/resolveDependencies/);
  });
});
