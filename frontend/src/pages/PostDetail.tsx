/**
 * 글 상세.
 *
 * 피드를 앱처럼 다시 짜면서(사용자: "피드탭 디자인, 사용자편의성 개선하고 싶어 앱느낌 나도록") 함께 맞췄다 —
 *   · 위 띠의 '005930' 칩이 작성자 밑 종목과 겹쳐서 뺐다. 위 띠는 ← 와 ⋯ 만(수정·삭제·링크 복사·신고)
 *   · 종목은 코드 대신 이름(종목칩), 사진은 누르면 크게(사진보기), 공유는 휴대폰 공유 창(utils/공유)
 *   · 깃발 아이콘·댓글마다 붙은 '신고' 글자·'수정 삭제' 글자는 ⋯ 메뉴로(글메뉴)
 *   · 댓글 입력칸을 화면 아래에 붙였다(사용자가 고른 11번). 예전에는 댓글 목록 위에 있어 댓글을 읽다가 쓰려면
 *     다시 올라가야 했고, 댓글 창(아래에서 올라오는 것)은 입력칸이 아래라 둘이 달랐다. 휴대폰은 아래 탭 바로
 *     위, 자판이 올라오면 자판 바로 위. 입력칸 옆 내 아바타도 닉네임·색·사진으로(예전에는 아이디 첫 글자 'P')
 */
import { useState, useRef, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Heart, MessageCircle, Share2, Send, Trash2, Eye, PenLine, Pencil, X,
  Hash, BarChart2, Image as ImageIcon, Flag, Link2,
} from "lucide-react";
import { communityApi } from "@/api/stocks";
import api from "@/api/client";
import { useAuthStore } from "@/store/authStore";
import PortfolioSnapshot from "@/components/portfolio/PortfolioSnapshot";
import AvatarComponent from "@/components/community/Avatar";
import 글메뉴, { type 메뉴항목 } from "@/components/community/글메뉴";
import 종목칩 from "@/components/community/종목칩";
import 사진보기 from "@/components/community/사진보기";
import 신고창, { 신고보내기 } from "@/components/community/신고창";
import { BODY_MAX, TITLE_MAX, COMMENT_MAX, POLL_QUESTION_MAX, POLL_OPTION_MAX } from "@/constants/community";
import { use확인, use알림 } from "@/hooks/useDialogs";
import { useMyProfile } from "@/hooks/useMyProfile";
import { use넓은화면 } from "@/hooks/useWideScreen";
import { use자판높이 } from "@/hooks/useSheet";
import { Button, 못불러옴, cn } from "@/components/ui";
import { timeAgo } from "@/utils/formatters";
import { use좋아요 } from "@/hooks/useLike";
import { 글공유, 글주소, 링크복사, 공유알림 } from "@/utils/공유";

async function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
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
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) { URL.revokeObjectURL(url); reject(new Error("canvas unavailable")); return; }
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.7));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image load failed")); };
    img.src = url;
  });
}

interface Comment {
  id: number; parent_id: number | null; user_id: number; username: string;
  avatar_color: number; avatar_url?: string | null; content: string;
  like_count: number; liked: boolean; created_at: string; is_mine: boolean; replies: Comment[];
}

/** 서버가 답하기 전에 얹어 두는 내 댓글의 모습 — 닉네임·색·사진으로(로그인 아이디가 아니라) */
type 내모습 = { displayName: string; avatarColor: number; avatarUrl: string | null };

/** 댓글·답글 하나의 ⋯ 메뉴 — 내 것이면 수정·삭제, 남의 것이면(로그인했을 때) 신고 */
function 댓글메뉴항목(내것: boolean, 로그인: boolean, 고치기: () => void, 지우기: () => void, 신고: () => void): 메뉴항목[] {
  if (내것) return [
    { 이름: "수정", 아이콘: Pencil, 누르면: 고치기 },
    { 이름: "삭제", 아이콘: Trash2, 위험: true, 누르면: 지우기 },
  ];
  return 로그인 ? [{ 이름: "신고", 아이콘: Flag, 위험: true, 누르면: 신고 }] : [];
}

