/**
 * 앱처럼 보이는가 — 브라우저 기본 동작 끄기.
 *
 * 설치형(PWA)인데 만지면 웹페이지 티가 났다. 화면을 다시 그려서가
 * 아니라, 브라우저가 기본으로 하는 '웹스러운 행동' 이 그대로 남아
 * 있어서다. 다섯 가지가 특히 컸다.
 *
 *   1) 누를 때 회색·파란 사각형이 번쩍인다
 *   2) 눌러도 아무 반응이 없다 — 손가락에는 hover 가 없는데
 *      버튼 399곳 중 22곳(5.5%)만 눌린 표시가 있었다
 *   3) 위아래로 당기면 화면이 튕기거나 새로고침된다
 *   4) 버튼을 길게 누르면 글자가 잡히고 복사 메뉴가 뜬다
 *   5) 검색창을 누르면 화면 전체가 확대된다(iOS)
 *
 * 이건 한 번 넣으면 눈에 안 띄는 종류라, 나중에 CSS 를 정리하다
 * 조용히 지워지기 쉽다. 그래서 못 박아 둔다.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const 뿌리 = path.resolve(__dirname, "../..");
const css = fs.readFileSync(path.join(뿌리, "index.css"), "utf-8");
const html = fs.readFileSync(path.resolve(뿌리, "../index.html"), "utf-8");

describe("브라우저 티 없애기", () => {
  it("누를 때 번쩍이는 사각형을 끈다", () => {
    expect(css).toMatch(/-webkit-tap-highlight-color:\s*transparent/);
  });

  it("당겨서 새로고침·바운스를 막는다", () => {
    expect(css).toMatch(/overscroll-behavior-y:\s*none/);
  });

  it("버튼을 길게 눌러도 글자가 안 잡힌다", () => {
    expect(css).toMatch(/-webkit-touch-callout:\s*none/);
    expect(css).toMatch(/user-select:\s*none/);
  });

  it("입력칸 글자는 고를 수 있다", () => {
    /* user-select 는 물려받는다. 검색창이 header 안에 있어서, header 에
       none 을 걸면 검색어를 드래그해 고치는 것까지 막힌다 —
       브라우저에서 재 보고서야 알았다. */
    expect(css).toMatch(/:where\(input, textarea, \[contenteditable\]\)/);
    const 자리 = css.indexOf(":where(input, textarea, [contenteditable])");
    expect(css.slice(자리, 자리 + 200)).toMatch(/user-select:\s*text/);
    // 푸는 규칙이 거는 규칙보다 뒤에 와야 이긴다(우선순위가 같다)
    expect(자리).toBeGreaterThan(css.indexOf("-webkit-touch-callout: none"));
  });

  it("본문 글자는 여전히 복사할 수 있다", () => {
    /* 종목코드·금액은 복사할 수 있어야 한다. user-select:none 을
       body 나 * 에 걸면 그게 막힌다 — 실제로 흔한 실수다. */
    const 막는규칙 = css.slice(css.indexOf("-webkit-touch-callout"));
    const 앞 = css.slice(0, css.indexOf("-webkit-touch-callout"));
    const 선택자 = 앞.slice(앞.lastIndexOf(":where"));
    expect(선택자).toContain("button");
    expect(선택자).not.toMatch(/:where\(\s*\*/);
    expect(막는규칙.slice(0, 200)).not.toMatch(/^\s*body\b/m);
  });
});

describe("눌린 느낌", () => {
  it("hover 가 없는 기기에서만 켠다", () => {
    /* 마우스에서는 이미 hover 가 있다. 거기서도 누를 때 흐려지면
       오히려 어색하다. */
    expect(css).toMatch(/@media\s*\(hover:\s*none\)/);
  });

  it("버튼·탭·링크를 다 덮는다", () => {
    const 자리 = css.indexOf("@media (hover: none)");
    expect(자리).toBeGreaterThan(-1);
    const 덩어리 = css.slice(자리, 자리 + 400);
    for (const 것 of ["button", '[role="button"]', '[role="tab"]', '[role="switch"]', "a"]) {
      expect(덩어리, `${것} 가 빠졌다`).toContain(것);
    }
    expect(덩어리).toMatch(/:active/);
  });

  it("우선순위 0(:where)이라 따로 준 스타일이 이긴다", () => {
    /* 하단 탭은 scale-95 로 더 또렷하게 눌린다. 여기서 덮어써 버리면
       그게 사라진다. */
    const 자리 = css.indexOf("@media (hover: none)");
    expect(css.slice(자리, 자리 + 400)).toContain(":where(");
  });
});

describe("iOS 확대 막기", () => {
  it("입력칸 글자를 16px 로 올린다", () => {
    /* iOS 는 16px 보다 작은 입력칸을 누르면 화면을 확대한다.
       검색창을 누를 때마다 화면이 커졌다 되돌아왔다. */
    expect(css).toMatch(/input,\s*select,\s*textarea\s*\{\s*font-size:\s*16px/);
  });

  it("손가락 확대는 막지 않는다", () => {
    /* maximum-scale=1 로 우회하는 방법이 흔한데, 그러면 눈이 불편한
       사람이 손가락으로 키우는 것까지 막힌다. */
    expect(html).not.toMatch(/maximum-scale/);
    expect(html).not.toMatch(/user-scalable\s*=\s*no/);
  });

  it("노치 영역까지 그린다", () => {
    expect(html).toMatch(/viewport-fit=cover/);
  });
});

describe("모서리 둥글기", () => {
  const 소스 = (() => {
    const 결과: string[] = [];
    const 훑기 = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (e.name !== "__tests__") 훑기(p); }
        else if (/\.tsx?$/.test(e.name)) 결과.push(fs.readFileSync(p, "utf-8"));
      }
    };
    훑기(뿌리);
    return 결과.join("\n");
  })();

  it("rounded-md 를 안 쓴다 — lg 와 2px 차이라 눈에 안 보이는 층이었다", () => {
    expect(소스).not.toMatch(/\brounded-md\b/);
  });

  it("쓰는 층이 다섯 가지를 안 넘는다", () => {
    /* 층이 많으면 같은 종류의 상자가 화면마다 다르게 보인다 */
    const 층 = new Set(
      [...소스.matchAll(/\brounded-(sm|md|lg|xl|2xl|3xl|full)\b/g)].map((m) => m[1]),
    );
    expect([...층].sort().join(" ")).toBe("2xl 3xl full lg sm xl");
    expect(층.size).toBeLessThanOrEqual(6);
  });
});
