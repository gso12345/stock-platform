import { useState, useCallback, useMemo, memo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { dashboardApi } from "@/api/stocks";
import { Card, ChangeBadge, Tabs, RowSkeleton, 못불러옴} from "@/components/ui";
import { useSettingsStore } from "@/store/settingsStore";
import { useIndicesStream } from "@/hooks/useWebSocket";
import { isUsdKrwRow } from "@/hooks/useExchangeRate";
import { safeExternalUrl } from "@/utils/url";
import { TrendingUp, TrendingDown, Newspaper, Globe, Flag, ExternalLink, ChevronRight, RefreshCw, Trophy } from "lucide-react";
import { fmtNewsDateTime, fmtKRWFull, fmtUSDFull } from "@/utils/formatters";

/* ── 지수 카드 ───────────────────────────────────────────── */
const IndexCard = memo(function IndexCard({ name, value, change_rate, onClick }: any) {
  // 색상 테마는 스토어에서 직접 읽는다. 예전에는 Dashboard → KRTab → IndexCard 로
  // prop 을 세 단계 넘겼는데, 같은 파일의 ChangeBadge 는 스토어를 직접 읽어
  // 한 화면 안에 두 방식이 섞여 있었다
  const colorScheme = useSettingsStore((st) => st.colorScheme);
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
        {pos ? <TrendingUp size={11} className={`${upColor} flex-shrink-0`} /> : <TrendingDown size={11} className={`${downColor} flex-shrink-0`} />}
        <ChangeBadge value={change_rate ?? 0} className="text-xs" />
      </div>
    </Card>
  );
});

