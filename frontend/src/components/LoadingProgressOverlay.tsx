import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient, type Query } from "@tanstack/react-query";
import { AlertTriangle, Check, Loader2, RotateCw, X } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { useSettingsStore } from "@/store/settingsStore";
import { dashboardApi } from "@/api/stocks";
import { use보유목록 } from "@/hooks/usePortfolioItems";
import { use관심목록 } from "@/hooks/useWatchlistItems";
import { 한가할때 } from "@/utils/한가할때";
import Logo from "./Logo";

/**
 * '데이터 불러오는 중' 위젯 — **어느 화면에서든** 처음 불러오는 데이터를
 * 항목별로 보여 준다.
 *
 * ── 왜 이렇게 바꿨나 ──────────────────────────────────────
 *
 * 처음에는 대시보드·뉴스 네 가지의 퍼센트 하나뿐이었다. 내 자산·관심종목·
 * 퀀트·피드에 들어가 한참 기다려도 무엇을 기다리는지 알 수 없었다.
 *
 * 그 화면들의 데이터를 앱 진입 때 **미리** 다 부르는 방법도 있지만 두 가지가
 * 걸린다. 화면마다 부르는 내용이 그 화면의 상태(보유 종목 목록 등)에 따라
 * 달라서 같은 로직을 두 벌 둬야 하고, 퀀트 비교처럼 분당 10회 제한이 걸린
 * 비싼 요청을 들어올 때마다 돌리게 된다.
 *
 * 그래서 **지켜보기만** 한다. react-query 캐시에서 '데이터가 아직 없는데
 * 불러오는 중' 인 것을 잡아 이름을 붙여 보여 준다. 어느 화면이든 처음
 * 불러올 때 뜨고, 다 되면 사라진다. 이미 있는 데이터를 뒤에서 새로 받는
 * 것(시세 15초 갱신 등)은 띄우지 않는다 — 그걸 띄우면 계속 깜빡인다.
 */

/** 데이터 이름표 → 사람이 읽는 이름. 여기 없는 것은 '기타 데이터' 로 묶는다 */
const 이름표: Record<string, string> = {
  "dashboard-kr": "국내 시장", "dashboard-us": "미국 시장", "dashboard-us-rates": "미국 금리",
  "dashboard-news": "뉴스", "rankings": "순위", "exchange-rate": "환율",
  "portfolios": "내 포트폴리오 목록", "portfolio-items-all": "내 보유종목",
  "portfolio-prices": "내 자산 시세", "portfolio-preview-prices": "내 자산 시세",
  "publicPortfolios": "공개 포트폴리오",
  "watchlist-items": "관심종목", "watchlist-folders": "관심종목 폴더",
  "watchlist-prices": "관심종목 시세", "watchlist-preview-prices": "관심종목 시세",
  "recent-viewed-prices": "최근 본 종목 시세",
  "quant-compare": "퀀트 점수 비교", "quant-score": "퀀트 점수",
  "quant-rankings": "퀀트 순위", "quant-weights": "퀀트 가중치",
  "feed": "피드 글", "community": "커뮤니티", "post": "게시글", "modal-comments": "댓글",
  "myProfile": "내 프로필", "userPublicProfile": "프로필", "userActivity": "활동 내역",
  "userFollowing": "팔로잉", "userFollowers": "팔로워",
  "notiList": "알림", "notiPage": "알림", "notiSettings": "알림 설정",
  "stock-detail": "종목 정보", "stock-ohlcv": "차트", "stock-news": "종목 뉴스",
  "stock-fundamentals": "재무 지표", "stock-financials": "재무제표",
  "metrics-history": "지표 추이", "forecasts": "실적 전망", "analyst": "애널리스트 의견",
  "earnings": "실적 발표", "disclosures": "공시", "supply-demand": "수급",
  "stock-dividends": "배당", "stock-nxt": "시간외 시세", "etf_holdings": "ETF 구성",
  "index-detail": "지수 정보", "index-ohlcv": "지수 차트", "index-daily": "지수 일별",
  "strategies": "저장한 전략", "backtest-experiments": "저장한 실험",
  "screening-presets": "스크리닝 조건",
};

