/**
 * 금액 가리기.
 *
 * 내 자산 화면을 지하철에서 열면 옆자리가 내 평가금액을 그대로 본다.
 * 다른 자산 앱들이 하나같이 눈 모양 버튼을 달아 두는 이유다.
 *
 * ── 무엇을 가리고 무엇을 안 가리나 ──
 *
 * 가린다   평가금액 · 매입금액 · 평가손익 · 오늘 손익 · 배당금 · 그래프 축
 * 안 가린다 수익률(%) · 비중(%) · 현재가 · 전일대비(주당) · 보유 수량
 *
 * 퍼센트는 내가 얼마를 가졌는지 말해 주지 않는다. 현재가는 남들도 다
 * 아는 값이다. 그것까지 가리면 화면이 읽을 수 없게 되기만 하고 지켜지는
 * 건 없다.
 *
 * ── 왜 훅으로 묶었나 ──
 *
 * 금액이 그려지는 자리가 내 자산 화면에만 마흔 곳쯤 된다. 자리마다
 * `가림 ? "••••" : fmtKRWFull(v)` 를 손으로 적으면 한 곳은 반드시
 * 빠뜨린다. 그리고 빠뜨린 그 한 곳이 제일 큰 숫자일 가능성이 높다 —
 * 총 평가금액처럼 눈에 띄는 자리부터 고치기 때문이다.
 *
 * 그래서 포맷터를 감싼 것 한 벌을 주고, 부르는 쪽은 fmtKRWFull(v) 대신
 * 돈.원(v) 을 쓴다. 가리는 판단은 여기 한 곳에만 있다.
 */
import { useMemo } from "react";
import { useSettingsStore } from "@/store/settingsStore";
import { fmtKRWFull, fmtKRWFullSign, fmtKRWCompact, fmtUSDFull, fmtNative, fmtKRW } from "@/utils/formatters";

/** 가릴 때 자리에 넣는 글자.
 *
 *  길이를 금액과 비슷하게 잡는다. 너무 짧으면(예: "*") 칸이 확 줄면서
 *  옆 칸들이 밀려 배치가 흔들린다. */
export const 가린글 = "•••••";

/** 금액 포맷터 한 벌. 가리기가 켜져 있으면 전부 •••• 를 돌려준다 */
export interface 돈그리기 {
  /** 지금 가리는 중인가 — 아이콘 모양이나 aria-label 을 고를 때 쓴다 */
  가림: boolean;
  /** ₩1,234,567 */
  원: (v: number) => string;
  /** +₩1,234,567 / -₩1,234,567 */
  원부호: (v: number) => string;
  /** ₩1.23억 — 좁은 자리(그래프 축·툴팁) */
  원줄임: (v: number) => string;
  /** 1.23억 — 통화 기호 없이 */
  원짧게: (v: number | null | undefined) => string;
  /** $1,234.56 */
  달러: (v: number) => string;
  /** 종목의 표시 통화에 맞춰 */
  현지: (market: string, currency: string, v: number) => string;
  /** 이미 만들어 둔 금액 문자열을 가린다 — 위 포맷터로 안 되는 모양일 때 */
  글: (s: string) => string;
  /** 값이 아니라 '가려야 하는가' 만 필요할 때(ChangeBadge 등에 넘긴다) */
  가릴까: (내돈: boolean | undefined) => boolean;
}

/** 훅 밖(테스트·순수 계산)에서도 쓸 수 있게 판단만 따로 둔다 */
export function 돈한벌(가림: boolean): 돈그리기 {
  const 가리개 = <A extends unknown[]>(f: (...a: A) => string) =>
    (...a: A) => (가림 ? 가린글 : f(...a));
  return {
    가림,
    원:     가리개(fmtKRWFull),
    원부호: 가리개(fmtKRWFullSign),
    원줄임: 가리개(fmtKRWCompact),
    원짧게: 가리개(fmtKRW),
    달러:   가리개(fmtUSDFull),
    현지:   가리개(fmtNative),
    글:     가리개((s: string) => s),
    가릴까: (내돈) => 가림 && 내돈 === true,
  };
}

export function use돈(): 돈그리기 {
  const 가림 = useSettingsStore((s) => s.금액가리기);
  return useMemo(() => 돈한벌(가림), [가림]);
}
