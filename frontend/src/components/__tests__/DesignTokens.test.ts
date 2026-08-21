/**
 * 색과 글자 크기가 디자인 시스템 안에 있는가.
 *
 * 두 가지가 흩어져 있었다.
 *
 *   1) Tailwind 기본 팔레트를 직접 쓴 곳 252회.
 *      amber 와 orange, emerald 와 green 이 기준 없이 섞여 있었다.
 *      공용 부품(components/ui/index.tsx)에도 25곳이 있어서, 그걸 쓰는
 *      모든 화면이 함께 어긋났다.
 *
 *   2) px 로 못 박은 글자 87곳.
 *      설정의 '글씨 크기' 는 루트 font-size 를 바꾸는 방식이라 rem 에만
 *      먹는다. 즉 이 87곳은 설정을 바꿔도 그대로였다 — 눈이 불편해서
 *      키운 사람에게는 고장이다.
 *
 * 이 검사는 '다시 흩어지지 않게' 막는다. 새 화면을 만들 때 무심코
 * text-blue-400 을 쓰면 여기서 걸린다.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const 뿌리 = path.resolve(__dirname, "../..");

/** 일부러 남겨 둔 곳 — 각각 파일 안에 이유가 적혀 있다 */
const 예외 = {
  "components/community/Avatar.tsx":
    "사용자를 구분하는 여덟 색. 토큰(일곱 개)으로 접으면 다른 사람이 같은 색이 된다",
  "components/SocialLoginButtons.tsx":
    "구글 버튼의 흰 바탕·검은 글씨는 브랜드 규정이다",
};

function 소스파일들(): string[] {
  const 결과: string[] = [];
  const 훑기 = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== "__tests__" && e.name !== "node_modules") 훑기(p);
      } else if (/\.tsx?$/.test(e.name)) {
        결과.push(path.relative(뿌리, p));
      }
    }
  };
  훑기(뿌리);
  return 결과;
}

const 팔레트 = new RegExp(
  "\\b(text|bg|border|ring|from|to|via|shadow|divide|placeholder|fill|stroke)-" +
  "(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|" +
  "teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\\d{2,3}\\b",
  "g",
);
const px글자 = /text-\[\d+px\]/g;

describe("색은 토큰으로", () => {
  const 걸린것 = 소스파일들()
    .filter((f) => !(f in 예외))
    .map((f) => ({ f, 찾음: (fs.readFileSync(path.join(뿌리, f), "utf-8").match(팔레트) ?? []) }))
    .filter((x) => x.찾음.length > 0);

  it("Tailwind 기본 팔레트를 직접 쓰지 않는다", () => {
    const 보고 = 걸린것.map((x) => `${x.f}: ${[...new Set(x.찾음)].join(", ")}`);
    expect(보고).toEqual([]);
  });

  it("공용 부품이 특히 깨끗해야 한다", () => {
    /* 여기가 어긋나면 이걸 쓰는 모든 화면이 함께 어긋난다.
       실제로 25곳이 있었다. */
    const s = fs.readFileSync(path.join(뿌리, "components/ui/index.tsx"), "utf-8");
    expect(s.match(팔레트) ?? []).toEqual([]);
  });

  it("예외는 이유가 적혀 있다", () => {
    /* 예외를 늘리는 것 자체는 막지 않는다. 다만 왜 예외인지
       파일 안에 남아 있어야 다음 사람이 지우지 않는다 */
    for (const f of Object.keys(예외)) {
      const s = fs.readFileSync(path.join(뿌리, f), "utf-8");
      expect(s).toMatch(/분류용|브랜드|규정/);
    }
  });
});

describe("글자 크기는 rem 으로", () => {
  it("px 로 못 박은 글자가 없다", () => {
    /* 설정의 글씨 크기는 루트 font-size 를 바꾼다 — px 에는 안 먹는다.
       눈이 불편해서 키운 사람에게는 그게 고장이다. */
    const 걸린것 = 소스파일들()
      .map((f) => ({ f, 찾음: (fs.readFileSync(path.join(뿌리, f), "utf-8").match(px글자) ?? []) }))
      .filter((x) => x.찾음.length > 0)
      .map((x) => `${x.f}: ${[...new Set(x.찾음)].join(", ")}`);
    expect(걸린것).toEqual([]);
  });

  it("가장 작은 글자가 10px 밑으로 내려가지 않는다", () => {
    /* 8px·9px 짜리가 있었다. 배지 숫자였지만 읽으라고 띄운 글자다 */
    const cfg = fs.readFileSync(path.resolve(뿌리, "../tailwind.config.js"), "utf-8");
    const m = cfg.match(/"2xs":\s*\["([\d.]+)rem"/);
    expect(m).toBeTruthy();
    expect(parseFloat(m![1]) * 16).toBeGreaterThanOrEqual(10);
  });
});
