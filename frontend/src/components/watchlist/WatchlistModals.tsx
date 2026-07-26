import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Modal, INPUT_CLASS, InlineSpinner, MarketBadge } from "@/components/ui";
import { Plus, Pencil, Trash2, X, Check, Search, Wallet, AlertTriangle } from "lucide-react";
import { stocksApi, portfolioApi } from "@/api/stocks";
import { useStockSearch, type SearchResult } from "@/hooks/useStockSearch";
import { useExchangeRate } from "@/hooks/useExchangeRate";
import { BuyInfoFields, type BuyInfoValue } from "@/components/portfolio/BuyInfoFields";
import { extractErrorMessage } from "@/utils/errors";
import { normalizeSymbol } from "@/utils/prices";


export function AddModal({ folders, defaultFolderId, onClose, onAdd }: {
  folders: any[];
  defaultFolderId: number;
  onClose: () => void;
  onAdd: (req: any) => void;
}) {
  const { query, setQuery, results, searching: loading } = useStockSearch();
  const [folderId, setFolderId] = useState<number>(defaultFolderId);
  const [memo, setMemo]         = useState("");
  const inputRef  = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  const handleSelect = (item: SearchResult) => {
    onAdd({ symbol: item.symbol, market: item.market, name: item.name, folder_id: folderId, memo });
    onClose();
  };

  return (
    <Modal align="start" padTop="pt-20" maxWidth="max-w-md">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-border">
        <h3 className="text-sm font-bold text-text-primary">관심종목 추가</h3>
        <button aria-label="닫기" onClick={onClose}><X size={15} className="text-text-muted hover:text-text-primary" /></button>
      </div>

      {/* 검색 입력 */}
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
        {loading && <InlineSpinner />}
      </div>

      {/* 검색 결과 */}
      <div className="max-h-64 overflow-y-auto">
        {!query && (
          <div className="px-4 py-6 text-center text-text-muted text-xs">
            종목명·코드·한글로 검색하세요
          </div>
        )}
        {query && !loading && results.length === 0 && (
          <div className="px-4 py-6 text-center text-text-muted text-sm">검색 결과 없음</div>
        )}
        {results.map((item) => (
          <button
            key={item.symbol}
            className="w-full flex items-center gap-3 px-4 py-3 border-b border-border/30 hover:bg-bg-hover text-left transition-colors"
            onClick={() => handleSelect(item)}
          >
            <MarketBadge market={item.market} />
            <div className="flex-1 min-w-0">
              <div className="font-mono font-bold text-sm text-text-primary">{item.symbol}</div>
              <div className="text-xs text-text-muted truncate">{item.name}</div>
            </div>
            <div className="text-xs text-text-muted flex-shrink-0">{item.exchange}</div>
            <Plus size={13} className="text-accent-blue flex-shrink-0" />
          </button>
        ))}
      </div>

      {/* 옵션 */}
      <div className="px-4 py-3 border-t border-border flex flex-col gap-2">
        <select
          className="w-full bg-bg-primary border border-border rounded-lg px-3 py-1.5 text-xs text-text-primary focus:outline-none"
          value={folderId}
          onChange={(e) => setFolderId(Number(e.target.value))}
        >
          {folders.map((f: any) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <input
          className="w-full bg-bg-primary border border-border rounded-lg px-3 py-1.5 text-xs text-text-primary focus:outline-none placeholder:text-text-muted"
          placeholder="메모 (선택)"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
        />
      </div>
    </Modal>
  );
}

/* ── 종목 편집 모달 ──────────────────────────────────────── */
export function EditItemModal({ item, folders, onClose, onSave }: {
  item: any;
  folders: any[];
  onClose: () => void;
  onSave: (patch: { name?: string; memo?: string; folder_id?: number }) => void;
}) {
  const [name, setName]     = useState(item.name || "");
  const [memo, setMemo]     = useState(item.memo || "");
  const [folderId, setFolderId] = useState<number>(item.folder_id ?? folders[0]?.id);

  return (
    <Modal maxWidth="max-w-sm">
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-border">
        <div>
          <h3 className="text-sm font-bold text-text-primary">종목 편집</h3>
          <p className="text-2xs text-text-muted mt-0.5">{item.symbol}</p>
        </div>
        <button aria-label="닫기" onClick={onClose}><X size={15} className="text-text-muted hover:text-text-primary" /></button>
      </div>
      <div className="p-4 flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-2xs font-semibold text-text-muted">표시 이름</label>
          <input
            className="bg-bg-primary border border-border rounded-xl px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-blue"
            placeholder={item.symbol}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-2xs font-semibold text-text-muted">메모</label>
          <textarea
            rows={3}
            className="bg-bg-primary border border-border rounded-xl px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-blue resize-none"
            placeholder="메모 입력..."
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
        </div>
        {folders.length > 0 && (
          <div className="flex flex-col gap-1">
            <label className="text-2xs font-semibold text-text-muted">폴더</label>
            <select
              className="bg-bg-primary border border-border rounded-xl px-3 py-2 text-sm text-text-primary focus:outline-none"
              value={folderId}
              onChange={(e) => setFolderId(Number(e.target.value))}
            >
              {folders.map((f: any) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-xl border border-border text-text-muted text-sm hover:border-accent-blue hover:text-text-primary transition-all"
          >취소</button>
          <button
            onClick={() => { onSave({ name, memo, folder_id: folderId }); onClose(); }}
            className="flex-1 py-2 rounded-xl bg-accent-blue text-white text-sm font-semibold hover:bg-blue-600 transition-colors"
          >저장</button>
        </div>
      </div>
    </Modal>
  );
}

/* ── 폴더 이름 편집 ──────────────────────────────────────── */
export function FolderNameEdit({ folder, onSave, onCancel }: { folder: any; onSave: (n: string) => void; onCancel: () => void }) {
  const [val, setVal] = useState(folder.name);
  return (
    <div className="flex items-center gap-1 flex-1">
      <input
        className="flex-1 bg-bg-primary border border-accent-blue rounded-lg px-2 py-0.5 text-xs text-text-primary focus:outline-none"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") onSave(val); if (e.key === "Escape") onCancel(); }}
        autoFocus
      />
      <button onClick={() => onSave(val)} className="text-accent-green p-1"><Check size={13} /></button>
      <button aria-label="닫기" onClick={onCancel} className="text-text-muted p-1"><X size={13} /></button>
    </div>
  );
}

/* ── 폴더 삭제 확인 모달 ──────────────────────────────────── */
export function DeleteFolderModal({ folder, itemCount, onClose, onConfirm }: {
  folder: any; itemCount: number; onClose: () => void; onConfirm: () => void;
}) {
  return (
    <Modal maxWidth="max-w-sm">
      <div className="p-5 flex flex-col gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full bg-accent-red/10 flex items-center justify-center flex-shrink-0">
            <AlertTriangle size={18} className="text-accent-red" />
          </div>
          <h3 className="text-sm font-bold text-text-primary">폴더를 삭제할까요?</h3>
        </div>
        <p className="text-xs text-text-muted leading-relaxed">
          <span className="font-semibold text-text-primary">"{folder.name}"</span> 폴더를 삭제합니다.
          {itemCount > 0 && (
            <> 폴더에 담긴 종목 <span className="font-semibold text-text-primary">{itemCount}개</span>는 관심종목에서 제거되지 않고 "기본 관심목록" 폴더로 이동합니다.</>
          )}
        </p>
        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-xl border border-border text-text-muted text-sm hover:border-accent-blue hover:text-text-primary transition-all"
          >취소</button>
          <button
            onClick={() => { onConfirm(); onClose(); }}
            className="flex-1 py-2 rounded-xl bg-accent-red text-white text-sm font-semibold hover:bg-red-600 transition-colors"
          >삭제</button>
        </div>
      </div>
    </Modal>
  );
}




export function AddToPortfolioModal({
  item,
  currentPrice,
  onClose,
}: {
  item: any;
  currentPrice?: number | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const isKR    = item.market === "KR";
  const isForex = item.market === "US" || item.market === "ETF";

  const [portfolioId,  setPortfolioId]  = useState<number | null>(null);
  const [form, setForm] = useState<BuyInfoValue>({
    currency:     isKR ? "KRW" : "USD",
    shares:       "",
    avgPrice:     currentPrice != null && currentPrice > 0 ? String(currentPrice) : "",
    inputFx:      "",
    purchaseDate: "",
    note:         "",
    assetClass:   "",
  });
  const patchForm = (p: Partial<BuyInfoValue>) => setForm((prev) => ({ ...prev, ...p }));
  const { currency, shares, avgPrice, note, inputFx, purchaseDate, assetClass } = form;
  const [priceLoading, setPriceLoading] = useState(currentPrice == null || currentPrice <= 0);
  const [saving,       setSaving]       = useState(false);
  const [saveError,    setSaveError]    = useState("");

  const { data: portfolios = [] } = useQuery<any[]>({
    queryKey: ["portfolios"],
    queryFn:  portfolioApi.getPortfolios,
    staleTime: 300_000,
  });

  const defaultFx = useExchangeRate();

  useEffect(() => {
    if ((portfolios as any[]).length > 0 && portfolioId === null) {
      setPortfolioId((portfolios as any[])[0].id);
    }
  }, [portfolios, portfolioId]);

  useEffect(() => {
    if (currentPrice != null && currentPrice > 0) return;
    setPriceLoading(true);
    stocksApi.getPrice(item.market, item.symbol)
      .then((data) => {
        if (data?.price != null) setForm((prev) => (prev.avgPrice === "" ? { ...prev, avgPrice: String(data.price) } : prev));
      })
      .catch(() => {})
      .finally(() => setPriceLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canSave = Number(shares) > 0 && Number(avgPrice) >= 0;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setSaveError("");
    try {
      await portfolioApi.addItem({
        portfolio_id:       portfolioId,
        symbol:             item.symbol,
        market:             item.market,
        name:               item.name,
        shares:             Number(shares),
        avg_price:          Number(avgPrice),
        currency,
        input_exchange_rate: currency === "USD" && inputFx ? Number(inputFx) : null,
        purchase_date:      purchaseDate || null,
        note:               note || null,
        asset_class:        assetClass || null,
      });
      qc.invalidateQueries({ queryKey: ["portfolio-items-all"] });
      qc.invalidateQueries({ queryKey: ["portfolios"] });
      onClose();
    } catch (err) {
      setSaveError(extractErrorMessage(err, "추가에 실패했습니다"));
    } finally {
      setSaving(false);
    }
  };


  return (
    <Modal align="start" padTop="pt-16" backdropOpacity={70} maxWidth="max-w-md" onClose={onClose}>
      {/* 헤더 */}
      <div className="flex items-center gap-2 px-4 py-3.5 border-b border-border">
        <Wallet size={14} className="text-accent-blue" />
        <h3 className="flex-1 text-sm font-bold text-text-primary">매수 정보 입력</h3>
        <button aria-label="닫기" onClick={onClose} className="p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors">
          <X size={15} />
        </button>
      </div>

      {/* 종목 정보 */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-bg-elevated/50">
        <MarketBadge market={item.market} />
        <div className="flex-1 min-w-0">
          <div className="font-mono font-bold text-sm text-text-primary">{normalizeSymbol(item.symbol ?? "")}</div>
          <div className="text-xs text-text-muted truncate">{item.name}</div>
        </div>
      </div>

      <div className="px-5 py-4 flex flex-col gap-3.5">
        {/* 포트폴리오 선택 */}
        {(portfolios as any[]).length > 1 && (
          <div className="flex flex-col gap-1.5">
            <label className="text-2xs font-semibold text-text-muted">포트폴리오</label>
            <select className={INPUT_CLASS} value={portfolioId ?? ""} onChange={(e) => setPortfolioId(Number(e.target.value))}>
              {(portfolios as any[]).map((pf: any) => (
                <option key={pf.id} value={pf.id}>{pf.name}</option>
              ))}
            </select>
          </div>
        )}

        <BuyInfoFields
          value={form}
          onChange={patchForm}
          isForex={isForex}
          priceLoading={priceLoading}
          defaultFx={defaultFx}
          autoFocusShares
        />
      </div>

      {saveError && (
        <p className="mx-5 mb-2 text-xs text-red-400 bg-red-900/20 rounded-lg px-3 py-2">
          오류: {saveError}
        </p>
      )}

      <div className="flex gap-2 px-5 py-4 border-t border-border">
        <button onClick={onClose} disabled={saving}
          className="flex-1 px-4 py-2 text-sm font-semibold rounded-lg border border-border text-text-muted hover:text-text-primary hover:border-accent-blue/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
          취소
        </button>
        <button onClick={handleSave} disabled={!canSave || saving}
          className="flex-1 px-4 py-2 text-sm font-semibold rounded-lg bg-accent-blue text-white hover:bg-blue-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
          {saving ? "추가 중..." : "추가"}
        </button>
      </div>
    </Modal>
  );
}

/* ── 폴더 관리 팝업 ────────────────────────────────────────── */
export function FolderManagerModal({
  folders, onClose, onCreate, onRename, onDelete, onReorder,
}: {
  folders: any[];
  onClose: () => void;
  onCreate: () => void;
  onRename: (id: number, name: string) => void;
  onDelete: (folder: any) => void;
  onReorder: (order: number[]) => void;
}) {
  const [local, setLocal] = useState<any[]>(folders);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [dragOver, setDragOver] = useState<number | null>(null);
  const dragIdx = useRef(-1);

  // 터치 드래그 상태
  const touchDragIdxRef = useRef(-1);
  const touchOverIdxRef = useRef(-1);
  const [touchOver, setTouchOver] = useState<number | null>(null);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);
  const lpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearLPTimer = () => { if (lpTimer.current) { clearTimeout(lpTimer.current); lpTimer.current = null; } };

  const handleRowTouchStart = (i: number, e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStartPos.current = { x: t.clientX, y: t.clientY };
    clearLPTimer();
    lpTimer.current = setTimeout(() => { touchDragIdxRef.current = i; }, 350);
  };

  const handleRowTouchMove = (e: React.TouchEvent) => {
    const t = e.touches[0];
    if (touchDragIdxRef.current < 0) {
      const s = touchStartPos.current;
      if (s && (Math.abs(t.clientX - s.x) > 8 || Math.abs(t.clientY - s.y) > 8)) clearLPTimer();
      return;
    }
    const el = (document.elementFromPoint(t.clientX, t.clientY) as HTMLElement | null)?.closest('[data-drag-idx]') as HTMLElement | null;
    if (el) {
      const toIdx = parseInt(el.dataset.dragIdx ?? '-1', 10);
      if (toIdx >= 0) { touchOverIdxRef.current = toIdx; setTouchOver(toIdx); }
    }
  };

  const handleRowTouchEnd = () => {
    clearLPTimer();
    if (touchDragIdxRef.current >= 0 && touchOverIdxRef.current >= 0 && touchOverIdxRef.current !== touchDragIdxRef.current) {
      handleDrop(touchOverIdxRef.current);
    }
    touchDragIdxRef.current = -1;
    touchOverIdxRef.current = -1;
    setTouchOver(null);
  };

  useEffect(() => { setLocal(folders); }, [folders]);

  const commitRename = (id: number) => {
    const trimmed = editName.trim();
    if (trimmed) onRename(id, trimmed);
    setEditingId(null);
  };

  const handleDrop = (toIdx: number) => {
    const from = dragIdx.current >= 0 ? dragIdx.current : touchDragIdxRef.current;
    if (from < 0 || from === toIdx) return;
    const next = [...local];
    const [moved] = next.splice(from, 1);
    next.splice(toIdx, 0, moved);
    setLocal(next);
    onReorder(next.map((f: any) => f.id));
  };

  return (
    <Modal maxWidth="max-w-sm" onClose={onClose}>
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-border">
        <h3 className="text-sm font-bold text-text-primary">폴더 관리</h3>
        <button aria-label="닫기" onClick={onClose}><X size={15} className="text-text-muted hover:text-text-primary" /></button>
      </div>
      <div className="flex flex-col max-h-96 overflow-y-auto">
        {local.map((f: any, i: number) => (
          <div
            key={f.id}
            data-drag-idx={i}
            draggable
            onDragStart={() => { dragIdx.current = i; }}
            onDragEnd={() => { dragIdx.current = -1; setDragOver(null); }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(i); }}
            onDrop={() => { handleDrop(i); setDragOver(null); }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null); }}
            onTouchStart={(e) => handleRowTouchStart(i, e)}
            onTouchMove={handleRowTouchMove}
            onTouchEnd={handleRowTouchEnd}
            className={`flex items-center gap-3 px-4 py-4 border-b border-border/40 transition-colors cursor-grab active:cursor-grabbing select-none ${dragOver === i || touchOver === i ? "bg-accent-blue/10 ring-2 ring-accent-blue/30 ring-inset" : ""}`}
          >
            {/* 드래그 핸들 */}
            <div className="text-text-muted flex-shrink-0 px-2 pointer-events-none">
              <svg width="18" height="28" viewBox="0 0 10 16" fill="currentColor">
                <circle cx="3" cy="2" r="1.8"/><circle cx="7" cy="2" r="1.8"/>
                <circle cx="3" cy="8" r="1.8"/><circle cx="7" cy="8" r="1.8"/>
                <circle cx="3" cy="14" r="1.8"/><circle cx="7" cy="14" r="1.8"/>
              </svg>
            </div>
            {editingId === f.id ? (
              <input
                draggable={false}
                className="flex-1 bg-bg-primary border border-accent-blue rounded-lg px-3 py-1.5 text-sm text-text-primary focus:outline-none cursor-text select-text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") commitRename(f.id); if (e.key === "Escape") setEditingId(null); }}
                autoFocus
              />
            ) : (
              <span className="flex-1 text-sm font-medium text-text-primary truncate">{f.name}</span>
            )}
            {editingId === f.id ? (
              <button draggable={false} onClick={(e) => { e.stopPropagation(); commitRename(f.id); }} className="p-2 text-accent-blue hover:bg-accent-blue/10 rounded-lg"><Check size={15} /></button>
            ) : (
              <button draggable={false} onClick={(e) => { e.stopPropagation(); setEditingId(f.id); setEditName(f.name); }}
                className="p-2 text-text-muted hover:text-accent-blue hover:bg-accent-blue/10 rounded-lg transition-colors"><Pencil size={15} /></button>
            )}
            <button draggable={false} onClick={(e) => { e.stopPropagation(); onDelete(f); }}
              className="p-2 text-text-muted hover:text-accent-red hover:bg-accent-red/10 rounded-lg transition-colors"><Trash2 size={15} /></button>
          </div>
        ))}
      </div>
      <div className="p-4 border-t border-border">
        <button onClick={onCreate}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-dashed border-border text-text-muted hover:text-accent-blue hover:border-accent-blue transition-colors text-sm">
          <Plus size={14} />새 폴더 만들기
        </button>
      </div>
    </Modal>
  );
}
