import { NavLink, Outlet, Link, useNavigate, useLocation } from "react-router-dom";
import { LayoutDashboard, Search, LineChart, BookMarked, Sun, Moon, MoreHorizontal, X, LogOut, LogIn, Wallet, Settings, Newspaper, Award, ShieldCheck, Megaphone, User, Rss } from "lucide-react";
import { safeExternalUrl } from "@/utils/url";
import Logo from "./Logo";
import { useWSStore } from "@/store/wsStore";
import { useAuthStore } from "@/store/authStore";
import { useSettingsStore } from "@/store/settingsStore";
import SearchBar from "@/components/SearchBar";
import InstallAppButton from "@/components/InstallAppButton";
import LoadingProgressOverlay from "@/components/LoadingProgressOverlay";
import NotificationBell from "@/components/community/NotificationBell";
import SettingsModal from "@/components/SettingsModal";
import { 더보기_경로 } from "@/constants/moreNav";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import api from "@/api/client";

const NAV = [
  { to: "/",          icon: LayoutDashboard, label: "대시보드",  end: true },
  { to: "/portfolio", icon: Wallet,           label: "내 자산"  },
  { to: "/quant",     icon: Award,            label: "퀀트"     },
  { to: "/screening", icon: Search,           label: "스크리닝" },
  { to: "/backtest",  icon: LineChart,        label: "백테스트" },
  { to: "/strategies",icon: BookMarked,       label: "전략저장소"},
  { to: "/news",      icon: Newspaper,        label: "뉴스"     },
  { to: "/feed",      icon: Rss,              label: "피드"     },
];

/* ── 모바일 하단 탭바 ─────────────────────────────────── */
const BOTTOM_NAV = [
  { to: "/",          icon: LayoutDashboard, label: "대시보드", end: true },
  { to: "/portfolio", icon: Wallet,          label: "내 자산"  },
  { to: "/feed",      icon: Rss,             label: "피드"     },
  { to: "/news",      icon: Newspaper,       label: "뉴스"     },
  { to: "/quant",     icon: Award,           label: "퀀트"     },
];

