/**
 * 서버가 주는 모양을 적어 두면, 이름을 잘못 쓴 곳을 빌드가 짚어 준다.
 *
 * any 로 두면 화면이 조용히 빈칸을 그리고 아무도 모른다. 이번에 타입을
 * 붙이면서 실제로 두 가지가 드러났다.
 *
 *   1) forecasts 가 전망행[] 로 선언돼 있었다. 서버는
 *      {annual, quarterly} 를 준다 — 배열이 아니다. 화면은 `as any` 로
 *      우회하고 있어서 이 어긋남이 그대로 묻혀 있었다.
 *   2) 전망행 의 칸 이름이 서버와 달랐다. revenue·eps 로 적혀 있는데
 *      서버는 revenue_est·eps_est 를 준다.
 *
 * 여기 적힌 이름은 전부 backend 소스를 열어 확인한 것이다.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { 종목상세원문 } from "./stockDetailSource";

const 뿌리 = path.resolve(__dirname, "../..");
const 소스 = (rel: string) => fs.readFileSync(path.join(뿌리, rel), "utf-8");
const 코드만 = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const 타입 = 소스("types/index.ts");
const api = 소스("api/stocks.ts");

describe("컨센서스 응답", () => {
  it("배열이 아니라 연간·분기 묶음이다", () => {
    expect(타입).toMatch(/export interface 전망응답 \{[\s\S]*annual: 전망행\[\][\s\S]*quarterly: 전망행\[\]/);
  });

  it("api 가 그 모양으로 선언한다", () => {
    /* 여기가 전망행[] 로 돌아가면 화면이 다시 as any 를 쓰게 된다 */
    expect(코드만(api)).toContain("api.get<전망응답>(");
    expect(코드만(api)).not.toMatch(/api\.get<전망행\[\]>/);
  });

  it("화면이 as any 없이 꺼낸다", () => {
    const s = 코드만(종목상세원문);
    expect(s).not.toContain("(forecasts as any)");
    expect(s).toContain("forecasts?.annual");
    expect(s).toContain("forecasts?.[consensusPeriod]");
  });
});

describe("전망 한 줄의 칸 이름", () => {
  const 전망행 = 타입.slice(타입.indexOf("export interface 전망행"),
                            타입.indexOf("export interface 전망응답"));

  it("서버가 실제로 넣는 이름을 쓴다", () => {
    /* backend stocks.py 의 get_forecasts 안 _upsert 가 넣는 것 */
    for (const k of ["eps_est", "revenue_est", "growth_est",
                     "eps_low", "eps_high", "eps_analysts"]) {
      expect(전망행, `${k} 가 없다`).toContain(k);
    }
  });

  it("서버에 없는 이름을 필수로 두지 않는다", () => {
    /* revenue·eps 로 적혀 있었다 — 서버는 그 이름으로 안 준다 */
    expect(전망행).not.toMatch(/^\s*revenue\??:/m);
    expect(전망행).not.toMatch(/^\s*eps\??:/m);
  });

  it("period 와 type 은 늘 온다", () => {
    /* _upsert 가 줄을 만들 때 반드시 넣는다. 없을 수 있다고 두면
       정렬하는 자리에서 period 가 undefined 라 터진다 */
    expect(전망행).toMatch(/period:\s*string;/);
    expect(전망행).toMatch(/type:\s*string;/);
  });
});

describe("서버에 없는 추정치를 아는 채로 둔다", () => {
  it("영업이익·순이익 예상이 왜 비는지 적혀 있다", () => {
    /* 화면은 op_income_est · net_income_est 를 찾는데 서버 어디에도
       그 이름이 없다. 즉 그 칸은 처음부터 늘 '—' 였다.
       매핑을 지우지는 않는다 — 서버가 넣기 시작하면 그대로 살아난다.
       대신 이유를 적어 둬야 다음 사람이 화면부터 뒤지지 않는다. */
    const 원문 = 종목상세원문;
    const i = 원문.indexOf("const 예측키");
    expect(i).toBeGreaterThan(-1);
    const 앞 = 원문.slice(Math.max(0, i - 800), i);
    expect(앞).toContain("op_income_est");
    expect(앞).toMatch(/서버 어디에도 없다|늘 '—'/);
  });
});

describe("관심종목 응답", () => {
  it("서버 _item_to_dict 와 같은 칸을 적어 뒀다", () => {
    const s = 타입.slice(타입.indexOf("export interface WatchlistItem"),
                         타입.indexOf("export interface 시세행"));
    for (const k of ["id", "symbol", "market", "name", "memo",
                     "folder_id", "folder_name", "added_at"]) {
      expect(s, `${k} 가 없다`).toContain(k);
    }
  });

  it("시세는 없을 수 있다고 적는다", () => {
    /* 못 받은 종목도 자리는 오고 값만 null 이다. 그 줄이 통째로 빠지면
       '내가 넣은 종목이 사라졌다' 로 보인다 */
    const s = 타입.slice(타입.indexOf("export interface 시세행"));
    expect(s).toMatch(/price:\s*number \| null;/);
  });

  it("폴더에 개수가 함께 온다", () => {
    const s = 타입.slice(타입.indexOf("export interface 관심폴더"));
    expect(s).toMatch(/count:\s*number;/);
  });

  it("api 가 그 모양으로 선언한다", () => {
    const s = 코드만(api);
    expect(s).toContain("Promise<관심폴더[]>");
    expect(s).toContain("Promise<WatchlistItem[]>");
    expect(s).toContain("Promise<시세행[]>");
    /* 응답 모양만 본다 — 함수 안에서 쓰는 작업용 배열까지 막으면
       고치는 것과 상관없는 곳이 걸린다 */
    expect(s).not.toMatch(/: *\(.*\): *Promise<any\[\]>/);
  });
});

describe("걷어낸 as any 가 되살아나지 않게", () => {
  it("관심종목이 목록을 as any 로 다루지 않는다", () => {
    const s = 코드만(소스("pages/Watchlist.tsx"));
    for (const 것 of ["folders as any", "allItems as any", "pfAllItems as any",
                      "items as any", "restPrices as any", "previewPrices as any"]) {
      expect(s, `${것} 가 되살아났다`).not.toContain(것);
    }
  });

  it("종목상세가 detail·fundamentals 를 as any 로 다루지 않는다", () => {
    const s = 코드만(종목상세원문);
    expect(s).not.toContain("유효((detail as any)");
    expect(s).not.toContain("유효((fundamentalsData as any)");
    expect(s).not.toContain("(detail as any)?.name");
  });
});

describe("폴더 개수 세기", () => {
  it("폴더 번호가 아닌 것을 세지 않는다", () => {
    /* 타입을 붙이고 나서야 보였다 — folder_id 가 null 인 것들이
       null 이라는 열쇠 하나에 뭉쳐 담기고 있었다 */
    const s = 코드만(소스("pages/Watchlist.tsx"));
    const i = s.indexOf("const folderCounts");
    expect(i).toBeGreaterThan(-1);
    expect(s.slice(i, i + 700)).toContain('typeof i.folder_id !== "number"');
  });
});
