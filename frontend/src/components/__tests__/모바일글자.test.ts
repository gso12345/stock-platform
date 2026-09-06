/**
 * 휴대폰에서만 글자가 커지던 것.
 *
 * '모바일에서 글자가 너무 크다' 를 듣고 재 봤다. 코드가 정한 크기는
 * 오히려 PC 보다 작다 — root 14px 기준으로 본문이 12.2px 다. 그런데도
 * 휴대폰에서 커 보이는 이유는 브라우저가 **제멋대로 키우기** 때문이다.
 *
 * 안드로이드 크롬의 font boosting 과 iOS 사파리의 text autosizing 은,
 * 가로가 화면보다 넓은 덩어리가 있으면 그 안의 글자를 저 혼자 1.5~2배
 * 까지 키운다. 이 앱에는 가로 스크롤 칸이 스무 개 파일에 있다
 * (탭 줄·칩 줄·차트 칸) — 정확히 그 방아쇠다.
 *
 * 그래서 화면마다, 심지어 같은 화면에서도 덩어리마다 글자 크기가
 * 제각각이 된다. 설정의 '글씨 크기' 를 맞춰도 소용이 없다 — 그 위에서
 * 브라우저가 또 곱하기 때문이다.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const 뿌리 = path.resolve(__dirname, "../../..");
const css = () => fs.readFileSync(path.join(뿌리, "src/index.css"), "utf-8");
const 설정 = () => fs.readFileSync(path.join(뿌리, "tailwind.config.js"), "utf-8");

describe("브라우저가 글자를 제멋대로 안 키우게", () => {
  it("html 에 text-size-adjust 를 못 박는다", () => {
    const s = css();
    expect(s).toMatch(/-webkit-text-size-adjust:\s*100%/);
    /* 표준 이름도 같이 둔다 — 사파리만 -webkit- 을 본다 */
    expect(s).toMatch(/(?<!-webkit-)text-size-adjust:\s*100%/);
  });

  it("html 안에 있어야 한다 — body 에 두면 안 먹는다", () => {
    const s = css();
    const 시작 = s.indexOf("  html {");
    expect(시작).toBeGreaterThan(-1);
    const 끝 = s.indexOf("\n  }", 시작);
    expect(s.slice(시작, 끝)).toContain("text-size-adjust");
  });

  it("none 이 아니라 100% 다", () => {
    /* none 은 사용자가 브라우저에서 직접 확대하는 것까지 막는 브라우저가
       있다. 막으려는 것은 자동 확대뿐이다 */
    expect(css()).not.toMatch(/text-size-adjust:\s*none/);
  });
});

