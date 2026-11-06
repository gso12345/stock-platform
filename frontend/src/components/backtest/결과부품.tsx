/**
 * 백테스트 결과 화면들이 같이 쓰는 작은 부품 — 단일 종목·자산배분이 **같은 모양**으로 숫자를 보이게.
 *
 * 사용자: "백테스팅 자산배분 … 디자인도 다른메뉴를 기준으로 통일시켜줘". 예전엔 자산배분만 숫자마다 테두리 상자
 * (칸)를 둘러 단일 종목 결과와 모양이 달랐다. 큰 숫자 셋 + 작은 숫자 줄, 결과 머리의 아이콘 단추, 그래프 아래 범례를 여기 하나로 둔다.
 */
import { cn } from "@/components/ui";
import { 툴팁상자 } from "@/utils/chartTheme";

/** '2024-07-29' → '24.07.29' — 날짜가 여럿 나란한 줄에서(폰 한 줄에 셋이 들어가게) */
export const 짧은날 = (d: string) => (d.length >= 10 ? `${d.slice(2, 4)}.${d.slice(5, 7)}.${d.slice(8, 10)}` : d);

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

/** 그래프 아래 한 줄 — 최고·최저와 선마다 무엇인지(내 자산 추이와 같은 모양).
 *  값: 선의 **끝 값**을 이름 옆에 — 견주는 그래프에서 '마지막에 어디였나' 를 툴팁 없이 읽게(선 끝의 점과 짝) */
export function 그래프범례({ 끝, 선들 }: {
  끝?: string | null;
  선들: { 이름: string; 색: string; 점선?: boolean; 값?: string | null }[];
}) {
  return (
    <div className="flex items-center justify-center gap-x-3 gap-y-1 flex-wrap -mt-1">
      {끝 && <span className="text-2xs text-text-dim tabular-nums">{끝}</span>}
      {선들.map((x) => (
        <span key={x.이름} className="flex items-center gap-1 text-2xs text-text-dim">
          <span aria-hidden className="w-3 h-0 border-t-2 rounded"
                style={{ borderColor: x.색, borderTopStyle: x.점선 ? "dashed" : "solid" }} />
          {x.이름}
          {x.값 && <span className="font-mono tabular-nums text-text-secondary">{x.값}</span>}
        </span>
      ))}
    </div>
  );
}

/** 견주는 그래프의 툴팁 — 날짜, 선마다(색·이름·값), 그리고 **차이**(내 것 − 견줄 것).
 *
 *  recharts 기본 툴팁은 값만 나란히 둔다. 견주는 그래프에서 사람이 묻는 것은 '얼마나 앞섰나·뒤졌나' 인데 그건 머릿속
 *  뺄셈으로 해야 했다. 글자는 글자 색(선 색이 아니다) — 색 점이 어느 선인지 가리킨다. recharts 의 content 로 넘긴다 */
export function 견줌툴팁({ active, label, payload, 줄들, 차이, 날글 }: {
  active?: boolean;
  label?: string;
  payload?: { payload?: Record<string, unknown> }[];
  줄들: { 키: string; 이름: string; 색: string; 점선?: boolean; 글: (v: number) => string }[];
  /** 가 − 나 를 글로. 둘 중 하나라도 없는 날은 안 적는다 */
  차이?: { 가: string; 나: string; 글: (v: number) => string; 색?: (v: number) => string };
  날글?: (d: string) => string;
}) {
  const 점 = payload?.[0]?.payload;
  if (!active || !점) return null;
  const 값 = (키: string) => (typeof 점[키] === "number" && Number.isFinite(점[키]) ? (점[키] as number) : null);
  const 보일것 = 줄들.filter((x) => 값(x.키) != null);
  const 가 = 차이 ? 값(차이.가) : null;
  const 나 = 차이 ? 값(차이.나) : null;
  return (
    /* 상자는 공통 툴팁과 **같은 값**(chartTheme 툴팁) — 다른 그래프의 툴팁과 같은 모양 */
    <div className="px-3 py-2 flex flex-col gap-1" style={툴팁상자}>
      {label && <span className="text-text-muted">{날글 ? 날글(label) : label}</span>}
      {보일것.map((x) => (
        <span key={x.키} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-text-secondary">
            <span aria-hidden className="w-3 h-0 border-t-2 rounded"
                  style={{ borderColor: x.색, borderTopStyle: x.점선 ? "dashed" : "solid" }} />
            {x.이름}
          </span>
          <span className="font-mono tabular-nums text-text-primary">{x.글(값(x.키)!)}</span>
        </span>
      ))}
      {차이 && 가 != null && 나 != null && (
        <span className="flex items-center justify-between gap-4 pt-1 border-t border-border">
          <span className="text-text-muted">차이</span>
          <span className={cn("font-mono tabular-nums", 차이.색 ? 차이.색(가 - 나) : "text-text-primary")}>{차이.글(가 - 나)}</span>
        </span>
      )}
    </div>
  );
}
