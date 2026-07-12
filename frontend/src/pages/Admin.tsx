import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import api from "@/api/client";
import {
  Users, BarChart2, Megaphone, Trash2, ToggleLeft, ToggleRight,
  ShieldCheck, RefreshCw, Activity, Database, Star, CheckCircle,
  TrendingUp, Zap, Clock, Folder, Wifi, Eye,
} from "lucide-react";

const adminApi = {
  getStats:        () => api.get("/admin/stats").then(r => r.data),
  getUsers:        () => api.get("/admin/users").then(r => r.data),
  getPopular:      (basis: string) => api.get(`/admin/popular-stocks?basis=${basis}`).then(r => r.data),
  getSignups:      () => api.get("/admin/signups").then(r => r.data),
  getSystem:       () => api.get("/admin/system").then(r => r.data),
  clearCache:      () => api.post("/admin/cache/clear").then(r => r.data),
  toggleActive:    (id: number) => api.patch(`/admin/users/${id}/active`).then(r => r.data),
  deleteUser:      (id: number) => api.delete(`/admin/users/${id}`).then(r => r.data),
  getAnnouncement: () => api.get("/admin/announcement").then(r => r.data),
  setAnnouncement: (text: string) => api.post("/admin/announcement", { text }).then(r => r.data),
};

type Tab = "dashboard" | "users" | "announcement";

