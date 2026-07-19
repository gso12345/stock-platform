import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, Link } from "react-router-dom";
import {
  Heart, MessageSquare, ArrowUpDown, RefreshCw, Rss, AlertCircle, Users, Share2,
  PenSquare, Hash, BarChart2, X, Trash2, Image as ImageIcon, Send, LogIn, Eye,
} from "lucide-react";
import { communityApi, portfolioApi } from "@/api/stocks";
import { useAuthStore } from "@/store/authStore";
import PostDetailModal from "@/components/community/PostDetailModal";
import api from "@/api/client";
import PortfolioSnapshot from "@/components/portfolio/PortfolioSnapshot";
import PortfolioChart, { type PfPortfolioForChart } from "@/components/portfolio/PortfolioChart";

type SortType = "latest" | "likes";
type MarketFilter = "ALL" | "KR" | "US" | "ETF";
type FeedType = "all" | "following";

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
  KR:  "bg-blue-500/15 text-blue-400 border-blue-500/20",
  US:  "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  ETF: "bg-purple-500/15 text-purple-400 border-purple-500/20",
};

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

interface PollData {
  question: string;
  options: string[];
  counts: number[];
  total: number;
  my_vote: number | null;
}

interface FeedPost {
  id: number;
  symbol: string;
  market: string;
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

function FeedCard({
  post,
  onLike,
  onVote,
  onOpen,
  onDelete,
  queryKey,
  qc,
}: {
  post: FeedPost;
  onLike: (id: number) => void;
  onVote: (postId: number, optionIndex: number) => void;
  onOpen: (post: FeedPost) => void;
  onDelete: (id: number) => void;
  queryKey: any[];
  qc: ReturnType<typeof useQueryClient>;
}) {
  const { isLoggedIn } = useAuthStore();
  const navigate = useNavigate();
  const badgeCls = MARKET_BADGE[post.market] ?? MARKET_BADGE.KR;
  const avatarCls = AVATAR_COLORS[post.avatar_color % AVATAR_COLORS.length];
  const [copied, setCopied] = useState(false);

  const handleShare = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const url = `${window.location.origin}/stocks/${post.market}/${post.symbol}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div
      className="bg-bg-card border border-border rounded-2xl p-4 hover:border-accent-blue/30 transition-colors cursor-pointer"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button, a, input, textarea")) return;
        onOpen(post);
      }}
    >
      <div className="flex gap-3">
        {/* 아바타 */}
        <Link to={post.is_mine ? "/mypage" : `/profile/${post.user_id}`}>
          <div
            className={`w-7 h-7 rounded-full border flex items-center justify-center font-bold text-xs shrink-0 ${avatarCls}`}
          >
            {post.username[0]?.toUpperCase()}
          </div>
        </Link>

        <div className="flex-1 min-w-0">
          {/* 헤더: 유저·시간·종목 */}
          <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
            <Link
              to={post.is_mine ? "/mypage" : `/profile/${post.user_id}`}
              className="text-xs font-semibold text-text-primary hover:text-accent-blue transition-colors"
            >
              {post.username}
            </Link>
            <span className="text-2xs text-text-dim">·</span>
            <span className="text-2xs text-text-dim">{timeAgo(post.created_at)}</span>
            <span className="ml-auto flex items-center gap-1.5">
              <span className={`text-2xs font-bold px-1.5 py-0.5 rounded border ${badgeCls}`}>
                {post.market}
              </span>
              <Link
                to={`/stocks/${post.market}/${post.symbol}`}
                className="text-2xs font-semibold text-accent-blue hover:underline"
              >
                {post.symbol}
              </Link>
              {post.is_mine && (
                <button
                  onClick={(e) => { e.stopPropagation(); if (confirm("게시글을 삭제할까요?")) onDelete(post.id); }}
                  className="p-0.5 rounded text-text-dim hover:text-accent-red transition-colors"
                >
                  <Trash2 size={11} />
                </button>
              )}
            </span>
          </div>

          {/* 제목 */}
          {post.title && (
            <p className="text-sm font-semibold text-text-primary mb-0.5">{post.title}</p>
          )}

          {/* 본문 (최대 3줄) */}
          <p className="text-sm text-text-secondary leading-relaxed line-clamp-3 break-words mb-2">
            {post.body}
          </p>

          {/* 첨부 이미지 */}
          {post.image && (
            <img
              src={post.image}
              alt="첨부 이미지"
              className="w-full max-h-48 object-cover rounded-xl mb-2"
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
                    disabled={voted || !isLoggedIn}
                    className={`relative w-full text-left px-3 py-1.5 rounded-lg border text-xs overflow-hidden transition-all ${
                      isChosen ? "border-accent-blue/50" : "border-border hover:border-accent-blue/30"
                    }`}
                  >
                    {voted && (
                      <div
                        className={`absolute inset-0 rounded-lg ${isChosen ? "bg-accent-blue/25" : "bg-accent-blue/10"}`}
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

          {/* 하단 액션 */}
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
              className="flex items-center gap-1.5 text-xs text-text-dim hover:text-accent-blue transition-colors"
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

            {!(post.portfolio && post.portfolio.length > 0) && (
              <Link
                to={`/stocks/${post.market}/${post.symbol}`}
                className="ml-auto text-2xs text-text-dim hover:text-accent-blue transition-colors"
              >
                종목 보기 →
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function FeedWritePanel({ onSubmitted }: { onSubmitted: () => void }) {
  const { isLoggedIn, username, userId } = useAuthStore();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"stock" | "portfolio">("stock");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // stock mode
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedStock, setSelectedStock] = useState<{ symbol: string; market: string; name: string } | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  // portfolio mode
  const [portfolios, setPortfolios] = useState<any[]>([]);
  const [selectedPfId, setSelectedPfId] = useState<number | null>(null);
  const [pfItems, setPfItems] = useState<any[]>([]);
  const [loadingPf, setLoadingPf] = useState(false);

  // common
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // 사진/투표/태그
  const [image, setImage] = useState("");
  const [showPoll, setShowPoll] = useState(false);
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptions, setPollOptions] = useState(["", ""]);
  const [showTagSearch, setShowTagSearch] = useState(false);
  const [tagQuery, setTagQuery] = useState("");
  const [tagResults, setTagResults] = useState<any[]>([]);
  const [customTags, setCustomTags] = useState<{ symbol: string; market: string }[]>([]);
  const [tagSearchTimeout, setTagSearchTimeout] = useState<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode === "portfolio" && portfolios.length === 0 && open) {
      setLoadingPf(true);
      portfolioApi.getPortfolios()
        .then((pfs: any[]) => {
          setPortfolios(pfs);
          if (pfs.length > 0) setSelectedPfId(pfs[0].id);
        })
        .finally(() => setLoadingPf(false));
    }
  }, [mode, open]);

  useEffect(() => {
    if (selectedPfId == null) return;
    portfolioApi.getItems(selectedPfId).then((items: any[]) => {
      setPfItems(items);
    });
  }, [selectedPfId]);

  useEffect(() => {
    if (!searchQ.trim()) { setSearchResults([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const { data } = await api.get<{ results: any[] }>("/search", { params: { q: searchQ } });
        setSearchResults((data.results || []).slice(0, 6));
      } catch { setSearchResults([]); }
      finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [searchQ]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchResults([]);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const autoResize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  const reset = () => {
    setOpen(false);
    setMode("stock");
    setSearchQ("");
    setSearchResults([]);
    setSelectedStock(null);
    setSelectedPfId(null);
    setPfItems([]);
    setPortfolios([]);
    setTitle("");
    setBody("");
    setError("");
    setImage("");
    setShowPoll(false);
    setPollQuestion("");
    setPollOptions(["", ""]);
    setShowTagSearch(false);
    setTagQuery("");
    setTagResults([]);
    setCustomTags([]);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const handleImagePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try { setImage(await compressImage(file)); } catch {}
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
      } catch { setTagResults([]); }
    }, 300);
    setTagSearchTimeout(t);
  };

  const addCustomTag = (tag: { symbol: string; market: string }) => {
    if (customTags.length >= 5) return;
    if (!customTags.find((t) => t.symbol === tag.symbol && t.market === tag.market)) {
      setCustomTags((prev) => [...prev, { symbol: tag.symbol, market: tag.market }]);
    }
    setTagQuery("");
    setTagResults([]);
  };

  // Portfolio chart for write panel preview
  const pfForChart: PfPortfolioForChart[] = pfItems.length > 0 ? [{
    id: selectedPfId ?? 0,
    name: "포트폴리오",
    items: pfItems.map((item: any) => ({
      symbol: item.symbol,
      market: item.market,
      name: item.name || item.symbol,
      avgPrice: item.avgPrice ?? 0,
      shares: item.shares,
      currency: item.currency,
      inputExchangeRate: item.inputExchangeRate ?? null,
    })),
  }] : [];

  // Avatar color from username (same algorithm as CommunityTab)
  const myColorIndex = (() => {
    const u = username ?? "";
    let h = 0;
    for (let i = 0; i < u.length; i++) h = (h * 31 + u.charCodeAt(i)) % AVATAR_COLORS.length;
    return h;
  })();

  const handleSubmit = async () => {
    if (submitting) return;
    setError("");

    let market: string, symbol: string, allTags: { symbol: string; market: string }[], bodyToSubmit: string;

    if (mode === "stock") {
      if (!selectedStock) { setError("종목을 선택해주세요"); return; }
      const bodyTrim = body.trim();
      if (!bodyTrim) { setError("본문을 입력해주세요"); return; }
      market = selectedStock.market;
      symbol = selectedStock.symbol;
      allTags = customTags;
      bodyToSubmit = bodyTrim;
    } else {
      if (pfItems.length === 0) { setError("포트폴리오에 종목이 없습니다"); return; }
      market = pfItems[0].market;
      symbol = pfItems[0].symbol;
      allTags = [
        ...pfItems.map((i: any) => ({ symbol: i.symbol, market: i.market })),
        ...customTags.filter((ct) => !pfItems.find((i: any) => i.symbol === ct.symbol)),
      ];
      bodyToSubmit = body.trim() || "📊 포트폴리오 공유";
    }

    const pollData = showPoll && pollQuestion.trim() && pollOptions.filter((o) => o.trim()).length >= 2
      ? { question: pollQuestion.trim(), options: pollOptions.filter((o) => o.trim()) }
      : null;

    setSubmitting(true);
    try {
      const portfolioSnapshot = mode === "portfolio"
        ? pfItems.map((i: any) => ({
            symbol: i.symbol,
            market: i.market,
            name: i.name || i.symbol,
            shares: i.shares,
            avg_price: i.avgPrice ?? i.avg_price ?? 0,
            currency: i.currency ?? "KRW",
            input_exchange_rate: i.inputExchangeRate ?? null,
          }))
        : null;
      await communityApi.createPost(market, symbol, title.trim(), bodyToSubmit, image, pollData, allTags, portfolioSnapshot);
      reset();
      onSubmitted();
    } catch {
      setError("게시글 작성에 실패했습니다. 다시 시도해주세요.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!isLoggedIn) {
    return (
      <div className="bg-bg-card border border-border rounded-2xl overflow-hidden">
        <button onClick={() => navigate("/login")} className="w-full flex items-center justify-center gap-2.5 py-5 text-sm text-text-muted hover:text-accent-blue hover:bg-accent-blue/5 transition-all">
          <LogIn size={15} />
          로그인하고 의견 남기기
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="bg-bg-card border border-border rounded-2xl overflow-hidden">
        <button
          onClick={() => setOpen(true)}
          className="w-full flex items-center gap-3 px-4 py-4 text-left hover:bg-bg-elevated transition-all group"
        >
          <div className={`w-7 h-7 rounded-full border flex items-center justify-center font-bold text-xs shrink-0 ${AVATAR_COLORS[myColorIndex]}`}>
            {(username ?? "?")[0]?.toUpperCase()}
          </div>
          <span className="flex-1 text-sm text-text-dim group-hover:text-text-secondary transition-colors">
            종목 의견이나 포트폴리오를 공유해보세요...
          </span>
          <PenSquare size={14} className="text-text-dim group-hover:text-accent-blue transition-colors shrink-0" />
        </button>
      </div>
    );
  }

  const canSubmit = mode === "stock" ? !!(selectedStock && body.trim()) : pfItems.length > 0;

  return (
    <div className="bg-bg-card border border-border rounded-2xl overflow-hidden">
      {/* 모드 탭 + 닫기 */}
      <div className="flex items-center justify-between border-b border-border px-3 pt-2 pb-0">
        <div className="flex">
          <button
            onClick={() => { setMode("stock"); setBody(""); setSelectedStock(null); }}
            className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 -mb-px transition-all ${
              mode === "stock" ? "border-accent-blue text-accent-blue" : "border-transparent text-text-muted hover:text-text-primary"
            }`}
          >
            <Hash size={11} />종목 의견
          </button>
          <button
            onClick={() => { setMode("portfolio"); setBody(""); setSelectedStock(null); }}
            className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 -mb-px transition-all ${
              mode === "portfolio" ? "border-accent-blue text-accent-blue" : "border-transparent text-text-muted hover:text-text-primary"
            }`}
          >
            <BarChart2 size={11} />포트폴리오 공유
          </button>
        </div>
        <button onClick={reset} className="p-1.5 text-text-dim hover:text-text-primary transition-colors mb-1">
          <X size={14} />
        </button>
      </div>

      <div className="p-4 flex flex-col gap-2.5">
        {/* 종목 선택 */}
        {mode === "stock" && (
          <div className="relative" ref={searchRef}>
            {selectedStock ? (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-accent-blue/15 border border-accent-blue/30 text-xs font-semibold text-accent-blue">
                  <span className="text-text-dim">[{selectedStock.market}]</span>
                  {selectedStock.symbol}
                  {selectedStock.name && selectedStock.name !== selectedStock.symbol && (
                    <span className="text-accent-blue/70 font-normal">{selectedStock.name}</span>
                  )}
                  <button onClick={() => setSelectedStock(null)} className="ml-0.5 hover:text-accent-red transition-colors">
                    <X size={10} />
                  </button>
                </span>
                <span className="text-xs text-text-dim">에 대한 의견</span>
              </div>
            ) : (
              <>
                <input
                  autoFocus
                  value={searchQ}
                  onChange={(e) => setSearchQ(e.target.value)}
                  placeholder="종목 검색 (예: 삼성전자, AAPL)"
                  className="w-full px-3 py-2 bg-bg-elevated border border-border rounded-xl text-sm text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-blue/50"
                />
                {(searchResults.length > 0 || searching) && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-bg-card border border-border rounded-xl shadow-lg z-20 overflow-hidden">
                    {searching && searchResults.length === 0 && <div className="px-3 py-2 text-xs text-text-dim">검색 중...</div>}
                    {searchResults.map((r: any, i: number) => (
                      <button
                        key={i}
                        onClick={() => {
                          setSelectedStock({ symbol: r.symbol, market: r.market, name: r.name || r.symbol });
                          setSearchQ("");
                          setSearchResults([]);
                          setCustomTags(prev => prev.find(t => t.symbol === r.symbol && t.market === r.market) ? prev : [{ symbol: r.symbol, market: r.market }, ...prev]);
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-bg-elevated transition-colors flex items-center gap-2"
                      >
                        <span className="text-2xs font-bold text-text-dim w-8">{r.market}</span>
                        <span className="text-sm font-semibold text-text-primary">{r.symbol}</span>
                        <span className="text-xs text-text-dim truncate flex-1">{r.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* 포트폴리오 선택 */}
        {mode === "portfolio" && (
          <div className="flex flex-col gap-2">
            {loadingPf ? (
              <p className="text-xs text-text-dim">포트폴리오 불러오는 중...</p>
            ) : portfolios.length === 0 ? (
              <p className="text-xs text-text-dim">등록된 포트폴리오가 없습니다</p>
            ) : (
              <select
                value={selectedPfId ?? ""}
                onChange={(e) => { const id = Number(e.target.value); setSelectedPfId(id); setPfItems([]); }}
                className="px-3 py-2 bg-bg-elevated border border-border rounded-xl text-sm text-text-primary focus:outline-none focus:border-accent-blue/50"
              >
                {portfolios.map((pf: any) => (
                  <option key={pf.id} value={pf.id}>{pf.name} ({pf.count}개 종목)</option>
                ))}
              </select>
            )}
          </div>
        )}

        {/* 아바타 + 입력 */}
        <div className="flex gap-3">
          <div className={`w-7 h-7 rounded-full border flex items-center justify-center font-bold text-xs shrink-0 mt-0.5 ${AVATAR_COLORS[myColorIndex]}`}>
            {(username ?? "?")[0]?.toUpperCase()}
          </div>
          <div className="flex-1 flex flex-col gap-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="제목 (선택사항)"
              maxLength={100}
              className="w-full px-0 py-0 bg-transparent border-none text-sm font-semibold text-text-primary placeholder:text-text-dim focus:outline-none"
            />
            <div className="h-px bg-border/50" />
            <textarea
              ref={textareaRef}
              value={body}
              onChange={(e) => { setBody(e.target.value); autoResize(); }}
              onFocus={() => { fetch(`${import.meta.env.VITE_API_URL || ""}/api/v1/dashboard/indices`).catch(() => {}); }}
              placeholder={mode === "portfolio" ? "포트폴리오에 대한 설명을 입력하세요... (선택사항)" : "의견을 입력하세요..."}
              maxLength={5000}
              className="w-full px-0 py-0 bg-transparent border-none text-sm text-text-primary placeholder:text-text-dim resize-none focus:outline-none leading-relaxed"
              style={{ minHeight: "2.5rem" }}
            />
            {/* 포트폴리오 차트 미리보기 — 본문 아래 */}
            {mode === "portfolio" && pfForChart.length > 0 && (
              <PortfolioChart portfolios={pfForChart} exchangeRate={1350} />
            )}
          </div>
        </div>

        {/* 사진 미리보기 */}
        {image && (
          <div className="relative w-full">
            <img src={image} alt="미리보기" className="w-full max-h-40 object-cover rounded-xl" />
            <button onClick={() => setImage("")} className="absolute top-1 right-1 p-1 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors">
              <X size={12} />
            </button>
          </div>
        )}

        {/* 투표 UI */}
        {showPoll && (
          <div className="bg-bg-elevated rounded-xl p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-text-primary">투표 만들기</span>
              <button onClick={() => setShowPoll(false)} className="text-text-dim hover:text-accent-red transition-colors"><X size={13} /></button>
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
                  onChange={(e) => { const next = [...pollOptions]; next[i] = e.target.value; setPollOptions(next); }}
                  placeholder={`선택지 ${i + 1}`}
                  maxLength={50}
                  className="flex-1 px-2.5 py-1.5 bg-bg-card border border-border rounded-lg text-xs text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-blue/50"
                />
                {pollOptions.length > 2 && (
                  <button onClick={() => setPollOptions((prev) => prev.filter((_, j) => j !== i))} className="text-text-dim hover:text-accent-red transition-colors">
                    <X size={12} />
                  </button>
                )}
              </div>
            ))}
            {pollOptions.length < 4 && (
              <button onClick={() => setPollOptions((prev) => [...prev, ""])} className="text-xs text-accent-blue hover:underline text-left">+ 옵션 추가</button>
            )}
          </div>
        )}

        {/* 태그 UI */}
        {showTagSearch && (
          <div className="bg-bg-elevated rounded-xl p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-text-primary">종목 태그</span>
              <button onClick={() => { setShowTagSearch(false); setTagQuery(""); setTagResults([]); }} className="text-text-dim hover:text-accent-red transition-colors"><X size={13} /></button>
            </div>
            {customTags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {customTags.map((t) => (
                  <span key={t.symbol} className="flex items-center gap-1 text-2xs px-1.5 py-0.5 rounded bg-accent-blue/15 text-accent-blue">
                    #{t.symbol}
                    <button onClick={() => setCustomTags((prev) => prev.filter((x) => x.symbol !== t.symbol))}><X size={10} /></button>
                  </span>
                ))}
              </div>
            )}
            {customTags.length < 5 && (
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
                        onClick={() => addCustomTag({ symbol: r.symbol, market: r.market })}
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

        {error && <p className="text-xs text-accent-red">{error}</p>}

        {/* 툴바 + 제출 */}
        <div className="flex items-center justify-between pt-1 border-t border-border/50">
          <div className="flex items-center gap-1">
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImagePick} />
            <button
              onClick={() => fileInputRef.current?.click()}
              title="사진 첨부"
              className={`p-1.5 rounded-lg transition-all ${image ? "text-accent-blue bg-accent-blue/10" : "text-text-dim hover:text-text-primary hover:bg-bg-elevated"}`}
            >
              <ImageIcon size={14} />
            </button>
            <button
              onClick={() => setShowPoll((v) => !v)}
              title="투표 만들기"
              className={`p-1.5 rounded-lg transition-all ${showPoll ? "text-accent-blue bg-accent-blue/10" : "text-text-dim hover:text-text-primary hover:bg-bg-elevated"}`}
            >
              <BarChart2 size={14} />
            </button>
            <button
              onClick={() => setShowTagSearch((v) => !v)}
              title="종목 태그"
              className={`p-1.5 rounded-lg transition-all ${(showTagSearch || customTags.length > 0) ? "text-accent-blue bg-accent-blue/10" : "text-text-dim hover:text-text-primary hover:bg-bg-elevated"}`}
            >
              <Hash size={14} />
            </button>
            <span className="text-2xs text-text-dim ml-1">{body.length}/5000</span>
          </div>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-accent-blue text-white text-xs font-semibold hover:bg-accent-blue/90 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            <Send size={12} />
            {submitting ? "등록 중..." : "의견 남기기"}
          </button>
        </div>
      </div>
    </div>
  );
}

const PAGE_SIZE = 20;

export default function Feed() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { isLoggedIn } = useAuthStore();
  const [feedType, setFeedType] = useState<FeedType>("all");
  const [sort, setSort] = useState<SortType>("latest");
  const [selectedPost, setSelectedPost] = useState<FeedPost | null>(null);
  const [marketFilter, setMarketFilter] = useState<MarketFilter>("ALL");
  const [page, setPage] = useState(1);

  const isFollowing = feedType === "following";
  const queryKey = ["feed", sort, marketFilter, page, feedType];

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey,
    queryFn: () =>
      communityApi.getFeed(
        page,
        sort,
        marketFilter === "ALL" ? undefined : marketFilter,
        isFollowing
      ),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const posts: FeedPost[] = data?.items ?? [];
  const total: number = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const likeMutation = useMutation({
    mutationFn: (postId: number) => communityApi.togglePostLike(postId),
    onMutate: async (postId) => {
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<any>(queryKey);
      if (prev) {
        qc.setQueryData(queryKey, {
          ...prev,
          items: prev.items.map((p: FeedPost) =>
            p.id === postId
              ? { ...p, liked: !p.liked, like_count: p.liked ? p.like_count - 1 : p.like_count + 1 }
              : p
          ),
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev);
    },
  });

  const voteMutation = useMutation({
    mutationFn: ({ postId, optionIndex }: { postId: number; optionIndex: number }) =>
      communityApi.votePoll(postId, optionIndex),
    onSuccess: (data, { postId }) => {
      qc.setQueryData(queryKey, (prev: any) => {
        if (!prev) return prev;
        return {
          ...prev,
          items: prev.items.map((p: FeedPost) =>
            p.id === postId && p.poll
              ? { ...p, poll: { ...p.poll, counts: data.counts, total: data.total, my_vote: data.my_vote } }
              : p
          ),
        };
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (post: FeedPost) => communityApi.deletePost(post.market, post.symbol, post.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["feed"] }),
  });

  const changeSort = (s: SortType) => { setSort(s); setPage(1); };
  const changeMarket = (m: MarketFilter) => { setMarketFilter(m); setPage(1); };
  const changeFeedType = (t: FeedType) => {
    if (t === "following" && !isLoggedIn) {
      navigate("/login");
      return;
    }
    setFeedType(t);
    setPage(1);
  };

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-5">
      {/* 헤더 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Rss size={18} className="text-accent-blue" />
            <h1 className="text-xl font-bold text-text-primary">커뮤니티 피드</h1>
          </div>
          <p className="text-xs text-text-dim mt-0.5">
            전체 종목의 최신 의견을 한 곳에서 확인하세요
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="p-1.5 text-text-dim hover:text-text-primary transition-colors"
          title="새로고침"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {/* 피드 타입 탭 */}
      <div className="flex gap-1 p-1 rounded-xl border border-border bg-bg-card w-fit">
        <button
          onClick={() => changeFeedType("all")}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            feedType === "all" ? "bg-accent-blue text-white shadow" : "text-text-muted hover:text-text-primary"
          }`}
        >
          <Rss size={11} />
          전체 피드
        </button>
        <button
          onClick={() => changeFeedType("following")}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            feedType === "following" ? "bg-accent-blue text-white shadow" : "text-text-muted hover:text-text-primary"
          }`}
        >
          <Users size={11} />
          팔로잉
        </button>
      </div>

      {/* 필터 영역 */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* 마켓 필터 */}
        <div className="flex gap-1 p-1 rounded-xl border border-border bg-bg-card">
          {(["ALL", "KR", "US", "ETF"] as const).map((m) => (
            <button
              key={m}
              onClick={() => changeMarket(m)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                marketFilter === m
                  ? "bg-accent-blue text-white shadow"
                  : "text-text-muted hover:text-text-primary"
              }`}
            >
              {m === "ALL" ? "전체" : m}
            </button>
          ))}
        </div>

        {/* 정렬 */}
        <button
          onClick={() => changeSort(sort === "latest" ? "likes" : "latest")}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-text-dim border border-border hover:border-accent-blue/40 hover:text-accent-blue transition-all ml-auto"
        >
          <ArrowUpDown size={11} />
          {sort === "latest" ? "최신순" : "좋아요순"}
        </button>
      </div>

      {/* 글쓰기 패널 */}
      <FeedWritePanel onSubmitted={() => { setPage(1); qc.invalidateQueries({ queryKey: ["feed"] }); }} />

      {/* 에러 */}
      {isError && (
        <div className="flex flex-col items-center justify-center py-14 gap-3 text-text-dim">
          <AlertCircle size={32} className="opacity-30" />
          <p className="text-sm">피드를 불러올 수 없습니다</p>
          <button onClick={() => refetch()} className="text-xs text-accent-blue hover:underline">
            다시 시도
          </button>
        </div>
      )}

      {/* 로딩 */}
      {isLoading && !isError && (
        <div className="flex flex-col gap-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="bg-bg-card border border-border rounded-2xl p-4 animate-pulse">
              <div className="flex gap-3">
                <div className="w-7 h-7 rounded-full bg-bg-elevated" />
                <div className="flex-1 flex flex-col gap-2">
                  <div className="h-2.5 bg-bg-elevated rounded w-32" />
                  <div className="h-2 bg-bg-elevated rounded w-full" />
                  <div className="h-2 bg-bg-elevated rounded w-2/3" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 빈 상태 */}
      {!isLoading && !isError && posts.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="w-16 h-16 rounded-2xl bg-bg-elevated flex items-center justify-center">
            {feedType === "following" ? (
              <Users size={28} className="text-text-dim opacity-40" />
            ) : (
              <Rss size={28} className="text-text-dim opacity-40" />
            )}
          </div>
          <div className="text-center">
            {feedType === "following" ? (
              <>
                <p className="text-sm font-medium text-text-secondary">아직 팔로우한 사람이 없어요</p>
                <p className="text-xs text-text-dim mt-0.5">다른 투자자를 팔로우하고 피드를 채워보세요!</p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-text-secondary">아직 게시글이 없어요</p>
                <p className="text-xs text-text-dim mt-0.5">종목 상세 페이지에서 의견을 남겨보세요!</p>
              </>
            )}
          </div>
        </div>
      )}

      {/* 피드 목록 */}
      {!isLoading && !isError && posts.length > 0 && (
        <>
          <div className="flex flex-col gap-2">
            {posts.map((post) => (
              <FeedCard
                key={post.id}
                post={post}
                onLike={(id) => likeMutation.mutate(id)}
                onVote={(postId, optionIndex) => voteMutation.mutate({ postId, optionIndex })}
                onOpen={(p) => setSelectedPost(p)}
                onDelete={(id) => { const p = posts.find((x) => x.id === id); if (p) deleteMutation.mutate(p); }}
                queryKey={queryKey}
                qc={qc}
              />
            ))}
          </div>

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

          <p className="text-center text-2xs text-text-dim">
            총 {total.toLocaleString()}개의 게시글
          </p>
        </>
      )}

      {/* 게시글 상세 모달 */}
      {selectedPost && (
        <PostDetailModal
          post={selectedPost}
          onClose={() => { setSelectedPost(null); qc.invalidateQueries({ queryKey }); }}
          onDeleted={() => { setSelectedPost(null); qc.invalidateQueries({ queryKey: ["feed"] }); }}
          onLikeToggled={(postId, liked, likeCount) => {
            qc.setQueryData<any>(queryKey, (prev) =>
              prev ? { ...prev, items: prev.items.map((p: FeedPost) =>
                p.id === postId ? { ...p, liked, like_count: likeCount } : p
              )} : prev
            );
            setSelectedPost((p) => p ? { ...p, liked, like_count: likeCount } : p);
          }}
          onVoteUpdated={(postId, counts, total, myVote) => {
            qc.setQueryData<any>(queryKey, (prev) =>
              prev ? { ...prev, items: prev.items.map((p: FeedPost) =>
                p.id === postId && p.poll ? { ...p, poll: { ...p.poll, counts, total, my_vote: myVote } } : p
              )} : prev
            );
          }}
        />
      )}
    </div>
  );
}
