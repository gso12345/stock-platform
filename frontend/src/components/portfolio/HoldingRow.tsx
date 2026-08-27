import { memo } from "react";
import { MarketBadge, ChangeBadge } from "@/components/ui";
import { Pencil, Trash2, ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
/* 현재가는 가리지 않으므로 원본 포맷터를 그대로 쓴다 — 남들도 다 아는
   값이고, 여기까지 가리면 목록이 읽을 수 없게만 되고 지켜지는 건 없다 */
import { fmtNative, fmtKRWFull, fmtUSDFull } from "@/utils/formatters";
import { use돈, 가린글 } from "@/hooks/useMoney";
import type { EnrichedItem } from "@/types/portfolio";
import LivePrice from "@/components/ui/LivePrice";

/** 이 종목이 배당을 어떻게 주나 — 배당 달력이 받아 온 것을 나눠 쓴다.
 *
 *  참고한 자산 앱들은 종목 카드마다 '배당월 2·5·8·11' 과 '투자배당률
 *  3.2%' 를 달아 둔다. 목록을 훑다가 "이 종목 배당이 언제였지" 를
 *  다른 화면에 가서 확인하지 않아도 된다. 서버에 새로 물어볼 것도
 *  없다 — 배당 탭이 이미 받는 값이고 캐시를 나눠 쓴다. */
export interface 배당몫 {
  /** 몇 월에 주나. 주·월배당은 1~12 전부라 화면에 안 쓴다 */
  months: number[];
  /** 한 주에 한 해 얼마 — 원본 통화 */
  perYear: number;
  currency: string;
}

/** 투자배당률 — 한 해 배당 ÷ 내가 넣은 돈.
 *
 *  '시가배당률'(지금 가격 대비)과 다른 숫자다. 오래 가진 사람일수록
 *  높아지는 쪽이 이것이고, 배당주를 오래 들고 있는 사람이 보고 싶어
 *  하는 것도 이쪽이다. */
export function 투자배당률(몫: 배당몫 | undefined, item: EnrichedItem, 환율: number): number | null {
  if (!몫 || !몫.perYear || item.costKRW <= 0 || !item.shares) return null;
  const 한해 = 몫.perYear * item.shares * (몫.currency === "KRW" ? 1 : 환율);
  return (한해 / item.costKRW) * 100;
}

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
  /** 배당 정보. 아직 안 왔으면 undefined — 그때는 배지를 안 그린다 */
  배당?: 배당몫;
  onNavigate: (item: EnrichedItem) => void;
  onEdit: (item: EnrichedItem) => void;
  onDelete: (item: EnrichedItem) => void;
  onPrefetch: (item: EnrichedItem) => void;
}

export const fmtShares = (n: number) => (n % 1 === 0 ? n.toLocaleString() : n.toFixed(4));

