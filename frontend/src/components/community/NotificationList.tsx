/**
 * 알림 목록 — 헤더의 종과 전체 알림 화면이 같은 목록을 쓴다.
 *
 * 따로 만들면 한쪽 문구·동작만 고쳐져 두 화면이 갈라진다.
 */
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { communityApi } from "@/api/stocks";
import Avatar from "@/components/community/Avatar";
import { KIND_META, notificationHref, type NotificationKind } from "@/constants/notifications";
import { timeAgo } from "@/utils/formatters";

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
  /** 가격 알림만 채워진다 — 눌렀을 때 갈 종목 */
  symbol?: string | null;
  market?: string | null;
}

/**
 * 알림 목록 캐시에서 한 줄의 읽음 표시만 바꾼다.
 *
 * 목록이 두 모양으로 담긴다 — 종(notiList)은 배열, 전체 화면(notiPage)은
 * {items:[...]} 다. 한쪽만 고치면 종에서 읽은 것이 전체 화면에서는
 * 안 읽은 채로 남는다.
 */
export function 표시하기<T>(prev: T, id: number, 읽음: boolean): T {
  const 바꾸기 = (arr: NotificationItem[]) =>
    arr.map((n) => (n.id === id ? { ...n, is_read: 읽음 } : n));
  if (Array.isArray(prev)) return 바꾸기(prev as NotificationItem[]) as unknown as T;
  const o = prev as { items?: NotificationItem[] } | undefined;
  if (o && Array.isArray(o.items)) return { ...o, items: 바꾸기(o.items) } as unknown as T;
  return prev;
}

/** 목록 전체를 읽음으로. '모두 읽음' 이 쓴다 */
export function 모두읽음<T>(prev: T): T {
  const 다 = (arr: NotificationItem[]) => arr.map((n) => (n.is_read ? n : { ...n, is_read: true }));
  if (Array.isArray(prev)) return 다(prev as NotificationItem[]) as unknown as T;
  const o = prev as { items?: NotificationItem[] } | undefined;
  if (o && Array.isArray(o.items)) return { ...o, items: 다(o.items) } as unknown as T;
  return prev;
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

  /**
   * 알림을 눌렀다 — 화면을 **먼저** 바꾸고 서버에는 뒤에 알린다.
   *
   * 예전에는 왕복을 둘이나 기다렸다.
   *
   *   눌림 → 서버에 '읽음' 알림(왕복 1) → 목록을 통째로 다시 받기(왕복 2)
   *        → 그제서야 파란 배경이 사라지고 → 그제서야 화면이 넘어감
   *
   * 한 칸이 한국↔싱가포르 왕복이라, 누르고 나서 한참을 아무 일도 안
   * 일어난 것처럼 보인다. 특히 가격 알림("8만원 됐어요")은 급해서 누르는
   * 것이라 그 멈춤이 제일 크게 느껴진다.
   *
   * 커뮤니티 댓글이 이미 이렇게 한다 — 쓰면 목록에 곧바로 얹고, 서버는
   * 뒤따라간다. 같은 방식으로 바꾼다.
   *
   *   1) 캐시를 지금 자리에서 고친다(읽음 표시 + 안 읽은 수 -1)
   *   2) 곧바로 화면을 넘긴다
   *   3) 서버에는 뒤에 알린다. 실패하면 되돌린다
   */
  const 읽음으로 = (id: number) => {
    qc.setQueryData<{ items?: NotificationItem[] } | NotificationItem[]>(
      ["notiList"], (prev) => 표시하기(prev, id, true));
    qc.setQueryData<{ items?: NotificationItem[] } | NotificationItem[]>(
      ["notiPage"], (prev) => 표시하기(prev, id, true));
    qc.setQueryData<{ count: number; capped: boolean } | undefined>(
      ["notiUnread"], (prev) =>
        prev ? { ...prev, count: Math.max(0, (prev.count ?? 0) - 1) } : prev);
  };

  const 되돌리기 = (id: number) => {
    qc.setQueryData<{ items?: NotificationItem[] } | NotificationItem[]>(
      ["notiList"], (prev) => 표시하기(prev, id, false));
    qc.setQueryData<{ items?: NotificationItem[] } | NotificationItem[]>(
      ["notiPage"], (prev) => 표시하기(prev, id, false));
    qc.invalidateQueries({ queryKey: ["notiUnread"] });
  };

  const open = (n: NotificationItem) => {
    onNavigate?.();
    if (!n.is_read) {
      읽음으로(n.id);
      /* 기다리지 않는다. 이 요청의 결과로 화면이 달라질 것이 없다 —
         이미 다 바꿔 놓았다. 실패했을 때만 되돌린다 */
      communityApi.markNotificationRead(n.id).catch(() => 되돌리기(n.id));
    }
    const href = notificationHref(n);
    if (href) navigate(href);
  };

  return (
    <ul>
      {items.map((n) => {
        const meta = KIND_META[n.kind] ?? KIND_META.comment;
        /* 사람이 한 일이 아닌 알림(가격 알림)은 보낸 사람이 없다.
           그대로 그리면 빈 동그라미와 이름 없는 문장 — "님이 ..." 도 아닌
           그냥 빈칸 — 이 남는다. 아이콘 하나와 내용만 보여 준다. */
        const 사람이_한_일 = n.actor_id != null && !!n.actor_name;
        return (
          <li key={n.id}>
            <button
              onClick={() => open(n)}
              className={`w-full flex gap-2.5 text-left border-b border-border/50 hover:bg-bg-elevated transition-colors ${
                roomy ? "px-4 py-3.5" : "px-3 py-2.5"
              } ${n.is_read ? "" : "bg-accent-blue/5"}`}
            >
              <div className="relative shrink-0">
                {사람이_한_일 ? (
                  <>
                    <Avatar username={n.actor_name} colorIndex={n.actor_color}
                            avatarUrl={n.actor_avatar} size={roomy ? "md" : "base"} />
                    <meta.Icon size={11}
                      className={`absolute -bottom-0.5 -right-0.5 p-[1px] rounded-full bg-bg-card ${meta.cls}`} />
                  </>
                ) : (
                  <div className={`flex items-center justify-center rounded-full bg-bg-elevated border border-border ${
                    roomy ? "w-8 h-8" : "w-7 h-7"
                  }`}>
                    <meta.Icon size={roomy ? 15 : 13} className={meta.cls} />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                {/* break-keep: 한글은 어절 단위로 끊어야 "남겼습니 / 다"처럼
                    낱말이 잘리지 않는다. 좁은 화면에서 특히 눈에 띈다 */}
                <p className="text-xs text-text-secondary leading-snug break-keep">
                  {사람이_한_일 ? (
                    <>
                      <span className="font-semibold text-text-primary">{n.actor_name}</span>
                      {meta.text}
                    </>
                  ) : (
                    <span className="font-semibold text-text-primary">{meta.label}</span>
                  )}
                </p>
                {n.preview && (
                  <p className={`mt-0.5 line-clamp-2 break-keep ${
                    사람이_한_일 ? "text-2xs text-text-dim" : "text-xs text-text-secondary"
                  }`}>{n.preview}</p>
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
