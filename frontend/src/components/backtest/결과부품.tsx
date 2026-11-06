/**
 * 백테스트 결과 화면들이 같이 쓰는 작은 부품 — 단일 종목·자산배분이 **같은 모양**으로 숫자를 보이게.
 *
 * 사용자: "백테스팅 자산배분 … 디자인도 다른메뉴를 기준으로 통일시켜줘". 예전엔 자산배분만 숫자마다 테두리 상자
 * (칸)를 둘러 단일 종목 결과와 모양이 달랐다. 큰 숫자 셋 + 작은 숫자 줄, 결과 머리의 아이콘 단추, 그래프 아래 범례를 여기 하나로 둔다.
 */
import { cn } from "@/components/ui";

/** 못 잰 값(null)은 '—' — 0 으로 그리면 '승률 0%' 가 '다 졌다' 로 읽힌다 */
export function 숫자(v: number | null | undefined, 자리 = 1, 앞 = "", 뒤 = ""): React.ReactNode {
  if (v == null || !Number.isFinite(v)) return <span className="text-text-dim">—</span>;
  return `${앞}${v.toFixed(자리)}${뒤}`;
}

/** 결과의 큰 숫자 — 사람이 제일 먼저 묻는 셋 */
export function 큰지표({ 이름, 값, 색, 밑 }: { 이름: string; 값: React.ReactNode; 색?: string; 밑?: string }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-xs text-text-muted">{이름}</span>
      <span className={cn("text-xl font-bold font-mono tabular-nums truncate", 색 ?? "text-text-primary")}>{값}</span>
      {밑 && <span className="text-2xs text-text-dim break-keep">{밑}</span>}
    </div>
  );
}

/** 나머지 숫자 — 작게, 한 줄에 둘·셋 */
export function 작은지표({ 이름, 값, 색, 밑 }: { 이름: string; 값: React.ReactNode; 색?: string; 밑?: string }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-2xs text-text-muted">{이름}</span>
      <span className={cn("text-sm font-semibold font-mono tabular-nums", 색 ?? "text-text-primary")}>{값}</span>
      {밑 && <span className="text-2xs text-text-dim break-keep">{밑}</span>}
    </div>
  );
}

/** 결과 머리의 작은 아이콘 단추 — 저장·공유·CSV */
export function 머리단추({ 이름, 누르기, children }: { 이름: string; 누르기: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={이름} title={이름} onClick={누르기}
      className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors flex-shrink-0">
      {children}
    </button>
  );
}

/** 그래프 아래 한 줄 — 최고·최저와 선마다 무엇인지(내 자산 추이와 같은 모양) */
export function 그래프범례({ 끝, 선들 }: {
  끝?: string | null;
  선들: { 이름: string; 색: string; 점선?: boolean }[];
}) {
  return (
    <div className="flex items-center justify-center gap-3 flex-wrap -mt-1">
      {끝 && <span className="text-2xs text-text-dim tabular-nums">{끝}</span>}
      {선들.map((x) => (
        <span key={x.이름} className="flex items-center gap-1 text-2xs text-text-dim">
          <span aria-hidden className="w-3 h-0 border-t-2 rounded"
                style={{ borderColor: x.색, borderTopStyle: x.점선 ? "dashed" : "solid" }} />
          {x.이름}
        </span>
      ))}
    </div>
  );
}
