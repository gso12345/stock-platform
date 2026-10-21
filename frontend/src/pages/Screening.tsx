/**
 * 종목 스크리닝 — 참고한 스크리너처럼(사용자: "스크리닝 사이트 참고해줘" → "일단 할수있는건 다해줘").
 *
 *   · 열자마자 시가총액 큰 순으로 보인다. 예전엔 조건을 고르고 '스크리닝 실행' 을 눌러야 표가 채워졌다
 *   · 칸 제목을 누르면 그 칸으로 세운다 — 한 번 더 누르면 반대로
 *   · 티커·이름 찾기, 조건 묶음, 조건, 칸 고르기, 보기 저장, CSV
 *   · 이름 칸에 회사 로고, 매출·EPS 는 연도별 막대
 *
 * 세우기는 서버가 한다. 받은 위 100개를 화면에서 다시 세우면 'PER 낮은 순' 이 전체가 아니라
 * '시총 위 100곳 중 PER 낮은 순' 이 된다. 상장된 모든 종목(국내 2천여·미국 6천여 곳)이라
 * 한 쪽에 쪽크기 만큼씩 서버에서 받아 넘긴다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle, Columns3, Download, Filter, Layers, Save, Search, SlidersHorizontal, X,
} from "lucide-react";
import { screeningApi, stocksApi, type 스크리닝요청, type 스크리닝줄 } from "@/api/stocks";
import { useAuthStore } from "@/store/authStore";
import { Button, Card, InlineSpinner, INPUT_CLASS, Tabs, Toast, cn, 빈화면, 못불러옴 } from "@/components/ui";
import Pagination from "@/components/ui/Pagination";
import { 읽을수있는오류 } from "@/utils/errors";
import { csv내려받기 } from "@/utils/csv";
import { 용어사전 } from "@/constants/terms";
import type { Market, ScreeningPreset } from "@/types";
import {
  칸들, 처음칸, 보낼조건, 스크리닝CSV, 조건글, ETF칸, 칸이름,
} from "@/components/screening/screeningDefs";
import { 칸값 } from "@/components/screening/ScreeningCells";
import {
  조건판, 칸판, 묶음판, 저장판, type 기본묶음하나, type 조건모음,
} from "@/components/screening/ScreeningPanels";
import {
  StockTableSkeleton, 받는중띠, 도구단추, 정렬제목, 종목칸,
  표상자, 표머리, 표머리줄, 표머리칸, 붙박이머리, 표줄, 붙박이칸, 표칸,
} from "@/components/common/StockTable";
import { 관심별 } from "@/components/watchlist/WatchlistStar";
import { timeAgo } from "@/utils/formatters";

// 시험·다른 화면이 이 파일에서 가져다 쓴다
export { SECTORS, 보낼조건, 스크리닝CSV } from "@/components/screening/screeningDefs";

/* 앱의 다른 화면(대시보드·관심종목·퀀트)과 같은 이름·차례 — 국내·해외 */
const 시장들 = [
  { id: "KR", label: "국내" },
  { id: "US", label: "해외" },
  { id: "ETF", label: "ETF" },
];

type 판 = "묶음" | "조건" | "칸" | "저장";

