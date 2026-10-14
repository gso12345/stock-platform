/**
 * 다가오는 공모주 한 곳 — 지금 어느 단계인지, 나온 숫자들, 시초가 예측.
 *
 * 수요예측 전·청약 전처럼 숫자가 덜 나온 공모주도 그대로 보여 준다. 예측이
 * 안 되면 왜 안 되는지(무엇이 나오면 되는지)를 그 자리에 적는다 — 빈칸으로
 * 두면 고장 난 줄 안다.
 */
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { SlidersHorizontal } from "lucide-react";
import { Card, Badge, 용어힌트 } from "@/components/ui";
import type { 다가오는공모주, 공모주직접입력, 공모주청약전성적 } from "@/api/stocks";
import IpoPrediction from "./IpoPrediction";
import { 원, 경쟁률글, 확약글, 주글, 억원글, 날짜글, 남은날 } from "./ipoFormat";
import { 증권사들 } from "./ipoBrokers";
import { 청약표 } from "./ipoSchedule";

const 단계색: Record<string, "default" | "blue" | "green" | "yellow" | "purple"> = {
  "수요예측 전": "default",
  "수요예측 완료": "yellow",
  "청약 예정": "yellow",
  "청약 완료": "blue",
  "상장 예정": "green",
  "상장": "green",
};

function 칸({ 이름, children }: { 이름: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col min-w-0">
      <dt className="text-2xs text-text-muted inline-flex items-center gap-1">{이름}</dt>
      <dd className="text-sm font-semibold text-text-primary num truncate">{children}</dd>
    </div>
  );
}

/** 지금 볼 일정 한 줄 — 청약이 잡혔으면 청약·상장, 아니면 수요예측 */
export function 일정글(g: 다가오는공모주): string {
  const 조각: string[] = [];
  if (g.sub_start) 조각.push(`청약 ${날짜글(g.sub_start)}~${날짜글(g.sub_end)}`);
  else if (g.forecast_date) 조각.push(`수요예측 ${날짜글(g.forecast_date)}`);
  if (g.list_date) 조각.push(`상장 ${날짜글(g.list_date)}`);
  return 조각.join(" · ") || "일정 미정";
}

/** 이 공모주의 숫자로 '직접 넣어 보기' 를 채울 값 */
export function 입력값으로(g: 다가오는공모주): 공모주직접입력 | null {
  if (g.offer_price == null || g.inst_ratio == null || g.lockup_pct == null) return null;
  return {
    offer_price: g.offer_price, inst_ratio: g.inst_ratio, lockup_pct: g.lockup_pct,
    sub_ratio: g.sub_ratio, band_low: g.band_low, band_high: g.band_high,
    offer_amount_eok: g.offer_amount != null ? g.offer_amount / 100 : null,
    float_pct: g.float_pct ?? null, equal_shares: g.equal_shares ?? null, old_pct: g.old_pct ?? null,
    kind: g.kind ?? "normal",
  };
}

export default function IpoCard({ 공모주: g, 바꿔보기, 청약전, 폭 }: {
  공모주: 다가오는공모주;
  /** 이 공모주 숫자로 계산기를 채운다(청약경쟁률을 미리 짐작해 보는 등) */
  바꿔보기?: (v: 공모주직접입력) => void;
  /** 청약 전에 본 예측의 지난 성적과 맞힘 폭(%) — 청약 전 카드에 붙인다 */
  청약전?: 공모주청약전성적;
  폭?: number;
}) {
  const 상장까지 = 남은날(g.list_date);
  const 날표 = 상장까지 == null ? "" : 상장까지 > 0 ? ` D-${상장까지}` : 상장까지 === 0 ? " 오늘" : "";
  // 청약 중이면(오늘·내일 마감) 단계보다 그게 먼저다. 청약을 기다리는 중이면 며칠 남았는지
  const 청약 = 청약표(g);
  const 청약배지 = 청약 && (청약.급함 || g.stage === "청약 예정") ? 청약 : null;
  const 공모가글 = g.offer_price != null ? 원(g.offer_price)
    : g.band_low != null && g.band_high != null ? `${g.band_low.toLocaleString("ko-KR")}~${원(g.band_high)}`
    : "—";
  const 넣을값 = 입력값으로(g);
  const 주관사 = 증권사들(g.underwriter);
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            {g.code
              ? <Link to={`/stocks/KR/${g.code}`} className="text-base font-bold text-text-primary hover:text-accent-blue truncate">{g.name}</Link>
              : <h3 className="text-base font-bold text-text-primary truncate">{g.name}</h3>}
            {g.kind === "spac" && <Badge variant="purple">스팩</Badge>}
            {g.kind === "reit" && <Badge variant="purple">리츠</Badge>}
            {g.market && <Badge>{g.market}</Badge>}
          </div>
          <p className="text-xs text-text-secondary num mt-1">{일정글(g)}</p>
          {주관사.length > 0 && <p className="text-2xs text-text-dim mt-0.5 truncate">주관사 {주관사.join(" · ")}</p>}
        </div>
        {청약배지
          ? <Badge variant={청약배지.급함 ? "red" : "yellow"}>{청약배지.글}</Badge>
          : <Badge variant={단계색[g.stage] ?? "default"}>{g.stage}{날표}</Badge>}
      </div>

      {/* 수요예측·청약 결과는 나온 것만(단계 배지가 아직인 것을 말해 준다). 날짜는 위 한 줄에 */}
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-2">
        <칸 이름={g.offer_price != null ? "확정 공모가" : <용어힌트 이름="희망공모가" />}>{공모가글}</칸>
        {g.inst_ratio != null && <칸 이름={<용어힌트 이름="기관경쟁률" />}>{경쟁률글(g.inst_ratio)}</칸>}
        {g.lockup_pct != null && <칸 이름={<용어힌트 이름="의무보유확약" />}>{확약글(g.lockup_pct)}</칸>}
        {g.sub_ratio != null && <칸 이름={<용어힌트 이름="청약경쟁률" />}>{경쟁률글(g.sub_ratio)}</칸>}
        <칸 이름="공모금액">{억원글(g.offer_amount)}</칸>
        {/* 상세 페이지에서 읽은 것 — 읽었을 때만(못 읽은 칸을 '—' 로 늘어놓지 않는다) */}
        {g.float_pct != null && <칸 이름={<용어힌트 이름="유통물량" />}>{확약글(g.float_pct)}</칸>}
        {g.equal_shares != null && <칸 이름={<용어힌트 이름="균등배정" />}>{주글(g.equal_shares)}</칸>}
        {g.prop_ratio != null && <칸 이름={<용어힌트 이름="비례경쟁률" />}>{경쟁률글(g.prop_ratio)}</칸>}
        {/* 서버는 읽고 견주는 데도 썼는데('견준 항목') 카드에 칸이 없어 안 보였다 */}
        {g.old_pct != null && <칸 이름={<용어힌트 이름="구주매출" />}>{g.old_pct === 0 ? "없음" : 확약글(g.old_pct)}</칸>}
      </dl>

      <IpoPrediction 예측={g.prediction} 공모가={g.offer_price}
        청약전={청약전} 폭={폭} 덧단추={바꿔보기 && 넣을값 ? (
        <button type="button" onClick={() => 바꿔보기(넣을값)}
          className="inline-flex items-center gap-1 text-xs font-semibold text-text-secondary hover:text-accent-blue">
          <SlidersHorizontal size={13} />이 숫자로 직접 바꿔 보기
        </button>
      ) : undefined} />
    </Card>
  );
}
