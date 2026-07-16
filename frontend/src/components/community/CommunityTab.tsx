import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Heart, Trash2, Send, LogIn, MessageSquare, AlertCircle, RefreshCw } from "lucide-react";
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

// 유저명 기반 아바타 색상
const AVATAR_COLORS = [
  "bg-blue-500/20 text-blue-400 border-blue-500/30",
  "bg-purple-500/20 text-purple-400 border-purple-500/30",
  "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  "bg-amber-500/20 text-amber-400 border-amber-500/30",
  "bg-rose-500/20 text-rose-400 border-rose-500/30",
  "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
];
function avatarColor(username: string) {
  let h = 0;
  for (let i = 0; i < username.length; i++) h = (h * 31 + username.charCodeAt(i)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[h];
}

function Avatar({ username, size = "sm" }: { username: string; size?: "sm" | "md" }) {
  const cls = avatarColor(username);
  const sz = size === "md" ? "w-8 h-8 text-sm" : "w-6 h-6 text-xs";
  return (
    <div className={`${sz} rounded-full border flex items-center justify-center font-bold shrink-0 ${cls}`}>
      {username[0]?.toUpperCase()}
    </div>
  );
}

export default function CommunityTab({ market, symbol }: { market: string; symbol: string }) {
  const { isLoggedIn, username } = useAuthStore();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 심볼 변경 시 초기화
  useEffect(() => { setPage(1); }, [symbol]);

  const key = ["community", market, symbol, page];

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: key,
    queryFn: () => communityApi.getPosts(market, symbol, page),
    staleTime: 30_000,
  });

  const posts: Post[] = data?.items ?? [];
  const total: number = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["community", market, symbol] });

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

  // textarea 자동 높이
  const autoResize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  };

  const handleSubmit = async () => {
    const content = draft.trim();
    if (!content || submitting) return;
    setPostError(null);
    setSubmitting(true);
    try {
      await communityApi.createPost(market, symbol, content);
      setDraft("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      setPage(1);
      invalidate();
      setSuccessMsg(true);
      setTimeout(() => setSuccessMsg(false), 2500);
    } catch (e: any) {
      const msg = e?.response?.data?.detail;
      if (e?.response?.status === 401) {
        setPostError("로그인이 필요합니다. 다시 로그인해 주세요.");
      } else if (e?.response?.status === 422) {
        setPostError("내용을 입력해 주세요.");
      } else if (msg) {
        setPostError(msg);
      } else {
        setPostError("등록에 실패했습니다. 잠시 후 다시 시도해 주세요.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSubmit();
  };

  return (
    <div className="flex flex-col gap-3">

      {/* 헤더 */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <MessageSquare size={15} className="text-text-muted" />
          <span className="text-sm font-semibold text-text-primary">종목 토론</span>
          {total > 0 && (
            <span className="text-xs text-text-dim bg-bg-elevated px-1.5 py-0.5 rounded-full border border-border">
              {total.toLocaleString()}
            </span>
          )}
        </div>
        <button onClick={() => refetch()} className="p-1 text-text-dim hover:text-text-primary transition-colors" title="새로고침">
          <RefreshCw size={13} />
        </button>
      </div>

      {/* 글쓰기 영역 */}
      <div className="bg-bg-card border border-border rounded-2xl overflow-hidden">
        {isLoggedIn ? (
          <div className="p-4 flex flex-col gap-3">
            <div className="flex gap-3">
              <Avatar username={username ?? "?"} size="md" />
              <div className="flex-1 flex flex-col gap-2">
                <textarea
                  ref={textareaRef}
                  value={draft}
                  onChange={(e) => { setDraft(e.target.value); autoResize(); setPostError(null); }}
                  onKeyDown={handleKeyDown}
                  placeholder="이 종목에 대한 의견을 자유롭게 남겨보세요"
                  maxLength={1000}
                  rows={2}
                  className="w-full px-0 py-0 bg-transparent border-none text-sm text-text-primary placeholder:text-text-dim resize-none focus:outline-none leading-relaxed"
                  style={{ minHeight: "2.5rem" }}
                />
                {postError && (
                  <div className="flex items-center gap-1.5 text-xs text-accent-red">
                    <AlertCircle size={12} />
                    {postError}
                  </div>
                )}
                {successMsg && (
                  <p className="text-xs text-accent-green">의견이 등록됐습니다!</p>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between pt-1 border-t border-border/50">
              <span className="text-2xs text-text-dim">{draft.length}/1000 · Ctrl+Enter로 제출</span>
              <button
                onClick={handleSubmit}
                disabled={!draft.trim() || submitting}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-accent-blue text-white text-xs font-semibold hover:bg-accent-blue/90 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                <Send size={12} />
                {submitting ? "등록 중..." : "의견 남기기"}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => navigate("/login")}
            className="w-full flex items-center justify-center gap-2.5 py-5 text-sm text-text-muted hover:text-accent-blue hover:bg-accent-blue/5 transition-all"
          >
            <LogIn size={15} />
            로그인하고 의견 남기기
          </button>
        )}
      </div>

      {/* 에러 상태 */}
      {isError && (
        <div className="flex flex-col items-center justify-center py-10 gap-3 text-text-dim">
          <AlertCircle size={32} className="opacity-30" />
          <p className="text-sm">의견을 불러올 수 없습니다</p>
          <button onClick={() => refetch()} className="text-xs text-accent-blue hover:underline">다시 시도</button>
        </div>
      )}

      {/* 로딩 */}
      {isLoading && !isError && (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-bg-card border border-border rounded-2xl p-4 animate-pulse">
              <div className="flex gap-3 mb-3">
                <div className="w-6 h-6 rounded-full bg-bg-elevated" />
                <div className="flex-1 flex flex-col gap-2">
                  <div className="h-2.5 bg-bg-elevated rounded w-24" />
                  <div className="h-2 bg-bg-elevated rounded w-full" />
                  <div className="h-2 bg-bg-elevated rounded w-3/4" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 게시글 목록 */}
      {!isLoading && !isError && posts.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <div className="w-14 h-14 rounded-2xl bg-bg-elevated flex items-center justify-center">
            <MessageSquare size={24} className="text-text-dim opacity-50" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-text-secondary">아직 의견이 없어요</p>
            <p className="text-xs text-text-dim mt-0.5">첫 번째 의견을 남겨보세요!</p>
          </div>
        </div>
      )}

      {!isLoading && !isError && posts.length > 0 && (
        <div className="flex flex-col gap-2">
          {posts.map((post) => (
            <div key={post.id} className="bg-bg-card border border-border rounded-2xl p-4 hover:border-border/80 transition-colors">
              <div className="flex gap-3">
                <Avatar username={post.username} />
                <div className="flex-1 min-w-0">
                  {/* 상단: 이름 · 시간 · 삭제 */}
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-text-primary">{post.username}</span>
                      <span className="text-2xs text-text-dim">·</span>
                      <span className="text-2xs text-text-dim">{timeAgo(post.created_at)}</span>
                    </div>
                    {post.is_mine && (
                      <button
                        onClick={() => { if (confirm("게시글을 삭제할까요?")) deleteMutation.mutate(post.id); }}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded-lg text-text-dim hover:text-accent-red hover:bg-accent-red/10 transition-all"
                        title="삭제"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>

                  {/* 본문 */}
                  <p className="text-sm text-text-primary leading-relaxed whitespace-pre-wrap break-words mb-3">{post.content}</p>

                  {/* 하단: 좋아요 */}
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => isLoggedIn ? likeMutation.mutate(post.id) : navigate("/login")}
                      className={`flex items-center gap-1.5 text-xs transition-all active:scale-90 ${
                        post.liked ? "text-accent-red" : "text-text-dim hover:text-accent-red"
                      }`}
                    >
                      <Heart size={13} className={post.liked ? "fill-accent-red" : ""} />
                      {post.like_count > 0 ? (
                        <span className={post.liked ? "font-semibold" : ""}>{post.like_count}</span>
                      ) : (
                        <span className="opacity-60">좋아요</span>
                      )}
                    </button>
                    {post.is_mine && (
                      <button
                        onClick={() => { if (confirm("게시글을 삭제할까요?")) deleteMutation.mutate(post.id); }}
                        className="text-xs text-text-dim hover:text-accent-red transition-colors"
                      >
                        삭제
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 py-1">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 rounded-xl text-xs text-text-muted border border-border hover:border-accent-blue/50 hover:text-accent-blue disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >이전</button>
          <div className="flex items-center gap-1">
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              const p = page <= 3 ? i + 1 : page >= totalPages - 2 ? totalPages - 4 + i : page - 2 + i;
              if (p < 1 || p > totalPages) return null;
              return (
                <button key={p} onClick={() => setPage(p)}
                  className={`w-7 h-7 rounded-lg text-xs transition-all ${p === page ? "bg-accent-blue text-white font-semibold" : "text-text-dim hover:text-text-primary border border-border"}`}
                >{p}</button>
              );
            })}
          </div>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1.5 rounded-xl text-xs text-text-muted border border-border hover:border-accent-blue/50 hover:text-accent-blue disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >다음</button>
        </div>
      )}
    </div>
  );
}
