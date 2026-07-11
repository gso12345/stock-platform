import { NavLink, Outlet, Link, useNavigate, useLocation } from "react-router-dom";
import { LayoutDashboard, Search, LineChart, BookMarked, Sun, Moon, Monitor, MoreHorizontal, X, LogOut, LogIn, Wallet, Settings, Newspaper, Star, Award, RectangleHorizontal, RectangleVertical, Smartphone } from "lucide-react";
import Logo from "./Logo";
import { useWSStore } from "@/store/wsStore";
import { useAuthStore } from "@/store/authStore";
import { useSettingsStore } from "@/store/settingsStore";
import type { ColorScheme, FontSize, Theme, Orientation, CardShadow } from "@/store/settingsStore";
import SearchBar from "@/components/SearchBar";
import InstallAppButton from "@/components/InstallAppButton";
import LoadingProgressOverlay from "@/components/LoadingProgressOverlay";
import { useState, useEffect } from "react";

const NAV = [
  { to: "/",          icon: LayoutDashboard, label: "대시보드",  end: true },
  { to: "/portfolio", icon: Wallet,           label: "내 자산"  },
  { to: "/quant",     icon: Award,            label: "퀀트"     },
  { to: "/screening", icon: Search,           label: "스크리닝" },
  { to: "/backtest",  icon: LineChart,        label: "백테스트" },
  { to: "/strategies",icon: BookMarked,       label: "전략저장소"},
  { to: "/news",      icon: Newspaper,        label: "뉴스"     },
];

/* ── 모바일 하단 탭바 ─────────────────────────────────── */
const BOTTOM_NAV = [
  { to: "/",          icon: LayoutDashboard, label: "대시보드", end: true },
  { to: "/portfolio", icon: Wallet,          label: "내 자산"  },
  { to: "/news",      icon: Newspaper,       label: "뉴스"     },
  { to: "/quant",     icon: Award,           label: "퀀트"     },
];

/* ── "더보기" 시트에 들어가는 나머지 메뉴 ─────────────── */
const MORE_NAV = [
  { to: "/watchlist",  icon: Star,      label: "관심종목"   },
  { to: "/screening",  icon: Search,    label: "스크리닝"   },
  { to: "/backtest",   icon: LineChart, label: "백테스트"   },
  { to: "/strategies", icon: BookMarked,label: "전략저장소" },
];

