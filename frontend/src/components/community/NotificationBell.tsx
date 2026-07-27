/**
 * 헤더의 알림 종.
 *
 * 안 읽은 개수는 화면이 떠 있는 내내 주기적으로 물어보게 되므로, 목록과 분리된
 * 가벼운 엔드포인트(COUNT 한 번)만 주기 조회한다. 목록은 종을 눌러 열 때만
 * 가져온다 — 열지도 않을 30건을 계속 받아올 이유가 없다.
 */
import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Bell, Heart, MessageSquare, CornerDownRight, UserPlus, CheckCheck } from "lucide-react";
import { communityApi } from "@/api/stocks";
import { useAuthStore } from "@/store/authStore";
import Avatar from "@/components/community/Avatar";

interface NotificationItem {
  id: number;
  kind: "comment" | "reply" | "post_like" | "comment_like" | "follow";
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

/** 알림 종류별 문구와 아이콘 — 한곳에 모아 문구가 화면마다 달라지지 않게 한다 */
const KIND_META: Record<NotificationItem["kind"], { text: string; Icon: typeof Heart; cls: string }> = {
  comment:      { text: "님이 회원님의 글에 댓글을 남겼습니다",   Icon: MessageSquare,    cls: "text-accent-blue" },
  reply:        { text: "님이 회원님의 댓글에 답글을 남겼습니다", Icon: CornerDownRight,  cls: "text-accent-blue" },
  post_like:    { text: "님이 회원님의 글을 좋아합니다",         Icon: Heart,            cls: "text-accent-red" },
  comment_like: { text: "님이 회원님의 댓글을 좋아합니다",       Icon: Heart,            cls: "text-accent-red" },
  follow:       { text: "님이 회원님을 팔로우했습니다",          Icon: UserPlus,         cls: "text-accent-green" },
};

function timeAgo(iso: string) {
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

export default function NotificationBell() {
  const { isLoggedIn } = useAuthStore();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: unread } = useQuery({
    queryKey: ["notiUnread"],
    queryFn: communityApi.getUnreadNotificationCount,
    enabled: isLoggedIn,
    refetchInterval: 60_000,
    // 탭이 뒤에 있을 때까지 계속 물어볼 이유가 없다
    refetchIntervalInBackground: false,
    staleTime: 30_000,
  });

  const { data: list, isLoading } = useQuery({
    queryKey: ["notiList"],
    queryFn: () => communityApi.getNotifications(1),
    enabled: isLoggedIn && open,
    staleTime: 10_000,
  });

  const readAll = useMutation({
    mutationFn: communityApi.markAllNotificationsRead,
    onSuccess: () => {
      qc.setQueryData(["notiUnread"], { count: 0, capped: false });
      qc.invalidateQueries({ queryKey: ["notiList"] });
    },
  });

  // 바깥을 누르거나 Esc를 누르면 닫는다
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!isLoggedIn) return null;

  const count = unread?.count ?? 0;
  const badge = unread?.capped ? "99+" : String(count);
  const items: NotificationItem[] = list?.items ?? [];

  const openItem = async (n: NotificationItem) => {
    setOpen(false);
    if (!n.is_read) {
      try {
        await communityApi.markNotificationRead(n.id);
        qc.invalidateQueries({ queryKey: ["notiUnread"] });
        qc.invalidateQueries({ queryKey: ["notiList"] });
      } catch { /* 읽음 표시 실패로 이동까지 막지는 않는다 */ }
    }
    if (n.kind === "follow" && n.actor_id) navigate(`/profile/${n.actor_id}`);
    else if (n.post_id) navigate(`/post/${n.post_id}`);
  };

  return (
    <div className="relative" ref={wrapRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={count > 0 ? `알림 ${badge}개` : "알림"}
        aria-expanded={open}
        aria-haspopup="menu"
        className="relative p-1.5 rounded-lg border border-border hover:bg-bg-elevated text-text-muted hover:text-text-primary transition-all"
      >
        <Bell size={14} />
        {count > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-0.5 flex items-center justify-center rounded-full bg-accent-red text-white text-[9px] font-bold leading-none">
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1.5 w-[min(92vw,20rem)] max-h-[70vh] overflow-y-auto z-50 bg-bg-card border border-border rounded-2xl shadow-xl"
        >
          <div className="sticky top-0 flex items-center gap-2 px-3 py-2 bg-bg-card border-b border-border">
            <span className="text-xs font-bold text-text-primary">알림</span>
            <div className="flex-1" />
            {count > 0 && (
              <button
                onClick={() => readAll.mutate()}
                disabled={readAll.isPending}
                className="flex items-center gap-1 text-2xs text-text-muted hover:text-accent-blue transition-colors disabled:opacity-50"
              >
                <CheckCheck size={12} /> 모두 읽음
              </button>
            )}
          </div>

          {isLoading ? (
            <p className="px-3 py-6 text-center text-xs text-text-dim">불러오는 중…</p>
          ) : items.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-text-dim">아직 알림이 없습니다</p>
          ) : (
            <ul>
              {items.map((n) => {
                const meta = KIND_META[n.kind] ?? KIND_META.comment;
                return (
                  <li key={n.id}>
                    <button
                      onClick={() => openItem(n)}
                      className={`w-full flex gap-2.5 px-3 py-2.5 text-left border-b border-border/50 hover:bg-bg-elevated transition-colors ${
                        n.is_read ? "" : "bg-accent-blue/5"
                      }`}
                    >
                      <div className="relative shrink-0">
                        <Avatar username={n.actor_name} colorIndex={n.actor_color}
                                avatarUrl={n.actor_avatar} size="md" />
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
                          <p className="mt-0.5 text-2xs text-text-dim line-clamp-2 break-words">{n.preview}</p>
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
          )}
        </div>
      )}
    </div>
  );
}