export const HoldingCard = memo(function HoldingCard({
  item, hasPrice, pnlClass, showAsNative, exchangeRate, isAllView, isLoggedIn, 배당,
  onNavigate, onEdit, onDelete, onPrefetch,
}: HoldingRowProps) {
  const { isForexItem, nativeAvgPrice, nativeValue, nativePnl } = item;
  const 돈 = use돈();
  const 배당률 = 투자배당률(배당, item, exchangeRate);
  /* 주·월배당은 months 가 1~12 전부라 적을 뜻이 없다. 분기·반기·연배당만
     '언제 주나' 가 정보가 된다 */
  const 배당월 = 배당?.months && 배당.months.length > 0 && 배당.months.length < 12
    ? 배당.months : null;
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
            {hasPrice ? (showAsNative ? 돈.달러(nativeValue) : 돈.원(item.currentValueKRW)) : "—"}
          </span>
        </div>
        <span className={`font-mono font-bold text-sm whitespace-nowrap ${hasPrice ? pnlClass : "text-text-muted"}`}>
          {hasPrice
            ? `${showAsNative ? `${nativePnl >= 0 ? "+" : ""}${돈.달러(nativePnl)}` : 돈.원부호(item.pnlKRW)} (${item.pnlRate >= 0 ? "+" : ""}${item.pnlRate.toFixed(2)}%)`
            : "—"}
        </span>
      </div>

      {/* 참고값 — 한 줄로 낮춘다. 예전에는 라벨과 값이 각각 두 줄씩
          세 칸을 차지해 카드 높이의 3분의 1을 먹었다 */}
      <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-2xs text-text-dim">
        {/* 수량과 평단가도 가린다.
            평가금액만 가리고 이 둘을 남기면 곱해서 그대로 나온다 —
            가리는 시늉만 하는 셈이다. 반면 현재가·수익률·비중은 남긴다:
            남들도 아는 값이거나, 내가 얼마를 가졌는지를 말하지 않는다 */}
        <span className="whitespace-nowrap">
          {돈.가림 ? 가린글 : `${fmtShares(item.shares)}주`} · 평단{" "}
          <span className="font-mono text-text-muted">
            {!isForexItem ? 돈.현지(item.market, item.currency, item.avgPrice)
              : showAsNative ? 돈.달러(nativeAvgPrice) : 돈.원(nativeAvgPrice * exchangeRate)}
          </span>
        </span>
        {/* 배당 —
            목록을 훑다가 "이 종목 배당이 언제였지" 를 다른 화면에 가서
            확인하지 않아도 되게. 투자배당률은 %라 안 가린다 */}
        {배당률 != null && (
          <span className="whitespace-nowrap text-accent-green/80 font-mono">
            배당 {배당률.toFixed(2)}%
          </span>
        )}
        {배당월 && (
          <span className="whitespace-nowrap">{배당월.join("·")}월</span>
        )}
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
  item, hasPrice, pnlClass, showAsNative, exchangeRate, isAllView, isLoggedIn, 배당,
  onNavigate, onEdit, onDelete, onPrefetch,
}: HoldingRowProps) {
  const { isForexItem, nativeAvgPrice, nativeValue, nativePnl } = item;
  const 돈 = use돈();
  const 배당률 = 투자배당률(배당, item, exchangeRate);
  const 배당월 = 배당?.months && 배당.months.length > 0 && 배당.months.length < 12
    ? 배당.months : null;
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
          {/* 배당 — 카드 보기와 같은 값을 같은 자리에 둔다 */}
          {(배당률 != null || 배당월) && (
            <span className="flex items-center gap-1.5 text-2xs text-text-dim whitespace-nowrap">
              {배당률 != null && <span className="text-accent-green/80 font-mono">배당 {배당률.toFixed(2)}%</span>}
              {배당월 && <span>{배당월.join("·")}월</span>}
            </span>
          )}
        </div>
      </td>
      {isAllView && (
        <td className="px-3 py-2.5 text-text-muted whitespace-nowrap">{item.portfolioName || "-"}</td>
      )}
      <td className="px-3 py-2.5 text-right whitespace-nowrap"><MarketBadge market={item.market} /></td>
      <td className="px-3 py-2.5 text-right font-mono text-text-primary whitespace-nowrap">
        {돈.가림 ? 가린글 : fmtShares(item.shares)}
      </td>
      <td className="px-3 py-2.5 text-right font-mono text-text-secondary whitespace-nowrap">
        <div>
          {!isForexItem ? 돈.현지(item.market, item.currency, item.avgPrice)
            : showAsNative ? 돈.달러(nativeAvgPrice) : 돈.원(nativeAvgPrice * exchangeRate)}
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
          ? (showAsNative ? 돈.달러(nativeValue) : 돈.원(item.currentValueKRW))
          : <span className="text-text-muted">—</span>}
      </td>
      <td className={`px-3 py-2.5 text-right font-mono font-semibold whitespace-nowrap ${hasPrice ? pnlClass : "text-text-muted"}`}>
        {hasPrice
          ? (showAsNative ? `${nativePnl >= 0 ? "+" : ""}${돈.달러(nativePnl)}` : 돈.원부호(item.pnlKRW))
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
