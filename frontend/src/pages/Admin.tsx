import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import api from "@/api/client";
import {
  Users, BarChart2, Megaphone, Trash2, ToggleLeft, ToggleRight,
  ShieldCheck, RefreshCw, Activity, Database, Star, CheckCircle,
  TrendingUp, Zap, Clock, Folder, Wifi, Eye, Search, X as XIcon,
  MessageSquare, Heart, Flag, Plus, Pencil, AlertCircle,
  ExternalLink, Calendar,
} from "lucide-react";

const adminApi = {
  getStats:        () => api.get("/admin/stats").then(r => r.data),
  getUsers:        (status = "all") => api.get("/admin/users", { params: { status } }).then(r => r.data),
  getCommunityPosts: (page = 1, market?: string) =>
    api.get("/admin/community/posts", { params: { page, limit: 20, ...(market && market !== "ALL" ? { market } : {}) } }).then(r => r.data),
  deleteCommunityPost: (id: number) =>
    api.delete(`/admin/community/posts/${id}`).then(r => r.data),
  getPopular:      (basis: string) => api.get(`/admin/popular-stocks?basis=${basis}`).then(r => r.data),
  getSignups:        () => api.get("/admin/signups").then(r => r.data),
  getVisitorTrend:   () => api.get("/admin/visitor-trend").then(r => r.data),
  getSystem:       () => api.get("/admin/system").then(r => r.data),
  getDbStats:      () => api.get("/admin/db-stats").then(r => r.data),
  clearCache:      () => api.post("/admin/cache/clear").then(r => r.data),
  listCache:       (prefix?: string) => api.get("/admin/cache", { params: prefix ? { prefix } : {} }).then(r => r.data),
  deleteCache:     (key: string) => api.delete(`/admin/cache/${encodeURIComponent(key)}`).then(r => r.data),
  deleteCachePrefix: (prefix: string) => api.delete("/admin/cache", { params: { prefix } }).then(r => r.data),
  toggleActive:       (id: number) => api.patch(`/admin/users/${id}/active`).then(r => r.data),
  toggleCommunityBan: (id: number) => api.patch(`/admin/users/${id}/community-ban`).then(r => r.data),
  deleteUser:         (id: number) => api.delete(`/admin/users/${id}`).then(r => r.data),
  getAnnouncement: () => api.get("/admin/announcement").then(r => r.data),
  setAnnouncement: (text: string) => api.post("/admin/announcement", { text }).then(r => r.data),
  // 팝업
  getPopups:       () => api.get("/admin/popups").then(r => r.data),
  createPopup:     (data: any) => api.post("/admin/popups", data).then(r => r.data),
  updatePopup:     (id: number, data: any) => api.put(`/admin/popups/${id}`, data).then(r => r.data),
  deletePopup:     (id: number) => api.delete(`/admin/popups/${id}`).then(r => r.data),
  // 신고
  getReports:      (status = "pending", page = 1) => api.get("/admin/reports", { params: { status, page } }).then(r => r.data),
  blindReport:     (id: number) => api.patch(`/admin/reports/${id}/blind`).then(r => r.data),
  dismissReport:   (id: number) => api.patch(`/admin/reports/${id}/dismiss`).then(r => r.data),
  deleteReportContent: (id: number) => api.delete(`/admin/reports/${id}/content`).then(r => r.data),
  // 트렌드
  getSearchTrends: () => api.get("/admin/search-trends").then(r => r.data),
  getUsageStats:   () => api.get("/admin/usage-stats").then(r => r.data),
};

type Tab = "dashboard" | "users" | "community" | "banner" | "cache" | "reports";

