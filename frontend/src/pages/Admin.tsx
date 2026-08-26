import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import { Users, BarChart2, Megaphone, ShieldCheck, Activity, Database, MessageSquare, Flag, ScrollText } from "lucide-react";
import SystemTab from "@/components/admin/SystemTab";

import { adminApi } from "@/components/admin/adminApi";
/* 탭마다 파일 하나. 원래 이 파일 한 장에 1,963줄이 있었는데, 관리자
   화면에 탭이 여덟 개라 사실상 여덟 화면이 한곳에 있었다. */
import DashboardTab from "@/components/admin/DashboardTab";
import CommunityAdminTab from "@/components/admin/CommunityAdminTab";
import UsersTab from "@/components/admin/UsersTab";
import BannerTab from "@/components/admin/BannerTab";
import CacheTab from "@/components/admin/CacheTab";
import ReportsTab from "@/components/admin/ReportsTab";
import AdminLogTab from "@/components/admin/AdminLogTab";

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
