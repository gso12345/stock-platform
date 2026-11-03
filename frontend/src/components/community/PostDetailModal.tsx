/**
 * 댓글 창 — 피드에서 '댓글' 을 누르면 아래에서 올라온다(PC 는 가운데). 보던 자리를 잃지 않는다.
 *
 * 피드를 앱처럼 다시 짜면서 글 상세(PostDetail)와 같은 모양으로 맞췄다 —
 *   · 종목은 코드 대신 이름(종목칩), 아바타는 사진까지(공용 Avatar)
 *   · 삭제·신고·링크 복사는 ⋯ 메뉴 하나로(글메뉴). 댓글도 같다
 *   · 공유는 휴대폰 공유 창(utils/공유), 사진은 누르면 크게(사진보기)
 *   · 댓글 입력칸 옆 내 아바타는 닉네임·색·사진으로(예전에는 로그인 아이디 첫 글자 'P')
 */
import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X, Heart, MessageCircle, Share2, Send, Eye, Trash2, Flag, Link2 } from "lucide-react";
import { communityApi } from "@/api/stocks";
import { API_BASE } from "@/api/client";
import { useAuthStore } from "@/store/authStore";
import { useNavigate, Link } from "react-router-dom";
import PortfolioSnapshot from "@/components/portfolio/PortfolioSnapshot";
import Avatar from "@/components/community/Avatar";
import 글메뉴, { type 메뉴항목 } from "@/components/community/글메뉴";
import 종목칩 from "@/components/community/종목칩";
import 사진보기 from "@/components/community/사진보기";
import 신고창, { 신고보내기 } from "@/components/community/신고창";
import { COMMENT_MAX } from "@/constants/community";
import { use확인, use알림 } from "@/hooks/useDialogs";
import { useMyProfile } from "@/hooks/useMyProfile";
import { timeAgo } from "@/utils/formatters";
import { use좋아요 } from "@/hooks/useLike";
import { 글공유, 글주소, 링크복사, 공유알림 } from "@/utils/공유";
import { cn } from "@/components/ui";

// ── 공용 타입 ─────────────────────────────────────────────────────
export interface ModalPost {
  id: number;
  symbol: string;
  market: string;
  name?: string | null;
  user_id: number;
  username: string;
  avatar_color: number;
  avatar_url?: string | null;
  title: string;
  body: string;
  image: string;
  has_image?: boolean;
  poll: {
    question: string;
    options: string[];
    counts: number[];
    total: number;
    my_vote: number | null;
  } | null;
  tags: { symbol: string; market: string; name?: string }[];
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
  avatar_url?: string | null;
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
  /** 댓글 수(답글 포함)가 바뀌면 — 목록의 숫자를 맞춘다 */
  onCommentCount?: (postId: number, count: number) => void;
  onDeleted?: (postId: number) => void;
}

/** 댓글 수 — 서버의 comment_count 처럼 답글까지 센다 */
export function 댓글모두(목록: { replies?: unknown[] }[] | undefined): number {
  return (목록 ?? []).reduce((n, c) => n + 1 + (c.replies?.length ?? 0), 0);
}

