import { useState, useRef, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Heart, MessageSquare, Share2, Send, Trash2, Eye, PenLine, Pencil, X,
  Hash, BarChart2, Image as ImageIcon, Flag,
} from "lucide-react";
import { communityApi } from "@/api/stocks";
import api from "@/api/client";
import { useAuthStore } from "@/store/authStore";
import PortfolioSnapshot from "@/components/portfolio/PortfolioSnapshot";
import AvatarComponent from "@/components/community/Avatar";

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

interface Comment {
  id: number; parent_id: number | null; user_id: number; username: string;
  avatar_color: number; avatar_url?: string | null; content: string;
  like_count: number; liked: boolean; created_at: string; is_mine: boolean; replies: Comment[];
}

function ReplyItem({ reply, postId, uid, isLoggedIn, queryKey }: {
  reply: Comment; postId: number; uid?: number; isLoggedIn: boolean; queryKey: any[];
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [liked, setLiked] = useState(reply.liked);
  const [likeCount, setLikeCount] = useState(reply.like_count);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [saving, setSaving] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [submittingReport, setSubmittingReport] = useState(false);

  const handleReport = async () => {
    const reason = reportReason.trim();
    if (!reason || submittingReport) return;
    setSubmittingReport(true);
    try {
      await communityApi.reportComment(reply.id, reason);
      setShowReport(false);
      setReportReason("");
      alert("신고가 접수되었습니다");
    } catch (e: any) {
      if (e?.response?.status === 409) alert("이미 신고한 댓글입니다");
    } finally { setSubmittingReport(false); }
  };

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

  return (
    <div className="flex gap-2">
      <AvatarComponent username={reply.username} colorIndex={reply.avatar_color} avatarUrl={reply.avatar_url}
        userId={reply.user_id} isMine={uid != null && reply.user_id === uid} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
          <Link to={uid != null && reply.user_id === uid ? "/mypage" : `/profile/${reply.user_id}`}
            className="text-xs font-semibold text-text-primary hover:text-accent-blue transition-colors">
            {reply.username}
          </Link>
          <span className="text-2xs text-text-dim">·</span>
          <span className="text-2xs text-text-dim">{timeAgo(reply.created_at)}</span>
        </div>
        {isEditing ? (
          <div className="flex flex-col gap-1.5 mt-1">
            <textarea autoFocus value={editText} rows={2}
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
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3 mt-1.5">
              <button onClick={handleLike}
                className={`flex items-center gap-1 text-xs transition-all active:scale-90 ${liked ? "text-accent-red" : "text-text-dim hover:text-accent-red"}`}>
                <Heart size={10} className={liked ? "fill-accent-red" : ""} />
                {likeCount > 0 ? <span className={liked ? "font-semibold" : ""}>{likeCount}</span> : <span className="opacity-50">좋아요</span>}
              </button>
              {reply.is_mine ? (<>
                <button onClick={startEdit} className="text-xs text-text-dim hover:text-accent-blue transition-colors">수정</button>
                <button onClick={handleDelete} className="text-xs text-text-dim hover:text-accent-red transition-colors">삭제</button>
              </>) : isLoggedIn && (
                <button onClick={() => setShowReport(v => !v)}
                  className={`flex items-center gap-0.5 text-xs transition-colors ${showReport ? "text-accent-red" : "text-text-dim hover:text-accent-red"}`}>
                  <Flag size={9} />신고
                </button>
              )}
            </div>
            {showReport && (
              <div className="flex items-center gap-1.5 mt-1">
                <input value={reportReason} onChange={e => setReportReason(e.target.value)}
                  placeholder="신고 사유를 입력하세요" maxLength={200}
                  className="flex-1 bg-bg-elevated border border-border rounded-lg px-2 py-1 text-xs text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-red/50" />
                <button onClick={handleReport} disabled={submittingReport || !reportReason.trim()}
                  className="text-xs px-2 py-1 bg-accent-red/90 text-white rounded-lg disabled:opacity-40">{submittingReport ? "..." : "신고"}</button>
                <button onClick={() => { setShowReport(false); setReportReason(""); }} className="text-xs text-text-dim hover:text-text-primary">취소</button>
              </div>
            )}
          </div>
        )}
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
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [submittingReport, setSubmittingReport] = useState(false);

  const handleReport = async () => {
    const reason = reportReason.trim();
    if (!reason || submittingReport) return;
    setSubmittingReport(true);
    try {
      await communityApi.reportComment(comment.id, reason);
      setShowReport(false);
      setReportReason("");
      alert("신고가 접수되었습니다");
    } catch (e: any) {
      if (e?.response?.status === 409) alert("이미 신고한 댓글입니다");
    } finally { setSubmittingReport(false); }
  };

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
      <AvatarComponent username={comment.username} colorIndex={comment.avatar_color} avatarUrl={comment.avatar_url}
        userId={comment.user_id} isMine={uid != null && comment.user_id === uid} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
          <Link to={uid != null && comment.user_id === uid ? "/mypage" : `/profile/${comment.user_id}`}
            className="text-sm font-semibold text-text-primary hover:text-accent-blue transition-colors">
            {comment.username}
          </Link>
          <span className="text-2xs text-text-dim">·</span>
          <span className="text-2xs text-text-dim">{timeAgo(comment.created_at)}</span>
        </div>
        {isEditing ? (
          <div className="flex flex-col gap-1.5 mt-1 mb-2">
            <textarea autoFocus value={editText} rows={3}
              onChange={e => setEditText(e.target.value)}
              className="w-full bg-bg-elevated border border-accent-blue/50 rounded-xl px-3 py-2 text-sm text-text-secondary focus:outline-none resize-none" />
            <div className="flex gap-2">
              <button onClick={saveEdit} disabled={savingEdit}
                className="text-xs px-2.5 py-1 bg-accent-blue text-white rounded-lg disabled:opacity-50">{savingEdit ? "저장 중" : "저장"}</button>
              <button onClick={() => setIsEditing(false)} className="text-xs px-2.5 py-1 text-text-dim hover:text-text-primary border border-border rounded-lg">취소</button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap break-words mb-2">{comment.content}</p>
        )}
        {!isEditing && (
          <div className="flex flex-col gap-1">
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
              {comment.is_mine ? (<>
                <button onClick={startEdit} className="text-xs text-text-dim hover:text-accent-blue transition-colors">수정</button>
                <button onClick={handleDelete} className="text-xs text-text-dim hover:text-accent-red transition-colors">삭제</button>
              </>) : isLoggedIn && (
                <button onClick={() => setShowReport(v => !v)}
                  className={`flex items-center gap-0.5 text-xs transition-colors ${showReport ? "text-accent-red" : "text-text-dim hover:text-accent-red"}`}>
                  <Flag size={10} />신고
                </button>
              )}
            </div>
            {showReport && (
              <div className="flex items-center gap-1.5 mt-1">
                <input value={reportReason} onChange={e => setReportReason(e.target.value)}
                  placeholder="신고 사유를 입력하세요" maxLength={200}
                  className="flex-1 bg-bg-elevated border border-border rounded-lg px-2.5 py-1 text-xs text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-red/50" />
                <button onClick={handleReport} disabled={submittingReport || !reportReason.trim()}
                  className="text-xs px-2.5 py-1 bg-accent-red/90 text-white rounded-lg disabled:opacity-40">{submittingReport ? "..." : "신고"}</button>
                <button onClick={() => { setShowReport(false); setReportReason(""); }} className="text-xs text-text-dim hover:text-text-primary">취소</button>
              </div>
            )}
          </div>
        )}
        {showReply && (
          <div className="mt-2 flex items-end gap-2">
            <div className="flex-1 flex items-end gap-2 bg-bg-elevated border border-border rounded-[22px] px-3.5 py-2 focus-within:border-accent-blue/50 transition-colors">
              <textarea autoFocus value={replyText} rows={1}
                onChange={e => {
                  setReplyText(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = Math.min(e.target.scrollHeight, 80) + "px";
                }}
                onKeyDown={e => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), submitReply())}
                placeholder="답글을 입력하세요..." maxLength={500}
                className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-dim focus:outline-none resize-none overflow-hidden leading-relaxed min-h-[20px]" />
              <button onClick={submitReply} disabled={submitting}
                className="shrink-0 mb-0.5 transition-all active:scale-90">
                {replyText.trim()
                  ? <Send size={15} className={`text-accent-blue ${submitting ? "opacity-40" : ""}`} />
                  : <PenLine size={15} className="text-text-dim" />}
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
  const commentInputRef = useRef<HTMLTextAreaElement>(null);
  const [showPostReport, setShowPostReport] = useState(false);
  const [postReportReason, setPostReportReason] = useState("");
  const [submittingPostReport, setSubmittingPostReport] = useState(false);

  const autoResize = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }, []);

  const { data: post, isLoading: postLoading } = useQuery<any>({
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

  const handlePostReport = async () => {
    const reason = postReportReason.trim();
    if (!reason || submittingPostReport || !activePost) return;
    setSubmittingPostReport(true);
    try {
      await communityApi.reportPost(activePost.id, reason);
      setShowPostReport(false);
      setPostReportReason("");
      alert("신고가 접수되었습니다");
    } catch (e: any) {
      if (e?.response?.status === 409) alert("이미 신고한 게시글입니다");
    } finally { setSubmittingPostReport(false); }
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
    if (commentInputRef.current) { commentInputRef.current.style.height = "auto"; }
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
            <AvatarComponent username={activePost.username} colorIndex={activePost.avatar_color}
              avatarUrl={activePost.avatar_url} userId={activePost.user_id} isMine={activePost.is_mine} size="lg" />
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
              <div className="flex items-center gap-1">
                <button onClick={startEdit} className="p-1.5 text-text-dim hover:text-accent-blue transition-colors rounded-lg hover:bg-bg-elevated">
                  <Pencil size={15} />
                </button>
                <button onClick={handleDelete} className="p-1.5 text-text-dim hover:text-accent-red transition-colors rounded-lg hover:bg-bg-elevated">
                  <Trash2 size={15} />
                </button>
              </div>
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
              <input value={editTitle} onChange={e => setEditTitle(e.target.value)}
                placeholder="제목 (선택사항)" maxLength={100}
                className="w-full bg-transparent border-none text-sm font-semibold text-text-primary placeholder:text-text-dim focus:outline-none" />
              <div className="h-px bg-border/50" />
              <textarea ref={editBodyRef} value={editBody}
                onChange={e => { setEditBody(e.target.value); const el = e.target; el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; }}
                placeholder="의견을 입력하세요..." maxLength={5000}
                className="w-full bg-transparent border-none text-sm text-text-primary placeholder:text-text-dim resize-none focus:outline-none leading-relaxed"
                style={{ minHeight: "5rem" }} />

              {/* 이미지 미리보기 */}
              {editImage && (
                <div className="relative w-full">
                  <img src={editImage} alt="미리보기" className="w-full max-h-48 object-cover rounded-xl" />
                  <button onClick={() => setEditImage("")}
                    className="absolute top-1.5 right-1.5 p-1 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors">
                    <X size={12} />
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
                    <button onClick={() => setEditShowPoll(false)} className="text-text-dim hover:text-accent-red transition-colors"><X size={13} /></button>
                  </div>
                  <input value={editPollQuestion} onChange={e => setEditPollQuestion(e.target.value)}
                    placeholder="투표 질문을 입력하세요" maxLength={100}
                    className="w-full px-2.5 py-1.5 bg-bg-elevated border border-border rounded-lg text-xs text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-blue/50" />
                  {editPollOptions.map((opt, i) => (
                    <div key={i} className="flex gap-1.5">
                      <input value={opt}
                        onChange={e => { const n = [...editPollOptions]; n[i] = e.target.value; setEditPollOptions(n); }}
                        placeholder={`선택지 ${i + 1}`} maxLength={50}
                        className="flex-1 px-2.5 py-1.5 bg-bg-elevated border border-border rounded-lg text-xs text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-blue/50" />
                      {editPollOptions.length > 2 && (
                        <button onClick={() => setEditPollOptions(prev => prev.filter((_, j) => j !== i))} className="text-text-dim hover:text-accent-red"><X size={12} /></button>
                      )}
                    </div>
                  ))}
                  {editPollOptions.length < 4 && (
                    <button onClick={() => setEditPollOptions(prev => [...prev, ""])} className="text-xs text-accent-blue hover:underline text-left">+ 옵션 추가</button>
                  )}
                </div>
              )}

              {/* 태그 UI */}
              {editShowTagSearch && (
                <div className="bg-bg-card rounded-xl p-3 flex flex-col gap-2 border border-border/50">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-text-primary">종목 태그</span>
                    <button onClick={() => { setEditShowTagSearch(false); setEditTagQuery(""); setEditTagResults([]); }} className="text-text-dim hover:text-accent-red"><X size={13} /></button>
                  </div>
                  {editTags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {editTags.map(t => (
                        <span key={t.symbol} className="flex items-center gap-1 text-2xs px-1.5 py-0.5 rounded bg-accent-blue/15 text-accent-blue">
                          #{t.market === "KR" && t.name ? t.name : t.symbol}
                          <button onClick={() => setEditTags(prev => prev.filter(x => x.symbol !== t.symbol))}><X size={10} /></button>
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
                        <div className="absolute z-10 w-full mt-1 bg-bg-card border border-border rounded-xl shadow-lg max-h-36 overflow-y-auto">
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
                  <button onClick={() => editFileInputRef.current?.click()} title="사진 첨부"
                    className={`p-1.5 rounded-lg transition-all ${editImage ? "text-accent-blue bg-accent-blue/10" : "text-text-dim hover:text-text-primary hover:bg-bg-elevated"}`}>
                    <ImageIcon size={14} />
                  </button>
                  {!activePost.poll && (
                    <button onClick={() => setEditShowPoll(v => !v)} title="투표 만들기"
                      className={`p-1.5 rounded-lg transition-all ${editShowPoll ? "text-accent-blue bg-accent-blue/10" : "text-text-dim hover:text-text-primary hover:bg-bg-elevated"}`}>
                      <BarChart2 size={14} />
                    </button>
                  )}
                  <button onClick={() => setEditShowTagSearch(v => !v)} title="종목 태그"
                    className={`p-1.5 rounded-lg transition-all ${(editShowTagSearch || editTags.length > 0) ? "text-accent-blue bg-accent-blue/10" : "text-text-dim hover:text-text-primary hover:bg-bg-elevated"}`}>
                    <Hash size={14} />
                  </button>
                  <span className="text-2xs text-text-dim ml-1">{editBody.length}/5000</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={cancelEdit}
                    className="px-3 py-1.5 rounded-xl text-xs text-text-dim hover:text-text-primary border border-border hover:bg-bg-elevated transition-colors">취소</button>
                  <button onClick={saveEdit} disabled={savingEdit}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-accent-blue text-white text-xs font-semibold hover:bg-accent-blue/90 disabled:opacity-50 transition-all">
                    <Send size={12} />{savingEdit ? "저장 중..." : "저장"}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
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
                  #{(t as any).market === "KR" && (t as any).name ? (t as any).name : t.symbol}
                </Link>
              ))}
            </div>
          )}

          {/* 포트폴리오 */}
          {activePost.portfolio?.length > 0 && (
            <PortfolioSnapshot items={activePost.portfolio} />
          )}
            </>
          )}

          {/* 액션 바 */}
          <div className="flex flex-col gap-2 py-3 border-t border-border/50">
            <div className="flex items-center gap-1">
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
              <div className="flex items-center gap-1 ml-auto">
                {!activePost.is_mine && isLoggedIn && (
                  <button onClick={() => setShowPostReport(v => !v)}
                    className={`flex items-center gap-1 px-3 py-2 rounded-xl text-sm font-medium transition-all ${
                      showPostReport ? "text-accent-red bg-accent-red/10" : "text-text-dim hover:text-accent-red hover:bg-accent-red/5"
                    }`}>
                    <Flag size={15} />
                  </button>
                )}
                <button onClick={handleShare}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium text-text-dim hover:text-text-primary hover:bg-bg-elevated transition-all">
                  <Share2 size={15} />
                  <span>{copied ? "복사됨!" : "공유"}</span>
                </button>
              </div>
            </div>
            {showPostReport && (
              <div className="flex items-center gap-2">
                <input value={postReportReason} onChange={e => setPostReportReason(e.target.value)}
                  placeholder="신고 사유를 입력하세요" maxLength={200}
                  className="flex-1 bg-bg-elevated border border-border rounded-xl px-3 py-2 text-sm text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-red/50" />
                <button onClick={handlePostReport} disabled={submittingPostReport || !postReportReason.trim()}
                  className="text-sm px-3 py-2 bg-accent-red/90 text-white rounded-xl disabled:opacity-40 whitespace-nowrap">{submittingPostReport ? "..." : "신고"}</button>
                <button onClick={() => { setShowPostReport(false); setPostReportReason(""); }}
                  className="text-sm px-3 py-2 text-text-dim hover:text-text-primary border border-border rounded-xl">취소</button>
              </div>
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
                  <button key={s} onClick={() => setCommentSort(s)}
                    className={`text-2xs px-2.5 py-1 rounded-md transition-all font-medium ${
                      commentSort === s ? "bg-bg-card text-text-primary shadow-sm" : "text-text-dim hover:text-text-secondary"
                    }`}>
                    {s === "latest" ? "최신순" : "인기순"}
                  </button>
                ))}
              </div>
            </div>

            {/* 댓글 입력 pill — 댓글 숫자 바로 아래 */}
            {isLoggedIn ? (
              <div className="flex items-end gap-2.5">
                <div className="w-6 h-6 rounded-full bg-accent-blue/20 border border-accent-blue/30 flex items-center justify-center text-xs font-bold text-accent-blue shrink-0">
                  {(myUsername ?? "?")[0]?.toUpperCase()}
                </div>
                <div className="flex-1 flex items-end gap-2 bg-bg-elevated border border-border rounded-[22px] px-3.5 py-2 focus-within:border-accent-blue/50 transition-colors">
                  <textarea ref={commentInputRef} value={commentText}
                    rows={1}
                    onChange={e => { setCommentText(e.target.value); autoResize(e.target); }}
                    onKeyDown={e => (e.ctrlKey || e.metaKey) && e.key === "Enter" && (e.preventDefault(), submitComment())}
                    placeholder="댓글을 입력하세요..."
                    maxLength={5000}
                    className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-dim focus:outline-none resize-none overflow-hidden leading-relaxed min-h-[20px]" />
                  <button onClick={submitComment} disabled={submittingComment}
                    className="shrink-0 mb-0.5 transition-all active:scale-90">
                    {commentText.trim()
                      ? <Send size={16} className={`text-accent-blue ${submittingComment ? "opacity-40" : ""}`} />
                      : <PenLine size={16} className="text-text-dim" />}
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
    </div>
  );
}
