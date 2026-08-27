import type { ColorScheme } from "@/store/settingsStore";

/**
 * 오름·내림 색값.
 *
 * 손익 색은 설정으로 갈린다 — 초록/빨강 쓰는 사람과 빨강/파랑 쓰는
 * 사람이 있다. 아래 usePnlColors 가 돌려주는 것은 **클래스 이름**이라
 * 글자에는 쓸 수 있지만 SVG 의 stroke·fill 이나 인라인 스타일에는 못
 * 쓴다. 그런 자리(자산 지도의 칸, 자산 흐름의 선)에는 색값 자체가
 * 필요하다.
 *
 * 두 벌을 각자 적어 두면 한쪽만 고쳐져 같은 화면 안에서 빨강이 한 번은
 * 오름이고 한 번은 내림이 된다. 그래서 여기 한 자리에 둔다.
 *
 * 값은 tailwind.config.js 의 accent 팔레트와 같다.
 */
export const 등락색 = {
  "green-red": { 오름: "#10b981", 내림: "#ef4444" },   // accent-green / accent-red
  "red-blue":  { 오름: "#ef4444", 내림: "#3b82f6" },   // accent-red   / accent-blue
} as const;

/** "#10b981" → "16,185,129".
 *
 *  rgba() 로 알파를 얹으려면 이 모양이어야 한다. 자산 지도는 칸 색을
 *  등락 세기에 따라 옅게·진하게 칠하므로 알파가 필요하다. */
export function 삼색(hex: string): string {
  const h = hex.replace("#", "");
  const n = parseInt(h, 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

/** 오른 값에 쓸 색값 (SVG·인라인 스타일용) */
export function 오름색(scheme: ColorScheme): string {
  return 등락색[scheme === "red-blue" ? "red-blue" : "green-red"].오름;
}

/** 내린 값에 쓸 색값 (SVG·인라인 스타일용) */
export function 내림색(scheme: ColorScheme): string {
  return 등락색[scheme === "red-blue" ? "red-blue" : "green-red"].내림;
}

/** 손익 색상 — 상승/하락 색 배치(빨강-파랑 / 초록-빨강)를 설정에 맞춰 돌려준다 */
export function usePnlColors(scheme: ColorScheme) {
  return {
    gain: scheme === "red-blue" ? "text-accent-red"  : "text-accent-green",
    loss: scheme === "red-blue" ? "text-accent-blue" : "text-accent-red",
    pnlColor: (v: number) => v === 0
      ? "text-text-muted"
      : v > 0
        ? (scheme === "red-blue" ? "text-accent-red"  : "text-accent-green")
        : (scheme === "red-blue" ? "text-accent-blue" : "text-accent-red"),
  };
}