/** 띄울 가치가 없는 것 — 아주 작고 자주 도는 것들 */
const 안띄울것 = new Set(["notiUnread", "announcement", "active-popups", "auth-me"]);

/** 이 쿼리를 화면에 뭐라고 부를까. null 이면 안 띄운다. */
export function 라벨(queryKey: readonly unknown[]): string | null {
  const 머리 = String(queryKey[0] ?? "");
  if (안띄울것.has(머리) || 머리.startsWith("admin-")) return null;
  if (머리 === "news") return queryKey[1] === "us" ? "해외 뉴스" : "국내 뉴스";
  return 이름표[머리] ?? "기타 데이터";
}

export type 항목상태 = "대기" | "완료" | "실패";
export type 진행항목 = { 이름: string; 상태: 항목상태; 초: number; 개수: number; 다시?: () => void };

/** 이만큼 넘게 기다리면 '서버가 깨는 중일 수 있다' 고 알려 준다.
 *  무료 서버는 한동안 요청이 없으면 잠들고, 깨는 데 20~50초가 든다. */
export const 느림기준초 = 10;
/** 이보다 빨리 끝나면 아예 안 띄운다 — 캐시에서 곧바로 나온 것이 번쩍이지 않게.
 *  0.6초였는데 화면을 옮길 때마다 떴다 사라졌다 해서 '흔들린다' 로 보였다. */
export const 띄울때까지ms = 1000;
/** 다 되고 나서 이만큼 보여 주고 닫는다 — 끝난 것을 확인할 틈 */
export const 닫기까지ms = 1200;

export type 기록 = { 이름: string; 시작: number; 끝?: number; 상태: 항목상태; 다시부르기: () => void };

/** 같은 이름끼리 한 줄로 — 차트 여러 개를 불러도 '차트 (3)' 한 줄 */
export function 묶기(기록들: 기록[], 지금: number): 진행항목[] {
  const 묶음 = new Map<string, 기록[]>();
  for (const r of 기록들) 묶음.set(r.이름, [...(묶음.get(r.이름) ?? []), r]);
  return [...묶음.entries()].map(([이름, rs]) => {
    const 상태: 항목상태 = rs.some((r) => r.상태 === "실패") ? "실패"
      : rs.some((r) => r.상태 === "대기") ? "대기" : "완료";
    //: 음수가 안 나오게 — 시계가 한 박자 늦게 도는 사이에 끝날 수 있다
    const 초 = Math.max(0, ...rs.map((r) => Math.round(((r.끝 ?? 지금) - r.시작) / 1000)));
    const 실패들 = rs.filter((r) => r.상태 === "실패");
    return {
      이름, 상태, 초, 개수: rs.length,
      다시: 실패들.length ? () => { for (const r of 실패들) r.다시부르기(); } : undefined,
    };
  });
}

