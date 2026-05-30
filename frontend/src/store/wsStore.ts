import { create } from "zustand";

type WSStatus = "connecting" | "connected" | "disconnected";

interface WSStore {
  indicesStatus: WSStatus;
  setIndicesStatus: (s: WSStatus) => void;
}

export const useWSStore = create<WSStore>((set) => ({
  indicesStatus: "disconnected",
  setIndicesStatus: (s) => set({ indicesStatus: s }),
}));
