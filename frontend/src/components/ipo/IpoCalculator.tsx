/**
 * 직접 넣어 보기 — 숫자를 넣어 시초가를 예측한다.
 *
 * 쓰임새가 둘이다.
 *   · 아직 목록에 없는 공모주(뉴스에서 본 수요예측 결과)를 넣어 본다
 *   · 목록의 공모주 숫자를 가져와 바꿔 본다 — 청약 전이면 '청약경쟁률이
 *     1,000:1 이면?' 처럼 짐작해 볼 수 있다
 *
 * 반드시 넣을 것은 수요예측 결과(공모가·기관경쟁률·확약) 셋이다. 나머지는
 * 비워 두면 그 항목 없이 견준다.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { Calculator } from "lucide-react";
import { Button, Card, INPUT_CLASS, 고른칩, 용어힌트 } from "@/components/ui";
import { ipoApi, type 공모주직접입력 } from "@/api/stocks";
import { 사람말로 } from "@/api/queryError";
import IpoPrediction from "./IpoPrediction";
import { 숫자로 } from "./ipoFormat";

/* 희망공모가는 상단만 받는다 — 예측은 '확정 공모가 ÷ 상단 − 1' 만 쓰고 하단은 쓰지 않는다.
   계산에 안 쓰이는 칸이 있으면 넣어도 결과가 그대로라 헷갈린다 */
type 칸이름 = "offer_price" | "inst_ratio" | "lockup_pct" | "sub_ratio" | "band_high" | "offer_amount_eok"
  | "float_pct" | "equal_shares" | "old_pct";
type 글값 = Record<칸이름, string>;

const 빈값: 글값 = {
  offer_price: "", inst_ratio: "", lockup_pct: "", sub_ratio: "",
  band_high: "", offer_amount_eok: "", float_pct: "", equal_shares: "", old_pct: "",
};

function 글로(v: 공모주직접입력): 글값 {
  const 글 = (n: number | null | undefined) => (n == null ? "" : String(Math.round(n * 100) / 100));
  return {
    offer_price: 글(v.offer_price), inst_ratio: 글(v.inst_ratio), lockup_pct: 글(v.lockup_pct),
    sub_ratio: 글(v.sub_ratio), band_high: 글(v.band_high),
    offer_amount_eok: 글(v.offer_amount_eok),
    float_pct: 글(v.float_pct), equal_shares: 글(v.equal_shares), old_pct: 글(v.old_pct),
  };
}

/** 넣은 글을 검사해 보낼 값으로. 틀린 곳이 있으면 [null, 칸별 안내] */
export function 검사(값: 글값): [공모주직접입력 | null, Partial<Record<칸이름, string>>] {
  const 틀림: Partial<Record<칸이름, string>> = {};
  const 수 = {} as Record<칸이름, number | null>;
  (Object.keys(값) as 칸이름[]).forEach((k) => {
    const v = 숫자로(값[k]);
    if (Number.isNaN(v)) 틀림[k] = "숫자로 넣어 주세요";
    수[k] = v != null && !Number.isNaN(v) ? v : null;
  });
  if (!틀림.offer_price && !(수.offer_price && 수.offer_price > 0)) 틀림.offer_price = "확정 공모가를 넣어 주세요";
  if (!틀림.inst_ratio && 수.inst_ratio == null) 틀림.inst_ratio = "기관경쟁률을 넣어 주세요";
  if (!틀림.lockup_pct && 수.lockup_pct == null) 틀림.lockup_pct = "확약 비율을 넣어 주세요";
  if (수.lockup_pct != null && (수.lockup_pct < 0 || 수.lockup_pct > 100)) 틀림.lockup_pct = "0~100% 사이로 넣어 주세요";
  if (수.float_pct != null && (수.float_pct <= 0 || 수.float_pct > 100)) 틀림.float_pct = "0~100% 사이로 넣어 주세요";
  if (수.old_pct != null && (수.old_pct < 0 || 수.old_pct > 100)) 틀림.old_pct = "0~100% 사이로 넣어 주세요";
  for (const k of ["inst_ratio", "sub_ratio", "equal_shares"] as const) {
    if (수[k] != null && 수[k]! < 0) 틀림[k] = "0보다 작을 수 없어요";
  }
  if (Object.keys(틀림).length) return [null, 틀림];
  return [{
    offer_price: 수.offer_price!, inst_ratio: 수.inst_ratio!, lockup_pct: 수.lockup_pct!,
    sub_ratio: 수.sub_ratio, band_high: 수.band_high,
    offer_amount_eok: 수.offer_amount_eok,
    float_pct: 수.float_pct, equal_shares: 수.equal_shares, old_pct: 수.old_pct,
  }, {}];
}

