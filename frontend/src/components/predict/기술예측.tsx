/**
 * 기술적 분석 예측 — 공모주 시초가 예측처럼(사용자: "기술적분석을 바탕으로 주가를 공모가처럼 예측해줘").
 * 서버는 backend/app/services/predict/technical.py.
 *
 * 공모주 카드(components/ipo/IpoPrediction)와 같은 모양으로 읽힌다 —
 *   · 예상 주가와 50% 범위 막대(숫자 하나가 답처럼 읽히지 않게)
 *   · 기술적 신호를 얼마나 반영했나 — 지난 3년 '지금 가격 그대로' 와 견준 성적으로 고른 비율(0 이면 지금 가격)
 *   · 신호만 본 값, 그리고 여러 종목 시험 결과(기술적 예상은 '그대로' 를 이기지 못했다)
 *   · 지표가 비슷했던 때 가운데 몇 번 올랐나, 10% 넘게 오르내린 것은 몇 번
 *   · 지난 3년 매주 맞혀 본 성적 — 방식마다 평균 오차·방향 맞힘, 50% 범위에 든 비율
 *   · 비슷했던 때 목록(그때 RSI·200일선, 그 뒤 얼마나 움직였나)과 지금의 기술적 지표
 * 기술적 분석은 짧은 앞날을 보는 도구라 3개월 뒤까지만 — 6개월·1년을 고르면 짧은 기간으로 옮길 단추를 준다.
 */
import { useId } from "react";
import { BarChart2, ChevronDown } from "lucide-react";
import type { 기술예측 as 기술예측자료, 기술예측기간, 주가예측 } from "@/api/predict";
import { Card, cn } from "@/components/ui";
import { usePnlColors } from "@/hooks/usePnlColors";
import { useSettingsStore } from "@/store/settingsStore";
import { fmtNative } from "@/utils/formatters";
import {
  기술막대자리, 기술반영글, 기술시험글, 날짜글, 년월일글, 변화글, 지표값글, 확률글, type 예측일수,
} from "@/utils/주가예측";

export default function 기술예측({ 예측, 일수, 기간바꾸기 }: {
  예측: 주가예측;
  일수: 예측일수;
  기간바꾸기: (일수: 예측일수) => void;
}) {
  const 제목id = useId();
  const 기술 = 예측.technical;
  const 기간 = 기술?.horizons.find((h) => h.days === 일수);
  return (
    <section aria-labelledby={제목id}>
      <Card className={cn("flex flex-col", 기간 ? "gap-3" : "gap-2")}>
        <div className="flex items-center gap-2">
          <h2 id={제목id} className="flex items-center gap-1.5 text-sm font-semibold text-text-primary">
            <BarChart2 size={14} className="text-accent-blue" />기술적 분석 예측
          </h2>
          {기간 && (
            <span className="ml-auto shrink-0 px-2 py-0.5 rounded-full bg-accent-blue/10 text-2xs font-semibold text-accent-blue">
              {기간.method_label}
            </span>
          )}
        </div>
        {!기술 ? (
          <p className="text-xs text-text-muted break-keep">
            기술적 분석은 시세가 2년 가까이 있어야 지난날과 견줄 수 있어요. 아래 출렁임으로 본 범위를 봐 주세요
          </p>
        ) : !기간 ? (
          <>
            <p className="text-xs text-text-muted break-keep">
              {일수 > 63 ? "기술적 분석은 짧은 앞날을 보는 도구라 3개월 뒤까지만 셈해요" : "이 기간은 견줄 지난 시세가 모자라요"}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {기술.horizons.map((h) => (
                <button key={h.days} type="button" onClick={() => 기간바꾸기(h.days as 예측일수)}
                  className="px-2.5 py-1 rounded-full border border-border text-xs text-text-secondary hover:border-accent-blue/50 hover:text-accent-blue transition-colors">
                  {h.label} 뒤 보기
                </button>
              ))}
            </div>
          </>
        ) : (
          <예상 예측={예측} 기술={기술} 기간={기간} />
        )}
      </Card>
    </section>
  );
}

