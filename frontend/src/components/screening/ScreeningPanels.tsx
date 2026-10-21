/**
 * 스크리닝 도구 줄 아래에 펼치는 판들 — 조건 묶음, 조건, 칸 고르기, 보기 저장.
 * 참고한 스크리너의 Preset Filters · Custom Filters · Columns · Save view 자리다.
 */
import { useState, type FormEvent } from "react";
import { Button, INPUT_CLASS, cn, 지움단추 } from "@/components/ui";
import type { ScreeningPreset } from "@/types";
import {
  칸들, 처음칸, 글조건, 글값, 기본묶음, 같은조건, 시장조건묶음, ETF칸, 칸이름,
} from "./screeningDefs";

export type 조건모음 = Record<string, any>;
export type 고를값들 = { exchange?: string[]; country?: string[]; sector?: string[]; industry?: string[] };
export type 기본묶음하나 = (typeof 기본묶음)[number];

const 시장말: Record<string, string> = { US: "미국", KR: "한국", ETF: "ETF" };

/** 적은 글 → 숫자. 비었거나 숫자가 아니면 없음 */
function 수로(글: string): number | undefined {
  const t = 글.trim();
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

// ── 조건 ──────────────────────────────────────────────────

/** 최소·최대를 적고 '적용' 을 눌러야 걸린다 — 적는 도중의 '1' 이나 '-' 로 표가 매번 다시 불리지 않게 */
export function 조건판({ 시장, 조건, 고를값, 적용 }: {
  시장: string;
  조건: 조건모음;
  고를값?: 고를값들;
  적용: (다음: 조건모음) => void;
}) {
  const [초안, set초안] = useState<Record<string, { min: string; max: string }>>(() => {
    const 처음: Record<string, { min: string; max: string }> = {};
    for (const [k, v] of Object.entries(조건)) {
      if (v && ("min" in v || "max" in v)) 처음[k] = { min: v.min != null ? String(v.min) : "", max: v.max != null ? String(v.max) : "" };
    }
    return 처음;
  });
  const [글초안, set글초안] = useState<Record<string, string>>(
    () => Object.fromEntries(글조건.map((g) => [g.key, 조건[g.key]?.eq ?? ""])),
  );
  const [틀림, set틀림] = useState<string | null>(null);
  const 억 = 시장 === "KR" ? "억원" : "억달러";
  const 묶음들 = 시장조건묶음(시장);

  const 적기 = (k: string, 끝: "min" | "max", 값: string) =>
    set초안((앞) => ({ ...앞, [k]: { min: 앞[k]?.min ?? "", max: 앞[k]?.max ?? "", [끝]: 값 } }));

  const 보내기 = (e: FormEvent) => {
    e.preventDefault();
    const 다음: 조건모음 = {};
    for (const g of 묶음들) {
      for (const c of g.조건) {
        const lo = 수로(초안[c.key]?.min ?? ""), hi = 수로(초안[c.key]?.max ?? "");
        if (lo == null && hi == null) continue;
        if (lo != null && hi != null && lo > hi) {
          set틀림(`${c.이름} — 최소가 최대보다 커요`);
          return;
        }
        다음[c.key] = { ...(lo != null && { min: lo }), ...(hi != null && { max: hi }) };
      }
    }
    for (const [k, v] of Object.entries(글초안)) if (v) 다음[k] = { eq: v };
    set틀림(null);
    적용(다음);
  };

  const 지우기 = () => {
    set초안({});
    set글초안(Object.fromEntries(글조건.map((g) => [g.key, ""])));
    set틀림(null);
  };

  const 칸글 = "w-full min-w-0 bg-bg-primary border border-border rounded-lg px-2 py-1 text-xs text-text-primary " +
    "placeholder:text-text-dim focus:outline-none focus:border-accent-blue transition-colors";
  const 글고르기 = 글조건.filter((g) => (고를값?.[g.key]?.length ?? 0) > 0 || 글초안[g.key]);

  return (
    <form onSubmit={보내기} className="flex flex-col gap-4" aria-label="조건">
      {글고르기.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {글고르기.map((g) => {
            const 값들 = 고를값?.[g.key] ?? [];
            const 지금 = 글초안[g.key];
            return (
              <label key={g.key} className="flex flex-col gap-1">
                <span className="text-2xs font-semibold text-text-muted">{g.이름}</span>
                <select value={지금} onChange={(e) => set글초안((앞) => ({ ...앞, [g.key]: e.target.value }))}
                  className={cn(칸글, "py-1.5")}>
                  <option value="">전체</option>
                  {/* 저장한 보기의 값이 이 시장에 없을 수도 있다 — 고른 것은 늘 보이게 */}
                  {지금 && !값들.includes(지금) && <option value={지금}>{글값(g.key, 지금)}</option>}
                  {값들.map((v) => <option key={v} value={v}>{글값(g.key, v)}</option>)}
                </select>
              </label>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
        {묶음들.map((g) => (
          <fieldset key={g.이름} className="flex flex-col gap-1.5 min-w-0">
            <legend className="text-xs font-semibold text-text-secondary mb-1">{g.이름}</legend>
            {g.조건.map((c) => {
              const 이름 = c.억 ? `${c.이름} (${억})` : c.이름;
              return (
                <div key={c.key} className="grid grid-cols-[minmax(0,1fr)_4.75rem_auto_4.75rem] items-center gap-1.5">
                  <span className="text-2xs text-text-muted truncate" title={이름}>{이름}</span>
                  <input type="number" step="any" placeholder="최소" aria-label={`${이름} 최소`}
                    value={초안[c.key]?.min ?? ""} onChange={(e) => 적기(c.key, "min", e.target.value)} className={칸글} />
                  <span className="text-text-dim text-2xs" aria-hidden>~</span>
                  <input type="number" step="any" placeholder="최대" aria-label={`${이름} 최대`}
                    value={초안[c.key]?.max ?? ""} onChange={(e) => 적기(c.key, "max", e.target.value)} className={칸글} />
                </div>
              );
            })}
          </fieldset>
        ))}
      </div>

      {/* 조건이 길어 휴대폰에선 화면을 넘는다 — 적용 단추가 늘 손 닿는 곳에 있게 붙여 둔다.
          bottom-0 이면 하단 탭 바로 위다: 붙는 자리는 스크롤 상자(main)의 안쪽 여백을 빼고 잡는데,
          main 이 하단 탭 높이만큼 아래 여백을 두고 있다(탭 높이를 또 더하면 한 줄 위에 뜬다) */}
      <div className="sticky bottom-0 -mx-4 -mb-4 px-4 py-3
                      bg-bg-card border-t border-border rounded-b-xl flex items-center gap-2">
        {틀림 && <p role="alert" className="text-xs text-accent-red mr-auto">{틀림}</p>}
        <Button type="button" variant="ghost" size="sm" onClick={지우기} className="ml-auto">모두 지우기</Button>
        <Button type="submit" size="sm">적용</Button>
      </div>
    </form>
  );
}

// ── 칸 고르기 ─────────────────────────────────────────────

export function 칸판({ 시장, 보이는, 바꾸기 }: {
  시장: string;
  보이는: string[];
  바꾸기: (다음: string[]) => void;
}) {
  const 고를칸 = 시장 === "ETF" ? 칸들.filter((c) => ETF칸.has(c.key)) : 칸들;
  const 켜짐 = new Set(보이는);
  const 켠수 = 고를칸.filter((c) => 켜짐.has(c.key)).length;
  const 토글 = (k: string) => {
    const 다음 = new Set(켜짐);
    if (다음.has(k)) 다음.delete(k); else 다음.add(k);
    바꾸기(칸들.filter((c) => 다음.has(c.key)).map((c) => c.key));
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-text-secondary">
          보일 칸 <span className="font-normal text-text-muted">{켠수}/{고를칸.length}</span>
        </p>
        <Button variant="ghost" size="sm" onClick={() => 바꾸기(처음칸)}>처음대로</Button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-0.5">
        {고를칸.map((c) => (
          <label key={c.key} className="flex items-center gap-2 py-1.5 text-xs text-text-secondary hover:text-text-primary cursor-pointer min-w-0">
            <input type="checkbox" checked={켜짐.has(c.key)} onChange={() => 토글(c.key)} className="accent-accent-blue flex-shrink-0" />
            <span className="truncate">{칸이름(c, 시장)}</span>
          </label>
        ))}
      </div>
      {시장 === "ETF" && (
        <p className="text-2xs text-text-muted">ETF 는 회사가 아니어서 매출·이익 같은 칸은 없어요.</p>
      )}
    </div>
  );
}

// ── 조건 묶음 ─────────────────────────────────────────────

export function 묶음판({ 시장, 지금, 고르기, 로그인함, 저장들, 보기열기, 보기지우기 }: {
  시장: string;
  지금: { 조건: 조건모음; 정렬: string; 순서: string };
  고르기: (묶음: 기본묶음하나) => void;
  로그인함: boolean;
  저장들?: ScreeningPreset[];
  보기열기: (p: ScreeningPreset) => void;
  보기지우기: (p: ScreeningPreset) => void;
}) {
  // ETF 에 ROE·성장률 같은 조건을 걸면 0곳이다 — ETF 에도 값이 있는 묶음만
  const 묶음들 = 시장 === "ETF"
    ? 기본묶음.filter((p) => Object.keys(p.조건).every((k) => ETF칸.has(k)) && ETF칸.has(p.정렬[0]))
    : 기본묶음;
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold text-text-secondary">자주 쓰는 조건</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {묶음들.map((p) => {
            const 고름 = 같은조건(지금.조건, p.조건) && 지금.정렬 === p.정렬[0] && 지금.순서 === p.정렬[1];
            return (
              <button key={p.이름} type="button" aria-pressed={고름} onClick={() => 고르기(p)}
                className={cn(
                  "text-left rounded-lg border px-3 py-2 transition-colors",
                  고름 ? "border-accent-blue bg-accent-blue/10" : "border-border bg-bg-elevated hover:border-accent-blue/50",
                )}>
                <span className={cn("block text-xs font-semibold", 고름 ? "text-accent-blue" : "text-text-primary")}>{p.이름}</span>
                <span className="block text-2xs text-text-muted mt-0.5">{p.설명}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold text-text-secondary">내가 저장한 보기</h2>
        {!로그인함 ? (
          <p className="text-xs text-text-muted">로그인하면 지금 보는 시장·조건·정렬·칸을 저장해 두고 다시 열 수 있어요.</p>
        ) : !저장들?.length ? (
          <p className="text-xs text-text-muted">아직 저장한 보기가 없어요. ‘보기 저장’ 으로 지금 화면을 남겨 보세요.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {저장들.map((p) => (
              <li key={p.id} className="flex items-center gap-1">
                <button type="button" onClick={() => 보기열기(p)}
                  className="flex-1 min-w-0 text-left text-xs px-3 py-2 rounded-lg border border-border bg-bg-elevated hover:border-accent-blue/50 transition-colors">
                  <span className="font-semibold text-text-primary">{p.name}</span>{" "}
                  <span className="text-text-muted ml-1">
                    · {시장말[p.market] ?? p.market} · 조건 {Object.keys(p.filters ?? {}).length}개
                    {p.columns?.length ? ` · 칸 ${p.columns.length}개` : ""}
                  </span>
                </button>
                <지움단추 ariaLabel={`${p.name} 보기 지우기`} onClick={() => 보기지우기(p)} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ── 보기 저장 ─────────────────────────────────────────────

export function 저장판({ 로그인함, 저장, 저장중, 로그인하기 }: {
  로그인함: boolean;
  저장: (이름: string) => void;
  저장중: boolean;
  로그인하기: () => void;
}) {
  const [이름, set이름] = useState("");
  if (!로그인함) {
    return (
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-text-muted">로그인하면 지금 보기(시장·조건·정렬·칸)를 저장해 둘 수 있어요.</p>
        <Button size="sm" onClick={로그인하기}>로그인</Button>
      </div>
    );
  }
  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (이름.trim()) 저장(이름.trim()); }}>
      <label htmlFor="스크리닝-보기-이름" className="text-xs font-semibold text-text-secondary">
        지금 보기 저장 <span className="font-normal text-text-muted">— 시장·조건·정렬·칸을 함께 남겨요</span>
      </label>
      <div className="flex gap-2">
        <input id="스크리닝-보기-이름" value={이름} onChange={(e) => set이름(e.target.value)} maxLength={50}
          placeholder="예: 저평가 반도체" className={INPUT_CLASS} />
        <Button type="submit" disabled={!이름.trim() || 저장중} className="flex-shrink-0">
          {저장중 ? "저장 중…" : "저장"}
        </Button>
      </div>
    </form>
  );
}