function 입력칸({ id, 이름, 단위, 값, 바꿈, 틀림, 도움말, 필수 }: {
  id: 칸이름; 이름: ReactNode; 단위: string; 값: string; 바꿈: (v: string) => void;
  틀림?: string; 도움말?: string; 필수?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={`ipo-${id}`} className="text-2xs font-semibold text-text-muted inline-flex items-center gap-1">
        {이름}{필수 && <span className="text-accent-red" aria-hidden>*</span>}
      </label>
      <div className="relative">
        <input id={`ipo-${id}`} inputMode="decimal" autoComplete="off" value={값}
          onChange={(e) => 바꿈(e.target.value)} aria-invalid={!!틀림}
          aria-describedby={틀림 ? `ipo-${id}-틀림` : undefined}
          className={`${INPUT_CLASS} pr-9 num ${틀림 ? "border-accent-red" : ""}`} />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-2xs text-text-dim">{단위}</span>
      </div>
      {틀림 ? <p id={`ipo-${id}-틀림`} className="text-2xs text-accent-red">{틀림}</p>
        : 도움말 ? <p className="text-2xs text-text-dim">{도움말}</p> : null}
    </div>
  );
}

export default function IpoCalculator({ 처음값 }: {
  /** 목록의 공모주에서 가져온 숫자. 바뀌면 칸을 다시 채운다 */
  처음값?: 공모주직접입력 | null;
}) {
  const [값, set값] = useState<글값>(빈값);
  const [종류, set종류] = useState<"normal" | "spac" | "reit">("normal");
  const [틀림, set틀림] = useState<Partial<Record<칸이름, string>>>({});
  const 예측 = useMutation({ mutationFn: (v: 공모주직접입력) => ipoApi.predict(v) });

  useEffect(() => {
    if (!처음값) return;
    set값(글로(처음값));
    set종류(처음값.kind ?? "normal");
    set틀림({});
    예측.reset();
    // 예측(mutation 객체)은 그릴 때마다 새로 와서 의존성에 넣지 않는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [처음값]);

  const 바꿈 = (k: 칸이름) => (v: string) => set값((s) => ({ ...s, [k]: v }));
  const 보내기 = (e: FormEvent) => {
    e.preventDefault();
    const [보낼것, 안내] = 검사(값);
    set틀림(안내);
    if (보낼것) 예측.mutate({ ...보낼것, kind: 종류 });
  };

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Calculator size={16} className="text-accent-blue" />
        <h2 className="text-sm font-bold text-text-primary">직접 넣어 보기</h2>
      </div>
      <p className="text-2xs text-text-muted break-keep -mt-1.5">
        수요예측 결과를 넣으면 비슷했던 공모주로 시초가를 예측해요. 청약경쟁률 등은 비워 둬도 돼요.
      </p>
      <form onSubmit={보내기} className="flex flex-col gap-3" noValidate>
        <div className="grid grid-cols-2 gap-2.5">
          <입력칸 id="offer_price" 이름="확정 공모가" 단위="원" 필수 값={값.offer_price} 바꿈={바꿈("offer_price")} 틀림={틀림.offer_price} />
          <입력칸 id="inst_ratio" 이름={<용어힌트 이름="기관경쟁률" />} 단위=":1" 필수 값={값.inst_ratio} 바꿈={바꿈("inst_ratio")} 틀림={틀림.inst_ratio} />
          <입력칸 id="lockup_pct" 이름={<용어힌트 이름="의무보유확약" />} 단위="%" 필수 값={값.lockup_pct} 바꿈={바꿈("lockup_pct")} 틀림={틀림.lockup_pct} />
          <입력칸 id="sub_ratio" 이름={<용어힌트 이름="청약경쟁률" />} 단위=":1" 값={값.sub_ratio} 바꿈={바꿈("sub_ratio")} 틀림={틀림.sub_ratio} 도움말="청약 뒤에 나와요" />
          <입력칸 id="band_high" 이름="희망공모가 상단" 단위="원" 값={값.band_high} 바꿈={바꿈("band_high")} 틀림={틀림.band_high} 도움말="확정 공모가와 견줘요" />
          <입력칸 id="offer_amount_eok" 이름="공모금액" 단위="억원" 값={값.offer_amount_eok} 바꿈={바꿈("offer_amount_eok")} 틀림={틀림.offer_amount_eok} />
          <입력칸 id="float_pct" 이름={<용어힌트 이름="유통물량" />} 단위="%" 값={값.float_pct} 바꿈={바꿈("float_pct")} 틀림={틀림.float_pct} 도움말="상장일에 팔 수 있는 몫" />
          <입력칸 id="equal_shares" 이름={<용어힌트 이름="균등배정" />} 단위="주" 값={값.equal_shares} 바꿈={바꿈("equal_shares")} 틀림={틀림.equal_shares} 도움말="계좌당 · 청약 뒤에 나와요" />
          <입력칸 id="old_pct" 이름="구주매출" 단위="%" 값={값.old_pct} 바꿈={바꿈("old_pct")} 틀림={틀림.old_pct} 도움말="공모 물량 중 기존 주주 몫" />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label="공모주 종류">
          {([["normal", "일반"], ["spac", "스팩"], ["reit", "리츠"]] as const).map(([k, 이름]) => (
            <고른칩 key={k} 고름={종류 === k} onClick={() => set종류(k)} 작게>{이름}</고른칩>
          ))}
        </div>
        <Button type="submit" disabled={예측.isPending}>{예측.isPending ? "계산하는 중…" : "예측하기"}</Button>
      </form>
      {예측.error && <p role="alert" className="text-xs text-accent-red">{사람말로(예측.error) || "예측하지 못했어요"}</p>}
      {예측.data && <IpoPrediction 예측={예측.data} />}
    </Card>
  );
}