/** 한 쪽에 몇 곳 — 서버 limit 상한(100) 안에서, 휴대폰에서도 표가 무겁지 않게 */
const 쪽크기 = 50;

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

  /* 시장·조건·정렬·찾기가 바뀌면 첫 쪽부터 — 다른 목록의 3쪽은 뜻이 없다. 쪽을 그 목록의 열쇠와
     함께 들어, 바뀐 목록으로 앞 목록의 3쪽을 한 번 묻는 일도 없게 한다 */
  const 목록열쇠 = JSON.stringify([시장, 조건, 정렬, 순서, 찾는말]);
  const [쪽기억, set쪽기억] = useState({ 열쇠: 목록열쇠, 쪽: 1 });
  const 쪽 = 쪽기억.열쇠 === 목록열쇠 ? 쪽기억.쪽 : 1;
  const 표자리 = useRef<HTMLDivElement>(null);
  const 머리자리 = useRef<HTMLDivElement>(null);

  const 요청: 스크리닝요청 = useMemo(() => ({
    market: 시장, filters: 보낼조건(조건), sort_by: 정렬, sort_order: 순서,
    limit: 쪽크기, offset: (쪽 - 1) * 쪽크기, q: 찾는말,
  }), [시장, 조건, 정렬, 순서, 찾는말, 쪽]);

  const 결과 = useQuery({
    queryKey: ["screening", 요청],
    queryFn: () => screeningApi.run(요청),
    staleTime: 60_000,
    /* 같은 시장에서 정렬·조건만 바꿀 땐 받는 동안 앞 결과를 흐리게 둔다(표가 사라졌다 나타나면 어지럽다).
       시장을 바꿨을 땐 두지 않는다 — '한국' 을 눌렀는데 미국 종목이 보이면 안 된다 */
    placeholderData: (앞, 앞질의) =>
      (앞질의?.queryKey[1] as 스크리닝요청 | undefined)?.market === 시장 ? 앞 : undefined,
    /* 서버가 그 시장을 처음 받는 중이면(배포 직후·처음 여는 시장 — 1~3분) 받은 것부터 오고,
       다 받을 때까지 곧잘 다시 묻는다 */
    refetchInterval: (q) => (q.state.data?.building ? 3000 : false),
  });

  const 줄들 = 결과.data?.results ?? [];
  const 전체수 = 결과.data?.total ?? 0;
  const 짓는중 = 결과.data?.building ?? null;
  const 쪽수 = Math.max(1, Math.ceil(전체수 / 쪽크기));
  // 순위·범위는 보이는 줄의 것으로 — 다음 쪽을 받는 동안엔 앞 쪽이 흐리게 남아 있다
  const 보인앞 = 결과.data?.offset ?? (쪽 - 1) * 쪽크기;

  const 쪽넘기기 = (p: number) => {
    set쪽기억({ 열쇠: 목록열쇠, 쪽: p });
    표자리.current?.scrollTo?.({ top: 0 });
    // 휴대폰은 화면 전체가 밀린다 — 표 아래의 쪽 단추를 눌렀으면 새 쪽의 첫 줄부터 보이게
    if ((머리자리.current?.getBoundingClientRect().top ?? 0) < 0) 머리자리.current?.scrollIntoView?.({ block: "start" });
  };

  /* 서버가 표를 새로 만들며 종목이 줄어 이 쪽이 사라졌으면 마지막 쪽으로 — '맞는 종목이 없어요' 가
     뜨면 조건만 헛되이 풀게 된다 */
  useEffect(() => {
    const d = 결과.data;
    if (d && !결과.isPlaceholderData && !d.results.length && d.total > 0 && 쪽 > 1) {
      set쪽기억({ 열쇠: 목록열쇠, 쪽: Math.ceil(d.total / 쪽크기) });
    }
  }, [결과.data, 결과.isPlaceholderData, 쪽, 목록열쇠]);

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
    <도구단추 아이콘={Icon} 열림={열린판 === p} controls="스크리닝-판" onClick={() => 판열기(p)}>{글}</도구단추>
  );
  const 시세때 = 결과.data?.as_of ? timeAgo(new Date(결과.data.as_of * 1000).toISOString()) : "";

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
          <도구단추 아이콘={Download} title="CSV 다운로드" disabled={!줄들.length}
            onClick={() => csv내려받기(
              `screening_${시장}_${new Date().toISOString().slice(0, 10)}.csv`,
              스크리닝CSV(줄들, new Set(보일칸.map((c) => c.key))))}>
            CSV
          </도구단추>
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
      <div ref={머리자리} className="flex items-center justify-between gap-2 px-1 text-xs text-text-muted min-h-[1.25rem] scroll-mt-3">
        <span>
          <span className="text-text-secondary font-medium">{정렬글}</span>
          {결과.data && !결과.data.failed && (
            <>
              {" · "}
              {짓는중 ? "시장 전체를 받는 중"
                : 전체수 > 줄들.length
                ? <>조건에 맞는 <b className="text-text-primary">{전체수.toLocaleString("ko-KR")}</b>곳 중{" "}
                    {(보인앞 + 1).toLocaleString("ko-KR")}~{(보인앞 + 줄들.length).toLocaleString("ko-KR")}위</>
                : <><b className="text-text-primary">{전체수.toLocaleString("ko-KR")}</b>곳</>}
              {/* 가격은 서버가 5분마다 묶음 시세로 새로 받는다 — 언제 것인지 밝힌다 */}
              {시세때 && !짓는중 && <span className="text-text-dim"> · 시세 {시세때}</span>}
            </>
          )}
        </span>
        {결과.isFetching && 결과.data && !짓는중 && (
          <span className="flex items-center gap-1.5" role="status"><InlineSpinner className="w-3 h-3" />불러오는 중</span>
        )}
      </div>

      {/* 서버가 이 시장을 처음 받는 중 — 예전엔 다 받을 때까지(1~3분) 표가 빈 채였다
          (사용자: "처음에는 아무것도 안나오던데"). 받은 것부터 보이고, 얼마나 받았는지 알린다 */}
      {짓는중 && (
        <받는중띠 이름="시장 전체를 받는 중" done={짓는중.done} total={짓는중.total || undefined}>
          처음 한 번은 시장 전체를 받아요(1~3분)
          {짓는중.total > 0 && <> — <b className="text-text-primary">{짓는중.done}/{짓는중.total}곳</b> 받음</>}
          . 받은 것부터 보여 드려요
        </받는중띠>
      )}

      <Card className="p-0 overflow-hidden">
        {결과.isError ? (
          /* 실패와 '결과 0곳' 을 갈라야 한다 — 모르면 조건만 헛되이 풀게 된다 */
          <못불러옴 사유={결과.error} 다시={() => 결과.refetch()} />
        ) : 결과.data?.failed ? (
          /* 받아 둔 시장 자료도 없는데 야후가 한 줄도 안 줬다 — '맞는 종목이 없어요' 라고 하면
             조건만 헛되이 풀게 된다 */
          <빈화면 icon={AlertTriangle} title="야후에서 시세를 받지 못했어요"
            hint="야후가 잠깐 막혔을 수 있어요. 1~2분 뒤 다시 시도해 보세요."
            action={{ label: "다시 시도", onClick: () => 결과.refetch() }} />
        ) : !결과.data || (짓는중 && 줄들.length === 0) ? (
          <div role="status" aria-label="불러오는 중">
            {!결과.data && (
              <p className="px-4 pt-4 text-2xs text-text-muted">처음 한 번은 시장 전체를 훑느라 수십 초 걸릴 수 있어요</p>
            )}
            <StockTableSkeleton />
          </div>
        ) : 줄들.length === 0 ? (
          <빈화면 icon={Filter} title="조건에 맞는 종목이 없어요"
            hint={걸린수 || 찾는말 ? "조건의 범위를 넓히거나 하나 빼 보세요." : "잠시 뒤 다시 열어 보세요."}
            action={걸린수 || 찾는말 ? { label: "조건 모두 지우기", onClick: 모두지우기 } : undefined} />
        ) : (
          <>
            <div ref={표자리} className={cn(표상자, "transition-opacity", 결과.isPlaceholderData && "opacity-60")}>
              <table className="w-full text-xs">
                <thead className={표머리}>
                  <tr className={표머리줄}>
                    <th scope="col" className={붙박이머리}>종목</th>
                    {보일칸.map((c) => {
                      const 이름 = 칸이름(c, 시장);
                      const 지금 = 정렬 === c.key;
                      return (
                        <th key={c.key} scope="col" className={표머리칸}
                          aria-sort={지금 ? (순서 === "desc" ? "descending" : "ascending") : undefined}>
                          {c.세움 === false ? 이름 : (
                            <정렬제목 이름={이름} 지금={지금} 순서={순서} onClick={() => 세우기(c.key)}
                              title={용어사전[c.이름]?.뜻} />
                          )}
                        </th>
                      );
                    })}
                    <th scope="col" className="px-2 py-2.5 w-8"><span className="sr-only">관심종목</span></th>
                  </tr>
                </thead>
                <tbody>
                  {줄들.map((s, i) => {
                    const 이름 = s.name ?? s.symbol;
                    return (
                      <tr key={`${s.market}:${s.symbol}`} onMouseEnter={() => 미리받기(s)} className={표줄}>
                        <td className={붙박이칸}>
                          <종목칸 순위={보인앞 + i + 1} symbol={s.symbol} name={이름} market={s.market} domain={s.domain} />
                        </td>
                        {보일칸.map((c) => (
                          <td key={c.key} className={표칸}>
                            <칸값 칸={c} 줄={s} 이름={`${이름} ${칸이름(c, 시장)}`} />
                          </td>
                        ))}
                        <td className="px-2 py-2">
                          <관심별 symbol={s.symbol} market={s.market} name={이름} 로그인함={isLoggedIn}
                            알리기={(글, 종류) => set알림({ 글, 종류 })} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={Math.min(쪽, 쪽수)} totalPages={쪽수} onChange={쪽넘기기} numbered
              className="py-3 border-t border-border/30" />
          </>
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
