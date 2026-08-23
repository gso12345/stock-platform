/**
 * 관리자 화면 점검에서 나온 것들.
 *
 * 관리자만 쓰는 화면이라 공격보다는 '실수로 되돌릴 수 없는 일을 하는' 쪽이
 * 문제다. 그리고 관리자가 여럿일 때 누가 무엇을 했는지 남는 것이 중요하다.
 *
 * 점검 결과 —
 *   · 여덟 탭 전부 조회 실패를 화면에 안 알렸다(0곳)
 *   · 신고 탭의 '콘텐츠 삭제' 만 확인 없이 클릭 한 번에 실행됐다.
 *     같은 일을 하는 커뮤니티 탭에는 확인창이 있다.
 *   · 신고 처리가 .finally() 만 있어 실패해도 성공처럼 보였다
 *   · 신고 처리·공지·팝업 변경이 관리 기록에 안 남았다
 *   · 팝업 입력에 길이·형식 검증이 없었다
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const 뿌리 = path.resolve(__dirname, "../..");
const 백엔드 = path.resolve(__dirname, "../../../../backend");
const 소스 = (rel: string) => fs.readFileSync(path.join(뿌리, rel), "utf-8");
const 코드만 = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
   .replace(/"""[\s\S]*?"""/g, "").replace(/^\s*#.*$/gm, "");

const 화면 = 코드만(소스("pages/Admin.tsx"));
const 서버 = 코드만(fs.readFileSync(path.join(백엔드, "app/api/routes/admin.py"), "utf-8"));

describe("조회가 실패하면 화면이 말한다", () => {
  it("일곱 자리에 실패 표시가 있다", () => {
    /* 여덟 탭 전부 0곳이었다. 실패해도 빈 목록으로 보여서, 관리자가
       "아직 아무것도 없구나" 로 읽고 넘어간다 */
    expect((화면.match(/<못불러옴/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });

  it("다시 시도할 길을 함께 준다", () => {
    const 자리 = [...화면.matchAll(/<못불러옴[\s\S]{0,160}?\/>/g)].map((m) => m[0]);
    expect(자리.length).toBeGreaterThan(0);
    expect(자리.every((x) => /다시=\{/.test(x))).toBe(true);
  });

  it("동그라미만 돌리던 자리를 스켈레톤으로 바꿨다", () => {
    /* 표가 뜰 자리를 잡아 두면 뜰 때 화면이 안 밀린다 */
    expect(화면).not.toContain(
      'w-5 h-5 rounded-full border-2 border-accent-blue border-t-transparent animate-spin');
    expect((화면.match(/<RowSkeleton/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });

  it("실패와 '검색 결과 없음' 을 갈랐다", () => {
    expect(화면).toContain("!isLoading && !못받음 && filtered.length === 0");
  });
});

describe("되돌릴 수 없는 일은 먼저 묻는다", () => {
  it("신고된 글 삭제에 확인창이 있다", () => {
    /* 여기만 클릭 한 번에 실행됐다. 옆 버튼(블라인드·기각)과 나란히
       있어서 잘못 누르기도 쉬웠다 */
    expect(화면).toContain("const 지우기 = (r: any) => 묻기(");
    expect(화면).not.toContain("act(adminApi.deleteReportContent, r.id)}");
  });

  it("무엇을 지우는지 보여 준다", () => {
    const i = 화면.indexOf("const 지우기");
    expect(화면.slice(i, i + 500)).toMatch(/대상:/);
  });

  it("되돌릴 수 있는 길을 함께 알려 준다", () => {
    /* 블라인드는 되돌릴 수 있다. 지우기 전에 그걸 알려 주면
       되돌릴 수 없는 쪽을 덜 고른다 */
    const i = 화면.indexOf("const 지우기");
    expect(화면.slice(i, i + 500)).toMatch(/블라인드는 되돌릴 수 있/);
  });
});

describe("실패를 성공처럼 보여 주지 않는다", () => {
  it("신고 처리가 오류를 잡아 알린다", () => {
    /* .finally() 만 있어서 실패해도 목록만 새로고침하고 끝났다 —
       아무것도 안 바뀐 채 "처리했다" 로 읽힌다 */
    const i = 화면.indexOf("const act = ");
    const 몸통 = 화면.slice(i, i + 400);
    expect(몸통).toContain("catch");
    expect(몸통).toContain("보이기(");
    expect(몸통).not.toMatch(/fn\(id\)\.finally\(/);
  });
});

describe("관리자가 한 일이 남는다", () => {
  const 남아야하는것 = [
    "report.blind", "report.unblind", "report.dismiss", "report.delete_content",
    "announcement.set", "popup.create", "popup.update", "popup.delete",
  ];

  it.each(남아야하는것)("%s 가 기록된다", (행위) => {
    /* 신고 처리와 공지·팝업은 모든 사용자가 보는 것을 바꾸는데
       기록이 없었다. 관리자가 여럿이면 누가 했는지 알 수 없다 */
    expect(서버).toContain(`"${행위}"`);
  });

  it("파괴적 동작 전부가 관리기록을 부른다", () => {
    const 부른수 = (서버.match(/관리기록\(/g) ?? []).length;
    expect(부른수).toBeGreaterThanOrEqual(20);   // 예전 12곳 + 이번 8곳
  });
});

describe("팝업·공지 입력을 검증한다", () => {
  it("body: dict 로 그냥 받지 않는다", () => {
    /* content 에 길이 제한이 없어 몇 MB 짜리 글이 DB 로 들어갔고,
       starts_at 이 문자열 그대로 DateTime 칸에 들어가 모양이 틀리면
       그 자리에서 500 이 났다 */
    expect(서버).not.toMatch(/def set_announcement\(body: dict/);
    expect(서버).not.toMatch(/def create_popup\(body: dict/);
    expect(서버).toContain("class 팝업요청(BaseModel)");
    expect(서버).toContain("class 공지요청(BaseModel)");
  });

  it("길이 상한을 적어 뒀다", () => {
    const i = 서버.indexOf("class 팝업요청");
    const 몸통 = 서버.slice(i, 서버.indexOf("@router", i));
    for (const k of ["popup_type", "title", "content", "link_text", "bg_color"]) {
      expect(몸통, `${k} 에 상한이 없다`).toMatch(new RegExp(`${k}[^\\n]*max_length`));
    }
  });

  it("날짜를 날짜로 받는다", () => {
    const i = 서버.indexOf("class 팝업요청");
    const 몸통 = 서버.slice(i, 서버.indexOf("@router", i));
    expect(몸통).toMatch(/starts_at:\s*Optional\[datetime\]/);
    expect(몸통).toMatch(/ends_at:\s*Optional\[datetime\]/);
  });

  it("수정은 보낸 칸만 고친다", () => {
    /* exclude_unset 이 없으면 모델 기본값이 안 보낸 칸까지 덮어써서,
       제목만 고치려다 꺼 둔 팝업이 켜진다 */
    const i = 서버.indexOf("def update_popup");
    expect(서버.slice(i, i + 900)).toContain("exclude_unset=True");
  });
});

describe("권한", () => {
  it("사용자도 봐야 하는 둘 말고는 전부 관리자 전용이다", () => {
    const 열린것 = [...서버.matchAll(
      /@router\.(get|post|put|patch|delete)\("([^"]+)"[^)]*\)\s*\n(?:@[^\n]*\n)*(?:async )?def \w+\(([\s\S]*?)\):/g)]
      .filter((m) => !m[3].includes("require_admin"))
      .map((m) => m[2]);
    /* 공지와 팝업은 사용자 화면이 읽어야 한다. 나머지가 열려 있으면 사고다 */
    expect(열린것.sort()).toEqual(["/announcement", "/popups/active"]);
  });
});
