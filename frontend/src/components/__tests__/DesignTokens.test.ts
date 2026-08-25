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


describe("키보드 초점", () => {
  /* 버튼이 407곳인데 초점 표시가 있는 곳이 셋뿐이었다(0%). 전역 규칙도
     없었다. 마우스로는 아무 문제가 없지만, 탭 키로 넘기면 지금 어디에
     가 있는지 알 수 없다 — 키보드만 쓰는 사람에게는 화면이 깜깜하다.

     407곳을 하나씩 고치는 대신 전역 규칙 하나로 덮었다.
     새로 만드는 버튼도 저절로 포함된다. */
  const css = fs.readFileSync(path.join(뿌리, "index.css"), "utf-8");

  it("전역 초점 규칙이 있다", () => {
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:/);
  });

  it("테두리가 실제로 보인다", () => {
    /* outline: none 으로 바꿔도 '규칙이 있다' 는 통과한다 —
       그러면 아무것도 안 보이는데 검사만 초록이다 */
    const m = css.match(/:focus-visible\s*\{([^}]*)\}/);
    expect(m).toBeTruthy();
    expect(m![1]).toMatch(/outline:\s*\d+px\s+solid/);
    expect(m![1]).not.toMatch(/outline:\s*none/);
  });

  it("focus 가 아니라 focus-visible 을 쓴다", () => {
    /* :focus 로 하면 마우스로 눌렀을 때까지 테두리가 남아 지저분해지고,
       결국 outline:none 으로 지우게 된다. 브라우저가 '키보드로 온 것'
       만 골라 주는 쪽을 써야 오래간다. */
    const 규칙 = css.slice(css.indexOf(":focus-visible") - 300, css.indexOf(":focus-visible") + 200);
    expect(규칙).not.toMatch(/[^-]:focus\s*\{/);
  });

  it("버튼과 링크와 입력칸을 모두 덮는다", () => {
    /* 주석에도 focus-visible 이라는 낱말이 나오므로, 셀렉터가 실제로
       시작하는 :where( 자리를 찾아 그 안만 본다 */
    const m = css.match(/:where\(([^)]*)\):focus-visible/);
    expect(m, "전역 초점 셀렉터를 못 찾음").toBeTruthy();
    /* toContain 으로 보면 [role="button"] 안의 button 에 걸려서,
       진짜 button 태그를 빼도 통과한다(뮤테이션에서 그랬다).
       쉼표로 갈라 낱말 그대로 있는지 본다. */
    const 것들 = m![1].split(",").map((x) => x.trim());
    for (const t of ["button", "a", "input", "textarea", "select"]) {
      expect(것들, `${t} 가 빠졌다`).toContain(t);
    }
  });

  it("우선순위를 0으로 둬서 화면별 스타일을 덮지 않는다", () => {
    /* :where 로 감싸면 우선순위가 0이라, 따로 준 초점 스타일이 있으면
       그쪽이 이긴다. 없을 때만 이 규칙이 나선다. */
    expect(css).toMatch(/:where\([^)]*button[^)]*\):focus-visible/);
  });

  it("두 테마 모두에 초점 색이 있다", () => {
    /* 어두운 바탕과 밝은 바탕에서 잘 보이는 파랑이 다르다 */
    expect((css.match(/--accent-focus:/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe("공용 Button", () => {
  /* <button> 이 407곳인데 공용 Button 을 쓰는 곳은 16곳뿐이었다(4%).
     다만 407곳이 다 같은 것이 아니다 —
       166곳  글자+패딩+둥글기 (이 부품이 맡을 자리)
       126곳  아이콘만 (정사각 패딩이라 모양이 다르다)
       106곳  맨 글자 링크형
         9곳  알약/탭 (공용 Tabs 가 따로 있다)

     한꺼번에 옮기면 '통일' 이 아니라 '대량 변경' 이 된다. 지금 화면을
     눈으로 볼 수 없어서, 모양이 정확히 같은 것만 옮겼다(link 형 7곳).
     나머지는 화면을 보면서 하나씩 확인해야 한다. */
  const ui = fs.readFileSync(path.join(뿌리, "components/ui/index.tsx"), "utf-8");

  it("실제 쓰임에 맞는 모양을 갖췄다", () => {
    for (const v of ["primary", "secondary", "ghost", "danger", "link"]) {
      expect(ui, `${v} 없음`).toContain(`${v}:`);
    }
    /* 'icon:' 만 보면 값을 지워도 통과한다 — 정사각 패딩이 있는지 본다 */
    expect(ui).toMatch(/icon:\s*"p-[\d.]+"/);
  });

  it("link 는 굵게 하지 않는다", () => {
    /* 굵히면 본문 글 사이에 섞인 자리마다 글자가 두꺼워져 티가 난다.
       옮겨 온 자리의 모양이 달라지면 옮긴 뜻이 없다. */
    expect(ui).toMatch(/variant === "link" \? "" : "font-semibold/);
  });

  it("눌리지 않는 상태를 알려 준다", () => {
    expect(ui).toContain("disabled:cursor-not-allowed");
  });

  it("쓰는 곳이 늘었다", () => {
    /* 16곳에서 시작했다. 줄어들면 누가 되돌린 것이다 */
    const 수 = 소스파일들()
      .map((f) => (fs.readFileSync(path.join(뿌리, f), "utf-8").match(/<Button[\s>]/g) ?? []).length)
      .reduce((a, b) => a + b, 0);
    expect(수, `공용 Button 사용 ${수}곳`).toBeGreaterThanOrEqual(20);
  });
});

/* ── 글자 크기 ──────────────────────────────────────────────
 *
 * 세어 보니 화면에 있는 글자 1,215곳 중 1,108곳(91.2%)이 12px 이하였다.
 * 16px 넘는 것은 40곳(3.3%), 28px 은 딱 한 곳.
 *
 * 크기가 다 같으면 '무엇이 중요한지' 를 눈이 못 알아챈다. 그래서 대신
 * 테두리와 상자로 구분하려 들고, 화면이 시끄러워진다. 자산 앱이
 * 조용해 보이는 이유는 반대다 — 총자산 34px, 라벨 12px 로 대비를
 * 크게 벌려 놓는다.
 *
 * 되돌리기 쉬운 변경이라(파일 하나) 지켜 두지 않으면 조용히 되돌아간다.
 */
describe("글자 크기", () => {
  const 설정 = fs.readFileSync(path.resolve(__dirname, "../../../tailwind.config.js"), "utf-8");
  const 크기 = (이름: string): number => {
    /* 줄 시작에 고정한다. 안 그러면 "xs" 가 "2xs" 안에서도 걸려서
       둘이 같은 값으로 읽힌다 — 처음에 그렇게 헛짚었다. */
    const m = 설정.match(new RegExp(`^\\s*["']?${이름}["']?:\\s*\\[\\s*"([\\d.]+)rem`, "m"));
    if (!m) throw new Error(`${이름} 크기를 못 찾았다`);
    return parseFloat(m[1]) * 16;
  };

  it("숫자 전용 크기가 있다", () => {
    /* 자산 앱의 정체성은 '숫자가 크다' 는 것인데 그 크기가 아예 없었다.
       다만 크게 잡을수록 위험하다 — 한 번 24~36px 로 잡았다가 화면이
       그냥 커져 버려 되돌렸다. 하한만 두고 상한은 아래에서 막는다. */
    expect(크기("display")).toBeGreaterThanOrEqual(22);
    expect(크기("hero")).toBeGreaterThanOrEqual(28);
  });

  it("숫자 전용 크기가 32px 을 넘지 않는다", () => {
    /* 정보를 촘촘히 보는 화면이다. 여백이 넉넉한 앱의 큰 숫자를 그대로
       가져오면 한 화면에 들어가는 줄이 확 줄어든다 — 그래서 되돌렸다. */
    expect(크기("hero")).toBeLessThanOrEqual(32);
  });

  it("가장 작은 글자가 11px 밑으로 안 내려간다", () => {
    /* 10px 는 휴대폰에서 읽기 힘들다. 라벨이라도 최소선이 있다.
       여기가 전체의 91% 라 1px 만 올려도 화면 전체가 편해진다. */
    expect(크기("2xs")).toBeGreaterThanOrEqual(11);
  });

  it("본문이 14px 이상이다", () => {
    /* 종목명·기사 제목이 여기 들어간다. 13px 로는 목록이 빽빽해 보인다.
       15px 까지 올려 봤는데 그건 너무 컸다 — 14px 이 이 화면에 맞는다. */
    expect(크기("base")).toBeGreaterThanOrEqual(14);
  });

  it("제목 크기는 손대지 않는다", () => {
    /* 16px 이상을 키웠더니 제목이 커져서 어색했다. 작은 쪽만 올리고
       여기는 그대로 둔다 — 되돌린 이유를 못 박아 둔다. */
    expect(크기("lg")).toBe(16);
    expect(크기("xl")).toBe(18);
    expect(크기("2xl")).toBe(22);
    expect(크기("3xl")).toBe(28);
  });

  it("가장 큰 것과 가장 작은 것의 차이가 두 배 반 이상이다", () => {
    /* 대비가 위계를 만든다. 다만 대비를 키우겠다고 제목을 키우면
       화면이 커지기만 한다 — 숫자 전용 크기로 대비를 만든다. */
    expect(크기("hero") / 크기("2xs")).toBeGreaterThanOrEqual(2.5);
  });

  it("단계가 작은 것부터 큰 것 순으로 이어진다", () => {
    /* 중간이 뒤집히면 text-sm 이 text-base 보다 커지는 일이 생긴다 */
    const 차례 = ["2xs", "xs", "sm", "base", "md", "lg", "xl", "2xl", "3xl"];
    const 값 = 차례.map(크기);
    for (let i = 1; i < 값.length; i++) {
      expect(값[i]).toBeGreaterThan(값[i - 1]);
    }
  });
});
