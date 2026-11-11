/**
 * 새 메시지 — 메시지 목록 위의 연필 단추로 연다(사용자: "메시지 개선할 거 있으면 개선해줘").
 *
 * 전에는 대화를 새로 시작하려면 피드에서 그 사람의 글을 찾아 프로필로 들어가야만 했다. 여기서는 팔로우로 이어진
 * 사람(내가 팔로우하는 사람·나를 팔로우하는 사람)을 바로 골라 대화를 연다. 아무나 찾아 말을 거는 길은 여전히 두지
 * 않는다 — 모르는 사람에게서 오는 메시지를 늘리지 않으려고. 그런 사람은 지금처럼 프로필의 '메시지' 로.
 *
 * 목록은 프로필의 팔로워·팔로잉 창과 같은 서랍(["userFollowing", 나], ["userFollowers", 나])을 쓴다.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search, Users, X } from "lucide-react";
import { communityApi } from "@/api/community";
import { dmApi } from "@/api/dm";
import { useAuthStore } from "@/store/authStore";
import Avatar from "@/components/community/Avatar";
import { Modal, 못불러옴, RowSkeleton, cn } from "@/components/ui";

/** 서버의 팔로워·팔로잉 한 줄(routes/community.py get_followers·get_following) */
export interface 팔로우사람 {
  user_id: number;
  username: string;
  nickname: string | null;
  avatar_color: number;
  avatar_url?: string | null;
}

export interface 고를사람 extends 팔로우사람 {
  이름: string;
  /** 어떻게 이어졌나 — 서로 팔로우하면 '서로 팔로우' */
  사이: "서로 팔로우" | "팔로잉" | "팔로워";
}

/** 팔로잉·팔로워를 한 목록으로 — 겹치는 사람은 한 번(서로 팔로우), 서로 팔로우 → 팔로잉 → 팔로워 차례, 각 안에서는 받은 차례 */
export function 사람합치기(팔로잉: 팔로우사람[], 팔로워: 팔로우사람[]): 고를사람[] {
  const 나를 = new Set(팔로워.map((p) => p.user_id));
  const 내가 = new Set(팔로잉.map((p) => p.user_id));
  const 본 = new Set<number>();
  const 모두: 고를사람[] = [];
  for (const p of [...팔로잉, ...팔로워]) {
    if (본.has(p.user_id)) continue;
    본.add(p.user_id);
    const 사이 = 내가.has(p.user_id) && 나를.has(p.user_id) ? "서로 팔로우" : 내가.has(p.user_id) ? "팔로잉" : "팔로워";
    모두.push({ ...p, 이름: p.nickname || p.username, 사이 });
  }
  const 차례 = { "서로 팔로우": 0, "팔로잉": 1, "팔로워": 2 } as const;
  // 자바스크립트의 sort 는 같은 값끼리 받은 차례를 지킨다
  return 모두.sort((a, b) => 차례[a.사이] - 차례[b.사이]);
}

/** 이름·아이디에 찾는 글이 들어 있나(대소문자 무시) */
export function 찾기맞나(p: 고를사람, 찾는: string): boolean {
  const q = 찾는.trim().toLowerCase();
  return !q || p.이름.toLowerCase().includes(q) || p.username.toLowerCase().includes(q);
}

