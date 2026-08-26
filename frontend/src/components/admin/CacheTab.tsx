/** 캐시 탭 — 무엇이 담겨 있고 무엇을 비울까.
 *
 * 원래 Admin.tsx 한 파일(1,963줄)에 있던 것을 탭 단위로 가른 조각이다.
 */
import { useState } from "react";
import { useQuery, useMutation, type QueryClient } from "@tanstack/react-query";
import { Trash2, RefreshCw, Search, X as XIcon } from "lucide-react";
import { RowSkeleton, 못불러옴 } from "@/components/ui";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

import { adminApi } from "@/components/admin/adminApi";

/* ─────────────────────────── 캐시 탭 ─────────────────────────── */
export function CacheTab({ qc }: { qc: QueryClient }) {
  /* window.confirm 은 앱 모양과 따로 놀고, 무엇이 지워지는지(키 이름)를
     보여 줄 수 없다. 항목 삭제에는 아예 확인이 없었다 */
  const [확인, set확인] = useState<{ 전체: boolean; key?: string } | null>(null);
  const [search, setSearch] = useState("");
  const [confirmed, setConfirmed] = useState<string | null>(null);

  const { data, isLoading, refetch, isError: 못받음, error: 실패사유 } = useQuery({
    queryKey: ["admin-cache"],
    queryFn: () => adminApi.listCache(),
    staleTime: 10_000,
    refetchInterval: 30_000,
    /* 시스템 탭은 이미 이렇게 하는데 여기만 빠져 있었다. 관리자 화면을
       켜 둔 채 다른 일을 하면 30초마다 계속 물어본다 */
    refetchIntervalInBackground: false,
  });

  const deleteMut = useMutation({
    mutationFn: (key: string) => adminApi.deleteCache(key),
    onSuccess: () => { setConfirmed(null); qc.invalidateQueries({ queryKey: ["admin-cache"] }); refetch(); },
  });

  const clearMut = useMutation({
    mutationFn: () => adminApi.clearCache(),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-cache"] }); refetch(); },
  });

  const items: { key: string; ttl_remaining: number; has_stale: boolean }[] = data?.items ?? [];
  const filtered = search ? items.filter((i) => i.key.includes(search)) : items;

  const TTL_COLOR = (ttl: number) =>
    ttl > 300 ? "text-accent-green" : ttl > 60 ? "text-accent-yellow" : "text-accent-red";

  const PREFIXES = ["price:", "idx:", "news:", "ohlcv:", "fund:", "extra:", "metrics_hist", "forecasts:", "rank:"];

  return (
    <div className="flex flex-col gap-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <span className="text-base font-bold text-text-primary">인메모리 캐시</span>
          <span className="text-xs text-text-muted ml-2">{data?.count ?? 0}개 항목</span>
        </div>
        <div className="flex items-center gap-2">
          <button aria-label="새로고침" onClick={() => refetch()} className="p-1.5 rounded-lg hover:bg-bg-elevated text-text-muted hover:text-accent-blue transition-colors">
            <RefreshCw size={14} />
          </button>
          <button
            onClick={() => set확인({ 전체: true })}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-accent-red/10 text-accent-red hover:bg-accent-red/20 transition-colors"
          >
            전체 초기화
          </button>
        </div>
      </div>

      {/* 빠른 필터 */}
      <div className="flex flex-wrap gap-1.5">
        <button onClick={() => setSearch("")}
          className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all ${search === "" ? "bg-accent-blue text-white border-transparent" : "border-border text-text-muted hover:text-text-primary"}`}>
          전체
        </button>
        {PREFIXES.map((p) => (
          <button key={p} onClick={() => setSearch(p)}
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all ${search === p ? "bg-accent-blue text-white border-transparent" : "border-border text-text-muted hover:text-text-primary"}`}>
            {p}
          </button>
        ))}
      </div>

      {/* 검색 */}
      <div className="relative">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="캐시 키 검색..."
          className="w-full pl-8 pr-8 py-2 text-sm bg-bg-elevated border border-border rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue"
        />
        {search && (
          <button aria-label="검색어 지우기" onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary">
            <XIcon size={13} />
          </button>
        )}
      </div>

      {/* 목록 */}
      <div className="rounded-xl border border-border bg-bg-card overflow-hidden">
        <div className="grid grid-cols-[1fr_80px_40px] text-xs font-semibold text-text-muted px-4 py-2.5 border-b border-border bg-bg-elevated">
          <span>키</span><span className="text-right">남은 TTL</span><span />
        </div>
        <div className="divide-y divide-border/40 max-h-[480px] overflow-y-auto">
          {isLoading && <div className="p-3"><RowSkeleton rows={5} /></div>}
          {!isLoading && 못받음 && (
            <못불러옴 compact 사유={실패사유} 다시={() => refetch()} />
          )}
          {!isLoading && !못받음 && filtered.length === 0 && (
            <div className="py-8 text-center text-text-muted text-sm">
              {search ? "검색 결과 없음" : "캐시 항목 없음"}
            </div>
          )}
          {filtered.map((item) => (
            <div key={item.key} className="grid grid-cols-[1fr_80px_40px] items-center px-4 py-2 hover:bg-bg-hover text-xs">
              <span className="font-mono text-text-secondary truncate pr-2">{item.key}</span>
              <span className={`font-mono text-right ${TTL_COLOR(item.ttl_remaining)}`}>{item.ttl_remaining}s</span>
              <div className="flex justify-end">
                {confirmed === item.key ? (
                  <button
                    aria-label={`${item.key} 삭제`}
                    onClick={() => set확인({ 전체: false, key: item.key })}
                    className="text-accent-red hover:text-accent-red/70 text-xs font-semibold">삭제</button>
                ) : (
                  <button aria-label="삭제" onClick={() => setConfirmed(item.key)}
                    className="text-text-muted hover:text-accent-red transition-colors">
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        {filtered.length > 0 && (
          <div className="px-4 py-2 border-t border-border text-xs text-text-muted">
            {filtered.length}개 표시 / 전체 {items.length}개
          </div>
        )}
      </div>

      {확인 && (
        <ConfirmDialog
          title={확인.전체 ? "캐시를 전부 비울까요?" : "이 캐시를 지울까요?"}
          message={확인.전체
            ? "모든 시세·재무 캐시가 사라집니다. 다시 채워질 때까지 한동안 모든 화면이 느려집니다."
            : "다음에 누군가 이 값을 찾으면 외부에서 새로 받아옵니다."}
          대상={확인.key}
          위험={확인.전체}
          확인글={확인.전체 ? "비우기" : "삭제"}
          진행중={clearMut.isPending || deleteMut.isPending}
          onConfirm={() => {
            if (확인.전체) clearMut.mutate();
            else if (확인.key) deleteMut.mutate(확인.key);
            set확인(null);
          }}
          onClose={() => set확인(null)}
        />
      )}
    </div>
  );
}

export default CacheTab;
