import { create } from "zustand";

export type ColorScheme = "green-red" | "red-blue";
export type FontSize = "normal" | "large" | "xl";

const KEY = "portfolio_settings";

function load(): { colorScheme: ColorScheme; fontSize: FontSize } {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return {
        colorScheme: p.colorScheme === "red-blue" ? "red-blue" : "green-red",
        fontSize: (["normal", "large", "xl"] as FontSize[]).includes(p.fontSize) ? p.fontSize : "normal",
      };
    }
  } catch {}
  return { colorScheme: "green-red", fontSize: "normal" };
}

function save(colorScheme: ColorScheme, fontSize: FontSize) {
  try { localStorage.setItem(KEY, JSON.stringify({ colorScheme, fontSize })); } catch {}
}

interface SettingsStore {
  colorScheme: ColorScheme;
  fontSize: FontSize;
  setColorScheme: (s: ColorScheme) => void;
  setFontSize: (s: FontSize) => void;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  ...load(),
  setColorScheme: (colorScheme) => { save(colorScheme, get().fontSize); set({ colorScheme }); },
  setFontSize:    (fontSize)    => { save(get().colorScheme, fontSize); set({ fontSize }); },
}));
