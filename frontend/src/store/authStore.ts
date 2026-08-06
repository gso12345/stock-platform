import { create } from "zustand";
import { persist } from "zustand/middleware";
import { AUTH_STORAGE_KEY } from "@/api/client";
import { 사용자바뀜 } from "@/api/queryClient";

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
      /* 받아 둔 서버 데이터를 버리고 시작한다.
         안 버리면 앞사람이 보던 목록이 그대로 남는다 — 피드의 좋아요가
         화면과 서버에서 서로 반대가 되는 것이 그 탓이었다 */
      login: (token, userId, username, isAdmin = false) => {
        사용자바뀜();
        set({ token, userId, username, isLoggedIn: true, isAdmin });
      },
      logout: () => {
        사용자바뀜();
        set({ token: null, userId: null, username: null, isLoggedIn: false, isAdmin: false });
      },
    }),
    {
      name: AUTH_STORAGE_KEY,
    }
  )
);
