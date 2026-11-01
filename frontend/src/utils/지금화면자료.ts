/**
 * 당겨서 새로고침이 다시 받을 자료 — 지금 화면이 쓰는 것만.
 *
 * 앱 틀의 불러오기 표시(LoadingProgressOverlay)는 다음에 열 화면을 위해 대시보드·뉴스·내 자산·관심종목을 늘
 * 지켜본다. 떠 있는 자료를 모두(type: active) 다시 받았더니 공모주 화면에서 한 번 당겨도 그 여섯 건까지 서버에
 * 다시 물었다(실제 브라우저에서 11건). 미리 받기만 지켜보는 자료는 뺀다 — 지금 화면도 같이 쓰면(대시보드에서
 * 당기면 대시보드 자료) 지켜보는 쪽이 둘 이상이라 그대로 다시 받는다.
 */
import { hashKey, type Query } from "@tanstack/react-query";
import { 미리받는열쇠 } from "@/constants/미리받기열쇠";
import { 보유목록열쇠 } from "@/hooks/usePortfolioItems";
import { 관심목록열쇠 } from "@/hooks/useWatchlistItems";

/** 처음 쓸 때 만든다 — 불러올 때 만들면 이 파일을 불러오는 것만으로 두 훅의 열쇠를 읽어야 한다 */
let 미리받기: Set<string> | null = null;
function 미리받는것들(): Set<string> {
  if (!미리받기) {
    미리받기 = new Set(
      [...Object.values(미리받는열쇠), 보유목록열쇠, 관심목록열쇠].map((k) => hashKey(k as readonly unknown[])),
    );
  }
  return 미리받기;
}

/** refetchQueries 의 predicate — 미리 받기 하나만 지켜보는 자료면 false */
export function 지금화면자료(q: Query): boolean {
  return !(미리받는것들().has(q.queryHash) && q.getObserversCount() <= 1);
}
