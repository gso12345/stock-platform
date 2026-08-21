import { useState, useEffect, memo, lazy, Suspense } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useNavigate, Link } from "react-router-dom";
import {
  Heart, MessageSquare, ArrowUpDown, RefreshCw, Rss, AlertCircle, Users, Share2,
  PenSquare, Trash2, LogIn, Eye, Search, X,
} from "lucide-react";
import { communityApi } from "@/api/stocks";
import { useAuthStore } from "@/store/authStore";
import { API_BASE } from "@/api/client";
/* 포트폴리오 그림은 따로 받는다.
   이걸 정적으로 걸어 두면 recharts(gzip 110KB)가 피드 청크에 딸려 온다.
   ESM 은 의존 그래프를 다 받아야 모듈 본문이 실행되므로, 피드의 첫 API
   요청이 그 110KB 를 기다렸다. 정작 이 그림은 '포트폴리오를 공유한 글'
   에만 나오는데, 그런 글이 하나도 없는 피드에서도 값을 치른 셈이다. */
const PortfolioSnapshot = lazy(() => import("@/components/portfolio/PortfolioSnapshot"));
import { useMyProfile } from "@/hooks/useMyProfile";
import Avatar from "@/components/community/Avatar";
import { Tabs, type TabItem, 빈화면, ConfirmDialog } from "@/components/ui";
import PostDetailModal from "@/components/community/PostDetailModal";

type SortType = "latest" | "likes";
type MarketFilter = "ALL" | "KR" | "US" | "ETF";
type FeedType = "all" | "following";

const MARKET_FILTER_TABS: TabItem[] = [
  { id: "ALL", label: "전체" },
  { id: "KR",  label: "KR"  },
  { id: "US",  label: "US"  },
  { id: "ETF", label: "ETF" },
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

/** 확인창에 보여 줄 한 줄. 제목이 없으면 본문 앞머리를 쓴다 */
function 글요약(p: { title?: string; body?: string }): string {
  const t = (p.title || p.body || "").trim();
  return t.length > 40 ? t.slice(0, 40) + "…" : (t || "(내용 없음)");
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
  avatar_url?: string | null;
  title: string;
  body: string;
  image: string;
  poll: PollData | null;
  tags: { symbol: string; market: string; name?: string }[];
  portfolio?: { symbol: string; market: string; name: string; shares: number; avg_price: number; currency?: string; input_exchange_rate?: number | null; current_price?: number | null }[] | null;
  like_count: number;
  comment_count: number;
  /** 목록 응답은 이미지를 빼고 '있다'는 표시만 보낸다 (피드가 가벼워진다) */
  has_image?: boolean;
  view_count?: number;
  liked: boolean;
  created_at: string;
  is_mine: boolean;
  is_following?: boolean;
}

const FeedCard = memo(function FeedCard({
  post,
  onLike,
  onVote,
  onOpen,
  onComments,
  onDelete,
}: {
  post: FeedPost;
  onLike: (id: number) => void;
  onVote: (postId: number, optionIndex: number) => void;
  onOpen: (post: FeedPost) => void;
  /* 댓글은 새 화면으로 넘어가지 않고 아래에서 올라오게 한다.
     보던 자리를 잃지 않고, 닫으면 그대로 돌아온다 — 알림창과 같은 방식. */
  onComments: (post: FeedPost) => void;
  onDelete: (id: number) => void;
}) {
  const { isLoggedIn } = useAuthStore();
  const navigate = useNavigate();
  const badgeCls = MARKET_BADGE[post.market] ?? MARKET_BADGE.KR;
  const [copied, setCopied] = useState(false);
  const [showFull, setShowFull] = useState(false);

  const handleShare = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const url = `${window.location.origin}/post/${post.id}`;
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
        <Avatar username={post.username} colorIndex={post.avatar_color} avatarUrl={post.avatar_url}
                userId={post.user_id} isMine={post.is_mine} size="base" />

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
                  aria-label="글 삭제"
                  onClick={(e) => { e.stopPropagation(); onDelete(post.id); }}
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

          {/* 본문 */}
          {post.body && (
            <div className="mb-2">
              <p className={`text-sm text-text-secondary leading-relaxed break-words ${showFull ? "" : "line-clamp-3"}`}>
                {post.body}
              </p>
              {post.body.length > 120 && (
                <button
                  onClick={(e) => { e.stopPropagation(); setShowFull((v) => !v); }}
                  className="text-xs text-accent-blue hover:underline mt-0.5"
                >
                  {showFull ? "접기" : "더 보기"}
                </button>
              )}
            </div>
          )}

          {/* 첨부 이미지.
              목록 응답에는 이미지가 없다(피드 20개에 이미지 20장이 딸려
              오면 수 MB 다). 화면에 들어올 때 따로 받는다 — 브라우저가
              캐시하므로 다시 볼 때는 요청이 안 나간다. */}
          {(post.image || post.has_image) && (
            <img
              src={post.image || `${API_BASE}/community/posts/${post.id}/image`}
              alt="첨부 이미지"
              loading="lazy"
              decoding="async"
              className="w-full max-h-48 object-cover rounded-xl mb-2 bg-bg-elevated"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
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
                  key={`${t.symbol}-${t.market}`}
                  to={`/stocks/${t.market}/${t.symbol}`}
                  className="text-2xs font-semibold px-1.5 py-0.5 rounded bg-accent-blue/10 text-accent-blue hover:bg-accent-blue/20 transition-colors"
                >
                  #{t.market === "KR" && t.name ? t.name : t.symbol}
                </Link>
              ))}
            </div>
          )}

          {/* 포트폴리오 차트 */}
          {post.portfolio && post.portfolio.length > 0 && (
            <div className="mb-2" onClick={(e) => e.stopPropagation()}>
              <Suspense fallback={<div className="h-[180px] rounded-xl bg-bg-elevated/40 animate-pulse" />}>
                <PortfolioSnapshot items={post.portfolio} />
              </Suspense>
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
              onClick={() => onComments(post)}
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
});

