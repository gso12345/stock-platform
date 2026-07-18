import { useState, useMemo } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { fmtKRWCompact } from "@/utils/formatters";
import { Link } from "react-router-dom";

const PIE_COLORS = ["#3b82f6","#10b981","#f59e0b","#8b5cf6","#ef4444","#06b6d4","#f97316","#84cc16","#ec4899","#14b8a6","#6366f1"];

function classifyAsset(market: string, name: string, symbol: string): string {
  const h = `${name} ${symbol}`.toUpperCase();
  const CC = ["커버드콜","COVERED CALL","JEPI","JEPQ","QYLD","XYLD","RYLD","DIVO","BUYWRITE"];
  const BOND = ["채권","국고채","회사채","TLT","BND","AGG","SHY","IEF","TIP","LQD","HYG","BNDX","TIGER 미국채","KODEX 국고채"];
  const GOLD = ["금현물","골드","GLD","IAU","GLDM","SGOL","KRX금"];
  if (CC.some(k => h.includes(k.toUpperCase()))) return "커버드콜";
  if (BOND.some(k => h.includes(k.toUpperCase()))) return "채권";
  if (GOLD.some(k => h.includes(k.toUpperCase()))) return "금";
  if (market === "KR") return "국내주식";
  if (market === "US") return "해외주식";
  const isKRListed = /^\d{6}/.test(symbol);
  if (!isKRListed) return "해외주식";
  const OV = ["미국","나스닥","S&P","SP500","차이나","중국","일본","글로벌","선진국","유로","베트남","인도","신흥국","해외"];
  if (OV.some(k => name.includes(k))) return "해외주식";
  return "국내주식";
}

export interface PfItemForChart {
  symbol: string;
  market: string;
  name: string;
  avgPrice: number;
  shares: number;
  currency?: string;
  inputExchangeRate?: number | null;
  currentValueKRW?: number;
}

export interface PfPortfolioForChart {
  id: number;
  name: string;
  items: PfItemForChart[];
}

type ChartMode = "stock" | "type" | "portfolio";

