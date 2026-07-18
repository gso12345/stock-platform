import { useState, useEffect, useMemo } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuthStore } from "@/store/authStore";
import { communityApi, portfolioApi, dashboardApi } from "@/api/stocks";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { User, Save, Palette, Globe, Lock, FileText, Users, BarChart2 } from "lucide-react";
import PostDetailModal from "@/components/community/PostDetailModal";
import type { ModalPost } from "@/components/community/PostDetailModal";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { fmtKRWCompact } from "@/utils/formatters";

const PIE_COLORS = ["#3b82f6","#10b981","#f59e0b","#8b5cf6","#ef4444","#06b6d4","#f97316","#84cc16","#ec4899","#14b8a6","#6366f1"];

type MyPfViewMode = "account" | "type" | "all";

function assetTypeMy(market: string, name?: string): string {
  if (market === "ETF" || (name || "").toLowerCase().includes("etf")) return "ETF";
  if (market === "KR") return "국내주식";
  return "해외주식";
}

const AVATAR_COLORS_DISPLAY = [
  { label: "파랑", dot: "bg-blue-500",    ring: "bg-blue-500/20 text-blue-400 border-blue-500/30"    },
  { label: "보라", dot: "bg-purple-500",  ring: "bg-purple-500/20 text-purple-400 border-purple-500/30"  },
  { label: "초록", dot: "bg-emerald-500", ring: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
  { label: "황금", dot: "bg-amber-500",   ring: "bg-amber-500/20 text-amber-400 border-amber-500/30"   },
  { label: "빨강", dot: "bg-rose-500",    ring: "bg-rose-500/20 text-rose-400 border-rose-500/30"    },
  { label: "하늘", dot: "bg-cyan-500",    ring: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30"    },
];

function MyPortfolioSection({
  portfolios,
  allItems,
  exchangeRate,
}: {
  portfolios: any[];
  allItems: any[];
  exchangeRate: number;
}) {
  const [viewMode, setViewMode] = useState<MyPfViewMode>("account");
  const [selectedPfId, setSelectedPfId] = useState<number>(portfolios[0]?.id ?? 0);

  const pfItemsWithKRW = useMemo(() => {
    return portfolios.map((pf: any) => {
      const items = allItems.filter((i: any) => i.portfolioId === pf.id);
      const enriched = items.map((item: any) => {
        const fx = item.currency === "USD" ? (item.inputExchangeRate ?? exchangeRate) : 1;
        return {
          symbol: item.symbol,
          name: item.name || item.symbol,
          market: item.market,
          assetType: assetTypeMy(item.market, item.name),
          value: (item.avgPrice ?? 0) * fx * item.shares,
        };
      }).sort((a: any, b: any) => b.value - a.value);
      return { ...pf, enriched };
    });
  }, [portfolios, allItems, exchangeRate]);

  const allEnriched = useMemo(() => {
    const combined: Record<string, { symbol: string; name: string; market: string; assetType: string; value: number }> = {};
    pfItemsWithKRW.forEach((pf) => {
      pf.enriched.forEach((item: any) => {
        if (combined[item.symbol]) combined[item.symbol].value += item.value;
        else combined[item.symbol] = { ...item };
      });
    });
    return Object.values(combined).sort((a, b) => b.value - a.value);
  }, [pfItemsWithKRW]);

  const typeGroups = useMemo(() => {
    const map: Record<string, number> = {};
    allEnriched.forEach((item) => { map[item.assetType] = (map[item.assetType] ?? 0) + item.value; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));
  }, [allEnriched]);

  const selectedPf = pfItemsWithKRW.find((pf) => pf.id === selectedPfId) ?? pfItemsWithKRW[0];
  const VIEW_TABS: { key: MyPfViewMode; label: string }[] = [
    { key: "account", label: "계좌별" },
    { key: "type", label: "자산유형별" },
    { key: "all", label: "전체" },
  ];

  return (
    <div className="bg-bg-card border border-border rounded-2xl p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart2 size={15} className="text-accent-blue" />
          <h2 className="text-sm font-bold text-text-primary">내 포트폴리오</h2>
        </div>
        <div className="flex gap-0.5 p-0.5 rounded-lg border border-border bg-bg-elevated">
          {VIEW_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setViewMode(t.key)}
              className={`px-2.5 py-1 rounded-md text-2xs font-semibold transition-all ${viewMode === t.key ? "bg-accent-blue text-white" : "text-text-muted hover:text-text-primary"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* 계좌별 */}
      {viewMode === "account" && (
        <div className="flex flex-col gap-3">
          {portfolios.length > 1 && (
            <div className="flex gap-1 flex-wrap">
              {pfItemsWithKRW.map((pf) => (
                <button
                  key={pf.id}
                  onClick={() => setSelectedPfId(pf.id)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${selectedPfId === pf.id ? "bg-accent-blue text-white" : "border border-border text-text-muted hover:text-text-primary"}`}
                >
                  {pf.name}
                </button>
              ))}
            </div>
          )}
          {selectedPf?.enriched.length === 0 ? (
            <p className="text-xs text-text-dim text-center py-4">종목 없음</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={selectedPf?.enriched ?? []} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={68} innerRadius={28} isAnimationActive animationBegin={0} animationDuration={600} animationEasing="ease-out">
                    {(selectedPf?.enriched ?? []).map((_: any, i: number) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: "#1e2435", border: "1px solid #2d3655", borderRadius: 8, fontSize: 11, color: "#e2e8f0" }} itemStyle={{ color: "#e2e8f0" }} labelStyle={{ display: "none" }} formatter={(v: any) => [fmtKRWCompact(Number(v)), ""]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-col gap-1">
                {(selectedPf?.enriched ?? []).map((entry: any, i: number) => {
                  const total = (selectedPf?.enriched ?? []).reduce((s: number, d: any) => s + d.value, 0);
                  const pct = total > 0 ? (entry.value / total) * 100 : 0;
                  return (
                    <div key={entry.symbol} className="flex items-center gap-2 py-0.5">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                      <span className="flex-1 text-xs text-text-secondary truncate">{entry.name}</span>
                      <span className="text-xs font-mono font-semibold text-text-primary w-12 text-right">{pct.toFixed(1)}%</span>
                      <span className="text-xs font-mono text-text-muted text-right w-20 hidden sm:block">{fmtKRWCompact(entry.value)}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* 자산유형별 */}
      {viewMode === "type" && (
        <div className="flex flex-col gap-3">
          {typeGroups.length === 0 ? (
            <p className="text-xs text-text-dim text-center py-4">종목 없음</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={typeGroups} dataKey="value" nameKey="label" cx="50%" cy="50%" outerRadius={68} innerRadius={28} isAnimationActive animationBegin={0} animationDuration={600} animationEasing="ease-out">
                    {typeGroups.map((_: any, i: number) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: "#1e2435", border: "1px solid #2d3655", borderRadius: 8, fontSize: 11, color: "#e2e8f0" }} itemStyle={{ color: "#e2e8f0" }} labelStyle={{ display: "none" }} formatter={(v: any) => [fmtKRWCompact(Number(v)), ""]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-col gap-1">
                {typeGroups.map((g, i) => {
                  const total = typeGroups.reduce((s, x) => s + x.value, 0);
                  const pct = total > 0 ? (g.value / total) * 100 : 0;
                  return (
                    <div key={g.label} className="flex items-center gap-2 py-0.5">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                      <span className="flex-1 text-xs text-text-secondary">{g.label}</span>
                      <span className="text-xs font-mono font-semibold text-text-primary w-12 text-right">{pct.toFixed(1)}%</span>
                      <span className="text-xs font-mono text-text-muted text-right w-20 hidden sm:block">{fmtKRWCompact(g.value)}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* 전체 */}
      {viewMode === "all" && (
        <div className="flex flex-col gap-3">
          {allEnriched.length === 0 ? (
            <p className="text-xs text-text-dim text-center py-4">종목 없음</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={allEnriched} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={68} innerRadius={28} isAnimationActive animationBegin={0} animationDuration={600} animationEasing="ease-out">
                    {allEnriched.map((_: any, i: number) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: "#1e2435", border: "1px solid #2d3655", borderRadius: 8, fontSize: 11, color: "#e2e8f0" }} itemStyle={{ color: "#e2e8f0" }} labelStyle={{ display: "none" }} formatter={(v: any) => [fmtKRWCompact(Number(v)), ""]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-col gap-1">
                {allEnriched.map((entry: any, i: number) => {
                  const total = allEnriched.reduce((s, d) => s + d.value, 0);
                  const pct = total > 0 ? (entry.value / total) * 100 : 0;
                  return (
                    <div key={entry.symbol} className="flex items-center gap-2 py-0.5">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                      <span className="flex-1 text-xs text-text-secondary truncate">{entry.name}</span>
                      <span className="text-xs font-mono font-semibold text-text-primary w-12 text-right">{pct.toFixed(1)}%</span>
                      <span className="text-xs font-mono text-text-muted text-right w-20 hidden sm:block">{fmtKRWCompact(entry.value)}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
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

  const [nickname, setNickname] = useState("");
  const [avatarColor, setAvatarColor] = useState(0);
  const [bio, setBio] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visibilityMap, setVisibilityMap] = useState<Record<number, boolean>>({});
  const [selectedPost, setSelectedPost] = useState<ModalPost | null>(null);
  const [loadingPostId, setLoadingPostId] = useState<number | null>(null);

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
    <div className="max-w-lg mx-auto py-6 flex flex-col gap-6">
      {/* 페이지 헤더 */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-2xl bg-accent-blue/10 flex items-center justify-center">
          <User size={20} className="text-accent-blue" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-text-primary">내 프로필</h1>
          <p className="text-xs text-text-dim">프로필을 설정하세요</p>
        </div>
      </div>

      {isLoading ? (
        <div className="bg-bg-card border border-border rounded-2xl p-6 animate-pulse flex flex-col gap-4">
          <div className="h-4 bg-bg-elevated rounded w-32" />
          <div className="h-10 bg-bg-elevated rounded" />
          <div className="h-4 bg-bg-elevated rounded w-24" />
          <div className="h-20 bg-bg-elevated rounded" />
        </div>
      ) : (
        <div className="bg-bg-card border border-border rounded-2xl p-6 flex flex-col gap-5">

          {/* 아바타 미리보기 + 팔로워/팔로잉 통계 */}
          <div className="flex items-center gap-3 pb-1">
            <div
              className={`w-14 h-14 rounded-full border-2 flex items-center justify-center font-bold text-xl shrink-0 ${colorCls.ring}`}
            >
              {displayName[0]?.toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-text-primary">{displayName}</p>
              <p className="text-xs text-text-dim">@{username}</p>
              {publicProfile && (
                <div className="flex items-center gap-3 mt-1.5">
                  <span className="flex items-center gap-1 text-xs text-text-dim">
                    <Users size={11} />
                    <span className="font-semibold text-text-secondary">{publicProfile.follower_count}</span>
                    {" "}팔로워
                  </span>
                  <span className="flex items-center gap-1 text-xs text-text-dim">
                    <span className="font-semibold text-text-secondary">{publicProfile.following_count}</span>
                    {" "}팔로잉
                  </span>
                </div>
              )}
            </div>
            {userId && (
              <Link
                to={`/profile/${userId}`}
                className="text-xs text-accent-blue hover:underline shrink-0"
              >
                공개 프로필
              </Link>
            )}
          </div>

          <div className="h-px bg-border" />

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

          {/* 오류 */}
          {error && <p className="text-xs text-accent-red">{error}</p>}

          {/* 저장 버튼 */}
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
      {allPortfolioItems && allPortfolioItems.length > 0 && portfolios && portfolios.length > 0 && (
        <MyPortfolioSection portfolios={portfolios} allItems={allPortfolioItems} exchangeRate={exchangeRate} />
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
        />
      )}
    </div>
  );
}
