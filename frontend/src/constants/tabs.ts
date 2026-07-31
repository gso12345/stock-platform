import { Wallet, Star } from "lucide-react";
import type { TabItem } from "@/components/ui";

/** '내 자산 ↔ 관심종목' 상단 탭.
 *
 * 두 페이지(포트폴리오·관심종목)가 서로를 오가는 같은 줄이라, 라벨이나
 * 순서가 한쪽만 바뀌면 화면이 어긋난다. 그래서 목록을 여기 한 곳에 둔다. */
export const ASSET_PAGE_TABS: TabItem[] = [
  { id: "portfolio", label: "내 자산",  icon: Wallet },
  { id: "watchlist", label: "관심종목", icon: Star   },
];
