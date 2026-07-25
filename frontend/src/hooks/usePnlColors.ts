import type { ColorScheme } from "@/store/settingsStore";

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
