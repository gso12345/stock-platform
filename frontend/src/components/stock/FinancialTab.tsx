import React from "react";

/**
 * 종목 상세의 재무제표 탭 — 가장 큰 덩어리였다(617줄).
 *
 * 한 파일이 3,173줄이라, 이 표의 칸 하나를 고치려 해도 여덟 탭이 든
 * 파일 전체를 건드려야 했다. 차트만 보고 나가는 사람도 이 코드를 다
 * 받았다.
 *
 * 훅이 하나도 없는 순수 렌더라 그대로 떼어 낼 수 있었다. 필요한 값은
 * 전부 인자로 받는다 — 하나라도 빠지면 빌드가 짚어 준다. 화면을 눈으로
 * 볼 수 없는 상태에서 옮기는 것이라 '컴파일이 곧 검증' 이 되게 했다.
 * 안은 한 줄도 바꾸지 않았다.
 */
import { fmtKRW, fmtUSD, fmtNum } from "@/utils/formatters";
import { 격자, 축, 툴팁 } from "@/utils/chartTheme";
import { Settings2, X } from "lucide-react";
import 차트틀 from "@/components/chart/ChartFrame";
import { FIN_CUSTOM_OPTS } from "@/constants/finMetrics";
import { StatCell, PeriodToggle, TransTable } from "@/components/stock/DetailBits";
import MetricManagerModal from "@/components/stock/MetricManagerModal";

