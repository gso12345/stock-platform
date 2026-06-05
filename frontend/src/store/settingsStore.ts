import { create } from "zustand";

export type ColorScheme = "green-red" | "red-blue";

const KEY = "portfolio_settings";

function load(): ColorScheme {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.colorScheme === "red-blue") return "red-blue";
    }
  } catch {}
  return "green-red";
}

interface SettingsStore {
  colorScheme: ColorScheme;
  setColorScheme: (s: ColorScheme) => void;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  colorScheme: load(),
  setColorScheme: (colorScheme) => {
    try { localStorage.setItem(KEY, JSON.stringify({ colorScheme })); } catch {}
    set({ colorScheme });
  },
}));
