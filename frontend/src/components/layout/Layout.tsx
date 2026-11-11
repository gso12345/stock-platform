import { NavLink, Outlet, Link, useNavigate, useLocation } from "react-router-dom";
import { LayoutDashboard, Search, LineChart, BookMarked, TrendingUp, MoreHorizontal, X, LogOut, LogIn, Wallet, Settings, Newspaper, Award, ShieldCheck, Megaphone, User, Rss, Rocket, RefreshCw, WifiOff, MessageCircle } from "lucide-react";
import { safeExternalUrl } from "@/utils/url";
import Logo from "./Logo";
import { useWSStore } from "@/store/wsStore";
import { useAuthStore } from "@/store/authStore";
import { useSettingsStore } from "@/store/settingsStore";
import { 테마적용 } from "@/utils/테마";
import SearchBar from "@/components/layout/SearchBar";
import InstallAppButton from "@/components/layout/InstallAppButton";
import LoadingProgressOverlay from "@/components/layout/LoadingProgressOverlay";
import NotificationBell from "@/components/community/NotificationBell";
import SettingsModal from "@/components/account/SettingsModal";
import { 더보기_경로, 내자산_경로, 대화방인가 } from "@/constants/moreNav";
import { useState, useEffect, useRef, Suspense, lazy } from "react";
import { 화면미리받기 } from "@/routes/pages";
import { 앱준비됨 } from "@/components/layout/SplashScreen";
import { 한가할때, 아껴쓰는중 } from "@/utils/한가할때";
import { 원하는방향, 지켜보기 as 방향지켜보기 } from "@/utils/화면방향";
import { use증권사알림맞추기 } from "@/hooks/useWebPush";
import { 맨위로 } from "@/utils/맨위로";
import { use밝은화면 } from "@/hooks/useThemeMode";
import { use당겨서새로고침 } from "@/hooks/usePullToRefresh";
import { use화면넘김 } from "@/hooks/usePageTransition";
import { use인터넷 } from "@/hooks/useOnline";
import { 지금화면자료 } from "@/utils/지금화면자료";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "@/api/client";

const NAV = [
  { to: "/",          icon: LayoutDashboard, label: "대시보드",  end: true },
  { to: "/portfolio", icon: Wallet,           label: "내 자산"  },
  { to: "/quant",     icon: Award,            label: "퀀트"     },
  { to: "/predict",   icon: TrendingUp,       label: "주가예측" },
  { to: "/screening", icon: Search,           label: "스크리닝" },
  { to: "/ipo",       icon: Rocket,           label: "공모주"   },
  { to: "/backtest",  icon: LineChart,        label: "백테스트" },
  { to: "/strategies",icon: BookMarked,       label: "전략저장소"},
  { to: "/news",      icon: Newspaper,        label: "뉴스"     },
  { to: "/feed",      icon: Rss,              label: "피드"     },
];

/* ── 모바일 하단 탭바 ─────────────────────────────────── */
/* 퀀트는 더보기로 옮겼다(사용자: "퀀트페이지를 더보기에 넣어줘") — constants/moreNav 참고 */
const BOTTOM_NAV = [
  { to: "/",          icon: LayoutDashboard, label: "대시보드", end: true },
  { to: "/portfolio", icon: Wallet,          label: "내 자산"  },
  { to: "/feed",      icon: Rss,             label: "피드"     },
  { to: "/news",      icon: Newspaper,       label: "뉴스"     },
];

/** 아래 탭을 숨기는 화면 — 글쓰기처럼 화면을 통째로 쓰는 곳 */
const 아래탭숨길곳 = ["/feed/write"];

/** 메뉴에 손을 대는 순간(마우스를 올리거나 손가락이 닿거나 초점이 오면)
 *  그 화면 코드를 미리 받는다 — 누르고 떼기까지의 0.1~0.3초 동안 받아 둔다 */
function 미리받기(주소: string) {
  const 받기 = () => 화면미리받기(주소);
  return { onPointerEnter: 받기, onPointerDown: 받기, onFocus: 받기 };
}

