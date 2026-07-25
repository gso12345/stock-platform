import { INPUT_CLASS } from "@/components/ui";
import { ASSET_CLASS_OPTIONS } from "@/utils/assetClass";

export interface BuyInfoValue {
  currency: "KRW" | "USD";
  shares: string;
  avgPrice: string;
  inputFx: string;
  purchaseDate: string;
  note: string;
  assetClass: string;
}

/**
 * 매수 정보 입력 폼 — 내 자산의 "포지션 추가/수정"과 관심종목의 "보유종목 추가"가
 * 똑같은 항목을 각자 따로 그리고 있어서 한쪽만 고치면 두 화면이 어긋나던 것을 합쳤다.
 * 상태는 부모가 들고 있고 이 컴포넌트는 화면만 담당한다.
 */
export function BuyInfoFields({
  value, onChange, isForex, priceLoading, defaultFx, autoFocusShares,
}: {
  value: BuyInfoValue;
  onChange: (patch: Partial<BuyInfoValue>) => void;
  isForex: boolean;
  priceLoading?: boolean;
  defaultFx: number;
  autoFocusShares?: boolean;
}) {
  const { currency, shares, avgPrice, inputFx, purchaseDate, note, assetClass } = value;

  return (
    <>
      {/* 해외 종목: 통화 선택 */}
      {isForex && (
        <div className="flex flex-col gap-1.5">
          <label className="text-2xs font-semibold text-text-muted">입력 통화 *</label>
          <div className="flex gap-2">
            {(["USD", "KRW"] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onChange({ currency: c })}
                className={`flex-1 py-2 text-xs font-bold rounded-lg border transition-all ${
                  currency === c
                    ? c === "USD"
                      ? "bg-green-900/40 border-green-700/60 text-green-400"
                      : "bg-blue-900/40 border-blue-700/60 text-blue-400"
                    : "border-border text-text-muted hover:text-text-primary"
                }`}
              >
                {c === "USD" ? "달러 ($)" : "원화 (₩)"}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <div className="flex-1 flex flex-col gap-1.5">
          <label className="text-2xs font-semibold text-text-muted">보유수량 *</label>
          <input
            className={INPUT_CLASS}
            type="number"
            min="0.0001"
            step="0.0001"
            placeholder="0"
            value={shares}
            onChange={(e) => onChange({ shares: e.target.value })}
            autoFocus={autoFocusShares}
          />
        </div>
        <div className="flex-1 flex flex-col gap-1.5">
          <label className="text-2xs font-semibold text-text-muted">
            평균매수가 * {isForex ? (currency === "USD" ? "($)" : "(₩)") : "(₩)"}
          </label>
          <input
            className={INPUT_CLASS}
            type="number"
            min="0"
            step="any"
            placeholder={priceLoading ? "로딩 중..." : "0"}
            value={avgPrice}
            onChange={(e) => onChange({ avgPrice: e.target.value })}
          />
        </div>
      </div>

      {/* 달러로 입력할 때만 매수 당시 환율을 받는다 */}
      {isForex && currency === "USD" && (
        <div className="flex flex-col gap-1.5">
          <label className="text-2xs font-semibold text-text-muted">
            매수 당시 환율 (₩/$ · 선택)
            <span className="ml-1 text-text-dim font-normal">공란 시 현재 환율 사용</span>
          </label>
          <input
            className={INPUT_CLASS}
            type="number"
            min="0"
            step="1"
            placeholder={`예: ${Math.round(defaultFx)}`}
            value={inputFx}
            onChange={(e) => onChange({ inputFx: e.target.value })}
          />
        </div>
      )}

      <div className="flex gap-3">
        <div className="flex-1 flex flex-col gap-1.5">
          <label className="text-2xs font-semibold text-text-muted">매수일 (선택)</label>
          <input
            className={INPUT_CLASS}
            type="date"
            value={purchaseDate}
            onChange={(e) => onChange({ purchaseDate: e.target.value })}
          />
        </div>
        <div className="flex-1 flex flex-col gap-1.5">
          <label className="text-2xs font-semibold text-text-muted">자산유형</label>
          <select
            className={INPUT_CLASS}
            value={assetClass}
            onChange={(e) => onChange({ assetClass: e.target.value })}
          >
            <option value="">자동 분류</option>
            {ASSET_CLASS_OPTIONS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-2xs font-semibold text-text-muted">
          메모<span className="ml-1 text-text-dim font-normal">({note.length}/100)</span>
        </label>
        <textarea
          className={`${INPUT_CLASS} resize-none`}
          rows={2}
          maxLength={100}
          placeholder="선택 사항"
          value={note}
          onChange={(e) => onChange({ note: e.target.value })}
        />
      </div>
    </>
  );
}
