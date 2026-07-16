import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Heart, Trash2, Send, LogIn, MessageSquare, AlertCircle,
  RefreshCw, ChevronDown, ChevronUp, Share2, ArrowUpDown,
} from "lucide-react";
import { communityApi } from "@/api/stocks";
import { useAuthStore } from "@/store/authStore";
import { useNavigate } from "react-router-dom";

// ── 타입 ──────────────────────────────────────────────────────────
interface Post {
  id: number;
  user_id: number;
  username: string;
  avatar_color: number;
  title: string;
  body: string;
  like_count: number;
  comment_count: number;
  liked: boolean;
  created_at: string;
  is_mine: boolean;
}

interface Comment {
  id: number;
  parent_id: number | null;
  user_id: number;
  username: string;
  avatar_color: number;
  content: string;
  like_count: number;
  liked: boolean;
  created_at: string;
  is_mine: boolean;
  replies: Comment[];
}

// ── 유틸 ──────────────────────────────────────────────────────────
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

// ── 아바타 ────────────────────────────────────────────────────────
const AVATAR_COLORS = [
  "bg-blue-500/20 text-blue-400 border-blue-500/30",
  "bg-purple-500/20 text-purple-400 border-purple-500/30",
  "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  "bg-amber-500/20 text-amber-400 border-amber-500/30",
  "bg-rose-500/20 text-rose-400 border-rose-500/30",
  "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
  "bg-orange-500/20 text-orange-400 border-orange-500/30",
];

function Avatar({
  username,
  colorIndex,
  size = "sm",
}: {
  username: string;
  colorIndex: number;
  size?: "sm" | "md";
}) {
  const cls = AVATAR_COLORS[colorIndex % AVATAR_COLORS.length];
  const sz = size === "md" ? "w-8 h-8 text-sm" : "w-6 h-6 text-xs";
  return (
    <div
      className={`${sz} rounded-full border flex items-center justify-center font-bold shrink-0 ${cls}`}
    >
      {username[0]?.toUpperCase()}
    </div>
  );
}

