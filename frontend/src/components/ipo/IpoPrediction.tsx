/**
 * 시초가 예측 한 건을 그린다 — 다가오는 공모주 카드와 '직접 넣어 보기' 가 같이 쓴다.
 *
 * 숫자 하나만 크게 두면 그게 답처럼 읽힌다. 실제로는 비슷했던 공모주들도
 * 넓게 흩어져 시작했다. 그래서 예상값 옆에 '그들 가운데 절반이 시작한 범위'
 * 를 막대로 같이 그리고, 그 공모주들을 직접 펼쳐 볼 수 있게 한다.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useSettingsStore } from "@/store/settingsStore";
import { cn, 용어힌트 } from "@/components/ui";
import type { 공모주예측 } from "@/api/stocks";
import { 원, 배율퍼센트, 퍼센트글, 경쟁률글, 확약글, 날짜글, 확률글 } from "./ipoFormat";

const 하한 = 0.6;
const 상한 = 4.0;

/** 설정의 색 규칙(빨강↑파랑↓ / 초록↑빨강↓)을 따른 등락 글자 */
export function 등락({ 퍼센트, className }: { 퍼센트: number; className?: string }) {
  const 색규칙 = useSettingsStore((s) => s.colorScheme);
  const 색 = 퍼센트 === 0 ? "text-text-secondary"
    : 퍼센트 > 0 ? (색규칙 === "red-blue" ? "text-accent-red" : "text-accent-green")
    : (색규칙 === "red-blue" ? "text-accent-blue" : "text-accent-red");
  return <span className={cn("font-mono font-semibold num", 색, className)}>{퍼센트글(퍼센트)}</span>;
}

/** 공모가의 60%~400% 를 로그 눈금으로 펴 놓은 막대 위에 범위와 예상값을 찍는다 */
function 범위막대({ 배율, 낮음, 높음 }: { 배율: number; 낮음: number; 높음: number }) {
  const 자리 = (r: number) =>
    ((Math.log(Math.min(Math.max(r, 하한), 상한)) - Math.log(하한)) / (Math.log(상한) - Math.log(하한))) * 100;
  const 설명 = `예상 시초가는 공모가의 ${배율.toFixed(2)}배. 비슷했던 공모주 절반은 ` +
    `${낮음.toFixed(2)}배에서 ${높음.toFixed(2)}배 사이에서 시작했다`;
  return (
    <div role="img" aria-label={설명} className="flex flex-col gap-1">
      <div className="relative h-2 rounded-full bg-bg-elevated">
        <div className="absolute inset-y-0 rounded-full bg-accent-blue/30"
             style={{ left: `${자리(낮음)}%`, width: `${Math.max(자리(높음) - 자리(낮음), 1)}%` }} />
        {[1, 2].map((r) => (
          <div key={r} className="absolute -inset-y-1 w-px bg-text-dim/50" style={{ left: `${자리(r)}%` }} />
        ))}
        <div className="absolute top-1/2 w-3 h-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-blue border-2 border-bg-card"
             style={{ left: `${자리(배율)}%` }} />
      </div>
      <div className="relative h-3.5 text-2xs text-text-dim">
        <span className="absolute left-0">60%</span>
        <span className="absolute -translate-x-1/2" style={{ left: `${자리(1)}%` }}>공모가</span>
        <span className="absolute -translate-x-1/2" style={{ left: `${자리(2)}%` }}>2배</span>
        <span className="absolute right-0">4배</span>
      </div>
    </div>
  );
}

