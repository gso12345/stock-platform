import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X, Heart, MessageSquare, Share2, Send } from "lucide-react";
import { communityApi } from "@/api/stocks";
import { useAuthStore } from "@/store/authStore";
import { useNavigate, Link } from "react-router-dom";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { fmtKRWCompact } from "@/utils/formatters";

const PIE_COLORS = ["#3b82f6","#10b981","#f59e0b","#8b5cf6","#ef4444","#06b6d4","#f97316","#84cc16","#ec4899","#14b8a6","#6366f1"];

// ── 공용 타입 ─────────────────────────────────────────────────────
export interface ModalPost {
  id: number;
  symbol: string;
  market: string;
  user_id: number;
  username: string;
  avatar_color: number;
  title: string;
  body: string;
  image: string;
  poll: {
    question: string;
    options: string[];
    counts: number[];
    total: number;
    my_vote: number | null;
  } | null;
  tags: { symbol: string; market: string }[];
  portfolio?: { symbol: string; market: string; name: string; shares: number; avg_price: number }[] | null;
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

export interface PostDetailModalProps {
  post: ModalPost;
  onClose: () => void;
  onLikeToggled?: (postId: number, liked: boolean, likeCount: number) => void;
  onVoteUpdated?: (postId: number, counts: number[], total: number, myVote: number) => void;
}

// ── 유틸 ──────────────────────────────────────────────────────────
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

function timeAgo(iso: string) {
  if (!iso) return "";
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

function Avatar({
  username, colorIndex, userId, isMine, onNavigate,
}: {
  username: string; colorIndex: number; userId?: number; isMine?: boolean; onNavigate?: () => void;
}) {
  const cls = AVATAR_COLORS[colorIndex % AVATAR_COLORS.length];
  const inner = (
    <div className={`w-9 h-9 rounded-full border-2 flex items-center justify-center font-bold text-sm shrink-0 ${cls}`}>
      {username[0]?.toUpperCase()}
    </div>
  );
  if (userId == null) return inner;
  return (
    <Link to={isMine ? "/mypage" : `/profile/${userId}`} onClick={onNavigate}>
      {inner}
    </Link>
  );
}

// ── 댓글 아이템 ───────────────────────────────────────────────────
function CommentItem({
  comment, postId, uid, isLoggedIn, onReplyAdded,
}: {
  comment: Comment; postId: number; uid?: number; isLoggedIn: boolean; onReplyAdded: () => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [liked, setLiked] = useState(comment.liked);
  const [likeCount, setLikeCount] = useState(comment.like_count);
  const [showReply, setShowReply] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleLike = async () => {
    if (!isLoggedIn) { navigate("/login"); return; }
    const prev = liked;
    setLiked((v) => !v);
    setLikeCount((n) => (liked ? n - 1 : n + 1));
    try {
      await communityApi.toggleCommentLike(comment.id);
    } catch {
      setLiked(prev);
      setLikeCount(comment.like_count);
    }
  };

  const handleDelete = async () => {
    if (!confirm("댓글을 삭제할까요?")) return;
    try {
      await communityApi.deleteComment(comment.id);
      qc.invalidateQueries({ queryKey: ["modal-comments", postId] });
    } catch {}
  };

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
      <Avatar username={comment.username} colorIndex={comment.avatar_color} userId={comment.user_id} isMine={uid != null && comment.user_id === uid} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <Link
            to={uid != null && comment.user_id === uid ? "/mypage" : `/profile/${comment.user_id}`}
            className="text-xs font-semibold text-text-primary hover:text-accent-blue transition-colors"
          >
            {comment.username}
          </Link>
          <span className="text-2xs text-text-dim">·</span>
          <span className="text-2xs text-text-dim">{timeAgo(comment.created_at)}</span>
        </div>
        <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap break-words mb-1.5">
          {comment.content}
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={handleLike}
            className={`flex items-center gap-1 text-xs transition-all active:scale-90 ${liked ? "text-accent-red" : "text-text-dim hover:text-accent-red"}`}
          >
            <Heart size={11} className={liked ? "fill-accent-red" : ""} />
            {likeCount > 0 ? <span className={liked ? "font-semibold" : ""}>{likeCount}</span> : <span className="opacity-50">좋아요</span>}
          </button>
          {isLoggedIn && (
            <button onClick={() => setShowReply((v) => !v)} className="text-xs text-text-dim hover:text-accent-blue transition-colors">
              답글
            </button>
          )}
          {comment.is_mine && (
            <button onClick={handleDelete} className="text-xs text-text-dim hover:text-accent-red transition-colors">
              삭제
            </button>
          )}
        </div>

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
              className="px-3 py-1.5 bg-accent-blue text-white text-xs rounded-xl disabled:opacity-40 hover:bg-accent-blue/90"
            >
              {submitting ? "..." : "등록"}
            </button>
          </div>
        )}

        {comment.replies.length > 0 && (
          <div className="mt-2 flex flex-col gap-3 pl-3 border-l-2 border-border/50">
            {comment.replies.map((r) => (
              <div key={r.id} className="flex gap-2">
                <Avatar username={r.username} colorIndex={r.avatar_color} userId={r.user_id} isMine={uid != null && r.user_id === uid} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <Link
                      to={uid != null && r.user_id === uid ? "/mypage" : `/profile/${r.user_id}`}
                      className="text-xs font-semibold text-text-primary hover:text-accent-blue transition-colors"
                    >
                      {r.username}
                    </Link>
                    <span className="text-2xs text-text-dim">·</span>
                    <span className="text-2xs text-text-dim">{timeAgo(r.created_at)}</span>
                  </div>
                  <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap break-words">
                    {r.content}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── 메인 모달 ─────────────────────────────────────────────────────
export default function PostDetailModal({
  post: initialPost, onClose, onLikeToggled, onVoteUpdated,
}: PostDetailModalProps) {
  const { isLoggedIn, userId } = useAuthStore();
  const navigate = useNavigate();

  const [post, setPost] = useState(initialPost);
  const [commentText, setCommentText] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [copied, setCopied] = useState(false);
  const commentInputRef = useRef<HTMLInputElement>(null);
  const uid = userId ?? undefined;

  // 배경 스크롤 잠금
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  // Escape 키로 닫기
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const { data: comments, refetch: refetchComments } = useQuery<Comment[]>({
    queryKey: ["modal-comments", post.id],
    queryFn: () => communityApi.getComments(post.id),
    staleTime: 30_000,
  });

  const handleLike = async () => {
    if (!isLoggedIn) { navigate("/login"); return; }
    const newLiked = !post.liked;
    const newCount = newLiked ? post.like_count + 1 : post.like_count - 1;
    setPost((p) => ({ ...p, liked: newLiked, like_count: newCount }));
    try {
      await communityApi.togglePostLike(post.id);
      onLikeToggled?.(post.id, newLiked, newCount);
    } catch {
      setPost((p) => ({ ...p, liked: !newLiked, like_count: post.like_count }));
    }
  };

  const handleVote = async (optionIndex: number) => {
    if (!isLoggedIn) { navigate("/login"); return; }
    try {
      const result = await communityApi.votePoll(post.id, optionIndex);
      setPost((p) =>
        p.poll ? { ...p, poll: { ...p.poll, counts: result.counts, total: result.total, my_vote: result.my_vote } } : p
      );
      onVoteUpdated?.(post.id, result.counts, result.total, result.my_vote);
    } catch {}
  };

  const handleShare = async () => {
    const url = `${window.location.origin}/stocks/${post.market}/${post.symbol}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const submitComment = async () => {
    const txt = commentText.trim();
    if (!txt || submittingComment) return;
    setSubmittingComment(true);
    try {
      await communityApi.createComment(post.id, txt);
      setCommentText("");
      refetchComments();
    } finally {
      setSubmittingComment(false);
    }
  };

  const commentCount = comments?.length ?? post.comment_count;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      {/* 백드롭 */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* 모달 패널 */}
      <div
        className="relative z-10 w-full sm:max-w-2xl max-h-[92vh] sm:max-h-[85vh] bg-bg-card border border-border rounded-t-3xl sm:rounded-3xl flex flex-col shadow-2xl animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <Avatar
              username={post.username}
              colorIndex={post.avatar_color}
              userId={post.user_id}
              isMine={post.is_mine}
              onNavigate={onClose}
            />
            <div>
              <Link
                to={post.is_mine ? "/mypage" : `/profile/${post.user_id}`}
                onClick={onClose}
                className="text-sm font-semibold text-text-primary hover:text-accent-blue transition-colors"
              >
                {post.username}
              </Link>
              <p className="text-2xs text-text-dim">{timeAgo(post.created_at)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-2xs font-bold px-2 py-0.5 rounded border ${
              post.market === "KR" ? "bg-blue-500/15 text-blue-400 border-blue-500/20" :
              post.market === "US" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20" :
              "bg-purple-500/15 text-purple-400 border-purple-500/20"
            }`}>{post.market}</span>
            <Link
              to={`/stocks/${post.market}/${post.symbol}`}
              onClick={onClose}
              className="text-2xs font-semibold text-accent-blue hover:underline"
            >
              {post.symbol}
            </Link>
            <button
              onClick={onClose}
              className="ml-2 p-2 rounded-xl text-text-dim hover:text-text-primary hover:bg-bg-elevated transition-all"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* 스크롤 가능 본문 */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4 flex flex-col gap-4 min-h-0">
          {/* 게시글 내용 */}
          <div>
            {post.title && (
              <p className="text-base font-bold text-text-primary mb-2">{post.title}</p>
            )}
            <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap break-words">
              {post.body}
            </p>
          </div>

          {post.portfolio && post.portfolio.length > 0 && (() => {
            const pieData = post.portfolio.map((item) => ({
              name: item.symbol,
              value: item.avg_price * item.shares,
            }));
            const total = pieData.reduce((s, d) => s + d.value, 0);
            return (
              <div className="p-4 bg-bg-elevated rounded-xl flex flex-col gap-3">
                <p className="text-xs font-semibold text-text-muted">포트폴리오 구성</p>
                <ResponsiveContainer width="100%" height={160}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={62}
                      innerRadius={26}
                      isAnimationActive
                      animationBegin={0}
                      animationDuration={600}
                      animationEasing="ease-out"
                    >
                      {pieData.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: "#1e2435", border: "1px solid #2d3655", borderRadius: 8, fontSize: 11, color: "#e2e8f0" }}
                      itemStyle={{ color: "#e2e8f0" }}
                      labelStyle={{ color: "#94a3b8", display: "none" }}
                      formatter={(v: any) => [fmtKRWCompact(Number(v)), ""]}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-col gap-1">
                  {pieData.map((entry, i) => {
                    const pct = total > 0 ? (entry.value / total) * 100 : 0;
                    return (
                      <div key={entry.name} className="flex items-center gap-2 py-0.5">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                        <span className="flex-1 text-xs text-text-secondary truncate">{entry.name}</span>
                        <span className="text-xs font-mono font-semibold text-text-primary w-10 text-right">{pct.toFixed(1)}%</span>
                        <span className="text-xs font-mono text-text-muted text-right w-18 hidden sm:block">{fmtKRWCompact(entry.value)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {post.image && (
            <img src={post.image} alt="첨부 이미지" className="w-full rounded-xl object-cover max-h-72" />
          )}

          {post.poll && (
            <div className="p-3 bg-bg-elevated rounded-xl space-y-2">
              <p className="text-xs font-semibold text-text-primary">{post.poll.question}</p>
              {post.poll.options.map((opt, i) => {
                const voted = post.poll!.my_vote !== null;
                const pct = post.poll!.total > 0 ? Math.round((post.poll!.counts[i] / post.poll!.total) * 100) : 0;
                const isChosen = post.poll!.my_vote === i;
                return (
                  <button
                    key={i}
                    onClick={() => !voted && handleVote(i)}
                    disabled={voted || !isLoggedIn}
                    className={`relative w-full text-left px-3 py-2 rounded-lg border text-xs overflow-hidden transition-all ${
                      isChosen ? "border-accent-blue/50" : "border-border hover:border-accent-blue/30"
                    }`}
                  >
                    {voted && (
                      <div
                        className={`absolute inset-0 rounded-lg transition-all ${isChosen ? "bg-accent-blue/25" : "bg-accent-blue/10"}`}
                        style={{ width: `${pct}%` }}
                      />
                    )}
                    <span className="relative z-10 flex justify-between">
                      <span className={isChosen ? "font-semibold text-accent-blue" : "text-text-secondary"}>{opt}</span>
                      {voted && <span className={isChosen ? "text-accent-blue font-semibold" : "text-text-dim"}>{pct}%</span>}
                    </span>
                  </button>
                );
              })}
              <p className="text-2xs text-text-dim text-right">총 {post.poll.total}표</p>
            </div>
          )}

          {post.tags && post.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {post.tags.map((t) => (
                <Link
                  key={t.symbol}
                  to={`/stocks/${t.market}/${t.symbol}`}
                  onClick={onClose}
                  className="text-2xs font-semibold px-1.5 py-0.5 rounded bg-accent-blue/10 text-accent-blue hover:bg-accent-blue/20 transition-colors"
                >
                  #{t.symbol}
                </Link>
              ))}
            </div>
          )}

          {/* 액션 바 */}
          <div className="flex items-center gap-4 py-2 border-t border-b border-border/50">
            <button
              onClick={handleLike}
              className={`flex items-center gap-1.5 text-sm transition-all active:scale-90 ${post.liked ? "text-accent-red" : "text-text-dim hover:text-accent-red"}`}
            >
              <Heart size={15} className={post.liked ? "fill-accent-red" : ""} />
              <span className={post.liked ? "font-semibold" : ""}>{post.like_count > 0 ? post.like_count : "좋아요"}</span>
            </button>

            <button
              onClick={() => commentInputRef.current?.focus()}
              className="flex items-center gap-1.5 text-sm text-text-dim hover:text-accent-blue transition-colors"
            >
              <MessageSquare size={15} />
              <span>{commentCount > 0 ? `댓글 ${commentCount}` : "댓글"}</span>
            </button>

            <button
              onClick={handleShare}
              className="flex items-center gap-1.5 text-sm text-text-dim hover:text-text-primary transition-colors ml-auto"
            >
              <Share2 size={15} />
              <span>{copied ? "복사됨!" : "공유"}</span>
            </button>
          </div>

          {/* 댓글 목록 */}
          <div className="flex flex-col gap-4 pb-2">
            {comments && comments.length > 0 ? (
              comments.map((c) => (
                <CommentItem
                  key={c.id}
                  comment={c}
                  postId={post.id}
                  uid={uid}
                  isLoggedIn={isLoggedIn}
                  onReplyAdded={refetchComments}
                />
              ))
            ) : (
              <p className="text-xs text-text-dim text-center py-6">첫 댓글을 남겨보세요</p>
            )}
          </div>
        </div>

        {/* 댓글 입력 */}
        <div className="shrink-0 px-5 py-3 border-t border-border">
          {isLoggedIn ? (
            <div className="flex gap-2">
              <input
                ref={commentInputRef}
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && submitComment()}
                placeholder="댓글을 입력하세요..."
                maxLength={500}
                className="flex-1 px-3 py-2 bg-bg-elevated border border-border rounded-xl text-sm text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-blue/50"
              />
              <button
                onClick={submitComment}
                disabled={!commentText.trim() || submittingComment}
                className="px-4 py-2 bg-accent-blue text-white text-sm rounded-xl disabled:opacity-40 hover:bg-accent-blue/90 transition-colors"
              >
                {submittingComment ? "..." : <Send size={14} />}
              </button>
            </div>
          ) : (
            <button
              onClick={() => { navigate("/login"); onClose(); }}
              className="w-full text-sm text-accent-blue hover:underline py-1"
            >
              로그인 후 댓글을 남겨보세요
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
