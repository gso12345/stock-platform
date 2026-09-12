/**
 * 조회 실패를 화면에 띄우는 자리.
 *
 * queryClient 의 QueryCache.onError 가 알려 주는 것을 받아 토스트로
 * 보여 준다. 앱 전체에 하나만 둔다 — 화면마다 두면 화면을 옮길 때
 * 알림이 사라지거나 겹친다.
 *
 * 왜 필요했나 — useQuery 가 102개인데 isError 를 다루는 곳이 31개뿐이라,
 * 나머지는 실패해도 빈 목록이나 영원한 로딩으로만 보였다. 사용자는
 * "느리다" 고 느끼지 "실패했다" 고 알지 못한다. 그러면 새로고침도
 * 안 해 보고 그냥 나간다.
 */
import { useCallback, useEffect, useState } from "react";
import { Toast } from "@/components/ui";
import { 오류구독 } from "@/api/queryError";

export default function QueryErrorToast() {
  /* 글만 들고 있으면 **같은 오류가 다시 나도 못 알아챈다.**
   *
   * 같은 문자열로 set 하면 React 가 상태가 안 바뀌었다고 보고 다시
   * 그리지 않는다. 그러면 Toast 안의 자동닫힘 타이머도 다시 시작되지
   * 않아서, 아직 고장이 이어지고 있는데 처음 뜬 시각 기준으로 띠가
   * 사라진다. 회차를 같이 들고 있으면 같은 글이어도 상태가 바뀐다. */
  const [알림, set알림] = useState<{ 글: string; 회차: number }>({ 글: "", 회차: 0 });

  useEffect(() => 오류구독((글) => set알림((앞) => ({ 글, 회차: 앞.회차 + 1 }))), []);

  const 닫기 = useCallback(() => set알림((앞) => ({ 글: "", 회차: 앞.회차 })), []);

  if (!알림.글) return null;
  /* key 에 회차를 넣어, 같은 글이 다시 와도 Toast 를 새로 세운다 —
     그래야 자동닫힘 타이머가 처음부터 다시 돈다 */
  return <Toast key={알림.회차} message={알림.글} kind="error" onClose={닫기} />;
}
