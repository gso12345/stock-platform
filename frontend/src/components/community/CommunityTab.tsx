import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Heart, Trash2, Send, LogIn } from "lucide-react";
import { communityApi } from "@/api/stocks";
import { useAuthStore } from "@/store/authStore";
import { useNavigate } from "react-router-dom";

interface Post {
  id: number;
  user_id: number;
  username: string;
  content: string;
  like_count: number;
  liked: boolean;
  created_at: string;
  is_mine: boolean;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "방금 전";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}일 전`;
  return new Date(iso).toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}

export default function CommunityTab({ market, symbol }: { market: string; symbol: string }) {
  const { isLoggedIn, username } = useAuthStore();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const key = ["community", market, symbol, page];

  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => communityApi.getPosts(market, symbol, page),
    staleTime: 30_000,
  });

  const posts: Post[] = data?.items ?? [];
  const total: number = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["community", market, symbol] });
  };

  const likeMutation = useMutation({
    mutationFn: (postId: number) => communityApi.toggleLike(postId),
    onMutate: async (postId) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<any>(key);
      if (prev) {
        qc.setQueryData(key, {
          ...prev,
          items: prev.items.map((p: Post) =>
            p.id === postId
              ? { ...p, liked: !p.liked, like_count: p.liked ? p.like_count - 1 : p.like_count + 1 }
              : p
          ),
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(key, ctx.prev); },
  });

  const deleteMutation = useMutation({
    mutationFn: (postId: number) => communityApi.deletePost(market, symbol, postId),
    onSuccess: invalidate,
  });

  const handleSubmit = async () => {
    const content = draft.trim();
    if (!content || submitting) return;
    setSubmitting(true);
    try {
      await communityApi.createPost(market, symbol, content);
      setDraft("");
      setPage(1);
      invalidate();
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSubmit();
  };

  return (
    <div className="flex flex-col gap-4">
      {/* 글쓰기 */}
      <div className="bg-bg-card border border-border rounded-xl p-4">
        {isLoggedIn ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-accent-blue/20 border border-accent-blue/30 flex items-center justify-center text-xs font-bold text-accent-blue">
                {username?.[0]?.toUpperCase() ?? "?"}
              </div>
              <span className="text-xs font-medium text-text-secondary">{username}</span>
            </div>
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`${symbol} 종목에 대한 의견을 남겨보세요 (Ctrl+Enter로 제출)`}
              maxLength={1000}
              rows={3}
              className="w-full px-3 py-2.5 rounded-lg bg-bg-elevated border border-border text-sm text-text-primary placeholder:text-text-dim resize-none focus:outline-none focus:border-accent-blue focus:ring-1 focus:ring-accent-blue/30 transition-all"
            />
            <div className="flex items-center justify-between">
              <span className="text-2xs text-text-dim">{draft.length}/1000</span>
              <button
                onClick={handleSubmit}
                disabled={!draft.trim() || submitting}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-blue text-white text-xs font-semibold hover:bg-accent-blue/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                <Send size={12} />
                {submitting ? "등록 중..." : "등록"}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => navigate("/login")}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-lg border border-dashed border-border text-sm text-text-muted hover:text-text-primary hover:border-accent-blue/50 transition-all"
          >
            <LogIn size={15} />
            로그인하고 의견 남기기
          </button>
        )}
      </div>

      {/* 게시글 목록 */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-text-dim text-sm">불러오는 중...</div>
      ) : posts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-2 text-text-dim">
          <p className="text-base">아직 의견이 없습니다</p>
          <p className="text-sm">첫 번째 의견을 남겨보세요!</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {posts.map((post) => (
            <div key={post.id} className="bg-bg-card border border-border rounded-xl p-4 flex flex-col gap-2.5">
              {/* 헤더 */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-bg-elevated border border-border flex items-center justify-center text-2xs font-bold text-text-secondary">
                    {post.username[0]?.toUpperCase()}
                  </div>
                  <span className="text-xs font-semibold text-text-primary">{post.username}</span>
                  <span className="text-2xs text-text-dim">{timeAgo(post.created_at)}</span>
                </div>
                {post.is_mine && (
                  <button
                    onClick={() => { if (confirm("게시글을 삭제할까요?")) deleteMutation.mutate(post.id); }}
                    className="p-1 rounded text-text-dim hover:text-accent-red transition-colors"
                    title="삭제"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>

              {/* 본문 */}
              <p className="text-sm text-text-primary leading-relaxed whitespace-pre-wrap break-words">{post.content}</p>

              {/* 좋아요 */}
              <div className="flex items-center gap-1 pt-0.5">
                <button
                  onClick={() => isLoggedIn ? likeMutation.mutate(post.id) : navigate("/login")}
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-all ${
                    post.liked
                      ? "text-accent-red bg-accent-red/10 border border-accent-red/20"
                      : "text-text-dim hover:text-accent-red hover:bg-accent-red/5 border border-transparent"
                  }`}
                >
                  <Heart size={12} className={post.liked ? "fill-accent-red" : ""} />
                  {post.like_count > 0 && <span>{post.like_count}</span>}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 py-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 rounded-lg text-xs text-text-muted border border-border hover:text-text-primary hover:border-accent-blue/50 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            이전
          </button>
          <span className="text-xs text-text-muted">{page} / {totalPages}</span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1.5 rounded-lg text-xs text-text-muted border border-border hover:text-text-primary hover:border-accent-blue/50 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            다음
          </button>
        </div>
      )}

      {total > 0 && (
        <p className="text-center text-2xs text-text-dim">총 {total.toLocaleString()}개 의견</p>
      )}
    </div>
  );
}