/* 머리의 메시지 아이콘(안 읽은 수·푸시 듣기·메시지 API)은 따로 받는다 — 모든 화면이 처음에 반드시 받는 앱 틀을
   키우지 않게(src/__tests__/bundle.test.ts 의 첫 진입 한도). 받는 동안은 배지 없는 같은 아이콘을 그려 자리가
   흔들리지 않는다. 배지는 어차피 서버에 묻고 나서야 뜬다 */
const 메시지아이콘 = lazy(() => import("@/components/dm/메시지아이콘"));
function 메시지아이콘자리() {
  return (
    <Link to="/messages" aria-label="메시지"
      className="relative p-1.5 rounded-lg border border-border hover:bg-bg-elevated text-text-muted hover:text-text-primary transition-all">
      <MessageCircle size={14} />
    </Link>
  );
}

/** 화면 코드를 받는 동안 내용 자리에 두는 자리표시 */
function 화면기다리기() {
  return (
    <div aria-busy="true" aria-label="화면을 불러오는 중" className="flex flex-col gap-3 pt-1">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-24 rounded-xl border border-border bg-bg-card animate-pulse" />
      ))}
    </div>
  );
}

export default function Layout() {
  const wsStatus = useWSStore((s) => s.indicesStatus);
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const logout = useAuthStore((s) => s.logout);
  const fontSize = useSettingsStore((s) => s.fontSize);
  const orientation = useSettingsStore((s) => s.orientation);
  const navigate = useNavigate();
  const location = useLocation();
  const [settingsOpen, setSettingsOpen] = useState(false);

  /* 밝은 화면인가 — '시스템' 이면 기기를 따른다(hooks/useThemeMode). 바꾸는 곳은 설정 창 한 곳 */
  const isLight = use밝은화면();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  /* 첫 화면이 뜨고 한가해지면 하단 탭 화면들의 코드를 미리 받는다.
     처음 여는 화면은 코드를 받는 왕복이 끝나야 데이터를 묻기 시작했다 —
     서버 요청은 하나도 안 늘리고 그 왕복만 앞으로 당긴다. 종목 상세는
     크고(차트 포함) 탭에도 없으니 누를 낌새가 보일 때만 받는다.
     데이터를 아껴 쓰는 중이면 안 한다. */
  /* 앱 틀이 그려졌다 — 설치형 앱의 시작 화면을 걷는다(SplashScreen) */
  useEffect(() => { 앱준비됨(); }, []);

  useEffect(() => {
    if (아껴쓰는중()) return;
    return 한가할때(() => BOTTOM_NAV.forEach(({ to }) => 화면미리받기(to)), 5_000);
  }, []);

  /* 앱이 고른 밝기를 브라우저에도 알린다 — 클래스·색 모드(color-scheme)·상태 표시줄 색을 한꺼번에. 색 모드를
     기기 설정에 맡겨 두었더니 브라우저 부품과 '웹사이트 어둡게' 덧칠이 기기 설정을 따라, 같은 다크모드인데 색이
     달랐다(utils/테마.ts) */
  useEffect(() => { 테마적용(isLight); }, [isLight]);

  /* 글씨 크기 클래스 적용 */
  useEffect(() => {
    const html = document.documentElement;
    html.classList.remove("font-small", "font-large", "font-xl");
    if (fontSize === "small") html.classList.add("font-small");
    else if (fontSize === "large") html.classList.add("font-large");
    else if (fontSize === "xl") html.classList.add("font-xl");
  }, [fontSize]);

  /* 화면 방향 고정 — 안드로이드는 전체 화면에서만 받아 주고, 전체 화면은 사람이 누른 그때만 들어갈 수
     있다. 그래서 설정이 바뀔 때(설정 창을 누른 그 손으로) 걸고, 앱을 새로 열었거나 전체 화면이
     풀렸으면 다음에 화면을 누를 때 다시 건다(utils/화면방향 맨 위 설명) */
  useEffect(() => 방향지켜보기(), []);
  useEffect(() => { void 원하는방향(orientation); }, [orientation]);

  /* 알림 받을 증권사(알림 화면에서 고른다)가 바뀌면 휴대폰 알림 구독에도 — 여기 한 곳에서 */
  use증권사알림맞추기();

  /* 본문(스크롤하는 곳) — 당겨서 새로고침·탭 다시 누르기가 쓴다. 화면을 옮길 때 스크롤 자리는 건드리지 않는다
     (맨 위에서 열고 뒤로 가면 보던 자리로 가게 해 봤다가, 사용자가 원래대로 돌려 달라고 했다) */
  const 본문 = useRef<HTMLElement>(null);

  /* 당겨서 새로고침 — 본문 맨 위에서 당기면 지금 화면이 쓰는 자료를 다시 받는다(hooks/usePullToRefresh).
     다음 화면을 위해 미리 받아 두기만 하는 자료는 빼고(utils/지금화면자료) */
  const qc = useQueryClient();
  const 당김표시 = useRef<HTMLDivElement>(null);
  const 새로받는중 = use당겨서새로고침(본문, 당김표시,
    () => qc.refetchQueries({ type: "active", predicate: 지금화면자료 }));

  /* 화면 넘김 — 들어갈 땐 오른쪽에서, 뒤로는 왼쪽에서, 탭끼리는 살짝(hooks/usePageTransition) */
  const 화면틀 = useRef<HTMLDivElement>(null);
  use화면넘김(화면틀);

  /* 인터넷이 끊기면 띠를 보인다 — 서비스워커가 마지막 화면 틀로 열어 준다(public/sw.js) */
  const 이어짐 = use인터넷();

  /* 하단 탭의 "더보기"는 /more 화면이지만, 거기 든 메뉴 중 하나를 보고
     있을 때도 탭이 켜져 있어야 한다 — 안 그러면 관심종목을 보는 중에는
     다섯 탭 중 아무것도 안 켜져, 지금 어디인지 알 수 없다 */
  const isMoreActive = 더보기_경로.some(
    (경로) => location.pathname === 경로 || location.pathname.startsWith(경로 + "/")
  );

  /* 글을 쓰는 동안은 아래 탭을 숨긴다 — 앱의 글쓰기 화면처럼 화면을 다 쓰고, 그 자리에 사진·투표·태그
     도구줄이 붙는다(FeedWrite). 잘못 눌러 쓰던 글을 두고 다른 탭으로 가는 일도 막는다 */
  const 대화방 = 대화방인가(location.pathname);
  const 아래탭숨김 = 아래탭숨길곳.includes(location.pathname) || 대화방;

  const navItemCls = (isActive: boolean) =>
    `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${
      isActive ? "bg-accent-blue/15 text-accent-blue border border-accent-blue/20 shadow-card"
               : "text-text-muted hover:text-text-secondary hover:bg-bg-elevated"}`;

  return (
    <div className="flex h-screen bg-bg-base overflow-hidden"
      style={{ paddingLeft: "env(safe-area-inset-left)", paddingRight: "env(safe-area-inset-right)" }}>

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
            <NavLink key={to} to={to} end={end} {...미리받기(to)}
              className={({ isActive }) => navItemCls(isActive)}
            >
              <Icon size={14} className="flex-shrink-0" />{label}
            </NavLink>
          ))}
        </nav>
        {/* 머리에 있던 관리자·로그아웃은 여기로 옮겼다(사용자: "위에 메시지 알림 로그아웃 다크모드 등 너무 많은데
            정리해줘") — 머리에는 메시지·알림만 남는다. 휴대폰은 더보기 화면에 같은 것이 있다. 다크 모드는 설정 창에서만
            바꾼다(사용자: "다크모드 설정에 있잖아 그냥 없애줘") */}
        <div className="px-3 pb-2 flex flex-col gap-0.5">
          {/* 로그인 전에도 보인다 — 누르면 내 프로필 화면이 로그인하라고 말한다 */}
          <NavLink to="/mypage"
            className={({ isActive }) => navItemCls(isActive)}
          >
            <User size={14} className="flex-shrink-0" />내 프로필
          </NavLink>
          {isAdmin && (
            <NavLink to="/admin" className={({ isActive }) => navItemCls(isActive)}>
              <ShieldCheck size={14} className="flex-shrink-0" />관리자
            </NavLink>
          )}
          <InstallAppButton className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm font-medium text-text-muted hover:text-text-secondary hover:bg-bg-elevated transition-all duration-150" />
          <button
            onClick={() => setSettingsOpen(true)}
            className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm font-medium text-text-muted hover:text-text-secondary hover:bg-bg-elevated transition-all duration-150"
          >
            <Settings size={14} className="flex-shrink-0" />설정
          </button>
          {isLoggedIn && (
            <button
              onClick={handleLogout}
              className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm font-medium text-text-muted hover:text-accent-red hover:bg-bg-elevated transition-all duration-150"
            >
              <LogOut size={14} className="flex-shrink-0" />로그아웃
            </button>
          )}
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

        {/* 헤더 — 아이폰 홈 화면 앱은 상태바를 투명하게 둬서(index.html 의 black-translucent) 화면이 시계·노치
            밑까지 올라온다. 그만큼(safe-area-inset-top) 띄우지 않으면 검색창이 시계와 겹쳤다. 다른 기기는 0 */}
        {/* 휴대폰 대화방은 이 머리를 숨기고 대화방의 위 띠(← · 상대 · ⋯) 하나만 둔다 — 검색·종 띠 아래에 대화 띠가
            또 쌓여, 자판이 올라오면 대화가 보이는 칸이 손가락 두어 마디만 남았다(사용자: "메시지 개선할 거 있으면
            개선해줘"). 노치 자리는 아래 빈 띠가 대신 띄운다. PC 는 그대로 */}
        {대화방 && (
          <div aria-hidden data-notch-space="" className="lg:hidden flex-shrink-0 bg-bg-card" style={{ height: "env(safe-area-inset-top)" }} />
        )}
        <header className={`${대화방 ? "hidden lg:flex" : "flex"} flex-shrink-0 items-center px-3 md:px-6 gap-3 bg-bg-primary border-b border-border`}
          style={{ height: "calc(52px + env(safe-area-inset-top))", paddingTop: "env(safe-area-inset-top)" }}>
          <SearchBar />
          <div className="flex-1" />
          <div className="flex items-center gap-2 text-2xs text-text-dim">
            <span className="font-mono hidden lg:block">
              {new Date().toLocaleDateString("ko-KR", { year:"numeric", month:"long", day:"numeric", weekday:"short" })}
            </span>
            {/* 머리에는 메시지·알림만 — 아이디·관리자·로그아웃·해와 달 단추가 검색창 옆에 다닥다닥 붙어 있었다(사용자:
                "위에 메시지 알림 로그아웃 다크모드 등 너무 많은데 정리해줘"). 그것들은 PC 는 왼쪽 메뉴 아래, 휴대폰은
                더보기에 있다. 로그인 전에도 메시지·종은 보인다 — PC 는 여기가 알림·메시지로 가는 유일한 입구다 */}
            <div className="flex items-center gap-1.5">
              <Suspense fallback={<메시지아이콘자리 />}><메시지아이콘 /></Suspense>
              <NotificationBell />
              {!isLoggedIn && (
                <Link
                  to="/login"
                  className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-border hover:bg-bg-elevated text-text-muted hover:text-accent-blue transition-all whitespace-nowrap"
                >
                  <LogIn size={13} />
                  <span className="text-xs">로그인</span>
                </Link>
              )}
            </div>
          </div>
        </header>

        {!이어짐 && (
          <div role="status"
            className="flex-shrink-0 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-accent-yellow/15 text-accent-yellow border-b border-accent-yellow/20">
            <WifiOff size={13} className="shrink-0" />
            인터넷이 끊겼어요 — 보던 화면은 그대로 두고, 이어지면 새로 받아요
          </div>
        )}

        {/* 공지사항 배너 */}
        <AnnouncementBanner />
        {/* 팝업 배너 */}
        <PopupBanners />

        {/* 콘텐츠 — relative·overflow-x-hidden: 화면 안의 absolute(자리 잡은 조상이 없는 것)가 본문 밖으로 새어
            문서를 넓히지 못하게 가둔다. 휴대폰은 문서가 넓어지면 판을 키우고, 아래 탭(fixed)이 그 큰 판의 바닥에
            붙어 화면 밖으로 사라졌다(스크리닝의 화면 읽기용 글자가 그랬다 — StockTable 표상자) */}
        {/* 아래 탭을 숨긴 화면(글쓰기)은 탭 자리만큼 비워 둘 이유가 없다 — 그 자리에 도구줄이 붙는다 */}
        <main ref={본문} className="relative flex-1 overflow-y-auto overflow-x-hidden overscroll-y-none bg-bg-primary pb-[calc(3.5rem_+_env(safe-area-inset-bottom))] lg:pb-0"
          style={아래탭숨김 ? { paddingBottom: 0 } : undefined}>
          {/* 최대 폭도 rem — 넓은 화면에서 뿌리 글자가 커지면(index.css) 같이 넓어진다. px 로 두면 글자만 커지고
              폭은 그대로라 큰 모니터에서 담기는 칸이 오히려 줄었다(14px 기준 1,596px) */}
          {/* 당겨서 새로고침 표시 — 위에 숨어 있다가 당기는 만큼 내려온다(움직임은 훅이 직접 준다) */}
          <div ref={당김표시} aria-hidden
            className="pointer-events-none absolute left-1/2 top-0 z-20 w-9 h-9 -translate-x-1/2 -translate-y-11 opacity-0 rounded-full bg-bg-card border border-border shadow-float flex items-center justify-center text-accent-blue">
            <RefreshCw size={16} className={새로받는중 ? "animate-spin" : ""} />
          </div>
          {새로받는중 && <span role="status" className="sr-only">새로 받는 중</span>}
          <div ref={화면틀} className="p-3 md:p-5 max-w-[114rem] mx-auto">
            {/* 화면 코드를 받는 동안 **내용 자리만** 기다린다. 이게 없으면
                바깥(main.tsx)의 대기 화면까지 올라가, 처음 여는 화면마다
                머리·하단 탭까지 통째로 사라졌다가 다시 나타났다 */}
            <Suspense fallback={<화면기다리기 />}>
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>

      {/* ── 모바일 하단 탭바 ─────────────────────────────── */}
      {!아래탭숨김 && <nav
        className="lg:hidden fixed bottom-0 left-0 right-0 z-30 flex items-stretch bg-bg-card border-t border-border"
        style={{ paddingBottom: "env(safe-area-inset-bottom)", paddingLeft: "env(safe-area-inset-left)",
                 paddingRight: "env(safe-area-inset-right)" }}
      >
        {BOTTOM_NAV.map(({ to, icon: Icon, label, end }) => (
          <NavLink key={to} to={to} end={end} {...미리받기(to)} className="flex-1 active:scale-95 transition-transform"
            onClick={(e) => {
              // 지금 보는 탭을 다시 누르면 맨 위로(앱들의 기본 동작) — 같은 주소로 다시 가지 않는다
              if (location.pathname === to) { e.preventDefault(); 맨위로(본문.current); }
            }}>
            {({ isActive }) => {
              /* 관심종목은 "내 자산" 화면의 형제 탭이라, 거기 있을 때도
                 "내 자산" 에 불이 켜져야 한다. 안 그러면 화면 위 탭은
                 "관심종목" 이라고 하는데 아래는 아무 데도 안 켜진다. */
              const 켜짐 = isActive ||
                (to === "/portfolio" && 내자산_경로.some((p) => location.pathname === p));
              return (
              <div className={`relative flex flex-col items-center justify-center gap-0.5 h-14 text-2xs font-medium transition-colors duration-200 ${
                켜짐 ? "text-accent-blue" : "text-text-muted"}`}>
                {켜짐 && <span className="absolute top-1.5 w-1 h-1 rounded-full bg-accent-blue fade-in" />}
                <Icon size={20} className={`transition-transform duration-200 ${켜짐 ? "scale-110" : "scale-100"}`} />
                {label}
              </div>
              );
            }}
          </NavLink>
        ))}
        <NavLink to="/more" className="flex-1 active:scale-95 transition-transform"
          onClick={(e) => { if (location.pathname === "/more") { e.preventDefault(); 맨위로(본문.current); } }}>
          <div className={`relative flex flex-col items-center justify-center gap-0.5 h-14 text-2xs font-medium transition-colors duration-200 ${
            isMoreActive ? "text-accent-blue" : "text-text-muted"}`}>
            {isMoreActive && <span className="absolute top-1.5 w-1 h-1 rounded-full bg-accent-blue fade-in" />}
            <MoreHorizontal size={20} className={`transition-transform duration-200 ${isMoreActive ? "scale-110" : "scale-100"}`} />
            더보기
          </div>
        </NavLink>
      </nav>}

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