function ReplyItem({ reply, uid, isLoggedIn, queryKey }: {
  reply: Comment; postId: number; uid?: number; isLoggedIn: boolean; queryKey: any[];
}) {
  const { 묻기, 화면: 확인화면 } = use확인();
  const { 보이기, 화면: 알림화면 } = use알림();
  const qc = useQueryClient();
  const { 눌림: liked, 수: likeCount, 누르기: handleLike } = use좋아요(
    reply.liked, reply.like_count, () => communityApi.toggleCommentLike(reply.id));
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [saving, setSaving] = useState(false);
  const [신고중, set신고중] = useState(false);

  const handleDelete = () => 묻기({
    title: "답글을 삭제할까요?",
    message: "지운 답글은 되돌릴 수 없습니다.",
    대상: reply.content?.slice(0, 40),
    onConfirm: async () => {
      try {
        await communityApi.deleteComment(reply.id);
        qc.invalidateQueries({ queryKey });
      } catch { 보이기("삭제하지 못했습니다", "error"); }
    },
  });

  const startEdit = () => { setEditText(reply.content); setIsEditing(true); };

  const saveEdit = async () => {
    const txt = editText.trim();
    if (!txt || saving) return;
    setSaving(true);
    try {
      await communityApi.updateComment(reply.id, txt);
      qc.setQueryData<Comment[]>(queryKey, (prev) =>
        (prev ?? []).map(c => ({
          ...c,
          replies: c.replies.map(r => r.id === reply.id ? { ...r, content: txt } : r),
        }))
      );
      setIsEditing(false);
    } catch {} finally { setSaving(false); }
  };

  const 내것 = uid != null && reply.user_id === uid;
  return (
    <>
    <div className="flex gap-2">
      <AvatarComponent username={reply.username} colorIndex={reply.avatar_color} avatarUrl={reply.avatar_url}
        userId={reply.user_id} isMine={내것} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5 min-w-0">
          <Link to={내것 ? "/mypage" : `/profile/${reply.user_id}`}
            className="text-xs font-semibold text-text-primary hover:text-accent-blue transition-colors truncate">
            {reply.username}
          </Link>
          <span className="text-2xs text-text-dim flex-shrink-0">· {timeAgo(reply.created_at)}</span>
          {!isEditing && (
            <span className="ml-auto">
              <글메뉴 이름="답글 메뉴" 크기={14}
                항목들={댓글메뉴항목(reply.is_mine, isLoggedIn, startEdit, handleDelete, () => set신고중(true))} />
            </span>
          )}
        </div>
        {isEditing ? (
          <div className="flex flex-col gap-1.5 mt-1">
            <textarea autoFocus value={editText} rows={2} aria-label="답글 고치기"
              onChange={e => setEditText(e.target.value)}
              className="w-full bg-bg-elevated border border-accent-blue/50 rounded-xl px-3 py-2 text-sm text-text-secondary focus:outline-none resize-none" />
            <div className="flex gap-2">
              <button onClick={saveEdit} disabled={saving}
                className="text-xs px-2.5 py-1 bg-accent-blue text-white rounded-lg disabled:opacity-50">{saving ? "저장 중" : "저장"}</button>
              <button onClick={() => setIsEditing(false)} className="text-xs px-2.5 py-1 text-text-dim hover:text-text-primary border border-border rounded-lg">취소</button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap break-words">{reply.content}</p>
        )}
        {!isEditing && (
          <div className="flex items-center gap-3 mt-1.5">
            <button onClick={handleLike} aria-pressed={liked} aria-label={likeCount > 0 ? `좋아요 ${likeCount}` : "좋아요"}
              className={`flex items-center gap-1 text-xs transition-all active:scale-90 ${liked ? "text-accent-red" : "text-text-dim hover:text-accent-red"}`}>
              <Heart size={11} className={liked ? "fill-accent-red" : ""} />
              {likeCount > 0 && <span className={liked ? "font-semibold" : ""}>{likeCount}</span>}
            </button>
          </div>
        )}
      </div>
    </div>
    {신고중 && (
      <신고창 무엇="댓글" 대상={reply.content?.slice(0, 60)} 닫기={() => set신고중(false)}
        보내기={(사유) => 신고보내기(() => communityApi.reportComment(reply.id, 사유), "댓글", 보이기)} />
    )}
    {확인화면}
    {알림화면}
    </>
  );
}

