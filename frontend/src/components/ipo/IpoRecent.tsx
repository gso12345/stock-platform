/**
 * 최근 상장 — 예측과 실제.
 *
 * 예측을 믿어도 되는지는 지난 결과로 보여 주는 수밖에 없다. 각 공모주를
 * '그 전에 상장한 것만으로' 맞혀 본 값이라, 지금 모델이 답을 보고 맞힌
 * 것이 아니다(서버의 시간순 검증).
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, Search, X } from "lucide-react";
import { Card, INPUT_CLASS, cn } from "@/components/ui";
import type { 공모주결과, 공모주방식성적, 공모주한눈에, 공모주따블점검 } from "@/api/stocks";
import { 등락 } from "./IpoPrediction";
import { 원, 배율퍼센트, 퍼센트글, 날짜글, 확률글 } from "./ipoFormat";

/** 처음에 보일 곳 수 — 나머지(서버가 맞혀 본 최근 100곳까지)는 '더 보기' 로 */
const 처음보일수 = 15;

/** 이름 견주기 — 띄어쓰기·대소문자를 가리지 않는다('에이비씨 바이오' 로 찾아도 '에이비씨바이오') */
export function 이름으로(이름: string): string {
  return 이름.replace(/\s+/g, "").toLowerCase();
}

/** 따블 확률 점검 — 사용자: "따블확률점검도 해줘".
 *
 *  카드의 '따블 이상으로 시작 23%' 가 지난 공모주에서 실제로 그만큼 맞았나. 그날 고른 방식이 낸
 *  확률을 구간으로 묶고, 그 구간의 공모주가 실제로 따블이었던 비율과 견준다. 기본은 한 줄만 —
 *  표는 펼쳤을 때 */
