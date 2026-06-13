import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Newspaper, ExternalLink, Sparkles } from "lucide-react";
import { dashboardApi } from "@/api/stocks";

type MarketTab = "kr" | "us";

export default function News() {
  const [market, setMarket] = useState<MarketTab>("kr");

  const { data: news, isLoading: loadingNews } = useQuery({
    queryKey: ["news", market],
    queryFn: () => dashboardApi.getNews(market),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const { data: summaryData, isLoading: loadingSummary } = useQuery({
    queryKey: ["news-summary", market],
    queryFn: () => dashboardApi.getNewsSummary(market),
    staleTime: 1_800_000,
    retry: 0,
  });

  return (
    <div className="flex flex-col gap-5 max-w-3xl mx-auto">
      {/* 헤더 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">뉴스</h1>
          <p className="text-text-muted text-xs mt-0.5">국내·미국 증시 주요 뉴스와 AI 요약</p>
        </div>
        <div className="flex gap-1 p-1 rounded-xl border border-border bg-bg-card">
          {(["kr", "us"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMarket(m)}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                market === m ? "bg-accent-blue text-white shadow" : "text-text-muted hover:text-text-primary"
              }`}
            >
              {m === "kr" ? "국내" : "미국"}
            </button>
          ))}
        </div>
      </div>

      {/* AI 요약 */}
      <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Sparkles size={14} className="text-accent-blue" />
          <span className="text-sm font-semibold text-text-primary">AI 요약</span>
        </div>
        <div className="p-4">
          {loadingSummary ? (
            <div className="flex justify-center py-4">
              <div className="w-5 h-5 border-2 border-accent-blue border-t-transparent rounded-full animate-spin" />
            </div>
          ) : summaryData?.available && summaryData.summary ? (
            <div className="text-sm text-text-secondary whitespace-pre-line leading-relaxed">
              {summaryData.summary}
            </div>
          ) : (
            <p className="text-xs text-text-muted">AI 요약 기능을 현재 사용할 수 없습니다.</p>
          )}
        </div>
      </div>

      {/* 뉴스 목록 */}
      <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Newspaper size={14} className="text-text-muted" />
          <span className="text-sm font-semibold text-text-primary">
            {market === "kr" ? "국내" : "미국"} 증시 뉴스
          </span>
        </div>
        {loadingNews ? (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 border-2 border-accent-blue border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (news?.length ?? 0) > 0 ? (
          <ul>
            {news!.map((item: any, i: number) => (
              <li key={i} className="border-b border-border/30 last:border-0">
                <a
                  href={item.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-3 px-4 py-3 hover:bg-bg-hover transition-colors group"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-text-primary group-hover:text-accent-blue transition-colors line-clamp-2">
                      {item.title}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      {item.source && <span className="text-2xs text-accent-blue/70 font-medium">{item.source}</span>}
                      {item.published && <span className="text-2xs text-text-muted">{item.published}</span>}
                    </div>
                    {item.summary && <p className="text-xs text-text-muted mt-1 line-clamp-2">{item.summary}</p>}
                  </div>
                  <ExternalLink size={12} className="text-text-muted flex-shrink-0 mt-1" />
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-8 text-center text-text-muted text-sm">뉴스 데이터가 없습니다</p>
        )}
      </div>
    </div>
  );
}
