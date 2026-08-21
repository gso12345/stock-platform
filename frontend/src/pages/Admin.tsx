import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import api from "@/api/client";
import {
  Users, BarChart2, Megaphone, Trash2, ToggleLeft, ToggleRight,
  ShieldCheck, RefreshCw, Activity, Database, Star, CheckCircle,
  TrendingUp, Zap, Clock, Folder, Wifi, Eye, Search, X as XIcon,
  MessageSquare, Heart, Flag, Plus, Pencil, AlertCircle,
  ExternalLink, Calendar, ScrollText,
} from "lucide-react";
import { safeExternalUrl } from "@/utils/url";
import { Tabs, MarketBadge } from "@/components/ui";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import UserItemsPanel, { 항목이름, type 항목종류 } from "@/components/admin/UserItemsPanel";
import PostLikesModal from "@/components/admin/PostLikesModal";
import SystemTab from "@/components/admin/SystemTab";

const adminApi = {
  getStats:        () => api.get("/admin/stats").then(r => r.data),
  getUsers:        (status = "all", page = 1) => api.get("/admin/users", { params: { status, page, limit: 50 } }).then(r => r.data),
  getUserDetail:   (id: number) => api.get(`/admin/users/${id}/detail`).then(r => r.data),
  getCommunityPosts: (page = 1, market?: string) =>
    api.get("/admin/community/posts", { params: { page, limit: 20, ...(market && market !== "ALL" ? { market } : {}) } }).then(r => r.data),
  deleteCommunityPost: (id: number) =>
    api.delete(`/admin/community/posts/${id}`).then(r => r.data),
  blindPost:       (id: number) => api.patch(`/admin/community/posts/${id}/blind`).then(r => r.data),
  unblindPost:     (id: number) => api.patch(`/admin/community/posts/${id}/unblind`).then(r => r.data),
  getCommunityComments: (page = 1, postId?: number) =>
    api.get("/admin/community/comments", { params: { page, limit: 20, ...(postId ? { post_id: postId } : {}) } }).then(r => r.data),
  deleteCommunityComment: (id: number) => api.delete(`/admin/community/comments/${id}`).then(r => r.data),
  blindComment:    (id: number) => api.patch(`/admin/community/comments/${id}/blind`).then(r => r.data),
  unblindComment:  (id: number) => api.patch(`/admin/community/comments/${id}/unblind`).then(r => r.data),
  getPopular:      (basis: string) => api.get(`/admin/popular-stocks?basis=${basis}`).then(r => r.data),
  getSignups:        () => api.get("/admin/signups").then(r => r.data),
  getVisitorTrend:   () => api.get("/admin/visitor-trend").then(r => r.data),
  getSystem:       () => api.get("/admin/system").then(r => r.data),
  /* 백엔드에 있는데 화면에서 안 쓰던 것 — 프로세스가 얼마나 자주 재시작되는지,
     지금 무엇을 붙들고 있는지를 본다 */
  getRuntime:      () => api.get("/admin/runtime").then(r => r.data),
  /* 관리자 행위 기록 — 되돌릴 수 없는 일이 무엇이 있었는지 */
  getAdminLogs:    (action = "", offset = 0) =>
    api.get("/admin/logs", { params: { ...(action ? { action } : {}), limit: 50, offset } }).then(r => r.data),
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
  unblindReport:   (id: number) => api.patch(`/admin/reports/${id}/unblind`).then(r => r.data),
  dismissReport:   (id: number) => api.patch(`/admin/reports/${id}/dismiss`).then(r => r.data),
  deleteReportContent: (id: number) => api.delete(`/admin/reports/${id}/content`).then(r => r.data),
  // 트렌드
  getSearchTrends: () => api.get("/admin/search-trends").then(r => r.data),
  getUsageStats:   () => api.get("/admin/usage-stats").then(r => r.data),
};

type Tab = "dashboard" | "users" | "community" | "banner" | "cache" | "reports" | "system" | "logs";

