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


describe("그림자는 세 층으로", () => {
  /* 토큰은 진작 있었는데 아무도 안 썼다(card·modal·glow 사용 0곳).
     대신 shadow-lg/2xl/xl/sm 이 흩어져서, 같은 종류의 것이 화면마다
     다르게 떠 보였다. 실제 쓰임을 보니 세 층으로 갈렸다 —
     카드 / 살짝 떠 있는 것(드롭다운·토스트) / 화면을 덮는 것(모달). */
  const 기본그림자 = /\bshadow-(sm|md|lg|xl|2xl|inner)\b/g;

  it("Tailwind 기본 그림자를 직접 쓰지 않는다", () => {
    const 걸린것 = 소스파일들()
      .map((f) => ({ f, 찾음: (fs.readFileSync(path.join(뿌리, f), "utf-8").match(기본그림자) ?? []) }))
      .filter((x) => x.찾음.length > 0)
      .map((x) => `${x.f}: ${[...new Set(x.찾음)].join(", ")}`);
    expect(걸린것).toEqual([]);
  });

  it("토큰이 실제로 쓰인다", () => {
    /* 위 검사만 있으면 그림자를 통째로 지워도 통과한다 */
    const 전체 = 소스파일들().map((f) => fs.readFileSync(path.join(뿌리, f), "utf-8")).join("\n");
    for (const t of ["shadow-card", "shadow-float", "shadow-modal"]) {
      expect(전체, `${t} 를 쓰는 곳이 없다`).toContain(t);
    }
  });

  it("세 층이 서로 다른 값이다", () => {
    const cfg = fs.readFileSync(path.resolve(뿌리, "../tailwind.config.js"), "utf-8");
    const 값 = ["card", "float", "modal"].map((k) => {
      const m = cfg.match(new RegExp(`${k}:\\s*"([^"]+)"`));
      return m?.[1];
    });
    expect(값.every(Boolean)).toBe(true);
    expect(new Set(값).size).toBe(3);
  });
});

describe("아이콘 크기", () => {
  /* 열 가지가 흩어져 있었다(10·11·12·13·14·15·16·18·20·32).
     13·14·15 는 눈으로 구분이 안 되는데 같은 자리에서도 파일마다 달랐다.
     2px 이내로만 합쳤다 — 화면을 눈으로 못 보는 상태에서 크게 바꾸면
     좁은 줄에서 넘칠 수 있다. */
  const 허용 = new Set([9, 11, 13, 14, 16, 17, 20, 22, 24, 28, 32, 36, 40]);

  it("정해진 크기만 쓴다", () => {
    const 걸린것: string[] = [];
    for (const f of 소스파일들()) {
      const s = fs.readFileSync(path.join(뿌리, f), "utf-8");
      for (const m of s.matchAll(/size=\{(\d+)\}/g)) {
        const n = Number(m[1]);
        if (!허용.has(n)) 걸린것.push(`${f}: size={${n}}`);
      }
    }
    expect([...new Set(걸린것)]).toEqual([]);
  });

  it("작은 쪽이 촘촘하게 갈리지 않는다", () => {
    /* 12·15 처럼 옆 크기와 1px 차이인 값이 되살아나면 다시 흩어진다 */
    const 전체 = 소스파일들().map((f) => fs.readFileSync(path.join(뿌리, f), "utf-8")).join("\n");
    for (const n of [10, 12, 15, 18]) {
      expect(전체, `size={${n}} 이 되살아났다`).not.toContain(`size={${n}}`);
    }
  });
});


describe("아이콘만 있는 버튼", () => {
  /* 화면 읽어주는 기능은 버튼 안의 글자를 읽는다. 아이콘만 있으면 읽을
     것이 없어서 그냥 "버튼" 이라고만 말한다.

     52곳을 찾아 42곳에 이름을 붙였다. 남은 10곳은 같은 아이콘이 자리마다
     다른 뜻이라(X 가 닫기일 수도 지우기일 수도 있다) 화면을 보면서
     붙여야 한다. 틀린 이름은 없는 이름보다 나쁘다.

     고치다 한 번 사고를 냈다. '버튼 안에 글자가 있는가' 를 보는 코드가
     여는 태그의 끝을 find(">") 로 찾았는데, onClick={() => ...} 의
     화살표에 든 > 를 먼저 만났다. 그래서 속을 잘못 잘라 냈고, 확인창의
     '취소' 버튼에 aria-label="닫기" 를 덮어썼다 — 눈에 보이는 글자와
     읽히는 이름이 달라지는 것은 원래 문제보다 나쁘다. 기존 검사가
     그걸 잡아 줬다. */

  /** 버튼 안에 사람이 읽을 글자가 있는지 */
  function 글자있나(속: string): boolean {
    const s = 속.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/<[^>]*>/g, "");
    if (/[가-힣A-Za-z0-9]/.test(s)) return true;
    if (/\{[^}]*["'][^"']*[가-힣A-Za-z][^"']*["'][^}]*\}/.test(속)) return true;
    if (/\{[가-힣A-Za-z_][\w가-힣.?[\]']*\}/.test(속)) return true;
    return false;
  }

  /** <button ...> 의 닫는 꺾쇠. 중괄호 밖의 > 만 본다 */
  function 여는태그끝(s: string, 시작: number): number {
    let 깊이 = 0;
    for (let i = 시작; i < s.length; i++) {
      const c = s[i];
      if (c === "{") 깊이++;
      else if (c === "}") 깊이--;
      else if (c === ">" && 깊이 === 0) return i;
    }
    return -1;
  }

  function 이름없는수(s: string): number {
    let n = 0, i = 0;
    for (;;) {
      const st = s.indexOf("<button", i);
      if (st < 0) break;
      const gt = 여는태그끝(s, st);
      if (gt < 0) break;
      const en = s.indexOf("</button>", gt);
      if (en < 0) break;
      const b = s.slice(st, en + 9);
      i = en + 9;
      if (b.includes("aria-label") || /\btitle=/.test(b)) continue;
      if (글자있나(b.slice(gt - st + 1, -9))) continue;
      n++;
    }
    return n;
  }

  it("이름 없는 아이콘 버튼이 더 늘지 않는다", () => {
    const 총 = 소스파일들().reduce(
      (a, f) => a + 이름없는수(fs.readFileSync(path.join(뿌리, f), "utf-8")), 0);
    expect(총, `이름 없는 아이콘 버튼이 ${총}곳`).toBeLessThanOrEqual(10);
  });

  it("글자가 있는 버튼에는 이름을 덮어쓰지 않는다", () => {
    /* 눈에 보이는 글자와 읽히는 이름이 다르면 더 헷갈린다.
       확인창의 '취소' 가 "닫기" 로 읽히던 것이 그 사고였다. */
    const s = fs.readFileSync(path.join(뿌리, "components/ui/ConfirmDialog.tsx"), "utf-8");
    const 취소자리 = s.slice(s.indexOf("onClick={onClose}") - 200, s.indexOf("취소"));
    expect(취소자리).not.toContain("aria-label");
  });

  it("이름을 붙인 것이 실제로 많다", () => {
    const 전체 = 소스파일들().map((f) => fs.readFileSync(path.join(뿌리, f), "utf-8")).join("\n");
    expect((전체.match(/aria-label=/g) ?? []).length).toBeGreaterThanOrEqual(120);
  });
});