export default function Admin() {
  const { isAdmin, username } = useAuthStore();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("dashboard");

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div className="w-16 h-16 rounded-2xl bg-bg-secondary border border-border flex items-center justify-center">
          <ShieldCheck size={28} className="text-text-muted/40" />
        </div>
        <p className="text-text-muted text-sm">관리자 권한이 없습니다</p>
        <button onClick={() => navigate("/")} className="px-4 py-2 rounded-lg bg-accent-blue text-white text-sm font-semibold">홈으로</button>
      </div>
    );
  }

  const TABS: { id: Tab; Icon: any; label: string }[] = [
    { id: "dashboard", Icon: BarChart2,     label: "대시보드" },
    { id: "users",     Icon: Users,         label: "유저 관리" },
    { id: "community", Icon: MessageSquare, label: "커뮤니티" },
    { id: "reports",   Icon: Flag,          label: "신고 관리" },
    { id: "banner",    Icon: Megaphone,     label: "배너·공지" },
    { id: "cache",     Icon: Database,      label: "캐시" },
  ];

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 flex flex-col gap-6">

      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent-blue/10 border border-accent-blue/20 flex items-center justify-center">
            <ShieldCheck size={20} className="text-accent-blue" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-text-primary">관리자 패널</h1>
            <p className="text-xs text-text-muted">{username}</p>
          </div>
        </div>
        <Link to="/" className="text-xs text-text-muted hover:text-text-primary transition-colors">← 앱으로 돌아가기</Link>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 border-b border-border overflow-x-auto scrollbar-hide">
        {TABS.map(({ id, Icon, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold transition-all border-b-2 -mb-px whitespace-nowrap ${
              tab === id
                ? "border-accent-blue text-accent-blue"
                : "border-transparent text-text-muted hover:text-text-primary"
            }`}
          >
            <Icon size={14} />{label}
          </button>
        ))}
      </div>

      {tab === "dashboard" && <DashboardTab qc={qc} />}
      {tab === "users"     && <UsersTab qc={qc} />}
      {tab === "community" && <CommunityAdminTab qc={qc} />}
      {tab === "reports"   && <ReportsTab qc={qc} />}
      {tab === "banner"    && <BannerTab qc={qc} />}
      {tab === "cache"     && <CacheTab qc={qc} />}
    </div>
  );
}

/* ─────────────────────────── 대시보드 탭 ─────────────────────────── */
function DashboardTab({ qc }: { qc: any }) {
  const [popularBasis, setPopularBasis] = useState<"watchlist" | "portfolio">("watchlist");
  const { data: stats }   = useQuery({ queryKey: ["admin-stats"],   queryFn: adminApi.getStats,   staleTime: 30_000 });
  const { data: popular } = useQuery({ queryKey: ["admin-popular", popularBasis], queryFn: () => adminApi.getPopular(popularBasis), staleTime: 60_000 });
  const { data: signups }      = useQuery({ queryKey: ["admin-signups"],       queryFn: adminApi.getSignups,      staleTime: 60_000 });
  const { data: visitorTrend } = useQuery({ queryKey: ["admin-visitor-trend"], queryFn: adminApi.getVisitorTrend, staleTime: 60_000 });
  const { data: system, refetch: refetchSystem } = useQuery({ queryKey: ["admin-system"], queryFn: adminApi.getSystem, staleTime: 30_000 });
  const { data: dbStats, refetch: refetchDbStats } = useQuery({ queryKey: ["admin-db-stats"], queryFn: adminApi.getDbStats, staleTime: 60_000 });
  const { data: searchTrends } = useQuery({ queryKey: ["admin-search-trends"], queryFn: adminApi.getSearchTrends, staleTime: 60_000 });
  const { data: usageStats }   = useQuery({ queryKey: ["admin-usage-stats"],   queryFn: adminApi.getUsageStats,   staleTime: 60_000 });

  const clearMut = useMutation({
    mutationFn: adminApi.clearCache,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-system"] }); refetchSystem(); },
  });

  const METRIC_CARDS = [
    { label: "전체 회원",    value: stats?.total_users       ?? 0, color: "text-accent-blue",   bg: "bg-accent-blue/8",   Icon: Users },
    { label: "활성 계정",    value: stats?.active_users      ?? 0, color: "text-accent-green",  bg: "bg-accent-green/8",  Icon: CheckCircle },
    { label: "현재 접속",    value: stats?.online_users      ?? 0, color: "text-cyan-400",      bg: "bg-cyan-400/8",      Icon: Wifi },
    { label: "오늘 방문자",  value: stats?.today_visitors    ?? 0, color: "text-orange-400",    bg: "bg-orange-400/8",    Icon: Eye },
    { label: "관심종목 폴더", value: stats?.watchlist_folders ?? 0, color: "text-amber-400",    bg: "bg-amber-400/8",     Icon: Folder },
    { label: "포트폴리오 수", value: stats?.portfolio_items  ?? 0, color: "text-purple-400",    bg: "bg-purple-400/8",    Icon: TrendingUp },
    { label: "커뮤니티 글",  value: stats?.total_posts       ?? 0, color: "text-rose-400",      bg: "bg-rose-400/8",      Icon: MessageSquare },
    { label: "커뮤니티 댓글", value: stats?.total_comments   ?? 0, color: "text-pink-400",      bg: "bg-pink-400/8",      Icon: Heart },
  ];

  const signupData: { date: string; count: number }[] = signups ?? [];
  const maxSignup    = Math.max(...signupData.map(d => d.count), 1);
  const totalMonth   = signupData.reduce((s, d) => s + d.count, 0);
  const todaySignups = signupData[signupData.length - 1]?.count ?? 0;

  const visitorData: { date: string; count: number }[] = visitorTrend ?? [];
  const maxVisitor     = Math.max(...visitorData.map(d => d.count), 1);
  const totalVisitors  = visitorData.reduce((s, d) => s + d.count, 0);
  const todayVisitors  = visitorData[visitorData.length - 1]?.count ?? 0;

  const popularList: { symbol: string; name: string; market: string; count: number }[] = popular ?? [];
  const maxPop = Math.max(...popularList.map(d => d.count), 1);

  const MARKET_COLOR: Record<string, string> = {
    KR:  "bg-accent-blue/15 text-accent-blue",
    US:  "bg-accent-green/15 text-accent-green",
    ETF: "bg-purple-400/15 text-purple-400",
  };

  return (
    <div className="flex flex-col gap-5">

      {/* 지표 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {METRIC_CARDS.map(({ label, value, color, bg, Icon }) => (
          <div key={label} className="rounded-xl border border-border bg-bg-card p-4 flex flex-col gap-3">
            <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center`}>
              <Icon size={16} className={color} />
            </div>
            <div>
              <p className="text-xs text-text-muted mb-0.5">{label}</p>
              <p className={`text-2xl font-bold font-mono ${color}`}>{value.toLocaleString()}</p>
            </div>
          </div>
        ))}
      </div>

      {/* DB 용량 */}
      {(() => {
        const LIMIT_MB = 500; // Supabase 무료 플랜 500 MB
        const LIMIT_BYTES = LIMIT_MB * 1024 * 1024;
        const usedBytes: number = dbStats?.total_bytes ?? 0;
        const pct = LIMIT_BYTES > 0 ? Math.min((usedBytes / LIMIT_BYTES) * 100, 100) : 0;
        const barColor = pct >= 90 ? "bg-accent-red" : pct >= 70 ? "bg-amber-400" : "bg-accent-green";
        return (
          <div className="rounded-xl border border-border bg-bg-card p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-text-primary flex items-center gap-1.5">
                <Database size={14} className="text-accent-blue" />DB 용량
              </span>
              <button onClick={() => refetchDbStats()} className="text-text-muted hover:text-text-primary transition-colors p-1 rounded">
                <RefreshCw size={13} />
              </button>
            </div>

            {dbStats ? (
              <>
                {/* 사용량 바 */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between items-baseline">
                    <span className="text-lg font-bold text-text-primary font-mono">{dbStats.total_pretty}</span>
                    <span className="text-xs text-text-muted">/ {LIMIT_MB} MB (Supabase 무료)</span>
                  </div>
                  <div className="w-full h-2.5 bg-bg-elevated rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-text-muted text-right">{pct.toFixed(1)}% 사용</span>
                </div>

                {/* 테이블별 용량 */}
                {dbStats.tables && dbStats.tables.length > 0 && (
                  <div className="flex flex-col gap-1 mt-1">
                    <p className="text-2xs text-text-muted font-semibold uppercase tracking-wide mb-0.5">테이블별</p>
                    {dbStats.tables.map((t: any) => {
                      const tPct = usedBytes > 0 ? Math.min((t.bytes / usedBytes) * 100, 100) : 0;
                      return (
                        <div key={t.name} className="flex items-center gap-2">
                          <span className="text-xs text-text-muted font-mono w-40 truncate shrink-0">{t.name}</span>
                          <div className="flex-1 h-1.5 bg-bg-elevated rounded-full overflow-hidden">
                            <div className="h-full bg-accent-blue/50 rounded-full" style={{ width: `${tPct}%` }} />
                          </div>
                          <span className="text-xs font-mono text-text-secondary w-14 text-right shrink-0">{t.pretty}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-center justify-center py-4">
                <div className="w-4 h-4 rounded-full border-2 border-accent-blue border-t-transparent animate-spin" />
              </div>
            )}
          </div>
        );
      })()}

      {/* 시스템 상태 + 가입 추이 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

        {/* 시스템 상태 */}
        <div className="rounded-xl border border-border bg-bg-card p-4 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-text-primary flex items-center gap-1.5">
              <Activity size={14} className="text-accent-blue" />시스템 상태
            </span>
            <button onClick={() => refetchSystem()} className="text-text-muted hover:text-text-primary transition-colors p-1 rounded">
              <RefreshCw size={13} />
            </button>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between py-2 border-b border-border/50">
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <Database size={13} />데이터베이스
              </div>
              <div className="flex items-center gap-1.5">
                {system?.db_ok !== undefined ? (
                  system.db_ok ? (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse" />
                      <span className="text-xs text-accent-green font-semibold">정상</span>
                      {system.db_latency_ms > 0 && (
                        <span className="text-[11px] text-text-muted">{system.db_latency_ms}ms</span>
                      )}
                    </>
                  ) : (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-accent-red" />
                      <span className="text-xs text-accent-red font-semibold">오류</span>
                    </>
                  )
                ) : <span className="text-xs text-text-muted">—</span>}
              </div>
            </div>

            <div className="flex items-center justify-between py-2 border-b border-border/50">
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <Zap size={13} />인메모리 캐시
              </div>
              <span className="text-xs text-text-primary font-mono">{(system?.cache_size ?? 0).toLocaleString()}건</span>
            </div>

            <div className="flex items-center justify-between py-2">
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <Clock size={13} />서버 시각 (UTC)
              </div>
              <span className="text-xs text-text-muted font-mono">
                {system?.server_time ? system.server_time.slice(11, 19) : "—"}
              </span>
            </div>
          </div>

          <button
            onClick={() => clearMut.mutate()}
            disabled={clearMut.isPending}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-border text-xs font-semibold text-text-muted hover:text-accent-red hover:border-accent-red/40 transition-all"
          >
            <RefreshCw size={12} className={clearMut.isPending ? "animate-spin" : ""} />
            {clearMut.isPending
              ? "초기화 중..."
              : clearMut.isSuccess
              ? `${clearMut.data?.cleared}건 삭제 완료`
              : "캐시 초기화"}
          </button>
        </div>

        {/* 가입 추이 */}
        <div className="rounded-xl border border-border bg-bg-card p-4 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-text-primary flex items-center gap-1.5">
              <TrendingUp size={14} className="text-accent-blue" />가입 추이
            </span>
            <span className="text-xs text-text-muted">최근 30일</span>
          </div>

          <div className="flex items-end gap-px h-20 w-full">
            {signupData.map((d, i) => {
              const pct = (d.count / maxSignup) * 100;
              const isToday = i === signupData.length - 1;
              return (
                <div key={d.date} className="flex-1 flex flex-col justify-end group relative" style={{ height: "100%" }}>
                  <div
                    className={`w-full rounded-sm transition-colors ${
                      isToday ? "bg-accent-blue" : "bg-accent-blue/30 group-hover:bg-accent-blue/60"
                    }`}
                    style={{ height: `${Math.max(pct, d.count > 0 ? 8 : 2)}%` }}
                  />
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:flex pointer-events-none z-10">
                    <div className="bg-bg-elevated border border-border text-text-primary text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap shadow-lg">
                      {d.date.slice(5)} · {d.count}명
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex gap-5 pt-1 border-t border-border">
            <div>
              <p className="text-[10px] text-text-muted mb-0.5">오늘</p>
              <p className="text-xl font-bold font-mono text-text-primary">{todaySignups}</p>
            </div>
            <div>
              <p className="text-[10px] text-text-muted mb-0.5">30일 누적</p>
              <p className="text-xl font-bold font-mono text-accent-blue">{totalMonth}</p>
            </div>
          </div>
        </div>
      </div>

      {/* 방문자 추이 */}
      <div className="rounded-xl border border-border bg-bg-card p-4 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-text-primary flex items-center gap-1.5">
            <Eye size={14} className="text-orange-400" />방문자 추이
          </span>
          <span className="text-xs text-text-muted">최근 30일 · UTC 기준</span>
        </div>

        {visitorData.length === 0 ? (
          <div className="h-20 flex items-center justify-center text-xs text-text-muted">데이터 없음</div>
        ) : (
          <div className="flex items-end gap-px h-20 w-full">
            {visitorData.map((d, i) => {
              const pct = (d.count / maxVisitor) * 100;
              const isToday = i === visitorData.length - 1;
              return (
                <div key={d.date} className="flex-1 flex flex-col justify-end group relative" style={{ height: "100%" }}>
                  <div
                    className={`w-full rounded-sm transition-colors ${
                      isToday ? "bg-orange-400" : "bg-orange-400/30 group-hover:bg-orange-400/60"
                    }`}
                    style={{ height: `${Math.max(pct, d.count > 0 ? 8 : 2)}%` }}
                  />
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:flex pointer-events-none z-10">
                    <div className="bg-bg-elevated border border-border text-text-primary text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap shadow-lg">
                      {d.date.slice(5)} · {d.count}명
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex gap-5 pt-1 border-t border-border">
          <div>
            <p className="text-[10px] text-text-muted mb-0.5">오늘</p>
            <p className="text-xl font-bold font-mono text-text-primary">{todayVisitors}</p>
          </div>
          <div>
            <p className="text-[10px] text-text-muted mb-0.5">30일 누적</p>
            <p className="text-xl font-bold font-mono text-orange-400">{totalVisitors.toLocaleString()}</p>
          </div>
        </div>
      </div>

      {/* 인기 종목 */}
      <div className="rounded-xl border border-border bg-bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <span className="text-sm font-semibold text-text-primary flex items-center gap-1.5">
            <Star size={14} className="text-accent-yellow" />인기 종목 TOP 10
          </span>
          <div className="flex items-center gap-0.5 bg-bg-secondary border border-border rounded-lg p-0.5">
            {(["watchlist", "portfolio"] as const).map((b) => (
              <button
                key={b}
                onClick={() => setPopularBasis(b)}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
                  popularBasis === b
                    ? "bg-bg-card text-text-primary shadow-sm"
                    : "text-text-muted hover:text-text-primary"
                }`}
              >
                {b === "watchlist" ? "관심종목" : "보유종목"}
              </button>
            ))}
          </div>
        </div>
        {popularList.length === 0 ? (
          <div className="py-12 text-center text-text-muted text-sm">데이터가 없습니다</div>
        ) : (
          <div className="divide-y divide-border/40">
            {popularList.map((item, idx) => (
              <div key={item.symbol} className="flex items-center gap-3 px-4 py-2.5 hover:bg-bg-hover transition-colors">
                <span className={`w-5 text-center text-xs font-bold font-mono shrink-0 ${idx < 3 ? "text-accent-yellow" : "text-text-muted/50"}`}>
                  {idx + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold text-text-primary truncate">{item.name}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-px rounded shrink-0 ${MARKET_COLOR[item.market] ?? "bg-bg-secondary text-text-muted"}`}>
                      {item.market}
                    </span>
                  </div>
                  <span className="text-xs text-text-muted font-mono">{item.symbol}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="w-20 h-1 rounded-full bg-bg-elevated overflow-hidden">
                    <div
                      className="h-full rounded-full bg-accent-blue/50"
                      style={{ width: `${(item.count / maxPop) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs font-mono text-text-muted w-8 text-right">{item.count}명</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 검색 트렌드 */}
      {(() => {
        const trends: { query: string; count: number }[] = searchTrends ?? [];
        const maxCount = Math.max(...trends.map(t => t.count), 1);
        return (
          <div className="rounded-xl border border-border bg-bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center gap-1.5">
              <Search size={14} className="text-accent-blue" />
              <span className="text-sm font-semibold text-text-primary">검색 트렌드 TOP 20</span>
              <span className="text-xs text-text-muted ml-auto">누적 집계</span>
            </div>
            {trends.length === 0 ? (
              <div className="py-8 text-center text-text-muted text-sm">검색 데이터가 없습니다</div>
            ) : (
              <div className="divide-y divide-border/40">
                {trends.map((t, idx) => (
                  <div key={t.query} className="flex items-center gap-3 px-4 py-2.5 hover:bg-bg-hover transition-colors">
                    <span className={`w-5 text-center text-xs font-bold font-mono shrink-0 ${idx < 3 ? "text-accent-yellow" : "text-text-muted/50"}`}>
                      {idx + 1}
                    </span>
                    <span className="flex-1 text-sm text-text-primary font-medium">{t.query}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="w-24 h-1.5 rounded-full bg-bg-elevated overflow-hidden">
                        <div className="h-full rounded-full bg-accent-blue/60" style={{ width: `${(t.count / maxCount) * 100}%` }} />
                      </div>
                      <span className="text-xs font-mono text-text-muted w-12 text-right">{t.count}회</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* 기능별 사용 통계 */}
      {(() => {
        const usage: { feature: string; label: string; count: number }[] = usageStats ?? [];
        const maxUsage = Math.max(...usage.map(u => u.count), 1);
        return (
          <div className="rounded-xl border border-border bg-bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center gap-1.5">
              <Activity size={14} className="text-accent-green" />
              <span className="text-sm font-semibold text-text-primary">기능별 사용 통계</span>
              <span className="text-xs text-text-muted ml-auto">누적 집계</span>
            </div>
            {usage.length === 0 ? (
              <div className="py-8 text-center text-text-muted text-sm">사용 데이터가 없습니다</div>
            ) : (
              <div className="p-4 flex flex-col gap-3">
                {usage.map((u) => (
                  <div key={u.feature} className="flex items-center gap-3">
                    <span className="text-sm text-text-secondary w-20 shrink-0">{u.label}</span>
                    <div className="flex-1 h-2 rounded-full bg-bg-elevated overflow-hidden">
                      <div
                        className="h-full rounded-full bg-accent-green/70 transition-all"
                        style={{ width: `${(u.count / maxUsage) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs font-mono text-text-muted w-12 text-right shrink-0">{u.count.toLocaleString()}회</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

/* ─────────────────────────── 커뮤니티 관리 탭 ─────────────────────────── */
const MARKET_COLOR_MAP: Record<string, string> = {
  KR:  "bg-accent-blue/15 text-accent-blue",
  US:  "bg-accent-green/15 text-accent-green",
  ETF: "bg-purple-400/15 text-purple-400",
};

function CommunityAdminTab({ qc }: { qc: any }) {
  const [page, setPage] = useState(1);
  const [marketFilter, setMarketFilter] = useState("ALL");
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-community-posts", page, marketFilter],
    queryFn: () => adminApi.getCommunityPosts(page, marketFilter),
    staleTime: 30_000,
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => adminApi.deleteCommunityPost(id),
    onSuccess: () => {
      setConfirmDelete(null);
      qc.invalidateQueries({ queryKey: ["admin-community-posts"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
      refetch();
    },
  });

  const posts: any[] = data?.items ?? [];
  const total: number = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  return (
    <div className="flex flex-col gap-4">
      {/* 필터 헤더 */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1 p-1 rounded-xl border border-border bg-bg-card">
          {(["ALL", "KR", "US", "ETF"] as const).map((m) => (
            <button
              key={m}
              onClick={() => { setMarketFilter(m); setPage(1); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                marketFilter === m ? "bg-accent-blue text-white shadow" : "text-text-muted hover:text-text-primary"
              }`}
            >
              {m === "ALL" ? "전체" : m}
            </button>
          ))}
        </div>
        <span className="text-xs text-text-dim ml-auto">총 {total.toLocaleString()}개</span>
        <button onClick={() => refetch()} className="p-1 text-text-muted hover:text-text-primary transition-colors">
          <RefreshCw size={13} />
        </button>
      </div>

      {/* 테이블 */}
      <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-5 h-5 rounded-full border-2 border-accent-blue border-t-transparent animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-text-muted text-xs">
                  <th className="text-left px-4 py-3 font-medium">ID</th>
                  <th className="text-left px-3 py-3 font-medium">작성자</th>
                  <th className="text-left px-3 py-3 font-medium hidden md:table-cell">종목</th>
                  <th className="text-left px-3 py-3 font-medium">내용</th>
                  <th className="text-center px-3 py-3 font-medium hidden sm:table-cell">좋아요</th>
                  <th className="text-center px-3 py-3 font-medium hidden lg:table-cell">작성일</th>
                  <th className="text-center px-3 py-3 font-medium">삭제</th>
                </tr>
              </thead>
              <tbody>
                {posts.map((p) => (
                  <tr key={p.id} className="border-b border-border/30 hover:bg-bg-hover transition-colors">
                    <td className="px-4 py-3 font-mono text-text-muted text-xs">{p.id}</td>
                    <td className="px-3 py-3">
                      <Link
                        to={`/profile/${p.user_id}`}
                        className="text-xs font-semibold text-text-primary hover:text-accent-blue transition-colors"
                      >
                        {p.username}
                      </Link>
                    </td>
                    <td className="px-3 py-3 hidden md:table-cell">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[10px] font-bold px-1.5 py-px rounded ${MARKET_COLOR_MAP[p.market] ?? "bg-bg-secondary text-text-muted"}`}>
                          {p.market}
                        </span>
                        <span className="text-xs font-mono text-text-muted">{p.symbol}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 max-w-[200px] lg:max-w-xs">
                      <Link
                        to={`/post/${p.id}`}
                        className="text-xs text-text-secondary hover:text-accent-blue transition-colors truncate block"
                        title={p.title || p.body || ""}
                      >
                        {p.title || p.body || "—"}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-center hidden sm:table-cell">
                      <div className="flex items-center justify-center gap-1 text-text-muted">
                        <Heart size={11} />
                        <span className="text-xs font-mono">{p.like_count}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-center hidden lg:table-cell">
                      <span className="text-xs text-text-muted font-mono">{p.created_at.slice(0, 10)}</span>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <button
                        onClick={() => setConfirmDelete(p.id)}
                        className="text-text-muted hover:text-accent-red transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {posts.length === 0 && (
              <div className="py-12 text-center text-text-muted text-sm">게시글이 없습니다</div>
            )}
          </div>
        )}
      </div>

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 rounded-xl text-xs text-text-muted border border-border hover:border-accent-blue/50 hover:text-accent-blue disabled:opacity-30 transition-all"
          >
            이전
          </button>
          <span className="text-xs text-text-muted px-2">{page} / {totalPages}</span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1.5 rounded-xl text-xs text-text-muted border border-border hover:border-accent-blue/50 hover:text-accent-blue disabled:opacity-30 transition-all"
          >
            다음
          </button>
        </div>
      )}

      {/* 삭제 확인 팝업 */}
      {confirmDelete !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => { if (!deleteMut.isPending) setConfirmDelete(null); }}
        >
          <div
            className="bg-bg-card border border-border rounded-2xl shadow-2xl p-6 w-80 flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col gap-1">
              <p className="text-sm font-bold text-text-primary">글을 삭제하시겠습니까?</p>
              <p className="text-xs text-text-dim">삭제된 게시글은 복구할 수 없습니다.</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                disabled={deleteMut.isPending}
                className="flex-1 py-2 rounded-xl border border-border text-sm text-text-secondary hover:border-accent-blue/50 transition-all disabled:opacity-50"
              >
                취소
              </button>
              <button
                onClick={() => deleteMut.mutate(confirmDelete)}
                disabled={deleteMut.isPending}
                className="flex-1 py-2 rounded-xl bg-accent-red text-white text-sm font-semibold hover:bg-accent-red/90 transition-all disabled:opacity-50"
              >
                {deleteMut.isPending ? "삭제 중..." : "삭제"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── 유저 관리 탭 ─────────────────────────── */
function UsersTab({ qc }: { qc: any }) {
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [search, setSearch] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["admin-users", statusFilter],
    queryFn: () => adminApi.getUsers(statusFilter),
    staleTime: 30_000,
  });

  const toggleMut = useMutation({
    mutationFn: (id: number) => adminApi.toggleActive(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
  });
  const communityBanMut = useMutation({
    mutationFn: (id: number) => adminApi.toggleCommunityBan(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => adminApi.deleteUser(id),
    onSuccess: () => { setConfirmDelete(null); qc.invalidateQueries({ queryKey: ["admin-users"] }); },
  });

  const filtered = search.trim()
    ? (users as any[]).filter(u =>
        u.username.toLowerCase().includes(search.toLowerCase()) ||
        (u.email ?? "").toLowerCase().includes(search.toLowerCase()))
    : (users as any[]);

  return (
    <div className="flex flex-col gap-3">
      {/* 필터 + 검색 */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-0.5 p-0.5 rounded-lg bg-bg-elevated border border-border">
          {(["all", "active", "inactive"] as const).map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
                statusFilter === s ? "bg-bg-card text-text-primary shadow-sm" : "text-text-muted hover:text-text-primary"
              }`}>
              {s === "all" ? "전체" : s === "active" ? "활성" : "비활성"}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[160px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="이름 또는 이메일 검색..."
            className="w-full pl-8 pr-7 py-1.5 text-xs bg-bg-elevated border border-border rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue/60 transition-colors" />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary">
              <XIcon size={12} />
            </button>
          )}
        </div>
        <span className="text-xs text-text-muted shrink-0">{filtered.length}명</span>
      </div>

      {/* 유저 목록 */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-5 h-5 rounded-full border-2 border-accent-blue border-t-transparent animate-spin" />
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-bg-card divide-y divide-border/40 overflow-hidden">
          {filtered.length === 0 && (
            <div className="py-10 text-center text-text-muted text-sm">검색 결과가 없습니다</div>
          )}
          {filtered.map((u: any) => (
            <div key={u.id} className="flex items-center gap-2 px-3 sm:px-4 py-2.5 hover:bg-bg-hover transition-colors min-w-0">
              {/* ID */}
              <span className="text-[11px] font-mono text-text-muted/60 w-7 shrink-0 hidden sm:block">{u.id}</span>

              {/* 이름 + 배지 + 이메일 — 1줄, 넘치면 말줄임 */}
              <div className="flex-1 min-w-0 flex items-center gap-1.5 overflow-hidden">
                <Link to={`/profile/${u.id}`}
                  className="text-sm font-semibold text-text-primary hover:text-accent-blue transition-colors whitespace-nowrap">
                  {u.username}
                </Link>
                {u.is_admin && (
                  <span className="text-[10px] bg-accent-blue/15 text-accent-blue px-1.5 py-px rounded font-bold shrink-0">관리자</span>
                )}
                {!u.is_admin && u.is_community_banned && (
                  <span className="text-[10px] bg-orange-400/15 text-orange-400 px-1.5 py-px rounded font-bold shrink-0 hidden sm:inline">커뮤차단</span>
                )}
                {u.email && (
                  <span className="text-[11px] text-text-muted truncate hidden sm:inline">{u.email}</span>
                )}
              </div>

              {/* 계정 상태 배지 */}
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                u.is_active ? "bg-accent-green/12 text-accent-green" : "bg-accent-red/12 text-accent-red"
              }`}>
                {u.is_active ? "활성" : "비활성"}
              </span>

              {/* 가입일 */}
              <span className="text-[11px] text-text-muted font-mono shrink-0 hidden lg:block">
                {u.created_at ? u.created_at.slice(0, 10) : "—"}
              </span>

              {/* 액션 버튼 */}
              {!u.is_admin ? (
                <div className="flex items-center gap-0.5 shrink-0">
                  {/* 계정 활성화 토글 */}
                  <button onClick={() => toggleMut.mutate(u.id)}
                    title={u.is_active ? "계정 비활성화" : "계정 활성화"}
                    className="p-1.5 rounded-lg hover:bg-bg-elevated transition-colors">
                    {u.is_active
                      ? <ToggleRight size={18} className="text-accent-green" />
                      : <ToggleLeft size={18} className="text-text-muted" />}
                  </button>
                  {/* 커뮤니티 차단 토글 */}
                  <button onClick={() => communityBanMut.mutate(u.id)}
                    title={u.is_community_banned ? "커뮤니티 차단 해제" : "커뮤니티 차단"}
                    className="p-1.5 rounded-lg hover:bg-bg-elevated transition-colors">
                    <MessageSquare size={14} className={u.is_community_banned ? "text-orange-400" : "text-text-muted"} />
                  </button>
                  {/* 삭제 */}
                  {confirmDelete === u.id ? (
                    <div className="flex items-center gap-1 ml-1">
                      <button onClick={() => deleteMut.mutate(u.id)} disabled={deleteMut.isPending}
                        className="text-[11px] px-1.5 py-0.5 rounded bg-accent-red text-white font-semibold">
                        {deleteMut.isPending ? "..." : "삭제"}
                      </button>
                      <button onClick={() => setConfirmDelete(null)}
                        className="text-[11px] px-1.5 py-0.5 rounded border border-border text-text-muted">
                        취소
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmDelete(u.id)}
                      className="p-1.5 rounded-lg hover:bg-bg-elevated text-text-muted hover:text-accent-red transition-colors">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ) : (
                <div className="w-[90px] shrink-0" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── 공지사항 탭 ─────────────────────────── */
function AnnouncementTab({ annoText, setAnnoText, qc }: { annoText: string; setAnnoText: (v: string) => void; qc: any }) {
  const [saved, setSaved] = useState(false);

  const { data: annoData } = useQuery({
    queryKey: ["admin-announcement"],
    queryFn: adminApi.getAnnouncement,
    staleTime: 30_000,
  });
  useEffect(() => {
    if (annoData && annoText === "") setAnnoText(annoData.text || "");
  }, [annoData]);

  const saveMut = useMutation({
    mutationFn: (text: string) => adminApi.setAnnouncement(text),
    onSuccess: () => {
      setSaved(true);
      qc.invalidateQueries({ queryKey: ["announcement"] });
      setTimeout(() => setSaved(false), 2500);
    },
  });

  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <div className="rounded-xl border border-border bg-bg-card p-5 flex flex-col gap-4">
        <div>
          <p className="text-sm font-semibold text-text-primary mb-1">앱 공지사항</p>
          <p className="text-xs text-text-muted leading-relaxed">저장하면 모든 사용자 화면 상단에 배너로 표시됩니다. 비워두면 배너가 사라집니다.</p>
        </div>

        <textarea
          value={annoText}
          onChange={e => setAnnoText(e.target.value)}
          maxLength={500}
          rows={5}
          placeholder="공지사항 내용을 입력하세요 (최대 500자)..."
          className="w-full rounded-lg border border-border bg-bg-elevated text-text-primary text-sm p-3 resize-none focus:outline-none focus:border-accent-blue/60 transition-colors leading-relaxed"
        />

        <div className="flex items-center justify-between">
          <span className="text-xs text-text-muted">{annoText.length} / 500</span>
          <div className="flex gap-2">
            <button
              onClick={() => { setAnnoText(""); saveMut.mutate(""); }}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-text-muted hover:text-text-primary border border-border transition-all"
            >
              공지 삭제
            </button>
            <button
              onClick={() => saveMut.mutate(annoText)}
              disabled={saveMut.isPending}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                saved
                  ? "bg-accent-green/15 text-accent-green border border-accent-green/30"
                  : "bg-accent-blue text-white hover:bg-accent-blue/90"
              }`}
            >
              {saved ? "✓ 저장 완료" : saveMut.isPending ? "저장 중..." : "저장"}
            </button>
          </div>
        </div>
      </div>

      {annoText && (
        <div>
          <p className="text-xs text-text-muted mb-2">미리보기</p>
          <div className="flex items-center gap-2 bg-accent-blue/8 border border-accent-blue/20 rounded-lg px-4 py-2.5">
            <Megaphone size={14} className="text-accent-blue shrink-0" />
            <p className="text-xs text-text-primary flex-1">{annoText}</p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── 배너·공지 탭 ─────────────────────────── */
function BannerTab({ qc }: { qc: any }) {
  const [annoText, setAnnoText] = useState("");
  return (
    <div className="flex flex-col gap-8">
      <AnnouncementTab annoText={annoText} setAnnoText={setAnnoText} qc={qc} />
      <div className="border-t border-border pt-6">
        <PopupTab qc={qc} />
      </div>
    </div>
  );
}

/* ─────────────────────────── 캐시 탭 ─────────────────────────── */
function CacheTab({ qc }: { qc: any }) {
  const [search, setSearch] = useState("");
  const [confirmed, setConfirmed] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-cache"],
    queryFn: () => adminApi.listCache(),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  const deleteMut = useMutation({
    mutationFn: (key: string) => adminApi.deleteCache(key),
    onSuccess: () => { setConfirmed(null); qc.invalidateQueries({ queryKey: ["admin-cache"] }); refetch(); },
  });

  const clearMut = useMutation({
    mutationFn: () => adminApi.clearCache(),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-cache"] }); refetch(); },
  });

  const items: { key: string; ttl_remaining: number; has_stale: boolean }[] = data?.items ?? [];
  const filtered = search ? items.filter((i) => i.key.includes(search)) : items;

  const TTL_COLOR = (ttl: number) =>
    ttl > 300 ? "text-accent-green" : ttl > 60 ? "text-accent-yellow" : "text-accent-red";

  const PREFIXES = ["price:", "idx:", "news:", "ohlcv:", "fund:", "extra:", "metrics_hist", "forecasts:", "rank:"];

  return (
    <div className="flex flex-col gap-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <span className="text-base font-bold text-text-primary">인메모리 캐시</span>
          <span className="text-xs text-text-muted ml-2">{data?.count ?? 0}개 항목</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => refetch()} className="p-1.5 rounded-lg hover:bg-bg-elevated text-text-muted hover:text-accent-blue transition-colors">
            <RefreshCw size={14} />
          </button>
          <button
            onClick={() => { if (window.confirm("캐시 전체를 초기화할까요?")) clearMut.mutate(); }}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-accent-red/10 text-accent-red hover:bg-accent-red/20 transition-colors"
          >
            전체 초기화
          </button>
        </div>
      </div>

      {/* 빠른 필터 */}
      <div className="flex flex-wrap gap-1.5">
        <button onClick={() => setSearch("")}
          className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all ${search === "" ? "bg-accent-blue text-white border-transparent" : "border-border text-text-muted hover:text-text-primary"}`}>
          전체
        </button>
        {PREFIXES.map((p) => (
          <button key={p} onClick={() => setSearch(p)}
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all ${search === p ? "bg-accent-blue text-white border-transparent" : "border-border text-text-muted hover:text-text-primary"}`}>
            {p}
          </button>
        ))}
      </div>

      {/* 검색 */}
      <div className="relative">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="캐시 키 검색..."
          className="w-full pl-8 pr-8 py-2 text-sm bg-bg-elevated border border-border rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue"
        />
        {search && (
          <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary">
            <XIcon size={13} />
          </button>
        )}
      </div>

      {/* 목록 */}
      <div className="rounded-xl border border-border bg-bg-card overflow-hidden">
        <div className="grid grid-cols-[1fr_80px_40px] text-xs font-semibold text-text-muted px-4 py-2.5 border-b border-border bg-bg-elevated">
          <span>키</span><span className="text-right">남은 TTL</span><span />
        </div>
        <div className="divide-y divide-border/40 max-h-[480px] overflow-y-auto">
          {isLoading && (
            <div className="py-8 text-center text-text-muted text-sm">불러오는 중...</div>
          )}
          {!isLoading && filtered.length === 0 && (
            <div className="py-8 text-center text-text-muted text-sm">캐시 항목 없음</div>
          )}
          {filtered.map((item) => (
            <div key={item.key} className="grid grid-cols-[1fr_80px_40px] items-center px-4 py-2 hover:bg-bg-hover text-xs">
              <span className="font-mono text-text-secondary truncate pr-2">{item.key}</span>
              <span className={`font-mono text-right ${TTL_COLOR(item.ttl_remaining)}`}>{item.ttl_remaining}s</span>
              <div className="flex justify-end">
                {confirmed === item.key ? (
                  <button onClick={() => deleteMut.mutate(item.key)}
                    className="text-accent-red hover:text-accent-red/70 text-xs font-semibold">삭제</button>
                ) : (
                  <button onClick={() => setConfirmed(item.key)}
                    className="text-text-muted hover:text-accent-red transition-colors">
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        {filtered.length > 0 && (
          <div className="px-4 py-2 border-t border-border text-xs text-text-muted">
            {filtered.length}개 표시 / 전체 {items.length}개
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────── 팝업 관리 탭 ─────────────────────────── */
const POPUP_TYPE_LABELS: Record<string, string> = {
  info: "정보", warning: "경고", event: "이벤트", feature: "신기능",
};
const POPUP_BG_OPTIONS = [
  { value: "blue",   label: "파란색" },
  { value: "green",  label: "초록색" },
  { value: "amber",  label: "노란색" },
  { value: "red",    label: "빨간색" },
  { value: "purple", label: "보라색" },
];

function PopupTab({ qc }: { qc: any }) {
  const { data: popups = [], isLoading, refetch } = useQuery({ queryKey: ["admin-popups"], queryFn: adminApi.getPopups, staleTime: 30_000 });
  const [editTarget, setEditTarget] = useState<any | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ popup_type: "info", title: "", content: "", link_url: "", link_text: "", bg_color: "blue", is_active: true, starts_at: "", ends_at: "" });

  const openCreate = () => { setForm({ popup_type: "info", title: "", content: "", link_url: "", link_text: "", bg_color: "blue", is_active: true, starts_at: "", ends_at: "" }); setEditTarget(null); setShowForm(true); };
  const openEdit   = (p: any) => {
    setForm({ popup_type: p.popup_type, title: p.title, content: p.content ?? "", link_url: p.link_url ?? "", link_text: p.link_text ?? "", bg_color: p.bg_color ?? "blue", is_active: p.is_active, starts_at: p.starts_at ? p.starts_at.slice(0, 16) : "", ends_at: p.ends_at ? p.ends_at.slice(0, 16) : "" });
    setEditTarget(p);
    setShowForm(true);
  };

  const createMut = useMutation({ mutationFn: adminApi.createPopup, onSuccess: () => { setShowForm(false); refetch(); qc.invalidateQueries({ queryKey: ["admin-popups"] }); } });
  const updateMut = useMutation({ mutationFn: ({ id, data }: any) => adminApi.updatePopup(id, data), onSuccess: () => { setShowForm(false); refetch(); qc.invalidateQueries({ queryKey: ["admin-popups"] }); } });
  const deleteMut = useMutation({ mutationFn: adminApi.deletePopup, onSuccess: () => { refetch(); qc.invalidateQueries({ queryKey: ["admin-popups"] }); } });

  const handleSave = () => {
    const payload = { ...form, starts_at: form.starts_at || null, ends_at: form.ends_at || null };
    if (editTarget) updateMut.mutate({ id: editTarget.id, data: payload });
    else createMut.mutate(payload);
  };

  const BG_COLOR_MAP: Record<string, string> = { blue: "bg-blue-500/15 text-blue-400", green: "bg-green-500/15 text-green-400", amber: "bg-amber-400/15 text-amber-500", red: "bg-red-500/15 text-red-400", purple: "bg-purple-500/15 text-purple-400" };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-base font-bold text-text-primary">팝업 배너 관리</span>
        <button onClick={openCreate} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-blue text-white text-xs font-semibold hover:bg-accent-blue/90 transition-colors">
          <Plus size={13} />새 팝업
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16"><div className="w-5 h-5 rounded-full border-2 border-accent-blue border-t-transparent animate-spin" /></div>
      ) : popups.length === 0 ? (
        <div className="rounded-xl border border-border bg-bg-card py-12 text-center text-text-muted text-sm">등록된 팝업이 없습니다</div>
      ) : (
        <div className="flex flex-col gap-3">
          {popups.map((p: any) => (
            <div key={p.id} className="rounded-xl border border-border bg-bg-card p-4 flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${BG_COLOR_MAP[p.bg_color] ?? "bg-bg-secondary text-text-muted"}`}>
                    {POPUP_TYPE_LABELS[p.popup_type] ?? p.popup_type}
                  </span>
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${p.is_active ? "bg-accent-green/12 text-accent-green" : "bg-bg-elevated text-text-muted"}`}>
                    {p.is_active ? "활성" : "비활성"}
                  </span>
                  <span className="text-sm font-semibold text-text-primary">{p.title}</span>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => openEdit(p)} className="p-1.5 text-text-muted hover:text-accent-blue transition-colors"><Pencil size={13} /></button>
                  <button onClick={() => { if (window.confirm("팝업을 삭제할까요?")) deleteMut.mutate(p.id); }} className="p-1.5 text-text-muted hover:text-accent-red transition-colors"><Trash2 size={13} /></button>
                </div>
              </div>
              {p.content && <p className="text-xs text-text-muted leading-relaxed">{p.content}</p>}
              {(p.starts_at || p.ends_at) && (
                <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
                  <Calendar size={11} />
                  {p.starts_at ? p.starts_at.slice(0, 16) : "—"} ~ {p.ends_at ? p.ends_at.slice(0, 16) : "상시"}
                </div>
              )}
              {p.link_url && (
                <a href={p.link_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[11px] text-accent-blue hover:underline">
                  <ExternalLink size={10} />{p.link_text || p.link_url}
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 팝업 폼 모달 */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowForm(false)}>
          <div className="bg-bg-card border border-border rounded-2xl shadow-2xl p-6 w-full max-w-lg mx-4 flex flex-col gap-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-text-primary">{editTarget ? "팝업 수정" : "새 팝업 추가"}</p>
              <button onClick={() => setShowForm(false)}><XIcon size={16} className="text-text-muted" /></button>
            </div>
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-text-muted mb-1 block">유형</label>
                  <select value={form.popup_type} onChange={e => setForm(f => ({...f, popup_type: e.target.value}))}
                    className="w-full rounded-lg border border-border bg-bg-elevated text-text-primary text-sm px-3 py-2 focus:outline-none">
                    {Object.entries(POPUP_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-text-muted mb-1 block">색상</label>
                  <select value={form.bg_color} onChange={e => setForm(f => ({...f, bg_color: e.target.value}))}
                    className="w-full rounded-lg border border-border bg-bg-elevated text-text-primary text-sm px-3 py-2 focus:outline-none">
                    {POPUP_BG_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-text-muted mb-1 block">제목 *</label>
                <input value={form.title} onChange={e => setForm(f => ({...f, title: e.target.value}))} maxLength={200}
                  className="w-full rounded-lg border border-border bg-bg-elevated text-text-primary text-sm px-3 py-2 focus:outline-none focus:border-accent-blue" />
              </div>
              <div>
                <label className="text-xs text-text-muted mb-1 block">내용</label>
                <textarea value={form.content} onChange={e => setForm(f => ({...f, content: e.target.value}))} rows={3}
                  className="w-full rounded-lg border border-border bg-bg-elevated text-text-primary text-sm px-3 py-2 focus:outline-none focus:border-accent-blue resize-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-text-muted mb-1 block">링크 URL</label>
                  <input value={form.link_url} onChange={e => setForm(f => ({...f, link_url: e.target.value}))} maxLength={500} placeholder="https://..."
                    className="w-full rounded-lg border border-border bg-bg-elevated text-text-primary text-sm px-3 py-2 focus:outline-none focus:border-accent-blue" />
                </div>
                <div>
                  <label className="text-xs text-text-muted mb-1 block">링크 텍스트</label>
                  <input value={form.link_text} onChange={e => setForm(f => ({...f, link_text: e.target.value}))} maxLength={100} placeholder="자세히 보기"
                    className="w-full rounded-lg border border-border bg-bg-elevated text-text-primary text-sm px-3 py-2 focus:outline-none focus:border-accent-blue" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-text-muted mb-1 block">시작일시</label>
                  <input type="datetime-local" value={form.starts_at} onChange={e => setForm(f => ({...f, starts_at: e.target.value}))}
                    className="w-full rounded-lg border border-border bg-bg-elevated text-text-primary text-sm px-3 py-2 focus:outline-none focus:border-accent-blue" />
                </div>
                <div>
                  <label className="text-xs text-text-muted mb-1 block">종료일시</label>
                  <input type="datetime-local" value={form.ends_at} onChange={e => setForm(f => ({...f, ends_at: e.target.value}))}
                    className="w-full rounded-lg border border-border bg-bg-elevated text-text-primary text-sm px-3 py-2 focus:outline-none focus:border-accent-blue" />
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({...f, is_active: e.target.checked}))} className="w-4 h-4 accent-accent-blue" />
                <span className="text-sm text-text-secondary">활성화</span>
              </label>
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={() => setShowForm(false)} className="flex-1 py-2 rounded-xl border border-border text-sm text-text-secondary hover:border-accent-blue/50 transition-all">취소</button>
              <button onClick={handleSave} disabled={!form.title || createMut.isPending || updateMut.isPending}
                className="flex-1 py-2 rounded-xl bg-accent-blue text-white text-sm font-semibold hover:bg-accent-blue/90 transition-all disabled:opacity-50">
                {createMut.isPending || updateMut.isPending ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── 신고 관리 탭 ─────────────────────────── */
function ReportsTab({ qc }: { qc: any }) {
  const [statusFilter, setStatusFilter] = useState<"pending" | "resolved" | "dismissed" | "all">("pending");
  const [page, setPage] = useState(1);
  const [actingId, setActingId] = useState<number | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-reports", statusFilter, page],
    queryFn: () => adminApi.getReports(statusFilter, page),
    staleTime: 30_000,
  });

  const act = (fn: (id: number) => Promise<any>, id: number) => {
    setActingId(id);
    fn(id).finally(() => {
      setActingId(null);
      refetch();
      qc.invalidateQueries({ queryKey: ["admin-reports"] });
    });
  };

  const reports: any[] = data?.items ?? [];
  const total: number  = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  const STATUS_LABELS: Record<string, string> = { pending: "대기", resolved: "처리됨", dismissed: "기각됨", all: "전체" };
  const STATUS_BADGE: Record<string, string> = {
    pending:   "bg-amber-400/15 text-amber-500 border-amber-400/30",
    resolved:  "bg-accent-green/12 text-accent-green border-accent-green/30",
    dismissed: "bg-bg-elevated text-text-muted border-border",
  };

  return (
    <div className="flex flex-col gap-4">
      {/* 필터 바 */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-0.5 p-0.5 rounded-lg bg-bg-elevated border border-border">
          {(["pending", "resolved", "dismissed", "all"] as const).map((s) => (
            <button key={s} onClick={() => { setStatusFilter(s); setPage(1); }}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                statusFilter === s ? "bg-bg-card text-text-primary shadow-sm" : "text-text-muted hover:text-text-primary"
              }`}>
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
        <span className="text-xs text-text-muted ml-auto">총 {total}건</span>
        <button onClick={() => refetch()} className="p-1.5 rounded-lg text-text-muted hover:text-accent-blue hover:bg-bg-elevated transition-colors">
          <RefreshCw size={13} />
        </button>
      </div>

      {/* 목록 */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-5 h-5 rounded-full border-2 border-accent-blue border-t-transparent animate-spin" />
        </div>
      ) : reports.length === 0 ? (
        <div className="rounded-xl border border-border bg-bg-card py-14 text-center">
          <Flag size={24} className="text-text-muted/30 mx-auto mb-2" />
          <p className="text-sm text-text-muted">신고 내역이 없습니다</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {reports.map((r: any) => {
            const isPending = r.status === "pending";
            const isActing  = actingId === r.id;
            return (
              <div key={r.id}
                className={`rounded-xl border bg-bg-card overflow-hidden transition-opacity ${
                  isPending ? "border-border" : "border-border/50 opacity-70"
                }`}>

                {/* 헤더 */}
                <div className="flex items-center gap-2 px-4 py-2.5 bg-bg-elevated/60 border-b border-border/50">
                  <span className={`text-[11px] font-bold px-2 py-px rounded-full border ${STATUS_BADGE[r.status] ?? STATUS_BADGE.dismissed}`}>
                    {STATUS_LABELS[r.status] ?? r.status}
                  </span>
                  <span className="text-[11px] text-text-muted font-mono">#{r.id}</span>
                  <span className="text-[11px] text-text-muted">·</span>
                  <Flag size={10} className="text-text-muted" />
                  <span className="text-[11px] font-semibold text-text-secondary">{r.reporter}</span>
                  <span className="text-[11px] text-text-muted">신고</span>
                  <span className="text-[11px] text-text-muted ml-auto font-mono">{r.created_at?.slice(0, 10)}</span>
                </div>

                {/* 신고 사유 */}
                <div className="px-4 pt-3 pb-2 flex items-start gap-2">
                  <AlertCircle size={13} className={`shrink-0 mt-0.5 ${isPending ? "text-amber-400" : "text-text-muted"}`} />
                  <p className="text-sm font-medium text-text-primary leading-snug">{r.reason}</p>
                </div>

                {/* 신고 대상 콘텐츠 */}
                <div className="px-4 pb-3 flex flex-col gap-2">
                  {r.post_id && (
                    <div className="rounded-lg bg-bg-elevated border border-border/50 p-3 flex flex-col gap-1.5">
                      <div className="flex items-center gap-2">
                        <MessageSquare size={11} className="text-text-muted shrink-0" />
                        <span className="text-[11px] text-text-muted">게시글 #{r.post_id}</span>
                        {r.post_author && (
                          <span className="text-[11px] font-semibold text-text-secondary">· @{r.post_author}</span>
                        )}
                        <Link to={`/post/${r.post_id}`} target="_blank"
                          className="ml-auto flex items-center gap-0.5 text-[11px] text-accent-blue hover:underline shrink-0">
                          <ExternalLink size={10} />보기
                        </Link>
                      </div>
                      {r.post_title && (
                        <p className="text-xs font-semibold text-text-primary truncate">{r.post_title}</p>
                      )}
                      {r.post_body && (
                        <p className="text-xs text-text-secondary leading-relaxed line-clamp-2">{r.post_body}</p>
                      )}
                    </div>
                  )}
                  {r.comment_id && (
                    <div className="rounded-lg bg-bg-elevated border border-border/50 p-3 flex flex-col gap-1.5">
                      <div className="flex items-center gap-2">
                        <MessageSquare size={11} className="text-text-muted shrink-0" />
                        <span className="text-[11px] text-text-muted">댓글 #{r.comment_id}</span>
                        {r.comment_author && (
                          <span className="text-[11px] font-semibold text-text-secondary">· @{r.comment_author}</span>
                        )}
                        {r.post_id && (
                          <Link to={`/post/${r.post_id}`} target="_blank"
                            className="ml-auto flex items-center gap-0.5 text-[11px] text-accent-blue hover:underline shrink-0">
                            <ExternalLink size={10} />게시글
                          </Link>
                        )}
                      </div>
                      <p className="text-xs text-text-secondary leading-relaxed line-clamp-2">{r.comment_preview || "—"}</p>
                    </div>
                  )}
                </div>

                {/* 액션 버튼 (대기 상태만) */}
                {isPending && (
                  <div className="flex border-t border-border/50 divide-x divide-border/50">
                    <button onClick={() => act(adminApi.blindReport, r.id)} disabled={isActing}
                      className="flex-1 py-3 text-xs font-semibold text-amber-500 hover:bg-amber-400/8 active:bg-amber-400/15 transition-colors disabled:opacity-40">
                      {isActing ? "처리 중..." : "블라인드"}
                    </button>
                    <button onClick={() => act(adminApi.deleteReportContent, r.id)} disabled={isActing}
                      className="flex-1 py-3 text-xs font-semibold text-accent-red hover:bg-accent-red/8 active:bg-accent-red/15 transition-colors disabled:opacity-40">
                      {isActing ? "처리 중..." : "콘텐츠 삭제"}
                    </button>
                    <button onClick={() => act(adminApi.dismissReport, r.id)} disabled={isActing}
                      className="flex-1 py-3 text-xs font-semibold text-text-muted hover:text-text-primary hover:bg-bg-elevated active:bg-bg-hover transition-colors disabled:opacity-40">
                      {isActing ? "처리 중..." : "기각"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            className="px-3 py-1.5 rounded-xl text-xs text-text-muted border border-border hover:border-accent-blue/50 hover:text-accent-blue disabled:opacity-30 transition-all">이전</button>
          <span className="text-xs text-text-muted px-2">{page} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            className="px-3 py-1.5 rounded-xl text-xs text-text-muted border border-border hover:border-accent-blue/50 hover:text-accent-blue disabled:opacity-30 transition-all">다음</button>
        </div>
      )}
    </div>
  );
}
