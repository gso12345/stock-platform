/**
 * 브라우저가 한가할 때 한다. 급하지 않은 미리받기용.
 *
 * 사파리에는 requestIdleCallback 이 없다(아이폰이 전부 그렇다) — 그때는
 * 잠깐 미뤘다가 한다. 돌려주는 함수를 부르면 취소된다.
 */
export function 한가할때(할일: () => void, 최대ms = 3_000): () => void {
  const w = window as Window & {
    requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (typeof w.requestIdleCallback === "function") {
    const id = w.requestIdleCallback(할일, { timeout: 최대ms });
    return () => w.cancelIdleCallback?.(id);
  }
  const t = window.setTimeout(할일, Math.min(최대ms, 1_500));
  return () => window.clearTimeout(t);
}

/** 데이터를 아껴 쓰는 중이거나 느린 망이면 미리받기를 하지 않는다 */
export function 아껴쓰는중(): boolean {
  const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return !!c && (c.saveData === true || /(^|-)2g$/.test(c.effectiveType ?? ""));
}
