import { useState, useEffect, useMemo, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import { communityApi, portfolioApi, dashboardApi, watchlistApi } from "@/api/stocks";
import { useAuthStore } from "@/store/authStore";
import { usePricesStream } from "@/hooks/useWebSocket";
import { mergeEffectivePrices, indexPricesBySymbol, lookupPrice } from "@/utils/prices";
import PortfolioChart from "@/components/portfolio/PortfolioChart";
import { timeAgo } from "@/utils/formatters";

const AVATAR_COLORS = [
  "bg-accent-blue/20 text-accent-blue border-accent-blue/30",
  "bg-accent-purple/20 text-accent-purple border-accent-purple/30",
  "bg-accent-green/20 text-accent-green border-accent-green/30",
  "bg-accent-yellow/20 text-accent-yellow border-accent-yellow/30",
  "bg-accent-red/20 text-accent-red border-accent-red/30",
  "bg-accent-cyan/20 text-accent-cyan border-accent-cyan/30",
  "bg-accent-purple/20 text-accent-purple border-accent-purple/30",
  "bg-accent-orange/20 text-accent-orange border-accent-orange/30",
];


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
    staleTime: 120_000,
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

  const { data: fxData } = useQuery({
    queryKey: ["exchange-rate"],
    queryFn: () => dashboardApi.getExchangeRate(),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
  const exchangeRate: number = (fxData as any)?.value ?? 0;

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
  const effectivePrices = useMemo(
    () => mergeEffectivePrices(wsPrices, batchPrices),
    [wsPrices, batchPrices],
  );

  // item.id → 현재가 맵 (배열 순서가 아닌 심볼로 매칭)
  const priceBySymbol = useMemo(() => indexPricesBySymbol(effectivePrices), [effectivePrices]);
  const priceMap = useMemo(() => {
    const map: Record<number, number> = {};
    priceableItems.forEach((item: any) => {
      const d = lookupPrice(priceBySymbol, item.symbol);
      if (d?.price != null) map[item.id] = d.price;
    });
    return map;
  }, [priceableItems, priceBySymbol]);

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
        // fx=0 이면 환율 미로드 상태 — undefined 반환해 PortfolioChart 내 fallback 사용
        const currentValueKRW = currentPrice != null && currentPrice > 0 && fx > 0
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
                        : "bg-accent-purple/15 text-accent-purple"
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
          <div className="w-full max-w-sm bg-bg-card border border-border rounded-2xl shadow-modal overflow-hidden">
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
