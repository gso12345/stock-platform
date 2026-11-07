/**
 * 대화 화면의 시각과 줄 묶기 — 메신저 앱들처럼.
 *
 *   · 말풍선 옆 시각은 '오후 3:12' — 같은 사람이 같은 분에 연달아 보낸 것은 묶어서 마지막에만
 *   · 날이 바뀌면 가운데 '2026년 11월 6일 목요일' 줄
 *   · 목록은 오늘이면 시각, 어제면 '어제', 올해면 '11월 3일', 그 전은 '2025. 11. 3.'
 *
 * Intl 을 안 쓰고 손으로 만든다 — 기기마다 ICU 판이 달라 빈칸 종류(좁은 빈칸 등)까지 바뀐다.
 * 시각은 그 기기의 시간대로 읽는다(서버는 UTC 로 준다).
 */
import type { 메시지 } from "@/api/dm";

const 요일들 = ["일", "월", "화", "수", "목", "금", "토"];

function 날짜로(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** '오후 3:12' — 낮 12시는 '오후 12:00', 밤 12시는 '오전 12:00' */
export function 말풍선시각(iso: string | null | undefined): string {
  const d = 날짜로(iso);
  if (!d) return "";
  const 시 = d.getHours();
  const 열두시 = 시 % 12 === 0 ? 12 : 시 % 12;
  return `${시 < 12 ? "오전" : "오후"} ${열두시}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 날이 바뀌는 줄 — '2026년 11월 6일 목요일' */
export function 날짜줄(iso: string | null | undefined): string {
  const d = 날짜로(iso);
  if (!d) return "";
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${요일들[d.getDay()]}요일`;
}

function 같은날짜(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** 대화 목록의 시각 — 오늘이면 시각, 어제면 '어제', 올해면 '11월 3일', 그 전은 '2025. 11. 3.' */
export function 목록시각(iso: string | null | undefined, 지금: Date = new Date()): string {
  const d = 날짜로(iso);
  if (!d) return "";
  if (같은날짜(d, 지금)) return 말풍선시각(iso);
  const 어제 = new Date(지금.getFullYear(), 지금.getMonth(), 지금.getDate() - 1);
  if (같은날짜(d, 어제)) return "어제";
  if (d.getFullYear() === 지금.getFullYear()) return `${d.getMonth() + 1}월 ${d.getDate()}일`;
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
}

/** 화면에 그리는 메시지 — 서버 것에 '보내는 중·못 보냄' 을 더한다(아직 번호가 없어 음수 id 로 둔다) */
export interface 표시메시지 extends 메시지 {
  상태?: "보내는중" | "실패";
  /** 보내기 전 자리를 찾는 이름 */
  임시?: string;
}

export type 대화줄 =
  | { 종류: "날짜"; key: string; 글: string }
  | {
      종류: "메시지";
      key: string;
      m: 표시메시지;
      /** 같은 사람이 같은 분에 연달아 보낸 묶음의 첫 줄 — 상대 것이면 아바타를 단다 */
      묶음첫: boolean;
      /** 묶음의 끝 줄 — 시각을 단다 */
      묶음끝: boolean;
      /** 상대가 여기까지 읽었다 — 내 메시지 중 상대가 읽은 마지막 하나에만 */
      읽음: boolean;
    };

function 같은분(a: Date, b: Date): boolean {
  return 같은날짜(a, b) && a.getHours() === b.getHours() && a.getMinutes() === b.getMinutes();
}

/** 메시지 → 그릴 줄. 순서는 받은 그대로(서버 번호 차례, 보내는 중인 것은 끝) */
export function 대화줄들(메시지들: 표시메시지[], 상대읽은번호: number): 대화줄[] {
  const 읽은마지막 = 메시지들.reduce(
    (최대, m) => (m.mine && m.id > 0 && m.id <= 상대읽은번호 && m.id > 최대 ? m.id : 최대), 0);
  const 줄들: 대화줄[] = [];
  let 앞날: Date | null = null;
  메시지들.forEach((m, i) => {
    const 때 = 날짜로(m.created_at);
    if (때 && (!앞날 || !같은날짜(앞날, 때))) {
      줄들.push({ 종류: "날짜", key: `d-${m.임시 ?? m.id}`, 글: 날짜줄(m.created_at) });
    }
    if (때) 앞날 = 때;
    const 앞 = 메시지들[i - 1];
    const 뒤 = 메시지들[i + 1];
    const 이어짐 = (x?: 표시메시지) => {
      if (!x || x.mine !== m.mine) return false;
      const 저때 = 날짜로(x.created_at);
      return !!(때 && 저때 && 같은분(때, 저때));
    };
    줄들.push({
      종류: "메시지",
      key: m.임시 ?? String(m.id),
      m,
      묶음첫: !이어짐(앞),
      묶음끝: !이어짐(뒤),
      // 읽은마지막은 0 이거나 서버 번호(양수)라, 보내는 중인 것(음수 번호)과는 같을 수 없다
      읽음: m.mine && m.id === 읽은마지막,
    });
  });
  return 줄들;
}

/** 서버에서 받은 메시지를 지금 목록에 합친다 — 같은 번호는 새 것으로(지움·가림이 바뀌었을 수 있다),
 *  번호 차례로 세우고, 아직 번호가 없는(보내는 중·못 보낸) 것은 맨 끝에 그대로 둔다 */
export function 메시지합치기(지금: 표시메시지[], 받은: 메시지[]): 표시메시지[] {
  const 서버것 = new Map<number, 표시메시지>();
  for (const m of 지금) if (m.id > 0) 서버것.set(m.id, m);
  for (const m of 받은) 서버것.set(m.id, m);
  const 임시것 = 지금.filter((m) => m.id <= 0);
  return [...[...서버것.values()].sort((a, b) => a.id - b.id), ...임시것];
}

/** 받은 것 중에 화면을 바꿀 것이 있나 — 새 번호이거나, 지움·가림·글이 바뀐 것. 없으면 다시 그리지 않는다
 *  (몇 초마다 묻는데 매번 목록을 새로 만들면 아무것도 안 바뀌어도 화면 전체를 다시 그린다) */
export function 바뀐것있나(지금: 표시메시지[], 받은: 메시지[]): boolean {
  const 있던 = new Map<number, 표시메시지>();
  for (const m of 지금) if (m.id > 0) 있던.set(m.id, m);
  return 받은.some((m) => {
    const 전 = 있던.get(m.id);
    return !전 || 전.deleted !== m.deleted || 전.blinded !== m.blinded || 전.body !== m.body;
  });
}
