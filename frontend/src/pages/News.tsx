import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Newspaper, RefreshCw } from "lucide-react";
import { dashboardApi } from "@/api/stocks";
import { fmtNewsDateTime, newsTimestampMs } from "@/utils/formatters";

type MarketTab = "kr" | "us";
type SortTab = "latest" | "popular";

function NewsItem({ item }: { item: any }) {
  const [imgError, setImgError] = useState(false);
  const showImage = item.image && !imgError;

  return (
    <li className="border-b border-border/30 last:border-0">
      <a
        href={item.link}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-start gap-3 px-4 py-3 hover:bg-bg-hover transition-colors group"
      >
        {showImage ? (
          <img
            src={item.image}
            alt=""
            loading="lazy"
            className="w-20 h-20 rounded-lg object-cover flex-shrink-0 bg-bg-elevated"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-20 h-20 rounded-lg flex-shrink-0 bg-bg-elevated flex items-center justify-center">
            <Newspaper size={22} className="text-text-muted" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-text-primary group-hover:text-accent-blue transition-colors line-clamp-2">
            {item.title}
          </p>
          {item.summary && <p className="text-xs text-text-muted mt-1 line-clamp-2">{item.summary}</p>}
          <div className="flex items-center gap-1.5 mt-1.5 text-2xs text-text-muted">
            {item.published && <span>{fmtNewsDateTime(item.published)}</span>}
            {item.published && item.source && <span>·</span>}
            {item.source && <span>{item.source}</span>}
          </div>
        </div>
      </a>
    </li>
  );
}

const PAGE_SIZE = 20;

export default function News() {
  const [market, setMarket] = useState<MarketTab>("kr");
  const [sort, setSort] = useState<SortTab>("latest");
  const [shownCount, setShownCount] = useState(PAGE_SIZE);

  const { data: news, isLoading: loadingNews, refetch: refetchNews, isFetching: fetchingNews } = useQuery({
    queryKey: ["news", market],
    queryFn: () => dashboardApi.getNews(market),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  // 최신순: published_ts(unix seconds) 우선, 없으면 문자열 파싱
  // 인기순: 트렌드 점수 기준 정렬
  const getTs = (item: any): number =>
    item.published_ts != null ? item.published_ts : newsTimestampMs(item.published) / 1000;

  const sorted = useMemo(() => {
    const base = sort === "popular"
      ? [...(news ?? [])].sort((a: any, b: any) => (b._trend_score ?? 0) - (a._trend_score ?? 0))
      : [...(news ?? [])].sort((a: any, b: any) => getTs(b) - getTs(a));
    return market === "kr" ? base.filter((item: any) => item.image) : base;
  }, [news, sort, market]);

  const shown = sorted.slice(0, shownCount);
  const remaining = sorted.length - shown.length;

  return (
    <div className="flex flex-col gap-5 max-w-3xl mx-auto">
      {/* 헤더 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">뉴스</h1>
          <p className="text-text-muted text-xs mt-0.5">국내·미국 증시 주요 뉴스</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 p-1 rounded-xl border border-border bg-bg-card">
            {(["kr", "us"] as const).map((m) => (
              <button
                key={m}
                onClick={() => { setMarket(m); setShownCount(PAGE_SIZE); }}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  market === m ? "bg-accent-blue text-white shadow" : "text-text-muted hover:text-text-primary"
                }`}
              >
                {m === "kr" ? "국내" : "미국"}
              </button>
            ))}
          </div>
          <button
            onClick={() => refetchNews()}
            disabled={fetchingNews}
            className="p-2 rounded-xl border border-border bg-bg-card text-text-muted hover:text-accent-blue hover:border-accent-blue/40 transition-all disabled:opacity-50"
            title="뉴스 업데이트"
          >
            <RefreshCw size={14} className={fetchingNews ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* 뉴스 목록 */}
      <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Newspaper size={14} className="text-text-muted" />
            <span className="text-sm font-semibold text-text-primary">
              {market === "kr" ? "국내" : "미국"} 증시 뉴스
            </span>
          </div>
          <div className="flex gap-1">
            {(["latest", "popular"] as const).map((s) => (
              <button
                key={s}
                onClick={() => { setSort(s); setShownCount(PAGE_SIZE); }}
                className={`px-2 py-0.5 text-2xs rounded font-semibold transition-all ${
                  sort === s ? "bg-accent-blue text-white" : "text-text-muted hover:text-text-primary"
                }`}
              >
                {s === "latest" ? "최신순" : "인기순"}
              </button>
            ))}
          </div>
        </div>

        {loadingNews ? (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 border-2 border-accent-blue border-t-transparent rounded-full animate-spin" />
          </div>
        ) : sorted.length > 0 ? (
          <>
            <ul>
              {shown.map((item: any, i: number) => (
                <NewsItem key={item.link || i} item={item} />
              ))}
            </ul>
            {remaining > 0 && (
              <button
                onClick={() => setShownCount((c) => c + PAGE_SIZE)}
                className="w-full py-2.5 text-xs font-semibold text-text-muted hover:text-accent-blue hover:bg-bg-elevated transition-all border-t border-border"
              >
                {`더보기 (${remaining}건 더) ▼`}
              </button>
            )}
          </>
        ) : (
          <p className="py-8 text-center text-text-muted text-sm">뉴스 데이터가 없습니다</p>
        )}
      </div>
    </div>
  );
}