function 따블점검({ 점검 }: { 점검: 공모주따블점검 }) {
  const [펼침, set펼침] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-2xs text-text-muted break-keep">
        따블 확률 점검 — 예측 평균 <b className="text-text-primary num">{확률글(점검.predicted ?? 0)}</b>
        {" · "}실제 따블 <b className="text-text-primary num">{확률글(점검.actual ?? 0)}</b>{" "}
        <button type="button" onClick={() => set펼침((v) => !v)} aria-expanded={펼침}
          aria-label={펼침 ? "따블 확률 점검 접기" : "따블 확률 점검 구간별로 보기"}
          className="font-semibold text-accent-blue hover:underline">
          {펼침 ? "접기" : "구간별로 보기"}
        </button>
      </p>
      {펼침 && (
        <div className="rounded-lg bg-bg-elevated px-2.5 py-2 flex flex-col gap-1.5">
          <table className="w-full text-2xs" aria-label="따블 확률 점검">
            <thead>
              <tr className="text-text-muted">
                <th className="text-left font-medium py-1">예측한 따블 확률</th>
                <th className="text-right font-medium py-1">곳</th>
                <th className="text-right font-medium py-1">예측 평균</th>
                <th className="text-right font-medium py-1">실제 따블</th>
              </tr>
            </thead>
            <tbody>
              {점검.bins.map((b) => (
                <tr key={b.from} className="border-t border-border/40 text-text-secondary">
                  <td className="py-1 num">{b.from}~{b.to}%</td>
                  <td className="py-1 text-right num">{b.n}곳</td>
                  <td className="py-1 text-right num">{확률글(b.predicted)}</td>
                  <td className="py-1 text-right num font-semibold text-text-primary">{확률글(b.actual)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-2xs text-text-dim break-keep">
            지난 {점검.n}곳을 그 전 공모주만으로 맞혔을 때예요. 예측한 확률과 실제 따블 비율이 가까울수록
            ‘따블 이상으로 시작’ 확률을 믿을 만해요.
          </p>
        </div>
      )}
    </div>
  );
}

/** 지금 쓰는 방식과 방식마다의 성적.
 *
 *  위 요약 숫자는 공모주마다 '그 전에 가장 잘 맞아 온 방식' 을 골라 쓴 결과다. 표는
 *  같은 공모주들을 방식 하나로만 맞혔을 때라, 표에서 가장 좋은 줄을 보고 고르면
 *  답을 보고 고르는 셈이 된다 — 그래서 고르기는 늘 그 전 결과로만 한다. */
function 방식설명({ 지금, 방식들, 폭 }: {
  지금: NonNullable<공모주한눈에["accuracy"]["method"]>;
  방식들: 공모주방식성적[];
  폭: number;
}) {
  const [펼침, set펼침] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-2xs text-text-muted break-keep">
        지금은 <b className="text-text-primary font-semibold">{지금.name}</b> 방식으로 예측해요 —
        직전 {지금.pick_window}곳에서 가장 잘 맞았어요.{" "}
        <button type="button" onClick={() => set펼침((v) => !v)} aria-expanded={펼침}
          className="font-semibold text-accent-blue hover:underline">
          {펼침 ? "접기" : "방식별로 보기"}
        </button>
      </p>
      {펼침 && (
        <div className="rounded-lg bg-bg-elevated px-2.5 py-2 flex flex-col gap-1.5">
          <table className="w-full text-2xs">
            <thead>
              <tr className="text-text-muted">
                <th className="text-left font-medium py-1">방식</th>
                <th className="text-right font-medium py-1">±{폭}% 안 맞힘</th>
                <th className="text-right font-medium py-1">보통 차이</th>
              </tr>
            </thead>
            <tbody>
              {방식들.map((m) => (
                <tr key={m.key} className={`border-t border-border/40 ${m.key === 지금.key ? "text-text-primary font-semibold" : "text-text-secondary"}`}>
                  <td className="py-1 break-keep">{m.name}</td>
                  <td className="py-1 text-right num">{m.hit_rate == null ? "—" : 확률글(m.hit_rate)}</td>
                  <td className="py-1 text-right num">{m.median_abs_diff_pct == null ? "—" : `±${m.median_abs_diff_pct}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-2xs text-text-dim break-keep">
            같은 공모주들을 방식 하나로만 맞혔을 때예요. 위 숫자는 공모주마다 그 전 {지금.pick_window}곳에서
            가장 잘 맞던 방식을 골라 쓴 결과예요 — 답을 보고 고르지 않으려고 늘 그 전 결과로만 골라요.
          </p>
        </div>
      )}
    </div>
  );
}

export default function IpoRecent({ 줄들, 정확도 }: {
  줄들: 공모주결과[];
  정확도: 공모주한눈에["accuracy"];
}) {
  const [다보기, set다보기] = useState(false);
  const [찾기, set찾기] = useState("");
  /** 맞힘(✓) 폭(%) — 서버가 가른 것과 같은 숫자를 적는다 */
  const 폭 = 정확도.hit_band_pct;
  // 프런트가 먼저 올라간 배포 사이 몇 분은 예전 서버가 예전 모양(범위 기준)으로 답한다 —
  // 그대로 그리면 'undefined%' 가 찍히므로 새 모양이 올 때까지 그리지 않는다
  if (!줄들.length || 폭 == null) return null;
  const 찾는말 = 이름으로(찾기);
  // 찾는 동안은 맞는 것을 모두 — '더 보기' 뒤에 있던 것까지
  const 보일것 = 찾는말 ? 줄들.filter((r) => 이름으로(r.name).includes(찾는말))
    : 다보기 ? 줄들 : 줄들.slice(0, 처음보일수);
  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-4 pt-4 pb-3 border-b border-border-subtle flex flex-col gap-2">
        <div>
          <h2 className="text-sm font-bold text-text-primary">최근 상장 — 예측과 실제</h2>
          <p className="text-2xs text-text-muted break-keep mt-0.5">
            각 공모주를 그 전에 상장한 공모주만으로 맞혀 본 결과예요.
          </p>
          {/* V·X 가 무엇을 재는지 — 실제 시초가가 예측가에서 ±폭 안이었는지. 왜 %p 가 아니라 값으로
              견주는지는 '어떻게 예측하나요?' 에 적었다(여기 두면 목록보다 설명이 먼저 읽힌다) */}
          {/* 아이콘과 그 뜻은 한 덩어리 — 따로 줄바꿈되면 ✗ 만 윗줄 끝에 남는다 */}
          <p className="text-2xs text-text-muted break-keep mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              <Check size={11} className="text-accent-green" aria-hidden />실제 시초가가 예측가의 ±{폭}% 안
            </span>
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              <X size={11} className="text-text-dim" aria-hidden />밖
            </span>
            <span className="text-text-dim">아이콘 아래 숫자는 예측가와의 차이</span>
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
        {/* 위 숫자는 청약 결과까지 넣고 맞힌 값이다. 청약할지 정하는 때(청약 전)의 예측은 더 빗나간다 */}
        {정확도.n > 0 && 정확도.pre_sub && 정확도.pre_sub.n > 0 && 정확도.pre_sub.hit_rate != null && (
          <p className="text-2xs text-text-muted break-keep">
            청약 전에 본 예측(청약경쟁률 없이)만 보면 ±{폭}% 안 <b className="text-text-primary num">{확률글(정확도.pre_sub.hit_rate)}</b>
            {정확도.pre_sub.median_abs_diff_pct != null && <> · 보통 차이 <b className="text-text-primary num">±{정확도.pre_sub.median_abs_diff_pct}%</b></>}
          </p>
        )}
        {정확도.n > 0 && 정확도.method && 정확도.methods?.length
          ? <방식설명 지금={정확도.method} 방식들={정확도.methods} 폭={폭} /> : null}
        {정확도.n > 0 && 정확도.double_check && 정확도.double_check.n > 0 && <따블점검 점검={정확도.double_check} />}
      </div>
      {/* "최근상장에서 이름찾기" — 100곳 가운데 하나를 찾으려면 끝까지 내려야 했다 */}
      <div className="px-4 py-2 border-b border-border-subtle flex items-center gap-1.5">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-dim pointer-events-none" aria-hidden />
          <input value={찾기} onChange={(e) => set찾기(e.target.value)} placeholder="이름으로 찾기"
            aria-label="최근 상장에서 이름으로 찾기" className={cn(INPUT_CLASS, "pl-8 py-1.5 text-xs")} />
        </div>
        {찾기 && (
          <button type="button" onClick={() => set찾기("")} aria-label="찾는 이름 지우기"
            className="p-1.5 rounded-lg text-text-dim hover:text-text-primary">
            <X size={13} />
          </button>
        )}
      </div>
      {찾는말 && !보일것.length && (
        <p className="px-4 py-4 text-xs text-text-muted break-keep">
          ‘{찾기.trim()}’에 맞는 공모주가 최근 {줄들.length}곳에 없어요.
        </p>
      )}
      <ul className="divide-y divide-border-subtle">
        {보일것.map((r) => {
          const 판정 = `실제가 예측가의 ±${폭}% ${r.hit ? "안" : "밖"} — 예측가 대비 ${퍼센트글(r.diff_pct)}`;
          return (
            <li key={`${r.name}-${r.list_date}`} className="px-4 py-2 flex items-center gap-3 text-xs">
              <div className="flex-1 min-w-0">
                {r.code
                  ? <Link to={`/stocks/KR/${r.code}`} className="font-semibold text-text-primary hover:text-accent-blue truncate block">{r.name}</Link>
                  : <span className="font-semibold text-text-primary truncate block">{r.name}</span>}
                <span className="text-2xs text-text-dim break-keep">{날짜글(r.list_date)} 상장 · 공모가 {원(r.offer_price)}</span>
              </div>
              {/* 실제·예측을 두 줄로 — 가격 옆에 공모가 대비 오르내림 */}
              <div className="flex flex-col items-end shrink-0 text-2xs whitespace-nowrap">
                <span className="text-text-muted">실제 {원(r.open_price)} <등락 퍼센트={배율퍼센트(r.actual_ratio)} /></span>
                <span className="text-text-dim">예측 {원(r.pred_price)} <등락 퍼센트={배율퍼센트(r.pred_ratio)} className="opacity-80" /></span>
              </div>
              {/* 맞힘과 예측가와의 차이 — 같은 너비라 줄이 맞는다 */}
              <span className="shrink-0 w-10 flex flex-col items-center" title={판정} aria-label={판정}>
                {r.hit ? <Check size={14} className="text-accent-green" /> : <X size={14} className="text-text-dim" />}
                <span className="text-2xs text-text-dim num" aria-hidden>{퍼센트글(r.diff_pct)}</span>
              </span>
            </li>
          );
        })}
      </ul>
      {!찾는말 && 줄들.length > 처음보일수 && (
        <button type="button" onClick={() => set다보기((v) => !v)}
          className="w-full py-2.5 text-xs font-semibold text-text-secondary hover:text-accent-blue border-t border-border-subtle">
          {다보기 ? "접기" : `${줄들.length - 처음보일수}곳 더 보기`}
        </button>
      )}
    </Card>
  );
}
