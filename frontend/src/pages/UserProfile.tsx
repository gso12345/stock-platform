import { useState, useEffect, useMemo, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import { communityApi, portfolioApi, dashboardApi, watchlistApi } from "@/api/stocks";
import { useAuthStore } from "@/store/authStore";
import { usePricesStream } from "@/hooks/useWebSocket";
import PortfolioChart from "@/components/portfolio/PortfolioChart";

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

type FollowModalType = "followers" | "following" | null;

interface FollowUser {
  user_id: number;
  username: string;
  nickname: string | null;
  avatar_color: number;
}

export default function UserProfile() {
  const { userId: userIdStr } = useParams<{ userId: string }>();
  const userId = Number(userIdStr);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { isLoggedIn } = useAuthStore();
  const [followModal, setFollowModal] = useState<FollowModalType>(null);

  const { data: profile, isLoading, isError, isFetching } = useQuery({
    queryKey: ["userPublicProfile", userId],
    queryFn: () => communityApi.getUserPublicProfile(userId),
    enabled: !!userId,
    staleTime: 120_000,
  });

  const { data: activity } = useQuery({
    queryKey: ["userActivity", userId],
    queryFn: () => communityApi.getUserActivity(userId),
    enabled: !!userId,
  });

  useEffect(() => {
    if (!activity?.items) return;
    activity.items.forEach((item: any) => {
      const postId = item.type === "post" ? item.id : item.post_id;
      qc.prefetchQuery({
        queryKey: ["post", postId],
        queryFn: () => communityApi.getPost(postId),
        staleTime: 120_000,
      });
    });
  }, [activity, qc]);

  const openActivityPost = (postId: number) => {
    navigate(`/post/${postId}`);
  };

  const { data: followersData } = useQuery({
    queryKey: ["userFollowers", userId],
    queryFn: () => communityApi.getFollowers(userId),
    enabled: followModal === "followers",
  });

  const { data: followingData } = useQuery({
    queryKey: ["userFollowing", userId],
    queryFn: () => communityApi.getFollowing(userId),
    enabled: followModal === "following",
  });

  const { data: publicPortfolios } = useQuery({
    queryKey: ["publicPortfolios", userId],
    queryFn: () => portfolioApi.getPublicPortfolios(userId),
    enabled: !!userId,
    staleTime: 120_000,
  });

  const { data: usRatesData } = useQuery({
    queryKey: ["dashboard-us-rates"],
    queryFn: () => dashboardApi.getUSRates(),
    staleTime: 300_000,
  });
  const exchangeRate: number = useMemo(() => {
    if (Array.isArray(usRatesData)) {
      const row = (usRatesData as any[]).find((r: any) => r.name === "원/달러");
      if (row?.value) return row.value;
    }
    return 1350;
  }, [usRatesData]);

  // 현금 제외한 가격 조회 가능 종목 추출
  const priceableItems = useMemo(() => {
    if (!publicPortfolios) return [];
    return (publicPortfolios as any[])
      .flatMap((pf: any) => pf.items ?? [])
      .filter((i: any) => i.assetClass !== "현금");
  }, [publicPortfolios]);

  // HTTP 배치 가격 (1분 주기 갱신)
  const { data: batchPrices } = useQuery({
    queryKey: ["public-portfolio-prices", userId, priceableItems.map((i: any) => `${i.market}:${i.symbol}`).join(",")],
    queryFn: () => watchlistApi.getPrices(
      priceableItems.map((i: any) => i.symbol),
      priceableItems.map((i: any) => i.market),
    ),
    enabled: priceableItems.length > 0,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  // WebSocket 실시간 가격
  const [wsPrices, setWsPrices] = useState<any[] | null>(null);
  const priceSymbols = useMemo(() => priceableItems.map((i: any) => i.symbol), [priceableItems]);
  const priceMarkets = useMemo(() => priceableItems.map((i: any) => i.market), [priceableItems]);
  usePricesStream(priceSymbols, priceMarkets, useCallback((prices: any[]) => {
    setWsPrices(prices);
  }, []));
  const effectivePrices = wsPrices ?? batchPrices;

  // item.id → 현재가 맵
  const priceMap = useMemo(() => {
    const map: Record<number, number> = {};
    if (Array.isArray(effectivePrices)) {
      priceableItems.forEach((item: any, i: number) => {
        const d = (effectivePrices as any[])[i];
        if (d?.price != null) map[item.id] = d.price;
      });
    }
    return map;
  }, [priceableItems, effectivePrices]);

  // 실시간 평가금액 적용된 포트폴리오
  const enrichedPortfolios = useMemo(() => {
    if (!publicPortfolios) return [];
    return (publicPortfolios as any[]).map((pf: any) => ({
      ...pf,
      items: (pf.items ?? []).map((i: any) => {
        const currentPrice = priceMap[i.id];
        // YF 실시간 가격은 항상 USD — currency 필드 오설정과 무관하게 market 기준으로 환산
        const isUSDStock = i.market === "US" || i.market === "ETF";
        const fx = isUSDStock ? exchangeRate : 1;
        const currentValueKRW = currentPrice != null && currentPrice > 0
          ? currentPrice * fx * i.shares
          : undefined;
        return { ...i, currentValueKRW };
      }),
    }));
  }, [publicPortfolios, priceMap, exchangeRate]);

  const followMutation = useMutation({
    mutationFn: () => communityApi.toggleFollow(userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["userPublicProfile", userId] });
    },
  });

  if (isLoading || (isFetching && !profile)) {
    return (
      <div className="max-w-2xl mx-auto py-6 flex flex-col gap-4">
        <div className="bg-bg-card border border-border rounded-2xl p-6 animate-pulse flex flex-col gap-4">
          <div className="flex gap-4">
            <div className="w-20 h-20 rounded-full bg-bg-elevated" />
            <div className="flex flex-col gap-2 flex-1">
              <div className="h-5 bg-bg-elevated rounded w-40" />
              <div className="h-4 bg-bg-elevated rounded w-24" />
              <div className="h-3 bg-bg-elevated rounded w-full" />
            </div>
          </div>
        </div>
        <p className="text-xs text-text-dim text-center">서버 연결 중... (재시도 중)</p>
      </div>
    );
  }

  if (isError || !profile) {
    return (
      <div className="max-w-2xl mx-auto py-10 flex flex-col items-center gap-3 text-text-dim">
        <AlertCircle size={32} className="opacity-30" />
        <p className="text-sm">프로필을 불러올 수 없습니다</p>
        <p className="text-xs text-text-dim">서버가 응답하지 않거나 존재하지 않는 사용자입니다</p>
        <button onClick={() => navigate(-1)} className="text-xs text-accent-blue hover:underline mt-1">
          돌아가기
        </button>
      </div>
    );
  }

  const avatarCls = AVATAR_COLORS[(profile.avatar_color ?? 0) % AVATAR_COLORS.length];
  const displayName = profile.nickname || profile.username;
  const isMe = profile.is_me;
  const isFollowing = profile.is_following;

  const handleFollowClick = () => {
    if (!isLoggedIn) {
      navigate("/login");
      return;
    }
    followMutation.mutate();
  };

  const modalUsers: FollowUser[] =
    followModal === "followers" ? (followersData ?? []) : (followingData ?? []);

  return (
    <div className="max-w-2xl mx-auto py-6 flex flex-col gap-5">
      {/* 프로필 카드 */}
      <div className="bg-bg-card border border-border rounded-2xl p-6 flex flex-col gap-4">
        <div className="flex gap-4 items-start">
          {/* 아바타 */}
          {profile.avatar_url ? (
            <img src={profile.avatar_url} alt={displayName}
              className="w-20 h-20 rounded-full object-cover border-2 border-border shrink-0" />
          ) : (
            <div className={`w-20 h-20 rounded-full border-2 flex items-center justify-center font-bold text-3xl shrink-0 ${avatarCls}`}>
              {displayName[0]?.toUpperCase()}
            </div>
          )}

          {/* 정보 */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div>
                <h1 className="text-xl font-bold text-text-primary">{displayName}</h1>
                <p className="text-sm text-text-dim">@{profile.username}</p>
              </div>
              {isMe ? (
                <Link
                  to="/mypage"
                  className="px-4 py-1.5 text-sm font-semibold rounded-xl border border-border text-text-secondary hover:border-accent-blue/50 hover:text-accent-blue transition-all"
                >
                  프로필 편집
                </Link>
              ) : (
                <button
                  onClick={handleFollowClick}
                  disabled={followMutation.isPending}
                  className={`px-4 py-1.5 text-sm font-semibold rounded-xl transition-all disabled:opacity-50 ${
                    isFollowing
                      ? "border border-border text-text-secondary hover:border-accent-red/50 hover:text-accent-red"
                      : "bg-accent-blue text-white hover:bg-accent-blue/90"
                  }`}
                >
                  {isFollowing ? "팔로잉" : "팔로우"}
                </button>
              )}
            </div>

            {profile.bio && (
              <p className="text-sm text-text-secondary mt-2 leading-relaxed">{profile.bio}</p>
            )}

            {/* 통계 */}
            <div className="flex items-center gap-5 mt-3">
              <button
                onClick={() => setFollowModal("followers")}
                className="flex flex-col items-center hover:text-accent-blue transition-colors group"
              >
                <span className="text-base font-bold text-text-primary group-hover:text-accent-blue">
                  {profile.follower_count}
                </span>
                <span className="text-xs text-text-dim">팔로워</span>
              </button>
              <button
                onClick={() => setFollowModal("following")}
                className="flex flex-col items-center hover:text-accent-blue transition-colors group"
              >
                <span className="text-base font-bold text-text-primary group-hover:text-accent-blue">
                  {profile.following_count}
                </span>
                <span className="text-xs text-text-dim">팔로잉</span>
              </button>
              <div className="flex flex-col items-center">
                <span className="text-base font-bold text-text-primary">{profile.post_count}</span>
                <span className="text-xs text-text-dim">게시글</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 공개 포트폴리오 (실시간 가격 연동) */}
      {enrichedPortfolios.length > 0 && (
        <PortfolioChart portfolios={enrichedPortfolios} exchangeRate={exchangeRate} title="공개 포트폴리오" />
      )}

      {/* 최근 활동 */}
      <div className="bg-bg-card border border-border rounded-2xl p-5 flex flex-col gap-3">
        <h2 className="text-sm font-bold text-text-primary">최근 활동</h2>
        {!activity?.items || activity.items.length === 0 ? (
          <p className="text-xs text-text-dim text-center py-4">활동 내역이 없습니다</p>
        ) : (
          <div className="flex flex-col divide-y divide-border/50">
            {activity.items.map((item: any, idx: number) => {
              const postId = item.type === "post" ? item.id : item.post_id;
              return (
                <div key={idx} className="flex gap-3 py-2.5">
                  <span
                    className={`text-2xs font-bold px-1.5 py-0.5 rounded shrink-0 h-fit mt-0.5 ${
                      item.type === "post"
                        ? "bg-accent-blue/15 text-accent-blue"
                        : "bg-purple-500/15 text-purple-400"
                    }`}
                  >
                    {item.type === "post" ? "게시글" : "댓글"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <button
                      onClick={() => openActivityPost(postId)}
                      className="text-sm text-text-secondary hover:text-accent-blue transition-colors line-clamp-2 break-words text-left w-full"
                    >
                      {item.type === "post" ? (item.title || item.body) : item.content}
                    </button>
                    {item.market && item.symbol && (
                      <span className="text-2xs text-text-dim">
                        {item.market} · {item.symbol}
                      </span>
                    )}
                    <p className="text-2xs text-text-dim mt-0.5">{timeAgo(item.created_at)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 팔로워/팔로잉 모달 */}
      {followModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setFollowModal(null);
          }}
        >
          <div className="w-full max-w-sm bg-bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="text-sm font-bold text-text-primary">
                {followModal === "followers" ? "팔로워" : "팔로잉"}
              </h3>
              <button
                onClick={() => setFollowModal(null)}
                className="text-text-muted hover:text-text-primary transition-colors w-6 h-6 flex items-center justify-center text-lg"
              >
                ×
              </button>
            </div>
            <div className="px-4 py-3 max-h-80 overflow-y-auto flex flex-col gap-1">
              {modalUsers.length === 0 ? (
                <p className="text-xs text-text-dim text-center py-4">
                  {followModal === "followers"
                    ? "팔로워가 없습니다"
                    : "팔로잉하는 유저가 없습니다"}
                </p>
              ) : (
                modalUsers.map((u) => {
                  const cls = AVATAR_COLORS[(u.avatar_color ?? 0) % AVATAR_COLORS.length];
                  const name = u.nickname || u.username;
                  return (
                    <Link
                      key={u.user_id}
                      to={`/profile/${u.user_id}`}
                      onClick={() => setFollowModal(null)}
                      className="flex items-center gap-3 py-2 hover:bg-bg-elevated rounded-xl px-2 transition-colors"
                    >
                      <div
                        className={`w-9 h-9 rounded-full border flex items-center justify-center font-bold text-sm shrink-0 ${cls}`}
                      >
                        {name[0]?.toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-text-primary">{name}</p>
                        <p className="text-xs text-text-dim">@{u.username}</p>
                      </div>
                    </Link>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
