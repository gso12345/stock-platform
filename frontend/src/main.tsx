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
const Login      = lazy(() => import("./pages/Login"));
const Register   = lazy(() => import("./pages/Register"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

// 대시보드 데이터를 컴포넌트 마운트 전에 미리 요청 (초기 로딩 단축)
queryClient.prefetchQuery({
  queryKey: ["dashboard-kr", "시가총액"],
  queryFn: () => dashboardApi.getKR("시가총액"),
  staleTime: 30_000,
});
queryClient.prefetchQuery({
  queryKey: ["dashboard-news-kr"],
  queryFn: () => dashboardApi.getNews("kr"),
  staleTime: 300_000,
});

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
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
