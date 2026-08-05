/**
 * 관심종목 탭 줄의 순서.
 *
 * 탭 줄에는 성격이 다른 셋이 섞여 있다 — 최근조회, 관심종목 폴더들, 내계좌들.
 * 예전에는 이 셋이 "최근조회 → 폴더 전부 → 내계좌 전부" 로 굳어 있었고,
 * 순서를 바꿀 수 있는 것은 폴더끼리뿐이었다. 내계좌를 주로 보는 사람은
 * 폴더를 다 지나쳐야 자기 계좌에 닿았다.
 *
 * 그래서 셋을 한 줄로 놓고 통째로 순서를 바꾼다. 종류가 달라 id 만으로는
 * 구분이 안 되므로 "folder:3" 같은 키를 쓴다.
 *
 * 저장은 브라우저에 한다. 서버에 둘 수도 있었지만 — 폴더 순서는 이미 서버에
 * 있다 — 이건 "이 기기에서 내가 보는 순서" 에 가깝다. 폰에서는 계좌를 먼저
 * 보고 PC 에서는 폴더를 먼저 보는 것이 이상하지 않다. 폴더끼리의 순서는
 * 그대로 서버에 남으므로, 기기를 옮겨도 폴더가 뒤섞이지는 않는다.
 */

export const 최근조회키 = "recent";
export const 폴더키 = (id: number) => `folder:${id}`;
export const 계좌키 = (id: number) => `portfolio:${id}`;

const 저장자리 = (사용자: number | string | null | undefined) =>
  `watchlistTabOrder:${사용자 ?? "guest"}`;

export function 탭순서읽기(사용자: number | string | null | undefined): string[] {
  try {
    const 값 = localStorage.getItem(저장자리(사용자));
    if (!값) return [];
    const 파싱 = JSON.parse(값);
    /* 남이 손댔거나 옛 형식이면 그냥 버린다. 여기서 터지면 관심종목
       화면 전체가 안 뜬다 — 순서 하나 때문에 그럴 이유가 없다 */
    return Array.isArray(파싱) ? 파싱.filter((k) => typeof k === "string") : [];
  } catch {
    return [];
  }
}

export function 탭순서쓰기(사용자: number | string | null | undefined, 키들: string[]): void {
  try {
    localStorage.setItem(저장자리(사용자), JSON.stringify(키들));
  } catch {
    /* 저장 공간이 꽉 찼거나 사파리 프라이빗 모드다. 순서가 안 남을 뿐,
       이번 화면은 멀쩡히 동작한다 */
  }
}

/**
 * 저장된 순서를 실제 목록에 입힌다.
 *
 * 저장된 순서는 언제나 낡아 있다고 봐야 한다 — 폴더를 지웠을 수도, 계좌를
 * 새로 만들었을 수도 있다. 그래서 저장된 것 중 아직 있는 것만 그 순서대로
 * 앞에 놓고, 처음 보는 것은 원래 순서 그대로 뒤에 붙인다.
 *
 * 새것을 뒤에 붙이는 쪽이 맞다. 앞에 끼우면 방금 만든 폴더가 애써 맞춰 둔
 * 순서를 밀어내고 맨 앞을 차지한다.
 */
export function 탭순서적용<T extends { key: string }>(저장된: string[], 실제: T[]): T[] {
  const 남은 = new Map(실제.map((t) => [t.key, t]));
  const 결과: T[] = [];
  for (const k of 저장된) {
    const t = 남은.get(k);
    if (t) { 결과.push(t); 남은.delete(k); }
  }
  for (const t of 실제) if (남은.has(t.key)) 결과.push(t);
  return 결과;
}

/**
 * 폴더끼리의 순서만 바뀌었을 때, 저장된 탭 순서에 그걸 입힌다.
 *
 * 폴더 순서는 두 곳에서도 바뀐다 — 화면 본문의 폴더 목록과 폴더 관리 창.
 * 그때 저장된 탭 순서를 그대로 두면, 서버는 새 순서인데 탭 줄은 옛 순서로
 * 남아 두 곳이 어긋난다.
 *
 * 폴더가 놓여 있던 "자리"는 그대로 두고 그 자리에 새 순서대로 채운다.
 * 자리까지 옮기면 폴더 사이에 끼워 둔 내계좌가 딸려 나간다.
 */
export function 폴더순서반영(저장된: string[], 폴더순서: number[]): string[] {
  const 새키 = 폴더순서.map(폴더키);
  let 다음 = 0;
  return 저장된.map((k) => (k.startsWith("folder:") && 다음 < 새키.length ? 새키[다음++] : k));
}
