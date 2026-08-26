/**
 * 쪽 넘기기 — 다섯 화면이 각자 만들어 쓰던 것을 한곳에 모은다.
 *
 * 피드·커뮤니티·관리자(신고·유저·글) 다섯 곳에 거의 같은 코드가
 * 스무 줄씩 있었다. 버튼 class 는 열두 벌이 글자까지 같았고, 다른 것은
 * 가운데뿐이었다 —
 *
 *   피드·커뮤니티   이전 [1][2][3][4][5] 다음
 *   관리자 세 곳     이전    3 / 12    다음
 *
 * 이런 것이 갈라져 있으면 한쪽만 고쳐진다. 실제로 '비활성 커서'
 * (disabled:cursor-not-allowed)가 두 곳에만 붙어 있었다.
 *
 * 가운데 모양은 그대로 둔다(numbered). 지금 화면을 말없이 바꾸는 것과
 * 코드를 합치는 것은 다른 일이라, 여기서는 뒤엣것만 한다.
 */
import { cn } from "@/components/ui";

/** 이전·다음 버튼 — 다섯 곳이 쓰던 것과 같은 모양 */
const 넘김단추 =
  "px-3 py-1.5 rounded-xl text-xs text-text-muted border border-border " +
  "hover:border-accent-blue/50 hover:text-accent-blue " +
  "disabled:opacity-30 disabled:cursor-not-allowed transition-all";

/** 가운데에 보일 쪽 번호들 — 지금 쪽을 가운데에 두고 최대 다섯 개 */
export function 보일쪽들(page: number, totalPages: number, 최대 = 5): number[] {
  const n = Math.min(totalPages, 최대);
  return Array.from({ length: n }, (_, i) => {
    if (page <= 3) return i + 1;
    if (page >= totalPages - 2) return totalPages - (n - 1) + i;
    return page - 2 + i;
  }).filter((p) => p >= 1 && p <= totalPages);
}

export default function Pagination({
  page, totalPages, onChange, numbered = false, className,
}: {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
  /** true 면 가운데에 쪽 번호 단추, false 면 "3 / 12" 글자 */
  numbered?: boolean;
  className?: string;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className={cn("flex items-center justify-center gap-2", className)}>
      <button
        onClick={() => onChange(Math.max(1, page - 1))}
        disabled={page === 1}
        aria-label="이전 쪽"
        className={넘김단추}
      >이전</button>

      {numbered ? (
        <div className="flex items-center gap-1">
          {보일쪽들(page, totalPages).map((p) => (
            <button
              key={p}
              onClick={() => onChange(p)}
              aria-current={p === page ? "page" : undefined}
              className={`w-7 h-7 rounded-lg text-xs transition-all ${
                p === page
                  ? "bg-accent-blue text-white font-semibold"
                  : "text-text-dim hover:text-text-primary border border-border"
              }`}
            >{p}</button>
          ))}
        </div>
      ) : (
        <span className="text-xs text-text-muted px-2">{page} / {totalPages}</span>
      )}

      <button
        onClick={() => onChange(Math.min(totalPages, page + 1))}
        disabled={page === totalPages}
        aria-label="다음 쪽"
        className={넘김단추}
      >다음</button>
    </div>
  );
}
