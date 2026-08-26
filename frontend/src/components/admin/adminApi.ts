/** 관리자 화면이 쓰는 서버 호출 한 벌.
 *
 * 원래 Admin.tsx(1,963줄) 맨 위에 있었다. 탭별로 파일을 가르면서
 * 탭마다 이 객체가 필요해졌으므로 따로 뺀다 — 두 벌을 두면 한쪽만
 * 고쳐져 어떤 탭에서만 되는 일이 생긴다.
 */
import api from "@/api/client";

export const adminApi = {
  getStats:        () => api.get("/admin/stats").then(r => r.data),
  getUsers:        (status = "all", page = 1) => api.get("/admin/users", { params: { status, page, limit: 50 } }).then(r => r.data),
  getUserDetail:   (id: number) => api.get(`/admin/users/${id}/detail`).then(r => r.data),
  getCommunityPosts: (page = 1, market?: string) =>
    api.get("/admin/community/posts", { params: { page, limit: 20, ...(market && market !== "ALL" ? { market } : {}) } }).then(r => r.data),
  deleteCommunityPost: (id: number) =>
    api.delete(`/admin/community/posts/${id}`).then(r => r.data),
  blindPost:       (id: number) => api.patch(`/admin/community/posts/${id}/blind`).then(r => r.data),
  unblindPost:     (id: number) => api.patch(`/admin/community/posts/${id}/unblind`).then(r => r.data),
  getCommunityComments: (page = 1, postId?: number) =>
    api.get("/admin/community/comments", { params: { page, limit: 20, ...(postId ? { post_id: postId } : {}) } }).then(r => r.data),
  deleteCommunityComment: (id: number) => api.delete(`/admin/community/comments/${id}`).then(r => r.data),
  blindComment:    (id: number) => api.patch(`/admin/community/comments/${id}/blind`).then(r => r.data),
  unblindComment:  (id: number) => api.patch(`/admin/community/comments/${id}/unblind`).then(r => r.data),
  getPopular:      (basis: string) => api.get(`/admin/popular-stocks?basis=${basis}`).then(r => r.data),
  getSignups:        () => api.get("/admin/signups").then(r => r.data),
  getVisitorTrend:   () => api.get("/admin/visitor-trend").then(r => r.data),
  getSystem:       () => api.get("/admin/system").then(r => r.data),
  /* 백엔드에 있는데 화면에서 안 쓰던 것 — 프로세스가 얼마나 자주 재시작되는지,
     지금 무엇을 붙들고 있는지를 본다 */
  getRuntime:      () => api.get("/admin/runtime").then(r => r.data),
  /* 관리자 행위 기록 — 되돌릴 수 없는 일이 무엇이 있었는지 */
  getAdminLogs:    (action = "", offset = 0) =>
    api.get("/admin/logs", { params: { ...(action ? { action } : {}), limit: 50, offset } }).then(r => r.data),
  getDbStats:      () => api.get("/admin/db-stats").then(r => r.data),
  clearCache:      () => api.post("/admin/cache/clear").then(r => r.data),
  listCache:       (prefix?: string) => api.get("/admin/cache", { params: prefix ? { prefix } : {} }).then(r => r.data),
  deleteCache:     (key: string) => api.delete(`/admin/cache/${encodeURIComponent(key)}`).then(r => r.data),
  deleteCachePrefix: (prefix: string) => api.delete("/admin/cache", { params: { prefix } }).then(r => r.data),
  toggleActive:       (id: number) => api.patch(`/admin/users/${id}/active`).then(r => r.data),
  toggleCommunityBan: (id: number) => api.patch(`/admin/users/${id}/community-ban`).then(r => r.data),
  deleteUser:         (id: number) => api.delete(`/admin/users/${id}`).then(r => r.data),
  getAnnouncement: () => api.get("/admin/announcement").then(r => r.data),
  setAnnouncement: (text: string) => api.post("/admin/announcement", { text }).then(r => r.data),
  // 팝업
  getPopups:       () => api.get("/admin/popups").then(r => r.data),
  createPopup:     (data: any) => api.post("/admin/popups", data).then(r => r.data),
  updatePopup:     (id: number, data: any) => api.put(`/admin/popups/${id}`, data).then(r => r.data),
  deletePopup:     (id: number) => api.delete(`/admin/popups/${id}`).then(r => r.data),
  // 신고
  getReports:      (status = "pending", page = 1) => api.get("/admin/reports", { params: { status, page } }).then(r => r.data),
  blindReport:     (id: number) => api.patch(`/admin/reports/${id}/blind`).then(r => r.data),
  unblindReport:   (id: number) => api.patch(`/admin/reports/${id}/unblind`).then(r => r.data),
  dismissReport:   (id: number) => api.patch(`/admin/reports/${id}/dismiss`).then(r => r.data),
  deleteReportContent: (id: number) => api.delete(`/admin/reports/${id}/content`).then(r => r.data),
  // 트렌드
  getSearchTrends: () => api.get("/admin/search-trends").then(r => r.data),
  getUsageStats:   () => api.get("/admin/usage-stats").then(r => r.data),
};

/** 시장 배지 색 — 글 목록(커뮤니티 탭)과 유저 상세가 같이 쓴다.
 *  두 벌을 두면 한쪽만 고쳐져 같은 배지가 화면마다 다른 색이 된다. */
export const MARKET_COLOR_MAP: Record<string, string> = {
  KR:  "bg-accent-blue/15 text-accent-blue",
  US:  "bg-accent-green/15 text-accent-green",
  ETF: "bg-accent-purple/15 text-accent-purple",
};
