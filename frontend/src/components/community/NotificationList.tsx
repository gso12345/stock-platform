/**
 * 알림 목록 — 헤더의 종과 전체 알림 화면이 같은 목록을 쓴다.
 *
 * 따로 만들면 한쪽 문구·동작만 고쳐져 두 화면이 갈라진다.
 */
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { communityApi } from "@/api/stocks";
import Avatar from "@/components/community/Avatar";
import { KIND_META, notificationHref, timeAgo, type NotificationKind } from "@/constants/notifications";

export interface NotificationItem {
  id: number;
  kind: NotificationKind;
  post_id: number | null;
  comment_id: number | null;
  preview: string | null;
  is_read: boolean;
  created_at: string;
  actor_id: number | null;
  actor_name: string;
  actor_color: number;
  actor_avatar: string | null;
}

export default function NotificationList({
  items,
  onNavigate,
  /** 손가락으로 누르는 화면에서는 행을 넉넉하게 잡는다 */
  roomy = false,
}: {
  items: NotificationItem[];
  onNavigate?: () => void;
  roomy?: boolean;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const open = async (n: NotificationItem) => {
    onNavigate?.();
    if (!n.is_read) {
      try {
        await communityApi.markNotificationRead(n.id);
        qc.invalidateQueries({ queryKey: ["notiUnread"] });
        qc.invalidateQueries({ queryKey: ["notiList"] });
      } catch { /* 읽음 표시에 실패해도 이동까지 막지는 않는다 */ }
    }
    const href = notificationHref(n);
    if (href) navigate(href);
  };

  return (
    <ul>
      {items.map((n) => {
        const meta = KIND_META[n.kind] ?? KIND_META.comment;
        return (
          <li key={n.id}>
            <button
              onClick={() => open(n)}
              className={`w-full flex gap-2.5 text-left border-b border-border/50 hover:bg-bg-elevated transition-colors ${
                roomy ? "px-4 py-3.5" : "px-3 py-2.5"
              } ${n.is_read ? "" : "bg-accent-blue/5"}`}
            >
              <div className="relative shrink-0">
                <Avatar username={n.actor_name} colorIndex={n.actor_color}
                        avatarUrl={n.actor_avatar} size={roomy ? "md" : "base"} />
                <meta.Icon size={11}
                  className={`absolute -bottom-0.5 -right-0.5 p-[1px] rounded-full bg-bg-card ${meta.cls}`} />
              </div>
              <div className="flex-1 min-w-0">
                {/* break-keep: 한글은 어절 단위로 끊어야 "남겼습니 / 다"처럼
                    낱말이 잘리지 않는다. 좁은 화면에서 특히 눈에 띈다 */}
                <p className="text-xs text-text-secondary leading-snug break-keep">
                  <span className="font-semibold text-text-primary">{n.actor_name}</span>
                  {meta.text}
                </p>
                {n.preview && (
                  <p className="mt-0.5 text-2xs text-text-dim line-clamp-2 break-keep">{n.preview}</p>
                )}
                <p className="mt-0.5 text-2xs text-text-dim">{timeAgo(n.created_at)}</p>
              </div>
              {!n.is_read && (
                <span className="mt-1 w-1.5 h-1.5 rounded-full bg-accent-blue shrink-0" aria-hidden />
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
