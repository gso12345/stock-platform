import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { dashboardApi } from "@/api/stocks";
import { Card, ChangeBadge } from "@/components/ui";
import { ArrowLeft, TrendingUp, TrendingDown, RefreshCw, Maximize2, X, ChevronDown } from "lucide-react";
import StockChart from "@/components/chart/StockChart";


const CANDLE_TYPES = [
  { label:"일봉", value:"1d"  },
  { label:"주봉", value:"1wk" },
  { label:"월봉", value:"1mo" },
  { label:"연봉", value:"1y"  },
];

const INDEX_INFO: Record<string, { region: string; desc: string; isKR: boolean }> = {
  KOSPI:     { region:"국내", desc:"한국 유가증권시장 전체 시가총액 기준 지수",     isKR:true  },
  KOSDAQ:    { region:"국내", desc:"한국 코스닥시장 전체 종목 지수",               isKR:true  },
  KOSPI200:  { region:"국내", desc:"코스피 대표 200개 종목 지수",                  isKR:true  },
  KOSDAQ150: { region:"국내", desc:"코스닥 대표 150개 종목 지수",                  isKR:true  },
  SP500:     { region:"해외", desc:"미국 대형주 500개 기업 지수 (S&P 500)",        isKR:false },
  NASDAQ:    { region:"해외", desc:"미국 나스닥 시장 전체 종합 지수",               isKR:false },
  DOW:       { region:"해외", desc:"미국 우량 대형주 30개 기업 다우산업 평균",      isKR:false },
  SOX:       { region:"해외", desc:"필라델피아 반도체 지수 — 글로벌 반도체 30개",  isKR:false },
  RUSSELL:   { region:"해외", desc:"미국 소형주 2000개 기업 러셀 2000 지수",       isKR:false },
};

// 개월 수 → yfinance period 매핑 (지원되는 최소 period 선택)
function monthsToPeriod(months: number): string {
  if (months <= 1)  return "1mo";
  if (months <= 3)  return "3mo";
  if (months <= 6)  return "6mo";
  if (months <= 12) return "1y";
  if (months <= 24) return "2y";
  if (months <= 60) return "5y";
  return "max";
}

const ROWS_PER_MONTH = 22; // 한 달 평균 거래일 수

