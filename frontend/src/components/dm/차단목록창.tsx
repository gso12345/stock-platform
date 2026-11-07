/**
 * 차단한 사람 — 메시지 목록에서 연다. 여기서 풀 수 있다.
 *
 * 차단은 양쪽을 막는다(내가 막은 사람에게도 못 보낸다). 막힌 사람에게는 알리지 않는다 — 그쪽 화면에는
 * '메시지를 보낼 수 없어요' 만 보인다(서버 routes/dm.py).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserX, X } from "lucide-react";
import { dmApi, dm열쇠 } from "@/api/dm";
import Avatar from "@/components/community/Avatar";
import { Modal, 못불러옴, RowSkeleton } from "@/components/ui";

export default function 차단목록창({ 닫기 }: { 닫기: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: dm열쇠.차단,
    queryFn: dmApi.listBlocks,
    staleTime: 0,
  });
  const 풀기 = useMutation({
    mutationFn: (id: number) => dmApi.unblock(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: dm열쇠.차단 });
      // 그 사람의 프로필·대화방도 '보낼 수 있다' 로 바뀐다
      qc.invalidateQueries({ queryKey: ["userPublicProfile"] });
      qc.invalidateQueries({ queryKey: ["dmThread"] });
    },
  });
  const 사람들 = data?.items ?? [];

  return (
    <Modal onClose={닫기} 시트 maxWidth="max-w-sm">
      <div className="px-5 pt-4 pb-1 flex items-center gap-2">
        <h2 className="flex-1 text-base font-bold text-text-primary">차단한 사람</h2>
        <button type="button" onClick={닫기} aria-label="닫기"
          className="p-1 -mr-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-elevated">
          <X size={16} />
        </button>
      </div>
      <p className="px-5 text-xs text-text-muted break-keep">
        차단하면 서로 메시지를 보낼 수 없어요. 상대에게는 차단했다는 걸 알리지 않아요.
      </p>
      <div className="px-2 py-3 min-h-[8rem]">
        {isLoading ? (
          <RowSkeleton rows={2} />
        ) : isError ? (
          <못불러옴 사유={error} 다시={() => refetch()} compact />
        ) : 사람들.length === 0 ? (
          <div className="py-8 flex flex-col items-center gap-2 text-text-dim">
            <UserX size={22} className="opacity-60" />
            <p className="text-sm">차단한 사람이 없어요</p>
          </div>
        ) : (
          <ul aria-label="차단한 사람 목록" className="flex flex-col">
            {사람들.map((p) => (
              <li key={p.id ?? p.name} className="flex items-center gap-3 px-3 py-2.5 rounded-xl">
                <Avatar username={p.name} colorIndex={p.avatar_color} avatarUrl={p.avatar_url} size="md" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-text-primary truncate">{p.name}</p>
                  {p.username && <p className="text-2xs text-text-dim truncate">@{p.username}</p>}
                </div>
                <button type="button"
                  onClick={() => p.id != null && 풀기.mutate(p.id)}
                  disabled={풀기.isPending && 풀기.variables === p.id}
                  className="shrink-0 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-text-secondary hover:border-accent-blue/50 hover:text-accent-blue transition-colors disabled:opacity-40">
                  차단 풀기
                </button>
              </li>
            ))}
          </ul>
        )}
        {풀기.isError && (
          <p role="alert" className="px-3 pt-1 text-2xs text-accent-red">차단을 풀지 못했어요. 잠시 뒤 다시 해 주세요</p>
        )}
      </div>
    </Modal>
  );
}
