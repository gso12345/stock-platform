/**
 * 청약 일정 챙기기 — 오늘 청약이 마감되는지, 며칠 뒤 청약인지, 어떤 차례로 늘어놓을지.
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

/** 청약일이 빠른 순서 — 사용자: "청약일정 나오는 순서는 청약일이 빠른 순서로 배열해줘".
 *
 *  청약일(시작)이 아직 안 잡힌 것(수요예측 전)은 뒤로, 그 안에서는 수요예측일 순. 날짜가
 *  같으면 서버가 준 차례 그대로. 날짜는 'YYYY-MM-DD' 라 글자 순이 곧 날짜 순이다. */
export function 청약일순(목록: 다가오는공모주[]): 다가오는공모주[] {
  const 날 = (iso: string | null | undefined) => iso || "9999-12-31";
  return 목록
    .map((g, i) => ({ g, i }))
    .sort((a, b) => 날(a.g.sub_start).localeCompare(날(b.g.sub_start))
      || 날(a.g.forecast_date).localeCompare(날(b.g.forecast_date)) || a.i - b.i)
    .map((x) => x.g);
}
