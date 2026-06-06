import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { backtestApi } from "@/api/stocks";
import { Card, LoadingSpinner, Badge, Button } from "@/components/ui";
import { useAuthStore } from "@/store/authStore";
import {
  LogIn, TrendingUp, Plus, Trash2, BarChart2, AlertTriangle,
} from "lucide-react";

type MarketFilter = "전체" | "KR" | "US";

const MARKET_FILTER_TABS: { id: MarketFilter; label: string }[] = [
  { id: "전체", label: "전체" },
  { id: "KR",   label: "한국 KR" },
  { id: "US",   label: "미국 US" },
];

export default function Strategies() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { isLoggedIn } = useAuthStore();

  const [marketFilter, setMarketFilter] = useState<MarketFilter>("전체");
  // 2-step delete: stores the id of the strategy awaiting confirmation
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);

  const { data: strategies, isLoading } = useQuery({
    queryKey: ["strategies"],
    queryFn: backtestApi.getStrategies,
    enabled: isLoggedIn,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => backtestApi.deleteStrategy(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["strategies"] });
      setPendingDeleteId(null);
    },
  });

  const allStrategies: any[] = strategies ?? [];

  // Stats
  const totalCount = allStrategies.length;
  const krCount    = allStrategies.filter((s) => s.market === "KR").length;
  const usCount    = allStrategies.filter((s) => s.market === "US").length;

  const filteredStrategies = marketFilter === "전체"
    ? allStrategies
    : allStrategies.filter((s) => s.market === marketFilter);

  return (
    <div className="flex flex-col gap-6">
      {/* ── 페이지 헤더 ──────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">전략 저장소</h1>
          <p className="text-text-muted text-xs mt-0.5">저장된 전략을 관리하고 백테스트에 로드합니다</p>
        </div>
        <Button onClick={() => navigate("/backtest")}>
          <Plus size={14} className="inline mr-1.5" />
          새 전략 만들기
        </Button>
      </div>

      {/* ── 비로그인 안내 ──────────────────────────────────────── */}
      {!isLoggedIn && (
        <Card className="flex flex-col items-center justify-center py-16 gap-5">
          <div className="w-16 h-16 rounded-full bg-accent-blue/10 flex items-center justify-center">
            <LogIn size={28} className="text-accent-blue" />
          </div>
          <div className="text-center">
            <p className="text-text-primary font-semibold text-base">로그인이 필요합니다</p>
            <p className="text-text-muted text-sm mt-1">전략 저장소는 로그인 후 이용할 수 있습니다</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => navigate("/login")}>로그인</Button>
            <Button variant="secondary" onClick={() => navigate("/register")}>회원가입</Button>
          </div>
        </Card>
      )}

      {isLoggedIn && (
        <>
          {/* ── 통계 카드 ──────────────────────────────────────── */}
          <div className="grid grid-cols-3 gap-3">
            <Card className="flex flex-col items-center gap-1 py-4">
              <div className="text-[11px] font-medium text-text-muted uppercase tracking-wide">전체 전략</div>
              <div className="text-2xl font-bold font-mono text-text-primary">{totalCount}</div>
            </Card>
            <Card className="flex flex-col items-center gap-1 py-4">
              <div className="text-[11px] font-medium text-text-muted uppercase tracking-wide">한국 KR</div>
              <div className="text-2xl font-bold font-mono text-blue-400">{krCount}</div>
            </Card>
            <Card className="flex flex-col items-center gap-1 py-4">
              <div className="text-[11px] font-medium text-text-muted uppercase tracking-wide">미국 US</div>
              <div className="text-2xl font-bold font-mono text-accent-green">{usCount}</div>
            </Card>
          </div>

          {/* ── 시장 필터 탭 ───────────────────────────────────── */}
          {totalCount > 0 && (
            <div className="flex gap-1 p-1 bg-bg-card border border-border rounded-xl w-fit">
              {MARKET_FILTER_TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setMarketFilter(t.id)}
                  className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                    marketFilter === t.id
                      ? "bg-accent-blue text-white shadow"
                      : "text-text-muted hover:text-text-primary"
                  }`}
                >
                  {t.label}
                  {t.id !== "전체" && (
                    <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full ${
                      marketFilter === t.id ? "bg-white/20 text-white" : "bg-bg-elevated text-text-muted"
                    }`}>
                      {t.id === "KR" ? krCount : usCount}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* ── 로딩 ───────────────────────────────────────────── */}
          {isLoading && <LoadingSpinner />}

          {/* ── 빈 상태 ────────────────────────────────────────── */}
          {!isLoading && totalCount === 0 && (
            <Card className="flex flex-col items-center justify-center py-16 gap-4 text-center">
              <div className="w-16 h-16 rounded-full bg-bg-elevated flex items-center justify-center">
                <TrendingUp size={28} className="text-text-muted" />
              </div>
              <div>
                <p className="text-text-primary font-semibold">저장된 전략이 없습니다</p>
                <p className="text-text-muted text-sm mt-1">
                  백테스트에서 전략을 만들고 저장해 보세요
                </p>
              </div>
              <Button onClick={() => navigate("/backtest")}>
                <Plus size={14} className="inline mr-1.5" />
                첫 전략 만들기
              </Button>
            </Card>
          )}

          {/* ── 필터 결과 없음 ─────────────────────────────────── */}
          {!isLoading && totalCount > 0 && filteredStrategies.length === 0 && (
            <Card className="flex flex-col items-center justify-center py-10 gap-3 text-center">
              <p className="text-text-muted text-sm">
                <span className="font-semibold text-text-secondary">{marketFilter}</span> 시장의 전략이 없습니다
              </p>
            </Card>
          )}

          {/* ── 전략 그리드 ────────────────────────────────────── */}
          {!isLoading && filteredStrategies.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredStrategies.map((s: any) => {
                const isPendingDelete = pendingDeleteId === s.id;
                const entryCount = s.entry_conditions?.conditions?.length ?? 0;
                const exitCount  = s.exit_conditions?.conditions?.length ?? 0;

                return (
                  <Card key={s.id} className="flex flex-col gap-0 p-0 overflow-hidden">
                    {/* Header */}
                    <div className="px-4 pt-4 pb-3 border-b border-border/60">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-text-primary text-sm truncate">{s.name}</span>
                            <Badge variant={s.market === "KR" ? "blue" : "green"}>{s.market}</Badge>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[11px] text-text-muted">v{s.version ?? 1}</span>
                            <span className="text-[11px] text-text-dim">·</span>
                            <span className="text-[11px] text-text-muted">
                              {s.created_at?.slice(0, 10) ?? "-"}
                            </span>
                          </div>
                        </div>
                        <TrendingUp size={16} className="text-text-muted flex-shrink-0 mt-0.5" />
                      </div>
                    </div>

                    {/* Body */}
                    <div className="px-4 py-3 flex flex-col gap-2 flex-1">
                      {s.description && (
                        <p className="text-xs text-text-secondary line-clamp-2">{s.description}</p>
                      )}
                      {/* Condition counts */}
                      <div className="flex gap-1.5 flex-wrap">
                        <span className="flex items-center gap-1 text-[11px] px-2 py-0.5 bg-blue-900/20 border border-blue-700/30 text-blue-400 rounded-md font-medium">
                          <BarChart2 size={10} />
                          진입 {entryCount}조건
                        </span>
                        <span className="flex items-center gap-1 text-[11px] px-2 py-0.5 bg-red-900/20 border border-red-700/30 text-accent-red rounded-md font-medium">
                          <BarChart2 size={10} />
                          청산 {exitCount}조건
                        </span>
                      </div>
                      {/* Stop-loss / take-profit */}
                      {(s.stop_loss || s.take_profit) && (
                        <div className="flex gap-1.5 flex-wrap">
                          {s.stop_loss   && <Badge variant="red">손절 {s.stop_loss}%</Badge>}
                          {s.take_profit && <Badge variant="green">익절 {s.take_profit}%</Badge>}
                        </div>
                      )}
                    </div>

                    {/* Footer / Actions */}
                    <div className="px-4 pb-4 pt-2 flex gap-2 border-t border-border/60 mt-1">
                      <Button
                        size="sm"
                        className="flex-1"
                        onClick={() => navigate("/backtest")}
                      >
                        <BarChart2 size={12} className="inline mr-1" />
                        백테스트 실행
                      </Button>
                      {isPendingDelete ? (
                        <div className="flex gap-1">
                          <button
                            onClick={() => deleteMutation.mutate(s.id)}
                            disabled={deleteMutation.isPending}
                            className="flex items-center gap-1 px-2.5 py-1 bg-accent-red/20 border border-accent-red/40 text-accent-red text-xs font-semibold rounded-lg hover:bg-accent-red/30 transition-colors"
                          >
                            <AlertTriangle size={11} />
                            확인
                          </button>
                          <button
                            onClick={() => setPendingDeleteId(null)}
                            className="px-2.5 py-1 bg-bg-elevated border border-border text-text-muted text-xs rounded-lg hover:text-text-primary transition-colors"
                          >
                            취소
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setPendingDeleteId(s.id)}
                          className="flex items-center gap-1 px-2.5 py-1 text-text-muted hover:text-accent-red border border-border hover:border-accent-red/40 text-xs rounded-lg transition-colors"
                        >
                          <Trash2 size={11} />
                          삭제
                        </button>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
