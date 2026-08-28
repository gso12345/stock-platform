/**
 * 비어 있는 동안만 다시 물어보기.
 *
 * 서버가 무거운 목록(해외 순위·뉴스)을 만들 때 쓰는 방식이 있다 —
 * 이번 요청은 있는 것으로 답하고, 만드는 일은 배경으로 넘긴다.
 * 0.15 CPU 서버에서 화면을 30초씩 붙잡지 않으려는 것이라 옳은 선택이다.
 *
 * 그런데 그러면 화면이 다시 와서 받아 가야 한다. 안 그러면 처음 연
 * 사람은 빈 화면을 본다. 실제로 그랬다 —
 *
 *   해외 순위 : staleTime 60초, 재촉 없음  → "아직 순위가 만들어지지 않았어요"
 *   해외 뉴스 : refetchInterval 5분        → "표시할 뉴스가 없어요"
 *
 * 배경 작업은 대개 몇 초면 끝나는데 화면은 1분·5분을 기다렸다.
 */
import { describe, it, expect } from "vitest";
import { 빌때재촉, 기본재촉, 기본재촉_횟수 } from "@/utils/refetch";

/** react-query 의 Query 에서 이 함수가 보는 부분만 흉내 낸다 */
const 조회 = <T,>(data: T | undefined, dataUpdateCount = 1) =>
  ({ state: { data, dataUpdateCount } }) as never;

describe("비어 있으면 재촉한다", () => {
  it("빈 배열이면 몇 초 뒤 다시 묻는다", () => {
    expect(빌때재촉<number[]>(false)(조회<number[]>([]))).toBe(기본재촉);
  });

  it("아직 아무것도 안 왔어도 재촉한다", () => {
    /* 첫 조회가 실패했거나 아직 도착 전이다. 그때도 다시 물어야
       배경이 채워 놓은 것을 받아 온다 */
    expect(빌때재촉<number[]>(false)(조회<number[]>(undefined))).toBe(기본재촉);
  });

  it("채워지면 평소 주기로 돌아간다", () => {
    expect(빌때재촉<number[]>(300_000)(조회([1, 2]))).toBe(300_000);
  });

  it("평소 주기가 false 면 채워진 뒤에는 아예 안 묻는다", () => {
    /* 순위는 60초 staleTime 으로 충분하다 — 채워진 뒤까지 계속
       두드릴 이유가 없다 */
    expect(빌때재촉<number[]>(false)(조회([1]))).toBe(false);
  });
});

describe("끝이 있다", () => {
  it("몇 번만 재촉하고 물러난다", () => {
    /* 영영 안 채워지는 경우가 있다(원천이 죽었거나 그 시장이 쉬는 날).
       그때 몇 초마다 영원히 두드리면 서버를 제일 세게 때리는 짓이면서
       값이 생기지도 않는다 */
    const 규칙 = 빌때재촉<number[]>(300_000);
    expect(규칙(조회<number[]>([], 기본재촉_횟수))).toBe(기본재촉);
    expect(규칙(조회<number[]>([], 기본재촉_횟수 + 1))).toBe(300_000);
  });

  it("물러난 뒤 평소 주기가 false 면 멈춘다", () => {
    const 규칙 = 빌때재촉<number[]>(false);
    expect(규칙(조회<number[]>([], 99))).toBe(false);
  });
});

describe("'비었다' 를 직접 정할 수 있다", () => {
  it("배열이 아닌 모양도 다룬다", () => {
    /* {items:[...]} 로 감싸여 오는 응답이 있다 */
    const 규칙 = 빌때재촉<{ items: number[] }>(
      false, (v) => !v || v.items.length === 0);
    expect(규칙(조회({ items: [] }))).toBe(기본재촉);
    expect(규칙(조회({ items: [1] }))).toBe(false);
  });

  it("간격과 횟수도 바꿀 수 있다", () => {
    const 규칙 = 빌때재촉<number[]>(false, undefined, 1_000, 2);
    expect(규칙(조회<number[]>([], 1))).toBe(1_000);
    expect(규칙(조회<number[]>([], 3))).toBe(false);
  });
});

describe("실제로 붙어 있는가", () => {
  /* 규칙만 맞고 화면에 안 붙어 있으면 아무 소용이 없다.
     누군가 '어차피 5분이면 되겠지' 하고 지워도 화면만 봐서는 티가
     안 난다 — 빈 화면은 원래 빈 화면처럼 보인다. */
  const 소스 = (rel: string) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs") as typeof import("fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("path") as typeof import("path");
    return fs.readFileSync(path.resolve(__dirname, "../..", rel), "utf-8");
  };

  it("해외·국내 순위와 뉴스에 다 붙어 있다", () => {
    const 대시 = 소스("pages/Dashboard.tsx");
    // 순위 하나 + 뉴스 둘
    expect((대시.match(/빌때재촉</g) ?? []).length).toBeGreaterThanOrEqual(3);
    const i = 대시.indexOf('queryKey: ["rankings"');
    expect(i).toBeGreaterThan(-1);
    expect(대시.slice(i, i + 700)).toContain("빌때재촉");
  });

  it("뉴스 탭 화면에도 붙어 있다", () => {
    expect(소스("pages/News.tsx")).toContain("빌때재촉");
  });
});
