/**
 * 이 글에 좋아요를 누른 사람들.
 *
 * 화면에는 개수만 있었다. 그런데 좋아요가 갑자기 몰리면 관리자가 보고 싶은
 * 것은 '몇 개' 가 아니라 '누가' 다 — 같은 사람이 여러 계정으로 누르는지,
 * 서로 밀어 주는 무리가 있는지는 이름을 봐야 알 수 있다.
 *
 * 관리자 화면에서만 연다. 누가 눌렀는지는 그 사람의 활동 기록이고, 일반
 * 사용자에게 공개할 이유가 없다(백엔드도 관리자만 준다).
 */
import { useQuery } from "@tanstack/react-query";
import { Heart, X } from "lucide-react";
import { Modal } from "@/components/ui";
import api from "@/api/client";

export default function PostLikesModal({
  postId, title, onClose,
}: { postId: number; title?: string; onClose: () => void }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-post-likes", postId],
    queryFn: () =>
      api.get(`/admin/community/posts/${postId}/likes`, { params: { limit: 100 } })
         .then((r) => r.data),
    staleTime: 30_000,
  });

  const items: any[] = data?.items ?? [];

  return (
    <Modal maxWidth="max-w-sm" onClose={onClose}>
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-border">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-text-primary flex items-center gap-1.5">
            <Heart size={13} className="text-accent-red" />
            좋아요 누른 사람
            {data?.total != null && (
              <span className="text-2xs font-normal text-text-dim">{data.total}명</span>
            )}
          </h3>
          {title && <p className="text-2xs text-text-dim mt-0.5 truncate">{title}</p>}
        </div>
        <button aria-label="닫기" onClick={onClose}>
          <X size={15} className="text-text-muted hover:text-text-primary" />
        </button>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-text-muted text-xs">불러오는 중</div>
      ) : isError ? (
        <div className="py-12 text-center text-text-muted text-xs">불러오지 못했습니다</div>
      ) : !items.length ? (
        <div className="py-12 text-center text-text-muted text-xs">아직 아무도 누르지 않았습니다</div>
      ) : (
        <ul className="divide-y divide-border max-h-80 overflow-y-auto">
          {items.map((u) => (
            <li key={u.id} className="px-4 py-2.5 flex items-center gap-2">
              <span className="text-sm text-text-primary flex-1 min-w-0 truncate">{u.username}</span>
              {u.is_admin && (
                <span className="text-2xs px-1.5 py-0.5 rounded bg-accent-blue/15 text-accent-blue shrink-0">관리자</span>
              )}
              {u.is_active === false && (
                <span className="text-2xs px-1.5 py-0.5 rounded bg-accent-red/15 text-accent-red shrink-0">정지</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {data?.total > items.length && (
        <p className="px-4 py-2 border-t border-border text-2xs text-text-dim text-center">
          최근 {items.length}명 / 전체 {data.total}명
        </p>
      )}
    </Modal>
  );
}
