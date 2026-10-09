/**
 * 최근 상장 — 예측과 실제.
 *
 * 예측을 믿어도 되는지는 지난 결과로 보여 주는 수밖에 없다. 각 공모주를
 * '그 전에 상장한 것만으로' 맞혀 본 값이라, 지금 모델이 답을 보고 맞힌
 * 것이 아니다(서버의 시간순 검증).
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, X } from "lucide-react";
import { Card } from "@/components/ui";
import type { 공모주결과, 공모주한눈에 } from "@/api/stocks";
import { 등락 } from "./IpoPrediction";
import { 원, 배율퍼센트, 퍼센트글, 날짜글, 확률글 } from "./ipoFormat";

const 처음보일수 = 8;

export default function IpoRecent({ 줄들, 정확도 }: {
  줄들: 공모주결과[];
  정확도: 공모주한눈에["accuracy"];
}) {
  const [다보기, set다보기] = useState(false);
  /** 맞힘(✓) 폭(%) — 서버가 가른 것과 같은 숫자를 적는다 */
  const 폭 = 정확도.hit_band_pct;
  // 프런트가 먼저 올라간 배포 사이 몇 분은 예전 서버가 예전 모양(범위 기준)으로 답한다 —
  // 그대로 그리면 'undefined%' 가 찍히므로 새 모양이 올 때까지 그리지 않는다
  if (!줄들.length || 폭 == null) return null;
  const 보일것 = 다보기 ? 줄들 : 줄들.slice(0, 처음보일수);
  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-4 pt-4 pb-3 border-b border-border-subtle flex flex-col gap-2">
        <div>
          <h2 className="text-sm font-bold text-text-primary">최근 상장 — 예측과 실제</h2>
          <p className="text-2xs text-text-muted break-keep mt-0.5">
            각 공모주를 그 전에 상장한 공모주만으로 맞혀 본 결과예요.
          </p>
          {/* V·X 가 무엇을 재는지 — 실제 시초가가 예측가에서 ±폭 안이었는지. 수익률 %p 로 재면
              많이 오른 공모주일수록 차이가 커 보이고, 예상 범위 안인지로 재면 잘 맞아도 절반은 X 다 */}
          <p className="text-2xs text-text-muted break-keep mt-1.5 flex flex-wrap items-center gap-x-1">
            <Check size={11} className="text-accent-green" aria-hidden />실제 시초가가 예측가의 ±{폭}% 안
            <span aria-hidden>·</span>
            <X size={11} className="text-text-dim" aria-hidden />밖.
            <span>%p 가 아니라 값으로 견줘요 — +270%와 +300%는 30%p 차이지만 값으로는 8% 차이예요.</span>
          </p>
        </div>
        {정확도.n > 0 && (
          <div className="grid grid-cols-3 gap-2" aria-label="예측 정확도">
            <div className="rounded-lg bg-bg-elevated px-2.5 py-2">
              <p className="text-2xs text-text-muted break-keep" title="예측가와 실제 시초가 차이(%)의 가운데값">실제와 보통 차이</p>
              <p className="text-sm font-bold text-text-primary num">±{정확도.median_abs_diff_pct}%</p>
            </div>
            <div className="rounded-lg bg-bg-elevated px-2.5 py-2">
              <p className="text-2xs text-text-muted break-keep">공모가 위·아래 맞힘</p>
              <p className="text-sm font-bold text-text-primary num">{확률글(정확도.direction_hit ?? 0)}</p>
            </div>
            <div className="rounded-lg bg-bg-elevated px-2.5 py-2">
              <p className="text-2xs text-text-muted break-keep">±{폭}% 안 맞힘</p>
              <p className="text-sm font-bold text-text-primary num">{확률글(정확도.hit_rate ?? 0)}</p>
            </div>
          </div>
        )}
      </div>
      <ul className="divide-y divide-border-subtle">
        {보일것.map((r) => {
          const 판정 = `실제가 예측가의 ±${폭}% ${r.hit ? "안" : "밖"}`;
          return (
            <li key={`${r.name}-${r.list_date}`} className="px-4 py-2.5 flex items-center gap-3 text-xs">
              <div className="flex-1 min-w-0">
                {r.code
                  ? <Link to={`/stocks/KR/${r.code}`} className="font-semibold text-text-primary hover:text-accent-blue truncate block">{r.name}</Link>
                  : <span className="font-semibold text-text-primary truncate block">{r.name}</span>}
                <span className="text-2xs text-text-dim break-keep">{날짜글(r.list_date)} 상장 · 공모가 {원(r.offer_price)}</span>
              </div>
              <div className="flex flex-col items-end shrink-0">
                <span className="text-2xs text-text-muted">실제 {원(r.open_price)}</span>
                <등락 퍼센트={배율퍼센트(r.actual_ratio)} />
              </div>
              {/* 줄마다 같은 폭이라 실제 칸이 줄을 맞춘다. 차이가 세 자리(+122%)면 그 줄만 넓어진다 */}
              <div className="flex flex-col items-end shrink-0 min-w-[5.5rem]">
                <span className="text-2xs text-text-muted whitespace-nowrap">예측 {원(r.pred_price)}</span>
                <등락 퍼센트={배율퍼센트(r.pred_ratio)} className="opacity-80" />
                <span className="text-2xs text-text-dim num whitespace-nowrap">예측 대비 {퍼센트글(r.diff_pct)}</span>
              </div>
              <span className="shrink-0" title={판정} aria-label={판정}>
                {r.hit ? <Check size={14} className="text-accent-green" /> : <X size={14} className="text-text-dim" />}
              </span>
            </li>
          );
        })}
      </ul>
      {줄들.length > 처음보일수 && (
        <button type="button" onClick={() => set다보기((v) => !v)}
          className="w-full py-2.5 text-xs font-semibold text-text-secondary hover:text-accent-blue border-t border-border-subtle">
          {다보기 ? "접기" : `${줄들.length - 처음보일수}곳 더 보기`}
        </button>
      )}
    </Card>
  );
}