export default function LoadingProgressOverlay() {
  const { isLoggedIn } = useAuthStore();
  const qc = useQueryClient();
  /* 설정 → 불러오기 표시. 꺼도 아래의 미리 불러오기와 지켜보기는 그대로 돈다 —
     '실패만' 으로 바꾸는 순간 지금 실패한 것이 곧바로 보여야 하므로 */
  const 표시 = useSettingsStore((s) => s.불러오기표시);

  /* 앱 진입 시 미리 불러 두는 핵심 데이터. 이 위젯이 Layout 에 있어 어느
     화면으로 들어와도 대시보드·뉴스·내 자산·관심종목이 준비된다. 진행 표시는
     아래 '지켜보기' 가 이것들도 똑같이 잡는다.

     **한가해진 뒤에** 부른다. 예전에는 앱이 뜨는 순간 여섯 건(대시보드
     국내·해외, 뉴스 둘, 보유·관심 목록)을 한꺼번에 보내, 공유받은 종목 링크로
     들어온 사람의 종목 상세 요청이 0.15 CPU 서버에서 그 뒤에 줄을 섰다.
     지금 화면이 먼저 받고, 다음에 옮길 화면은 그 뒤에 받아 둔다 — 대시보드
     화면은 어차피 자기 데이터를 곧바로 직접 묻는다. */
  const [미리받기, set미리받기] = useState(false);
  useEffect(() => 한가할때(() => set미리받기(true), 2_500), []);
  useQuery({ queryKey: ["dashboard-kr", "시가총액"], queryFn: () => dashboardApi.getKR(), staleTime: 60_000, enabled: 미리받기 });
  useQuery({ queryKey: ["dashboard-us", "시가총액"], queryFn: () => dashboardApi.getUS(), staleTime: 60_000, enabled: 미리받기 });
  useQuery({ queryKey: ["news", "kr", "latest"], queryFn: () => dashboardApi.getNews("kr", "latest"), staleTime: 300_000, enabled: 미리받기 });
  useQuery({ queryKey: ["news", "us", "latest"], queryFn: () => dashboardApi.getNews("us", "latest"), staleTime: 300_000, enabled: 미리받기 });
  /* 같은 이름표에 fetcher 가 둘이면 먼저 붙은 쪽이 이긴다 — 보유목록은
     use보유목록 한 벌만 쓴다(hooks/usePortfolioItems). */
  use보유목록(isLoggedIn && 미리받기);
  use관심목록(isLoggedIn && 미리받기);

  const 기록들 = useRef(new Map<string, 기록>()).current;
  const [, 다시그려] = useState(0);
  const [지금, set지금] = useState(() => Date.now());
  const [닫음, set닫음] = useState(false);
  const 떠있음 = useRef(false);
  /* 한 번이라도 떴었나. 두 번째부터는 등장 효과(아래서 4px 올라옴)를 빼고
     제자리에 나타난다 — 화면을 옮길 때마다 튀어 오르면 흔들려 보인다 */
  const 떴었음 = useRef(false);

  /* 캐시를 지켜본다. '데이터가 아직 없는데 불러오는 중' 인 것만 잡는다 */
  useEffect(() => {
    const 캐시 = qc.getQueryCache();
    const 살피기 = (q: Query) => {
      const 이름 = 라벨(q.queryKey);
      if (!이름) return;
      const s = q.state;
      const 있던것 = 기록들.get(q.queryHash);
      if (s.fetchStatus === "fetching" && s.data === undefined) {
        if (!있던것 || 있던것.상태 !== "대기") {
          기록들.set(q.queryHash, {
            이름, 시작: Date.now(), 상태: "대기",
            다시부르기: () => { q.fetch().catch(() => {}); },
          });
          set닫음(false);
          다시그려((n) => n + 1);
        }
      } else if (있던것 && 있던것.상태 === "대기" && s.fetchStatus === "idle") {
        있던것.상태 = s.status === "error" ? "실패" : "완료";
        있던것.끝 = Date.now();
        다시그려((n) => n + 1);
      }
    };
    캐시.getAll().forEach(살피기);
    return 캐시.subscribe((e) => { if (e?.query) 살피기(e.query); });
  }, [qc, 기록들]);

  const 항목들 = 묶기([...기록들.values()], 지금);
  const 기다림 = 항목들.filter((x) => x.상태 === "대기");
  const 실패들 = 항목들.filter((x) => x.상태 === "실패");
  const 다끝남 = 항목들.length > 0 && 기다림.length === 0;
  const 기다리는시작 = [...기록들.values()].filter((r) => r.상태 === "대기").map((r) => r.시작);
  const 가장이른 = 기다리는시작.length ? Math.min(...기다리는시작) : 지금;

  /* 기다리는 동안 시계를 돌린다. 띄울지 판단도 이 시계로 한다 */
  useEffect(() => {
    if (기다림.length === 0) return;
    set지금(Date.now());
    const t = setInterval(() => set지금(Date.now()), 250);
    return () => clearInterval(t);
  }, [기다림.length]);

  /* 다 됐고 실패가 없으면 잠깐 뒤 비운다 — 다음 화면에서 새로 시작 */
  useEffect(() => {
    if (!다끝남 || 실패들.length) return;
    const t = setTimeout(() => { 기록들.clear(); 떠있음.current = false; 다시그려((n) => n + 1); }, 닫기까지ms);
    return () => clearTimeout(t);
  }, [다끝남, 실패들.length, 기록들]);

  //: 한 번 떴으면 끝날 때까지 계속 보인다(깜빡임 방지). 빨리 끝난 것은 안 띄운다.
  if ((기다림.length > 0 && 지금 - 가장이른 >= 띄울때까지ms) || 실패들.length) 떠있음.current = true;
  if (항목들.length === 0) 떠있음.current = false;

  if (닫음 || !떠있음.current || 항목들.length === 0) return null;
  if (표시 === "끄기") return null;
  if (표시 === "실패만" && 실패들.length === 0) return null;
  const 처음뜸 = !떴었음.current;
  떴었음.current = true;

  const total = 항목들.length;
  const done = total - 기다림.length;
  const percent = Math.round((done / total) * 100);
  const 가장오래 = 기다림.reduce((a, x) => Math.max(a, x.초), 0);

  return (
    <div
      role="status"
      aria-label="데이터 불러오기 상황"
      className={`fixed right-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] lg:bottom-4 z-[150] w-64 bg-bg-card border border-border rounded-xl shadow-modal p-2.5 flex flex-col gap-1.5 ${처음뜸 ? "fade-in" : ""}`}
    >
      <div className="flex items-center gap-1.5">
        <Logo size={16} />
        <span className="text-2xs font-semibold text-text-secondary flex-1 truncate">
          {다끝남
            ? (실패들.length ? `${실패들.length}개를 못 불러왔어요` : "다 불러왔어요")
            : `데이터 불러오는 중… ${done}/${total}`}
        </span>
        <button
          onClick={() => {
            set닫음(true);
            //: 다 끝난 뒤 닫으면 목록도 비운다 — 다음 화면에서 새로 시작
            if (다끝남) { 기록들.clear(); 떠있음.current = false; 다시그려((n) => n + 1); }
          }}
          aria-label="닫기"
          className="p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors"
        >
          <X size={13} />
        </button>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full bg-bg-elevated overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ease-out ${실패들.length ? "bg-accent-amber" : "bg-accent-blue"}`}
            style={{ width: `${percent}%` }}
          />
        </div>
        <span className="text-2xs font-mono text-text-muted">{percent}%</span>
      </div>

      {/* 목록 칸의 **높이를 고정**한다. 팝업이 아래에 붙어 있어서, 항목이
          늘거나 줄 때마다 높이가 바뀌면 위쪽 가장자리가 들썩였다 — '흔들린다'.
          넘치면 안에서 스크롤한다. */}
      <ul data-testid="불러오기-목록" className="flex flex-col gap-0.5 h-[7.25rem] overflow-y-auto">
        {항목들.map((x) => (
          <li key={x.이름} data-state={x.상태} className="flex items-center gap-1.5 text-2xs">
            {x.상태 === "완료" ? (
              <Check size={11} className="text-accent-green shrink-0" aria-label="완료" />
            ) : x.상태 === "실패" ? (
              <AlertTriangle size={11} className="text-accent-red shrink-0" aria-label="실패" />
            ) : (
              <Loader2 size={11} className="text-accent-blue shrink-0 animate-spin" aria-label="불러오는 중" />
            )}
            <span className={`flex-1 truncate ${x.상태 === "완료" ? "text-text-dim" : "text-text-secondary"}`}>
              {x.이름}{x.개수 > 1 && <span className="text-text-dim"> ({x.개수})</span>}
            </span>
            {x.상태 === "실패" ? (
              <button
                type="button"
                onClick={x.다시}
                aria-label={`${x.이름} 다시 시도`}
                className="flex items-center gap-0.5 text-accent-blue hover:underline shrink-0"
              >
                <RotateCw size={11} />다시
              </button>
            ) : (
              <span className="font-mono text-text-dim shrink-0">{x.초}초</span>
            )}
          </li>
        ))}
      </ul>

      {/* 안내 줄도 자리를 늘 잡아 둔다 — 나타날 때 팝업이 커지지 않게 */}
      <p className={`text-2xs text-text-dim break-keep h-[2.25rem] ${!다끝남 && 가장오래 >= 느림기준초 ? "" : "invisible"}`}>
        서버가 쉬고 있다가 깨어나는 중일 수 있어요. 처음 한 번은 30초쯤 걸려요.
      </p>
    </div>
  );
}
