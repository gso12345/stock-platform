import { useState, useRef, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Heart, MessageSquare, Share2, Send, Trash2, Eye,
} from "lucide-react";
import { communityApi } from "@/api/stocks";
import { useAuthStore } from "@/store/authStore";
import PortfolioSnapshot from "@/components/portfolio/PortfolioSnapshot";

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

const MARKET_BADGE: Record<string, string> = {
  KR:  "border-blue-500/40 text-blue-400 bg-blue-500/10",
  US:  "border-emerald-500/40 text-emerald-400 bg-emerald-500/10",
  ETF: "border-purple-500/40 text-purple-400 bg-purple-500/10",
};

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

function Avatar({ username, colorIndex, userId, isMine, size = "md" }: {
  username: string; colorIndex: number; userId?: number; isMine?: boolean; size?: "sm" | "md" | "lg";
}) {
  const cls = AVATAR_COLORS[colorIndex % AVATAR_COLORS.length];
  const sz = size === "lg" ? "w-10 h-10 text-sm border-2" : size === "sm" ? "w-6 h-6 text-xs border" : "w-8 h-8 text-xs border-2";
  const inner = (
    <div className={`rounded-full flex items-center justify-center font-bold shrink-0 ${sz} ${cls}`}>
      {username[0]?.toUpperCase()}
    </div>
  );
  if (userId == null) return inner;
  return <Link to={isMine ? "/mypage" : `/profile/${userId}`}>{inner}</Link>;
}

interface Comment {
  id: number; parent_id: number | null; user_id: number; username: string;
  avatar_color: number; content: string; like_count: number; liked: boolean;
  created_at: string; is_mine: boolean; replies: Comment[];
}

