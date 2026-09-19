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
/**
 * 원/달러가 오늘 얼마나 움직였나(%).
 *
 * 해외 종목의 원화 평가금액은 주가와 환율 둘이 같이 정한다. 그런데
 * 지금까지 '오늘 손익' 은 주가만 봤다 — 미국장이 쉬는 날에 원화가 1%
 * 약해지면 총 평가금액은 1% 늘어나는데 '오늘' 은 0원이었다.
 *
 * 값 자체는 같은 질의에서 이미 오고 있었다(지표카드의 change_rate).
 * 훅이 value 만 꺼내 쓰고 버리고 있었을 뿐이다.
 *
 * useExchangeRate 와 **같은 queryKey** 를 쓴다 — react-query 가 합쳐
 * 주므로 왕복이 늘지 않는다.
 */
export function useExchangeRateChange(): number | null {
  const { data: fx } = useQuery({
    queryKey: ["exchange-rate"],
    queryFn: () => dashboardApi.getExchangeRate(),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
  const v = (fx as { change_rate?: unknown } | undefined)?.change_rate;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * 환율과 **그것이 진짜인지**를 같이 돌려준다.
 *
 * ── 왜 '진짜인지' 가 필요한가 ─────────────────────────────
 *
 * 못 받으면 1350 을 쓴다. 화면에 '오늘 환율' 처럼 보이지만 아니다.
 * 평가금액을 눈으로 보는 자리에서는 몇십 원 차이라 넘어갈 만하지만,
 * 그 수로 **비중을 매겨 백테스트에 넣는** 자리에서는 다르다 —
 * 달러 종목의 비중이 통째로 어긋난 채로 지난 20년을 재게 되고,
 * 화면에는 아무 표시도 안 난다.
 *
 * 그래서 값과 출처를 같이 준다. 쓰는 쪽이 '어림값이면 적어 둔다' 를
 * 고를 수 있어야 한다.
 *
 * 받는 주기는 60초다 — staleTime 과 refetchInterval 이 같아서, 열어
 * 두면 1분마다 새로 받고 그 사이에는 받아 둔 값을 쓴다.
 */
export function useExchangeRateLive(): { 환율: number; 진짜인가: boolean } {
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

  if (hasDirect) return { 환율: direct, 진짜인가: true };

  if (Array.isArray(usRates)) {
    const row = (usRates as any[]).find(isUsdKrwRow);
    if (typeof row?.value === "number" && row.value > 0) {
      //: 2순위도 실제로 받아 온 값이다 — 어림값이 아니다
      return { 환율: row.value, 진짜인가: true };
    }
  }
  return { 환율: DEFAULT_FX, 진짜인가: false };
}

export function useExchangeRate(): number {
  return useExchangeRateLive().환율;
}
