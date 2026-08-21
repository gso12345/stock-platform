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
import { useEffect, useState } from "react";
import { Toast } from "@/components/ui";
import { 오류구독 } from "@/api/queryError";

export default function QueryErrorToast() {
  const [글, set글] = useState("");

  useEffect(() => 오류구독(set글), []);

  if (!글) return null;
  return <Toast message={글} kind="error" onClose={() => set글("")} />;
}
