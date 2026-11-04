/**
 * 앱 설정 하나가 기준 — 사용자: "다크모드의 다크모드 화이트모드의 다크모드 다크모드의 화이트 모드 등 색깔이 다달라 /
 * 시스템설정과 앱설정이 통일이 되지 않아 / 심지어 같은 다크모드여도 색깔이 달라".
 *
 * 브라우저에 `color-scheme: dark light`(둘 다 된다)라고만 알려서, 브라우저가 기기 설정을 보고 색 모드를 골랐다 —
 * 브라우저 부품(달력·고르기 목록)과 크롬 '웹사이트 어둡게' 의 덧칠이 기기 설정을 따라, 같은 앱 다크인데 테두리가
 * 하얗게 바뀌고 앱 라이트는 새까만 가짜 다크가 됐다(실제 화면으로 찍어 확인). 이제 앱이 고른 밝기를 그대로 알린다.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { 테마적용, 상태줄색, 색모드 } from "@/utils/테마";

const 뿌리 = resolve(__dirname, "../../..");
const indexHtml = readFileSync(resolve(뿌리, "index.html"), "utf8");
const 시작스크립트 = indexHtml.match(/<script>\s*([\s\S]*?)<\/script>/)![1];
const css = readFileSync(resolve(뿌리, "src/index.css"), "utf8");
const 매니페스트 = JSON.parse(readFileSync(resolve(뿌리, "public/manifest.json"), "utf8"));

/** 테스트 문서를 index.html 처음 모습으로 — html 은 다크 클래스, 머리에 색 모드·상태 표시줄 메타 */
function 처음문서() {
  const html = document.documentElement;
  html.className = "dark";
  document.head.innerHTML = '<meta name="color-scheme" content="dark"><meta name="theme-color" content="#0f1117">';
}
const 지금 = () => ({
  클래스: [...document.documentElement.classList].filter((c) => c === "light" || c === "dark").sort().join(" "),
  색모드: document.querySelector('meta[name="color-scheme"]')!.getAttribute("content"),
  상태줄: document.querySelector('meta[name="theme-color"]')!.getAttribute("content"),
});

beforeEach(() => { localStorage.clear(); 처음문서(); });

describe("테마적용 — 클래스·색 모드·상태 표시줄을 한꺼번에", () => {
  it("다크", () => {
    테마적용(false);
    expect(지금()).toEqual({ 클래스: "dark", 색모드: "dark", 상태줄: 상태줄색.dark });
  });

  it("라이트 — 'only' 가 있어야 브라우저가 어둡게 덧칠하지 않는다", () => {
    테마적용(true);
    expect(지금()).toEqual({ 클래스: "light", 색모드: "only light", 상태줄: 상태줄색.light });
    expect(document.documentElement.classList.contains("dark"), "라이트인데 dark 클래스가 남았다").toBe(false);
  });

  it("오가도 남는 것이 없다", () => {
    테마적용(true); 테마적용(false);
    expect(지금()).toEqual({ 클래스: "dark", 색모드: "dark", 상태줄: 상태줄색.dark });
  });

  it("메타가 없어도 터지지 않는다", () => {
    document.head.innerHTML = "";
    expect(() => 테마적용(true)).not.toThrow();
    expect(document.documentElement.classList.contains("light")).toBe(true);
  });
});

describe("화면을 그리기 전(index.html 첫 스크립트)도 같은 규칙", () => {
  function 돌리기(앱설정: string | null, 기기가라이트: boolean) {
    처음문서();
    localStorage.clear();
    if (앱설정) localStorage.setItem("portfolio_settings", JSON.stringify({ theme: 앱설정 }));
    window.matchMedia = ((q: string) => ({ matches: 기기가라이트 && q.includes("light") })) as never;
    new Function(시작스크립트)();
    return 지금();
  }
  /** 테마적용 이 같은 밝기로 칠한 결과 */
  function 기대(밝음: boolean) {
    처음문서();
    테마적용(밝음);
    return 지금();
  }

  it.each([
    ["dark", false], ["light", true],
  ] as const)("앱 설정 %s — 기기가 라이트든 다크든 똑같다", (앱설정, 밝음) => {
    const 기기라이트 = 돌리기(앱설정, true);
    const 기기다크 = 돌리기(앱설정, false);
    expect(기기라이트, "같은 앱 설정인데 기기 설정에 따라 달라진다").toEqual(기기다크);
    expect(기기라이트, "Layout(테마적용)과 다르게 칠한다").toEqual(기대(밝음));
  });

  it("'시스템' 이면(저장값이 없어도) 기기를 따른다", () => {
    expect(돌리기("system", true)).toEqual(기대(true));
    expect(돌리기("system", false)).toEqual(기대(false));
    expect(돌리기(null, true)).toEqual(기대(true));
  });

  it("색 모드 글자가 테마적용 과 같다", () => {
    for (const 밝음 of [true, false]) expect(시작스크립트).toContain(`"${색모드(밝음)}"`);
    expect(시작스크립트).toContain(`"${상태줄색.light}"`);
    expect(시작스크립트).toContain(`"${상태줄색.dark}"`);
  });

  it("메타가 스크립트보다 먼저 있다 — 나중에 있으면 스크립트가 못 바꾼다", () => {
    const 메타 = indexHtml.indexOf('<meta name="color-scheme"');
    expect(메타).toBeGreaterThan(-1);
    expect(메타).toBeLessThan(indexHtml.indexOf("<script>"));
    expect(indexHtml.indexOf('<meta name="theme-color"')).toBeLessThan(indexHtml.indexOf("<script>"));
  });

  it("'둘 다 된다'(dark light)로 알리지 않는다 — 그러면 브라우저가 기기 설정을 본다", () => {
    expect(indexHtml).not.toMatch(/color-scheme"\s+content="dark light"/);
    expect(indexHtml.match(/<meta name="color-scheme"/g)).toHaveLength(1);
    expect(indexHtml.match(/<meta name="theme-color"/g)).toHaveLength(1);
  });
});

describe("CSS — 브라우저가 그리는 부품도 앱 설정을 따른다", () => {
  it("html 에 다크, html.light 에 only light", () => {
    expect(css).toMatch(/html\s*\{\s*color-scheme:\s*dark;\s*\}/);
    expect(css).toMatch(/html\.light\s*\{\s*color-scheme:\s*only light;\s*\}/);
    expect(css, "기기 설정으로 갈리는 규칙이 생겼다").not.toMatch(/prefers-color-scheme/);
  });
});

describe("상태 표시줄 색 = 바로 아래 머리 줄(bg-primary)", () => {
  const 값 = (덩어리: string, 이름: string) => 덩어리.match(new RegExp(`${이름}:\\s*(#[0-9a-fA-F]{6})`))![1].toLowerCase();
  const 다크 = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
  const 라이트 = css.slice(css.indexOf("html.light {"), css.indexOf("}", css.indexOf("html.light {")));

  it("두 테마 모두 머리 줄과 같은 색 — 다르면 휴대폰 위쪽에 경계가 보인다", () => {
    expect(상태줄색.dark).toBe(값(다크, "--bg-primary"));
    expect(상태줄색.light).toBe(값(라이트, "--bg-primary"));
  });

  it("설치한 앱의 처음 색도 다크 머리 줄 색", () => {
    expect(매니페스트.theme_color).toBe(상태줄색.dark);
  });
});
