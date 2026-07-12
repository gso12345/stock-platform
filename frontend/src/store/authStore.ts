import { create } from "zustand";
import { persist } from "zustand/middleware";
import { AUTH_STORAGE_KEY } from "@/api/client";

interface AuthState {
  token: string | null;
  userId: number | null;
  username: string | null;
  isLoggedIn: boolean;
  isAdmin: boolean;
  login: (token: string, userId: number, username: string, isAdmin?: boolean) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      userId: null,
      username: null,
      isLoggedIn: false,
      isAdmin: false,
      login: (token, userId, username, isAdmin = false) =>
        set({ token, userId, username, isLoggedIn: true, isAdmin }),
      logout: () =>
        set({ token: null, userId: null, username: null, isLoggedIn: false, isAdmin: false }),
    }),
    {
      name: AUTH_STORAGE_KEY,
    }
  )
);
