/** 커뮤니티 관리 탭 — 글과 댓글.
 *
 * 원래 Admin.tsx 한 파일(1,963줄)에 있던 것을 탭 단위로 가른 조각이다.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, type QueryClient } from "@tanstack/react-query";
import { Trash2, RefreshCw, Eye, Heart } from "lucide-react";
import { Tabs, RowSkeleton, 못불러옴 } from "@/components/ui";
import PostLikesModal from "@/components/admin/PostLikesModal";

import { adminApi, MARKET_COLOR_MAP } from "@/components/admin/adminApi";

/* ─────────────────────────── 커뮤니티 관리 탭 ─────────────────────────── */

export function CommunityAdminTab({ qc }: { qc: QueryClient }) {
  const [subTab, setSubTab] = useState<"posts" | "comments">("posts");
  return (
    <div className="flex flex-col gap-4">
      <Tabs
        ariaLabel="커뮤니티 관리 대상" fill={false} className="w-fit"
        tabs={[{ id: "posts", label: "게시글" }, { id: "comments", label: "댓글" }]}
        active={subTab}
        onChange={(id) => setSubTab(id as any)}
      />
      {subTab === "posts"    && <PostsAdminSection qc={qc} />}
      {subTab === "comments" && <CommentsAdminSection qc={qc} />}
    </div>
  );
}

