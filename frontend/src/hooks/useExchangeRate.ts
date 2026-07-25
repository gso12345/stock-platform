import { useQuery } from "@tanstack/react-query";
import { dashboardApi } from "@/api/stocks";

/** 환율을 못 불러왔을 때만 쓰는 최후 기본값 */
export const DEFAULT_FX = 1350;

/** 표시 이름이 바뀌어도 원/달러 항목을 찾아내도록 느슨하게 판별 */
export function isUsdKrwRow(r: any): boolean {
  if (!r) return false;
  if (typeof r.symbol === "string" && r.symbol.toUpperCase().startsWith("USDKRW")) return true;
  const name = typeof r.name === "string" ? r.name.replace(/\s/g, "") : "";
  return name.includes("달러") && !name.includes("유로") && !name.includes("엔");
}

/**
 * 원/달러 환율 — 화면마다 제각기 구하던 것을 하나로 모은 훅.
 *
 * 이전에는 각 페이지가 미국 금리 목록에서 "원/달러"라는 표시 이름을 정확히 일치시켜
 * 꺼냈기 때문에, 서버에서 라벨을 조금만 바꿔도 아무 오류 없이 기본값 1350원으로
 * 떨어져 자산 평가액이 통째로 틀어졌다.
 *
 * 그래서 값만 돌려주는 전용 엔드포인트(/dashboard/exchange)를 1순위로 쓰고,
 * 실패했을 때만 금리 목록을 느슨한 조건으로 뒤지는 2순위 조회를 켠다.
 */
export function useExchangeRate(): number {
  const { data: fx } = useQuery({
    queryKey: ["exchange-rate"],
    queryFn: () => dashboardApi.getExchangeRate(),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const direct = (fx as any)?.value;
  const hasDirect = typeof direct === "number" && direct > 0;

  // 1순위가 값을 주지 못할 때만 요청 (평소에는 네트워크 비용 0)
  const { data: usRates } = useQuery({
    queryKey: ["dashboard-us-rates"],
    queryFn: () => dashboardApi.getUSRates(),
    staleTime: 300_000,
    enabled: !hasDirect,
  });

  if (hasDirect) return direct;

  if (Array.isArray(usRates)) {
    const row = (usRates as any[]).find(isUsdKrwRow);
    if (typeof row?.value === "number" && row.value > 0) return row.value;
  }
  return DEFAULT_FX;
}
