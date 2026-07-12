import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import api from "@/api/client";
import { Users, BarChart2, Megaphone, Trash2, ToggleLeft, ToggleRight, ShieldCheck } from "lucide-react";

const adminApi = {
  getStats: () => api.get("/admin/stats").then(r => r.data),
  getUsers: () => api.get("/admin/users").then(r => r.data),
  toggleActive: (id: number) => api.patch(`/admin/users/${id}/active`).then(r => r.data),
  deleteUser: (id: number) => api.delete(`/admin/users/${id}`).then(r => r.data),
  getAnnouncement: () => api.get("/admin/announcement").then(r => r.data),
  setAnnouncement: (text: string) => api.post("/admin/announcement", { text }).then(r => r.data),
};

type Tab = "stats" | "users" | "announcement";

export default function Admin() {
  const { isAdmin, username } = useAuthStore();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("stats");
  const [annoText, setAnnoText] = useState("");
  const [annoSaved, setAnnoSaved] = useState(false);

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <ShieldCheck size={48} className="text-text-muted/30" />
        <p className="text-text-muted text-base">관리자 권한이 없습니다</p>
        <button onClick={() => navigate("/")} className="px-4 py-2 rounded-lg bg-accent-blue text-white text-sm font-semibold">홈으로</button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 flex flex-col gap-6">
      {/* 헤더 */}
      <div className="flex items-center gap-3">
        <ShieldCheck size={24} className="text-accent-blue" />
        <div>
          <h1 className="text-xl font-bold text-text-primary">관리자 페이지</h1>
          <p className="text-xs text-text-muted">{username}</p>
        </div>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 p-1 rounded-xl border border-border bg-bg-secondary w-fit">
        {([
          { id: "stats",        Icon: BarChart2,  label: "통계" },
          { id: "users",        Icon: Users,       label: "유저 관리" },
          { id: "announcement", Icon: Megaphone,   label: "공지사항" },
        ] as { id: Tab; Icon: any; label: string }[]).map(({ id, Icon, label }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
              tab === id ? "bg-accent-blue text-white shadow" : "text-text-muted hover:text-text-primary"
            }`}>
            <Icon size={13}/>{label}
          </button>
        ))}
      </div>

      {/* 통계 탭 */}
      {tab === "stats" && <StatsTab />}

      {/* 유저 관리 탭 */}
      {tab === "users" && <UsersTab qc={qc} />}

      {/* 공지사항 탭 */}
      {tab === "announcement" && (
        <AnnouncementTab
          annoText={annoText}
          setAnnoText={setAnnoText}
          annoSaved={annoSaved}
          setAnnoSaved={setAnnoSaved}
        />
      )}
    </div>
  );
}

/* ── 통계 ── */
function StatsTab() {
  const { data, isLoading } = useQuery({ queryKey: ["admin-stats"], queryFn: adminApi.getStats, staleTime: 30_000 });

  const cards = [
    { label: "전체 가입자", value: data?.total_users ?? 0, color: "text-accent-blue" },
    { label: "활성 계정", value: data?.active_users ?? 0, color: "text-accent-green" },
    { label: "관심종목 수", value: data?.watchlist_items ?? 0, color: "text-accent-yellow" },
    { label: "포트폴리오 보유종목", value: data?.portfolio_items ?? 0, color: "text-purple-400" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {cards.map(c => (
        <div key={c.label} className="rounded-xl border border-border bg-bg-card p-4 flex flex-col gap-1">
          <span className="text-xs text-text-muted">{c.label}</span>
          <span className={`text-2xl font-bold font-mono ${c.color}`}>
            {isLoading ? "—" : c.value.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── 유저 관리 ── */
function UsersTab({ qc }: { qc: any }) {
  const { data: users = [], isLoading } = useQuery({ queryKey: ["admin-users"], queryFn: adminApi.getUsers, staleTime: 30_000 });
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const toggleMut = useMutation({
    mutationFn: (id: number) => adminApi.toggleActive(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => adminApi.deleteUser(id),
    onSuccess: () => { setConfirmDelete(null); qc.invalidateQueries({ queryKey: ["admin-users"] }); },
  });

  if (isLoading) return <div className="text-text-muted text-sm py-8 text-center">로딩 중...</div>;

  return (
    <div className="rounded-xl overflow-hidden border border-border bg-bg-card">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <span className="font-semibold text-text-primary text-base">유저 목록</span>
        <span className="text-xs text-text-muted">{users.length}명</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-bg-secondary text-text-muted">
              <th className="text-left px-4 py-2.5 font-medium">ID</th>
              <th className="text-left px-3 py-2.5 font-medium">아이디</th>
              <th className="text-left px-3 py-2.5 font-medium hidden sm:table-cell">이메일</th>
              <th className="text-left px-3 py-2.5 font-medium hidden sm:table-cell">가입일</th>
              <th className="text-center px-3 py-2.5 font-medium">상태</th>
              <th className="text-center px-3 py-2.5 font-medium">관리</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u: any) => (
              <tr key={u.id} className="border-b border-border/30 hover:bg-bg-hover transition-colors">
                <td className="px-4 py-2.5 font-mono text-text-muted text-xs">{u.id}</td>
                <td className="px-3 py-2.5 font-semibold text-text-primary">
                  {u.username}
                  {u.is_admin && <span className="ml-1.5 text-[10px] bg-accent-blue/20 text-accent-blue px-1.5 py-0.5 rounded font-semibold">관리자</span>}
                </td>
                <td className="px-3 py-2.5 text-text-muted hidden sm:table-cell">{u.email || "—"}</td>
                <td className="px-3 py-2.5 text-text-muted text-xs hidden sm:table-cell">
                  {u.created_at ? u.created_at.slice(0, 10) : "—"}
                </td>
                <td className="px-3 py-2.5 text-center">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${u.is_active ? "bg-accent-green/20 text-accent-green" : "bg-accent-red/20 text-accent-red"}`}>
                    {u.is_active ? "활성" : "비활성"}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-center">
                  {!u.is_admin && (
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => toggleMut.mutate(u.id)}
                        title={u.is_active ? "비활성화" : "활성화"}
                        className="text-text-muted hover:text-accent-blue transition-colors"
                      >
                        {u.is_active ? <ToggleRight size={18} className="text-accent-green"/> : <ToggleLeft size={18}/>}
                      </button>
                      {confirmDelete === u.id ? (
                        <div className="flex gap-1">
                          <button onClick={() => deleteMut.mutate(u.id)} className="text-xs text-accent-red font-semibold hover:underline">확인</button>
                          <button onClick={() => setConfirmDelete(null)} className="text-xs text-text-muted hover:underline">취소</button>
                        </div>
                      ) : (
                        <button onClick={() => setConfirmDelete(u.id)} className="text-text-muted hover:text-accent-red transition-colors">
                          <Trash2 size={14}/>
                        </button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── 공지사항 ── */
function AnnouncementTab({ annoText, setAnnoText, annoSaved, setAnnoSaved }: any) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["admin-announcement"],
    queryFn: adminApi.getAnnouncement,
    staleTime: 30_000,
    onSuccess: (d: any) => { if (annoText === "") setAnnoText(d.text || ""); },
  } as any);

  const saveMut = useMutation({
    mutationFn: (text: string) => adminApi.setAnnouncement(text),
    onSuccess: () => {
      setAnnoSaved(true);
      qc.invalidateQueries({ queryKey: ["announcement"] });
      setTimeout(() => setAnnoSaved(false), 2000);
    },
  });

  return (
    <div className="rounded-xl border border-border bg-bg-card p-4 flex flex-col gap-4">
      <div>
        <p className="text-base font-semibold text-text-primary mb-1">앱 공지사항</p>
        <p className="text-xs text-text-muted">저장하면 모든 사용자 화면 상단에 배너로 표시됩니다. 비워두면 배너가 사라집니다.</p>
      </div>
      <textarea
        value={annoText}
        onChange={e => setAnnoText(e.target.value)}
        maxLength={500}
        rows={4}
        placeholder="공지사항 내용 입력 (최대 500자)..."
        className="w-full rounded-lg border border-border bg-bg-elevated text-text-primary text-sm p-3 resize-none focus:outline-none focus:border-accent-blue/60"
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-muted">{annoText.length}/500</span>
        <div className="flex gap-2">
          <button
            onClick={() => { setAnnoText(""); saveMut.mutate(""); }}
            className="px-3 py-1.5 rounded-lg text-sm font-semibold text-text-muted hover:text-text-primary border border-border hover:border-accent-blue/40 transition-all"
          >
            공지 삭제
          </button>
          <button
            onClick={() => saveMut.mutate(annoText)}
            disabled={saveMut.isPending}
            className="px-4 py-1.5 rounded-lg text-sm font-semibold bg-accent-blue text-white hover:bg-accent-blue/90 transition-all"
          >
            {annoSaved ? "저장 완료!" : saveMut.isPending ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}
