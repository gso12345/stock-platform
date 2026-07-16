import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { quantScoreApi, watchlistApi, watchlistFolderApi, portfolioApi, type QuantFactorKey } from "@/api/stocks";
import { useQuantSettings, QUANT_DEFAULT_WEIGHTS } from "@/hooks/useQuantSettings";
import { getRecentlyViewed, type RecentStock } from "@/utils/recentlyViewed";
import QuantSettingsPanel from "@/components/quant/QuantSettingsPanel";
import { useAuthStore } from "@/store/authStore";
import { Card, Badge, RowSkeleton, Button } from "@/components/ui";
import { Award, AlertCircle, Settings2, LogIn, ArrowDown, ArrowUp, Clock, Wallet } from "lucide-react";
import { GRADE_BANDS, gradeColor, scoreColor } from "@/utils/quant";

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

export default function Quant() {
  const navigate = useNavigate();
  const { isLoggedIn } = useAuthStore();
  const [marketTab, setMarketTab] = useState("전체");
  const [folderTab, setFolderTab] = useState<number | "all" | "none" | "recent">("all");
  const [portfolioTab, setPortfolioTab] = useState<number | null>(null);
  const [showGradeHelp, setShowGradeHelp] = useState(false);
  const gradeHelpRef = useRef<HTMLDivElement>(null);
  const [sortKey, setSortKey] = useState<SortKey>("total");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [recentlyViewed, setRecentlyViewed] = useState<RecentStock[]>(() => getRecentlyViewed());

  // 최근조회 탭 선택 시 localStorage에서 새로 불러오기
  useEffect(() => {
    if (folderTab === "recent") {
      setRecentlyViewed(getRecentlyViewed());
    }
  }, [folderTab]);

  // 등급 도움말 팝업 외부 클릭 시 닫기
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (gradeHelpRef.current && !gradeHelpRef.current.contains(e.target as Node)) {
        setShowGradeHelp(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

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

  const { data: pfList = [] } = useQuery<any[]>({
    queryKey: ["portfolios"],
    queryFn: portfolioApi.getPortfolios,
    enabled: isLoggedIn,
    staleTime: 300_000,
  });

  const { data: pfItems = [] } = useQuery({
    queryKey: ["portfolio-tab-items", portfolioTab],
    queryFn: () => portfolioApi.getItems(portfolioTab ?? undefined),
    enabled: isLoggedIn && portfolioTab !== null,
    staleTime: 60_000,
  });

  const filteredItems = useMemo(() => {
    let list = (items ?? []) as any[];
    if (marketTab !== "전체") list = list.filter((it) => it.market === marketTab);
    if (folderTab === "none") list = list.filter((it) => !it.folder_id);
    else if (folderTab !== "all") list = list.filter((it) => it.folder_id === folderTab);
    return list;
  }, [items, marketTab, folderTab]);

  const allCompareItems = useMemo(() => {
    if (portfolioTab !== null) {
      let list = (pfItems as any[]);
      if (marketTab !== "전체") list = list.filter((i) => i.market === marketTab);
      const seen = new Set<string>();
      const out: { symbol: string; market: string; name: string }[] = [];
      for (const it of list) {
        const key = `${it.market}:${it.symbol}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ symbol: it.symbol, market: it.market, name: it.name });
      }
      return out;
    }
    if (folderTab === "recent") {
      let recentList = recentlyViewed;
      if (marketTab !== "전체") recentList = recentList.filter((s) => s.market === marketTab);
      return recentList.slice(0, 10).map((s) => ({ symbol: s.symbol, market: s.market, name: s.name }));
    }
    const seen = new Set<string>();
    const out: { symbol: string; market: string; name: string }[] = [];
    for (const it of filteredItems as any[]) {
      const key = `${it.market}:${it.symbol}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ symbol: it.symbol, market: it.market, name: it.name });
    }
    return out;
  }, [filteredItems, folderTab, recentlyViewed, marketTab, portfolioTab, pfItems]);
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
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
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
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors whitespace-nowrap flex-shrink-0 ${
              showSettings ? "border-accent-blue text-accent-blue bg-accent-blue/5" : "border-border text-text-muted hover:text-text-primary hover:border-accent-blue/40"
            }`}
          >
            <Settings2 size={14} className="flex-shrink-0" />기준 수정
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

          <div className="flex border-b border-border bg-bg-card rounded-t-xl overflow-x-auto scrollbar-hide">
            {(() => {
              const tabCls = (active: boolean) =>
                `flex-shrink-0 whitespace-nowrap px-4 py-3 text-sm font-semibold border-b-2 -mb-px transition-all ${
                  active ? "border-accent-blue text-accent-blue bg-accent-blue/5" : "border-transparent text-text-muted hover:text-text-primary hover:bg-bg-elevated"
                }`;
              return (
                <>
                  <button
                    onClick={() => { setFolderTab("all"); setPortfolioTab(null); }}
                    className={tabCls(folderTab === "all" && portfolioTab === null)}
                  >
                    전체 <span className="text-[10px] opacity-70">{portfolioTab === null && folderTab === "all" ? allCompareItems.length : ((items ?? []) as any[]).filter((i) => marketTab === "전체" || i.market === marketTab).length}</span>
                  </button>
                  <button
                    onClick={() => { setFolderTab("recent"); setPortfolioTab(null); }}
                    className={tabCls(folderTab === "recent" && portfolioTab === null)}
                  >
                    <span className="flex items-center gap-1"><Clock size={13} /> 최근조회 <span className="text-[10px] opacity-70">{recentlyViewed.filter((s) => marketTab === "전체" || s.market === marketTab).length}</span></span>
                  </button>
                  {(folders ?? []).map((f: any) => {
                    const cnt = ((items ?? []) as any[]).filter(
                      (i) => i.folder_id === f.id && (marketTab === "전체" || i.market === marketTab),
                    ).length;
                    return (
                      <button
                        key={f.id}
                        onClick={() => { setFolderTab(f.id); setPortfolioTab(null); }}
                        className={tabCls(folderTab === f.id && portfolioTab === null)}
                      >
                        {f.name} <span className="text-[10px] opacity-70">{cnt}</span>
                      </button>
                    );
                  })}
                  {pfList.map((pf: any) => (
                    <button
                      key={`pf-${pf.id}`}
                      onClick={() => { setPortfolioTab(pf.id); setFolderTab("all"); }}
                      className={`${tabCls(portfolioTab === pf.id)} flex items-center gap-1`}
                    >
                      <Wallet size={11} />{pf.name}
                    </button>
                  ))}
                </>
              );
            })()}
          </div>

          <Card className="p-0 overflow-hidden">
            {itemsLoading || scoreLoading ? (
              <div className="p-3">
                <RowSkeleton rows={5} />
              </div>
            ) : compareItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
                <Award size={32} className="text-text-muted/40" />
                {portfolioTab !== null ? (
                  <>
                    <p className="text-text-secondary text-sm">이 포트폴리오에 종목이 없어요</p>
                    <p className="text-text-muted text-xs">내 자산 메뉴에서 종목을 추가해보세요</p>
                  </>
                ) : folderTab === "recent" ? (
                  <>
                    <p className="text-text-secondary text-sm">최근 조회한 종목이 없어요</p>
                    <p className="text-text-muted text-xs">종목 상세 페이지를 방문하면 여기서 바로 비교할 수 있어요</p>
                  </>
                ) : (
                  <>
                    <p className="text-text-secondary text-sm">비교할 관심종목이 없어요</p>
                    <p className="text-text-muted text-xs">관심종목 메뉴에서 종목을 추가하면 여기서 비교할 수 있어요</p>
                  </>
                )}
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
                        <div ref={gradeHelpRef} className="flex items-center justify-end gap-1.5 relative whitespace-nowrap">
                          등급
                          <button
                            onClick={() => setShowGradeHelp((s) => !s)}
                            className="flex items-center justify-center w-4 h-4 rounded-full border border-border text-text-muted hover:text-text-primary hover:border-accent-blue/40"
                          >
                            ?
                          </button>
                          {showGradeHelp && (
                            <div className="absolute left-0 top-6 z-50 w-48 rounded-xl border border-border bg-bg-elevated shadow-lg p-3 flex flex-col gap-1.5 text-left">
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
                          tabIndex={0}
                          onClick={() => navigate(`/stocks/${row.market}/${row.symbol}`)}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/stocks/${row.market}/${row.symbol}`); } }}
                          className="border-b border-border/30 hover:bg-bg-hover/50 transition-colors cursor-pointer focus:outline-none focus:bg-bg-hover/50"
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
                          <td className={`px-3 py-2.5 text-right font-mono font-bold whitespace-nowrap ${scoreColor(row.total_score)}`}>
                            {row.total_score != null ? row.total_score.toFixed(1) : "—"}
                          </td>
                          <td className={`px-3 py-2.5 text-right font-mono font-bold whitespace-nowrap ${gradeColor(row.grade)}`}>
                            {row.grade ?? "—"}
                          </td>
                          {(Object.keys(FACTOR_LABEL_KO) as QuantFactorKey[]).map((k) => {
                            const s = factorScore(k);
                            return (
                              <td key={k} className={`px-3 py-2.5 text-right font-mono text-xs whitespace-nowrap ${scoreColor(s)}`}>
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
