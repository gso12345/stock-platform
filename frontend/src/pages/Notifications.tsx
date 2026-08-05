/**
 * 전체 알림 화면.
 *
 * 헤더의 종은 최근 30건만 보여준다. 밀린 알림을 훑거나, 좁은 화면에서 편하게
 * 보려면 별도 화면이 필요하다. 알림 설정도 여기에 함께 둔다 — 알림을 보다가
 * "이건 그만 받고 싶다"고 느끼는 지점이 바로 여기이기 때문이다.
 */
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams, Link, useNavigate } from "react-router-dom";
import { Bell, CheckCheck, LogIn, ChevronLeft, ChevronRight } from "lucide-react";
import { communityApi } from "@/api/stocks";
import { useAuthStore } from "@/store/authStore";
import NotificationList, { type NotificationItem } from "@/components/community/NotificationList";
import NotificationSettings from "@/components/community/NotificationSettings";
import { 빈화면 } from "@/components/ui";

export default function Notifications() {
  const { isLoggedIn } = useAuthStore();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const qc = useQueryClient();

  // 종의 "알림 설정"에서 들어오면 설정이 펼쳐진 채로 열린다
  const [showSettings, setShowSettings] = useState(params.get("settings") === "1");
  useEffect(() => {
    if (params.get("settings") === "1") {
      setShowSettings(true);
      setParams((p) => { p.delete("settings"); return p; }, { replace: true });
    }
  }, [params, setParams]);

  const { data, isLoading } = useQuery({
    queryKey: ["notiPage", page],
    queryFn: () => communityApi.getNotifications(page),
    enabled: isLoggedIn,
  });

  const { data: unread } = useQuery({
    queryKey: ["notiUnread"],
    queryFn: communityApi.getUnreadNotificationCount,
    enabled: isLoggedIn,
  });

  const readAll = useMutation({
    mutationFn: communityApi.markAllNotificationsRead,
    onSuccess: () => {
      qc.setQueryData(["notiUnread"], { count: 0, capped: false });
      qc.invalidateQueries({ queryKey: ["notiPage"] });
      qc.invalidateQueries({ queryKey: ["notiList"] });
    },
  });

  if (!isLoggedIn) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center">
        <Bell size={28} className="mx-auto mb-3 text-text-dim opacity-50" />
        <p className="text-sm text-text-muted mb-4">알림을 보려면 로그인이 필요합니다</p>
        <Link to="/login"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent-blue text-white text-xs font-semibold hover:bg-accent-blue/90 transition-all">
          <LogIn size={13} /> 로그인
        </Link>
      </div>
    );
  }

  const items: NotificationItem[] = data?.items ?? [];
  const count = unread?.count ?? 0;
  // 서버는 한 번에 30건까지 준다 — 꽉 찼으면 다음 쪽이 있을 수 있다
  const hasNext = items.length === 30;

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Bell size={18} className="text-accent-blue" />
        <h1 className="text-lg font-bold text-text-primary">알림</h1>
        {count > 0 && (
          <span className="px-1.5 py-0.5 rounded-full bg-accent-red text-white text-2xs font-bold">
            {unread?.capped ? "99+" : count}
          </span>
        )}
        <div className="flex-1" />
        {count > 0 && (
          <button
            onClick={() => readAll.mutate()}
            disabled={readAll.isPending}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-border text-xs text-text-muted hover:text-accent-blue hover:border-accent-blue/40 transition-all disabled:opacity-50"
          >
            <CheckCheck size={13} /> 모두 읽음
          </button>
        )}
      </div>

      <NotificationSettings open={showSettings} onToggle={() => setShowSettings((v) => !v)} />

      <div className="bg-bg-card border border-border rounded-2xl overflow-hidden">
        {isLoading ? (
          <p className="px-4 py-12 text-center text-xs text-text-dim">불러오는 중…</p>
        ) : items.length === 0 ? (
          /* 첫 장이 비어 있는 것과 마지막 장까지 넘긴 것은 다른 상황이다.
             앞의 경우에만 '무엇을 하면 알림이 오는지' 를 알려준다 */
          page > 1 ? (
            <빈화면 compact icon={Bell} title="더 이상 알림이 없습니다" />
          ) : (
            <빈화면
              icon={Bell}
              title="아직 알림이 없어요"
              hint="내 글에 댓글이 달리거나 누가 나를 팔로우하면 여기로 알려드려요"
              action={{ label: "피드 둘러보기", onClick: () => navigate("/feed") }}
            />
          )
        ) : (
          <NotificationList items={items} roomy />
        )}
      </div>

      {(page > 1 || hasNext) && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            aria-label="이전 쪽"
            className="p-2 rounded-xl border border-border text-text-muted hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            <ChevronLeft size={15} />
          </button>
          <span className="text-xs text-text-muted tabular-nums">{page}</span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={!hasNext}
            aria-label="다음 쪽"
            className="p-2 rounded-xl border border-border text-text-muted hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            <ChevronRight size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
