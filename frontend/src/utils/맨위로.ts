/**
 * 하단 탭을 지금 보는 화면에서 다시 누르면 맨 위로 — 앱들의 기본 동작(앱 틀이 부른다).
 *
 * 부드럽게 굴린다. scrollTo 가 없는 옛 브라우저는 바로 맨 위로.
 */
export function 맨위로(el: HTMLElement | null | undefined): void {
  if (!el) return;
  if (typeof el.scrollTo === "function") el.scrollTo({ top: 0, behavior: "smooth" });
  else el.scrollTop = 0;
}
