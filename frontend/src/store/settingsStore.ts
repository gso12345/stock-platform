import { create } from "zustand";

export type ColorScheme = "green-red" | "red-blue";
export type FontSize = "normal" | "large" | "xl";
export type Theme = "light" | "dark" | "system";
export type Orientation = "system" | "portrait" | "landscape";

const KEY = "portfolio_settings";

function legacyTheme(): Theme {
  try {
    const legacy = localStorage.getItem("theme");
    if (legacy === "light" || legacy === "dark") return legacy;
  } catch {}
  return "dark";
}

function load(): { colorScheme: ColorScheme; fontSize: FontSize; theme: Theme; orientation: Orientation } {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return {
        colorScheme: p.colorScheme === "red-blue" ? "red-blue" : "green-red",
        fontSize: (["normal", "large", "xl"] as FontSize[]).includes(p.fontSize) ? p.fontSize : "normal",
        theme: (["light", "dark", "system"] as Theme[]).includes(p.theme) ? p.theme : legacyTheme(),
        orientation: (["system", "portrait", "landscape"] as Orientation[]).includes(p.orientation) ? p.orientation : "system",
      };
    }
  } catch {}
  return { colorScheme: "green-red", fontSize: "normal", theme: legacyTheme(), orientation: "system" };
}

function save(colorScheme: ColorScheme, fontSize: FontSize, theme: Theme, orientation: Orientation) {
  try { localStorage.setItem(KEY, JSON.stringify({ colorScheme, fontSize, theme, orientation })); } catch {}
}

interface SettingsStore {
  colorScheme: ColorScheme;
  fontSize: FontSize;
  theme: Theme;
  orientation: Orientation;
  setColorScheme: (s: ColorScheme) => void;
  setFontSize: (s: FontSize) => void;
  setTheme: (t: Theme) => void;
  setOrientation: (o: Orientation) => void;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  ...load(),
  setColorScheme: (colorScheme) => { save(colorScheme, get().fontSize, get().theme, get().orientation); set({ colorScheme }); },
  setFontSize:    (fontSize)    => { save(get().colorScheme, fontSize, get().theme, get().orientation); set({ fontSize }); },
  setTheme:       (theme)       => { save(get().colorScheme, get().fontSize, theme, get().orientation); set({ theme }); },
  setOrientation: (orientation) => { save(get().colorScheme, get().fontSize, get().theme, orientation); set({ orientation }); },
}));
