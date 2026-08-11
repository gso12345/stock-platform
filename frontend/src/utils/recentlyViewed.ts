/**
 * 최근 본 종목 — 관심종목 '최근' 탭과 퀀트 화면이 읽는다.
 *
 * 사람마다 따로 담는다. 예전에는 키가 하나뿐이라, 공용 기기(가족 PC·매장
 * 단말)에서 A 가 보고 나간 종목이 B 가 로그인한 뒤에도 그대로 보였다.
 * 무엇을 들여다봤는지는 남에게 보일 이유가 없는 정보다.
 *
 * 로그아웃 상태(비로그인)도 자기 칸을 쓴다 — 미리보기로 둘러본 것이
 * 로그인한 사람 목록에 섞이지 않게.
 */
const BASE = "recently_viewed_stocks";
const MAX_ITEMS = 30;

export interface RecentStock {
  symbol: string;
  market: string;
  name: string;
  viewedAt: number;
}

/** 지금 로그인한 사람의 칸 이름.
 *
 *  authStore 를 import 하면 순환 참조가 생긴다(스토어가 이 유틸을 쓰는 화면을
 *  거쳐 돌아온다). 저장된 인증 정보를 직접 읽는 편이 단순하다 —
 *  client.ts 가 쓰는 키와 같은 것이다. */
function 내칸(): string {
  try {
    const raw = localStorage.getItem("stkplt_auth");
    if (raw) {
      const id = JSON.parse(raw)?.state?.userId ?? JSON.parse(raw)?.userId;
      if (id != null) return `${BASE}:u${id}`;
    }
  } catch {
    /* 못 읽으면 손님 칸을 쓴다 */
  }
  return `${BASE}:guest`;
}

export function getRecentlyViewed(): RecentStock[] {
  try {
    const raw = localStorage.getItem(내칸());
    const 읽은것 = raw ? JSON.parse(raw) : [];
    // 손으로 고쳐졌거나 예전 형식일 수 있다 — 모양을 확인하고 받는다
    return Array.isArray(읽은것)
      ? 읽은것.filter((x): x is RecentStock => !!x && typeof x.symbol === "string")
      : [];
  } catch {
    return [];
  }
}

export function addRecentlyViewed(symbol: string, market: string, name: string): void {
  try {
    const list = getRecentlyViewed().filter((i) => !(i.symbol === symbol && i.market === market));
    list.unshift({ symbol, market, name, viewedAt: Date.now() });
    localStorage.setItem(내칸(), JSON.stringify(list.slice(0, MAX_ITEMS)));
  } catch {
    // localStorage 비활성 환경 — 무시
  }
}

/** 사람이 바뀔 때 부른다 — 예전 키에 쌓여 있던 공용 기록을 지운다.
 *
 *  칸을 나눈 것만으로는 이미 남아 있는 옛 기록이 안 없어진다. 그건 누구
 *  것인지 알 수 없으므로 남겨 둘 이유가 없다. */
export function 최근조회정리() {
  try { localStorage.removeItem(BASE); } catch { /* 무시 */ }
}
