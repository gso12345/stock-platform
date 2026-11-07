/**
 * 1:1 메시지 — 사용자: "상대방이랑 채팅도 할 수 있도록 해줘". 서버는 backend/app/api/routes/dm.py.
 *
 * 실시간은 '자주 묻기' 로 한다 — 대화방이 열려 있는 동안만 몇 초마다 '이 번호 다음 것' 을 묻는다(after_id).
 * 번호가 곧 차례라 놓치는 것이 없다. 앱을 닫아 두면 휴대폰 알림으로 온다.
 */
import api from "./client";

export interface 대화상대 {
  id: number | null;
  name: string;
  username: string | null;
  avatar_url: string | null;
  avatar_color: number;
  /** 거짓이면 탈퇴·정지 — 프로필로 잇지 않는다 */
  active: boolean;
}

export interface 메시지 {
  id: number;
  mine: boolean;
  /** 지운 것·가린 것은 비어 온다(자리만 그린다) */
  body: string | null;
  deleted: boolean;
  blinded: boolean;
  created_at: string | null;
}

export interface 대화방줄 {
  id: number;
  other: 대화상대;
  last_message: { id: number; mine: boolean; preview: string; created_at: string | null };
  unread: number;
}

export interface 대화방 {
  id: number;
  other: 대화상대;
  can_send: boolean;
  /** 내가 막았나 — 막힌 쪽에는 '차단당했다' 고 알리지 않는다(그쪽은 can_send 만 거짓) */
  i_blocked: boolean;
  my_read_id: number;
  other_read_id: number;
}

export interface 메시지묶음 {
  items: 메시지[];
  has_more: boolean;
  other_read_id: number;
}

export interface 안읽음 { count: number; capped: boolean }

export interface 차단한사람 extends 대화상대 { blocked_at: string | null }

export const dmApi = {
  /** 그 사람과의 방 — 없으면 만든다 */
  openThread: (userId: number) =>
    api.post<{ id: number }>("/community/dm/threads", { user_id: userId }).then((r) => r.data),
  listThreads: () =>
    api.get<{ items: 대화방줄[] }>("/community/dm/threads").then((r) => r.data),
  getThread: (threadId: number) =>
    api.get<대화방>(`/community/dm/threads/${threadId}`).then((r) => r.data),
  /** 오래된 → 새 차례. after_id 는 '그 다음 것', before_id 는 '그 앞 것' */
  getMessages: (threadId: number, 물음: { before_id?: number; after_id?: number; limit?: number } = {}) =>
    api.get<메시지묶음>(`/community/dm/threads/${threadId}/messages`, { params: 물음 }).then((r) => r.data),
  send: (threadId: number, body: string) =>
    api.post<메시지>(`/community/dm/threads/${threadId}/messages`, { body }).then((r) => r.data),
  markRead: (threadId: number, lastId: number) =>
    api.post<{ read_id: number }>(`/community/dm/threads/${threadId}/read`, { last_id: lastId }).then((r) => r.data),
  /** 나가기 — 지금까지를 내 목록에서만 지운다(상대에게는 남는다) */
  leave: (threadId: number) =>
    api.post(`/community/dm/threads/${threadId}/leave`).then((r) => r.data),
  deleteMessage: (messageId: number) =>
    api.delete(`/community/dm/messages/${messageId}`).then((r) => r.data),
  report: (messageId: number, reason: string) =>
    api.post(`/community/dm/messages/${messageId}/report`, { reason }).then((r) => r.data),
  unreadCount: () =>
    api.get<안읽음>("/community/dm/unread-count").then((r) => r.data),
  block: (userId: number) =>
    api.post<{ blocked: boolean }>(`/community/users/${userId}/block`).then((r) => r.data),
  unblock: (userId: number) =>
    api.delete<{ blocked: boolean }>(`/community/users/${userId}/block`).then((r) => r.data),
  listBlocks: () =>
    api.get<{ items: 차단한사람[] }>("/community/blocks").then((r) => r.data),
};

/** 질의 이름표 — 머리의 메시지 아이콘·더보기·목록·대화방이 같은 서랍을 쓴다 */
export const dm열쇠 = {
  안읽음: ["dmUnread"] as const,
  목록: ["dmThreads"] as const,
  방: (id: number) => ["dmThread", id] as const,
  차단: ["dmBlocks"] as const,
};
