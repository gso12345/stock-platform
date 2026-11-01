/**
 * 공모주 일정을 내 캘린더로.
 *
 *   · 구독 — 한 번 걸어 두면 새 공모주의 청약일·상장일이 캘린더에 저절로 생긴다(앱을 안 열어도).
 *     고른 증권사가 있으면 그 증권사가 주관하는 공모주만(청약은 계좌가 있는 증권사로만 한다) —
 *     '모든 공모주' 로 바꿔 걸 수도 있다.
 *   · 한 곳만 — 카드마다 그 공모주의 청약·상장을 구글 캘린더나 캘린더 파일로.
 *
 * 아이폰·맥은 webcal:// 을 누르면 '구독' 을 띄우고, 구글은 '주소로 추가' 를 띄운다.
 */
import { useState } from "react";
import { CalendarPlus, Check, Copy } from "lucide-react";
import { 시트, 고른칩 } from "@/components/ui";
import type { 다가오는공모주 } from "@/api/stocks";
import { 공모주캘린더주소, 구글구독주소, 구글일정주소, webcal주소 } from "@/utils/캘린더";
import { 날짜글 } from "./ipoFormat";
import { 증권사들 } from "./ipoBrokers";

const 줄단추 = "flex items-center justify-between gap-3 px-4 py-3 text-sm text-text-primary hover:bg-bg-elevated transition-colors";

/** 공모주 일정 구독 — 다가오는 공모주 머리에 붙는다.
 *  증권사를 골랐으면 '고른 증권사 것만'(기본)과 '모든 공모주' 가운데 고른다 — 캘린더로도 다른 증권사
 *  청약 일정까지 보고 싶을 수 있다(알림은 내 증권사 것만 받더라도) */
export function 공모주구독단추({ 증권사 }: { 증권사: string[] }) {
  const [열림, set열림] = useState(false);
  const [복사함, set복사함] = useState(false);
  const [모두, set모두] = useState(false);
  const 고른것만 = 증권사.length > 0 && !모두;
  const 주소 = 공모주캘린더주소({ 증권사: 고른것만 ? 증권사 : [] });
  const 복사 = async () => {
    try {
      await navigator.clipboard.writeText(주소);
      set복사함(true);
      setTimeout(() => set복사함(false), 2000);
    } catch {
      /* 복사를 막은 브라우저 — 주소가 시트에 그대로 보이니 길게 눌러 복사하면 된다 */
    }
  };
  return (
    <>
      <button type="button" onClick={() => set열림(true)}
        className="inline-flex items-center gap-1 text-xs font-semibold text-text-secondary hover:text-accent-blue">
        <CalendarPlus size={13} />내 캘린더로
      </button>
      <시트 열림={열림} 닫기={() => set열림(false)} 제목="공모주 일정을 내 캘린더로">
        <div className="flex flex-col">
          <p className="px-4 pt-3 pb-2 text-xs text-text-secondary leading-relaxed break-keep">
            한 번 걸어 두면 새 공모주의 <b className="text-text-primary">청약일·상장일</b>이 캘린더에 저절로 생겨요.
            {고른것만
              ? <> 고른 증권사(<b className="text-text-primary">{증권사.join(" · ")}</b>)가 주관하는 공모주만 넣어요.</>
              : 증권사.length
                ? <> 모든 증권사의 공모주를 넣어요.</>
                : <> 증권사를 고르면 그 증권사 공모주만 넣을 수 있어요.</>}
          </p>
          {증권사.length > 0 && (
            <div role="group" aria-label="캘린더에 넣을 공모주" className="flex gap-1.5 px-4 pb-2">
              <고른칩 작게 고름={고른것만} onClick={() => set모두(false)}>고른 증권사 것만</고른칩>
              <고른칩 작게 고름={!고른것만} onClick={() => set모두(true)}>모든 공모주</고른칩>
            </div>
          )}
          <a href={webcal주소(주소)} className={줄단추}>
            <span>아이폰·맥 캘린더로 구독</span><CalendarPlus size={16} className="text-text-muted" />
          </a>
          <a href={구글구독주소(주소)} target="_blank" rel="noopener noreferrer" className={줄단추}>
            <span>구글 캘린더로 구독</span><CalendarPlus size={16} className="text-text-muted" />
          </a>
          <button type="button" onClick={복사} className={줄단추}>
            <span>{복사함 ? "복사했어요" : "주소 복사(다른 캘린더 앱)"}</span>
            {복사함 ? <Check size={16} className="text-accent-green" /> : <Copy size={16} className="text-text-muted" />}
          </button>
          <p className="px-4 pt-1 pb-4 text-2xs text-text-dim break-all">{주소}</p>
        </div>
      </시트>
    </>
  );
}

/** 이 공모주의 청약·상장을 캘린더에 — 카드의 일정 줄 옆에 붙는다. 날짜가 하나도 없으면 안 그린다 */
export function 공모주일정단추({ 공모주: g }: { 공모주: 다가오는공모주 }) {
  const [열림, set열림] = useState(false);
  if (!g.sub_start && !g.list_date) return null;
  const 주관 = 증권사들(g.underwriter).join(" · ");
  const 공모가 = g.offer_price != null ? `확정 공모가 ${g.offer_price.toLocaleString("ko-KR")}원` : null;
  const 설명 = (무엇: string) => [공모가, 무엇 === "청약" && 주관 ? `주관사 ${주관}` : null,
    무엇 === "청약" ? "청약은 보통 마지막 날 오후 4시에 마감해요." : null].filter(Boolean).join("\n");
  return (
    <>
      <button type="button" onClick={() => set열림(true)} aria-label={`${g.name} 일정을 캘린더에 넣기`}
        className="inline-flex items-center gap-0.5 text-2xs font-semibold text-text-muted hover:text-accent-blue align-middle">
        <CalendarPlus size={11} />캘린더
      </button>
      <시트 열림={열림} 닫기={() => set열림(false)} 제목={`${g.name} 일정을 캘린더에`}>
        <div className="flex flex-col pb-3">
          {g.sub_start && (
            <a className={줄단추} target="_blank" rel="noopener noreferrer"
              href={구글일정주소({ 제목: `[청약] ${g.name}`, 시작: g.sub_start, 끝: g.sub_end ?? g.sub_start, 설명: 설명("청약") })}>
              <span>청약 {날짜글(g.sub_start)}~{날짜글(g.sub_end ?? g.sub_start)} · 구글 캘린더에 넣기</span>
              <CalendarPlus size={16} className="text-text-muted shrink-0" />
            </a>
          )}
          {g.list_date && (
            <a className={줄단추} target="_blank" rel="noopener noreferrer"
              href={구글일정주소({ 제목: `[상장] ${g.name}`, 시작: g.list_date, 설명: 설명("상장") })}>
              <span>상장 {날짜글(g.list_date)} · 구글 캘린더에 넣기</span>
              <CalendarPlus size={16} className="text-text-muted shrink-0" />
            </a>
          )}
          <a className={줄단추} href={공모주캘린더주소({ 이름: g.name })}>
            <span>캘린더 파일 받기 <span className="text-text-muted text-xs">아이폰·삼성·아웃룩</span></span>
            <CalendarPlus size={16} className="text-text-muted shrink-0" />
          </a>
          <p className="px-4 pt-1 text-2xs text-text-dim break-keep">
            청약 첫날 아침 8시 30분, 상장일 아침 9시에 알려 줘요(캘린더 파일). 일정이 바뀌면 다시 받으면 고쳐져요.
          </p>
        </div>
      </시트>
    </>
  );
}
