/**
 * 공모주 일정을 증권사로 거르기 — 사용자: "공모주 일정 증권사별로 설정해서 볼수 있게 만들어줘"
 *
 * 청약은 계좌가 있는 증권사로만 할 수 있다. 서버는 원천(38)의 주관사 칸을 글 그대로
 * 준다('미래에셋증권,KB증권'). 여기서 증권사 이름들로 나눈다.
 */

/** 증권사 옛 이름 → 지금 이름. 원천이 그때 이름으로 적어 둔 줄도 같은 증권사로 묶는다 */
const 새이름: Record<string, string> = {
  미래에셋대우: "미래에셋증권",
  신한금융투자: "신한투자증권",
  하나금융투자: "하나증권",
  KTB투자증권: "다올투자증권",
  이베스트투자증권: "LS증권",
  하이투자증권: "iM증권",
};

/** 주관사 칸 → 증권사 이름들. 여럿이면 쉼표·빗금 등으로 잇는다. '(대표)'·'(주)' 같은 괄호와
 *  '외 2' 는 뺀다. 같은 이름은 한 번만 */
export function 증권사들(주관사: string | null | undefined): string[] {
  if (!주관사) return [];
  const out: string[] = [];
  for (const 조각 of 주관사.split(/[,，/·、&+\n]|\s{2,}/)) {
    const 이름 = 조각
      .replace(/\([^)]*\)|㈜|주식회사/g, "")
      .replace(/\s*외\s*\d*\s*(?:곳|개사|사)?\s*$/, "")
      .replace(/\s+/g, "");
    if (!이름 || 이름 === "-") continue;
    const 지금이름 = 새이름[이름] ?? 이름;
    if (!out.includes(지금이름)) out.push(지금이름);
  }
  return out;
}

/** 증권사마다 몇 곳을 주관하나 — 많은 순, 같으면 이름 순 */
export function 증권사별수(주관사칸들: (string | null | undefined)[]): [string, number][] {
  const 수 = new Map<string, number>();
  for (const 칸 of 주관사칸들) {
    for (const 이름 of 증권사들(칸)) 수.set(이름, (수.get(이름) ?? 0) + 1);
  }
  return [...수.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"));
}

/** 서버 목록을 못 받았을 때 알림 설정에 늘어놓는 증권사 — 공모주를 자주 주관하는 곳(지금 이름) */
export const 자주주관하는증권사 = [
  "한국투자증권", "NH투자증권", "미래에셋증권", "KB증권", "삼성증권", "신한투자증권", "대신증권", "하나증권",
  "키움증권", "유안타증권", "교보증권", "신영증권", "IBK투자증권", "한화투자증권", "현대차증권", "SK증권",
  "유진투자증권",
];

/** 알림 설정에 늘어놓을 증권사 칩 — 서버 목록(많이 맡은 순, 없으면 자주 주관하는 곳) 뒤에, 거기 없는데
 *  골라 둔 증권사를 붙인다(그래야 뺄 수 있다). 같은 이름은 한 번만 */
export function 알림증권사칩(서버목록: string[] | null | undefined, 고른: string[]): string[] {
  const 바탕 = 서버목록?.length ? 서버목록 : 자주주관하는증권사;
  return [...new Set([...바탕, ...고른])];
}

/** 고른 증권사 가운데 하나라도 주관하나. 아무것도 안 골랐으면 모두 보인다 */
export function 내증권사공모주(주관사: string | null | undefined, 고른: string[]): boolean {
  if (!고른.length) return true;
  return 증권사들(주관사).some((x) => 고른.includes(x));
}
