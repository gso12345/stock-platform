import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./api/queryClient";
import Layout from "./components/Layout";
import ErrorBoundary from "./components/common/ErrorBoundary";
import SplashScreen from "./components/SplashScreen";
import BootScreen from "./components/BootScreen";
import QueryErrorToast from "./components/common/QueryErrorToast";
import { dashboardApi } from "./api/stocks";
import { 화면들 } from "./routes/pages";
import { 한가할때 } from "./utils/한가할때";
import { 오류받기_시작 } from "./utils/오류보내기";
import "./index.css";

/* 아무 데서도 안 잡힌 오류를 줍는다. ErrorBoundary 는 화면을 그리다
   터진 것만 잡고, 이벤트 처리기나 약속(Promise) 안에서 터진 것은
   콘솔에만 남는다 — 사용자에게는 "눌러도 아무 일이 안 일어남" 이다. */
오류받기_시작();

/* 화면 코드를 불러오는 함수는 routes/pages 한 곳에 있다 — 메뉴에 손을 대는
   순간 같은 함수로 미리 받아 둘 수 있게(Layout) */
const Dashboard = lazy(화면들.Dashboard);
const Screening = lazy(화면들.Screening);
const StockDetail = lazy(화면들.StockDetail);
const IndexDetail = lazy(화면들.IndexDetail);
const Backtest = lazy(화면들.Backtest);
const Watchlist = lazy(화면들.Watchlist);
const Strategies = lazy(화면들.Strategies);
const Portfolio = lazy(화면들.Portfolio);
const News = lazy(화면들.News);
const Quant = lazy(화면들.Quant);
const Login = lazy(화면들.Login);
const Register = lazy(화면들.Register);
const OAuthCallback = lazy(화면들.OAuthCallback);
const Admin = lazy(화면들.Admin);
const Terms = lazy(화면들.Terms);
const Privacy = lazy(화면들.Privacy);
const MyPage = lazy(화면들.MyPage);
const Feed = lazy(화면들.Feed);
const FeedWrite = lazy(화면들.FeedWrite);
const More = lazy(화면들.More);
const UserProfile = lazy(화면들.UserProfile);
const PostDetail = lazy(화면들.PostDetail);
const Notifications = lazy(화면들.Notifications);

// queryClient 는 api/queryClient 로 옮겼다 — 로그인·로그아웃 때
// 화면 밖(authStore)에서도 비울 수 있어야 하기 때문이다

// 대시보드 핵심 데이터만 선제 요청
function 대시보드_선제요청() {
  queryClient.prefetchQuery({
    queryKey: ["dashboard-kr", "시가총액"],
    queryFn: () => dashboardApi.getKR(),
    staleTime: 60_000,
  });
  queryClient.prefetchQuery({
    queryKey: ["dashboard-us", "시가총액"],
    queryFn: () => dashboardApi.getUS(),
    staleTime: 60_000,
  });
  // 환율/금리 — 대시보드 KR/US 탭 + 포트폴리오에서 공통 사용
  queryClient.prefetchQuery({
    queryKey: ["dashboard-us-rates"],
    queryFn: () => dashboardApi.getUSRates(),
    staleTime: 300_000,
  });
}
/* 대시보드로 들어올 때만 곧바로 보낸다. 공유받은 종목 링크처럼 다른 화면으로
   들어온 사람에게는 이 세 건이 그 화면의 요청과 0.15 CPU 서버를 다툰다 —
   그 화면이 먼저 받고, 한가해지면 보낸다(대시보드로 옮길 때 곧바로 뜨게). */
if (window.location.pathname === "/") 대시보드_선제요청();
else 한가할때(대시보드_선제요청, 4_000);
// 서버를 깨우려고 /health 를 한 번 두드리던 자리다. Render 무료 플랜이
// 자고 있을 때 첫 요청을 도달시키려는 것이었는데, 그 잠듦이 없어졌다.
// 남겨 두면 얻는 것 없이 손해만 남는다 — 바로 위 prefetch 세 건과
// 같은 순간에 요청이 하나 더 나가서, 정작 화면에 필요한 값들이
// 그만큼 뒤로 밀린다.
//
// 다시 재우는 요금제로 돌아가면 이 자리를 되살린다.

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

/** 화면을 그리다 터지면 흰 화면 대신 되돌아갈 길을 보여 준다.
 *
 *  주소가 바뀌면 지난 오류를 놓아 준다 — 한 화면이 망가졌다고 해서 다른
 *  화면까지 못 열게 할 이유가 없다. 그래서 라우터 안에 둔다(useLocation). */
function 화면오류그물({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  return <ErrorBoundary resetKey={pathname}>{children}</ErrorBoundary>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SplashScreen />
    <QueryClientProvider client={queryClient}>
      {/* 조회가 실패하면 여기서 알린다. 앱 전체에 하나만 둔다 —
          화면마다 두면 화면을 옮길 때 알림이 사라지거나 겹친다 */}
      <QueryErrorToast />
      <BrowserRouter>
        <화면오류그물>
        {/* "로딩 중..." 다섯 글자만 있었다. 서버가 자고 있으면 20~45초가
            걸리는데 그동안 아무 설명이 없어서 고장난 줄 알기 쉬웠다 */}
        <Suspense fallback={<BootScreen />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/oauth/callback" element={<OAuthCallback />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/" element={<Layout />}>
              <Route index element={<Dashboard />} />
              <Route path="screening" element={<Screening />} />
              <Route path="stocks/:market/:symbol" element={<StockDetail />} />
              <Route path="stocks/:market/:symbol/*" element={<StockDetail />} />
              <Route path="index/:name" element={<IndexDetail />} />
              <Route path="backtest" element={<Backtest />} />
              <Route path="watchlist" element={<Watchlist />} />
              <Route path="strategies" element={<Strategies />} />
              <Route path="portfolio" element={<Portfolio />} />
              <Route path="news" element={<News />} />
              <Route path="quant" element={<Quant />} />
              <Route path="admin" element={<Admin />} />
              <Route path="mypage" element={<MyPage />} />
              <Route path="feed" element={<Feed />} />
              <Route path="feed/write" element={<FeedWrite />} />
              <Route path="profile/:userId" element={<UserProfile />} />
              <Route path="post/:postId" element={<PostDetail />} />
              <Route path="notifications" element={<Notifications />} />
              <Route path="more" element={<More />} />
            </Route>
          </Routes>
        </Suspense>
        </화면오류그물>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
