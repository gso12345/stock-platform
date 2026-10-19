/**
 * 종목 스크리닝 — 참고한 스크리너처럼(사용자: "스크리닝 사이트 참고해줘" → "일단 할수있는건 다해줘").
 *
 *   · 열자마자 시가총액 큰 순으로 보인다. 예전엔 조건을 고르고 '스크리닝 실행' 을 눌러야 표가 채워졌다
 *   · 칸 제목을 누르면 그 칸으로 세운다 — 한 번 더 누르면 반대로
 *   · 티커·이름 찾기, 조건 묶음, 조건, 칸 고르기, 보기 저장, CSV
 *   · 이름 칸에 회사 로고, 매출·EPS 는 연도별 막대
 *
 * 세우기는 서버가 한다. 받은 위 100개를 화면에서 다시 세우면 'PER 낮은 순' 이 전체가 아니라
 * '시총 위 100곳 중 PER 낮은 순' 이 된다.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowDown, ArrowUp, Columns3, Download, Filter, Layers, Save, Search, SlidersHorizontal, Star, X,
} from "lucide-react";
import { screeningApi, watchlistApi, stocksApi, type 스크리닝요청, type 스크리닝줄 } from "@/api/stocks";
import { useAuthStore } from "@/store/authStore";
import { Button, Card, InlineSpinner, INPUT_CLASS, Tabs, Toast, cn, 빈화면, 못불러옴 } from "@/components/ui";
import { 읽을수있는오류 } from "@/utils/errors";
import { csv내려받기 } from "@/utils/csv";
import { 용어사전 } from "@/constants/terms";
import type { Market, ScreeningPreset } from "@/types";
import {
  칸들, 처음칸, 보낼조건, 스크리닝CSV, 조건글, ETF칸, 칸이름,
} from "@/components/screening/screeningDefs";
import { 칸값, 회사로고 } from "@/components/screening/ScreeningCells";
import {
  조건판, 칸판, 묶음판, 저장판, type 기본묶음하나, type 조건모음,
} from "@/components/screening/ScreeningPanels";

// 시험·다른 화면이 이 파일에서 가져다 쓴다
export { SECTORS, 보낼조건, 스크리닝CSV } from "@/components/screening/screeningDefs";

const 시장들 = [
  { id: "US", label: "미국" },
  { id: "KR", label: "한국" },
  { id: "ETF", label: "ETF" },
];

type 판 = "묶음" | "조건" | "칸" | "저장";

/** 고른 칸은 이 브라우저에 남긴다 — 열 때마다 칸을 다시 고르게 하면 칸 고르기를 안 쓰게 된다 */
const 칸_열쇠 = "screening_cols_v2";

function 칸읽기(): string[] {
  try {
    const 값 = JSON.parse(localStorage.getItem(칸_열쇠) ?? "null");
    if (Array.isArray(값)) {
      const 아는칸 = 칸들.filter((c) => 값.includes(c.key)).map((c) => c.key);
      if (아는칸.length) return 아는칸;
    }
  } catch { /* 사생활 보호 창 등 — 처음 칸으로 */ }
  return 처음칸;
}

/* 결과 표 자리를 미리 잡아 둔다. 처음 한 번은 시장 전체를 훑느라 수십 초가 걸린다 —
   동그라미만 돌면 멈춘 줄 안다. */
function ScreeningSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3 p-4" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 animate-pulse">
          <div className="h-3 w-4 rounded bg-bg-elevated" />
          <div className="h-6 w-6 rounded-lg bg-bg-elevated flex-shrink-0" />
          <div className="flex flex-col gap-1.5">
            <div className="h-3 w-32 rounded bg-bg-elevated" />
            <div className="h-2.5 w-12 rounded bg-bg-elevated" />
          </div>
          <div className="ml-auto hidden sm:flex gap-6">
            {Array.from({ length: 6 }).map((__, j) => <div key={j} className="h-3 w-14 rounded bg-bg-elevated" />)}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Screening() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { isLoggedIn } = useAuthStore();

  const [시장, set시장] = useState<Market>("US");
  const [조건, set조건] = useState<조건모음>({});
  const [정렬, set정렬] = useState("market_cap");
  const [순서, set순서] = useState<"asc" | "desc">("desc");
  const [찾기, set찾기] = useState("");
  const [찾는말, set찾는말] = useState("");
  const [열린판, set열린판] = useState<판 | null>(null);
  const [보이는칸, set보이는칸] = useState<string[]>(칸읽기);
  const [몇줄, set몇줄] = useState(30);
  const [별, set별] = useState<Set<string>>(new Set());
  const [알림, set알림] = useState<{ 글: string; 종류: "success" | "error" } | null>(null);
  // Toast 는 onClose 가 바뀌면 머무는 시간을 처음부터 다시 잰다 — 표를 받는 동안 안 닫히지 않게 고정한다
  const 알림닫기 = useCallback(() => set알림(null), []);

  // 한 글자 칠 때마다 묻지 않는다 — 한글은 조합이 끝나야 뜻이 된다
  useEffect(() => {
    const t = setTimeout(() => set찾는말(찾기.trim()), 300);
    return () => clearTimeout(t);
  }, [찾기]);

  useEffect(() => {
    if (!열린판) return;
    const 키 = (e: KeyboardEvent) => { if (e.key === "Escape") set열린판(null); };
    window.addEventListener("keydown", 키);
    return () => window.removeEventListener("keydown", 키);
  }, [열린판]);

  const 요청: 스크리닝요청 = useMemo(() => ({
    market: 시장, filters: 보낼조건(조건), sort_by: 정렬, sort_order: 순서, limit: 100, q: 찾는말,
  }), [시장, 조건, 정렬, 순서, 찾는말]);

  const 결과 = useQuery({
    queryKey: ["screening", 요청],
    queryFn: () => screeningApi.run(요청),
    staleTime: 60_000,
    /* 같은 시장에서 정렬·조건만 바꿀 땐 받는 동안 앞 결과를 흐리게 둔다(표가 사라졌다 나타나면 어지럽다).
       시장을 바꿨을 땐 두지 않는다 — '한국' 을 눌렀는데 미국 종목이 보이면 안 된다 */
    placeholderData: (앞, 앞질의) =>
      (앞질의?.queryKey[1] as 스크리닝요청 | undefined)?.market === 시장 ? 앞 : undefined,
  });
  useEffect(() => set몇줄(30), [요청]);

  const 줄들 = 결과.data?.results ?? [];
  const 전체수 = 결과.data?.total ?? 0;

  const 보일칸 = useMemo(() => {
    const 켜짐 = new Set(보이는칸);
    return 칸들.filter((c) => 켜짐.has(c.key) && (시장 !== "ETF" || ETF칸.has(c.key)));
  }, [보이는칸, 시장]);

  const { data: 저장들 } = useQuery<ScreeningPreset[]>({
    queryKey: ["screening-presets"], queryFn: screeningApi.getPresets, enabled: isLoggedIn,
  });

  const 저장 = useMutation({
    mutationFn: (이름: string) => screeningApi.savePreset({
      name: 이름, market: 시장, filters: 조건, sort_by: 정렬, sort_order: 순서, columns: 보이는칸,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["screening-presets"] });
      set열린판(null);
      set알림({ 글: "지금 보기를 저장했어요 — ‘조건 묶음’ 에서 다시 열 수 있어요", 종류: "success" });
    },
    onError: (e: any) => set알림({ 글: 읽을수있는오류(e?.response?.data?.detail, "저장하지 못했어요"), 종류: "error" }),
  });

  const 지우기 = useMutation({
    mutationFn: (id: number) => screeningApi.deletePreset(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["screening-presets"] }),
    onError: (e: any) => set알림({ 글: 읽을수있는오류(e?.response?.data?.detail, "지우지 못했어요"), 종류: "error" }),
  });

  const 관심담기 = useMutation({
    mutationFn: (s: 스크리닝줄) =>
      watchlistApi.addItem({ symbol: s.symbol, market: s.market, name: s.name ?? s.symbol, watchlist_id: 1 }),
    onSuccess: (_d, s) => {
      set별((앞) => new Set([...앞, s.symbol]));
      set알림({ 글: `${s.name ?? s.symbol} 관심종목에 담았어요`, 종류: "success" });
    },
    onError: (err: any) => {
      if (err?.response?.status === 401) { navigate("/login"); return; }
      set알림({ 글: 읽을수있는오류(err?.response?.data?.detail, "담지 못했어요"), 종류: "error" });
    },
  });

  // 줄에 마우스를 올리면 상세 화면 자료를 미리 받는다 — 누르면 곧바로 뜬다
  const 미리받기 = (s: 스크리닝줄) => {
    const 키 = ["stock-detail", s.market as Market, s.symbol];
    if (qc.getQueryData(키)) return;
    qc.prefetchQuery({ queryKey: 키, queryFn: () => stocksApi.getDetail(s.market as Market, s.symbol), staleTime: 60_000 });
  };

  const 칸바꾸기 = (다음: string[]) => {
    set보이는칸(다음);
    try { localStorage.setItem(칸_열쇠, JSON.stringify(다음)); } catch { /* 못 남겨도 이번엔 바뀐다 */ }
  };

  const 세우기 = (k: string) => {
    if (k === 정렬) set순서((o) => (o === "desc" ? "asc" : "desc"));
    else { set정렬(k); set순서("desc"); }
  };

  const 판열기 = (p: 판) => set열린판((앞) => (앞 === p ? null : p));

  const 묶음고르기 = (p: 기본묶음하나) => {
    set조건(p.조건);
    set정렬(p.정렬[0]);
    set순서(p.정렬[1]);
    set열린판(null);
  };

  const 보기열기 = (p: ScreeningPreset) => {
    set시장(p.market);
    set조건((p.filters ?? {}) as 조건모음);
    set정렬(p.sort_by);
    set순서(p.sort_order === "asc" ? "asc" : "desc");
    if (p.columns?.length) 칸바꾸기(칸들.filter((c) => p.columns!.includes(c.key)).map((c) => c.key));
    set열린판(null);
  };

  const 조건빼기 = (k: string) => set조건((앞) => {
    const 다음 = { ...앞 };
    delete 다음[k];
    return 다음;
  });

  const 모두지우기 = () => { set조건({}); set찾기(""); set찾는말(""); };

  const 걸린수 = Object.keys(조건).length;
  const 정렬칸 = 칸들.find((c) => c.key === 정렬);
  const 정렬글 = `${정렬칸 ? 칸이름(정렬칸, 시장) : 정렬} ${순서 === "desc" ? "높은" : "낮은"} 순`;
  const 흐름칸있음 = 시장 !== "ETF" && 보일칸.some((c) => c.모양 === "흐름" || c.key.endsWith("_cagr_3y"));

  const 판단추 = (p: 판, Icon: typeof Layers, 글: string) => (
    <button type="button" onClick={() => 판열기(p)} aria-expanded={열린판 === p} aria-controls="스크리닝-판"
      className={cn(
        "flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium whitespace-nowrap transition-colors flex-shrink-0",
        열린판 === p
          ? "bg-accent-blue/15 border-accent-blue text-accent-blue"
          : "bg-bg-elevated border-border text-text-secondary hover:text-text-primary hover:border-accent-blue/50",
      )}>
      <Icon size={13} />{글}
    </button>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* ── 머리 ─────────────────────────────────────────── */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">종목 스크리닝</h1>
          <p className="text-text-muted text-xs mt-0.5">칸 제목을 누르면 그 칸으로 세워요</p>
        </div>
        <Tabs tabs={시장들} active={시장} onChange={(id) => set시장(id as Market)} fill={false} ariaLabel="시장" />
      </div>

      {/* ── 도구 줄 ─────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 min-w-0">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
          <input type="search" value={찾기} onChange={(e) => set찾기(e.target.value)} maxLength={100}
            aria-label="티커나 이름으로 찾기" placeholder="티커나 이름 — 쉼표로 여럿 (AAPL, MSFT)"
            className={cn(INPUT_CLASS, "pl-9 pr-9 [&::-webkit-search-cancel-button]:hidden")} />
          {찾기 && (
            <button type="button" onClick={() => { set찾기(""); set찾는말(""); }} aria-label="찾는 말 지우기"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-text-muted hover:text-text-primary">
              <X size={14} />
            </button>
          )}
        </div>
        <div className="flex gap-1.5 overflow-x-auto scrollbar-hide -mx-3 px-3 sm:mx-0 sm:px-0">
          {판단추("묶음", Layers, "조건 묶음")}
          {판단추("조건", SlidersHorizontal, 걸린수 ? `조건 ${걸린수}` : "조건")}
          {판단추("칸", Columns3, `칸 ${보일칸.length}`)}
          {판단추("저장", Save, "보기 저장")}
          <button type="button" onClick={() => csv내려받기(
              `screening_${시장}_${new Date().toISOString().slice(0, 10)}.csv`,
              스크리닝CSV(줄들, new Set(보일칸.map((c) => c.key))))}
            disabled={!줄들.length} title="CSV 다운로드"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-bg-elevated text-xs font-medium text-text-secondary hover:text-text-primary hover:border-accent-blue/50 transition-colors disabled:opacity-40 flex-shrink-0">
            <Download size={13} />CSV
          </button>
        </div>
      </div>

      {열린판 && (
        <Card className="p-4">
          <div id="스크리닝-판">
            {열린판 === "묶음" && (
              <묶음판 시장={시장} 지금={{ 조건, 정렬, 순서 }} 고르기={묶음고르기} 로그인함={isLoggedIn}
                저장들={저장들} 보기열기={보기열기} 보기지우기={(p) => 지우기.mutate(p.id)} />
            )}
            {열린판 === "조건" && (
              <조건판 key={`${시장}:${JSON.stringify(조건)}`} 시장={시장} 조건={조건} 고를값={결과.data?.facets}
                적용={(다음) => { set조건(다음); set열린판(null); }} />
            )}
            {열린판 === "칸" && <칸판 시장={시장} 보이는={보이는칸} 바꾸기={칸바꾸기} />}
            {열린판 === "저장" && (
              <저장판 로그인함={isLoggedIn} 저장={(이름) => 저장.mutate(이름)} 저장중={저장.isPending}
                로그인하기={() => navigate("/login")} />
            )}
          </div>
        </Card>
      )}

      {/* ── 걸린 조건 ─────────────────────────────────────── */}
      {(걸린수 > 0 || 찾는말) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {찾는말 && (
            <span className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full bg-accent-blue/10 border border-accent-blue/30 text-2xs text-accent-blue">
              찾기: {찾는말}
              <button type="button" onClick={() => { set찾기(""); set찾는말(""); }} aria-label="찾기 빼기"
                className="p-0.5 rounded-full hover:bg-accent-blue/20"><X size={11} /></button>
            </span>
          )}
          {Object.entries(조건).map(([k, v]) => {
            const 글 = 조건글(k, v, 시장);
            return (
              <span key={k} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full bg-accent-blue/10 border border-accent-blue/30 text-2xs text-accent-blue">
                {글}
                <button type="button" onClick={() => 조건빼기(k)} aria-label={`${글} 조건 빼기`}
                  className="p-0.5 rounded-full hover:bg-accent-blue/20"><X size={11} /></button>
              </span>
            );
          })}
          <Button variant="link" className="text-2xs ml-1" onClick={모두지우기}>모두 지우기</Button>
        </div>
      )}

      {/* ── 결과 ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 px-1 text-xs text-text-muted min-h-[1.25rem]">
        <span>
          <span className="text-text-secondary font-medium">{정렬글}</span>
          {결과.data && (
            <>
              {" · "}
              {전체수 > 줄들.length
                ? <>조건에 맞는 <b className="text-text-primary">{전체수.toLocaleString("ko-KR")}</b>곳 중 위 {줄들.length}곳</>
                : <><b className="text-text-primary">{전체수.toLocaleString("ko-KR")}</b>곳</>}
            </>
          )}
        </span>
        {결과.isFetching && 결과.data && (
          <span className="flex items-center gap-1.5" role="status"><InlineSpinner className="w-3 h-3" />불러오는 중</span>
        )}
      </div>

      <Card className="p-0 overflow-hidden">
        {결과.isError ? (
          /* 실패와 '결과 0곳' 을 갈라야 한다 — 모르면 조건만 헛되이 풀게 된다 */
          <못불러옴 사유={결과.error} 다시={() => 결과.refetch()} />
        ) : !결과.data ? (
          <div role="status" aria-label="불러오는 중">
            <p className="px-4 pt-4 text-2xs text-text-muted">처음 한 번은 시장 전체를 훑느라 수십 초 걸릴 수 있어요</p>
            <ScreeningSkeleton />
          </div>
        ) : 줄들.length === 0 ? (
          <빈화면 icon={Filter} title="조건에 맞는 종목이 없어요"
            hint={걸린수 || 찾는말 ? "조건의 범위를 넓히거나 하나 빼 보세요." : "잠시 뒤 다시 열어 보세요."}
            action={걸린수 || 찾는말 ? { label: "조건 모두 지우기", onClick: 모두지우기 } : undefined} />
        ) : (
          <div className={cn("overflow-x-auto lg:overflow-y-auto lg:max-h-[75vh] transition-opacity",
            결과.isPlaceholderData && "opacity-60")}>
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-20 bg-bg-secondary">
                <tr className="text-text-muted border-b border-border">
                  <th scope="col" className="sticky left-0 z-30 bg-bg-secondary text-left font-medium px-3 py-2.5">
                    종목
                  </th>
                  {보일칸.map((c) => {
                    const 이름 = 칸이름(c, 시장);
                    const 지금 = 정렬 === c.key;
                    return (
                      <th key={c.key} scope="col" className="text-right font-medium px-3 py-2.5 whitespace-nowrap"
                        aria-sort={지금 ? (순서 === "desc" ? "descending" : "ascending") : undefined}>
                        {c.세움 === false ? 이름 : (
                          <button type="button" onClick={() => 세우기(c.key)} title={용어사전[c.이름]?.뜻}
                            className={cn("inline-flex items-center gap-0.5 whitespace-nowrap",
                              지금 ? "text-accent-blue" : "hover:text-text-primary")}>
                            {이름}
                            {지금 && (순서 === "desc" ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
                          </button>
                        )}
                      </th>
                    );
                  })}
                  <th scope="col" className="px-2 py-2.5 w-8"><span className="sr-only">관심종목</span></th>
                </tr>
              </thead>
              <tbody>
                {줄들.slice(0, 몇줄).map((s, i) => {
                  const 담음 = 별.has(s.symbol);
                  const 이름 = s.name ?? s.symbol;
                  return (
                    <tr key={`${s.market}:${s.symbol}`} onMouseEnter={() => 미리받기(s)}
                      className="group/row border-b border-border/30 hover:bg-bg-hover/50 transition-colors">
                      {/* 붙박이 칸은 바탕이 불투명해야 밀리는 칸이 비치지 않는다 — 줄에 올렸을 때도
                          나머지 칸(카드 위에 반투명 hover)과 같은 색이 되게 섞어 칠한다 */}
                      <td className="sticky left-0 z-10 bg-bg-card group-hover/row:bg-[color-mix(in_srgb,var(--bg-hover)_50%,var(--bg-card))] transition-colors px-3 py-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-5 flex-shrink-0 text-right text-2xs text-text-dim font-mono">{i + 1}</span>
                          <회사로고 도메인={s.domain} 이름={이름} />
                          <Link to={`/stocks/${s.market}/${s.symbol}`} className="min-w-0 flex flex-col group">
                            <span className="font-semibold text-text-primary truncate max-w-[7.5rem] sm:max-w-[12rem] group-hover:text-accent-blue transition-colors">
                              {이름}
                            </span>
                            <span className="text-2xs text-text-muted font-mono">{s.symbol}</span>
                          </Link>
                        </div>
                      </td>
                      {보일칸.map((c) => (
                        <td key={c.key} className="px-3 py-2 text-right whitespace-nowrap">
                          <칸값 칸={c} 줄={s} 이름={`${이름} ${칸이름(c, 시장)}`} />
                        </td>
                      ))}
                      <td className="px-2 py-2">
                        <button type="button" disabled={담음 || 관심담기.isPending}
                          onClick={() => { if (!isLoggedIn) { navigate("/login"); return; } 관심담기.mutate(s); }}
                          aria-label={담음 ? `${이름} 관심종목에 담김` : `${이름} 관심종목에 담기`}
                          className={cn("p-1 rounded transition-colors", 담음 ? "text-accent-yellow" : "text-text-muted hover:text-accent-yellow")}>
                          <Star size={13} fill={담음 ? "currentColor" : "none"} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {줄들.length > 몇줄 && (
              <div className="flex justify-center py-3 border-t border-border/30">
                <Button variant="link" className="text-xs" onClick={() => set몇줄((n) => n + 30)}>
                  더 보기 ({줄들.length - 몇줄}곳 더)
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>

      {흐름칸있음 && (
        <p className="px-1 text-2xs text-text-muted break-keep">
          매출·EPS 흐름은 최근 4년 연간 실적, 성장률은 그 3년 연평균이에요. 서버가 조금씩 받아 채워서 아직 빈 종목도 있어요.
          {시장 === "US" && " 해외 회사의 흐름은 그 회사 장부의 돈 단위예요(TSMC 는 대만 달러)."}
        </p>
      )}

      {알림 && <Toast message={알림.글} kind={알림.종류} onClose={알림닫기} />}
    </div>
  );
}
