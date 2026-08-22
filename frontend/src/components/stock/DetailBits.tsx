/**
 * 종목 상세가 쓰는 작은 부품 넷.
 *
 * 종목 상세 한 파일이 3,173줄이라 탭을 떼어 내는 중인데, 이 넷은 떼어 낸
 * 탭과 남은 본문이 함께 쓴다. 한쪽에 두면 다른 쪽이 그 파일을 통째로
 * 끌어오게 되므로 따로 뺀다.
 *
 * 여기 있는 것은 옮기기만 했고 안은 그대로다.
 */
import React from "react";
import { 용어힌트 } from "@/components/ui";

/* ── 지표 셀 ────────────────────────────────────────── */
export function StatCell({ label, value, color, sub }: { label: string; value: React.ReactNode; color?: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5 p-3 rounded-xl border border-border bg-bg-elevated">
      {/* 이 한 자리가 PER·PBR·ROE 등 스물다섯 가지 이름을 다 그린다.
          용어힌트는 사전에 없는 이름이면 물음표 없이 글자만 내보내므로,
          어떤 이름이 와도 그냥 통과한다 */}
      <span className="text-xs text-text-muted font-medium uppercase tracking-wide">
        <용어힌트 이름={label} />
      </span>
      <span className={`text-base font-mono font-semibold truncate ${color ?? "text-text-primary"}`}>{value ?? "—"}</span>
      {sub && <span className="text-xs text-text-muted font-mono">{sub}</span>}
    </div>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-bold text-text-muted uppercase tracking-widest mb-2">{children}</h3>;
}

/* ── 재무제표 탭 — 기간 토글 ─────────────────────────────── */
export function PeriodToggle({ finPeriod, setFinPeriod }: {
  finPeriod: "annual" | "quarterly";
  setFinPeriod: (v: "annual" | "quarterly") => void;
}) {
  return (
    <div className="flex gap-1 p-0.5 rounded-lg border border-border bg-bg-primary">
      {(["annual","quarterly"] as const).map(k=>(
        <button key={k} onClick={()=>setFinPeriod(k)}
          className={`px-2.5 py-1 text-sm font-semibold rounded-md transition-all ${finPeriod===k?"bg-accent-blue text-white":"text-text-muted"}`}>
          {k==="annual"?"연간":"분기"}
        </button>
      ))}
    </div>
  );
}

/* ── 재무제표 탭 — 전치 테이블 ──────────────────────────── */
export function TransTable({ rows, allYears, getVal, finPeriod }: {
  rows: { key: string; label: string; fmt: (v: number) => string; color: string; boldLabel?: boolean }[];
  allYears: string[];
  getVal: (key: string, year: string) => number | null;
  finPeriod: "annual" | "quarterly";
}) {
  if (!allYears.length) return <p className="text-text-muted text-base py-4 text-center">연결 중...</p>;
  const filteredRows = rows.filter(r => r.key);
  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="text-sm w-max min-w-full">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left pb-2 font-medium text-text-muted sticky left-0 bg-bg-card w-28 min-w-[7rem] whitespace-nowrap">지표</th>
            {allYears.map(y=>(
              <th key={y} className={`text-right pb-2 font-mono font-medium min-w-[72px] px-2 whitespace-nowrap ${y.endsWith("E")?"text-accent-yellow/80":"text-text-muted"}`}>
                {y.endsWith("E") ? y : (finPeriod === "quarterly" ? y.replace(/(\d{4})-?Q(\d)/, "$1 Q$2") : y)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filteredRows.map(({ key, label, fmt, color, boldLabel })=>(
            <tr key={key} className="border-b border-border/30 hover:bg-bg-hover">
              <td className={`py-1.5 pr-3 text-text-muted sticky left-0 bg-bg-card whitespace-nowrap ${boldLabel?"font-semibold":""}`}>{label}</td>
              {allYears.map(y=>{
                const v = getVal(key, y);
                const isEst = y.endsWith("E");
                return (
                  <td key={y} className={`py-1.5 px-2 text-right font-mono ${color} ${isEst?"opacity-70 italic":""}`}>
                    {v!=null ? fmt(v) : "—"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── 사용자설정 재무지표 옵션 ───────────────────────────── */
