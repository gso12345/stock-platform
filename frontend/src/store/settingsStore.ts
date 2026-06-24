import { create } from "zustand";

export type ColorScheme = "green-red" | "red-blue";
export type FontSize = "normal" | "large" | "xl";
export type Theme = "light" | "dark" | "system";
export type Orientation = "system" | "portrait" | "landscape";
export type CardShadow = "on" | "off";

const KEY = "portfolio_settings";

function legacyTheme(): Theme {
  try {
    const legacy = localStorage.getItem("theme");
    if (legacy === "light" || legacy === "dark") return legacy;
  } catch {}
  return "dark";
}

function load(): { colorScheme: ColorScheme; fontSize: FontSize; theme: Theme; orientation: Orientation; cardShadow: CardShadow } {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return {
        colorScheme: p.colorScheme === "red-blue" ? "red-blue" : "green-red",
        fontSize: (["normal", "large", "xl"] as FontSize[]).includes(p.fontSize) ? p.fontSize : "normal",
        theme: (["light", "dark", "system"] as Theme[]).includes(p.theme) ? p.theme : legacyTheme(),
        orientation: (["system", "portrait", "landscape"] as Orientation[]).includes(p.orientation) ? p.orientation : "system",
        cardShadow: p.cardShadow === "off" ? "off" : "on",
      };
    }
  } catch {}
  return { colorScheme: "green-red", fontSize: "normal", theme: legacyTheme(), orientation: "system", cardShadow: "on" };
}

function save(colorScheme: ColorScheme, fontSize: FontSize, theme: Theme, orientation: Orientation, cardShadow: CardShadow) {
  try { localStorage.setItem(KEY, JSON.stringify({ colorScheme, fontSize, theme, orientation, cardShadow })); } catch {}
}

interface SettingsStore {
  colorScheme: ColorScheme;
  fontSize: FontSize;
  theme: Theme;
  orientation: Orientation;
  cardShadow: CardShadow;
  setColorScheme: (s: ColorScheme) => void;
  setFontSize: (s: FontSize) => void;
  setTheme: (t: Theme) => void;
  setOrientation: (o: Orientation) => void;
  setCardShadow: (s: CardShadow) => void;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  ...load(),
  setColorScheme: (colorScheme) => { save(colorScheme, get().fontSize, get().theme, get().orientation, get().cardShadow); set({ colorScheme }); },
  setFontSize:    (fontSize)    => { save(get().colorScheme, fontSize, get().theme, get().orientation, get().cardShadow); set({ fontSize }); },
  setTheme:       (theme)       => { save(get().colorScheme, get().fontSize, theme, get().orientation, get().cardShadow); set({ theme }); },
  setOrientation: (orientation) => { save(get().colorScheme, get().fontSize, get().theme, orientation, get().cardShadow); set({ orientation }); },
  setCardShadow:  (cardShadow)  => { save(get().colorScheme, get().fontSize, get().theme, get().orientation, cardShadow); set({ cardShadow }); },
}));
