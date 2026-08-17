/**
 * 유저 상세의 숫자를 눌렀을 때 나오는 실제 내용.
 *
 * 예전에는 "게시글 12 · 댓글 30 · 신고 보냄 3" 처럼 숫자만 있었다. 그런데
 * 관리자가 이 화면을 여는 이유는 대개 "이 사람이 무슨 글을 썼길래" 를
 * 확인하려는 것이다. 숫자만 봐서는 다음에 무엇을 할지 정할 수 없었다.
 *
 * 삭제·가려진 것도 함께 보여 준다 — 관리자에게는 그쪽이 오히려 봐야 할
 * 대상이다. 대신 무슨 상태인지 표시해서 헷갈리지 않게 한다.
 */
import { useQuery } from "@tanstack/react-query";
import api from "@/api/client";

export type 항목종류 = "posts" | "comments" | "reports" | "followers" | "following";

export const 항목이름: Record<항목종류, string> = {
  posts: "게시글", comments: "댓글", reports: "신고 보냄",
  followers: "팔로워", following: "팔로잉",
};

const 신고상태: Record<string, { 글: string; 색: string }> = {
  pending:   { 글: "대기",   색: "bg-accent-yellow/15 text-accent-yellow" },
  resolved:  { 글: "처리됨", 색: "bg-accent-green/15 text-accent-green" },
  dismissed: { 글: "기각",   색: "bg-bg-elevated text-text-muted" },
};

function 언제(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("ko-KR", { year: "2-digit", month: "2-digit", day: "2-digit" });
}

export default function UserItemsPanel({ userId, kind }: { userId: number; kind: 항목종류 }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-user-items", userId, kind],
    queryFn: () =>
      api.get(`/admin/users/${userId}/items`, { params: { kind, limit: 30 } }).then((r) => r.data),
    staleTime: 30_000,
  });

  if (isLoading) {
    return <div className="py-8 text-center text-text-muted text-xs">불러오는 중...</div>;
  }
  if (isError) {
    return <div className="py-8 text-center text-text-muted text-xs">불러오지 못했습니다</div>;
  }

  const items: any[] = data?.items ?? [];
  if (!items.length) {
    return <div className="py-8 text-center text-text-muted text-xs">{항목이름[kind]}이 없습니다</div>;
  }

  const 사람목록 = kind === "followers" || kind === "following";

  return (
    <div className="flex flex-col">
      <ul className="divide-y divide-border max-h-64 overflow-y-auto">
        {items.map((it) => (
          <li key={`${kind}-${it.id}`} className="py-2 flex items-start gap-2">
            {사람목록 ? (
              <>
                <span className="text-sm text-text-primary flex-1 min-w-0 truncate">{it.username}</span>
                {it.is_active === false && (
                  <span className="text-2xs px-1.5 py-0.5 rounded bg-accent-red/15 text-accent-red shrink-0">정지</span>
                )}
              </>
            ) : (
              <>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary truncate">{it.text || "(내용 없음)"}</p>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    {it.symbol && (
                      <span className="text-2xs text-text-dim">{it.symbol}</span>
                    )}
                    {/* 관리자에게는 지워진 것도 봐야 할 대상이다. 다만 상태는 알려 준다 */}
                    {it.deleted && (
                      <span className="text-2xs px-1.5 py-0.5 rounded bg-accent-red/15 text-accent-red">삭제됨</span>
                    )}
                    {it.blinded && (
                      <span className="text-2xs px-1.5 py-0.5 rounded bg-accent-orange/15 text-accent-orange">가려짐</span>
                    )}
                    {kind === "reports" && (
                      <span className={`text-2xs px-1.5 py-0.5 rounded ${신고상태[it.status]?.색 ?? ""}`}>
                        {신고상태[it.status]?.글 ?? it.status}
                      </span>
                    )}
                    {kind === "reports" && (
                      <span className="text-2xs text-text-dim">
                        {it.post_id ? `글 #${it.post_id}` : it.comment_id ? `댓글 #${it.comment_id}` : ""}
                      </span>
                    )}
                    {kind === "posts" && (
                      <span className="text-2xs text-text-dim">♥ {it.likes} · 💬 {it.comments}</span>
                    )}
                  </div>
                </div>
              </>
            )}
            <span className="text-2xs text-text-dim shrink-0 whitespace-nowrap">{언제(it.created_at)}</span>
          </li>
        ))}
      </ul>
      {data?.total > items.length && (
        <p className="pt-2 text-2xs text-text-dim text-center">
          최근 {items.length}건 / 전체 {data.total}건
        </p>
      )}
    </div>
  );
}
