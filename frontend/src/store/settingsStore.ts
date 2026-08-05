import { create } from "zustand";

export type ColorScheme = "green-red" | "red-blue";
export type FontSize = "normal" | "large" | "xl";
export type Theme = "light" | "dark" | "system";
export type Orientation = "system" | "portrait" | "landscape";

/** 내 자산·종목상세를 어떤 모양으로 그릴지.
 *
 *  classic  내 자산은 요약 카드 넷을 그대로 두고, 종목상세는 가격 아래에
 *           지표를 한 번에 편다. 숫자를 한눈에 다 보고 싶을 때.
 *  app      다른 증권 앱 배치 — 큰 가격 → 곧바로 차트 → 그 아래 통계.
 *
 * 셋이었다가 둘로 줄였다. 가운데 것('간단히')은 종목상세만 달랐는데,
 * 접었다 폈다 하는 수고에 견줘 얻는 게 적었다.
 *
 * 무엇이 나은지는 사람마다 갈린다. 하나로 정하는 대신 고르게 둔다. */
export type 화면모양 = "classic" | "app";
/** 저장된 값이 셋 중 하나인지 확인한다. 아니면 기본값.
 *
 *  예전 버전이 남긴 값, 손으로 고친 값, 오타 — 어느 쪽이든 그대로 쓰면
 *  화면이 셋 중 아무 가지에도 안 걸려 텅 빈 채로 뜬다. */
export function 정상화면모양(v: unknown): 화면모양 {
  return v === "classic" || v === "app" ? v : "app";
}

export const 화면모양_목록: { value: 화면모양; label: string; desc: string }[] = [
  { value: "classic", label: "기본",   desc: "숫자를 한 번에 다 펼쳐 봅니다" },
  { value: "app",     label: "앱처럼", desc: "큰 가격 → 차트 → 통계 순서로 봅니다" },
];

const KEY = "portfolio_settings";

function legacyTheme(): Theme {
  try {
    const legacy = localStorage.getItem("theme");
    if (legacy === "light" || legacy === "dark") return legacy;
  } catch {}
  return "dark";
}

function load(): { colorScheme: ColorScheme; fontSize: FontSize; theme: Theme; orientation: Orientation; 화면모양: 화면모양 } {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return {
        colorScheme: p.colorScheme === "red-blue" ? "red-blue" : "green-red",
        fontSize: (["normal", "large", "xl"] as FontSize[]).includes(p.fontSize) ? p.fontSize : "normal",
        theme: (["light", "dark", "system"] as Theme[]).includes(p.theme) ? p.theme : legacyTheme(),
        orientation: (["system", "portrait", "landscape"] as Orientation[]).includes(p.orientation) ? p.orientation : "system",
        화면모양: 정상화면모양(p.화면모양),
      };
    }
  } catch {}
  return { colorScheme: "green-red", fontSize: "normal", theme: legacyTheme(), orientation: "system", 화면모양: "app" };
}

function save(colorScheme: ColorScheme, fontSize: FontSize, theme: Theme, orientation: Orientation, 화면모양: 화면모양) {
  try { localStorage.setItem(KEY, JSON.stringify({ colorScheme, fontSize, theme, orientation, 화면모양 })); } catch {}
}

interface SettingsStore {
  colorScheme: ColorScheme;
  fontSize: FontSize;
  theme: Theme;
  orientation: Orientation;
  화면모양: 화면모양;
  setColorScheme: (s: ColorScheme) => void;
  setFontSize: (s: FontSize) => void;
  setTheme: (t: Theme) => void;
  setOrientation: (o: Orientation) => void;
  set화면모양: (v: 화면모양) => void;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  ...load(),
  setColorScheme: (colorScheme) => { save(colorScheme, get().fontSize, get().theme, get().orientation, get().화면모양); set({ colorScheme }); },
  setFontSize:    (fontSize)    => { save(get().colorScheme, fontSize, get().theme, get().orientation, get().화면모양); set({ fontSize }); },
  setTheme:       (theme)       => { save(get().colorScheme, get().fontSize, theme, get().orientation, get().화면모양); set({ theme }); },
  setOrientation: (orientation) => { save(get().colorScheme, get().fontSize, get().theme, orientation, get().화면모양); set({ orientation }); },
  set화면모양:    (화면모양)     => { save(get().colorScheme, get().fontSize, get().theme, get().orientation, 화면모양); set({ 화면모양 }); },
}));
