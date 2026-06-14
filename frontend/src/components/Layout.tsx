import { NavLink, Outlet, Link, useNavigate } from "react-router-dom";
import { LayoutDashboard, Search, LineChart, BookMarked, Sun, Moon, Menu, X, LogOut, LogIn, Wallet, Settings, Newspaper } from "lucide-react";
import Logo from "./Logo";
import { useWSStore } from "@/store/wsStore";
import { useAuthStore } from "@/store/authStore";
import { useSettingsStore } from "@/store/settingsStore";
import type { ColorScheme, FontSize } from "@/store/settingsStore";
import SearchBar from "@/components/SearchBar";
import InstallAppButton from "@/components/InstallAppButton";
import { useState, useEffect } from "react";

const NAV = [
  { to: "/",          icon: LayoutDashboard, label: "대시보드",  end: true },
  { to: "/portfolio", icon: Wallet,           label: "내 자산"  },
  { to: "/screening", icon: Search,           label: "스크리닝" },
  { to: "/backtest",  icon: LineChart,        label: "백테스트" },
  { to: "/strategies",icon: BookMarked,       label: "전략저장소"},
  { to: "/news",      icon: Newspaper,        label: "뉴스"     },
];

function SettingsModal({ onClose }: { onClose: () => void }) {
  const { colorScheme, setColorScheme, fontSize, setFontSize } = useSettingsStore();
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-sm bg-bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-sm font-bold text-text-primary">설정</h3>
          <button onClick={onClose} className="p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-elevated">
            <X size={15} />
          </button>
        </div>
        <div className="px-5 py-5 flex flex-col gap-5">

          {/* 등락 색상 */}
          <div>
            <p className="text-xs font-semibold text-text-muted mb-2">등락 색상</p>
            <div className="flex gap-2">
              {([
                { value: "green-red", label: "초록 / 빨강", desc: "상승=초록, 하락=빨강" },
                { value: "red-blue",  label: "빨강 / 파랑",  desc: "상승=빨강, 하락=파랑" },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setColorScheme(opt.value as ColorScheme)}
                  className={`flex-1 flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all ${
                    colorScheme === opt.value
                      ? "border-accent-blue bg-accent-blue/10"
                      : "border-border hover:border-accent-blue/40 hover:bg-bg-elevated"
                  }`}
                >
                  <div className="flex gap-1.5">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${opt.value === "green-red" ? "text-accent-green bg-accent-green/10" : "text-accent-red bg-accent-red/10"}`}>▲</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${opt.value === "green-red" ? "text-accent-red bg-accent-red/10" : "text-accent-blue bg-accent-blue/10"}`}>▼</span>
                  </div>
                  <span className="text-xs font-semibold text-text-primary">{opt.label}</span>
                  <span className="text-[10px] text-text-muted text-center leading-tight">{opt.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 글씨 크기 */}
          <div>
            <p className="text-xs font-semibold text-text-muted mb-2">글씨 크기</p>
            <div className="flex gap-2">
              {([
                { value: "normal", label: "기본",   size: "text-xs"  },
                { value: "large",  label: "크게",   size: "text-sm"  },
                { value: "xl",     label: "아주 크게", size: "text-base" },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setFontSize(opt.value as FontSize)}
                  className={`flex-1 flex flex-col items-center gap-1.5 py-3 rounded-xl border transition-all ${
                    fontSize === opt.value
                      ? "border-accent-blue bg-accent-blue/10"
                      : "border-border hover:border-accent-blue/40 hover:bg-bg-elevated"
                  }`}
                >
                  <span className={`font-bold text-text-primary ${opt.size}`}>Aa</span>
                  <span className="text-[10px] text-text-muted">{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

        </div>
        <div className="px-5 pb-5">
          <button
            onClick={onClose}
            className="w-full py-2 text-sm font-semibold rounded-lg bg-accent-blue text-white hover:bg-blue-600 transition-colors"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Layout() {
  const wsStatus = useWSStore((s) => s.indicesStatus);
  const { isLoggedIn, username, logout } = useAuthStore();
  const { fontSize } = useSettingsStore();
  const navigate = useNavigate();
  const [isLight, setIsLight] = useState(() => localStorage.getItem("theme") === "light");
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  useEffect(() => {
    document.documentElement.classList.toggle("light", isLight);
    localStorage.setItem("theme", isLight ? "light" : "dark");
  }, [isLight]);

  /* 글씨 크기 클래스 적용 */
  useEffect(() => {
    const html = document.documentElement;
    html.classList.remove("font-large", "font-xl");
    if (fontSize === "large") html.classList.add("font-large");
    else if (fontSize === "xl") html.classList.add("font-xl");
  }, [fontSize]);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);

  const navItemCls = (isActive: boolean) =>
    `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${
      isActive ? "bg-accent-blue/15 text-accent-blue border border-accent-blue/20 shadow-sm"
               : "text-text-muted hover:text-text-secondary hover:bg-bg-elevated"}`;

  return (
    <div className="flex h-screen bg-bg-base overflow-hidden">

      {/* ── 데스크탑 사이드바 ─────────────────────────────── */}
      <aside className="hidden md:flex w-52 flex-shrink-0 flex-col bg-bg-card border-r border-border">
        <div className="px-5 pt-6 pb-5">
          <div className="flex items-center gap-2.5">
            <Logo size={28} />
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
              className={({ isActive }) => navItemCls(isActive)}
            >
              <Icon size={15} className="flex-shrink-0" />{label}
            </NavLink>
          ))}
        </nav>
        <div className="px-3 pb-2 flex flex-col gap-0.5">
          <InstallAppButton className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm font-medium text-text-muted hover:text-text-secondary hover:bg-bg-elevated transition-all duration-150" />
          <button
            onClick={() => setSettingsOpen(true)}
            className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm font-medium text-text-muted hover:text-text-secondary hover:bg-bg-elevated transition-all duration-150"
          >
            <Settings size={15} className="flex-shrink-0" />설정
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

      {/* ── 모바일 드로어 오버레이 ───────────────────────── */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={closeMenu}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
        </div>
      )}

      {/* ── 모바일 드로어 ───────────────────────────────── */}
      <aside
        className={`fixed top-0 left-0 h-full z-50 w-64 flex flex-col md:hidden bg-bg-card border-r border-border transition-transform duration-300 ${
          menuOpen ? "translate-x-0" : "-translate-x-full pointer-events-none"}`}
      >
        <div className="px-5 pt-6 pb-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Logo size={28} />
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
          <InstallAppButton
            iconSize={16}
            onAfterClick={closeMenu}
            className="flex items-center gap-2.5 px-3 py-3 rounded-lg text-sm font-medium text-text-muted hover:text-text-secondary hover:bg-bg-elevated transition-all duration-150"
          />
          <button
            onClick={() => { closeMenu(); setSettingsOpen(true); }}
            className="flex items-center gap-2.5 px-3 py-3 rounded-lg text-sm font-medium text-text-muted hover:text-text-secondary hover:bg-bg-elevated transition-all duration-150"
          >
            <Settings size={16} className="flex-shrink-0" />설정
          </button>
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

      {/* ── 메인 영역 ──────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* 헤더 */}
        <header className="flex-shrink-0 flex items-center px-3 md:px-6 gap-3 bg-bg-primary border-b border-border" style={{ height: "52px" }}>
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
            {isLoggedIn ? (
              <div className="flex items-center gap-1.5">
                <span className="hidden sm:block text-text-muted text-xs font-medium truncate max-w-[120px]" title={username ?? ""}>
                  {username}
                </span>
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

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
