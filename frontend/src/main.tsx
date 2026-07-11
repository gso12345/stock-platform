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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 자주 바뀌지 않는 데이터(폴더 목록, 관심종목 목록 등)는 5분간 캐시
      // 가격 등 실시간 데이터는 각 useQuery에서 낮은 staleTime을 명시적으로 재정의
      staleTime: 300_000,
      gcTime: 1_800_000,
      refetchOnWindowFocus: false,
      retry: 1,
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
// 뉴스 탭 선제 프리페치 — 진입 시 즉시 표시되도록
// staleTime을 Dashboard.tsx의 600_000ms와 동일하게 맞춰 불필요한 재요청 방지
queryClient.prefetchQuery({
  queryKey: ["news", "kr"],
  queryFn: () => dashboardApi.getNews("kr"),
  staleTime: 600_000,
});
queryClient.prefetchQuery({
  queryKey: ["news", "us"],
  queryFn: () => dashboardApi.getNews("us"),
  staleTime: 600_000,
});

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
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
