import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { dashboardApi, portfolioApi, watchlistApi } from "@/api/stocks";
import Logo from "./Logo";

const MAX_VISIBLE_MS = 8000; // 일부 항목이 지연돼도 최대 이 시간 후엔 닫힘

/** 앱 진입 시 핵심 데이터(대시보드/뉴스/보유종목/관심종목) 로딩 진행률 표시 */
export default function LoadingProgressOverlay() {
  const { isLoggedIn, userId } = useAuthStore();
  const [visible, setVisible] = useState(true);

  const dashKR = useQuery({ queryKey: ["dashboard-kr", "시가총액"], queryFn: () => dashboardApi.getKR("시가총액"), staleTime: 60_000 });
  const dashUS = useQuery({ queryKey: ["dashboard-us", "시가총액"], queryFn: () => dashboardApi.getUS("시가총액"), staleTime: 60_000 });
  const newsKR = useQuery({ queryKey: ["news", "kr"], queryFn: () => dashboardApi.getNews("kr"), staleTime: 60_000 });
  const newsUS = useQuery({ queryKey: ["news", "us"], queryFn: () => dashboardApi.getNews("us"), staleTime: 60_000 });
  const holdings = useQuery({ queryKey: ["portfolio-items"], queryFn: portfolioApi.getItems, enabled: isLoggedIn, staleTime: 60_000 });
  const watch = useQuery({ queryKey: ["watchlist-items-check", userId], queryFn: () => watchlistApi.getItems(), enabled: isLoggedIn, staleTime: 30_000 });

  const sections = [
    { label: "대시보드 정보", queries: [dashKR, dashUS] },
    { label: "뉴스",         queries: [newsKR, newsUS] },
    ...(isLoggedIn ? [
      { label: "보유종목", queries: [holdings] },
      { label: "관심종목", queries: [watch] },
    ] : []),
  ];

  const allQueries = sections.flatMap((s) => s.queries);
  const total = allQueries.length;
  const done = allQueries.filter((q) => q.isSuccess || q.isError).length;
  const percent = total > 0 ? Math.round((done / total) * 100) : 100;

  // 모든 항목 로딩 완료 시 잠시 후 닫기
  useEffect(() => {
    if (percent >= 100) {
      const t = setTimeout(() => setVisible(false), 400);
      return () => clearTimeout(t);
    }
  }, [percent]);

  // 안전장치: 일부 항목이 계속 지연돼도 최대 시간 후 자동 닫기
  useEffect(() => {
    const t = setTimeout(() => setVisible(false), MAX_VISIBLE_MS);
    return () => clearTimeout(t);
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4 fade-in">
      <div className="w-full max-w-xs bg-bg-card border border-border rounded-2xl shadow-2xl p-6 flex flex-col items-center gap-4">
        <div className="flex items-center gap-2">
          <Logo size={28} />
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-bold text-text-primary tracking-tight">StockPlatform</span>
            <span className="text-2xs font-bold px-1.5 py-0.5 rounded bg-accent-blue/15 text-accent-blue leading-none">BETA</span>
          </div>
        </div>
        <p className="text-xs text-text-muted -mt-1">데이터를 불러오고 있어요</p>

        <div className="w-full">
          <div className="w-full h-2 rounded-full bg-bg-elevated overflow-hidden">
            <div
              className="h-full bg-accent-blue rounded-full transition-all duration-300 ease-out"
              style={{ width: `${percent}%` }}
            />
          </div>
          <div className="mt-1.5 text-right text-2xs font-mono text-text-muted">{percent}%</div>
        </div>

        <div className="w-full flex flex-col gap-1.5">
          {sections.map((s) => {
            const sectionDone = s.queries.every((q) => q.isSuccess || q.isError);
            return (
              <div key={s.label} className="flex items-center justify-between text-2xs">
                <span className="text-text-secondary">{s.label}</span>
                {sectionDone
                  ? <CheckCircle2 size={14} className="text-accent-green" />
                  : <Loader2 size={14} className="text-text-muted animate-spin" />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
