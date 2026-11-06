/**
 * 이름 뒤에 붙는 조사 — '과/와' 처럼 앞 말의 받침에 따라 갈리는 것.
 *
 * 'S&P500 와 견주기' 처럼 이름을 끼워 넣는 자리에 조사를 하나로 박아 두면 절반은 틀린다(사용자가 고른 9번).
 * 벤치마크 이름은 한글(코스피)·숫자(나스닥100)·영문(S&P500)이 섞여 있어 끝 글자를 읽는 소리로 본다.
 *   한글   글자의 받침
 *   숫자   0(영·십·백·천)·1(일)·3(삼)·6(육)·7(칠)·8(팔) 은 받침이 있다
 *   영문   한 글자씩 읽는 약자로 본다 — L(엘)·M(엠)·N(엔)·R(알) 만 받침이 있다
 * 괄호·점·공백 같은 기호는 건너뛰고 그 앞 글자를 본다.
 */
export function 받침있나(말: string): boolean {
  const 글자들 = [...(말 ?? "").trim()].reverse();
  for (const ch of 글자들) {
    const c = ch.codePointAt(0)!;
    if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28 !== 0;
    if (ch >= "0" && ch <= "9") return "013678".includes(ch);
    if (/[a-z]/i.test(ch)) return "lmnr".includes(ch.toLowerCase());
  }
  return false;
}

/** '코스피와' · 'S&P500과' */
export function 과와(말: string): string {
  return `${말}${받침있나(말) ? "과" : "와"}`;
}

/** '코스피는' · 'S&P500은' */
export function 은는(말: string): string {
  return `${말}${받침있나(말) ? "은" : "는"}`;
}

/** '코스피예요' · 'S&P500이에요' — '코스피이에요' 처럼 박아 두면 받침 없는 이름에서 틀린다 */
export function 이에요(말: string): string {
  return `${말}${받침있나(말) ? "이에요" : "예요"}`;
}
