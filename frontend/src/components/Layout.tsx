import { NavLink, Outlet } from "react-router-dom";
import { LayoutDashboard, Search, LineChart, Star, BookMarked, Activity, Sun, Moon, Menu, X } from "lucide-react";
import { useWSStore } from "@/store/wsStore";
import SearchBar from "@/components/SearchBar";
import { useState, useEffect } from "react";

const NAV = [
  { to: "/",          icon: LayoutDashboard, label: "대시보드",  end: true },
  { to: "/screening", icon: Search,           label: "스크리닝" },
  { to: "/backtest",  icon: LineChart,        label: "백테스트" },
  { to: "/watchlist", icon: Star,             label: "관심종목" },
  { to: "/strategies",icon: BookMarked,       label: "전략저장소"},
];

export default function Layout() {
  const wsStatus = useWSStore((s) => s.indicesStatus);
  const [isLight, setIsLight] = useState(() => localStorage.getItem("theme") === "light");
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle("light", isLight);
    localStorage.setItem("theme", isLight ? "light" : "dark");
  }, [isLight]);

  // 메뉴 열릴 때 스크롤 막기
  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="flex h-screen bg-bg-base overflow-hidden">

      {/* ── 데스크탑 사이드바 (md 이상) ─────────── */}
      <aside className="hidden md:flex w-52 flex-shrink-0 flex-col bg-bg-card border-r border-border">
        <div className="px-5 pt-6 pb-5">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-accent-blue flex items-center justify-center flex-shrink-0">
              <Activity size={14} className="text-white" />
            </div>
            <div>
              <div className="text-sm font-bold text-text-primary tracking-tight leading-none">StockPlatform</div>
              <div className="text-2xs text-text-dim mt-0.5">종목발굴 &amp; 백테스트</div>
            </div>
          </div>
        </div>
        <div className="mx-4 h-px bg-border-subtle mb-3" />
        <nav className="flex-1 px-3 flex flex-col gap-0.5">
          {NAV.map(({ to, icon: Icon, label, end }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${
                  isActive ? "bg-accent-blue/15 text-accent-blue border border-accent-blue/20 shadow-sm"
                           : "text-text-muted hover:text-text-secondary hover:bg-bg-elevated"}`}
            >
              <Icon size={15} className="flex-shrink-0" />{label}
            </NavLink>
          ))}
        </nav>
        <div className="px-5 py-4 border-t border-border-subtle">
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

      {/* ── 모바일 드로어 오버레이 ───────────────── */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={closeMenu}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
        </div>
      )}

      {/* ── 모바일 드로어 패널 ───────────────────── */}
      <aside
        className={`fixed top-0 left-0 h-full z-50 w-64 flex flex-col md:hidden transition-transform duration-300 ${
          menuOpen ? "translate-x-0" : "-translate-x-full"}`}
        className="bg-bg-card border-r border-border"
      >
        <div className="px-5 pt-6 pb-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-accent-blue flex items-center justify-center flex-shrink-0">
              <Activity size={14} className="text-white" />
            </div>
            <div>
              <div className="text-sm font-bold text-text-primary tracking-tight leading-none">StockPlatform</div>
              <div className="text-2xs text-text-dim mt-0.5">종목발굴 &amp; 백테스트</div>
            </div>
          </div>
          <button onClick={closeMenu} className="text-text-muted hover:text-text-primary p-1">
            <X size={18} />
          </button>
        </div>
        <div className="mx-4 h-px bg-border-subtle mb-3" />
        <nav className="flex-1 px-3 flex flex-col gap-0.5">
          {NAV.map(({ to, icon: Icon, label, end }) => (
            <NavLink key={to} to={to} end={end} onClick={closeMenu}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-3 rounded-lg text-sm font-medium transition-all duration-150 ${
                  isActive ? "bg-accent-blue/15 text-accent-blue border border-accent-blue/20 shadow-sm"
                           : "text-text-muted hover:text-text-secondary hover:bg-bg-elevated"}`}
            >
              <Icon size={16} className="flex-shrink-0" />{label}
            </NavLink>
          ))}
        </nav>
        <div className="px-5 py-4 border-t border-border-subtle">
          <div className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
              wsStatus === "connected" ? "bg-accent-green animate-pulse" : "bg-text-dim"}`} />
            <span className="text-2xs text-text-dim">
              {wsStatus === "connected" ? "실시간 연결됨" : "오프라인"}
            </span>
          </div>
        </div>
      </aside>

      {/* ── 메인 영역 ──────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* 헤더 */}
        <header className="flex-shrink-0 flex items-center px-3 md:px-6 gap-3 bg-bg-primary border-b border-border" style={{ height: "52px" }}>

          {/* 모바일 햄버거 버튼 */}
          <button
            onClick={() => setMenuOpen(v => !v)}
            className="md:hidden p-1.5 rounded-lg border border-border hover:bg-bg-elevated text-text-muted hover:text-text-primary transition-all"
          >
            <Menu size={16} />
          </button>

          <SearchBar />
          <div className="flex-1" />
          <div className="flex items-center gap-2 text-2xs text-text-dim">
            <span className="font-mono hidden lg:block">
              {new Date().toLocaleDateString("ko-KR", { year:"numeric", month:"long", day:"numeric", weekday:"short" })}
            </span>
            <button
              onClick={() => setIsLight(v => !v)}
              className="p-1.5 rounded-lg border border-border hover:bg-bg-elevated text-text-muted hover:text-text-primary transition-all"
              title={isLight ? "다크 모드" : "라이트 모드"}
            >
              {isLight ? <Moon size={14} /> : <Sun size={14} />}
            </button>
          </div>
        </header>

        {/* 콘텐츠 */}
        <main className="flex-1 overflow-y-auto bg-bg-primary">
          <div className="p-3 md:p-5 max-w-[1600px] mx-auto">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
