import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { dashboardApi } from "@/api/stocks";
import { Card, ChangeBadge } from "@/components/ui";
import { ArrowLeft, TrendingUp, TrendingDown, RefreshCw } from "lucide-react";
import StockChart from "@/components/chart/StockChart";

const PERIODS = [
  { label:"1달",  value:"1mo"  },
  { label:"3달",  value:"3mo"  },
  { label:"6달",  value:"6mo"  },
  { label:"1년",  value:"1y"   },
  { label:"2년",  value:"2y"   },
  { label:"3년",  value:"3y"   },
  { label:"5년",  value:"5y"   },
  { label:"10년", value:"10y"  },
  { label:"최대", value:"max"  },
];

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

export default function IndexDetail() {
  const { name }  = useParams<{ name: string }>();
  const navigate  = useNavigate();
  const [period, setPeriod]         = useState("1y");
  const [candleType, setCandleType] = useState("1d");

  const indexName = name?.toUpperCase() ?? "";
  const meta      = INDEX_INFO[indexName] ?? { region:"—", desc:"", isKR:false };

  const { data: info, refetch: refetchInfo } = useQuery({
    queryKey: ["index-detail", indexName],
    queryFn: () => dashboardApi.getIndexDetail(indexName),
    enabled: !!indexName,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const { data: ohlcv, isLoading: loadingChart, refetch: refetchChart } = useQuery({
    queryKey: ["index-ohlcv", indexName, period],
    queryFn: () => dashboardApi.getIndexOHLCV(indexName, period),
    enabled: !!indexName,
    staleTime: 300_000,
  });

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
          <button onClick={()=>{refetchInfo();refetchChart();}} className="ml-auto p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors">
            <RefreshCw size={14}/>
          </button>
        </Card>
      )}

      {/* 차트 */}
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
            <div className="w-px h-4 bg-border"/>
            {/* 기간 */}
            <div className="flex gap-0.5 p-0.5 rounded-lg border border-border bg-bg-primary flex-wrap">
              {PERIODS.map(p=>(
                <button key={p.value} onClick={()=>setPeriod(p.value)}
                  className={`px-2.5 py-1 text-xs rounded-md font-medium transition-all ${period===p.value?"bg-accent-blue text-white shadow":"text-text-muted hover:text-text-primary"}`}
                >{p.label}</button>
              ))}
            </div>
            <button onClick={()=>refetchChart()} className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors">
              <RefreshCw size={13}/>
            </button>
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

      {/* 기간 요약 */}
      {ohlcv?.length > 1 && (
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
