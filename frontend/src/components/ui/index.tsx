import React from "react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...i: ClassValue[]) { return twMerge(clsx(i)); }

/* ── Card ──────────────────────────────────────────────── */
export function Card({ children, className, onClick }: {
  children: React.ReactNode; className?: string; onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "bg-bg-card border border-border rounded-xl",
        !className?.includes("p-0") && "p-4",
        onClick && "cursor-pointer hover:border-accent-blue/40 transition-colors",
        className,
      )}
    >{children}</div>
  );
}

/* ── 등락 배지 ─────────────────────────────────────────── */
export function ChangeBadge({ value, suffix = "%", className }: {
  value: number; suffix?: string; className?: string;
}) {
  const pos = value >= 0;
  return (
    <span className={cn("font-mono font-semibold num", pos ? "text-accent-green" : "text-accent-red", className)}>
      {pos ? "+" : ""}{value.toFixed(2)}{suffix}
    </span>
  );
}

/* ── 스피너 ────────────────────────────────────────────── */
export function LoadingSpinner({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const s = size === "sm" ? "w-5 h-5" : size === "lg" ? "w-12 h-12" : "w-8 h-8";
  return (
    <div className="flex items-center justify-center py-8">
      <div className={cn(s, "border-2 border-accent-blue border-t-transparent rounded-full animate-spin")} />
    </div>
  );
}

/* ── 배지 ──────────────────────────────────────────────── */
export function Badge({ children, variant = "default" }: {
  children: React.ReactNode;
  variant?: "default" | "blue" | "green" | "red" | "yellow" | "purple";
}) {
  const v: Record<string, string> = {
    default: "bg-bg-elevated border-border text-text-muted",
    blue:    "bg-blue-900/30 border-blue-700/40 text-blue-400",
    green:   "bg-green-900/30 border-green-700/40 text-accent-green",
    red:     "bg-red-900/30 border-red-700/40 text-accent-red",
    yellow:  "bg-yellow-900/30 border-yellow-700/40 text-accent-yellow",
    purple:  "bg-purple-900/30 border-purple-700/40 text-purple-400",
  };
  return <span className={cn("text-2xs px-1.5 py-0.5 rounded border font-semibold", v[variant])}>{children}</span>;
}

/* ── 탭 ────────────────────────────────────────────────── */
export function Tabs({ tabs, active, onChange }: {
  tabs: { id: string; label: string }[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex gap-0.5 p-1 bg-bg-card border border-border rounded-xl">
      {tabs.map((t) => (
        <button key={t.id} onClick={() => onChange(t.id)}
          className={cn("flex-1 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all",
            active === t.id ? "bg-accent-blue text-white shadow" : "text-text-muted hover:text-text-primary"
          )}
        >{t.label}</button>
      ))}
    </div>
  );
}

/* ── 버튼 ──────────────────────────────────────────────── */
export function Button({ children, variant = "primary", size = "md", className, ...p }: {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const vMap = {
    primary:   "bg-accent-blue hover:bg-blue-600 text-white",
    secondary: "bg-bg-elevated border border-border text-text-primary hover:border-accent-blue",
    ghost:     "text-text-muted hover:text-text-primary hover:bg-bg-elevated",
    danger:    "bg-red-600/20 border border-red-700/50 text-accent-red hover:bg-red-600/30",
  };
  const sMap = { sm: "px-3 py-1 text-xs", md: "px-4 py-2 text-sm", lg: "px-6 py-2.5 text-sm" };
  return (
    <button {...p} className={cn("font-semibold rounded-lg transition-colors disabled:opacity-40", vMap[variant], sMap[size], className)}>
      {children}
    </button>
  );
}

/* ── 범위 필터 입력 ────────────────────────────────────── */
export function RangeFilter({ label, filterKey, filters, onChange }: {
  label: string; filterKey: string; filters: Record<string, any>;
  onChange: (k: string, v: { min?: number; max?: number }) => void;
}) {
  const c = filters[filterKey] ?? {};
  const inp = "w-full bg-bg-primary border border-border rounded-lg px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent-blue transition-colors";
  return (
    <div className="flex flex-col gap-1">
      <label className="text-2xs font-semibold text-text-muted">{label}</label>
      <div className="flex gap-1.5 items-center">
        <input type="number" placeholder="최소" className={inp} value={c.min ?? ""}
          onChange={(e) => onChange(filterKey, { ...c, min: e.target.value !== "" ? +e.target.value : undefined })} />
        <span className="text-text-dim text-xs">~</span>
        <input type="number" placeholder="최대" className={inp} value={c.max ?? ""}
          onChange={(e) => onChange(filterKey, { ...c, max: e.target.value !== "" ? +e.target.value : undefined })} />
      </div>
    </div>
  );
}

/* ── 숫자 포맷 ─────────────────────────────────────────── */
export function formatNumber(n: number | null | undefined, digits = 0): string {
  if (n == null) return "—";
  if (Math.abs(n) >= 1e12) return (n / 1e12).toFixed(1) + "조";
  if (Math.abs(n) >= 1e8)  return (n / 1e8).toFixed(1) + "억";
  if (Math.abs(n) >= 1e4)  return (n / 1e4).toFixed(1) + "만";
  return n.toLocaleString("ko-KR", { maximumFractionDigits: digits });
}

export function fmtPct(v: number | null | undefined) {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}
