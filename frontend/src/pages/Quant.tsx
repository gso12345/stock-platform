import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { quantScoreApi, watchlistApi, watchlistFolderApi, portfolioApi, type QuantFactorKey } from "@/api/stocks";
import { useQuantSettings, QUANT_DEFAULT_WEIGHTS } from "@/hooks/useQuantSettings";
import { getRecentlyViewed, type RecentStock } from "@/utils/recentlyViewed";
import QuantSettingsPanel from "@/components/quant/QuantSettingsPanel";
import { useAuthStore } from "@/store/authStore";
import { Card, Badge, RowSkeleton, Button, Tabs, UnderlineTabs, ChangeBadge, 용어힌트, 빈화면 } from "@/components/ui";
import { Award, AlertCircle, Settings2, LogIn, ArrowDown, ArrowUp, Clock, Wallet, Download } from "lucide-react";
import { GRADE_BANDS, gradeColor, scoreColor } from "@/utils/quant";
import { lookupPrice, indexPricesBySymbol } from "@/utils/prices";
import { fmtKRWFull, fmtUSDFull } from "@/utils/formatters";

const FACTOR_LABEL_KO: Record<QuantFactorKey, string> = {
  value: "가치", quality: "품질", momentum: "모멘텀", growth: "성장", risk: "안정성",
};

const MARKET_TABS = [
  { id: "전체", label: "전체" },
  { id: "KR",   label: "국내" },
  { id: "US",   label: "해외" },
  { id: "ETF",  label: "ETF"  },
];

type SortKey = "total" | QuantFactorKey;

