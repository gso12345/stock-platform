/** 신고 관리 탭.
 *
 * 원래 Admin.tsx 한 파일(1,963줄)에 있던 것을 탭 단위로 가른 조각이다.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { RefreshCw, MessageSquare, Flag, AlertCircle, ExternalLink } from "lucide-react";
import { Tabs, RowSkeleton, 못불러옴 } from "@/components/ui";
import { use확인, use알림 } from "@/hooks/useDialogs";
import { 사람말로 } from "@/api/queryError";

import { adminApi } from "@/components/admin/adminApi";
import Pagination from "@/components/ui/Pagination";

/* ─────────────────────────── 신고 관리 탭 ─────────────────────────── */
export function ReportsTab({ qc }: { qc: QueryClient }) {
  const [statusFilter, setStatusFilter] = useState<"pending" | "resolved" | "dismissed" | "all">("pending");
  const [page, setPage] = useState(1);
  const [actingId, setActingId] = useState<number | null>(null);
  const { 묻기, 화면: 확인화면 } = use확인();
  const { 보이기, 화면: 알림화면 } = use알림();

  const { data, isLoading, refetch, isError: 못받음, error: 실패사유 } = useQuery({
    queryKey: ["admin-reports", statusFilter, page],
    queryFn: () => adminApi.getReports(statusFilter, page),
    staleTime: 30_000,
  });

  /* .finally() 만 있어서 실패해도 성공처럼 보였다 — 목록을 새로고침하고
     끝나니, 아무것도 안 바뀐 채 "처리했다" 로 읽힌다 */
  const act = async (fn: (id: number) => Promise<any>, id: number) => {
    setActingId(id);
    try {
      await fn(id);
    } catch (e) {
      보이기(사람말로(e) || "처리하지 못했습니다", "error");
    } finally {
      setActingId(null);
      refetch();
      qc.invalidateQueries({ queryKey: ["admin-reports"] });
    }
  };

  /* 신고된 글을 지우는 것은 되돌릴 수 없다. 그런데 여기만 확인 없이
     클릭 한 번에 실행됐다 — 커뮤니티 탭의 같은 동작에는 확인창이 있다.
     옆 버튼(블라인드·기각)과 나란히 있어서 잘못 누르기도 쉽다. */
  const 지우기 = (r: any) => 묻기({
    title: "신고된 글을 삭제할까요?",
    message: "글이 목록에서 사라집니다. 가리기만 하려면 블라인드를 쓰세요 — 블라인드는 되돌릴 수 있고, "
      + "잘못 지웠어도 '처리됨' 에서 '처리 취소' 로 되살릴 수 있어요.",
    대상: (r.post_title || r.post_preview || r.comment_preview || "(내용 없음)").slice(0, 40),
    확인글: "삭제",
    onConfirm: () => act(adminApi.deleteReportContent, r.id),
  });

  /* 처리 취소 — 무엇이 되돌려지는지 먼저 말한다. 블라인드·삭제는 글이
     다시 보이게 되는 일이라 확인 없이 누르면 안 된다 */
  const 되돌림설명: Record<string, string> = {
    blind: "블라인드를 풀어 글이 다시 보이게 됩니다.",
    delete: "삭제한 글을 되살려 다시 보이게 됩니다.",
    dismiss: "기각을 거두고 다시 검토할 수 있게 됩니다.",
  };
  const 취소하기 = (r: any) => 묻기({
    title: "처리를 취소할까요?",
    message: `${되돌림설명[r.action] ?? "무엇을 처리했는지 기록이 없어 글은 그대로 두고"} 신고는 '대기' 로 돌아갑니다.`
      + (r.action === "blind" || r.action === "delete"
        ? " 같은 글이 다른 신고로도 처리돼 있으면 글은 그대로 둡니다." : ""),
    대상: (r.post_title || r.post_body || r.comment_preview || "(내용 없음)").slice(0, 40),
    확인글: "처리 취소",
    onConfirm: () => act(async (id) => {
      const 결과 = await adminApi.reopenReport(id);
      if (결과?.kept?.length) 보이기(`신고는 대기로 돌렸고, ${결과.kept.join(", ")} 는 그대로 뒀어요`, "info");
    }, r.id),
  });

  const reports: any[] = data?.items ?? [];
  const total: number  = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  const STATUS_LABELS: Record<string, string> = { pending: "대기", resolved: "처리됨", dismissed: "기각됨", all: "전체" };
  const STATUS_BADGE: Record<string, string> = {
    pending:   "bg-accent-yellow/15 text-accent-yellow border-accent-yellow/30",
    resolved:  "bg-accent-green/12 text-accent-green border-accent-green/30",
    dismissed: "bg-bg-elevated text-text-muted border-border",
  };

  return (
    <div className="flex flex-col gap-4">
      {/* 필터 바 */}
      <div className="flex items-center gap-2 flex-wrap">
        <Tabs
          ariaLabel="신고 상태 필터" tone="subtle" fill={false}
          tabs={(["pending", "resolved", "dismissed", "all"] as const)
            .map((s) => ({ id: s, label: STATUS_LABELS[s] }))}
          active={statusFilter}
          onChange={(id) => { setStatusFilter(id as any); setPage(1); }}
        />
        <span className="text-xs text-text-muted ml-auto">총 {total}건</span>
        <button aria-label="새로고침" onClick={() => refetch()} className="p-1.5 rounded-lg text-text-muted hover:text-accent-blue hover:bg-bg-elevated transition-colors">
          <RefreshCw size={13} />
        </button>
      </div>

      {/* 목록 */}
      {isLoading ? (
        <RowSkeleton rows={4} />
      ) : 못받음 ? (
        <못불러옴 사유={실패사유} 다시={() => refetch()} />
      ) : reports.length === 0 ? (
        <div className="rounded-xl border border-border bg-bg-card py-14 text-center">
          <Flag size={24} className="text-text-muted/30 mx-auto mb-2" />
          <p className="text-sm text-text-muted">신고 내역이 없습니다</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {reports.map((r: any) => {
            const isPending = r.status === "pending";
            const isActing  = actingId === r.id;
            return (
              <div key={r.id}
                className={`rounded-xl border bg-bg-card overflow-hidden transition-opacity ${
                  isPending ? "border-border" : "border-border/50 opacity-70"
                }`}>

                {/* 헤더 */}
                <div className="flex items-center gap-2 px-4 py-2.5 bg-bg-elevated/60 border-b border-border/50">
                  <span className={`text-xs font-bold px-2 py-px rounded-full border ${STATUS_BADGE[r.status] ?? STATUS_BADGE.dismissed}`}>
                    {STATUS_LABELS[r.status] ?? r.status}
                  </span>
                  <span className="text-xs text-text-muted font-mono">#{r.id}</span>
                  <span className="text-xs text-text-muted">·</span>
                  <Flag size={11} className="text-text-muted" />
                  <span className="text-xs font-semibold text-text-secondary">{r.reporter}</span>
                  <span className="text-xs text-text-muted">신고</span>
                  <span className="text-xs text-text-muted ml-auto font-mono">{r.created_at?.slice(0, 10)}</span>
                </div>

                {/* 신고 사유 */}
                <div className="px-4 pt-3 pb-2 flex items-start gap-2">
                  <AlertCircle size={13} className={`shrink-0 mt-0.5 ${isPending ? "text-accent-yellow" : "text-text-muted"}`} />
                  <p className="text-sm font-medium text-text-primary leading-snug">{r.reason}</p>
                </div>

                {/* 신고 대상 콘텐츠 */}
                <div className="px-4 pb-3 flex flex-col gap-2">
                  {r.post_id && (
                    <div className="rounded-lg bg-bg-elevated border border-border/50 p-3 flex flex-col gap-1.5">
                      <div className="flex items-center gap-2">
                        <MessageSquare size={11} className="text-text-muted shrink-0" />
                        <span className="text-xs text-text-muted">게시글 #{r.post_id}</span>
                        {r.post_author && (
                          <span className="text-xs font-semibold text-text-secondary">· @{r.post_author}</span>
                        )}
                        <Link to={`/post/${r.post_id}`} target="_blank"
                          className="ml-auto flex items-center gap-0.5 text-xs text-accent-blue hover:underline shrink-0">
                          <ExternalLink size={11} />보기
                        </Link>
                      </div>
                      {r.post_title && (
                        <p className="text-xs font-semibold text-text-primary truncate">{r.post_title}</p>
                      )}
                      {r.post_body && (
                        <p className="text-xs text-text-secondary leading-relaxed line-clamp-2">{r.post_body}</p>
                      )}
                    </div>
                  )}
                  {r.comment_id && (
                    <div className="rounded-lg bg-bg-elevated border border-border/50 p-3 flex flex-col gap-1.5">
                      <div className="flex items-center gap-2">
                        <MessageSquare size={11} className="text-text-muted shrink-0" />
                        <span className="text-xs text-text-muted">댓글 #{r.comment_id}</span>
                        {r.comment_author && (
                          <span className="text-xs font-semibold text-text-secondary">· @{r.comment_author}</span>
                        )}
                        {r.post_id && (
                          <Link to={`/post/${r.post_id}`} target="_blank"
                            className="ml-auto flex items-center gap-0.5 text-xs text-accent-blue hover:underline shrink-0">
                            <ExternalLink size={11} />게시글
                          </Link>
                        )}
                      </div>
                      <p className="text-xs text-text-secondary leading-relaxed line-clamp-2">{r.comment_preview || "—"}</p>
                    </div>
                  )}
                </div>

                {/* 액션 버튼 */}
                {isPending ? (
                  <div className="flex border-t border-border/50 divide-x divide-border/50">
                    <button onClick={() => act(adminApi.blindReport, r.id)} disabled={isActing}
                      className="flex-1 py-3 text-xs font-semibold text-accent-yellow hover:bg-accent-yellow/8 active:bg-accent-yellow/15 transition-colors disabled:opacity-40">
                      {isActing ? "처리 중..." : "블라인드"}
                    </button>
                    <button onClick={() => 지우기(r)} disabled={isActing}
                      className="flex-1 py-3 text-xs font-semibold text-accent-red hover:bg-accent-red/8 active:bg-accent-red/15 transition-colors disabled:opacity-40">
                      {isActing ? "처리 중..." : "콘텐츠 삭제"}
                    </button>
                    <button onClick={() => act(adminApi.dismissReport, r.id)} disabled={isActing}
                      className="flex-1 py-3 text-xs font-semibold text-text-muted hover:text-text-primary hover:bg-bg-elevated active:bg-bg-hover transition-colors disabled:opacity-40">
                      {isActing ? "처리 중..." : "기각"}
                    </button>
                  </div>
                ) : (
                  /* 처리한 것은 무엇이든 취소할 수 있다 — 블라인드·삭제·기각 모두 */
                  <div className="flex items-center border-t border-border/50">
                    {r.action && (
                      <span className="px-4 text-2xs text-text-dim shrink-0">
                        {{ blind: "블라인드함", delete: "삭제함", dismiss: "기각함" }[r.action as string] ?? ""}
                      </span>
                    )}
                    <button onClick={() => 취소하기(r)} disabled={isActing}
                      className="flex-1 py-3 text-xs font-semibold text-accent-blue hover:bg-accent-blue/8 active:bg-accent-blue/15 transition-colors disabled:opacity-40">
                      {isActing ? "처리 중..." : "처리 취소"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 페이지네이션 */}
      <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      {확인화면}
      {알림화면}
    </div>
  );
}

export default ReportsTab;