describe("크기표 주석이 실제와 맞는가", () => {
  /* 예전 주석은 '16px 기준 환산' 이라 적혀 있었는데 실제 root 는 14px
     이었다. 그래서 주석이 말하는 크기와 화면에 그려지는 크기가 12.5%
     어긋났다 — '10→11px 로 올렸다' 고 적어 두고 실제로는 9.6px 를
     만든 셈이다. 다음 사람이 그 표를 믿고 또 잘못 판단하지 않게, 표가
     스스로 맞는지 여기서 본다. */

  const 루트px = () => {
    const m = css().match(/html\s*\{[^}]*font-size:\s*(\d+)px/);
    expect(m).not.toBeNull();
    return Number(m![1]);
  };

  it("index.css 의 root 는 14px 다", () => {
    expect(루트px()).toBe(14);
  });

  it("주석의 첫 숫자가 root 기준 실제 크기와 같다", () => {
    const 루트 = 루트px();
    const 줄들 = 설정().split("\n").filter((l) => /\["[\d.]+rem", "[\d.]+rem"\],\s*\/\//.test(l));
    /* 아홉 단계 + 숫자 전용 둘 = 열한 줄. 숫자 전용 주석도 같은
       16px 오류를 갖고 있었다 — 표는 통째로 맞아야 뜻이 있다 */
    expect(줄들.length).toBe(11);
    for (const 줄 of 줄들) {
      const rem = Number(줄.match(/\["([\d.]+)rem"/)![1]);
      const 적힌것 = Number(줄.match(/\/\/\s+([\d.]+) \//)![1]);
      expect(Math.abs(rem * 루트 - 적힌것)).toBeLessThan(0.1);
    }
  });

  it("어느 root 기준인지 밝힌다", () => {
    /* 기준을 안 적으면 다음 사람이 또 16px 로 읽는다. 그게 이번에
       12.5% 어긋난 이유였다 */
    expect(설정()).toMatch(/root 14px 기준/);
  });

  it("본문이 휴대폰에서 읽을 만한 크기다", () => {
    /* 너무 작으면 브라우저가 키우려 드는 쪽으로 되돌아간다 */
    const s = 설정();
    const base = Number(s.match(/base:\s*\["([\d.]+)rem"/)![1]);
    expect(base * 루트px()).toBeGreaterThanOrEqual(12);
  });
});


describe("글씨 크기 설정이 이름대로 움직이는가", () => {
  const layout = () => fs.readFileSync(path.join(뿌리, "src/components/Layout.tsx"), "utf-8");
  const 설정창 = () => fs.readFileSync(path.join(뿌리, "src/components/SettingsModal.tsx"), "utf-8");
  const 스토어 = () => fs.readFileSync(path.join(뿌리, "src/store/settingsStore.ts"), "utf-8");

  /** 글씨 크기 칸의 (값, 라벨) 짝.
   *
   *  설정 화면에는 테마·색·화면모양 목록이 같은 모양으로 여럿 있다.
   *  파일 전체에서 찾으면 그것들까지 딸려 온다 — 글씨 크기 블록
   *  안에서만 본다. */
  const 칸들 = () => {
    const 전체 = 설정창();
    const 시작 = 전체.indexOf("{/* 글씨 크기 */}");
    expect(시작).toBeGreaterThan(-1);
    const 끝 = 전체.indexOf("{/*", 전체.indexOf("</div>", 시작));
    const 토막 = 전체.slice(시작, 끝 > 시작 ? 끝 : 시작 + 2000);
    return [...토막.matchAll(/\{ value: "(\w+)",\s*label: "([^"]+)"/g)]
      .map((m) => ({ 값: m[1], 이름: m[2] }));
  };

  /** index.css 가 그 값에 주는 root 크기 */
  const 크기 = (값: string): number => {
    if (값 === "normal") {
      return Number(css().match(/html\s*\{[^}]*font-size:\s*(\d+)px/)![1]);
    }
    const 반 = { small: "font-small", large: "font-large", xl: "font-xl" }[값];
    return Number(css().match(new RegExp(`html\\.${반}\\s*\\{\\s*font-size:\\s*(\\d+)px`))![1]);
  };

  it("네 칸이 있다 — '작게' 자리가 원래 비어 있었다", () => {
    /* 제일 작은 것이 곧 기본값이라 줄일 방법이 아예 없었다 */
    expect(칸들().map((x) => x.값)).toEqual(["small", "normal", "large", "xl"]);
  });

  it("이름 순서와 실제 크기 순서가 같다", () => {
    /* 여기가 어긋나 있었다. '작게' 로 적힌 것이 기본값(14px)이고,
       '기본' 을 고르면 16px 로 14% 커졌다 — 이름을 믿고 고른 사람은
       자기도 모르게 키운 셈이다 */
    const 크기들 = 칸들().map((x) => 크기(x.값));
    expect(크기들).toEqual([...크기들].sort((a, b) => a - b));
    expect(크기들[0]).toBeLessThan(크기들[크기들.length - 1]);
  });

  it("'보통' 이 기본값과 같은 크기다", () => {
    /* 처음 켠 사람이 보는 크기가 곧 '보통' 이어야 한다 */
    const 기본 = 스토어().match(/fontSize:\s*"(\w+)"/)![1];
    const 보통 = 칸들().find((x) => x.이름 === "보통")!;
    expect(보통.값).toBe(기본);
  });

  it("'작게' 는 정말로 기본보다 작다", () => {
    expect(크기("small")).toBeLessThan(크기("normal"));
  });

  it("고른 것을 화면에 실제로 건다", () => {
    /* 값만 담고 안 걸면 설정이 아무 일도 안 한다 */
    const s = layout();
    for (const { 값 } of 칸들()) {
      if (값 === "normal") continue;         // 기본은 클래스가 없다
      expect(s).toContain(`fontSize === "${값}"`);
    }
    // 바꿀 때 앞의 것을 지워야 두 개가 겹치지 않는다
    expect(s).toContain('html.classList.remove("font-small", "font-large", "font-xl")');
  });

  it("담긴 값이 이상하면 기본으로 되돌린다", () => {
    expect(스토어()).toContain('["small", "normal", "large", "xl"]');
  });
});


describe("토큰 밖 글자 크기가 새어 들어오지 않게", () => {
  /* tailwind 설정은 extend 라서, 우리가 정한 아홉 단계 **위에** Tailwind
     기본값이 그대로 남아 있다. text-4xl 을 쓰면 조용히 2.25rem(31.5px)
     이 걸리는데, 이 앱에서 제일 큰 토큰(hero 26.2px)보다도 크다.
     오류도 경고도 없이 화면 하나만 유난히 커진다 — 실제로 퀀트 점수
     게이지와 지수 상세가 그렇게 커져 있었다.

     색 팔레트에서 amber 가 빠져 있던 것과 같은 종류의 사고다. 그때는
     없는 이름이라 조용히 지워졌고, 여기는 있는 이름이라 조용히 커진다. */
  const 소스들 = () => {
    const 모으기 = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true })
      .flatMap((e) => {
        const 길 = path.join(dir, e.name);
        if (e.isDirectory()) return 모으기(길);
        return /\.tsx?$/.test(e.name) ? [길] : [];
      });
    return 모으기(path.join(뿌리, "src"));
  };

  it("text-4xl 이상을 안 쓴다", () => {
    const 걸린것: string[] = [];
    for (const f of 소스들()) {
      /* 검사 파일은 뺀다 — 여기서 그 이름을 적어 두고 설명하는 것이
         일이라, 자기 자신에 걸린다 */
      if (f.includes("__tests__")) continue;
      /* 주석 안의 이름도 뺀다. '예전에 text-4xl 이었다' 는 기록은
         남겨 둬야 다음 사람이 왜 바꿨는지 안다 */
      const 본문 = fs.readFileSync(f, "utf-8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      for (const m of 본문.matchAll(/text-(\d)xl\b/g)) {
        if (Number(m[1]) >= 4) 걸린것.push(`${path.relative(뿌리, f)}: ${m[0]}`);
      }
    }
    expect(걸린것, `토큰 밖 크기: ${걸린것.join(", ")}`).toEqual([]);
  });

  it("제일 큰 토큰이 hero 다", () => {
    /* 화면에 hero 보다 큰 글자가 있을 이유가 없다. 그보다 커야 한다면
       토큰을 하나 더 만들고 이름을 붙일 일이다 */
    const rem = [...설정().matchAll(/\["([\d.]+)rem", "[\d.]+rem"\],\s*\/\//g)]
      .map((m) => Number(m[1]));
    const hero = Number(설정().match(/hero:\s*\["([\d.]+)rem"/)![1]);
    expect(Math.max(...rem)).toBe(hero);
  });
});
