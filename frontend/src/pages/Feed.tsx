import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, Link } from "react-router-dom";
import {
  Heart, MessageSquare, ArrowUpDown, RefreshCw, Rss, AlertCircle,
} from "lucide-react";
import { communityApi } from "@/api/stocks";
import { useAuthStore } from "@/store/authStore";

type SortType = "latest" | "likes";
type MarketFilter = "ALL" | "KR" | "US" | "ETF";

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

interface FeedPost {
  id: number;
  symbol: string;
  market: string;
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

function FeedCard({ post, onLike }: { post: FeedPost; onLike: (id: number) => void }) {
  const { isLoggedIn } = useAuthStore();
  const navigate = useNavigate();
  const badgeCls = MARKET_BADGE[post.market] ?? MARKET_BADGE.KR;
  const avatarCls = AVATAR_COLORS[post.avatar_color % AVATAR_COLORS.length];

  return (
    <div className="bg-bg-card border border-border rounded-2xl p-4 hover:border-border/80 transition-colors">
      <div className="flex gap-3">
        {/* 아바타 */}
        <div
          className={`w-7 h-7 rounded-full border flex items-center justify-center font-bold text-xs shrink-0 ${avatarCls}`}
        >
          {post.username[0]?.toUpperCase()}
        </div>

        <div className="flex-1 min-w-0">
          {/* 헤더: 유저·시간·종목 */}
          <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
            <span className="text-xs font-semibold text-text-primary">{post.username}</span>
            <span className="text-2xs text-text-dim">·</span>
            <span className="text-2xs text-text-dim">{timeAgo(post.created_at)}</span>
            <span className="ml-auto flex items-center gap-1">
              <span className={`text-2xs font-bold px-1.5 py-0.5 rounded border ${badgeCls}`}>
                {post.market}
              </span>
              <Link
                to={`/stocks/${post.market}/${post.symbol}`}
                className="text-2xs font-semibold text-accent-blue hover:underline"
              >
                {post.symbol}
              </Link>
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

            <Link
              to={`/stocks/${post.market}/${post.symbol}`}
              className="flex items-center gap-1.5 text-xs text-text-dim hover:text-accent-blue transition-colors"
            >
              <MessageSquare size={12} />
              {post.comment_count > 0 ? (
                <span>{post.comment_count}</span>
              ) : (
                <span className="opacity-60">댓글</span>
              )}
            </Link>

            <Link
              to={`/stocks/${post.market}/${post.symbol}`}
              className="ml-auto text-2xs text-text-dim hover:text-accent-blue transition-colors"
            >
              종목 보기 →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

const PAGE_SIZE = 20;

export default function Feed() {
  const qc = useQueryClient();
  const [sort, setSort] = useState<SortType>("latest");
  const [marketFilter, setMarketFilter] = useState<MarketFilter>("ALL");
  const [page, setPage] = useState(1);

  const queryKey = ["feed", sort, marketFilter, page];

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey,
    queryFn: () =>
      communityApi.getFeed(page, sort, marketFilter === "ALL" ? undefined : marketFilter),
    staleTime: 30_000,
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

  const changeSort = (s: SortType) => { setSort(s); setPage(1); };
  const changeMarket = (m: MarketFilter) => { setMarketFilter(m); setPage(1); };

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
            <Rss size={28} className="text-text-dim opacity-40" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-text-secondary">아직 게시글이 없어요</p>
            <p className="text-xs text-text-dim mt-0.5">종목 상세 페이지에서 의견을 남겨보세요!</p>
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
    </div>
  );
}