function CommentItem({ comment, postId, uid, isLoggedIn, queryKey, 나 }: {
  comment: Comment; postId: number; uid?: number; isLoggedIn: boolean; queryKey: any[]; 나: 내모습;
}) {
  const { 묻기, 화면: 확인화면 } = use확인();
  const { 보이기, 화면: 알림화면 } = use알림();
  const qc = useQueryClient();
  const { 눌림: liked, 수: likeCount, 누르기: handleLike } = use좋아요(
    comment.liked, comment.like_count, () => communityApi.toggleCommentLike(comment.id));
  const [showReply, setShowReply] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [신고중, set신고중] = useState(false);

  const handleDelete = () => 묻기({
    title: "댓글을 삭제할까요?",
    message: "지운 댓글은 되돌릴 수 없습니다. 달린 답글도 함께 사라집니다.",
    대상: comment.content?.slice(0, 40),
    onConfirm: async () => {
      try {
        await communityApi.deleteComment(comment.id);
        qc.invalidateQueries({ queryKey });
      } catch { 보이기("삭제하지 못했습니다", "error"); }
    },
  });

  const startEdit = () => { setEditText(comment.content); setIsEditing(true); };

  const saveEdit = async () => {
    const txt = editText.trim();
    if (!txt || savingEdit) return;
    setSavingEdit(true);
    try {
      await communityApi.updateComment(comment.id, txt);
      qc.setQueryData<Comment[]>(queryKey, (prev) =>
        (prev ?? []).map(c => c.id === comment.id ? { ...c, content: txt } : c)
      );
      setIsEditing(false);
    } catch {} finally { setSavingEdit(false); }
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
            user_id: uid ?? 0, username: 나.displayName, avatar_color: 나.avatarColor, avatar_url: 나.avatarUrl,
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

  const 내것 = uid != null && comment.user_id === uid;
  return (
    <>
    <div className="flex gap-3">
      <AvatarComponent username={comment.username} colorIndex={comment.avatar_color} avatarUrl={comment.avatar_url}
        userId={comment.user_id} isMine={내것} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5 min-w-0">
          <Link to={내것 ? "/mypage" : `/profile/${comment.user_id}`}
            className="text-sm font-semibold text-text-primary hover:text-accent-blue transition-colors truncate">
            {comment.username}
          </Link>
          <span className="text-2xs text-text-dim flex-shrink-0">· {timeAgo(comment.created_at)}</span>
          {!isEditing && (
            <span className="ml-auto">
              <글메뉴 이름="댓글 메뉴" 크기={16}
                항목들={댓글메뉴항목(comment.is_mine, isLoggedIn, startEdit, handleDelete, () => set신고중(true))} />
            </span>
          )}
        </div>
        {isEditing ? (
          <div className="flex flex-col gap-1.5 mt-1 mb-2">
            <textarea autoFocus value={editText} rows={3} aria-label="댓글 고치기"
              onChange={e => setEditText(e.target.value)}
              className="w-full bg-bg-elevated border border-accent-blue/50 rounded-xl px-3 py-2 text-sm text-text-secondary focus:outline-none resize-none" />
            <div className="flex gap-2">
              <button onClick={saveEdit} disabled={savingEdit}
                className="text-xs px-2.5 py-1 bg-accent-blue text-white rounded-lg disabled:opacity-50">{savingEdit ? "저장 중" : "저장"}</button>
              <button onClick={() => setIsEditing(false)} className="text-xs px-2.5 py-1 text-text-dim hover:text-text-primary border border-border rounded-lg">취소</button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap break-words mb-1.5">{comment.content}</p>
        )}
        {!isEditing && (
          <div className="flex items-center gap-4">
            <button onClick={handleLike} aria-pressed={liked} aria-label={likeCount > 0 ? `좋아요 ${likeCount}` : "좋아요"}
              className={`flex items-center gap-1 text-xs transition-all active:scale-90 ${liked ? "text-accent-red" : "text-text-dim hover:text-accent-red"}`}>
              <Heart size={11} className={liked ? "fill-accent-red" : ""} />
              {likeCount > 0 && <span className={liked ? "font-semibold" : ""}>{likeCount}</span>}
            </button>
            {isLoggedIn && (
              <button onClick={() => setShowReply(v => !v)}
                className="text-xs text-text-dim hover:text-accent-blue transition-colors">답글</button>
            )}
          </div>
        )}
        {showReply && (
          <div className="mt-2 flex items-end gap-2">
            <div className="flex-1 flex items-end gap-2 bg-bg-elevated border border-border rounded-[22px] px-3.5 py-2 focus-within:border-accent-blue/50 transition-colors">
              <textarea autoFocus value={replyText} rows={1} aria-label="답글 쓰기"
                onChange={e => {
                  setReplyText(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = Math.min(e.target.scrollHeight, 80) + "px";
                }}
                onKeyDown={e => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), submitReply())}
                placeholder="답글을 입력하세요..." maxLength={COMMENT_MAX}
                className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-dim focus:outline-none resize-none overflow-hidden leading-relaxed min-h-[20px]" />
              <button onClick={submitReply} disabled={submitting} aria-label="답글 올리기"
                className="shrink-0 mb-0.5 transition-all active:scale-90">
                {replyText.trim()
                  ? <Send size={14} className={`text-accent-blue ${submitting ? "opacity-40" : ""}`} />
                  : <PenLine size={14} className="text-text-dim" />}
              </button>
            </div>
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
    {신고중 && (
      <신고창 무엇="댓글" 대상={comment.content?.slice(0, 60)} 닫기={() => set신고중(false)}
        보내기={(사유) => 신고보내기(() => communityApi.reportComment(comment.id, 사유), "댓글", 보이기)} />
    )}
    {확인화면}
    {알림화면}
    </>
  );
}

/* 글 상세가 뜰 자리 */
function PostSkeleton() {
  return (
    <div className="max-w-2xl mx-auto py-4 flex flex-col gap-4 animate-pulse">
      <div className="flex items-center gap-2">
        <div className="w-9 h-9 rounded-full bg-bg-elevated" />
        <div className="flex flex-col gap-1.5">
          <div className="h-3 w-24 rounded bg-bg-elevated" />
          <div className="h-2.5 w-16 rounded bg-bg-elevated" />
        </div>
      </div>
      <div className="h-5 w-3/4 rounded bg-bg-elevated" />
      <div className="flex flex-col gap-2">
        <div className="h-3 w-full rounded bg-bg-elevated" />
        <div className="h-3 w-11/12 rounded bg-bg-elevated" />
        <div className="h-3 w-2/3 rounded bg-bg-elevated" />
      </div>
      <div className="h-px bg-border" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex gap-2">
          <div className="w-7 h-7 rounded-full bg-bg-elevated flex-shrink-0" />
          <div className="flex-1 flex flex-col gap-1.5">
            <div className="h-2.5 w-20 rounded bg-bg-elevated" />
            <div className="h-3 w-4/5 rounded bg-bg-elevated" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function PostDetail() {
  const { 묻기, 화면: 확인화면 } = use확인();
  const { 보이기, 화면: 알림화면 } = use알림();
  const { postId } = useParams<{ postId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { isLoggedIn, userId } = useAuthStore();
  const 나 = useMyProfile();
  const uid = userId ?? undefined;
  /* 댓글 입력칸 자리 — 휴대폰은 화면 아래(아래 탭 바로 위, 자판이 올라오면 자판 바로 위), PC 는 본문 끝에 붙어
     따라 내려온다(sticky) */
  const 넓음 = use넓은화면();
  const 자판 = use자판높이(!넓음);

  const [commentText, setCommentText] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [following, setFollowing] = useState<boolean | null>(null);
  const commentInputRef = useRef<HTMLTextAreaElement>(null);
  const [신고중, set신고중] = useState(false);
  const [크게볼사진, set크게볼사진] = useState<string | null>(null);

  const autoResize = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }, []);

  const { data: post, isLoading: postLoading, isError: 못받음, error: 실패사유, refetch: 다시받기 } = useQuery<any>({
    queryKey: ["post", postId],
    queryFn: () => communityApi.getPost(Number(postId)),
    staleTime: 60_000,
  });

  const [commentSort, setCommentSort] = useState<"latest" | "popular">("latest");
  const commentsKey = ["post-comments", Number(postId), commentSort];
  const { data: comments = [], isLoading: commentsLoading, refetch: refetchComments } = useQuery<Comment[]>({
    queryKey: commentsKey,
    queryFn: () => communityApi.getComments(Number(postId), commentSort),
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
    try {
      /* 서버가 알려준 것으로 맞춘다. 먼저 뒤집어 놓은 값은 "내가 알고 있던
         상태" 를 기준으로 한 추측이고, 서버는 토글이라 그 추측이 틀리면
         반대로 움직인다 — 맞춰 놓지 않으면 다음 클릭이 또 어긋난다 */
      const r: any = await communityApi.togglePostLike(activePost.id);
      if (r && typeof r.liked === "boolean") {
        setLocalPost((p: any) => ({ ...(p ?? activePost), liked: r.liked, like_count: r.like_count ?? newCount }));
      }
    }
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
    const 알림 = 공유알림(await 글공유(글주소(activePost.id), activePost.title || undefined));
    if (알림) 보이기(알림.글, 알림.종류);
  };
  const handleCopy = async () => {
    if (!activePost) return;
    const 알림 = 공유알림(await 링크복사(글주소(activePost.id)));
    if (알림) 보이기(알림.글, 알림.종류);
  };

  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editTags, setEditTags] = useState<{ symbol: string; market: string; name?: string }[]>([]);
  const [editTagQuery, setEditTagQuery] = useState("");
  const [editTagResults, setEditTagResults] = useState<any[]>([]);
  const [editShowTagSearch, setEditShowTagSearch] = useState(false);
  const [editShowPoll, setEditShowPoll] = useState(false);
  const [editPollQuestion, setEditPollQuestion] = useState("");
  const [editPollOptions, setEditPollOptions] = useState(["", ""]);
  const [editImage, setEditImage] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const editBodyRef = useRef<HTMLTextAreaElement>(null);
  const editFileInputRef = useRef<HTMLInputElement>(null);
  const editTagSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startEdit = () => {
    if (!activePost) return;
    setEditTitle(activePost.title ?? "");
    setEditBody(activePost.body ?? "");
    setEditImage(activePost.image ?? "");
    setEditTags(activePost.tags ?? []);
    setEditTagQuery("");
    setEditTagResults([]);
    setEditShowTagSearch(false);
    setEditShowPoll(false);
    setEditPollQuestion("");
    setEditPollOptions(["", ""]);
    setIsEditing(true);
    setTimeout(() => {
      if (editBodyRef.current) {
        editBodyRef.current.style.height = "auto";
        editBodyRef.current.style.height = editBodyRef.current.scrollHeight + "px";
      }
    }, 0);
  };

  const cancelEdit = () => setIsEditing(false);

  const handleEditTagSearch = (q: string) => {
    setEditTagQuery(q);
    if (editTagSearchTimer.current) clearTimeout(editTagSearchTimer.current);
    if (!q.trim()) { setEditTagResults([]); return; }
    editTagSearchTimer.current = setTimeout(async () => {
      try {
        const { data } = await api.get<{ results: any[] }>("/search", { params: { q } });
        setEditTagResults((data.results || []).slice(0, 6));
      } catch { setEditTagResults([]); }
    }, 300);
  };

  const addEditTag = (tag: { symbol: string; market: string; name?: string }) => {
    if (editTags.length >= 5) return;
    if (!editTags.find(t => t.symbol === tag.symbol && t.market === tag.market)) {
      setEditTags(prev => [...prev, tag]);
    }
    setEditTagQuery("");
    setEditTagResults([]);
  };

  const saveEdit = async () => {
    if (!activePost || savingEdit) return;
    setSavingEdit(true);
    try {
      const newPoll = !activePost.poll && editShowPoll && editPollQuestion.trim() && editPollOptions.filter(o => o.trim()).length >= 2
        ? { question: editPollQuestion.trim(), options: editPollOptions.filter(o => o.trim()) }
        : undefined;
      await communityApi.updatePost(activePost.market, activePost.symbol, activePost.id, editTitle, editBody, editTags, newPoll, editImage);
      const updatedPoll = newPoll
        ? { question: newPoll.question, options: newPoll.options, counts: newPoll.options.map(() => 0), total: 0, my_vote: null }
        : activePost.poll;
      setLocalPost((p: any) => ({ ...(p ?? activePost), title: editTitle, body: editBody, image: editImage, tags: editTags, poll: updatedPoll }));
      qc.setQueryData(["post", activePost.id], (old: any) => old ? { ...old, title: editTitle, body: editBody, image: editImage, tags: editTags, poll: updatedPoll } : old);
      setIsEditing(false);
    } catch {
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = () => {
    if (!activePost) return;
    묻기({
      title: "글을 삭제할까요?",
      message: "지운 글은 되돌릴 수 없습니다. 달린 댓글도 함께 사라집니다.",
      대상: (activePost.title || activePost.body || "(내용 없음)").slice(0, 40),
      onConfirm: async () => {
        try {
          await communityApi.deletePost(activePost.market, activePost.symbol, activePost.id);
          navigate(-1);
        } catch { 보이기("삭제하지 못했습니다", "error"); }
      },
    });
  };

  const submitComment = async () => {
    const txt = commentText.trim();
    if (!txt || submittingComment || !activePost) return;
    setSubmittingComment(true);
    setCommentText("");
    if (commentInputRef.current) { commentInputRef.current.style.height = "auto"; }
    const tempId = -Date.now();
    qc.setQueryData<Comment[]>(commentsKey, (prev) => [
      ...(prev ?? []),
      { id: tempId, post_id: activePost.id, parent_id: null, user_id: uid ?? 0,
        username: 나.displayName, avatar_color: 나.avatarColor, avatar_url: 나.avatarUrl, content: txt, like_count: 0,
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
    /* 글 한 편의 모양을 미리 잡아 둔다. 예전에는 동그라미만 돌다가
       제목·본문·댓글이 한꺼번에 튀어나와 읽던 자리가 밀렸다 */
    return <PostSkeleton />;
  }

  /* '못 불러왔다' 와 '없는 글' 은 다르다. 아래 !activePost 는 지워진 글에도
     걸리는데, 예전에는 조회가 실패해도 똑같이 "찾을 수 없습니다" 가 떴다.
     지워진 글은 다시 눌러도 소용없지만 실패는 한 번이면 되는 일이다 */
  if (못받음) {
    return <못불러옴 사유={실패사유} 다시={() => 다시받기()} />;
  }

  if (!activePost) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <p className="text-text-muted text-sm">게시글을 찾을 수 없습니다</p>
        <Button onClick={() => navigate(-1)} variant="link" className="text-xs">돌아가기</Button>
      </div>
    );
  }

  const isFollowing = following ?? activePost.is_following ?? false;
  const 포트폴리오글 = (activePost.portfolio?.length ?? 0) > 0;
  const 글메뉴항목: 메뉴항목[] = [
    ...(activePost.is_mine ? [{ 이름: "수정", 아이콘: Pencil, 누르면: startEdit }] : []),
    { 이름: "링크 복사", 아이콘: Link2, 누르면: handleCopy },
    ...(activePost.is_mine
      ? [{ 이름: "삭제", 아이콘: Trash2, 위험: true, 누르면: handleDelete }]
      : isLoggedIn ? [{ 이름: "신고", 아이콘: Flag, 위험: true, 누르면: () => set신고중(true) }] : []),
  ];

  return (
    <>
    <div className="min-h-screen flex flex-col">
      {/* 상단 헤더 — ← 와 ⋯ 만 */}
      <div className="sticky top-0 z-20 bg-bg-card/90 backdrop-blur-md border-b border-border">
        <div className="max-w-2xl mx-auto px-3 sm:px-4 h-12 flex items-center gap-2">
          <button aria-label="뒤로" onClick={() => navigate(-1)}
            className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors -ml-1">
            <ArrowLeft size={20} />
          </button>
          <span className="text-sm font-semibold text-text-primary truncate flex-1">게시글</span>
          <글메뉴 항목들={글메뉴항목} 이름="글 메뉴" 크기={20} className="mr-0.5" />
        </div>
      </div>

      {/* 본문 — 아래에 댓글 입력칸이 붙어 있으니 그만큼 비워 둔다 */}
      <div className="flex-1 pb-6">
        <div className="max-w-2xl mx-auto px-3 sm:px-4 py-4 sm:py-6 flex flex-col gap-5">

          {/* 작성자 · 종목 · 팔로우 */}
          <div className="flex items-start gap-3">
            <AvatarComponent username={activePost.username} colorIndex={activePost.avatar_color}
              avatarUrl={activePost.avatar_url} userId={activePost.user_id} isMine={activePost.is_mine} size="lg" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <Link to={activePost.is_mine ? "/mypage" : `/profile/${activePost.user_id}`}
                  className="text-sm font-semibold text-text-primary hover:text-accent-blue transition-colors truncate">
                  {activePost.username}
                </Link>
                <span className="text-2xs text-text-dim flex-shrink-0">{timeAgo(activePost.created_at)}</span>
              </div>
              <div className="mt-1">
                {포트폴리오글
                  ? <span className="px-2 py-0.5 rounded-lg text-xs font-semibold bg-bg-elevated text-text-secondary">포트폴리오</span>
                  : <종목칩 symbol={activePost.symbol} market={activePost.market} name={activePost.name} />}
              </div>
            </div>
            {!activePost.is_mine && isLoggedIn && (
              <button onClick={handleFollow}
                className={`flex-shrink-0 text-xs px-3 py-1.5 rounded-full border font-semibold transition-all ${
                  isFollowing
                    ? "bg-bg-elevated border-border text-text-muted hover:border-accent-red/50 hover:text-accent-red"
                    : "bg-accent-blue/10 border-accent-blue/30 text-accent-blue hover:bg-accent-blue hover:text-white"
                }`}>
                {isFollowing ? "팔로잉" : "팔로우"}
              </button>
            )}
          </div>

          {/* 수정 패널 — 글쓰기와 동일한 UI */}
          {isEditing ? (
            <div className="bg-bg-elevated border border-accent-blue/30 rounded-2xl p-4 flex flex-col gap-3">
              <input ref={editFileInputRef} type="file" accept="image/*" className="hidden"
                onChange={async e => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try { setEditImage(await compressImage(file)); } catch {}
                  e.target.value = "";
                }} />
              {/* 제목 + 본문 */}
              <input value={editTitle} onChange={e => setEditTitle(e.target.value)} aria-label="제목 고치기"
                placeholder="제목 (선택사항)" maxLength={TITLE_MAX}
                className="w-full bg-transparent border-none text-sm font-semibold text-text-primary placeholder:text-text-dim focus:outline-none" />
              <div className="h-px bg-border/50" />
              <textarea ref={editBodyRef} value={editBody} aria-label="내용 고치기"
                onChange={e => { setEditBody(e.target.value); const el = e.target; el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; }}
                placeholder="의견을 입력하세요..." maxLength={BODY_MAX}
                className="w-full bg-transparent border-none text-sm text-text-primary placeholder:text-text-dim resize-none focus:outline-none leading-relaxed"
                style={{ minHeight: "5rem" }} />

              {/* 이미지 미리보기 */}
              {editImage && (
                <div className="relative w-full">
                  <img src={editImage} alt="미리보기" className="w-full max-h-48 object-cover rounded-xl" />
                  <button aria-label="첨부 이미지 지우기" onClick={() => setEditImage("")}
                    className="absolute top-1.5 right-1.5 p-1 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors">
                    <X size={13} />
                  </button>
                </div>
              )}

              {/* 투표 — 기존 있으면 읽기전용, 없으면 추가 가능 */}
              {activePost.poll ? (
                <div className="bg-bg-card rounded-xl p-3 border border-border/50">
                  <p className="text-xs text-text-dim mb-1.5">투표 (수정 불가)</p>
                  <p className="text-xs font-semibold text-text-primary mb-2">{activePost.poll.question}</p>
                  <div className="flex flex-col gap-1">
                    {activePost.poll.options.map((opt: string, i: number) => (
                      <div key={i} className="text-xs px-2.5 py-1.5 bg-bg-elevated rounded-lg text-text-secondary">{opt}</div>
                    ))}
                  </div>
                </div>
              ) : editShowPoll && (
                <div className="bg-bg-card rounded-xl p-3 flex flex-col gap-2 border border-border/50">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-text-primary">투표 만들기</span>
                    <button aria-label="투표 없애기" onClick={() => setEditShowPoll(false)} className="text-text-dim hover:text-accent-red transition-colors"><X size={13} /></button>
                  </div>
                  <input value={editPollQuestion} onChange={e => setEditPollQuestion(e.target.value)}
                    placeholder="투표 질문을 입력하세요" maxLength={POLL_QUESTION_MAX}
                    className="w-full px-2.5 py-1.5 bg-bg-elevated border border-border rounded-lg text-xs text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-blue/50" />
                  {editPollOptions.map((opt, i) => (
                    <div key={i} className="flex gap-1.5">
                      <input value={opt}
                        onChange={e => { const n = [...editPollOptions]; n[i] = e.target.value; setEditPollOptions(n); }}
                        placeholder={`선택지 ${i + 1}`} maxLength={POLL_OPTION_MAX}
                        className="flex-1 px-2.5 py-1.5 bg-bg-elevated border border-border rounded-lg text-xs text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-blue/50" />
                      {editPollOptions.length > 2 && (
                        <button aria-label="선택지 지우기" onClick={() => setEditPollOptions(prev => prev.filter((_, j) => j !== i))} className="text-text-dim hover:text-accent-red"><X size={13} /></button>
                      )}
                    </div>
                  ))}
                  {editPollOptions.length < 4 && (
                    <Button onClick={() => setEditPollOptions(prev => [...prev, ""])} variant="link" className="text-xs text-left">+ 옵션 추가</Button>
                  )}
                </div>
              )}

              {/* 태그 UI */}
              {editShowTagSearch && (
                <div className="bg-bg-card rounded-xl p-3 flex flex-col gap-2 border border-border/50">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-text-primary">종목 태그</span>
                    <button aria-label="태그 검색 닫기" onClick={() => { setEditShowTagSearch(false); setEditTagQuery(""); setEditTagResults([]); }} className="text-text-dim hover:text-accent-red"><X size={13} /></button>
                  </div>
                  {editTags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {editTags.map(t => (
                        <span key={t.symbol} className="flex items-center gap-1 text-2xs px-1.5 py-0.5 rounded bg-accent-blue/15 text-accent-blue">
                          #{t.market === "KR" && t.name ? t.name : t.symbol}
                          <button aria-label="태그 빼기" onClick={() => setEditTags(prev => prev.filter(x => x.symbol !== t.symbol))}><X size={11} /></button>
                        </span>
                      ))}
                    </div>
                  )}
                  {editTags.length < 5 && (
                    <div className="relative">
                      <input value={editTagQuery} onChange={e => handleEditTagSearch(e.target.value)}
                        placeholder="종목명 또는 심볼 검색..."
                        className="w-full px-2.5 py-1.5 bg-bg-elevated border border-border rounded-lg text-xs text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-blue/50" />
                      {editTagResults.length > 0 && (
                        <div className="absolute z-10 w-full mt-1 bg-bg-card border border-border rounded-xl shadow-float max-h-36 overflow-y-auto">
                          {editTagResults.map((r: any, idx) => (
                            <button key={idx} onClick={() => addEditTag({ symbol: r.symbol, market: r.market, name: r.name })}
                              className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-bg-elevated transition-colors text-left">
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

              {/* 툴바 */}
              <div className="flex items-center justify-between pt-1 border-t border-border/50">
                <div className="flex items-center gap-1">
                  <button onClick={() => editFileInputRef.current?.click()} title="사진 첨부" aria-label="사진 첨부"
                    className={`p-1.5 rounded-lg transition-all ${editImage ? "text-accent-blue bg-accent-blue/10" : "text-text-dim hover:text-text-primary hover:bg-bg-elevated"}`}>
                    <ImageIcon size={14} />
                  </button>
                  {!activePost.poll && (
                    <button onClick={() => setEditShowPoll(v => !v)} title="투표 만들기" aria-label="투표 만들기"
                      className={`p-1.5 rounded-lg transition-all ${editShowPoll ? "text-accent-blue bg-accent-blue/10" : "text-text-dim hover:text-text-primary hover:bg-bg-elevated"}`}>
                      <BarChart2 size={14} />
                    </button>
                  )}
                  <button onClick={() => setEditShowTagSearch(v => !v)} title="종목 태그" aria-label="종목 태그"
                    className={`p-1.5 rounded-lg transition-all ${(editShowTagSearch || editTags.length > 0) ? "text-accent-blue bg-accent-blue/10" : "text-text-dim hover:text-text-primary hover:bg-bg-elevated"}`}>
                    <Hash size={14} />
                  </button>
                  <span className="text-2xs text-text-dim ml-1">{editBody.length}/{BODY_MAX}</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={cancelEdit}
                    className="px-3 py-1.5 rounded-xl text-xs text-text-dim hover:text-text-primary border border-border hover:bg-bg-elevated transition-colors">취소</button>
                  <button onClick={saveEdit} disabled={savingEdit}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-accent-blue text-white text-xs font-semibold hover:bg-accent-blue/90 disabled:opacity-50 transition-all">
                    <Send size={13} />{savingEdit ? "저장 중..." : "저장"}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
          {activePost.title && (
            <h1 className="text-lg sm:text-xl font-bold text-text-primary leading-snug">{activePost.title}</h1>
          )}

          {activePost.body && (
            <p className="text-sm sm:text-base text-text-secondary leading-relaxed whitespace-pre-wrap break-words">
              {activePost.body}
            </p>
          )}

          {/* 사진 — 누르면 크게 */}
          {activePost.image && (
            <button type="button" aria-label="사진 크게 보기" onClick={() => set크게볼사진(activePost.image)}
              className="block w-full overflow-hidden rounded-2xl border border-border/60">
              <img src={activePost.image} alt="첨부 사진" className="w-full max-h-96 object-cover" />
            </button>
          )}

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

          {activePost.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {activePost.tags.map((t: any) => (
                <Link key={`${t.market}-${t.symbol}`} to={`/stocks/${t.market}/${t.symbol}`}
                  className="text-xs px-2.5 py-1 bg-accent-blue/10 text-accent-blue rounded-lg font-semibold hover:bg-accent-blue/20 transition-colors">
                  #{(t as any).market === "KR" && (t as any).name ? (t as any).name : t.symbol}
                </Link>
              ))}
            </div>
          )}

          {포트폴리오글 && <PortfolioSnapshot items={activePost.portfolio} />}
            </>
          )}

          {/* 액션 바 — 아이콘과 숫자만. 신고는 ⋯ 메뉴로 옮겼다 */}
          <div className="flex items-center gap-1 py-2 border-t border-border/50">
            <button onClick={handleLike} aria-pressed={activePost.liked}
              aria-label={activePost.like_count > 0 ? `좋아요 ${activePost.like_count}` : "좋아요"}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all active:scale-95 ${
                activePost.liked ? "text-accent-red bg-accent-red/10" : "text-text-dim hover:text-accent-red hover:bg-accent-red/5"
              }`}>
              <Heart size={17} className={activePost.liked ? "fill-accent-red" : ""} />
              {activePost.like_count > 0 && <span className="num">{activePost.like_count}</span>}
            </button>
            <button onClick={() => commentInputRef.current?.focus()}
              aria-label={(activePost.comment_count ?? 0) > 0 ? `댓글 ${activePost.comment_count}` : "댓글"}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium text-text-dim hover:text-accent-blue hover:bg-accent-blue/5 transition-all">
              <MessageCircle size={17} />
              {(activePost.comment_count ?? 0) > 0 && <span className="num">{activePost.comment_count}</span>}
            </button>
            <button onClick={handleShare} aria-label="공유"
              className="flex items-center justify-center px-3 py-2 rounded-xl text-sm text-text-dim hover:text-text-primary hover:bg-bg-elevated transition-all">
              <Share2 size={17} />
            </button>
            {(activePost.view_count ?? 0) > 0 && (
              <span className="ml-auto flex items-center gap-1 pr-1 text-xs text-text-dim" aria-label={`조회 ${activePost.view_count}`}>
                <Eye size={14} />
                <span className="num">{activePost.view_count}</span>
              </span>
            )}
          </div>

          {/* 댓글 목록 */}
          <div className="flex flex-col gap-5 border-t border-border/50 pt-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-text-primary">
                댓글 {(activePost.comment_count ?? 0) > 0 ? activePost.comment_count : ""}
              </p>
              <div className="flex items-center gap-0.5 bg-bg-elevated rounded-lg p-0.5">
                {(["latest", "popular"] as const).map(s => (
                  <button key={s} onClick={() => setCommentSort(s)} aria-pressed={commentSort === s}
                    className={`text-2xs px-2.5 py-1 rounded-lg transition-all font-medium ${
                      commentSort === s ? "bg-bg-card text-text-primary shadow-card" : "text-text-dim hover:text-text-secondary"
                    }`}>
                    {s === "latest" ? "최신순" : "인기순"}
                  </button>
                ))}
              </div>
            </div>

            {commentsLoading ? (
              <div className="flex justify-center py-6">
                <div className="w-5 h-5 rounded-full border-2 border-accent-blue border-t-transparent animate-spin" />
              </div>
            ) : comments.length > 0 ? (
              comments.map(c => (
                <CommentItem key={c.id} comment={c} postId={activePost.id} uid={uid}
                  isLoggedIn={isLoggedIn} queryKey={commentsKey} 나={나} />
              ))
            ) : (
              <p className="text-sm text-text-dim text-center py-6">첫 댓글을 남겨보세요</p>
            )}
          </div>
        </div>
      </div>

      {/* 댓글 입력칸 — 화면 아래에 붙는다 */}
      <div data-comment-bar=""
        className={cn("z-30 bg-bg-card/95 backdrop-blur-md border-t border-border",
          넓음 ? "sticky bottom-0" : "fixed inset-x-0")}
        style={넓음 ? undefined : { bottom: 자판 > 0 ? 자판 : "calc(3.5rem + env(safe-area-inset-bottom))" }}>
        <div className="max-w-2xl mx-auto px-3 sm:px-4 py-2.5">
          {isLoggedIn ? (
            <div className="flex items-end gap-2.5">
              <div className="pb-0.5">
                <AvatarComponent username={나.displayName} colorIndex={나.avatarColor} avatarUrl={나.avatarUrl} size="md" />
              </div>
              <div className="flex-1 flex items-end gap-2 bg-bg-elevated border border-border rounded-[22px] px-3.5 py-2 focus-within:border-accent-blue/50 transition-colors">
                <textarea ref={commentInputRef} value={commentText} aria-label="댓글 쓰기"
                  rows={1}
                  onChange={e => { setCommentText(e.target.value); autoResize(e.target); }}
                  onKeyDown={e => (e.ctrlKey || e.metaKey) && e.key === "Enter" && (e.preventDefault(), submitComment())}
                  placeholder="댓글을 입력하세요..."
                  maxLength={BODY_MAX}
                  className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-dim focus:outline-none resize-none overflow-hidden leading-relaxed min-h-[20px]" />
                <button onClick={submitComment} disabled={submittingComment || !commentText.trim()} aria-label="댓글 올리기"
                  className="shrink-0 mb-0.5 transition-all active:scale-90 disabled:opacity-40">
                  <Send size={16} className={commentText.trim() ? "text-accent-blue" : "text-text-dim"} />
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => navigate("/login")}
              className="w-full flex items-center gap-3 bg-bg-elevated border border-border rounded-[22px] px-4 py-2.5 hover:border-accent-blue/40 transition-colors">
              <PenLine size={13} className="text-text-dim shrink-0" />
              <span className="text-sm text-text-dim">로그인 후 댓글 작성</span>
            </button>
          )}
        </div>
      </div>
      {/* 휴대폰 — 입력칸(fixed)에 가리지 않게 마지막 댓글 아래를 그만큼 비운다 */}
      {!넓음 && <div aria-hidden className="h-16" />}
    </div>
    {신고중 && (
      <신고창 무엇="글" 대상={(activePost.title || activePost.body || "").slice(0, 60)} 닫기={() => set신고중(false)}
        보내기={(사유) => 신고보내기(() => communityApi.reportPost(activePost.id, 사유), "글", 보이기)} />
    )}
    {크게볼사진 && <사진보기 주소={크게볼사진} 닫기={() => set크게볼사진(null)} />}
    {확인화면}
    {알림화면}
    </>
  );
}
