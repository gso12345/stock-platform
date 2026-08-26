/** 관리 기록 탭 — 무슨 일이 있었는지.
 *
 * 원래 Admin.tsx 한 파일(1,963줄)에 있던 것을 탭 단위로 가른 조각이다.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tabs, RowSkeleton, 못불러옴 } from "@/components/ui";

import { adminApi } from "@/components/admin/adminApi";

/* ─────────────────────────── 관리 기록 탭 ─────────────────────────── */
/** 무슨 일이 있었는지.
 *
 *  지우기와 정지는 되돌릴 수 없다. 되돌릴 수 없다면 최소한 무슨 일이
 *  있었는지는 알 수 있어야 한다 — 특히 관리자가 여럿일 때.
 *  예전에는 로그 파일에만, 그나마 '누가' 가 빠진 채 남았다. */
const 행위이름: Record<string, string> = {
  "user.delete": "계정 삭제", "user.active": "계정 정지·해제",
  "user.community_ban": "커뮤니티 차단·해제",
  "post.delete": "글 삭제", "post.blind": "글 가리기", "post.unblind": "글 복구",
  "comment.delete": "댓글 삭제", "comment.blind": "댓글 가리기", "comment.unblind": "댓글 복구",
  "cache.clear": "캐시 전체 비우기", "cache.delete": "캐시 삭제",
  "cache.delete_prefix": "캐시 묶음 삭제",
};
/** 되돌릴 수 없는 것은 눈에 띄게 */
const 되돌릴수없음 = new Set(["user.delete", "post.delete", "comment.delete", "cache.clear"]);

export function AdminLogTab() {
  const [필터, set필터] = useState("");
  const { data, isLoading, isError: 못받음, error: 실패사유, refetch } = useQuery({
    queryKey: ["admin-logs", 필터],
    queryFn: () => adminApi.getAdminLogs(필터),
    staleTime: 15_000,
  });
  const items: any[] = data?.items ?? [];

  return (
    <div className="flex flex-col gap-3">
      <Tabs
        ariaLabel="기록 종류" tone="subtle" fill={false} className="w-fit"
        tabs={[
          { id: "", label: "전체" },
          { id: "user", label: "계정" },
          { id: "post", label: "게시글" },
          { id: "comment", label: "댓글" },
          { id: "cache", label: "캐시" },
        ]}
        active={필터}
        onChange={set필터}
      />

      <div className="rounded-xl border border-border bg-bg-card overflow-hidden">
        {isLoading ? (
          <div className="p-3"><RowSkeleton rows={6} /></div>
        ) : 못받음 ? (
          <못불러옴 사유={실패사유} 다시={() => refetch()} />
        ) : !items.length ? (
          <div className="py-16 text-center">
            <p className="text-text-muted text-sm">아직 기록이 없습니다</p>
            <p className="text-2xs text-text-dim mt-1">관리자가 무언가를 지우거나 정지하면 여기 남습니다</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((it) => (
              <li key={it.id} className="px-4 py-3 flex items-start gap-3">
                <span className={`text-2xs px-1.5 py-0.5 rounded font-bold shrink-0 whitespace-nowrap ${
                  되돌릴수없음.has(it.action)
                    ? "bg-accent-red/15 text-accent-red"
                    : "bg-bg-elevated text-text-muted"}`}>
                  {행위이름[it.action] ?? it.action}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary truncate">
                    <span className="font-semibold">{it.actor || "?"}</span>
                    {it.target_id && (
                      <span className="text-text-muted"> · {it.target_type} {it.target_id}</span>
                    )}
                  </p>
                  {it.detail && (
                    <p className="text-2xs text-text-dim mt-0.5 break-all">{it.detail}</p>
                  )}
                </div>
                <span className="text-2xs text-text-dim shrink-0 whitespace-nowrap">
                  {it.created_at
                    ? new Date(it.created_at).toLocaleString("ko-KR", {
                        month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
        {data?.total > items.length && (
          <div className="px-4 py-2 border-t border-border text-2xs text-text-muted">
            최근 {items.length}건 표시 / 전체 {data.total}건
          </div>
        )}
      </div>
    </div>
  );
}

export default AdminLogTab;
