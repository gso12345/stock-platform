import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { quantScoreApi, watchlistApi, watchlistFolderApi, type QuantFactorKey } from "@/api/stocks";
import { useQuantSettings, QUANT_DEFAULT_WEIGHTS } from "@/hooks/useQuantSettings";
import QuantSettingsPanel from "@/components/quant/QuantSettingsPanel";
import { useAuthStore } from "@/store/authStore";
import { Card, Badge, LoadingSpinner, Button } from "@/components/ui";
import { Award, AlertCircle, Settings2, LogIn } from "lucide-react";

const FACTOR_LABEL_KO: Record<QuantFactorKey, string> = {
  value: "가치", quality: "품질", momentum: "모멘텀", growth: "성장", risk: "안정성",
};

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
  const [folderId, setFolderId] = useState<number | "all">("all");
  const [showGradeHelp, setShowGradeHelp] = useState(false);

  const { data: folders } = useQuery({
    queryKey: ["watchlist-folders"],
    queryFn: watchlistFolderApi.getFolders,
    enabled: isLoggedIn,
  });

  const { data: items, isLoading: itemsLoading } = useQuery({
    queryKey: ["watchlist-items", folderId],
    queryFn: () => watchlistApi.getItems(undefined, folderId === "all" ? undefined : folderId),
    enabled: isLoggedIn,
  });

  const allCompareItems = useMemo(
    () => (items ?? []).map((it: any) => ({ symbol: it.symbol, market: it.market, name: it.name })),
    [items],
  );
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

  const rows = useMemo(() => {
    const list = compareData?.items ?? [];
    return [...list].sort((a, b) => (b.total_score ?? -1) - (a.total_score ?? -1));
  }, [compareData]);

  useEffect(() => {
    if (folderId !== "all" && folders && !folders.some((f: any) => f.id === folderId)) {
      setFolderId("all");
    }
  }, [folders, folderId]);

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

          {folders && folders.length > 0 && (
            <div className="flex gap-1 bg-bg-elevated border border-border rounded-lg p-0.5 w-fit overflow-x-auto">
              <button
                onClick={() => setFolderId("all")}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all whitespace-nowrap ${
                  folderId === "all" ? "bg-accent-blue text-white" : "text-text-muted hover:text-text-primary"
                }`}
              >
                전체
              </button>
              {folders.map((f: any) => (
                <button
                  key={f.id}
                  onClick={() => setFolderId(f.id)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all whitespace-nowrap ${
                    folderId === f.id ? "bg-accent-blue text-white" : "text-text-muted hover:text-text-primary"
                  }`}
                >
                  {f.name}
                </button>
              ))}
            </div>
          )}

          <Card className="p-0 overflow-hidden">
            {itemsLoading || scoreLoading ? (
              <div className="flex items-center justify-center h-64">
                <LoadingSpinner />
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
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-bg-secondary border-b border-border z-10">
                    <tr className="text-text-muted text-[11px]">
                      <th className="text-left px-3 py-3 sticky left-0 bg-bg-secondary z-20">종목</th>
                      <th className="text-right px-3 py-3">종합점수</th>
                      <th className="text-right px-3 py-3">
                        <div className="flex items-center justify-end gap-1.5 relative">
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
                        <th key={k} className="text-right px-3 py-3 whitespace-nowrap">{FACTOR_LABEL_KO[k]}</th>
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
                          <td className={`px-3 py-2.5 text-right font-mono font-bold ${gradeColor(row.grade)}`}>
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