// ── 댓글 컴포넌트 ─────────────────────────────────────────────────
function CommentItem({
  comment,
  postId,
  uid,
  isLoggedIn,
  onReplyAdded,
}: {
  comment: Comment;
  postId: number;
  uid?: number;
  isLoggedIn: boolean;
  onReplyAdded: () => void;
}) {
  const navigate = useNavigate();
  const [showReply, setShowReply] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [liked, setLiked] = useState(comment.liked);
  const [likeCount, setLikeCount] = useState(comment.like_count);
  const qc = useQueryClient();

  const likeMutation = useMutation({
    mutationFn: () => communityApi.toggleCommentLike(comment.id),
    onMutate: () => {
      setLiked((v) => !v);
      setLikeCount((n) => (liked ? n - 1 : n + 1));
    },
    onError: () => {
      setLiked(comment.liked);
      setLikeCount(comment.like_count);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => communityApi.deleteComment(comment.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["comments", postId] }),
  });

  const submitReply = async () => {
    const txt = replyText.trim();
    if (!txt || submitting) return;
    setSubmitting(true);
    try {
      await communityApi.createComment(postId, txt, comment.id);
      setReplyText("");
      setShowReply(false);
      onReplyAdded();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex gap-2.5">
      <Avatar username={comment.username} colorIndex={comment.avatar_color} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="text-xs font-semibold text-text-primary">{comment.username}</span>
          <span className="text-2xs text-text-dim">·</span>
          <span className="text-2xs text-text-dim">{timeAgo(comment.created_at)}</span>
        </div>
        <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap break-words mb-1.5">
          {comment.content}
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={() => (isLoggedIn ? likeMutation.mutate() : navigate("/login"))}
            className={`flex items-center gap-1 text-xs transition-all active:scale-90 ${
              liked ? "text-accent-red" : "text-text-dim hover:text-accent-red"
            }`}
          >
            <Heart size={11} className={liked ? "fill-accent-red" : ""} />
            {likeCount > 0 ? (
              <span className={liked ? "font-semibold" : ""}>{likeCount}</span>
            ) : (
              <span className="opacity-50">좋아요</span>
            )}
          </button>
          {isLoggedIn && (
            <button
              onClick={() => setShowReply((v) => !v)}
              className="text-xs text-text-dim hover:text-accent-blue transition-colors"
            >
              답글
            </button>
          )}
          {comment.is_mine && (
            <button
              onClick={() => {
                if (confirm("댓글을 삭제할까요?")) deleteMutation.mutate();
              }}
              className="text-xs text-text-dim hover:text-accent-red transition-colors"
            >
              삭제
            </button>
          )}
        </div>

        {/* 답글 입력 */}
        {showReply && (
          <div className="mt-2 flex gap-2">
            <input
              autoFocus
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && submitReply()}
              placeholder="답글 입력..."
              maxLength={500}
              className="flex-1 px-3 py-1.5 bg-bg-elevated border border-border rounded-xl text-xs text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-blue/50"
            />
            <button
              onClick={submitReply}
              disabled={!replyText.trim() || submitting}
              className="px-3 py-1.5 bg-accent-blue text-white text-xs rounded-xl disabled:opacity-40 hover:bg-accent-blue/90 transition-colors"
            >
              {submitting ? "..." : "등록"}
            </button>
          </div>
        )}

        {/* 대댓글 */}
        {comment.replies.length > 0 && (
          <div className="mt-2 flex flex-col gap-2 pl-3 border-l-2 border-border/50">
            {comment.replies.map((r) => (
              <div key={r.id} className="flex gap-2">
                <Avatar username={r.username} colorIndex={r.avatar_color} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-xs font-semibold text-text-primary">{r.username}</span>
                    <span className="text-2xs text-text-dim">·</span>
                    <span className="text-2xs text-text-dim">{timeAgo(r.created_at)}</span>
                  </div>
                  <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap break-words mb-1">
                    {r.content}
                  </p>
                  <ReplyLikeDelete reply={r} postId={postId} isLoggedIn={isLoggedIn} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ReplyLikeDelete({
  reply,
  postId,
  isLoggedIn,
}: {
  reply: Comment;
  postId: number;
  isLoggedIn: boolean;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [liked, setLiked] = useState(reply.liked);
  const [likeCount, setLikeCount] = useState(reply.like_count);

  const likeMutation = useMutation({
    mutationFn: () => communityApi.toggleCommentLike(reply.id),
    onMutate: () => {
      setLiked((v) => !v);
      setLikeCount((n) => (liked ? n - 1 : n + 1));
    },
    onError: () => {
      setLiked(reply.liked);
      setLikeCount(reply.like_count);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => communityApi.deleteComment(reply.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["comments", postId] }),
  });

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() => (isLoggedIn ? likeMutation.mutate() : navigate("/login"))}
        className={`flex items-center gap-1 text-xs transition-all active:scale-90 ${
          liked ? "text-accent-red" : "text-text-dim hover:text-accent-red"
        }`}
      >
        <Heart size={10} className={liked ? "fill-accent-red" : ""} />
        {likeCount > 0 ? (
          <span className={liked ? "font-semibold" : ""}>{likeCount}</span>
        ) : (
          <span className="opacity-50">좋아요</span>
        )}
      </button>
      {reply.is_mine && (
        <button
          onClick={() => {
            if (confirm("댓글을 삭제할까요?")) deleteMutation.mutate();
          }}
          className="text-xs text-text-dim hover:text-accent-red transition-colors"
        >
          삭제
        </button>
      )}
    </div>
  );
}

// ── 게시글 카드 ───────────────────────────────────────────────────
function PostCard({
  post,
  uid,
  isLoggedIn,
  market,
  symbol,
  onDelete,
  onLike,
}: {
  post: Post;
  uid?: number;
  isLoggedIn: boolean;
  market: string;
  symbol: string;
  onDelete: (id: number) => void;
  onLike: (id: number) => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [copied, setCopied] = useState(false);

  const commentsKey = ["comments", post.id];
  const { data: comments, refetch: refetchComments } = useQuery<Comment[]>({
    queryKey: commentsKey,
    queryFn: () => communityApi.getComments(post.id),
    enabled: showComments,
    staleTime: 30_000,
  });

  const handleShare = async () => {
    const url = `${window.location.origin}/stocks/${market}/${symbol}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const submitComment = async () => {
    const txt = commentText.trim();
    if (!txt || submittingComment) return;
    setSubmittingComment(true);
    try {
      await communityApi.createComment(post.id, txt);
      setCommentText("");
      refetchComments();
      qc.invalidateQueries({ queryKey: ["community", market, symbol] });
    } finally {
      setSubmittingComment(false);
    }
  };

  const bodyLines = post.body.split("\n");
  const isLong = bodyLines.length > 4 || post.body.length > 200;
  const truncated = isLong && !expanded;

  return (
    <div className="bg-bg-card border border-border rounded-2xl p-4 hover:border-border/80 transition-colors">
      <div className="flex gap-3">
        <Avatar username={post.username} colorIndex={post.avatar_color} />
        <div className="flex-1 min-w-0">
          {/* 헤더 */}
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-text-primary">{post.username}</span>
              <span className="text-2xs text-text-dim">·</span>
              <span className="text-2xs text-text-dim">{timeAgo(post.created_at)}</span>
            </div>
            {post.is_mine && (
              <button
                onClick={() => {
                  if (confirm("게시글을 삭제할까요?")) onDelete(post.id);
                }}
                className="p-1 rounded-lg text-text-dim hover:text-accent-red hover:bg-accent-red/10 transition-all"
                title="삭제"
              >
                <Trash2 size={11} />
              </button>
            )}
          </div>

          {/* 제목 */}
          {post.title && (
            <p className="text-sm font-semibold text-text-primary mb-1">{post.title}</p>
          )}

          {/* 본문 */}
          <div className="mb-2">
            <p
              className={`text-sm text-text-secondary leading-relaxed whitespace-pre-wrap break-words ${
                truncated ? "line-clamp-4" : ""
              }`}
            >
              {post.body}
            </p>
            {isLong && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="mt-0.5 flex items-center gap-0.5 text-xs text-accent-blue hover:underline"
              >
                {expanded ? (
                  <>
                    <ChevronUp size={11} /> 접기
                  </>
                ) : (
                  <>
                    <ChevronDown size={11} /> 더 보기
                  </>
                )}
              </button>
            )}
          </div>

          {/* 액션 버튼 */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => (isLoggedIn ? onLike(post.id) : navigate("/login"))}
              className={`flex items-center gap-1.5 text-xs transition-all active:scale-90 ${
                post.liked ? "text-accent-red" : "text-text-dim hover:text-accent-red"
              }`}
            >
              <Heart size={12} className={post.liked ? "fill-accent-red" : ""} />
              {post.like_count > 0 ? (
                <span className={post.liked ? "font-semibold" : ""}>{post.like_count}</span>
              ) : (
                <span className="opacity-60">좋아요</span>
              )}
            </button>

            <button
              onClick={() => {
                setShowComments((v) => !v);
              }}
              className={`flex items-center gap-1.5 text-xs transition-all ${
                showComments ? "text-accent-blue" : "text-text-dim hover:text-accent-blue"
              }`}
            >
              <MessageSquare size={12} />
              {post.comment_count > 0 ? (
                <span>{post.comment_count}</span>
              ) : (
                <span className="opacity-60">댓글</span>
              )}
            </button>

            <button
              onClick={handleShare}
              className="flex items-center gap-1.5 text-xs text-text-dim hover:text-text-primary transition-colors"
            >
              <Share2 size={12} />
              <span className="opacity-60">{copied ? "복사됨!" : "공유"}</span>
            </button>
          </div>

          {/* 댓글 영역 */}
          {showComments && (
            <div className="mt-3 pt-3 border-t border-border/50 flex flex-col gap-3">
              {/* 댓글 목록 */}
              {comments && comments.length > 0 ? (
                comments.map((c) => (
                  <CommentItem
                    key={c.id}
                    comment={c}
                    postId={post.id}
                    uid={uid}
                    isLoggedIn={isLoggedIn}
                    onReplyAdded={() => {
                      refetchComments();
                      qc.invalidateQueries({ queryKey: ["community", market, symbol] });
                    }}
                  />
                ))
              ) : (
                <p className="text-xs text-text-dim text-center py-2">
                  첫 댓글을 남겨보세요
                </p>
              )}

              {/* 댓글 입력 */}
              {isLoggedIn ? (
                <div className="flex gap-2 mt-1">
                  <input
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && submitComment()}
                    placeholder="댓글을 입력하세요..."
                    maxLength={500}
                    className="flex-1 px-3 py-1.5 bg-bg-elevated border border-border rounded-xl text-xs text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-blue/50"
                  />
                  <button
                    onClick={submitComment}
                    disabled={!commentText.trim() || submittingComment}
                    className="px-3 py-1.5 bg-accent-blue text-white text-xs rounded-xl disabled:opacity-40 hover:bg-accent-blue/90 transition-colors"
                  >
                    {submittingComment ? "..." : <Send size={12} />}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => navigate("/login")}
                  className="text-xs text-accent-blue hover:underline text-center"
                >
                  로그인 후 댓글을 남겨보세요
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────
export default function CommunityTab({ market, symbol }: { market: string; symbol: string }) {
  const { isLoggedIn, username } = useAuthStore();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<"latest" | "likes">("latest");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setPage(1);
  }, [symbol]);

  const key = ["community", market, symbol, page, sort];

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: key,
    queryFn: () => communityApi.getPosts(market, symbol, page, sort),
    staleTime: 30_000,
  });

  const posts: Post[] = data?.items ?? [];
  const total: number = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["community", market, symbol] });

  const likeMutation = useMutation({
    mutationFn: (postId: number) => communityApi.togglePostLike(postId),
    onMutate: async (postId) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<any>(key);
      if (prev) {
        qc.setQueryData(key, {
          ...prev,
          items: prev.items.map((p: Post) =>
            p.id === postId
              ? {
                  ...p,
                  liked: !p.liked,
                  like_count: p.liked ? p.like_count - 1 : p.like_count + 1,
                }
              : p
          ),
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (postId: number) => communityApi.deletePost(market, symbol, postId),
    onSuccess: invalidate,
  });

  const autoResize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  const handleSubmit = async () => {
    const b = body.trim();
    if (!b || submitting) return;
    setPostError(null);
    setSubmitting(true);
    try {
      await communityApi.createPost(market, symbol, title.trim(), b);
      setTitle("");
      setBody("");
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
        setPostError(typeof msg === "string" ? msg : "오류가 발생했습니다.");
      } else {
        setPostError("등록에 실패했습니다. 잠시 후 다시 시도해 주세요.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  // derive avatar_color from username via hash (fallback before profile loads)
  const myColorIndex = (() => {
    const u = username ?? "";
    let h = 0;
    for (let i = 0; i < u.length; i++) h = (h * 31 + u.charCodeAt(i)) % AVATAR_COLORS.length;
    return h;
  })();

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
        <div className="flex items-center gap-1">
          {/* 정렬 */}
          <button
            onClick={() => setSort((s) => (s === "latest" ? "likes" : "latest"))}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs text-text-dim border border-border hover:border-accent-blue/40 hover:text-accent-blue transition-all"
          >
            <ArrowUpDown size={10} />
            {sort === "latest" ? "최신순" : "좋아요순"}
          </button>
          <button
            onClick={() => refetch()}
            className="p-1.5 text-text-dim hover:text-text-primary transition-colors"
            title="새로고침"
          >
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      {/* 글쓰기 */}
      <div className="bg-bg-card border border-border rounded-2xl overflow-hidden">
        {isLoggedIn ? (
          <div className="p-4 flex flex-col gap-2.5">
            <div className="flex gap-3">
              <Avatar username={username ?? "?"} colorIndex={myColorIndex} size="md" />
              <div className="flex-1 flex flex-col gap-2">
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="제목 (선택)"
                  maxLength={100}
                  className="w-full px-0 py-0 bg-transparent border-none text-sm font-semibold text-text-primary placeholder:text-text-dim focus:outline-none"
                />
                <div className="h-px bg-border/50" />
                <textarea
                  ref={textareaRef}
                  value={body}
                  onChange={(e) => {
                    setBody(e.target.value);
                    autoResize();
                    setPostError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSubmit();
                  }}
                  placeholder="이 종목에 대한 의견을 자유롭게 남겨보세요"
                  maxLength={2000}
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
              <span className="text-2xs text-text-dim">{body.length}/2000 · Ctrl+Enter로 제출</span>
              <button
                onClick={handleSubmit}
                disabled={!body.trim() || submitting}
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

      {/* 에러 */}
      {isError && (
        <div className="flex flex-col items-center justify-center py-10 gap-3 text-text-dim">
          <AlertCircle size={32} className="opacity-30" />
          <p className="text-sm">의견을 불러올 수 없습니다</p>
          <button onClick={() => refetch()} className="text-xs text-accent-blue hover:underline">
            다시 시도
          </button>
        </div>
      )}

      {/* 로딩 스켈레톤 */}
      {isLoading && !isError && (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-bg-card border border-border rounded-2xl p-4 animate-pulse">
              <div className="flex gap-3">
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

      {/* 빈 상태 */}
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

      {/* 게시글 목록 */}
      {!isLoading && !isError && posts.length > 0 && (
        <div className="flex flex-col gap-2">
          {posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              uid={undefined}
              isLoggedIn={isLoggedIn}
              market={market}
              symbol={symbol}
              onDelete={(id) => deleteMutation.mutate(id)}
              onLike={(id) => likeMutation.mutate(id)}
            />
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
          >
            이전
          </button>
          <div className="flex items-center gap-1">
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              const p =
                page <= 3
                  ? i + 1
                  : page >= totalPages - 2
                  ? totalPages - 4 + i
                  : page - 2 + i;
              if (p < 1 || p > totalPages) return null;
              return (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`w-7 h-7 rounded-lg text-xs transition-all ${
                    p === page
                      ? "bg-accent-blue text-white font-semibold"
                      : "text-text-dim hover:text-text-primary border border-border"
                  }`}
                >
                  {p}
                </button>
              );
            })}
          </div>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1.5 rounded-xl text-xs text-text-muted border border-border hover:border-accent-blue/50 hover:text-accent-blue disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            다음
          </button>
        </div>
      )}
    </div>
  );
}
