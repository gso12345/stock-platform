/**
 * 커뮤니티 피드.
 *
 * 앱처럼 다시 짰다(사용자: "피드탭 디자인, 사용자편의성 개선하고 싶어 앱느낌 나도록" — 열세 가지 모두).
 *   1  위쪽 — 제목·전체/팔로잉·검색창·시장·정렬·글쓰기 상자가 다섯 줄이라 첫 글이 화면 40% 아래에서
 *      시작했다. '전체 | 팔로잉' 밑줄 탭 한 줄(오른쪽 끝에 검색)과 시장·정렬 칩 한 줄로 줄였다.
 *      새로고침 아이콘은 당겨서 새로고침이 있어 뺐다
 *   2  글쓰기 — 목록 위 큰 상자 대신 오른쪽 아래 둥근 연필 단추(PC 는 위쪽 줄의 단추)
 *   3  목록 — 띄엄띄엄 쌓던 둥근 상자 대신 구분선으로 나눈 한 장(휴대폰은 화면 끝까지)
 *   4  종목 — 코드 대신 이름(종목칩)
 *   5  아래 단추 — 아이콘과 숫자만, 누르는 자리는 손가락 크기, 조회수 0 은 숨김, 하트가 톡 튄다
 *   6  ⋯ 메뉴 — 삭제·링크 복사·신고(글메뉴)
 *   7  공유 — 휴대폰은 기기 공유 창(utils/공유)
 *   8  포트폴리오 글 — 원 그래프 대신 비중 색 띠(포트폴리오띠)
 *   9  사진 — 누르면 크게(사진보기)
 *   10 쪽 번호 — 끝에 닿으면 다음 글이 저절로 붙는다(useInfiniteQuery)
 */
import { useState, useEffect, useRef, memo } from "react";
import { useInfiniteQuery, useMutation, useQueryClient, keepPreviousData, type InfiniteData } from "@tanstack/react-query";
import { useNavigate, Link } from "react-router-dom";
import {
  Heart, MessageCircle, ArrowUpDown, AlertCircle, Users, Share2, PenLine, Trash2, Eye, Search, X, Rss,
  Link2, Flag, Loader2,
} from "lucide-react";
import { communityApi } from "@/api/stocks";
import { use낙관 } from "@/hooks/useOptimistic";
import { useAuthStore } from "@/store/authStore";
import { API_BASE } from "@/api/client";
import Avatar from "@/components/community/Avatar";
import { UnderlineTabs, ChipTabs, 칩탭모양, cn, 빈화면, ConfirmDialog, Button, type TabItem } from "@/components/ui";
import PostDetailModal from "@/components/community/PostDetailModal";
import 글메뉴, { type 메뉴항목 } from "@/components/community/글메뉴";
import 종목칩, { 종목이름 } from "@/components/community/종목칩";
import 포트폴리오띠 from "@/components/community/포트폴리오띠";
import 사진보기 from "@/components/community/사진보기";
import 신고창, { 신고보내기 } from "@/components/community/신고창";
import { use알림 } from "@/hooks/useDialogs";
import { use넓은화면 } from "@/hooks/useWideScreen";
import { 글공유, 글주소, 링크복사, 공유알림 } from "@/utils/공유";
import { timeAgo } from "@/utils/formatters";

type SortType = "latest" | "likes";
type MarketFilter = "ALL" | "KR" | "US" | "ETF";
type FeedType = "all" | "following";

/** 다른 메뉴(관심종목·스크리닝·퀀트)와 같은 말 — 'KR·US' 대신 '국내·해외' */
const 시장칩: TabItem[] = [
  { id: "ALL", label: "전체" },
  { id: "KR",  label: "국내" },
  { id: "US",  label: "해외" },
  { id: "ETF", label: "ETF" },
];

const 피드종류: TabItem[] = [
  { id: "all",       label: "전체" },
  { id: "following", label: "팔로잉" },
];

/** 한 번에 받는 글 수 — 서버 기본값과 같다 */
export const PAGE_SIZE = 20;

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