/* 글쓰기는 따로 화면을 낸다 — 목록 위에서 패널이 자라며 아래 글을
   밀어내던 것을 없애고, 태그칸도 처음부터 보이게 하기 위해서다.
   여기 남는 것은 그 화면으로 가는 버튼뿐이다. */
function 글쓰기버튼() {
  const { isLoggedIn } = useAuthStore();
  const navigate = useNavigate();
  const { displayName: myName, avatarColor: myAvatarColor, avatarUrl: myAvatarUrl } = useMyProfile();

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

  return (
    <div className="bg-bg-card border border-border rounded-2xl overflow-hidden">
      <button
        onClick={() => navigate("/feed/write")}
        className="w-full flex items-center gap-3 px-4 py-4 text-left hover:bg-bg-elevated transition-all group"
      >
        <Avatar username={myName} colorIndex={myAvatarColor} avatarUrl={myAvatarUrl} size="base" />
        <span className="flex-1 text-sm text-text-dim group-hover:text-text-secondary transition-colors">
          종목 의견이나 포트폴리오를 공유해보세요...
        </span>
        <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-accent-blue text-white text-xs font-semibold shrink-0">
          <PenSquare size={13} />
          글쓰기
        </span>
      </button>
    </div>
  );
}


const PAGE_SIZE = 20;

