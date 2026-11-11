/**
 * 지금 밝은 화면인가 — 테마가 '시스템' 이면 기기 설정을 따른다(바뀌면 따라 바뀐다).
 *
 * 앱 틀(Layout)이 이걸로 브라우저에 테마를 알린다(utils/테마 테마적용). 테마를 바꾸는 곳은 설정 창 한 곳이다 —
 * 머리의 해·달 단추를 더보기 스위치·PC 왼쪽 메뉴로 옮겼다가, 설정에 이미 있으니 없애 달라고 했다(사용자: "다크모드
 * 설정에 있잖아 그냥 없애줘").
 */
import { useEffect, useState } from "react";
import { useSettingsStore } from "@/store/settingsStore";

const 질의 = "(prefers-color-scheme: light)";

export function use밝은화면(): boolean {
  const theme = useSettingsStore((s) => s.theme);
  const [기기밝음, set기기밝음] = useState(
    () => (typeof window !== "undefined" && window.matchMedia?.(질의)?.matches) || false,
  );
  useEffect(() => {
    const mq = window.matchMedia?.(질의);
    if (!mq) return;
    const 바뀜 = (e: MediaQueryListEvent) => set기기밝음(e.matches);
    mq.addEventListener?.("change", 바뀜);
    return () => mq.removeEventListener?.("change", 바뀜);
  }, []);
  return theme === "system" ? 기기밝음 : theme === "light";
}
