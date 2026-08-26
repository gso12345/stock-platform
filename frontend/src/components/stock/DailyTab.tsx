/** 일별 시세 표 — 종목 상세의 '일별' 탭.
 *
 * 원래 StockDetail.tsx 본문 안에 있었다. 화면 본체가 2,082줄이라
 * 값 하나를 고치려고 열면 어디를 봐야 하는지부터 찾아야 했다.
 */
import { fmtKRW, fmtUSD } from "@/utils/formatters";
import type { OHLCV } from "@/types";

export default function DailyTab({
  rows, 불러오는중, 개월수, set개월수, isKR, 상승색, 하락색,
}: {
  rows: OHLCV[];
  불러오는중: boolean;
  /** 몇 개월치를 받아 왔는지. '더보기' 를 누르면 늘어난다 */
  개월수: number;
  set개월수: (v: number | ((p: number) => number)) => void;
  isKR: boolean;
  /** 오르내림 색은 설정(빨강-파랑/초록-빨강)에 따라 달라진다 */
  상승색: string;
  하락색: string;
}) {
  const dailyOhlcv = rows;
  const fetchingDaily = 불러오는중;
  const dailyMonths = 개월수;
  const setDailyMonths = set개월수;
  const upColor = 상승색;
  const downColor = 하락색;

  return (
    <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold text-text-primary">일별 시세</span>
          {fetchingDaily && <div className="w-4 h-4 border-2 border-accent-blue border-t-transparent rounded-full animate-spin"/>}
        </div>
        {dailyOhlcv?.length ? (
          <span className="text-sm text-text-muted">{dailyOhlcv.length}일</span>
        ) : null}
      </div>
      {!dailyOhlcv?.length ? (
        <div className="py-12 text-center text-text-muted text-base">{fetchingDaily ? "불러오는 중" : "데이터 없음"}</div>
      ) : (
        <>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-text-muted border-b border-border bg-bg-secondary">
                <th className="text-left px-4 py-2.5 font-medium whitespace-nowrap sticky left-0 bg-bg-secondary">날짜</th>
                <th className="text-right px-3 py-2.5 font-medium whitespace-nowrap">종가</th>
                <th className="text-right px-3 py-2.5 font-medium whitespace-nowrap">등락률</th>
                <th className="text-right px-3 py-2.5 font-medium whitespace-nowrap">거래량</th>
                <th className="text-right px-3 py-2.5 font-medium whitespace-nowrap">거래대금</th>
                <th className="text-right px-3 py-2.5 font-medium whitespace-nowrap">시가</th>
                <th className="text-right px-3 py-2.5 font-medium whitespace-nowrap">고가</th>
                <th className="text-right px-3 py-2.5 font-medium whitespace-nowrap pr-4">저가</th>
              </tr>
            </thead>
            <tbody>
              {[...dailyOhlcv].reverse().map((bar, i, arr) => {
                const prevClose = arr[i + 1]?.close;
                const chgRate = prevClose ? ((bar.close - prevClose) / prevClose * 100) : 0;
                const isPos = chgRate >= 0;
                /* 거래대금은 원천에 따라 안 올 수 있다. 그때는 종가×거래량으로
                   어림한다 — 실제 값과 조금 다르지만 자리가 비는 것보다 낫다 */
                const amount = bar.amount && bar.amount > 0
                  ? bar.amount : bar.close * (bar.volume || 0);
                return (
                  <tr key={bar.date} className="border-b border-border/30 hover:bg-bg-hover">
                    <td className="px-4 py-2.5 font-mono text-text-muted whitespace-nowrap sticky left-0 bg-bg-card">{bar.date?.replace(/^(\d{4})(\d{2})(\d{2})/, "$1-$2-$3").slice(0,10)}</td>
                    <td className="px-3 py-2.5 text-right font-mono font-semibold text-text-primary whitespace-nowrap">
                      {isKR ? `₩${bar.close?.toLocaleString("ko-KR", {maximumFractionDigits:0})}` : `$${bar.close?.toFixed(2)}`}
                    </td>
                    <td className={`px-3 py-2.5 text-right font-mono whitespace-nowrap ${prevClose ? (isPos ? upColor : downColor) : "text-text-muted"}`}>
                      {prevClose ? `${isPos?"+":""}${chgRate.toFixed(2)}%` : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-text-muted whitespace-nowrap">
                      {bar.volume ? (bar.volume >= 1e8 ? `${(bar.volume/1e8).toFixed(1)}억` : bar.volume >= 1e4 ? `${(bar.volume/1e4).toFixed(1)}만` : bar.volume.toLocaleString()) : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-text-muted whitespace-nowrap">
                      {amount > 0 ? (isKR ? fmtKRW(amount) : fmtUSD(amount)) : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-text-muted whitespace-nowrap">
                      {isKR ? bar.open?.toLocaleString("ko-KR", {maximumFractionDigits:0}) : bar.open?.toFixed(2)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-accent-red/80 whitespace-nowrap">
                      {isKR ? bar.high?.toLocaleString("ko-KR", {maximumFractionDigits:0}) : bar.high?.toFixed(2)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-accent-blue/80 whitespace-nowrap pr-4">
                      {isKR ? bar.low?.toLocaleString("ko-KR", {maximumFractionDigits:0}) : bar.low?.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* 더보기 버튼 — 1달씩 추가 */}
        {dailyMonths <= 6 && (
          <button
            onClick={() => setDailyMonths(prev => prev + 1)}
            disabled={fetchingDaily}
            className="w-full py-3 text-sm font-semibold text-text-muted hover:text-accent-blue hover:bg-bg-elevated transition-all border-t border-border"
          >
            {fetchingDaily ? "불러오는 중" : `더보기 (+1개월) ▼`}
          </button>
        )}
        </>
      )}
    </div>
  );
}
