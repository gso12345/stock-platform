/**
 * "더보기" 에 들어가는 메뉴.
 *
 * 두 곳에서 쓴다 — /more 화면이 이걸로 목록을 그리고, 하단 탭바는 지금 보는
 * 화면이 이 중 하나인지 보고 "더보기" 탭을 켠다.
 *
 * 한 벌로 둔 이유가 그거다. 예전에는 목록이 Layout 안에만 있었는데, 화면을
 * 따로 내면서 두 벌이 될 뻔했다. 두 벌이면 메뉴를 하나 추가할 때 화면에는
 * 나오는데 탭은 안 켜지는, 알아채기 어려운 어긋남이 생긴다.
 */
import { Star, Search, LineChart, BookMarked } from "lucide-react";

export interface 더보기메뉴 {
  to: string;
  icon: typeof Star;
  label: string;
  설명: string;
}

export const 더보기_메뉴: 더보기메뉴[] = [
  { to: "/watchlist",  icon: Star,       label: "관심종목",   설명: "폴더로 묶어 한눈에" },
  { to: "/screening",  icon: Search,     label: "스크리닝",   설명: "조건으로 종목 걸러내기" },
  { to: "/backtest",   icon: LineChart,  label: "백테스트",   설명: "과거 데이터로 전략 검증" },
  { to: "/strategies", icon: BookMarked, label: "전략저장소", 설명: "저장한 전략 다시 돌리기" },
];

/** 하단 탭의 "더보기" 를 켤지 판단할 경로들. 화면 자체(/more)와, 로그인해야
 *  보이는 것들(내 프로필·알림)까지 포함한다 — 로그인 여부는 여기서 모른다 */
export const 더보기_경로 = [
  "/more",
  ...더보기_메뉴.map((m) => m.to),
  "/mypage",
  "/notifications",
];