export default function IpoPrediction({ 예측, className }: { 예측: 공모주예측; className?: string }) {
  const [이웃보기, set이웃보기] = useState(false);
  if (!예측.ok) {
    return (
      <div className={cn("rounded-lg bg-bg-elevated px-3 py-2.5 text-xs text-text-muted break-keep", className)}>
        {예측.reason}
      </div>
    );
  }
  const { range: 범위 } = 예측;
  const 청약없음 = 예측.missing.includes("청약경쟁률");
  const 보정 = 예측.parts.correction_pct ?? 0;
  return (
    <div className={cn("rounded-xl border border-accent-blue/25 bg-accent-blue/5 p-3 flex flex-col gap-2.5", className)}>
      <div className="flex items-end justify-between gap-2 flex-wrap">
        <div className="flex flex-col">
          <span className="text-2xs font-semibold text-text-muted inline-flex items-center gap-1">
            예상 <용어힌트 이름="시초가" />
          </span>
          <span className="text-xl font-bold text-text-primary num" data-testid="예상시초가">{원(예측.price)}</span>
        </div>
        <span className="text-sm">공모가 대비 <등락 퍼센트={배율퍼센트(예측.ratio)} /></span>
      </div>

      <범위막대 배율={예측.ratio} 낮음={범위.low_ratio} 높음={범위.high_ratio} />
      <p className="text-xs text-text-secondary break-keep">
        비슷했던 공모주 가운데 절반이 <b className="text-text-primary num">{원(범위.low_price)}~{원(범위.high_price)}</b>
        {" "}(<등락 퍼센트={배율퍼센트(범위.low_ratio)} /> ~ <등락 퍼센트={배율퍼센트(범위.high_ratio)} />)에서 시작했어요.
      </p>
      {/* 최근 오차 보정 — 범위는 비슷했던 공모주가 실제로 시작한 값이라 그대로 두고, 예상값만 옮겼다.
          그래서 점이 범위 밖에 찍힐 수 있다 — 왜 그런지 여기 적는다 */}
      {!!보정 && (
        <p className="text-2xs text-text-muted break-keep">
          요즘 공모주가 예측보다 {보정 > 0 ? "높게" : "낮게"} 시작하고 있어서 예상을
          {" "}<b className="text-text-primary num">{Math.abs(보정)}%</b> {보정 > 0 ? "올려" : "내려"} 잡았어요.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-bg-card border border-border px-2.5 py-2">
          <p className="text-2xs text-text-muted inline-flex items-center gap-1"><용어힌트 이름="따블" /> 이상으로 시작</p>
          <p className="text-sm font-bold text-text-primary num">{확률글(예측.p_double)}</p>
        </div>
        <div className="rounded-lg bg-bg-card border border-border px-2.5 py-2">
          <p className="text-2xs text-text-muted">공모가 아래로 시작</p>
          <p className="text-sm font-bold text-text-primary num">{확률글(예측.p_below)}</p>
        </div>
      </div>

      {청약없음 && (
        <p className="text-2xs text-text-muted break-keep">청약 전이라 청약경쟁률 없이 계산했어요. 청약이 끝나면 다시 계산해요.</p>
      )}

      <button type="button" onClick={() => set이웃보기((v) => !v)} aria-expanded={이웃보기}
        className="self-start inline-flex items-center gap-1 text-xs font-semibold text-accent-blue hover:underline">
        비슷했던 공모주 {예측.neighbors.length}곳 {이웃보기 ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>
      {이웃보기 && (
        <ul className="flex flex-col divide-y divide-border-subtle rounded-lg border border-border bg-bg-card">
          {예측.neighbors.map((n) => (
            <li key={`${n.name}-${n.list_date}`} className="px-2.5 py-2 flex items-center gap-2 text-xs">
              <div className="flex-1 min-w-0">
                {n.code
                  ? <Link to={`/stocks/KR/${n.code}`} className="font-semibold text-text-primary hover:text-accent-blue truncate block">{n.name}</Link>
                  : <span className="font-semibold text-text-primary truncate block">{n.name}</span>}
                <span className="text-2xs text-text-dim">
                  {날짜글(n.list_date)} 상장 · 기관 {경쟁률글(n.inst_ratio)} · 확약 {확약글(n.lockup_pct)}
                  {n.sub_ratio != null && <> · 청약 {경쟁률글(n.sub_ratio)}</>}
                </span>
              </div>
              <등락 퍼센트={배율퍼센트(n.ratio)} />
            </li>
          ))}
        </ul>
      )}
      <p className="text-2xs text-text-dim break-keep">
        견준 항목: {예측.used.join(" · ")} · 지난 공모주 {예측.n_train}건
        {예측.method && <> · 방식 {예측.method.name}</>}
      </p>
    </div>
  );
}
