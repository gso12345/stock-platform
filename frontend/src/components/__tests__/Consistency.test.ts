/**
 * 같은 뜻인데 화면마다 다르게 말하던 것들.
 *
 *   · 기다리는 중을 "로딩 중..." 과 "불러오는 중" 두 가지로 적고 있었다.
 *     같은 상황인데 화면을 옮길 때마다 말이 바뀌면 사용자는 다른 일이
 *     일어난다고 느낀다.
 *
 *   · 선물은 백엔드가 응답에 담아 보내는데 화면에서 안 썼다. 대시보드를
 *     열 때마다 KIS 선물 API 를 부르고 결과를 버린 셈이다.
 *
 *   · 빈 화면 부품(빈화면)을 만들어 놓고 여섯 곳만 썼다. 나머지는
 *     "~없습니다" 한 줄로 끝나는 막다른 길이었다.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const 뿌리 = path.resolve(__dirname, "../..");
const 읽기 = (rel: string) => fs.readFileSync(path.join(뿌리, rel), "utf-8");

/** 주석은 뺀다 — 무엇을 왜 바꿨는지 적어 둔 자리다 */
function 코드만(s: string): string {
  return s
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function 화면파일들(): string[] {
  const 결과: string[] = [];
  const 훑기 = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== "__tests__") 훑기(p);
      } else if (e.name.endsWith(".tsx")) {
        결과.push(path.relative(뿌리, p));
      }
    }
  };
  훑기(뿌리);
  return 결과;
}

describe("기다리는 중이라는 말", () => {
  it("한 가지로만 적는다", () => {
    /* "로딩 중..." 6곳 / "불러오는 중" 5곳 / "불러오는 중..." 1곳
       세 가지가 섞여 있었다 */
    const 걸린것 = 화면파일들()
      .map((f) => ({ f, 찾음: 코드만(읽기(f)).match(/로딩 중\.\.\.|불러오는 중\.\.\./g) ?? [] }))
      .filter((x) => x.찾음.length > 0)
      .map((x) => `${x.f}: ${[...new Set(x.찾음)].join(", ")}`);
    expect(걸린것).toEqual([]);
  });

  it("쓰는 말이 실제로 여러 곳에 있다", () => {
    /* 위 검사만 있으면 문구를 통째로 지워도 통과한다.
       한 곳만 보면 다른 데서 지워도 안 걸리므로 파일 수로 센다. */
    const 쓰는파일 = 화면파일들().filter((f) => 코드만(읽기(f)).includes("불러오는 중"));
    expect(쓰는파일.length).toBeGreaterThanOrEqual(8);
  });
});

