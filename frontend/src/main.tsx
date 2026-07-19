import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Layout from "./components/Layout";
import SplashScreen from "./components/SplashScreen";
import { dashboardApi } from "./api/stocks";
import "./index.css";

const Dashboard  = lazy(() => import("./pages/Dashboard"));
const Screening  = lazy(() => import("./pages/Screening"));
const StockDetail = lazy(() => import("./pages/StockDetail"));
const IndexDetail = lazy(() => import("./pages/IndexDetail"));
const Backtest   = lazy(() => import("./pages/Backtest"));
const Watchlist  = lazy(() => import("./pages/Watchlist"));
const Strategies = lazy(() => import("./pages/Strategies"));
const Portfolio  = lazy(() => import("./pages/Portfolio"));
const News       = lazy(() => import("./pages/News"));
const Quant      = lazy(() => import("./pages/Quant"));
const Login      = lazy(() => import("./pages/Login"));
const Register   = lazy(() => import("./pages/Register"));
const OAuthCallback = lazy(() => import("./pages/OAuthCallback"));
const Admin = lazy(() => import("./pages/Admin"));
const Terms = lazy(() => import("./pages/Terms"));
const Privacy = lazy(() => import("./pages/Privacy"));
const MyPage = lazy(() => import("./pages/MyPage"));
const Feed   = lazy(() => import("./pages/Feed"));
const UserProfile = lazy(() => import("./pages/UserProfile"));
const PostDetail  = lazy(() => import("./pages/PostDetail"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 300_000,
      gcTime: 1_800_000,
      refetchOnWindowFocus: false,
      // Render 무료 플랜 슬립(20~45s) 대응: 3회 재시도, 지수 백오프(2s→6s→18s)
      retry: 3,
      retryDelay: (attempt) => Math.min(2_000 * 3 ** attempt, 20_000),
    },
  },
});

// 대시보드 핵심 데이터만 선제 요청
queryClient.prefetchQuery({
  queryKey: ["dashboard-kr", "시가총액"],
  queryFn: () => dashboardApi.getKR("시가총액"),
  staleTime: 60_000,
});
queryClient.prefetchQuery({
  queryKey: ["dashboard-us", "시가총액"],
  queryFn: () => dashboardApi.getUS("시가총액"),
  staleTime: 60_000,
});
// 환율/금리 — 대시보드 KR/US 탭 + 포트폴리오에서 공통 사용
queryClient.prefetchQuery({
  queryKey: ["dashboard-us-rates"],
  queryFn: () => dashboardApi.getUSRates(),
  staleTime: 300_000,
});
// Render 무료 플랜 슬립 대응: 앱 시작 시 Authorization 없이 단순 GET 전송.
// 단순 요청(커스텀 헤더 없음)은 CORS preflight 없이 바로 전달되므로
// 서버가 슬립 상태여도 요청이 도달해 웨이크업을 트리거한다.
{
  const apiRoot = import.meta.env.VITE_API_URL || "";
  fetch(`${apiRoot}/api/v1/dashboard/indices`).catch(() => {});
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SplashScreen />
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Suspense fallback={<div className="flex items-center justify-center h-screen text-text-muted text-sm">로딩 중...</div>}>
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
              <Route path="profile/:userId" element={<UserProfile />} />
              <Route path="post/:postId" element={<PostDetail />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
