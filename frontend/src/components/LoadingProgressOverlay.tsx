import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { dashboardApi, portfolioApi, watchlistApi } from "@/api/stocks";
import Logo from "./Logo";

/** 앱 진입 시 핵심 데이터(대시보드/뉴스/보유종목/관심종목) 로딩 진행률을 화면을 가리지 않는 작은 위젯으로 표시 */
export default function LoadingProgressOverlay() {
  const { isLoggedIn, userId } = useAuthStore();
  const [closed, setClosed] = useState(false);

  const dashKR = useQuery({ queryKey: ["dashboard-kr", "시가총액"], queryFn: () => dashboardApi.getKR("시가총액"), staleTime: 60_000 });
  const dashUS = useQuery({ queryKey: ["dashboard-us", "시가총액"], queryFn: () => dashboardApi.getUS("시가총액"), staleTime: 60_000 });
  const newsKR = useQuery({ queryKey: ["news", "kr"], queryFn: () => dashboardApi.getNews("kr"), staleTime: 60_000 });
  const newsUS = useQuery({ queryKey: ["news", "us"], queryFn: () => dashboardApi.getNews("us"), staleTime: 60_000 });
  const holdings = useQuery({ queryKey: ["portfolio-items-check", userId], queryFn: () => portfolioApi.getItems(), enabled: isLoggedIn, staleTime: 60_000 });
  const watch = useQuery({ queryKey: ["watchlist-items-check", userId], queryFn: () => watchlistApi.getItems(), enabled: isLoggedIn, staleTime: 30_000 });

  const allQueries = [dashKR, dashUS, newsKR, newsUS, ...(isLoggedIn ? [holdings, watch] : [])];
  const total = allQueries.length;
  const done = allQueries.filter((q) => q.isSuccess || q.isError).length;
  const percent = total > 0 ? Math.round((done / total) * 100) : 100;

  if (closed || percent >= 100) return null;

  return (
    <div className="fixed right-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] lg:bottom-4 z-[150] w-48 bg-bg-card border border-border rounded-xl shadow-2xl p-2.5 flex flex-col gap-1.5 fade-in">
      <div className="flex items-center gap-1.5">
        <Logo size={18} />
        <span className="text-2xs font-semibold text-text-secondary flex-1 truncate">데이터 불러오는 중…</span>
        <button
          onClick={() => setClosed(true)}
          aria-label="닫기"
          className="p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors"
        >
          <X size={12} />
        </button>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full bg-bg-elevated overflow-hidden">
          <div
            className="h-full bg-accent-blue rounded-full transition-all duration-300 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>
        <span className="text-2xs font-mono text-text-muted">{percent}%</span>
      </div>
    </div>
  );
}