// ── 댓글·답글 하나 ────────────────────────────────────────────────
function CommentItem({
  comment, postId, uid, isLoggedIn, onReplyAdded, 답글 = false,
}: {
  comment: Comment; postId: number; uid?: number; isLoggedIn: boolean; onReplyAdded: () => void; 답글?: boolean;
}) {
  const { 묻기, 화면: 확인화면 } = use확인();
  const { 보이기, 화면: 알림화면 } = use알림();
  const qc = useQueryClient();
  const { 눌림: liked, 수: likeCount, 누르기: handleLike } = use좋아요(
    comment.liked, comment.like_count, () => communityApi.toggleCommentLike(comment.id));
  const [showReply, setShowReply] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [신고중, set신고중] = useState(false);
  const 내것 = uid != null && comment.user_id === uid;

  const handleDelete = () => 묻기({
    title: 답글 ? "답글을 삭제할까요?" : "댓글을 삭제할까요?",
    message: 답글 ? "지운 답글은 되돌릴 수 없습니다." : "지운 댓글은 되돌릴 수 없습니다. 달린 답글도 함께 사라집니다.",
    대상: comment.content?.slice(0, 40),
    onConfirm: async () => {
      try {
        await communityApi.deleteComment(comment.id);
        qc.invalidateQueries({ queryKey: ["modal-comments", postId] });
      } catch { 보이기("삭제하지 못했습니다", "error"); }
    },
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

  const 메뉴: 메뉴항목[] = comment.is_mine
    ? [{ 이름: "삭제", 아이콘: Trash2, 위험: true, 누르면: handleDelete }]
    : isLoggedIn ? [{ 이름: "신고", 아이콘: Flag, 위험: true, 누르면: () => set신고중(true) }] : [];

  return (
    <>
    <div className={cn("flex", 답글 ? "gap-2" : "gap-2.5")}>
      <Avatar username={comment.username} colorIndex={comment.avatar_color} avatarUrl={comment.avatar_url}
        userId={comment.user_id} isMine={내것} size={답글 ? "sm" : "md"} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5 min-w-0">
          <Link to={내것 ? "/mypage" : `/profile/${comment.user_id}`}
            className="text-xs font-semibold text-text-primary hover:text-accent-blue transition-colors truncate">
            {comment.username}
          </Link>
          <span className="text-2xs text-text-dim flex-shrink-0">· {timeAgo(comment.created_at)}</span>
          <span className="ml-auto"><글메뉴 항목들={메뉴} 이름={답글 ? "답글 메뉴" : "댓글 메뉴"} 크기={14} /></span>
        </div>
        <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap break-words">
          {comment.content}
        </p>
        <div className="flex items-center gap-3 mt-1">
          <button onClick={handleLike} aria-pressed={liked}
            aria-label={likeCount > 0 ? `좋아요 ${likeCount}` : "좋아요"}
            className={cn("flex items-center gap-1 text-xs transition-all active:scale-90",
              liked ? "text-accent-red" : "text-text-dim hover:text-accent-red")}>
            <Heart size={11} className={liked ? "fill-accent-red" : ""} />
            {likeCount > 0 && <span className={liked ? "font-semibold" : ""}>{likeCount}</span>}
          </button>
          {!답글 && isLoggedIn && (
            <button onClick={() => setShowReply((v) => !v)} className="text-xs text-text-dim hover:text-accent-blue transition-colors">
              답글
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
              maxLength={COMMENT_MAX}
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
              <CommentItem key={r.id} comment={r} postId={postId} uid={uid} isLoggedIn={isLoggedIn}
                onReplyAdded={onReplyAdded} 답글 />
            ))}
          </div>
        )}
      </div>
    </div>
    {신고중 && (
      <신고창 무엇="댓글" 대상={comment.content?.slice(0, 60)} 닫기={() => set신고중(false)}
        보내기={(사유) => 신고보내기(() => communityApi.reportComment(comment.id, 사유), "댓글", 보이기)} />
    )}
    {확인화면}
    {알림화면}
    </>
  );
}

