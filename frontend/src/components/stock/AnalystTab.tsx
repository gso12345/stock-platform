import React from "react";

/**
 * 종목 상세의 투자의견 탭.
 *
 * 한 파일이 3,173줄이었다. 이 탭 한 칸을 고치려 해도 그 전체를 건드려야
 * 했고, 차트만 보고 나가는 사람도 여덟 탭의 코드를 다 받았다.
 *
 * 훅이 하나도 없는 순수 렌더라 그대로 떼어 낼 수 있었다. 필요한 값은
 * 전부 인자로 받는다 — 하나라도 빠지면 빌드가 짚어 준다. 화면을 눈으로
 * 볼 수 없는 상태에서 옮기는 것이라, '컴파일이 곧 검증' 이 되게 했다.
 */
import type { 전망응답 } from "@/types";
import { Tabs } from "@/components/ui";
import { fmtKRW, fmtUSD, fmtNum } from "@/utils/formatters";
import { 격자, 축, 툴팁 } from "@/utils/chartTheme";
import 차트틀 from "@/components/chart/ChartFrame";
import { StatCell } from "@/components/stock/DetailBits";

export default function 투자의견탭({
  analystData, analystSubTab, consensusPeriod, exchangeRate, forecasts, isKR, isMobile, loadingAnalyst, setAnalystSubTab, setConsensusPeriod, setShowKRW, showKRW,
}: {
  analystData: unknown;
  analystSubTab: "opinion" | "consensus";
  consensusPeriod: "annual" | "quarterly";
  exchangeRate: number;
  forecasts: 전망응답 | undefined;
  isKR: boolean;
  isMobile: boolean;
  loadingAnalyst: boolean;
  setAnalystSubTab: (v: "opinion" | "consensus") => void;
  setConsensusPeriod: (v: "annual" | "quarterly") => void;
  /* 갱신 함수 형태로도 부른다 — setShowKRW(v => !v) */
  setShowKRW: React.Dispatch<React.SetStateAction<boolean>>;
  showKRW: boolean;
}) {
    const ad = analystData as any;
    const pt = ad?.price_targets;
    const cs = ad?.consensus;
    const nc = ad?.naver_consensus; // Naver 컨센서스 (국내 종목)
    const reports: any[] = ad?.reports ?? [];
    const history: any[] = ad?.consensus_history ?? [];

    // 합의 등급 계산
    const totalVotes = cs ? cs.strong_buy + cs.buy + cs.hold + cs.sell + cs.strong_sell : 0;
    const avgScore = cs && totalVotes > 0
      ? (cs.strong_buy*5 + cs.buy*4 + cs.hold*3 + cs.sell*2 + cs.strong_sell*1) / totalVotes
      : null;
    const ratingLabel = avgScore == null ? "—"
      : avgScore >= 4.5 ? "강력매수"
      : avgScore >= 3.5 ? "매수"
      : avgScore >= 2.5 ? "보유"
      : avgScore >= 1.5 ? "매도"
      : "강력매도";
    const ratingColor = avgScore == null ? "text-text-muted"
      : avgScore >= 4 ? "text-accent-green"
      : avgScore >= 3 ? "text-accent-yellow"
      : "text-accent-red";

    const upside = pt?.current && pt?.mean
      ? ((pt.mean - pt.current) / pt.current * 100)
      : null;

    const analystGradeColor = (g: string) => {
      const l = g.toLowerCase();
      if (l.includes("strong buy") || l.includes("outperform") || l.includes("overweight")) return "text-accent-green";
      if (l.includes("buy") || l.includes("positive") || l.includes("add")) return "text-accent-green";
      if (l.includes("hold") || l.includes("neutral") || l.includes("equal")) return "text-accent-yellow";
      if (l.includes("sell") || l.includes("underperform") || l.includes("reduce") || l.includes("underweight")) return "text-accent-red";
      return "text-text-primary";
    };

    const actionLabel = (a: string, pa: string) => {
      const al = a.toLowerCase();
      const pal = (pa || "").toLowerCase();
      if (al === "init") return { text: "신규", color: "text-accent-blue bg-accent-blue/10" };
      if (pal === "raises") return { text: "↑상향", color: "text-accent-green bg-accent-green/10" };
      if (pal === "lowers") return { text: "↓하향", color: "text-accent-red bg-accent-red/10" };
      if (pal === "maintains") return { text: "유지", color: "text-text-muted bg-bg-elevated" };
      return { text: a, color: "text-text-muted bg-bg-elevated" };
    };

    // 투자의견/컨센서스 통화 포맷 (showKRW 토글 반영)
    const fmtPrice = (v: number | null | undefined): string => {
      if (v == null) return "—";
      if (isKR) return `₩${Math.round(v).toLocaleString("ko-KR")}`;
      if (showKRW) return `₩${Math.round(v * exchangeRate).toLocaleString("ko-KR")}`;
      return `$${v.toFixed(2)}`;
    };
    const fmtPrice0 = (v: number | null | undefined): string => {
      if (v == null) return "—";
      if (isKR) return `₩${Math.round(v).toLocaleString("ko-KR")}`;
      if (showKRW) return `₩${Math.round(v * exchangeRate).toLocaleString("ko-KR")}`;
      return `$${v.toFixed(0)}`;
    };
    const fmtAmtKRW = (v: number): string => {
      if (isKR) return fmtKRW(v);
      if (showKRW) return fmtKRW(v * exchangeRate);
      return fmtUSD(v);
    };

    return (
      <div className="flex flex-col gap-4">
        {/* 서브탭 + 원화 환산 토글 */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <Tabs
            fill={false} size="md" className="w-fit"
            ariaLabel="애널리스트 항목"
            tabs={[{ id: "opinion", label: "투자의견" }, { id: "consensus", label: "컨센서스" }]}
            active={analystSubTab}
            onChange={(id) => setAnalystSubTab(id as any)}
          />
          {!isKR && (
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
          )}
        </div>

        {analystSubTab==="opinion" && (loadingAnalyst ? (
          <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-accent-blue border-t-transparent rounded-full animate-spin"/></div>
        ) : !ad || (!pt && !cs && !nc && reports.length === 0) ? (
          <div className="rounded-xl border border-border bg-bg-card flex items-center justify-center py-16">
            <p className="text-text-muted text-base">투자의견 데이터가 없습니다</p>
          </div>
        ) : (
          <>
            {/* ── 컨센서스 보조 정보 (국내: Naver, 해외: 펀더멘털 기반) ── */}
            {nc && (
              <div className="rounded-xl border border-border bg-bg-card p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="col-span-2 sm:col-span-4">
                  <span className="text-sm font-bold text-text-muted uppercase tracking-widest">{isKR ? "Naver 컨센서스" : "컨센서스 정보"}</span>
                </div>
                {nc.cons_per != null && (
                  <StatCell label="컨센서스 PER" value={`${fmtNum(nc.cons_per)}배`} color="text-accent-blue" />
                )}
                {nc.cons_eps != null && (
                  <StatCell label="컨센서스 EPS" value={fmtPrice(nc.cons_eps)} color="text-accent-green" />
                )}
                {nc.recommendation && (
                  <StatCell label="투자의견" value={nc.recommendation} />
                )}
                {nc.analyst_count && (
                  <StatCell label="애널리스트 수" value={`${nc.analyst_count}명`} />
                )}
              </div>
            )}

            {/* ── 목표주가 & 합의 등급 ── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* 목표주가 */}
              {pt && (
                <div className="rounded-xl border border-border bg-bg-card p-4 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-text-muted uppercase tracking-widest">목표주가</span>
                    {upside != null && (
                      <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${upside >= 0 ? "bg-accent-green/10 text-accent-green" : "bg-accent-red/10 text-accent-red"}`}>
                        {upside >= 0 ? "+" : ""}{upside.toFixed(1)}% 상승여력
                      </span>
                    )}
                  </div>
                  {/* 목표가 바 */}
                  {pt.low != null && pt.high != null && pt.current != null && (
                    <div className="flex flex-col gap-1">
                      <div className="relative h-2 rounded-full bg-bg-elevated overflow-hidden">
                        {(() => {
                          const range = pt.high - pt.low;
                          const curPct = range > 0 ? Math.min(100, Math.max(0, ((pt.current - pt.low) / range) * 100)) : 50;
                          const meanPct = range > 0 ? Math.min(100, Math.max(0, ((pt.mean - pt.low) / range) * 100)) : 50;
                          return (
                            <>
                              <div className="absolute inset-0 bg-gradient-to-r from-accent-red/30 via-accent-yellow/30 to-accent-green/30"/>
                              <div className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-white border-2 border-accent-blue shadow z-10"
                                style={{ left: `calc(${curPct}% - 5px)` }} title="현재가"/>
                              <div className="absolute top-1/2 -translate-y-1/2 w-2 h-4 rounded-sm bg-accent-green/80"
                                style={{ left: `calc(${meanPct}% - 1px)` }} title="평균목표가"/>
                            </>
                          );
                        })()}
                      </div>
                      <div className="flex justify-between text-xs text-text-muted font-mono">
                        <span>저 {fmtPrice0(pt.low)}</span>
                        <span>고 {fmtPrice0(pt.high)}</span>
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-3 gap-2 mt-1">
                    {[
                      { label:"평균", v: pt.mean, color:"text-accent-blue" },
                      { label:"최고", v: pt.high, color:"text-accent-green" },
                      { label:"최저", v: pt.low,  color:"text-accent-red" },
                    ].map(item => (
                      <div key={item.label} className="flex flex-col gap-0.5 items-center p-2 rounded-lg bg-bg-elevated">
                        <span className="text-xs text-text-muted">{item.label}</span>
                        <span className={`text-base font-mono font-bold ${item.color}`}>
                          {fmtPrice0(item.v)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="text-sm text-text-muted text-center">
                    현재가 {fmtPrice(pt.current ?? 0)} 기준 · {totalVotes}명 애널리스트
                  </div>
                </div>
              )}

              {/* 합의 등급 */}
              {cs && (
                <div className="rounded-xl border border-border bg-bg-card p-4 flex flex-col gap-3">
                  <span className="text-sm font-bold text-text-muted uppercase tracking-widest">투자의견 합의</span>
                  <div className="flex items-center gap-3">
                    <span className={`text-2xl font-bold ${ratingColor}`}>{ratingLabel}</span>
                    {avgScore != null && <span className="text-base text-text-muted font-mono">{avgScore.toFixed(2)} / 5.0</span>}
                  </div>
                  {/* 분포 바 */}
                  <div className="flex flex-col gap-1.5">
                    {[
                      { label:"강력매수", key:"strong_buy",  color:"#10b981" },
                      { label:"매수",     key:"buy",         color:"#34d399" },
                      { label:"보유",     key:"hold",        color:"#f59e0b" },
                      { label:"매도",     key:"sell",        color:"#f87171" },
                      { label:"강력매도", key:"strong_sell", color:"#ef4444" },
                    ].map(({ label, key, color }) => {
                      const cnt = cs[key] ?? 0;
                      const pct = totalVotes > 0 ? (cnt / totalVotes) * 100 : 0;
                      return (
                        <div key={key} className="flex items-center gap-2">
                          <span className="text-xs text-text-muted w-14 flex-shrink-0">{label}</span>
                          <div className="flex-1 h-2 rounded-full bg-bg-elevated overflow-hidden">
                            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }}/>
                          </div>
                          <span className="text-xs font-mono text-text-muted w-6 text-right">{cnt}</span>
                        </div>
                      );
                    })}
                  </div>
                  {/* 최근 3개월 추이 */}
                  {history.length > 1 && (
                    <div className="border-t border-border pt-2">
                      <p className="text-xs text-text-muted mb-1.5">최근 추이</p>
                      <div className="flex gap-2">
                        {history.slice(0, 4).map((h: any, i: number) => {
                          const tot = h.strong_buy + h.buy + h.hold + h.sell + h.strong_sell;
                          const bs = ((h.strong_buy + h.buy) / (tot || 1) * 100).toFixed(0);
                          const label = ["이번달","1개월전","2개월전","3개월전"][i] ?? h.period;
                          return (
                            <div key={i} className="flex-1 flex flex-col items-center gap-0.5 p-1.5 rounded-lg bg-bg-elevated">
                              <span className="text-xs text-text-muted">{label}</span>
                              <span className="text-sm font-bold text-accent-green">{bs}%</span>
                              <span className="text-xs text-text-dim">매수</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── 최근 애널리스트 리포트 ── */}
            {reports.length > 0 && (
              <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
                <div className="px-4 py-3 border-b border-border">
                  <span className="text-base font-semibold text-text-primary">최근 애널리스트 리포트</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-text-muted">
                        <th className="text-left px-4 py-2 font-medium">날짜</th>
                        <th className="text-left px-4 py-2 font-medium">증권사</th>
                        <th className="text-left px-4 py-2 font-medium">투자의견</th>
                        <th className="text-right px-4 py-2 font-medium">목표가</th>
                        <th className="text-center px-4 py-2 font-medium">액션</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reports.map((r: any, i: number) => {
                        const act = actionLabel(r.action, r.price_action);
                        return (
                          <tr key={i} className="border-b border-border/30 hover:bg-bg-hover transition-colors">
                            <td className="px-4 py-2.5 font-mono text-text-muted whitespace-nowrap">{r.date}</td>
                            <td className="px-4 py-2.5 font-semibold text-text-primary whitespace-nowrap">{r.firm || "—"}</td>
                            <td className={`px-4 py-2.5 font-semibold whitespace-nowrap ${analystGradeColor(r.to_grade)}`}>{r.to_grade || "—"}</td>
                            <td className="px-4 py-2.5 text-right font-mono text-text-primary whitespace-nowrap">
                              {fmtPrice0(r.target)}
                              {r.prior_target != null && r.target != null && r.prior_target !== r.target && (
                                <span className="text-text-muted ml-1 text-2xs">
                                  ({r.target > r.prior_target ? "↑" : "↓"}{fmtPrice0(r.prior_target)})
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-center whitespace-nowrap">
                              <span className={`px-2 py-0.5 rounded-full text-2xs font-bold whitespace-nowrap ${act.color}`}>{act.text}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        ))}

        {analystSubTab==="consensus" && (() => {
          const fcstData = forecasts?.[consensusPeriod] ?? [];
          if (!fcstData.length) return (
            <div className="rounded-xl border border-border bg-bg-card flex items-center justify-center py-16">
              <p className="text-text-muted text-base">컨센서스 데이터가 없습니다</p>
            </div>
          );

          // 기간 컬럼 생성
          const periods = fcstData.map((r: any) => r.period);
          const periodLabel = (p: string) => {
            if (consensusPeriod === "annual") return p;
            // 분기: "2026-Q1" → "2026 Q1"
            return p.replace("-", " ");
          };

          const indicators = [
            { key: "revenue_est",    label: "매출 추정",        color: "text-accent-blue",    fmt: fmtAmtKRW },
            { key: "revenue_low",    label: "매출 최저",         color: "text-accent-blue/60", fmt: fmtAmtKRW },
            { key: "revenue_high",   label: "매출 최고",         color: "text-accent-blue/60", fmt: fmtAmtKRW },
            { key: "op_income_est",  label: "영업이익 추정",     color: "text-accent-green",   fmt: fmtAmtKRW },
            { key: "net_income_est", label: "순이익 추정",       color: "text-accent-purple",     fmt: fmtAmtKRW },
            { key: "eps_est",        label: "EPS 추정",          color: "text-accent-green",   fmt: fmtPrice },
            { key: "eps_low",        label: "EPS 최저",          color: "text-accent-green/60",fmt: fmtPrice },
            { key: "eps_high",       label: "EPS 최고",          color: "text-accent-green/60",fmt: fmtPrice },
            { key: "eps_analysts",   label: "EPS 애널리스트 수", color: "text-text-muted",     fmt: (v: number) => `${Math.round(v)}명` },
            { key: "eps_current",    label: "EPS 현재 추정",     color: "text-accent-cyan",       fmt: fmtPrice },
            { key: "eps_7d_ago",     label: "EPS 7일 전",        color: "text-text-muted",     fmt: fmtPrice },
            { key: "eps_30d_ago",    label: "EPS 30일 전",       color: "text-text-muted",     fmt: fmtPrice },
            { key: "eps_90d_ago",    label: "EPS 90일 전",       color: "text-text-muted",     fmt: fmtPrice },
            { key: "growth_est",     label: "EPS 성장률 추정",   color: "text-accent-yellow",  fmt: (v: number) => `${(v*100).toFixed(1)}%` },
          ].filter(ind => fcstData.some((r: any) => r[ind.key] != null));

          // 컨센서스 차트용 데이터/포맷 (showKRW 토글 시 차트 값도 원화로 환산)
          const inKRW = isKR || showKRW;
          const convFactor = (!isKR && showKRW) ? exchangeRate : 1;
          const chartData = fcstData.map((r: any) => {
            const conv: any = { ...r, periodLabel: periodLabel(r.period) };
            if (convFactor !== 1) {
              ["revenue_est","revenue_low","revenue_high","op_income_est","net_income_est","eps_est"].forEach(k => {
                if (conv[k] != null) conv[k] = conv[k] * convFactor;
              });
            }
            return conv;
          });
          const hasRevenueChart = fcstData.some((r: any) => r.revenue_est != null);
          const hasOpIncome  = fcstData.some((r: any) => r.op_income_est != null);
          const hasNetIncome = fcstData.some((r: any) => r.net_income_est != null);
          const hasEpsChart  = fcstData.some((r: any) => r.eps_est != null);
          const chartHSm = isMobile ? 185 : 240;
          const cMargin  = {top:8,right:12,left:4,bottom:4} as any;
          // 재무제표 탭과 같은 테마 토큰을 쓴다 (utils/chartTheme)
          const cGrid    = 격자;
          const cXAxis   = 축 as any;
          const cYAxis   = { ...축, width: isMobile ? 46 : 58 } as any;
          const cTooltip = 툴팁 as any;
          const fmtAmt = (v:number) => inKRW ? fmtKRW(v) : fmtUSD(v);
          const fmtEpsV = (v:number) => inKRW ? `₩${Math.round(v).toLocaleString("ko-KR")}` : `$${v.toFixed(2)}`;

          return (
            <div className="flex flex-col gap-3">
              {/* 연간/분기 토글 */}
              <div className="flex gap-1 p-0.5 rounded-lg border border-border bg-bg-primary w-fit">
                {(["annual","quarterly"] as const).map(k => (
                  <button key={k} onClick={() => setConsensusPeriod(k)}
                    className={`px-3 py-1 text-sm font-semibold rounded-md transition-all ${consensusPeriod===k?"bg-accent-blue text-white":"text-text-muted hover:text-text-primary"}`}>
                    {k==="annual" ? "연간" : "분기"}
                  </button>
                ))}
              </div>
              {/* 컨센서스 추정치 그래프 */}
              {(hasRevenueChart || hasEpsChart) && (
                <div className="rounded-xl overflow-hidden border border-border bg-bg-card p-4">
                  <차트틀 height={chartHSm}>
                    {(R) => (
                      hasRevenueChart ? (
                        <R.BarChart data={chartData} {...cMargin}>
                          <R.CartesianGrid {...cGrid}/>
                          <R.XAxis dataKey="periodLabel" {...cXAxis}/>
                          <R.YAxis {...cYAxis} tickFormatter={(v:number)=>{const a=Math.abs(v);return inKRW?(a>=1e12?(v/1e12).toFixed(0)+"조":a>=1e8?(v/1e8).toFixed(0)+"억":String(v)):(a>=1e9?(v/1e9).toFixed(0)+"B":a>=1e6?(v/1e6).toFixed(0)+"M":String(v));}}/>
                          <R.Tooltip {...cTooltip} formatter={(v:number,name:string)=>{const l:Record<string,string>={revenue_est:"매출 추정",op_income_est:"영업이익 추정",net_income_est:"순이익 추정"};return[fmtAmt(v),l[name]??name];}}/>
                          <R.Legend formatter={v=>({revenue_est:"매출",op_income_est:"영업이익",net_income_est:"순이익"}[v as string]??v)}/>
                          <R.Bar dataKey="revenue_est" fill="#3b82f6" radius={[2,2,0,0]} maxBarSize={35}/>
                          {hasOpIncome && <R.Bar dataKey="op_income_est" fill="#10b981" radius={[2,2,0,0]} maxBarSize={35}/>}
                          {hasNetIncome && <R.Bar dataKey="net_income_est" fill="#8b5cf6" radius={[2,2,0,0]} maxBarSize={35}/>}
                        </R.BarChart>
                      ) : (
                        <R.BarChart data={chartData} {...cMargin}>
                          <R.CartesianGrid {...cGrid}/>
                          <R.XAxis dataKey="periodLabel" {...cXAxis}/>
                          <R.YAxis {...cYAxis} tickFormatter={(v:number)=>fmtEpsV(v)}/>
                          <R.Tooltip {...cTooltip} formatter={(v:number)=>[fmtEpsV(v),"EPS 추정"]}/>
                          <R.Bar dataKey="eps_est" fill="#06b6d4" radius={[2,2,0,0]} maxBarSize={35}/>
                        </R.BarChart>
                      )
                    )}
                  </차트틀>
                </div>
              )}
              {/* 테이블 */}
              <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
                <div className="px-4 py-3 border-b border-border">
                  <span className="text-base font-semibold text-text-primary">애널리스트 컨센서스 추정치</span>
                </div>
                <div className="overflow-x-auto p-4">
                  <table className="text-sm w-max min-w-full">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left pb-2 font-medium text-text-muted sticky left-0 bg-bg-card min-w-[120px] pr-4">지표</th>
                        {periods.map((p: string) => (
                          <th key={p} className="text-right pb-2 font-mono font-semibold text-accent-yellow/90 px-3 min-w-[90px] whitespace-nowrap">{periodLabel(p)}E</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {indicators.map(ind => (
                        <tr key={ind.key} className="border-b border-border/30 hover:bg-bg-hover">
                          <td className={`py-2 pr-4 font-medium sticky left-0 bg-bg-card whitespace-nowrap ${ind.color}`}>{ind.label}</td>
                          {fcstData.map((r: any, i: number) => (
                            <td key={i} className={`py-2 px-3 text-right font-mono ${ind.color}`}>
                              {r[ind.key] != null ? ind.fmt(r[ind.key]) : "—"}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    );
}
