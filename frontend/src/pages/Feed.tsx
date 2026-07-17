import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, Link } from "react-router-dom";
import {
  Heart, MessageSquare, ArrowUpDown, RefreshCw, Rss, AlertCircle, Users,
} from "lucide-react";
import { communityApi } from "@/api/stocks";
import { useAuthStore } from "@/store/authStore";

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
  like_count: number;
  comment_count: number;
  liked: boolean;
  created_at: string;
  is_mine: boolean;
}

function FeedCard({
  post,
  onLike,
  onVote,
  queryKey,
  qc,
}: {
  post: FeedPost;
  onLike: (id: number) => void;
  onVote: (postId: number, optionIndex: number) => void;
  queryKey: any[];
  qc: ReturnType<typeof useQueryClient>;
}) {
  const { isLoggedIn } = useAuthStore();
  const navigate = useNavigate();
  const badgeCls = MARKET_BADGE[post.market] ?? MARKET_BADGE.KR;
  const avatarCls = AVATAR_COLORS[post.avatar_color % AVATAR_COLORS.length];

  return (
    <div className="bg-bg-card border border-border rounded-2xl p-4 hover:border-border/80 transition-colors">
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
  const navigate = useNavigate();
  const { isLoggedIn } = useAuthStore();
  const [feedType, setFeedType] = useState<FeedType>("all");
  const [sort, setSort] = useState<SortType>("latest");
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
    </div>
  );
}
