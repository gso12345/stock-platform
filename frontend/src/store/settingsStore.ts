import { create } from "zustand";

export type ColorScheme = "green-red" | "red-blue";
export type FontSize = "normal" | "large" | "xl";
export type Theme = "light" | "dark" | "system";

const KEY = "portfolio_settings";

function legacyTheme(): Theme {
  try {
    const legacy = localStorage.getItem("theme");
    if (legacy === "light" || legacy === "dark") return legacy;
  } catch {}
  return "dark";
}

function load(): { colorScheme: ColorScheme; fontSize: FontSize; theme: Theme } {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return {
        colorScheme: p.colorScheme === "red-blue" ? "red-blue" : "green-red",
        fontSize: (["normal", "large", "xl"] as FontSize[]).includes(p.fontSize) ? p.fontSize : "normal",
        theme: (["light", "dark", "system"] as Theme[]).includes(p.theme) ? p.theme : legacyTheme(),
      };
    }
  } catch {}
  return { colorScheme: "green-red", fontSize: "normal", theme: legacyTheme() };
}

function save(colorScheme: ColorScheme, fontSize: FontSize, theme: Theme) {
  try { localStorage.setItem(KEY, JSON.stringify({ colorScheme, fontSize, theme })); } catch {}
}

interface SettingsStore {
  colorScheme: ColorScheme;
  fontSize: FontSize;
  theme: Theme;
  setColorScheme: (s: ColorScheme) => void;
  setFontSize: (s: FontSize) => void;
  setTheme: (t: Theme) => void;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  ...load(),
  setColorScheme: (colorScheme) => { save(colorScheme, get().fontSize, get().theme); set({ colorScheme }); },
  setFontSize:    (fontSize)    => { save(get().colorScheme, fontSize, get().theme); set({ fontSize }); },
  setTheme:       (theme)       => { save(get().colorScheme, get().fontSize, theme); set({ theme }); },
}));