describe("이미 받는 데이터를 쓰는가", () => {
  it("선물을 화면에 그린다", () => {
    /* 백엔드 /dashboard/kr 이 futures 를 담아 보내는데 화면에
       한 줄도 없었다. 받아 놓고 버리는 것이 가장 아까운 낭비다 */
    expect(코드만(읽기("pages/Dashboard.tsx"))).toMatch(/data\?\.futures/);
  });

  it("선물 값 이름을 맞춰 넘긴다", () => {
    /* 백엔드는 price 로, 카드는 value 로 부른다.
       그대로 펼치면 값이 안 보인다 */
    const s = 코드만(읽기("pages/Dashboard.tsx"));
    const 자리 = s.slice(s.indexOf("data?.futures"), s.indexOf("data?.futures") + 500);
    expect(자리).toMatch(/value=\{f\.price/);
  });
});

describe("빈 화면이 막다른 길이 아닌가", () => {
  const 고친것 = ["pages/News.tsx", "pages/Backtest.tsx"];

  it.each(고친것)("%s 가 공용 빈화면을 실제로 그린다", (f) => {
    /* import 만 보면 안 된다 — 렌더를 한 줄짜리로 되돌려도
       import 는 남아 있어 통과해 버렸다(뮤테이션에서 실제로 그랬다) */
    expect(읽기(f)).toMatch(/<빈화면[\s>]/);
  });

  it("빈화면이 아이콘과 설명을 함께 준다", () => {
    /* "없습니다" 한 줄이면 처음 온 사람은 거기서 뒤로 간다.
       무엇을 하면 채워지는지가 있어야 안내다 */
    const s = 읽기("pages/Backtest.tsx");
    const 자리 = s.slice(s.indexOf("<빈화면"), s.indexOf("<빈화면") + 400);
    expect(자리).toMatch(/icon=/);
    expect(자리).toMatch(/hint=/);
  });

  it("쓰는 곳이 늘었다", () => {
    /* 여섯 곳이었다. 줄어들면 누가 되돌린 것이다 */
    const 수 = 화면파일들().filter((f) => 읽기(f).includes("빈화면")).length;
    expect(수).toBeGreaterThanOrEqual(8);
  });
});

describe("페이지 머리 줄이 폰에서 안 무너지는가", () => {
  /* 제목과 탭이 한 줄에 나란히 있는데 flex-wrap 이 없으면, 폰 폭(390px)
     에서 탭 줄은 안 줄고 제목 칸만 줄어든다. 그러다 칸이 한 글자보다
     좁아지면 제목이 **세로로 쪼개진다** — '백/테/스/트'.

     이 고장은 검사로는 절대 안 잡힌다. jsdom 에는 배치가 없어서 폭이
     늘 0 이고, 클래스만 보면 멀쩡하다. 실제로 폰 크기로 화면을 찍어
     보고서야 나왔다. 그래서 여기서는 **규칙 자체**를 못 박는다.

     대시보드가 같은 이유로 이미 flex-wrap gap-3 을 쓰고 있었다.
     한 곳만 맞춰 두면 다음 화면에서 또 난다. */
  /** 제목(h1)을 안고 있는 머리 줄만 고른다.
   *
   *  파일의 첫 `justify-between` 을 집으면 안 된다 — 대시보드는 그
   *  자리가 카드 안의 작은 줄이라, 정작 제목 줄은 멀쩡한데 검사가
   *  틀렸다고 말했다(그렇게 짰다가 걸렸다). */
  function 제목줄들(s: string): string[] {
    const 나온것: string[] = [];
    for (const m of s.matchAll(/className="flex items-center justify-between([^"]*)"/g)) {
      if (/<h1[\s>]/.test(s.slice(m.index!, m.index! + 260))) 나온것.push(m[1]);
    }
    return 나온것;
  }

  it.each(["pages/Backtest.tsx", "pages/Dashboard.tsx"])(
    "%s 의 머리 줄이 접힌다", (f) => {
      const 줄들 = 제목줄들(읽기(f));
      expect(줄들.length, `${f} 에 제목 머리 줄을 못 찾았다`).toBeGreaterThan(0);
      for (const 클래스 of 줄들)
        expect(클래스, `${f} 제목이 폰에서 세로로 쪼개진다 — flex-wrap 을 넣어라`)
          .toMatch(/flex-wrap/);
    });

  it("제목 옆에 무언가를 두는 화면이 다 같은 규칙을 쓴다", () => {
    /* 위 둘만 찍어 두면 새 화면이 늘 때 또 놓친다. 실제로 이 훑기가
       퀀트·스크리닝·전략저장소 세 곳을 더 찾아냈다 — 백테스트만
       고쳤으면 나머지는 그대로 남았을 것이다. */
    const 어긴것 = 화면파일들().filter(
      (f) => 제목줄들(읽기(f)).some((c) => !/flex-wrap/.test(c)));
    expect(어긴것, `이 화면들의 제목이 폰에서 세로로 쪼개진다: ${어긴것.join(", ")}`)
      .toEqual([]);
  });
});