export default function 재무제표탭({
  customMetricKeys, d, exchangeRate, finPeriod, finSubTab, finTabData, financials, isKR, isMobile, loadingFin, selectedMetric, setFinPeriod, setSelectedMetric, setShowCustomSelector, setShowKRW, showCustomSelector, showKRW, updateCustomMetricKeys,
}: {
  customMetricKeys: string[];
  /* detail 을 any 로 본 것. 본문이 이미 만들어 둔 것을 그대로 받는다 */
  d: any;
  exchangeRate: number;
  finPeriod: "annual" | "quarterly";
  finSubTab: string;
  finTabData: any;
  financials: any;
  isKR: boolean;
  isMobile: boolean;
  loadingFin: boolean;
  selectedMetric: string;
  setFinPeriod: React.Dispatch<React.SetStateAction<"annual" | "quarterly">>;
  setSelectedMetric: React.Dispatch<React.SetStateAction<string>>;
  setShowCustomSelector: React.Dispatch<React.SetStateAction<boolean>>;
  setShowKRW: React.Dispatch<React.SetStateAction<boolean>>;
  showCustomSelector: boolean;
  showKRW: boolean;
  updateCustomMetricKeys: (keys: string[]) => void;
}) {
    const { mh, dEnhanced, mhYears, allYears, getVal } = finTabData;

    // 재무제표 통화 포맷 (showKRW 토글 반영)
    const fmtFin = (v: number | null | undefined): string => {
      if (v == null) return "—";
      if (isKR) return fmtKRW(v);
      if (showKRW) return fmtKRW(v * exchangeRate);
      return fmtUSD(v);
    };

    // stat cell용 금액 포맷 (showKRW 토글 반영, null 반환)
    const fmtFinVal = (v: number | null | undefined): string | null => {
      if (v == null) return null;
      if (isKR) return fmtKRW(v);
      if (showKRW) return fmtKRW(v * exchangeRate);
      return fmtUSD(v);
    };

    // EPS/BPS 등 주당 지표 포맷 — fmtKRW("3만"처럼 만 단위로 축약)를 쓰지 않고
    // 원 단위까지 정확하게 표기 (예: 34,292원)
    const fmtEpsBps = (v: number | null | undefined): string | null => {
      if (v == null) return null;
      if (isKR) return `₩${Math.round(v).toLocaleString("ko-KR")}`;
      if (showKRW) return `₩${Math.round(v * exchangeRate).toLocaleString("ko-KR")}`;
      return fmtUSD(v);
    };

    // 반응형 차트 높이 (모바일 compact, PC 표준)
    const chartH   = isMobile ? 220 : 300;
    const chartHSm = isMobile ? 185 : 240;

    // 공통 차트 옵션
    const chartProps = {
      /* margin 은 반드시 margin={...} 로 넘긴다.
         예전에는 {...chartProps.margin} 으로 펼쳐서 넘겼다. 그러면 recharts 가
         모르는 top/right/left/bottom 이 각각 prop 으로 들어가고 정작 margin 은
         안 들어간다 — 차트 11개의 여백이 한 번도 적용된 적이 없었다.
         `as any` 가 붙어 있어서 타입 검사도 이걸 못 잡았으므로 떼어 둔다. */
      margin: {top:8,right:12,left:4,bottom:4},
      /* 축·격자·툴팁 색은 테마 토큰에서 읽는다. 예전에는 다크 값을 손으로
         적어 두어 라이트 모드에서 차트만 어둡게 남았다 (utils/chartTheme) */
      cartesianGridProps: 격자,
      xAxisProps: 축 as any,
      yAxisProps: { ...축, width: isMobile ? 46 : 58 } as any,
      tooltipProps: 툴팁 as any,
    };

    return (
      <div className="flex flex-col gap-4">

      {/* 원화 환산 토글 (US 종목만) */}
      {!isKR && (
        <div className="flex justify-end">
          <button
            aria-pressed={showKRW} onClick={() => setShowKRW(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-lg border transition-all ${
              showKRW
                ? "bg-accent-blue/20 border-accent-blue/50 text-accent-blue"
                : "border-border text-text-muted hover:text-text-primary hover:border-accent-blue/40"
            }`}
          >
            ₩ 원화
            {showKRW && <span className="text-2xs text-text-muted">(1USD≈{exchangeRate.toLocaleString("ko-KR")}₩)</span>}
          </button>
        </div>
      )}

      {/* ── 손익계산서 ── */}
      {finSubTab==="income" && (
        <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="text-base font-semibold text-text-primary">손익계산서</span>
            <PeriodToggle finPeriod={finPeriod} setFinPeriod={setFinPeriod} />
          </div>
          {loadingFin ? (
            <div className="flex justify-center py-12"><div className="w-8 h-8 border-2 border-accent-blue border-t-transparent rounded-full animate-spin"/></div>
          ) : (
            <div className="p-4 flex flex-col gap-4">
              {/* 차트 */}
              {financials&&(financials[finPeriod]?.length??0)>0 && (() => {
                const finData = (financials[finPeriod] as any[]).filter((r:any) => r.revenue != null || r.op_income != null || r.net_income != null);
                if (!finData.length) return null;
                return (
                <차트틀 height={chartH}>
                  {(R) => (
                    <R.BarChart data={finData} margin={chartProps.margin}>
                      <R.CartesianGrid {...chartProps.cartesianGridProps}/>
                      <R.XAxis dataKey="period" {...chartProps.xAxisProps} tickFormatter={(v:string)=>v.slice(0,finPeriod==="quarterly"?7:4)}/>
                      <R.YAxis {...chartProps.yAxisProps} tickFormatter={(v:number)=>{const a=Math.abs(v);return isKR?(a>=1e12?(v/1e12).toFixed(0)+"조":a>=1e8?(v/1e8).toFixed(0)+"억":String(v)):(a>=1e9?(v/1e9).toFixed(0)+"B":a>=1e6?(v/1e6).toFixed(0)+"M":String(v));}}/>
                      <R.Tooltip {...chartProps.tooltipProps} formatter={(v:number,name:string)=>{const l:Record<string,string>={revenue:"매출",op_income:"영업이익",net_income:"당기순이익"};return[fmtFin(v),l[name]??name];}}/>
                      <R.Legend formatter={v=>({revenue:"매출",op_income:"영업이익",net_income:"당기순이익"}[v as string]??v)}/>
                      <R.Bar dataKey="revenue" fill="#3b82f6" radius={[2,2,0,0]} maxBarSize={35}/>
                      <R.Bar dataKey="op_income" fill="#10b981" radius={[2,2,0,0]} maxBarSize={35}/>
                      <R.Bar dataKey="net_income" fill="#8b5cf6" radius={[2,2,0,0]} maxBarSize={35}/>
                    </R.BarChart>
                  )}
                </차트틀>
                );
              })()}
              {/* 전치 테이블 */}
              <TransTable rows={[
                { key:"revenue",          label:"매출",         fmt:(v)=>fmtFin(v), color:"text-accent-blue" },
                { key:"revenue_growth",   label:"매출성장률",   fmt:(v)=>`${v.toFixed(1)}%`, color: "text-accent-blue" },
                { key:"op_income",        label:"영업이익",     fmt:(v)=>fmtFin(v), color:"text-accent-green" },
                { key:"op_income_growth", label:"영업이익성장률",fmt:(v)=>`${v.toFixed(1)}%`, color:"text-accent-green" },
                { key:"net_income",       label:"당기순이익",   fmt:(v)=>fmtFin(v), color:"text-accent-purple" },
                { key:"net_income_growth",label:"순이익성장률", fmt:(v)=>`${v.toFixed(1)}%`, color:"text-accent-purple" },
                { key:"op_margin",        label:"영업이익률",   fmt:(v)=>`${v.toFixed(1)}%`, color:"text-text-secondary" },
                { key:"net_margin",       label:"순이익률",     fmt:(v)=>`${v.toFixed(1)}%`, color:"text-text-secondary" },
                { key:"eps",              label:"EPS",          fmt:(v)=>fmtEpsBps(v)!, color:"text-accent-cyan" },
                /* 백엔드가 매출·영업이익·순이익과 함께 eps_growth 도
                   만들어 보내는데(_add_growth) 표에는 없었다. 주당 이익이
                   얼마나 늘었는지가 정작 주주에게 가장 가까운 숫자다 */
                { key:"eps_growth",       label:"EPS성장률",    fmt:(v)=>`${v.toFixed(1)}%`, color:"text-accent-cyan" },
              ]} allYears={allYears} getVal={getVal} finPeriod={finPeriod} />
            </div>
          )}
        </div>
      )}

      {/* ── 밸류에이션 ── */}
      {finSubTab==="valuation" && (
        <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="text-base font-semibold text-text-primary">밸류에이션</span>
            <PeriodToggle finPeriod={finPeriod} setFinPeriod={setFinPeriod} />
          </div>
          <div className="p-4 flex flex-col gap-4">
            {/* 현재 지표 — detail 없으면 metricsHistory 최신값 사용 */}
            {d && (
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                <StatCell label="PER(현재)"    value={dEnhanced.per          != null ? `${fmtNum(dEnhanced.per)}배` : null} />
                <StatCell label="PER(선행)"    value={dEnhanced.forward_per  != null ? `${fmtNum(dEnhanced.forward_per)}배` : null} />
                <StatCell label="EPS(선행)"    value={fmtEpsBps(dEnhanced.forward_eps)} />
                <StatCell label="PEG"          value={dEnhanced.peg          != null ? fmtNum(dEnhanced.peg, 2) : null} />
                <StatCell label="PBR"          value={dEnhanced.pbr          != null ? `${fmtNum(dEnhanced.pbr,2)}배` : null} />
                <StatCell label="PSR"          value={dEnhanced.psr          != null ? `${fmtNum(dEnhanced.psr,2)}배` : null} />
                <StatCell label="EV/EBITDA"    value={dEnhanced.ev_ebitda    != null ? `${fmtNum(dEnhanced.ev_ebitda,1)}배` : null} />
                <StatCell label="시가총액"     value={fmtFinVal(d.market_cap)} />
                <StatCell label="기업가치(EV)" value={fmtFinVal(dEnhanced.enterprise_value)} />
              </div>
            )}
            {/* PER/PBR 연도별 차트 — PER/PBR 없으면 EPS 차트, mh 비어있으면 dEnhanced로 단일 포인트 */}
            {(() => {
              const hasMultiple = mh.some((r:any) => r.per != null || r.pbr != null);
              const hasEps = mh.some((r:any) => r.eps != null);
              // mh가 비어있어도 dEnhanced에 값이 있으면 단일 포인트로 차트 표시
              if (!hasMultiple && !hasEps) {
                const hasDEnhancedValuation = dEnhanced.per != null || dEnhanced.pbr != null || dEnhanced.eps != null;
                if (!hasDEnhancedValuation) return null;
                const singlePoint = [{
                  period: "현재",
                  per: dEnhanced.per,
                  pbr: dEnhanced.pbr,
                  psr: dEnhanced.psr,
                  eps: dEnhanced.eps,
                }];
                if (dEnhanced.per != null || dEnhanced.pbr != null) {
                  return (
                    <차트틀 height={chartHSm}>
                      {(R) => (
                        <R.BarChart data={singlePoint} margin={chartProps.margin}>
                          <R.CartesianGrid {...chartProps.cartesianGridProps}/>
                          <R.XAxis dataKey="period" {...chartProps.xAxisProps}/>
                          <R.YAxis {...chartProps.yAxisProps}/>
                          <R.Tooltip {...chartProps.tooltipProps} formatter={(v:number,n:string)=>[Number(v).toFixed(2),{per:"PER",pbr:"PBR",psr:"PSR"}[n]??n]}/>
                          <R.Legend formatter={v=>({per:"PER",pbr:"PBR",psr:"PSR"}[v as string]??v)}/>
                          {dEnhanced.per!=null&&<R.Bar dataKey="per" fill="#3b82f6" radius={[2,2,0,0]} maxBarSize={25}/>}
                          {dEnhanced.pbr!=null&&<R.Bar dataKey="pbr" fill="#10b981" radius={[2,2,0,0]} maxBarSize={25}/>}
                          {dEnhanced.psr!=null&&<R.Bar dataKey="psr" fill="#8b5cf6" radius={[2,2,0,0]} maxBarSize={25}/>}
                        </R.BarChart>
                      )}
                    </차트틀>
                  );
                }
                if (dEnhanced.eps != null) {
                  return (
                    <차트틀 height={chartHSm}>
                      {(R) => (
                        <R.BarChart data={singlePoint.filter(r=>r.eps!=null)} margin={chartProps.margin}>
                          <R.CartesianGrid {...chartProps.cartesianGridProps}/>
                          <R.XAxis dataKey="period" {...chartProps.xAxisProps}/>
                          <R.YAxis {...chartProps.yAxisProps} tickFormatter={(v:number)=>fmtEpsBps(v)!}/>
                          <R.Tooltip {...chartProps.tooltipProps} formatter={(v:number)=>[fmtEpsBps(v)!,"EPS"]}/>
                          <R.Bar dataKey="eps" fill="#06b6d4" radius={[2,2,0,0]} maxBarSize={35}/>
                        </R.BarChart>
                      )}
                    </차트틀>
                  );
                }
                return null;
              }
              if (hasMultiple) {
                return (
                  <차트틀 height={chartHSm}>
                    {(R) => (
                      <R.BarChart data={mh} margin={chartProps.margin}>
                        <R.CartesianGrid {...chartProps.cartesianGridProps}/>
                        <R.XAxis dataKey="period" {...chartProps.xAxisProps} tickFormatter={(v:string)=>v.slice(0,finPeriod==="quarterly"?7:4)}/>
                        <R.YAxis {...chartProps.yAxisProps}/>
                        <R.Tooltip {...chartProps.tooltipProps} formatter={(v:number,n:string)=>[Number(v).toFixed(2),{per:"PER",pbr:"PBR",psr:"PSR"}[n]??n]}/>
                        <R.Legend formatter={v=>({per:"PER",pbr:"PBR",psr:"PSR"}[v as string]??v)}/>
                        <R.Bar dataKey="per" fill="#3b82f6" radius={[2,2,0,0]} maxBarSize={25}/>
                        <R.Bar dataKey="pbr" fill="#10b981" radius={[2,2,0,0]} maxBarSize={25}/>
                        <R.Bar dataKey="psr" fill="#8b5cf6" radius={[2,2,0,0]} maxBarSize={25}/>
                      </R.BarChart>
                    )}
                  </차트틀>
                );
              }
              // EPS 차트 (PER/PBR 없을 때)
              return (
                <차트틀 height={chartHSm}>
                  {(R) => (
                    <R.BarChart data={mh.filter((r:any)=>r.eps!=null)} margin={chartProps.margin}>
                      <R.CartesianGrid {...chartProps.cartesianGridProps}/>
                      <R.XAxis dataKey="period" {...chartProps.xAxisProps} tickFormatter={(v:string)=>v.slice(0,finPeriod==="quarterly"?7:4)}/>
                      <R.YAxis {...chartProps.yAxisProps} tickFormatter={(v:number)=>fmtEpsBps(v)!}/>
                      <R.Tooltip {...chartProps.tooltipProps} formatter={(v:number)=>[fmtEpsBps(v)!,"EPS"]}/>
                      <R.Bar dataKey="eps" fill="#06b6d4" radius={[2,2,0,0]} maxBarSize={35}/>
                    </R.BarChart>
                  )}
                </차트틀>
              );
            })()}
            {/* 전치 테이블 */}
            <TransTable rows={[
              { key:"per",  label:"PER",        fmt:(v)=>`${v.toFixed(1)}배`, color:"text-accent-blue" },
              { key:"pbr",  label:"PBR",        fmt:(v)=>`${v.toFixed(2)}배`, color:"text-accent-green" },
              { key:"psr",  label:"PSR",        fmt:(v)=>`${v.toFixed(2)}배`, color:"text-accent-purple" },
              { key:"eps",  label:"EPS",  fmt:(v)=>fmtEpsBps(v)!, color:"text-accent-cyan" },
              { key:"bps",  label:"BPS",  fmt:(v)=>fmtEpsBps(v)!, color:"text-text-secondary" },
            ]} allYears={allYears} getVal={getVal} finPeriod={finPeriod} />
          </div>
        </div>
      )}

      {/* ── 기본 (수익성 + 종합 지표) ── */}
      {finSubTab==="basic" && (
        <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="text-base font-semibold text-text-primary">기본 지표</span>
            <PeriodToggle finPeriod={finPeriod} setFinPeriod={setFinPeriod} />
          </div>
          <div className="p-4 flex flex-col gap-4">{(() => {
            const BASIC_METRICS = [
              { key:"revenue",       label:"매출",         color:"#3b82f6", pct:false },
              { key:"op_income",     label:"영업이익",     color:"#10b981", pct:false },
              { key:"net_income",    label:"당기순이익",   color:"#8b5cf6", pct:false },
              { key:"gross_margin",  label:"매출총이익률", color:"#3b82f6", pct:true  },
              { key:"op_margin",     label:"영업이익률",   color:"#10b981", pct:true  },
              { key:"net_margin",    label:"순이익률",     color:"#8b5cf6", pct:true  },
              { key:"roe",           label:"ROE",          color:"#f59e0b", pct:true  },
              { key:"debt_ratio",    label:"부채비율",     color:"#ef4444", pct:true  },
              { key:"current_ratio", label:"유동비율",     color:"#10b981", pct:false },
            ];
            const curr = BASIC_METRICS.find(m => m.key === selectedMetric) ?? BASIC_METRICS[0];
            const chartData = mh.filter((r:any) => r[selectedMetric] != null);
            return (<>
              {/* 지표 선택 버튼 */}
              <div className="flex flex-wrap gap-1">
                {BASIC_METRICS.map(m=>(
                  <button key={m.key} onClick={()=>setSelectedMetric(m.key)}
                    className={`px-2.5 py-1 text-sm rounded-lg font-semibold border transition-all ${selectedMetric===m.key?"text-white border-transparent":"border-border text-text-muted hover:text-text-primary"}`}
                    style={selectedMetric===m.key?{background:m.color+"cc",borderColor:m.color}:{}}
                  >{m.label}</button>
                ))}
              </div>
              {/* 선택 지표 차트 */}
              {chartData.length > 0 ? (
                <차트틀 height={chartH}>
                  {(R) => (
                    <R.BarChart data={chartData} margin={chartProps.margin}>
                      <R.CartesianGrid {...chartProps.cartesianGridProps}/>
                      <R.XAxis dataKey="period" {...chartProps.xAxisProps} tickFormatter={(v:string)=>v.slice(0,finPeriod==="quarterly"?7:4)}/>
                      <R.YAxis {...chartProps.yAxisProps} tickFormatter={(v:number)=>curr.pct?`${v}%`:fmtFin(v)}/>
                      <R.Tooltip {...chartProps.tooltipProps} formatter={(v:number)=>[curr.pct?`${Number(v).toFixed(1)}%`:(fmtFin(v)), curr.label]}/>
                      <R.Bar dataKey={selectedMetric} fill={curr.color} radius={[3,3,0,0]} maxBarSize={50}/>
                    </R.BarChart>
                  )}
                </차트틀>
              ) : <p className="text-text-muted text-base py-4 text-center">연결 중...</p>}
              {/* 전치 테이블 */}
              <TransTable rows={BASIC_METRICS.map(m=>({
                key: m.key,
                label: m.label,
                fmt: (v:number) => m.pct ? `${v.toFixed(1)}%` : (m.key==="current_ratio"||m.key==="quick_ratio" ? `${(v*100).toFixed(0)}%` : (fmtFin(v))),
                color: "text-text-secondary",
              }))} allYears={allYears} getVal={getVal} finPeriod={finPeriod} />
            </>);
          })()}
          </div>
        </div>
      )}

      {/* ── 수익성 ── */}
      {finSubTab==="profitability" && (
        <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="text-base font-semibold text-text-primary">수익성</span>
            <PeriodToggle finPeriod={finPeriod} setFinPeriod={setFinPeriod} />
          </div>
          <div className="p-4 flex flex-col gap-4">
            {d && (
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                <StatCell label="ROE" value={dEnhanced.roe!=null?`${dEnhanced.roe.toFixed(1)}%`:null}
                  color={dEnhanced.roe!=null?(dEnhanced.roe>=15?"text-accent-green":dEnhanced.roe<0?"text-accent-red":"text-text-primary"):undefined}/>
                <StatCell label="매출총이익률" value={dEnhanced.gross_margin!=null?`${dEnhanced.gross_margin.toFixed(1)}%`:null}/>
                <StatCell label="영업이익률" value={dEnhanced.op_margin!=null?`${dEnhanced.op_margin.toFixed(1)}%`:null}
                  color={dEnhanced.op_margin!=null?(dEnhanced.op_margin>=15?"text-accent-green":dEnhanced.op_margin<0?"text-accent-red":"text-text-primary"):undefined}/>
                <StatCell label="순이익률" value={dEnhanced.net_margin!=null?`${dEnhanced.net_margin.toFixed(1)}%`:null}/>
                <StatCell label="EPS" value={fmtEpsBps(dEnhanced.eps)}/>
                <StatCell label="선행EPS" value={fmtEpsBps(dEnhanced.forward_eps)}/>
              </div>
            )}
            {mhYears.length > 0 && (
              <차트틀 height={chartHSm}>
                {(R) => (
                  <R.BarChart data={mh.filter((r:any)=>r.op_margin||r.net_margin)} margin={chartProps.margin}>
                    <R.CartesianGrid {...chartProps.cartesianGridProps}/>
                    <R.XAxis dataKey="period" {...chartProps.xAxisProps} tickFormatter={(v:string)=>v.slice(0,finPeriod==="quarterly"?7:4)}/>
                    <R.YAxis {...chartProps.yAxisProps} tickFormatter={(v:number)=>`${v}%`}/>
                    <R.Tooltip {...chartProps.tooltipProps} formatter={(v:number,n:string)=>[`${Number(v).toFixed(1)}%`,{gross_margin:"매출총이익률",op_margin:"영업이익률",net_margin:"순이익률"}[n]??n]}/>
                    <R.Legend formatter={v=>({gross_margin:"매출총이익률",op_margin:"영업이익률",net_margin:"순이익률"}[v as string]??v)}/>
                    <R.Bar dataKey="gross_margin" fill="#3b82f6" radius={[2,2,0,0]} maxBarSize={20}/>
                    <R.Bar dataKey="op_margin"    fill="#10b981" radius={[2,2,0,0]} maxBarSize={20}/>
                    <R.Bar dataKey="net_margin"   fill="#8b5cf6" radius={[2,2,0,0]} maxBarSize={20}/>
                  </R.BarChart>
                )}
              </차트틀>
            )}
            <TransTable rows={[
              { key:"gross_margin", label:"매출총이익률", fmt:(v)=>`${v.toFixed(1)}%`, color:"text-accent-blue" },
              { key:"op_margin",    label:"영업이익률",   fmt:(v)=>`${v.toFixed(1)}%`, color:"text-accent-green" },
              { key:"net_margin",   label:"순이익률",     fmt:(v)=>`${v.toFixed(1)}%`, color:"text-accent-purple" },
              { key:"roe",          label:"ROE",          fmt:(v)=>`${v.toFixed(1)}%`, color:"text-accent-yellow" },
              { key:"roa",          label:"ROA",          fmt:(v)=>`${v.toFixed(1)}%`, color:"text-accent-cyan" },
              { key:"eps",          label:"EPS",          fmt:(v)=>fmtEpsBps(v)!, color:"text-accent-cyan" },
            ]} allYears={allYears} getVal={getVal} finPeriod={finPeriod} />
          </div>
        </div>
      )}

      {/* ── 재무건전성 ── */}
      {finSubTab==="health" && (
        <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="text-base font-semibold text-text-primary">재무건전성</span>
            <PeriodToggle finPeriod={finPeriod} setFinPeriod={setFinPeriod} />
          </div>
          <div className="p-4 flex flex-col gap-4">
            {/* 현재 지표 */}
            {d && (
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                <StatCell label="부채비율"  value={dEnhanced.debt_ratio!=null?`${dEnhanced.debt_ratio.toFixed(0)}%`:null}
                  color={dEnhanced.debt_ratio!=null?(dEnhanced.debt_ratio>200?"text-accent-red":dEnhanced.debt_ratio<100?"text-accent-green":"text-text-primary"):undefined}/>
                <StatCell label="유동비율"  value={dEnhanced.current_ratio!=null?`${(dEnhanced.current_ratio*100).toFixed(0)}%`:null}
                  color={dEnhanced.current_ratio!=null?(dEnhanced.current_ratio>=2?"text-accent-green":dEnhanced.current_ratio<1?"text-accent-red":"text-text-primary"):undefined}/>
                <StatCell label="당좌비율"  value={dEnhanced.quick_ratio!=null?`${(dEnhanced.quick_ratio*100).toFixed(0)}%`:null}/>
                <StatCell label="배당수익률" value={d.dividend_yield!=null?`${d.dividend_yield.toFixed(2)}%`:null} color="text-accent-green"/>
                <StatCell label="배당성향"  value={dEnhanced.payout_ratio!=null?`${dEnhanced.payout_ratio.toFixed(1)}%`:null}/>
                <StatCell label="베타"      value={dEnhanced.beta!=null?dEnhanced.beta.toFixed(2):null}
                  color={dEnhanced.beta!=null?(dEnhanced.beta>1.5?"text-accent-red":dEnhanced.beta<0.5?"text-accent-green":"text-text-primary"):undefined}/>
              </div>
            )}
            {/* 차트 */}
            {mhYears.length > 0 && (
              <차트틀 height={chartHSm}>
                {(R) => (
                  <R.BarChart data={mh.filter((r:any)=>r.debt_ratio||r.current_ratio)} margin={chartProps.margin}>
                    <R.CartesianGrid {...chartProps.cartesianGridProps}/>
                    <R.XAxis dataKey="period" {...chartProps.xAxisProps} tickFormatter={(v:string)=>v.slice(0,finPeriod==="quarterly"?7:4)}/>
                    <R.YAxis yAxisId="ratio" {...chartProps.yAxisProps} tickFormatter={(v:number)=>`${(v*100).toFixed(0)}%`}/>
                    <R.YAxis yAxisId="pct" orientation="right" {...chartProps.yAxisProps} tickFormatter={(v:number)=>`${v}%`}/>
                    <R.Tooltip {...chartProps.tooltipProps} formatter={(v:number,n:string)=>{const l:Record<string,string>={current_ratio:"유동비율",quick_ratio:"당좌비율",debt_ratio:"부채비율(%)"};return[n==="debt_ratio"?`${Number(v).toFixed(0)}%`:(n==="current_ratio"||n==="quick_ratio")?`${(Number(v)*100).toFixed(0)}%`:Number(v).toFixed(2),l[n]??n];}}/>
                    <R.Legend formatter={v=>({current_ratio:"유동비율",quick_ratio:"당좌비율",debt_ratio:"부채비율(%)"}[v as string]??v)}/>
                    <R.Bar yAxisId="ratio" dataKey="current_ratio" fill="#10b981" radius={[2,2,0,0]} maxBarSize={20}/>
                    <R.Bar yAxisId="ratio" dataKey="quick_ratio"   fill="#3b82f6" radius={[2,2,0,0]} maxBarSize={20}/>
                    <R.Bar yAxisId="pct"   dataKey="debt_ratio"    fill="#ef4444" radius={[2,2,0,0]} maxBarSize={20}/>
                  </R.BarChart>
                )}
              </차트틀>
            )}
            {/* 전치 테이블 */}
            <TransTable rows={[
              { key:"debt_ratio",    label:"부채비율",   fmt:(v)=>`${v.toFixed(0)}%`,        color:"text-accent-red" },
              { key:"current_ratio", label:"유동비율",   fmt:(v)=>`${(v*100).toFixed(0)}%`,  color:"text-accent-green" },
              { key:"quick_ratio",   label:"당좌비율",   fmt:(v)=>`${(v*100).toFixed(0)}%`,  color:"text-accent-blue" },
            ]} allYears={allYears} getVal={getVal} finPeriod={finPeriod} />
          </div>
        </div>
      )}

      {/* ── 현금흐름 ── */}
      {finSubTab==="cashflow" && (
        <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="text-base font-semibold text-text-primary">현금흐름</span>
            <PeriodToggle finPeriod={finPeriod} setFinPeriod={setFinPeriod} />
          </div>
          <div className="p-4 flex flex-col gap-4">
            {/* 현금흐름 바 차트 */}
            {mh.some((r:any) => r.operating_cf != null) && (
              <div>
                <p className="text-sm text-text-muted font-semibold mb-2">영업 / 투자 / 재무 현금흐름</p>
                <차트틀 height={chartH}>
                  {(R) => (
                    <R.BarChart data={mh.filter((r:any)=>r.operating_cf!=null)} margin={chartProps.margin}>
                      <R.CartesianGrid {...chartProps.cartesianGridProps}/>
                      <R.XAxis dataKey="period" {...chartProps.xAxisProps} tickFormatter={(v:string)=>v.slice(0,finPeriod==="quarterly"?7:4)}/>
                      <R.YAxis {...chartProps.yAxisProps} tickFormatter={(v:number)=>{const a=Math.abs(v);return isKR?(a>=1e12?(v/1e12).toFixed(0)+"조":a>=1e8?(v/1e8).toFixed(0)+"억":String(v)):(a>=1e9?(v/1e9).toFixed(0)+"B":a>=1e6?(v/1e6).toFixed(0)+"M":String(v));}}/>
                      <R.Tooltip {...chartProps.tooltipProps} formatter={(v:number,name:string)=>{const l:Record<string,string>={operating_cf:"영업현금흐름",investing_cf:"투자현금흐름",financing_cf:"재무현금흐름"};return[fmtFin(v),l[name]??name];}}/>
                      <R.Legend formatter={v=>({operating_cf:"영업현금흐름",investing_cf:"투자현금흐름",financing_cf:"재무현금흐름"}[v as string]??v)}/>
                      <R.Bar dataKey="operating_cf" fill="#10b981" radius={[2,2,0,0]} maxBarSize={28}/>
                      <R.Bar dataKey="investing_cf" fill="#ef4444" radius={[2,2,0,0]} maxBarSize={28}/>
                      <R.Bar dataKey="financing_cf" fill="#f59e0b" radius={[2,2,0,0]} maxBarSize={28}/>
                    </R.BarChart>
                  )}
                </차트틀>
              </div>
            )}
            {/* FCF 차트 */}
            {mh.some((r:any) => r.free_cf != null) && (
              <div>
                <p className="text-sm text-text-muted font-semibold mb-2">잉여현금흐름 (FCF)</p>
                <차트틀 height={chartHSm}>
                  {(R) => (
                    <R.BarChart data={mh.filter((r:any)=>r.free_cf!=null)} margin={chartProps.margin}>
                      <R.CartesianGrid {...chartProps.cartesianGridProps}/>
                      <R.XAxis dataKey="period" {...chartProps.xAxisProps} tickFormatter={(v:string)=>v.slice(0,finPeriod==="quarterly"?7:4)}/>
                      <R.YAxis {...chartProps.yAxisProps} tickFormatter={(v:number)=>{const a=Math.abs(v);return isKR?(a>=1e12?(v/1e12).toFixed(0)+"조":a>=1e8?(v/1e8).toFixed(0)+"억":String(v)):(a>=1e9?(v/1e9).toFixed(0)+"B":a>=1e6?(v/1e6).toFixed(0)+"M":String(v));}}/>
                      <R.Tooltip {...chartProps.tooltipProps} formatter={(v:number)=>[fmtFin(v),"FCF"]}/>
                      <R.Bar dataKey="free_cf" radius={[2,2,0,0]} maxBarSize={35}
                        fill="#3b82f6"
                        label={false}
                      />
                    </R.BarChart>
                  )}
                </차트틀>
              </div>
            )}
            {/* 전치 테이블 */}
            <TransTable rows={[
              { key:"operating_cf", label:"영업현금흐름", fmt:(v)=>fmtFin(v), color:"text-accent-green" },
              { key:"investing_cf", label:"투자현금흐름", fmt:(v)=>fmtFin(v), color:"text-accent-red" },
              { key:"financing_cf", label:"재무현금흐름", fmt:(v)=>fmtFin(v), color:"text-accent-yellow" },
              { key:"free_cf",      label:"FCF",         fmt:(v)=>fmtFin(v), color:"text-accent-blue" },
              { key:"capex",        label:"CAPEX",        fmt:(v)=>fmtFin(v), color:"text-text-secondary" },
              { key:"da",           label:"감가상각비",   fmt:(v)=>fmtFin(v), color:"text-text-secondary" },
            ]} allYears={allYears} getVal={getVal} finPeriod={finPeriod} />
          </div>
        </div>
      )}

      {/* ── 사용자설정 ── */}
      {finSubTab==="custom" && (() => {
        const selectedOpts = customMetricKeys.map(k => FIN_CUSTOM_OPTS.find(o => o.key === k)).filter((o): o is typeof FIN_CUSTOM_OPTS[number] => !!o);
        const fmtVal = (opt: typeof FIN_CUSTOM_OPTS[number], v: number) => {
          if (opt.fmt === "fin") return fmtFin(v);
          if (opt.fmt === "pct") return `${v.toFixed(1)}%`;
          if (opt.fmt === "ratio_pct") return `${(v * 100).toFixed(0)}%`;
          if (opt.fmt === "epsbps") return fmtEpsBps(v)!;
          return `${v.toFixed(2)}x`;
        };
        const COLORS = ["#3b82f6","#10b981","#8b5cf6","#f59e0b","#ef4444","#06b6d4","#f97316","#22c55e","#ec4899","#14b8a6"];
        return (
          <div className="flex flex-col gap-4">
            {/* 기간 토글 */}
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-text-muted">지표 선택 후 차트·표로 확인</span>
              <PeriodToggle finPeriod={finPeriod} setFinPeriod={setFinPeriod}/>
            </div>

            {/* 지표 관리 —
                관심종목 탭 관리·내 자산 계좌 관리와 같은 모양이다.
                예전에는 "지표 선택"(접이식 칩)과 "순서 조정"(◀▶ 버튼)이
                화면에 늘 펼쳐져 있어, 정작 보려던 차트가 저 아래로
                밀렸다. 순서 바꾸는 방식도 여기만 화살표였다. */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setShowCustomSelector(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-text-muted hover:text-accent-blue hover:border-accent-blue/40 transition-all"
              >
                <Settings2 size={13} />
                지표 관리
                <span className="text-text-dim font-normal">{customMetricKeys.length}/20</span>
              </button>
              {/* 고른 것을 여기서도 보여준다 — 창을 열지 않고도 무엇을
                  보고 있는지 알 수 있게. 누르면 바로 뺀다 */}
              {selectedOpts.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => updateCustomMetricKeys(customMetricKeys.filter((k) => k !== opt.key))}
                  aria-label={`${opt.label} 빼기`}
                  title="눌러서 빼기"
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold text-white border border-transparent hover:opacity-80 transition-opacity"
                  style={{ background: opt.color + "bb", borderColor: opt.color }}
                >
                  {opt.label}
                  <X size={11} className="opacity-70" />
                </button>
              ))}
            </div>

            {showCustomSelector && (
              <MetricManagerModal
                전체={FIN_CUSTOM_OPTS}
                선택된={customMetricKeys}
                onChange={updateCustomMetricKeys}
                onClose={() => setShowCustomSelector(false)}
              />
            )}

            {/* 선택된 지표 없을 때 */}
            {selectedOpts.length === 0 && (
              <div className="rounded-xl border border-border bg-bg-card flex items-center justify-center py-12">
                <p className="text-text-muted text-base">위에서 지표를 선택하세요</p>
              </div>
            )}

            {/* 차트 — 단위별 분리 */}
            {selectedOpts.length > 0 && allYears.length > 0 && (() => {
              const chartData = allYears.map((year: string) => {
                const row: any = { year };
                selectedOpts.forEach(opt => { row[opt.key] = getVal(opt.key, year); });
                return row;
              });
              const xFmt = (v: string) => finPeriod === "quarterly" ? v.replace(/(\d{4})-?Q(\d)/, "$1 Q$2") : v;
              const ttFmt = (v: number, name: string) => {
                const opt = FIN_CUSTOM_OPTS.find(o => o.key === name);
                return [opt ? fmtVal(opt, v) : v, opt?.label ?? name];
              };
              const legFmt = (v: string) => FIN_CUSTOM_OPTS.find(o => o.key === v)?.label ?? v;
              const UNIT_GROUPS = [
                {
                  fmts: ["fin"],
                  label: isKR ? "금액 (조원 / 억원)" : "금액 (B / M)",
                  yFmt: (v: number) => { const a=Math.abs(v); return isKR?(a>=1e12?(v/1e12).toFixed(0)+"조":a>=1e8?(v/1e8).toFixed(0)+"억":String(v)):(a>=1e9?(v/1e9).toFixed(0)+"B":a>=1e6?(v/1e6).toFixed(0)+"M":v.toFixed(1)); },
                },
                {
                  fmts: ["epsbps"],
                  label: isKR ? "주당 (원)" : "주당 ($)",
                  yFmt: (v: number) => { const a=Math.abs(v); return isKR?(a>=10000?(v/10000).toFixed(1)+"만":v.toLocaleString("ko-KR")):("$"+v.toFixed(2)); },
                },
                {
                  fmts: ["pct", "ratio_pct"],
                  label: "비율 (%)",
                  yFmt: (v: number) => v.toFixed(1) + "%",
                },
                {
                  fmts: ["x"],
                  label: "배수 (x)",
                  yFmt: (v: number) => v.toFixed(2) + "x",
                },
              ];
              return (
                <>
                  {UNIT_GROUPS.map(group => {
                    const groupOpts = selectedOpts.filter(opt => group.fmts.includes(opt.fmt));
                    if (!groupOpts.length) return null;
                    return (
                      <div key={group.label} className="rounded-xl overflow-hidden border border-border bg-bg-card">
                        <div className="px-4 py-3 border-b border-border">
                          <span className="text-base font-semibold text-text-primary">추이 차트 — {group.label}</span>
                        </div>
                        <div className="p-4">
                          <차트틀 height={chartH}>
                            {(R) => (
                              <R.BarChart data={chartData} margin={chartProps.margin}>
                                <R.CartesianGrid {...chartProps.cartesianGridProps}/>
                                <R.XAxis dataKey="year" {...chartProps.xAxisProps} tickFormatter={xFmt}/>
                                <R.YAxis {...chartProps.yAxisProps} tickFormatter={group.yFmt}/>
                                <R.Tooltip {...chartProps.tooltipProps} formatter={ttFmt as any}/>
                                <R.Legend formatter={legFmt}/>
                                {groupOpts.map(opt => (
                                  <R.Bar key={opt.key} dataKey={opt.key} fill={COLORS[selectedOpts.indexOf(opt) % COLORS.length]} radius={[2,2,0,0]} maxBarSize={35}/>
                                ))}
                              </R.BarChart>
                            )}
                          </차트틀>
                        </div>
                      </div>
                    );
                  })}
                </>
              );
            })()}

            {/* 테이블 */}
            {selectedOpts.length > 0 && (
              <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
                <div className="px-4 py-3 border-b border-border">
                  <span className="text-base font-semibold text-text-primary">데이터 표</span>
                </div>
                <div className="p-4">
                  <TransTable
                    rows={selectedOpts.map(opt => ({
                      key: opt.key,
                      label: opt.label,
                      fmt: (v: number) => fmtVal(opt, v),
                      color: "text-text-primary",
                    }))}
                    allYears={allYears}
                    getVal={getVal}
                    finPeriod={finPeriod}
                  />
                </div>
              </div>
            )}
          </div>
        );
      })()}

      </div>
    );
}
