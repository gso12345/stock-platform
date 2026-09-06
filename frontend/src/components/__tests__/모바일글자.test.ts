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