export default function IndexDetail() {
  const { name }  = useParams<{ name: string }>();
  const navigate  = useNavigate();
  const qc        = useQueryClient();
  const [candleType, setCandleType] = useState("1d");
  const [mainTab, setMainTab] = useState<"chart" | "daily">("chart");
  const [dailyMonths, setDailyMonths] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);

  const indexName = name?.toUpperCase() ?? "";
  const meta      = INDEX_INFO[indexName] ?? { region:"—", desc:"", isKR:false };

  // 지수 변경 시 일별 개월 초기화
  useEffect(() => { setDailyMonths(1); }, [indexName]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFullscreen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 현재 dailyMonths에 필요한 yfinance period
  const dailyPeriod = useMemo(() => monthsToPeriod(dailyMonths), [dailyMonths]);

  const { data: info, refetch: refetchInfo } = useQuery({
    queryKey: ["index-detail", indexName],
    queryFn: () => dashboardApi.getIndexDetail(indexName),
    enabled: !!indexName,
    staleTime: 30_000,
    refetchInterval: 30_000,
    placeholderData: () => {
      // 대시보드 캐시에서 지수 기본 정보 즉시 활용
      const kr = qc.getQueryData<any>(["dashboard-kr", "시가총액"]);
      const idx = kr?.indices?.find((r: any) => r.index === indexName);
      if (idx) return idx;
      const us = qc.getQueryData<any>(["dashboard-us", "시가총액"]);
      return us?.indices?.find((r: any) => r.index === indexName);
    },
  });

  // 차트 전용: max 기간, 차트 탭이 활성화될 때만 fetch
  const { data: ohlcv, isLoading: loadingChart, refetch: refetchChart } = useQuery({
    queryKey: ["index-ohlcv", indexName, "max", candleType],
    queryFn: () => dashboardApi.getIndexOHLCV(indexName, "max", candleType),
    enabled: !!indexName && mainTab === "chart",
    staleTime: 300_000,
  });

  // 일별 전용: 개월 수에 따라 점진적으로 fetch (탭 전환 시에만 fetch)
  const { data: dailyRaw, isLoading: loadingDaily } = useQuery({
    queryKey: ["index-daily", indexName, dailyPeriod],
    queryFn: () => dashboardApi.getIndexOHLCV(indexName, dailyPeriod, "1d"),
    enabled: !!indexName && mainTab === "daily",
    staleTime: 300_000,
    placeholderData: (prev) => prev,
  });

  // 최신순으로 뒤집어 dailyMonths * 22행만 표시
  const dailyRows = useMemo(() => {
    if (!dailyRaw?.length) return [];
    return [...dailyRaw].reverse().slice(0, dailyMonths * ROWS_PER_MONTH);
  }, [dailyRaw, dailyMonths]);

  // 더보기 가능 여부: 표시 중인 행이 가져온 데이터보다 적거나, 아직 전체 기간이 아닌 경우
  const canLoadMore = !!dailyRaw && (dailyRows.length < dailyRaw.length || dailyPeriod !== "max");

  const isUp = (info?.change_rate ?? 0) >= 0;

  const fmt = (v: number | null | undefined) => {
    if (v == null) return "—";
    return meta.isKR
      ? v.toLocaleString("ko-KR", { maximumFractionDigits: 2 })
      : v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  };

  return (
    <div className="flex flex-col gap-5">
      {/* 헤더 */}
      <div className="flex items-center gap-3">
        <button onClick={()=>navigate(-1)} className="p-1.5 rounded-lg hover:bg-bg-elevated text-text-muted hover:text-text-primary transition-colors">
          <ArrowLeft size={18}/>
        </button>
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold font-mono text-text-primary">{info?.display_name ?? indexName}</h1>
            <span className={`text-2xs px-2 py-0.5 rounded border font-semibold ${
              meta.region==="국내"?"border-blue-700/50 text-blue-400 bg-blue-900/20":"border-green-700/50 text-green-400 bg-green-900/20"
            }`}>{meta.region}</span>
          </div>
          {meta.desc && <p className="text-text-muted text-xs mt-0.5">{meta.desc}</p>}
        </div>
      </div>

      {/* 현재값 */}
      {info && (
        <Card className="flex items-center gap-6 flex-wrap">
          <div>
            <div className="text-4xl font-mono font-bold text-text-primary num">{fmt(info.value)}</div>
            <div className="flex items-center gap-2 mt-1.5">
              {isUp?<TrendingUp size={14} className="text-accent-green"/>:<TrendingDown size={14} className="text-accent-red"/>}
              <ChangeBadge value={info.change ?? 0} suffix="" />
              <ChangeBadge value={info.change_rate ?? 0} />
              {(info as any)._demo && <span className="text-2xs px-1 py-0.5 rounded bg-accent-yellow/10 text-accent-yellow border border-accent-yellow/20">DEMO</span>}
            </div>
          </div>
          <button onClick={()=>{refetchInfo();if(mainTab==="chart")refetchChart();}} className="ml-auto p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors">
            <RefreshCw size={14}/>
          </button>
        </Card>
      )}

      {/* 탭 네비게이션 */}
      <div className="flex border-b border-border bg-bg-card rounded-t-xl overflow-x-auto scrollbar-hide">
        {[
          { id:"chart", label:"차트" },
          { id:"daily", label:"일별" },
        ].map(({ id, label }) => (
          <button key={id}
            onClick={() => setMainTab(id as any)}
            className={`flex items-center gap-1.5 px-4 py-3 text-xs font-semibold transition-all border-b-2 -mb-px whitespace-nowrap flex-shrink-0 ${
              mainTab === id
                ? "border-accent-blue text-accent-blue bg-accent-blue/5"
                : "border-transparent text-text-muted hover:text-text-primary hover:bg-bg-elevated"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 차트 탭 */}
      {mainTab==="chart" && (
      <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
        <div className="flex items-center justify-between px-4 pt-3 pb-2.5 border-b border-border flex-wrap gap-2">
          <span className="text-sm font-semibold text-text-primary">지수 차트</span>
          <div className="flex items-center gap-2 flex-wrap">
            {/* 봉 선택 */}
            <div className="flex gap-0.5 p-0.5 rounded-lg border border-border bg-bg-primary">
              {CANDLE_TYPES.map(ct=>(
                <button key={ct.value} onClick={()=>setCandleType(ct.value)}
                  className={`px-2.5 py-1 text-xs rounded-md font-semibold transition-all ${candleType===ct.value?"bg-accent-blue text-white":"text-text-muted hover:text-text-primary"}`}
                >{ct.label}</button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <button onClick={()=>refetchChart()} className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors">
                <RefreshCw size={13}/>
              </button>
              <button onClick={()=>setFullscreen(true)} className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors" title="전체보기">
                <Maximize2 size={13}/>
              </button>
            </div>
          </div>
        </div>
        <div>
          {loadingChart ? (
            <div className="h-[400px] flex items-center justify-center">
              <div className="w-8 h-8 border-2 border-accent-blue border-t-transparent rounded-full animate-spin"/>
            </div>
          ) : ohlcv?.length ? (
            <StockChart data={ohlcv} height={400} isKR={meta.isKR} />
          ) : (
            <div className="h-[400px] flex items-center justify-center text-text-muted text-sm">
              차트 데이터를 불러오는 중입니다...
            </div>
          )}
        </div>
      </div>
      )}

      {/* 일별 탭 */}
      {mainTab==="daily" && (
        <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-text-primary">일별 시세</span>
              {dailyRows.length > 0 && (
                <span className="text-2xs text-text-muted bg-bg-elevated px-1.5 py-0.5 rounded">
                  최근 {dailyMonths}개월
                </span>
              )}
            </div>
            {loadingDaily && <div className="w-4 h-4 border-2 border-accent-blue border-t-transparent rounded-full animate-spin"/>}
          </div>

          {loadingDaily && !dailyRaw ? (
            /* 초기 로딩 스켈레톤 */
            <div className="animate-pulse">
              {Array.from({ length: 10 }, (_, i) => (
                <div key={i} className="flex gap-4 px-4 py-2.5 border-b border-border/30">
                  <div className="h-3 bg-bg-elevated rounded w-20" />
                  <div className="h-3 bg-bg-elevated rounded w-24 ml-auto" />
                  <div className="h-3 bg-bg-elevated rounded w-14" />
                  <div className="h-3 bg-bg-elevated rounded w-14" />
                  <div className="h-3 bg-bg-elevated rounded w-14" />
                </div>
              ))}
            </div>
          ) : !dailyRows.length ? (
            <div className="py-12 text-center text-text-muted text-sm">데이터 없음</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-text-muted border-b border-border bg-bg-secondary">
                      <th className="text-left px-4 py-2.5 font-medium whitespace-nowrap sticky left-0 bg-bg-secondary">날짜</th>
                      <th className="text-right px-3 py-2.5 font-medium whitespace-nowrap">종가(포인트)</th>
                      <th className="text-right px-3 py-2.5 font-medium whitespace-nowrap">등락률</th>
                      <th className="text-right px-3 py-2.5 font-medium whitespace-nowrap">고가</th>
                      <th className="text-right px-3 py-2.5 font-medium whitespace-nowrap pr-4">저가</th>
                      <th className="text-right px-3 py-2.5 font-medium whitespace-nowrap pr-4">거래량</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dailyRows.map((bar: any, i: number) => {
                      const prevClose = dailyRows[i + 1]?.close;
                      const chgRate = prevClose ? ((bar.close - prevClose) / prevClose * 100) : 0;
                      const isPos = chgRate >= 0;
                      const fmtPt = (v: number | null | undefined) =>
                        v == null ? "—" : v.toLocaleString(meta.isKR ? "ko-KR" : "en-US", { maximumFractionDigits: 2 });
                      return (
                        <tr key={bar.date} className="border-b border-border/30 hover:bg-bg-hover">
                          <td className="px-4 py-2.5 font-mono text-text-muted whitespace-nowrap sticky left-0 bg-bg-card">{bar.date?.slice(0,10)}</td>
                          <td className="px-3 py-2.5 text-right font-mono font-semibold text-text-primary whitespace-nowrap">
                            {fmtPt(bar.close)}
                          </td>
                          <td className={`px-3 py-2.5 text-right font-mono whitespace-nowrap ${prevClose ? (isPos ? "text-accent-green" : "text-accent-red") : "text-text-muted"}`}>
                            {prevClose ? `${isPos?"+":""}${chgRate.toFixed(2)}%` : "—"}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-accent-red/80 whitespace-nowrap">
                            {fmtPt(bar.high)}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-accent-blue/80 whitespace-nowrap pr-4">
                            {fmtPt(bar.low)}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-text-muted whitespace-nowrap pr-4">
                            {bar.volume ? (bar.volume >= 1e8 ? `${(bar.volume/1e8).toFixed(1)}억` : bar.volume >= 1e4 ? `${(bar.volume/1e4).toFixed(1)}만` : bar.volume.toLocaleString()) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* 더보기 / 로딩 버튼 */}
              {canLoadMore ? (
                <button
                  onClick={() => setDailyMonths(prev => prev + 1)}
                  disabled={loadingDaily}
                  className="w-full py-3 flex items-center justify-center gap-1.5 text-xs font-semibold text-text-muted hover:text-accent-blue hover:bg-bg-elevated transition-all border-t border-border disabled:opacity-50"
                >
                  {loadingDaily
                    ? <><div className="w-3.5 h-3.5 border-2 border-accent-blue border-t-transparent rounded-full animate-spin" /><span>불러오는 중...</span></>
                    : <><ChevronDown size={13} /><span>1개월 더 보기</span></>
                  }
                </button>
              ) : (
                <div className="py-2.5 text-center text-2xs text-text-dim border-t border-border">
                  전체 {dailyRows.length}일 표시 중
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* 전체보기 모달 */}
      {mainTab==="chart" && fullscreen && ohlcv?.length && (
        <div className="fixed inset-0 z-50 bg-bg-base flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-bg-card flex-shrink-0">
            <div className="flex items-center gap-3">
              <span className="font-bold text-text-primary">{info?.display_name ?? indexName}</span>
              <div className="flex gap-0.5 p-0.5 rounded-lg border border-border bg-bg-primary">
                {CANDLE_TYPES.map(ct=>(
                  <button key={ct.value} onClick={()=>setCandleType(ct.value)}
                    className={`px-2.5 py-1 text-xs rounded-md font-semibold transition-all ${candleType===ct.value?"bg-accent-blue text-white":"text-text-muted hover:text-text-primary"}`}
                  >{ct.label}</button>
                ))}
              </div>
            </div>
            <button onClick={()=>setFullscreen(false)} className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors">
              <X size={18}/>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <StockChart data={ohlcv} height={window.innerHeight - 96} isKR={meta.isKR}/>
          </div>
        </div>
      )}

      {/* 기간 요약 */}
      {mainTab==="chart" && ohlcv?.length > 1 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label:"기간 시작", value: ohlcv[0]?.close },
            { label:"현재",     value: ohlcv[ohlcv.length-1]?.close },
            { label:"기간 최고",value: Math.max(...ohlcv.map((d:any)=>d.high)) },
            { label:"기간 최저",value: Math.min(...ohlcv.map((d:any)=>d.low)) },
          ].map(item=>{
            const pct = item.label==="현재"&&ohlcv[0]?.close
              ? ((item.value-ohlcv[0].close)/ohlcv[0].close*100) : null;
            return (
              <Card key={item.label} className="text-center py-3">
                <div className="text-2xs text-text-muted mb-1">{item.label}</div>
                <div className="text-lg font-mono font-bold text-text-primary num">{fmt(item.value)}</div>
                {pct!=null && <ChangeBadge value={pct} className="text-sm mt-0.5"/>}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