export default function 새대화창({ 닫기 }: { 닫기: () => void }) {
  const 나 = useAuthStore((s) => s.userId);
  const navigate = useNavigate();
  const [찾는, set찾는] = useState("");
  const [여는중, set여는중] = useState<number | null>(null);
  const [오류, set오류] = useState<string | null>(null);

  const 팔로잉 = useQuery<팔로우사람[]>({
    queryKey: ["userFollowing", 나],
    queryFn: () => communityApi.getFollowing(나!),
    enabled: 나 != null,
    staleTime: 60_000,
  });
  const 팔로워 = useQuery<팔로우사람[]>({
    queryKey: ["userFollowers", 나],
    queryFn: () => communityApi.getFollowers(나!),
    enabled: 나 != null,
    staleTime: 60_000,
  });
  const 받는중 = 팔로잉.isLoading || 팔로워.isLoading;
  const 실패 = 팔로잉.error ?? 팔로워.error;
  const 모두 = useMemo(() => 사람합치기(팔로잉.data ?? [], 팔로워.data ?? []), [팔로잉.data, 팔로워.data]);
  const 보일것 = 모두.filter((p) => 찾기맞나(p, 찾는));

  const 열기 = async (p: 고를사람) => {
    if (여는중 != null) return;
    set여는중(p.user_id);
    set오류(null);
    try {
      const { id } = await dmApi.openThread(p.user_id);
      닫기();
      navigate(`/messages/${id}`);
    } catch (e) {
      const 코드 = (e as { response?: { status?: number } } | null)?.response?.status;
      set오류(코드 === 403 ? "커뮤니티 이용이 제한된 계정은 메시지를 보낼 수 없어요"
        : 코드 === 429 ? "대화를 너무 자주 열고 있어요. 잠시 뒤 다시 해 주세요"
        : 코드 === 404 ? "탈퇴했거나 찾을 수 없는 사용자예요"
        : "대화를 열지 못했어요. 잠시 뒤 다시 해 주세요");
    } finally {
      set여는중(null);
    }
  };

  return (
    <Modal onClose={닫기} 시트 maxWidth="max-w-sm">
      <div className="px-5 pt-4 pb-1 flex items-center gap-2">
        <h2 className="flex-1 text-base font-bold text-text-primary">새 메시지</h2>
        <button type="button" onClick={닫기} aria-label="닫기"
          className="p-1 -mr-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-elevated">
          <X size={16} />
        </button>
      </div>
      <p className="px-5 text-xs text-text-muted break-keep">팔로우로 이어진 사람에게 메시지를 보낼 수 있어요.</p>

      {모두.length > 0 && (
        <div className="px-4 pt-3">
          <label className="flex items-center gap-2 px-3 py-2 rounded-xl bg-bg-elevated border border-border focus-within:border-accent-blue/50 transition-colors">
            <Search size={14} className="shrink-0 text-text-dim" />
            <input type="search" value={찾는} onChange={(e) => set찾는(e.target.value)}
              aria-label="이름으로 찾기" placeholder="이름으로 찾기" enterKeyHint="search"
              className="flex-1 min-w-0 bg-transparent text-sm text-text-primary placeholder:text-text-dim focus:outline-none" />
          </label>
        </div>
      )}

      <div className="px-2 py-3 min-h-[8rem] max-h-[60vh] overflow-y-auto">
        {나 == null ? null : 받는중 ? (
          <RowSkeleton rows={3} />
        ) : 실패 ? (
          <못불러옴 사유={실패} 다시={() => { void 팔로잉.refetch(); void 팔로워.refetch(); }} compact />
        ) : 모두.length === 0 ? (
          <div className="py-6 px-4 flex flex-col items-center gap-2 text-center">
            <Users size={22} className="text-text-dim opacity-60" />
            <p className="text-sm text-text-secondary">아직 팔로우로 이어진 사람이 없어요</p>
            <p className="text-xs text-text-dim break-keep">피드에서 프로필을 열고 '메시지' 를 눌러도 대화를 시작할 수 있어요</p>
            <button type="button" onClick={() => { 닫기(); navigate("/feed"); }}
              className="mt-1 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-text-secondary hover:border-accent-blue/50 hover:text-accent-blue transition-colors">
              피드 보기
            </button>
          </div>
        ) : 보일것.length === 0 ? (
          <p className="py-8 text-center text-sm text-text-dim break-keep">'{찾는.trim()}' 에 맞는 사람이 없어요</p>
        ) : (
          <ul aria-label="메시지를 보낼 사람" className="flex flex-col">
            {보일것.map((p) => (
              <li key={p.user_id}>
                <button type="button" onClick={() => void 열기(p)} disabled={여는중 != null}
                  className={cn("w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left hover:bg-bg-elevated transition-colors disabled:cursor-wait",
                    여는중 != null && 여는중 !== p.user_id && "opacity-50")}>
                  <Avatar username={p.이름} colorIndex={p.avatar_color} avatarUrl={p.avatar_url ?? null} size="md" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-text-primary truncate">{p.이름}</span>
                    <span className="block text-2xs text-text-dim truncate">@{p.username}</span>
                  </span>
                  <span className={cn("shrink-0 text-2xs", p.사이 === "서로 팔로우" ? "text-accent-blue font-semibold" : "text-text-dim")}>
                    {여는중 === p.user_id ? "여는 중…" : p.사이}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {오류 && <p role="alert" className="px-3 pt-2 text-2xs text-accent-red break-keep">{오류}</p>}
      </div>
    </Modal>
  );
}
