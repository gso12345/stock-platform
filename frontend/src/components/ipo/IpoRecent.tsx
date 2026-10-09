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
  if (!줄들.length) return null;
  const 보일것 = 다보기 ? 줄들 : 줄들.slice(0, 처음보일수);
  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-4 pt-4 pb-3 border-b border-border-subtle flex flex-col gap-2">
        <div>
          <h2 className="text-sm font-bold text-text-primary">최근 상장 — 예측과 실제</h2>
          <p className="text-2xs text-text-muted break-keep mt-0.5">
            각 공모주를 그 전에 상장한 공모주만으로 맞혀 본 결과예요.
          </p>
          {/* V·X 가 무엇을 재는지 — 예측 숫자가 가까웠는지가 아니라 범위 안에 들었는지다.
              범위는 비슷했던 공모주 가운데 절반이 시작한 구간이라, 잘 맞아도 절반쯤은 X 다 */}
          <p className="text-2xs text-text-muted break-keep mt-1.5 flex flex-wrap items-center gap-x-1">
            <Check size={11} className="text-accent-green" aria-hidden />실제 시초가가 예상 범위 안
            <span aria-hidden>·</span>
            <X size={11} className="text-text-dim" aria-hidden />범위 밖.
            <span>범위는 비슷했던 공모주 가운데 절반이 시작한 구간이라, 잘 맞아도 절반쯤은 밖에 나와요.</span>
          </p>
        </div>
        {정확도.n > 0 && (
          <div className="grid grid-cols-3 gap-2" aria-label="예측 정확도">
            <div className="rounded-lg bg-bg-elevated px-2.5 py-2">
              <p className="text-2xs text-text-muted" title="예측과 실제 시초가 수익률 차이의 가운데값">실제와 보통 차이</p>
              <p className="text-sm font-bold text-text-primary num">±{정확도.median_abs_err_pp}%p</p>
            </div>
            <div className="rounded-lg bg-bg-elevated px-2.5 py-2">
              <p className="text-2xs text-text-muted">공모가 위·아래 맞힘</p>
              <p className="text-sm font-bold text-text-primary num">{확률글(정확도.direction_hit ?? 0)}</p>
            </div>
            <div className="rounded-lg bg-bg-elevated px-2.5 py-2">
              <p className="text-2xs text-text-muted">범위 안에 든 몫</p>
              <p className="text-sm font-bold text-text-primary num">{확률글(정확도.range_hit ?? 0)}</p>
            </div>
          </div>
        )}
      </div>
      <ul className="divide-y divide-border-subtle">
        {보일것.map((r) => (
          <li key={`${r.name}-${r.list_date}`} className="px-4 py-2.5 flex items-center gap-3 text-xs">
            <div className="flex-1 min-w-0">
              {r.code
                ? <Link to={`/stocks/KR/${r.code}`} className="font-semibold text-text-primary hover:text-accent-blue truncate block">{r.name}</Link>
                : <span className="font-semibold text-text-primary truncate block">{r.name}</span>}
              <span className="text-2xs text-text-dim">{날짜글(r.list_date)} 상장 · 공모가 {원(r.offer_price)}</span>
            </div>
            <div className="flex flex-col items-end shrink-0">
              <span className="text-2xs text-text-muted">실제 {원(r.open_price)}</span>
              <등락 퍼센트={배율퍼센트(r.actual_ratio)} />
            </div>
            <div className="flex flex-col items-end shrink-0 w-[5.5rem]">
              <span className="text-2xs text-text-muted">예측</span>
              <등락 퍼센트={배율퍼센트(r.pred_ratio)} className="opacity-80" />
              <span className="text-2xs text-text-dim num whitespace-nowrap">
                범위 {퍼센트글(배율퍼센트(r.low_ratio))}~{퍼센트글(배율퍼센트(r.high_ratio))}
              </span>
            </div>
            <span className="shrink-0" title={r.in_range ? "실제가 예상 범위 안" : "실제가 예상 범위 밖"}
                  aria-label={r.in_range ? "실제가 예상 범위 안" : "실제가 예상 범위 밖"}>
              {r.in_range ? <Check size={14} className="text-accent-green" /> : <X size={14} className="text-text-dim" />}
            </span>
          </li>
        ))}
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
