/** 커뮤니티 — 글·댓글·투표·알림. 화면은 '@/api/stocks' 에서 가져간다(거기서 다시 내보낸다). */
import api from "./client";

/** 글에 붙이는 투표 — 서버 PollIn 과 같은 모양 (질문 1개 + 보기 2~4개) */
export interface 글투표 { question: string; options: string[] }

/** 글에 붙이는 종목 태그 — 서버 TagIn */
export interface 글태그 { symbol: string; market: string; name?: string | null }

/** 글에 붙이는 보유 종목 — 서버 PortfolioItemIn.
 *  현금 항목은 symbol 이 "현금" 이라 종목코드 형식을 강제하지 않는다. */
export interface 글보유종목 {
  symbol: string; market: string; name?: string;
  shares?: number; avg_price?: number; currency?: string | null;
  input_exchange_rate?: number | null;
  current_price?: number | null;
  asset_class?: string | null;
}

export const communityApi = {
  getPosts: (market: string, symbol: string, page = 1, sort: "latest" | "likes" = "latest") =>
    api.get(`/community/${market}/${symbol}/posts`, { params: { page, sort } }).then((r) => r.data),
  createPost: (market: string, symbol: string, title: string, body: string,
               image = "", poll: 글투표 | null = null, tags: 글태그[] = [],
               portfolio: 글보유종목[] | null = null) =>
    api.post(`/community/${market}/${symbol}/posts`, { title, body, content: body, image, poll, tags, portfolio }).then((r) => r.data),
  getPost: (postId: number) =>
    api.get(`/community/posts/${postId}`).then((r) => r.data),
  updatePost: (market: string, symbol: string, postId: number, title: string,
               body: string, tags?: 글태그[], poll?: 글투표 | null, image?: string) =>
    api.put(`/community/${market}/${symbol}/posts/${postId}`, { title, body, tags, poll, image }).then((r) => r.data),
  updateComment: (commentId: number, content: string) =>
    api.put(`/community/comments/${commentId}`, { content }).then((r) => r.data),
  deletePost: (market: string, symbol: string, postId: number) =>
    api.delete(`/community/${market}/${symbol}/posts/${postId}`).then((r) => r.data),
  togglePostLike: (postId: number) =>
    api.post(`/community/posts/${postId}/like`).then((r) => r.data),
  getComments: (postId: number, sort: "latest" | "popular" = "latest") =>
    api.get(`/community/posts/${postId}/comments`, { params: { sort } }).then((r) => r.data),
  createComment: (postId: number, content: string, parentId?: number) =>
    api.post(`/community/posts/${postId}/comments`, { content, parent_id: parentId ?? null }).then((r) => r.data),
  deleteComment: (commentId: number) =>
    api.delete(`/community/comments/${commentId}`).then((r) => r.data),
  toggleCommentLike: (commentId: number) =>
    api.post(`/community/comments/${commentId}/like`).then((r) => r.data),
  getMyProfile: () =>
    api.get("/community/profile/me").then((r) => r.data),
  updateMyProfile: (payload: { nickname?: string; avatar_color?: number; bio?: string; avatar_url?: string }) =>
    api.put("/community/profile/me", payload).then((r) => r.data),
  getUserProfile: (userId: number) =>
    api.get(`/community/profile/${userId}`).then((r) => r.data),
  getFeed: (page = 1, sort: "latest" | "likes" = "latest", market?: string, following = false, q?: string) =>
    api.get("/community/feed", { params: { page, sort, ...(market ? { market } : {}), ...(following ? { following: true } : {}), ...(q ? { q } : {}) } }).then((r) => r.data),
  getUserPublicProfile: (userId: number) =>
    api.get(`/community/users/${userId}/profile`).then((r) => r.data),
  getUserActivity: (userId: number) =>
    api.get(`/community/users/${userId}/activity`).then((r) => r.data),
  getFollowers: (userId: number) =>
    api.get(`/community/users/${userId}/followers`).then((r) => r.data),
  getFollowing: (userId: number) =>
    api.get(`/community/users/${userId}/following`).then((r) => r.data),
  toggleFollow: (userId: number) =>
    api.post(`/community/users/${userId}/follow`).then((r) => r.data),
  votePoll: (postId: number, optionIndex: number) =>
    api.post(`/community/posts/${postId}/poll/vote`, { option_index: optionIndex }).then((r) => r.data),
  setPortfolioVisibility: (portfolioId: number, isPublic: boolean) =>
    api.put(`/portfolio/${portfolioId}/visibility`, { is_public: isPublic }).then((r) => r.data),
  reportPost: (postId: number, reason: string) =>
    api.post(`/community/posts/${postId}/report`, { reason }).then((r) => r.data),
  reportComment: (commentId: number, reason: string) =>
    api.post(`/community/comments/${commentId}/report`, { reason }).then((r) => r.data),
  getNotifications: (page = 1) =>
    api.get("/community/notifications", { params: { page } }).then((r) => r.data),
  getUnreadNotificationCount: () =>
    api.get("/community/notifications/unread-count").then((r) => r.data),
  markNotificationRead: (notiId: number) =>
    api.post(`/community/notifications/${notiId}/read`).then((r) => r.data),
  markAllNotificationsRead: () =>
    api.post("/community/notifications/read-all").then((r) => r.data),
  /** 알림 한 줄을 지운다 */
  deleteNotification: (notiId: number) =>
    api.delete(`/community/notifications/${notiId}`).then((r) => r.data),
  /** 읽은 알림을 한 번에 치운다. **안 읽은 것은 안 지운다** */
  deleteReadNotifications: () =>
    api.delete<{ ok: boolean; deleted: number }>("/community/notifications/read").then((r) => r.data),
  getNotificationSettings: () =>
    api.get("/community/notifications/settings").then((r) => r.data),
  updateNotificationSettings: (payload: Record<string, boolean>) =>
    api.put("/community/notifications/settings", payload).then((r) => r.data),
};
