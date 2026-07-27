/**
 * 알림 종류 — 서버(_NOTI_KINDS)와 같은 다섯 가지여야 한다.
 *
 * 종(NotificationBell)과 설정 화면이 같은 목록·같은 문구를 쓰도록 한곳에 모은다.
 * 따로 두면 한쪽에만 종류를 추가했을 때 설정에서 끌 수 없는 알림이 생긴다.
 */
import { Heart, MessageSquare, CornerDownRight, UserPlus } from "lucide-react";

export type NotificationKind = "comment" | "reply" | "post_like" | "comment_like" | "follow";

export interface KindMeta {
  /** 알림 목록에 쓰는 문구 — 앞에 보낸 사람 이름이 붙는다 */
  text: string;
  /** 설정 화면에 쓰는 짧은 이름 */
  label: string;
  /** 설정 화면의 보조 설명 */
  desc: string;
  Icon: typeof Heart;
  cls: string;
}

export const KIND_META: Record<NotificationKind, KindMeta> = {
  comment: {
    text: "님이 회원님의 글에 댓글을 남겼습니다",
    label: "내 글의 댓글",
    desc: "내가 쓴 글에 댓글이 달릴 때",
    Icon: MessageSquare, cls: "text-accent-blue",
  },
  reply: {
    text: "님이 회원님의 댓글에 답글을 남겼습니다",
    label: "내 댓글의 답글",
    desc: "내가 쓴 댓글에 답글이 달릴 때",
    Icon: CornerDownRight, cls: "text-accent-blue",
  },
  post_like: {
    text: "님이 회원님의 글을 좋아합니다",
    label: "글 좋아요",
    desc: "내가 쓴 글이 좋아요를 받을 때",
    Icon: Heart, cls: "text-accent-red",
  },
  comment_like: {
    text: "님이 회원님의 댓글을 좋아합니다",
    label: "댓글 좋아요",
    desc: "내가 쓴 댓글이 좋아요를 받을 때",
    Icon: Heart, cls: "text-accent-red",
  },
  follow: {
    text: "님이 회원님을 팔로우했습니다",
    label: "새 팔로워",
    desc: "누군가 나를 팔로우할 때",
    Icon: UserPlus, cls: "text-accent-green",
  },
};

/** 설정 화면에 보여줄 순서 */
export const NOTIFICATION_KINDS: NotificationKind[] = [
  "comment", "reply", "post_like", "comment_like", "follow",
];

/** 알림이 가리키는 화면 — 목록과 설정이 같은 규칙을 쓰도록 여기에 둔다 */
export function notificationHref(n: { kind: string; post_id: number | null; actor_id: number | null }) {
  if (n.kind === "follow") return n.actor_id ? `/profile/${n.actor_id}` : null;
  return n.post_id ? `/post/${n.post_id}` : null;
}

export function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "방금 전";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}일 전`;
  return new Date(iso).toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}
