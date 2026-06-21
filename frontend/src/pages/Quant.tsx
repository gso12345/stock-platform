import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { quantScoreApi, watchlistApi, watchlistFolderApi, type QuantFactorKey } from "@/api/stocks";
import { useQuantSettings, QUANT_DEFAULT_WEIGHTS } from "@/hooks/useQuantSettings";
import QuantSettingsPanel from "@/components/quant/QuantSettingsPanel";
import { useAuthStore } from "@/store/authStore";
import { Card, Badge, RowSkeleton, Button } from "@/components/ui";
import { Award, AlertCircle, Settings2, LogIn, ArrowDown, ArrowUp } from "lucide-react";

const FACTOR_LABEL_KO: Record<QuantFactorKey, string> = {
  value: "가치", quality: "품질", momentum: "모멘텀", growth: "성장", risk: "안정성",
};

const MARKET_TABS = [
  { id: "전체", label: "전체" },
  { id: "KR",   label: "국내" },
  { id: "US",   label: "해외" },
  { id: "ETF",  label: "ETF"  },
];

type SortKey = "total" | QuantFactorKey;

const GRADE_BANDS: { grade: string; range: string }[] = [
  { grade: "S", range: "90 ~ 100점" },
  { grade: "A", range: "80 ~ 90점" },
  { grade: "B", range: "60 ~ 80점" },
  { grade: "C", range: "40 ~ 60점" },
  { grade: "D", range: "20 ~ 40점" },
  { grade: "F", range: "0 ~ 20점" },
];

function gradeColor(grade: string | null | undefined) {
  if (!grade) return "text-text-muted";
  if (grade.startsWith("S")) return "text-purple-400";
  if (grade.startsWith("A")) return "text-accent-green";
  if (grade.startsWith("B")) return "text-accent-blue";
  if (grade.startsWith("C")) return "text-accent-yellow";
  return "text-accent-red";
}

function scoreColor(s: number | null) {
  return s == null ? "text-text-muted" : s >= 60 ? "text-accent-green" : s >= 40 ? "text-accent-yellow" : "text-accent-red";
}

