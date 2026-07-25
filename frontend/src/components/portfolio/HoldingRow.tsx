import { memo } from "react";
import { MarketBadge } from "@/components/ui";
import { Pencil, Trash2, ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { fmtKRWFull, fmtKRWFullSign, fmtUSDFull, fmtNative } from "@/utils/formatters";
import type { EnrichedItem } from "@/types/portfolio";

/* ── Market badge ───────────────────────────────────────── */

/* ── Sort ──────────────────────────────────────────────── */
export type SortField = "name" | "shares" | "value" | "pnl" | "pnlRate" | "weight";

export function SortHead({ field, label, sortField, sortDir, onClick, align = "right" }: {
  field: SortField; label: string; sortField: SortField | null; sortDir: "asc" | "desc";
  onClick: (f: SortField) => void; align?: "left" | "right";
}) {
  const active = sortField === field;
  return (
    <th
      onClick={() => onClick(field)}
      className={`px-3 py-2.5 font-semibold text-text-muted whitespace-nowrap cursor-pointer select-none hover:text-text-primary transition-colors ${
        align === "left" ? "text-left" : "text-right"
      }`}
    >
      <span className={`inline-flex items-center gap-0.5 ${align === "right" ? "flex-row-reverse" : ""}`}>
        {label}
        {active
          ? sortDir === "desc"
            ? <ChevronDown size={10} className="text-accent-blue" />
            : <ChevronUp size={10} className="text-accent-blue" />
          : <ChevronsUpDown size={10} className="opacity-25" />
        }
      </span>
    </th>
  );
}

/* ── 보유종목 행 ──
   시세는 30초마다 들어오는데 그때마다 목록 전체를 다시 그리면 종목이 많을수록 느려진다.
   값이 바뀐 행만 다시 그리도록 memo로 감싸되, 그러려면 prop이 렌더마다 새로 만들어지지
   않아야 하므로 핸들러는 "항목을 인자로 받는" 형태로 두고 부모에서 useCallback으로 고정한다. */
export interface HoldingRowProps {
  item: EnrichedItem;
  hasPrice: boolean;
  pnlClass: string;
  showAsNative: boolean;
  exchangeRate: number;
  isAllView: boolean;
  isLoggedIn: boolean;
  onNavigate: (item: EnrichedItem) => void;
  onEdit: (item: EnrichedItem) => void;
  onDelete: (item: EnrichedItem) => void;
  onPrefetch: (item: EnrichedItem) => void;
}

export const fmtShares = (n: number) => (n % 1 === 0 ? n.toLocaleString() : n.toFixed(4));

export const HoldingCard = memo(function HoldingCard({
  item, hasPrice, pnlClass, showAsNative, exchangeRate, isAllView, isLoggedIn,
  onNavigate, onEdit, onDelete, onPrefetch,
}: HoldingRowProps) {
  const { isForexItem, nativeAvgPrice, nativeValue, nativePnl } = item;
  return (
    <div
      className="holding-card-lite rounded-xl border border-border bg-bg-card hover:border-accent-blue/30 hover:bg-bg-hover transition-all p-4 flex flex-col gap-3 cursor-pointer"
      onClick={() => onNavigate(item)}
      onMouseEnter={() => onPrefetch(item)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <MarketBadge market={item.market} />
          <div className="min-w-0">
            <div className="font-semibold text-text-primary text-sm truncate">{item.name || item.symbol}</div>
            <div className="text-text-dim font-mono text-xs truncate">
              {item.symbol}{isAllView && item.portfolioName ? ` · ${item.portfolioName}` : ""}
            </div>
          </div>
        </div>
        {isLoggedIn && (
          <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => onEdit(item)}
              className="p-1.5 rounded-lg text-accent-blue bg-accent-blue/15 hover:bg-accent-blue/25 transition-colors" title="수정">
              <Pencil size={13} />
            </button>
            <button onClick={() => onDelete(item)}
              className="p-1.5 rounded-lg text-accent-red bg-accent-red/15 hover:bg-accent-red/25 transition-colors" title="삭제">
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 pt-2 border-t border-border/40">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-text-dim">평가금액</span>
          <span className="font-mono font-bold text-text-primary text-base">
            {hasPrice ? (showAsNative ? fmtUSDFull(nativeValue) : fmtKRWFull(item.currentValueKRW)) : "—"}
          </span>
        </div>
        <div className="flex flex-col gap-0.5 items-end">
          <span className="text-xs text-text-dim">평가손익</span>
          <span className={`font-mono font-bold text-base whitespace-nowrap ${hasPrice ? pnlClass : "text-text-muted"}`}>
            {hasPrice
              ? `${showAsNative ? `${nativePnl >= 0 ? "+" : ""}${fmtUSDFull(nativePnl)}` : fmtKRWFullSign(item.pnlKRW)} (${item.pnlRate >= 0 ? "+" : ""}${item.pnlRate.toFixed(2)}%)`
              : "—"}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="flex flex-col gap-0.5">
          <span className="text-text-dim">보유수량</span>
          <span className="font-mono text-text-secondary">{fmtShares(item.shares)}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-text-dim">평단가</span>
          <span className="font-mono text-text-secondary">
            {!isForexItem ? fmtNative(item.market, item.currency, item.avgPrice)
              : showAsNative ? fmtUSDFull(nativeAvgPrice) : fmtKRWFull(nativeAvgPrice * exchangeRate)}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-text-dim">현재가</span>
          <span className="font-mono text-text-secondary">
            {!hasPrice ? "—"
              : !isForexItem ? fmtNative(item.market, item.currency, item.currentPriceNative)
              : showAsNative ? fmtUSDFull(item.currentPriceNative) : fmtKRWFull(item.currentPriceNative * exchangeRate)}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex-1 h-1 bg-bg-elevated rounded-full overflow-hidden">
          <div className="h-full bg-accent-blue/60 rounded-full" style={{ width: `${Math.min(100, item.weight)}%` }} />
        </div>
        <span className="text-xs font-mono text-text-muted flex-shrink-0">비중 {item.weight.toFixed(1)}%</span>
      </div>
    </div>
  );
});

export const HoldingTableRow = memo(function HoldingTableRow({
  item, hasPrice, pnlClass, showAsNative, exchangeRate, isAllView, isLoggedIn,
  onNavigate, onEdit, onDelete, onPrefetch,
}: HoldingRowProps) {
  const { isForexItem, nativeAvgPrice, nativeValue, nativePnl } = item;
  return (
    <tr
      className="border-b border-border/40 transition-colors hover:bg-bg-hover cursor-pointer"
      onClick={() => onNavigate(item)}
      onMouseEnter={() => onPrefetch(item)}
    >
      <td className="px-3 py-2.5">
        <div className="flex flex-col gap-0.5">
          <span className="font-semibold text-text-primary">{item.name || item.symbol}</span>
          <span className="text-text-dim font-mono">{item.symbol}</span>
        </div>
      </td>
      {isAllView && (
        <td className="px-3 py-2.5 text-text-muted whitespace-nowrap">{item.portfolioName || "-"}</td>
      )}
      <td className="px-3 py-2.5 text-right whitespace-nowrap"><MarketBadge market={item.market} /></td>
      <td className="px-3 py-2.5 text-right font-mono text-text-primary whitespace-nowrap">
        {fmtShares(item.shares)}
      </td>
      <td className="px-3 py-2.5 text-right font-mono text-text-secondary whitespace-nowrap">
        <div>
          {!isForexItem ? fmtNative(item.market, item.currency, item.avgPrice)
            : showAsNative ? fmtUSDFull(nativeAvgPrice) : fmtKRWFull(nativeAvgPrice * exchangeRate)}
        </div>
        {item.currency === "USD" && item.inputExchangeRate && (
          <div className="text-[10px] text-text-dim">@{Math.round(item.inputExchangeRate).toLocaleString()}원</div>
        )}
      </td>
      <td className="px-3 py-2.5 text-right font-mono text-text-primary whitespace-nowrap">
        {!hasPrice ? <span className="text-text-muted">—</span>
          : !isForexItem ? fmtNative(item.market, item.currency, item.currentPriceNative)
          : showAsNative ? fmtUSDFull(item.currentPriceNative) : fmtKRWFull(item.currentPriceNative * exchangeRate)}
      </td>
      <td className="px-3 py-2.5 text-right font-mono text-text-primary whitespace-nowrap">
        {hasPrice
          ? (showAsNative ? fmtUSDFull(nativeValue) : fmtKRWFull(item.currentValueKRW))
          : <span className="text-text-muted">—</span>}
      </td>
      <td className={`px-3 py-2.5 text-right font-mono font-semibold whitespace-nowrap ${hasPrice ? pnlClass : "text-text-muted"}`}>
        {hasPrice
          ? (showAsNative ? `${nativePnl >= 0 ? "+" : ""}${fmtUSDFull(nativePnl)}` : fmtKRWFullSign(item.pnlKRW))
          : "—"}
      </td>
      <td className={`px-3 py-2.5 text-right font-mono font-semibold whitespace-nowrap ${hasPrice ? pnlClass : "text-text-muted"}`}>
        {hasPrice ? `${item.pnlRate >= 0 ? "+" : ""}${item.pnlRate.toFixed(2)}%` : "—"}
      </td>
      <td className="px-3 py-2.5 text-right font-mono text-text-muted whitespace-nowrap">
        <div>{item.weight.toFixed(1)}%</div>
        <div className="w-12 h-1 bg-bg-elevated rounded-full overflow-hidden ml-auto mt-0.5">
          <div className="h-full bg-accent-blue/60 rounded-full" style={{ width: `${Math.min(100, item.weight)}%` }} />
        </div>
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap">
        {isLoggedIn && (
          <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => onEdit(item)}
              className="p-1.5 rounded-lg text-accent-blue bg-accent-blue/15 hover:bg-accent-blue/25 transition-colors" title="수정">
              <Pencil size={13} />
            </button>
            <button onClick={() => onDelete(item)}
              className="p-1.5 rounded-lg text-accent-red bg-accent-red/15 hover:bg-accent-red/25 transition-colors" title="삭제">
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </td>
    </tr>
  );
});
