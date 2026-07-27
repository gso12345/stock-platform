/**
 * 내 프로필(닉네임·아바타 색·프로필 사진).
 *
 * 피드와 종목 커뮤니티의 글 작성란은 각자 username을 해시해서 아바타 색을 정하고
 * 프로필 사진은 아예 무시하고 있었다. 그래서 같은 화면 안에서 내 아바타가 두 가지로
 * 보였다 — 내가 쓴 글에는 서버가 준 색·사진이, 바로 위 작성란에는 해시로 만든
 * 다른 색이 나왔다. 두 화면이 같은 출처를 쓰도록 하나로 모은다.
 */
import { useQuery } from "@tanstack/react-query";
import { communityApi } from "@/api/stocks";
import { useAuthStore } from "@/store/authStore";

export interface MyProfile {
  user_id: number;
  username: string;
  nickname: string | null;
  avatar_color: number;
  avatar_url: string | null;
}

export function useMyProfile() {
  const { isLoggedIn, username } = useAuthStore();

  const { data } = useQuery<MyProfile>({
    queryKey: ["myProfile"],
    queryFn: communityApi.getMyProfile,
    enabled: isLoggedIn,
    staleTime: 5 * 60_000,
  });

  return {
    displayName: data?.nickname || data?.username || username || "?",
    avatarColor: data?.avatar_color ?? 0,
    avatarUrl: data?.avatar_url ?? null,
    userId: data?.user_id,
  };
}
