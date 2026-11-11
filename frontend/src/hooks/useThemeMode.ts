/**
 * 지금 밝은 화면인가, 그리고 밝음 ↔ 어두움 바꾸기.
 *
 * 테마가 '시스템' 이면 기기 설정을 따른다(바뀌면 따라 바뀐다). 바꾸기는 지금 보이는 것의 반대로 못 박는다 — '시스템'
 * 이었어도 누른 사람은 지금 화면이 싫어서 누른 것이다.
 *
 * 앱 틀(Layout — 테마 적용·PC 왼쪽 메뉴)과 더보기의 '다크 모드' 스위치가 같은 것을 쓴다. 머리에 있던 해·달 단추를
 * 옮기면서(사용자: "위에 메시지 알림 로그아웃 다크모드 등 너무 많은데 정리해줘") 두 곳이 따로 셈하면 서로 다른
 * 답을 낼 수 있어 한곳에 모았다.
 */
import { useEffect, useState } from "react";
import { useSettingsStore } from "@/store/settingsStore";

const 질의 = "(prefers-color-scheme: light)";

export function use밝은화면(): { 밝음: boolean; 바꾸기: () => void } {
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
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
  const 밝음 = theme === "system" ? 기기밝음 : theme === "light";
  return { 밝음, 바꾸기: () => setTheme(밝음 ? "dark" : "light") };
}
