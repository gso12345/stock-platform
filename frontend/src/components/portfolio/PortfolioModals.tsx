import { useState, useEffect, useRef } from "react";
import { Modal, INPUT_CLASS, InlineSpinner } from "@/components/ui";
import { Plus, Pencil, Trash2, X, Search, ArrowLeft, Check, AlertTriangle } from "lucide-react";
import { stocksApi } from "@/api/stocks";
import { useStockSearch, type SearchResult } from "@/hooks/useStockSearch";
import type { AssetClass } from "@/utils/assetClass";
import { BuyInfoFields, type BuyInfoValue } from "./BuyInfoFields";
import type { Market, Currency, PortfolioItem, PortfolioMeta } from "@/types/portfolio";
import { ReorderableList } from "@/components/common/ReorderableList";
import ModalFooter from "@/components/ui/ModalFooter";


export const MKTCOLOR: Record<string, string> = {
  KR:  "border-accent-blue/30 text-accent-blue bg-accent-blue/15",
  US:  "border-accent-green/30 text-accent-green bg-accent-green/15",
  ETF: "border-accent-purple/30 text-accent-purple bg-accent-purple/15",
};

/* ── Add/Edit Modal (Step 1: 검색 → Step 2: 매수 정보) ─── */
/** 내 자산에 담을 수 있는 것.
 *
 *  창을 둘로 나눠 뒀던 때는 '현금 추가' 버튼을 못 찾는 일이 있었다.
 *  담는 사람에게는 둘 다 같은 일이라 한 창에서 고르게 한다. */
export type 자산종류 = "종목" | "현금";