export interface FeedPost {
  id: number;
  symbol: string;
  market: string;
  /** 종목 이름 — 서버가 모르면 비어 온다(그러면 코드를 쓴다) */
  name?: string | null;
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

type 피드쪽 = { total: number; page: number; items: FeedPost[] };
type 피드자료 = InfiniteData<피드쪽, number>;

/** 다음에 받을 쪽 — 받은 글이 전체보다 적으면 다음 쪽. 빈 쪽이 오면 멈춘다(지워진 글로 전체 수가
 *  어긋나도 끝없이 묻지 않게) */
export function 다음쪽(마지막: 피드쪽, 모두: 피드쪽[]): number | undefined {
  const 받은수 = 모두.reduce((n, p) => n + (p.items?.length ?? 0), 0);
  if (!마지막?.items?.length) return undefined;
  return 받은수 < (마지막.total ?? 0) ? 모두.length + 1 : undefined;
}

/** 받은 쪽들을 한 줄로 — 쪽 사이에 새 글이 끼면 같은 글이 두 쪽에 걸친다. 먼저 나온 것만 둔다 */
export function 한줄로(자료: 피드자료 | undefined): FeedPost[] {
  const 본것 = new Set<number>();
  const 줄: FeedPost[] = [];
  for (const 쪽 of 자료?.pages ?? []) {
    for (const p of 쪽.items ?? []) {
      if (본것.has(p.id)) continue;
      본것.add(p.id);
      줄.push(p);
    }
  }
  return 줄;
}

/** 받은 쪽들 안의 글 하나를 고친다 */
export function 글고치기(자료: 피드자료 | undefined, id: number, 고치기: (p: FeedPost) => FeedPost): 피드자료 | undefined {
  if (!자료?.pages) return 자료;
  return { ...자료, pages: 자료.pages.map((쪽) => ({ ...쪽, items: (쪽.items ?? []).map((p) => (p.id === id ? 고치기(p) : p)) })) };
}

/** 받은 쪽들에서 글 하나를 뺀다 */
export function 글빼기(자료: 피드자료 | undefined, id: number): 피드자료 | undefined {
  if (!자료?.pages) return 자료;
  return { ...자료, pages: 자료.pages.map((쪽) => ({ ...쪽, items: (쪽.items ?? []).filter((p) => p.id !== id) })) };
}

const FeedRow = memo(function FeedRow({
  post, onLike, onVote, onOpen, onComments, onDelete, onReport, onShare, onCopy, onImage,
}: {
  post: FeedPost;
  onLike: (id: number) => void;
  onVote: (postId: number, optionIndex: number) => void;
  onOpen: (post: FeedPost) => void;
  /* 댓글은 새 화면으로 넘어가지 않고 아래에서 올라오게 한다.
     보던 자리를 잃지 않고, 닫으면 그대로 돌아온다 — 알림창과 같은 방식. */
  onComments: (post: FeedPost) => void;
  onDelete: (post: FeedPost) => void;
  onReport: (post: FeedPost) => void;
  onShare: (post: FeedPost) => void;
  onCopy: (post: FeedPost) => void;
  onImage: (주소: string) => void;
}) {
  const { isLoggedIn } = useAuthStore();
  const navigate = useNavigate();
  const [showFull, setShowFull] = useState(false);
  /* 누를 때마다 하트가 톡 튀게 — 같은 글자(class)를 다시 붙이려면 key 를 바꿔야 애니메이션이 다시 돈다 */
  const [튐, set튐] = useState(0);
  const 포트폴리오글 = !!(post.portfolio && post.portfolio.length > 0);
  const 사진주소 = post.image || (post.has_image ? `${API_BASE}/community/posts/${post.id}/image` : "");
  const 조회수 = post.view_count ?? 0;

  const 메뉴: 메뉴항목[] = [
    { 이름: "링크 복사", 아이콘: Link2, 누르면: () => onCopy(post) },
    ...(post.is_mine
      ? [{ 이름: "삭제", 아이콘: Trash2, 위험: true, 누르면: () => onDelete(post) }]
      : isLoggedIn ? [{ 이름: "신고", 아이콘: Flag, 위험: true, 누르면: () => onReport(post) }] : []),
  ];

  const 좋아요 = () => {
    if (!isLoggedIn) { navigate("/login"); return; }
    if (!post.liked) set튐((n) => n + 1);
    onLike(post.id);
  };

  return (
    <article
      className="px-4 py-3.5 cursor-pointer transition-colors hover:bg-bg-elevated/40 active:bg-bg-elevated/60"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button, a, input, textarea")) return;
        onOpen(post);
      }}
    >
      <div className="flex gap-3">
        <Avatar username={post.username} colorIndex={post.avatar_color} avatarUrl={post.avatar_url}
                userId={post.user_id} isMine={post.is_mine} size="lg" />

        <div className="flex-1 min-w-0 flex flex-col gap-1.5">
          {/* 머리: 이름 · 시간 ······ 종목 ⋯ */}
          <div className="flex items-center gap-1.5 min-w-0">
            <Link to={post.is_mine ? "/mypage" : `/profile/${post.user_id}`}
              className="text-sm font-semibold text-text-primary hover:text-accent-blue transition-colors truncate">
              {post.username}
            </Link>
            <span className="text-xs text-text-dim flex-shrink-0">· {timeAgo(post.created_at)}</span>
            <span className="ml-auto flex items-center gap-2 flex-shrink-0 pl-1">
              {/* 포트폴리오 글이 걸린 종목은 담긴 것 중 하나일 뿐이라(첫 종목) 그 이름을 내세우지 않는다 */}
              {포트폴리오글
                ? <span className="px-2 py-0.5 rounded-lg text-xs font-semibold bg-bg-elevated text-text-secondary">포트폴리오</span>
                : <종목칩 symbol={post.symbol} market={post.market} name={post.name} />}
              <글메뉴 항목들={메뉴} 이름="글 메뉴" />
            </span>
          </div>

          {post.title && <p className="text-sm font-semibold text-text-primary">{post.title}</p>}

          {post.body && (
            <div>
              {/* 접어 둘 때는 줄바꿈을 살리지 않는다 — 빈 줄이 석 줄 안에 들면 '…' 만 덩그러니 한 줄을 차지했다.
                  펼치면 글쓴이가 나눈 문단 그대로 */}
              <p className={cn("text-sm text-text-secondary leading-relaxed break-words", showFull ? "whitespace-pre-line" : "line-clamp-3")}>
                {post.body}
              </p>
              {post.body.length > 120 && (
                <button onClick={() => setShowFull((v) => !v)}
                  className="text-xs font-semibold text-text-muted hover:text-text-primary mt-0.5">
                  {showFull ? "접기" : "더 보기"}
                </button>
              )}
            </div>
          )}

          {/* 첨부 사진. 목록 응답에는 사진이 없다(피드 20개에 사진 20장이 딸려 오면 수 MB 다) — 화면에 들어올 때
              따로 받는다. 누르면 크게 본다 */}
          {사진주소 && (
            <button type="button" aria-label="사진 크게 보기" onClick={() => onImage(사진주소)}
              className="block w-full overflow-hidden rounded-xl border border-border/60 bg-bg-elevated">
              <img src={사진주소} alt="첨부 사진" loading="lazy" decoding="async"
                className="w-full max-h-80 object-cover"
                onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }} />
            </button>
          )}

          {post.poll && (
            <div className="p-3 bg-bg-elevated rounded-xl flex flex-col gap-2">
              <p className="text-xs font-semibold text-text-primary">{post.poll.question}</p>
              {post.poll.options.map((opt, i) => {
                const voted = post.poll!.my_vote !== null;
                const pct = post.poll!.total > 0 ? Math.round((post.poll!.counts[i] / post.poll!.total) * 100) : 0;
                const isChosen = post.poll!.my_vote === i;
                return (
                  <button key={i}
                    onClick={() => (isLoggedIn ? !voted && onVote(post.id, i) : navigate("/login"))}
                    disabled={voted}
                    className={cn("relative w-full text-left px-3 py-2 rounded-lg border text-xs overflow-hidden transition-colors",
                      isChosen ? "border-accent-blue/50" : "border-border hover:border-accent-blue/30")}
                  >
                    {voted && (
                      <div className={cn("absolute inset-0 rounded-lg", isChosen ? "bg-accent-blue/25" : "bg-accent-blue/10")}
                           style={{ width: `${pct}%` }} />
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

          {포트폴리오글 && <포트폴리오띠 items={post.portfolio!} />}

          {post.tags && post.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {post.tags.map((t) => (
                <Link key={`${t.symbol}-${t.market}`} to={`/stocks/${t.market}/${t.symbol}`}
                  className="text-xs font-semibold text-accent-blue hover:underline">
                  {/* 해외 태그의 이름은 영어 회사명이라 길다 — 심볼이 낫다 */}
                  #{t.market === "KR" && t.name ? t.name : t.symbol}
                </Link>
              ))}
            </div>
          )}

          {/* 아래 단추 — 아이콘과 숫자만. 누르는 자리는 손가락 크기(40px) */}
          <div className="flex items-center -ml-2 -mb-1.5">
            <button onClick={좋아요} aria-pressed={post.liked}
              aria-label={post.like_count > 0 ? `좋아요 ${post.like_count}` : "좋아요"}
              className={cn("flex items-center gap-1.5 min-h-[40px] min-w-[40px] px-2 rounded-full text-sm transition-colors",
                post.liked ? "text-accent-red" : "text-text-muted hover:text-accent-red")}>
              <Heart key={튐} size={17} className={cn(post.liked && "fill-accent-red", 튐 > 0 && "heart-pop")} />
              {post.like_count > 0 && <span className="num font-medium">{post.like_count}</span>}
            </button>
            <button onClick={() => onComments(post)}
              aria-label={post.comment_count > 0 ? `댓글 ${post.comment_count}` : "댓글"}
              className="flex items-center gap-1.5 min-h-[40px] min-w-[40px] px-2 rounded-full text-sm text-text-muted hover:text-accent-blue transition-colors">
              <MessageCircle size={17} />
              {post.comment_count > 0 && <span className="num font-medium">{post.comment_count}</span>}
            </button>
            <button onClick={() => onShare(post)} aria-label="공유"
              className="flex items-center justify-center min-h-[40px] min-w-[40px] px-2 rounded-full text-text-muted hover:text-text-primary transition-colors">
              <Share2 size={17} />
            </button>
            {/* 조회수는 있을 때만 — '0' 은 읽을 거리가 아니다 */}
            {조회수 > 0 && (
              <span className="ml-auto flex items-center gap-1 pr-0.5 text-xs text-text-dim" aria-label={`조회 ${조회수}`}>
                <Eye size={13} />
                <span className="num">{조회수}</span>
              </span>
            )}
          </div>
        </div>
      </div>
    </article>
  );
});

/** 글이 뜰 자리 — 목록과 같은 모양으로 잡아 두어 글이 들어올 때 덜컹이지 않는다 */
function 목록뼈대() {
  return (
    <div aria-hidden className="-mx-3 md:mx-0 bg-bg-card border-y md:border border-border md:rounded-2xl divide-y divide-border">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="px-4 py-4 flex gap-3 animate-pulse">
          <div className="w-10 h-10 rounded-full bg-bg-elevated flex-shrink-0" />
          <div className="flex-1 flex flex-col gap-2 pt-1">
            <div className="h-3 bg-bg-elevated rounded w-32" />
            <div className="h-2.5 bg-bg-elevated rounded w-full" />
            <div className="h-2.5 bg-bg-elevated rounded w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Feed() {
  const qc = useQueryClient();
  const { 미리, 되돌리기 } = use낙관();
  const navigate = useNavigate();
  const { isLoggedIn } = useAuthStore();
  const 넓음 = use넓은화면();
  const { 보이기, 화면: 알림화면 } = use알림();
  const [feedType, setFeedType] = useState<FeedType>("all");
  /* 댓글을 볼 글. 새 화면으로 넘어가는 대신 아래에서 올라오게 한다 —
     피드를 훑다가 댓글만 확인하고 돌아오는 흐름이 대부분인데, 화면을
     갈아타면 스크롤 위치도 필터도 잃는다. */
  const [댓글글, set댓글글] = useState<FeedPost | null>(null);
  /* 어느 글을 지우는지 보여 주려면 id 만으로는 안 된다 */
  const [지울글, set지울글] = useState<FeedPost | null>(null);
  const [신고할글, set신고할글] = useState<FeedPost | null>(null);
  const [크게볼사진, set크게볼사진] = useState<string | null>(null);
  const [sort, setSort] = useState<SortType>("latest");
  const [marketFilter, setMarketFilter] = useState<MarketFilter>("ALL");

  /* 검색 — 돋보기를 누를 때만 칸을 편다. 치는 동안 매 글자마다 서버를 부르면 0.15 CPU 짜리 서버가
     그대로 막힌다 — 잠깐 멈췄을 때만 보낸다. 검색어가 바뀌면 이름표가 바뀌어 1쪽부터 새로 받는다 */
  const [검색열림, set검색열림] = useState(false);
  const [검색입력, set검색입력] = useState("");
  const [검색어, set검색어] = useState("");
  useEffect(() => {
    const t = setTimeout(() => set검색어(검색입력.trim()), 350);
    return () => clearTimeout(t);
  }, [검색입력]);
  const 검색닫기 = () => { set검색열림(false); set검색입력(""); set검색어(""); };

  const isFollowing = feedType === "following";
  const queryKey = ["feed", sort, marketFilter, feedType, 검색어];

  const { data, isLoading, isFetching, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }): Promise<피드쪽> =>
      communityApi.getFeed(
        pageParam,
        sort,
        marketFilter === "ALL" ? undefined : marketFilter,
        isFollowing,
        검색어 || undefined,
      ),
    initialPageParam: 1,
    getNextPageParam: 다음쪽,
    staleTime: 120_000,
    refetchInterval: 300_000,
    placeholderData: keepPreviousData,
  });

  const posts = 한줄로(data as 피드자료 | undefined);
  const total: number = (data as 피드자료 | undefined)?.pages?.[0]?.total ?? 0;

  /* 끝에 닿기 조금 전(600px)에 다음 쪽을 받는다 — 끝까지 내려와 기다리지 않게 */
  const 끝표시 = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = 끝표시.current;
    if (!el || !hasNextPage || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((보임) => {
      if (보임.some((e) => e.isIntersecting) && !isFetchingNextPage) fetchNextPage();
    }, { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, posts.length]);

  const 고치기 = (id: number, 바꾸기: (p: FeedPost) => FeedPost) =>
    qc.setQueryData<피드자료>(queryKey, (앞) => 글고치기(앞, id, 바꾸기));

  const likeMutation = useMutation({
    mutationFn: (postId: number) => communityApi.togglePostLike(postId),
    onMutate: async (postId) => {
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<피드자료>(queryKey);
      고치기(postId, (p) => ({ ...p, liked: !p.liked, like_count: p.liked ? p.like_count - 1 : p.like_count + 1 }));
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
      고치기(postId, (p) => ({ ...p, liked: 결과.liked, like_count: 결과.like_count ?? p.like_count }));
    },
  });

  const voteMutation = useMutation({
    mutationFn: ({ postId, optionIndex }: { postId: number; optionIndex: number }) =>
      communityApi.votePoll(postId, optionIndex),
    onSuccess: (r, { postId }) => {
      고치기(postId, (p) => (p.poll ? { ...p, poll: { ...p.poll, counts: r.counts, total: r.total, my_vote: r.my_vote } } : p));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (post: FeedPost) => communityApi.deletePost(post.market, post.symbol, post.id),
    /* 목록에서 먼저 뺀다. 예전에는 서버 왕복 뒤에 피드를 통째로 다시
       받아서, 지운 글이 한참 그대로 남아 있었다 */
    onMutate: (post) => 미리<피드자료>(queryKey, (앞) => 글빼기(앞, post.id)),
    onError: (_e, _v, ctx) => 되돌리기(ctx),
  });

  /** 마우스를 올리면 그 목록의 첫 쪽을 미리 받는다(PC) */
  const 미리받기 = (o: { sort?: SortType; market?: MarketFilter; type?: FeedType }) => {
    const s = o.sort ?? sort, m = o.market ?? marketFilter, t = o.type ?? feedType;
    qc.prefetchInfiniteQuery({
      queryKey: ["feed", s, m, t, 검색어],
      queryFn: ({ pageParam }) =>
        communityApi.getFeed(pageParam as number, s, m === "ALL" ? undefined : m, t === "following", 검색어 || undefined),
      initialPageParam: 1,
      staleTime: 30_000,
    });
  };

  const changeFeedType = (t: FeedType) => {
    if (t === "following" && !isLoggedIn) { navigate("/login"); return; }
    setFeedType(t);
  };
  const 글쓰기로 = () => navigate(isLoggedIn ? "/feed/write" : "/login");

  const 공유하기 = async (p: FeedPost) => {
    const 알림 = 공유알림(await 글공유(글주소(p.id), p.title || `${종목이름(p.name, p.symbol)} 이야기`));
    if (알림) 보이기(알림.글, 알림.종류);
  };
  const 복사하기 = async (p: FeedPost) => {
    const 알림 = 공유알림(await 링크복사(글주소(p.id)));
    if (알림) 보이기(알림.글, 알림.종류);
  };

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-3 pb-24 lg:pb-6">
      <h1 className="sr-only">피드</h1>

      {/* 위쪽 1 — 전체 | 팔로잉 ··· 검색 (PC 는 글쓰기도) */}
      <UnderlineTabs
        ariaLabel="피드 종류"
        tabs={피드종류}
        active={feedType}
        onChange={(id) => changeFeedType(id as FeedType)}
        onHover={(id) => 미리받기({ type: id as FeedType })}
        끝={<>
          <button type="button" aria-label={검색열림 ? "검색 닫기" : "검색"} aria-expanded={검색열림}
            onClick={() => (검색열림 ? 검색닫기() : set검색열림(true))}
            className={cn("p-2 rounded-full transition-colors",
              검색열림 ? "text-accent-blue bg-accent-blue/10" : "text-text-muted hover:text-text-primary hover:bg-bg-elevated")}>
            {검색열림 ? <X size={20} /> : <Search size={20} />}
          </button>
          {넓음 && (
            <Button size="sm" onClick={글쓰기로} className="ml-1 flex items-center gap-1.5 py-1.5">
              <PenLine size={14} />글쓰기
            </Button>
          )}
        </>}
      />

      {검색열림 && (
        <div className="relative fade-in">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-dim pointer-events-none" />
          <input
            type="search"
            aria-label="피드 검색"
            autoFocus
            value={검색입력}
            onChange={(e) => set검색입력(e.target.value)}
            placeholder="종목·제목·내용·태그로 검색"
            maxLength={50}
            // 브라우저가 search 칸에 따로 붙이는 지우기(×)는 감춘다 — 오른쪽의 '검색어 지우기' 와 × 가 둘이 됐다
            className="w-full pl-9 pr-9 py-2.5 bg-bg-card border border-border rounded-xl text-sm text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-blue/50 transition-colors [&::-webkit-search-cancel-button]:hidden"
          />
          {검색입력 && (
            <button onClick={() => set검색입력("")} aria-label="검색어 지우기"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-full text-text-dim hover:text-text-primary hover:bg-bg-elevated transition-colors">
              <X size={13} />
            </button>
          )}
        </div>
      )}

      {/* 위쪽 2 — 시장 칩 ··· 정렬 */}
      <div className="flex items-center gap-2">
        <ChipTabs ariaLabel="시장" tabs={시장칩} active={marketFilter} className="flex-1 min-w-0"
          onChange={(id) => setMarketFilter(id as MarketFilter)}
          onHover={(id) => 미리받기({ market: id as MarketFilter })} />
        <button type="button" onClick={() => setSort(sort === "latest" ? "likes" : "latest")}
          onMouseEnter={() => 미리받기({ sort: sort === "latest" ? "likes" : "latest" })}
          aria-label={`정렬 바꾸기 — 지금 ${sort === "latest" ? "최신순" : "좋아요순"}`}
          className={cn(칩탭모양(false), "flex-shrink-0")}>
          <ArrowUpDown size={13} />
          {sort === "latest" ? "최신순" : "좋아요순"}
        </button>
      </div>

      {isError && (
        <div className="flex flex-col items-center justify-center py-14 gap-3 text-text-dim">
          <AlertCircle size={32} className="opacity-30" />
          <p className="text-sm">피드를 불러올 수 없습니다</p>
          <Button onClick={() => refetch()} variant="link" className="text-xs">다시 시도</Button>
        </div>
      )}

      {isLoading && !isError && <목록뼈대 />}

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
            hint="종목코드나 종목명으로도 찾을 수 있어요. 시장 칩이 골라져 있으면 '전체' 로 풀어보세요"
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
            action={{ label: "첫 글 쓰기", onClick: () => navigate("/feed/write") }}
          />
        )
      )}

      {!isLoading && !isError && posts.length > 0 && (
        <>
          {/* 한 장으로 — 휴대폰은 화면 끝까지(바깥 여백만큼 당긴다), PC 는 테두리 두른 판 */}
          <div className={cn(
            "-mx-3 md:mx-0 bg-bg-card border-y md:border border-border md:rounded-2xl divide-y divide-border transition-opacity duration-150",
            isFetching && !isFetchingNextPage ? "opacity-60" : "opacity-100",
          )}>
            {posts.map((post) => (
              <FeedRow
                key={post.id}
                post={post}
                onLike={(id) => likeMutation.mutate(id)}
                onVote={(postId, optionIndex) => voteMutation.mutate({ postId, optionIndex })}
                onOpen={(p) => navigate(`/post/${p.id}`)}
                onComments={(p) => set댓글글(p)}
                onDelete={(p) => set지울글(p)}
                onReport={(p) => set신고할글(p)}
                onShare={공유하기}
                onCopy={복사하기}
                onImage={set크게볼사진}
              />
            ))}
          </div>

          {/* 끝 표시 — 여기가 보이기 조금 전에 다음 쪽을 받는다 */}
          <div ref={끝표시} className="flex flex-col items-center gap-2 py-3">
            {isFetchingNextPage ? (
              <span role="status" className="flex items-center gap-1.5 text-xs text-text-dim">
                <Loader2 size={14} className="animate-spin" />더 불러오는 중
              </span>
            ) : hasNextPage ? (
              /* 저절로 붙지만, 화면 읽기·키보드로 쓰는 사람이 직접 누를 수 있게 남긴다 */
              <button type="button" onClick={() => fetchNextPage()}
                className="text-xs font-semibold text-text-muted hover:text-text-primary px-3 py-1.5 rounded-full border border-border">
                더 보기
              </button>
            ) : (
              <p className="text-2xs text-text-dim">글 {total.toLocaleString()}개를 모두 봤어요</p>
            )}
          </div>
        </>
      )}

      {/* 글쓰기 — 휴대폰은 오른쪽 아래 둥근 단추(아래 탭 바로 위). 스크롤해도 늘 그 자리에 있다 */}
      {!넓음 && (
        <button type="button" aria-label="글쓰기" onClick={글쓰기로}
          className="fixed right-4 z-30 w-14 h-14 rounded-full bg-accent-blue text-white shadow-float flex items-center justify-center active:scale-95 transition-transform"
          style={{ bottom: "calc(3.5rem + env(safe-area-inset-bottom) + 1rem)" }}>
          <PenLine size={22} />
        </button>
      )}

      {/* 글 삭제는 되돌릴 수 없다 — 어느 글을 지우는지 보여 준다(목록에서 옆줄을 잘못 누르는 것이 가장 흔한 실수다) */}
      {지울글 && (
        <ConfirmDialog
          title="글을 삭제할까요?"
          message="지운 글은 되돌릴 수 없습니다. 달린 댓글도 함께 사라집니다."
          대상={`${종목이름(지울글.name, 지울글.symbol)} · ${글요약(지울글)}`}
          확인글="삭제"
          진행중={deleteMutation.isPending}
          onConfirm={() => { deleteMutation.mutate(지울글); set지울글(null); }}
          onClose={() => set지울글(null)}
        />
      )}

      {신고할글 && (
        <신고창 무엇="글" 대상={글요약(신고할글)} 닫기={() => set신고할글(null)}
          보내기={(사유) => 신고보내기(() => communityApi.reportPost(신고할글.id, 사유), "글", 보이기)} />
      )}

      {크게볼사진 && <사진보기 주소={크게볼사진} 닫기={() => set크게볼사진(null)} />}

      {/* 댓글 — 아래에서 올라온다(댓글 쓰기·좋아요·투표까지 그대로). 거기서 바뀐 것은 목록의 그 글만 고친다 —
          쪽을 여럿 받아 둔 목록을 통째로 다시 받지 않는다 */}
      {댓글글 && (
        <PostDetailModal
          post={댓글글 as any}
          onClose={() => set댓글글(null)}
          onLikeToggled={(id, liked, n) => 고치기(id, (p) => ({ ...p, liked, like_count: n }))}
          onVoteUpdated={(id, counts, total, my_vote) =>
            고치기(id, (p) => (p.poll ? { ...p, poll: { ...p.poll, counts, total, my_vote } } : p))}
          onCommentCount={(id, n) => 고치기(id, (p) => ({ ...p, comment_count: n }))}
          onDeleted={(id) => { set댓글글(null); qc.setQueryData<피드자료>(queryKey, (앞) => 글빼기(앞, id)); }}
        />
      )}
      {알림화면}
    </div>
  );
}