export default function Quant() {
  const navigate = useNavigate();
  const { isLoggedIn } = useAuthStore();
  const [marketTab, setMarketTab] = useState("전체");
  const [folderTab, setFolderTab] = useState<number | "all" | "none" | "recent">("all");
  const [portfolioTab, setPortfolioTab] = useState<number | null>(null);
  const [showGradeHelp, setShowGradeHelp] = useState(false);
  const gradeHelpRef = useRef<HTMLDivElement>(null);
  /* 정렬 상태를 주소에 남긴다. 새로고침하면 초기화되던 것을 고치고,
     "이 순서로 봐" 하고 링크를 넘길 수 있게 한다 */
  const [searchParams, setSearchParams] = useSearchParams();
  const sortKey = (searchParams.get("sort") ?? "total") as SortKey;
  const sortDir = searchParams.get("dir") === "asc" ? "asc" : "desc";
  const setSort = (key: SortKey, dir: "desc" | "asc") => {
    const next = new URLSearchParams(searchParams);
    if (key === "total" && dir === "desc") { next.delete("sort"); next.delete("dir"); }
    else { next.set("sort", key); next.set("dir", dir); }
    setSearchParams(next, { replace: true });
  };
  const [recentlyViewed, setRecentlyViewed] = useState<RecentStock[]>(() => getRecentlyViewed());

  // 최근조회 탭 선택 시 localStorage에서 새로 불러오기
  useEffect(() => {
    if (folderTab === "recent") {
      setRecentlyViewed(getRecentlyViewed());
    }
  }, [folderTab]);

  // 등급 도움말 팝업 외부 클릭 시 닫기
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (gradeHelpRef.current && !gradeHelpRef.current.contains(e.target as Node)) {
        setShowGradeHelp(false);
      }
    };
    // 바깥 클릭만 막아뒀더니 키보드로는 닫을 방법이 없었다
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setShowGradeHelp(false); };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", onEsc);
    };
  }, []);

  /* 관심종목 화면과 같은 키·같은 staleTime 을 쓴다.
     예전에는 staleTime 이 없어(=0) 퀀트 탭에 올 때마다 폴더·종목을 다시 받았다. */
  const { data: folders } = useQuery({
    queryKey: ["watchlist-folders"],
    queryFn: watchlistFolderApi.getFolders,
    enabled: isLoggedIn,
    staleTime: 300_000,
  });

  const { data: items, isLoading: itemsLoading } = useQuery({
    queryKey: ["watchlist-items"],
    queryFn: () => watchlistApi.getItems(),
    enabled: isLoggedIn,
    staleTime: 120_000,
  });

  const { data: pfList = [] } = useQuery<any[]>({
    queryKey: ["portfolios"],
    queryFn: portfolioApi.getPortfolios,
    enabled: isLoggedIn,
    staleTime: 300_000,
  });

  /* 보유종목은 내 자산·관심종목과 같은 쿼리를 쓴다.
     예전에는 ["portfolio-tab-items", id] 라는 이 화면 전용 키를 썼다. 내 자산에서
     종목을 추가·삭제해도 그쪽은 ["portfolio-items-all"] 만 무효화하므로, 퀀트는
     사라진 종목의 점수를 계속 보여줬다. 요청도 탭마다 따로 나갔다. */
  const { data: pfAllItems = [] } = useQuery<any[]>({
    queryKey: ["portfolio-items-all"],
    queryFn: () => portfolioApi.getItems(undefined, true),
    enabled: isLoggedIn,
    staleTime: 300_000,
  });
  const pfItems = useMemo(
    () => (pfAllItems as any[]).filter((i) => (i.portfolioId ?? null) === portfolioTab),
    [pfAllItems, portfolioTab],
  );

  const filteredItems = useMemo(() => {
    let list = (items ?? []) as any[];
    if (marketTab !== "전체") list = list.filter((it) => it.market === marketTab);
    if (folderTab === "none") list = list.filter((it) => !it.folder_id);
    else if (folderTab !== "all") list = list.filter((it) => it.folder_id === folderTab);
    return list;
  }, [items, marketTab, folderTab]);

  const allCompareItems = useMemo(() => {
    if (portfolioTab !== null) {
      let list = (pfItems as any[]);
      if (marketTab !== "전체") list = list.filter((i) => i.market === marketTab);
      const seen = new Set<string>();
      const out: { symbol: string; market: string; name: string }[] = [];
      for (const it of list) {
        const key = `${it.market}:${it.symbol}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ symbol: it.symbol, market: it.market, name: it.name });
      }
      return out;
    }
    if (folderTab === "recent") {
      let recentList = recentlyViewed;
      if (marketTab !== "전체") recentList = recentList.filter((s) => s.market === marketTab);
      return recentList.slice(0, 10).map((s) => ({ symbol: s.symbol, market: s.market, name: s.name }));
    }
    const seen = new Set<string>();
    const out: { symbol: string; market: string; name: string }[] = [];
    for (const it of filteredItems as any[]) {
      const key = `${it.market}:${it.symbol}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ symbol: it.symbol, market: it.market, name: it.name });
    }
    return out;
  }, [filteredItems, folderTab, recentlyViewed, marketTab, portfolioTab, pfItems]);
  const compareItems = useMemo(() => allCompareItems.slice(0, 30), [allCompareItems]);
  const truncated = allCompareItems.length > compareItems.length;

  const { data: weightsData } = useQuery({
    queryKey: ["quant-weights"],
    queryFn: quantScoreApi.getWeights,
    enabled: isLoggedIn,
  });

  const quantSettings = useQuantSettings(weightsData?.weights, weightsData?.enabled_metrics);
  const { weights: quantWeights, metrics: quantMetrics, showSettings, setShowSettings } = quantSettings;

  const {
    data: compareData,
    isLoading: scoreLoading,
    isError,
    isFetching,
  } = useQuery({
    queryKey: ["quant-compare", compareItems.map((i: { symbol: string; market: string }) => `${i.market}:${i.symbol}`).join(","), quantWeights, quantMetrics],
    queryFn: () => quantScoreApi.compare(compareItems, quantWeights ?? undefined, quantMetrics ?? undefined),
    enabled: isLoggedIn && compareItems.length > 0,
    staleTime: 60_000,
  });

  /* 표에 시세를 같이 띄운다. 점수만 보고는 "그래서 지금 얼마인데?" 를
     알 수 없어 매번 종목 상세로 들어가야 했다. 관심종목 화면과 같은 배치
     조회를 쓰므로 캐시를 공유한다 — 추가 요청이 사실상 없다. */
  const priceSymbols = useMemo(() => compareItems.map((i) => i.symbol), [compareItems]);
  const priceMarkets = useMemo(
    () => compareItems.map((i) => (i.market === "KR" ? "KR" : "US")), [compareItems]);
  const { data: priceRows } = useQuery({
    queryKey: ["watchlist-prices", [...priceSymbols].sort().join(",")],
    queryFn: ({ signal }) => watchlistApi.getPrices(priceSymbols, priceMarkets, signal),
    enabled: isLoggedIn && priceSymbols.length > 0,
    staleTime: 55_000,
    refetchInterval: 60_000,
  });
  const priceMap = useMemo(() => indexPricesBySymbol(priceRows as any[] | undefined), [priceRows]);

  const nameMap = useMemo(() => {
    const m = new Map<string, string>();
    compareItems.forEach((i: { symbol: string; market: string; name: string }) => m.set(`${i.market}:${i.symbol}`, i.name));
    return m;
  }, [compareItems]);

  const scoreOf = (row: { total_score: number | null; factors: { key: QuantFactorKey; score: number | null }[] }, key: SortKey) =>
    key === "total" ? row.total_score : row.factors.find((f) => f.key === key)?.score ?? null;

  const rows = useMemo(() => {
    const list = compareData?.items ?? [];
    const dir = sortDir === "desc" ? -1 : 1;
    /* 점수가 없는 종목은 방향과 무관하게 항상 뒤로 보낸다.
       예전에는 null 을 -1 로 바꿔 정렬해서, 오름차순일 때 '점수 없음'이
       맨 위로 올라왔다 — 가장 안 궁금한 줄이 첫 화면을 차지했다 */
    return [...list].sort((a, b) => {
      const av = scoreOf(a, sortKey), bv = scoreOf(b, sortKey);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return dir * (av - bv);
    });
  }, [compareData, sortKey, sortDir]);

  /** 지금 보고 있는 표를 CSV 로 내려받는다.
      비교 결과는 스프레드시트로 옮겨 보는 수요가 크다. 엑셀이 UTF-8 을
      알아보도록 BOM 을 붙인다 — 없으면 한글이 깨진다 */
  const downloadCsv = () => {
    const head = ["종목명", "심볼", "시장", "현재가", "종합점수", "등급",
                  ...(Object.keys(FACTOR_LABEL_KO) as QuantFactorKey[]).map((k) => FACTOR_LABEL_KO[k])];
    const esc = (v: unknown) => {
      const t = String(v ?? "");
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const body = rows.map((r) => [
      nameMap.get(`${r.market}:${r.symbol}`) ?? r.symbol, r.symbol, r.market,
      lookupPrice(priceMap, r.symbol)?.price ?? "",
      r.total_score?.toFixed(1) ?? "", r.grade ?? "",
      ...(Object.keys(FACTOR_LABEL_KO) as QuantFactorKey[]).map(
        (k) => r.factors.find((f) => f.key === k)?.score?.toFixed(1) ?? ""),
    ]);
    const csv = "\uFEFF" + [head, ...body].map((row) => row.map(esc).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    // 파일명은 영문으로 둔다. 크로미움은 download 속성에 한글이 섞이면
    // 이름을 통째로 버리고 'download' 로 저장한다 — 실제로 그렇게 나왔다.
    // 파일 내용의 한글은 BOM 덕에 문제없다
    a.download = `quant-score_${new Date().toISOString().slice(0, 10)}.csv`;
    // 문서에 붙였다 떼야 파일명이 지켜진다 — 떠 있는 앵커는 브라우저가
    // download 속성을 무시하고 'download' 라는 이름으로 저장한다
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  /** 시장 탭까지 반영한 폴더별 종목 수. folderId 가 null 이면 전체 */
  const countIn = (folderId: number | null) =>
    ((items ?? []) as any[]).filter(
      (i) => (marketTab === "전체" || i.market === marketTab) &&
             (folderId === null || i.folder_id === folderId),
    ).length;

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSort(key, sortDir === "desc" ? "asc" : "desc");
    else setSort(key, "desc");
  };

  useEffect(() => {
    if (typeof folderTab === "number" && folders && !folders.some((f: any) => f.id === folderTab)) {
      setFolderTab("all");
    }
  }, [folders, folderTab]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <Award size={22} className="text-accent-blue" />
            퀀트점수 비교
          </h1>
          <p className="text-text-muted text-xs mt-0.5">
            관심종목들을 같은 기준(가중치·사용 지표)으로 퀀트 점수 비교
          </p>
        </div>
        {isLoggedIn && (
          <div className="flex items-center gap-2 flex-shrink-0">
          {rows.length > 0 && (
            <button
              onClick={downloadCsv}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold border border-border text-text-muted hover:text-text-primary hover:border-accent-blue/40 transition-colors whitespace-nowrap"
            >
              <Download size={14} className="flex-shrink-0" />CSV
            </button>
          )}
          <button
            onClick={() => setShowSettings((s) => !s)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors whitespace-nowrap flex-shrink-0 ${
              showSettings ? "border-accent-blue text-accent-blue bg-accent-blue/5" : "border-border text-text-muted hover:text-text-primary hover:border-accent-blue/40"
            }`}
          >
            <Settings2 size={14} className="flex-shrink-0" />기준 수정
          </button>
          </div>
        )}
      </div>

      {!isLoggedIn ? (
        <Card className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <LogIn size={32} className="text-text-muted/40" />
          <p className="text-text-secondary text-sm">로그인하면 내 관심종목의 퀀트 점수를 비교할 수 있어요</p>
          <Button size="sm" onClick={() => navigate("/login")}>로그인</Button>
        </Card>
      ) : (
        <>
          {showSettings && (
            <QuantSettingsPanel
              weightsDraft={quantSettings.weightsDraft}
              metricsDraft={quantSettings.metricsDraft}
              onUpdateWeight={quantSettings.updateWeight}
              onToggleMetric={quantSettings.toggleMetric}
              onReset={quantSettings.resetToDefault}
              onSave={() => quantSettings.save.mutate({ weights: quantSettings.weightsDraft ?? QUANT_DEFAULT_WEIGHTS, metrics: quantSettings.metricsDraft ?? {} })}
              isSaving={quantSettings.save.isPending}
              isLoggedIn={isLoggedIn}
              saveMsg={quantSettings.saveMsg}
            />
          )}

          <Tabs
            fill={false}
            ariaLabel="시장 선택"
            className="w-fit"
            tabs={MARKET_TABS}
            active={marketTab}
            onChange={(id) => { setMarketTab(id); setFolderTab("all"); }}
          />

          <UnderlineTabs
            ariaLabel="목록 선택"
            active={portfolioTab !== null ? `pf-${portfolioTab}` : String(folderTab)}
            onChange={(id) => {
              if (id.startsWith("pf-")) { setPortfolioTab(Number(id.slice(3))); setFolderTab("all"); }
              else { setFolderTab(id === "all" || id === "recent" ? id : Number(id)); setPortfolioTab(null); }
            }}
            tabs={[
              { id: "all", label: "전체", count: countIn(null) },
              { id: "recent", label: "최근조회", icon: Clock,
                count: recentlyViewed.filter((r) => marketTab === "전체" || r.market === marketTab).length },
              ...(folders ?? []).map((f: any) => ({ id: String(f.id), label: f.name, count: countIn(f.id) })),
              ...pfList.map((pf: any) => ({ id: `pf-${pf.id}`, label: pf.name, icon: Wallet })),
            ]}
          />

          {truncated && (
            <div className="flex items-start gap-2 rounded-xl border border-accent-amber/30 bg-accent-amber/10 px-3 py-2.5">
              <AlertCircle size={14} className="text-accent-amber flex-shrink-0 mt-0.5" />
              <p className="text-xs text-accent-amber break-keep leading-relaxed">
                이 목록은 {allCompareItems.length}개인데 <b>한 번에 30개까지</b> 비교할 수 있어
                앞쪽 30개만 계산했습니다. 폴더나 시장 탭으로 나눠 보면 전부 확인할 수 있어요.
              </p>
            </div>
          )}

          <Card className="p-0 overflow-hidden">
            {itemsLoading || scoreLoading ? (
              <div className="p-3">
                <RowSkeleton rows={5} />
              </div>
            ) : compareItems.length === 0 ? (
              /* 안내만 하고 끝내면 "그래서 어디로 가라고?" 가 된다.
                 각 경우마다 채우러 갈 곳으로 바로 보낸다 */
              portfolioTab !== null ? (
                <빈화면
                  icon={Wallet}
                  title="이 포트폴리오에 종목이 없어요"
                  hint="보유한 종목을 넣으면 여기서 점수를 나란히 비교할 수 있어요"
                  action={{ label: "내 자산에 종목 넣기", onClick: () => navigate("/portfolio") }}
                />
              ) : folderTab === "recent" ? (
                <빈화면
                  icon={Clock}
                  title="최근 조회한 종목이 없어요"
                  hint="종목을 한 번 들여다보면 여기 쌓여서, 바로 비교해 볼 수 있어요"
                  action={{ label: "종목 둘러보기", onClick: () => navigate("/") }}
                />
              ) : (
                <빈화면
                  icon={Award}
                  title="비교할 관심종목이 없어요"
                  hint="관심 있는 종목을 담아두면 가치·품질·모멘텀 점수를 한눈에 견줄 수 있어요"
                  action={{ label: "관심종목 담으러 가기", onClick: () => navigate("/watchlist") }}
                />
              )
            ) : isError ? (
              <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
                <AlertCircle size={32} className="text-accent-red/60" />
                <p className="text-text-secondary text-sm">퀀트 점수를 불러오지 못했어요. 잠시 후 다시 시도해주세요</p>
              </div>
            ) : (
              <div key={`${marketTab}-${folderTab}`} className="overflow-x-auto tab-fade">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-bg-secondary border-b border-border z-10">
                    <tr className="text-text-muted text-[11px]">
                      <th className="text-left px-3 py-3 sticky left-0 bg-bg-secondary z-20">종목</th>
                      <th className="text-right px-3 py-3 whitespace-nowrap">현재가</th>
                      <th className="text-right px-3 py-3"
                          aria-sort={sortKey === "total" ? (sortDir === "desc" ? "descending" : "ascending") : "none"}>
                        <button
                          onClick={() => toggleSort("total")}
                          className={`flex items-center justify-end gap-1 ml-auto whitespace-nowrap ${sortKey === "total" ? "text-accent-blue" : "hover:text-text-primary"}`}
                        >
                          종합점수
                          {sortKey === "total" && (sortDir === "desc" ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
                        </button>
                      </th>
                      <th className="text-right px-3 py-3 whitespace-nowrap">
                        <div ref={gradeHelpRef} className="flex items-center justify-end gap-1.5 relative whitespace-nowrap">
                          등급
                          <button
                            onClick={() => setShowGradeHelp((s) => !s)}
                            aria-label="등급 기준 보기"
                            aria-expanded={showGradeHelp}
                            className="flex items-center justify-center w-4 h-4 rounded-full border border-border text-text-muted hover:text-text-primary hover:border-accent-blue/40"
                          >
                            ?
                          </button>
                          {showGradeHelp && (
                            <div className="absolute left-0 top-6 z-50 w-48 rounded-xl border border-border bg-bg-elevated shadow-lg p-3 flex flex-col gap-1.5 text-left">
                              <span className="text-[11px] font-semibold text-text-secondary pb-1">등급 기준</span>
                              {GRADE_BANDS.map((b) => (
                                <div key={b.grade} className="flex items-center justify-between text-xs">
                                  <span className={`font-bold ${gradeColor(b.grade)}`}>{b.grade}</span>
                                  <span className="text-text-secondary font-mono">{b.range}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </th>
                      {(Object.keys(FACTOR_LABEL_KO) as QuantFactorKey[]).map((k) => (
                        <th key={k} className="text-right px-3 py-3 whitespace-nowrap"
                            aria-sort={sortKey === k ? (sortDir === "desc" ? "descending" : "ascending") : "none"}>
                          {/* 물음표는 정렬 버튼 밖에 둔다. 안에 넣으면 버튼이 겹쳐
                              설명을 보려다 정렬이 바뀐다 */}
                          <span className="flex items-center justify-end gap-1 ml-auto whitespace-nowrap">
                            <button
                              onClick={() => toggleSort(k)}
                              className={`flex items-center gap-1 whitespace-nowrap ${sortKey === k ? "text-accent-blue" : "hover:text-text-primary"}`}
                            >
                              {FACTOR_LABEL_KO[k]}
                              {sortKey === k && (sortDir === "desc" ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
                            </button>
                            <용어힌트 이름={FACTOR_LABEL_KO[k]} 글자숨김 />
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const key = `${row.market}:${row.symbol}`;
                      const name = nameMap.get(key) ?? row.symbol;
                      const factorScore = (fkey: QuantFactorKey) =>
                        row.factors.find((f) => f.key === fkey)?.score ?? null;
                      return (
                        <tr
                          key={key}
                          tabIndex={0}
                          onClick={() => navigate(`/stocks/${row.market}/${row.symbol}`)}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/stocks/${row.market}/${row.symbol}`); } }}
                          className="border-b border-border/30 hover:bg-bg-hover/50 transition-colors cursor-pointer focus:outline-none focus:bg-bg-hover/50"
                        >
                          <td className="px-3 py-2.5 sticky left-0 bg-bg-card z-10">
                            <div className="flex flex-col">
                              <div className="flex items-center gap-1.5">
                                <span className="font-semibold text-text-primary truncate max-w-[160px]">{name}</span>
                                <Badge variant={row.market === "KR" ? "blue" : row.market === "ETF" ? "purple" : "green"}>
                                  {row.market}
                                </Badge>
                              </div>
                              <span className="text-text-muted text-[11px] font-mono">{row.symbol}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-right whitespace-nowrap">
                            {(() => {
                              const pr = lookupPrice(priceMap, row.symbol);
                              if (pr?.price == null) return <span className="text-text-dim text-xs">—</span>;
                              return (
                                <div className="flex flex-col items-end">
                                  <span className="font-mono text-xs text-text-primary">
                                    {row.market === "KR" ? fmtKRWFull(Number(pr.price)) : fmtUSDFull(Number(pr.price))}
                                  </span>
                                  {pr.change_rate != null && (
                                    <ChangeBadge value={Number(pr.change_rate)} className="text-[10px]"
                                      금액={pr.change != null ? Number(pr.change) : null}
                                      통화={row.market === "KR" ? "KRW" : "USD"} />
                                  )}
                                </div>
                              );
                            })()}
                          </td>
                          <td className={`px-3 py-2.5 text-right font-mono font-bold whitespace-nowrap ${scoreColor(row.total_score)}`}>
                            {row.total_score != null ? row.total_score.toFixed(1) : "—"}
                          </td>
                          <td className={`px-3 py-2.5 text-right font-mono font-bold whitespace-nowrap ${gradeColor(row.grade)}`}>
                            {row.grade ?? "—"}
                          </td>
                          {(Object.keys(FACTOR_LABEL_KO) as QuantFactorKey[]).map((k) => {
                            const s = factorScore(k);
                            return (
                              <td key={k} className={`px-3 py-2.5 text-right font-mono text-xs whitespace-nowrap ${scoreColor(s)}`}>
                                {s != null ? s.toFixed(1) : "—"}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {isFetching && !scoreLoading && (
              <div className="px-3 py-2 text-[11px] text-text-muted border-t border-border/30">갱신 중...</div>
            )}
          </Card>
          {!truncated && (
            <p className="text-xs text-text-muted leading-relaxed">
              관심종목 폴더로 나눠서 보면 더 빠르게 비교할 수 있어요.
            </p>
          )}
        </>
      )}
    </div>
  );
}
