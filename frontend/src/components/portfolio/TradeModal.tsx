/**
 * 사고팔기 — 보유 하나를 팔거나 더 산다.
 *
 * 예전에는 일부를 팔면 '수정' 에서 수량을 손으로 고쳐야 했고, 판 이익은 어디에도 안 남았다.
 * 여기서 팔면 수량이 줄고 실현 손익이 '매매' 탭에 남는다. 더 사면 평단·매수 환율이 섞인다.
 *
 * 저장하기 전에 결과를 보여 준다 — '팔면 얼마 남나', '평단이 얼마가 되나'. 서버와 같은 셈이다(utils/매매).
 */
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { Modal, INPUT_CLASS, cn } from "@/components/ui";
import ModalFooter from "@/components/ui/ModalFooter";
import { portfolioApi } from "@/api/stocks";
import { 사람말로 } from "@/api/queryError";
import { use돈 } from "@/hooks/useMoney";
import { usePnlColors } from "@/hooks/usePnlColors";
import { useSettingsStore } from "@/store/settingsStore";
import type { EnrichedItem } from "@/types/portfolio";
import { 팔면, 사면 } from "@/utils/매매";
import { fmtShares } from "./HoldingRow";

function 오늘(): string {
  const d = new Date();
  const 두 = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${두(d.getMonth() + 1)}-${두(d.getDate())}`;
}

/** 쉼표를 넣어 쳐도 읽는다 */
const 숫자 = (s: string) => Number(s.replace(/,/g, "").trim());

export default function TradeModal({ item, exchangeRate, onClose }: {
  item: EnrichedItem;
  /** 지금 환율 — 달러 종목의 기본값 */
  exchangeRate: number;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const 돈 = use돈();
  const 손익색 = usePnlColors(useSettingsStore((s) => s.colorScheme)).pnlColor;
  const 달러 = item.currency === "USD";
  const [쪽, set쪽] = useState<"sell" | "buy">("sell");
  const [수량, set수량] = useState("");
  const [가격, set가격] = useState(item.currentPriceNative ? String(item.currentPriceNative) : "");
  const [환율, set환율] = useState(String(Math.round(exchangeRate * 100) / 100));
  const [날짜, set날짜] = useState(오늘);
  const [수수료, set수수료] = useState("");
  const [오류, set오류] = useState<string | null>(null);

  const 값 = { 수량: 숫자(수량), 가격: 숫자(가격), 환율: 숫자(환율), 수수료: 숫자(수수료 || "0") };
  const 틀림 =
    !(값.수량 > 0) ? "수량을 넣어 주세요"
    : 쪽 === "sell" && 값.수량 > item.shares + 1e-9 ? `가진 것(${fmtShares(item.shares)}주)보다 많이 팔 수 없어요`
    : !(값.가격 >= 0) || 가격.trim() === "" ? "가격을 넣어 주세요"
    : 달러 && !(값.환율 > 0) ? "환율을 넣어 주세요"
    : !(값.수수료 >= 0) ? "수수료가 맞지 않아요"
    : null;

  const 보유 = { shares: item.shares, avgPrice: item.avgPrice, inputExchangeRate: item.inputExchangeRate, currency: item.currency };
  const 미리 = useMemo(() => {
    if (틀림) return null;
    return 쪽 === "sell"
      ? { 종류: "sell" as const, ...팔면(보유, 값.수량, 값.가격, 달러 ? 값.환율 : null, 값.수수료) }
      : { 종류: "buy" as const, ...사면(보유, 값.수량, 값.가격, 달러 ? 값.환율 : null, 값.수수료) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [틀림, 쪽, 수량, 가격, 환율, 수수료, item.shares, item.avgPrice, item.inputExchangeRate]);

  const 저장 = useMutation({
    mutationFn: () => portfolioApi.trade(item.id, {
      side: 쪽, shares: 값.수량, price: 값.가격, fx: 달러 ? 값.환율 : null, fee: 값.수수료, trade_date: 날짜,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portfolio-items-all"] });
      qc.invalidateQueries({ queryKey: ["portfolios"] });
      qc.invalidateQueries({ queryKey: ["portfolio-trades"] });
      onClose();
    },
    onError: (e) => set오류(사람말로(e)),
  });

  const 단위 = 달러 ? "$" : "원";
  const 칸 = (이름: string, 값: string, 바꾸기: (v: string) => void, 덧: Partial<React.InputHTMLAttributes<HTMLInputElement>> = {}) => (
    <label className="flex flex-col gap-1 text-2xs text-text-muted">
      {이름}
      <input value={값} onChange={(e) => 바꾸기(e.target.value)} className={INPUT_CLASS} {...덧} />
    </label>
  );

  return (
    <Modal maxWidth="max-w-sm" onClose={저장.isPending ? undefined : onClose}>
      <div className="flex items-center justify-between px-5 pt-4">
        <h3 className="text-sm font-bold text-text-primary">{item.name || item.symbol} 사고팔기</h3>
        <button type="button" onClick={onClose} aria-label="닫기" className="p-1 text-text-muted hover:text-text-primary">
          <X size={16} />
        </button>
      </div>
      <div className="px-5 py-3 flex flex-col gap-3">
        <div role="group" aria-label="팔기 또는 더 사기" className="flex rounded-lg border border-border overflow-hidden">
          {(["sell", "buy"] as const).map((k) => (
            <button key={k} type="button" aria-pressed={쪽 === k} onClick={() => { set쪽(k); set오류(null); }}
              className={cn("flex-1 py-2 text-xs font-semibold transition-colors",
                쪽 === k ? (k === "sell" ? "bg-accent-blue text-white" : "bg-accent-red text-white")
                  : "text-text-muted hover:bg-bg-elevated")}>
              {k === "sell" ? "팔기" : "더 사기"}
            </button>
          ))}
        </div>
        <p className="text-2xs text-text-dim">
          지금 {fmtShares(item.shares)}주 · 평단 {달러 ? `$${item.avgPrice.toFixed(2)}` : `${Math.round(item.avgPrice).toLocaleString("ko-KR")}원`}
          {달러 && item.inputExchangeRate ? ` · 매수 환율 ${item.inputExchangeRate.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}원` : ""}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            {칸("수량(주)", 수량, set수량, { inputMode: "decimal", placeholder: "0", "aria-label": "수량" })}
            {쪽 === "sell" && (
              <button type="button" onClick={() => set수량(String(item.shares))}
                className="self-start text-2xs font-semibold text-accent-blue hover:underline">전부</button>
            )}
          </div>
          {칸(`가격(${단위})`, 가격, set가격, { inputMode: "decimal", "aria-label": "가격" })}
          {달러 && 칸("환율(원/달러)", 환율, set환율, { inputMode: "decimal", "aria-label": "환율" })}
          {칸(`수수료·세금(${단위}, 선택)`, 수수료, set수수료, { inputMode: "decimal", placeholder: "0", "aria-label": "수수료" })}
          {칸("날짜", 날짜, set날짜, { type: "date", "aria-label": "날짜" })}
        </div>

        <div aria-live="polite" className="rounded-lg bg-bg-elevated px-3 py-2.5 text-xs text-text-secondary min-h-[2.75rem] flex items-center">
          {틀림 ? <span className="text-text-dim">{틀림}</span>
            : 미리?.종류 === "sell" ? (
              <span>
                실현 손익 <b className={손익색(미리.실현)}>
                  {돈.원부호(미리.실현)}</b>
                {" "}· 남는 수량 {미리.남은수 ? `${fmtShares(미리.남은수)}주` : "없음(보유에서 빠져요)"}
              </span>
            ) : 미리?.종류 === "buy" ? (
              <span>
                {fmtShares(미리.새수)}주 · 새 평단 <b className="text-text-primary">
                  {달러 ? `$${미리.새평단.toFixed(2)}` : `${Math.round(미리.새평단).toLocaleString("ko-KR")}원`}</b>
                {미리.새환율 ? ` · 매수 환율 ${미리.새환율.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}원` : ""}
              </span>
            ) : null}
        </div>
        {오류 && <p role="alert" className="text-2xs text-accent-red">{오류}</p>}
      </div>
      <ModalFooter onCancel={onClose} onConfirm={() => 저장.mutate()} 진행중={저장.isPending} 확인가능={!틀림}
        확인글={저장.isPending ? "저장 중..." : 쪽 === "sell" ? "팔기" : "더 사기"} />
    </Modal>
  );
}