export default function Admin() {
  const { isAdmin, username } = useAuthStore();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("dashboard");
  const [annoText, setAnnoText] = useState("");

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
    { id: "dashboard",    Icon: BarChart2, label: "대시보드" },
    { id: "users",        Icon: Users,     label: "유저 관리" },
    { id: "announcement", Icon: Megaphone, label: "공지사항" },
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
      <div className="flex gap-1 border-b border-border">
        {TABS.map(({ id, Icon, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold transition-all border-b-2 -mb-px ${
              tab === id
                ? "border-accent-blue text-accent-blue"
                : "border-transparent text-text-muted hover:text-text-primary"
            }`}
          >
            <Icon size={14} />{label}
          </button>
        ))}
      </div>

      {tab === "dashboard"    && <DashboardTab qc={qc} />}
      {tab === "users"        && <UsersTab qc={qc} />}
      {tab === "announcement" && <AnnouncementTab annoText={annoText} setAnnoText={setAnnoText} qc={qc} />}
    </div>
  );
}

/* ─────────────────────────── 대시보드 탭 ─────────────────────────── */
function DashboardTab({ qc }: { qc: any }) {
  const [popularBasis, setPopularBasis] = useState<"watchlist" | "portfolio">("watchlist");
  const { data: stats }   = useQuery({ queryKey: ["admin-stats"],   queryFn: adminApi.getStats,   staleTime: 30_000 });
  const { data: popular } = useQuery({ queryKey: ["admin-popular", popularBasis], queryFn: () => adminApi.getPopular(popularBasis), staleTime: 60_000 });
  const { data: signups } = useQuery({ queryKey: ["admin-signups"], queryFn: adminApi.getSignups, staleTime: 60_000 });
  const { data: system, refetch: refetchSystem } = useQuery({ queryKey: ["admin-system"], queryFn: adminApi.getSystem, staleTime: 30_000 });

  const clearMut = useMutation({
    mutationFn: adminApi.clearCache,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-system"] }); refetchSystem(); },
  });

  const METRIC_CARDS = [
    { label: "전체 회원",    value: stats?.total_users       ?? 0, color: "text-accent-blue",   bg: "bg-accent-blue/8",   Icon: Users },
    { label: "활성 계정",    value: stats?.active_users      ?? 0, color: "text-accent-green",  bg: "bg-accent-green/8",  Icon: CheckCircle },
    { label: "현재 접속",    value: stats?.online_users      ?? 0, color: "text-cyan-400",      bg: "bg-cyan-400/8",      Icon: Wifi },
    { label: "오늘 방문자",  value: stats?.today_visitors    ?? 0, color: "text-orange-400",    bg: "bg-orange-400/8",    Icon: Eye },
    { label: "관심종목 수",  value: stats?.watchlist_items   ?? 0, color: "text-accent-yellow", bg: "bg-accent-yellow/8", Icon: Star },
    { label: "관심종목 폴더", value: stats?.watchlist_folders ?? 0, color: "text-amber-400",    bg: "bg-amber-400/8",     Icon: Folder },
    { label: "포트폴리오 수", value: stats?.portfolio_items  ?? 0, color: "text-purple-400",    bg: "bg-purple-400/8",    Icon: TrendingUp },
  ];

  const signupData: { date: string; count: number }[] = signups ?? [];
  const maxSignup  = Math.max(...signupData.map(d => d.count), 1);
  const totalMonth = signupData.reduce((s, d) => s + d.count, 0);
  const todayCount = signupData[signupData.length - 1]?.count ?? 0;

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
              <p className="text-xl font-bold font-mono text-text-primary">{todayCount}</p>
            </div>
            <div>
              <p className="text-[10px] text-text-muted mb-0.5">30일 누적</p>
              <p className="text-xl font-bold font-mono text-accent-blue">{totalMonth}</p>
            </div>
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
    </div>
  );
}

/* ─────────────────────────── 유저 관리 탭 ─────────────────────────── */
function UsersTab({ qc }: { qc: any }) {
  const { data: users = [], isLoading } = useQuery({ queryKey: ["admin-users"], queryFn: adminApi.getUsers, staleTime: 30_000 });
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const toggleMut = useMutation({
    mutationFn: (id: number) => adminApi.toggleActive(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => adminApi.deleteUser(id),
    onSuccess: () => { setConfirmDelete(null); qc.invalidateQueries({ queryKey: ["admin-users"] }); },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-5 h-5 rounded-full border-2 border-accent-blue border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <span className="text-sm font-semibold text-text-primary">전체 유저</span>
        <span className="text-xs text-text-muted bg-bg-secondary px-2 py-0.5 rounded-full">{users.length}명</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-text-muted text-xs">
              <th className="text-left px-4 py-3 font-medium">ID</th>
              <th className="text-left px-3 py-3 font-medium">아이디</th>
              <th className="text-left px-3 py-3 font-medium hidden sm:table-cell">이메일</th>
              <th className="text-left px-3 py-3 font-medium hidden md:table-cell">가입일</th>
              <th className="text-center px-3 py-3 font-medium">상태</th>
              <th className="text-center px-3 py-3 font-medium">관리</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u: any) => (
              <tr key={u.id} className="border-b border-border/30 hover:bg-bg-hover transition-colors">
                <td className="px-4 py-3 font-mono text-text-muted text-xs">{u.id}</td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-text-primary">{u.username}</span>
                    {u.is_admin && (
                      <span className="text-[10px] bg-accent-blue/15 text-accent-blue px-1.5 py-px rounded font-bold">관리자</span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-3 text-text-muted text-xs hidden sm:table-cell">{u.email || "—"}</td>
                <td className="px-3 py-3 text-text-muted text-xs hidden md:table-cell">
                  {u.created_at ? u.created_at.slice(0, 10) : "—"}
                </td>
                <td className="px-3 py-3 text-center">
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${u.is_active ? "bg-accent-green/12 text-accent-green" : "bg-accent-red/12 text-accent-red"}`}>
                    {u.is_active ? "활성" : "비활성"}
                  </span>
                </td>
                <td className="px-3 py-3 text-center">
                  {!u.is_admin && (
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => toggleMut.mutate(u.id)}
                        title={u.is_active ? "비활성화" : "활성화"}
                        className="text-text-muted hover:text-accent-blue transition-colors"
                      >
                        {u.is_active
                          ? <ToggleRight size={18} className="text-accent-green" />
                          : <ToggleLeft  size={18} />}
                      </button>
                      {confirmDelete === u.id ? (
                        <div className="flex gap-1">
                          <button onClick={() => deleteMut.mutate(u.id)} className="text-[11px] text-accent-red font-semibold hover:underline">삭제</button>
                          <button onClick={() => setConfirmDelete(null)} className="text-[11px] text-text-muted hover:underline">취소</button>
                        </div>
                      ) : (
                        <button onClick={() => setConfirmDelete(u.id)} className="text-text-muted hover:text-accent-red transition-colors">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─────────────────────────── 공지사항 탭 ─────────────────────────── */
function AnnouncementTab({ annoText, setAnnoText, qc }: { annoText: string; setAnnoText: (v: string) => void; qc: any }) {
  const [saved, setSaved] = useState(false);

  useQuery({
    queryKey: ["admin-announcement"],
    queryFn: adminApi.getAnnouncement,
    staleTime: 30_000,
    onSuccess: (d: any) => { if (annoText === "") setAnnoText(d.text || ""); },
  } as any);

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