export default function Admin() {
  const { isAdmin, username } = useAuthStore();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("dashboard");

  const { data: stats } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: adminApi.getStats,
    staleTime: 30_000,
    enabled: isAdmin,
  });
  const pendingReports: number = stats?.pending_reports ?? 0;

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
      {/* 메인 탭. 공용 <Tabs> 는 이 파일 안에서도 다섯 곳이 쓰는데 정작
          메인 탭만 손으로 짜여 있었다. 배지(신고 대기 건수)를 겹쳐 붙이는
          모양이라 공용 컴포넌트에 그대로 안 들어가서, 모양은 두되 공용
          Tabs 가 주던 것(역할·선택 상태)은 붙여 둔다 —
          화면 읽어주는 기능이 "탭 목록, 4/7 선택됨" 으로 읽는다. */}
      <div role="tablist" aria-label="관리 항목"
           className="flex gap-1 border-b border-border overflow-x-auto scrollbar-hide">
        {([
          { id: "dashboard", Icon: BarChart2,     label: "대시보드",  badge: 0 },
          { id: "users",     Icon: Users,         label: "유저 관리", badge: 0 },
          { id: "community", Icon: MessageSquare, label: "커뮤니티",  badge: 0 },
          { id: "reports",   Icon: Flag,          label: "신고 관리", badge: pendingReports },
          { id: "banner",    Icon: Megaphone,     label: "배너·공지", badge: 0 },
          { id: "cache",     Icon: Database,      label: "캐시",      badge: 0 },
          { id: "system",    Icon: Activity,      label: "시스템",    badge: 0 },
          { id: "logs",      Icon: ScrollText,    label: "관리 기록", badge: 0 },
        ] as { id: Tab; Icon: any; label: string; badge: number }[]).map(({ id, Icon, label, badge }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold transition-all border-b-2 -mb-px whitespace-nowrap ${
              tab === id
                ? "border-accent-blue text-accent-blue"
                : "border-transparent text-text-muted hover:text-text-primary"
            }`}
          >
            <Icon size={14} />{label}
            {badge > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 bg-accent-red text-white text-2xs font-bold rounded-full flex items-center justify-center px-1">
                {badge > 99 ? "99+" : badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "dashboard" && <DashboardTab qc={qc} stats={stats} />}
      {tab === "users"     && <UsersTab qc={qc} />}
      {tab === "community" && <CommunityAdminTab qc={qc} />}
      {tab === "reports"   && <ReportsTab qc={qc} />}
      {tab === "banner"    && <BannerTab qc={qc} />}
      {tab === "cache"     && <CacheTab qc={qc} />}
      {tab === "system"    && <SystemTab />}
      {tab === "logs"      && <AdminLogTab />}
    </div>
  );
}

/* ─────────────────────────── 대시보드 탭 ─────────────────────────── */
function DashboardTab({ qc, stats: statsProp }: { qc: QueryClient; stats?: any }) {
  const [캐시확인, set캐시확인] = useState(false);
  const [popularBasis, setPopularBasis] = useState<"watchlist" | "portfolio">("watchlist");
  const { data: statsData } = useQuery({ queryKey: ["admin-stats"], queryFn: adminApi.getStats, staleTime: 30_000 });
  const stats = statsProp ?? statsData;
  const { data: popular } = useQuery({ queryKey: ["admin-popular", popularBasis], queryFn: () => adminApi.getPopular(popularBasis), staleTime: 60_000 });
  const { data: signups }      = useQuery({ queryKey: ["admin-signups"],       queryFn: adminApi.getSignups,      staleTime: 60_000 });
  const { data: visitorTrend } = useQuery({ queryKey: ["admin-visitor-trend"], queryFn: adminApi.getVisitorTrend, staleTime: 60_000 });
  const { data: system, refetch: refetchSystem } = useQuery({ queryKey: ["admin-system"], queryFn: adminApi.getSystem, staleTime: 30_000 });
  const { data: searchTrends } = useQuery({ queryKey: ["admin-search-trends"], queryFn: adminApi.getSearchTrends, staleTime: 60_000 });
  const { data: usageStats }   = useQuery({ queryKey: ["admin-usage-stats"],   queryFn: adminApi.getUsageStats,   staleTime: 60_000 });

  const clearMut = useMutation({
    mutationFn: adminApi.clearCache,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-system"] }); refetchSystem(); },
  });

  const METRIC_CARDS = [
    { label: "전체 회원",    value: stats?.total_users       ?? 0, color: "text-accent-blue",   bg: "bg-accent-blue/8",   Icon: Users },
    { label: "활성 계정",    value: stats?.active_users      ?? 0, color: "text-accent-green",  bg: "bg-accent-green/8",  Icon: CheckCircle },
    { label: "현재 접속",    value: stats?.online_users      ?? 0, color: "text-accent-cyan",      bg: "bg-accent-cyan/8",      Icon: Wifi },
    { label: "오늘 방문자",  value: stats?.today_visitors    ?? 0, color: "text-accent-orange",    bg: "bg-accent-orange/8",    Icon: Eye },
    { label: "관심종목 폴더", value: stats?.watchlist_folders ?? 0, color: "text-accent-yellow",    bg: "bg-accent-yellow/8",     Icon: Folder },
    { label: "포트폴리오 수", value: stats?.portfolio_items  ?? 0, color: "text-accent-purple",    bg: "bg-accent-purple/8",    Icon: TrendingUp },
    { label: "커뮤니티 글",  value: stats?.total_posts       ?? 0, color: "text-accent-red",      bg: "bg-accent-red/8",      Icon: MessageSquare },
    { label: "커뮤니티 댓글", value: stats?.total_comments   ?? 0, color: "text-accent-purple",      bg: "bg-accent-purple/8",      Icon: Heart },
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
    ETF: "bg-accent-purple/15 text-accent-purple",
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

      {/* 시스템 상태 + 가입 추이 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

        {/* 시스템 상태 */}
        <div className="rounded-xl border border-border bg-bg-card p-4 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-text-primary flex items-center gap-1.5">
              <Activity size={14} className="text-accent-blue" />시스템 상태
            </span>
            <button aria-label="새로고침" onClick={() => refetchSystem()} className="text-text-muted hover:text-text-primary transition-colors p-1 rounded">
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
                        <span className="text-xs text-text-muted">{system.db_latency_ms}ms</span>
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
            /* 같은 동작인데 캐시 탭에는 확인이 있고 여기만 없었다.
               전체 초기화는 0.15 CPU 서버에서 한동안 모든 화면을 느리게 만든다 */
            onClick={() => set캐시확인(true)}
            disabled={clearMut.isPending}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-border text-xs font-semibold text-text-muted hover:text-accent-red hover:border-accent-red/40 transition-all"
          >
            <RefreshCw size={13} className={clearMut.isPending ? "animate-spin" : ""} />
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
                    <div className="bg-bg-elevated border border-border text-text-primary text-2xs font-semibold px-1.5 py-0.5 rounded whitespace-nowrap shadow-float">
                      {d.date.slice(5)} · {d.count}명
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex gap-5 pt-1 border-t border-border">
            <div>
              <p className="text-2xs text-text-muted mb-0.5">오늘</p>
              <p className="text-xl font-bold font-mono text-text-primary">{todaySignups}</p>
            </div>
            <div>
              <p className="text-2xs text-text-muted mb-0.5">30일 누적</p>
              <p className="text-xl font-bold font-mono text-accent-blue">{totalMonth}</p>
            </div>
          </div>
        </div>
      </div>

      {/* 방문자 추이 */}
      <div className="rounded-xl border border-border bg-bg-card p-4 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-text-primary flex items-center gap-1.5">
            <Eye size={14} className="text-accent-orange" />방문자 추이
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
                      isToday ? "bg-accent-orange" : "bg-accent-orange/30 group-hover:bg-accent-orange/60"
                    }`}
                    style={{ height: `${Math.max(pct, d.count > 0 ? 8 : 2)}%` }}
                  />
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:flex pointer-events-none z-10">
                    <div className="bg-bg-elevated border border-border text-text-primary text-2xs font-semibold px-1.5 py-0.5 rounded whitespace-nowrap shadow-float">
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
            <p className="text-2xs text-text-muted mb-0.5">오늘</p>
            <p className="text-xl font-bold font-mono text-text-primary">{todayVisitors}</p>
          </div>
          <div>
            <p className="text-2xs text-text-muted mb-0.5">30일 누적</p>
            <p className="text-xl font-bold font-mono text-accent-orange">{totalVisitors.toLocaleString()}</p>
          </div>
        </div>
      </div>

      {/* 인기 종목 */}
      <div className="rounded-xl border border-border bg-bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <span className="text-sm font-semibold text-text-primary flex items-center gap-1.5">
            <Star size={14} className="text-accent-yellow" />인기 종목 TOP 10
          </span>
          <Tabs
            ariaLabel="인기 종목 기준" tone="subtle" fill={false}
            tabs={[
              { id: "watchlist", label: "관심종목" },
              { id: "portfolio", label: "보유종목" },
            ]}
            active={popularBasis}
            onChange={(id) => setPopularBasis(id as any)}
          />
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
                    <span className={`text-2xs font-bold px-1.5 py-px rounded shrink-0 ${MARKET_COLOR[item.market] ?? "bg-bg-secondary text-text-muted"}`}>
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

      {/* 검색으로 찾은 종목 — '무엇을 쳤나'가 아니라 '무엇을 찾았나' */}
      {(() => {
        const trends: { symbol: string; market: string; name: string; count: number }[] = searchTrends ?? [];
        const maxCount = Math.max(...trends.map(t => t.count), 1);
        return (
          <div className="rounded-xl border border-border bg-bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center gap-1.5">
              <Search size={14} className="text-accent-blue" />
              <span className="text-sm font-semibold text-text-primary">검색으로 찾은 종목 TOP 20</span>
              <span className="text-xs text-text-muted ml-auto">검색 결과에서 실제로 고른 종목</span>
            </div>
            {trends.length === 0 ? (
              <div className="py-8 text-center text-text-muted text-sm">아직 기록이 없습니다</div>
            ) : (
              <div className="divide-y divide-border/40">
                {trends.map((t, idx) => (
                  <Link
                    key={`${t.market}:${t.symbol}`}
                    to={`/stocks/${t.market}/${encodeURIComponent(t.symbol)}`}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-bg-hover transition-colors"
                  >
                    <span className={`w-5 text-center text-xs font-bold font-mono shrink-0 ${idx < 3 ? "text-accent-yellow" : "text-text-muted/50"}`}>
                      {idx + 1}
                    </span>
                    {t.market && <MarketBadge market={t.market} />}
                    <span className="flex-1 min-w-0 flex items-baseline gap-1.5 truncate">
                      <span className="text-sm text-text-primary font-medium truncate">{t.name || t.symbol}</span>
                      {t.name && <span className="text-xs font-mono text-text-dim shrink-0">{t.symbol}</span>}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="w-24 h-1.5 rounded-full bg-bg-elevated overflow-hidden">
                        <div className="h-full rounded-full bg-accent-blue/60" style={{ width: `${(t.count / maxCount) * 100}%` }} />
                      </div>
                      <span className="text-xs font-mono text-text-muted w-12 text-right">{t.count}회</span>
                    </div>
                  </Link>
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
              <span className="text-xs text-text-muted ml-auto">DB 영속화</span>
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

      {캐시확인 && (
        <ConfirmDialog
          title="캐시를 전부 비울까요?"
          message="모든 시세·재무 캐시가 사라집니다. 다시 채워질 때까지 한동안 모든 화면이 느려집니다."
          확인글="비우기"
          진행중={clearMut.isPending}
          onConfirm={() => { clearMut.mutate(); set캐시확인(false); }}
          onClose={() => set캐시확인(false)}
        />
      )}
    </div>
  );
}

/* ─────────────────────────── 커뮤니티 관리 탭 ─────────────────────────── */
const MARKET_COLOR_MAP: Record<string, string> = {
  KR:  "bg-accent-blue/15 text-accent-blue",
  US:  "bg-accent-green/15 text-accent-green",
  ETF: "bg-accent-purple/15 text-accent-purple",
};

function CommunityAdminTab({ qc }: { qc: QueryClient }) {
  const [subTab, setSubTab] = useState<"posts" | "comments">("posts");
  return (
    <div className="flex flex-col gap-4">
      <Tabs
        ariaLabel="커뮤니티 관리 대상" fill={false} className="w-fit"
        tabs={[{ id: "posts", label: "게시글" }, { id: "comments", label: "댓글" }]}
        active={subTab}
        onChange={(id) => setSubTab(id as any)}
      />
      {subTab === "posts"    && <PostsAdminSection qc={qc} />}
      {subTab === "comments" && <CommentsAdminSection qc={qc} />}
    </div>
  );
}

function PostsAdminSection({ qc }: { qc: QueryClient }) {
  const [좋아요볼글, set좋아요볼글] = useState<{ id: number; title?: string } | null>(null);
  const [page, setPage] = useState(1);
  const [marketFilter, setMarketFilter] = useState("ALL");
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [actingId, setActingId] = useState<number | null>(null);

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

  const actPost = (fn: (id: number) => Promise<any>, id: number) => {
    setActingId(id);
    fn(id).finally(() => { setActingId(null); refetch(); });
  };

  const posts: any[] = data?.items ?? [];
  const total: number = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  return (
    <div className="flex flex-col gap-4">
      {/* 필터 헤더 */}
      <div className="flex items-center gap-3 flex-wrap">
        <Tabs
          ariaLabel="시장 필터" fill={false}
          tabs={[
            { id: "ALL", label: "전체" }, { id: "KR", label: "KR" },
            { id: "US",  label: "US"   }, { id: "ETF", label: "ETF" },
          ]}
          active={marketFilter}
          onChange={(id) => { setMarketFilter(id as any); setPage(1); }}
        />
        <span className="text-xs text-text-dim ml-auto">총 {total.toLocaleString()}개</span>
        <button aria-label="새로고침" onClick={() => refetch()} className="p-1 text-text-muted hover:text-text-primary transition-colors">
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
                  <th className="text-center px-3 py-3 font-medium">관리</th>
                </tr>
              </thead>
              <tbody>
                {posts.map((p) => (
                  <tr key={p.id} className={`border-b border-border/30 hover:bg-bg-hover transition-colors ${p.is_blinded ? "opacity-50" : ""}`}>
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
                        <span className={`text-2xs font-bold px-1.5 py-px rounded ${MARKET_COLOR_MAP[p.market] ?? "bg-bg-secondary text-text-muted"}`}>
                          {p.market}
                        </span>
                        <span className="text-xs font-mono text-text-muted">{p.symbol}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 max-w-[200px] lg:max-w-xs">
                      <div className="flex items-center gap-1.5">
                        {p.is_blinded && (
                          <span className="text-2xs bg-accent-yellow/15 text-accent-yellow px-1.5 py-px rounded font-bold shrink-0">블라인드</span>
                        )}
                        <Link
                          to={`/post/${p.id}`}
                          className="text-xs text-text-secondary hover:text-accent-blue transition-colors truncate block"
                          title={p.title || p.body || ""}
                        >
                          {p.title || p.body || "—"}
                        </Link>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-center hidden sm:table-cell">
                      {/* 개수만 보여 주면 '누가' 를 알 수 없다. 좋아요가 갑자기
                          몰릴 때 관리자가 보고 싶은 것은 이름 쪽이다 */}
                      <button
                        disabled={!p.like_count}
                        aria-label={`좋아요 누른 사람 ${p.like_count}명 보기`}
                        onClick={(e) => { e.stopPropagation(); set좋아요볼글({ id: p.id, title: p.title }); }}
                        className={`flex items-center justify-center gap-1 mx-auto px-1.5 py-1 rounded transition-colors ${
                          p.like_count
                            ? "text-text-muted hover:text-accent-red hover:bg-accent-red/10"
                            : "text-text-dim cursor-default"}`}
                      >
                        <Heart size={11} />
                        <span className="text-xs font-mono">{p.like_count}</span>
                      </button>
                    </td>
                    <td className="px-3 py-3 text-center hidden lg:table-cell">
                      <span className="text-xs text-text-muted font-mono">{p.created_at.slice(0, 10)}</span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => actPost(p.is_blinded ? adminApi.unblindPost : adminApi.blindPost, p.id)}
                          disabled={actingId === p.id}
                          title={p.is_blinded ? "블라인드 복구" : "블라인드"}
                          className={`p-1 rounded transition-colors ${p.is_blinded ? "text-accent-blue hover:bg-accent-blue/10" : "text-accent-yellow hover:bg-accent-yellow/10"} disabled:opacity-40`}
                        >
                          <Eye size={13} />
                        </button>
                        <button aria-label="삭제"
                          onClick={() => setConfirmDelete(p.id)}
                          className="p-1 rounded text-text-muted hover:text-accent-red transition-colors"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
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
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
            className="px-3 py-1.5 rounded-xl text-xs text-text-muted border border-border hover:border-accent-blue/50 hover:text-accent-blue disabled:opacity-30 transition-all">이전</button>
          <span className="text-xs text-text-muted px-2">{page} / {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            className="px-3 py-1.5 rounded-xl text-xs text-text-muted border border-border hover:border-accent-blue/50 hover:text-accent-blue disabled:opacity-30 transition-all">다음</button>
        </div>
      )}

      {/* 삭제 확인 팝업 */}
      {confirmDelete !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => { if (!deleteMut.isPending) setConfirmDelete(null); }}>
          <div className="bg-bg-card border border-border rounded-2xl shadow-modal p-6 w-80 flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-col gap-1">
              <p className="text-sm font-bold text-text-primary">글을 삭제하시겠습니까?</p>
              <p className="text-xs text-text-dim">삭제된 게시글은 복구할 수 없습니다.</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDelete(null)} disabled={deleteMut.isPending}
                className="flex-1 py-2 rounded-xl border border-border text-sm text-text-secondary hover:border-accent-blue/50 transition-all disabled:opacity-50">취소</button>
              <button onClick={() => deleteMut.mutate(confirmDelete)} disabled={deleteMut.isPending}
                className="flex-1 py-2 rounded-xl bg-accent-red text-white text-sm font-semibold hover:bg-accent-red/90 transition-all disabled:opacity-50">
                {deleteMut.isPending ? "삭제 중..." : "삭제"}
              </button>
            </div>
          </div>
        </div>
      )}

      {좋아요볼글 && (
        <PostLikesModal postId={좋아요볼글.id} title={좋아요볼글.title}
                        onClose={() => set좋아요볼글(null)} />
      )}
    </div>
  );
}

function CommentsAdminSection({ qc }: { qc: QueryClient }) {
  const [page, setPage] = useState(1);
  const [actingId, setActingId] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-community-comments", page],
    queryFn: () => adminApi.getCommunityComments(page),
    staleTime: 30_000,
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => adminApi.deleteCommunityComment(id),
    onSuccess: () => {
      setConfirmDelete(null);
      qc.invalidateQueries({ queryKey: ["admin-community-comments"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
      refetch();
    },
  });

  const actComment = (fn: (id: number) => Promise<any>, id: number) => {
    setActingId(id);
    fn(id).finally(() => { setActingId(null); refetch(); });
  };

  const comments: any[] = data?.items ?? [];
  const total: number   = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="text-xs text-text-muted ml-auto">총 {total.toLocaleString()}개</span>
        <button aria-label="새로고침" onClick={() => refetch()} className="p-1 text-text-muted hover:text-text-primary transition-colors">
          <RefreshCw size={13} />
        </button>
      </div>

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
                  <th className="text-left px-3 py-3 font-medium hidden md:table-cell">게시글</th>
                  <th className="text-left px-3 py-3 font-medium">내용</th>
                  <th className="text-center px-3 py-3 font-medium hidden lg:table-cell">작성일</th>
                  <th className="text-center px-3 py-3 font-medium">관리</th>
                </tr>
              </thead>
              <tbody>
                {comments.map((c) => (
                  <tr key={c.id} className={`border-b border-border/30 hover:bg-bg-hover transition-colors ${c.is_blinded ? "opacity-50" : ""}`}>
                    <td className="px-4 py-3 font-mono text-text-muted text-xs">{c.id}</td>
                    <td className="px-3 py-3">
                      <Link to={`/profile/${c.user_id}`}
                        className="text-xs font-semibold text-text-primary hover:text-accent-blue transition-colors">
                        {c.username}
                      </Link>
                    </td>
                    <td className="px-3 py-3 hidden md:table-cell">
                      <Link to={`/post/${c.post_id}`}
                        className="text-xs font-mono text-accent-blue hover:underline">
                        #{c.post_id}
                      </Link>
                    </td>
                    <td className="px-3 py-3 max-w-[200px] lg:max-w-xs">
                      <div className="flex items-center gap-1.5">
                        {c.is_blinded && (
                          <span className="text-2xs bg-accent-yellow/15 text-accent-yellow px-1.5 py-px rounded font-bold shrink-0">블라인드</span>
                        )}
                        {c.parent_id && (
                          <span className="text-2xs bg-bg-elevated text-text-muted px-1.5 py-px rounded shrink-0">답글</span>
                        )}
                        <span className="text-xs text-text-secondary truncate">{c.content || "—"}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-center hidden lg:table-cell">
                      <span className="text-xs text-text-muted font-mono">{c.created_at?.slice(0, 10)}</span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => actComment(c.is_blinded ? adminApi.unblindComment : adminApi.blindComment, c.id)}
                          disabled={actingId === c.id}
                          title={c.is_blinded ? "블라인드 복구" : "블라인드"}
                          className={`p-1 rounded transition-colors ${c.is_blinded ? "text-accent-blue hover:bg-accent-blue/10" : "text-accent-yellow hover:bg-accent-yellow/10"} disabled:opacity-40`}
                        >
                          <Eye size={13} />
                        </button>
                        <button aria-label="삭제"
                          onClick={() => setConfirmDelete(c.id)}
                          className="p-1 rounded text-text-muted hover:text-accent-red transition-colors"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {comments.length === 0 && (
              <div className="py-12 text-center text-text-muted text-sm">댓글이 없습니다</div>
            )}
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            className="px-3 py-1.5 rounded-xl text-xs text-text-muted border border-border hover:border-accent-blue/50 hover:text-accent-blue disabled:opacity-30 transition-all">이전</button>
          <span className="text-xs text-text-muted px-2">{page} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            className="px-3 py-1.5 rounded-xl text-xs text-text-muted border border-border hover:border-accent-blue/50 hover:text-accent-blue disabled:opacity-30 transition-all">다음</button>
        </div>
      )}

      {confirmDelete !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => { if (!deleteMut.isPending) setConfirmDelete(null); }}>
          <div className="bg-bg-card border border-border rounded-2xl shadow-modal p-6 w-80 flex flex-col gap-4"
            onClick={e => e.stopPropagation()}>
            <div className="flex flex-col gap-1">
              <p className="text-sm font-bold text-text-primary">댓글을 삭제하시겠습니까?</p>
              <p className="text-xs text-text-dim">삭제된 댓글은 복구할 수 없습니다.</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDelete(null)} disabled={deleteMut.isPending}
                className="flex-1 py-2 rounded-xl border border-border text-sm text-text-secondary hover:border-accent-blue/50 transition-all disabled:opacity-50">취소</button>
              <button onClick={() => deleteMut.mutate(confirmDelete)} disabled={deleteMut.isPending}
                className="flex-1 py-2 rounded-xl bg-accent-red text-white text-sm font-semibold hover:bg-accent-red/90 transition-all disabled:opacity-50">
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
function UsersTab({ qc }: { qc: QueryClient }) {
  /* 계정 정지는 그 사람이 로그인을 못 하게 되는 일이다. 목록에서 옆줄을
     잘못 누르는 것이 가장 흔한 실수라, 무엇에 대한 일인지 이름을 보여 주고
     한 번 묻는다 */
  const [확인, set확인] = useState<
    { 종류: "active" | "ban"; id: number; 이름: string; 켬: boolean } | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [detailUserId, setDetailUserId] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-users", statusFilter, page],
    queryFn: () => adminApi.getUsers(statusFilter, page),
    staleTime: 30_000,
  });

  const allUsers: any[] = data?.items ?? [];
  const total: number   = data?.total ?? 0;
  const totalPages = Math.ceil(total / 50);

  const toggleMut = useMutation({
    mutationFn: (id: number) => adminApi.toggleActive(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
  });
  const communityBanMut = useMutation({
    mutationFn: (id: number) => adminApi.toggleCommunityBan(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
  });

  const filtered = search.trim()
    ? allUsers.filter(u =>
        u.username.toLowerCase().includes(search.toLowerCase()) ||
        (u.email ?? "").toLowerCase().includes(search.toLowerCase()))
    : allUsers;

  return (
    <div className="flex flex-col gap-3">
      {/* 필터 + 검색 */}
      <div className="flex items-center gap-2 flex-wrap">
        <Tabs
          ariaLabel="유저 상태 필터" tone="subtle" fill={false}
          tabs={[
            { id: "all", label: "전체" }, { id: "active", label: "활성" },
            { id: "inactive", label: "비활성" },
          ]}
          active={statusFilter}
          onChange={(id) => { setStatusFilter(id as any); setPage(1); }}
        />
        <div className="relative flex-1 min-w-[160px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="이름 또는 이메일 검색..."
            className="w-full pl-8 pr-7 py-1.5 text-xs bg-bg-elevated border border-border rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue/60 transition-colors" />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary">
              <XIcon size={13} />
            </button>
          )}
        </div>
        <span className="text-xs text-text-muted shrink-0">총 {total}명</span>
      </div>

      {/* 유저 목록 */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-5 h-5 rounded-full border-2 border-accent-blue border-t-transparent animate-spin" />
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-bg-card divide-y divide-border/40 overflow-hidden">
          {/* 컬럼 헤더 */}
          <div className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-bg-elevated/60 border-b border-border text-xs font-semibold text-text-muted">
            <span className="w-7 shrink-0 hidden sm:block">ID</span>
            <span className="flex-1 min-w-0">아이디 / 이메일</span>
            <span className="shrink-0 w-[56px] text-center">계정</span>
            <span className="shrink-0 w-[72px] text-center">커뮤니티</span>
            <span className="shrink-0 hidden lg:block w-[80px] text-right">가입일</span>
          </div>
          {filtered.length === 0 && (
            <div className="py-10 text-center text-text-muted text-sm">검색 결과가 없습니다</div>
          )}
          {filtered.map((u: any) => (
            <div key={u.id} className="flex items-center gap-2 px-3 sm:px-4 py-2.5 hover:bg-bg-hover transition-colors min-w-0">
              {/* ID */}
              <span className="text-xs font-mono text-text-muted/60 w-7 shrink-0 hidden sm:block">{u.id}</span>

              {/* 이름 + 배지 + 이메일 */}
              <div className="flex-1 min-w-0 flex items-center gap-1.5 overflow-hidden">
                <button
                  onClick={() => setDetailUserId(u.id)}
                  className="text-sm font-semibold text-text-primary hover:text-accent-blue transition-colors whitespace-nowrap">
                  {u.username}
                </button>
                {u.is_admin && (
                  <span className="text-2xs bg-accent-blue/15 text-accent-blue px-1.5 py-px rounded font-bold shrink-0">관리자</span>
                )}
                {!u.is_admin && u.is_community_banned && (
                  <span className="text-2xs bg-accent-orange/15 text-accent-orange px-1.5 py-px rounded font-bold shrink-0 hidden sm:inline">커뮤차단</span>
                )}
                {u.email && (
                  <span className="text-xs text-text-muted truncate hidden sm:inline">{u.email}</span>
                )}
              </div>

              {/* 계정 비활성화 토글 */}
              <div className="w-[56px] flex justify-center shrink-0">
                {!u.is_admin ? (
                  <button
                    aria-label={u.is_active ? `${u.username} 계정 비활성화` : `${u.username} 계정 활성화`}
                    onClick={() => set확인({ 종류: "active", id: u.id, 이름: u.username, 켬: u.is_active })}
                    title={u.is_active ? "계정 비활성화" : "계정 활성화"}>
                    {u.is_active
                      ? <ToggleRight size={20} className="text-accent-green" />
                      : <ToggleLeft size={20} className="text-text-muted" />}
                  </button>
                ) : (
                  <span className="text-2xs bg-accent-blue/15 text-accent-blue px-1.5 py-px rounded font-bold">관리자</span>
                )}
              </div>

              {/* 커뮤니티 비활성화 토글 */}
              <div className="w-[72px] flex justify-center shrink-0">
                {!u.is_admin && (
                  <button
                    aria-label={u.is_community_banned ? `${u.username} 커뮤니티 차단 해제` : `${u.username} 커뮤니티 차단`}
                    onClick={() => set확인({ 종류: "ban", id: u.id, 이름: u.username, 켬: !u.is_community_banned })}
                    title={u.is_community_banned ? "커뮤니티 차단 해제" : "커뮤니티 차단"}>
                    {u.is_community_banned
                      ? <ToggleRight size={20} className="text-accent-orange" />
                      : <ToggleLeft size={20} className="text-text-muted" />}
                  </button>
                )}
              </div>

              {/* 가입일 */}
              <span className="text-xs text-text-muted font-mono shrink-0 hidden lg:block w-[80px] text-right">
                {u.created_at ? u.created_at.slice(0, 10) : "—"}
              </span>
            </div>
          ))}
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

      {/* 유저 상세 모달 */}
      {detailUserId !== null && (
        <UserDetailModal userId={detailUserId} onClose={() => setDetailUserId(null)} qc={qc} />
      )}

      {/* 되돌릴 수 없는 일 앞에서 한 번 묻는다 */}
      {확인 && (
        <ConfirmDialog
          title={확인.종류 === "active"
            ? (확인.켬 ? "계정을 정지할까요?" : "계정을 다시 열까요?")
            : (확인.켬 ? "커뮤니티를 차단할까요?" : "커뮤니티 차단을 풀까요?")}
          message={확인.종류 === "active"
            ? (확인.켬 ? "이 사람은 로그인할 수 없게 됩니다." : "다시 로그인할 수 있게 됩니다.")
            : (확인.켬 ? "글·댓글을 쓸 수 없게 됩니다. 로그인과 열람은 그대로입니다." : "다시 글을 쓸 수 있게 됩니다.")}
          대상={확인.이름}
          위험={확인.켬}
          확인글={확인.켬 ? (확인.종류 === "active" ? "정지" : "차단") : "해제"}
          진행중={toggleMut.isPending || communityBanMut.isPending}
          onConfirm={() => {
            if (확인.종류 === "active") toggleMut.mutate(확인.id);
            else communityBanMut.mutate(확인.id);
            set확인(null);
          }}
          onClose={() => set확인(null)}
        />
      )}
    </div>
  );
}

function UserDetailModal({ userId, onClose, qc }: { userId: number; onClose: () => void; qc: QueryClient }) {
  const [확인, set확인] = useState<"active" | "ban" | null>(null);
  /* 어느 숫자를 펼쳤나. 한 번에 하나만 연다 — 모달 안이라 자리가 좁다 */
  const [펼친것, set펼친것] = useState<항목종류 | null>(null);
  const { data: detail, isLoading } = useQuery({
    queryKey: ["admin-user-detail", userId],
    queryFn: () => adminApi.getUserDetail(userId),
    staleTime: 30_000,
  });

  const toggleMut = useMutation({
    mutationFn: () => adminApi.toggleActive(userId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-users"] }); qc.invalidateQueries({ queryKey: ["admin-user-detail", userId] }); },
  });
  const communityBanMut = useMutation({
    mutationFn: () => adminApi.toggleCommunityBan(userId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-users"] }); qc.invalidateQueries({ queryKey: ["admin-user-detail", userId] }); },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}>
      <div className="bg-bg-card border border-border rounded-2xl shadow-modal w-full max-w-md flex flex-col max-h-[85vh] overflow-hidden"
        onClick={e => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <p className="text-sm font-bold text-text-primary">유저 상세</p>
          <button aria-label="닫기" onClick={onClose}><XIcon size={16} className="text-text-muted" /></button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-5 h-5 rounded-full border-2 border-accent-blue border-t-transparent animate-spin" />
          </div>
        ) : detail ? (
          <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5">
            {/* 프로필 */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-accent-blue/15 flex items-center justify-center shrink-0">
                <span className="text-sm font-bold text-accent-blue">{detail.username?.[0]?.toUpperCase()}</span>
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-bold text-text-primary">{detail.username}</p>
                  {detail.is_admin && <span className="text-2xs bg-accent-blue/15 text-accent-blue px-1.5 py-px rounded font-bold">관리자</span>}
                  {!detail.is_active && <span className="text-2xs bg-accent-red/15 text-accent-red px-1.5 py-px rounded font-bold">비활성</span>}
                  {detail.is_community_banned && <span className="text-2xs bg-accent-orange/15 text-accent-orange px-1.5 py-px rounded font-bold">커뮤차단</span>}
                </div>
                <p className="text-xs text-text-muted">{detail.email}</p>
                <p className="text-xs text-text-muted">가입일: {detail.created_at?.slice(0, 10)}</p>
              </div>
            </div>

            {/* 통계 — 누르면 실제 내용이 펼쳐진다.
                숫자만 봐서는 다음에 무엇을 할지 정할 수 없다. 관리자가 이
                화면을 여는 이유는 대개 '이 사람이 무슨 글을 썼길래' 다 */}
            <div className="grid grid-cols-3 gap-2">
              {([
                { kind: "posts",     label: "게시글",   value: detail.post_count },
                { kind: "comments",  label: "댓글",     value: detail.comment_count },
                { kind: "reports",   label: "신고 보냄", value: detail.report_sent_count },
                { kind: "followers", label: "팔로워",   value: detail.follower_count },
                { kind: "following", label: "팔로잉",   value: detail.following_count },
              ] as { kind: 항목종류; label: string; value: number }[]).map(({ kind, label, value }) => {
                const 열림 = 펼친것 === kind;
                const 빔 = !value;
                return (
                  <button
                    key={kind}
                    /* 0건이면 펼쳐 봐야 빈 목록이라 누르지 못하게 한다 */
                    disabled={빔}
                    aria-expanded={열림}
                    onClick={() => set펼친것(열림 ? null : kind)}
                    className={`rounded-lg p-2.5 flex flex-col gap-0.5 text-left transition-all ${
                      열림 ? "bg-accent-blue/15 ring-1 ring-accent-blue/40"
                           : "bg-bg-elevated hover:bg-bg-hover"
                    } ${빔 ? "opacity-50 cursor-default" : ""}`}
                  >
                    <p className="text-2xs text-text-muted">{label}</p>
                    <p className={`text-base font-bold font-mono ${
                      열림 ? "text-accent-blue" : "text-text-primary"}`}>{value}</p>
                  </button>
                );
              })}
            </div>

            {펼친것 && (
              <div className="rounded-lg border border-border bg-bg-card px-3 py-2">
                <div className="flex items-center justify-between pb-1.5 border-b border-border">
                  <span className="text-xs font-semibold text-text-primary">{항목이름[펼친것]}</span>
                  <button aria-label="닫기" onClick={() => set펼친것(null)}
                          className="text-2xs text-text-muted hover:text-text-primary">닫기</button>
                </div>
                <UserItemsPanel userId={userId} kind={펼친것} />
              </div>
            )}

            {/* 최근 게시글 */}
            {detail.recent_posts?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-text-muted mb-2">최근 게시글</p>
                <div className="flex flex-col gap-1">
                  {detail.recent_posts.map((p: any) => (
                    <Link key={p.id} to={`/post/${p.id}`}
                      className="flex items-center gap-2 p-2 rounded-lg bg-bg-elevated hover:bg-bg-hover transition-colors">
                      <span className={`text-2xs font-bold px-1.5 py-px rounded shrink-0 ${MARKET_COLOR_MAP[p.market] ?? "bg-bg-secondary text-text-muted"}`}>{p.market}</span>
                      <span className="text-xs text-text-secondary truncate flex-1">{p.title || "—"}</span>
                      <span className="text-2xs text-text-muted font-mono shrink-0">{p.created_at?.slice(0, 10)}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* 액션 버튼 */}
            {!detail.is_admin && (
              <div className="flex gap-2 pt-2 border-t border-border">
                <button onClick={() => set확인("active")} disabled={toggleMut.isPending}
                  className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-all ${
                    detail.is_active
                      ? "bg-accent-red/10 text-accent-red hover:bg-accent-red/20"
                      : "bg-accent-green/10 text-accent-green hover:bg-accent-green/20"
                  } disabled:opacity-50`}>
                  {detail.is_active ? "계정 비활성화" : "계정 활성화"}
                </button>
                <button onClick={() => set확인("ban")} disabled={communityBanMut.isPending}
                  className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-all ${
                    detail.is_community_banned
                      ? "bg-accent-green/10 text-accent-green hover:bg-accent-green/20"
                      : "bg-accent-orange/10 text-accent-orange hover:bg-accent-orange/20"
                  } disabled:opacity-50`}>
                  {detail.is_community_banned ? "커뮤니티 차단 해제" : "커뮤니티 차단"}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="py-12 text-center text-text-muted text-sm">정보를 불러올 수 없습니다</div>
        )}
      </div>

      {확인 && detail && (
        <ConfirmDialog
          title={확인 === "active"
            ? (detail.is_active ? "계정을 정지할까요?" : "계정을 다시 열까요?")
            : (detail.is_community_banned ? "커뮤니티 차단을 풀까요?" : "커뮤니티를 차단할까요?")}
          message={확인 === "active"
            ? (detail.is_active ? "이 사람은 로그인할 수 없게 됩니다." : "다시 로그인할 수 있게 됩니다.")
            : (detail.is_community_banned ? "다시 글을 쓸 수 있게 됩니다." : "글·댓글을 쓸 수 없게 됩니다. 로그인과 열람은 그대로입니다.")}
          대상={detail.username}
          위험={확인 === "active" ? detail.is_active : !detail.is_community_banned}
          확인글={확인 === "active"
            ? (detail.is_active ? "정지" : "열기")
            : (detail.is_community_banned ? "해제" : "차단")}
          진행중={toggleMut.isPending || communityBanMut.isPending}
          onConfirm={() => {
            if (확인 === "active") toggleMut.mutate();
            else communityBanMut.mutate();
            set확인(null);
          }}
          onClose={() => set확인(null)}
        />
      )}
    </div>
  );
}

/* ─────────────────────────── 공지사항 탭 ─────────────────────────── */
function AnnouncementTab({ annoText, setAnnoText, qc }: { annoText: string; setAnnoText: (v: string) => void; qc: QueryClient }) {
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
function BannerTab({ qc }: { qc: QueryClient }) {
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
function CacheTab({ qc }: { qc: QueryClient }) {
  /* window.confirm 은 앱 모양과 따로 놀고, 무엇이 지워지는지(키 이름)를
     보여 줄 수 없다. 항목 삭제에는 아예 확인이 없었다 */
  const [확인, set확인] = useState<{ 전체: boolean; key?: string } | null>(null);
  const [search, setSearch] = useState("");
  const [confirmed, setConfirmed] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-cache"],
    queryFn: () => adminApi.listCache(),
    staleTime: 10_000,
    refetchInterval: 30_000,
    /* 시스템 탭은 이미 이렇게 하는데 여기만 빠져 있었다. 관리자 화면을
       켜 둔 채 다른 일을 하면 30초마다 계속 물어본다 */
    refetchIntervalInBackground: false,
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
          <button aria-label="새로고침" onClick={() => refetch()} className="p-1.5 rounded-lg hover:bg-bg-elevated text-text-muted hover:text-accent-blue transition-colors">
            <RefreshCw size={14} />
          </button>
          <button
            onClick={() => set확인({ 전체: true })}
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
            <div className="py-8 text-center text-text-muted text-sm">불러오는 중</div>
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
                  <button
                    aria-label={`${item.key} 삭제`}
                    onClick={() => set확인({ 전체: false, key: item.key })}
                    className="text-accent-red hover:text-accent-red/70 text-xs font-semibold">삭제</button>
                ) : (
                  <button aria-label="삭제" onClick={() => setConfirmed(item.key)}
                    className="text-text-muted hover:text-accent-red transition-colors">
                    <Trash2 size={13} />
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

      {확인 && (
        <ConfirmDialog
          title={확인.전체 ? "캐시를 전부 비울까요?" : "이 캐시를 지울까요?"}
          message={확인.전체
            ? "모든 시세·재무 캐시가 사라집니다. 다시 채워질 때까지 한동안 모든 화면이 느려집니다."
            : "다음에 누군가 이 값을 찾으면 외부에서 새로 받아옵니다."}
          대상={확인.key}
          위험={확인.전체}
          확인글={확인.전체 ? "비우기" : "삭제"}
          진행중={clearMut.isPending || deleteMut.isPending}
          onConfirm={() => {
            if (확인.전체) clearMut.mutate();
            else if (확인.key) deleteMut.mutate(확인.key);
            set확인(null);
          }}
          onClose={() => set확인(null)}
        />
      )}
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

function PopupTab({ qc }: { qc: QueryClient }) {
  /* 여기만 window.confirm 이 남아 있었다. 브라우저 기본 창은 앱 모양과
     따로 놀고, 어느 팝업을 지우는지 제목을 보여 줄 수 없다 */
  const [지울팝업, set지울팝업] = useState<{ id: number; title: string } | null>(null);
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

  const BG_COLOR_MAP: Record<string, string> = { blue: "bg-accent-blue/15 text-accent-blue", green: "bg-accent-green/15 text-accent-green", amber: "bg-accent-yellow/15 text-accent-yellow", red: "bg-accent-red/15 text-accent-red", purple: "bg-accent-purple/15 text-accent-purple" };

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
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${BG_COLOR_MAP[p.bg_color] ?? "bg-bg-secondary text-text-muted"}`}>
                    {POPUP_TYPE_LABELS[p.popup_type] ?? p.popup_type}
                  </span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${p.is_active ? "bg-accent-green/12 text-accent-green" : "bg-bg-elevated text-text-muted"}`}>
                    {p.is_active ? "활성" : "비활성"}
                  </span>
                  <span className="text-sm font-semibold text-text-primary">{p.title}</span>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button aria-label="수정" onClick={() => openEdit(p)} className="p-1.5 text-text-muted hover:text-accent-blue transition-colors"><Pencil size={13} /></button>
                  <button aria-label={`${p.title} 삭제`} onClick={() => set지울팝업({ id: p.id, title: p.title })} className="p-1.5 text-text-muted hover:text-accent-red transition-colors"><Trash2 size={13} /></button>
                </div>
              </div>
              {p.content && <p className="text-xs text-text-muted leading-relaxed">{p.content}</p>}
              {(p.starts_at || p.ends_at) && (
                <div className="flex items-center gap-1.5 text-xs text-text-muted">
                  <Calendar size={11} />
                  {p.starts_at ? p.starts_at.slice(0, 16) : "—"} ~ {p.ends_at ? p.ends_at.slice(0, 16) : "상시"}
                </div>
              )}
              {p.link_url && (
                <a href={safeExternalUrl(p.link_url)} target="_blank" rel="noopener noreferrer nofollow" className="flex items-center gap-1 text-xs text-accent-blue hover:underline">
                  <ExternalLink size={11} />{p.link_text || p.link_url}
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 팝업 폼 모달 */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowForm(false)}>
          <div className="bg-bg-card border border-border rounded-2xl shadow-modal p-6 w-full max-w-lg mx-4 flex flex-col gap-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
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

      {지울팝업 && (
        <ConfirmDialog
          title="팝업을 삭제할까요?"
          message="지운 팝업은 되돌릴 수 없습니다."
          대상={지울팝업.title}
          확인글="삭제"
          진행중={deleteMut.isPending}
          onConfirm={() => { deleteMut.mutate(지울팝업.id); set지울팝업(null); }}
          onClose={() => set지울팝업(null)}
        />
      )}
    </div>
  );
}

/* ─────────────────────────── 신고 관리 탭 ─────────────────────────── */
function ReportsTab({ qc }: { qc: QueryClient }) {
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
    pending:   "bg-accent-yellow/15 text-accent-yellow border-accent-yellow/30",
    resolved:  "bg-accent-green/12 text-accent-green border-accent-green/30",
    dismissed: "bg-bg-elevated text-text-muted border-border",
  };

  return (
    <div className="flex flex-col gap-4">
      {/* 필터 바 */}
      <div className="flex items-center gap-2 flex-wrap">
        <Tabs
          ariaLabel="신고 상태 필터" tone="subtle" fill={false}
          tabs={(["pending", "resolved", "dismissed", "all"] as const)
            .map((s) => ({ id: s, label: STATUS_LABELS[s] }))}
          active={statusFilter}
          onChange={(id) => { setStatusFilter(id as any); setPage(1); }}
        />
        <span className="text-xs text-text-muted ml-auto">총 {total}건</span>
        <button aria-label="새로고침" onClick={() => refetch()} className="p-1.5 rounded-lg text-text-muted hover:text-accent-blue hover:bg-bg-elevated transition-colors">
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
                  <span className={`text-xs font-bold px-2 py-px rounded-full border ${STATUS_BADGE[r.status] ?? STATUS_BADGE.dismissed}`}>
                    {STATUS_LABELS[r.status] ?? r.status}
                  </span>
                  <span className="text-xs text-text-muted font-mono">#{r.id}</span>
                  <span className="text-xs text-text-muted">·</span>
                  <Flag size={11} className="text-text-muted" />
                  <span className="text-xs font-semibold text-text-secondary">{r.reporter}</span>
                  <span className="text-xs text-text-muted">신고</span>
                  <span className="text-xs text-text-muted ml-auto font-mono">{r.created_at?.slice(0, 10)}</span>
                </div>

                {/* 신고 사유 */}
                <div className="px-4 pt-3 pb-2 flex items-start gap-2">
                  <AlertCircle size={13} className={`shrink-0 mt-0.5 ${isPending ? "text-accent-yellow" : "text-text-muted"}`} />
                  <p className="text-sm font-medium text-text-primary leading-snug">{r.reason}</p>
                </div>

                {/* 신고 대상 콘텐츠 */}
                <div className="px-4 pb-3 flex flex-col gap-2">
                  {r.post_id && (
                    <div className="rounded-lg bg-bg-elevated border border-border/50 p-3 flex flex-col gap-1.5">
                      <div className="flex items-center gap-2">
                        <MessageSquare size={11} className="text-text-muted shrink-0" />
                        <span className="text-xs text-text-muted">게시글 #{r.post_id}</span>
                        {r.post_author && (
                          <span className="text-xs font-semibold text-text-secondary">· @{r.post_author}</span>
                        )}
                        <Link to={`/post/${r.post_id}`} target="_blank"
                          className="ml-auto flex items-center gap-0.5 text-xs text-accent-blue hover:underline shrink-0">
                          <ExternalLink size={11} />보기
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
                        <span className="text-xs text-text-muted">댓글 #{r.comment_id}</span>
                        {r.comment_author && (
                          <span className="text-xs font-semibold text-text-secondary">· @{r.comment_author}</span>
                        )}
                        {r.post_id && (
                          <Link to={`/post/${r.post_id}`} target="_blank"
                            className="ml-auto flex items-center gap-0.5 text-xs text-accent-blue hover:underline shrink-0">
                            <ExternalLink size={11} />게시글
                          </Link>
                        )}
                      </div>
                      <p className="text-xs text-text-secondary leading-relaxed line-clamp-2">{r.comment_preview || "—"}</p>
                    </div>
                  )}
                </div>

                {/* 액션 버튼 */}
                {isPending ? (
                  <div className="flex border-t border-border/50 divide-x divide-border/50">
                    <button onClick={() => act(adminApi.blindReport, r.id)} disabled={isActing}
                      className="flex-1 py-3 text-xs font-semibold text-accent-yellow hover:bg-accent-yellow/8 active:bg-accent-yellow/15 transition-colors disabled:opacity-40">
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
                ) : (r.status === "resolved" && (r.post_is_blinded || r.comment_is_blinded)) && (
                  <div className="flex border-t border-border/50">
                    <button onClick={() => act(adminApi.unblindReport, r.id)} disabled={isActing}
                      className="flex-1 py-3 text-xs font-semibold text-accent-blue hover:bg-accent-blue/8 active:bg-accent-blue/15 transition-colors disabled:opacity-40">
                      {isActing ? "처리 중..." : "블라인드 복구"}
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

/* ─────────────────────────── 관리 기록 탭 ─────────────────────────── */
/** 무슨 일이 있었는지.
 *
 *  지우기와 정지는 되돌릴 수 없다. 되돌릴 수 없다면 최소한 무슨 일이
 *  있었는지는 알 수 있어야 한다 — 특히 관리자가 여럿일 때.
 *  예전에는 로그 파일에만, 그나마 '누가' 가 빠진 채 남았다. */
const 행위이름: Record<string, string> = {
  "user.delete": "계정 삭제", "user.active": "계정 정지·해제",
  "user.community_ban": "커뮤니티 차단·해제",
  "post.delete": "글 삭제", "post.blind": "글 가리기", "post.unblind": "글 복구",
  "comment.delete": "댓글 삭제", "comment.blind": "댓글 가리기", "comment.unblind": "댓글 복구",
  "cache.clear": "캐시 전체 비우기", "cache.delete": "캐시 삭제",
  "cache.delete_prefix": "캐시 묶음 삭제",
};
/** 되돌릴 수 없는 것은 눈에 띄게 */
const 되돌릴수없음 = new Set(["user.delete", "post.delete", "comment.delete", "cache.clear"]);

function AdminLogTab() {
  const [필터, set필터] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["admin-logs", 필터],
    queryFn: () => adminApi.getAdminLogs(필터),
    staleTime: 15_000,
  });
  const items: any[] = data?.items ?? [];

  return (
    <div className="flex flex-col gap-3">
      <Tabs
        ariaLabel="기록 종류" tone="subtle" fill={false} className="w-fit"
        tabs={[
          { id: "", label: "전체" },
          { id: "user", label: "계정" },
          { id: "post", label: "게시글" },
          { id: "comment", label: "댓글" },
          { id: "cache", label: "캐시" },
        ]}
        active={필터}
        onChange={set필터}
      />

      <div className="rounded-xl border border-border bg-bg-card overflow-hidden">
        {isLoading ? (
          <div className="py-16 text-center text-text-muted text-sm">불러오는 중</div>
        ) : !items.length ? (
          <div className="py-16 text-center">
            <p className="text-text-muted text-sm">아직 기록이 없습니다</p>
            <p className="text-2xs text-text-dim mt-1">관리자가 무언가를 지우거나 정지하면 여기 남습니다</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((it) => (
              <li key={it.id} className="px-4 py-3 flex items-start gap-3">
                <span className={`text-2xs px-1.5 py-0.5 rounded font-bold shrink-0 whitespace-nowrap ${
                  되돌릴수없음.has(it.action)
                    ? "bg-accent-red/15 text-accent-red"
                    : "bg-bg-elevated text-text-muted"}`}>
                  {행위이름[it.action] ?? it.action}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary truncate">
                    <span className="font-semibold">{it.actor || "?"}</span>
                    {it.target_id && (
                      <span className="text-text-muted"> · {it.target_type} {it.target_id}</span>
                    )}
                  </p>
                  {it.detail && (
                    <p className="text-2xs text-text-dim mt-0.5 break-all">{it.detail}</p>
                  )}
                </div>
                <span className="text-2xs text-text-dim shrink-0 whitespace-nowrap">
                  {it.created_at
                    ? new Date(it.created_at).toLocaleString("ko-KR", {
                        month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
        {data?.total > items.length && (
          <div className="px-4 py-2 border-t border-border text-2xs text-text-muted">
            최근 {items.length}건 표시 / 전체 {data.total}건
          </div>
        )}
      </div>
    </div>
  );
}
