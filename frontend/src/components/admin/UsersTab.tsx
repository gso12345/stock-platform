/** 유저 관리 탭 — 목록과 상세.
 *
 * 원래 Admin.tsx 한 파일(1,963줄)에 있던 것을 탭 단위로 가른 조각이다.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, type QueryClient } from "@tanstack/react-query";
import { ToggleLeft, ToggleRight, Search, X as XIcon } from "lucide-react";
import { Tabs, RowSkeleton, 못불러옴 } from "@/components/ui";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import UserItemsPanel, { 항목이름, type 항목종류 } from "@/components/admin/UserItemsPanel";

import { adminApi, MARKET_COLOR_MAP } from "@/components/admin/adminApi";

/* ─────────────────────────── 유저 관리 탭 ─────────────────────────── */
export function UsersTab({ qc }: { qc: QueryClient }) {
  /* 계정 정지는 그 사람이 로그인을 못 하게 되는 일이다. 목록에서 옆줄을
     잘못 누르는 것이 가장 흔한 실수라, 무엇에 대한 일인지 이름을 보여 주고
     한 번 묻는다 */
  const [확인, set확인] = useState<
    { 종류: "active" | "ban"; id: number; 이름: string; 켬: boolean } | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [detailUserId, setDetailUserId] = useState<number | null>(null);

  const { data, isLoading, isError: 못받음, error: 실패사유, refetch } = useQuery({
    queryKey: ["admin-users", statusFilter, page],
    queryFn: () => adminApi.getUsers(statusFilter, page),
    staleTime: 30_000,
  });

  const allUsers: any[] = data?.items ?? [];
  const total: number   = data?.total ?? 0;
  const totalPages = Math.ceil(total / 50);

  const toggleMut = useMutation({
    mutationFn: (id: number) => adminApi.toggleActive(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
  });
  const communityBanMut = useMutation({
    mutationFn: (id: number) => adminApi.toggleCommunityBan(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
  });

  const filtered = search.trim()
    ? allUsers.filter(u =>
        u.username.toLowerCase().includes(search.toLowerCase()) ||
        (u.email ?? "").toLowerCase().includes(search.toLowerCase()))
    : allUsers;

  return (
    <div className="flex flex-col gap-3">
      {/* 필터 + 검색 */}
      <div className="flex items-center gap-2 flex-wrap">
        <Tabs
          ariaLabel="유저 상태 필터" tone="subtle" fill={false}
          tabs={[
            { id: "all", label: "전체" }, { id: "active", label: "활성" },
            { id: "inactive", label: "비활성" },
          ]}
          active={statusFilter}
          onChange={(id) => { setStatusFilter(id as any); setPage(1); }}
        />
        <div className="relative flex-1 min-w-[160px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="이름 또는 이메일 검색..."
            className="w-full pl-8 pr-7 py-1.5 text-xs bg-bg-elevated border border-border rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue/60 transition-colors" />
          {search && (
            <button aria-label="검색어 지우기" onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary">
              <XIcon size={13} />
            </button>
          )}
        </div>
        <span className="text-xs text-text-muted shrink-0">총 {total}명</span>
      </div>

      {/* 유저 목록 */}
      {isLoading ? (
        <RowSkeleton rows={6} />
      ) : 못받음 ? (
        <못불러옴 사유={실패사유} 다시={() => refetch()} />
      ) : (
        <div className="rounded-xl border border-border bg-bg-card divide-y divide-border/40 overflow-hidden">
          {/* 컬럼 헤더 */}
          <div className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-bg-elevated/60 border-b border-border text-xs font-semibold text-text-muted">
            <span className="w-7 shrink-0 hidden sm:block">ID</span>
            <span className="flex-1 min-w-0">아이디 / 이메일</span>
            <span className="shrink-0 w-[56px] text-center">계정</span>
            <span className="shrink-0 w-[72px] text-center">커뮤니티</span>
            <span className="shrink-0 hidden lg:block w-[80px] text-right">가입일</span>
          </div>
          {filtered.length === 0 && (
            <div className="py-10 text-center text-text-muted text-sm">검색 결과가 없습니다</div>
          )}
          {filtered.map((u: any) => (
            <div key={u.id} className="flex items-center gap-2 px-3 sm:px-4 py-2.5 hover:bg-bg-hover transition-colors min-w-0">
              {/* ID */}
              <span className="text-xs font-mono text-text-muted/60 w-7 shrink-0 hidden sm:block">{u.id}</span>

              {/* 이름 + 배지 + 이메일 */}
              <div className="flex-1 min-w-0 flex items-center gap-1.5 overflow-hidden">
                <button
                  onClick={() => setDetailUserId(u.id)}
                  className="text-sm font-semibold text-text-primary hover:text-accent-blue transition-colors whitespace-nowrap">
                  {u.username}
                </button>
                {u.is_admin && (
                  <span className="text-2xs bg-accent-blue/15 text-accent-blue px-1.5 py-px rounded font-bold shrink-0">관리자</span>
                )}
                {!u.is_admin && u.is_community_banned && (
                  <span className="text-2xs bg-accent-orange/15 text-accent-orange px-1.5 py-px rounded font-bold shrink-0 hidden sm:inline">커뮤차단</span>
                )}
                {u.email && (
                  <span className="text-xs text-text-muted truncate hidden sm:inline">{u.email}</span>
                )}
              </div>

              {/* 계정 비활성화 토글 */}
              <div className="w-[56px] flex justify-center shrink-0">
                {!u.is_admin ? (
                  <button
                    aria-label={u.is_active ? `${u.username} 계정 비활성화` : `${u.username} 계정 활성화`}
                    onClick={() => set확인({ 종류: "active", id: u.id, 이름: u.username, 켬: u.is_active })}
                    title={u.is_active ? "계정 비활성화" : "계정 활성화"}>
                    {u.is_active
                      ? <ToggleRight size={20} className="text-accent-green" />
                      : <ToggleLeft size={20} className="text-text-muted" />}
                  </button>
                ) : (
                  <span className="text-2xs bg-accent-blue/15 text-accent-blue px-1.5 py-px rounded font-bold">관리자</span>
                )}
              </div>

              {/* 커뮤니티 비활성화 토글 */}
              <div className="w-[72px] flex justify-center shrink-0">
                {!u.is_admin && (
                  <button
                    aria-label={u.is_community_banned ? `${u.username} 커뮤니티 차단 해제` : `${u.username} 커뮤니티 차단`}
                    onClick={() => set확인({ 종류: "ban", id: u.id, 이름: u.username, 켬: !u.is_community_banned })}
                    title={u.is_community_banned ? "커뮤니티 차단 해제" : "커뮤니티 차단"}>
                    {u.is_community_banned
                      ? <ToggleRight size={20} className="text-accent-orange" />
                      : <ToggleLeft size={20} className="text-text-muted" />}
                  </button>
                )}
              </div>

              {/* 가입일 */}
              <span className="text-xs text-text-muted font-mono shrink-0 hidden lg:block w-[80px] text-right">
                {u.created_at ? u.created_at.slice(0, 10) : "—"}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            className="px-3 py-1.5 rounded-xl text-xs text-text-muted border border-border hover:border-accent-blue/50 hover:text-accent-blue disabled:opacity-30 transition-all">이전</button>
          <span className="text-xs text-text-muted px-2">{page} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            className="px-3 py-1.5 rounded-xl text-xs text-text-muted border border-border hover:border-accent-blue/50 hover:text-accent-blue disabled:opacity-30 transition-all">다음</button>
        </div>
      )}

      {/* 유저 상세 모달 */}
      {detailUserId !== null && (
        <UserDetailModal userId={detailUserId} onClose={() => setDetailUserId(null)} qc={qc} />
      )}

      {/* 되돌릴 수 없는 일 앞에서 한 번 묻는다 */}
      {확인 && (
        <ConfirmDialog
          title={확인.종류 === "active"
            ? (확인.켬 ? "계정을 정지할까요?" : "계정을 다시 열까요?")
            : (확인.켬 ? "커뮤니티를 차단할까요?" : "커뮤니티 차단을 풀까요?")}
          message={확인.종류 === "active"
            ? (확인.켬 ? "이 사람은 로그인할 수 없게 됩니다." : "다시 로그인할 수 있게 됩니다.")
            : (확인.켬 ? "글·댓글을 쓸 수 없게 됩니다. 로그인과 열람은 그대로입니다." : "다시 글을 쓸 수 있게 됩니다.")}
          대상={확인.이름}
          위험={확인.켬}
          확인글={확인.켬 ? (확인.종류 === "active" ? "정지" : "차단") : "해제"}
          진행중={toggleMut.isPending || communityBanMut.isPending}
          onConfirm={() => {
            if (확인.종류 === "active") toggleMut.mutate(확인.id);
            else communityBanMut.mutate(확인.id);
            set확인(null);
          }}
          onClose={() => set확인(null)}
        />
      )}
    </div>
  );
}

export function UserDetailModal({ userId, onClose, qc }: { userId: number; onClose: () => void; qc: QueryClient }) {
  const [확인, set확인] = useState<"active" | "ban" | null>(null);
  /* 어느 숫자를 펼쳤나. 한 번에 하나만 연다 — 모달 안이라 자리가 좁다 */
  const [펼친것, set펼친것] = useState<항목종류 | null>(null);
  const { data: detail, isLoading, isError: 못받음, error: 실패사유, refetch } = useQuery({
    queryKey: ["admin-user-detail", userId],
    queryFn: () => adminApi.getUserDetail(userId),
    staleTime: 30_000,
  });

  const toggleMut = useMutation({
    mutationFn: () => adminApi.toggleActive(userId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-users"] }); qc.invalidateQueries({ queryKey: ["admin-user-detail", userId] }); },
  });
  const communityBanMut = useMutation({
    mutationFn: () => adminApi.toggleCommunityBan(userId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-users"] }); qc.invalidateQueries({ queryKey: ["admin-user-detail", userId] }); },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}>
      <div className="bg-bg-card border border-border rounded-2xl shadow-modal w-full max-w-md flex flex-col max-h-[85vh] overflow-hidden"
        onClick={e => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <p className="text-sm font-bold text-text-primary">유저 상세</p>
          <button aria-label="닫기" onClick={onClose}><XIcon size={16} className="text-text-muted" /></button>
        </div>

        {isLoading ? (
          <div className="p-4"><RowSkeleton rows={4} /></div>
        ) : 못받음 ? (
          <못불러옴 사유={실패사유} 다시={() => refetch()} />
        ) : detail ? (
          <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5">
            {/* 프로필 */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-accent-blue/15 flex items-center justify-center shrink-0">
                <span className="text-sm font-bold text-accent-blue">{detail.username?.[0]?.toUpperCase()}</span>
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-bold text-text-primary">{detail.username}</p>
                  {detail.is_admin && <span className="text-2xs bg-accent-blue/15 text-accent-blue px-1.5 py-px rounded font-bold">관리자</span>}
                  {!detail.is_active && <span className="text-2xs bg-accent-red/15 text-accent-red px-1.5 py-px rounded font-bold">비활성</span>}
                  {detail.is_community_banned && <span className="text-2xs bg-accent-orange/15 text-accent-orange px-1.5 py-px rounded font-bold">커뮤차단</span>}
                </div>
                <p className="text-xs text-text-muted">{detail.email}</p>
                <p className="text-xs text-text-muted">가입일: {detail.created_at?.slice(0, 10)}</p>
              </div>
            </div>

            {/* 통계 — 누르면 실제 내용이 펼쳐진다.
                숫자만 봐서는 다음에 무엇을 할지 정할 수 없다. 관리자가 이
                화면을 여는 이유는 대개 '이 사람이 무슨 글을 썼길래' 다 */}
            <div className="grid grid-cols-3 gap-2">
              {([
                { kind: "posts",     label: "게시글",   value: detail.post_count },
                { kind: "comments",  label: "댓글",     value: detail.comment_count },
                { kind: "reports",   label: "신고 보냄", value: detail.report_sent_count },
                { kind: "followers", label: "팔로워",   value: detail.follower_count },
                { kind: "following", label: "팔로잉",   value: detail.following_count },
              ] as { kind: 항목종류; label: string; value: number }[]).map(({ kind, label, value }) => {
                const 열림 = 펼친것 === kind;
                const 빔 = !value;
                return (
                  <button
                    key={kind}
                    /* 0건이면 펼쳐 봐야 빈 목록이라 누르지 못하게 한다 */
                    disabled={빔}
                    aria-expanded={열림}
                    onClick={() => set펼친것(열림 ? null : kind)}
                    className={`rounded-lg p-2.5 flex flex-col gap-0.5 text-left transition-all ${
                      열림 ? "bg-accent-blue/15 ring-1 ring-accent-blue/40"
                           : "bg-bg-elevated hover:bg-bg-hover"
                    } ${빔 ? "opacity-50 cursor-default" : ""}`}
                  >
                    <p className="text-2xs text-text-muted">{label}</p>
                    <p className={`text-base font-bold font-mono ${
                      열림 ? "text-accent-blue" : "text-text-primary"}`}>{value}</p>
                  </button>
                );
              })}
            </div>

            {펼친것 && (
              <div className="rounded-lg border border-border bg-bg-card px-3 py-2">
                <div className="flex items-center justify-between pb-1.5 border-b border-border">
                  <span className="text-xs font-semibold text-text-primary">{항목이름[펼친것]}</span>
                  <button aria-label="닫기" onClick={() => set펼친것(null)}
                          className="text-2xs text-text-muted hover:text-text-primary">닫기</button>
                </div>
                <UserItemsPanel userId={userId} kind={펼친것} />
              </div>
            )}

            {/* 최근 게시글 */}
            {detail.recent_posts?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-text-muted mb-2">최근 게시글</p>
                <div className="flex flex-col gap-1">
                  {detail.recent_posts.map((p: any) => (
                    <Link key={p.id} to={`/post/${p.id}`}
                      className="flex items-center gap-2 p-2 rounded-lg bg-bg-elevated hover:bg-bg-hover transition-colors">
                      <span className={`text-2xs font-bold px-1.5 py-px rounded shrink-0 ${MARKET_COLOR_MAP[p.market] ?? "bg-bg-secondary text-text-muted"}`}>{p.market}</span>
                      <span className="text-xs text-text-secondary truncate flex-1">{p.title || "—"}</span>
                      <span className="text-2xs text-text-muted font-mono shrink-0">{p.created_at?.slice(0, 10)}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* 액션 버튼 */}
            {!detail.is_admin && (
              <div className="flex gap-2 pt-2 border-t border-border">
                <button onClick={() => set확인("active")} disabled={toggleMut.isPending}
                  className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-all ${
                    detail.is_active
                      ? "bg-accent-red/10 text-accent-red hover:bg-accent-red/20"
                      : "bg-accent-green/10 text-accent-green hover:bg-accent-green/20"
                  } disabled:opacity-50`}>
                  {detail.is_active ? "계정 비활성화" : "계정 활성화"}
                </button>
                <button onClick={() => set확인("ban")} disabled={communityBanMut.isPending}
                  className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-all ${
                    detail.is_community_banned
                      ? "bg-accent-green/10 text-accent-green hover:bg-accent-green/20"
                      : "bg-accent-orange/10 text-accent-orange hover:bg-accent-orange/20"
                  } disabled:opacity-50`}>
                  {detail.is_community_banned ? "커뮤니티 차단 해제" : "커뮤니티 차단"}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="py-12 text-center text-text-muted text-sm">정보를 불러올 수 없습니다</div>
        )}
      </div>

      {확인 && detail && (
        <ConfirmDialog
          title={확인 === "active"
            ? (detail.is_active ? "계정을 정지할까요?" : "계정을 다시 열까요?")
            : (detail.is_community_banned ? "커뮤니티 차단을 풀까요?" : "커뮤니티를 차단할까요?")}
          message={확인 === "active"
            ? (detail.is_active ? "이 사람은 로그인할 수 없게 됩니다." : "다시 로그인할 수 있게 됩니다.")
            : (detail.is_community_banned ? "다시 글을 쓸 수 있게 됩니다." : "글·댓글을 쓸 수 없게 됩니다. 로그인과 열람은 그대로입니다.")}
          대상={detail.username}
          위험={확인 === "active" ? detail.is_active : !detail.is_community_banned}
          확인글={확인 === "active"
            ? (detail.is_active ? "정지" : "열기")
            : (detail.is_community_banned ? "해제" : "차단")}
          진행중={toggleMut.isPending || communityBanMut.isPending}
          onConfirm={() => {
            if (확인 === "active") toggleMut.mutate();
            else communityBanMut.mutate();
            set확인(null);
          }}
          onClose={() => set확인(null)}
        />
      )}
    </div>
  );
}

export default UsersTab;
