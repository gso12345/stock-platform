import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Heart, Trash2, Send, LogIn, MessageSquare, AlertCircle,
  RefreshCw, ChevronDown, ChevronUp, Share2, ArrowUpDown,
  Image as ImageIcon, BarChart2, Hash, X as XIcon, Eye,
} from "lucide-react";
import { communityApi } from "@/api/stocks";
import { useAuthStore } from "@/store/authStore";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import api from "@/api/client";
import PortfolioSnapshot from "@/components/portfolio/PortfolioSnapshot";

// ── 타입 ──────────────────────────────────────────────────────────
interface PollData {
  question: string;
  options: string[];
  counts: number[];
  total: number;
  my_vote: number | null;
}

interface Post {
  id: number;
  user_id: number;
  username: string;
  avatar_color: number;
  title: string;
  body: string;
  image: string;
  poll: PollData | null;
  tags: { symbol: string; market: string }[];
  portfolio?: { symbol: string; market: string; name: string; shares: number; avg_price: number; currency?: string; input_exchange_rate?: number | null }[] | null;
  like_count: number;
  comment_count: number;
  view_count?: number;
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

interface StockTag {
  symbol: string;
  market: string;
  name?: string;
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

async function compressImage(file: File): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const maxSize = 800;
      let { width, height } = img;
      if (width > maxSize || height > maxSize) {
        const ratio = Math.min(maxSize / width, maxSize / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.7));
    };
    img.src = url;
  });
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
  userId,
  isMine,
}: {
  username: string;
  colorIndex: number;
  size?: "sm" | "md";
  userId?: number;
  isMine?: boolean;
}) {
  const cls = AVATAR_COLORS[colorIndex % AVATAR_COLORS.length];
  const sz = size === "md" ? "w-8 h-8 text-sm" : "w-6 h-6 text-xs";
  const avatar = (
    <div
      className={`${sz} rounded-full border flex items-center justify-center font-bold shrink-0 ${cls}`}
    >
      {username[0]?.toUpperCase()}
    </div>
  );
  if (userId == null) return avatar;
  return (
    <Link to={isMine ? "/mypage" : `/profile/${userId}`}>
      {avatar}
    </Link>
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
      <Avatar
        username={comment.username}
        colorIndex={comment.avatar_color}
        userId={comment.user_id}
        isMine={uid != null && comment.user_id === uid}
      />
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
                <Avatar
                  username={r.username}
                  colorIndex={r.avatar_color}
                  userId={r.user_id}
                  isMine={uid != null && r.user_id === uid}
                />
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
                  <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap break-words mb-1">
                    {r.content}
                  </p>
                  <ReplyLikeDelete reply={r} postId={postId} isLoggedIn={isLoggedIn} uid={uid} />
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
  uid,
}: {
  reply: Comment;
  postId: number;
  isLoggedIn: boolean;
  uid?: number;
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
  onVote,
  onOpen,
}: {
  post: Post;
  uid?: number;
  isLoggedIn: boolean;
  market: string;
  symbol: string;
  onDelete: (id: number) => void;
  onLike: (id: number) => void;
  onVote: (postId: number, optionIndex: number) => void;
  onOpen: (post: Post) => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [copied, setCopied] = useState(false);
  const [following, setFollowing] = useState(false);
  const [followPending, setFollowPending] = useState(false);

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

  const handleFollow = async () => {
    if (!isLoggedIn) { navigate("/login"); return; }
    if (followPending) return;
    setFollowPending(true);
    try {
      const result = await communityApi.toggleFollow(post.user_id);
      setFollowing(result.followed);
    } catch {
      /* ignore */
    } finally {
      setFollowPending(false);
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
    <div
      className="bg-bg-card border border-border rounded-2xl p-4 hover:border-accent-blue/30 transition-colors cursor-pointer"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button, a, input, textarea")) return;
        onOpen(post);
      }}
    >
      <div className="flex gap-3">
        <Avatar
          username={post.username}
          colorIndex={post.avatar_color}
          userId={post.user_id}
          isMine={post.is_mine}
        />
        <div className="flex-1 min-w-0">
          {/* 헤더 */}
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <Link
                to={post.is_mine ? "/mypage" : `/profile/${post.user_id}`}
                className="text-xs font-semibold text-text-primary hover:text-accent-blue transition-colors"
              >
                {post.username}
              </Link>
              <span className="text-2xs text-text-dim">·</span>
              <span className="text-2xs text-text-dim">{timeAgo(post.created_at)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              {!post.is_mine && (
                <button
                  onClick={handleFollow}
                  disabled={followPending}
                  className={`text-2xs px-2 py-0.5 rounded-lg border transition-all disabled:opacity-50 ${
                    following
                      ? "border-border text-text-dim"
                      : "bg-accent-blue/10 border-accent-blue/30 text-accent-blue hover:bg-accent-blue hover:text-white"
                  }`}
                >
                  {following ? "팔로잉" : "팔로우"}
                </button>
              )}
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
                  <><ChevronUp size={11} /> 접기</>
                ) : (
                  <><ChevronDown size={11} /> 더 보기</>
                )}
              </button>
            )}
          </div>

          {/* 첨부 이미지 */}
          {post.image && (
            <img
              src={post.image}
              alt="첨부 이미지"
              className="w-full max-h-64 object-cover rounded-xl mb-2"
            />
          )}

          {/* 투표 */}
          {post.poll && (
            <div className="mb-2 p-3 bg-bg-elevated rounded-xl space-y-2">
              <p className="text-xs font-semibold text-text-primary">{post.poll.question}</p>
              {post.poll.options.map((opt, i) => {
                const voted = post.poll!.my_vote !== null;
                const pct =
                  post.poll!.total > 0
                    ? Math.round((post.poll!.counts[i] / post.poll!.total) * 100)
                    : 0;
                const isChosen = post.poll!.my_vote === i;
                return (
                  <button
                    key={i}
                    onClick={() => !voted && onVote(post.id, i)}
                    disabled={voted}
                    className={`relative w-full text-left px-3 py-1.5 rounded-lg border text-xs overflow-hidden transition-all ${
                      isChosen
                        ? "border-accent-blue/50"
                        : "border-border hover:border-accent-blue/30"
                    }`}
                  >
                    {voted && (
                      <div
                        className={`absolute inset-0 rounded-lg transition-all ${
                          isChosen ? "bg-accent-blue/25" : "bg-accent-blue/10"
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    )}
                    <span className="relative z-10 flex justify-between">
                      <span className={isChosen ? "font-semibold text-accent-blue" : "text-text-secondary"}>
                        {opt}
                      </span>
                      {voted && (
                        <span className={isChosen ? "text-accent-blue font-semibold" : "text-text-dim"}>
                          {pct}%
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
              <p className="text-2xs text-text-dim text-right">총 {post.poll.total}표</p>
            </div>
          )}

          {/* 종목 태그 */}
          {post.tags && post.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {post.tags.map((t) => (
                <Link
                  key={t.symbol}
                  to={`/stocks/${t.market}/${t.symbol}`}
                  className="text-2xs font-semibold px-1.5 py-0.5 rounded bg-accent-blue/10 text-accent-blue hover:bg-accent-blue/20 transition-colors"
                >
                  #{t.symbol}
                </Link>
              ))}
            </div>
          )}

          {/* 포트폴리오 차트 */}
          {post.portfolio && post.portfolio.length > 0 && (
            <div className="mb-2" onClick={(e) => e.stopPropagation()}>
              <PortfolioSnapshot items={post.portfolio} />
            </div>
          )}

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
              onClick={() => onOpen(post)}
              className="flex items-center gap-1.5 text-xs text-text-dim hover:text-accent-blue transition-all"
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

            <span className="flex items-center gap-1 text-xs text-text-dim">
              <Eye size={11} />
              <span>{post.view_count ?? 0}</span>
            </span>
          </div>

          {/* 댓글 영역 */}
          {showComments && (
            <div className="mt-3 pt-3 border-t border-border/50 flex flex-col gap-3">
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
                <p className="text-xs text-text-dim text-center py-2">첫 댓글을 남겨보세요</p>
              )}

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
  const { isLoggedIn, username, userId } = useAuthStore();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<"latest" | "likes">("latest");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 사진/투표/태그 상태
  const [image, setImage] = useState("");
  const [showPoll, setShowPoll] = useState(false);
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptions, setPollOptions] = useState(["", ""]);
  const [showTagSearch, setShowTagSearch] = useState(false);
  const [tagQuery, setTagQuery] = useState("");
  const [tagResults, setTagResults] = useState<StockTag[]>([]);
  const [tags, setTags] = useState<StockTag[]>([{ symbol, market }]);
  const [tagSearchTimeout, setTagSearchTimeout] = useState<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setPage(1);
    setTags([{ symbol, market }]);
  }, [symbol, market]);

  useEffect(() => {
    const postId = searchParams.get("post");
    if (!postId) return;
    setSearchParams((prev) => { prev.delete("post"); return prev; }, { replace: true });
    navigate(`/post/${postId}`);
  }, [searchParams, setSearchParams, navigate]);

  const key = ["community", market, symbol, page, sort];

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: key,
    queryFn: () => communityApi.getPosts(market, symbol, page, sort),
    staleTime: 30_000,
    refetchInterval: 60_000,
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
              ? { ...p, liked: !p.liked, like_count: p.liked ? p.like_count - 1 : p.like_count + 1 }
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

  const voteMutation = useMutation({
    mutationFn: ({ postId, optionIndex }: { postId: number; optionIndex: number }) =>
      communityApi.votePoll(postId, optionIndex),
    onSuccess: (data, { postId }) => {
      qc.setQueryData(key, (prev: any) => {
        if (!prev) return prev;
        return {
          ...prev,
          items: prev.items.map((p: Post) =>
            p.id === postId && p.poll
              ? { ...p, poll: { ...p.poll, counts: data.counts, total: data.total, my_vote: data.my_vote } }
              : p
          ),
        };
      });
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

  const handleImagePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImage(file);
      setImage(compressed);
    } catch {
      /* ignore */
    }
    e.target.value = "";
  };

  const handleTagSearch = (q: string) => {
    setTagQuery(q);
    if (tagSearchTimeout) clearTimeout(tagSearchTimeout);
    if (!q.trim()) { setTagResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const res = await api.get("/search", { params: { q: q.trim(), limit: 10 } });
        setTagResults(res.data?.results ?? res.data ?? []);
      } catch {
        setTagResults([]);
      }
    }, 300);
    setTagSearchTimeout(t);
  };

  const addTag = (tag: StockTag) => {
    if (tags.length >= 5) return;
    if (!tags.find((t) => t.symbol === tag.symbol && t.market === tag.market)) {
      setTags((prev) => [...prev, { symbol: tag.symbol, market: tag.market }]);
    }
    setTagQuery("");
    setTagResults([]);
  };

  const removeTag = (symbol: string) => setTags((prev) => prev.filter((t) => t.symbol !== symbol));

  const resetForm = () => {
    setTitle("");
    setBody("");
    setImage("");
    setShowPoll(false);
    setPollQuestion("");
    setPollOptions(["", ""]);
    setShowTagSearch(false);
    setTagQuery("");
    setTags([{ symbol, market }]);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const handleSubmit = async () => {
    const b = body.trim();
    if (!b || submitting) return;
    setPostError(null);
    setSubmitting(true);

    const pollData = showPoll && pollQuestion.trim() && pollOptions.filter((o) => o.trim()).length >= 2
      ? { question: pollQuestion.trim(), options: pollOptions.filter((o) => o.trim()) }
      : null;

    const doPost = async () => {
      return communityApi.createPost(market, symbol, title.trim(), b, image, pollData, tags);
    };

    // Render 무료 플랜은 15분 비활성 후 슬립 → POST가 502/CORS 오류로 실패함.
    // 전략: GET ping으로 먼저 서버를 깨우고, 충분히 기다린 뒤 POST 재시도.
    const wakeAndPost = async (): Promise<void> => {
      try {
        await doPost();
        return;
      } catch (firstErr: any) {
        if (firstErr?.response) throw firstErr; // 실제 HTTP 오류(401/422/500)는 재시도 안 함
      }

      // 네트워크 오류 → 서버 슬립 가능성.
      // Authorization 헤더 없는 단순 GET → CORS preflight 없이 슬립 서버에 바로 전달됨.
      setPostError("서버를 깨우는 중...");
      {
        const apiRoot = import.meta.env.VITE_API_URL || "";
        fetch(`${apiRoot}/api/v1/dashboard/indices`).catch(() => {});
      }

      // Render가 깨어나는 데 보통 15~45초 소요. 3단계로 재시도.
      const waits = [20, 20, 20]; // 각 대기 초
      for (let i = 0; i < waits.length; i++) {
        const wait = waits[i];
        const elapsed = waits.slice(0, i).reduce((a, b) => a + b, 0) + wait;
        setPostError(`서버 연결 중... (${elapsed}초 후 재시도)`);
        await new Promise((r) => setTimeout(r, wait * 1000));
        setPostError(null);
        try {
          await doPost();
          return;
        } catch (retryErr: any) {
          if (retryErr?.response) throw retryErr;
          {
            const apiRoot = import.meta.env.VITE_API_URL || "";
            fetch(`${apiRoot}/api/v1/dashboard/indices`).catch(() => {});
          }
        }
      }
      throw new Error("network");
    };

    try {
      await wakeAndPost();
      resetForm();
      setPage(1);
      invalidate();
      setSuccessMsg(true);
      setTimeout(() => setSuccessMsg(false), 2500);
    } catch (e: any) {
      console.error("[community post error]", e?.response?.status, e?.response?.data, e?.message, e);
      const status = e?.response?.status;
      const detail = e?.response?.data?.detail;
      if (status === 401) {
        setPostError("로그인이 필요합니다. 다시 로그인해 주세요.");
      } else if (status === 422) {
        const txt = Array.isArray(detail) ? detail[0]?.msg : detail;
        setPostError(typeof txt === "string" ? txt : "내용을 입력해 주세요.");
      } else if (status === 429) {
        setPostError("잠시 후 다시 시도해 주세요. (요청 제한)");
      } else if (status && detail) {
        setPostError(typeof detail === "string" ? detail : `오류 ${status}: 잠시 후 다시 시도해 주세요.`);
      } else if (status) {
        setPostError(`서버 오류 (${status}). 잠시 후 다시 시도해 주세요.`);
      } else {
        setPostError(`서버에 연결할 수 없습니다. (${e?.message || "네트워크 오류"}) — 잠시 후 다시 시도해 주세요.`);
      }
    } finally {
      setSubmitting(false);
    }
  };

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
              <Avatar username={username ?? "?"} colorIndex={myColorIndex} size="md" userId={userId ?? undefined} isMine />
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
                  onFocus={() => {
                    // 사용자가 타이핑 시작 시 서버 미리 깨움 — 인증 헤더 없는 단순 GET으로 preflight 없이 바로 도달
                    const apiRoot = import.meta.env.VITE_API_URL || "";
                    fetch(`${apiRoot}/api/v1/dashboard/indices`).catch(() => {});
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSubmit();
                  }}
                  placeholder="이 종목에 대한 의견을 자유롭게 남겨보세요"
                  maxLength={5000}
                  rows={2}
                  className="w-full px-0 py-0 bg-transparent border-none text-sm text-text-primary placeholder:text-text-dim resize-none focus:outline-none leading-relaxed"
                  style={{ minHeight: "2.5rem" }}
                />

                {/* 사진 미리보기 */}
                {image && (
                  <div className="relative w-full">
                    <img src={image} alt="미리보기" className="w-full max-h-40 object-cover rounded-xl" />
                    <button
                      onClick={() => setImage("")}
                      className="absolute top-1 right-1 p-1 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
                    >
                      <XIcon size={12} />
                    </button>
                  </div>
                )}

                {/* 투표 UI */}
                {showPoll && (
                  <div className="bg-bg-elevated rounded-xl p-3 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-text-primary">투표 만들기</span>
                      <button onClick={() => setShowPoll(false)} className="text-text-dim hover:text-accent-red transition-colors">
                        <XIcon size={13} />
                      </button>
                    </div>
                    <input
                      value={pollQuestion}
                      onChange={(e) => setPollQuestion(e.target.value)}
                      placeholder="투표 질문을 입력하세요"
                      maxLength={100}
                      className="w-full px-2.5 py-1.5 bg-bg-card border border-border rounded-lg text-xs text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-blue/50"
                    />
                    {pollOptions.map((opt, i) => (
                      <div key={i} className="flex gap-1.5">
                        <input
                          value={opt}
                          onChange={(e) => {
                            const next = [...pollOptions];
                            next[i] = e.target.value;
                            setPollOptions(next);
                          }}
                          placeholder={`선택지 ${i + 1}`}
                          maxLength={50}
                          className="flex-1 px-2.5 py-1.5 bg-bg-card border border-border rounded-lg text-xs text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-blue/50"
                        />
                        {pollOptions.length > 2 && (
                          <button
                            onClick={() => setPollOptions((prev) => prev.filter((_, j) => j !== i))}
                            className="text-text-dim hover:text-accent-red transition-colors"
                          >
                            <XIcon size={12} />
                          </button>
                        )}
                      </div>
                    ))}
                    {pollOptions.length < 4 && (
                      <button
                        onClick={() => setPollOptions((prev) => [...prev, ""])}
                        className="text-xs text-accent-blue hover:underline text-left"
                      >
                        + 옵션 추가
                      </button>
                    )}
                  </div>
                )}

                {/* 태그 검색 UI */}
                {showTagSearch && (
                  <div className="bg-bg-elevated rounded-xl p-3 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-text-primary">종목 태그</span>
                      <button onClick={() => { setShowTagSearch(false); setTagQuery(""); setTagResults([]); }} className="text-text-dim hover:text-accent-red transition-colors">
                        <XIcon size={13} />
                      </button>
                    </div>
                    {tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {tags.map((t) => (
                          <span key={t.symbol} className="flex items-center gap-1 text-2xs px-1.5 py-0.5 rounded bg-accent-blue/15 text-accent-blue">
                            #{t.symbol}
                            <button onClick={() => removeTag(t.symbol)}>
                              <XIcon size={10} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    {tags.length < 5 && (
                      <div className="relative">
                        <input
                          value={tagQuery}
                          onChange={(e) => handleTagSearch(e.target.value)}
                          placeholder="종목명 또는 심볼 검색..."
                          className="w-full px-2.5 py-1.5 bg-bg-card border border-border rounded-lg text-xs text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-blue/50"
                        />
                        {tagResults.length > 0 && (
                          <div className="absolute z-10 w-full mt-1 bg-bg-card border border-border rounded-xl shadow-lg max-h-36 overflow-y-auto">
                            {tagResults.map((r: any, idx) => (
                              <button
                                key={idx}
                                onClick={() => addTag({ symbol: r.symbol, market: r.market })}
                                className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-bg-elevated transition-colors text-left"
                              >
                                <span className="font-semibold text-text-primary">{r.symbol}</span>
                                <span className="text-text-dim">{r.name || r.market}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

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

            {/* 툴바 + 제출 */}
            <div className="flex items-center justify-between pt-1 border-t border-border/50">
              <div className="flex items-center gap-1">
                {/* 사진 버튼 */}
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImagePick} />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  title="사진 첨부"
                  className={`p-1.5 rounded-lg transition-all ${image ? "text-accent-blue bg-accent-blue/10" : "text-text-dim hover:text-text-primary hover:bg-bg-elevated"}`}
                >
                  <ImageIcon size={14} />
                </button>
                {/* 투표 버튼 */}
                <button
                  onClick={() => setShowPoll((v) => !v)}
                  title="투표 만들기"
                  className={`p-1.5 rounded-lg transition-all ${showPoll ? "text-accent-blue bg-accent-blue/10" : "text-text-dim hover:text-text-primary hover:bg-bg-elevated"}`}
                >
                  <BarChart2 size={14} />
                </button>
                {/* 태그 버튼 */}
                <button
                  onClick={() => setShowTagSearch((v) => !v)}
                  title="종목 태그"
                  className={`p-1.5 rounded-lg transition-all ${(showTagSearch || tags.length > 0) ? "text-accent-blue bg-accent-blue/10" : "text-text-dim hover:text-text-primary hover:bg-bg-elevated"}`}
                >
                  <Hash size={14} />
                </button>
                <span className="text-2xs text-text-dim ml-1">{body.length}/5000</span>
              </div>
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
              uid={userId ?? undefined}
              isLoggedIn={isLoggedIn}
              market={market}
              symbol={symbol}
              onDelete={(id) => deleteMutation.mutate(id)}
              onLike={(id) => likeMutation.mutate(id)}
              onVote={(postId, optionIndex) => voteMutation.mutate({ postId, optionIndex })}
              onOpen={(p) => navigate(`/post/${p.id}`)}
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
