/**
 * 쓰던 메시지 — 대화방을 나갔다 와도 입력칸에 그대로(메신저 앱들처럼).
 *
 * 쓰다가 뒤로 가거나 앱을 닫으면 쓰던 글이 사라졌다. 방마다 이 기기에 남겨 두고, 다시 열면 입력칸에 채운다.
 * 목록에서도 '쓰던 글' 로 보인다(Messages).
 *
 * 로그인한 사람의 칸(api/queryPersist 의 사람칸) 아래에 둔다 — 로그인·로그아웃·인증 만료 때 사람 칸을 통째로
 * 지우므로(사람칸_모두지우기) 같은 기기를 다음에 쓰는 사람에게 남의 쓰던 글이 보이지 않는다.
 * 저장소를 못 쓰는 브라우저(사생활 보호 창 등)에서는 조용히 안 남긴다.
 */
import { 사람칸 } from "@/api/queryPersist";

function 열쇠(방: number): string | null {
  const 칸 = 사람칸();
  return 칸 ? `${칸}:dm-draft:${방}` : null;
}

/** 그 방에 쓰던 글 — 없으면 빈 글 */
export function 초안읽기(방: number): string {
  try {
    const k = 열쇠(방);
    return (k && localStorage.getItem(k)) || "";
  } catch {
    return "";
  }
}

/** 쓰던 글을 남긴다 — 빈칸뿐이면 지운다(보냈거나 다 지웠다) */
export function 초안쓰기(방: number, 글: string): void {
  try {
    const k = 열쇠(방);
    if (!k) return;
    if (글.trim()) localStorage.setItem(k, 글);
    else localStorage.removeItem(k);
  } catch {
    /* 가득 찼거나 막혔다 — 쓰던 글은 이 화면에만 남는다 */
  }
}
