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
