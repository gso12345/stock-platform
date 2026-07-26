import { useState, useCallback, useMemo, memo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { dashboardApi } from "@/api/stocks";
import { Card, ChangeBadge } from "@/components/ui";
import { useSettingsStore } from "@/store/settingsStore";
import { useIndicesStream } from "@/hooks/useWebSocket";
import { isUsdKrwRow } from "@/hooks/useExchangeRate";
import { safeExternalUrl } from "@/utils/url";
import { TrendingUp, TrendingDown, Newspaper, Globe, Flag, ExternalLink, ChevronRight, RefreshCw } from "lucide-react";
import { fmtNewsDateTime } from "@/utils/formatters";

/* ── 지수 카드 ───────────────────────────────────────────── */
const IndexCard = memo(function IndexCard({ name, value, change_rate, onClick, colorScheme }: any) {
  const pos = (change_rate ?? 0) >= 0;
  const upColor   = colorScheme === "red-blue" ? "text-accent-red"  : "text-accent-green";
  const downColor = colorScheme === "red-blue" ? "text-accent-blue" : "text-accent-red";
  return (
    <Card
      className="flex flex-col gap-1 min-w-[145px] cursor-pointer group"
      onClick={onClick}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="text-2xs text-text-muted font-semibold uppercase tracking-wide truncate">{name}</span>
        <div className="flex items-center gap-1 flex-shrink-0">
          <ChevronRight size={11} className="text-text-dim group-hover:text-accent-blue transition-colors" />
        </div>
      </div>
      <span className="text-lg font-mono font-bold text-text-primary num">
        {value > 0 ? value.toLocaleString("ko-KR", {maximumFractionDigits:2}) : "—"}
      </span>
      <div className="flex items-center gap-1">
        {pos ? <TrendingUp size={10} className={`${upColor} flex-shrink-0`} /> : <TrendingDown size={10} className={`${downColor} flex-shrink-0`} />}
        <ChangeBadge value={change_rate ?? 0} className="text-xs" />
      </div>
    </Card>
  );
});

/* ── 환율 / 금리 / 선물 카드 ─────────────────────────────── */
const ExtraCard = memo(function ExtraCard({ name, value, change, change_rate, unit, _demo, _static, colorScheme }: any) {
  const isRate = unit === "%";
  const numVal = typeof value === "number" ? value : parseFloat(String(value).replace(/,/g,"")) || 0;
  const chgVal = typeof change === "number" ? change : 0;
  const chgrVal = typeof change_rate === "number" ? change_rate : 0;
  const pos = chgVal >= 0;
  const upColor   = colorScheme === "red-blue" ? "text-accent-red"  : "text-accent-green";
  const downColor = colorScheme === "red-blue" ? "text-accent-blue" : "text-accent-red";

  const formatted = isRate
    ? numVal.toFixed(2) + "%"
    : numVal > 0
      ? numVal.toLocaleString("ko-KR", { maximumFractionDigits: 2 }) + (unit && unit !== "%" ? " " + unit : "")
      : "—";

  return (
    <Card className="flex flex-col gap-1 min-w-[135px] flex-shrink-0">
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-2xs text-text-muted font-semibold uppercase tracking-wide truncate">{name}</span>
        {_demo && <span className="text-[8px] px-0.5 rounded bg-accent-yellow/10 text-accent-yellow border border-accent-yellow/20">DEMO</span>}
        {_static && <span className="text-[8px] px-0.5 rounded bg-blue-900/20 text-blue-400 border border-blue-700/20">고정</span>}
      </div>
      <span className="text-base font-mono font-bold text-text-primary num">{formatted}</span>
      {(chgVal !== 0 || chgrVal !== 0) && (
        <div className="flex items-center gap-1">
          {pos ? <TrendingUp size={10} className={upColor} /> : <TrendingDown size={10} className={downColor} />}
          <span className={`text-2xs font-mono ${pos ? upColor : downColor}`}>
            {pos ? "+" : ""}{isRate ? chgVal.toFixed(2) + "bp" : chgVal !== 0 ? chgVal.toFixed(2) : (chgrVal.toFixed(2) + "%")}
          </span>
        </div>
      )}
    </Card>
  );
});

/* ── 스켈레톤 UI ─────────────────────────────────────────── */
const IndexCardSkeleton = memo(function IndexCardSkeleton() {
  return (
    <div className="flex flex-col gap-1.5 min-w-[145px] p-3 rounded-xl bg-bg-secondary border border-border animate-pulse">
      <div className="h-2 bg-bg-elevated rounded w-14" />
      <div className="h-6 bg-bg-elevated rounded w-24 mt-0.5" />
      <div className="h-2.5 bg-bg-elevated rounded w-12" />
    </div>
  );
});

const ExtraCardSkeleton = memo(function ExtraCardSkeleton() {
  return (
    <div className="flex flex-col gap-1.5 min-w-[135px] flex-shrink-0 p-3 rounded-xl bg-bg-secondary border border-border animate-pulse">
      <div className="h-2 bg-bg-elevated rounded w-20" />
      <div className="h-5 bg-bg-elevated rounded w-24 mt-0.5" />
      <div className="h-2 bg-bg-elevated rounded w-12" />
    </div>
  );
});

/* ── 뉴스 패널 ───────────────────────────────────────────── */
const NEWS_INITIAL = 10;

const NewsPanel = memo(function NewsPanel({
  news, sort, onSortChange,
}: {
  news: any[];
  sort: "latest" | "popular";
  onSortChange: (s: "latest" | "popular") => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // 정렬은 서버가 처리한다 — 인기도 점수는 내부 계산값이라 응답에 실리지 않는다
  const sorted = news;

  const shown = expanded ? sorted : sorted.slice(0, NEWS_INITIAL);
  const remaining = sorted.length - NEWS_INITIAL;

  if (!news?.length) return <div className="py-6 text-center text-text-muted text-xs">뉴스 로딩 중...</div>;
  return (
    <div className="flex flex-col">
      {/* 정렬 토글 */}
      <div className="flex gap-1 p-0.5 mb-1">
        {(["latest","popular"] as const).map(s=>(
          <button key={s} onClick={()=>onSortChange(s)}
            className={`px-2.5 py-1 text-2xs rounded-md font-semibold transition-all ${sort===s?"bg-accent-blue text-white":"text-text-muted hover:text-text-primary"}`}>
            {s==="latest"?"최신순":"인기순"}
          </button>
        ))}
      </div>
      {shown.map((item: any, i: number) => (
        <a key={item.link || i} href={safeExternalUrl(item.link)} target="_blank" rel="noopener noreferrer nofollow"
          className="flex items-start gap-2.5 py-2.5 px-1 border-b border-border/40 hover:bg-bg-hover transition-colors group">
          {safeExternalUrl(item.image) ? (
            <img
              src={safeExternalUrl(item.image)}
              alt=""
              loading="lazy"
              decoding="async"
              width={56}
              height={56}
              referrerPolicy="no-referrer"
              className="w-14 h-14 rounded-lg object-cover flex-shrink-0 bg-bg-elevated"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <div className="w-14 h-14 rounded-lg flex-shrink-0 bg-bg-elevated flex items-center justify-center">
              <Newspaper size={18} className="text-text-muted" />
            </div>
          )}
          <div className="flex-1 min-w-0 flex flex-col gap-0.5">
            <div className="flex items-start gap-2">
              <span className="flex-1 text-xs text-text-primary group-hover:text-accent-blue transition-colors line-clamp-2 leading-relaxed">
                {item.title}
              </span>
              <ExternalLink size={10} className="text-text-muted mt-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <div className="flex items-center gap-2 text-2xs text-text-muted">
              <span className="font-medium text-text-dim">{item.source}</span>
              {item.published && <><span>·</span><span>{fmtNewsDateTime(item.published)}</span></>}
            </div>
          </div>
        </a>
      ))}
      {remaining > 0 && (
        <button onClick={() => setExpanded(!expanded)}
          className="py-2 text-2xs text-accent-blue hover:text-blue-400 transition-colors text-center">
          {expanded ? "접기 ▲" : `더보기 ${remaining}건 ▼`}
        </button>
      )}
    </div>
  );
});

/* ── 국내 탭 ─────────────────────────────────────────────── */
const KRTab = memo(function KRTab({ liveIndices, navigate, colorScheme }: { liveIndices: any; navigate: (p: string) => void; colorScheme: string }) {
  const qc = useQueryClient();
  const { data, refetch } = useQuery({
    queryKey: ["dashboard-kr", "시가총액"],
    queryFn: () => dashboardApi.getKR("시가총액"),
    staleTime: 60_000,
    refetchInterval: (query) =>
      (query.state.data?.rankings?.length ?? 0) === 0 ? 5_000 : 60_000,
    refetchIntervalInBackground: false,
  });

  // 환율: WebSocket 실시간 우선 → HTTP 폴백
  const { data: usRatesData } = useQuery({
    queryKey: ["dashboard-us-rates"],
    queryFn: () => dashboardApi.getUSRates(),
    staleTime: 300_000,
    refetchInterval: 300_000,
  });
  const liveUsdkrw = liveIndices?.forex?.usdkrw ?? null;
  const usdkrwRate = useMemo(() => {
    if (liveUsdkrw) return liveUsdkrw;
    if (Array.isArray(usRatesData)) {
      return (usRatesData as any[]).find(isUsdKrwRow);
    }
    return null;
  }, [liveUsdkrw, usRatesData]);

  const prefetchIndex = useCallback((key: string) => {
    if (qc.getQueryData(["index-detail", key])) return;
    qc.prefetchQuery({ queryKey: ["index-detail", key], queryFn: () => dashboardApi.getIndexDetail(key), staleTime: 30_000 });
    // OHLCV는 실제 지수 상세 페이지 진입 시 로드 (대시보드 호버 프리페치 제거)
  }, [qc]);

  const [newsSort, setNewsSort] = useState<"latest" | "popular">("latest");
  const { data: newsData } = useQuery({
    queryKey: ["news", "kr", newsSort],
    queryFn: () => dashboardApi.getNews("kr", newsSort),
    staleTime: 300_000,
    refetchInterval: 300_000,
    refetchIntervalInBackground: false,
  });

  const KR_INDEX_KEYS = ["KOSPI","KOSDAQ","KOSPI200","KOSDAQ150"] as const;
  const KR_DISPLAY: Record<string, string> = {
    KOSPI:"코스피",KOSDAQ:"코스닥",KOSPI200:"코스피 200",KOSDAQ150:"코스닥 150"
  };
  const getIdx = (key: string) => {
    const live    = liveIndices?.kr?.find((r: any) => r.index === key);
    const fetched = data?.indices?.find((r: any) => r.index === key);
    return live ?? fetched ?? { value: 0, change: 0, change_rate: 0 };
  };

  return (
    <div className="flex flex-col gap-5">
      {/* 지수 */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-2xs font-semibold text-text-muted uppercase tracking-widest">국내 지수</h2>
          <button onClick={() => refetch()} className="text-text-muted hover:text-accent-blue transition-colors">
            <RefreshCw size={11} />
          </button>
        </div>
        <div className="flex gap-3 overflow-x-auto p-2 -m-2 scrollbar-hide">
          {!data
            ? KR_INDEX_KEYS.map((key) => <div key={key} className="flex-shrink-0"><IndexCardSkeleton /></div>)
            : KR_INDEX_KEYS.map((key) => {
                const idx = getIdx(key);
                return (
                  <div key={key} className="flex-shrink-0" onMouseEnter={() => prefetchIndex(key)}>
                    <IndexCard name={KR_DISPLAY[key]} {...idx} onClick={() => navigate(`/index/${key}`)} colorScheme={colorScheme} />
                  </div>
                );
              })
          }
        </div>
      </section>

      {/* 환율 / 금리 */}
      <section>
        <h2 className="text-2xs font-semibold text-text-muted uppercase tracking-widest mb-3">환율 · 금리</h2>
        <div className="flex gap-3 overflow-x-auto p-2 -m-2 scrollbar-hide">
          {!data ? (
            [1,2,3,4].map(i => <ExtraCardSkeleton key={i} />)
          ) : (
            <>
              {(usdkrwRate ?? data?.exchange) && (
                <ExtraCard
                  name="원/달러"
                  value={usdkrwRate?.value ?? data?.exchange?.value ?? data?.exchange?.usdkrw ?? 0}
                  change={usdkrwRate?.change ?? data?.exchange?.change ?? 0}
                  change_rate={usdkrwRate?.change_rate ?? data?.exchange?.change_rate ?? 0}
                  unit="원"
                  _demo={usdkrwRate ? undefined : data?.exchange?._demo}
                  colorScheme={colorScheme}
                />
              )}
              {(data?.rates ?? []).map((r: any) => (
                <ExtraCard key={r.name} {...r} colorScheme={colorScheme} />
              ))}
            </>
          )}
        </div>
      </section>

      {/* 뉴스 */}
      <Card className="p-0 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Newspaper size={14} className="text-text-muted" />
          <h3 className="text-sm font-semibold text-text-primary">국내 금융뉴스</h3>
          {newsData && <span className="text-2xs text-text-muted ml-auto">{newsData.length}건</span>}
        </div>
        <div className="px-3 py-1">
          <NewsPanel news={newsData ?? []} sort={newsSort} onSortChange={setNewsSort} />
        </div>
      </Card>
    </div>
  );
});

/* ── 해외 탭 ─────────────────────────────────────────────── */
const USTab = memo(function USTab({ liveIndices, navigate, colorScheme }: { liveIndices: any; navigate: (p: string) => void; colorScheme: string }) {
  const qc = useQueryClient();
  const { data, refetch } = useQuery({
    queryKey: ["dashboard-us", "시가총액"],
    queryFn: () => dashboardApi.getUS("시가총액"),
    staleTime: 60_000,
    refetchInterval: (query) =>
      (query.state.data?.rankings?.length ?? 0) === 0 ? 5_000 : 60_000,
    refetchIntervalInBackground: false,
  });

  const { data: ratesData } = useQuery({
    queryKey: ["dashboard-us-rates"],
    queryFn: () => dashboardApi.getUSRates(),
    staleTime: 300_000,
    refetchInterval: 300_000,
  });

  const [newsSort, setNewsSort] = useState<"latest" | "popular">("latest");
  const { data: newsData } = useQuery({
    queryKey: ["news", "us", newsSort],
    queryFn: () => dashboardApi.getNews("us", newsSort),
    staleTime: 300_000,
    refetchInterval: 300_000,
    refetchIntervalInBackground: false,
  });

  const US_INDEX_KEYS = ["SP500","NASDAQ","DOW","SOX","RUSSELL"] as const;
  const US_DISPLAY: Record<string, string> = {
    SP500:"S&P 500", NASDAQ:"나스닥", DOW:"다우 산업", SOX:"필라델피아 반도체", RUSSELL:"러셀 2000"
  };
  const prefetchIndex = useCallback((key: string) => {
    if (qc.getQueryData(["index-detail", key])) return;
    qc.prefetchQuery({ queryKey: ["index-detail", key], queryFn: () => dashboardApi.getIndexDetail(key), staleTime: 30_000 });
  }, [qc]);
  const getIdx = (key: string) => {
    const live    = liveIndices?.us?.find((r: any) => r.index === key);
    const fetched = data?.indices?.find((r: any) => r.index === key);
    return live ?? fetched ?? { value: 0, change: 0, change_rate: 0 };
  };

  // rates: WebSocket 실시간 환율 반영 후 목록 구성
  const liveUsdkrwUS = liveIndices?.forex?.usdkrw ?? null;
  const rates: any[] = useMemo(() => {
    const base: any[] = ratesData?.length ? [...ratesData] : data?.rates?.length ? [...data.rates] :
      data?.exchange ? [{ name: "원/달러", value: data.exchange.value ?? data.exchange.usdkrw ?? 0, change: data.exchange.change ?? 0, change_rate: data.exchange.change_rate ?? 0, unit: "원" }] : [];
    // WebSocket으로 실시간 환율 덮어쓰기
    if (liveUsdkrwUS) {
      const idx = base.findIndex(isUsdKrwRow);
      const live = { ...liveUsdkrwUS, name: "원/달러" };
      if (idx >= 0) base[idx] = live; else base.unshift(live);
    }
    return base;
  }, [ratesData, data, liveUsdkrwUS]);

  return (
    <div className="flex flex-col gap-5">
      {/* 해외 지수 */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-2xs font-semibold text-text-muted uppercase tracking-widest">해외 지수</h2>
          <button onClick={() => refetch()} className="text-text-muted hover:text-accent-blue transition-colors">
            <RefreshCw size={11} />
          </button>
        </div>
        <div className="flex gap-3 overflow-x-auto p-2 -m-2 scrollbar-hide">
          {!data
            ? US_INDEX_KEYS.map((key) => <div key={key} className="flex-shrink-0"><IndexCardSkeleton /></div>)
            : US_INDEX_KEYS.map((key) => {
                const idx = getIdx(key);
                return (
                  <div key={key} className="flex-shrink-0" onMouseEnter={() => prefetchIndex(key)}>
                    <IndexCard name={US_DISPLAY[key]} {...idx} onClick={() => navigate(`/index/${key}`)} colorScheme={colorScheme} />
                  </div>
                );
              })
          }
        </div>
      </section>

      {/* 환율 · 금리 · 국채 */}
      <section>
        <h2 className="text-2xs font-semibold text-text-muted uppercase tracking-widest mb-3">환율 · 금리 · 국채</h2>
        <div className="flex gap-3 overflow-x-auto p-2 -m-2 scrollbar-hide">
          {!ratesData && !data ? (
            [1,2,3,4,5].map(i => <ExtraCardSkeleton key={i} />)
          ) : (
            rates.map((r: any) => <ExtraCard key={r.name} {...r} colorScheme={colorScheme} />)
          )}
        </div>
      </section>

      {/* 뉴스 */}
      <Card className="p-0 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Globe size={14} className="text-text-muted" />
          <h3 className="text-sm font-semibold text-text-primary">해외 금융뉴스</h3>
          {newsData && <span className="text-2xs text-text-muted ml-auto">{newsData.length}건</span>}
        </div>
        <div className="px-3 py-1">
          <NewsPanel news={newsData ?? []} sort={newsSort} onSortChange={setNewsSort} />
        </div>
      </Card>
    </div>
  );
});

/* ── 메인 ────────────────────────────────────────────────── */
export default function Dashboard() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"kr" | "us">("kr");
  const [liveIndices, setLiveIndices] = useState<any>(null);
  const colorScheme = useSettingsStore((s) => s.colorScheme);

  const { status: wsStatus } = useIndicesStream(
    useCallback((data: any) => setLiveIndices(data), []),
    30,
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">대시보드</h1>
          <p className="text-text-muted text-xs mt-0.5">지수 클릭 → 상세 차트 · 종목 클릭 → 종목 상세</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${wsStatus==="connected" ? "bg-accent-green animate-pulse" : "bg-accent-red"}`} />
            <span className="text-2xs text-text-muted">{wsStatus==="connected" ? "실시간" : "오프라인"}</span>
          </div>
          <div className="flex gap-0.5 bg-bg-secondary border border-border rounded-xl p-1">
            <button onClick={() => setTab("kr")}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                tab==="kr" ? "bg-accent-blue text-white shadow" : "text-text-muted hover:text-text-primary"
              }`}><Flag size={11}/>국내</button>
            <button onClick={() => setTab("us")}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                tab==="us" ? "bg-accent-blue text-white shadow" : "text-text-muted hover:text-text-primary"
              }`}><Globe size={11}/>해외</button>
          </div>
        </div>
      </div>

      <div key={tab} className="tab-fade">
        {tab === "kr"
          ? <KRTab liveIndices={liveIndices} navigate={navigate} colorScheme={colorScheme} />
          : <USTab liveIndices={liveIndices} navigate={navigate} colorScheme={colorScheme} />
        }
      </div>
    </div>
  );
}
