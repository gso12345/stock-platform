import { create } from "zustand";
import { persist } from "zustand/middleware";
import { AUTH_STORAGE_KEY } from "@/api/client";

interface AuthState {
  token: string | null;
  userId: number | null;
  username: string | null;
  isLoggedIn: boolean;
  login: (token: string, userId: number, username: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      userId: null,
      username: null,
      isLoggedIn: false,
      login: (token, userId, username) =>
        set({ token, userId, username, isLoggedIn: true }),
      logout: () =>
        set({ token: null, userId: null, username: null, isLoggedIn: false }),
    }),
    {
      name: AUTH_STORAGE_KEY,
    }
  )
);
