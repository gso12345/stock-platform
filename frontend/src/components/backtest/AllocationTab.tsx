/**
 * 자산배분 백테스트 탭 — 설정·결과·실험목록을 잇는 자리.
 *
 * 계산은 서버가 하고, 여기는 설정을 모아 보내고 받은 것을 그리는 일만
 * 한다. 수익률을 화면에서 다시 계산하지 않는다 — 두 군데서 계산하면
 * 반드시 어긋나고, 그 어긋남은 '어느 쪽이 맞나' 를 아무도 모르는
 * 상태로 이어진다.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { backtestApi, type 자산배분요청, type 자산배분결과 } from "@/api/stocks";
import { useAuthStore } from "@/store/authStore";
import { Card, 못불러옴 } from "@/components/ui";
import { 읽을수있는오류 } from "@/utils/errors";
import 자산배분설정, { 첫설정, 실험목록, type 설정 } from "./AllocationForm";
import 자산배분결과화면 from "./AllocationResult";

/** 화면의 설정을 서버가 받는 모양으로. */
export function 보낼것(s: 설정): 자산배분요청 {
  return {
    assets: s.assets,
    currency: s.currency,
    initial_amount: Number(s.initial_amount) || 0,
    start_date: s.start_date,
    end_date: s.end_date,
    /* 주기가 '없음' 이면 금액도 0 으로 보낸다. 금액만 남겨 두면
       서버가 '적립 있음' 으로 읽어 총납입이 부풀려진다 */
    contribution_period: s.contribution_period,
    contribution_amount: s.contribution_period === "none"
      ? 0 : (Number(s.contribution_amount) || 0),
    rebalance_period: s.rebalance_period,
    total_return: s.total_return,
    rebalance_day: s.rebalance_day,
    /* 퍼센트 그대로 보낸다 — 비율로 바꾸는 것은 서버 한 곳에서만 한다.
       양쪽에서 나누면 수수료가 100분의 1 이 되고, 아무도 못 알아챈다 */
    cost_rate: Number(s.cost_rate) || 0,
    data_interval: s.data_interval,
    benchmark: s.benchmark,
    equal_weight: s.equal_weight,
    extended: s.extended,
  };
}

export default function 자산배분탭() {
  const qc = useQueryClient();
  const { isLoggedIn } = useAuthStore();
  const [설정값, set설정값] = useState<설정>(() => 첫설정());
  const [결과, set결과] = useState<자산배분결과 | null>(null);
  const [오류, set오류] = useState<string | null>(null);
  const [목록열림, set목록열림] = useState(false);

  const { data: 실험들 = [] } = useQuery({
    queryKey: ["backtest-experiments"],
    queryFn: backtestApi.getExperiments,
    /* 서버가 비로그인에 빈 배열을 주므로 401 이 안 난다.
       그래도 로그인 전에는 부를 이유가 없다 */
    enabled: isLoggedIn,
    staleTime: 300_000,
  });

  const 돌리기 = useMutation({
    mutationFn: () => backtestApi.runPortfolio(보낼것(설정값)),
    onSuccess: (d) => { set결과(d); set오류(null); },
    /* detail 을 그대로 넣으면 안 된다 — FastAPI 422 는 객체 배열이라
       React 자식으로 들어가는 순간 화면이 죽는다 */
    onError: (e: any) => set오류(읽을수있는오류(
      e?.response?.data?.detail, "계산에 실패했어요. 잠시 후 다시 시도해 주세요")),
  });

  const 저장 = useMutation({
    mutationFn: () => backtestApi.saveExperiment({
      ...보낼것(설정값),
      name: 설정값.assets.map((a) => a.name || a.symbol).slice(0, 3).join(" · ")
            + (설정값.assets.length > 3 ? ` 외 ${설정값.assets.length - 3}` : ""),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["backtest-experiments"] }),
    onError: (e: any) => set오류(읽을수있는오류(
      e?.response?.data?.detail, "저장에 실패했어요")),
  });

  const 지우기 = useMutation({
    mutationFn: (id: number) => backtestApi.deleteExperiment(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["backtest-experiments"] }),
  });

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
      <div className="flex flex-col gap-4">
        {목록열림 ? (
          <실험목록
            것들={실험들}
            닫기={() => set목록열림(false)}
            지우기={(id) => 지우기.mutate(id)}
            불러오기={(id) => {
              const x = 실험들.find((e) => e.id === id);
              if (!x) return;
              /* 저장된 실험에는 옛 설정이 없을 수 있다(기능이 늘기 전에
                 저장한 것). 빠진 칸은 지금 화면의 값을 그대로 둔다 —
                 undefined 로 두면 고르기 칸이 통제 불능이 된다.

                 ?? 를 쓴다(|| 가 아니라). cost_rate 0 과 equal_weight
                 false 는 **고른 값**인데, || 로 두면 falsy 라서 지금
                 화면 값으로 덮인다 — 수수료를 0 으로 저장해 두고
                 불러오면 0.25% 가 되어 있는 식이다. */
              set설정값({
                ...설정값,
                직접입력: true,
                start_date: x.start_date, end_date: x.end_date,
                currency: x.currency, initial_amount: x.initial_amount,
                assets: x.assets,
                contribution_period: x.contribution_period,
                contribution_amount: x.contribution_amount,
                rebalance_period: x.rebalance_period,
                total_return: x.total_return,
                rebalance_day: x.rebalance_day ?? 설정값.rebalance_day,
                cost_rate: x.cost_rate ?? 설정값.cost_rate,
                data_interval: x.data_interval ?? 설정값.data_interval,
                benchmark: x.benchmark ?? 설정값.benchmark,
                equal_weight: x.equal_weight ?? 설정값.equal_weight,
                extended: x.extended ?? 설정값.extended,
              });
              set목록열림(false);
              set결과(null);
            }}
          />
        ) : (
          <자산배분설정
            값={설정값}
            바꾸기={set설정값}
            돌리기={() => 돌리기.mutate()}
            도는중={돌리기.isPending}
            목록열기={() => set목록열림(true)}
            저장하기={isLoggedIn ? () => 저장.mutate() : undefined}
          />
        )}
      </div>

      <div className="flex flex-col gap-4">
        {오류 && (
          <Card className="border-accent-red/40">
            <못불러옴 사유={오류} 다시={() => 돌리기.mutate()} compact />
          </Card>
        )}
        {!오류 && !결과 && !돌리기.isPending && (
          <Card className="flex flex-col gap-2 py-12 text-center">
            <span className="text-sm text-text-muted">
              자산을 고르고 ‘결과 확인’ 을 눌러 보세요
            </span>
            <span className="text-2xs text-text-dim break-keep px-4">
              예: S&P500 ETF 60% · 금 20% · 현금 20% 로 8년, 매달 50만원씩 더 넣고
              해마다 비중 맞추기
            </span>
          </Card>
        )}
        {돌리기.isPending && (
          <Card className="flex flex-col gap-2 py-12 items-center">
            <span className="text-sm text-text-muted">계산 중…</span>
            <span className="text-2xs text-text-dim">자산마다 시세를 받아 옵니다</span>
          </Card>
        )}
        {결과 && !돌리기.isPending && <자산배분결과화면 r={결과} />}
      </div>
    </div>
  );
}
