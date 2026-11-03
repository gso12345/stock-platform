/**
 * 글 공유 — 휴대폰은 기기의 공유 창(카카오톡·문자로 바로), PC 는 링크 복사.
 *
 * 예전에는 어디서나 링크 복사만 됐고, 단추 글자가 잠깐 '복사됨!' 으로 바뀌는 게 전부였다(사용자가 고른 7번).
 * 휴대폰 앱들은 공유를 누르면 기기의 공유 창이 뜬다.
 *
 * PC 크롬에도 navigator.share 가 있지만(윈도 공유 창) PC 에서는 복사가 익숙하다 — 손가락으로 쓰는
 * 기기(pointer: coarse)에서만 공유 창을 연다.
 */

/** 공유 = 기기 공유 창으로 보냄, 복사 = 링크를 복사함, 취소 = 공유 창을 닫음, 실패 = 아무것도 못 함 */
export type 공유결과 = "공유" | "복사" | "취소" | "실패";

/** 글 하나의 주소 — 종목 게시판(/stocks/…)이 아니라 그 글로 바로 간다 */
export function 글주소(id: number): string {
  return `${window.location.origin}/post/${id}`;
}

/** 이 기기에서 공유 창을 띄우나 */
export function 공유창쓰나(): boolean {
  try {
    return typeof navigator.share === "function" && !!window.matchMedia?.("(pointer: coarse)")?.matches;
  } catch {
    return false;
  }
}

/** 링크만 복사한다(⋯ 메뉴의 '링크 복사') */
export async function 링크복사(주소: string): Promise<공유결과> {
  try {
    await navigator.clipboard.writeText(주소);
    return "복사";
  } catch {
    return "실패";
  }
}

export async function 글공유(주소: string, 제목?: string): Promise<공유결과> {
  if (공유창쓰나()) {
    try {
      await navigator.share({ title: 제목 || undefined, url: 주소 });
      return "공유";
    } catch (e) {
      // 사람이 공유 창을 닫았다 — 복사로 넘어가면 바라지 않은 일을 하게 된다
      if ((e as { name?: string } | null)?.name === "AbortError") return "취소";
      // 그 밖의 실패(권한·지원 안 함)는 복사로 대신한다
    }
  }
  return 링크복사(주소);
}

/** 결과를 알림 한 줄로. 공유 창을 띄웠거나 닫았으면 말하지 않는다(기기가 이미 보여 줬다) */
export function 공유알림(결과: 공유결과): { 글: string; 종류: "success" | "error" } | null {
  if (결과 === "복사") return { 글: "링크를 복사했어요", 종류: "success" };
  if (결과 === "실패") return { 글: "링크를 복사하지 못했어요", 종류: "error" };
  return null;
}