export default function Quant() {
  const navigate = useNavigate();
  const { isLoggedIn } = useAuthStore();
  const [marketTab, setMarketTab] = useState("전체");
  const [folderTab, setFolderTab] = useState<number | "all" | "none">("all");
  const [showGradeHelp, setShowGradeHelp] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("total");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");

  const { data: folders } = useQuery({
    queryKey: ["watchlist-folders"],
    queryFn: watchlistFolderApi.getFolders,
    enabled: isLoggedIn,
  });

  const { data: items, isLoading: itemsLoading } = useQuery({
    queryKey: ["watchlist-items"],
    queryFn: () => watchlistApi.getItems(),
    enabled: isLoggedIn,
  });

  const filteredItems = useMemo(() => {
    let list = (items ?? []) as any[];
    if (marketTab !== "전체") list = list.filter((it) => it.market === marketTab);
    if (folderTab === "none") list = list.filter((it) => !it.folder_id);
    else if (folderTab !== "all") list = list.filter((it) => it.folder_id === folderTab);
    return list;
  }, [items, marketTab, folderTab]);

  const allCompareItems = useMemo(() => {
    const seen = new Set<string>();
    const out: { symbol: string; market: string; name: string }[] = [];
    for (const it of filteredItems as any[]) {
      const key = `${it.market}:${it.symbol}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ symbol: it.symbol, market: it.market, name: it.name });
    }
    return out;
  }, [filteredItems]);
  const compareItems = useMemo(() => allCompareItems.slice(0, 30), [allCompareItems]);
  const truncated = allCompareItems.length > compareItems.length;

  const { data: weightsData } = useQuery({
    queryKey: ["quant-weights"],
    queryFn: quantScoreApi.getWeights,
    enabled: isLoggedIn,
  });

  const quantSettings = useQuantSettings(weightsData?.weights, weightsData?.enabled_metrics);
  const { weights: quantWeights, metrics: quantMetrics, showSettings, setShowSettings } = quantSettings;

  const {
    data: compareData,
    isLoading: scoreLoading,
    isError,
    isFetching,
  } = useQuery({
    queryKey: ["quant-compare", compareItems.map((i: { symbol: string; market: string }) => `${i.market}:${i.symbol}`).join(","), quantWeights, quantMetrics],
    queryFn: () => quantScoreApi.compare(compareItems, quantWeights ?? undefined, quantMetrics ?? undefined),
    enabled: isLoggedIn && compareItems.length > 0,
    staleTime: 60_000,
  });

  const nameMap = useMemo(() => {
    const m = new Map<string, string>();
    compareItems.forEach((i: { symbol: string; market: string; name: string }) => m.set(`${i.market}:${i.symbol}`, i.name));
    return m;
  }, [compareItems]);

  const scoreOf = (row: { total_score: number | null; factors: { key: QuantFactorKey; score: number | null }[] }, key: SortKey) =>
    key === "total" ? row.total_score : row.factors.find((f) => f.key === key)?.score ?? null;

  const rows = useMemo(() => {
    const list = compareData?.items ?? [];
    const dir = sortDir === "desc" ? -1 : 1;
    return [...list].sort((a, b) => dir * ((scoreOf(a, sortKey) ?? -1) - (scoreOf(b, sortKey) ?? -1)));
  }, [compareData, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  useEffect(() => {
    if (typeof folderTab === "number" && folders && !folders.some((f: any) => f.id === folderTab)) {
      setFolderTab("all");
    }
  }, [folders, folderTab]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <Award size={22} className="text-accent-blue" />
            퀀트점수 비교
          </h1>
          <p className="text-text-muted text-xs mt-0.5">
            관심종목들을 같은 기준(가중치·사용 지표)으로 퀀트 점수 비교
          </p>
        </div>
        {isLoggedIn && (
          <button
            onClick={() => setShowSettings((s) => !s)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
              showSettings ? "border-accent-blue text-accent-blue bg-accent-blue/5" : "border-border text-text-muted hover:text-text-primary hover:border-accent-blue/40"
            }`}
          >
            <Settings2 size={14} />기준 수정
          </button>
        )}
      </div>

      {!isLoggedIn ? (
        <Card className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <LogIn size={32} className="text-text-muted/40" />
          <p className="text-text-secondary text-sm">로그인하면 내 관심종목의 퀀트 점수를 비교할 수 있어요</p>
          <Button size="sm" onClick={() => navigate("/login")}>로그인</Button>
        </Card>
      ) : (
        <>
          {showSettings && (
            <QuantSettingsPanel
              weightsDraft={quantSettings.weightsDraft}
              metricsDraft={quantSettings.metricsDraft}
              onUpdateWeight={quantSettings.updateWeight}
              onToggleMetric={quantSettings.toggleMetric}
              onReset={quantSettings.resetToDefault}
              onSave={() => quantSettings.save.mutate({ weights: quantSettings.weightsDraft ?? QUANT_DEFAULT_WEIGHTS, metrics: quantSettings.metricsDraft ?? {} })}
              isSaving={quantSettings.save.isPending}
              isLoggedIn={isLoggedIn}
              saveMsg={quantSettings.saveMsg}
            />
          )}

          <div className="flex gap-1 bg-bg-secondary border border-border rounded-xl p-1 w-fit">
            {MARKET_TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => { setMarketTab(t.id); setFolderTab("all"); }}
                className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                  marketTab === t.id ? "bg-accent-blue text-white shadow" : "text-text-muted hover:text-text-primary"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex overflow-x-auto scrollbar-hide rounded-lg border border-border w-fit max-w-full">
            <button
              onClick={() => setFolderTab("all")}
              className={`flex-shrink-0 whitespace-nowrap px-3 py-1.5 text-xs font-semibold border-r border-border last:border-r-0 transition-all ${
                folderTab === "all" ? "bg-accent-blue text-white" : "text-text-muted hover:text-text-primary hover:bg-bg-hover bg-bg-card"
              }`}
            >
              전체 <span className="text-[10px] opacity-70">{allCompareItems.length}</span>
            </button>
            <button
              onClick={() => setFolderTab("none")}
              className={`flex-shrink-0 whitespace-nowrap px-3 py-1.5 text-xs font-semibold border-r border-border last:border-r-0 transition-all ${
                folderTab === "none" ? "bg-accent-blue text-white" : "text-text-muted hover:text-text-primary hover:bg-bg-hover bg-bg-card"
              }`}
            >
              기본 <span className="text-[10px] opacity-70">{filteredItems.filter((i: any) => !i.folder_id).length}</span>
            </button>
            {(folders ?? []).map((f: any) => {
              const cnt = ((items ?? []) as any[]).filter(
                (i) => i.folder_id === f.id && (marketTab === "전체" || i.market === marketTab),
              ).length;
              return (
                <button
                  key={f.id}
                  onClick={() => setFolderTab(f.id)}
                  className={`flex-shrink-0 whitespace-nowrap px-3 py-1.5 text-xs font-semibold border-r border-border last:border-r-0 transition-all ${
                    folderTab === f.id ? "bg-accent-blue text-white" : "text-text-muted hover:text-text-primary hover:bg-bg-hover bg-bg-card"
                  }`}
                >
                  {f.name} <span className="text-[10px] opacity-70">{cnt}</span>
                </button>
              );
            })}
          </div>

          <Card className="p-0 overflow-hidden">
            {itemsLoading || scoreLoading ? (
              <div className="p-3">
                <RowSkeleton rows={5} />
              </div>
            ) : compareItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
                <Award size={32} className="text-text-muted/40" />
                <p className="text-text-secondary text-sm">비교할 관심종목이 없어요</p>
                <p className="text-text-muted text-xs">관심종목 메뉴에서 종목을 추가하면 여기서 비교할 수 있어요</p>
              </div>
            ) : isError ? (
              <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
                <AlertCircle size={32} className="text-accent-red/60" />
                <p className="text-text-secondary text-sm">퀀트 점수를 불러오지 못했어요. 잠시 후 다시 시도해주세요</p>
              </div>
            ) : (
              <div key={`${marketTab}-${folderTab}`} className="overflow-x-auto tab-fade">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-bg-secondary border-b border-border z-10">
                    <tr className="text-text-muted text-[11px]">
                      <th className="text-left px-3 py-3 sticky left-0 bg-bg-secondary z-20">종목</th>
                      <th className="text-right px-3 py-3">
                        <button
                          onClick={() => toggleSort("total")}
                          className={`flex items-center justify-end gap-1 ml-auto whitespace-nowrap ${sortKey === "total" ? "text-accent-blue" : "hover:text-text-primary"}`}
                        >
                          종합점수
                          {sortKey === "total" && (sortDir === "desc" ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
                        </button>
                      </th>
                      <th className="text-right px-3 py-3 whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5 relative whitespace-nowrap">
                          등급
                          <button
                            onClick={() => setShowGradeHelp((s) => !s)}
                            className="flex items-center justify-center w-4 h-4 rounded-full border border-border text-text-muted hover:text-text-primary hover:border-accent-blue/40"
                          >
                            ?
                          </button>
                          {showGradeHelp && (
                            <div className="absolute right-0 top-6 z-30 w-48 rounded-xl border border-border bg-bg-elevated shadow-lg p-3 flex flex-col gap-1.5 text-left">
                              <span className="text-[11px] font-semibold text-text-secondary pb-1">등급 기준</span>
                              {GRADE_BANDS.map((b) => (
                                <div key={b.grade} className="flex items-center justify-between text-xs">
                                  <span className={`font-bold ${gradeColor(b.grade)}`}>{b.grade}</span>
                                  <span className="text-text-secondary font-mono">{b.range}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </th>
                      {(Object.keys(FACTOR_LABEL_KO) as QuantFactorKey[]).map((k) => (
                        <th key={k} className="text-right px-3 py-3 whitespace-nowrap">
                          <button
                            onClick={() => toggleSort(k)}
                            className={`flex items-center justify-end gap-1 ml-auto whitespace-nowrap ${sortKey === k ? "text-accent-blue" : "hover:text-text-primary"}`}
                          >
                            {FACTOR_LABEL_KO[k]}
                            {sortKey === k && (sortDir === "desc" ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const key = `${row.market}:${row.symbol}`;
                      const name = nameMap.get(key) ?? row.symbol;
                      const factorScore = (fkey: QuantFactorKey) =>
                        row.factors.find((f) => f.key === fkey)?.score ?? null;
                      return (
                        <tr
                          key={key}
                          onClick={() => navigate(`/stocks/${row.market}/${row.symbol}`)}
                          className="border-b border-border/30 hover:bg-bg-hover/50 transition-colors cursor-pointer"
                        >
                          <td className="px-3 py-2.5 sticky left-0 bg-bg-card z-10">
                            <div className="flex flex-col">
                              <div className="flex items-center gap-1.5">
                                <span className="font-semibold text-text-primary truncate max-w-[160px]">{name}</span>
                                <Badge variant={row.market === "KR" ? "blue" : row.market === "ETF" ? "purple" : "green"}>
                                  {row.market}
                                </Badge>
                              </div>
                              <span className="text-text-muted text-[11px] font-mono">{row.symbol}</span>
                            </div>
                          </td>
                          <td className={`px-3 py-2.5 text-right font-mono font-bold ${scoreColor(row.total_score)}`}>
                            {row.total_score != null ? row.total_score.toFixed(1) : "—"}
                          </td>
                          <td className={`px-3 py-2.5 text-right font-mono font-bold whitespace-nowrap ${gradeColor(row.grade)}`}>
                            {row.grade ?? "—"}
                          </td>
                          {(Object.keys(FACTOR_LABEL_KO) as QuantFactorKey[]).map((k) => {
                            const s = factorScore(k);
                            return (
                              <td key={k} className={`px-3 py-2.5 text-right font-mono text-xs ${scoreColor(s)}`}>
                                {s != null ? s.toFixed(1) : "—"}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {isFetching && !scoreLoading && (
              <div className="px-3 py-2 text-[11px] text-text-muted border-t border-border/30">갱신 중...</div>
            )}
          </Card>
          <p className="text-xs text-text-muted leading-relaxed">
            {truncated
              ? `한 번에 최대 30개까지 비교할 수 있어 앞쪽 30개만 표시했어요. 관심종목 폴더로 나눠서 확인해보세요.`
              : "관심종목 폴더로 나눠서 보면 더 빠르게 비교할 수 있어요."}
          </p>
        </>
      )}
    </div>
  );
}
