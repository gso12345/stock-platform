import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/store/authStore";
import { communityApi, portfolioApi, dashboardApi, watchlistApi } from "@/api/stocks";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, Palette, Globe, Lock, FileText } from "lucide-react";
import PostDetailModal from "@/components/community/PostDetailModal";
import type { ModalPost } from "@/components/community/PostDetailModal";
import PortfolioChart from "@/components/portfolio/PortfolioChart";

const AVATAR_COLORS_DISPLAY = [
  { label: "파랑", dot: "bg-blue-500",    ring: "bg-blue-500/20 text-blue-400 border-blue-500/30"    },
  { label: "보라", dot: "bg-purple-500",  ring: "bg-purple-500/20 text-purple-400 border-purple-500/30"  },
  { label: "초록", dot: "bg-emerald-500", ring: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
  { label: "황금", dot: "bg-amber-500",   ring: "bg-amber-500/20 text-amber-400 border-amber-500/30"   },
  { label: "빨강", dot: "bg-rose-500",    ring: "bg-rose-500/20 text-rose-400 border-rose-500/30"    },
  { label: "하늘", dot: "bg-cyan-500",    ring: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30"    },
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

export default function MyPage() {
  const { isLoggedIn, username, userId } = useAuthStore();
  const navigate = useNavigate();
  const qc = useQueryClient();

  useEffect(() => {
    if (!isLoggedIn) navigate("/login");
  }, [isLoggedIn, navigate]);

  const { data: profile, isLoading } = useQuery({
    queryKey: ["myProfile"],
    queryFn: communityApi.getMyProfile,
    enabled: isLoggedIn,
  });

  const { data: publicProfile } = useQuery({
    queryKey: ["userPublicProfile", userId],
    queryFn: () => communityApi.getUserPublicProfile(userId!),
    enabled: isLoggedIn && !!userId,
  });

  const { data: portfolios } = useQuery({
    queryKey: ["portfolios"],
    queryFn: portfolioApi.getPortfolios,
    enabled: isLoggedIn,
  });

  const { data: allPortfolioItems } = useQuery({
    queryKey: ["allPortfolioItems"],
    queryFn: () => portfolioApi.getItems(undefined, true),
    enabled: isLoggedIn,
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

  const { data: activity } = useQuery({
    queryKey: ["userActivity", userId],
    queryFn: () => communityApi.getUserActivity(userId!),
    enabled: isLoggedIn && !!userId,
  });

  const [editMode, setEditMode] = useState(false);
  const [nickname, setNickname] = useState("");
  const [avatarColor, setAvatarColor] = useState(0);
  const [bio, setBio] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visibilityMap, setVisibilityMap] = useState<Record<number, boolean>>({});
  const [selectedPost, setSelectedPost] = useState<ModalPost | null>(null);
  const [loadingPostId, setLoadingPostId] = useState<number | null>(null);

  const allSymbols = useMemo(() => {
    if (!allPortfolioItems) return [];
    return [...new Set((allPortfolioItems as any[]).map((i: any) => i.symbol))];
  }, [allPortfolioItems]);

  const allMarkets = useMemo(() => {
    if (!allPortfolioItems) return [];
    return [...new Set((allPortfolioItems as any[]).map((i: any) => i.market))];
  }, [allPortfolioItems]);

  const { data: livePrices } = useQuery({
    queryKey: ["portfolioLivePrices", allSymbols],
    queryFn: () => watchlistApi.getPrices(allSymbols, allMarkets),
    enabled: allSymbols.length > 0,
    staleTime: 60_000,
  });

  const pfForChart = useMemo(() => {
    if (!portfolios || !allPortfolioItems) return [];
    const priceMap: Record<string, any> = {};
    if (livePrices) {
      (livePrices as any[]).forEach((p: any) => { priceMap[p.symbol] = p; });
    }
    return (portfolios as any[])
      .filter((pf: any) => pf.is_public)
      .map((pf: any) => ({
        id: pf.id,
        name: pf.name,
        items: (allPortfolioItems as any[])
          .filter((i: any) => i.portfolioId === pf.id)
          .map((i: any) => {
            const lp = priceMap[i.symbol];
            const currentPriceNative = lp?.price ?? 0;
            const fx = i.currency === "USD" ? exchangeRate : 1;
            const currentValueKRW = currentPriceNative > 0
              ? currentPriceNative * fx * i.shares
              : undefined;
            return { ...i, currentValueKRW };
          }),
      }));
  }, [portfolios, allPortfolioItems, livePrices, exchangeRate]);

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

  const openActivityPost = async (postId: number) => {
    if (loadingPostId === postId) return;
    const cached = qc.getQueryData<ModalPost>(["post", postId]);
    if (cached) { setSelectedPost(cached); return; }
    setLoadingPostId(postId);
    try {
      const post = await communityApi.getPost(postId);
      qc.setQueryData(["post", postId], post);
      setSelectedPost(post);
    } catch {}
    finally { setLoadingPostId(null); }
  };

  useEffect(() => {
    if (profile) {
      setNickname(profile.nickname ?? "");
      setAvatarColor(profile.avatar_color ?? 0);
      setBio(profile.bio ?? "");
    }
  }, [profile]);

  useEffect(() => {
    if (portfolios) {
      const map: Record<number, boolean> = {};
      portfolios.forEach((pf: any) => {
        map[pf.id] = pf.is_public ?? false;
      });
      setVisibilityMap(map);
    }
  }, [portfolios]);

  const updateMutation = useMutation({
    mutationFn: () =>
      communityApi.updateMyProfile({ nickname: nickname.trim(), avatar_color: avatarColor, bio: bio.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["myProfile"] });
      setError(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
    onError: (e: any) => {
      const detail = e?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "저장에 실패했습니다.");
    },
  });

  const visibilityMutation = useMutation({
    mutationFn: ({ portfolioId, isPublic }: { portfolioId: number; isPublic: boolean }) =>
      communityApi.setPortfolioVisibility(portfolioId, isPublic),
    onSuccess: (_data, vars) => {
      setVisibilityMap((prev) => ({ ...prev, [vars.portfolioId]: vars.isPublic }));
      qc.invalidateQueries({ queryKey: ["portfolios"] });
    },
  });

  if (!isLoggedIn) return null;

  const displayName = nickname.trim() || username || "?";
  const colorCls = AVATAR_COLORS_DISPLAY[avatarColor % AVATAR_COLORS_DISPLAY.length];

  return (
    <div className="max-w-2xl mx-auto py-6 flex flex-col gap-5">
      {/* 프로필 카드 — 다른 사람에게 보이는 모습 */}
      {isLoading ? (
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
      ) : (
        <div className="bg-bg-card border border-border rounded-2xl p-6 flex flex-col gap-4">
          <div className="flex gap-4 items-start">
            <div className={`w-20 h-20 rounded-full border-2 flex items-center justify-center font-bold text-3xl shrink-0 ${colorCls.ring}`}>
              {displayName[0]?.toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div>
                  <h1 className="text-xl font-bold text-text-primary">{displayName}</h1>
                  <p className="text-sm text-text-dim">@{username}</p>
                </div>
                <button
                  onClick={() => setEditMode(v => !v)}
                  className="px-4 py-1.5 text-sm font-semibold rounded-xl border border-border text-text-secondary hover:border-accent-blue/50 hover:text-accent-blue transition-all"
                >
                  {editMode ? "닫기" : "프로필 편집"}
                </button>
              </div>
              {profile?.bio && (
                <p className="text-sm text-text-secondary mt-2 leading-relaxed">{profile.bio}</p>
              )}
              {publicProfile && (
                <div className="flex items-center gap-5 mt-3">
                  <div className="flex flex-col items-center">
                    <span className="text-base font-bold text-text-primary">{publicProfile.follower_count}</span>
                    <span className="text-xs text-text-dim">팔로워</span>
                  </div>
                  <div className="flex flex-col items-center">
                    <span className="text-base font-bold text-text-primary">{publicProfile.following_count}</span>
                    <span className="text-xs text-text-dim">팔로잉</span>
                  </div>
                  <div className="flex flex-col items-center">
                    <span className="text-base font-bold text-text-primary">{publicProfile.post_count}</span>
                    <span className="text-xs text-text-dim">게시글</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 프로필 편집 패널 (토글) */}
      {editMode && (
        <div className="bg-bg-card border border-border rounded-2xl p-6 flex flex-col gap-5">
          {/* 아이디 (읽기 전용) */}
          <div>
            <label className="block text-xs font-semibold text-text-muted mb-1.5">아이디</label>
            <input
              readOnly
              value={username ?? ""}
              className="w-full px-3 py-2.5 bg-bg-elevated border border-border rounded-xl text-sm text-text-dim cursor-not-allowed focus:outline-none"
            />
          </div>

          {/* 닉네임 */}
          <div>
            <label className="block text-xs font-semibold text-text-muted mb-1.5">닉네임</label>
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="닉네임을 입력하세요 (미설정 시 아이디로 표시)"
              maxLength={50}
              className="w-full px-3 py-2.5 bg-bg-elevated border border-border rounded-xl text-sm text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-blue/50 transition-colors"
            />
            <p className="text-2xs text-text-dim mt-1">{nickname.length}/50</p>
          </div>

          {/* 아바타 색상 */}
          <div>
            <label className="block text-xs font-semibold text-text-muted mb-2">
              <span className="flex items-center gap-1.5">
                <Palette size={11} /> 아바타 색상
              </span>
            </label>
            <div className="flex gap-2 flex-wrap">
              {AVATAR_COLORS_DISPLAY.map((c, idx) => (
                <button
                  key={idx}
                  onClick={() => setAvatarColor(idx)}
                  title={c.label}
                  className={`w-8 h-8 rounded-full ${c.dot} transition-all ${
                    avatarColor === idx
                      ? "ring-2 ring-offset-2 ring-offset-bg-card ring-white/60 scale-110"
                      : "opacity-50 hover:opacity-100 hover:scale-105"
                  }`}
                />
              ))}
            </div>
          </div>

          {/* 소개 */}
          <div>
            <label className="block text-xs font-semibold text-text-muted mb-1.5">소개</label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="간단한 자기소개를 입력하세요"
              maxLength={200}
              rows={3}
              className="w-full px-3 py-2.5 bg-bg-elevated border border-border rounded-xl text-sm text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-blue/50 resize-none transition-colors"
            />
            <p className="text-2xs text-text-dim mt-1">{bio.length}/200</p>
          </div>

          {error && <p className="text-xs text-accent-red">{error}</p>}

          <button
            onClick={() => updateMutation.mutate()}
            disabled={updateMutation.isPending}
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-accent-blue text-white text-sm font-semibold hover:bg-accent-blue/90 active:scale-[0.98] disabled:opacity-50 transition-all"
          >
            <Save size={14} />
            {updateMutation.isPending ? "저장 중..." : saved ? "저장됐습니다!" : "저장하기"}
          </button>
        </div>
      )}

      {/* 내 포트폴리오 차트 */}
      {pfForChart.length > 0 && pfForChart.some((pf: any) => pf.items.length > 0) && (
        <PortfolioChart portfolios={pfForChart} exchangeRate={exchangeRate} title="내 포트폴리오" />
      )}

      {/* 포트폴리오 공개 설정 */}
      {portfolios && portfolios.length > 0 && (
        <div className="bg-bg-card border border-border rounded-2xl p-5 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Globe size={15} className="text-accent-blue" />
            <h2 className="text-sm font-bold text-text-primary">포트폴리오 공개 설정</h2>
          </div>
          <p className="text-xs text-text-dim">공개된 포트폴리오는 다른 사용자가 내 프로필에서 볼 수 있습니다</p>
          <div className="flex flex-col gap-2">
            {portfolios.map((pf: any) => {
              const isPublic = visibilityMap[pf.id] ?? false;
              return (
                <div
                  key={pf.id}
                  className="flex items-center justify-between py-2.5 px-3 bg-bg-elevated rounded-xl"
                >
                  <div className="flex items-center gap-2">
                    {isPublic ? (
                      <Globe size={13} className="text-accent-green" />
                    ) : (
                      <Lock size={13} className="text-text-dim" />
                    )}
                    <span className="text-sm text-text-primary">{pf.name}</span>
                  </div>
                  <button
                    onClick={() =>
                      visibilityMutation.mutate({ portfolioId: pf.id, isPublic: !isPublic })
                    }
                    disabled={visibilityMutation.isPending}
                    className={`relative w-10 h-5 rounded-full transition-colors ${
                      isPublic ? "bg-accent-blue" : "bg-bg-card border border-border"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${
                        isPublic ? "left-5" : "left-0.5"
                      }`}
                    />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 최근 활동 */}
      {activity && (
        <div className="bg-bg-card border border-border rounded-2xl p-5 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <FileText size={15} className="text-accent-blue" />
            <h2 className="text-sm font-bold text-text-primary">최근 활동</h2>
          </div>
          {!activity.items || activity.items.length === 0 ? (
            <p className="text-xs text-text-dim text-center py-4">활동 내역이 없습니다</p>
          ) : (
            <div className="flex flex-col divide-y divide-border/50">
              {activity.items.map((item: any, idx: number) => {
                const postId = item.type === "post" ? item.id : item.post_id;
                const isLoading = loadingPostId === postId;
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
                        disabled={isLoading}
                        className="text-sm text-text-secondary hover:text-accent-blue transition-colors line-clamp-2 break-words text-left w-full disabled:opacity-60"
                      >
                        {isLoading ? "불러오는 중..." : (item.type === "post" ? (item.title || item.body) : item.content)}
                      </button>
                      <p className="text-2xs text-text-dim mt-0.5">{timeAgo(item.created_at)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {selectedPost && (
        <PostDetailModal
          post={selectedPost}
          onClose={() => setSelectedPost(null)}
          onDeleted={() => {
            setSelectedPost(null);
            qc.invalidateQueries({ queryKey: ["userActivity", userId] });
          }}
        />
      )}
    </div>
  );
}
