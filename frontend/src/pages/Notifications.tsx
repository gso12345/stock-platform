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
import { Bell, CheckCheck, LogIn, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { communityApi } from "@/api/stocks";
import { useAuthStore } from "@/store/authStore";
import NotificationList, { 모두읽음, 읽은것빼기, type NotificationItem } from "@/components/community/NotificationList";
import NotificationSettings from "@/components/community/NotificationSettings";
import MyPriceAlerts from "@/components/community/MyPriceAlerts";
import { use확인 } from "@/hooks/useDialogs";
import { 빈화면, 못불러옴, RowSkeleton} from "@/components/ui";

export default function Notifications() {
  const { isLoggedIn } = useAuthStore();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const qc = useQueryClient();
  /* 지우기는 못 되돌린다. 브라우저 기본 창 대신 앱 확인창을 쓴다 */
  const { 묻기, 화면: 확인창 } = use확인();

  // 종의 "알림 설정"에서 들어오면 설정이 펼쳐진 채로 열린다
  const [showSettings, setShowSettings] = useState(params.get("settings") === "1");
  /* 시세 알림 목록은 접어 둔다. 펼친 채로 두면 알림을 보러 온 사람이
     매번 그 목록을 지나쳐야 새 알림에 닿는다 */
  const [알림목록열림, set알림목록열림] = useState(false);
  useEffect(() => {
    if (params.get("settings") === "1") {
      setShowSettings(true);
      setParams((p) => { p.delete("settings"); return p; }, { replace: true });
    }
  }, [params, setParams]);

  const { data, isLoading, isError: 못받음, error: 실패사유, refetch: 다시받기 } = useQuery({
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
    /* 누른 즉시 바꾼다 — 종과 같은 방식.
       서버가 답한 뒤에 목록을 다시 받으면 왕복이 둘이고, 그동안
       화면은 아무 일도 안 일어난 것처럼 보인다 */
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ["notiPage"] });
      const 이전 = qc.getQueryData(["notiPage"]);
      const 이전수 = qc.getQueryData(["notiUnread"]);
      qc.setQueryData(["notiUnread"], { count: 0, capped: false });
      qc.setQueryData(["notiPage"], (prev: unknown) => 모두읽음(prev));
      qc.setQueryData(["notiList"], (prev: unknown) => 모두읽음(prev));
      return { 이전, 이전수 };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.이전 !== undefined) qc.setQueryData(["notiPage"], ctx.이전);
      if (ctx?.이전수 !== undefined) qc.setQueryData(["notiUnread"], ctx.이전수);
      qc.invalidateQueries({ queryKey: ["notiList"] });
    },
  });

  /**
   * 읽은 알림 정리.
   *
   * '모두 읽음' 을 눌러도 목록은 그대로 남는다. 며칠 쓰면 다 읽은 알림
   * 수백 줄을 계속 넘겨야 새 것이 나온다 — 읽음 표시는 그 줄이
   * 쓸모없어졌다는 뜻인데 화면이 그걸 안 치웠다.
   *
   * **안 읽은 것은 안 지운다.** 서버도 같은 규칙이다. 아직 못 본 것까지
   * 쓸어 버리면 되돌릴 방법이 없다.
   */
  const 읽은것정리 = useMutation({
    mutationFn: communityApi.deleteReadNotifications,
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ["notiPage"] });
      const 이전 = qc.getQueryData(["notiPage"]);
      const 이전종 = qc.getQueryData(["notiList"]);
      qc.setQueryData(["notiPage"], (prev: unknown) => 읽은것빼기(prev));
      qc.setQueryData(["notiList"], (prev: unknown) => 읽은것빼기(prev));
      return { 이전, 이전종 };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.이전 !== undefined) qc.setQueryData(["notiPage"], ctx.이전);
      if (ctx?.이전종 !== undefined) qc.setQueryData(["notiList"], ctx.이전종);
    },
    /* 지운 만큼 다음 쪽이 당겨진다. 이 쪽만 고쳐 두면 넘겼을 때
       이미 지운 줄이 다시 나온다 */
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["notiPage"] }); setPage(1); },
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
  /* 지울 것이 없는데 단추가 있으면 눌러 놓고 아무 일도 안 일어나는
     것을 보게 된다 */
  const 읽은것있나 = items.some((n) => n.is_read);
  // 서버는 한 번에 30건까지 준다 — 꽉 찼으면 다음 쪽이 있을 수 있다
  const hasNext = items.length === 30;

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Bell size={16} className="text-accent-blue" />
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
        {/* 읽은 줄이 있을 때만 보여 준다. 지울 것이 없는데 단추가 있으면
            눌러 놓고 아무 일도 안 일어나는 것을 보게 된다 */}
        {읽은것있나 && (
          <button
            onClick={() => 묻기({
              title: "읽은 알림을 정리할까요?",
              message: "이미 읽은 알림만 지웁니다. 안 읽은 알림은 그대로 남아요.",
              확인글: "정리",
              onConfirm: () => 읽은것정리.mutate(),
            })}
            disabled={읽은것정리.isPending}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-border text-xs text-text-muted hover:text-accent-red hover:border-accent-red/40 transition-all disabled:opacity-50"
          >
            <Trash2 size={13} /> 읽은 것 정리
          </button>
        )}
      </div>

      <NotificationSettings open={showSettings} onToggle={() => setShowSettings((v) => !v)} />
      {/* '어떤 알림을 받을까' 바로 다음에 오는 질문이 '지금 무엇을
          기다리고 있나' 다. 지금까지 그 답은 종목 상세의 종 안에만
          있어서, 알림을 건 종목을 이미 알고 있어야 볼 수 있었다 */}
      <MyPriceAlerts open={알림목록열림} onToggle={() => set알림목록열림((v) => !v)} />

      <div className="bg-bg-card border border-border rounded-2xl overflow-hidden">
        {isLoading ? (
          <RowSkeleton rows={5} />
        ) : 못받음 ? (
          <못불러옴 사유={실패사유} 다시={() => 다시받기()} />
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
            <ChevronLeft size={14} />
          </button>
          <span className="text-xs text-text-muted tabular-nums">{page}</span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={!hasNext}
            aria-label="다음 쪽"
            className="p-2 rounded-xl border border-border text-text-muted hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      )}

      {확인창}
    </div>
  );
}
