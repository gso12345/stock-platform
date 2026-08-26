/**
 * 관리자 화면 전체 원문 — 검사끼리 같이 쓴다.
 *
 * 관리자 화면은 원래 Admin.tsx 한 파일(1,963줄)이었고, 여러 검사가
 * 그 파일을 통째로 읽어 "여덟 탭 전부에 실패 표시가 있는가" 같은 것을
 * 봤다. 탭 단위로 가르면서 파일이 아홉 개가 됐는데, Admin.tsx 만 계속
 * 읽으면 검사는 통과하면서 정작 아무것도 안 지키게 된다 — 있는 것보다
 * 나쁘다.
 *
 * 그래서 조각을 전부 이어 붙여 준다. 새 탭을 추가해도 자동으로 딸려
 * 들어오므로, 나중에 또 쪼개도 검사가 조용히 눈멀지 않는다.
 */
import fs from "fs";
import path from "path";

const 뿌리 = path.resolve(__dirname, "../..");

/** 관리자 화면을 이루는 파일들 — 본체 + 탭 조각 전부 */
export function 관리자파일들(): string[] {
  const 탭들 = path.join(뿌리, "components/admin");
  return [
    path.join(뿌리, "pages/Admin.tsx"),
    ...fs.readdirSync(탭들)
        .filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"))
        .map((f) => path.join(탭들, f)),
  ];
}

/** 이어 붙인 원문 */
export function 관리자원문(): string {
  const 파일 = 관리자파일들();
  if (파일.length < 5) throw new Error(`관리자 조각을 못 찾았다: ${파일.length}개`);
  return 파일.map((p) => fs.readFileSync(p, "utf-8")).join("\n");
}

/** 주석·문서화 문자열을 걷어낸 원문.
 *  무엇을 왜 그만뒀는지 주석에 적어 두므로, 그걸 현재 코드로 착각하면
 *  멀쩡한 구현이 걸린다. */
export function 관리자코드(): string {
  return 관리자원문()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}
