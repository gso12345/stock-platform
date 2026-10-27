/**
 * 넓은 화면(PC)에서 앱 전체를 같은 비율로 키운다 — 사용자: "스크리닝 PC버전에서 축소가 너무 많이돼",
 * "스크리닝뿐만 아니라 다른 메뉴들도 고려해줘".
 *
 * 글자 크기는 휴대폰에 맞춰져 있다(뿌리 14px, 본문 12.2px). 같은 크기를 1,500px 넓이에 깔면 화면 전체를
 * 줄여 놓은 것처럼 보였다. 화면마다 lg: 로 따로 키우면 메뉴마다 들쭉날쭉해지므로, 뿌리 글자 하나를 올린다 —
 * 글자·여백·칸 폭이 모두 rem 이라 모든 메뉴가 같은 비율로 커진다.
 *
 * 여기서 못 박는 것 —
 *   1) 1024px 부터 +1px, 1536px 부터 +2px — 설정의 글씨 크기(작게·크게·아주 크게)도 같은 폭으로
 *   2) 넓은 화면 규칙이 기본 규칙 **뒤에** 있다(같은 우선순위라 뒤의 것이 이긴다)
 *   3) 그래프 글자도 rem — px 로 박으면 화면은 커지는데 눈금만 그대로 작다
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { 그래프글자, 가로축, 축, 툴팁 } from "@/utils/chartTheme";

const 뿌리 = path.resolve(__dirname, "../..");
const css = () => fs.readFileSync(path.join(뿌리, "index.css"), "utf-8");

/** 규칙 덩어리 안의 html 글자 크기들 → { 기본, small, large, xl } */
function 크기들(덩어리: string) {
  const 하나 = (선택자: string) => {
    const m = 덩어리.match(new RegExp(`${선택자.replace(".", "\\.")}\\s*\\{\\s*font-size:\\s*(\\d+)px`));
    return m ? Number(m[1]) : null;
  };
  return { 기본: 하나("html"), small: 하나("html.font-small"), large: 하나("html.font-large"), xl: 하나("html.font-xl") };
}

function 미디어덩어리(최소폭: number): string {
  const s = css();
  const 시작 = s.indexOf(`@media (min-width: ${최소폭}px)`);
  expect(시작, `${최소폭}px 규칙이 없다`).toBeGreaterThan(-1);
  /* 덩어리 끝 — 안쪽 } 들을 세며 바깥 } 까지 */
  let 깊이 = 0;
  for (let i = s.indexOf("{", 시작); i < s.length; i++) {
    if (s[i] === "{") 깊이++;
    if (s[i] === "}" && --깊이 === 0) return s.slice(시작, i + 1);
  }
  return s.slice(시작);
}

describe("넓은 화면은 뿌리 글자를 한 눈금씩 올린다", () => {
  const 기본 = { 기본: 14, small: 12, large: 16, xl: 18 };

  it.each([[1024, 1], [1536, 2]])("%ipx 부터 설정마다 +%ipx", (폭, 더함) => {
    const 잰것 = 크기들(미디어덩어리(폭));
    for (const k of Object.keys(기본) as (keyof typeof 기본)[]) {
      expect(잰것[k], `${폭}px · ${k}: '크게' 를 고른 사람이 PC 에서 '보통' 보다 작아지면 안 된다`).toBe(기본[k] + 더함);
    }
  });

  it("넓은 화면 규칙이 기본 규칙 뒤에 있다 — 같은 우선순위라 뒤의 것이 이긴다", () => {
    const s = css();
    const 기본자리 = s.indexOf("html.font-xl    { font-size: 18px; }");
    expect(기본자리).toBeGreaterThan(-1);
    expect(s.indexOf("@media (min-width: 1024px)")).toBeGreaterThan(기본자리);
    expect(s.indexOf("@media (min-width: 1536px)")).toBeGreaterThan(s.indexOf("@media (min-width: 1024px)"));
  });

  it("왼쪽 메뉴가 나오는 폭(lg)과 같은 데서 시작한다 — 휴대폰·태블릿 크기는 그대로", () => {
    const 설정 = fs.readFileSync(path.resolve(뿌리, "../tailwind.config.js"), "utf-8");
    /* 화면마다 쓰는 lg: 와 어긋나면 사이 폭에서 왼쪽 메뉴는 없는데 글자만 커지는 구간이 생긴다 */
    expect(설정, "화면 폭 기준(screens)을 바꿨다 — lg 가 1024px 가 아니면 여기 규칙도 같이 옮겨야 한다")
      .not.toMatch(/\bscreens\s*:/);
    expect(미디어덩어리(1024)).toContain("html");
  });
});

describe("본문 폭도 같이 넓어진다", () => {
  it("본문 최대 폭이 rem — px 이면 글자만 커지고 폭은 그대로라 큰 모니터에서 담기는 칸이 줄었다", () => {
    const 틀 = fs.readFileSync(path.join(뿌리, "components/layout/Layout.tsx"), "utf-8");
    const 본문 = 틀.slice(틀.indexOf("<main"), 틀.indexOf("<Suspense", 틀.indexOf("<main")));
    expect(본문).toMatch(/max-w-\[[\d.]+rem\]/);
    expect(본문).not.toMatch(/max-w-\[\d+px\]/);
  });
});

describe("그래프 툴팁은 한 곳에서", () => {
  it("화면 코드에 툴팁 상자(contentStyle)를 손으로 적지 않는다 — chartTheme 의 툴팁만", () => {
    /* 손으로 적은 곳마다 모양이 달랐고, 한 곳은 어두운 색을 박아 밝은 화면에서도 검은 상자가 떴다 */
    const 걸린것: string[] = [];
    const 훑기 = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (e.name !== "__tests__") 훑기(p); continue; }
        if (!/\.tsx?$/.test(e.name) || p.endsWith(path.join("utils", "chartTheme.ts"))) continue;
        if (fs.readFileSync(p, "utf-8").includes("contentStyle")) 걸린것.push(path.relative(뿌리, p));
      }
    };
    훑기(뿌리);
    expect(걸린것).toEqual([]);
  });
});

describe("그래프 글자도 rem — 뿌리를 따라 커진다", () => {
  it("눈금·범례·툴팁 글자가 rem 이다", () => {
    for (const v of Object.values(그래프글자)) expect(v).toMatch(/^[\d.]+rem$/);
    expect(가로축.tick.fontSize).toBe(그래프글자.눈금);
    expect(축.tick.fontSize).toBe(그래프글자.눈금);
    expect(툴팁.contentStyle.fontSize).toBe(그래프글자.툴팁);
  });

  it("화면 코드에 px 그래프 글자가 없다(자산 지도 칸 이름은 px 로 칸 폭을 재서 예외)", () => {
    const 걸린것: string[] = [];
    const 훑기 = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (e.name !== "__tests__") 훑기(p); continue; }
        if (!/\.tsx?$/.test(e.name) || e.name === "AssetTreemap.tsx") continue;
        const 글 = fs.readFileSync(p, "utf-8");
        for (const m of 글.matchAll(/fontSize(?::|=\{)\s*\d+/g)) 걸린것.push(`${path.relative(뿌리, p)}: ${m[0]}`);
      }
    };
    훑기(뿌리);
    expect(걸린것).toEqual([]);
  });
});