// ── 메인 모달 ─────────────────────────────────────────────────────
export default function PostDetailModal({
  post: initialPost, onClose, onLikeToggled, onVoteUpdated, onCommentCount, onDeleted,
}: PostDetailModalProps) {
  const { 묻기, 화면: 확인화면 } = use확인();
  const { 보이기, 화면: 알림화면 } = use알림();
  const { isLoggedIn, userId } = useAuthStore();
  const 나 = useMyProfile();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [post, setPost] = useState(initialPost);
  const [commentText, setCommentText] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [신고중, set신고중] = useState(false);
  const [크게볼사진, set크게볼사진] = useState<string | null>(null);
  const commentInputRef = useRef<HTMLInputElement>(null);
  const uid = userId ?? undefined;

  // 배경 스크롤 잠금
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  // Escape 키로 닫기 — 사진을 크게 보는 중이면 사진만 닫는다(사진보기가 따로 듣는다)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape" && !크게볼사진) onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, 크게볼사진]);

  const { data: comments, isLoading: commentsLoading, refetch: refetchComments } = useQuery<Comment[]>({
    queryKey: ["modal-comments", post.id],
    queryFn: () => communityApi.getComments(post.id),
    staleTime: 30_000,
  });

  /* 댓글을 달거나 지우면 목록의 댓글 수도 맞춘다 — 창을 닫고 돌아갔는데 숫자가 그대로면 안 달린 줄 안다.
     수가 바뀔 때마다 알린다. 처음 받은 수가 목록과 같으면 바뀐 것이 없어 알리지 않는다(그 수로 시작했으니).
     '처음 수와 다를 때만' 으로 막으면, 달았다(2→3) 지웠을 때(3→2) 목록이 3 에 머문다 */
  const 댓글수 = comments ? 댓글모두(comments) : post.comment_count;
  useEffect(() => {
    if (comments) onCommentCount?.(post.id, 댓글수);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [댓글수]);

  const handleLike = async () => {
    if (!isLoggedIn) { navigate("/login"); return; }
    const newLiked = !post.liked;
    const newCount = newLiked ? post.like_count + 1 : post.like_count - 1;
    setPost((p) => ({ ...p, liked: newLiked, like_count: newCount }));
    try {
      /* 서버가 알려준 것으로 맞춘다 — 서버는 토글이라, 화면이 들고 있던
         상태가 틀렸으면 반대로 움직인다 */
      const r: any = await communityApi.togglePostLike(post.id);
      const 실제liked = r && typeof r.liked === "boolean" ? r.liked : newLiked;
      const 실제count = r?.like_count ?? newCount;
      setPost((p) => ({ ...p, liked: 실제liked, like_count: 실제count }));
      onLikeToggled?.(post.id, 실제liked, 실제count);
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

  /* 글 주소여야 한다 — 종목 게시판(/stocks/…)으로 보내면 받은 사람은 어떤 글 이야기인지 모른다 */
  const handleShare = async () => {
    const 알림 = 공유알림(await 글공유(글주소(post.id), post.title || undefined));
    if (알림) 보이기(알림.글, 알림.종류);
  };
  const handleCopy = async () => {
    const 알림 = 공유알림(await 링크복사(글주소(post.id)));
    if (알림) 보이기(알림.글, 알림.종류);
  };

  const handleDelete = () => 묻기({
    title: "글을 삭제할까요?",
    message: "지운 글은 되돌릴 수 없습니다. 달린 댓글도 함께 사라집니다.",
    대상: (post.title || post.body || "(내용 없음)").slice(0, 40),
    onConfirm: async () => {
      try {
        await communityApi.deletePost(post.market, post.symbol, post.id);
        onDeleted?.(post.id);
        onClose();
      } catch { 보이기("삭제하지 못했습니다", "error"); }
    },
  });

  const submitComment = async () => {
    const txt = commentText.trim();
    if (!txt || submittingComment) return;
    setSubmittingComment(true);
    setCommentText("");
    const tempId = -Date.now();
    // 서버가 답하기 전에 먼저 얹는다 — 내 닉네임·색·사진으로(아이디 첫 글자가 아니라)
    const tempComment = {
      id: tempId, post_id: post.id, user_id: uid ?? 0,
      username: 나.displayName, avatar_color: 나.avatarColor, avatar_url: 나.avatarUrl,
      content: txt, like_count: 0, liked: false, is_mine: true,
      created_at: new Date().toISOString(), replies: [],
    };
    qc.setQueryData<any[]>(["modal-comments", post.id], (prev) => [...(prev ?? []), tempComment]);
    try {
      await communityApi.createComment(post.id, txt);
      refetchComments();
    } catch {
      qc.setQueryData<any[]>(["modal-comments", post.id], (prev) =>
        (prev ?? []).filter((c) => c.id !== tempId)
      );
      setCommentText(txt);
    } finally {
      setSubmittingComment(false);
    }
  };

  const 포트폴리오글 = !!(post.portfolio && post.portfolio.length > 0);
  /* 피드 목록에서 넘어온 글은 사진을 빼고 '있다' 는 표시만 들고 있다 — 예전에는 그래서 댓글 창에 사진이
     안 나왔다. 목록 카드처럼 사진 주소로 받는다 */
  const 사진 = post.image || (post.has_image ? `${API_BASE}/community/posts/${post.id}/image` : "");
  const 메뉴: 메뉴항목[] = [
    { 이름: "링크 복사", 아이콘: Link2, 누르면: handleCopy },
    ...(post.is_mine
      ? [{ 이름: "삭제", 아이콘: Trash2, 위험: true, 누르면: handleDelete }]
      : isLoggedIn ? [{ 이름: "신고", 아이콘: Flag, 위험: true, 누르면: () => set신고중(true) }] : []),
  ];

  return (
    <>
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      {/* 백드롭 */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* 모달 패널 */}
      <div
        role="dialog" aria-modal="true" aria-label="댓글"
        className="relative z-10 w-full sm:max-w-2xl max-h-[92dvh] sm:max-h-[85dvh] bg-bg-card border border-border rounded-t-3xl sm:rounded-3xl flex flex-col shadow-modal animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between gap-2 px-5 py-3.5 border-b border-border shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar username={post.username} colorIndex={post.avatar_color} avatarUrl={post.avatar_url}
              userId={post.user_id} isMine={post.is_mine} size="lg" />
            <div className="min-w-0">
              <Link
                to={post.is_mine ? "/mypage" : `/profile/${post.user_id}`}
                onClick={onClose}
                className="block text-sm font-semibold text-text-primary hover:text-accent-blue transition-colors truncate"
              >
                {post.username}
              </Link>
              <p className="text-2xs text-text-dim">{timeAgo(post.created_at)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {!포트폴리오글 && <종목칩 symbol={post.symbol} market={post.market} name={post.name} onClick={onClose} />}
            <글메뉴 항목들={메뉴} 이름="글 메뉴" />
            <button
              onClick={onClose}
              aria-label="닫기"
              title="닫기"
              className="p-2 -mr-2 rounded-xl text-text-dim hover:text-text-primary hover:bg-bg-elevated transition-all"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* 스크롤 가능 본문 */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4 flex flex-col gap-4 min-h-0">
          <div>
            {post.title && (
              <p className="text-base font-bold text-text-primary mb-2">{post.title}</p>
            )}
            <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap break-words">
              {post.body}
            </p>
          </div>

          {포트폴리오글 && <PortfolioSnapshot items={post.portfolio!} />}

          {사진 && (
            <button type="button" aria-label="사진 크게 보기" onClick={() => set크게볼사진(사진)}
              className="block w-full overflow-hidden rounded-xl border border-border/60">
              <img src={사진} alt="첨부 사진" className="w-full object-cover max-h-72" />
            </button>
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
                    disabled={voted}
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
              <p className="text-2xs text-text-dim text-right">{post.poll.total}명 투표</p>
            </div>
          )}

          {post.tags && post.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {post.tags.map((t) => (
                <Link
                  key={`${t.market}-${t.symbol}`}
                  to={`/stocks/${t.market}/${t.symbol}`}
                  onClick={onClose}
                  className="text-xs font-semibold text-accent-blue hover:underline"
                >
                  #{t.market === "KR" && t.name ? t.name : t.symbol}
                </Link>
              ))}
            </div>
          )}

          {/* 액션 바 — 아이콘과 숫자만 */}
          <div className="flex items-center gap-1 -ml-2 py-1 border-t border-b border-border/50">
            <button onClick={handleLike} aria-pressed={post.liked}
              aria-label={post.like_count > 0 ? `좋아요 ${post.like_count}` : "좋아요"}
              className={cn("flex items-center gap-1.5 min-h-[40px] px-2 rounded-full text-sm transition-all active:scale-90",
                post.liked ? "text-accent-red" : "text-text-muted hover:text-accent-red")}>
              <Heart size={17} className={post.liked ? "fill-accent-red" : ""} />
              {post.like_count > 0 && <span className="num font-medium">{post.like_count}</span>}
            </button>

            <button onClick={() => commentInputRef.current?.focus()}
              aria-label={댓글수 > 0 ? `댓글 ${댓글수}` : "댓글"}
              className="flex items-center gap-1.5 min-h-[40px] px-2 rounded-full text-sm text-text-muted hover:text-accent-blue transition-colors">
              <MessageCircle size={17} />
              {댓글수 > 0 && <span className="num font-medium">{댓글수}</span>}
            </button>

            <button onClick={handleShare} aria-label="공유"
              className="flex items-center justify-center min-h-[40px] min-w-[40px] px-2 rounded-full text-text-muted hover:text-text-primary transition-colors">
              <Share2 size={17} />
            </button>

            {(post.view_count ?? 0) > 0 && (
              <span className="ml-auto flex items-center gap-1 text-xs text-text-dim" aria-label={`조회 ${post.view_count}`}>
                <Eye size={13} />
                <span className="num">{post.view_count}</span>
              </span>
            )}
          </div>

          {/* 댓글 목록 */}
          <div className="flex flex-col gap-4 pb-2">
            {commentsLoading ? (
              <div className="flex justify-center py-8">
                <div className="w-5 h-5 rounded-full border-2 border-accent-blue border-t-transparent animate-spin" />
              </div>
            ) : comments && comments.length > 0 ? (
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

        {/* 댓글 입력 — 내 아바타와 함께 */}
        <div className="shrink-0 px-4 py-3 border-t border-border pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          {isLoggedIn ? (
            <div className="flex items-center gap-2">
              <Avatar username={나.displayName} colorIndex={나.avatarColor} avatarUrl={나.avatarUrl} size="md" />
              <input
                ref={commentInputRef}
                aria-label="댓글 쓰기"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && submitComment()}
                placeholder="댓글을 입력하세요..."
                maxLength={COMMENT_MAX}
                className="flex-1 min-w-0 px-3.5 py-2 bg-bg-elevated border border-border rounded-full text-sm text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-blue/50"
              />
              <button
                onClick={submitComment}
                aria-label="댓글 올리기"
                disabled={!commentText.trim() || submittingComment}
                className="p-2.5 bg-accent-blue text-white rounded-full disabled:opacity-40 hover:bg-accent-blue/90 transition-colors"
              >
                <Send size={16} />
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
    {신고중 && (
      <신고창 무엇="글" 대상={(post.title || post.body || "").slice(0, 60)} 닫기={() => set신고중(false)}
        보내기={(사유) => 신고보내기(() => communityApi.reportPost(post.id, 사유), "글", 보이기)} />
    )}
    {크게볼사진 && <사진보기 주소={크게볼사진} 닫기={() => set크게볼사진(null)} />}
    {확인화면}
    {알림화면}
    </>
  );
}
