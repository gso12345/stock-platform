/**
 * 머리의 메시지 아이콘 — 안 읽은 메시지 수를 빨간 배지로. 누르면 대화 목록(/messages).
 *
 * 알림 종처럼 가벼운 '수' 만 1분마다 묻는다(창이 뒤에 있으면 안 묻는다). 메시지 푸시가 오면 그 자리에서 다시
 * 묻는다(hooks/useDmPush) — 휴대폰 알림이 울렸는데 배지는 그대로인 1분을 없앤다.
 * 로그인 전에도 보인다 — 누르면 목록 화면이 로그인하라고 말한다(종과 같은 규칙).
 */
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
import { dmApi, dm열쇠, type 안읽음 } from "@/api/dm";
import { useAuthStore } from "@/store/authStore";
import { use메시지푸시 } from "@/hooks/useDmPush";

/** 배지 글 — 없으면 null, 서버가 세다 멈췄으면(capped) '99+' */
export function 배지글(n?: 안읽음 | null): string | null {
  if (!n?.count) return null;
  return n.capped ? "99+" : String(n.count);
}

/** 안 읽은 메시지 수 — 머리 아이콘과 더보기 화면이 같은 서랍을 쓴다(요청이 겹치지 않는다) */
export function use안읽은메시지() {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  return useQuery({
    queryKey: dm열쇠.안읽음,
    queryFn: dmApi.unreadCount,
    enabled: isLoggedIn,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    staleTime: 20_000,
  });
}

export default function 메시지아이콘() {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const qc = useQueryClient();
  const { data } = use안읽은메시지();
  use메시지푸시(() => {
    if (!isLoggedIn) return;
    qc.invalidateQueries({ queryKey: dm열쇠.안읽음 });
    qc.invalidateQueries({ queryKey: dm열쇠.목록 });
  });
  const 배지 = isLoggedIn ? 배지글(data) : null;
  return (
    <Link to="/messages"
      aria-label={배지 ? `메시지, 안 읽은 메시지 ${배지}개` : "메시지"}
      title={isLoggedIn ? "메시지" : "메시지 — 로그인하면 볼 수 있어요"}
      className="relative p-1.5 rounded-lg border border-border hover:bg-bg-elevated text-text-muted hover:text-text-primary transition-all">
      <MessageCircle size={14} />
      {배지 && (
        <span aria-hidden
          className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-0.5 flex items-center justify-center rounded-full bg-accent-red text-white text-2xs font-bold leading-none">
          {배지}
        </span>
      )}
    </Link>
  );
}
