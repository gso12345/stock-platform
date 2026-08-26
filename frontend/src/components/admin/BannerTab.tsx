/** 배너·공지 탭 — 공지 문구와 팝업.
 *
 * 원래 Admin.tsx 한 파일(1,963줄)에 있던 것을 탭 단위로 가른 조각이다.
 */
import { useState, useEffect } from "react";
import { useQuery, useMutation, type QueryClient } from "@tanstack/react-query";
import { Megaphone } from "lucide-react";

import { adminApi } from "@/components/admin/adminApi";
import PopupTab from "@/components/admin/PopupTab";

/* ─────────────────────────── 공지사항 탭 ─────────────────────────── */
export function AnnouncementTab({ annoText, setAnnoText, qc }: { annoText: string; setAnnoText: (v: string) => void; qc: QueryClient }) {
  const [saved, setSaved] = useState(false);

  const { data: annoData } = useQuery({
    queryKey: ["admin-announcement"],
    queryFn: adminApi.getAnnouncement,
    staleTime: 30_000,
  });
  useEffect(() => {
    if (annoData && annoText === "") setAnnoText(annoData.text || "");
  }, [annoData]);

  const saveMut = useMutation({
    mutationFn: (text: string) => adminApi.setAnnouncement(text),
    onSuccess: () => {
      setSaved(true);
      qc.invalidateQueries({ queryKey: ["announcement"] });
      setTimeout(() => setSaved(false), 2500);
    },
  });

  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <div className="rounded-xl border border-border bg-bg-card p-5 flex flex-col gap-4">
        <div>
          <p className="text-sm font-semibold text-text-primary mb-1">앱 공지사항</p>
          <p className="text-xs text-text-muted leading-relaxed">저장하면 모든 사용자 화면 상단에 배너로 표시됩니다. 비워두면 배너가 사라집니다.</p>
        </div>

        <textarea
          value={annoText}
          onChange={e => setAnnoText(e.target.value)}
          maxLength={500}
          rows={5}
          placeholder="공지사항 내용을 입력하세요 (최대 500자)..."
          className="w-full rounded-lg border border-border bg-bg-elevated text-text-primary text-sm p-3 resize-none focus:outline-none focus:border-accent-blue/60 transition-colors leading-relaxed"
        />

        <div className="flex items-center justify-between">
          <span className="text-xs text-text-muted">{annoText.length} / 500</span>
          <div className="flex gap-2">
            <button
              onClick={() => { setAnnoText(""); saveMut.mutate(""); }}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-text-muted hover:text-text-primary border border-border transition-all"
            >
              공지 삭제
            </button>
            <button
              onClick={() => saveMut.mutate(annoText)}
              disabled={saveMut.isPending}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                saved
                  ? "bg-accent-green/15 text-accent-green border border-accent-green/30"
                  : "bg-accent-blue text-white hover:bg-accent-blue/90"
              }`}
            >
              {saved ? "✓ 저장 완료" : saveMut.isPending ? "저장 중..." : "저장"}
            </button>
          </div>
        </div>
      </div>

      {annoText && (
        <div>
          <p className="text-xs text-text-muted mb-2">미리보기</p>
          <div className="flex items-center gap-2 bg-accent-blue/8 border border-accent-blue/20 rounded-lg px-4 py-2.5">
            <Megaphone size={14} className="text-accent-blue shrink-0" />
            <p className="text-xs text-text-primary flex-1">{annoText}</p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── 배너·공지 탭 ─────────────────────────── */
export function BannerTab({ qc }: { qc: QueryClient }) {
  const [annoText, setAnnoText] = useState("");
  return (
    <div className="flex flex-col gap-8">
      <AnnouncementTab annoText={annoText} setAnnoText={setAnnoText} qc={qc} />
      <div className="border-t border-border pt-6">
        <PopupTab qc={qc} />
      </div>
    </div>
  );
}

export default BannerTab;
