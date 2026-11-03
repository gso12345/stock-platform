/**
 * 피드 글쓰기 화면.
 *
 * 예전에는 피드 목록 맨 위에 접힌 패널이 얹혀 있었다. 한 줄짜리 의견은
 * 그걸로 충분했지만, 종목을 고르고 태그를 붙이고 사진과 투표까지 넣으려면
 * 목록 위에서 패널이 계속 자라면서 아래 글들을 밀어냈다. 게다가 태그칸은
 * # 버튼 뒤에 숨어 있어서 있는 줄도 모르는 사람이 많았다.
 *
 * 그래서 화면을 따로 냈다. 여기서는 종목검색·제목·내용·태그가 처음부터
 * 다 보이고, 사진과 투표는 도구줄에서 켠다.
 *
 * 앱의 글쓰기 화면처럼 다시 짰다(사용자가 고른 12번) — 상자 안 서식(종목·제목·내용·태그 칸이 위에서부터
 * 늘어선 것) 대신, 아바타 옆에 종목 칩과 큰 입력칸이 먼저 오고, 사진·투표·태그 단추는 화면 아래(자판 위)에
 * 붙는다. 쓰는 동안 아래 탭은 숨긴다(Layout).
 */
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Hash, BarChart2, X, Image as ImageIcon, Send, ArrowLeft, Loader2, FileText, Search} from "lucide-react";
import { communityApi, portfolioApi, watchlistApi, dashboardApi } from "@/api/stocks";
import { usePricesStream } from "@/hooks/useWebSocket";
import { useAuthStore } from "@/store/authStore";
import api from "@/api/client";
import { mergeEffectivePrices, indexPricesBySymbol, lookupPrice } from "@/utils/prices";
import PortfolioChart, { type PfPortfolioForChart } from "@/components/portfolio/PortfolioChart";
import { compressImage } from "@/utils/image";
import { useMyProfile } from "@/hooks/useMyProfile";
import Avatar from "@/components/community/Avatar";
import { BODY_MAX, TITLE_MAX, POLL_OPTION_MAX } from "@/constants/community";
import { use확인 } from "@/hooks/useDialogs";
import { Button, 고른칩, cn } from "@/components/ui";
import { use임시저장, use임시본알림, 임시저장지우기 } from "@/hooks/useDraft";
import { use보유목록 } from "@/hooks/usePortfolioItems";
import { 시세열쇠, 시세대상 } from "@/constants/portfolioQuery";
import { use넓은화면 } from "@/hooks/useWideScreen";
import { use자판높이 } from "@/hooks/useSheet";

/** 브라우저에 담아 두는 자리 이름 */
const 임시본열쇠 = "feed-write-draft";

type 태그 = { symbol: string; market: string; name?: string };