function SettingsModal({ onClose }: { onClose: () => void }) {
  const { colorScheme, setColorScheme, fontSize, setFontSize, theme, setTheme, orientation, setOrientation, cardShadow, setCardShadow } = useSettingsStore();
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70 backdrop-blur-sm modal-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-sm bg-bg-card border border-border rounded-2xl shadow-2xl overflow-hidden modal-pop">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-sm font-bold text-text-primary">설정</h3>
          <button onClick={onClose} className="p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-elevated">
            <X size={15} />
          </button>
        </div>
        <div className="px-5 py-5 flex flex-col gap-5">

          {/* 테마 */}
          <div>
            <p className="text-xs font-semibold text-text-muted mb-2">테마</p>
            <div className="flex gap-2">
              {([
                { value: "light",  label: "라이트", icon: Sun },
                { value: "dark",   label: "다크",   icon: Moon },
                { value: "system", label: "시스템", icon: Monitor },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setTheme(opt.value as Theme)}
                  className={`flex-1 flex flex-col items-center gap-1.5 py-3 rounded-xl border transition-all ${
                    theme === opt.value
                      ? "border-accent-blue bg-accent-blue/10"
                      : "border-border hover:border-accent-blue/40 hover:bg-bg-elevated"
                  }`}
                >
                  <opt.icon size={16} className="text-text-primary" />
                  <span className="text-[10px] text-text-muted">{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

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
                { value: "normal", label: "작게",   size: "text-xs"  },
                { value: "large",  label: "기본",   size: "text-sm"  },
                { value: "xl",     label: "크게", size: "text-base" },
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

          {/* 화면 방향 */}
          <div>
            <p className="text-xs font-semibold text-text-muted mb-2">화면 방향</p>
            <p className="text-2xs text-text-dim mb-2">설치된 앱(PWA) 등 일부 환경에서만 적용돼요</p>
            <div className="flex gap-2">
              {([
                { value: "landscape", label: "가로",     icon: RectangleHorizontal },
                { value: "portrait",  label: "세로",     icon: RectangleVertical   },
                { value: "system",    label: "시스템설정", icon: Smartphone          },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => {
                    setOrientation(opt.value as Orientation);
                    /* 화면 회전 고정 API는 사용자 클릭(transient activation) 직후
                       동기적으로 호출해야 동작하는 브라우저가 있어 useEffect가 아닌
                       클릭 핸들러에서 직접 호출 */
                    const so = screen.orientation as (ScreenOrientation & { lock?: (o: string) => Promise<void> }) | undefined;
                    if (!so) return;
                    /* lock()/unlock()은 풀스크린/PWA가 아닌 일반 브라우저 탭에서
                       Promise reject가 아니라 동기적으로 예외를 던지는 환경이 있어
                       try/catch로 감싸야 함 (안 그러면 앱 전체가 흰/검은 화면으로 죽음) */
                    try {
                      if (opt.value === "system") so.unlock?.();
                      else so.lock?.(opt.value)?.catch(() => {});
                    } catch {}
                  }}
                  className={`flex-1 flex flex-col items-center gap-1.5 py-3 rounded-xl border transition-all ${
                    orientation === opt.value
                      ? "border-accent-blue bg-accent-blue/10"
                      : "border-border hover:border-accent-blue/40 hover:bg-bg-elevated"
                  }`}
                >
                  <opt.icon size={16} className="text-text-primary" />
                  <span className="text-[10px] text-text-muted">{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 카드 그림자 */}
          <div>
            <p className="text-xs font-semibold text-text-muted mb-2">카드 그림자</p>
            <div className="flex gap-2">
              {([
                { value: "on",  label: "켜기" },
                { value: "off", label: "끄기" },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setCardShadow(opt.value as CardShadow)}
                  className={`flex-1 flex flex-col items-center gap-1.5 py-3 rounded-xl border transition-all ${
                    cardShadow === opt.value
                      ? "border-accent-blue bg-accent-blue/10"
                      : "border-border hover:border-accent-blue/40 hover:bg-bg-elevated"
                  }`}
                >
                  <div className={`w-8 h-5 rounded-md bg-bg-elevated border border-border ${opt.value === "on" ? "shadow-card" : ""}`} />
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
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const username = useAuthStore((s) => s.username);
  const logout = useAuthStore((s) => s.logout);
  const fontSize = useSettingsStore((s) => s.fontSize);
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const orientation = useSettingsStore((s) => s.orientation);
  const cardShadow = useSettingsStore((s) => s.cardShadow);
  const navigate = useNavigate();
  const location = useLocation();
  const [systemPrefersLight, setSystemPrefersLight] = useState(
    () => window.matchMedia?.("(prefers-color-scheme: light)").matches ?? false
  );
  const [moreOpen, setMoreOpen] = useState(false);
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

  /* 카드 그림자 설정 적용 */
  useEffect(() => {
    document.documentElement.classList.toggle("shadow-off", cardShadow === "off");
  }, [cardShadow]);

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

  useEffect(() => {
    document.body.style.overflow = moreOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [moreOpen]);

  /* 라우트 이동 시 "더보기" 시트 자동 닫힘 */
  useEffect(() => {
    setMoreOpen(false);
  }, [location.pathname]);

  const closeMore = () => setMoreOpen(false);

  const isMoreActive = MORE_NAV.some(
    (item) => location.pathname === item.to || location.pathname.startsWith(item.to + "/")
  );

  const navItemCls = (isActive: boolean) =>
    `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${
      isActive ? "bg-accent-blue/15 text-accent-blue border border-accent-blue/20 shadow-sm"
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

      {/* ── 모바일 "더보기" 시트 오버레이 ───────────────── */}
      {moreOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={closeMore}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm fade-in" />
        </div>
      )}

      {/* ── 모바일 "더보기" 바텀시트 ─────────────────────── */}
      <div
        className={`fixed bottom-0 left-0 right-0 z-50 lg:hidden bg-bg-card border-t border-border rounded-t-2xl shadow-2xl transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
          moreOpen ? "translate-y-0" : "translate-y-full pointer-events-none"}`}
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 8px)" }}
      >
        <div className="flex justify-center pt-2.5 pb-1">
          <div className="w-9 h-1 rounded-full bg-border-light" />
        </div>
        <div className="px-4 pt-1 pb-2 grid grid-cols-5 gap-2">
          {MORE_NAV.map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to} onClick={closeMore}
              className={({ isActive }) =>
                `flex flex-col items-center gap-1.5 py-3 rounded-xl text-2xs font-medium transition-all duration-150 active:scale-95 ${
                  isActive ? "bg-accent-blue/15 text-accent-blue" : "text-text-muted hover:bg-bg-elevated hover:text-text-secondary"}`}
            >
              <Icon size={20} className="flex-shrink-0" />
              {label}
            </NavLink>
          ))}
        </div>
        <div className="mx-4 h-px bg-border-subtle" />
        <div className="px-3 py-2 flex flex-col gap-0.5">
          <InstallAppButton
            iconSize={16}
            onAfterClick={closeMore}
            className="flex items-center gap-2.5 px-3 py-3 rounded-lg text-sm font-medium text-text-muted hover:text-text-secondary hover:bg-bg-elevated transition-all duration-150"
          />
          <button
            onClick={() => { closeMore(); setSettingsOpen(true); }}
            className="flex items-center gap-2.5 px-3 py-3 rounded-lg text-sm font-medium text-text-muted hover:text-text-secondary hover:bg-bg-elevated transition-all duration-150"
          >
            <Settings size={16} className="flex-shrink-0" />설정
          </button>
        </div>
        <div className="px-5 py-3 border-t border-border-subtle">
          <div className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
              wsStatus === "connected" ? "bg-accent-green animate-pulse" : "bg-text-dim"}`} />
            <span className="text-2xs text-text-dim">
              {wsStatus === "connected" ? "실시간 연결됨" : "오프라인"}
            </span>
          </div>
        </div>
      </div>

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
              onClick={() => setTheme(isLight ? "dark" : "light")}
              className="p-1.5 rounded-lg border border-border hover:bg-bg-elevated text-text-muted hover:text-text-primary transition-all"
              title={isLight ? "다크 모드" : "라이트 모드"}
            >
              {isLight ? <Moon size={14} /> : <Sun size={14} />}
            </button>
          </div>
        </header>

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
        <button onClick={() => setMoreOpen((v) => !v)} className="flex-1 active:scale-95 transition-transform">
          <div className={`relative flex flex-col items-center justify-center gap-0.5 h-14 text-2xs font-medium transition-colors duration-200 ${
            moreOpen || isMoreActive ? "text-accent-blue" : "text-text-muted"}`}>
            {(moreOpen || isMoreActive) && <span className="absolute top-1.5 w-1 h-1 rounded-full bg-accent-blue fade-in" />}
            <MoreHorizontal size={20} className={`transition-transform duration-200 ${moreOpen ? "scale-110 rotate-90" : "scale-100"}`} />
            더보기
          </div>
        </button>
      </nav>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
