/**
 * 헤더의 알림 종.
 *
 * 안 읽은 개수는 화면이 떠 있는 내내 주기적으로 물어보게 되므로, 목록과 분리된
 * 가벼운 엔드포인트(COUNT 한 번)만 주기 조회한다. 목록은 종을 눌러 열 때만
 * 가져온다 — 열지도 않을 30건을 계속 받아올 이유가 없다.
 *
 * 여는 방식은 화면 크기에 따라 다르다. 좁은 화면에서 320px짜리 드롭다운은
 * 글자가 두세 줄로 접히고 손가락으로 누르기도 좁아서, 아래에서 올라오는
 * 시트로 띄운다(이 앱의 "더보기" 메뉴와 같은 방식).
 */
import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Bell, CheckCheck, X, Settings } from "lucide-react";
import { communityApi } from "@/api/stocks";
import { useAuthStore } from "@/store/authStore";
import NotificationList, { 모두읽음, type NotificationItem } from "@/components/community/NotificationList";

/** 이 폭 미만이면 시트로 연다 — Tailwind의 lg 기준과 맞춘다 */
const SHEET_BELOW = 1024;

export default function NotificationBell() {
  const { isLoggedIn } = useAuthStore();
  const [open, setOpen] = useState(false);
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== "undefined" && window.innerWidth < SHEET_BELOW
  );
  const wrapRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth < SHEET_BELOW);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

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

  /* 누른 즉시 다 읽은 모양으로 바꾼다.
     예전에는 서버가 답한 **뒤에야** 배지가 사라지고, 거기서 목록을 또
     받아 와야 파란 배경이 걷혔다 — 왕복 둘이다. 그동안 사람은 안 눌린
     줄 알고 한 번 더 누른다. */
  const readAll = useMutation({
    mutationFn: communityApi.markAllNotificationsRead,
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ["notiList"] });
      const 이전목록 = qc.getQueryData(["notiList"]);
      const 이전수 = qc.getQueryData(["notiUnread"]);
      qc.setQueryData(["notiUnread"], { count: 0, capped: false });
      qc.setQueryData(["notiList"], (prev: unknown) => 모두읽음(prev));
      qc.setQueryData(["notiPage"], (prev: unknown) => 모두읽음(prev));
      return { 이전목록, 이전수 };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.이전목록 !== undefined) qc.setQueryData(["notiList"], ctx.이전목록);
      if (ctx?.이전수 !== undefined) qc.setQueryData(["notiUnread"], ctx.이전수);
      qc.invalidateQueries({ queryKey: ["notiPage"] });
    },
  });

  // 바깥을 누르거나 Esc를 누르면 닫는다 (드롭다운일 때만 — 시트는 덮개를 누른다)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (isNarrow) return;
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, isNarrow]);

  // 시트가 열려 있는 동안 뒤 화면이 스크롤되지 않게 한다
  useEffect(() => {
    if (!(open && isNarrow)) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open, isNarrow]);

  if (!isLoggedIn) return null;

  const count = unread?.count ?? 0;
  const badge = unread?.capped ? "99+" : String(count);
  const items: NotificationItem[] = list?.items ?? [];

  const 머리말 = (
    <div className="flex items-center gap-2 px-4 py-3 bg-bg-card border-b border-border">
      <span className="text-sm font-bold text-text-primary">알림</span>
      <div className="flex-1" />
      {count > 0 && (
        <button
          onClick={() => readAll.mutate()}
          disabled={readAll.isPending}
          className="flex items-center gap-1 text-2xs text-text-muted hover:text-accent-blue transition-colors disabled:opacity-50"
        >
          <CheckCheck size={13} /> 모두 읽음
        </button>
      )}
      {isNarrow && (
        <button onClick={() => setOpen(false)} aria-label="닫기"
          className="p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-elevated">
          <X size={16} />
        </button>
      )}
    </div>
  );

  const 본문 = isLoading ? (
    <p className="px-3 py-8 text-center text-xs text-text-dim">불러오는 중…</p>
  ) : items.length === 0 ? (
    <div className="px-3 py-10 text-center">
      <Bell size={22} className="mx-auto mb-2 text-text-dim opacity-50" />
      <p className="text-xs text-text-dim">아직 알림이 없습니다</p>
    </div>
  ) : (
    <NotificationList items={items} onNavigate={() => setOpen(false)} roomy={isNarrow} />
  );

  const 꼬리말 = (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-bg-card border-t border-border">
      <Link to="/notifications" onClick={() => setOpen(false)}
        className="text-2xs font-semibold text-accent-blue hover:underline">
        전체 보기
      </Link>
      <div className="flex-1" />
      <Link to="/notifications?settings=1" onClick={() => setOpen(false)}
        className="flex items-center gap-1 text-2xs text-text-muted hover:text-text-primary transition-colors">
        <Settings size={13} /> 알림 설정
      </Link>
    </div>
  );

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
          <span className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-0.5 flex items-center justify-center rounded-full bg-accent-red text-white text-2xs font-bold leading-none">
            {badge}
          </span>
        )}
      </button>

      {open && !isNarrow && (
        <div role="menu"
          className="absolute right-0 top-full mt-1.5 w-80 z-50 bg-bg-card border border-border rounded-2xl shadow-float overflow-hidden">
          {머리말}
          <div className="max-h-[60vh] overflow-y-auto">{본문}</div>
          {꼬리말}
        </div>
      )}

      {open && isNarrow && (
        <>
          <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm modal-backdrop"
               onClick={() => setOpen(false)} aria-hidden />
          <div
            role="menu"
            className="fixed inset-x-0 bottom-0 z-50 bg-bg-card border-t border-border rounded-t-2xl shadow-modal flex flex-col"
            // 화면의 80%까지만 차지하고, 아이폰 홈 인디케이터 영역을 피한다
            style={{ maxHeight: "80vh", paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            {/* 손잡이 — 아래에서 올라온 시트라는 걸 알려준다 */}
            <div className="pt-2 pb-1 flex justify-center shrink-0">
              <span className="w-9 h-1 rounded-full bg-border" aria-hidden />
            </div>
            <div className="shrink-0">{머리말}</div>
            <div className="flex-1 overflow-y-auto overscroll-contain">{본문}</div>
            <div className="shrink-0">{꼬리말}</div>
          </div>
        </>
      )}
    </div>
  );
}
