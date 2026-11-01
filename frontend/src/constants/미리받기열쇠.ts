/**
 * 앱 틀이 다음 화면을 위해 미리 받아 두는 자료의 열쇠 — 불러오기 표시(LoadingProgressOverlay)가 이것으로 받고,
 * 당겨서 새로고침(utils/지금화면자료)은 이것만 지켜보는 자료를 다시 묻지 않는다. 내 자산·관심종목 목록도
 * 미리 받지만 그 열쇠는 각자의 훅(hooks/usePortfolioItems·useWatchlistItems)에 있다.
 */
export const 미리받는열쇠 = {
  국내대시보드: ["dashboard-kr", "시가총액"],
  해외대시보드: ["dashboard-us", "시가총액"],
  국내뉴스: ["news", "kr", "latest"],
  해외뉴스: ["news", "us", "latest"],
} as const;
