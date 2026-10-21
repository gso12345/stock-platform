/** 관심종목 — 폴더·종목·시세. 화면은 '@/api/stocks' 에서 가져간다(거기서 다시 내보낸다). */
import api from "./client";
import type { WatchlistItem, 관심폴더, 시세행 } from "@/types";

export const watchlistFolderApi = {
  getFolders: (): Promise<관심폴더[]> =>
    api.get("/watchlist/folders").then((r) => r.data),
  createFolder: (name: string) =>
    api.post("/watchlist/folders", { name }).then((r) => r.data),
  updateFolder: (id: number, name: string) =>
    api.put(`/watchlist/folders/${id}`, { name }).then((r) => r.data),
  deleteFolder: (id: number) =>
    api.delete(`/watchlist/folders/${id}`).then((r) => r.data),
  reorderFolders: (order: number[]) =>
    api.put("/watchlist/folders/reorder", { order }).then((r) => r.data),
};

/** 서버 /watchlist/prices 가 한 요청에 허용하는 최대 심볼 수 (backend watchlist.py) */
const PRICE_CHUNK_SIZE = 50;

export const watchlistApi = {
  getAll: () =>
    api.get("/watchlist/").then((r) => r.data),

  getItems: (market?: string, folderId?: number): Promise<WatchlistItem[]> =>
    api.get("/watchlist/items", { params: { market, folder_id: folderId } }).then((r) => r.data),

  /** 관심종목 목록 + **이미 받아 둔 시세**를 한 번에 (내 자산의 getItemsWithPrices 와 같은 것).
   *  예전 서버는 배열만 준다 — 받는 쪽(hooks/useWatchlistItems)이 둘 다 읽는다 */
  getItemsWithCachedPrices: () =>
    api.get<{ items: unknown[]; prices: unknown[] } | unknown[]>("/watchlist/items", {
      params: { with_prices: true },
    }).then((r) => r.data),

  /**
   * 여러 종목의 현재가를 한 번에 조회한다.
   *
   * 서버는 한 요청당 최대 50종목만 받는다(초과하면 400). 예전에는 보유·관심종목을
   * 통째로 보내서, 51개만 넘어도 일부가 아니라 **전부** 실패해 가격이 하나도
   * 표시되지 않았다. 그래서 50개씩 나눠 보내고 결과를 이어 붙인다.
   * (순서는 요청 순서 그대로 유지되므로 인덱스로 읽는 쪽도 그대로 동작한다)
   */
  getPrices: async (symbols: string[], markets: string[], signal?: AbortSignal): Promise<시세행[]> => {
    if (symbols.length === 0) return [];

    const fetchChunk = (syms: string[], mkts: string[]) =>
      api.get<시세행[]>("/watchlist/prices", {
        params: { symbols: syms.join(","), markets: mkts.join(",") },
        signal,
      }).then((r) => r.data);

    if (symbols.length <= PRICE_CHUNK_SIZE) return fetchChunk(symbols, markets);

    const requests: Promise<시세행[]>[] = [];
    for (let i = 0; i < symbols.length; i += PRICE_CHUNK_SIZE) {
      // 서버가 symbols[i]와 markets[i]를 짝지으므로 같은 구간으로 잘라야 한다
      requests.push(fetchChunk(
        symbols.slice(i, i + PRICE_CHUNK_SIZE),
        markets.slice(i, i + PRICE_CHUNK_SIZE),
      ));
    }
    return (await Promise.all(requests)).flat();
  },

  getItemsWithPrices: (market?: string) =>
    api.get("/watchlist/items/prices", { params: { market } }).then((r) => r.data),

  getWithPrices: (id: number) =>
    api.get(`/watchlist/${id}/prices`).then((r) => r.data),

  // folder_id를 null로 보내면 서버가 "기본 관심목록" 폴더로 자동 편입한다 (watchlist.py add_item)
  addItem: (payload: { symbol: string; market: string; name: string; watchlist_id: number; memo?: string; folder_id?: number | null }) =>
    api.post("/watchlist/items", payload).then((r) => r.data),

  updateItem: (id: number, payload: { name?: string; memo?: string; folder_id?: number }) =>
    api.put(`/watchlist/items/${id}`, payload).then((r) => r.data),

  removeItem: (itemId: number) =>
    api.delete(`/watchlist/items/${itemId}`).then((r) => r.data),

  reorderItems: (order: number[]) =>
    api.put("/watchlist/items/reorder", { order }).then((r) => r.data),
};
