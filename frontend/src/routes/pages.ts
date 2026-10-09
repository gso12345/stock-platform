/**
 * 화면(페이지) 코드를 불러오는 함수 — 한 곳에 모은다.
 *
 * 화면마다 코드를 따로 받는다(lazy). 그런데 받는 시점이 '그 화면으로
 * 옮긴 다음' 이라, 처음 여는 화면은 코드를 받는 왕복이 끝나야 데이터
 * 요청을 시작했다. 메뉴에 손을 대는 순간(미리받기) 받아 두면 그 왕복이
 * 사라진다. 같은 import() 를 두 번 불러도 한 번만 받는다.
 */
export const 화면들 = {
  Dashboard:     () => import("../pages/Dashboard"),
  Screening:     () => import("../pages/Screening"),
  Ipo:           () => import("../pages/Ipo"),
  StockDetail:   () => import("../pages/StockDetail"),
  IndexDetail:   () => import("../pages/IndexDetail"),
  Backtest:      () => import("../pages/Backtest"),
  Watchlist:     () => import("../pages/Watchlist"),
  Strategies:    () => import("../pages/Strategies"),
  Portfolio:     () => import("../pages/Portfolio"),
  News:          () => import("../pages/News"),
  Quant:         () => import("../pages/Quant"),
  Login:         () => import("../pages/Login"),
  Register:      () => import("../pages/Register"),
  OAuthCallback: () => import("../pages/OAuthCallback"),
  Admin:         () => import("../pages/Admin"),
  Terms:         () => import("../pages/Terms"),
  Privacy:       () => import("../pages/Privacy"),
  MyPage:        () => import("../pages/MyPage"),
  Feed:          () => import("../pages/Feed"),
  FeedWrite:     () => import("../pages/FeedWrite"),
  More:          () => import("../pages/More"),
  UserProfile:   () => import("../pages/UserProfile"),
  PostDetail:    () => import("../pages/PostDetail"),
  Notifications: () => import("../pages/Notifications"),
} as const;

/** 메뉴 주소 → 그 화면. 메뉴에 있는 것만 적는다 */
const 주소별: Record<string, keyof typeof 화면들> = {
  "/": "Dashboard",
  "/portfolio": "Portfolio",
  "/watchlist": "Watchlist",
  "/quant": "Quant",
  "/screening": "Screening",
  "/ipo": "Ipo",
  "/backtest": "Backtest",
  "/strategies": "Strategies",
  "/news": "News",
  "/feed": "Feed",
  "/more": "More",
  "/mypage": "MyPage",
  "/notifications": "Notifications",
};

/** 그 주소의 화면 코드를 미리 받아 둔다. 실패해도 조용히 — 옮길 때 다시 받는다 */
export function 화면미리받기(주소: string): void {
  const 이름 = 주소별[주소];
  if (이름) 화면들[이름]().catch(() => {});
}
