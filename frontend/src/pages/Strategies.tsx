import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { backtestApi } from "@/api/stocks";
import { Card, LoadingSpinner } from "@/components/ui";

export default function Strategies() {
  const qc = useQueryClient();

  const { data: strategies, isLoading } = useQuery({
    queryKey: ["strategies"],
    queryFn: backtestApi.getStrategies,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => backtestApi.deleteStrategy(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["strategies"] }),
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-text-primary">전략 저장소</h1>
        <a
          href="/backtest"
          className="px-4 py-2 bg-accent-blue hover:bg-blue-600 text-white text-sm font-medium rounded-lg transition-colors"
        >
          + 새 전략
        </a>
      </div>

      {isLoading ? (
        <LoadingSpinner />
      ) : !strategies?.length ? (
        <Card>
          <p className="text-text-muted text-sm py-8 text-center">
            저장된 전략이 없습니다. 백테스트에서 전략을 저장하세요.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {strategies.map((s: any) => (
            <Card key={s.id} className="flex flex-col gap-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-semibold text-text-primary">{s.name}</div>
                  <div className="text-text-muted text-xs mt-0.5">v{s.version} · {s.market}</div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => deleteMutation.mutate(s.id)}
                    className="text-text-muted hover:text-accent-red text-xs transition-colors"
                  >
                    삭제
                  </button>
                </div>
              </div>

              {s.description && (
                <p className="text-text-secondary text-xs">{s.description}</p>
              )}

              <div className="flex flex-wrap gap-2">
                {s.stop_loss && (
                  <span className="text-xs px-2 py-0.5 bg-red-900/30 text-accent-red rounded border border-red-800/40">
                    손절 {s.stop_loss}%
                  </span>
                )}
                {s.take_profit && (
                  <span className="text-xs px-2 py-0.5 bg-green-900/30 text-accent-green rounded border border-green-800/40">
                    익절 {s.take_profit}%
                  </span>
                )}
              </div>

              <div className="border-t border-border pt-2 text-xs text-text-muted">
                진입: {s.entry_conditions?.conditions?.length ?? 0}개 조건 ·
                청산: {s.exit_conditions?.conditions?.length ?? 0}개 조건
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
