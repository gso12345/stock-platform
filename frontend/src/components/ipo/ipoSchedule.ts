/**
 * 청약 일정 챙기기 — 오늘 청약이 마감되는지, 며칠 뒤 청약인지, 무엇부터 챙길지.
 *
 * 서버의 단계는 청약이 끝나 경쟁률이 나와야 '청약 완료' 가 된다. 그 전 청약 기간에는
 * '청약 예정' 그대로라, 오늘이 청약 날인지는 날짜(한국 날짜)로 가른다.
 */
import type { 다가오는공모주 } from "@/api/stocks";
import { 남은날 } from "./ipoFormat";

/** 청약 배지 — 청약 중이면 급함(오늘·내일 마감), 청약을 앞두고 있으면 'D-n'.
 *  청약이 끝났거나(경쟁률이 나왔거나 마감일이 지났거나) 날짜가 없으면 null */
export function 청약표(g: 다가오는공모주, 지금: Date = new Date()): { 글: string; 급함: boolean } | null {
  if (g.sub_ratio != null) return null;
  const 시작 = 남은날(g.sub_start, 지금);
  const 끝 = 남은날(g.sub_end ?? g.sub_start, 지금);
  if (시작 == null || 끝 == null || 끝 < 0) return null;
  if (시작 > 0) return { 글: `청약 D-${시작}`, 급함: false };
  return { 글: 끝 === 0 ? "청약 오늘 마감" : 끝 === 1 ? "청약 내일 마감" : `청약 중 · ${끝}일 뒤 마감`, 급함: true };
}

/** 챙길 순서 — 청약 중인 것(마감이 빠른 것부터) → 다음 일정이 빠른 것부터 → 남은 일정이 없는 것.
 *
 *  예전에는 서버가 준 상장일 순 그대로라, 상장일이 먼저 잡힌 공모주 뒤로 오늘 마감하는 청약이
 *  밀렸다. 다음 일정은 청약 시작(청약이 안 끝났을 때)·상장·수요예측 가운데 오늘 이후로 가장
 *  빠른 날이고, 같은 날이면 청약 → 상장 → 수요예측 차례다. */
export function 챙길순서(목록: 다가오는공모주[], 지금: Date = new Date()): 다가오는공모주[] {
  const 열쇠 = (g: 다가오는공모주): number[] => {
    const 표 = 청약표(g, 지금);
    if (표?.급함) return [0, 남은날(g.sub_end ?? g.sub_start, 지금)!, 0];
    // 차례대로 늘어놓았다 — 정렬은 같은 날이면 늘어놓은 차례를 지킨다(청약 → 상장 → 수요예측)
    const 일정: [string | null | undefined, number][] = [
      [g.sub_ratio == null ? g.sub_start : null, 0], [g.list_date, 1], [g.forecast_date, 2],
    ];
    const 다음 = 일정
      .map(([iso, 차례]) => [남은날(iso, 지금), 차례] as const)
      .filter((x): x is readonly [number, number] => x[0] != null && x[0] >= 0)
      .sort((a, b) => a[0] - b[0])[0];
    return 다음 ? [1, 다음[0], 다음[1]] : [2, 0, 0];
  };
  return 목록
    .map((g, i) => ({ g, k: 열쇠(g), i }))
    .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2] || a.i - b.i)
    .map((x) => x.g);
}
