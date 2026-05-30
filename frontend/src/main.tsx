import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Screening from "./pages/Screening";
import StockDetail from "./pages/StockDetail";
import IndexDetail from "./pages/IndexDetail";
import Backtest from "./pages/Backtest";
import Watchlist from "./pages/Watchlist";
import Strategies from "./pages/Strategies";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
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
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
