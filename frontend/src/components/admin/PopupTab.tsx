/** 팝업 관리 — 배너·공지 탭이 쓴다.
 *
 * 원래 Admin.tsx 한 파일(1,963줄)에 있던 것을 탭 단위로 가른 조각이다.
 */
import { useState } from "react";
import { useQuery, useMutation, type QueryClient } from "@tanstack/react-query";
import { Trash2, X as XIcon, Plus, Pencil, ExternalLink, Calendar } from "lucide-react";
import { safeExternalUrl } from "@/utils/url";
import { RowSkeleton, 못불러옴 } from "@/components/ui";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

import { adminApi } from "@/components/admin/adminApi";

/* ─────────────────────────── 팝업 관리 탭 ─────────────────────────── */
const POPUP_TYPE_LABELS: Record<string, string> = {
  info: "정보", warning: "경고", event: "이벤트", feature: "신기능",
};
const POPUP_BG_OPTIONS = [
  { value: "blue",   label: "파란색" },
  { value: "green",  label: "초록색" },
  { value: "amber",  label: "노란색" },
  { value: "red",    label: "빨간색" },
  { value: "purple", label: "보라색" },
];

export function PopupTab({ qc }: { qc: QueryClient }) {
  /* 여기만 window.confirm 이 남아 있었다. 브라우저 기본 창은 앱 모양과
     따로 놀고, 어느 팝업을 지우는지 제목을 보여 줄 수 없다 */
  const [지울팝업, set지울팝업] = useState<{ id: number; title: string } | null>(null);
  const { data: popups = [], isLoading, refetch, isError: 못받음, error: 실패사유 } = useQuery({ queryKey: ["admin-popups"], queryFn: adminApi.getPopups, staleTime: 30_000 });
  const [editTarget, setEditTarget] = useState<any | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ popup_type: "info", title: "", content: "", link_url: "", link_text: "", bg_color: "blue", is_active: true, starts_at: "", ends_at: "" });

  const openCreate = () => { setForm({ popup_type: "info", title: "", content: "", link_url: "", link_text: "", bg_color: "blue", is_active: true, starts_at: "", ends_at: "" }); setEditTarget(null); setShowForm(true); };
  const openEdit   = (p: any) => {
    setForm({ popup_type: p.popup_type, title: p.title, content: p.content ?? "", link_url: p.link_url ?? "", link_text: p.link_text ?? "", bg_color: p.bg_color ?? "blue", is_active: p.is_active, starts_at: p.starts_at ? p.starts_at.slice(0, 16) : "", ends_at: p.ends_at ? p.ends_at.slice(0, 16) : "" });
    setEditTarget(p);
    setShowForm(true);
  };

  const createMut = useMutation({ mutationFn: adminApi.createPopup, onSuccess: () => { setShowForm(false); refetch(); qc.invalidateQueries({ queryKey: ["admin-popups"] }); } });
  const updateMut = useMutation({ mutationFn: ({ id, data }: any) => adminApi.updatePopup(id, data), onSuccess: () => { setShowForm(false); refetch(); qc.invalidateQueries({ queryKey: ["admin-popups"] }); } });
  const deleteMut = useMutation({ mutationFn: adminApi.deletePopup, onSuccess: () => { refetch(); qc.invalidateQueries({ queryKey: ["admin-popups"] }); } });

  const handleSave = () => {
    const payload = { ...form, starts_at: form.starts_at || null, ends_at: form.ends_at || null };
    if (editTarget) updateMut.mutate({ id: editTarget.id, data: payload });
    else createMut.mutate(payload);
  };

  const BG_COLOR_MAP: Record<string, string> = { blue: "bg-accent-blue/15 text-accent-blue", green: "bg-accent-green/15 text-accent-green", amber: "bg-accent-yellow/15 text-accent-yellow", red: "bg-accent-red/15 text-accent-red", purple: "bg-accent-purple/15 text-accent-purple" };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-base font-bold text-text-primary">팝업 배너 관리</span>
        <button onClick={openCreate} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-blue text-white text-xs font-semibold hover:bg-accent-blue/90 transition-colors">
          <Plus size={13} />새 팝업
        </button>
      </div>

      {isLoading ? (
        <RowSkeleton rows={3} />
      ) : 못받음 ? (
        <못불러옴 사유={실패사유} 다시={() => refetch()} />
      ) : popups.length === 0 ? (
        <div className="rounded-xl border border-border bg-bg-card py-12 text-center text-text-muted text-sm">등록된 팝업이 없습니다</div>
      ) : (
        <div className="flex flex-col gap-3">
          {popups.map((p: any) => (
            <div key={p.id} className="rounded-xl border border-border bg-bg-card p-4 flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${BG_COLOR_MAP[p.bg_color] ?? "bg-bg-secondary text-text-muted"}`}>
                    {POPUP_TYPE_LABELS[p.popup_type] ?? p.popup_type}
                  </span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${p.is_active ? "bg-accent-green/12 text-accent-green" : "bg-bg-elevated text-text-muted"}`}>
                    {p.is_active ? "활성" : "비활성"}
                  </span>
                  <span className="text-sm font-semibold text-text-primary">{p.title}</span>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button aria-label="수정" onClick={() => openEdit(p)} className="p-1.5 text-text-muted hover:text-accent-blue transition-colors"><Pencil size={13} /></button>
                  <button aria-label={`${p.title} 삭제`} onClick={() => set지울팝업({ id: p.id, title: p.title })} className="p-1.5 text-text-muted hover:text-accent-red transition-colors"><Trash2 size={13} /></button>
                </div>
              </div>
              {p.content && <p className="text-xs text-text-muted leading-relaxed">{p.content}</p>}
              {(p.starts_at || p.ends_at) && (
                <div className="flex items-center gap-1.5 text-xs text-text-muted">
                  <Calendar size={11} />
                  {p.starts_at ? p.starts_at.slice(0, 16) : "—"} ~ {p.ends_at ? p.ends_at.slice(0, 16) : "상시"}
                </div>
              )}
              {p.link_url && (
                <a href={safeExternalUrl(p.link_url)} target="_blank" rel="noopener noreferrer nofollow" className="flex items-center gap-1 text-xs text-accent-blue hover:underline">
                  <ExternalLink size={11} />{p.link_text || p.link_url}
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 팝업 폼 모달 */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowForm(false)}>
          <div className="bg-bg-card border border-border rounded-2xl shadow-modal p-6 w-full max-w-lg mx-4 flex flex-col gap-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-text-primary">{editTarget ? "팝업 수정" : "새 팝업 추가"}</p>
              <button aria-label="작성 취소" onClick={() => setShowForm(false)}><XIcon size={16} className="text-text-muted" /></button>
            </div>
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-text-muted mb-1 block">유형</label>
                  <select value={form.popup_type} onChange={e => setForm(f => ({...f, popup_type: e.target.value}))}
                    className="w-full rounded-lg border border-border bg-bg-elevated text-text-primary text-sm px-3 py-2 focus:outline-none">
                    {Object.entries(POPUP_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-text-muted mb-1 block">색상</label>
                  <select value={form.bg_color} onChange={e => setForm(f => ({...f, bg_color: e.target.value}))}
                    className="w-full rounded-lg border border-border bg-bg-elevated text-text-primary text-sm px-3 py-2 focus:outline-none">
                    {POPUP_BG_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-text-muted mb-1 block">제목 *</label>
                <input value={form.title} onChange={e => setForm(f => ({...f, title: e.target.value}))} maxLength={200}
                  className="w-full rounded-lg border border-border bg-bg-elevated text-text-primary text-sm px-3 py-2 focus:outline-none focus:border-accent-blue" />
              </div>
              <div>
                <label className="text-xs text-text-muted mb-1 block">내용</label>
                <textarea value={form.content} onChange={e => setForm(f => ({...f, content: e.target.value}))} rows={3}
                  className="w-full rounded-lg border border-border bg-bg-elevated text-text-primary text-sm px-3 py-2 focus:outline-none focus:border-accent-blue resize-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-text-muted mb-1 block">링크 URL</label>
                  <input value={form.link_url} onChange={e => setForm(f => ({...f, link_url: e.target.value}))} maxLength={500} placeholder="https://..."
                    className="w-full rounded-lg border border-border bg-bg-elevated text-text-primary text-sm px-3 py-2 focus:outline-none focus:border-accent-blue" />
                </div>
                <div>
                  <label className="text-xs text-text-muted mb-1 block">링크 텍스트</label>
                  <input value={form.link_text} onChange={e => setForm(f => ({...f, link_text: e.target.value}))} maxLength={100} placeholder="자세히 보기"
                    className="w-full rounded-lg border border-border bg-bg-elevated text-text-primary text-sm px-3 py-2 focus:outline-none focus:border-accent-blue" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-text-muted mb-1 block">시작일시</label>
                  <input type="datetime-local" value={form.starts_at} onChange={e => setForm(f => ({...f, starts_at: e.target.value}))}
                    className="w-full rounded-lg border border-border bg-bg-elevated text-text-primary text-sm px-3 py-2 focus:outline-none focus:border-accent-blue" />
                </div>
                <div>
                  <label className="text-xs text-text-muted mb-1 block">종료일시</label>
                  <input type="datetime-local" value={form.ends_at} onChange={e => setForm(f => ({...f, ends_at: e.target.value}))}
                    className="w-full rounded-lg border border-border bg-bg-elevated text-text-primary text-sm px-3 py-2 focus:outline-none focus:border-accent-blue" />
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({...f, is_active: e.target.checked}))} className="w-4 h-4 accent-accent-blue" />
                <span className="text-sm text-text-secondary">활성화</span>
              </label>
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={() => setShowForm(false)} className="flex-1 py-2 rounded-xl border border-border text-sm text-text-secondary hover:border-accent-blue/50 transition-all">취소</button>
              <button onClick={handleSave} disabled={!form.title || createMut.isPending || updateMut.isPending}
                className="flex-1 py-2 rounded-xl bg-accent-blue text-white text-sm font-semibold hover:bg-accent-blue/90 transition-all disabled:opacity-50">
                {createMut.isPending || updateMut.isPending ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}

      {지울팝업 && (
        <ConfirmDialog
          title="팝업을 삭제할까요?"
          message="지운 팝업은 되돌릴 수 없습니다."
          대상={지울팝업.title}
          확인글="삭제"
          진행중={deleteMut.isPending}
          onConfirm={() => { deleteMut.mutate(지울팝업.id); set지울팝업(null); }}
          onClose={() => set지울팝업(null)}
        />
      )}
    </div>
  );
}

export default PopupTab;