export default function Feed() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { isLoggedIn } = useAuthStore();
  const [feedType, setFeedType] = useState<FeedType>("all");
  /* 댓글을 볼 글. 새 화면으로 넘어가는 대신 아래에서 올라오게 한다 —
     피드를 훑다가 댓글만 확인하고 돌아오는 흐름이 대부분인데, 화면을
     갈아타면 스크롤 위치도 필터도 잃는다. */
  const [댓글글, set댓글글] = useState<FeedPost | null>(null);
  /* 어느 글을 지우는지 보여 주려면 id 만으로는 안 된다 */
  const [지울글, set지울글] = useState<FeedPost | null>(null);
  const [sort, setSort] = useState<SortType>("latest");
  const [marketFilter, setMarketFilter] = useState<MarketFilter>("ALL");
  const [page, setPage] = useState(1);

  /* 검색 — 치는 동안 매 글자마다 서버를 부르면 0.15 CPU 짜리 서버가
     그대로 막힌다. 잠깐 멈췄을 때만 보낸다 */
  const [검색입력, set검색입력] = useState("");
  const [검색어, set검색어] = useState("");
  useEffect(() => {
    const t = setTimeout(() => { set검색어(검색입력.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [검색입력]);

  const isFollowing = feedType === "following";
  const queryKey = ["feed", sort, marketFilter, page, feedType, 검색어];

  const { data, isLoading, isFetching, isError, refetch } = useQuery({
    queryKey,
    queryFn: () =>
      communityApi.getFeed(
        page,
        sort,
        marketFilter === "ALL" ? undefined : marketFilter,
        isFollowing,
        검색어 || undefined
      ),
    staleTime: 120_000,
    refetchInterval: 300_000,
    placeholderData: keepPreviousData,
  });

  const posts: FeedPost[] = data?.items ?? [];
  const total: number = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const likeMutation = useMutation({
    mutationFn: (postId: number) => communityApi.togglePostLike(postId),
    onMutate: async (postId) => {
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<any>(queryKey);
      if (prev?.items) {
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
    /* 서버가 알려준 것으로 맞춘다.
       낙관적으로 뒤집은 값은 "내가 알고 있던 상태" 를 기준으로 한 추측이다.
       그 추측이 틀렸을 수 있다 — 다른 기기에서 이미 눌렀거나, 화면이
       오래된 목록을 들고 있었을 때. 서버는 토글이라 어긋나면 반대로
       움직이므로, 한 번 누른 뒤에는 반드시 실제 값으로 맞춰 놓아야
       다음 클릭이 또 어긋나지 않는다. */
    onSuccess: (결과: any, postId) => {
      if (!결과 || typeof 결과.liked !== "boolean") return;
      qc.setQueryData(queryKey, (prev: any) => {
        if (!prev?.items) return prev;
        return {
          ...prev,
          items: prev.items.map((p: FeedPost) =>
            p.id === postId
              ? { ...p, liked: 결과.liked, like_count: 결과.like_count ?? p.like_count }
              : p),
        };
      });
    },
  });

  const voteMutation = useMutation({
    mutationFn: ({ postId, optionIndex }: { postId: number; optionIndex: number }) =>
      communityApi.votePoll(postId, optionIndex),
    onSuccess: (data, { postId }) => {
      qc.setQueryData(queryKey, (prev: any) => {
        if (!prev?.items) return prev;
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

  const prefetchFeed = (overrides: { sort?: SortType; market?: MarketFilter; type?: FeedType }) => {
    const s = overrides.sort ?? sort;
    const m = overrides.market ?? marketFilter;
    const t = overrides.type ?? feedType;
    const key = ["feed", s, m, 1, t, 검색어];
    qc.prefetchQuery({
      queryKey: key,
      queryFn: () => communityApi.getFeed(1, s, m === "ALL" ? undefined : m, t === "following", 검색어 || undefined),
      staleTime: 30_000,
    });
  };

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
      <Tabs
        ariaLabel="피드 종류"
        fill={false}
        className="w-fit"
        tabs={[
          { id: "all",       label: "전체 피드", icon: Rss },
          { id: "following", label: "팔로잉",   icon: Users },
        ]}
        active={feedType}
        onChange={(id) => changeFeedType(id as any)}
        onHover={(id) => prefetchFeed({ type: id as any })}
      />

      {/* 검색 — 제목·본문·종목코드·태그에서 찾는다 */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-dim pointer-events-none" />
        <input
          type="search"
          aria-label="피드 검색"
          value={검색입력}
          onChange={(e) => set검색입력(e.target.value)}
          placeholder="종목·제목·내용·태그로 검색"
          maxLength={50}
          className="w-full pl-9 pr-9 py-2.5 bg-bg-card border border-border rounded-xl text-sm text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-blue/50 transition-colors"
        />
        {검색입력 && (
          <button
            onClick={() => set검색입력("")}
            aria-label="검색어 지우기"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-full text-text-dim hover:text-text-primary hover:bg-bg-elevated transition-colors"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {/* 필터 영역 */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* 마켓 필터 */}
        <Tabs
          ariaLabel="시장 필터"
          fill={false}
          tabs={MARKET_FILTER_TABS}
          active={marketFilter}
          onChange={(id) => changeMarket(id as any)}
          onHover={(id) => prefetchFeed({ market: id as any })}
        />

        {/* 정렬 */}
        <button
          onClick={() => changeSort(sort === "latest" ? "likes" : "latest")}
          onMouseEnter={() => prefetchFeed({ sort: sort === "latest" ? "likes" : "latest" })}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-text-dim border border-border hover:border-accent-blue/40 hover:text-accent-blue transition-all ml-auto"
        >
          <ArrowUpDown size={11} />
          {sort === "latest" ? "최신순" : "좋아요순"}
        </button>
      </div>

      {/* 글쓰기 패널 */}
      <글쓰기버튼 />

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
      {!isLoading && !isFetching && !isError && posts.length === 0 && (
        /* 팔로잉 피드가 비었을 때는 '전체'로 보내는 게 제일 낫다. 거기엔
           글이 있으니 바로 읽을 것이 생기고, 마음에 드는 사람을 그 자리에서
           팔로우하면 이 화면이 채워진다 */
        검색어 ? (
          /* 검색 결과가 없을 때 "첫 글을 남겨보세요" 를 내밀면 엉뚱하다.
             찾던 것이 없는 것이지, 피드가 빈 것이 아니다 */
          <빈화면
            icon={Search}
            title={`"${검색어}" 에 대한 글이 없어요`}
            hint="종목코드나 종목명으로도 찾을 수 있어요. 시장 필터가 걸려 있으면 풀어보세요"
            action={{ label: "검색 지우기", onClick: () => set검색입력("") }}
          />
        ) : feedType === "following" ? (
          <빈화면
            icon={Users}
            title="아직 팔로우한 사람이 없어요"
            hint="전체 피드에서 마음에 드는 글을 쓴 사람을 팔로우하면 여기에 모여요"
            action={{ label: "전체 피드 보기", onClick: () => changeFeedType("all") }}
          />
        ) : (
          <빈화면
            icon={Rss}
            title="아직 게시글이 없어요"
            hint="첫 글을 남겨보세요. 종목을 함께 붙이면 다른 사람이 찾아보기 좋아요"
            action={{
              label: "첫 글 쓰기",
              // 글쓰기는 따로 화면이 있다. 예전에는 맨 위로 올리기만 했는데,
              // 올라간 자리에 접힌 한 줄이 있을 뿐이라 한 번 더 눌러야 했다
              onClick: () => navigate("/feed/write"),
            }}
          />
        )
      )}

      {/* 피드 목록 */}
      {!isLoading && !isError && posts.length > 0 && (
        <>
          <div className={`flex flex-col gap-2 transition-opacity duration-150 ${isFetching ? "opacity-60" : "opacity-100"}`}>
            {posts.map((post) => (
              <FeedCard
                key={post.id}
                post={post}
                onLike={(id) => likeMutation.mutate(id)}
                onVote={(postId, optionIndex) => voteMutation.mutate({ postId, optionIndex })}
                onOpen={(p) => navigate(`/post/${p.id}`)}
                onComments={(p) => set댓글글(p)}
                onDelete={(id) => { const p = posts.find((x) => x.id === id); if (p) set지울글(p); }}
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


    {/* 댓글 — 아래에서 올라온다. PostDetailModal 이 이미 모바일에서
        아래 붙는 모양이라 그대로 쓴다(댓글 쓰기·좋아요·투표까지 그대로) */}
    {/* 글 삭제는 되돌릴 수 없다. 예전에는 브라우저 기본 confirm 이라
        앱 모양과 따로 놀았고, 어느 글을 지우는지 보여 줄 수 없었다 —
        목록에서 옆줄을 잘못 누르는 것이 가장 흔한 실수다. */}
    {지울글 && (
      <ConfirmDialog
        title="글을 삭제할까요?"
        message="지운 글은 되돌릴 수 없습니다. 달린 댓글도 함께 사라집니다."
        대상={지울글.symbol ? `${지울글.symbol} · ${글요약(지울글)}` : 글요약(지울글)}
        확인글="삭제"
        진행중={deleteMutation.isPending}
        onConfirm={() => { deleteMutation.mutate(지울글); set지울글(null); }}
        onClose={() => set지울글(null)}
      />
    )}

    {댓글글 && (
      <PostDetailModal
        post={댓글글 as any}
        onClose={() => set댓글글(null)}
        onLikeToggled={() => qc.invalidateQueries({ queryKey: ["feed"] })}
        onVoteUpdated={() => qc.invalidateQueries({ queryKey: ["feed"] })}
        onDeleted={() => { set댓글글(null); qc.invalidateQueries({ queryKey: ["feed"] }); }}
      />
    )}
    </div>
  );
}
