const KEY = "recently_viewed_stocks";
const MAX_ITEMS = 30;

export interface RecentStock {
  symbol: string;
  market: string;
  name: string;
  viewedAt: number;
}

export function getRecentlyViewed(): RecentStock[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function addRecentlyViewed(symbol: string, market: string, name: string): void {
  try {
    const list = getRecentlyViewed().filter((i) => !(i.symbol === symbol && i.market === market));
    list.unshift({ symbol, market, name, viewedAt: Date.now() });
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_ITEMS)));
  } catch {
    // localStorage 비활성 환경 — 무시
  }
}