function ReplyItem({ reply, postId, uid, isLoggedIn, queryKey }: {
  reply: Comment; postId: number; uid?: number; isLoggedIn: boolean; queryKey: any[];
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [liked, setLiked] = useState(reply.liked);
  const [likeCount, setLikeCount] = useState(reply.like_count);

  const handleLike = async () => {
    if (!isLoggedIn) { navigate("/login"); return; }
    const prev = liked;
    setLiked(v => !v);
    setLikeCount(n => prev ? n - 1 : n + 1);
    try { await communityApi.toggleCommentLike(reply.id); }
    catch { setLiked(prev); setLikeCount(reply.like_count); }
  };

  const handleDelete = async () => {
    if (!confirm("대댓글을 삭제할까요?")) return;
    try {
      await communityApi.deleteComment(reply.id);
      qc.invalidateQueries({ queryKey });
    } catch {}
  };

  return (
    <div className="flex gap-2">
      <Avatar username={reply.username} colorIndex={reply.avatar_color} userId={reply.user_id}
        isMine={uid != null && reply.user_id === uid} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
          <Link to={uid != null && reply.user_id === uid ? "/mypage" : `/profile/${reply.user_id}`}
            className="text-xs font-semibold text-text-primary hover:text-accent-blue transition-colors">
            {reply.username}
          </Link>
          <span className="text-2xs text-text-dim">·</span>
          <span className="text-2xs text-text-dim">{timeAgo(reply.created_at)}</span>
        </div>
        <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap break-words">{reply.content}</p>
        <div className="flex items-center gap-3 mt-1.5">
          <button onClick={handleLike}
            className={`flex items-center gap-1 text-xs transition-all active:scale-90 ${liked ? "text-accent-red" : "text-text-dim hover:text-accent-red"}`}>
            <Heart size={10} className={liked ? "fill-accent-red" : ""} />
            {likeCount > 0 ? <span className={liked ? "font-semibold" : ""}>{likeCount}</span> : <span className="opacity-50">좋아요</span>}
          </button>
          {reply.is_mine && (
            <button onClick={handleDelete} className="text-xs text-text-dim hover:text-accent-red transition-colors">삭제</button>
          )}
        </div>
      </div>
    </div>
  );
}

function CommentItem({ comment, postId, uid, isLoggedIn, queryKey, myUsername }: {
  comment: Comment; postId: number; uid?: number; isLoggedIn: boolean; queryKey: any[]; myUsername?: string | null;
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
    setLiked(v => !v);
    setLikeCount(n => prev ? n - 1 : n + 1);
    try { await communityApi.toggleCommentLike(comment.id); }
    catch { setLiked(prev); setLikeCount(comment.like_count); }
  };

  const handleDelete = async () => {
    if (!confirm("댓글을 삭제할까요?")) return;
    try {
      await communityApi.deleteComment(comment.id);
      qc.invalidateQueries({ queryKey });
    } catch {}
  };

  const submitReply = async () => {
    const txt = replyText.trim();
    if (!txt || submitting) return;
    setSubmitting(true);
    setReplyText("");
    setShowReply(false);
    const tempId = -Date.now();
    qc.setQueryData<Comment[]>(queryKey, (prev) =>
      (prev ?? []).map(c => c.id === comment.id
        ? { ...c, replies: [...c.replies, {
            id: tempId, post_id: postId, parent_id: comment.id,
            user_id: uid ?? 0, username: myUsername ?? "나", avatar_color: 0,
            content: txt, like_count: 0, liked: false, is_mine: true,
            created_at: new Date().toISOString(), replies: [],
          }] }
        : c
      )
    );
    try {
      await communityApi.createComment(postId, txt, comment.id);
      qc.invalidateQueries({ queryKey });
    } catch {
      qc.setQueryData<Comment[]>(queryKey, (prev) =>
        (prev ?? []).map(c => c.id === comment.id
          ? { ...c, replies: c.replies.filter(r => r.id !== tempId) }
          : c
        )
      );
      setReplyText(txt);
      setShowReply(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex gap-3">
      <Avatar username={comment.username} colorIndex={comment.avatar_color} userId={comment.user_id}
        isMine={uid != null && comment.user_id === uid} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
          <Link to={uid != null && comment.user_id === uid ? "/mypage" : `/profile/${comment.user_id}`}
            className="text-sm font-semibold text-text-primary hover:text-accent-blue transition-colors">
            {comment.username}
          </Link>
          <span className="text-2xs text-text-dim">·</span>
          <span className="text-2xs text-text-dim">{timeAgo(comment.created_at)}</span>
        </div>
        <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap break-words mb-2">{comment.content}</p>
        <div className="flex items-center gap-4">
          <button onClick={handleLike}
            className={`flex items-center gap-1 text-xs transition-all active:scale-90 ${liked ? "text-accent-red" : "text-text-dim hover:text-accent-red"}`}>
            <Heart size={11} className={liked ? "fill-accent-red" : ""} />
            {likeCount > 0 ? <span className={liked ? "font-semibold" : ""}>{likeCount}</span> : <span className="opacity-50">좋아요</span>}
          </button>
          {isLoggedIn && (
            <button onClick={() => setShowReply(v => !v)}
              className="text-xs text-text-dim hover:text-accent-blue transition-colors">답글</button>
          )}
          {comment.is_mine && (
            <button onClick={handleDelete} className="text-xs text-text-dim hover:text-accent-red transition-colors">삭제</button>
          )}
        </div>
        {showReply && (
          <div className="mt-2 flex gap-2">
            <input autoFocus value={replyText} onChange={e => setReplyText(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && submitReply()}
              placeholder="답글 입력..." maxLength={500}
              className="flex-1 px-3 py-2 bg-bg-elevated border border-border rounded-xl text-sm text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-blue/50" />
            <button onClick={submitReply} disabled={!replyText.trim() || submitting}
              className="px-3 py-2 bg-accent-blue text-white text-xs rounded-xl disabled:opacity-40 hover:bg-accent-blue/90 transition-colors">
              {submitting ? "..." : "등록"}
            </button>
          </div>
        )}
        {comment.replies.length > 0 && (
          <div className="mt-3 flex flex-col gap-3 pl-3 border-l-2 border-border/50">
            {comment.replies.map(r => (
              <ReplyItem key={r.id} reply={r} postId={postId} uid={uid}
                isLoggedIn={isLoggedIn} queryKey={queryKey} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function PostDetail() {
  const { postId } = useParams<{ postId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { isLoggedIn, userId, username: myUsername } = useAuthStore();
  const uid = userId ?? undefined;

  const [commentText, setCommentText] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [copied, setCopied] = useState(false);
  const [following, setFollowing] = useState<boolean | null>(null);
  const commentInputRef = useRef<HTMLInputElement>(null);

  const { data: post, isLoading: postLoading } = useQuery<any>({
    queryKey: ["post", postId],
    queryFn: () => communityApi.getPost(Number(postId)),
    staleTime: 60_000,
  });

  const commentsKey = ["post-comments", Number(postId)];
  const { data: comments = [], isLoading: commentsLoading, refetch: refetchComments } = useQuery<Comment[]>({
    queryKey: commentsKey,
    queryFn: () => communityApi.getComments(Number(postId)),
    enabled: !!postId,
    staleTime: 30_000,
  });

  // post 로컬 상태 (낙관적 업데이트용)
  const [localPost, setLocalPost] = useState<any>(null);
  const activePost = localPost ?? post;

  const handleLike = async () => {
    if (!isLoggedIn) { navigate("/login"); return; }
    if (!activePost) return;
    const newLiked = !activePost.liked;
    const newCount = newLiked ? activePost.like_count + 1 : activePost.like_count - 1;
    setLocalPost((p: any) => ({ ...(p ?? activePost), liked: newLiked, like_count: newCount }));
    try { await communityApi.togglePostLike(activePost.id); }
    catch { setLocalPost((p: any) => ({ ...(p ?? activePost), liked: !newLiked, like_count: activePost.like_count })); }
  };

  const handleVote = async (optionIndex: number) => {
    if (!isLoggedIn) { navigate("/login"); return; }
    if (!activePost?.poll) return;
    const prevPoll = activePost.poll;
    const newCounts = [...prevPoll.counts];
    if (prevPoll.my_vote !== null) newCounts[prevPoll.my_vote] = Math.max(0, newCounts[prevPoll.my_vote] - 1);
    newCounts[optionIndex] = (newCounts[optionIndex] ?? 0) + 1;
    const newTotal = prevPoll.my_vote === null ? prevPoll.total + 1 : prevPoll.total;
    setLocalPost((p: any) => ({
      ...(p ?? activePost),
      poll: { ...prevPoll, counts: newCounts, total: newTotal, my_vote: optionIndex },
    }));
    try {
      const result = await communityApi.votePoll(activePost.id, optionIndex);
      setLocalPost((p: any) => ({
        ...(p ?? activePost),
        poll: { ...prevPoll, counts: result.counts, total: result.total, my_vote: result.my_vote },
      }));
    } catch {
      setLocalPost((p: any) => ({ ...(p ?? activePost), poll: prevPoll }));
    }
  };

  const handleFollow = async () => {
    if (!isLoggedIn) { navigate("/login"); return; }
    if (!activePost) return;
    const prev = following ?? activePost.is_following ?? false;
    setFollowing(!prev);
    try {
      const result = await communityApi.toggleFollow(activePost.user_id);
      setFollowing(result.followed);
    } catch {
      setFollowing(prev);
    }
  };

  const handleShare = async () => {
    if (!activePost) return;
    const url = `${window.location.origin}/post/${activePost.id}`;
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  };

  const handleDelete = async () => {
    if (!activePost || !confirm("게시글을 삭제할까요?")) return;
    try {
      await communityApi.deletePost(activePost.market, activePost.symbol, activePost.id);
      navigate(-1);
    } catch {}
  };

  const submitComment = async () => {
    const txt = commentText.trim();
    if (!txt || submittingComment || !activePost) return;
    setSubmittingComment(true);
    setCommentText("");
    const tempId = -Date.now();
    qc.setQueryData<Comment[]>(commentsKey, (prev) => [
      ...(prev ?? []),
      { id: tempId, post_id: activePost.id, parent_id: null, user_id: uid ?? 0,
        username: myUsername ?? "나", avatar_color: 0, content: txt, like_count: 0,
        liked: false, is_mine: true, created_at: new Date().toISOString(), replies: [] },
    ]);
    setLocalPost((p: any) => ({ ...(p ?? activePost), comment_count: (activePost.comment_count ?? 0) + 1 }));
    try {
      await communityApi.createComment(activePost.id, txt);
      refetchComments();
    } catch {
      qc.setQueryData<Comment[]>(commentsKey, (prev) => (prev ?? []).filter(c => c.id !== tempId));
      setCommentText(txt);
      setLocalPost((p: any) => ({ ...(p ?? activePost), comment_count: activePost.comment_count }));
    } finally {
      setSubmittingComment(false);
    }
  };

  if (postLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-6 h-6 rounded-full border-2 border-accent-blue border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!activePost) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <p className="text-text-muted text-sm">게시글을 찾을 수 없습니다</p>
        <button onClick={() => navigate(-1)} className="text-xs text-accent-blue hover:underline">돌아가기</button>
      </div>
    );
  }

  const isFollowing = following ?? activePost.is_following ?? false;
  const badgeCls = MARKET_BADGE[activePost.market] ?? MARKET_BADGE.KR;
  const avatarCls = AVATAR_COLORS[activePost.avatar_color % AVATAR_COLORS.length];

  return (
    <div className="min-h-screen flex flex-col">
      {/* 상단 헤더 */}
      <div className="sticky top-0 z-20 bg-bg-card/90 backdrop-blur-md border-b border-border">
        <div className="max-w-2xl mx-auto px-3 sm:px-4 h-12 flex items-center gap-2">
          <button onClick={() => navigate(-1)}
            className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors -ml-1">
            <ArrowLeft size={18} />
          </button>
          <span className="text-sm font-semibold text-text-primary truncate flex-1">게시글</span>
          <Link to={`/stocks/${activePost.market}/${activePost.symbol}`}
            className={`text-xs font-bold px-2 py-0.5 rounded border ${badgeCls}`}>
            {activePost.symbol}
          </Link>
        </div>
      </div>

      {/* 본문 */}
      <div className="flex-1 overflow-y-auto pb-[calc(4rem+env(safe-area-inset-bottom))]">
        <div className="max-w-2xl mx-auto px-3 sm:px-4 py-4 sm:py-6 flex flex-col gap-5">

          {/* 작성자 + 액션 */}
          <div className="flex items-start gap-3">
            <Avatar username={activePost.username} colorIndex={activePost.avatar_color}
              userId={activePost.user_id} isMine={activePost.is_mine} size="lg" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Link to={activePost.is_mine ? "/mypage" : `/profile/${activePost.user_id}`}
                  className="text-sm font-semibold text-text-primary hover:text-accent-blue transition-colors">
                  {activePost.username}
                </Link>
                <span className="text-2xs text-text-dim">{timeAgo(activePost.created_at)}</span>
                {!activePost.is_mine && isLoggedIn && (
                  <button onClick={handleFollow}
                    className={`ml-auto text-xs px-2.5 py-1 rounded-lg border font-semibold transition-all ${
                      isFollowing
                        ? "bg-bg-elevated border-border text-text-muted hover:border-accent-red/50 hover:text-accent-red"
                        : "bg-accent-blue/10 border-accent-blue/30 text-accent-blue hover:bg-accent-blue hover:text-white"
                    }`}>
                    {isFollowing ? "팔로잉" : "팔로우"}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <Link to={`/stocks/${activePost.market}/${activePost.symbol}`}
                  className={`text-2xs font-bold px-1.5 py-0.5 rounded border ${badgeCls}`}>
                  {activePost.market}
                </Link>
                <Link to={`/stocks/${activePost.market}/${activePost.symbol}`}
                  className="text-xs font-semibold text-accent-blue hover:underline">
                  {activePost.symbol}
                </Link>
              </div>
            </div>
            {activePost.is_mine && (
              <button onClick={handleDelete} className="p-1.5 text-text-dim hover:text-accent-red transition-colors rounded-lg hover:bg-bg-elevated">
                <Trash2 size={15} />
              </button>
            )}
          </div>

          {/* 제목 */}
          {activePost.title && (
            <h1 className="text-lg sm:text-xl font-bold text-text-primary leading-snug">{activePost.title}</h1>
          )}

          {/* 본문 */}
          {activePost.body && (
            <p className="text-sm sm:text-base text-text-secondary leading-relaxed whitespace-pre-wrap break-words">
              {activePost.body}
            </p>
          )}

          {/* 이미지 */}
          {activePost.image && (
            <img src={activePost.image} alt="첨부 이미지"
              className="w-full max-h-96 object-cover rounded-2xl" />
          )}

          {/* 투표 */}
          {activePost.poll && (
            <div className="bg-bg-elevated rounded-2xl p-4 space-y-3">
              <p className="text-sm font-semibold text-text-primary">{activePost.poll.question}</p>
              <div className="space-y-2">
                {activePost.poll.options.map((opt: string, i: number) => {
                  const voted = activePost.poll!.my_vote !== null;
                  const pct = activePost.poll!.total > 0
                    ? Math.round((activePost.poll!.counts[i] / activePost.poll!.total) * 100) : 0;
                  const isMy = activePost.poll!.my_vote === i;
                  return (
                    <button key={i} disabled={voted}
                      onClick={() => handleVote(i)}
                      className={`w-full relative text-left px-4 py-3 rounded-xl border transition-all overflow-hidden text-sm font-medium ${
                        voted ? (isMy ? "border-accent-blue text-accent-blue" : "border-border text-text-muted") : "border-border hover:border-accent-blue/50 hover:bg-bg-card text-text-primary"
                      }`}>
                      {voted && (
                        <div className={`absolute inset-0 ${isMy ? "bg-accent-blue/10" : "bg-bg-card/50"}`}
                          style={{ width: `${pct}%`, transition: "width 0.5s ease" }} />
                      )}
                      <span className="relative z-10 flex justify-between">
                        <span>{opt}</span>
                        {voted && <span className="font-bold">{pct}%</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-text-dim text-right">총 {activePost.poll.total}명 투표</p>
            </div>
          )}

          {/* 종목 태그 */}
          {activePost.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {activePost.tags.map((t: any) => (
                <Link key={`${t.market}-${t.symbol}`} to={`/stocks/${t.market}/${t.symbol}`}
                  className="text-xs px-2.5 py-1 bg-accent-blue/10 text-accent-blue rounded-lg font-semibold hover:bg-accent-blue/20 transition-colors">
                  #{t.symbol}
                </Link>
              ))}
            </div>
          )}

          {/* 포트폴리오 */}
          {activePost.portfolio?.length > 0 && (
            <PortfolioSnapshot items={activePost.portfolio} />
          )}

          {/* 액션 바 */}
          <div className="flex items-center gap-1 py-3 border-t border-b border-border/50">
            <button onClick={handleLike}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all active:scale-95 ${
                activePost.liked ? "text-accent-red bg-accent-red/10" : "text-text-dim hover:text-accent-red hover:bg-accent-red/5"
              }`}>
              <Heart size={16} className={activePost.liked ? "fill-accent-red" : ""} />
              <span>{activePost.like_count > 0 ? activePost.like_count : "좋아요"}</span>
            </button>
            <button onClick={() => commentInputRef.current?.focus()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium text-text-dim hover:text-accent-blue hover:bg-accent-blue/5 transition-all">
              <MessageSquare size={16} />
              <span>{activePost.comment_count > 0 ? activePost.comment_count : "댓글"}</span>
            </button>
            {(activePost.view_count ?? 0) > 0 && (
              <span className="flex items-center gap-1.5 px-3 py-2 text-sm text-text-dim">
                <Eye size={16} />
                <span>{activePost.view_count}</span>
              </span>
            )}
            <button onClick={handleShare}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium text-text-dim hover:text-text-primary hover:bg-bg-elevated transition-all ml-auto">
              <Share2 size={15} />
              <span>{copied ? "복사됨!" : "공유"}</span>
            </button>
          </div>

          {/* 댓글 */}
          <div className="flex flex-col gap-5">
            <p className="text-sm font-semibold text-text-primary">
              댓글 {comments.length > 0 ? comments.length : ""}
            </p>
            {commentsLoading ? (
              <div className="flex justify-center py-6">
                <div className="w-5 h-5 rounded-full border-2 border-accent-blue border-t-transparent animate-spin" />
              </div>
            ) : comments.length > 0 ? (
              comments.map(c => (
                <CommentItem key={c.id} comment={c} postId={activePost.id} uid={uid}
                  isLoggedIn={isLoggedIn} queryKey={commentsKey} myUsername={myUsername} />
              ))
            ) : (
              <p className="text-sm text-text-dim text-center py-6">첫 댓글을 남겨보세요</p>
            )}
          </div>
        </div>
      </div>

      {/* 고정 댓글 입력 */}
      <div className="fixed bottom-0 left-0 right-0 z-20 bg-bg-card/95 backdrop-blur-md border-t border-border">
        <div className="max-w-2xl mx-auto px-3 sm:px-4 py-2.5" style={{ paddingBottom: "calc(0.625rem + env(safe-area-inset-bottom))" }}>
          {isLoggedIn ? (
            <div className="flex gap-2 items-center">
              <div className={`w-7 h-7 rounded-full border flex items-center justify-center text-xs font-bold shrink-0 ${AVATAR_COLORS[0]}`}>
                {(myUsername ?? "?")[0]?.toUpperCase()}
              </div>
              <input ref={commentInputRef} value={commentText}
                onChange={e => setCommentText(e.target.value)}
                onKeyDown={e => e.key === "Enter" && !e.shiftKey && submitComment()}
                placeholder="댓글을 입력하세요..."
                maxLength={5000}
                className="flex-1 px-3 py-2 bg-bg-elevated border border-border rounded-xl text-sm text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-blue/50" />
              <button onClick={submitComment} disabled={!commentText.trim() || submittingComment}
                className="px-3 py-2 bg-accent-blue text-white text-sm rounded-xl disabled:opacity-40 hover:bg-accent-blue/90 transition-colors shrink-0">
                {submittingComment ? "..." : <Send size={14} />}
              </button>
            </div>
          ) : (
            <button onClick={() => navigate("/login")}
              className="w-full py-2.5 text-sm text-text-dim bg-bg-elevated rounded-xl border border-border hover:border-accent-blue/50 transition-colors text-center">
              로그인 후 댓글 작성
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
