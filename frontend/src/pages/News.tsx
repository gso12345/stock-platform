import { useState, memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Newspaper, RefreshCw } from "lucide-react";
import { dashboardApi } from "@/api/stocks";
import { Card, InlineSpinner, Tabs, 빈화면 } from "@/components/ui";
import { fmtNewsDateTime } from "@/utils/formatters";

type MarketTab = "kr" | "us";
type SortTab = "latest" | "popular";

const THUMB = 80;   // 썸네일 한 변(px) — 이미지 로드 전에도 자리를 잡아두기 위해 명시한다

/**
 * 외부 링크는 서버에서 http/https만 통과시키지만, 화면에서도 한 번 더 확인한다.
 * 캐시에 남아 있던 예전 데이터나 다른 경로로 들어온 값이 그대로 렌더되는 걸 막는다.
 */
function safeHref(url: unknown): string | undefined {
  if (typeof url !== "string") return undefined;
  const cleaned = url.replace(/[\s\u0000-\u001f]/g, "");
  // "//img.example.com/a.jpg" 는 스킴만 생략한 정상 외부 주소다 (RSS에 흔하다).
  // 브라우저가 https://img.example.com/... 으로 해석하므로 살려 쓴다.
  if (cleaned.startsWith("//")) return "https:" + url.trim();
  return /^https?:\/\//i.test(cleaned) ? url : undefined;
}

const NewsItem = memo(function NewsItem({ item }: { item: any }) {
  const [imgError, setImgError] = useState(false);
  const href = safeHref(item.link);
  const imgSrc = safeHref(item.image);
  const showImage = !!imgSrc && !imgError;

  return (
    <li className="border-b border-border/30 last:border-0">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="flex items-start gap-3 px-4 py-3 hover:bg-bg-hover transition-colors group"
      >
        {showImage ? (
          <img
            src={imgSrc}
            alt=""
            loading="lazy"
            decoding="async"
            /* 이미지가 도착하기 전에도 자리를 차지하도록 크기를 알려준다.
               없으면 이미지가 하나씩 뜰 때마다 아래 기사가 밀려 내려간다 */
            width={THUMB}
            height={THUMB}
            /* 우리 사이트 주소가 언론사 서버로 전달되지 않게 한다 */
            referrerPolicy="no-referrer"
            className="w-20 h-20 rounded-lg object-cover flex-shrink-0 bg-bg-elevated"
            onError={() => setImgError(true)}
          />
        ) : (
          <div
            style={{ width: THUMB, height: THUMB }}
            className="rounded-lg flex-shrink-0 bg-bg-elevated flex items-center justify-center"
          >
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
});

const PAGE_SIZE = 20;

export default function News() {
  const [market, setMarket] = useState<MarketTab>("kr");
  const [sort, setSort] = useState<SortTab>("latest");
  const [shownCount, setShownCount] = useState(PAGE_SIZE);

  const { data: news, isLoading: loadingNews, refetch: refetchNews, isFetching: fetchingNews } = useQuery({
    queryKey: ["news", market, sort],
    queryFn: () => dashboardApi.getNews(market, sort),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  // 정렬·이미지 필터는 모두 서버가 처리한다 (인기도 산식을 노출하지 않기 위해)
  const sorted = news ?? [];

  const shown = sorted.slice(0, shownCount);
  const remaining = sorted.length - shown.length;

  const switchMarket = (m: MarketTab) => { setMarket(m); setShownCount(PAGE_SIZE); };
  const switchSort   = (s: SortTab)   => { setSort(s);   setShownCount(PAGE_SIZE); };

  return (
    <div className="flex flex-col gap-5 max-w-3xl mx-auto pb-20">
      {/* 헤더 — 좁은 화면에서는 제목과 버튼을 세로로 쌓는다 (다른 화면과 동일) */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-text-primary whitespace-nowrap">뉴스</h1>
          <p className="text-text-muted text-xs mt-0.5 truncate">국내·미국 증시 주요 뉴스</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap sm:justify-end">
          <Tabs
            fill={false}
            ariaLabel="시장 선택"
            tabs={[{ id: "kr", label: "국내" }, { id: "us", label: "미국" }]}
            active={market}
            onChange={(id) => switchMarket(id as "kr" | "us")}
          />
          <button
            onClick={() => refetchNews()}
            disabled={fetchingNews}
            className="p-2 rounded-xl border border-border bg-bg-card text-text-muted hover:text-accent-blue hover:border-accent-blue/40 transition-all disabled:opacity-50"
            title="뉴스 업데이트"
            aria-label="뉴스 업데이트"
          >
            <RefreshCw size={14} className={fetchingNews ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* 뉴스 목록 */}
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Newspaper size={14} className="text-text-muted flex-shrink-0" />
            <span className="text-sm font-semibold text-text-primary truncate">
              {market === "kr" ? "국내" : "미국"} 증시 뉴스
            </span>
            {sorted.length > 0 && (
              <span className="text-xs text-text-muted bg-bg-secondary px-2 py-0.5 rounded-full flex-shrink-0">
                {sorted.length}
              </span>
            )}
          </div>
          <div className="flex gap-1 flex-shrink-0">
            {(["latest", "popular"] as const).map((s) => (
              <button
                key={s}
                onClick={() => switchSort(s)}
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
            <InlineSpinner className="w-6 h-6" />
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
          <빈화면
            icon={Newspaper}
            title="표시할 뉴스가 없어요"
            hint="언론사에서 기사를 받아오는 중일 수 있습니다. 잠시 후 다시 확인해 주세요."
          />
        )}
      </Card>
    </div>
  );
}