export function PortfolioModal({
  item,
  defaultFx,
  onClose,
  onSave,
  isSaving,
  saveError,
}: {
  item?: PortfolioItem;
  defaultFx: number;
  onClose: () => void;
  onSave: (data: Omit<PortfolioItem, "id">) => void;
  isSaving?: boolean;
  saveError?: string | null;
}) {
  /* ── 종목과 현금을 한 창에서 담는다 ──
     예전에는 창이 둘이었다('종목 추가' 와 '현금 추가'). 담으려는 사람
     입장에서는 둘 다 '내 자산에 뭘 넣는' 같은 일인데, 무엇을 넣느냐에
     따라 눌러야 할 버튼이 달랐다 — 현금 버튼을 못 찾아 종목 검색창에
     '현금' 을 쳐 보는 일이 생긴다. 한 창에서 종류만 고르게 한다. */
  const [종류, set종류] = useState<자산종류>(item?.assetClass === "현금" ? "현금" : "종목");
  const 현금인가 = 종류 === "현금";

  const [step, setStep] = useState<1 | 2>(item ? 2 : 1);
  const [selected, setSelected] = useState<{ symbol: string; market: Market; name: string } | null>(
    item && item.assetClass !== "현금"
      ? { symbol: item.symbol, market: item.market, name: item.name }
      : null
  );

  const { query, setQuery, results, searching } = useStockSearch();
  const inputRef    = useRef<HTMLInputElement>(null);
  const sharesRef   = useRef<HTMLInputElement>(null);

  const isForex = (m: Market) => m === "US" || m === "ETF";

  const [form, setForm] = useState<BuyInfoValue>({
    shares:       item ? String(item.shares)   : "",
    // 현금은 '금액' 을 여기에 담는다(수량 1 × 금액)
    avgPrice:     item ? String(item.avgPrice) : "",
    currency:     item?.currency ?? (item?.assetClass === "현금" ? "KRW" : "USD"),
    inputFx:      item?.inputExchangeRate ? String(item.inputExchangeRate) : "",
    purchaseDate: item?.purchaseDate ?? "",
    note:         item?.note ?? "",
    assetClass:   item?.assetClass ?? "",
  });
  const patchForm = (p: Partial<BuyInfoValue>) => setForm((prev) => ({ ...prev, ...p }));
  const { shares, avgPrice, currency, inputFx, purchaseDate, note, assetClass } = form;
  const [priceLoading, setPriceLoading] = useState(false);

  useEffect(() => {
    // 모달이 50ms 안에 닫히면 사라진 요소를 건드리므로 정리해 준다
    const t = setTimeout(() => {
      if (step === 1) inputRef.current?.focus();
      else sharesRef.current?.focus();
    }, 50);
    return () => clearTimeout(t);
  }, [step]);

  // 현재가 자동 입력: 신규 추가 시에만 (수정 모드 아님) 현재가 조회하여 평균매수가 초기값 설정
  useEffect(() => {
    if (!selected || item) return;
    setPriceLoading(true);
    stocksApi.getPrice(selected.market as Market, selected.symbol)
      .then((data) => {
        if (data?.price != null) {
          setForm((prev) => (prev.avgPrice === "" ? { ...prev, avgPrice: String(data.price) } : prev));
        }
      })
      .catch(() => { /* 조회 실패 시 빈칸 유지 */ })
      .finally(() => setPriceLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.symbol, selected?.market]);

  const handleSelect = (r: SearchResult) => {
    const mkt = r.market as Market;
    setSelected({ symbol: r.symbol, market: mkt, name: r.name });
    patchForm({ currency: mkt === "KR" ? "KRW" : "USD" });
    setStep(2);
  };

  /** 종류를 바꾸면 화면도 따라간다.
   *
   *  현금 화면은 step 과 무관하게 그린다 — 고를 종목이 없어 단계가
   *  하나다. 대신 매수 정보 화면 쪽에 `!현금인가` 를 걸어 둔다.
   *  그게 없으면 종목을 고른 뒤 현금으로 바꿨을 때 두 화면이 같이
   *  그려지고 저장 버튼이 둘이 된다.
   *
   *  주식으로 되돌아올 때 고른 종목을 비우는 것은 지금 화면에 드러나지
   *  않는다(검색은 1단계라 고른 종목을 안 본다). 그래도 비운다 —
   *  '검색으로 돌아왔는데 이전 선택이 남아 있는' 상태를 두면, 나중에
   *  단계를 손볼 때 그게 되살아난다. */
  const 종류바꾸기 = (v: 자산종류) => {
    set종류(v);
    if (v === "현금") {
      patchForm({ currency: "KRW" });
      return;
    }
    setSelected(null);
    setStep(1);
  };

  const canSave = 현금인가
    ? Number(avgPrice) > 0
    : Number(shares) > 0 && Number(avgPrice) >= 0 && selected != null;

  const handleSave = () => {
    if (!canSave) return;
    if (현금인가) {
      onSave({
        symbol: "현금",
        market: currency === "USD" ? "US" : "KR",
        name: currency === "USD" ? "달러 현금" : "원화 현금",
        /* 수량 1 × 금액 으로 담는다. 현금에는 '몇 주' 가 없지만,
           보유 종목과 같은 표에 들어가야 합계가 한 규칙으로 난다 */
        shares: 1,
        avgPrice: Number(avgPrice),
        currency,
        note: note || undefined,
        assetClass: "현금",
      });
      return;
    }
    if (!selected) return;
    onSave({
      symbol: selected.symbol,
      market: selected.market,
      name: selected.name,
      shares: Number(shares),
      avgPrice: Number(avgPrice),
      currency,
      inputExchangeRate: currency === "USD" && inputFx ? Number(inputFx) : undefined,
      purchaseDate: purchaseDate || undefined,
      note: note || undefined,
      assetClass: (assetClass || null) as AssetClass | null,
    });
  };


  return (
    <Modal align="start" padTop="pt-16" backdropOpacity={70} maxWidth="max-w-md" onClose={onClose}>

      {/* 헤더 */}
      <div className="flex items-center gap-2 px-4 py-3.5 border-b border-border">
        {step === 2 && !item && !현금인가 && (
          <button aria-label="뒤로" onClick={() => setStep(1)} className="p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors">
            <ArrowLeft size={14} />
          </button>
        )}
        <h3 className="flex-1 text-sm font-bold text-text-primary">
          {item
            ? (현금인가 ? "현금 수정" : "보유 수정")
            : 현금인가 ? "현금 담기"
            : step === 1 ? "자산 추가" : "매수 정보 입력"}
        </h3>
        <button aria-label="닫기" onClick={onClose} className="p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors">
          <X size={14} />
        </button>
      </div>

      {/* 무엇을 담을까 — 새로 담을 때만 고른다.
          수정할 때는 이미 정해져 있고, 바꾸려면 지우고 다시 담는 편이
          맞다(종목을 현금으로 바꾸면 수량·평단이 갈 곳이 없다) */}
      {!item && (
        <div className="flex gap-2 px-4 pt-3">
          {(["종목", "현금"] as 자산종류[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => 종류바꾸기(v)}
              aria-pressed={종류 === v}
              className={`flex-1 py-2 text-xs font-bold rounded-lg border transition-all ${
                종류 === v
                  ? "bg-accent-blue/15 border-accent-blue/30 text-accent-blue"
                  : "border-border text-text-muted hover:text-text-primary"
              }`}
            >
              {v === "종목" ? "주식·ETF" : "현금"}
            </button>
          ))}
        </div>
      )}

      {/* 현금 — 고를 종목이 없으니 검색 단계를 건너뛴다 */}
      {현금인가 && (
        <>
          <div className="px-5 py-4 flex flex-col gap-3.5">
            <div className="flex flex-col gap-1.5">
              <label className="text-2xs font-semibold text-text-muted">통화 *</label>
              <div className="flex gap-2">
                {(["KRW", "USD"] as Currency[]).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => patchForm({ currency: c })}
                    aria-pressed={currency === c}
                    className={`flex-1 py-2 text-xs font-bold rounded-lg border transition-all ${
                      currency === c
                        ? c === "USD"
                          ? "bg-accent-green/15 border-accent-green/30 text-accent-green"
                          : "bg-accent-blue/15 border-accent-blue/30 text-accent-blue"
                        : "border-border text-text-muted hover:text-text-primary"
                    }`}
                  >
                    {c === "USD" ? "달러 ($)" : "원화 (₩)"}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-2xs font-semibold text-text-muted">
                금액 * {currency === "USD" ? "($)" : "(₩)"}
              </label>
              <input
                ref={sharesRef}
                className={INPUT_CLASS}
                type="number" min="0" step="any" placeholder="0"
                value={avgPrice}
                onChange={(e) => patchForm({ avgPrice: e.target.value })}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-2xs font-semibold text-text-muted">
                메모<span className="ml-1 text-text-dim font-normal">({note.length}/100)</span>
              </label>
              <input
                className={INPUT_CLASS}
                maxLength={100}
                placeholder="예: 비상금, 매수 대기"
                value={note}
                onChange={(e) => patchForm({ note: e.target.value })}
              />
            </div>
          </div>

          {saveError && (
            <p className="mx-5 mb-2 text-xs text-accent-red bg-accent-red/15 rounded-lg px-3 py-2">
              오류: {saveError}
            </p>
          )}
          <ModalFooter
            onCancel={onClose} onConfirm={handleSave}
            진행중={isSaving} 확인가능={canSave}
            확인글={isSaving ? "저장 중..." : "저장"}
          />
        </>
      )}

      {/* Step 1: 검색 */}
        {!현금인가 && step === 1 && (
          <>
            <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border">
              <Search size={14} className="text-text-muted flex-shrink-0" />
              <input
                ref={inputRef}
                className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
                placeholder="종목명 또는 코드 검색 (예: AAPL, 005930, 삼성)"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoComplete="off"
              />
              {searching && <InlineSpinner />}
            </div>
            <div className="max-h-72 overflow-y-auto">
              {!query && (
                <div className="px-4 py-8 text-center text-text-muted text-xs">종목명·코드·한글로 검색하세요</div>
              )}
              {query && !searching && results.length === 0 && (
                <div className="px-4 py-8 text-center text-text-muted text-sm">검색 결과 없음</div>
              )}
              {results.map((r) => (
                <button
                  key={r.symbol + r.market}
                  className="w-full flex items-center gap-3 px-4 py-3 border-b border-border/30 hover:bg-bg-hover text-left transition-colors"
                  onClick={() => handleSelect(r)}
                >
                  <span className={`text-2xs px-1.5 py-0.5 rounded border font-bold flex-shrink-0 ${MKTCOLOR[r.market] ?? ""}`}>
                    {r.market}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-mono font-bold text-sm text-text-primary">{r.symbol}</div>
                    <div className="text-xs text-text-muted truncate">{r.name}</div>
                  </div>
                  <span className="text-xs text-text-muted flex-shrink-0">{r.exchange}</span>
                  <Plus size={13} className="text-accent-blue flex-shrink-0" />
                </button>
              ))}
            </div>
          </>
        )}

        {/* Step 2: 매수 정보 */}
        {!현금인가 && step === 2 && selected && (
          <>
            {/* 선택된 종목 */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-bg-elevated/50">
              <span className={`text-2xs px-1.5 py-0.5 rounded border font-bold flex-shrink-0 ${MKTCOLOR[selected.market] ?? ""}`}>
                {selected.market}
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-mono font-bold text-sm text-text-primary">{selected.symbol}</div>
                <div className="text-xs text-text-muted truncate">{selected.name}</div>
              </div>
            </div>

            <div className="px-5 py-4 flex flex-col gap-3.5">
              <BuyInfoFields
                value={form}
                onChange={patchForm}
                isForex={isForex(selected.market)}
                priceLoading={priceLoading}
                defaultFx={defaultFx}
              />
            </div>

            {saveError && (
              <p className="mx-5 mb-2 text-xs text-accent-red bg-accent-red/15 rounded-lg px-3 py-2">
                오류: {saveError}
              </p>
            )}
            <ModalFooter
              onCancel={onClose} onConfirm={handleSave}
              진행중={isSaving} 확인가능={canSave}
              확인글={isSaving ? "저장 중..." : "저장"}
            />
          </>
        )}
    </Modal>
  );
}

/* 현금 추가/수정 창은 없앴다.
   담는 사람에게는 '종목을 넣는 일' 과 '현금을 넣는 일' 이 같은 일인데
   버튼이 둘로 나뉘어 있었다 — 현금 버튼을 못 찾아 종목 검색창에
   '현금' 을 쳐 보는 일이 생긴다. 위 PortfolioModal 이 종류(주식·ETF /
   현금)를 고르는 줄 하나로 둘 다 받는다. */

/* ── 삭제 확인 모달 (종목/포트폴리오 공용 — 디자인 통일) ──────────── */
export function ConfirmDeleteModal({
  title, description, onClose, onConfirm, isDeleting,
}: {
  title: string; description: React.ReactNode; onClose: () => void; onConfirm: () => void; isDeleting?: boolean;
}) {
  return (
    <Modal maxWidth="max-w-sm">
      <div className="p-5 flex flex-col gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full bg-accent-red/10 flex items-center justify-center flex-shrink-0">
            <AlertTriangle size={16} className="text-accent-red" />
          </div>
          <h3 className="text-sm font-bold text-text-primary">{title}</h3>
        </div>
        <p className="text-xs text-text-muted leading-relaxed">{description}</p>
        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            disabled={isDeleting}
            className="flex-1 py-2 rounded-xl border border-border text-text-muted text-sm hover:border-accent-blue hover:text-text-primary transition-all disabled:opacity-40"
          >취소</button>
          <button
            onClick={onConfirm}
            disabled={isDeleting}
            className="flex-1 py-2 rounded-xl bg-accent-red text-white text-sm font-semibold hover:bg-accent-red transition-colors disabled:opacity-40"
          >{isDeleting ? "삭제 중..." : "삭제"}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ── 포트폴리오 선택 탭 ──────────────────────────────────── */
export function PortfolioPill({
  portfolio, active, onSelect,
  draggable, isDragging, isDropTarget,
  onDragStart, onDragOver, onDrop, onTouchStart, onTouchMove, onTouchEnd,
}: {
  portfolio: PortfolioMeta; active: boolean;
  onSelect: () => void;
  draggable?: boolean; isDragging?: boolean; isDropTarget?: boolean;
  onDragStart?: () => void; onDragOver?: (e: React.DragEvent) => void; onDrop?: () => void;
  onTouchStart?: (e: React.TouchEvent) => void; onTouchMove?: (e: React.TouchEvent) => void; onTouchEnd?: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      data-portfolio-id={portfolio.id}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      title={draggable ? "길게 눌러서 드래그하면 포트폴리오 순서를 바꿀 수 있어요" : undefined}
      style={{ touchAction: isDragging ? "none" : "auto" }}
      className={`group flex items-center gap-1.5 px-4 py-3 text-sm font-semibold border-b-2 -mb-px cursor-pointer transition-all flex-shrink-0 whitespace-nowrap ${
        active
          ? "border-accent-blue text-accent-blue bg-accent-blue/5"
          : "border-transparent text-text-muted hover:text-text-primary hover:bg-bg-elevated"
      } ${isDragging ? "opacity-40" : ""} ${isDropTarget ? "ring-1 ring-accent-blue ring-inset" : ""}`}
    >
      <span>{portfolio.name}</span>
      <span className="text-xs opacity-60">({portfolio.count ?? 0})</span>
    </div>
  );
}

/* ── 전체 보기에서 포함/제외할 포트폴리오 선택 (포트폴리오 모아보기) ── */
export function PortfolioFilterDropdown({ portfolios, excludedIds, onToggle }: {
  portfolios: PortfolioMeta[]; excludedIds: Set<number>; onToggle: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const includedCount = portfolios.length - excludedIds.size;

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-text-muted hover:text-accent-blue hover:border-accent-blue/40 text-xs font-semibold transition-colors whitespace-nowrap"
        title="전체 보기에 포함할 포트폴리오 선택"
      >
        <Check size={13} /> 포트폴리오 선택 ({includedCount}/{portfolios.length})
      </button>
      {open && (
        <div className="absolute z-30 top-full mt-1 left-0 w-56 max-h-64 overflow-y-auto bg-bg-card border border-border rounded-xl shadow-modal p-1.5 flex flex-col gap-0.5">
          {portfolios.map((pf) => {
            const checked = !excludedIds.has(pf.id);
            return (
              <label key={pf.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-bg-elevated cursor-pointer text-xs">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(pf.id)}
                  className="accent-accent-blue"
                />
                <span className="flex-1 truncate text-text-primary">{pf.name}</span>
                <span className="text-text-dim">({pf.count})</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function AddPortfolioButton({ onAdd }: { onAdd: (name: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!adding) return;
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [adding]);

  const commit = () => {
    const trimmed = name.trim();
    if (trimmed) onAdd(trimmed);
    setName("");
    setAdding(false);
  };

  if (adding) {
    return (
      <div className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-accent-blue bg-bg-elevated flex-shrink-0">
        <input
          ref={inputRef}
          className="bg-transparent text-xs font-semibold text-text-primary focus:outline-none w-28"
          placeholder="포트폴리오 이름"
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") { setName(""); setAdding(false); }
          }}
        />
        <button aria-label="확인" onClick={commit} className="p-0.5 text-accent-blue hover:text-accent-blue"><Check size={13} /></button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setAdding(true)}
      className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-dashed border-border text-text-muted hover:text-accent-blue hover:border-accent-blue/40 text-xs font-semibold transition-colors flex-shrink-0"
    >
      <Plus size={13} /> 포트폴리오
    </button>
  );
}

/* ── 포트폴리오 관리 팝업 ── */
export function PortfolioManagerModal({
  portfolios, onClose, onRename, onDelete, onReorder, onAdd,
}: {
  portfolios: PortfolioMeta[];
  onClose: () => void;
  onRename: (id: number, name: string) => void;
  onDelete: (pf: PortfolioMeta) => void;
  onReorder: (order: number[]) => void;
  onAdd: (name: string) => void;
}) {
  const [local, setLocal] = useState(portfolios);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [addingNew, setAddingNew] = useState(false);
  const [newName, setNewName] = useState("");
  useEffect(() => { setLocal(portfolios); }, [portfolios]);

  const commitRename = (id: number) => {
    const trimmed = editName.trim();
    if (trimmed) onRename(id, trimmed);
    setEditingId(null);
  };

  const commitAdd = () => {
    const trimmed = newName.trim();
    if (trimmed) { onAdd(trimmed); setNewName(""); setAddingNew(false); }
  };

  const handleReorder = (order: number[]) => {
    setLocal((prev) => order.map((id) => prev.find((p: any) => p.id === id)).filter(Boolean) as any[]);
    onReorder(order);
  };

  return (
    <Modal maxWidth="max-w-sm" onClose={onClose}>
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-border">
        <h3 className="text-sm font-bold text-text-primary">포트폴리오 관리</h3>
        <button aria-label="닫기" onClick={onClose}><X size={14} className="text-text-muted hover:text-text-primary" /></button>
      </div>
      <ReorderableList
        items={local}
        onReorder={handleReorder}
        itemKey="data-portfolio-row"
        className="flex flex-col max-h-96 overflow-y-auto"
      >
        {(pf: any, { handle }) => (
          <div className="flex items-center gap-3 px-4 py-4 border-b border-border/40 select-none">
            {handle}
            {editingId === pf.id ? (
              <input
                draggable={false}
                className="flex-1 bg-bg-primary border border-accent-blue rounded-lg px-3 py-1.5 text-sm text-text-primary focus:outline-none cursor-text select-text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") commitRename(pf.id); if (e.key === "Escape") setEditingId(null); }}
                autoFocus
              />
            ) : (
              <span className="flex-1 text-sm font-medium text-text-primary truncate">{pf.name}</span>
            )}
            <span className="text-xs text-text-muted flex-shrink-0">{pf.count}개</span>
            {editingId === pf.id ? (
              <button aria-label="확인" draggable={false} onClick={(e) => { e.stopPropagation(); commitRename(pf.id); }} className="p-2 text-accent-blue hover:bg-accent-blue/10 rounded-lg"><Check size={14} /></button>
            ) : (
              <button aria-label="수정" draggable={false} onClick={(e) => { e.stopPropagation(); setEditingId(pf.id); setEditName(pf.name); }}
                className="p-2 text-text-muted hover:text-accent-blue hover:bg-accent-blue/10 rounded-lg transition-colors"><Pencil size={14} /></button>
            )}
            <button aria-label="삭제" draggable={false} onClick={(e) => { e.stopPropagation(); onDelete(pf); }}
              className="p-2 text-text-muted hover:text-accent-red hover:bg-accent-red/10 rounded-lg transition-colors"><Trash2 size={14} /></button>
          </div>
        )}
      </ReorderableList>
      <div className="p-4 border-t border-border">
        {addingNew ? (
          <div className="flex items-center gap-2">
            <input
              className="flex-1 bg-bg-primary border border-accent-blue rounded-lg px-3 py-1.5 text-sm text-text-primary focus:outline-none"
              placeholder="포트폴리오 이름"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") commitAdd(); if (e.key === "Escape") { setAddingNew(false); setNewName(""); } }}
              autoFocus
            />
            <button aria-label="확인" onClick={commitAdd} className="p-1.5 text-accent-blue hover:bg-accent-blue/10 rounded-lg"><Check size={14} /></button>
            <button aria-label="새 포트폴리오 만들기 취소" onClick={() => { setAddingNew(false); setNewName(""); }} className="p-1.5 text-text-muted hover:text-text-primary rounded-lg"><X size={14} /></button>
          </div>
        ) : (
          <button onClick={() => setAddingNew(true)}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-dashed border-border text-text-muted hover:text-accent-blue hover:border-accent-blue transition-colors text-sm">
            <Plus size={13} />새 포트폴리오 만들기
          </button>
        )}
      </div>
    </Modal>
  );
}