describe("백테스트 화면의 통일", () => {
  /* 같은 뜻인데 자리마다 다르게 하던 것들. 하나하나는 사소해 보이지만,
     한 화면 안에서 규칙이 여러 개면 '이 앱은 대충 만들었다' 로 읽힌다. */
  const 백테스트파일들 = [
    "pages/Backtest.tsx",
    "components/backtest/AllocationForm.tsx",
    "components/backtest/AllocationResult.tsx",
    "components/backtest/AllocationTab.tsx",
  ];

  it("말줄임표를 한 가지로 쓴다", () => {
    /* '계산 중...' 과 '계산 중…' 이 섞여 있었다(3곳 대 8곳).
       점 세 개는 폰트에 따라 간격이 달라 보인다. */
    const 걸린것: string[] = [];
    for (const f of 백테스트파일들) {
      for (const m of 읽기(f).matchAll(/중\.\.\./g)) 걸린것.push(`${f}: ${m[0]}`);
    }
    expect(걸린것, `점 세 개를 쓴 곳: ${걸린것.join(", ")}`).toEqual([]);
  });

  it("기다리는 표시를 손으로 만들지 않는다", () => {
    /* 공용 LoadingSpinner 를 만들어 놓고, 정작 이 화면은 같은 마크업을
       손으로 베껴 쓰고 있었다. 하나가 바뀌면 다른 하나만 옛날 모양으로
       남는다. */
    const 걸린것 = 백테스트파일들.filter(
      (f) => 읽기(f).includes("border-t-transparent rounded-full animate-spin"));
    expect(걸린것, `스피너를 손으로 만든 곳: ${걸린것.join(", ")}`).toEqual([]);
  });

  it("차트 색을 직접 적지 않는다", () => {
    /* 이 앱에는 밝은 테마가 있다. 직접 적은 색은 테마를 안 따라가서,
       하얀 배경에 어두운 말풍선이 뜬다. */
    const 걸린것: string[] = [];
    for (const f of 백테스트파일들) {
      const 코드 = 코드만(읽기(f));
      for (const m of 코드.matchAll(/#[0-9a-fA-F]{6}/g)) 걸린것.push(`${f}: ${m[0]}`);
    }
    expect(걸린것, `색을 직접 적은 곳: ${걸린것.join(", ")}`).toEqual([]);
  });

  it("탭과 내용이 이어져 있다", () => {
    /* role="tab" 만 있고 내용 쪽에 아무 표시가 없으면, 화면을 소리로
       듣는 사람은 탭을 눌렀을 때 무엇이 바뀌었는지 알 수 없다. */
    const s = 읽기("pages/Backtest.tsx");
    expect(s, "탭에 이름표를 안 붙였다").toMatch(/idPrefix=/);
    expect(s, "내용 쪽에 role=\"tabpanel\" 이 없다").toMatch(/role="tabpanel"/);
    expect(s, "어느 탭의 내용인지 안 가리킨다").toMatch(/aria-labelledby=/);
  });

  it("지우기 확인을 한 가지 방식으로 한다", () => {
    /* 공용 확인 창 · 버튼이 '확인/취소' 로 바뀌는 방식 · 확인 없음 —
       세 가지가 섞여 있었다. 되돌릴 수 없는 일에는 **무엇이 지워지는지
       이름을 보여 주는** 공용 창이 맞다. */
    for (const f of ["pages/Strategies.tsx", "pages/Backtest.tsx"]) {
      expect(읽기(f), `${f} 가 공용 확인 창을 안 쓴다`).toMatch(/ConfirmDialog/);
      expect(읽기(f), `${f} 에 2단계 삭제가 남아 있다`).not.toMatch(/pendingDeleteId/);
    }
  });
});

describe("백테스트 화면의 단추", () => {
  /* 같은 일을 하는 단추가 자리마다 크기와 색이 달랐다.
     한 줄에 나란히 놓으면 높이가 안 맞고, 한 곳을 고쳐도 나머지는
     그대로 남는다. */
  const 백테스트파일들 = [
    "pages/Backtest.tsx",
    "components/backtest/AllocationForm.tsx",
    "components/backtest/AllocationTab.tsx",
    "components/backtest/ConditionBuilder.tsx",
  ];

  it("고르기 칩을 손으로 안 만든다", () => {
    /* '여럿 중 하나 고르기' 칩이 여섯 벌이었고 크기가 다 달랐다 —
       기간 py-2, 금액 py-2, 거래비용 py-1.5(혼자 작음), 시장 py-1.5,
       프리셋 py-1, 논리 py-0.5. 고른 것을 칠하는 규칙도 여섯 번
       따로 적혀 있었다. */
    const 걸린것: string[] = [];
    for (const f of 백테스트파일들) {
      const 코드 = 코드만(읽기(f));
      /* 고른 것을 파랗게 칠하는 규칙을 직접 적은 자리를 찾는다 */
      for (const _ of 코드.matchAll(/bg-accent-blue\/15 border-accent-blue/g)) {
        걸린것.push(f);
      }
    }
    expect(걸린것, `칩 모양을 손으로 적은 곳: ${[...new Set(걸린것)].join(", ")}`)
      .toEqual([]);
  });

  it("칩 글자가 줄바꿈되지 않는다", () => {
    /* '반영 안 함' 이 좁은 칩 안에서 두 줄이 되면서 그 칩만 46px 이
       되고, 같은 줄의 형제 칩까지 31px → 46px 로 끌려 올라갔다.
       jsdom 은 레이아웃을 안 재므로 글자로 못을 박는 수밖에 없다. */
    expect(읽기("components/ui/index.tsx"), "고른칩에 whitespace-nowrap 이 없다")
      .toMatch(/disabled:opacity-40 whitespace-nowrap/);
  });

  it("고르기 칩에 공용 부품을 쓴다", () => {
    /* 위 검사만 있으면 칩을 통째로 지워도 통과한다 */
    const 쓰는곳 = 백테스트파일들.filter((f) => 읽기(f).includes("고른칩"));
    expect(쓰는곳.length, "공용 칩을 쓰는 곳이 없다").toBeGreaterThanOrEqual(2);
  });

  it("아이콘 지우기 단추를 손으로 안 만든다", () => {
    /* p-1 · p-1.5 · p-2 가 섞여 있었다. 아이콘이 14px 이라 p-1 이면
       폰에서 손가락으로 누르기에 좁다 — 옆의 것이 눌린다. */
    const 걸린것: string[] = [];
    for (const f of 백테스트파일들) {
      const 코드 = 코드만(읽기(f));
      for (const m of 코드.matchAll(/hover:text-accent-red/g)) {
        /* 글자가 있는 단추(삭제·지우기 글씨)는 아이콘 단추가 아니다 */
        const 자리 = 코드.slice(Math.max(0, m.index! - 200), m.index! + 200);
        if (/<Trash2|<X /.test(자리) && !/지움단추/.test(자리)) 걸린것.push(f);
      }
    }
    expect(걸린것, `아이콘 지우기를 손으로 만든 곳: ${[...new Set(걸린것)].join(", ")}`)
      .toEqual([]);
  });

  it("AND/OR 토글도 공용 부품을 쓴다", () => {
    /* 테두리 안의 분절 토글은 칩과 다른 모양이다. 이 앱에는 그 용도의
       Tabs(tone="subtle")가 이미 있는데 손으로 또 만들고 있었다. */
    const s = 읽기("components/backtest/ConditionBuilder.tsx");
    expect(s, "논리 토글을 손으로 만들었다").toMatch(/tone="subtle"/);
  });
});