export default function PortfolioChart({
  portfolios,
  exchangeRate,
  title,
}: {
  portfolios: PfPortfolioForChart[];
  exchangeRate: number;
  title?: string;
}) {
  const [mode, setMode] = useState<ChartMode>("stock");
  const showPortfolioTab = portfolios.length > 1;

  const allEnriched = useMemo(() => {
    const map: Record<string, { symbol: string; name: string; market: string; assetType: string; value: number }> = {};
    portfolios.forEach(pf => {
      pf.items.forEach(item => {
        if (!item.symbol) return;
        let value: number;
        if (item.currentValueKRW != null) {
          value = item.currentValueKRW;
        } else {
          const fx = item.currency === "USD" ? (item.inputExchangeRate ?? exchangeRate) : 1;
          value = (item.avgPrice ?? 0) * fx * (item.shares ?? 0);
        }
        if (map[item.symbol]) map[item.symbol].value += value;
        else map[item.symbol] = {
          symbol: item.symbol,
          name: item.name || item.symbol,
          market: item.market,
          assetType: classifyAsset(item.market, item.name || "", item.symbol),
          value,
        };
      });
    });
    return Object.values(map).sort((a, b) => b.value - a.value);
  }, [portfolios, exchangeRate]);

  const stockPieData = useMemo(() =>
    allEnriched.filter(e => e.value > 0).map(e => ({ name: e.name, symbol: e.symbol, market: e.market, value: Math.round(e.value) })),
    [allEnriched]
  );

  const typePieData = useMemo(() => {
    const map: Record<string, number> = {};
    allEnriched.filter(e => e.value > 0).forEach(e => { map[e.assetType] = (map[e.assetType] ?? 0) + e.value; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value: Math.round(value) }));
  }, [allEnriched]);

  const portfolioPieData = useMemo(() =>
    portfolios.map(pf => ({
      name: pf.name,
      value: Math.round(pf.items.reduce((s, item) => {
        if (item.currentValueKRW != null) return s + item.currentValueKRW;
        const fx = item.currency === "USD" ? (item.inputExchangeRate ?? exchangeRate) : 1;
        return s + (item.avgPrice ?? 0) * fx * item.shares;
      }, 0)),
    })).filter(d => d.value > 0),
    [portfolios, exchangeRate]
  );

  const activePieData = mode === "stock" ? stockPieData : mode === "type" ? typePieData : portfolioPieData;
  const legendData = mode === "stock" ? allEnriched : activePieData.map(e => ({ ...e, symbol: (e as any).symbol, market: (e as any).market }));

  const TABS: { id: ChartMode; label: string }[] = [
    { id: "stock", label: "종목별" },
    { id: "type", label: "자산유형별" },
    ...(showPortfolioTab ? [{ id: "portfolio" as ChartMode, label: "포트폴리오별" }] : []),
  ];

  return (
    <div className="bg-bg-card border border-border rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 pt-3 pb-0">
        <div className="flex">
          {TABS.map(({ id, label }) => (
            <button key={id} onClick={() => setMode(id)}
              className={`px-3 py-2.5 text-xs font-semibold border-b-2 -mb-px transition-all ${
                mode === id ? "border-accent-blue text-accent-blue" : "border-transparent text-text-muted hover:text-text-primary"
              }`}
            >{label}</button>
          ))}
        </div>
        {title && <span className="text-xs font-semibold text-text-muted pb-2">{title}</span>}
      </div>

      <div className="p-4">
        {legendData.length === 0 ? (
          <div className="h-[160px] flex items-center justify-center text-text-muted text-sm">데이터 없음</div>
        ) : (
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 items-center sm:items-start">
            <div className="flex-shrink-0 w-full sm:w-44">
              <ResponsiveContainer width="100%" height={180}>
                <PieChart key={mode}>
                  <Pie
                    data={activePieData} dataKey="value" nameKey="name"
                    cx="50%" cy="50%" outerRadius={72} innerRadius={30}
                    isAnimationActive animationBegin={0} animationDuration={700} animationEasing="ease-out"
                  >
                    {activePieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: "#1e2435", border: "1px solid #2d3655", borderRadius: 8, fontSize: 11, color: "#e2e8f0" }}
                    itemStyle={{ color: "#e2e8f0" }}
                    labelStyle={{ color: "#94a3b8", display: "none" }}
                    formatter={(v: any) => [fmtKRWCompact(Number(v)), ""]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex-1 min-w-0 w-full self-center flex flex-col gap-0.5 py-1">
              {(() => {
                const total = activePieData.reduce((s, e) => s + e.value, 0);
                return legendData.map((entry, i) => {
                  const pct = total > 0 ? (entry.value / total) * 100 : 0;
                  const e = entry as any;
                  const colorIdx = activePieData.findIndex(d => d.name === entry.name);
                  const color = PIE_COLORS[(colorIdx >= 0 ? colorIdx : i) % PIE_COLORS.length];
                  return (
                    <div key={entry.name} className="flex items-center gap-2 py-1">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
                      {mode === "stock" && e.symbol && e.market ? (
                        <Link to={`/stocks/${e.market}/${e.symbol}`} className="flex-1 text-xs text-text-secondary hover:text-accent-blue truncate min-w-0 transition-colors">
                          {entry.name}
                        </Link>
                      ) : (
                        <span className="flex-1 text-xs text-text-secondary truncate min-w-0">{entry.name}</span>
                      )}
                      <div className="flex-shrink-0 w-16 h-1.5 bg-bg-elevated rounded-full overflow-hidden hidden sm:block">
                        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
                      </div>
                      <span className="text-xs font-mono font-semibold text-text-primary w-10 text-right flex-shrink-0">
                        {entry.value > 0 ? `${pct.toFixed(1)}%` : "—"}
                      </span>
                      <span className="text-xs font-mono text-text-muted text-right flex-shrink-0 w-20 hidden sm:block">
                        {entry.value > 0 ? fmtKRWCompact(entry.value) : "매입가 미설정"}
                      </span>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
