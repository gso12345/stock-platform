/**
 * 뉴스 목록을 그리기 전에 — 같은 기사를 한 번만 남기고, 기사마다 겹치지 않는 이름표(key)를 준다.
 *
 * 국내·미국을 오가면 미국 목록 위에 국내 기사가 쌓이던 오류의 원인이 여기였다. 서버가 준 목록에 같은 기사가
 * 두 번(같은 주소) 있었고, 화면은 기사 주소를 React 의 이름표로 썼다. 이름표가 겹치면 React 는 목록을 바꿀 때
 * 겹친 것 중 하나를 못 지우고 화면에 남긴다 — 오갈 때마다 하나씩 쌓였다(사용자 사진: 미국 증시 뉴스 맨 위에
 * 국내 기사 둘이 두 번씩). 서버도 이제 같은 기사를 빼고 보내지만, 화면이 받은 것을 믿지 않고 한 번 더 거른다.
 */

type 기사 = { link?: string | null; title?: string | null; source?: string | null };

/** 기사 하나의 이름표 — 주소, 주소가 없으면 제목 */
export function 기사열쇠(a: 기사): string {
  const 주소 = (a?.link ?? "").trim();
  return 주소 ? `주소:${주소}` : `제목:${(a?.title ?? "").trim()}`;
}

/** 같은 기사는 처음 것 하나만 남긴다(순서는 그대로).
 *
 *  같은 기사 — 주소가 같거나, 주소는 달라도 **같은 언론사의 같은 제목**(같은 기사를 주소 꼬리만 바꿔 다시 실은
 *  것). 언론사가 다르면 제목이 같아도 남긴다 — 통신사 기사를 여러 곳이 받아 쓴 것은 출처가 다른 기사다. */
export function 같은기사빼기<T extends 기사>(기사들: readonly T[] | null | undefined): T[] {
  const 본열쇠 = new Set<string>();
  const 본제목 = new Set<string>();
  const 남길것: T[] = [];
  for (const a of 기사들 ?? []) {
    if (!a) continue;
    const 열쇠 = 기사열쇠(a);
    const 제목 = (a.title ?? "").trim();
    const 출처제목 = 제목 ? `${(a.source ?? "").trim()}\u0000${제목}` : "";
    if (본열쇠.has(열쇠) || (출처제목 && 본제목.has(출처제목))) continue;
    본열쇠.add(열쇠);
    if (출처제목) 본제목.add(출처제목);
    남길것.push(a);
  }
  return 남길것;
}