function 예상({ 예측, 기술, 기간 }: { 예측: 주가예측; 기술: 기술예측자료; 기간: 기술예측기간 }) {
  const 색 = usePnlColors(useSettingsStore((s) => s.colorScheme));
  const 돈 = (v: number) => fmtNative(예측.market, 예측.currency, v);
  const 검 = 기간.check;
  const 자리 = 기술막대자리(기간.range, 기간.predicted, 예측.price);
  const K = 기간.neighbor_count;
  const 몇번 = (p: number) => Math.round(p * K);
  const 오차범위 = 기간.range_kind === "errors";
  const 범위글 = `${돈(기간.range[0])} ~ ${돈(기간.range[1])}`;
  const 퍼센트 = (p: number | null) => (p == null ? "—" : `${Math.round(p * 100)}%`);
  // 예상에 쓴 것 — 반영 0 이면 '그대로', 1 이면 신호 방식, 그 사이면 따로 한 줄
  const 쓴줄 = !검 ? null : 검.weight === 0 ? "flat" : 검.weight === 1 ? 기간.method : "반영";
  const 표시 = (key: string) => (key === 쓴줄 ? "← 예상에 씀" : key === 기간.method ? "← 신호" : null);
  return (
    <>
      <div>
        <p className="text-xs text-text-muted">{기간.label} 뒤 · {날짜글(기간.date)} 무렵 · 예상 주가 · 참고만</p>
        {/* 숫자는 '참고만' 크기로 — 큰 숫자는 답처럼 읽힌다. 여러 종목 10년 시험에서 기술적 예상은 '그대로' 를
            이기지 못했다(운영 첫날 엔비디아 3개월 +19.2% 는 '그대로' 보다 7% 더 틀린 방식이었다) */}
        <p className="mt-0.5 text-xl font-semibold text-text-primary num" data-testid="기술예상">
          {돈(기간.predicted)}
          <span className={cn("ml-2 text-sm font-medium", 색.pnlColor(기간.predicted - 예측.price))}>
            {변화글(기간.predicted, 예측.price)}
          </span>
        </p>
        <p className="mt-1 text-xs text-text-secondary break-keep" data-testid="기술반영">{기술반영글(검)}</p>
        {기간.weight < 1 && (
          <p className="mt-0.5 text-2xs text-text-dim break-keep">
            기술적 신호만 보면 <span className="num">{돈(기간.signal)}({변화글(기간.signal, 예측.price)})</span> · {기간.method_label}
          </p>
        )}
        <p className="mt-1 text-2xs font-semibold text-accent-yellow break-keep">{기술시험글}</p>
      </div>

      {/* 공모주 카드처럼 — 50% 범위(띠), 예상(세로 줄), 지금(삼각) */}
      <div>
        <div className="relative h-3 rounded-full bg-bg-elevated" role="img"
          aria-label={`${오차범위 ? "50% 범위" : "비슷했던 때의 가운데 절반"} ${돈(기간.range[0])}부터 ${돈(기간.range[1])}, 예상 ${돈(기간.predicted)}, 지금 ${돈(예측.price)}`}>
          <span className="absolute inset-y-0 rounded-full bg-accent-blue/35"
            style={{ left: `${자리.절반[0]}%`, width: `${Math.max(자리.절반[1] - 자리.절반[0], 1)}%` }} />
          <span className="absolute -inset-y-0.5 w-0.5 bg-accent-blue" style={{ left: `${자리.예상}%` }} />
          <span className="absolute -top-2.5 -translate-x-1/2 text-text-primary text-2xs leading-none" style={{ left: `${자리.지금}%` }}>▼</span>
        </div>
        <p className="mt-1.5 text-xs text-text-secondary break-keep">
          {오차범위
            ? <>지난 3년 예상 오차로 본 50% 범위 <b className="num">{범위글}</b></>
            : <>지금과 지표가 비슷했던 때 {K}번 가운데 절반이 <b className="num">{범위글}</b> 사이였어요</>}
          <span className="text-text-dim"> · 지금 {돈(예측.price)}</span>
        </p>
        <p className="mt-0.5 text-xs text-text-secondary break-keep">
          지표가 비슷했던 때 {K}번 가운데 {몇번(기간.up)}번 올랐어요({확률글(기간.up)})
          <span className="text-text-dim"> · 10% 넘게 오른 때 {몇번(기간.up10)}번 · 10% 넘게 내린 때 {몇번(기간.down10)}번</span>
        </p>
      </div>

      {검 && (
        <div className="rounded-xl bg-bg-elevated px-3 py-2.5">
          <p className="text-2xs text-text-muted break-keep">
            지난 3년 매주, 그날까지의 시세만으로 {기간.label} 뒤를 맞혀 봤어요({검.n}번)
          </p>
          <table className="mt-1.5 w-full text-xs">
            <thead>
              <tr className="text-2xs text-text-dim">
                <th className="text-left font-normal">방식</th>
                <th className="text-right font-normal">평균 오차</th>
                <th className="text-right font-normal">방향 맞힘</th>
              </tr>
            </thead>
            <tbody>
              {검.methods.map((m) => (
                <tr key={m.key} className={cn(m.key === 쓴줄 ? "font-semibold text-text-primary" : "text-text-secondary")}>
                  <td className="py-0.5">{m.label}{표시(m.key) && <span className="ml-1 text-2xs text-accent-blue">{표시(m.key)}</span>}</td>
                  <td className="py-0.5 text-right num">{(m.mae * 100).toFixed(1)}%</td>
                  <td className="py-0.5 text-right num">{퍼센트(m.direction)}</td>
                </tr>
              ))}
              {쓴줄 === "반영" && (
                <tr className="font-semibold text-text-primary">
                  <td className="py-0.5">
                    {기간.method_label} {Math.round(검.weight * 100)}% 반영<span className="ml-1 text-2xs text-accent-blue">← 예상에 씀</span>
                  </td>
                  <td className="py-0.5 text-right num">{(검.mae_used * 100).toFixed(1)}%</td>
                  <td className="py-0.5 text-right num">{퍼센트(검.direction_used)}</td>
                </tr>
              )}
            </tbody>
          </table>
          {검.in50 != null && (
            <p className="mt-1.5 text-2xs text-text-dim break-keep">
              실제 주가가 50% 범위에 든 비율 {Math.round(검.in50 * 100)}% — 날마다 그날까지 알던 오차로 그은 범위로(맞다면 50% 언저리)
            </p>
          )}
        </div>
      )}

      <details className="group">
        <summary className="flex items-center gap-1 cursor-pointer list-none text-xs font-semibold text-text-secondary">
          비슷했던 때 {기간.neighbors.length}번 보기
          <ChevronDown size={14} className="text-text-dim transition-transform group-open:rotate-180" />
        </summary>
        <p className="mt-1 text-2xs text-text-dim">지표가 오늘과 가까운 차례예요</p>
        <ul className="mt-1 flex flex-col divide-y divide-border-subtle" aria-label="비슷했던 때">
          {기간.neighbors.map((n) => (
            <li key={n.date} className="flex items-center gap-2 py-1.5 text-xs">
              <span className="text-text-secondary">{년월일글(n.date)}</span>
              <span className="text-2xs text-text-dim num">
                {[n.rsi != null && `RSI ${n.rsi.toFixed(0)}`, n.gap200 != null && `200일선 ${변화글(1 + n.gap200, 1)}`]
                  .filter(Boolean).join(" · ")}
              </span>
              <span className={cn("ml-auto num font-semibold", 색.pnlColor(n.change))}>
                {기간.label} 뒤 {변화글(1 + n.change, 1)}
              </span>
            </li>
          ))}
        </ul>
      </details>

      <details className="group">
        <summary className="flex items-center gap-1 cursor-pointer list-none text-xs font-semibold text-text-secondary">
          지금 기술적 지표
          <ChevronDown size={14} className="text-text-dim transition-transform group-open:rotate-180" />
        </summary>
        {/* 휴대폰은 한 줄에 하나 — 두 칸이면 '1년 흐름(최근 1개월 빼고)' 같은 이름이 잘렸다 */}
        <ul className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1" aria-label="지금 기술적 지표">
          {기술.indicators.map((x) => (
            <li key={x.key} className={cn("flex items-baseline justify-between gap-2 text-xs", !x.used && "opacity-50")}>
              <span className="text-text-muted min-w-0 break-keep">{x.label}</span>
              <span className="num text-text-primary shrink-0">{지표값글(x.key, x.value)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-1.5 text-2xs text-text-dim break-keep">
          {/* '지수로' — 코스피로·S&P 500으로 처럼 이름마다 조사가 달라지지 않게 */}
          {기술.market ? `시장 흐름은 ${기술.market} 지수로 셈해요. ` : "시장 지수를 받지 못해 시장 흐름은 빼고 셈했어요. "}
          흐린 것은 이 종목에서 자료가 모자라 빼고 셈한 지표예요
        </p>
      </details>
    </>
  );
}