/* ── 환율 / 금리 / 선물 카드 ─────────────────────────────── */
const ExtraCard = memo(function ExtraCard({ name, value, change, change_rate, unit, _demo, _static }: any) {
  const colorScheme = useSettingsStore((st) => st.colorScheme);
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
        {_demo && <span className="text-2xs px-0.5 rounded bg-accent-yellow/10 text-accent-yellow border border-accent-yellow/20">DEMO</span>}
        {_static && <span className="text-2xs px-0.5 rounded bg-accent-blue/15 text-accent-blue border border-accent-blue/20">고정</span>}
      </div>
      <span className="text-base font-mono font-bold text-text-primary num">{formatted}</span>
      {(chgVal !== 0 || chgrVal !== 0) && (
        <div className="flex items-center gap-1">
          {pos ? <TrendingUp size={11} className={upColor} /> : <TrendingDown size={11} className={downColor} />}
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

/** 기사 사진 한 칸.
 *
 *  주소가 살아 있는지는 받아 보기 전에는 알 수 없다. 서버는 주소가
 *  있는지까지만 볼 수 있고, 그 주소가 실제로 그림을 주는지는 브라우저가
 *  받아 봐야 안다. 언론사가 사진을 치우거나 핫링크를 막으면 주소는
 *  멀쩡한데 그림만 안 온다.
 *
 *  그래서 안 되는 것을 여기서 위로 알린다(onFail). 목록 쪽이 그 기사를
 *  통째로 뺀다 — "이미지 있는 기사만" 이라는 약속을 화면에서 끝까지
 *  지키려면 이 방법뿐이다. 대체 아이콘을 그려 두는 것으로는 부족했다.
 *  사용자에게는 그것도 '이미지가 안 나오는 기사' 로 보인다. */
export function 뉴스썸네일({ src, onFail }: { src?: string; onFail?: () => void }) {
  const [깨짐, set깨짐] = useState(false);
  const 자리 = "w-14 h-14 rounded-lg flex-shrink-0 bg-bg-elevated";
  if (!src || 깨짐) {
    /* 목록에서 빠지기 전 한 프레임 동안만 보이는 자리다. 자리를 지켜서
       그 순간에도 줄이 들쭉날쭉해 보이지 않게 한다. */
    return (
      <div className={`${자리} flex items-center justify-center`}>
        <Newspaper size={16} className="text-text-muted" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      width={56}
      height={56}
      referrerPolicy="no-referrer"
      className={`${자리} object-cover`}
      onError={() => { set깨짐(true); onFail?.(); }}
    />
  );
}

const NewsPanel = memo(function NewsPanel({
  news, sort, onSortChange,
}: {
  news: any[];
  sort: "latest" | "popular";
  onSortChange: (s: "latest" | "popular") => void;
}) {
  const [expanded, setExpanded] = useState(false);

  /* 그림을 못 받은 기사 주소. 서버는 '주소가 있는지' 까지만 볼 수 있어서,
     실제로 안 뜨는 것은 브라우저가 받아 봐야 안다. 한 번 실패한 것은
     여기 담아 두고 목록에서 뺀다 — 그래야 "이미지 있는 기사만" 이
     화면에서도 지켜진다. */
  const [사진없음, set사진없음] = useState<Set<string>>(new Set());
  const 사진깨짐 = useCallback((키: string) => {
    set사진없음((이전) => (이전.has(키) ? 이전 : new Set(이전).add(키)));
  }, []);

  // 정렬은 서버가 처리한다 — 인기도 점수는 내부 계산값이라 응답에 실리지 않는다
  const sorted = useMemo(
    () => (news ?? []).filter((a: any) => a?.image && !사진없음.has(a.link || a.title)),
    [news, 사진없음],
  );

  const shown = expanded ? sorted : sorted.slice(0, NEWS_INITIAL);
  const remaining = sorted.length - NEWS_INITIAL;

  /* 빈 상태 모양을 다른 화면과 맞춘다. 예전에는 '뉴스 로딩 중...' 한 줄이라
     로딩인지 정말 없는 건지 구분이 안 됐다 */
  if (!sorted.length) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
        <Newspaper size={24} className="text-text-muted/40" />
        <p className="text-text-secondary text-sm">표시할 뉴스가 없어요</p>
        <p className="text-text-muted text-xs">잠시 후 다시 확인해주세요</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col">
      {/* 정렬 토글 */}
      <div className="flex gap-1 p-0.5 mb-1">
        {(["latest","popular"] as const).map(s=>(
          <button key={s} onClick={()=>onSortChange(s)}
            className={`px-2.5 py-1 text-2xs rounded-lg font-semibold transition-all ${sort===s?"bg-accent-blue text-white":"text-text-muted hover:text-text-primary"}`}>
            {s==="latest"?"최신순":"인기순"}
          </button>
        ))}
      </div>
      {shown.map((item: any, i: number) => (
        <a key={item.link || i} href={safeExternalUrl(item.link)} target="_blank" rel="noopener noreferrer nofollow"
          className="flex items-start gap-2.5 py-2.5 px-1 border-b border-border/40 hover:bg-bg-hover transition-colors group">
          <뉴스썸네일 src={safeExternalUrl(item.image)}
            onFail={() => 사진깨짐(item.link || item.title)} />
          <div className="flex-1 min-w-0 flex flex-col gap-0.5">
            <div className="flex items-start gap-2">
              <span className="flex-1 text-xs text-text-primary group-hover:text-accent-blue transition-colors line-clamp-2 leading-relaxed">
                {item.title}
              </span>
              <ExternalLink size={11} className="text-text-muted mt-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
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
          className="py-2 text-2xs text-accent-blue hover:text-accent-blue transition-colors text-center">
          {expanded ? "접기 ▲" : `더보기 ${remaining}건 ▼`}
        </button>
      )}
    </div>
  );
});

/* ── 순위 ────────────────────────────────────────────────────
   서버는 원래부터 이 값을 응답에 실어 보냈지만 화면에 표시하지 않았다.
   요청마다 24KB 를 받아서 버렸고, 심지어 '비어 있으면 5초마다 다시 받기'의
   판정 기준으로만 쓰였다. 이제 실제로 보여준다. */
const RANK_CATEGORIES = [
  { id: "시가총액", label: "시가총액" },
  { id: "상승률",   label: "상승률"   },
  { id: "하락률",   label: "하락률"   },
  { id: "거래대금", label: "거래대금" },
  { id: "거래량",   label: "거래량"   },
] as const;

const RANK_SHOWN = 10;

const RankingPanel = memo(function RankingPanel({
  market, navigate,
}: { market: "kr" | "us"; navigate: (p: string) => void }) {
  const [category, setCategory] = useState<string>("시가총액");
  const [expanded, setExpanded] = useState(false);
  const { data, isLoading, isError: 못받음, error: 실패사유, refetch: 다시받기 } = useQuery({
    queryKey: ["rankings", market, category],
    queryFn: () => dashboardApi.getRankings(market, category),
    staleTime: 60_000,
  });

  const rows: any[] = Array.isArray(data) ? data : [];
  const shown = expanded ? rows.slice(0, 50) : rows.slice(0, RANK_SHOWN);
  const isKR = market === "kr";

  return (
    <Card className="p-0 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <Trophy size={14} className="text-text-muted" />
        <h3 className="text-sm font-semibold text-text-primary">{isKR ? "국내" : "해외"} 순위</h3>
      </div>
      <div className="px-3 pt-2">
        <Tabs
          fill={false}
          ariaLabel="순위 기준"
          tabs={RANK_CATEGORIES.map((c) => ({ id: c.id, label: c.label }))}
          active={category}
          onChange={setCategory}
          className="w-fit"
        />
      </div>
      {isLoading ? (
        <div className="p-3"><RowSkeleton rows={5} /></div>
      ) : 못받음 ? (
        /* 예전에는 실패든 빈 목록이든 '순위를 불러오지 못했어요' 한 줄이었다.
           다시 눌러 볼 방법도 없었다 */
        <못불러옴 compact 사유={실패사유} 다시={() => 다시받기()} />
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
          <Trophy size={24} className="text-text-muted/40" />
          <p className="text-text-muted text-xs">아직 순위가 만들어지지 않았어요</p>
        </div>
      ) : (
        <div className="flex flex-col">
          {shown.map((r, i) => (
            <button
              key={r.symbol ?? i}
              onClick={() => navigate(`/stocks/${isKR ? "KR" : "US"}/${encodeURIComponent(r.symbol)}`)}
              className="flex items-center gap-2.5 px-3 py-2 border-b border-border/30 hover:bg-bg-hover transition-colors text-left last:border-b-0"
            >
              <span className="w-5 text-2xs font-mono text-text-dim flex-shrink-0">{r.rank ?? i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-text-primary truncate">{r.name}</div>
                <div className="text-xs text-text-muted font-mono">{r.symbol}</div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-xs font-mono font-semibold text-text-primary">
                  {r.price ? (isKR ? fmtKRWFull(r.price) : fmtUSDFull(r.price)) : "—"}
                </div>
                <ChangeBadge value={r.change_rate ?? 0} className="text-2xs" />
              </div>
            </button>
          ))}
          {rows.length > RANK_SHOWN && (
            <button onClick={() => setExpanded((v) => !v)}
              className="py-2 text-2xs text-accent-blue hover:text-accent-blue transition-colors text-center">
              {expanded ? "접기 ▲" : `더보기 ${Math.min(rows.length, 50) - RANK_SHOWN}건 ▼`}
            </button>
          )}
        </div>
      )}
    </Card>
  );
});

/* ── 국내 탭 ─────────────────────────────────────────────── */
const KRTab = memo(function KRTab({ liveIndices, navigate }: { liveIndices: any; navigate: (p: string) => void }) {
  const qc = useQueryClient();
  const { data, refetch, isError: 못받음, error: 실패사유 } = useQuery({
    queryKey: ["dashboard-kr", "시가총액"],
    queryFn: () => dashboardApi.getKR("시가총액"),
    staleTime: 60_000,
    /* 지수를 못 받았을 때만 잠깐 자주 시도한다.
       예전에는 rankings 로 판정했는데, 그건 화면에 표시되지도 않는 값이라
       비어 있으면 영원히 5초마다 폴링했다.

       그 뒤에도 구멍이 남아 있었다 — 조회가 실패하면 data 가 undefined 라
       `?? 0` 이 0 이 되고, 결국 실패하는 동안 5초마다 계속 두드린다.
       서버가 자고 있거나 죽어 있을 때가 정확히 그 상황인데, 0.15 CPU
       서버를 그때 가장 세게 때리는 셈이다.

       실패했으면 평소 주기로 물러난다. 자다 깨는 데 20~45초가 걸리므로
       5초로 재촉해 봐야 얻는 것이 없다. */
    refetchInterval: (query) => {
      if (query.state.status === "error") return 60_000;
      return (query.state.data?.indices?.length ?? 0) === 0 ? 5_000 : 60_000;
    },
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
  const { data: newsData, isError: 뉴스못받음, error: 뉴스실패사유, refetch: 뉴스다시 } = useQuery({
    queryKey: ["news", "kr", newsSort],
    queryFn: () => dashboardApi.getNews("kr", newsSort),
    staleTime: 300_000,
    refetchInterval: 300_000,
    refetchIntervalInBackground: false,
  });

  /* 화면이 지수 목록을 들고 있지 않는다 — 서버가 준 것만 그린다.

     여기서 같은 일을 세 번 겪었다. 코스닥150 이 몇 달 동안 0 으로 떠
     있었고, 그걸 빼고 KRX 300 을 넣었더니 이번엔 KRX 300 이 안 나왔다.
     원인이 매번 달랐지만 되풀이되는 구조는 하나였다 —

       화면에 지수 이름을 적어 둔다 → 서버가 그 지수를 못 받는다
       → 화면은 적어 둔 이름대로 자리를 만든다 → 빈 카드/0 이 뜬다

     이름을 적어 두는 한 다음 후보에서 또 겪는다. 그래서 목록을
     서버 응답에서 만든다. 서버가 값을 못 받으면 응답에 안 실리고,
     그러면 화면에도 애초에 안 생긴다. 지수를 더 넣거나 뺄 때 화면을
     같이 고칠 일도 없어진다. */
  const 지수이름: Record<string, string> = {
    KOSPI:"코스피", KOSDAQ:"코스닥", KOSPI200:"코스피 200", KOSPI100:"코스피 100",
  };
  const 쓸모있는지수 = (r: any) =>
    /* 0 은 '0포인트' 가 아니라 '모른다' 는 뜻이다. 서버가 아직
       0 을 실어 보내는 경로가 남아 있어(옛 캐시 등) 여기서 한 번 더 거른다.
       금융 화면에서 모르는 값을 숫자로 채우면 사람은 그걸 믿는다. */
    r && r.index && typeof r.value === "number" && r.value > 0;

  const 국내지수 = useMemo(() => {
    const 실시간 = new Map<string, any>();
    for (const r of liveIndices?.kr ?? []) if (쓸모있는지수(r)) 실시간.set(r.index, r);
    const 목록: any[] = [];
    const 본것 = new Set<string>();
    /* 순서는 서버가 준 차례를 따른다. 실시간 값이 있으면 그걸로 바꿔 끼운다 */
    for (const r of [...(data?.indices ?? []), ...(liveIndices?.kr ?? [])]) {
      const 쓸것 = 실시간.get(r?.index) ?? r;
      if (!쓸모있는지수(쓸것) || 본것.has(쓸것.index)) continue;
      본것.add(쓸것.index);
      목록.push(쓸것);
    }
    return 목록;
  }, [data?.indices, liveIndices?.kr]);

  return (
    <div className="flex flex-col gap-5">
      {/* 지수 */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-2xs font-semibold text-text-muted uppercase tracking-widest">국내 지수</h2>
          <button aria-label="새로고침" onClick={() => refetch()} className="text-text-muted hover:text-accent-blue transition-colors">
            <RefreshCw size={11} />
          </button>
        </div>
        <div className="flex gap-3 overflow-x-auto p-2 -m-2 scrollbar-hide">
          {못받음 && !data
            /* 실패하면 스켈레톤이 영원히 돌았다. 사용자에게는 '아직
               불러오는 중' 으로 보이는데 영영 안 온다 */
            ? <못불러옴 compact 사유={실패사유} 다시={() => refetch()} />
            : !data
            ? [0, 1, 2, 3].map((i) => <div key={i} className="flex-shrink-0"><IndexCardSkeleton /></div>)
            : 국내지수.map((idx) => (
                <div key={idx.index} className="flex-shrink-0"
                  onMouseEnter={() => prefetchIndex(idx.index)}
                  onTouchStart={() => prefetchIndex(idx.index)}
                  onFocus={() => prefetchIndex(idx.index)}>
                  <IndexCard name={지수이름[idx.index] ?? idx.name ?? idx.index} {...idx}
                    onClick={() => navigate(`/index/${idx.index}`)} />
                </div>
              ))
          }
        </div>
      </section>

      {/* 환율 / 금리 / 변동성 */}
      <section>
        {/* VKOSPI 가 이 줄에 들어오면서 제목이 내용과 안 맞게 됐다.
            해외 탭이 VIX 를 같은 자리에 두고 있어 짝을 맞춘 것이다 */}
        <h2 className="text-2xs font-semibold text-text-muted uppercase tracking-widest mb-3">환율 · 금리 · 변동성</h2>
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
                />
              )}
              {(data?.rates ?? []).map((r: any, i: number) => (
                <ExtraCard key={`${r.name}-${i}`} {...r} />
              ))}
              {/* 선물 — 백엔드가 응답에 담아 보내는데 화면에서 안 쓰고
                  버리고 있었다. 대시보드를 열 때마다 KIS 선물 API 를
                  부르고 결과를 버린 셈이다.
                  값 이름이 price 라 ExtraCard 가 쓰는 value 로 옮긴다. */}
              {(data?.futures ?? []).map((f: any, i: number) => (
                <ExtraCard
                  key={`fut-${f.symbol ?? f.name}-${i}`}
                  name={f.name}
                  value={f.price ?? f.value ?? 0}
                  change={f.change ?? 0}
                  change_rate={f.change_rate ?? 0}
                  unit={f.unit ?? "pt"}
                />
              ))}
            </>
          )}
        </div>
      </section>

      <RankingPanel market="kr" navigate={navigate} />

      {/* 뉴스 */}
      <Card className="p-0 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Newspaper size={14} className="text-text-muted" />
          <h3 className="text-sm font-semibold text-text-primary">국내 금융뉴스</h3>
          {newsData && <span className="text-2xs text-text-muted ml-auto">{newsData.length}건</span>}
        </div>
        <div className="px-3 py-1">
          {뉴스못받음 ? (
            /* 국내 언론사 49곳 중 상당수가 실패 중일 때가 있다.
               "기사가 없다" 와 "못 받았다" 는 사용자가 할 일이 다르다 */
            <못불러옴 compact 사유={뉴스실패사유} 다시={() => 뉴스다시()} />
          ) : (
            <NewsPanel news={newsData ?? []} sort={newsSort} onSortChange={setNewsSort} />
          )}
        </div>
      </Card>
    </div>
  );
});

/* ── 해외 탭 ─────────────────────────────────────────────── */
const USTab = memo(function USTab({ liveIndices, navigate }: { liveIndices: any; navigate: (p: string) => void }) {
  const qc = useQueryClient();
  const { data, refetch, isError: 못받음, error: 실패사유 } = useQuery({
    queryKey: ["dashboard-us", "시가총액"],
    queryFn: () => dashboardApi.getUS("시가총액"),
    staleTime: 60_000,
    refetchInterval: (query) => {
      if (query.state.status === "error") return 60_000;
      return (query.state.data?.indices?.length ?? 0) === 0 ? 5_000 : 60_000;
    },
    refetchIntervalInBackground: false,
  });

  const { data: ratesData } = useQuery({
    queryKey: ["dashboard-us-rates"],
    queryFn: () => dashboardApi.getUSRates(),
    staleTime: 300_000,
    refetchInterval: 300_000,
  });

  const [newsSort, setNewsSort] = useState<"latest" | "popular">("latest");
  const { data: newsData, isError: 뉴스못받음, error: 뉴스실패사유, refetch: 뉴스다시 } = useQuery({
    queryKey: ["news", "us", newsSort],
    queryFn: () => dashboardApi.getNews("us", newsSort),
    staleTime: 300_000,
    refetchInterval: 300_000,
    refetchIntervalInBackground: false,
  });

  const 지수이름: Record<string, string> = {
    SP500:"S&P 500", NASDAQ:"나스닥", DOW:"다우 산업", SOX:"필라델피아 반도체", RUSSELL:"러셀 2000"
  };
  const prefetchIndex = useCallback((key: string) => {
    if (qc.getQueryData(["index-detail", key])) return;
    qc.prefetchQuery({ queryKey: ["index-detail", key], queryFn: () => dashboardApi.getIndexDetail(key), staleTime: 30_000 });
  }, [qc]);

  /* 국내 탭과 같은 규칙 — 목록을 화면에 적어 두지 않고 서버가 준 것만 그린다 */
  const 쓸모있는지수 = (r: any) =>
    r && r.index && typeof r.value === "number" && r.value > 0;

  const 해외지수 = useMemo(() => {
    const 실시간 = new Map<string, any>();
    for (const r of liveIndices?.us ?? []) if (쓸모있는지수(r)) 실시간.set(r.index, r);
    const 목록: any[] = [];
    const 본것 = new Set<string>();
    for (const r of [...(data?.indices ?? []), ...(liveIndices?.us ?? [])]) {
      const 쓸것 = 실시간.get(r?.index) ?? r;
      if (!쓸모있는지수(쓸것) || 본것.has(쓸것.index)) continue;
      본것.add(쓸것.index);
      목록.push(쓸것);
    }
    return 목록;
  }, [data?.indices, liveIndices?.us]);

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
          <button aria-label="새로고침" onClick={() => refetch()} className="text-text-muted hover:text-accent-blue transition-colors">
            <RefreshCw size={11} />
          </button>
        </div>
        <div className="flex gap-3 overflow-x-auto p-2 -m-2 scrollbar-hide">
          {못받음 && !data
            ? <못불러옴 compact 사유={실패사유} 다시={() => refetch()} />
            : !data
            ? [0, 1, 2, 3, 4].map((i) => <div key={i} className="flex-shrink-0"><IndexCardSkeleton /></div>)
            : 해외지수.map((idx) => (
                <div key={idx.index} className="flex-shrink-0"
                  onMouseEnter={() => prefetchIndex(idx.index)}
                  onTouchStart={() => prefetchIndex(idx.index)}
                  onFocus={() => prefetchIndex(idx.index)}>
                  <IndexCard name={지수이름[idx.index] ?? idx.name ?? idx.index} {...idx}
                    onClick={() => navigate(`/index/${idx.index}`)} />
                </div>
              ))
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
            rates.map((r: any, i: number) => <ExtraCard key={`${r.name}-${i}`} {...r} />)
          )}
        </div>
      </section>

      <RankingPanel market="us" navigate={navigate} />

      {/* 뉴스 */}
      <Card className="p-0 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Globe size={14} className="text-text-muted" />
          <h3 className="text-sm font-semibold text-text-primary">해외 금융뉴스</h3>
          {newsData && <span className="text-2xs text-text-muted ml-auto">{newsData.length}건</span>}
        </div>
        <div className="px-3 py-1">
          {뉴스못받음 ? (
            /* 국내 언론사 49곳 중 상당수가 실패 중일 때가 있다.
               "기사가 없다" 와 "못 받았다" 는 사용자가 할 일이 다르다 */
            <못불러옴 compact 사유={뉴스실패사유} 다시={() => 뉴스다시()} />
          ) : (
            <NewsPanel news={newsData ?? []} sort={newsSort} onSortChange={setNewsSort} />
          )}
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

  const { status: wsStatus } = useIndicesStream(
    useCallback((data: any) => setLiveIndices(data), []),
    30,
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        {/* 제목을 되돌렸다.
            하단 탭이 있으니 없어도 된다고 봤는데, 막상 지우니 화면이
            어디인지 알려 주는 것이 없어 어색했다. 하단 탭은 작고 화면
            맨 아래에 있어서 제목을 대신하지 못한다. */}
        <div>
          <h1 className="text-2xl font-bold text-text-primary">대시보드</h1>
          <p className="text-text-muted text-xs mt-0.5">지수 클릭 → 상세 차트 · 종목 클릭 → 종목 상세</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${wsStatus==="connected" ? "bg-accent-green animate-pulse" : "bg-accent-red"}`} />
            <span className="text-2xs text-text-muted">{wsStatus==="connected" ? "실시간" : "오프라인"}</span>
          </div>
          <Tabs
            fill={false}
            ariaLabel="시장 선택"
            tabs={[
              { id: "kr", label: "국내", icon: Flag },
              { id: "us", label: "해외", icon: Globe },
            ]}
            active={tab}
            onChange={(id) => setTab(id as "kr" | "us")}
          />
        </div>
      </div>

      <div key={tab} className="tab-fade">
        {tab === "kr"
          ? <KRTab liveIndices={liveIndices} navigate={navigate} />
          : <USTab liveIndices={liveIndices} navigate={navigate} />
        }
      </div>
    </div>
  );
}
