/** 대시보드 탭 — 한눈에 보는 숫자들.
 *
 * 원래 Admin.tsx 한 파일(1,963줄)에 있던 것을 탭 단위로 가른 조각이다.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, type QueryClient } from "@tanstack/react-query";
import { Users, RefreshCw, Activity, Database, Star, CheckCircle, TrendingUp, Zap, Clock, Folder, Wifi, Eye, Search, MessageSquare, Heart } from "lucide-react";
import { Tabs, MarketBadge } from "@/components/ui";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

import { adminApi } from "@/components/admin/adminApi";

/* ─────────────────────────── 대시보드 탭 ─────────────────────────── */
export function DashboardTab({ qc, stats: statsProp }: { qc: QueryClient; stats?: any }) {
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

export default DashboardTab;
