import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Newspaper } from "lucide-react";
import { dashboardApi } from "@/api/stocks";

type MarketTab = "kr" | "us";
type SortTab = "latest" | "popular";

/** "MM/DD HH:MM" (KST) 문자열 → Date */
function parseKstDate(published: string): Date | null {
  const m = published.match(/^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{1,2})$/);
  if (!m) return null;
  const month = parseInt(m[1], 10);
  const day = parseInt(m[2], 10);
  const hour = parseInt(m[3], 10);
  const minute = parseInt(m[4], 10);

  const nowKst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  let year = nowKst.getUTCFullYear();
  // 12월 기사인데 현재가 1월이면 작년 기사
  if (month === 12 && nowKst.getUTCMonth() === 0) year -= 1;

  return new Date(Date.UTC(year, month - 1, day, hour, minute) - 9 * 60 * 60 * 1000);
}

/** 상대 시간 표시 ("N분 전" / "N시간 전" / "N일 전") */
function formatRelative(published: string): string {
  const date = parseKstDate(published);
  if (!date) return published;
  const diffMin = Math.floor((Date.now() - date.getTime()) / 60000);
  if (diffMin < 1) return "방금 전";
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay}일 전`;
  return published;
}

/** 날짜 그룹 헤더 ("오늘" / "어제" / "M월 D일") */
function dateGroupLabel(published: string): string {
  const date = parseKstDate(published);
  if (!date) return "";
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const nowKst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const key = (d: Date) => `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
  if (key(kst) === key(nowKst)) return "오늘";
  const yesterday = new Date(nowKst.getTime() - 24 * 60 * 60 * 1000);
  if (key(kst) === key(yesterday)) return "어제";
  return `${kst.getUTCMonth() + 1}월 ${kst.getUTCDate()}일`;
}

function NewsItem({ item }: { item: any }) {
  return (
    <li className="border-b border-border/30 last:border-0">
      <a
        href={item.link}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-start gap-3 px-4 py-3 hover:bg-bg-hover transition-colors group"
      >
        {item.image && (
          <img
            src={item.image}
            alt=""
            loading="lazy"
            className="w-20 h-20 rounded-lg object-cover flex-shrink-0 bg-bg-elevated"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-text-primary group-hover:text-accent-blue transition-colors line-clamp-2">
            {item.title}
          </p>
          {item.summary && <p className="text-xs text-text-muted mt-1 line-clamp-2">{item.summary}</p>}
          <div className="flex items-center gap-1.5 mt-1.5 text-2xs text-text-muted">
            {item.published && <span>{formatRelative(item.published)}</span>}
            {item.published && item.source && <span>·</span>}
            {item.source && <span>{item.source}</span>}
          </div>
        </div>
      </a>
    </li>
  );
}

export default function News() {
  const [market, setMarket] = useState<MarketTab>("kr");
  const [sort, setSort] = useState<SortTab>("latest");

  const { data: news, isLoading: loadingNews } = useQuery({
    queryKey: ["news", market],
    queryFn: () => dashboardApi.getNews(market),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const sorted = [...(news ?? [])].sort((a: any, b: any) =>
    sort === "popular"
      ? (b._trend_score ?? 0) - (a._trend_score ?? 0)
      : String(b.published ?? "").localeCompare(String(a.published ?? ""))
  );

  // 최신순일 때 날짜별 그룹화 ("오늘" / "어제" / "M월 D일")
  const groups: { label: string; items: any[] }[] = [];
  if (sort === "latest") {
    for (const item of sorted) {
      const label = item.published ? dateGroupLabel(item.published) : "";
      const last = groups[groups.length - 1];
      if (last && last.label === label) {
        last.items.push(item);
      } else {
        groups.push({ label, items: [item] });
      }
    }
  }

  return (
    <div className="flex flex-col gap-5 max-w-3xl mx-auto">
      {/* 헤더 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">뉴스</h1>
          <p className="text-text-muted text-xs mt-0.5">국내·미국 증시 주요 뉴스</p>
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
                onClick={() => setSort(s)}
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
          sort === "latest" ? (
            groups.map((group, gi) => (
              <div key={gi}>
                {group.label && (
                  <div className="px-4 py-2 bg-bg-elevated/50 text-2xs font-semibold text-text-muted">
                    {group.label}
                  </div>
                )}
                <ul>
                  {group.items.map((item: any, i: number) => (
                    <NewsItem key={i} item={item} />
                  ))}
                </ul>
              </div>
            ))
          ) : (
            <ul>
              {sorted.map((item: any, i: number) => (
                <NewsItem key={i} item={item} />
              ))}
            </ul>
          )
        ) : (
          <p className="py-8 text-center text-text-muted text-sm">뉴스 데이터가 없습니다</p>
        )}
      </div>
    </div>
  );
}
