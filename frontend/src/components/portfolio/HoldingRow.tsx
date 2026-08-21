import { memo } from "react";
import { MarketBadge, ChangeBadge } from "@/components/ui";
import { Pencil, Trash2, ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { fmtKRWFull, fmtKRWFullSign, fmtUSDFull, fmtNative } from "@/utils/formatters";
import type { EnrichedItem } from "@/types/portfolio";
import LivePrice from "@/components/ui/LivePrice";

/* ── Market badge ───────────────────────────────────────── */

/* ── Sort ──────────────────────────────────────────────── */
export type SortField = "name" | "shares" | "value" | "pnl" | "pnlRate" | "weight";

export function SortHead({ field, label, sortField, sortDir, onClick, align = "right" }: {
  field: SortField; label: string; sortField: SortField | null; sortDir: "asc" | "desc";
  onClick: (f: SortField) => void; align?: "left" | "right";
}) {
  const active = sortField === field;
  /* 예전에는 <th onClick> 이라 마우스로만 누를 수 있었다. 스크린리더는
     이 칸이 눌리는지도, 지금 무엇으로 정렬돼 있는지도 알 수 없었다.
     퀀트 표와 같은 방식(th 에 aria-sort, 안쪽은 진짜 button)으로 맞춘다. */
  return (
    <th
      aria-sort={active ? (sortDir === "desc" ? "descending" : "ascending") : "none"}
      className={`px-3 py-2.5 font-semibold text-text-muted whitespace-nowrap select-none ${
        align === "left" ? "text-left" : "text-right"
      }`}
    >
      <button
        type="button"
        onClick={() => onClick(field)}
        aria-label={`${label} 기준 정렬`}
        className={`inline-flex items-center gap-0.5 hover:text-text-primary transition-colors
          focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/60 rounded
          ${align === "right" ? "flex-row-reverse" : ""} ${active ? "text-accent-blue" : ""}`}
      >
        {label}
        {active
          ? sortDir === "desc"
            ? <ChevronDown size={11} className="text-accent-blue" />
            : <ChevronUp size={11} className="text-accent-blue" />
          : <ChevronsUpDown size={11} className="opacity-25" />
        }
      </button>
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
      {/* 종목 + 지금 얼마 —
          예전에는 현재가가 아래 3칸 격자의 한 칸 안에 들어 있어서, 그 칸
          너비(휴대폰에서 약 110px)에 "₩185,000" 과 "+1,500 (+0.82%)" 가
          같이 못 들어가 줄이 갈라졌다. 현재가는 종목 옆이 제자리다 —
          다른 증권 앱들도 종목명 오른쪽에 시세를 붙인다. */}
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
        <div className="flex flex-col items-end gap-0.5 shrink-0">
          <span className="font-mono text-sm font-semibold text-text-primary whitespace-nowrap">
            {!hasPrice ? "—" : (
              <LivePrice value={item.currentPriceNative}>
                {!isForexItem ? fmtNative(item.market, item.currency, item.currentPriceNative)
                  : showAsNative ? fmtUSDFull(item.currentPriceNative) : fmtKRWFull(item.currentPriceNative * exchangeRate)}
              </LivePrice>
            )}
          </span>
          {/* 전일대비 — 수익률(매입가 대비)과 다른 숫자다. 어제 산 사람과
              3년 전에 산 사람에게 오늘의 움직임은 같지만 수익률은 다르다.
              whitespace-nowrap 이 없으면 좁은 칸에서 다시 갈라진다 */}
          {hasPrice && item.전일대비율 != null && (
            <ChangeBadge value={item.전일대비율} className="text-xs whitespace-nowrap"
              금액={item.전일대비액 != null
                ? (isForexItem && !showAsNative ? item.전일대비액 * exchangeRate : item.전일대비액)
                : null}
              /* 금액을 원화로 환산해 놓고 통화만 USD 로 두면 소수점이 붙는다 —
                    실제로 "+25390.76 (+2.14%)" 로 나왔다. 환산 여부와 맞춘다 */
                통화={isForexItem && showAsNative ? "USD" : "KRW"} />
          )}
        </div>
      </div>

      {/* 내 몫 — 이 카드에서 제일 크게 읽혀야 하는 두 값 */}
      <div className="flex items-end justify-between gap-3 pt-2.5 border-t border-border/40">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-2xs text-text-dim">평가금액</span>
          <span className="font-mono font-bold text-text-primary text-lg leading-none truncate">
            {hasPrice ? (showAsNative ? fmtUSDFull(nativeValue) : fmtKRWFull(item.currentValueKRW)) : "—"}
          </span>
        </div>
        <span className={`font-mono font-bold text-sm whitespace-nowrap ${hasPrice ? pnlClass : "text-text-muted"}`}>
          {hasPrice
            ? `${showAsNative ? `${nativePnl >= 0 ? "+" : ""}${fmtUSDFull(nativePnl)}` : fmtKRWFullSign(item.pnlKRW)} (${item.pnlRate >= 0 ? "+" : ""}${item.pnlRate.toFixed(2)}%)`
            : "—"}
        </span>
      </div>

      {/* 참고값 — 한 줄로 낮춘다. 예전에는 라벨과 값이 각각 두 줄씩
          세 칸을 차지해 카드 높이의 3분의 1을 먹었다 */}
      <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-2xs text-text-dim">
        <span className="whitespace-nowrap">
          {fmtShares(item.shares)}주 · 평단{" "}
          <span className="font-mono text-text-muted">
            {!isForexItem ? fmtNative(item.market, item.currency, item.avgPrice)
              : showAsNative ? fmtUSDFull(nativeAvgPrice) : fmtKRWFull(nativeAvgPrice * exchangeRate)}
          </span>
        </span>
        <span className="ml-auto flex items-center gap-1.5 shrink-0">
          <span className="w-10 h-1 bg-bg-elevated rounded-full overflow-hidden">
            <span className="block h-full bg-accent-blue/60 rounded-full" style={{ width: `${Math.min(100, item.weight)}%` }} />
          </span>
          <span className="font-mono whitespace-nowrap">{item.weight.toFixed(1)}%</span>
        </span>
      </div>

      {/* 수정·삭제는 맨 아래로. 위에 두면 종목명 옆의 시세 자리를 뺏는다 */}
      {isLoggedIn && (
        <div className="flex items-center gap-1 justify-end -mt-1" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => onEdit(item)} aria-label={`${item.name || item.symbol} 수정`}
            className="p-1.5 rounded-lg text-text-dim hover:text-accent-blue hover:bg-accent-blue/10 transition-colors" title="수정">
            <Pencil size={13} />
          </button>
          <button onClick={() => onDelete(item)} aria-label={`${item.name || item.symbol} 삭제`}
            className="p-1.5 rounded-lg text-text-dim hover:text-accent-red hover:bg-accent-red/10 transition-colors" title="삭제">
            <Trash2 size={13} />
          </button>
        </div>
      )}
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
          <div className="text-2xs text-text-dim">@{Math.round(item.inputExchangeRate).toLocaleString()}원</div>
        )}
      </td>
      <td className="px-3 py-2.5 text-right font-mono text-text-primary whitespace-nowrap">
        {!hasPrice ? <span className="text-text-muted">—</span> : (
          <div className="flex flex-col items-end">
            <LivePrice value={item.currentPriceNative}>
              {!isForexItem ? fmtNative(item.market, item.currency, item.currentPriceNative)
                : showAsNative ? fmtUSDFull(item.currentPriceNative) : fmtKRWFull(item.currentPriceNative * exchangeRate)}
            </LivePrice>
            {item.전일대비율 != null && (
              <ChangeBadge value={item.전일대비율} className="text-2xs whitespace-nowrap"
                금액={item.전일대비액 != null
                  ? (isForexItem && !showAsNative ? item.전일대비액 * exchangeRate : item.전일대비액)
                  : null}
                /* 금액을 원화로 환산해 놓고 통화만 USD 로 두면 소수점이 붙는다 —
                    실제로 "+25390.76 (+2.14%)" 로 나왔다. 환산 여부와 맞춘다 */
                통화={isForexItem && showAsNative ? "USD" : "KRW"} />
            )}
          </div>
        )}
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