export default function FeedWrite() {
  const { 묻기, 화면: 확인화면 } = use확인();
  const { isLoggedIn } = useAuthStore();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [mode, setMode] = useState<"stock" | "portfolio">("stock");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);
  /* 도구줄 자리 — 휴대폰은 화면 아래(자판이 올라오면 자판 바로 위), PC 는 글 끝에 붙어 따라 내려온다 */
  const 넓음 = use넓은화면();
  const 자판 = use자판높이(!넓음);

  // stock mode
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedStock, setSelectedStock] = useState<{ symbol: string; market: string; name: string } | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  // portfolio mode
  const [selectedPfId, setSelectedPfId] = useState<number | null>(null);

  // common
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // 사진/투표/태그
  const [image, setImage] = useState("");
  const [showPoll, setShowPoll] = useState(false);
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptions, setPollOptions] = useState(["", ""]);
  const [tagQuery, setTagQuery] = useState("");
  const [tagResults, setTagResults] = useState<any[]>([]);
  const [customTags, setCustomTags] = useState<태그[]>([]);
  const tagSearchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ── 쓰던 글 지키기 ──────────────────────────────────
     저장이 실패해도 내용은 남고(화면을 안 떠난다), 뒤로 갈 때도 한 번
     물어본다. 그 사이에 구멍이 있었다 — 새로고침, 탭 닫기, 휴대폰이
     배경에서 앱을 정리하는 경우다.

     긴 글을 쓰다가 전화가 오거나 다른 앱을 잠깐 보고 오면 브라우저가
     화면을 버리는 일이 흔하다. 돌아오면 빈 칸이고 되돌릴 방법이 없다.

     이미지는 담지 않는다 — 압축해도 수백 KB 라 localStorage 한도(보통
     5MB)를 금방 먹고, 그러면 정작 글자가 안 담긴다. */
  const 쓴것 = useMemo(() => ({
    mode, title, body, showPoll, pollQuestion, pollOptions, customTags,
    selectedStock, selectedPfId,
  }), [mode, title, body, showPoll, pollQuestion, pollOptions, customTags,
       selectedStock, selectedPfId]);
  const 담을만한가 = !!(title.trim() || body.trim() || customTags.length > 0
                       || pollOptions.some((o) => o.trim()));
  use임시저장(임시본열쇠, 쓴것, 담을만한가);
  const { 임시본, 닫기: 임시본닫기, 버리기: 임시본버리기 } = use임시본알림<typeof 쓴것>(임시본열쇠);

  const 임시본이어쓰기 = () => {
    if (!임시본) return;
    setMode(임시본.mode);
    setTitle(임시본.title ?? "");
    setBody(임시본.body ?? "");
    setShowPoll(!!임시본.showPoll);
    setPollQuestion(임시본.pollQuestion ?? "");
    setPollOptions(임시본.pollOptions ?? ["", ""]);
    setCustomTags(임시본.customTags ?? []);
    setSelectedStock(임시본.selectedStock ?? null);
    setSelectedPfId(임시본.selectedPfId ?? null);
    임시본닫기();
  };

  /* 로그인 없이 들어오면 쓸 수 있는 것이 하나도 없다. 빈 폼을 보여주고
     제출에서 막는 것보다 바로 보내는 편이 낫다 */
  useEffect(() => {
    if (!isLoggedIn) navigate("/login", { replace: true });
  }, [isLoggedIn, navigate]);

  const 포트폴리오모드 = mode === "portfolio";

  // 내자산과 동일한 queryKey → 캐시 공유
  const { data: portfoliosData = [], isLoading: loadingPf } = useQuery({
    queryKey: ["portfolios"],
    queryFn: portfolioApi.getPortfolios,
    enabled: isLoggedIn && 포트폴리오모드,
    staleTime: 300_000,
  });

  const { data: allItems = [] } = use보유목록(isLoggedIn && 포트폴리오모드);

  const { data: fxData } = useQuery({
    queryKey: ["exchange-rate"],
    queryFn: () => dashboardApi.getExchangeRate(),
    staleTime: 300_000,
    /* 서버가 이 값을 300초 담아 둔다. 60초마다 물으면 다섯 번 중
       네 번은 같은 답을 받으려고 왕복하는 셈이다 — CPU 0.15개에서는
       그 왕복 자체가 비용이다 */
    refetchInterval: 300_000,
    enabled: isLoggedIn && 포트폴리오모드,
  });
  const liveExchangeRate: number = (fxData as any)?.value ?? 0;

  // 선택된 포트폴리오 아이템 (클라이언트 필터링)
  const pfItems = useMemo(() => {
    if (!포트폴리오모드) return [];
    if (selectedPfId === null) return allItems as any[];
    return (allItems as any[]).filter((i: any) => i.portfolioId === selectedPfId);
  }, [allItems, selectedPfId, 포트폴리오모드]);

  // 내자산과 동일: 전체 아이템 기준 가격 조회 → 캐시 공유
  /* 시세 대상을 고르는 규칙과 조회 이름표는 한 군데서만 만든다
     (constants/portfolioQuery). 손으로 적으면 반드시 어긋나고, 어긋나면
     보유 목록에 딸려 온 시세가 **다른 서랍에 들어가** 그냥 버려진다 —
     화면에는 아무 표시가 안 나고 그냥 왕복이 한 번 더 늘 뿐이다. */
  const priceableItemsForFeed = useMemo(() => 시세대상(allItems as any[]), [allItems]);

  const { data: allBatchPrices } = useQuery({
    queryKey: 시세열쇠(allItems as any[]),
    queryFn: () => watchlistApi.getPrices(
      priceableItemsForFeed.map((i: any) => i.symbol),
      priceableItemsForFeed.map((i: any) => i.market)
    ),
    enabled: isLoggedIn && 포트폴리오모드 && priceableItemsForFeed.length > 0,
    staleTime: 120_000,
  });

  // Portfolio.tsx와 동일: WebSocket 실시간 가격 (HTTP 배치 보완)
  const [wsFeedPrices, setWsFeedPrices] = useState<any[] | null>(null);
  const feedPriceSymbols = useMemo(() => priceableItemsForFeed.map((i: any) => i.symbol), [priceableItemsForFeed]);
  const feedPriceMarkets = useMemo(() => priceableItemsForFeed.map((i: any) => i.market), [priceableItemsForFeed]);
  usePricesStream(feedPriceSymbols, feedPriceMarkets, useCallback((prices: any[]) => {
    setWsFeedPrices(prices);
  }, []), 30);
  const feedEffectivePrices = useMemo(
    () => mergeEffectivePrices(wsFeedPrices, allBatchPrices),
    [wsFeedPrices, allBatchPrices],
  );

  // 내자산과 동일: item.id 기준 priceMap (배열 순서가 아닌 심볼로 매칭)
  const feedPriceBySymbol = useMemo(() => indexPricesBySymbol(feedEffectivePrices), [feedEffectivePrices]);
  const feedPriceMap = useMemo(() => {
    const map: Record<number, number> = {};
    priceableItemsForFeed.forEach((item: any) => {
      const d = lookupPrice(feedPriceBySymbol, item.symbol);
      if (d?.price != null) map[item.id] = d.price;
    });
    return map;
  }, [priceableItemsForFeed, feedPriceBySymbol]);

  useEffect(() => {
    if (!searchQ.trim()) { setSearchResults([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const { data } = await api.get<{ results: any[] }>("/search", { params: { q: searchQ } });
        setSearchResults((data.results || []).slice(0, 6));
      } catch { setSearchResults([]); }
      finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [searchQ]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchResults([]);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const autoResize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 480)}px`;
  };

  const handleImagePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setImage(await compressImage(file));
      setError("");
    } catch (err) {
      // 예전에는 조용히 무시해서, 잘못된 파일을 골라도 아무 반응이 없었다
      setError(err instanceof Error ? err.message : "이미지를 첨부할 수 없습니다");
    }
    e.target.value = "";
  };

  const handleTagSearch = (q: string) => {
    setTagQuery(q);
    if (tagSearchTimeoutRef.current) clearTimeout(tagSearchTimeoutRef.current);
    if (!q.trim()) { setTagResults([]); return; }
    tagSearchTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await api.get("/search", { params: { q: q.trim(), limit: 10 } });
        setTagResults(res.data?.results ?? res.data ?? []);
      } catch { setTagResults([]); }
    }, 300);
  };

  const addCustomTag = (tag: 태그) => {
    if (customTags.length >= 5) return;
    if (!customTags.find((t) => t.symbol === tag.symbol && t.market === tag.market)) {
      setCustomTags((prev) => [...prev, { symbol: tag.symbol, market: tag.market, name: tag.name }]);
    }
    setTagQuery("");
    setTagResults([]);
  };

  // 내자산과 동일한 방식으로 차트 데이터 구성
  const pfForChart: PfPortfolioForChart[] = pfItems.length > 0 ? [{
    id: selectedPfId ?? 0,
    name: selectedPfId === null ? "전체 포트폴리오" : ((portfoliosData as any[]).find((p: any) => p.id === selectedPfId)?.name ?? "포트폴리오"),
    items: pfItems.map((item: any) => {
      const currentPrice = feedPriceMap[item.id];
      const isUSDStock = item.market === "US" || item.market === "ETF";
      const fx = isUSDStock ? liveExchangeRate : 1;
      const currentValueKRW = currentPrice != null && currentPrice > 0 && fx > 0
        ? currentPrice * fx * item.shares
        : undefined;
      return {
        symbol: item.symbol,
        market: item.market,
        name: item.name || item.symbol,
        avgPrice: item.avgPrice ?? 0,
        shares: item.shares,
        currency: item.currency,
        inputExchangeRate: item.inputExchangeRate ?? null,
        currentValueKRW,
      };
    }),
  }] : [];

  const { displayName: myName, avatarColor: myAvatarColor, avatarUrl: myAvatarUrl } = useMyProfile();

  const handleSubmit = async () => {
    if (submitting) return;
    setError("");

    let market: string, symbol: string, allTags: { symbol: string; market: string }[], bodyToSubmit: string;

    if (mode === "stock") {
      if (!selectedStock) { setError("종목을 선택해주세요"); return; }
      const bodyTrim = body.trim();
      if (!bodyTrim) { setError("본문을 입력해주세요"); return; }
      market = selectedStock.market;
      symbol = selectedStock.symbol;
      allTags = customTags;
      bodyToSubmit = bodyTrim;
    } else {
      if (pfItems.length === 0) { setError("포트폴리오에 종목이 없습니다"); return; }
      // 글이 걸릴 종목은 실제 종목코드여야 한다. 현금 항목은 코드가 "현금"이라
      // 첫 항목이 현금이면 주소 자체가 거부돼 공유가 통째로 실패했다.
      const anchor = pfItems.find((i: any) => i.assetClass !== "현금");
      if (!anchor) { setError("현금만 있는 포트폴리오는 공유할 수 없습니다"); return; }
      market = anchor.market;
      symbol = anchor.symbol;
      allTags = [
        ...pfItems.map((i: any) => ({ symbol: i.symbol, market: i.market })),
        ...customTags.filter((ct) => !pfItems.find((i: any) => i.symbol === ct.symbol)),
      ];
      bodyToSubmit = body.trim() || "📊 포트폴리오 공유";
    }

    const pollData = showPoll && pollQuestion.trim() && pollOptions.filter((o) => o.trim()).length >= 2
      ? { question: pollQuestion.trim(), options: pollOptions.filter((o) => o.trim()) }
      : null;

    setSubmitting(true);
    try {
      const portfolioSnapshot = 포트폴리오모드
        ? pfItems.map((i: any) => {
            const currentPrice = feedPriceMap[i.id];
            return {
              symbol: i.symbol,
              market: i.market,
              name: i.name || i.symbol,
              shares: i.shares,
              avg_price: i.avgPrice ?? i.avg_price ?? 0,
              currency: i.currency ?? "KRW",
              input_exchange_rate: i.inputExchangeRate ?? null,
              current_price: currentPrice ?? null,
              asset_class: i.assetClass ?? null,
            };
          })
        : null;
      await communityApi.createPost(market, symbol, title.trim(), bodyToSubmit, image, pollData, allTags, portfolioSnapshot);
      qc.invalidateQueries({ queryKey: ["feed"] });
      임시저장지우기(임시본열쇠);           // 올렸으니 더 들고 있을 이유가 없다
      navigate("/feed", { replace: true });
    } catch {
      setError("게시글 작성에 실패했습니다. 다시 시도해주세요.");
      setSubmitting(false);
    }
  };

  /* 뒤로 갈 때 쓰던 글이 있으면 한 번 물어본다. 실수로 뒤로 눌러
     다 날리는 것이 글쓰기 화면에서 제일 아픈 실수다 */
  const 나가기 = () => {
    const 쓴것 = title.trim() || body.trim() || image || customTags.length > 0;
    if (!쓴것) { navigate("/feed"); return; }
    묻기({
      title: "쓰던 글을 버릴까요?",
      message: "작성 중인 내용이 사라집니다. 되돌릴 수 없습니다.",
      대상: (title.trim() || body.trim() || "(첨부만 있음)").slice(0, 40),
      확인글: "나가기",
      onConfirm: () => { 임시저장지우기(임시본열쇠); navigate("/feed"); },
    });
  };

  const 쓰기바꾸기 = (m: "stock" | "portfolio") => {
    if (m === mode) return;
    setMode(m); setBody(""); setSelectedStock(null);
  };

  const canSubmit = mode === "stock" ? !!(selectedStock && body.trim()) : pfItems.length > 0;
  const 도구단추 = (켜짐: boolean) => cn(
    "flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold transition-colors",
    켜짐 ? "text-accent-blue bg-accent-blue/10" : "text-text-muted hover:text-text-primary hover:bg-bg-elevated",
  );

  return (
    <>
    <div className="max-w-2xl mx-auto flex flex-col">
      {/* 머리 — 나가기 / 글쓰기 / 등록. 스크롤해도 위에 붙어 있다 */}
      <div className="sticky top-0 z-20 -mx-3 md:mx-0 px-3 md:px-0 h-12 flex items-center gap-2 bg-bg-primary/95 backdrop-blur-md border-b border-border">
        <button
          onClick={나가기}
          aria-label="뒤로"
          className="p-1.5 -ml-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors"
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-base font-bold text-text-primary flex-1">글쓰기</h1>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit || submitting}
          className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-accent-blue text-white text-sm font-semibold hover:bg-accent-blue/90 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          {submitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          {submitting ? "등록 중..." : "등록"}
        </button>
      </div>

      {/* 쓰다 만 글이 있으면 한 번 물어본다.
          곧바로 채워 넣지 않는 이유 — 새 글을 쓰려고 들어왔는데 예전 글이
          들어가 있으면 그것대로 당황스럽다. 고르게 한다. */}
      {임시본 && (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-accent-blue/40 bg-accent-blue/10 px-3 py-2.5">
          <FileText size={14} className="text-accent-blue flex-shrink-0" />
          <p className="flex-1 text-xs text-text-secondary break-keep">
            쓰다 만 글이 있습니다
            {임시본.title?.trim() || 임시본.body?.trim()
              ? ` — "${(임시본.title?.trim() || 임시본.body?.trim() || "").slice(0, 24)}…"`
              : ""}
          </p>
          <Button size="sm" onClick={임시본이어쓰기}>이어 쓰기</Button>
          <Button size="sm" variant="ghost" onClick={임시본버리기}>버리기</Button>
        </div>
      )}

      {/* 무엇을 쓸까 */}
      <div className="flex gap-1.5 pt-3">
        <고른칩 고름={mode === "stock"} onClick={() => 쓰기바꾸기("stock")} 작게 className="flex items-center gap-1">
          <Hash size={11} />종목 의견
        </고른칩>
        <고른칩 고름={포트폴리오모드} onClick={() => 쓰기바꾸기("portfolio")} 작게 className="flex items-center gap-1">
          <BarChart2 size={11} />포트폴리오 공유
        </고른칩>
      </div>

      {/* 아바타 옆에 — 종목, 제목, 큰 내용칸 */}
      <div className="flex gap-3 pt-4">
        <div className="shrink-0">
          <Avatar username={myName} colorIndex={myAvatarColor} avatarUrl={myAvatarUrl} size="lg" />
        </div>
        <div className="flex-1 min-w-0 flex flex-col gap-2.5">
          <span className="text-sm font-semibold text-text-primary leading-10 -mb-1.5">{myName}</span>

          {/* 종목 — 고르면 칩이 된다 */}
          {mode === "stock" && (
            <div className="relative" ref={searchRef}>
              {selectedStock ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full bg-accent-blue/15 text-sm font-semibold text-accent-blue">
                    {selectedStock.name || selectedStock.symbol}
                    <span className="text-2xs font-normal text-accent-blue/70">{selectedStock.market} {selectedStock.symbol}</span>
                    <button onClick={() => setSelectedStock(null)} aria-label="종목 지우기"
                      className="p-0.5 rounded-full hover:bg-accent-blue/20 transition-colors">
                      <X size={13} />
                    </button>
                  </span>
                  <span className="text-xs text-text-dim">에 대한 의견</span>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-dim pointer-events-none" />
                    <input
                      autoFocus
                      value={searchQ}
                      onChange={(e) => setSearchQ(e.target.value)}
                      aria-label="종목"
                      placeholder="종목 검색 (예: 삼성전자, AAPL)"
                      className="w-full pl-8 pr-3 py-2 bg-bg-elevated border border-border rounded-full text-sm text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-blue/50"
                    />
                  </div>
                  {(searchResults.length > 0 || searching) && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-bg-card border border-border rounded-xl shadow-float z-20 overflow-hidden">
                      {searching && searchResults.length === 0 && <div className="px-3 py-2 text-xs text-text-dim">검색 중...</div>}
                      {searchResults.map((r: any, i: number) => (
                        <button
                          key={i}
                          onClick={() => {
                            setSelectedStock({ symbol: r.symbol, market: r.market, name: r.name || r.symbol });
                            setSearchQ("");
                            setSearchResults([]);
                            setCustomTags(prev => prev.find(t => t.symbol === r.symbol && t.market === r.market) ? prev : [{ symbol: r.symbol, market: r.market, name: r.name }, ...prev]);
                            textareaRef.current?.focus();
                          }}
                          className="w-full text-left px-3 py-2.5 hover:bg-bg-elevated transition-colors flex items-center gap-2"
                        >
                          <span className="text-2xs font-bold text-text-dim w-8">{r.market}</span>
                          <span className="text-sm font-semibold text-text-primary">{r.symbol}</span>
                          <span className="text-xs text-text-dim truncate flex-1">{r.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* 포트폴리오 선택 */}
          {포트폴리오모드 && (
            loadingPf ? (
              <p className="text-xs text-text-dim">포트폴리오 불러오는 중</p>
            ) : (portfoliosData as any[]).length === 0 ? (
              <p className="text-xs text-text-dim">등록된 포트폴리오가 없습니다</p>
            ) : (
              <select
                aria-label="포트폴리오"
                value={selectedPfId ?? ""}
                onChange={(e) => { const val = e.target.value; setSelectedPfId(val === "" ? null : Number(val)); }}
                className="self-start px-3 py-2 bg-bg-elevated border border-border rounded-full text-sm text-text-primary focus:outline-none focus:border-accent-blue/50"
              >
                <option value="">전체 포트폴리오</option>
                {(portfoliosData as any[]).map((pf: any) => (
                  <option key={pf.id} value={pf.id}>{pf.name} ({pf.count}개 종목)</option>
                ))}
              </select>
            )
          )}

          {/* 제목 — 선택. 칸 테두리 없이 글자만 */}
          <label htmlFor="글제목" className="sr-only">제목 (선택)</label>
          <input
            id="글제목"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="제목 (선택)"
            maxLength={TITLE_MAX}
            className="w-full bg-transparent text-base font-semibold text-text-primary placeholder:text-text-dim focus:outline-none"
          />

          {/* 내용 — 크게 */}
          <label htmlFor="글내용" className="sr-only">내용</label>
          <textarea
            id="글내용"
            ref={textareaRef}
            value={body}
            onChange={(e) => { setBody(e.target.value); autoResize(); }}
            placeholder={포트폴리오모드 ? "포트폴리오를 소개해 주세요 (선택)" : "이 종목, 어떻게 보세요?"}
            maxLength={BODY_MAX}
            className="w-full bg-transparent text-md text-text-primary placeholder:text-text-dim resize-none focus:outline-none leading-relaxed"
            style={{ minHeight: "9rem" }}
          />

          {/* 포트폴리오 차트 미리보기 */}
          {포트폴리오모드 && pfForChart.length > 0 && (
            <PortfolioChart portfolios={pfForChart} exchangeRate={liveExchangeRate} />
          )}

          {/* 자동 태그 미리보기 */}
          {포트폴리오모드 && pfItems.length > 0 && (
            <div className="flex flex-wrap gap-1 items-center">
              <span className="text-2xs text-text-dim shrink-0">자동 태그:</span>
              {pfItems.slice(0, 8).map((i: any) => (
                <span key={i.symbol} className="text-2xs px-1.5 py-0.5 rounded bg-accent-blue/10 text-accent-blue font-semibold">
                  #{i.symbol}
                </span>
              ))}
              {pfItems.length > 8 && (
                <span className="text-2xs text-text-dim">외 {pfItems.length - 8}개</span>
              )}
            </div>
          )}

          {/* 사진 미리보기 */}
          {image && (
            <div className="relative w-full">
              <img src={image} alt="미리보기" className="w-full max-h-72 object-cover rounded-xl border border-border/60" />
              <button onClick={() => setImage("")} aria-label="사진 빼기" className="absolute top-1.5 right-1.5 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors">
                <X size={13} />
              </button>
            </div>
          )}

          {/* 투표 */}
          {showPoll && (
            <div className="bg-bg-elevated rounded-xl p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-text-primary">투표</span>
                <button onClick={() => setShowPoll(false)} aria-label="투표 빼기" className="text-text-dim hover:text-accent-red transition-colors"><X size={13} /></button>
              </div>
              <input
                value={pollQuestion}
                onChange={(e) => setPollQuestion(e.target.value)}
                placeholder="투표 질문을 입력하세요"
                maxLength={TITLE_MAX}
                className="w-full px-2.5 py-1.5 bg-bg-card border border-border rounded-lg text-xs text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-blue/50"
              />
              {pollOptions.map((opt, i) => (
                <div key={i} className="flex gap-1.5">
                  <input
                    value={opt}
                    onChange={(e) => { const next = [...pollOptions]; next[i] = e.target.value; setPollOptions(next); }}
                    placeholder={`선택지 ${i + 1}`}
                    maxLength={POLL_OPTION_MAX}
                    className="flex-1 px-2.5 py-1.5 bg-bg-card border border-border rounded-lg text-xs text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-blue/50"
                  />
                  {pollOptions.length > 2 && (
                    <button onClick={() => setPollOptions((prev) => prev.filter((_, j) => j !== i))} aria-label={`선택지 ${i + 1} 빼기`} className="text-text-dim hover:text-accent-red transition-colors">
                      <X size={13} />
                    </button>
                  )}
                </div>
              ))}
              {pollOptions.length < 4 && (
                <Button onClick={() => setPollOptions((prev) => [...prev, ""])} variant="link" className="text-xs text-left">+ 옵션 추가</Button>
              )}
            </div>
          )}

          {/* 태그 — 예전에는 # 버튼 뒤에 숨어 있어서 아무도 못 찾았다. 그래서 칸은 늘 보이고, 아래 도구줄의
              '태그' 는 이 칸으로 데려다 준다 */}
          <div className="flex flex-col gap-1.5 pt-1">
            {customTags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {customTags.map((t) => (
                  <span key={`${t.market}:${t.symbol}`} className="flex items-center gap-1 text-xs pl-2 pr-1 py-0.5 rounded-full bg-accent-blue/15 text-accent-blue font-semibold">
                    #{t.market === "KR" && t.name ? t.name : t.symbol}
                    <button onClick={() => setCustomTags((prev) => prev.filter((x) => x.symbol !== t.symbol))} aria-label={`${t.symbol} 태그 빼기`}
                      className="p-0.5 rounded-full hover:bg-accent-blue/20">
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {customTags.length < 5 ? (
              <div className="relative">
                <label htmlFor="태그검색" className="sr-only">태그</label>
                <input
                  id="태그검색"
                  ref={tagInputRef}
                  value={tagQuery}
                  onChange={(e) => handleTagSearch(e.target.value)}
                  placeholder="# 종목 태그 추가 (최대 5개)"
                  className="w-full bg-transparent py-1 text-sm text-text-primary placeholder:text-text-dim focus:outline-none border-b border-dashed border-border focus:border-accent-blue/50"
                />
                {tagResults.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-bg-card border border-border rounded-xl shadow-float max-h-36 overflow-y-auto">
                    {tagResults.map((r: any, idx) => (
                      <button
                        key={idx}
                        onClick={() => addCustomTag({ symbol: r.symbol, market: r.market, name: r.name })}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-bg-elevated transition-colors text-left"
                      >
                        <span className="font-semibold text-text-primary">{r.symbol}</span>
                        <span className="text-text-dim">{r.name || r.market}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-2xs text-text-dim">태그는 5개까지 붙일 수 있습니다</p>
            )}
          </div>

          {error && <p role="alert" className="text-xs text-accent-red">{error}</p>}
        </div>
      </div>

      {/* 휴대폰 — 도구줄(fixed)에 가리지 않게 글 아래를 그만큼 비운다 */}
      {!넓음 && <div aria-hidden className="h-20" />}

      {/* 도구줄 — 아래에 붙는다. 휴대폰은 화면 맨 아래(자판이 올라오면 자판 바로 위), PC 는 글 끝에 */}
      <div
        className={cn("z-30 bg-bg-card/95 backdrop-blur-md border-t border-border",
          넓음 ? "sticky bottom-0 mt-4" : "fixed inset-x-0")}
        style={넓음 ? undefined : { bottom: 자판, paddingBottom: 자판 > 0 ? undefined : "env(safe-area-inset-bottom)" }}>
        <div className="max-w-2xl mx-auto px-3 md:px-1 py-1.5 flex items-center gap-1">
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImagePick} />
          <button onClick={() => fileInputRef.current?.click()} title="사진 첨부" aria-label="사진 첨부" className={도구단추(!!image)}>
            <ImageIcon size={16} />사진
          </button>
          <button onClick={() => setShowPoll((v) => !v)} title="투표 만들기" aria-label="투표 만들기" className={도구단추(showPoll)}>
            <BarChart2 size={16} />투표
          </button>
          <button onClick={() => tagInputRef.current?.focus()} title="종목 태그" className={도구단추(customTags.length > 0)}>
            <Hash size={16} />태그
          </button>
          <span className={cn("ml-auto pr-1 text-2xs num", body.length > BODY_MAX * 0.9 ? "text-accent-red" : "text-text-dim")}>
            {body.length}/{BODY_MAX}
          </span>
        </div>
      </div>
    </div>
    {확인화면}
    </>
  );
}
