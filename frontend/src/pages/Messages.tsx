/**
 * 메시지 — 1:1 대화 목록(사용자: "상대방이랑 채팅도 할 수 있도록 해줘").
 *
 *   · 최근에 말이 오간 방부터. 안 읽은 것이 있으면 이름을 굵게, 오른쪽에 빨간 수
 *   · 마지막 메시지 한 줄 — 내가 보낸 것이면 앞에 '나:'
 *   · 열려 있는 동안 15초마다 다시 묻는다(창이 뒤에 있으면 안 묻는다). 메시지 푸시가 오면 바로
 *   · 쓰다 만 글이 있는 방은 마지막 메시지 대신 '쓰던 글: …'(utils/대화초안)
 *
 * 대화는 상대 프로필의 '메시지' 로, 또는 위의 연필 단추(새 메시지)에서 팔로우로 이어진 사람을 골라 시작한다.
 * 아무나 찾아 먼저 말을 거는 길은 두지 않았다 — 모르는 사람에게서 오는 메시지를 늘리지 않으려고.
 */
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { MessageCircle, SquarePen, UserX } from "lucide-react";
import { dmApi, dm열쇠, type 대화방줄 } from "@/api/dm";
import { useAuthStore } from "@/store/authStore";
import Avatar from "@/components/community/Avatar";
import 차단목록창 from "@/components/dm/차단목록창";
import 새대화창 from "@/components/dm/새대화창";
import { RowSkeleton, 못불러옴, 빈화면, cn } from "@/components/ui";
import { 목록시각 } from "@/utils/대화시각";
import { 초안읽기 } from "@/utils/대화초안";

/** 방 하나의 안 읽은 수 — 서버가 99 에서 세기를 멈춘다 */
export function 안읽음글(n: number): string {
  return n >= 99 ? "99+" : String(n);
}

function 방줄({ t }: { t: 대화방줄 }) {
  const 안읽음 = t.unread > 0;
  /* 쓰다 만 글 — 메신저 앱들처럼 마지막 메시지 대신 보인다. 안 읽은 것이 있으면 그쪽(상대가 보낸 것)이 먼저 */
  const 쓰던글 = 안읽음 ? "" : 초안읽기(t.id).replace(/\s+/g, " ").trim();
  return (
    <Link to={`/messages/${t.id}`}
      className="flex items-center gap-3 px-4 py-3 hover:bg-bg-elevated active:bg-bg-elevated transition-colors">
      <Avatar username={t.other.name} colorIndex={t.other.avatar_color} avatarUrl={t.other.avatar_url} size="lg" />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className={cn("flex-1 min-w-0 truncate text-sm text-text-primary",
            안읽음 ? "font-bold" : "font-semibold", !t.other.active && "text-text-muted")}>
            {t.other.name}
          </span>
          <span className="shrink-0 text-2xs text-text-dim">{목록시각(t.last_message.created_at)}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          {쓰던글 ? (
            <p className="flex-1 min-w-0 truncate text-xs text-text-muted">
              <span className="font-semibold text-accent-blue">쓰던 글: </span>{쓰던글}
            </p>
          ) : (
            <p className={cn("flex-1 min-w-0 truncate text-xs", 안읽음 ? "text-text-primary" : "text-text-muted")}>
              {t.last_message.mine && <span className="text-text-dim">나: </span>}
              {t.last_message.preview}
            </p>
          )}
          {안읽음 && (
            <span aria-label={`안 읽은 메시지 ${안읽음글(t.unread)}개`}
              className="shrink-0 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-accent-red text-white text-2xs font-bold leading-none">
              {안읽음글(t.unread)}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

export default function Messages() {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const navigate = useNavigate();
  const [차단보기, set차단보기] = useState(false);
  const [새로쓰기, set새로쓰기] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: dm열쇠.목록,
    queryFn: dmApi.listThreads,
    enabled: isLoggedIn,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    staleTime: 5_000,
  });
  const 방들 = data?.items ?? [];

  if (!isLoggedIn) {
    return (
      <div className="max-w-2xl mx-auto">
        <h1 className="text-xl font-bold text-text-primary">메시지</h1>
        <빈화면 icon={MessageCircle} title="로그인하면 메시지를 주고받을 수 있어요"
          hint="다른 사람의 프로필에서 '메시지' 를 눌러 대화를 시작해요"
          action={{ label: "로그인", onClick: () => navigate("/login") }} />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <h1 className="flex-1 text-xl font-bold text-text-primary">메시지</h1>
        <button type="button" onClick={() => set차단보기(true)}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors">
          <UserX size={13} /> 차단한 사람
        </button>
        {/* 새 메시지 — 팔로우로 이어진 사람을 골라 대화를 연다(components/dm/새대화창) */}
        <button type="button" aria-label="새 메시지" onClick={() => set새로쓰기(true)}
          className="p-1.5 -mr-1.5 rounded-lg text-text-secondary hover:text-accent-blue hover:bg-bg-elevated transition-colors">
          <SquarePen size={20} />
        </button>
      </div>

      {isLoading ? (
        <RowSkeleton rows={5} />
      ) : isError ? (
        <못불러옴 사유={error} 다시={() => refetch()} />
      ) : 방들.length === 0 ? (
        <빈화면 icon={MessageCircle} title="아직 나눈 메시지가 없어요"
          hint="팔로우하는 사람에게 먼저 말을 걸어 보세요. 프로필의 '메시지' 로도 시작할 수 있어요"
          action={{ label: "새 메시지", onClick: () => set새로쓰기(true) }} />
      ) : (
        <ul aria-label="대화 목록"
          className="bg-bg-card border border-border rounded-2xl overflow-hidden divide-y divide-border-subtle">
          {방들.map((t) => <li key={t.id}><방줄 t={t} /></li>)}
        </ul>
      )}

      {차단보기 && <차단목록창 닫기={() => set차단보기(false)} />}
      {새로쓰기 && <새대화창 닫기={() => set새로쓰기(false)} />}
    </div>
  );
}
