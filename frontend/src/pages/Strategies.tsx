import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { backtestApi } from "@/api/stocks";
import { Card, LoadingSpinner } from "@/components/ui";
import { useAuthStore } from "@/store/authStore";
import { LogIn } from "lucide-react";

export default function Strategies() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { isLoggedIn } = useAuthStore();

  const { data: strategies, isLoading, error } = useQuery({
    queryKey: ["strategies"],
    queryFn: backtestApi.getStrategies,
    enabled: isLoggedIn,
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

      {/* 비로그인 안내 */}
      {!isLoggedIn && (
        <Card className="flex flex-col items-center justify-center py-14 gap-4">
          <div className="w-14 h-14 rounded-full bg-accent-blue/10 flex items-center justify-center">
            <LogIn size={24} className="text-accent-blue" />
          </div>
          <div className="text-center">
            <p className="text-text-primary font-semibold">로그인이 필요합니다</p>
            <p className="text-text-muted text-xs mt-1">전략 저장소는 로그인 후 이용할 수 있습니다</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => navigate("/login")}
              className="px-5 py-2 bg-accent-blue hover:bg-blue-600 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              로그인
            </button>
            <button
              onClick={() => navigate("/register")}
              className="px-5 py-2 border border-border text-text-secondary text-sm font-medium rounded-lg hover:border-accent-blue hover:text-accent-blue transition-colors"
            >
              회원가입
            </button>
          </div>
        </Card>
      )}

      {isLoggedIn && isLoading ? (
        <LoadingSpinner />
      ) : isLoggedIn && !strategies?.length ? (
        <Card>
          <p className="text-text-muted text-sm py-8 text-center">
            저장된 전략이 없습니다. 백테스트에서 전략을 저장하세요.
          </p>
        </Card>
      ) : isLoggedIn && (
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