export default function Layout() {
  const wsStatus = useWSStore((s) => s.indicesStatus);
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const username = useAuthStore((s) => s.username);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const logout = useAuthStore((s) => s.logout);
  const fontSize = useSettingsStore((s) => s.fontSize);
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const orientation = useSettingsStore((s) => s.orientation);
  const navigate = useNavigate();
  const location = useLocation();
  const [systemPrefersLight, setSystemPrefersLight] = useState(
    () => window.matchMedia?.("(prefers-color-scheme: light)").matches ?? false
  );
  const [settingsOpen, setSettingsOpen] = useState(false);

  const isLight = theme === "system" ? systemPrefersLight : theme === "light";

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  /* 시스템 다크/라이트 모드 변경 감지 */
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const handler = (e: MediaQueryListEvent) => setSystemPrefersLight(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("light", isLight);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", isLight ? "#f0f4f8" : "#0b0e17");
  }, [isLight]);

  /* 글씨 크기 클래스 적용 */
  useEffect(() => {
    const html = document.documentElement;
    html.classList.remove("font-large", "font-xl");
    if (fontSize === "large") html.classList.add("font-large");
    else if (fontSize === "xl") html.classList.add("font-xl");
  }, [fontSize]);

  /* 화면 방향 고정 적용 (설치된 PWA 등 지원 환경에서만 동작)
     일반 브라우저 탭(풀스크린/PWA 아님)에서는 lock()/unlock()이 Promise reject가 아니라
     동기적으로 예외를 던질 수 있어 try/catch 필수 — 안 그러면 페이지 첫 진입 시
     이 effect가 매번 실행되며 앱 전체가 흰/검은 화면으로 죽음 */
  useEffect(() => {
    try {
      const so = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      if (!so) return;
      if (orientation === "system") so.unlock?.();
      else so.lock?.(orientation)?.catch(() => {});
    } catch {}
  }, [orientation]);

  /* 하단 탭의 "더보기"는 /more 화면이지만, 거기 든 메뉴 중 하나를 보고
     있을 때도 탭이 켜져 있어야 한다 — 안 그러면 관심종목을 보는 중에는
     다섯 탭 중 아무것도 안 켜져, 지금 어디인지 알 수 없다 */
  const isMoreActive = 더보기_경로.some(
    (경로) => location.pathname === 경로 || location.pathname.startsWith(경로 + "/")
  );

  const navItemCls = (isActive: boolean) =>
    `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${
      isActive ? "bg-accent-blue/15 text-accent-blue border border-accent-blue/20 shadow-card"
               : "text-text-muted hover:text-text-secondary hover:bg-bg-elevated"}`;

  return (
    <div className="flex h-screen bg-bg-base overflow-hidden">

      {/* ── 진입 시 데이터 로딩 진행률 ────────────────────── */}
      <LoadingProgressOverlay />

      {/* ── 데스크탑 사이드바 ─────────────────────────────── */}
      <aside className="hidden lg:flex w-52 flex-shrink-0 flex-col bg-bg-card border-r border-border">
        <div className="px-5 pt-6 pb-5">
          <div className="flex items-center gap-2.5">
            <Logo size={28} />
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold text-text-primary tracking-tight leading-none">StockPlatform</span>
                <span className="text-2xs font-bold px-1.5 py-0.5 rounded bg-accent-blue/15 text-accent-blue leading-none">BETA</span>
              </div>
              <div className="text-2xs text-text-dim mt-0.5">종목발굴 &amp; 백테스트</div>
            </div>
          </div>
        </div>
        <div className="mx-4 h-px bg-border-subtle mb-3" />
        <nav className="flex-1 px-3 flex flex-col gap-0.5">
          {NAV.map(({ to, icon: Icon, label, end }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) => navItemCls(isActive)}
            >
              <Icon size={14} className="flex-shrink-0" />{label}
            </NavLink>
          ))}
        </nav>
        <div className="px-3 pb-2 flex flex-col gap-0.5">
          {isLoggedIn && (
            <NavLink to="/mypage"
              className={({ isActive }) => navItemCls(isActive)}
            >
              <User size={14} className="flex-shrink-0" />내 프로필
            </NavLink>
          )}
          <InstallAppButton className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm font-medium text-text-muted hover:text-text-secondary hover:bg-bg-elevated transition-all duration-150" />
          <button
            onClick={() => setSettingsOpen(true)}
            className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm font-medium text-text-muted hover:text-text-secondary hover:bg-bg-elevated transition-all duration-150"
          >
            <Settings size={14} className="flex-shrink-0" />설정
          </button>
        </div>
        <div className="px-5 py-3 border-t border-border-subtle">
          <div className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
              wsStatus === "connected"  ? "bg-accent-green animate-pulse" :
              wsStatus === "connecting" ? "bg-accent-yellow animate-pulse-slow" : "bg-text-dim"}`} />
            <span className="text-2xs text-text-dim">
              {wsStatus === "connected" ? "실시간 연결됨" : wsStatus === "connecting" ? "연결 중..." : "오프라인"}
            </span>
          </div>
        </div>
      </aside>


      {/* ── 메인 영역 ──────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* 헤더 */}
        <header className="flex-shrink-0 flex items-center px-3 md:px-6 gap-3 bg-bg-primary border-b border-border" style={{ height: "52px" }}>
          <SearchBar />
          <div className="flex-1" />
          <div className="flex items-center gap-2 text-2xs text-text-dim">
            <span className="font-mono hidden lg:block">
              {new Date().toLocaleDateString("ko-KR", { year:"numeric", month:"long", day:"numeric", weekday:"short" })}
            </span>
            {isLoggedIn ? (
              <div className="flex items-center gap-1.5">
                <Link to="/mypage" className="hidden sm:block text-text-muted text-xs font-medium truncate max-w-[120px] hover:text-accent-blue transition-colors" title={username ?? ""}>
                  {username}
                </Link>
                <NotificationBell />
                {isAdmin && (
                  <Link to="/admin" className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-accent-blue/40 hover:bg-accent-blue/10 text-accent-blue transition-all" title="관리자 페이지">
                    <ShieldCheck size={13} />
                    <span className="hidden sm:block text-xs">관리자</span>
                  </Link>
                )}
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-border hover:bg-bg-elevated text-text-muted hover:text-accent-red transition-all"
                  title="로그아웃"
                >
                  <LogOut size={13} />
                  <span className="hidden sm:block text-xs">로그아웃</span>
                </button>
              </div>
            ) : (
              <Link
                to="/login"
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-border hover:bg-bg-elevated text-text-muted hover:text-accent-blue transition-all whitespace-nowrap"
              >
                <LogIn size={13} />
                <span className="text-xs">로그인</span>
              </Link>
            )}
            <button
              onClick={() => setTheme(isLight ? "dark" : "light")}
              className="p-1.5 rounded-lg border border-border hover:bg-bg-elevated text-text-muted hover:text-text-primary transition-all"
              title={isLight ? "다크 모드" : "라이트 모드"}
            >
              {isLight ? <Moon size={14} /> : <Sun size={14} />}
            </button>
          </div>
        </header>

        {/* 공지사항 배너 */}
        <AnnouncementBanner />
        {/* 팝업 배너 */}
        <PopupBanners />

        {/* 콘텐츠 */}
        <main className="flex-1 overflow-y-auto bg-bg-primary pb-[calc(3.5rem_+_env(safe-area-inset-bottom))] lg:pb-0">
          <div className="p-3 md:p-5 max-w-[1600px] mx-auto">
            <Outlet />
          </div>
        </main>
      </div>

      {/* ── 모바일 하단 탭바 ─────────────────────────────── */}
      <nav
        className="lg:hidden fixed bottom-0 left-0 right-0 z-30 flex items-stretch bg-bg-card border-t border-border"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {BOTTOM_NAV.map(({ to, icon: Icon, label, end }) => (
          <NavLink key={to} to={to} end={end} className="flex-1 active:scale-95 transition-transform">
            {({ isActive }) => (
              <div className={`relative flex flex-col items-center justify-center gap-0.5 h-14 text-2xs font-medium transition-colors duration-200 ${
                isActive ? "text-accent-blue" : "text-text-muted"}`}>
                {isActive && <span className="absolute top-1.5 w-1 h-1 rounded-full bg-accent-blue fade-in" />}
                <Icon size={20} className={`transition-transform duration-200 ${isActive ? "scale-110" : "scale-100"}`} />
                {label}
              </div>
            )}
          </NavLink>
        ))}
        <NavLink to="/more" className="flex-1 active:scale-95 transition-transform">
          <div className={`relative flex flex-col items-center justify-center gap-0.5 h-14 text-2xs font-medium transition-colors duration-200 ${
            isMoreActive ? "text-accent-blue" : "text-text-muted"}`}>
            {isMoreActive && <span className="absolute top-1.5 w-1 h-1 rounded-full bg-accent-blue fade-in" />}
            <MoreHorizontal size={20} className={`transition-transform duration-200 ${isMoreActive ? "scale-110" : "scale-100"}`} />
            더보기
          </div>
        </NavLink>
      </nav>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

/* ── 팝업 배너 ──────────────────────────────────────────── */
const POPUP_BG_CLASS: Record<string, string> = {
  blue:   "bg-accent-blue/10 border-accent-blue/20 text-accent-blue",
  green:  "bg-accent-green/10 border-accent-green/20 text-accent-green",
  amber:  "bg-accent-yellow/10 border-accent-yellow/20 text-accent-yellow",
  red:    "bg-accent-red/10 border-accent-red/20 text-accent-red",
  purple: "bg-accent-purple/10 border-accent-purple/20 text-accent-purple",
};

function PopupBanners() {
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const { data: popups = [] } = useQuery<any[]>({
    queryKey: ["active-popups"],
    queryFn: () => api.get("/admin/popups/active").then(r => r.data),
    staleTime: 300_000,
  });
  const visible = popups.filter((p: any) => !dismissed.has(p.id));
  if (visible.length === 0) return null;
  return (
    <div className="flex flex-col">
      {visible.map((p: any) => {
        const cls = POPUP_BG_CLASS[p.bg_color] ?? POPUP_BG_CLASS["blue"];
        return (
          <div key={p.id} className={`flex items-center gap-2 px-4 py-2 border-b text-sm ${cls}`}>
            <span className="flex-1">
              <span className="font-semibold mr-1.5">{p.title}</span>
              {p.content && <span className="opacity-80">{p.content}</span>}
              {p.link_url && (
                <a href={safeExternalUrl(p.link_url)} target="_blank" rel="noopener noreferrer nofollow"
                  className="ml-2 underline underline-offset-2 text-xs font-semibold opacity-80 hover:opacity-100">
                  {p.link_text || "자세히 보기"}
                </a>
              )}
            </span>
            <button aria-label="알림 닫기" onClick={() => setDismissed(s => new Set([...s, p.id]))} className="flex-shrink-0 hover:opacity-60 transition-opacity">
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* ── 공지사항 배너 ─────────────────────────────────────── */
function AnnouncementBanner() {
  const [dismissed, setDismissed] = useState(false);
  const { data } = useQuery({
    queryKey: ["announcement"],
    queryFn: () => api.get("/admin/announcement").then(r => r.data),
    staleTime: 300_000,
  });
  const text = data?.text || "";
  if (!text || dismissed) return null;
  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-accent-blue/10 border-b border-accent-blue/20 text-accent-blue text-sm">
      <Megaphone size={14} className="flex-shrink-0" />
      <span className="flex-1">{text}</span>
      <button aria-label="알림 닫기" onClick={() => setDismissed(true)} className="flex-shrink-0 hover:text-accent-blue/60 transition-colors">
        <X size={14} />
      </button>
    </div>
  );
}
