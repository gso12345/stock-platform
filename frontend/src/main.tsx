import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Layout from "./components/Layout";
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
const Login      = lazy(() => import("./pages/Login"));
const Register   = lazy(() => import("./pages/Register"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
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

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Suspense fallback={<div className="flex items-center justify-center h-screen text-text-muted text-sm">로딩 중...</div>}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
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
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