export function PostsAdminSection({ qc }: { qc: QueryClient }) {
  const [좋아요볼글, set좋아요볼글] = useState<{ id: number; title?: string } | null>(null);
  const [page, setPage] = useState(1);
  const [marketFilter, setMarketFilter] = useState("ALL");
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [actingId, setActingId] = useState<number | null>(null);

  const { data, isLoading, refetch, isError: 못받음, error: 실패사유 } = useQuery({
    queryKey: ["admin-community-posts", page, marketFilter],
    queryFn: () => adminApi.getCommunityPosts(page, marketFilter),
    staleTime: 30_000,
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => adminApi.deleteCommunityPost(id),
    onSuccess: () => {
      setConfirmDelete(null);
      qc.invalidateQueries({ queryKey: ["admin-community-posts"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
      refetch();
    },
  });

  const actPost = (fn: (id: number) => Promise<any>, id: number) => {
    setActingId(id);
    fn(id).finally(() => { setActingId(null); refetch(); });
  };

  const posts: any[] = data?.items ?? [];
  const total: number = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  return (
    <div className="flex flex-col gap-4">
      {/* 필터 헤더 */}
      <div className="flex items-center gap-3 flex-wrap">
        <Tabs
          ariaLabel="시장 필터" fill={false}
          tabs={[
            { id: "ALL", label: "전체" }, { id: "KR", label: "KR" },
            { id: "US",  label: "US"   }, { id: "ETF", label: "ETF" },
          ]}
          active={marketFilter}
          onChange={(id) => { setMarketFilter(id as any); setPage(1); }}
        />
        <span className="text-xs text-text-dim ml-auto">총 {total.toLocaleString()}개</span>
        <button aria-label="새로고침" onClick={() => refetch()} className="p-1 text-text-muted hover:text-text-primary transition-colors">
          <RefreshCw size={13} />
        </button>
      </div>

      {/* 테이블 */}
      <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
        {isLoading ? (
          <div className="p-3"><RowSkeleton rows={6} /></div>
        ) : 못받음 ? (
          <못불러옴 사유={실패사유} 다시={() => refetch()} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-text-muted text-xs">
                  <th className="text-left px-4 py-3 font-medium">ID</th>
                  <th className="text-left px-3 py-3 font-medium">작성자</th>
                  <th className="text-left px-3 py-3 font-medium hidden md:table-cell">종목</th>
                  <th className="text-left px-3 py-3 font-medium">내용</th>
                  <th className="text-center px-3 py-3 font-medium hidden sm:table-cell">좋아요</th>
                  <th className="text-center px-3 py-3 font-medium hidden lg:table-cell">작성일</th>
                  <th className="text-center px-3 py-3 font-medium">관리</th>
                </tr>
              </thead>
              <tbody>
                {posts.map((p) => (
                  <tr key={p.id} className={`border-b border-border/30 hover:bg-bg-hover transition-colors ${p.is_blinded ? "opacity-50" : ""}`}>
                    <td className="px-4 py-3 font-mono text-text-muted text-xs">{p.id}</td>
                    <td className="px-3 py-3">
                      <Link
                        to={`/profile/${p.user_id}`}
                        className="text-xs font-semibold text-text-primary hover:text-accent-blue transition-colors"
                      >
                        {p.username}
                      </Link>
                    </td>
                    <td className="px-3 py-3 hidden md:table-cell">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-2xs font-bold px-1.5 py-px rounded ${MARKET_COLOR_MAP[p.market] ?? "bg-bg-secondary text-text-muted"}`}>
                          {p.market}
                        </span>
                        <span className="text-xs font-mono text-text-muted">{p.symbol}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 max-w-[200px] lg:max-w-xs">
                      <div className="flex items-center gap-1.5">
                        {p.is_blinded && (
                          <span className="text-2xs bg-accent-yellow/15 text-accent-yellow px-1.5 py-px rounded font-bold shrink-0">블라인드</span>
                        )}
                        <Link
                          to={`/post/${p.id}`}
                          className="text-xs text-text-secondary hover:text-accent-blue transition-colors truncate block"
                          title={p.title || p.body || ""}
                        >
                          {p.title || p.body || "—"}
                        </Link>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-center hidden sm:table-cell">
                      {/* 개수만 보여 주면 '누가' 를 알 수 없다. 좋아요가 갑자기
                          몰릴 때 관리자가 보고 싶은 것은 이름 쪽이다 */}
                      <button
                        disabled={!p.like_count}
                        aria-label={`좋아요 누른 사람 ${p.like_count}명 보기`}
                        onClick={(e) => { e.stopPropagation(); set좋아요볼글({ id: p.id, title: p.title }); }}
                        className={`flex items-center justify-center gap-1 mx-auto px-1.5 py-1 rounded transition-colors ${
                          p.like_count
                            ? "text-text-muted hover:text-accent-red hover:bg-accent-red/10"
                            : "text-text-dim cursor-default"}`}
                      >
                        <Heart size={11} />
                        <span className="text-xs font-mono">{p.like_count}</span>
                      </button>
                    </td>
                    <td className="px-3 py-3 text-center hidden lg:table-cell">
                      <span className="text-xs text-text-muted font-mono">{p.created_at.slice(0, 10)}</span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => actPost(p.is_blinded ? adminApi.unblindPost : adminApi.blindPost, p.id)}
                          disabled={actingId === p.id}
                          title={p.is_blinded ? "블라인드 복구" : "블라인드"}
                          className={`p-1 rounded transition-colors ${p.is_blinded ? "text-accent-blue hover:bg-accent-blue/10" : "text-accent-yellow hover:bg-accent-yellow/10"} disabled:opacity-40`}
                        >
                          <Eye size={13} />
                        </button>
                        <button aria-label="삭제"
                          onClick={() => setConfirmDelete(p.id)}
                          className="p-1 rounded text-text-muted hover:text-accent-red transition-colors"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {posts.length === 0 && (
              <div className="py-12 text-center text-text-muted text-sm">게시글이 없습니다</div>
            )}
          </div>
        )}
      </div>

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
            className="px-3 py-1.5 rounded-xl text-xs text-text-muted border border-border hover:border-accent-blue/50 hover:text-accent-blue disabled:opacity-30 transition-all">이전</button>
          <span className="text-xs text-text-muted px-2">{page} / {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            className="px-3 py-1.5 rounded-xl text-xs text-text-muted border border-border hover:border-accent-blue/50 hover:text-accent-blue disabled:opacity-30 transition-all">다음</button>
        </div>
      )}

      {/* 삭제 확인 팝업 */}
      {confirmDelete !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => { if (!deleteMut.isPending) setConfirmDelete(null); }}>
          <div className="bg-bg-card border border-border rounded-2xl shadow-modal p-6 w-80 flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-col gap-1">
              <p className="text-sm font-bold text-text-primary">글을 삭제하시겠습니까?</p>
              <p className="text-xs text-text-dim">삭제된 게시글은 복구할 수 없습니다.</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDelete(null)} disabled={deleteMut.isPending}
                className="flex-1 py-2 rounded-xl border border-border text-sm text-text-secondary hover:border-accent-blue/50 transition-all disabled:opacity-50">취소</button>
              <button onClick={() => deleteMut.mutate(confirmDelete)} disabled={deleteMut.isPending}
                className="flex-1 py-2 rounded-xl bg-accent-red text-white text-sm font-semibold hover:bg-accent-red/90 transition-all disabled:opacity-50">
                {deleteMut.isPending ? "삭제 중..." : "삭제"}
              </button>
            </div>
          </div>
        </div>
      )}

      {좋아요볼글 && (
        <PostLikesModal postId={좋아요볼글.id} title={좋아요볼글.title}
                        onClose={() => set좋아요볼글(null)} />
      )}
    </div>
  );
}

export function CommentsAdminSection({ qc }: { qc: QueryClient }) {
  const [page, setPage] = useState(1);
  const [actingId, setActingId] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const { data, isLoading, refetch, isError: 못받음, error: 실패사유 } = useQuery({
    queryKey: ["admin-community-comments", page],
    queryFn: () => adminApi.getCommunityComments(page),
    staleTime: 30_000,
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => adminApi.deleteCommunityComment(id),
    onSuccess: () => {
      setConfirmDelete(null);
      qc.invalidateQueries({ queryKey: ["admin-community-comments"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
      refetch();
    },
  });

  const actComment = (fn: (id: number) => Promise<any>, id: number) => {
    setActingId(id);
    fn(id).finally(() => { setActingId(null); refetch(); });
  };

  const comments: any[] = data?.items ?? [];
  const total: number   = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="text-xs text-text-muted ml-auto">총 {total.toLocaleString()}개</span>
        <button aria-label="새로고침" onClick={() => refetch()} className="p-1 text-text-muted hover:text-text-primary transition-colors">
          <RefreshCw size={13} />
        </button>
      </div>

      <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
        {isLoading ? (
          <div className="p-3"><RowSkeleton rows={6} /></div>
        ) : 못받음 ? (
          <못불러옴 사유={실패사유} 다시={() => refetch()} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-text-muted text-xs">
                  <th className="text-left px-4 py-3 font-medium">ID</th>
                  <th className="text-left px-3 py-3 font-medium">작성자</th>
                  <th className="text-left px-3 py-3 font-medium hidden md:table-cell">게시글</th>
                  <th className="text-left px-3 py-3 font-medium">내용</th>
                  <th className="text-center px-3 py-3 font-medium hidden lg:table-cell">작성일</th>
                  <th className="text-center px-3 py-3 font-medium">관리</th>
                </tr>
              </thead>
              <tbody>
                {comments.map((c) => (
                  <tr key={c.id} className={`border-b border-border/30 hover:bg-bg-hover transition-colors ${c.is_blinded ? "opacity-50" : ""}`}>
                    <td className="px-4 py-3 font-mono text-text-muted text-xs">{c.id}</td>
                    <td className="px-3 py-3">
                      <Link to={`/profile/${c.user_id}`}
                        className="text-xs font-semibold text-text-primary hover:text-accent-blue transition-colors">
                        {c.username}
                      </Link>
                    </td>
                    <td className="px-3 py-3 hidden md:table-cell">
                      <Link to={`/post/${c.post_id}`}
                        className="text-xs font-mono text-accent-blue hover:underline">
                        #{c.post_id}
                      </Link>
                    </td>
                    <td className="px-3 py-3 max-w-[200px] lg:max-w-xs">
                      <div className="flex items-center gap-1.5">
                        {c.is_blinded && (
                          <span className="text-2xs bg-accent-yellow/15 text-accent-yellow px-1.5 py-px rounded font-bold shrink-0">블라인드</span>
                        )}
                        {c.parent_id && (
                          <span className="text-2xs bg-bg-elevated text-text-muted px-1.5 py-px rounded shrink-0">답글</span>
                        )}
                        <span className="text-xs text-text-secondary truncate">{c.content || "—"}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-center hidden lg:table-cell">
                      <span className="text-xs text-text-muted font-mono">{c.created_at?.slice(0, 10)}</span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => actComment(c.is_blinded ? adminApi.unblindComment : adminApi.blindComment, c.id)}
                          disabled={actingId === c.id}
                          title={c.is_blinded ? "블라인드 복구" : "블라인드"}
                          className={`p-1 rounded transition-colors ${c.is_blinded ? "text-accent-blue hover:bg-accent-blue/10" : "text-accent-yellow hover:bg-accent-yellow/10"} disabled:opacity-40`}
                        >
                          <Eye size={13} />
                        </button>
                        <button aria-label="삭제"
                          onClick={() => setConfirmDelete(c.id)}
                          className="p-1 rounded text-text-muted hover:text-accent-red transition-colors"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {comments.length === 0 && (
              <div className="py-12 text-center text-text-muted text-sm">댓글이 없습니다</div>
            )}
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            className="px-3 py-1.5 rounded-xl text-xs text-text-muted border border-border hover:border-accent-blue/50 hover:text-accent-blue disabled:opacity-30 transition-all">이전</button>
          <span className="text-xs text-text-muted px-2">{page} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            className="px-3 py-1.5 rounded-xl text-xs text-text-muted border border-border hover:border-accent-blue/50 hover:text-accent-blue disabled:opacity-30 transition-all">다음</button>
        </div>
      )}

      {confirmDelete !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => { if (!deleteMut.isPending) setConfirmDelete(null); }}>
          <div className="bg-bg-card border border-border rounded-2xl shadow-modal p-6 w-80 flex flex-col gap-4"
            onClick={e => e.stopPropagation()}>
            <div className="flex flex-col gap-1">
              <p className="text-sm font-bold text-text-primary">댓글을 삭제하시겠습니까?</p>
              <p className="text-xs text-text-dim">삭제된 댓글은 복구할 수 없습니다.</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDelete(null)} disabled={deleteMut.isPending}
                className="flex-1 py-2 rounded-xl border border-border text-sm text-text-secondary hover:border-accent-blue/50 transition-all disabled:opacity-50">취소</button>
              <button onClick={() => deleteMut.mutate(confirmDelete)} disabled={deleteMut.isPending}
                className="flex-1 py-2 rounded-xl bg-accent-red text-white text-sm font-semibold hover:bg-accent-red/90 transition-all disabled:opacity-50">
                {deleteMut.isPending ? "삭제 중..." : "삭제"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default CommunityAdminTab;
